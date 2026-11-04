"""Read model for the collection offer display."""
import json
import re
import time
import uuid
from decimal import Decimal, ROUND_UP

from flask import abort, g, request
from resale import cap_funded_balance, listing_price


def install_offer_display(app, db, auth, canonical_name):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_offer_quotes (
                id TEXT PRIMARY KEY, collection_key TEXT NOT NULL, model TEXT NOT NULL,
                backdrop TEXT NOT NULL, symbol TEXT NOT NULL, price_gram TEXT NOT NULL,
                quantity INTEGER NOT NULL, expires_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS crafter_offers_collection_idx
                ON crafter_offer_quotes(collection_key);
        """)

    @app.get('/api/market/offers')
    @auth()
    def collection_offers():
        collection=request.args.get('collection','').strip()
        if not collection or len(collection)>120 or ',' in collection:
            abort(400,description='Выберите одну коллекцию')
        choices={}
        for trait in ('model','backdrop','symbol'):
            raw=request.args.get(trait,'')
            values={part.strip().casefold() for part in raw.split(',') if part.strip()}
            if len(raw)>1000 or len(values)>20 or any(len(x)>150 for x in values):
                abort(400,description='Выберите до 20 значений атрибута')
            choices[trait]=values
        key=canonical_name(collection)
        owned=[]
        for gift_row in db().execute("""SELECT nft_id,payload FROM inventory
                WHERE user_id=? AND status IN ('unlisted','listed')""",(g.user['id'],)):
            gift=json.loads(gift_row['payload'])
            if (gift.get('catalog_only') or
                key not in (canonical_name(gift.get('name','')),
                            canonical_name(gift.get('collection_id','')))):
                continue
            owned.append((gift_row['nft_id'],gift))
        general,specific=[],[]
        for row in db().execute("""SELECT id,model,backdrop,symbol,price,remaining,buyer_id
            FROM crafter_offers WHERE collection_key=? AND status='active'
              AND lot_id IS NULL AND remaining>0
              AND (expires_at IS NULL OR expires_at>?)""",(key,int(time.time()))):
            quote={name:row[name] for name in ('id','model','backdrop','symbol')}
            quote.update(price_gram=row['price'],quantity=row['remaining'])
            eligible=[]
            if row['buyer_id']!=g.user['id']:
                for gift_id,gift in owned:
                    if any(row[trait] and str(gift.get(trait,'')).casefold()!=row[trait].casefold()
                           for trait in ('model','backdrop','symbol')):
                        continue
                    if db().execute('SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?',
                                    (row['buyer_id'],gift_id)).fetchone():
                        continue
                    eligible.append(gift_id)
            quote['eligible_ids']=eligible
            quote['executable']=int(bool(eligible))
            if not any(row[k] for k in ('model','backdrop','symbol')):
                general.append(quote)
            elif all(not choices[k] or not row[k] or row[k].casefold() in choices[k]
                     for k in ('model','backdrop','symbol')):
                specific.append(quote)
        all_offers=general+specific
        all_offers.sort(key=lambda row:Decimal(row['price_gram']),reverse=True)
        for group in (general,specific):
            group.sort(key=lambda row:Decimal(row['price_gram']),reverse=True)
        best=next((row for row in all_offers if row['executable']),None)
        if best is None and all_offers:
            best=all_offers[0]
        return {'best':best,'general':general[:10],'specific':specific[:10],
                'count':len(all_offers)}


def install_trading_offers(app, db, auth, record, canonical_name, notify_sale,
                           notify_offer=None, notify_purchase=None):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_offers (
                id TEXT PRIMARY KEY, buyer_id INTEGER NOT NULL, seller_id INTEGER,
                lot_id TEXT, collection_key TEXT NOT NULL, model TEXT NOT NULL,
                backdrop TEXT NOT NULL, symbol TEXT NOT NULL, gift_json TEXT NOT NULL,
                price TEXT NOT NULL, quantity INTEGER NOT NULL, remaining INTEGER NOT NULL,
                fee TEXT NOT NULL, backing TEXT NOT NULL, status TEXT NOT NULL,
                created INTEGER NOT NULL, expires_at INTEGER, expiry TEXT NOT NULL,
                request_id TEXT NOT NULL, UNIQUE(buyer_id,request_id)
            );
            CREATE INDEX IF NOT EXISTS crafter_offers_lot ON crafter_offers(lot_id,status);
            CREATE INDEX IF NOT EXISTS crafter_offers_inbox ON crafter_offers(seller_id,status);
            CREATE INDEX IF NOT EXISTS crafter_offers_active_collection ON crafter_offers(collection_key,status);
        """)

    def balance(uid):
        row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
        return Decimal(row[0]) if row else Decimal(0)

    def set_balance(uid, value):
        db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(value), uid))

    def fee_gram():
        row = db().execute("SELECT payload FROM settings WHERE key='tonconnect'").fetchone()
        rate = Decimal(str(json.loads(row[0]).get('gram_per_ton', '1'))) if row else Decimal(1)
        return (rate * Decimal('0.01')).quantize(Decimal('0.000000001'), rounding=ROUND_UP)

    def refund(row, status):
        buyer = row['buyer_id']
        principal = Decimal(row['price']) * row['remaining']
        db().execute('UPDATE crafter_offers SET status=? WHERE id=?', (status, row['id']))
        previous = balance(buyer)
        cap_funded_balance(db(), buyer, previous)
        set_balance(buyer, previous + principal)
        for network, held in json.loads(row['backing']).items():
            funded = db().execute('SELECT gram FROM wallet_balances WHERE user_id=? AND network=?',
                                  (buyer, network)).fetchone()
            restored = (Decimal(funded[0]) if funded else Decimal(0)) + Decimal(held)
            db().execute("""INSERT INTO wallet_balances VALUES(?,?,?)
                ON CONFLICT(user_id,network) DO UPDATE SET gram=excluded.gram""", (buyer, network, str(restored)))
        record('offer_cancelled', {'offer_id': row['id'], 'gift': json.loads(row['gift_json']),
                                  'amount': str(principal), 'reason': status}, uid=buyer)

    def close_lot_offers(lot_id):
        if lot_id:
            for row in db().execute("SELECT * FROM crafter_offers WHERE lot_id=? AND status='active'", (lot_id,)).fetchall():
                refund(row, 'closed')

    def expire_user_offers(uid):
        sql = """SELECT * FROM crafter_offers o WHERE (buyer_id=? OR seller_id=?) AND status='active' AND
            ((expires_at IS NOT NULL AND expires_at<=?) OR
            (lot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crafter_listings l WHERE l.id=o.lot_id)))"""
        params = (uid, uid, int(time.time()))
        if not db().execute(sql, params).fetchone():
            return
        with db():
            db().execute('BEGIN IMMEDIATE')
            for row in db().execute(sql, params).fetchall():
                status = 'expired' if row['expires_at'] is not None and row['expires_at'] <= params[2] else 'closed'
                refund(row, status)

    def public(row):
        return {**{key: row[key] for key in ('id','lot_id','model','backdrop','symbol','price','quantity',
                    'remaining','fee','status','created','expires_at')}, 'gift': json.loads(row['gift_json'])}

    @app.get('/api/offers')
    @auth()
    def offer_inbox():
        uid = g.user['id']
        expire_user_offers(uid)
        rows = db().execute("""SELECT * FROM crafter_offers
            WHERE (buyer_id=? OR seller_id=?) AND status='active'
            ORDER BY created DESC,id DESC LIMIT 150""", (uid, uid)).fetchall()
        return {'received': [public(row) for row in rows if row['seller_id'] == uid],
                'placed': [public(row) for row in rows if row['buyer_id'] == uid and row['lot_id']],
                'collections': [public(row) for row in rows if row['buyer_id'] == uid and not row['lot_id']],
                'fee_gram': str(fee_gram()), 'balance': str(balance(uid))}

    def register_resale_actions(available_lot, settle_lot, get_collection):
        @app.post('/api/offers')
        @auth()
        def create_offer():
            data = request.get_json(silent=True)
            if not isinstance(data, dict):
                abort(400)
            buyer = g.user['id']
            expire_user_offers(buyer)
            price = listing_price(data.get('price'))
            rid, lot_id = data.get('request_id'), data.get('lot_id')
            expiry, quantity = data.get('expiry', 'none'), data.get('quantity', 1)
            fields = {key: data.get(key, '') for key in ('collection','model','backdrop','symbol')}
            if (not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', rid) or
                    expiry not in ('none','day','week') or type(quantity) is not int or not 1 <= quantity <= 30 or
                    any(not isinstance(value, str) or len(value) > 150 for value in fields.values()) or
                    (lot_id is not None and (not isinstance(lot_id, str) or
                     not re.fullmatch(r'crafter-[0-9a-f]{32}', lot_id) or quantity != 1))):
                abort(400, description='Проверьте параметры оффера')
            key = canonical_name(fields['collection'])
            collection = get_collection(fields['collection']) if not lot_id else None
            if not lot_id and not collection:
                abort(400, description='Выберите коллекцию')
            if collection:
                key = canonical_name(collection['name'])
            with db():
                connection = db()
                connection.execute('BEGIN IMMEDIATE')
                previous = connection.execute('SELECT * FROM crafter_offers WHERE buyer_id=? AND request_id=?',
                                              (buyer, rid)).fetchone()
                if previous:
                    if (previous['lot_id'] != lot_id or Decimal(previous['price']) != price or
                            previous['quantity'] != quantity or previous['expiry'] != expiry or
                            (not lot_id and (previous['collection_key'] != key or
                             any(previous[name] != fields[name] for name in ('model','backdrop','symbol'))))):
                        abort(409, description='Этот запрос уже использован')
                    return {'offer': public(previous), 'balance': str(balance(buyer))}
                seller = None
                if lot_id:
                    lot = available_lot(lot_id, buyer)
                    seller = lot['seller_id']
                    original = json.loads(lot['payload'])
                    gift = {name: original[name] for name in ('id','name','number','image','model','backdrop','symbol',
                            'background','telegram_url','source_number','telegram_slug') if name in original}
                    key = canonical_name(gift.get('name', ''))
                    fields.update(model='', backdrop='', symbol='')
                    if connection.execute("""SELECT 1 FROM crafter_offers
                        WHERE buyer_id=? AND lot_id=? AND status='active'""", (buyer, lot_id)).fetchone():
                        abort(409, description='На этот подарок уже есть ваш активный оффер')
                else:
                    gift = {'name':collection['name'], 'image':collection.get('photo_url','')}
                fee = fee_gram()
                if data.get('expected_fee_gram') is not None and str(data['expected_fee_gram']) != str(fee):
                    abort(409, description='Курс изменился. Откройте форму снова')
                after_fee = balance(buyer) - fee
                after_reserve = after_fee - price * quantity
                if after_reserve < 0:
                    abort(409, description='Недостаточно GRAM для суммы оффера и комиссии')
                cap_funded_balance(connection, buyer, after_fee)
                backing = cap_funded_balance(connection, buyer, after_reserve)
                set_balance(buyer, after_reserve)
                oid = uuid.uuid4().hex
                now = int(time.time())
                ends = None if expiry == 'none' else now + (86400 if expiry == 'day' else 604800)
                connection.execute("""INSERT INTO crafter_offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (oid, buyer, seller, lot_id, key, fields['model'], fields['backdrop'], fields['symbol'],
                     json.dumps(gift), str(price), quantity, quantity, str(fee), json.dumps(backing),
                     'active', now, ends, expiry, rid))
                record('offer_created', {'offer_id':oid, 'gift':gift, 'price':str(price), 'amount':str(fee)})
                if seller:
                    record('offer_received', {'offer_id':oid, 'gift':gift, 'price':str(price)}, uid=seller)
                row = connection.execute('SELECT * FROM crafter_offers WHERE id=?', (oid,)).fetchone()
            if seller and notify_offer:
                notify_offer(seller, gift, price, 'received')
            return {'offer': public(row), 'balance': str(after_reserve)}

        @app.post('/api/offers/<offer_id>/action')
        @auth()
        def offer_action(offer_id):
            uid = g.user['id']
            expire_user_offers(uid)
            data = request.get_json(silent=True)
            action = data.get('action') if isinstance(data, dict) else None
            if action not in ('accept','decline','withdraw'):
                abort(400)
            trade = None
            withdrawn = None
            with db():
                connection = db()
                connection.execute('BEGIN IMMEDIATE')
                row = connection.execute('SELECT * FROM crafter_offers WHERE id=?', (offer_id,)).fetchone()
                if not row or (uid != row['buyer_id'] and row['lot_id'] and uid != row['seller_id']):
                    abort(404)
                buyer = row['buyer_id']
                if row['status'] != 'active' or (row['expires_at'] is not None and row['expires_at'] <= int(time.time())):
                    abort(409, description='Оффер уже закрыт')
                if action == 'withdraw' and buyer == uid:
                    refund(row, 'withdrawn')
                    if row['seller_id']:
                        withdrawn = (row['seller_id'], json.loads(row['gift_json']), row['price'])
                        record('offer_withdrawn', {
                            'offer_id':row['id'], 'gift':withdrawn[1],
                            'price':row['price']}, uid=row['seller_id'])
                elif action == 'decline' and row['seller_id'] == uid:
                    refund(row, 'declined')
                elif action == 'accept' and buyer != uid:
                    if row['lot_id']:
                        if row['seller_id'] != uid:
                            abort(403)
                        lot = available_lot(row['lot_id'], buyer)
                    else:
                        gift_id = data.get('gift_id')
                        if not isinstance(gift_id, str) or not 1 <= len(gift_id) <= 200:
                            abort(400, description='Выберите подарок')
                        owned = connection.execute("""SELECT i.nft_id AS gift_id,i.payload,i.user_id AS seller_id,l.id
                            FROM inventory i LEFT JOIN crafter_listings l ON l.seller_id=i.user_id AND l.gift_id=i.nft_id
                            WHERE i.user_id=? AND i.nft_id=? AND i.status IN ('unlisted','listed')""", (uid,gift_id)).fetchone()
                        if not owned:
                            abort(409, description='Подарок недоступен')
                        gift = json.loads(owned['payload'])
                        if (gift.get('catalog_only') or row['collection_key'] not in (
                            canonical_name(gift.get('name','')),canonical_name(gift.get('collection_id',''))) or
                                any(row[k] and str(gift.get(k,'')).casefold() != row[k].casefold()
                                    for k in ('model','backdrop','symbol'))):
                            abort(409, description='Подарок не подходит под условия оффера')
                        if connection.execute('SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?',
                                              (buyer,gift_id)).fetchone():
                            abort(409, description='У покупателя уже есть этот подарок')
                        lot = dict(owned)
                    price = Decimal(row['price'])
                    backing = json.loads(row['backing'])
                    consume = price
                    for network, held in backing.items():
                        reserved = Decimal(held)
                        spent = min(consume, reserved)
                        backing[network] = str(reserved - spent)
                        consume -= spent
                    left = row['remaining'] - 1
                    connection.execute('UPDATE crafter_offers SET remaining=?,backing=?,status=? WHERE id=?',
                                       (left,json.dumps(backing),'active' if left else 'accepted',offer_id))
                    trade = settle_lot(lot, buyer, 'offer', price=price)
                    record('offer_accepted', {'offer_id':offer_id, **trade}, uid=buyer)
                    record('buy', trade, uid=buyer)
                else:
                    abort(403, description='Это действие недоступно для вашего аккаунта')
            if trade:
                notify_sale(uid, trade)
                if notify_purchase:
                    notify_purchase(buyer, trade)
            if withdrawn and notify_offer:
                notify_offer(*withdrawn, 'withdrawn')
            return {'ok':True, 'balance':str(balance(uid))}

    return close_lot_offers, expire_user_offers, register_resale_actions
