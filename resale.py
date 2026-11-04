"""Crafter listings and settlement in the internal GRAM ledger."""
import json
import re
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import abort, g, request

CENT = Decimal('0.01')
FEE = Decimal('0.04')
MAX_BATCH = 30


def listing_price(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,7}(?:[.,][0-9]{1,2})?', value):
        abort(400, description='Введите цену в GRAM с точностью до двух знаков')
    price = Decimal(value.replace(',', '.'))
    if not CENT <= price <= 1000000:
        abort(400, description='Цена должна быть от 0,01 до 1 000 000 GRAM')
    return price.quantize(CENT)


def cap_funded_balance(connection, uid, balance):
    """Internal spending must not leave a higher refundable TON allowance."""
    rows = connection.execute(
        "SELECT network,gram FROM wallet_balances WHERE user_id=? ORDER BY CASE WHEN network='mainnet' THEN 1 ELSE 0 END,network",
        (uid,)).fetchall()
    excess = sum((Decimal(row['gram']) for row in rows), Decimal(0)) - max(balance, Decimal(0))
    for row in rows:
        if excess <= 0:
            break
        paid = Decimal(row['gram'])
        removed = min(paid, excess)
        connection.execute('UPDATE wallet_balances SET gram=? WHERE user_id=? AND network=?',
                           (str(paid - removed), uid, row['network']))
        excess -= removed


