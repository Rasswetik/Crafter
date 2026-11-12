"""Gift auctions in the internal GRAM ledger.

A seller puts a gift from the inventory up for a fixed time with a start price. While the auction runs the gift has
status 'auction' (so it cannot be sold, crafted, staked, withdrawn or played elsewhere). A bid is taken from the bidder's
balance at once (escrow); the previous leader gets their money back the moment somebody outbids them. When the time is
over the gift goes to the leader and the seller receives the price minus the marketplace fee, or the gift returns to the
seller when nobody bid. A bid in the last two minutes moves the end by two minutes (no last-second sniping)."""
import json
import re
import threading
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP

from flask import abort, g, request
from resale import CENT, FEE, cap_funded_balance, listing_price

MIN_MINUTES = 30
MAX_MINUTES = 30 * 24 * 60            # the seller picks any length from 30 minutes to 30 days
MAX_ACTIVE_PER_SELLER = 10
STEP_RATE = Decimal('0.05')          # a new bid must beat the leader by 5 %, at least one cent
EXTEND_WINDOW = 120
EXTEND_BY = 120
MAX_EXTENSIONS = 30
PUBLIC_FIELDS = {'name', 'number', 'model', 'image', 'background', 'backdrop', 'symbol', 'source_number',
                 'collection_id', 'rarity', 'telegram_url', 'telegram_slug', 'pack_item', 'pack_id'}


def min_next_bid(start_price, current_bid):
    """The smallest bid that is accepted now."""
    if current_bid is None:
        return Decimal(start_price)
    current = Decimal(current_bid)
    step = max(CENT, (current * STEP_RATE).quantize(CENT, rounding=ROUND_UP))
    return current + step


