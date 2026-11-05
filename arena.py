"""One shared Arena room with transactional GRAM and gift escrow."""
import json
import re
import secrets
import threading
import time
import uuid
from decimal import Decimal, ROUND_DOWN

from flask import abort, g, request

from resale import cap_funded_balance
from staking import decimal_amount

UNIT = Decimal('0.000001')
BET_MS = 15_000
AIM_MS = 3_000
FLIGHT_MS = 4_000
FINISH_MS = 4_000
PLAY_MS = AIM_MS + FLIGHT_MS + FINISH_MS
RESULT_MS = 8_000
WAIT_MS = 300_000
MAX_PLAYERS = 32
MAX_GIFTS = 20
MAX_REQUESTS = 80
MAX_AMOUNT = Decimal('1000000')
FEE_BPS = 800
BOT_UID = -1
BOT_JOIN_MS = 4_000
BOT_INTERVAL_MS = 2_000
BOT_CUTOFF_MS = 2_000
BOT_MAX_STAKES = 4
BOT_DEFAULTS = {'enabled': True, 'limit': '200'}
BOT_INITIAL_BANK = Decimal('200')


def clock():
    return time.time_ns() // 1_000_000


def units(amount):
    return int(amount / UNIT)


def gram(amount):
    return format(Decimal(amount) * UNIT, 'f')


