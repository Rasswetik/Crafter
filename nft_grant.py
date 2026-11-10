"""Administrator grants into a player's inventory.

* Ordinary Telegram gifts and card packs can be given directly.
* An NFT gift can be given ONLY by its link (https://t.me/nft/Name-123) and only while the gift really sits on the
  relayer account or in the Thermos inventory. Anything else is refused: nothing is invented without backing.
"""
import asyncio
import json
import re

from flask import abort, request

import relayer_transfer as rt

LINK = re.compile(r'https://(?:t\.me|telegram\.me)/nft/([A-Za-z0-9]+)-([1-9][0-9]{0,9})')


def install_nft_grant(app, db, auth, record, audit):
    def player(uid):
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            abort(404, description='Игрок не найден')

    def already_given(slug):
        needle = '%' + slug.lower() + '%'
        for row in db().execute("SELECT payload FROM inventory WHERE lower(payload) LIKE ?", (needle,)):
            try:
                if str(json.loads(row['payload']).get('telegram_slug') or '').lower() == slug.lower():
                    return True
            except ValueError:
                continue
        return False

    def on_relayer(slug):
        """The relayer's saved-gift entry for this slug, or None. Raises when the relayer is not connected."""
        api_id, api_hash, session, _ = app.extensions['crafter_relayer_credentials']()
        return asyncio.run(rt.entry_by_slug(api_id, api_hash, session, slug))

    def thermos_has(slug):
        owns = app.extensions.get('crafter_thermos_owns')
        return bool(owns and owns(slug))

    @app.post('/api/admin/users/<int:uid>/nft-gift')
    @auth(admin=True)
    def grant_nft_by_link(uid):
        link = str((request.get_json(silent=True) or {}).get('link') or '').strip()
        found = LINK.fullmatch(link)
        if not found:
            abort(400, description='Нужна ссылка на подарок вида https://t.me/nft/PlushPepe-1234')
        player(uid)
        slug = found.group(1) + '-' + found.group(2)
        if already_given(slug):
            abort(409, description='Этот подарок уже есть в инвентаре игрока или другого игрока')
        entry, thermos = None, False
        try:
            entry = on_relayer(slug)
        except Exception:
            entry = None
        if entry is None:
            thermos = thermos_has(slug)
        if entry is None and not thermos:
            abort(409, description='Подарка нет на релейере и в инвентаре Thermos: выдать его нельзя')
        if entry is not None:
            from telegram_deposits import gift_payload
            gift = gift_payload(entry)
            if not gift:
                abort(409, description='Не удалось прочитать подарок на релейере')
        else:
            title = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', found.group(1))
            number = int(found.group(2))
            gift = {'id': 'thermos-' + slug.lower(), 'name': title, 'collection_id': found.group(1).lower(), 'number': number, 'source_number': number,
                    'model': '', 'symbol': '', 'backdrop': '', 'price': '0', 'floor_price': '0', 'price_unit': 'GRAM', 'origin': 'thermos',
                    'telegram_slug': slug, 'telegram_url': 'https://t.me/nft/' + slug, 'relayer_pending': True,
                    'image': 'https://nft.fragment.com/gift/' + slug.lower() + '.webp'}
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute("SELECT 1 FROM inventory WHERE nft_id=?", (gift['id'],)).fetchone():
                abort(409, description='Этот подарок уже выдан')
            db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted')", (uid, gift['id'], json.dumps(gift, ensure_ascii=False)))
            record('gift_granted', {'gift': gift, 'source': 'admin-link'}, uid=uid)
        audit('NFT granted by link to ' + str(uid) + ': ' + slug + (' (relayer)' if entry is not None else ' (Thermos)'))
        return {'ok': True, 'gift': gift, 'source': 'relayer' if entry is not None else 'thermos'}

    @app.post('/api/admin/users/<int:uid>/packs')
    @auth(admin=True)
    def grant_packs(uid):
        body = request.get_json(silent=True) or {}
        try:
            count = int(body.get('count') or 1)
        except (TypeError, ValueError):
            abort(400, description='Количество — целое число')
        pack_id = str(body.get('pack_id') or '')
        if not 1 <= count <= 50 or not app.extensions['crafter_pack_exists'](pack_id):
            abort(400, description='Выберите существующий пак и количество от 1 до 50')
        player(uid)
        with db():
            db().execute('BEGIN IMMEDIATE')
            ids = [app.extensions['crafter_grant_pack'](uid, pack_id, 'admin') for _ in range(count)]
        audit('Pack %s x%d granted to %d' % (pack_id, count, uid))
        return {'ok': True, 'pack_ids': ids}