def install_auctions(app, db, auth, record, notify_sale=None, notify_purchase=None, notify_auction=None):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_auctions (
                id TEXT PRIMARY KEY, seller_id INTEGER NOT NULL, gift_id TEXT NOT NULL, gift_json TEXT NOT NULL,
                start_price TEXT NOT NULL, current_bid TEXT, bidder_id INTEGER, backing TEXT NOT NULL DEFAULT '{}',
                bid_count INTEGER NOT NULL DEFAULT 0, extensions INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL, created INTEGER NOT NULL, ends_at INTEGER NOT NULL, closed_at INTEGER,
                request_id TEXT NOT NULL, UNIQUE(seller_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS crafter_auctions_status ON crafter_auctions(status, ends_at);
            CREATE INDEX IF NOT EXISTS crafter_auctions_seller ON crafter_auctions(seller_id, status);
            CREATE TABLE IF NOT EXISTS crafter_auction_favorites (
                user_id INTEGER NOT NULL, auction_id TEXT NOT NULL, PRIMARY KEY(user_id, auction_id)
            );
            CREATE TABLE IF NOT EXISTS crafter_auction_bids (
                id TEXT PRIMARY KEY, auction_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                amount TEXT NOT NULL, created INTEGER NOT NULL, request_id TEXT NOT NULL,
                UNIQUE(user_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS crafter_auction_bids_auction ON crafter_auction_bids(auction_id, created);
        """)

    def balance(uid):
        row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
        return Decimal(row[0]) if row else Decimal(0)

    def credit(uid, amount):
        """Give GRAM back or pay it out (the internal balance only)."""
        current = balance(uid)
        cap_funded_balance(db(), uid, current)
        db().execute("""INSERT INTO demo_accounts(user_id,balance) VALUES(?,?)
            ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance""", (uid, str(current + amount)))

    def restore(uid, amount, backing):
        """The bid comes back: the balance and the refundable TON allowance that was held with it."""
        credit(uid, amount)
        for network, held in backing.items():
            funded = db().execute('SELECT gram FROM wallet_balances WHERE user_id=? AND network=?',
                                  (uid, network)).fetchone()
            total = (Decimal(funded[0]) if funded else Decimal(0)) + Decimal(held)
            db().execute("""INSERT INTO wallet_balances VALUES(?,?,?)
                ON CONFLICT(user_id,network) DO UPDATE SET gram=excluded.gram""", (uid, network, str(total)))

    def public_gift(row):
        gift = json.loads(row['gift_json'])
        return {k: v for k, v in gift.items() if k in PUBLIC_FIELDS}

    def person(uid):
        row = db().execute('SELECT name,username FROM users WHERE id=?', (uid,)).fetchone()
        name = ((row['name'] if row else '') or '').strip() or ((row['username'] if row else '') or '').strip()
        return (name or 'Игрок')[:14]

    def public(row, uid, bids=False):
        current = row['current_bid']
        item = {
            'id': row['id'], 'gift': public_gift(row), 'start_price': row['start_price'], 'current_bid': current,
            'bid_count': row['bid_count'], 'status': row['status'], 'created': row['created'],
            'ends_at': row['ends_at'], 'price_unit': 'GRAM',
            'min_bid': str(min_next_bid(row['start_price'], current)),
            'own': row['seller_id'] == uid, 'leading': row['bidder_id'] == uid and current is not None,
            'leader': person(row['bidder_id']) if row['bidder_id'] else None,
            'can_cancel': row['seller_id'] == uid and row['status'] == 'active' and row['bid_count'] == 0,
            'favorite': bool(db().execute('SELECT 1 FROM crafter_auction_favorites WHERE user_id=? AND auction_id=?',
                                          (uid, row['id'])).fetchone()),
        }
        if bids:
            item['bids'] = [{'user': person(b['user_id']), 'amount': b['amount'], 'created': b['created'],
                             'mine': b['user_id'] == uid}
                            for b in db().execute("""SELECT user_id,amount,created FROM crafter_auction_bids
                                WHERE auction_id=? ORDER BY created DESC,rowid DESC LIMIT 12""", (row['id'],))]
        return item

    def settle(row):
        """Close one finished auction. Runs inside a transaction; returns the notices to send afterwards."""
        now = int(time.time())
        gift = json.loads(row['gift_json'])
        seller, winner, gift_id = row['seller_id'], row['bidder_id'], row['gift_id']
        notices = []
        keep = winner is not None and not db().execute(
            'SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?', (winner, gift_id)).fetchone()
        if winner is None or not keep:
            if winner is not None:               # the winner already owns this very gift: give the money back
                restore(winner, Decimal(row['current_bid']), json.loads(row['backing']))
            db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='auction'",
                         (seller, gift_id))
            db().execute("UPDATE crafter_auctions SET status='unsold',closed_at=? WHERE id=?", (now, row['id']))
            record('auction_unsold', {'auction_id': row['id'], 'gift': gift}, uid=seller)
            notices.append(('unsold', seller, gift, row['start_price']))
            return notices
        price = Decimal(row['current_bid'])
        fee = (price * FEE).quantize(CENT, rounding=ROUND_HALF_UP)
        proceeds = price - fee
        credit(seller, proceeds)
        moved = db().execute("""UPDATE inventory SET user_id=?,status='unlisted'
            WHERE user_id=? AND nft_id=? AND status='auction'""", (winner, seller, gift_id)).rowcount
        if moved != 1:
            raise RuntimeError('auction gift is not in escrow')
        db().execute("UPDATE crafter_auctions SET status='sold',closed_at=? WHERE id=?", (now, row['id']))
        trade = {'gift': gift, 'price': str(price), 'fee': str(fee), 'proceeds': str(proceeds),
                 'scope': 'crafter', 'mode': 'auction'}
        record('sale', trade, uid=seller)
        record('buy', trade, uid=winner)
        notices.append(('sold', seller, winner, trade))
        return notices

    def settle_due():
        """Close every auction whose time is over. Safe to call from any request or from the worker."""
        now = int(time.time())
        ids = [r['id'] for r in db().execute(
            "SELECT id FROM crafter_auctions WHERE status='active' AND ends_at<=?", (now,)).fetchall()]
        sent = []
        for auction_id in ids:
            with db():
                db().execute('BEGIN IMMEDIATE')
                row = db().execute("SELECT * FROM crafter_auctions WHERE id=? AND status='active' AND ends_at<=?",
                                   (auction_id, int(time.time()))).fetchone()
                if row:
                    sent += settle(row)
        for notice in sent:
            if notice[0] == 'sold':
                _, seller, winner, trade = notice
                if notify_sale:
                    notify_sale(seller, trade)
                if notify_purchase:
                    notify_purchase(winner, trade)
            elif notify_auction:
                notify_auction('unsold', notice[1], notice[2], notice[3])
        return len(ids)

    def clean_request_id(data):
        rid = data.get('request_id') if isinstance(data, dict) else None
        if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', rid):
            abort(400, description='Проверьте параметры запроса')
        return rid

    def lock_auction(auction_id):
        row = db().execute('SELECT * FROM crafter_auctions WHERE id=?', (auction_id,)).fetchone()
        if not row:
            abort(404, description='Аукцион не найден')
        return row

    def number_text(value):
        return str(value or '').lstrip('#')

    @app.get('/api/auctions')
    @auth()
    def auctions_list():
        settle_due()
        uid = g.user['id']
        args = request.args
        view = args.get('view', 'all')
        now = int(time.time())
        if view == 'mine':
            rows = db().execute("""SELECT * FROM crafter_auctions WHERE seller_id=? AND status='active'
                ORDER BY ends_at ASC LIMIT 100""", (uid,)).fetchall()
        elif view == 'bids':
            rows = db().execute("""SELECT * FROM crafter_auctions WHERE status='active' AND id IN
                (SELECT auction_id FROM crafter_auction_bids WHERE user_id=?) ORDER BY ends_at ASC LIMIT 100""",
                                (uid,)).fetchall()
        elif view == 'favorites':
            rows = db().execute("""SELECT * FROM crafter_auctions WHERE status='active' AND ends_at>? AND id IN
                (SELECT auction_id FROM crafter_auction_favorites WHERE user_id=?) ORDER BY ends_at ASC LIMIT 100""",
                                (now, uid)).fetchall()
        else:
            rows = db().execute("SELECT * FROM crafter_auctions WHERE status='active' AND ends_at>? LIMIT 600",
                                (now,)).fetchall()
        facets = {}
        for row in rows:
            name = json.loads(row['gift_json']).get('name') or ''
            facets[name] = facets.get(name, 0) + 1
        query = args.get('search', '').strip().casefold()[:100]
        collections = {c for c in args.get('collection', '')[:1000].split(',') if c}
        limits = []
        for field, default in (('min_price', '0'), ('max_price', '1000000000')):
            try:
                limits.append(Decimal(args.get(field) or default))
            except Exception:
                abort(400, description='Недопустимый диапазон цены')
        wanted_number = number_text(args.get('number', '')[:20])
        kept = []
        for row in rows:
            gift = json.loads(row['gift_json'])
            price = Decimal(row['current_bid'] or row['start_price'])
            if collections and (gift.get('name') or '') not in collections:
                continue
            if not limits[0] <= price <= limits[1]:
                continue
            if wanted_number and number_text(gift.get('number')) != wanted_number:
                continue
            if query and query not in ' '.join(str(gift.get(k, '')) for k in
                                               ('name', 'model', 'backdrop', 'symbol', 'number')).casefold():
                continue
            kept.append(row)
        key = {'new': lambda r: -r['created'], 'price': lambda r: Decimal(r['current_bid'] or r['start_price']),
               'price_desc': lambda r: -Decimal(r['current_bid'] or r['start_price']),
               'bids': lambda r: -r['bid_count']}.get(args.get('sort', 'ending'), lambda r: r['ends_at'])
        kept = sorted(kept, key=key)[:100]
        return {'auctions': [public(r, uid) for r in kept], 'now': now, 'balance': str(balance(uid)),
                'fee_percent': str(FEE * 100), 'max_active': MAX_ACTIVE_PER_SELLER,
                'collections': [{'name': n, 'count': c} for n, c in sorted(facets.items())]}

    @app.post('/api/auctions/<auction_id>/favorite')
    @auth()
    def auction_favorite(auction_id):
        uid = g.user['id']
        lock_auction(auction_id)
        with db():
            marked = db().execute('SELECT 1 FROM crafter_auction_favorites WHERE user_id=? AND auction_id=?',
                                  (uid, auction_id)).fetchone()
            if marked:
                db().execute('DELETE FROM crafter_auction_favorites WHERE user_id=? AND auction_id=?', (uid, auction_id))
            else:
                db().execute('INSERT INTO crafter_auction_favorites VALUES(?,?)', (uid, auction_id))
        return {'favorite': not marked}

    @app.get('/api/auctions/<auction_id>')
    @auth()
    def auction_detail(auction_id):
        settle_due()
        row = lock_auction(auction_id)
        return {'auction': public(row, g.user['id'], bids=True), 'now': int(time.time()),
                'balance': str(balance(g.user['id']))}

    @app.post('/api/auctions')
    @auth()
    def auction_create():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        rid = clean_request_id(data)
        gift_id, minutes = data.get('gift_id'), data.get('minutes')
        if (not isinstance(gift_id, str) or not 1 <= len(gift_id) <= 200 or type(minutes) is not int or
                not MIN_MINUTES <= minutes <= MAX_MINUTES):
            abort(400, description='Выберите подарок и длительность от 30 минут до 30 дней')
        price = listing_price(data.get('start_price'))
        uid = g.user['id']
        settle_due()
        with db():
            db().execute('BEGIN IMMEDIATE')
            previous = db().execute('SELECT * FROM crafter_auctions WHERE seller_id=? AND request_id=?',
                                    (uid, rid)).fetchone()
            if previous:
                if previous['gift_id'] != gift_id or Decimal(previous['start_price']) != price:
                    abort(409, description='Этот запрос уже использован')
                return {'auction': public(previous, uid)}
            active = db().execute("SELECT count(*) FROM crafter_auctions WHERE seller_id=? AND status='active'",
                                  (uid,)).fetchone()[0]
            if active >= MAX_ACTIVE_PER_SELLER:
                abort(409, description='Можно вести не больше %d аукционов одновременно' % MAX_ACTIVE_PER_SELLER)
            inv = db().execute('SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?',
                               (uid, gift_id)).fetchone()
            if not inv or inv['status'] != 'unlisted':
                abort(409, description='Подарок недоступен: снимите его с продажи или дождитесь окончания игры')
            gift = json.loads(inv['payload'])
            if gift.get('catalog_only') or gift.get('star_gift'):
                abort(409, description='Этот подарок нельзя выставить на аукцион')
            now = int(time.time())
            auction_id = 'auction-' + uuid.uuid4().hex
            db().execute("UPDATE inventory SET status='auction' WHERE user_id=? AND nft_id=?", (uid, gift_id))
            db().execute("""INSERT INTO crafter_auctions(id,seller_id,gift_id,gift_json,start_price,status,created,
                ends_at,request_id) VALUES(?,?,?,?,?,'active',?,?,?)""",
                         (auction_id, uid, gift_id, json.dumps(gift), str(price), now, now + minutes * 60, rid))
            record('auction_created', {'auction_id': auction_id, 'gift': gift, 'price': str(price),
                                       'minutes': minutes})
            row = db().execute('SELECT * FROM crafter_auctions WHERE id=?', (auction_id,)).fetchone()
        return {'auction': public(row, uid)}

    @app.post('/api/auctions/<auction_id>/bid')
    @auth()
    def auction_bid(auction_id):
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        rid = clean_request_id(data)
        amount = listing_price(data.get('amount'))
        uid = g.user['id']
        settle_due()
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute('SELECT auction_id,amount FROM crafter_auction_bids WHERE user_id=? AND request_id=?',
                                (uid, rid)).fetchone()
            if done:
                if done['auction_id'] != auction_id or Decimal(done['amount']) != amount:
                    abort(409, description='Этот запрос уже использован')
                return {'auction': public(lock_auction(auction_id), uid), 'balance': str(balance(uid))}
            row = lock_auction(auction_id)
            now = int(time.time())
            if row['status'] != 'active' or row['ends_at'] <= now:
                abort(409, description='Аукцион уже завершён')
            if row['seller_id'] == uid:
                abort(409, description='Нельзя делать ставки на свой аукцион')
            if row['bidder_id'] == uid:
                abort(409, description='Ваша ставка уже лидирует')
            if db().execute('SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?', (uid, row['gift_id'])).fetchone():
                abort(409, description='Этот подарок уже есть в вашем инвентаре')
            needed = min_next_bid(row['start_price'], row['current_bid'])
            if amount < needed:
                abort(409, description='Минимальная ставка сейчас %s GRAM' % needed)
            after = balance(uid) - amount
            if after < 0:
                abort(409, description='Недостаточно GRAM на балансе')
            outbid = None
            if row['bidder_id']:                 # the previous leader gets the bid back at once
                outbid = (row['bidder_id'], json.loads(row['gift_json']))
                restore(row['bidder_id'], Decimal(row['current_bid']), json.loads(row['backing']))
                record('auction_outbid', {'auction_id': row['id'], 'gift': json.loads(row['gift_json']),
                                          'amount': row['current_bid']}, uid=row['bidder_id'])
            backing = cap_funded_balance(db(), uid, balance(uid) - amount)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(balance(uid) - amount), uid))
            ends = row['ends_at']
            extensions = row['extensions']
            if ends - now <= EXTEND_WINDOW and extensions < MAX_EXTENSIONS:
                ends, extensions = ends + EXTEND_BY, extensions + 1
            db().execute("""UPDATE crafter_auctions SET current_bid=?,bidder_id=?,backing=?,bid_count=bid_count+1,
                ends_at=?,extensions=? WHERE id=?""",
                         (str(amount), uid, json.dumps(backing), ends, extensions, auction_id))
            db().execute('INSERT INTO crafter_auction_bids VALUES(?,?,?,?,?,?)',
                         (uuid.uuid4().hex, auction_id, uid, str(amount), now, rid))
            record('auction_bid', {'auction_id': auction_id, 'gift': json.loads(row['gift_json']),
                                   'amount': str(amount)})
            fresh = db().execute('SELECT * FROM crafter_auctions WHERE id=?', (auction_id,)).fetchone()
        if notify_auction:
            if outbid:
                notify_auction('outbid', outbid[0], outbid[1], str(amount))
            notify_auction('bid', row['seller_id'], json.loads(row['gift_json']), str(amount))
        return {'auction': public(fresh, uid, bids=True), 'balance': str(balance(uid))}

    @app.post('/api/auctions/<auction_id>/cancel')
    @auth()
    def auction_cancel(auction_id):
        uid = g.user['id']
        settle_due()
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = lock_auction(auction_id)
            if row['seller_id'] != uid:
                abort(403)
            if row['status'] != 'active':
                abort(409, description='Аукцион уже завершён')
            if row['bid_count']:
                abort(409, description='Нельзя снять аукцион, на который уже сделали ставку')
            db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='auction'",
                         (uid, row['gift_id']))
            db().execute("UPDATE crafter_auctions SET status='cancelled',closed_at=? WHERE id=?",
                         (int(time.time()), auction_id))
            record('auction_cancelled', {'auction_id': auction_id, 'gift': json.loads(row['gift_json'])})
        return {'ok': True}

    if not app.config.get('TESTING'):
        def worker():
            while True:
                time.sleep(20)
                try:
                    with app.app_context():
                        settle_due()
                except Exception:
                    app.logger.exception('auction settlement failed')
        threading.Thread(target=worker, name='auction-settle', daemon=True).start()
    return settle_due
