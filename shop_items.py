"""Seasonal shop items besides NFT lots: GRAM balance, New Year balls, card packs and buyer-bound promo codes.

Items are paid for in New Year balls (0 = free), can have a stock and a per-player limit.
"""
import re
import secrets
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'PROMO', 'BUNDLE', 'CHEST', 'DROP')
PROMO_KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'CHEST')
RARITIES = ('auto', 'common', 'rare', 'special', 'epic', 'mythic', 'legend')   # the colour and the name of an offer; auto = by price
CARD_BGS = ('ny-snow', 'ny-candy', 'ny-lights', 'ny-frost', 'ny-ginger', 'ny-bells', 'ny-fire', 'ny-aurora',
            'c-blue', 'c-violet', 'c-crimson', 'c-emerald', 'c-gold', 'c-pink',
            'ny-tree', 'ny-stars', 'ny-mitten', 'ny-cozy', 'ny-ice', 'ny-gold', 'ny-pine', 'ny-berry', 'ny-cocoa', 'ny-polar', 'ny-moon',
            'ny-cabin', 'ny-bauble', 'ny-gifts', 'ny-sparklers', 'ny-champagne', 'ny-northpole', 'ny-wreath', 'ny-skating', 'ny-santa', 'c-sunrise', 'c-desert', 'c-jungle', 'c-cherry', 'c-space', 'c-cyber', 'c-bubbles', 'c-storm', 'c-hex',
            'ny-nikolay', 'ny-goshan', 'ny-gifton', 'ny-collab',
            'ny-fireworks', 'ny-confetti', 'ny-snowstorm', 'c-galaxy', 'c-neon', 'c-sunset', 'c-ocean', 'c-forest', 'c-mint', 'c-rose', 'c-steel', 'c-lava',
            'c-softsky', 'c-softberry', 'c-softmint', 'c-softgold', 'c-softnight', 'c-softrose', 'c-softocean', 'c-softlilac', 'c-softember', 'c-softcocoa', 'c-softpine', 'c-softslate')                  # the background of one offer card
SIZES = ('small', 'wide', 'tall', 'large', 'banner')     # 1x1, 2x1 stretched, 1x2 long, 2x2 big, a whole row
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
_LIMIT = 10**9


def plain(d):
    return format(d.normalize(), 'f') if d else '0'


