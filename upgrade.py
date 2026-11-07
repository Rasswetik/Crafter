"""Crafter Upgrade: server-side quotes, fair spins and bank-funded Craft Market settlement.

GRAM and gift stakes use Crafter's existing ledger. Native TON stakes are intentionally
unavailable until a dedicated, verified TON escrow exists.
"""
import json
import os
import re
import secrets
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_DOWN

from flask import abort, g, request
from resale import cap_funded_balance

CENT = Decimal('0.01')
QUOTE_LIFETIME = 120
MAX_CHANCE_BPS = 9500
DEMO_BANK_ID = -930070001
# Negative system ownership keeps lost/consumed stake gifts out of every user wallet.
SITE_GIFT_BANK_ID = -930070002


def install_upgrade(app, db, auth, record, canonical_name, available_lot,
                    settle_lot, notify_sale, notify_purchase=None):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS upgrade_quotes (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, payload TEXT NOT NULL,
                created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS upgrade_rounds (
                user_id INTEGER NOT NULL, request_id TEXT NOT NULL,
                quote_id TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL,
                PRIMARY KEY(user_id,request_id)
            );
        """)
        if app.config.get('DEMO_MODE'):
            db().execute('INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT DO NOTHING',
                         (DEMO_BANK_ID, '1000'))

    def bank_user():
        if app.config.get('DEMO_MODE'):
            return DEMO_BANK_ID
        raw = str(app.config.get('UPGRADE_BANK_USER_ID') or os.getenv('UPGRADE_BANK_USER_ID') or '')
        try:
            value = int(raw)
        except ValueError:
            return None
        return value if value > 0 else None

    def cash(uid):
        row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal(0)

    def safe_amount(value):
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,7}(?:\.[0-9]{1,2})?', value):
            abort(400, description='Введите сумму GRAM с точностью до сотых')
        try:
            amount = Decimal(value)
        except InvalidOperation:
            abort(400)
        if amount < CENT or amount > Decimal('1000000'):
            abort(400, description='Допустимая ставка: от 0.01 до 1000000 GRAM')
        return amount

    def rows():
        return db().execute("""
            SELECT l.id, l.price, l.seller_id, l.gift_id, i.payload
            FROM crafter_listings l JOIN inventory i
            ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
            ORDER BY l.listed_at DESC,l.id DESC
        """).fetchall()

    def collection_key(gift):
        return canonical_name(str(gift.get('name') or gift.get('collection_id') or ''))

    def display_lot(row):
        gift = json.loads(row['payload'])
        return {
            'id': row['id'], 'name': str(gift.get('name') or ''),
            'collection': collection_key(gift), 'number': gift.get('number'),
            'model': gift.get('model') or '', 'image': gift.get('image') or '',
            'symbol': gift.get('symbol') or '', 'backdrop': gift.get('backdrop') or '',
            'background': gift.get('background') or {},
            'telegram_url': gift.get('telegram_url') or '',
            'price': str(row['price']), 'price_unit': 'GRAM',
        }

    def stake_gift(uid, gift_id):
        if not isinstance(gift_id, str) or len(gift_id) > 180:
            abort(400, description='Выберите подарок из инвентаря')
        row = db().execute(
            "SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?",
            (uid, gift_id)).fetchone()
        if not row or row['status'] != 'unlisted':
            abort(409, description='Подарок уже недоступен для ставки')
        gift = json.loads(row['payload'])
        if gift.get('catalog_only') or gift.get('price_unit') != 'GRAM':
            abort(409, description='Для ставки нужен подарок с ценой в GRAM')
        raw = gift.get('price')
        try:
            stated = Decimal(str(raw))
        except (InvalidOperation, TypeError):
            abort(409, description='Невозможно оценить подарок')
        if not stated.is_finite() or stated < CENT:
            abort(409, description='Невозможно оценить подарок')
        # Do not price a gift from a user-controlled listing or from unconverted TON.
        # Cap the valuation at a current Craft Market floor for its collection.
        key = collection_key(gift)
        floors = []
        for item in rows():
            other = json.loads(item['payload'])
            if collection_key(other) == key:
                floors.append(Decimal(item['price']))
        # The existing internal acquisition value is authoritative when there are
        # no comparable active listings. If a market floor exists, cap the stake
        # value to that floor instead of inflating the player's win probability.
        valuation = min(stated, min(floors)) if floors else stated
        return gift, valuation.quantize(CENT, rounding=ROUND_DOWN)

    def describe_quote(uid, data):
        lot_id = data.get('lot_id')
        if not isinstance(lot_id, str) or not re.fullmatch(r'crafter-[0-9a-f]{32}', lot_id):
            abort(400, description='Выберите лот Craft Market')
        lot = available_lot(lot_id, uid)
        target = Decimal(lot['price'])
        if lot['seller_id'] in (bank_user(), SITE_GIFT_BANK_ID):
            abort(409, description='Нельзя выбирать лоты банка Upgrade')
        mode = data.get('stake_mode')
        if mode == 'balance':
            amount = safe_amount(data.get('amount'))
            if cash(uid) < amount:
                abort(409, description='Недостаточно GRAM на балансе')
            gift_id = None
        elif mode == 'gift':
            gift_id = data.get('gift_id')
            _, amount = stake_gift(uid, gift_id)
        else:
            abort(400, description='Выберите тип ставки')
        if target <= 0 or amount >= target:
            abort(409, description='Стоимость цели должна быть выше ставки')
        chance = min(MAX_CHANCE_BPS, int((amount * 10000 / target).to_integral_value(rounding=ROUND_DOWN)))
        if chance < 1:
            abort(409, description='Шанс слишком низкий, увеличьте ставку')
        return {
            'lot_id': lot_id, 'target_price': str(target), 'stake_mode': mode,
            'amount': str(amount), 'gift_id': gift_id, 'chance_bps': chance,
            'currency': 'GRAM',
        }

    @app.get('/api/upgrade/info')
    @auth()
    def upgrade_info():
        uid = g.user['id']
        bank = bank_user()
        row = db().execute("SELECT result,created FROM upgrade_rounds WHERE user_id=? ORDER BY created DESC LIMIT 8",
                           (uid,)).fetchall()
        return {
            'balance': str(cash(uid)), 'price_unit': 'GRAM', 'native_ton_enabled': False,
            'enabled': bool(bank is not None and bank != uid and cash(bank) > 0),
            'history': [{**json.loads(r['result']), 'created': r['created']} for r in row],
        }

    @app.get('/api/upgrade/collections')
    @auth()
    def upgrade_collections():
        uid = g.user['id']
        groups = {}
        for row in rows():
            if row['seller_id'] in (uid, bank_user(), SITE_GIFT_BANK_ID):
                continue
            gift = display_lot(row)
            key = gift['collection']
            item = groups.setdefault(key, {
                'key': key, 'name': gift['name'], 'image': gift['image'],
                'floor': gift['price'], 'count': 0,
            })
            item['count'] += 1
            if Decimal(gift['price']) < Decimal(item['floor']):
                item['floor'] = gift['price']
                item['image'] = gift['image']
        return {'collections': sorted(groups.values(), key=lambda item: (Decimal(item['floor']), item['name']))}

    @app.get('/api/upgrade/lots')
    @auth()
    def upgrade_lots():
        uid = g.user['id']
        key = request.args.get('collection', '')[:180]
        if not key:
            abort(400, description='Выберите коллекцию')
        offset = max(0, request.args.get('offset', 0, type=int))
        offset = min(offset, 100000)
        lots = [display_lot(row) for row in rows()
                if row['seller_id'] not in (uid, bank_user(), SITE_GIFT_BANK_ID)
                and collection_key(json.loads(row['payload'])) == key]
        lots.sort(key=lambda lot: (Decimal(lot['price']), str(lot['number'] or '')))
        return {'lots': lots[offset:offset + 40], 'total': len(lots),
                'has_more': offset + 40 < len(lots), 'next_offset': offset + 40}

    @app.post('/api/upgrade/quote')
    @auth()
    def upgrade_quote():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        uid = g.user['id']
        quote = describe_quote(uid, data)
        quote_id = 'ug-' + uuid.uuid4().hex
        with db():
            db().execute('INSERT INTO upgrade_quotes VALUES(?,?,?,?)',
                         (quote_id, uid, json.dumps(quote), int(time.time())))
        bank = bank_user()
        playable = bank is not None and bank != uid and cash(bank) >= Decimal(quote['target_price'])
        return {'quote_id': quote_id, **quote, 'chance': quote['chance_bps']/100,
                'playable': playable, 'expires_in': QUOTE_LIFETIME}

    @app.post('/api/upgrade/play')
    @auth()
    def upgrade_play():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        request_id, quote_id = data.get('request_id'), data.get('quote_id')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id):
            abort(400, description='Некорректный идентификатор запуска')
        if not isinstance(quote_id, str) or not re.fullmatch(r'ug-[0-9a-f]{32}', quote_id):
            abort(400, description='Выберите цель заново')
        uid = g.user['id']
        bank = bank_user()
        lot = trade = result = None
        with db():
            conn = db()
            conn.execute('BEGIN IMMEDIATE')
            receipt = conn.execute(
                'SELECT quote_id,result FROM upgrade_rounds WHERE user_id=? AND request_id=?',
                (uid, request_id)).fetchone()
            if receipt:
                if receipt['quote_id'] != quote_id:
                    abort(409, description='Этот запрос уже использован')
                return json.loads(receipt['result'])
            quote_row = conn.execute(
                'SELECT payload,created FROM upgrade_quotes WHERE id=? AND user_id=?',
                (quote_id, uid)).fetchone()
            if not quote_row or int(time.time()) - int(quote_row['created']) > QUOTE_LIFETIME:
                abort(409, description='Расчёт устарел. Выберите цель заново')
            previous = json.loads(quote_row['payload'])
            fresh = describe_quote(uid, previous if previous['stake_mode'] == 'gift'
                                   else {**previous, 'amount': previous['amount']})
            if fresh != previous:
                abort(409, description='Ставка или цена лота изменилась. Обновите расчёт')
            if bank is None or bank == uid:
                abort(503, description='Банк Upgrade ещё не настроен')
            balance_bank = cash(bank)
            target = Decimal(previous['target_price'])
            # Ensure EVERY possible win can actually be paid before rolling.
            if balance_bank < target:
                abort(503, description='В банке Upgrade недостаточно средств для этой цели')
            roll = secrets.randbelow(10000)
            won = roll < int(previous['chance_bps'])
            amount = Decimal(previous['amount'])
            if previous['stake_mode'] == 'balance':
                remaining = cash(uid) - amount
                if remaining < 0:
                    abort(409, description='Недостаточно GRAM')
                cap_funded_balance(conn, uid, remaining)
                conn.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                             (str(remaining), uid))
                balance_bank += amount
            else:
                gift_id = previous['gift_id']
                moved = conn.execute(
                    "UPDATE inventory SET user_id=?,status='unlisted' WHERE user_id=? AND nft_id=? AND status='unlisted'",
                    (SITE_GIFT_BANK_ID, uid, gift_id))
                # The stake is held in the site's own inventory, independent of the
                # account that funds actual prize purchases from Craft Market.
                if moved.rowcount != 1:
                    abort(409, description='Подарок уже использован')
            if won:
                lot = available_lot(previous['lot_id'], uid)
                trade = settle_lot(lot, uid, 'upgrade', target)
                balance_bank -= target
            # The bank must not keep an independently withdrawable TON allowance
            # after it has spent GRAM to settle a player's prize.
            cap_funded_balance(conn, bank, balance_bank)
            conn.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                         (str(balance_bank), bank))
            result = {
                'ok': True, 'success': won, 'roll_bps': roll,
                'chance_bps': previous['chance_bps'], 'chance': previous['chance_bps']/100,
                'stake_mode': previous['stake_mode'], 'stake': previous['amount'],
                'price_unit': 'GRAM', 'target_price': previous['target_price'],
                'lot_id': previous['lot_id'], 'gift': trade['gift'] if trade else None,
                'site_bank_gift_id': previous['gift_id'] if previous['stake_mode'] == 'gift' else None,
                'balance': str(cash(uid)),
            }
            record('upgrade', result)
            conn.execute('INSERT INTO upgrade_rounds VALUES(?,?,?,?,?)',
                         (uid, request_id, quote_id, json.dumps(result), int(time.time())))
            conn.execute('DELETE FROM upgrade_quotes WHERE id=?', (quote_id,))
        if trade is not None:
            try:
                notify_sale(lot['seller_id'], trade)
                if notify_purchase:
                    notify_purchase(uid, trade)
            except Exception:
                app.logger.warning('Upgrade notification could not be delivered')
        return result