def install_arena(app, db, auth, record, catalog, canonical_name, demo_prices):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS arena_rounds (
                id INTEGER PRIMARY KEY, created INTEGER NOT NULL, wait_until INTEGER,
                bet_until INTEGER, seed INTEGER NOT NULL, winner_id INTEGER, finished_at INTEGER,
                result TEXT
            );
            CREATE INDEX IF NOT EXISTS arena_best_result
                ON arena_rounds(id DESC) WHERE result IS NOT NULL;
            CREATE TABLE IF NOT EXISTS arena_stakes (
                round_id INTEGER NOT NULL, user_id INTEGER NOT NULL, request_id TEXT NOT NULL,
                position INTEGER NOT NULL, intent TEXT NOT NULL, gram INTEGER NOT NULL,
                gifts TEXT NOT NULL, backing TEXT NOT NULL,
                PRIMARY KEY (round_id, user_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS arena_stake_order ON arena_stakes(round_id, position);
            CREATE TABLE IF NOT EXISTS arena_round_terms (
                round_id INTEGER PRIMARY KEY, fee_bps INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS arena_fees (
                round_id INTEGER PRIMARY KEY, gram TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS arena_bot_funding (
                admin_id INTEGER NOT NULL, request_id TEXT NOT NULL, intent TEXT NOT NULL,
                PRIMARY KEY (admin_id, request_id)
            );
        """)
        connection = db()
        connection.execute('BEGIN IMMEDIATE')
        connection.execute("INSERT INTO demo_accounts VALUES(?, '0') ON CONFLICT DO NOTHING", (BOT_UID,))
        grant = connection.execute(
            'INSERT INTO arena_bot_funding VALUES(?,?,?) ON CONFLICT DO NOTHING',
            (BOT_UID, 'starter-bank-v1', json.dumps({'amount': str(BOT_INITIAL_BANK)})),
        )
        if grant.rowcount:
            before = Decimal(connection.execute('SELECT balance FROM demo_accounts WHERE user_id=?',
                                                (BOT_UID,)).fetchone()[0])
            connection.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                               (str(before + BOT_INITIAL_BANK), BOT_UID))
            record('arena_bot_grant', {'gram': str(BOT_INITIAL_BANK), 'source': 'starter-bank'}, uid=BOT_UID)

    def latest_round():
        return db().execute('SELECT * FROM arena_rounds ORDER BY id DESC LIMIT 1').fetchone()

    def new_round(round_id, now):
        db().execute('INSERT INTO arena_rounds(id,created,seed) VALUES(?,?,?)',
                     (round_id, now, secrets.randbits(32)))
        return latest_round()

    def balance(uid):
        return Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()[0])

    def set_balance(uid, amount):
        db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(amount), uid))

    def stakes(round_id):
        rows = db().execute('SELECT * FROM arena_stakes WHERE round_id=? ORDER BY position', (round_id,))
        return [{**dict(row), 'gifts': json.loads(row['gifts']), 'backing': json.loads(row['backing'])}
                for row in rows]

    def totals(entries):
        players = {}
        for entry in entries:
            player = players.setdefault(entry['user_id'], {'gram': 0, 'gifts': []})
            player['gram'] += entry['gram']
            player['gifts'].extend(entry['gifts'])
        for player in players.values():
            player['value'] = player['gram'] + sum(gift['value'] for gift in player['gifts'])
        return players

    def players_public(players):
        if not players:
            return []
        placeholders = ','.join('?' for _ in players)
        profiles = {row['id']: row for row in db().execute(f"""
            SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id
            WHERE u.id IN ({placeholders})
        """, list(players))}
        profiles[BOT_UID] = {'name': 'Crafter', 'photo_url': '/static/assets/arena-crafter-bot.jpg'}
        total = sum(player['value'] for player in players.values())
        return [
            {'id': str(uid), 'name': profiles[uid]['name'] or 'Игрок',
             'photo': profiles[uid]['photo_url'], 'is_bot': uid == BOT_UID, 'gram': gram(player['gram']),
             'value': gram(player['value']), 'chance': round(100 * player['value'] / total, 4),
             'gifts': player['gifts']}
            for uid, player in players.items()
        ]

    def release_gift(uid, gift_id, recipient):
        connection = db()
        if uid != recipient and app.config['DEMO_MODE'] and gift_id in demo_prices and connection.execute(
                'SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?', (recipient, gift_id)).fetchone():
            # Demo accounts start with copies of the same sample gifts.
            row = connection.execute("SELECT payload FROM inventory WHERE user_id=? AND nft_id=? AND status='arena'",
                                     (uid, gift_id)).fetchone()
            gift = json.loads(row['payload'])
            gift['id'] = 'demo-arena-' + uuid.uuid4().hex
            connection.execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?', (uid, gift_id))
            connection.execute("INSERT INTO inventory VALUES(?,?,?,'unlisted')",
                               (recipient, gift['id'], json.dumps(gift)))
        elif connection.execute("""UPDATE inventory SET user_id=?,status='unlisted'
                WHERE user_id=? AND nft_id=? AND status='arena'""", (recipient, uid, gift_id)).rowcount != 1:
            raise RuntimeError('Arena gift escrow is missing')

    def restore_backing(uid, entries):
        amounts = {}
        for entry in entries:
            for network, amount in entry['backing'].items():
                amounts[network] = amounts.get(network, Decimal(0)) + Decimal(amount)
        for network, amount in amounts.items():
            row = db().execute('SELECT gram FROM wallet_balances WHERE user_id=? AND network=?',
                               (uid, network)).fetchone()
            previous = Decimal(row['gram']) if row else Decimal(0)
            db().execute("""INSERT INTO wallet_balances VALUES(?,?,?) ON CONFLICT(user_id,network)
                DO UPDATE SET gram=excluded.gram""", (uid, network, str(previous + amount)))

    def refund(round_row, entries, now):
        for uid, player in totals(entries).items():
            set_balance(uid, balance(uid) + Decimal(gram(player['gram'])))
            restore_backing(uid, [entry for entry in entries if entry['user_id'] == uid])
            for gift in player['gifts']:
                release_gift(uid, gift['id'], uid)
            record('arena_refund', {'round_id': round_row['id'], 'gram': gram(player['gram']),
                                    'gifts': player['gifts']}, uid=uid)
        db().execute('UPDATE arena_rounds SET finished_at=? WHERE id=?', (now, round_row['id']))
        return new_round(round_row['id'] + 1, now)

    def award(round_row, now):
        entries = stakes(round_row['id'])
        players = totals(entries)
        winner = round_row['winner_id']
        bank = sum(player['gram'] for player in players.values())
        bank_value = sum(player['value'] for player in players.values())
        fee = (bank - players[winner]['gram']) * round_fee(round_row['id']) // 10_000
        if fee:
            db().execute('INSERT INTO arena_fees VALUES(?,?)', (round_row['id'], gram(fee)))
        payout = bank - fee
        gifts = []
        for uid, player in players.items():
            for gift in player['gifts']:
                release_gift(uid, gift['id'], winner)
                gifts.append(gift)
        set_balance(winner, balance(winner) + Decimal(gram(payout)))
        restore_backing(winner, [entry for entry in entries if entry['user_id'] == winner])
        for uid in players:
            record('arena_result', {
                'round_id': round_row['id'], 'success': uid == winner,
                'prize_value': gram(bank_value - fee) if uid == winner else None,
                'gram': gram(payout if uid == winner else 0),
                'fee_gram': gram(fee if uid == winner else 0),
                'gifts': gifts if uid == winner else [],
            }, uid=uid)
        public = players_public(players)
        result = {'round_id': round_row['id'], 'winner': next(p for p in public if p['id'] == str(winner)),
                  'gram': gram(payout), 'value': gram(bank_value - fee), 'fee_gram': gram(fee), 'gifts': gifts}
        db().execute('UPDATE arena_rounds SET finished_at=?,result=? WHERE id=?',
                     (now, json.dumps(result), round_row['id']))
        return latest_round()

    def advance(now):
        round_row = latest_round()
        if not round_row:
            return new_round(1, now)
        end = round_row['bet_until']
        if round_row['finished_at'] is not None:
            if now >= round_row['finished_at'] + RESULT_MS:
                return new_round(round_row['id'] + 1, now)
        elif end is not None and now >= end:
            if round_row['winner_id'] is None:
                players = totals(stakes(round_row['id']))
                draw = secrets.randbelow(sum(player['value'] for player in players.values()))
                for uid, player in players.items():
                    draw -= player['value']
                    if draw < 0:
                        db().execute('UPDATE arena_rounds SET winner_id=? WHERE id=?', (uid, round_row['id']))
                        round_row = latest_round()
                        break
            if now >= end + PLAY_MS:
                return award(round_row, now)
        elif end is None and round_row['wait_until'] is not None and now >= round_row['wait_until']:
            return refund(round_row, stakes(round_row['id']), now)
        return bot_tick(round_row, now)

    def round_fee(round_id):
        row = db().execute('SELECT fee_bps FROM arena_round_terms WHERE round_id=?', (round_id,)).fetchone()
        return row['fee_bps'] if row else 0

    def record_cutoffs():
        row=db().execute("SELECT payload FROM settings WHERE key='arena_record_cutoffs_v1'").fetchone()
        try:
            value=json.loads(row['payload']) if row else {}
            return {'best':int(value.get('best',0)), 'last':int(value.get('last',0))}
        except (ValueError, TypeError, KeyError, OverflowError):
            return {'best':0,'last':0}

    def winter_enabled():
        row=db().execute("SELECT payload FROM settings WHERE key='arena_winter_theme_v1'").fetchone()
        return row is not None and row['payload']=='true'

    def snapshot(round_row, now, uid):
        players = totals(stakes(round_row['id']))
        end = round_row['bet_until']
        finished = round_row['finished_at']
        phase = ('result' if finished is not None else
                 'playing' if end is not None and now >= end else
                 'betting' if end is not None else 'waiting')
        cutoffs=record_cutoffs()
        previous = db().execute("""SELECT result FROM arena_rounds
            WHERE result IS NOT NULL AND id>? ORDER BY id DESC LIMIT 1""",
            (cutoffs['last'],)).fetchone()
        # Keep best-result sorting compatible with both PostgreSQL and SQLite.
        value_sql = ("CAST((result::jsonb ->> 'value') AS NUMERIC)" if app.config.get('DATABASE_URL')
                     else "CAST(json_extract(result, '$.value') AS NUMERIC)")
        best = db().execute(f"""SELECT result FROM arena_rounds
            WHERE result IS NOT NULL AND id>?
            ORDER BY {value_sql} DESC, id DESC
            LIMIT 1""", (cutoffs['best'],)).fetchone()
        return {'round_id': round_row['id'], 'server_time': now, 'phase': phase, 'seed': round_row['seed'],
                'wait_until': round_row['wait_until'], 'bet_until': end,
                'aim_ms': AIM_MS, 'flight_ms': FLIGHT_MS, 'finish_ms': FINISH_MS,
                'target': str(round_row['winner_id']) if end is not None and now >= end + AIM_MS else None,
                'players': players_public(players), 'bank': gram(sum(p['value'] for p in players.values())),
                'last_result': json.loads(previous['result']) if previous else None,
                'best_result': json.loads(best['result']) if best else None,
                'fee_bps': round_fee(round_row['id']) if players else FEE_BPS,
                'bot_enabled': bot_settings()['enabled'],
                'balance': str(balance(uid)), 'viewer': str(uid), 'gift_limit': MAX_GIFTS,
                'can_cancel': phase == 'waiting' and uid in players}

    def floor_prices():
        prices = {}
        for item in catalog():
            price = decimal_amount(item.get('floor_price'))
            if price is not None and UNIT <= price <= MAX_AMOUNT:
                prices.setdefault(canonical_name(item.get('name') or ''), price)
        return prices

    def available_gifts(uid, floors, gift_ids=None):
        query = "SELECT nft_id,payload FROM inventory WHERE user_id=? AND status='unlisted'"
        params = [uid]
        if gift_ids is not None:
            query += ' AND nft_id IN (' + ','.join('?' for _ in gift_ids) + ')'
            params.extend(gift_ids)
        result = {}
        for row in db().execute(query, params):
            gift = json.loads(row['payload'])
            if gift.get('catalog_only'):
                continue
            price = (floors.get(canonical_name(gift.get('name') or '')) or
                     decimal_amount(demo_prices.get(row['nft_id'])))
            if price is None and gift.get('price_unit') == 'GRAM':
                price = decimal_amount(gift.get('price'))
            if price is None or not UNIT <= price <= MAX_AMOUNT:
                continue
            result[row['nft_id']] = {
                **{key: gift.get(key) for key in ('name', 'number', 'model', 'backdrop', 'background',
                                                  'symbol', 'image', 'telegram_url', 'telegram_slug',
                                                  'collection_id', 'source_number', 'source_id', 'origin')},
                'id': row['nft_id'], 'value': units(price),
            }
        return result

    def place_stake(round_id, uid, rid, intent, cash, gifts, entries, players, now):
        connection = db()
        for gift_id in gifts:
            connection.execute("UPDATE inventory SET status='arena' WHERE user_id=? AND nft_id=?", (uid, gift_id))
        backing = {}
        if cash:
            remaining = balance(uid) - Decimal(gram(cash))
            backing = cap_funded_balance(connection, uid, remaining)
            set_balance(uid, remaining)
        connection.execute('INSERT INTO arena_stakes VALUES(?,?,?,?,?,?,?,?)',
                           (round_id, uid, rid, len(entries), intent, cash,
                            json.dumps(list(gifts.values())), json.dumps(backing)))
        if not entries:
            connection.execute('INSERT INTO arena_round_terms VALUES(?,?)', (round_id, FEE_BPS))
            connection.execute('UPDATE arena_rounds SET wait_until=? WHERE id=?', (now + WAIT_MS, round_id))
        if len(players) == 1 and uid not in players:
            connection.execute('UPDATE arena_rounds SET bet_until=? WHERE id=?', (now + BET_MS, round_id))
        record('arena_stake', {'round_id': round_id, 'gram': gram(-cash),
                              'gifts': list(gifts.values())}, uid=uid)

    def bot_settings():
        row = db().execute("SELECT payload FROM settings WHERE key='arena_bot'").fetchone()
        return {**BOT_DEFAULTS, **(json.loads(row['payload']) if row else {})}

    def bot_target():
        roll = secrets.randbelow(100)
        if roll < 5:
            return 1000
        if roll >= 95:
            return 7000
        return 3000 + secrets.randbelow(1001)

    def bot_tick(round_row, now):
        end = round_row['bet_until']
        if (round_row['finished_at'] is not None or round_row['wait_until'] is None or
                (end is not None and now >= end - BOT_CUTOFF_MS)):
            return round_row
        settings = bot_settings()
        if not settings['enabled'] or not round_fee(round_row['id']):
            return round_row
        if now < round_row['wait_until'] - WAIT_MS + BOT_JOIN_MS:
            return round_row
        round_id = round_row['id']
        entries = stakes(round_id)
        players = totals(entries)
        bot = players.get(BOT_UID)
        if not bot and len(players) != 1:
            return round_row
        moves = [entry for entry in entries if entry['user_id'] == BOT_UID]
        if len(moves) >= BOT_MAX_STAKES:
            return round_row
        latest = json.loads(moves[-1]['intent']) if moves else None
        if latest and now < latest['at'] + BOT_INTERVAL_MS:
            return round_row
        target = latest['target'] if latest else bot_target()
        already = bot['value'] if bot else 0
        humans = sum(player['value'] for uid, player in players.items() if uid != BOT_UID)
        needed = min(humans * target // (10_000 - target), units(Decimal(settings['limit']))) - already
        if needed <= 0:
            return round_row

        cash = max(0, units(balance(BOT_UID)))
        gifts = {}
        slots = MAX_GIFTS - (len(bot['gifts']) if bot else 0)
        if slots and (cash < needed or secrets.randbelow(3) != 0):
            stock = available_gifts(BOT_UID, floor_prices())
            for gift in sorted(stock.values(), key=gift_order, reverse=True):
                if gift['value'] <= needed:
                    gifts[gift['id']] = gift
                    needed -= gift['value']
                    if len(gifts) >= slots or needed == 0:
                        break
        cash = min(needed, cash)
        if not (cash or gifts):
            return round_row
        intent = json.dumps({'target': target, 'at': now})
        place_stake(round_id, BOT_UID, 'bot-' + str(len(moves)), intent, cash, gifts, entries, players, now)
        return latest_round()

    @app.get('/api/arena')
    @auth()
    def arena_status():
        # Polling is read-only. The settlement sweep and stake endpoints own
        # transitions under the transaction lock; spectators must not
        # serialize every refresh against players placing bets.
        with db():
            now = clock()
            round_row = latest_round()
            # Tests use a synthetic clock and intentionally do not start the background
            # settlement thread; advance rounds deterministically during test polling.
            if app.config.get('TESTING') or round_row is None:
                db().execute('BEGIN IMMEDIATE')
                round_row = advance(now)
            return snapshot(round_row, now, g.user['id'])

    def gift_order(gift):
        return gift['value'], gift['id']

    @app.get('/api/arena/gifts')
    @auth()
    def arena_gifts():
        return {'gifts': sorted(available_gifts(g.user['id'], floor_prices()).values(), key=gift_order)}

    @app.post('/api/arena/stake')
    @auth()
    def arena_stake():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        round_id, rid = data.get('round_id'), data.get('request_id')
        ids, amount = data.get('gift_ids', []), data.get('amount', '0')
        quick_value = data.get('quick_value')
        if (type(round_id) is not int or not 0 < round_id < 2**63 or
                not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', rid) or
                not isinstance(ids, list) or len(ids) > MAX_GIFTS or
                any(not isinstance(item, str) or not 1 <= len(item) <= 200 for item in ids) or
                len(set(ids)) != len(ids) or not isinstance(amount, str) or
                (amount != 'all' and not re.fullmatch(r'[0-9]{1,7}(?:\.[0-9]{1,6})?', amount)) or
                (amount == 'all' and ids) or
                (quick_value is not None and
                 (type(quick_value) is not int or not 0 < quick_value <= units(MAX_AMOUNT) or
                  len(ids) != 1 or amount != '0'))):
            abort(400, description='Проверьте ставку')
        intent_fields = {'amount': amount, 'gift_ids': sorted(ids)}
        if quick_value is not None:
            intent_fields['quick_value'] = quick_value
        intent = json.dumps(intent_fields)
        uid = g.user['id']
        with db():
            connection = db()
            connection.execute('BEGIN IMMEDIATE')
            now = clock()
            round_row = advance(now)
            existing = connection.execute("""SELECT intent FROM arena_stakes
                WHERE round_id=? AND user_id=? AND request_id=?""", (round_id, uid, rid)).fetchone()
            if existing:
                if existing['intent'] != intent:
                    abort(409, description='Этот запрос уже использован')
                return snapshot(round_row, now, uid)
            end = round_row['bet_until']
            if round_row['id'] != round_id or (end is not None and now >= end):
                abort(409, description='Приём ставок на этот раунд завершён')
            entries = stakes(round_id)
            players = totals(entries)
            own = players.get(uid, {'gifts': []})
            if ((uid not in players and len(players) >= MAX_PLAYERS) or
                    sum(entry['user_id'] == uid for entry in entries) >= MAX_REQUESTS or
                    len(own['gifts']) + len(ids) > MAX_GIFTS):
                abort(409, description='Достигнут лимит ставок на раунд')
            before = balance(uid)
            cash = before.quantize(UNIT, rounding=ROUND_DOWN) if amount == 'all' else Decimal(amount)
            if cash < 0 or (not cash and not ids) or (amount != 'all' and cash > MAX_AMOUNT) or units(cash) >= 2**63:
                abort(400, description='Укажите сумму или выберите подарки')
            if cash > before:
                abort(409, description='Недостаточно GRAM на балансе')
            if quick_value is not None:
                cheapest = min(available_gifts(uid, floor_prices()).values(), key=gift_order, default=None)
                if not cheapest or (cheapest['id'], cheapest['value']) != (ids[0], quick_value):
                    abort(409, description='Самый дешёвый подарок изменился. Проверьте новую ставку.')
                gifts = {cheapest['id']: cheapest}
            else:
                gifts = available_gifts(uid, floor_prices(), ids) if ids else {}
            if len(gifts) != len(ids):
                abort(409, description='Один из подарков уже недоступен для ставки')
            place_stake(round_id, uid, rid, intent, units(cash), gifts, entries, players, now)
            return snapshot(latest_round(), now, uid)

    @app.post('/api/arena/cancel')
    @auth()
    def arena_cancel():
        data = request.get_json(silent=True)
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            now = clock()
            round_row = advance(now)
            if (not isinstance(data, dict) or type(data.get('round_id')) is not int or
                    data['round_id'] != round_row['id'] or round_row['bet_until'] is not None):
                abort(409, description='Раунд уже начался или завершился')
            entries = stakes(round_row['id'])
            if not entries or entries[0]['user_id'] != uid:
                abort(409, description='У вас нет ставки в этом раунде')
            return snapshot(refund(round_row, entries, now), now, uid)

    def bot_admin_status(uid):
        stock = available_gifts(uid, floor_prices())
        return {**bot_settings(), 'balance': str(balance(BOT_UID)), 'admin_balance': str(balance(uid)),
                'gift_count': db().execute("SELECT count(*) FROM inventory WHERE user_id=? AND status='unlisted'",
                                           (BOT_UID,)).fetchone()[0],
                'fees': str(sum((Decimal(row['gram']) for row in db().execute('SELECT gram FROM arena_fees')),
                                Decimal(0))),
                'gifts': sorted(stock.values(), key=gift_order)}

    @app.get('/api/admin/arena')
    @auth(admin=True)
    def arena_bot_admin():
        return bot_admin_status(g.user['id'])

    @app.post('/api/admin/arena')
    @auth(admin=True)
    def arena_bot_update():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        enabled, limit, amount = data.get('enabled'), decimal_amount(data.get('limit')), decimal_amount(data.get('amount'))
        ids, rid = data.get('gift_ids', []), data.get('request_id')
        if (type(enabled) is not bool or limit is None or not UNIT <= limit <= MAX_AMOUNT or Decimal(gram(units(limit))) != limit or
                amount is None or not 0 <= amount <= MAX_AMOUNT or Decimal(gram(units(amount))) != amount or
                not isinstance(ids, list) or len(ids) > MAX_GIFTS or
                any(not isinstance(item, str) or not 1 <= len(item) <= 200 for item in ids) or len(set(ids)) != len(ids) or
                not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', rid)):
            abort(400, description='Проверьте лимит, сумму и подарки')
        uid = g.user['id']
        settings = {'enabled': enabled, 'limit': str(limit)}
        intent = json.dumps({**settings, 'amount': str(amount), 'gift_ids': sorted(ids)})
        with db():
            connection = db()
            connection.execute('BEGIN IMMEDIATE')
            previous = connection.execute('SELECT intent FROM arena_bot_funding WHERE admin_id=? AND request_id=?',
                                          (uid, rid)).fetchone()
            if previous:
                if previous['intent'] != intent:
                    abort(409, description='Этот запрос уже использован')
                return bot_admin_status(uid)
            before = balance(uid)
            if amount > before:
                abort(409, description='Недостаточно GRAM на вашем балансе')
            gifts = available_gifts(uid, floor_prices(), ids) if ids else {}
            if len(gifts) != len(ids):
                abort(409, description='Один из подарков недоступен')
            for gift_id in ids:
                connection.execute("UPDATE inventory SET user_id=? WHERE user_id=? AND nft_id=?",
                                   (BOT_UID, uid, gift_id))
            if amount:
                cap_funded_balance(connection, uid, before - amount)
                set_balance(uid, before - amount)
                set_balance(BOT_UID, balance(BOT_UID) + amount)
            if amount or gifts:
                record('arena_bot_fund', {'gram': str(-amount), 'gifts': list(gifts.values())}, uid=uid)
            connection.execute("INSERT INTO settings VALUES('arena_bot', ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                               (json.dumps(settings),))
            connection.execute('INSERT INTO arena_bot_funding VALUES(?,?,?)', (uid, rid, intent))
            return bot_admin_status(uid)

    @app.get('/api/arena/theme')
    def arena_theme_public():
        response=app.json.response({'winter':winter_enabled()})
        response.headers['Cache-Control']='no-store'
        return response

    @app.post('/api/admin/arena/theme')
    @auth(admin=True)
    def arena_theme_admin():
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or type(data.get('winter')) is not bool:
            abort(400,description='Укажите состояние новогодней темы')
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute("""INSERT INTO settings VALUES('arena_winter_theme_v1',?)
                ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
                         ('true' if data['winter'] else 'false',))
        return {'winter':data['winter']}

    @app.post('/api/admin/arena/records/reset')
    @auth(admin=True)
    def arena_reset_record():
        data=request.get_json(silent=True)
        kind=data.get('kind') if isinstance(data,dict) else None
        if kind not in ('best','last'):
            abort(400,description='Выберите топ игру или последнюю игру')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cutoffs=record_cutoffs()
            latest=db().execute('SELECT max(id) FROM arena_rounds').fetchone()[0] or 0
            cutoffs[kind]=latest
            db().execute("""INSERT INTO settings VALUES('arena_record_cutoffs_v1',?)
                ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
                         (json.dumps(cutoffs),))
        return {'ok':True,'kind':kind,'cutoffs':cutoffs}

    def sweep():
        while True:
            try:
                with app.app_context():
                    row = latest_round()
                    now = clock()
                    if not row:
                        due = None
                    elif row['finished_at'] is not None:
                        due = row['finished_at'] + RESULT_MS
                    elif row['bet_until'] is None:
                        due = row['wait_until']
                    else:
                        due = row['bet_until'] + (PLAY_MS if row['winner_id'] is not None else 0)
                    bot_due = row and row['finished_at'] is None and row['wait_until'] is not None and (
                        row['bet_until'] is None or now < row['bet_until'] - BOT_CUTOFF_MS
                    ) and bot_settings()['enabled']
                    if (due is not None and now >= due) or bot_due:
                        with db():
                            db().execute('BEGIN IMMEDIATE')
                            advance(clock())
            except Exception:
                app.logger.exception('Arena settlement failed')
            time.sleep(1)

    # Separate invite-only rooms share escrow and valuation helpers, but never
    # reuse public round IDs or allow the public Crafter bot into private games.
    from arena_private import install_private_arena
    install_private_arena(app, db, auth, record, {
        'clock': clock, 'units': units, 'gram': gram,
        'balance': balance, 'set_balance': set_balance,
        'totals': totals, 'players_public': players_public,
        'release_gift': release_gift, 'restore_backing': restore_backing,
        'available_gifts': available_gifts, 'floor_prices': floor_prices,
    })

    if not app.config.get('TESTING'):
        threading.Thread(target=sweep, daemon=True, name='arena-settlement').start()
