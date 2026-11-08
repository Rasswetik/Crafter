"""Crafter New Year event: administrator-controlled test gift market and balances.

A Telegram NFT URL supplies display metadata, not proof of custody.
New-year purchases intentionally create non-transferable TEST inventory entries.
No on-chain or Portals purchase is performed by these routes.
"""
import json
import re
import time
import uuid
from urllib.error import HTTPError, URLError

from portals_public import get as portals_get
from flask import abort, g, request

_NFT = re.compile(r"^https://(?:t\.me|telegram\.me)/nft/([A-Za-z][A-Za-z0-9_-]{2,90}-[1-9][0-9]{0,14})/?$", re.I)
_LIMIT = 10**9



def portal_nft_metadata(slug):
    """Resolve the exact Telegram collectible from the Portals public NFT catalogue.

    An external collection number is a prefix search; we MUST compare the returned
    number and the collection slug before trusting attributes or artwork.
    """
    collection, index = slug.rsplit('-', 1)
    number = int(index)
    label = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', collection.replace('_',' '))
    try:
        data = portals_get('nfts/search', {
            'external_collection_number': number, 'name_filter': label,
            'limit': 100, 'offset': 0,
        })
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError, OSError) as error:
        abort(503, description='Portals сейчас не возвращает данные NFT. Попробуйте позже.')
    results = data.get('results', []) if isinstance(data, dict) else []
    canonical = lambda s: re.sub(r'[^a-z0-9]', '', str(s or '').lower())
    wanted = canonical(collection)
    for nft in results if isinstance(results, list) else []:
        if not isinstance(nft, dict):
            continue
        try:
            if int(nft.get('external_collection_number', -1)) != number:
                continue
        except (ValueError, TypeError):
            continue
        tg_slug = str(nft.get('tg_id') or '')
        if canonical(nft.get('name')) != wanted and canonical(tg_slug.rsplit('-',1)[0]) != wanted:
            continue
        # The exact NFT has been verified by collection AND full number.
        attrs = {}
        rarity = {}
        for entry in nft.get('attributes') or []:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get('type') or '').lower()
            if key not in ('model', 'backdrop', 'symbol', 'pattern'):
                continue
            value = entry.get('value')
            if isinstance(value, str):
                attrs['symbol' if key == 'pattern' else key] = value[:100]
            try:
                per_mille = float(entry.get('rarity_per_mille'))
                if 0 <= per_mille <= 1000:
                    rarity['symbol' if key == 'pattern' else key] = per_mille
            except (TypeError, ValueError):
                pass
        photo = nft.get('photo_url')
        if not isinstance(photo, str) or not photo.startswith('https://'):
            photo = ''
        return {
            'model': attrs.get('model', ''), 'symbol': attrs.get('symbol', ''),
            'backdrop': attrs.get('backdrop', ''),
            'floor_price': str(nft.get('floor_price') or ''),
            'floor_unit': 'GRAM',
            'image': photo, 'portal_nft_id': str(nft.get('id') or ''),
            'rarity': rarity, 'portal_verified_at': int(time.time()),
            'portal_status': str(nft.get('status') or ''),
        }
    abort(404, description='Точный NFT по указанной ссылке не найден в Portals (коллекция и номер).')


