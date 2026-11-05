"""Invite-only Arena rooms. Independent rounds and escrow, no public listing."""
import json
import re
import secrets
import threading
import time
from decimal import Decimal, InvalidOperation, ROUND_DOWN

from flask import abort, g, request

from resale import cap_funded_balance

RESULT_MS = 8_000
PLAY_MS = 11_000
WAIT_MS = 300_000
AIM_MS = 3_000
FLIGHT_MS = 4_000
FINISH_MS = 4_000
FEE_BPS = 800
MAX_GIFTS = 20
MAX_REQUESTS = 80
MAX_AMOUNT = Decimal('1000000')
UNIT = Decimal('0.000001')
TOKEN_RE = re.compile(r'[A-Za-z0-9_-]{24}\Z')
REQUEST_RE = re.compile(r'[A-Za-z0-9_-]{1,100}\Z')
AMOUNT_RE = re.compile(r'[0-9]{1,7}(?:\.[0-9]{1,6})?\Z')


def install_private_arena(app, db, auth, record, tools):
    clock = tools['clock']
    units = tools['units']
    gram = tools['gram']
    balance = tools['balance']
    set_balance = tools['set_balance']
    totals = tools['totals']
    players_public = tools['players_public']
    release_gift = tools['release_gift']
    restore_backing = tools['restore_backing']
    available_gifts = tools['available_gifts']
    floor_prices = tools['floor_prices']

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS arena_private_rooms (
                token TEXT PRIMARY KEY, owner_id INTEGER NOT NULL,
                name TEXT NOT NULL, bet_seconds INTEGER NOT NULL,
                player_limit INTEGER NOT NULL, min_value INTEGER NOT NULL,
                max_value INTEGER NOT NULL, current_round INTEGER NOT NULL,
                created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS arena_private_members (
                token TEXT NOT NULL, user_id INTEGER NOT NULL, joined INTEGER NOT NULL,
                PRIMARY KEY (token, user_id)
            );
            CREATE INDEX IF NOT EXISTS arena_private_member_user ON arena_private_members(user_id);
            CREATE TABLE IF NOT EXISTS arena_private_rounds (
                token TEXT NOT NULL, round_no INTEGER NOT NULL, created INTEGER NOT NULL,
                wait_until INTEGER, bet_until INTEGER, seed INTEGER NOT NULL,
                winner_id INTEGER, finished_at INTEGER, result TEXT,
                PRIMARY KEY (token, round_no)
            );
            CREATE TABLE IF NOT EXISTS arena_private_stakes (
                token TEXT NOT NULL, round_no INTEGER NOT NULL,
                user_id INTEGER NOT NULL, request_id TEXT NOT NULL,
                position INTEGER NOT NULL, intent TEXT NOT NULL,
                gram INTEGER NOT NULL, gifts TEXT NOT NULL, backing TEXT NOT NULL,
                PRIMARY KEY (token, round_no, user_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS arena_private_stake_order
                ON arena_private_stakes(token, round_no, position);
        """)

    def valid_token(token):
        if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
            abort(404, description='Комната не найдена')
        return token

    def room_for(token, member=False):
        token = valid_token(token)
        room = db().execute('SELECT * FROM arena_private_rooms WHERE token=?', (token,)).fetchone()
        if not room:
            abort(404, description='Комната не найдена')
        if member and not db().execute(
                'SELECT 1 FROM arena_private_members WHERE token=? AND user_id=?',
                (token, g.user['id'])).fetchone():
            abort(403, description='Войдите в комнату по ссылке-приглашению')
        return room

    def public_room(room, joined=False):
        token = room['token']
        members = db().execute(
            'SELECT count(*) FROM arena_private_members WHERE token=?', (token,)).fetchone()[0]
        return {'token': token, 'name': room['name'], 'owner': str(room['owner_id']),
                'is_owner': g.user['id'] == room['owner_id'],
                'joined': joined, 'members': members,
                'bet_seconds': room['bet_seconds'], 'max_players': room['player_limit'],
                'created_at': room['created'], 'round_no': room['current_round'],
                'min_bet': gram(room['min_value']), 'max_bet': gram(room['max_value'])}

    def round_for(room):
        return db().execute(
            'SELECT * FROM arena_private_rounds WHERE token=? AND round_no=?',
            (room['token'], room['current_round'])).fetchone()

    def round_entries(token, number):
        return [{**dict(row), 'gifts': json.loads(row['gifts']),
                 'backing': json.loads(row['backing'])}
                for row in db().execute(
                    'SELECT * FROM arena_private_stakes WHERE token=? AND round_no=? ORDER BY position',
                    (token, number))]

    def new_round(room, number, now):
        db().execute('UPDATE arena_private_rooms SET current_round=? WHERE token=?',
                     (number, room['token']))
        db().execute(
            'INSERT INTO arena_private_rounds(token,round_no,created,seed) VALUES(?,?,?,?)',
            (room['token'], number, now, secrets.randbits(32)))
        return db().execute(
            'SELECT * FROM arena_private_rounds WHERE token=? AND round_no=?',
            (room['token'], number)).fetchone()

    def refund(room, round_row, entries, now):
        players = totals(entries)
        for uid, player in players.items():
            set_balance(uid, balance(uid) + Decimal(gram(player['gram'])))
            restore_backing(uid, [entry for entry in entries if entry['user_id'] == uid])
            for gift in player['gifts']:
                release_gift(uid, gift['id'], uid)
            record('arena_refund', {'round_id': round_row['round_no'],
                                   'private_room': room['token'],
                                   'gram': gram(player['gram']), 'gifts': player['gifts']}, uid=uid)
        db().execute(
            'UPDATE arena_private_rounds SET finished_at=? WHERE token=? AND round_no=?',
            (now, room['token'], round_row['round_no']))
        return new_round(room, round_row['round_no'] + 1, now)

    def award(room, round_row, now):
        token, number = room['token'], round_row['round_no']
        entries = round_entries(token, number)
        players = totals(entries)
        winner = round_row['winner_id']
        if winner not in players:
            raise RuntimeError('Private Arena has no eligible winner')
        bank = sum(player['gram'] for player in players.values())
        total_value = sum(player['value'] for player in players.values())
        fee = (bank - players[winner]['gram']) * FEE_BPS // 10000
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
                'round_id': number, 'private_room': token,
                'success': uid == winner,
                'prize_value': gram(total_value - fee) if uid == winner else None,
                'gram': gram(payout if uid == winner else 0),
                'fee_gram': gram(fee if uid == winner else 0),
                'gifts': gifts if uid == winner else [],
            }, uid=uid)
        public = players_public(players)
        result = {
            'round_id': number,
            'winner': next(p for p in public if p['id'] == str(winner)),
            'gram': gram(payout), 'value': gram(total_value - fee),
            'fee_gram': gram(fee), 'gifts': gifts,
        }
        db().execute(
            'UPDATE arena_private_rounds SET finished_at=?, result=? '
            'WHERE token=? AND round_no=?',
            (now, json.dumps(result), token, number))
        return round_for(room)

    def advance(room, now):
        current = round_for(room)
        if not current:
            return new_round(room, room['current_round'], now)
        token, number = room['token'], current['round_no']
        end, finished = current['bet_until'], current['finished_at']
        if finished is not None:
            if now >= finished + RESULT_MS:
                return new_round(room, number + 1, now)
            return current
        if end is not None and now >= end:
            if current['winner_id'] is None:
                players = totals(round_entries(token, number))
                total = sum(p['value'] for p in players.values())
                if total <= 0 or len(players) < 2:
                    return refund(room, current, round_entries(token, number), now)
                draw = secrets.randbelow(total)
                for uid, player in players.items():
                    draw -= player['value']
                    if draw < 0:
                        db().execute(
                            'UPDATE arena_private_rounds SET winner_id=? '
                            'WHERE token=? AND round_no=?',
                            (uid, token, number))
                        break
                current = round_for(room)
            if now >= end + PLAY_MS:
                return award(room, current, now)
        elif end is None and current['wait_until'] is not None and now >= current['wait_until']:
            return refund(room, current, round_entries(token, number), now)
        return current

    def latest_results(token):
        latest = db().execute(
            'SELECT result FROM arena_private_rounds WHERE token=? AND result IS NOT NULL '
            'ORDER BY round_no DESC LIMIT 1', (token,)).fetchone()
        # Only this room's history is considered, never the public Arena.
        all_best = db().execute(
            'SELECT result FROM arena_private_rounds WHERE token=? AND result IS NOT NULL '
            'ORDER BY round_no DESC LIMIT 200', (token,)).fetchall()
        last_result = json.loads(latest['result']) if latest else None
        best_result = max(
            (json.loads(row['result']) for row in all_best),
            key=lambda item: Decimal(item['value']),
            default=None)
        return last_result, best_result

    def snapshot(room, now, uid):
        round_row = round_for(room)
        if not round_row:
            abort(503, description='Раунд создаётся')
        number, token = round_row['round_no'], room['token']
        players = totals(round_entries(token, number))
        end, finished = round_row['bet_until'], round_row['finished_at']
        phase = ('result' if finished is not None else
                 'playing' if end is not None and now >= end else
                 'betting' if end is not None else 'waiting')
        last_result, best_result = latest_results(token)
        return {
            'round_id': number, 'server_time': now, 'phase': phase,
            'seed': round_row['seed'], 'wait_until': round_row['wait_until'],
            'bet_until': end, 'aim_ms': AIM_MS, 'flight_ms': FLIGHT_MS,
            'finish_ms': FINISH_MS,
            'target': str(round_row['winner_id']) if
                end is not None and now >= end + AIM_MS and round_row['winner_id'] is not None
                else None,
            'players': players_public(players),
            'bank': gram(sum(p['value'] for p in players.values())),
            'last_result': last_result, 'best_result': best_result,
            'fee_bps': FEE_BPS, 'bot_enabled': False,
            'balance': str(balance(uid)), 'viewer': str(uid), 'gift_limit': MAX_GIFTS,
            'can_cancel': phase == 'waiting' and uid in players,
            'private_room': public_room(room, joined=True),
        }

    def parse_amount(value):
        if not isinstance(value, str) or not AMOUNT_RE.fullmatch(value):
            abort(400, description='Некорректная сумма GRAM')
        try:
            amount = Decimal(value)
        except InvalidOperation:
            abort(400, description='Некорректная сумма GRAM')
        if not UNIT <= amount <= MAX_AMOUNT:
            abort(400, description='Сумма выходит за лимит')
        return units(amount)

    def telegram_invite(token):
        username = (app.config.get('BOT_USERNAME') or '').strip().lstrip('@')
        if not re.fullmatch(r'[A-Za-z0-9_]{5,32}', username):
            return None
        return 'https://t.me/' + username + '?startapp=arena_' + token

    @app.get('/api/arena/private')
    @auth()
    def private_rooms():
        rows = db().execute(
            'SELECT r.* FROM arena_private_rooms r '
            'JOIN arena_private_members m ON r.token=m.token '
            'WHERE m.user_id=? ORDER BY r.created DESC LIMIT 30',
            (g.user['id'],)).fetchall()
        return {'rooms': [public_room(row, joined=True) for row in rows]}

    def validate_room_settings(data):
        if not isinstance(data, dict):
            abort(400, description='Укажите параметры комнаты')
        name = data.get('name', '')
        seconds, player_limit = data.get('bet_seconds'), data.get('max_players')
        if (not isinstance(name, str) or not 2 <= len(name.strip()) <= 48 or
                any(ord(c) < 32 or ord(c) == 127 for c in name)):
            abort(400, description='Название группы должно содержать 2–48 символов')
        if (type(seconds) is not int or not 10 <= seconds <= 300 or
                type(player_limit) is not int or not 2 <= player_limit <= 32):
            abort(400, description='Неверный таймер или максимальное число игроков')
        minimum = parse_amount(data.get('min_bet'))
        maximum = parse_amount(data.get('max_bet'))
        if maximum < minimum:
            abort(400, description='Максимальная ставка меньше минимальной')
        return name.strip(), seconds, player_limit, minimum, maximum

    @app.post('/api/arena/private')
    @auth()
    def create_private_room():
        name, seconds, player_limit, minimum, maximum = validate_room_settings(
            request.get_json(silent=True))
        with db():
            db().execute('BEGIN IMMEDIATE')
            existing = db().execute(
                'SELECT count(*) FROM arena_private_rooms WHERE owner_id=?',
                (g.user['id'],)).fetchone()[0]
            if existing >= 20:
                abort(409, description='Можно создать не больше 20 групп')
            token = secrets.token_urlsafe(18)
            now = clock()
            db().execute(
                'INSERT INTO arena_private_rooms VALUES(?,?,?,?,?,?,?,?,?)',
                (token, g.user['id'], name.strip(), seconds, player_limit,
                 minimum, maximum, 1, now))
            db().execute(
                'INSERT INTO arena_private_members VALUES(?,?,?)',
                (token, g.user['id'], now))
            db().execute(
                'INSERT INTO arena_private_rounds(token,round_no,created,seed) '
                'VALUES(?,?,?,?)', (token, 1, now, secrets.randbits(32)))
            room = room_for(token, member=True)
            result = public_room(room, joined=True)
            result['telegram_link'] = telegram_invite(token)
            result['web_link'] = request.url_root.rstrip('/') + '/?arena_room=' + token
            return result

    @app.post('/api/arena/private/<token>/settings')
    @auth()
    def update_private_room_settings(token):
        name, seconds, player_limit, minimum, maximum = validate_room_settings(
            request.get_json(silent=True))
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token, member=True)
            if room['owner_id'] != g.user['id']:
                abort(403, description='Менять настройки может только владелец группы')
            members = db().execute(
                'SELECT count(*) FROM arena_private_members WHERE token=?',
                (token,)).fetchone()[0]
            if player_limit < members:
                abort(409, description='Нельзя установить лимит ниже числа участников')
            terms_changed = (seconds != room['bet_seconds'] or
                             player_limit != room['player_limit'] or
                             minimum != room['min_value'] or maximum != room['max_value'])
            if terms_changed:
                current = round_for(room)
                if current and current['finished_at'] is None:
                    pending_stakes = db().execute(
                        'SELECT 1 FROM arena_private_stakes '
                        'WHERE token=? AND round_no=? LIMIT 1',
                        (token, room['current_round'])).fetchone()
                    if pending_stakes:
                        abort(409, description='Дождитесь окончания текущего раунда, чтобы поменять условия ставок')
            db().execute(
                'UPDATE arena_private_rooms SET name=?, bet_seconds=?, player_limit=?, '
                'min_value=?, max_value=? WHERE token=? AND owner_id=?',
                (name, seconds, player_limit, minimum, maximum, token, g.user['id']))
            updated = room_for(token, member=True)
            return public_room(updated, joined=True)

    @app.get('/api/arena/private/<token>/invite')
    @auth()
    def private_invite(token):
        room = room_for(token)
        joined = db().execute(
            'SELECT 1 FROM arena_private_members WHERE token=? AND user_id=?',
            (token, g.user['id'])).fetchone() is not None
        result = public_room(room, joined=joined)
        owner = db().execute('SELECT name,username FROM users WHERE id=?',
                             (room['owner_id'],)).fetchone()
        result['owner_name'] = ((owner['name'] or owner['username']) if owner else None) or 'Владелец'
        result['telegram_link'] = telegram_invite(token)
        result['web_link'] = request.url_root.rstrip('/') + '/?arena_room=' + token
        return result

    @app.post('/api/arena/private/<token>/join')
    @auth()
    def private_join(token):
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token)
            joined = db().execute(
                'SELECT 1 FROM arena_private_members WHERE token=? AND user_id=?',
                (token, g.user['id'])).fetchone()
            if not joined:
                members = db().execute(
                    'SELECT count(*) FROM arena_private_members WHERE token=?',
                    (token,)).fetchone()[0]
                if members >= room['player_limit']:
                    abort(409, description='В комнате больше нет свободных мест')
                db().execute('INSERT INTO arena_private_members VALUES(?,?,?)',
                             (token, g.user['id'], clock()))
            return public_room(room, joined=True)

    @app.get('/api/arena/private/<token>')
    @auth()
    def private_status(token):
        with db():
            room = room_for(token, member=True)
            return snapshot(room, clock(), g.user['id'])

    @app.post('/api/arena/private/<token>/stake')
    @auth()
    def private_stake(token):
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        number, rid = data.get('round_id'), data.get('request_id')
        ids, amount = data.get('gift_ids', []), data.get('amount', '0')
        quick_value = data.get('quick_value')
        if (type(number) is not int or number < 1 or number >= 2**63 or
                not isinstance(rid, str) or not REQUEST_RE.fullmatch(rid) or
                not isinstance(ids, list) or len(ids) > MAX_GIFTS or
                any(not isinstance(item, str) or not 1 <= len(item) <= 200 for item in ids) or
                len(set(ids)) != len(ids) or not isinstance(amount, str) or
                (amount != 'all' and not AMOUNT_RE.fullmatch(amount)) or
                (amount == 'all' and ids) or
                (quick_value is not None and
                 (type(quick_value) is not int or quick_value <= 0 or
                  len(ids) != 1 or amount != '0'))):
            abort(400, description='Проверьте ставку')
        intent_data = {'amount': amount, 'gift_ids': sorted(ids)}
        if quick_value is not None:
            intent_data['quick_value'] = quick_value
        intent = json.dumps(intent_data)
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token, member=True)
            now = clock()
            current = advance(room, now)
            previous = db().execute(
                'SELECT intent FROM arena_private_stakes '
                'WHERE token=? AND round_no=? AND user_id=? AND request_id=?',
                (token, number, uid, rid)).fetchone()
            if previous:
                if previous['intent'] != intent:
                    abort(409, description='Этот запрос уже использован')
                return snapshot(room_for(token), now, uid)
            if current['round_no'] != number or current['bet_until'] is not None and now >= current['bet_until']:
                abort(409, description='Ставки на этот раунд закрыты')
            entries = round_entries(token, number)
            players = totals(entries)
            own = players.get(uid, {'gram': 0, 'gifts': [], 'value': 0})
            if (len(players) >= room['player_limit'] and uid not in players or
                    sum(e['user_id'] == uid for e in entries) >= MAX_REQUESTS or
                    len(own['gifts']) + len(ids) > MAX_GIFTS):
                abort(409, description='Лимит игроков или подарков достигнут')
            available = balance(uid)
            cash = available.quantize(UNIT, rounding=ROUND_DOWN) if amount == 'all' else Decimal(amount)
            if (cash < 0 or cash > MAX_AMOUNT or cash > available or
                    units(cash) >= 2**63):
                abort(409, description='Недостаточно GRAM для ставки')
            if quick_value is not None:
                choices = available_gifts(uid, floor_prices())
                candidate = min(choices.values(), key=lambda gift: (gift['value'], gift['id']),
                                default=None)
                if not candidate or (candidate['id'], candidate['value']) != (ids[0], quick_value):
                    abort(409, description='Подарок для быстрой ставки изменился')
                gifts = {candidate['id']: candidate}
            else:
                gifts = available_gifts(uid, floor_prices(), ids) if ids else {}
            if len(gifts) != len(ids):
                abort(409, description='Подарок уже недоступен для ставки')
            bet_value = units(cash) + sum(item['value'] for item in gifts.values())
            if bet_value <= 0:
                abort(400, description='Выберите GRAM или подарок')
            if own['value'] + bet_value < room['min_value'] or own['value'] + bet_value > room['max_value']:
                abort(409, description='Ставка вне минимального или максимального лимита комнаты')
            for gift_id in gifts:
                if db().execute(
                    "UPDATE inventory SET status='arena' "
                    "WHERE user_id=? AND nft_id=? AND status='unlisted'",
                    (uid, gift_id)).rowcount != 1:
                    abort(409, description='Подарок уже используется')
            backing = {}
            if cash:
                remaining = available - cash
                backing = cap_funded_balance(db(), uid, remaining)
                set_balance(uid, remaining)
            db().execute(
                'INSERT INTO arena_private_stakes VALUES(?,?,?,?,?,?,?,?,?)',
                (token, number, uid, rid, len(entries), intent, units(cash),
                 json.dumps(list(gifts.values())), json.dumps(backing)))
            if not entries:
                db().execute(
                    'UPDATE arena_private_rounds SET wait_until=? '
                    'WHERE token=? AND round_no=?',
                    (now + WAIT_MS, token, number))
            if len(players) == 1 and uid not in players:
                db().execute(
                    'UPDATE arena_private_rounds SET bet_until=? '
                    'WHERE token=? AND round_no=?',
                    (now + room['bet_seconds'] * 1000, token, number))
            record('arena_stake', {'round_id': number, 'private_room': token,
                                   'gram': gram(-units(cash)),
                                   'gifts': list(gifts.values())}, uid=uid)
            return snapshot(room_for(token), now, uid)

    @app.post('/api/arena/private/<token>/cancel')
    @auth()
    def private_cancel(token):
        body = request.get_json(silent=True)
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token, member=True)
            now = clock()
            current = advance(room, now)
            if (not isinstance(body, dict) or type(body.get('round_id')) is not int or
                    current['round_no'] != body['round_id'] or current['bet_until'] is not None):
                abort(409, description='Раунд уже начался или завершился')
            entries = round_entries(token, current['round_no'])
            if not entries or entries[0]['user_id'] != g.user['id']:
                abort(409, description='У вас нет ставки для отмены')
            refund(room, current, entries, now)
            return snapshot(room_for(token), now, g.user['id'])

    def private_sweep():
        while True:
            try:
                with app.app_context():
                    now = clock()
                    due = db().execute(
                        'SELECT r.token FROM arena_private_rooms r '
                        'JOIN arena_private_rounds x ON x.token=r.token '
                        'AND x.round_no=r.current_round '
                        'WHERE (x.finished_at IS NOT NULL AND x.finished_at + ? <= ?) '
                        'OR (x.finished_at IS NULL AND x.bet_until IS NOT NULL '
                        'AND ((x.winner_id IS NULL AND x.bet_until <= ?) '
                        'OR (x.winner_id IS NOT NULL AND x.bet_until + ? <= ?))) '
                        'OR (x.finished_at IS NULL AND x.bet_until IS NULL '
                        'AND x.wait_until IS NOT NULL AND x.wait_until <= ?) '
                        'LIMIT 50', (RESULT_MS, now, now, PLAY_MS, now, now)).fetchall()
                    for row in due:
                        with db():
                            db().execute('BEGIN IMMEDIATE')
                            room = db().execute(
                                'SELECT * FROM arena_private_rooms WHERE token=?',
                                (row['token'],)).fetchone()
                            if room:
                                advance(room, clock())
            except Exception:
                app.logger.exception('Private Arena settlement failed')
            time.sleep(1.5)

    if not app.config.get('TESTING'):
        threading.Thread(target=private_sweep, daemon=True,
                         name='arena-private-settlement').start()
