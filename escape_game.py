"""Escape: a ball bounces inside a ring with a gap. Every bounce on the wall adds +0.2x. Sooner or later the ball leaves
through the gap and falls on the floor: the green part pays bet x multiplier, the red part (the skull) takes the bet.

The server settles the round before anything is drawn; the client only plays the already decided result. Every round is
provably fair: the player sees the hash of the server seed BEFORE the round, the seed is revealed in the answer, the
result is derived from HMAC-SHA256(seed, "client_seed:nonce:index") and can be recomputed by anybody.
"""
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from decimal import Decimal, ROUND_DOWN

from flask import abort, g, request

STEP = Decimal('0.2')                 # every bounce adds this to the multiplier
START = Decimal('1.0')
RTP = 0.96                            # return to player: the house keeps 4%
MAX_BOUNCES = 80
MIN_BET, MAX_BET = Decimal('0.1'), Decimal('200')
UNIT = Decimal('0.000001')
# the chance to leave through the gap on one wall hit: the smaller the gap, the more bounces (and the bigger multipliers)
LEVELS = {
    'lite': {'name': 'Lite', 'exit': 0.50},
    'mid': {'name': 'Mid', 'exit': 0.30},
    'epic': {'name': 'Epic', 'exit': 0.15},
}


def green_chance(level):
    """Chance of landing on the green part, chosen so that the return to player equals RTP for this level."""
    e = LEVELS[level]['exit']
    expected = float(START) + float(STEP) * (1 - e) / e
    return min(0.97, RTP / expected)


def draw(seed, client_seed, nonce, index):
    """A number in [0, 1) that anybody can recompute from the revealed seed."""
    digest = hmac.new(seed.encode(), ('%s:%d:%d' % (client_seed, nonce, index)).encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:6], 'big') / float(1 << 48)


def play_round(seed, client_seed, nonce, level):
    """-> {bounces, win, multiplier, landing}. 'landing' is a number in [0,1) inside the zone where the ball falls."""
    e, green = LEVELS[level]['exit'], green_chance(level)
    bounces = 0
    while bounces < MAX_BOUNCES and draw(seed, client_seed, nonce, bounces) >= e:
        bounces += 1
    win = draw(seed, client_seed, nonce, 1000) < green
    landing = draw(seed, client_seed, nonce, 1001)
    return {'bounces': bounces, 'win': win, 'multiplier': START + STEP * bounces, 'landing': landing, 'green': green}


