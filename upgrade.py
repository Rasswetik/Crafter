"""Upgrade mode: stake one gift, pick a pricier target gift, spin the wheel.

Reuses the craft machinery (market candidates, awarding, internal lots) so a won
target comes from the same sources as a Lucky Craft: Portals market listings or
Crafter player lots. The server rolls with ``secrets`` and returns the roll so the
client only animates a result that is already settled.
"""
import json
import secrets
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

STAKE_ORIGINS = ('admin-grant', 'application-craft', 'local-purchase', 'portals-partner', 'telegram-deposit', 'thermos')
TEST_ORIGINS = ('market-test', 'demo-craft')
MIN_BPS, MAX_BPS = 100, 9499      # 1% .. 94.99%; the 5% house edge is built into the ratio
EDGE_BPS = 9500
QUOTE_TTL = 120
TARGET_LIMIT = 60


def chance_bps(stake, target):
    """Win chance in basis points for a stake worth ``stake`` aiming at ``target``."""
    if stake <= 0 or target <= 0:
        return 0
    return int(stake / target * EDGE_BPS)


def roll_wins(roll, bps):
    return 0 <= roll < bps


def install_upgrade(app, db, auth, record, ctx):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS upgrade_quotes (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS upgrade_requests (
                user_id INTEGER NOT NULL, request_id TEXT NOT NULL, result TEXT NOT NULL,
                PRIMARY KEY(user_id, request_id));
        """)
        db().commit()

    owned = ctx['owned']
    positive_price = ctx['positive_price']

    def stake_value(gift):
        """GRAM value of a stake, or None when the gift cannot be staked.

        Real gifts use their GRAM price. Gifts bought in test mode carry price 0 and keep
        the market price in source_price(+unit); they are only accepted while test mode is on."""
        if gift['status'] != 'unlisted':
            return None
        if gift.get('test_only'):
            if not ctx['test_mode']() or gift.get('origin') not in TEST_ORIGINS:
                return None
            amount = positive_price(gift.get('source_price'))
            if amount is None:
                return None
            if gift.get('source_price_unit', 'GRAM') == 'TON':
                try:
                    amount = amount * Decimal(str(ctx['gram_per_ton']()))
                except Exception:
                    return None
            return amount
        if gift.get('catalog_only') or gift.get('origin') not in STAKE_ORIGINS:
            return None
        price = positive_price(gift.get('price')) if gift.get('price_unit', 'GRAM') == 'GRAM' else None
        if price is None and gift.get('origin') in ('telegram-deposit', 'portals-partner', 'thermos'):
            return collection_floor(gift)       # deposited NFTs carry no price: value them at the collection floor
        return price

    def collection_floor(gift):
        """GRAM value of a gift priced at its collection's floor in the current catalogue."""
        floors = getattr(g, '_upgrade_floors', None)
        if floors is None:
            floors = {}
            for c in ctx['public_catalog']():
                value = positive_price(c.get('floor_price'))
                if value is None:
                    continue
                if c.get('price_unit', 'GRAM') == 'TON':
                    try:
                        value = value * Decimal(str(ctx['gram_per_ton']()))
                    except Exception:
                        continue
                floors.setdefault(ctx['canonical_name'](c.get('name', '')), value)
            g._upgrade_floors = floors
        return floors.get(ctx['canonical_name'](gift.get('name', '')))

    def stake_gift(gift_id):
        gift = next((x for x in owned() if x['id'] == gift_id), None)
        value = stake_value(gift) if gift else None
        if value is None:
            abort(409, description='Этот подарок нельзя поставить в апгрейд')
        return gift, value

    @app.get('/api/upgrade/stakes')
    @auth()
    def upgrade_stakes():
        out = []
        for gift in owned():
            value = stake_value(gift)
            if value is not None:
                out.append({**gift, 'upgrade_value': str(value.quantize(Decimal('0.01')))})
        return {'gifts': out}

    def lots(target, uid):
        rows = db().execute("""SELECT l.id,l.price,l.seller_id,i.payload FROM crafter_listings l
            JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
            WHERE l.seller_id!=? ORDER BY l.listed_at DESC""", (uid,))
        name = ctx['canonical_name'](target['name'])
        for row in rows:
            gift = json.loads(row['payload'])
            if ctx['work_mode']() and gift.get('origin') != 'telegram-deposit':
                continue          # work mode: only gifts that really sit on our relayer are shown
            if ctx['canonical_name'](gift.get('name', '')) == name:
                yield {**{k: gift.get(k) for k in ('name', 'number', 'model', 'image', 'backdrop', 'symbol',
                                                    'background', 'collection_id')},
                       'id': row['id'], 'price': row['price'], 'source': 'crafter'}

    def view(gift, price, source):
        return {'id': gift['id'], 'name': gift.get('name'), 'number': gift.get('number'),
                'model': gift.get('model', ''), 'backdrop': gift.get('backdrop', ''),
                'symbol': gift.get('symbol', ''), 'image': gift.get('image', ''),
                'background': gift.get('background'), 'collection_id': gift.get('collection_id'),
                'price': str(price), 'price_unit': 'GRAM', 'source': source}

    def collection(collection_id):
        target = next((c for c in ctx['public_catalog']() if str(c['id']) == str(collection_id)), None)
        if not target:
            abort(400, description='Выберите коллекцию')
        return target

    def market_price(gift, price, test):
        """GRAM price of a market lot, or None when it cannot be valued. TON lots (Thermos) are converted."""
        unit = gift.get('price_unit', 'GRAM')
        if unit == 'GRAM':
            return price
        if unit == 'TON' and (test or ctx['thermos_backend']()):
            return (price * Decimal(str(ctx['gram_per_ton']()))).quantize(Decimal('0.01'))
        return None

    def offers(target, uid, value, test=False):
        """Market lots (Portals) + Crafter player lots, cheapest first."""
        # Only lots whose chance falls in [MIN_BPS, MAX_BPS] can ever be offered.
        ctx['ensure_listings'](target, value * EDGE_BPS / (MAX_BPS + 1), value * EDGE_BPS / MIN_BPS)
        out = []
        for gift, price in ctx['market_candidates'](target):
            price = market_price(gift, price, test)
            if price is not None and gift.get('image') and (test or gift.get('model')):
                shown = view(gift, price, 'portals')
                shown['market'] = gift.get('marketplace') or ('Thermos' if ctx['thermos_backend']() else 'Portals')
                shown['marketplace'] = gift.get('marketplace')
                if gift.get('price_unit') == 'TON':
                    shown['ton_price'] = str(gift['price'])       # exact TON price, needed for re-verification
                out.append((shown, price))
        for lot in ([] if test else lots(target, uid)):
            price = positive_price(lot['price'])
            if price is not None:
                out.append((view(lot, price, 'crafter'), price))
        # Crafter market lots come first, then Portals; cheapest first inside each group.
        out.sort(key=lambda item: (item[0]['source'] != 'crafter', item[1], item[0]['id']))
        return out

    @app.get('/api/upgrade/collections')
    @auth()
    def upgrade_collections():
        """All catalogue collections; those with usable Crafter market lots for this stake come first."""
        gift, value = stake_gift(request.args.get('stake_id', ''))
        low, high = value * EDGE_BPS / (MAX_BPS + 1), value * EDGE_BPS / MIN_BPS
        found = {}
        if not gift.get('test_only'):
            rows = db().execute("""SELECT l.price,i.payload FROM crafter_listings l
                JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
                WHERE l.seller_id!=?""", (g.user['id'],))
            for row in rows:
                lot = json.loads(row['payload'])
                price = positive_price(row['price'])
                if price is None or not low <= price <= high:
                    continue
                if ctx['work_mode']() and lot.get('origin') != 'telegram-deposit':
                    continue
                key = ctx['canonical_name'](lot.get('name', ''))
                found[key] = found.get(key, 0) + 1
        out = []
        for index, c in enumerate(ctx['public_catalog']()):
            out.append({'id': c['id'], 'name': c['name'], 'photo_url': c.get('photo_url', ''),
                        'crafter': found.get(ctx['canonical_name'](c['name']), 0), '_i': index})
        out.sort(key=lambda c: (-c['crafter'], c['_i']))
        for c in out:
            c.pop('_i')
        return {'collections': out, 'stake_value': str(value)}

    @app.get('/api/upgrade/targets')
    @auth()
    def upgrade_targets():
        gift, value = stake_gift(request.args.get('stake_id', ''))
        target = collection(request.args.get('collection_id'))
        shown = []
        for item, price in offers(target, g.user['id'], value, bool(gift.get('test_only'))):
            bps = chance_bps(value, price)
            if MIN_BPS <= bps <= MAX_BPS:
                shown.append({**item, 'chance': bps / 100})
        return {'stake_value': str(value), 'gifts': shown[:TARGET_LIMIT], 'collection': {
            'id': target['id'], 'name': target['name'], 'photo_url': target.get('photo_url', '')}}

    @app.post('/api/upgrade/quote')
    @auth()
    def upgrade_quote():
        data = request.get_json(silent=True) or {}
        gift, value = stake_gift(data.get('stake_id', ''))
        target = collection(data.get('collection_id'))
        listing_id = data.get('listing_id')
        if not isinstance(listing_id, str) or not 1 <= len(listing_id) <= 150:
            abort(400, description='Выберите целевой подарок')
        found = next(((item, price) for item, price in offers(target, g.user['id'], value, bool(gift.get('test_only')))
                      if item['id'] == listing_id), None)
        if not found:
            abort(409, description='Целевой подарок недоступен. Обновите список.')
        item, price = found
        if not gift.get('test_only') and item['source'] == 'portals':
            check = {**item, 'price': item['ton_price'], 'price_unit': 'TON'} if item.get('ton_price') else item
            ctx['can_buy'](check, price)         # work mode: must be buyable on the market, else no upgrade
        bps = chance_bps(value, price)
        if not MIN_BPS <= bps <= MAX_BPS:
            abort(409, description='Для этой цели нужна другая ставка')
        quote = {'stake_id': gift['id'], 'stake_value': str(value), 'listing_id': listing_id,
                 'source': item['source'], 'price': str(price), 'chance_bps': bps,
                 'collection_id': str(target['id'])}
        qid = uuid.uuid4().hex
        with db():
            db().execute('INSERT INTO upgrade_quotes VALUES(?,?,?,?)',
                         (qid, g.user['id'], json.dumps(quote), int(time.time())))
        return {'quote_id': qid, 'chance': bps / 100, 'stake_value': str(value), 'target_value': str(price),
                'expires_at': int(time.time()) + QUOTE_TTL}

    @app.post('/api/upgrade')
    @auth()
    def upgrade_spin():
        data = request.get_json(silent=True) or {}
        rid, qid = data.get('request_id'), data.get('quote_id')
        if not isinstance(rid, str) or not 1 <= len(rid) <= 100 or not isinstance(qid, str):
            abort(400)
        uid = g.user['id']
        notify = None
        # Work mode: re-check outside the write transaction that a Portals lot can still be bought out.
        pre = db().execute('SELECT payload FROM upgrade_quotes WHERE id=? AND user_id=?', (qid, uid)).fetchone()
        if pre:
            pq = json.loads(pre['payload'])
            pg = next((x for x in owned() if x['id'] == pq['stake_id']), None)
            if pq['source'] == 'portals' and pg and not pg.get('test_only'):
                cand = next((gf for gf, p in ctx['market_candidates'](collection(pq['collection_id']))
                             if gf['id'] == pq['listing_id']), None)
                if cand:
                    ctx['can_buy']({**cand, 'price_unit': cand.get('price_unit', 'GRAM')}, Decimal(pq['price']))
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior = db().execute('SELECT result FROM upgrade_requests WHERE user_id=? AND request_id=?',
                                 (uid, rid)).fetchone()
            if prior:
                return json.loads(prior[0])
            row = db().execute('SELECT payload,created FROM upgrade_quotes WHERE id=? AND user_id=?',
                               (qid, uid)).fetchone()
            if not row or time.time() - row['created'] > QUOTE_TTL:
                abort(409, description='Расчёт устарел. Повторите выбор.')
            q = json.loads(row['payload'])
            gift, value = stake_gift(q['stake_id'])
            if str(value) != q['stake_value']:
                abort(409, description='Оценка ставки изменилась. Повторите выбор.')
            target = collection(q['collection_id'])
            price = Decimal(q['price'])
            reward = None
            roll = secrets.randbelow(10000)
            win = roll_wins(roll, q['chance_bps'])
            lot = listing = deferred = None
            if win and gift.get('test_only'):
                # Test mode: no availability or price re-check, the quoted listing is simply awarded.
                listing = next((gf for gf, p in ctx['market_candidates'](target)
                                if gf['id'] == q['listing_id']), None)
                if listing is None:
                    abort(409, description='Целевой подарок уже недоступен. Повторите выбор.')
            elif win:
                if q['source'] == 'crafter':
                    lot = ctx['available_crafter_lot'](q['listing_id'], uid)
                    if Decimal(lot['price']) != price:
                        abort(409, description='Лот изменился. Повторите выбор.')
                else:
                    listing = next((gf for gf, p in ctx['market_candidates'](target)
                                    if gf['id'] == q['listing_id'] and market_price(gf, p, False) == price), None)
                    if listing is None:
                        abort(409, description='Целевой подарок уже недоступен. Повторите выбор.')
                    if ctx['thermos_backend']() and ctx['work_mode']():
                        deferred = listing            # really bought on Thermos after the transaction
            stake_payload = {k: v for k, v in gift.items() if k not in ('status', 'listing_price')}
            db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?', (uid, gift['id']))
            if win and gift.get('test_only'):
                reward = {**listing, 'id': 'demo-craft-' + uuid.uuid4().hex, 'collection_id': target['id'],
                          'source_id': listing['id'], 'origin': 'demo-craft', 'test_only': True, 'catalog_only': True,
                          'crafted': True, 'source_price': str(price), 'source_price_unit': 'GRAM',
                          'price': '0', 'price_unit': 'GRAM'}
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)',
                             (uid, reward['id'], json.dumps(reward), 'unlisted'))
            elif win and lot is not None:
                sale = ctx['settle_crafter_lot'](lot, uid, 'upgrade')
                reward, notify = sale['gift'], (lot['seller_id'], sale)
            elif win and deferred is None:
                reward = ctx['award_market_gift'](target, listing, price.quantize(Decimal('0.01')))
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)',
                             (uid, reward['id'], json.dumps(reward), 'unlisted'))
            result = {'success': win, 'chance': q['chance_bps'] / 100, 'roll': roll / 100,
                      'gift': reward, 'stake': {k: gift.get(k) for k in ('id', 'name', 'number', 'image')},
                      'stake_value': q['stake_value'], 'target_value': q['price'], 'mode': 'upgrade'}
            if deferred is not None:
                result['pending'] = True
            result['balls_earned'] = record('upgrade', result)
            db().execute('INSERT INTO upgrade_requests VALUES(?,?,?)', (uid, rid, json.dumps(result)))
            db().execute('DELETE FROM upgrade_quotes WHERE id=?', (qid,))
        if notify:
            ctx['notify_sale'](*notify)
        if deferred is not None:
            result = settle_purchase(uid, rid, result, deferred, price, stake_payload)
        return result

    def settle_purchase(uid, rid, result, listing, price, stake_payload):
        """Winner of a market lot in WORK mode: buy it for real. Failure returns the stake; unknown goes to review."""
        outcome, note = ctx['acquire']([listing])
        with db():
            db().execute('BEGIN IMMEDIATE')
            if outcome == 'ok':
                gift = {**listing, 'id': 'thermos-' + uuid.uuid4().hex, 'source_id': listing['id'], 'origin': 'thermos',
                        'price': str(price), 'price_unit': 'GRAM', 'relayer_pending': True,
                        'source_price': str(listing['price']), 'source_price_unit': listing.get('price_unit', 'TON')}
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)', (uid, gift['id'], json.dumps(gift), 'unlisted'))
                result = {**result, 'gift': gift, 'pending': False}
            elif outcome == 'failed':
                db().execute('INSERT INTO inventory VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
                             (uid, stake_payload['id'], json.dumps(stake_payload), 'unlisted'))
                result = {**result, 'success': False, 'gift': None, 'pending': False, 'refunded': True,
                          'note': 'Подарок не удалось выкупить — ставка возвращена'}
            else:
                result = {**result, 'pending': False, 'review': True,
                          'note': 'Выкуп подтверждается вручную. Подарок появится в инвентаре.'}
            db().execute('UPDATE upgrade_requests SET result=? WHERE user_id=? AND request_id=?',
                         (json.dumps(result), uid, rid))
        return result