def install_shop_items(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS shop_items(
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, promo_kind TEXT NOT NULL DEFAULT '',
            amount TEXT NOT NULL, title TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '',
            price_balls BIGINT NOT NULL DEFAULT 0, stock BIGINT, per_user BIGINT,
            sold BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shop_item_buys(
            item_id TEXT NOT NULL, user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            result TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(user_id,request_id)
        );
        """)

        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS bundle BIGINT NOT NULL DEFAULT 1")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS old_price_balls BIGINT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS contents TEXT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS position INTEGER")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT 'small'")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'auto'")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS badge TEXT NOT NULL DEFAULT ''")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS ends_at BIGINT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS section_id TEXT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS heading TEXT NOT NULL DEFAULT ''")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS starts_at BIGINT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT ''")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS card_bg TEXT NOT NULL DEFAULT ''")
        else:
            cols = [r['name'] for r in database.execute("PRAGMA table_info(shop_items)").fetchall()]
            if 'bundle' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN bundle BIGINT NOT NULL DEFAULT 1")
            if 'old_price_balls' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN old_price_balls BIGINT")
            if 'contents' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN contents TEXT")
            if 'position' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN position INTEGER")
            if 'size' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN size TEXT NOT NULL DEFAULT 'small'")
            if 'description' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN description TEXT NOT NULL DEFAULT ''")
            if 'rarity' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN rarity TEXT NOT NULL DEFAULT 'auto'")
            if 'badge' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN badge TEXT NOT NULL DEFAULT ''")
            if 'ends_at' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN ends_at BIGINT")
            if 'section_id' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN section_id TEXT")
            if 'starts_at' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN starts_at BIGINT")
            if 'mode' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN mode TEXT NOT NULL DEFAULT ''")
            if 'heading' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN heading TEXT NOT NULL DEFAULT ''")
            if 'card_bg' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN card_bg TEXT NOT NULL DEFAULT ''")

    import json

    def wallet_balls(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def option_pack(key):
        key = str(key)
        if key.startswith('chest:'):
            ch = app.extensions['crafter_chest_short'](key[6:])
            return {'id': key, 'title': ch['title'], 'image': ch['image'], 'type': 'CHEST'} if ch else None
        if key.startswith('drop:'):
            d = app.extensions['crafter_drop_short'](key[5:])
            return {'id': key, 'title': d['title'], 'image': d['image'], 'type': 'DROP'} if d else None
        return app.extensions['crafter_pack_short'](key)

    def view(row, uid=None):
        mine = 0
        if uid:
            mine = int(db().execute("SELECT COUNT(*) AS n FROM shop_item_buys WHERE item_id=? AND user_id=?", (row['id'], uid)).fetchone()['n'])
        pack = None
        pid = row['amount'] if row['kind'] == 'PACK' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'PACK') else None
        if pid and app.extensions.get('crafter_pack_short'):
            pack = app.extensions['crafter_pack_short'](pid)
        mix, parts = None, {}
        if row['contents']:
            try:
                raw = json.loads(row['contents'])
                if isinstance(raw, dict):
                    parts = {'gram': raw.get('gram') or None, 'balls': int(raw.get('balls') or 0) or None,
                             'chests': [x for x in ({'chest': app.extensions['crafter_chest_short'](c['chest_id']), 'count': int(c['count'])} for c in (raw.get('chests') or [])) if x['chest']] or None,
                             'drops': [x for x in ({'drop': app.extensions['crafter_drop_short'](c['drop_id']), 'count': int(c['count'])} for c in (raw.get('drops') or [])) if x['drop']] or None}
                    raw = raw.get('packs') or []
                mix = [{'pack': option_pack(c['pack_id']), 'count': int(c['count']), 'price': (int(c['price']) if c.get('price') is not None else None)} for c in raw]
                mix = [c for c in mix if c['pack']] or None
            except (ValueError, KeyError, TypeError):
                mix = None
        star = None
        if row['kind'] == 'STAR' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'STAR'):
            star = app.extensions['crafter_star_gift_short'](row['amount'])
        chest = app.extensions['crafter_chest_short'](row['amount']) if row['kind'] == 'CHEST' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'CHEST') else None
        drop = app.extensions['crafter_drop_short'](row['amount']) if row['kind'] == 'DROP' else None
        left = None if row['stock'] is None else max(0, int(row['stock']) - int(row['sold']))
        return {'id': row['id'], 'kind': row['kind'], 'promo_kind': row['promo_kind'], 'amount': row['amount'],
                'title': row['title'], 'image_url': row['image_url'] or (pack['image'] if pack else '') or (star['image'] if star else '') or (chest['image'] if chest else '') or (drop['image'] if drop else ''), 'chest': chest, 'drop': drop, 'pack': pack, 'star': star, 'contents': mix, 'gram': parts.get('gram'), 'balls': parts.get('balls'), 'chests_in': parts.get('chests'), 'drops_in': parts.get('drops'),
                'price_balls': int(row['price_balls']), 'old_price_balls': (int(row['old_price_balls']) if row['old_price_balls'] else None),
                'discount_percent': (round((1 - int(row['price_balls']) / int(row['old_price_balls'])) * 100) if row['old_price_balls'] and int(row['old_price_balls']) > int(row['price_balls']) else None),
                'stock': row['stock'], 'left': left, 'sold': int(row['sold']),
                'per_user': row['per_user'], 'bundle': int(row['bundle'] or 1), 'mine': mine, 'status': row['status'],
                'size': row['size'] if row['size'] in SIZES else 'small', 'description': row['description'] or '',
                'rarity': row['rarity'] if row['rarity'] in RARITIES else 'auto', 'badge': row['badge'] or '',
                'ends_at': int(row['ends_at']) if row['ends_at'] else None, 'section_id': row['section_id'] or '', 'heading': row['heading'] or '', 'card_bg': row['card_bg'] or (('image:' + chest['bg_collection']) if chest and chest.get('bg_collection') else ''),
                'starts_at': int(row['starts_at']) if row['starts_at'] else None, 'mode': row['mode'] or ''}

    def order_mode():
        row = db().execute("SELECT payload FROM settings WHERE key='shop_items_order_v1'").fetchone()
        try:
            return 'manual' if row and json.loads(row['payload']).get('mode') == 'manual' else 'price'
        except (ValueError, TypeError, AttributeError):
            return 'price'

    def ordered(rows):
        if order_mode() == 'manual':
            return sorted(rows, key=lambda r: (r['position'] is None, r['position'] or 0, int(r['price_balls']), r['created']))
        return sorted(rows, key=lambda r: (int(r['price_balls']), r['created']))

    @app.get('/api/shop-items')
    @auth()
    def shop_items():
        now = int(time.time())
        rows = ordered(db().execute("SELECT * FROM shop_items WHERE status='active' AND (ends_at IS NULL OR ends_at>?) AND (starts_at IS NULL OR starts_at<=?)", (now, now)).fetchall())
        hidden = app.extensions['crafter_hidden_sections']()
        rows = [r for r in rows if (r['section_id'] or '') not in hidden]
        return {'items': [view(r, g.user['id']) for r in rows], 'now': now, 'sections': app.extensions['crafter_shop_sections'](False), **app.extensions['crafter_exchange_public'](g.user['id'])}

    @app.post('/api/shop-items/buy')
    @auth()
    def shop_items_buy():
        body = request.get_json(silent=True) or {}
        iid, rid = body.get('item_id'), body.get('request_id')
        if not isinstance(iid, str) or not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', rid):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute("SELECT item_id,result FROM shop_item_buys WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
            if done:
                if done['item_id'] != iid:
                    abort(409, description='Номер покупки уже использован')
                return json.loads(done['result'])
            row = db().execute("SELECT * FROM shop_items WHERE id=? AND status='active'", (iid,)).fetchone()
            if not row or (row['section_id'] or '') in app.extensions['crafter_hidden_sections']():
                abort(409, description='Товар недоступен')
            if row['ends_at'] and int(row['ends_at']) <= int(time.time()):
                abort(409, description='Акция уже закончилась')
            if row['starts_at'] and int(row['starts_at']) > int(time.time()):
                abort(409, description='Акция ещё не началась')
            picked = None
            if row['mode'] in ('choice', 'random'):
                spec_pool = json.loads(row['contents'] or '[]')
                if row['mode'] == 'choice':
                    picked = next((c for c in spec_pool if c['pack_id'] == body.get('choice')), None)
                    if not picked:
                        abort(400, description='Выберите один из вариантов')
                else:
                    picked = secrets.choice(spec_pool)
            if row['stock'] is not None and int(row['sold']) >= int(row['stock']):
                abort(409, description='Товар закончился')
            if row['per_user'] is not None:
                have = db().execute("SELECT COUNT(*) AS n FROM shop_item_buys WHERE item_id=? AND user_id=?", (iid, uid)).fetchone()['n']
                if int(have) >= int(row['per_user']):
                    abort(409, description='Лимит покупок на игрока исчерпан')
            price, balls = int(row['price_balls']), wallet_balls(uid)
            if row['mode'] == 'choice' and picked and picked.get('price') is not None:
                price = int(picked['price'])
            if balls < price:
                abort(409, description='Недостаточно новогодних шаров')
            if price:
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls - price, uid))
            balls -= price
            if price:
                app.extensions['crafter_author_reward'](uid, 'BALLS', price, 'shop:' + iid)
            result = {'ok': True, 'kind': row['kind'], 'title': row['title'], 'balance': {'balls': balls}}
            now = int(time.time())
            if row['kind'] == 'GRAM':
                acc = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
                after = (Decimal(str(acc['balance'])) if acc else Decimal('0')) + Decimal(row['amount'])
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                result.update(gram=row['amount'], gram_balance=str(after))
            elif row['kind'] == 'BALL':
                gain = int(row['amount'])
                if balls + gain > _LIMIT:
                    abort(409, description='Баланс шаров превысит максимум')
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls + gain, uid))
                balls += gain
                result.update(balls_gain=gain, balance={'balls': balls})
            elif row['kind'] == 'BUNDLE':
                spec = json.loads(row['contents'] or '{}')
                ids = [app.extensions['crafter_grant_pack'](uid, c['pack_id'], 'shop:' + iid) for c in spec.get('packs', []) for _ in range(int(c['count']))]
                if spec.get('gram'):
                    acc = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
                    after = (Decimal(str(acc['balance'])) if acc else Decimal('0')) + Decimal(spec['gram'])
                    db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                    result.update(gram=spec['gram'], gram_balance=str(after))
                opens = []
                for c in spec.get('chests', []):
                    for _ in range(int(c['count'])):
                        opens.append(app.extensions['crafter_open_chest'](uid, c['chest_id'], 'shop:' + iid))
                for c in spec.get('drops', []):
                    app.extensions['crafter_start_drops'](uid, c['drop_id'], int(c['count']), 'shop:' + iid)
                    result.update(drop_granted={'drop': app.extensions['crafter_drop_short'](c['drop_id']), 'qty': int(c['count'])})
                if opens:
                    result.update(chest_opens=opens, chest_open=opens[0])
                    balls = opens[-1]['balance']['balls']
                    result.update(balance={'balls': balls}, gram_balance=opens[-1]['gram_balance'])
                if spec.get('balls'):
                    gain = int(spec['balls'])
                    if balls + gain > _LIMIT:
                        abort(409, description='Баланс шаров превысит максимум')
                    db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                    db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls + gain, uid))
                    balls += gain
                    result.update(balls_gain=gain, balance={'balls': balls})
                if ids:
                    result.update(pack_id=ids[0], pack_ids=ids)
            elif row['kind'] == 'PACK':
                if picked and str(picked['pack_id']).startswith('chest:'):       # the option is a chest: it opens at once
                    opens = [app.extensions['crafter_open_chest'](uid, picked['pack_id'][6:], 'shop:' + iid) for _ in range(int(picked['count']))]
                    result.update(chest_open=opens[0], chest_opens=opens, balance=opens[-1]['balance'], gram_balance=opens[-1]['gram_balance'], picked=picked['pack_id'])
                    balls = opens[-1]['balance']['balls']
                    ids = []
                elif picked and str(picked['pack_id']).startswith('drop:'):      # the option is a drop: it opens at once
                    app.extensions['crafter_start_drops'](uid, picked['pack_id'][5:], int(picked['count']), 'shop:' + iid)
                    result.update(drop_granted={'drop': app.extensions['crafter_drop_short'](picked['pack_id'][5:]), 'qty': int(picked['count'])}, picked=picked['pack_id'])
                    ids = []
                elif picked:                                         # a choice or a random offer: one pack of the pool
                    ids = [app.extensions['crafter_grant_pack'](uid, picked['pack_id'], 'shop:' + iid) for _ in range(int(picked['count']))]
                    result['picked'] = picked['pack_id']
                elif row['contents']:                                # a mixed set: every pack of the set is given
                    ids = [app.extensions['crafter_grant_pack'](uid, c['pack_id'], 'shop:' + iid) for c in json.loads(row['contents']) for _ in range(int(c['count']))]
                else:
                    ids = [app.extensions['crafter_grant_pack'](uid, row['amount'], 'shop:' + iid) for _ in range(int(row['bundle'] or 1))]
                if ids:
                    result.update(pack_id=ids[0], pack_ids=ids)
            elif row['kind'] == 'CHEST':                            # a chest is never kept: it opens at once
                opens = [app.extensions['crafter_open_chest'](uid, row['amount'], 'shop:' + iid) for _ in range(int(row['bundle'] or 1))]
                opened = opens[-1]
                result.update(chest_open=opens[0], chest_opens=opens, balance=opened['balance'], gram_balance=opened['gram_balance'])
                balls = opened['balance']['balls']
            elif row['kind'] == 'DROP':                              # a drop goes to the inventory; the player opens it himself (4 attempts)
                n = int(row['bundle'] or 1)
                app.extensions['crafter_start_drops'](uid, row['amount'], n, 'shop:' + iid)
                result.update(drop_granted={'drop': app.extensions['crafter_drop_short'](row['amount']), 'qty': n})
            elif row['kind'] == 'STAR':
                ids = [app.extensions['crafter_grant_star_gift'](uid, row['amount'], 'shop:' + iid) for _ in range(int(row['bundle'] or 1))]
                result.update(star_gift=row['amount'], gift_ids=ids, count=len(ids))
            else:
                code = ''
                for _ in range(30):
                    cand = 'NY-' + ''.join(secrets.choice(ALPHABET) for _ in range(4)) + '-' + ''.join(secrets.choice(ALPHABET) for _ in range(4))
                    if not db().execute("SELECT 1 FROM promo_codes WHERE code=?", (cand,)).fetchone():
                        code = cand
                        break
                if not code:
                    abort(503, description='Не удалось создать код, повторите')
                db().execute("INSERT INTO promo_codes(code,reward,currency,uses_limit,used,active,created_by,created,owner_id) VALUES(?,?,?,?,0,1,?,?,?)",
                             (code, (row['amount'] + ':' + str(int(row['bundle'] or 1))) if row['promo_kind'] in ('PACK', 'STAR') else row['amount'], row['promo_kind'], 1, uid, now, uid))
                result['code'] = code
            db().execute("UPDATE shop_items SET sold=sold+1 WHERE id=?", (iid,))
            db().execute("INSERT INTO shop_item_buys(item_id,user_id,request_id,result,created) VALUES(?,?,?,?,?)",
                         (iid, uid, rid, json.dumps(result, ensure_ascii=False), now))
            record('shop_item_buy', {'item': iid, 'kind': row['kind'], 'price_balls': price}, uid=uid)
        return result

    # ---- administration (permission section: new-year) ----
    @app.get('/api/admin/new-year/shop')
    @auth(admin=True)
    def admin_shop():
        rows = ordered(db().execute("SELECT * FROM shop_items").fetchall())[:300]
        return {'items': [view(r) for r in rows], 'order': order_mode(), 'now': int(time.time()), 'sections': app.extensions['crafter_shop_sections'](True), 'bg_library': app.extensions['crafter_bg_library']()}

    def whole(value, low, high, name):
        try:
            n = int(value)
        except (TypeError, ValueError):
            abort(400, description='Укажите целое число: ' + name)
        if str(value).strip() != str(n) or not low <= n <= high:
            abort(400, description=name + ': от ' + str(low) + ' до ' + str(high))
        return n

    def parse_item(body):
        kind, promo = body.get('kind'), body.get('promo_kind') or ''
        if kind not in KINDS:
            abort(400, description='Неизвестный тип товара')
        if kind == 'PROMO' and promo not in PROMO_KINDS:
            abort(400, description='Тип промокода: GRAM, шары или пак')
        eff = promo if kind == 'PROMO' else kind
        mix, mix_title = None, ''
        bundle_spec = None
        packs_in = body.get('contents')
        if kind == 'BUNDLE':
            spec_in = packs_in if isinstance(packs_in, dict) else {}
            packs_in = spec_in.get('packs') if isinstance(spec_in.get('packs'), list) else []
            from packs import money
            gram_in = str(spec_in.get('gram') or '').strip()
            gram = plain(money(gram_in)) if gram_in not in ('', '0') else ''
            balls_in = str(spec_in.get('balls') or '').strip()
            balls_n = whole(balls_in, 1, _LIMIT, 'Шары') if balls_in not in ('', '0') else 0
            bundle_spec = {'gram': gram, 'balls': balls_n}
            chests = {}
            for entry in (spec_in.get('chests') if isinstance(spec_in.get('chests'), list) else []):
                cid = str((entry or {}).get('chest_id') or '')
                try:
                    n = int((entry or {}).get('count') or 0)
                except (TypeError, ValueError):
                    abort(400, description='Количество ящиков — целое число')
                if n <= 0:
                    continue
                if not app.extensions['crafter_chest_exists'](cid):
                    abort(400, description='В бандле есть несуществующий ящик')
                chests[cid] = chests.get(cid, 0) + n
            if sum(chests.values()) > 50:
                abort(400, description='В бандле не больше 50 ящиков')
            bundle_spec['chests'] = [{'chest_id': k, 'count': v} for k, v in chests.items()]
            drops_in = {}
            for entry in (spec_in.get('drops') if isinstance(spec_in.get('drops'), list) else []):
                did = str((entry or {}).get('drop_id') or '')
                try:
                    n = int((entry or {}).get('count') or 0)
                except (TypeError, ValueError):
                    abort(400, description='Количество дропов — целое число')
                if n <= 0:
                    continue
                if not app.extensions['crafter_drop_exists'](did):
                    abort(400, description='В бандле есть несуществующий дроп')
                drops_in[did] = drops_in.get(did, 0) + n
            if sum(drops_in.values()) > 50:
                abort(400, description='В бандле не больше 50 дропов')
            bundle_spec['drops'] = [{'drop_id': k, 'count': v} for k, v in drops_in.items()]
        mode = str(body.get('mode') or '')
        if mode not in ('', 'choice', 'random'):
            abort(400, description='Тип акции: обычная, с выбором или случайный пак')
        if mode and kind != 'PACK':
            abort(400, description='Выбор и случайная награда работают только в акциях типа «пак»')
        if (kind == 'PACK' or kind == 'BUNDLE') and isinstance(packs_in, list) and packs_in:
            merged, option_price = {}, {}
            for entry in packs_in:
                pid = str((entry or {}).get('pack_id') or '')
                if mode and not pid and (entry or {}).get('chest_id'):
                    pid = 'chest:' + str(entry['chest_id'])
                if mode and not pid and (entry or {}).get('drop_id'):
                    pid = 'drop:' + str(entry['drop_id'])
                raw_price = (entry or {}).get('price')
                if mode == 'choice' and str(raw_price if raw_price is not None else '').strip() not in ('', 'None'):
                    option_price[pid] = whole(raw_price, 0, _LIMIT, 'Цена варианта')
                try:
                    n = int((entry or {}).get('count') or 0)
                except (TypeError, ValueError):
                    abort(400, description='Количество паков в наборе — целое число')
                if n <= 0:
                    continue
                if mode and pid.startswith('chest:'):
                    if not app.extensions['crafter_chest_exists'](pid[6:]):
                        abort(400, description='Среди вариантов есть несуществующий ящик')
                elif mode and pid.startswith('drop:'):
                    if not app.extensions['crafter_drop_exists'](pid[5:]):
                        abort(400, description='Среди вариантов есть несуществующий дроп')
                elif not app.extensions['crafter_pack_exists'](pid):
                    abort(400, description='В наборе есть несуществующий пак')
                merged[pid] = merged.get(pid, 0) + n
            if not merged or sum(merged.values()) > 500:
                abort(400, description='В наборе от 1 до 500 паков')
            mix = json.dumps([({'pack_id': k, 'count': v, 'price': option_price[k]} if k in option_price else {'pack_id': k, 'count': v}) for k, v in merged.items()])
            if bundle_spec is not None:
                bundle_spec['packs'] = json.loads(mix)
            mix_title = ' + '.join(((app.extensions['crafter_pack_short'](k) or {}).get('title', 'Пак')) + (' ×' + str(v) if v > 1 else '') for k, v in merged.items() if ':' not in k)
            if mode and len(merged) < 2:
                abort(400, description='Для выбора или случайной награды нужно минимум два разных варианта')
            only_packs = all(':' not in k for k in merged)
            if mode == 'choice':
                mix_title = 'Пак на выбор' if only_packs else 'Награда на выбор'
            elif mode == 'random':
                mix_title = 'Случайный пак' if only_packs else 'Случайная награда'
            body = {**body, 'amount': next(iter(merged)), 'bundle': 1 if mode else sum(merged.values())}
        elif mode:
            abort(400, description='Добавьте паки, из которых выбирать')
        if eff == 'BUNDLE':
            if not (bundle_spec.get('packs') or bundle_spec['gram'] or bundle_spec['balls'] or bundle_spec['chests'] or bundle_spec['drops']):
                abort(400, description='Добавьте в бандл хотя бы один пак, ящик, дроп, GRAM или шары')
            bundle_spec.setdefault('packs', [])
            mix = json.dumps(bundle_spec)
            amount = bundle_spec['packs'][0]['pack_id'] if bundle_spec['packs'] else ''
            parts_t = [mix_title] if mix_title else []
            if bundle_spec['gram']:
                parts_t.append(bundle_spec['gram'] + ' GRAM')
            if bundle_spec['balls']:
                parts_t.append(str(bundle_spec['balls']) + ' шаров')
            for c in bundle_spec['drops']:
                parts_t.append(((app.extensions['crafter_drop_short'](c['drop_id']) or {}).get('title') or 'Дроп') + (' ×' + str(c['count']) if c['count'] > 1 else ''))
            for c in bundle_spec['chests']:
                parts_t.append(((app.extensions['crafter_chest_short'](c['chest_id']) or {}).get('title') or 'Ящик') + (' ×' + str(c['count']) if c['count'] > 1 else ''))
            mix_title = 'Бандл: ' + ' + '.join(parts_t)
        elif eff == 'PACK':
            amount = str(body.get('amount') or '')
            if not mode and not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
        elif eff == 'STAR':
            amount = str(body.get('amount') or '')
            if not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
        elif eff == 'CHEST':
            amount = str(body.get('amount') or '')
            if not app.extensions['crafter_chest_exists'](amount):
                abort(400, description='Выберите существующий ящик')
        elif eff == 'DROP':
            amount = str(body.get('amount') or '')
            if not app.extensions['crafter_drop_exists'](amount):
                abort(400, description='Выберите существующий дроп')
        elif eff == 'BALL':
            amount = str(whole(body.get('amount'), 1, _LIMIT, 'Шары'))
        else:
            from packs import money
            amount = plain(money(body.get('amount')))
        price = whole(body.get('price_balls', 0), 0, _LIMIT, 'Цена')
        old_price = None
        if str(body.get('old_price_balls') or '').strip() not in ('', '0'):
            old_price = whole(body.get('old_price_balls'), 1, _LIMIT, 'Старая цена')
            if old_price <= price:
                abort(400, description='Старая цена должна быть больше текущей: иначе скидки нет')
        stock = None if str(body.get('stock') or '').strip() == '' else whole(body.get('stock'), 1, 1000000, 'Количество')
        per_user = None if str(body.get('per_user') or '').strip() == '' else whole(body.get('per_user'), 1, 1000, 'Лимит на игрока')
        bundle = 1
        if eff == 'BUNDLE':
            bundle = max(1, sum(c['count'] for c in bundle_spec['packs']))
        elif eff in ('PACK', 'STAR', 'CHEST', 'DROP'):
            bundle = whole(body.get('bundle') or 1, 1, 20, 'Штук за одну покупку')
        image = str(body.get('image_url') or '').strip()
        if image and not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        title = str(body.get('title') or '').strip()[:80]
        if not title:
            if eff in ('PACK', 'BUNDLE') and mix_title:
                title = mix_title[:80]
            elif eff == 'PACK':
                title = (app.extensions['crafter_pack_short'](amount) or {}).get('title', 'Пак') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'STAR':
                title = (app.extensions['crafter_star_gift_short'](amount) or {}).get('title', 'Подарок') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'CHEST':
                title = (app.extensions['crafter_chest_short'](amount) or {}).get('title', 'Ящик') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'DROP':
                title = (app.extensions['crafter_drop_short'](amount) or {}).get('title', 'Дроп') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'BALL':
                title = amount + ' шаров'
            else:
                title = amount + ' GRAM'
            if kind == 'PROMO':
                title = 'Промокод: ' + title
        size = str(body.get('size') or 'small')
        if size not in SIZES:
            abort(400, description='Размер плитки: обычная, широкая, длинная, большая или баннер')
        description = ' '.join(str(body.get('description') or '').split())[:240]
        rarity = str(body.get('rarity') or 'auto')
        if rarity not in RARITIES:
            abort(400, description='Редкость: авто, обычная, особая, эпическая, мифическая или легендарная')
        badge = ' '.join(str(body.get('badge') or '').split())[:14]
        def msk(value):                                      # 'YYYY-MM-DDTHH:MM' in Moscow time (UTC+3) -> unix time
            import calendar
            m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)', str(value).strip())
            if not m:
                abort(400, description='Время: дата и часы по Москве')
            try:
                return calendar.timegm(tuple(int(x) for x in m.groups()) + (0,)) - 3 * 3600
            except (ValueError, OverflowError):
                abort(400, description='Время: такой даты нет')
        starts_at = None
        if 'starts_at_msk' in body:
            starts_at = msk(body.get('starts_at_msk')) if str(body.get('starts_at_msk') or '').strip() else None
        ends_at = None
        hours = body.get('ends_in_hours')
        if str(hours if hours is not None else '').strip() not in ('', '0'):
            ends_at = int(time.time()) + whole(hours, 1, 24 * 120, 'Срок акции в часах') * 3600
        elif 'ends_at_msk' in body:
            ends_at = msk(body.get('ends_at_msk')) if str(body.get('ends_at_msk') or '').strip() else None
        elif str(body.get('ends_at') or '').strip() not in ('', '0', 'None'):
            ends_at = whole(body.get('ends_at'), 1, 4102444800, 'Время окончания')
        if starts_at and ends_at and ends_at <= starts_at:
            abort(400, description='Конец акции должен быть позже начала')
        section_id = str(body.get('section_id') or '').strip()
        if section_id and not app.extensions['crafter_shop_section_exists'](section_id):
            abort(400, description='Раздел не найден')
        heading = ' '.join(str(body.get('heading') or '').split())[:30]
        card_bg = str(body.get('card_bg') or '').strip()
        if card_bg and card_bg not in CARD_BGS and not re.fullmatch(r'image:(/media/shop/[0-9a-f]{32}|/static/assets/chests/[A-Za-z0-9_.-]+)', card_bg):
            abort(400, description='Фон карточки: выберите готовый или загрузите картинку')
        return (kind, promo if kind == 'PROMO' else '', amount, title, image, price, old_price, stock, per_user, bundle, mix, size, description, rarity, badge, ends_at, section_id or None, heading, card_bg, starts_at, mode)

    @app.post('/api/admin/new-year/shop')
    @auth(admin=True)
    def admin_shop_create():
        vals = parse_item(request.get_json(silent=True) or {})
        iid = uuid.uuid4().hex
        with db():
            position = None
            if order_mode() == 'manual':
                position = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM shop_items").fetchone()['n'])
            db().execute("INSERT INTO shop_items(id,kind,promo_kind,amount,title,image_url,price_balls,old_price_balls,stock,per_user,bundle,contents,size,description,rarity,badge,ends_at,section_id,heading,card_bg,starts_at,mode,position,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (iid,) + vals + (position, int(time.time())))
        audit('Shop item created: ' + vals[3])
        return {'ok': True, 'id': iid}

    @app.post('/api/admin/new-year/shop/<iid>/edit')
    @auth(admin=True)
    def admin_shop_edit(iid):
        vals = parse_item(request.get_json(silent=True) or {})
        with db():
            if not db().execute("UPDATE shop_items SET kind=?,promo_kind=?,amount=?,title=?,image_url=?,price_balls=?,old_price_balls=?,stock=?,per_user=?,bundle=?,contents=?,size=?,description=?,rarity=?,badge=?,ends_at=?,section_id=?,heading=?,card_bg=?,starts_at=?,mode=? WHERE id=?",
                                vals + (iid,)).rowcount:
                abort(404, description='Товар не найден')
        audit('Shop item edited: ' + vals[3])
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/size')
    @auth(admin=True)
    def admin_shop_size(iid):
        size = (request.get_json(silent=True) or {}).get('size')
        if size not in SIZES:
            abort(400, description='Размер плитки: обычная, широкая, длинная, большая или баннер')
        with db():
            row = db().execute("SELECT title FROM shop_items WHERE id=?", (iid,)).fetchone()
            if not row:
                abort(404, description='Товар не найден')
            db().execute("UPDATE shop_items SET size=? WHERE id=?", (size, iid))
        audit('Shop item size: ' + row['title'] + ' -> ' + size)
        return {'ok': True}

    def msk_time(value):                                     # 'YYYY-MM-DDTHH:MM' in Moscow time (UTC+3) -> unix time
        import calendar
        m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)', str(value).strip())
        if not m:
            abort(400, description='Время: дата и часы по Москве')
        try:
            return calendar.timegm(tuple(int(x) for x in m.groups()) + (0,)) - 3 * 3600
        except (ValueError, OverflowError):
            abort(400, description='Время: такой даты нет')

    @app.post('/api/admin/new-year/shop/<iid>/style')
    @auth(admin=True)
    def admin_shop_style(iid):
        """Quick editing from the board: any field of an offer (price, texts, limits, times, section, rarity, background)."""
        body = request.get_json(silent=True) or {}
        with db():
            row = db().execute("SELECT * FROM shop_items WHERE id=?", (iid,)).fetchone()
            if not row:
                abort(404, description='Товар не найден')
            sets, vals = [], []

            def put(column, value):
                sets.append(column + '=?'); vals.append(value)
            if 'rarity' in body:
                if body['rarity'] not in RARITIES:
                    abort(400, description='Неизвестная редкость')
                put('rarity', body['rarity'])
            if 'heading' in body:
                put('heading', ' '.join(str(body['heading'] or '').split())[:30])
            if 'card_bg' in body:
                card_bg = str(body['card_bg'] or '').strip()
                if card_bg and card_bg not in CARD_BGS and not re.fullmatch(r'image:(/media/shop/[0-9a-f]{32}|/static/assets/chests/[A-Za-z0-9_.-]+)', card_bg):
                    abort(400, description='Фон карточки: выберите готовый или загрузите картинку')
                put('card_bg', card_bg)
            if 'title' in body:
                title = ' '.join(str(body['title'] or '').split())[:80]
                if not title:
                    abort(400, description='Название не может быть пустым')
                put('title', title)
            price = int(row['price_balls'])
            if 'price_balls' in body:
                price = whole(body['price_balls'], 0, _LIMIT, 'Цена')
                put('price_balls', price)
            if 'old_price_balls' in body or 'price_balls' in body:
                old_raw = body.get('old_price_balls', row['old_price_balls'])
                old = None if str(old_raw if old_raw is not None else '').strip() in ('', '0', 'None') else whole(old_raw, 1, _LIMIT, 'Старая цена')
                if old is not None and old <= price:
                    abort(400, description='Старая цена должна быть больше текущей: иначе скидки нет')
                put('old_price_balls', old)
            if 'badge' in body:
                put('badge', ' '.join(str(body['badge'] or '').split())[:14])
            if 'description' in body:
                put('description', ' '.join(str(body['description'] or '').split())[:240])
            if 'stock' in body:
                put('stock', None if str(body['stock'] or '').strip() in ('', '0') else whole(body['stock'], 1, 1000000, 'Количество'))
            if 'per_user' in body:
                put('per_user', None if str(body['per_user'] or '').strip() in ('', '0') else whole(body['per_user'], 1, 1000, 'Лимит на игрока'))
            starts = int(row['starts_at']) if row['starts_at'] else None
            ends = int(row['ends_at']) if row['ends_at'] else None
            if 'starts_at_msk' in body:
                starts = msk_time(body['starts_at_msk']) if str(body['starts_at_msk'] or '').strip() else None
                put('starts_at', starts)
            if 'ends_at_msk' in body:
                ends = msk_time(body['ends_at_msk']) if str(body['ends_at_msk'] or '').strip() else None
                put('ends_at', ends)
            if starts and ends and ends <= starts:
                abort(400, description='Конец акции должен быть позже начала')
            if 'section_id' in body:
                sid = str(body['section_id'] or '').strip()
                if sid and not app.extensions['crafter_shop_section_exists'](sid):
                    abort(400, description='Раздел не найден')
                put('section_id', sid or None)
            if not sets:
                abort(400, description='Нечего менять')
            db().execute('UPDATE shop_items SET ' + ','.join(sets) + ' WHERE id=?', tuple(vals) + (iid,))
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/section')
    @auth(admin=True)
    def admin_shop_section(iid):
        section_id = str((request.get_json(silent=True) or {}).get('section_id') or '').strip()
        if section_id and not app.extensions['crafter_shop_section_exists'](section_id):
            abort(400, description='Раздел не найден')
        with db():
            if not db().execute("UPDATE shop_items SET section_id=? WHERE id=?", (section_id or None, iid)).rowcount:
                abort(404, description='Товар не найден')
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/move')
    @auth(admin=True)
    def admin_shop_move(iid):
        direction = (request.get_json(silent=True) or {}).get('direction')
        if direction not in ('up', 'down'):
            abort(400, description='direction: up или down')
        with db():
            db().execute('BEGIN IMMEDIATE')
            rows = ordered(db().execute("SELECT * FROM shop_items").fetchall())
            ids = [r['id'] for r in rows]
            if iid not in ids:
                abort(404, description='Товар не найден')
            at = ids.index(iid)
            to = at - 1 if direction == 'up' else at + 1
            if 0 <= to < len(ids):
                ids[at], ids[to] = ids[to], ids[at]
            for number, item in enumerate(ids, 1):
                db().execute("UPDATE shop_items SET position=? WHERE id=?", (number, item))
            db().execute("INSERT INTO settings(key,payload) VALUES('shop_items_order_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps({'mode': 'manual'}),))
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-arrange')
    @auth(admin=True)
    def admin_shop_arrange():
        wanted = (request.get_json(silent=True) or {}).get('ids')
        if not isinstance(wanted, list) or len(wanted) > 500 or any(not isinstance(i, str) for i in wanted):
            abort(400, description='ids: список товаров в нужном порядке')
        with db():
            db().execute('BEGIN IMMEDIATE')
            known = [r['id'] for r in ordered(db().execute("SELECT * FROM shop_items").fetchall())]
            chosen = [i for i in dict.fromkeys(wanted) if i in known]
            for number, item in enumerate(chosen + [i for i in known if i not in chosen], 1):
                db().execute("UPDATE shop_items SET position=? WHERE id=?", (number, item))
            db().execute("INSERT INTO settings(key,payload) VALUES('shop_items_order_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps({'mode': 'manual'}),))
        audit('Shop items rearranged')
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-order')
    @auth(admin=True)
    def admin_shop_order():
        if (request.get_json(silent=True) or {}).get('mode') != 'price':
            abort(400, description='mode: price')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('shop_items_order_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps({'mode': 'price'}),))
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/status')
    @auth(admin=True)
    def admin_shop_status(iid):
        status = (request.get_json(silent=True) or {}).get('status')
        if status not in ('active', 'hidden'):
            abort(400, description='Статус: active или hidden')
        with db():
            if not db().execute("UPDATE shop_items SET status=? WHERE id=?", (status, iid)).rowcount:
                abort(404, description='Товар не найден')
        audit('Shop item ' + iid + ' ' + status)
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-clear')
    @auth(admin=True)
    def admin_shop_clear():
        """Remove every offer of one section at once ('' = the offers without a section). What players already got stays theirs."""
        body = request.get_json(silent=True) or {}
        section_id = str(body.get('section_id') or '').strip()
        if body.get('confirm') is not True:
            abort(400, description='Подтвердите очистку раздела')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if section_id:
                where, args = "section_id=?", (section_id,)
            else:
                where, args = "(section_id IS NULL OR section_id='')", ()
            ids = [r['id'] for r in db().execute("SELECT id FROM shop_items WHERE " + where, args).fetchall()]
            for iid in ids:
                db().execute("DELETE FROM shop_item_buys WHERE item_id=?", (iid,))
                db().execute("DELETE FROM shop_items WHERE id=?", (iid,))
        audit('Shop section cleared %s: %d offers' % (section_id or '(auto)', len(ids)))
        return {'ok': True, 'removed': len(ids)}

    @app.post('/api/admin/new-year/shop/<iid>/delete')
    @auth(admin=True)
    def admin_shop_delete(iid):
        with db():
            if not db().execute("DELETE FROM shop_items WHERE id=?", (iid,)).rowcount:         # it may have been bought: what players already got stays theirs
                abort(404, description='Товар не найден')
            db().execute("DELETE FROM shop_item_buys WHERE item_id=?", (iid,))
        audit('Shop item deleted ' + iid)
        return {'ok': True}
