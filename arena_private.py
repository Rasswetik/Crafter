"""Invite-only Arena rooms. Independent rounds and escrow, no public listing."""
import json
import re
import secrets
import hashlib
import base64
import io
import threading
import time
from decimal import Decimal, InvalidOperation, ROUND_DOWN

from flask import abort, g, request, Response
from PIL import Image, UnidentifiedImageError

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
BOT_DELAY_MS = 4000
BOT_INTERVAL_MS = 3000
BOT_CUTOFF_MS = 2000
BOT_MAX_STAKES = 3
BOT_DEFAULT_PHOTO = '/static/assets/arena-crafter-bot.jpg'
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
        for sql in (
            "ALTER TABLE arena_private_rooms ADD COLUMN bot_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE arena_private_rooms ADD COLUMN bot_name TEXT NOT NULL DEFAULT 'Crafter'",
            "ALTER TABLE arena_private_rooms ADD COLUMN bot_avatar TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE arena_private_rooms ADD COLUMN bot_avatar_version INTEGER NOT NULL DEFAULT 0",
        ):
            try:
                db().execute(sql)
            except Exception as exc:
                if 'already exists' not in str(exc).lower() and 'duplicate column' not in str(exc).lower():
                    raise

    def room_bot_uid(token):
        digest = hashlib.sha256(token.encode('ascii')).digest()
        return -((int.from_bytes(digest[:8], 'big') & ((1 << 60) - 1)) + 100000)

    def bot_photo(room):
        if room['bot_avatar_version']:
            return '/api/arena/private/' + room['token'] + '/bot-avatar?v=' + str(room['bot_avatar_version'])
        return BOT_DEFAULT_PHOTO

    def private_players_public(players, room):
        bot_id = room_bot_uid(room['token'])
        human = {uid: value for uid, value in players.items() if uid != bot_id}
        human_rows = players_public(human)
        profiles = {int(row['id']): row for row in human_rows}
        total = sum(player['value'] for player in players.values())
        output = []
        for uid, player in players.items():
            if uid == bot_id:
                profile = {'id': str(uid), 'name': room['bot_name'],
                           'photo': bot_photo(room), 'is_bot': True}
            else:
                profile = dict(profiles[uid])
            profile.update({
                'gram': gram(player['gram']), 'value': gram(player['value']),
                'chance': round(100 * player['value'] / total, 4) if total else 0,
                'gifts': player['gifts']
            })
            output.append(profile)
        return output

    def ensure_bot_account(room):
        uid = room_bot_uid(room['token'])
        db().execute("INSERT INTO demo_accounts VALUES(?, '0') ON CONFLICT DO NOTHING", (uid,))
        return uid

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
                'min_bet': gram(room['min_value']), 'max_bet': gram(room['max_value']),
                'bot_enabled': bool(room['bot_enabled']), 'bot_name': room['bot_name'],
                'bot_photo': bot_photo(room)}

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
        # Private bot stake is owner-funded. Its NFT prize goes to the room
        # owner rather than being stranded in a negative bot account.
        gift_recipient = room['owner_id'] if winner == room_bot_uid(token) else winner
        for uid, player in players.items():
            for gift in player['gifts']:
                release_gift(uid, gift['id'], gift_recipient)
                gifts.append(gift)
        if winner == room_bot_uid(token) and gifts:
            record('arena_bot_prize', {'private_room': token, 'round_id': number,
                                      'gifts': gifts}, uid=room['owner_id'])
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
        public = private_players_public(players, room)
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
            'players': private_players_public(players, room),
            'bank': gram(sum(p['value'] for p in players.values())),
            'last_result': last_result, 'best_result': best_result,
            'fee_bps': FEE_BPS, 'bot_enabled': bool(room['bot_enabled']),
            'balance': str(balance(uid)), 'viewer': str(uid), 'gift_limit': MAX_GIFTS,
            'can_cancel': phase == 'waiting' and uid in players,
            'private_room': public_room(room, joined=True),
        }

    def bot_tick(room, round_row, now):
        if (not room['bot_enabled'] or round_row['finished_at'] is not None or
                round_row['wait_until'] is None or
                (round_row['bet_until'] is not None and now >= round_row['bet_until'] - BOT_CUTOFF_MS)):
            return round_row
        if now < round_row['wait_until'] - WAIT_MS + BOT_DELAY_MS:
            return round_row
        token, number = room['token'], round_row['round_no']
        bot_id = room_bot_uid(token)
        entries = round_entries(token, number)
        players = totals(entries)
        humans = {uid: player for uid, player in players.items() if uid != bot_id}
        if not humans:
            return round_row
        own = players.get(bot_id)
        if not own and (len(players) >= room['player_limit'] or len(humans) != 1):
            return round_row
        moves = [entry for entry in entries if entry['user_id'] == bot_id]
        if len(moves) >= BOT_MAX_STAKES:
            return round_row
        last = json.loads(moves[-1]['intent']) if moves else None
        if last and now < last['at'] + BOT_INTERVAL_MS:
            return round_row
        roll = last['target'] if last else 3000 + secrets.randbelow(1601)
        human_stakes = sum(player['value'] for player in humans.values())
        desired = human_stakes * roll // (10000 - roll)
        already = own['value'] if own else 0
        cash_available = max(0, units(balance(bot_id)))
        if not own:
            # The first bot bet must satisfy the room minimum, even when
            # its adaptive percentage would otherwise calculate less.
            desired = max(desired, room['min_value'])
        target = min(desired - already, room['max_value'] - already, cash_available)
        if not own and target < room['min_value']:
            return round_row
        if target <= 0:
            return round_row
        remaining = balance(bot_id) - Decimal(gram(target))
        backing = cap_funded_balance(db(), bot_id, remaining)
        set_balance(bot_id, remaining)
        db().execute(
            'INSERT INTO arena_private_stakes VALUES(?,?,?,?,?,?,?,?,?)',
            (token, number, bot_id, 'bot-' + str(len(moves)), len(entries),
             json.dumps({'at': now, 'target': roll}), target, '[]', json.dumps(backing)))
        if len(humans) == 1 and own is None:
            db().execute(
                'UPDATE arena_private_rounds SET bet_until=? WHERE token=? AND round_no=?',
                (now + room['bet_seconds'] * 1000, token, number))
        record('arena_stake', {'round_id': number, 'private_room': token,
                               'gram': gram(-target), 'gifts': [], 'is_bot': True}, uid=bot_id)
        return round_for(room)

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
                'INSERT INTO arena_private_rooms '
                '(token,owner_id,name,bet_seconds,player_limit,min_value,max_value,current_round,created) '
                'VALUES(?,?,?,?,?,?,?,?,?)',
                (token, g.user['id'], name.strip(), seconds, player_limit,
                 minimum, maximum, 1, now))
            db().execute(
                'INSERT INTO arena_private_members VALUES(?,?,?)',
                (token, g.user['id'], now))
            db().execute(
                'INSERT INTO arena_private_rounds(token,round_no,created,seed) '
                'VALUES(?,?,?,?)', (token, 1, now, secrets.randbits(32)))
            room = room_for(token, member=True)
            ensure_bot_account(room)
            result = public_room(room, joined=True)
            result['telegram_link'] = telegram_invite(token)
            result['web_link'] = request.url_root.rstrip('/') + '/?arena_room=' + token
            return result

    @app.post('/api/arena/private/<token>/settings')
    @auth()
    def update_private_room_settings(token):
        data = request.get_json(silent=True)
        name, seconds, player_limit, minimum, maximum = validate_room_settings(data)
        enabled = data.get('bot_enabled', False)
        bot_name = data.get('bot_name', 'Crafter')
        if (type(enabled) is not bool or not isinstance(bot_name, str) or
                not 2 <= len(bot_name.strip()) <= 24 or
                any(ord(ch) < 32 or ord(ch) == 127 for ch in bot_name)):
            abort(400, description='Проверьте имя и статус бота')
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
                'min_value=?, max_value=?, bot_enabled=?, bot_name=? WHERE token=? AND owner_id=?',
                (name, seconds, player_limit, minimum, maximum, int(enabled),
                 bot_name.strip(), token, g.user['id']))
            updated = room_for(token, member=True)
            ensure_bot_account(updated)
            result = public_room(updated, joined=True)
            result['bot_balance'] = str(balance(room_bot_uid(token)))
            return result

    @app.post('/api/arena/private/<token>/bot-funds')
    @auth()
    def private_bot_funds(token):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or data.get('action') not in ('deposit', 'withdraw'):
            abort(400, description='Укажите действие с балансом')
        amount = parse_amount(data.get('amount'))
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token, member=True)
            if room['owner_id'] != g.user['id']:
                abort(403, description='Баланс бота может менять только владелец')
            bot_id = ensure_bot_account(room)
            owner = g.user['id']
            transfer = Decimal(gram(amount))
            if data['action'] == 'deposit':
                if balance(owner) < transfer:
                    abort(409, description='На вашем балансе недостаточно GRAM')
                remaining = balance(owner) - transfer
                backing = cap_funded_balance(db(), owner, remaining)
                set_balance(owner, remaining)
                set_balance(bot_id, balance(bot_id) + transfer)
                restore_backing(bot_id, [{'backing': backing}])
                record('arena_bot_fund', {'private_room': token, 'gram': str(-transfer),
                       'bot_name': room['bot_name']}, uid=owner)
            else:
                if balance(bot_id) < transfer:
                    abort(409, description='На балансе бота недостаточно GRAM')
                current = round_for(room)
                if current and current['finished_at'] is None and db().execute(
                        'SELECT 1 FROM arena_private_stakes WHERE token=? AND round_no=? '
                        'AND user_id=? LIMIT 1',
                        (token, room['current_round'], bot_id)).fetchone():
                    abort(409, description='Дождитесь завершения игры бота')
                remaining = balance(bot_id) - transfer
                backing = cap_funded_balance(db(), bot_id, remaining)
                set_balance(bot_id, remaining)
                set_balance(owner, balance(owner) + transfer)
                restore_backing(owner, [{'backing': backing}])
                record('arena_bot_fund', {'private_room': token, 'gram': str(transfer),
                       'bot_name': room['bot_name'], 'action': 'withdraw'}, uid=owner)
            result = public_room(room, joined=True)
            result['bot_balance'] = str(balance(bot_id))
            result['owner_balance'] = str(balance(owner))
            return result

    @app.post('/api/arena/private/<token>/bot-avatar')
    @auth()
    def update_private_bot_avatar(token):
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400, description='Неверный формат изображения')
        raw = data.get('image')
        if raw is not None and (not isinstance(raw, str) or
                len(raw) > 12000 or not raw.startswith('data:image/webp;base64,')):
            abort(400, description='Выберите небольшое изображение WEBP')
        encoded = ''
        if raw:
            try:
                image_bytes = base64.b64decode(raw.split(',', 1)[1], validate=True)
                if len(image_bytes) > 8500:
                    abort(413, description='Размер аватара слишком большой')
                with Image.open(io.BytesIO(image_bytes)) as picture:
                    if picture.width > 256 or picture.height > 256 or picture.width < 16 or picture.height < 16:
                        abort(400, description='Размер изображения должен быть 16–256 пикселей')
                    picture.load()
                    picture = picture.convert('RGB')
                    picture.thumbnail((128, 128))
                    output = io.BytesIO()
                    picture.save(output, format='WEBP', quality=72, method=4)
                    if output.tell() > 10000:
                        abort(413, description='Слишком сложное изображение')
                    encoded = base64.b64encode(output.getvalue()).decode('ascii')
            except (ValueError, OSError, UnidentifiedImageError, base64.binascii.Error):
                abort(400, description='Не удалось обработать изображение')
        with db():
            db().execute('BEGIN IMMEDIATE')
            room = room_for(token, member=True)
            if room['owner_id'] != g.user['id']:
                abort(403, description='Аватар может менять только владелец')
            db().execute(
                'UPDATE arena_private_rooms SET bot_avatar=?, bot_avatar_version=? '
                'WHERE token=? AND owner_id=?',
                (encoded, clock() if encoded else 0, token, g.user['id']))
            updated = room_for(token, member=True)
            result = public_room(updated, joined=True)
            result['bot_balance'] = str(balance(ensure_bot_account(updated)))
            return result

    @app.get('/api/arena/private/<token>/bot-avatar')
    def private_bot_avatar_image(token):
        room = room_for(token)
        if not room['bot_avatar']:
            abort(404)
        try:
            data = base64.b64decode(room['bot_avatar'], validate=True)
        except (ValueError, base64.binascii.Error):
            abort(404)
        return Response(data, mimetype='image/webp',
                        headers={'Cache-Control': 'public, max-age=86400'})

    @app.get('/api/arena/private/<token>/invite')
    @auth()
    def private_invite(token):
        room = room_for(token)
        joined = db().execute(
            'SELECT 1 FROM arena_private_members WHERE token=? AND user_id=?',
            (token, g.user['id'])).fetchone() is not None
        result = public_room(room, joined=joined)
        if joined and room['owner_id'] == g.user['id']:
            account = db().execute(
                'SELECT balance FROM demo_accounts WHERE user_id=?',
                (room_bot_uid(token),)).fetchone()
            result['bot_balance'] = str(account['balance']) if account else '0'
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
            human_count = sum(1 for player_id in players if player_id != room_bot_uid(token))
            if ((human_count >= room['player_limit'] and uid not in players) or
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
                        'OR (r.bot_enabled=1 AND x.finished_at IS NULL AND '
                        'x.wait_until IS NOT NULL AND '
                        '(x.bet_until IS NULL OR x.bet_until > ?)) '
                        'LIMIT 50', (RESULT_MS, now, now, PLAY_MS, now, now, now + BOT_CUTOFF_MS)).fetchall()
                    for row in due:
                        with db():
                            db().execute('BEGIN IMMEDIATE')
                            room = db().execute(
                                'SELECT * FROM arena_private_rooms WHERE token=?',
                                (row['token'],)).fetchone()
                            if room:
                                now_tick = clock()
                                current = round_for(room)
                                if current and room['bot_enabled']:
                                    bot_tick(room, current, now_tick)
                                advance(room, clock())
            except Exception:
                app.logger.exception('Private Arena settlement failed')
            time.sleep(1.5)

    if not app.config.get('TESTING'):
        threading.Thread(target=private_sweep, daemon=True,
                         name='arena-private-settlement').start()