def install_escape(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS escape_seeds (
                user_id BIGINT PRIMARY KEY, seed TEXT NOT NULL, hash TEXT NOT NULL, nonce BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS escape_rounds (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, request_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL, bet TEXT NOT NULL, bounces BIGINT NOT NULL, multiplier TEXT NOT NULL, win BIGINT NOT NULL,
                payout TEXT NOT NULL, seed TEXT NOT NULL, hash TEXT NOT NULL, client_seed TEXT NOT NULL, nonce BIGINT NOT NULL,
                landing DOUBLE PRECISION NOT NULL DEFAULT 0.5, created BIGINT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS escape_rounds_request ON escape_rounds(user_id, request_id);
            CREATE INDEX IF NOT EXISTS escape_rounds_user ON escape_rounds(user_id, created);
            CREATE INDEX IF NOT EXISTS escape_rounds_time ON escape_rounds(created);
        """)

    pace, pace_lock = {}, threading.Lock()

    def throttle(uid):
        now = time.time()
        with pace_lock:
            if now - pace.get(uid, 0) < 0.7:
                abort(429, description='Подождите секунду')
            pace[uid] = now

    def balance_of(uid):
        row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
        return Decimal(row['balance']) if row else Decimal(0)

    def fresh_seed(uid, nonce=0):
        seed = secrets.token_hex(32)
        digest = hashlib.sha256(seed.encode()).hexdigest()
        db().execute('INSERT INTO escape_seeds(user_id,seed,hash,nonce,created) VALUES(?,?,?,?,?) '
                     'ON CONFLICT(user_id) DO UPDATE SET seed=excluded.seed,hash=excluded.hash,nonce=excluded.nonce,created=excluded.created',
                     (uid, seed, digest, nonce, int(time.time())))
        return digest

    def current_hash(uid):
        row = db().execute('SELECT hash FROM escape_seeds WHERE user_id=?', (uid,)).fetchone()
        if row:
            return row['hash']
        with db():
            return fresh_seed(uid)

    def display_name(user):
        return (user.get('username') or user.get('first_name') or 'Игрок')[:24]

    def best(since):
        row = db().execute('SELECT name,bet,payout FROM escape_rounds WHERE win=1 AND created>? '
                           'ORDER BY (CAST(payout AS DOUBLE PRECISION) - CAST(bet AS DOUBLE PRECISION)) DESC LIMIT 1', (since,)).fetchone()
        if not row:
            return None
        return {'name': row['name'] or 'Игрок', 'profit': format((Decimal(row['payout']) - Decimal(row['bet'])).quantize(Decimal('0.01')), 'f')}

    def round_view(row):
        return {'id': row['id'], 'level': row['level'], 'bet': row['bet'], 'bounces': int(row['bounces']), 'multiplier': row['multiplier'],
                'win': bool(row['win']), 'payout': row['payout'], 'seed': row['seed'], 'hash': row['hash'], 'client_seed': row['client_seed'],
                'nonce': int(row['nonce']), 'landing': float(row['landing']), 'created': int(row['created'])}

    @app.get('/api/escape/state')
    @auth()
    def escape_state():
        uid = g.user['id']
        now = int(time.time())
        online = db().execute('SELECT COUNT(DISTINCT user_id) AS n FROM escape_rounds WHERE created>?', (now - 600,)).fetchone()['n']
        return {'hash': current_hash(uid), 'balance': str(balance_of(uid)), 'min_bet': str(MIN_BET), 'max_bet': str(MAX_BET),
                'step': str(STEP), 'rtp': RTP, 'online': int(online),
                'levels': [{'key': key, 'name': value['name'], 'exit': value['exit'], 'green': green_chance(key)} for key, value in LEVELS.items()],
                'best_week': best(now - 7 * 86400), 'best_day': best(now - 86400)}

    @app.get('/api/escape/history')
    @auth()
    def escape_history():
        rows = db().execute('SELECT * FROM escape_rounds WHERE user_id=? ORDER BY created DESC, id DESC LIMIT 40', (g.user['id'],)).fetchall()
        return {'rounds': [round_view(r) for r in rows]}

    @app.post('/api/escape/play')
    @auth()
    def escape_play():
        data = request.get_json(silent=True) or {}
        level = data.get('level')
        rid = data.get('request_id')
        if level not in LEVELS:
            abort(400, description='Выберите сложность')
        if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', rid):
            abort(400, description='Неверный запрос')
        try:
            bet = Decimal(str(data.get('bet'))).quantize(UNIT, rounding=ROUND_DOWN)
        except Exception:
            abort(400, description='Укажите ставку')
        if not bet.is_finite() or bet < MIN_BET or bet > MAX_BET:
            abort(400, description='Ставка от %s до %s GRAM' % (MIN_BET, MAX_BET))
        client_seed = re.sub(r'[^A-Za-z0-9_-]', '', str(data.get('client_seed') or ''))[:32] or str(g.user['id'])
        uid = g.user['id']
        if not db().execute('SELECT 1 FROM escape_rounds WHERE user_id=? AND request_id=?', (uid, rid)).fetchone():
            throttle(uid)                                  # a repeated request of the same round is answered at once
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior = db().execute('SELECT * FROM escape_rounds WHERE user_id=? AND request_id=?', (uid, rid)).fetchone()
            if prior:
                return {'round': round_view(prior), 'repeat': True}
            row = db().execute('SELECT seed,hash,nonce FROM escape_seeds WHERE user_id=?', (uid,)).fetchone()
            if not row:
                fresh_seed(uid)
                row = db().execute('SELECT seed,hash,nonce FROM escape_seeds WHERE user_id=?', (uid,)).fetchone()
            seed, digest, nonce = row['seed'], row['hash'], int(row['nonce'])
            left = balance_of(uid) - bet
            if left < 0:
                abort(409, description='Недостаточно GRAM на балансе')
            result = play_round(seed, client_seed, nonce, level)
            payout = (bet * result['multiplier']).quantize(UNIT, rounding=ROUND_DOWN) if result['win'] else Decimal(0)
            from resale import cap_funded_balance
            cap_funded_balance(db(), uid, left)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(left + payout), uid))
            round_id = secrets.token_hex(8)
            db().execute('INSERT INTO escape_rounds(id,user_id,request_id,name,level,bet,bounces,multiplier,win,payout,seed,hash,client_seed,nonce,landing,created) '
                         'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                         (round_id, uid, rid, display_name(g.user), level, str(bet), result['bounces'], str(result['multiplier']), 1 if result['win'] else 0,
                          str(payout), seed, digest, client_seed, nonce, result['landing'], int(time.time())))
            next_hash = fresh_seed(uid)                    # the seed of this round is revealed, the next one is committed
            record('escape', {'level': level, 'bet': str(bet), 'bounces': result['bounces'], 'win': result['win'], 'payout': str(payout)})
            finished = db().execute('SELECT * FROM escape_rounds WHERE id=?', (round_id,)).fetchone()
            balance = balance_of(uid)
        return {'round': round_view(finished), 'balance': str(balance), 'next_hash': next_hash}

    app.extensions['crafter_escape_verify'] = play_round