def install_resale(app, db, auth, record, canonical_name):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_listings (
                id TEXT PRIMARY KEY, seller_id INTEGER NOT NULL, gift_id TEXT NOT NULL,
                price TEXT NOT NULL, listed_at INTEGER NOT NULL, UNIQUE(seller_id,gift_id),
                FOREIGN KEY(seller_id,gift_id) REFERENCES inventory(user_id,nft_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS crafter_sale_receipts (
                buyer_id INTEGER NOT NULL, request_id TEXT NOT NULL, lot_id TEXT NOT NULL,
                price TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(buyer_id,request_id)
            );
        """)

    def public_lot(row, uid):
        gift = json.loads(row['payload'])
        public = {k: v for k, v in gift.items() if k in {
            'name', 'number', 'model', 'image', 'background', 'backdrop', 'symbol', 'source_number',
            'collection_id', 'floor_price', 'rarity', 'telegram_url', 'telegram_slug', 'source_price_unit',
        }}
        return {**public, 'id': row['id'], 'price': row['price'], 'price_unit': 'GRAM',
                'resale': True, 'own_listing': row['seller_id'] == uid, 'listed_at': row['listed_at']}

    def market():
        uid = g.user['id']
        args = request.args
        collections = {canonical_name(value) for value in args.get('collection_id', '')[:2100].split(',') if value}
        query = args.get('search', '').strip().casefold()[:150]
        traits = {'model': 'filter_by_models', 'backdrop': 'filter_by_backdrops', 'symbol': 'filter_by_symbols'}
        order = args.get('sort_by', 'listed_at desc')
        limits = []
        for field in ('min_price', 'max_price'):
            try:
                value = Decimal(args.get(field) or ('0' if field == 'min_price' else '1000000'))
                if not value.is_finite() or value < 0:
                    raise ValueError
            except (InvalidOperation, ValueError):
                abort(400, description='Недопустимый диапазон цены')
            limits.append(value)
        if limits[0] > limits[1]:
            abort(400, description='Недопустимый диапазон цены')
        lots = []
        rows = db().execute("""SELECT l.*, i.payload FROM crafter_listings l
            JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
            ORDER BY l.listed_at DESC,l.id DESC""")
        for row in rows:
            price = Decimal(row['price'])
            if not limits[0] <= price <= limits[1]:
                continue
            gift = public_lot(row, uid)
            if collections and not collections.intersection(canonical_name(gift.get(k, '')) for k in ('collection_id', 'name')):
                continue
            if query and query not in ' '.join(str(gift.get(k, '')) for k in ('name', 'model', 'number')).casefold():
                continue
            if any(args.get(field) and args[field] != gift.get(trait) for trait, field in traits.items()):
                continue
            lots.append(gift)
        field, _, direction = order.partition(' ')
        if field in ('price', 'external_collection_number', 'model_rarity'):
            key = {
                'price': lambda gift: Decimal(gift['price']),
                'external_collection_number': lambda gift: int(gift.get('number') or 0),
                'model_rarity': lambda gift: float((gift.get('rarity') or {}).get('model') or 0),
            }[field]
            lots.sort(key=key, reverse=direction == 'desc')
        offset = max(0, args.get('offset', 0, type=int))
        end = offset + 20
        return {'gifts': lots[offset:end], 'source': 'crafter', 'price_unit': 'GRAM',
                'next_offset': end, 'has_more': end < len(lots), 'total': len(lots)}

    @app.post('/api/resale/listings')
    @auth()
    def update_listings():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        action, items = data.get('action'), data.get('items')
        if (action not in ('sell', 'edit', 'unlist') or not isinstance(items, list) or
                not 1 <= len(items) <= MAX_BATCH):
            abort(400, description='Выберите от 1 до 30 подарков')
        uid = g.user['id']
        changes = {}
        for item in items:
            gift_id = item.get('id') if isinstance(item, dict) else None
            if not isinstance(gift_id, str) or not 1 <= len(gift_id) <= 200 or gift_id in changes:
                abort(400, description='Проверьте список подарков')
            changes[gift_id] = None if action == 'unlist' else listing_price(item.get('price'))
        with db():
            db().execute('BEGIN IMMEDIATE')
            gifts = []
            for gift_id, price in changes.items():
                row = db().execute('SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?',
                                   (uid, gift_id)).fetchone()
                if not row or row['status'] != ('unlisted' if action == 'sell' else 'listed'):
                    abort(409, description='Один из подарков уже недоступен для этого действия')
                gift = json.loads(row['payload'])
                if gift.get('catalog_only'):
                    abort(409, description='Модель из каталога нельзя выставить')
                if action == 'unlist':
                    db().execute('DELETE FROM crafter_listings WHERE seller_id=? AND gift_id=?', (uid, gift_id))
                    db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=?", (uid, gift_id))
                else:
                    db().execute("""
                        INSERT INTO crafter_listings(id,seller_id,gift_id,price,listed_at) VALUES(?,?,?,?,?)
                        ON CONFLICT(seller_id,gift_id) DO UPDATE SET price=excluded.price
                    """, ('crafter-' + uuid.uuid4().hex, uid, gift_id, str(price), int(time.time())))
                    db().execute("UPDATE inventory SET status='listed' WHERE user_id=? AND nft_id=?", (uid, gift_id))
                gifts.append({**gift, 'price': str(price) if price is not None else gift.get('price')})
            record({'sell': 'sell', 'edit': 'listing_price', 'unlist': 'unlist'}[action], {'gifts': gifts})
        return {'ok': True, 'gift_ids': list(changes)}

    @app.post('/api/resale/buy')
    @auth()
    def buy():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        lot_id, request_id = data.get('id'), data.get('request_id')
        if (not isinstance(lot_id, str) or not re.fullmatch(r'crafter-[0-9a-f]{32}', lot_id) or
                not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', request_id)):
            abort(400)
        expected = listing_price(data.get('expected_price'))
        buyer = g.user['id']
        with db():
            connection = db()
            connection.execute('BEGIN IMMEDIATE')
            receipt = connection.execute('SELECT lot_id,price,result FROM crafter_sale_receipts WHERE buyer_id=? AND request_id=?',
                                         (buyer, request_id)).fetchone()
            if receipt:
                if receipt['lot_id'] != lot_id or Decimal(receipt['price']) != expected:
                    abort(409, description='Этот запрос уже использован')
                return json.loads(receipt['result'])
            lot = connection.execute("""SELECT l.*,i.payload FROM crafter_listings l JOIN inventory i
                ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed' WHERE l.id=?""", (lot_id,)).fetchone()
            if not lot:
                abort(409, description='Лот уже куплен или снят с продажи')
            seller, gift_id = lot['seller_id'], lot['gift_id']
            if buyer == seller:
                abort(409, description='Свой лот нельзя купить')
            price = Decimal(lot['price'])
            if expected != price:
                abort(409, description='Цена изменилась. Откройте лот снова')
            balances = {row['user_id']: Decimal(row['balance']) for row in connection.execute(
                'SELECT user_id,balance FROM demo_accounts WHERE user_id IN (?,?)', (buyer, seller))}
            if balances.get(buyer, Decimal(0)) < price:
                abort(409, description='Недостаточно GRAM на балансе')
            if connection.execute('SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?', (buyer, gift_id)).fetchone():
                abort(409, description='Этот подарок уже есть в вашем инвентаре')
            fee = (price * FEE).quantize(CENT, rounding=ROUND_HALF_UP)
            proceeds = price - fee
            balance = balances[buyer] - price
            seller_balance = balances.get(seller, Decimal(0))
            cap_funded_balance(connection, buyer, balance)
            cap_funded_balance(connection, seller, seller_balance)
            connection.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(balance), buyer))
            connection.execute("""INSERT INTO demo_accounts(user_id,balance) VALUES(?,?)
                ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance""", (seller, str(seller_balance + proceeds)))
            gift = json.loads(lot['payload'])
            connection.execute('DELETE FROM crafter_listings WHERE id=?', (lot_id,))
            connection.execute("UPDATE inventory SET user_id=?,status='unlisted' WHERE user_id=? AND nft_id=?",
                               (buyer, seller, gift_id))
            trade = {'gift': gift, 'price': str(price), 'fee': str(fee), 'proceeds': str(proceeds), 'scope': 'crafter'}
            record('buy', trade)
            record('sale', trade, uid=seller)
            result = {'ok': True, 'gift': gift, 'balance': str(balance), 'fee': str(fee), 'scope': 'crafter'}
            connection.execute('INSERT INTO crafter_sale_receipts VALUES(?,?,?,?,?)',
                               (buyer, request_id, lot_id, str(price), json.dumps(result)))
        return result

    return market