def install_new_year(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS new_year_wallets (
            user_id BIGINT PRIMARY KEY, balls BIGINT NOT NULL DEFAULT 0,
            donate BIGINT NOT NULL DEFAULT 0, tinsel BIGINT NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS new_year_lots (
            id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
            nft_url TEXT NOT NULL, title TEXT NOT NULL,
            number BIGINT NOT NULL, price BIGINT NOT NULL,
            metadata TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
            created_by BIGINT NOT NULL, created BIGINT NOT NULL,
            buyer_id BIGINT, sold_at BIGINT
        );
        CREATE TABLE IF NOT EXISTS new_year_receipts (
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL, lot_id TEXT NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(user_id,request_id)
        );
        """)

    def enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='new_year_enabled_v1'").fetchone()
        return bool(row and row['payload'] == 'true')

    def wallet(uid):
        row = db().execute(
            "SELECT balls,donate,tinsel FROM new_year_wallets WHERE user_id=?", (uid,)
        ).fetchone()
        return {key:int(row[key]) if row else 0 for key in ('balls','donate','tinsel')}

    def gift_from_lot(row):
        extra = json.loads(row['metadata'])
        return {
            'name':row['title'], 'number':int(row['number']),
            'model':extra.get('model',''), 'symbol':extra.get('symbol',''),
            'backdrop':extra.get('backdrop',''),
            'floor_price':extra.get('floor_price',''),
            'floor_unit':extra.get('floor_unit','GRAM'),
            'rarity':extra.get('rarity',{}),
            'image':extra.get('image',''),
            'portal_nft_id':extra.get('portal_nft_id',''),
            'portal_verified_at':extra.get('portal_verified_at',0),
            'telegram_url':row['nft_url'], 'telegram_slug':row['slug'],
            'collection_id':re.sub(r'[^a-z0-9]','',row['title'].lower()),
            'price_unit':'BALL', 'price':int(row['price'])
        }

    def item(row):
        return dict(id=row['id'],slug=row['slug'],url=row['nft_url'],
                    price=int(row['price']),status=row['status'],
                    gift=gift_from_lot(row),created=int(row['created']),
                    buyer_id=row['buyer_id'])

    @app.get('/api/new-year/status')
    @auth()
    def new_year_status():
        return {'enabled':enabled()}

    @app.get('/api/new-year')
    @auth()
    def new_year_market():
        if not enabled() and not g.is_admin:
            abort(404,description='Раздел Новый год пока отключён')
        rows=db().execute(
            "SELECT * FROM new_year_lots WHERE status='active' ORDER BY created DESC"
        ).fetchall()
        return {'enabled':enabled(),'balance':wallet(g.user['id']),
                'lots':[item(row) for row in rows], 'test_mode':True}

    @app.get('/api/admin/new-year')
    @auth(admin=True)
    def admin_new_year():
        rows=db().execute("SELECT * FROM new_year_lots ORDER BY created DESC LIMIT 150").fetchall()
        return {'enabled':enabled(), 'lots':[item(row) for row in rows],
                'my_balance':wallet(g.user['id'])}

    @app.post('/api/admin/new-year/settings')
    @auth(admin=True)
    def admin_new_year_settings():
        body=request.get_json(silent=True) or {}
        if type(body.get('enabled')) is not bool:
            abort(400,description='Неверное значение переключателя')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('new_year_enabled_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         ('true' if body['enabled'] else 'false',))
        audit('New Year event '+('enabled' if body['enabled'] else 'disabled'))
        return {'ok':True,'enabled':body['enabled']}

    @app.get('/api/new-year/lots/<lot_id>/details')
    @auth()
    def new_year_lot_details(lot_id):
        if not enabled() and not g.is_admin:
            abort(404)
        row = db().execute("SELECT * FROM new_year_lots WHERE id=?",(lot_id,)).fetchone()
        if not row or row['status'] != 'active':
            abort(404, description='Лот уже недоступен')
        extra = json.loads(row['metadata'])
        if int(extra.get('portal_verified_at') or 0) < int(time.time()) - 900:
            verified = portal_nft_metadata(row['slug'])
            extra.update(verified)
            with db():
                db().execute("UPDATE new_year_lots SET metadata=? WHERE id=? AND status='active'",
                             (json.dumps(extra,ensure_ascii=False),lot_id))
            row = db().execute("SELECT * FROM new_year_lots WHERE id=?",(lot_id,)).fetchone()
        return {'ok':True,'lot':item(row)}

    @app.post('/api/admin/new-year/lots')
    @auth(admin=True)
    def admin_new_year_create():
        body=request.get_json(silent=True) or {}
        link=body.get('url')
        match=_NFT.fullmatch(link.strip()) if isinstance(link,str) else None
        if not match:
            abort(400,description='Введите ссылку вида https://t.me/nft/ChillFlame-426793')
        slug=match.group(1)
        prefix, number=slug.rsplit('-',1)
        try:price=int(body.get('price',0))
        except (TypeError,ValueError):abort(400,description='Стоимость укажите целым числом шаров')
        if str(body.get('price','')) != str(price) or not 1<=price<=_LIMIT:
            abort(400,description='Стоимость: от 1 до 1 000 000 000 шаров')
        title=re.sub(r'(?<=[a-z])(?=[A-Z])',' ',prefix.replace('_',' ')).strip()
        # Fetch real NFT attributes and image; never trust manually supplied metadata.
        extra=portal_nft_metadata(slug)
        lot_id=uuid.uuid4().hex
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute("SELECT 1 FROM new_year_lots WHERE lower(slug)=lower(?)",
                            (slug,)).fetchone():
                abort(409,description='Этот NFT уже есть в новогоднем маркете')
            db().execute(
                "INSERT INTO new_year_lots(id,slug,nft_url,title,number,price,metadata,status,created_by,created) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (lot_id,slug,'https://t.me/nft/'+slug,title,int(number),price,
                 json.dumps(extra,ensure_ascii=False),'active',g.user['id'],int(time.time())))
        audit('New Year lot created '+slug+' for '+str(price)+' balls')
        return {'ok':True,'id':lot_id}

    @app.post('/api/admin/new-year/lots/<lot_id>/status')
    @auth(admin=True)
    def admin_new_year_lot_status(lot_id):
        body=request.get_json(silent=True) or {}
        next_status=body.get('status')
        if next_status not in ('active','hidden'):
            abort(400,description='Можно только скрыть или вернуть непроданный лот')
        with db():
            row=db().execute("SELECT status FROM new_year_lots WHERE id=?", (lot_id,)).fetchone()
            if not row:abort(404)
            if row['status']=='sold':abort(409,description='Проданный NFT нельзя выставить повторно')
            db().execute("UPDATE new_year_lots SET status=? WHERE id=?", (next_status,lot_id))
        audit('New Year lot '+lot_id+' status '+next_status)
        return {'ok':True,'status':next_status}

    @app.get('/api/admin/new-year/users/<int:uid>/wallet')
    @auth(admin=True)
    def new_year_user_wallet(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():
            abort(404,description='Пользователь не найден')
        return {'user_id':uid,'balance':wallet(uid)}

    @app.post('/api/admin/new-year/wallet')
    @auth(admin=True)
    def admin_new_year_grant():
        body=request.get_json(silent=True) or {}
        try:uid=int(body.get('user_id',0))
        except (TypeError,ValueError):abort(400,description='Неверный Telegram ID')
        if uid<=0 or uid>=2**63:
            abort(400,description='Неверный Telegram ID')
        amounts={}
        for key in ('balls','donate','tinsel'):
            try:value=int(body.get(key,0))
            except (ValueError,TypeError):abort(400,description='Укажите целые суммы')
            if str(body.get(key,0))!=str(value) or not -_LIMIT<=value<=_LIMIT:
                abort(400,description='Неверное число '+key)
            amounts[key]=value
        if not any(amounts.values()):
            abort(400,description='Введите сумму зачисления или списания')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():
                abort(404,description='Пользователь ещё не входил в Crafter')
            db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING",(uid,))
            before=wallet(uid)
            after={key:before[key]+amounts[key] for key in amounts}
            if any(not 0<=value<=_LIMIT for value in after.values()):
                abort(409,description='Баланс не может стать отрицательным или превысить лимит')
            db().execute(
                "UPDATE new_year_wallets SET balls=?,donate=?,tinsel=? WHERE user_id=?",
                (after['balls'],after['donate'],after['tinsel'],uid))
            record('new_year_grant',{'admin_id':g.user['id'],'delta':amounts,
                                     'after':after},uid=uid)
        audit('New Year balances modified for '+str(uid))
        return {'ok':True,'balance':after}

    @app.post('/api/new-year/buy')
    @auth()
    def new_year_buy():
        body=request.get_json(silent=True) or {}
        lot_id=body.get('lot_id')
        rid=body.get('request_id')
        if not isinstance(lot_id,str) or not re.fullmatch(r'[a-f0-9]{32}',lot_id):
            abort(400,description='Неверный лот')
        if not isinstance(rid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',rid):
            abort(400,description='Неверный номер покупки')
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            previous=db().execute(
                "SELECT lot_id,result FROM new_year_receipts WHERE user_id=? AND request_id=?",
                (uid,rid)).fetchone()
            if previous:
                if previous['lot_id']!=lot_id:abort(409,description='Номер покупки уже использован')
                return json.loads(previous['result'])
            if not enabled():
                abort(409,description='Новогодний маркет сейчас выключен')
            lot=db().execute("SELECT * FROM new_year_lots WHERE id=? AND status='active'",
                             (lot_id,)).fetchone()
            if not lot:
                abort(409,description='Подарок уже куплен или снят с продажи')
            amount=int(lot['price'])
            before=wallet(uid)
            if before['balls']<amount:
                abort(409,description='Недостаточно новогодних шаров')
            changed=db().execute(
                "UPDATE new_year_lots SET status='sold',buyer_id=?,sold_at=? "
                "WHERE id=? AND status='active'",(uid,int(time.time()),lot_id)).rowcount
            if changed!=1:
                abort(409,description='Этот подарок уже недоступен')
            db().execute(
                "INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING",(uid,))
            db().execute(
                "UPDATE new_year_wallets SET balls=? WHERE user_id=?",(before['balls']-amount,uid))
            gift=gift_from_lot(lot)
            gift.update(
                id='new-year-test-'+uuid.uuid4().hex, origin='new-year-test',
                source_id=lot['id'], price='0', price_unit='GRAM',
                catalog_only=True, test_only=True,
                new_year_price_balls=amount)
            db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)",
                         (uid,gift['id'],json.dumps(gift,ensure_ascii=False),'unlisted'))
            result={'ok':True,'gift':gift,
                    'balance':{'balls':before['balls']-amount,'donate':before['donate'],
                               'tinsel':before['tinsel']},
                    'test_mode':True}
            db().execute("INSERT INTO new_year_receipts(user_id,request_id,lot_id,result) "
                         "VALUES(?,?,?,?)",(uid,rid,lot_id,json.dumps(result,ensure_ascii=False)))
            record('new_year_buy',{'lot_id':lot_id,'gift':gift,
                                   'price_balls':amount,'test_mode':True},uid=uid)
        return result

    return enabled
