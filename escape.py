"""Escape — independently funded *virtual* GRAM arcade game.

This temporary game intentionally DOES NOT touch users' actual GRAM balances,
withdrawal backing, NFTs, Craft Market, or Portals. Its independent test wallet
and leaderboard are non-redeemable. Each round is pre-determined on the server,
stored atomically, and exposed to the client solely for visual replay.
"""
import json
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import abort, g, request

TEST_INITIAL_CENTS = 100_000  # 1,000.00 TEST GRAM, deliberately not wallet GRAM.
MIN_STAKE_CENTS = 10
MAX_STAKE_CENTS = 50_000
BERLIN = ZoneInfo('Europe/Berlin')

# One shard increases the displayed multiplier. The rotating cyan segment
# denotes the survival probability for the NEXT shard, not overall round odds.
DIFFICULTIES = {
    'light': dict(label='Light', step=20, base_bps=9400, decay_bps=9600,
                  min_shards=6, max_shards=10, accent='#6bddff'),
    'mid': dict(label='Mid', step=36, base_bps=8800, decay_bps=9300,
                min_shards=5, max_shards=11, accent='#b794ff'),
    'epic': dict(label='Epic', step=55, base_bps=8100, decay_bps=9000,
                 min_shards=4, max_shards=12, accent='#ffb868'),
}


def amount(cents):
    return f'{cents // 100}.{cents % 100:02d}'


def stake_cents(raw):
    if not isinstance(raw, str) or not re.fullmatch(r'(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?', raw):
        abort(400, description='Введите ставку GRAM с точностью до сотых')
    value = Decimal(raw)
    cents = int(value * 100)
    if cents < MIN_STAKE_CENTS or cents > MAX_STAKE_CENTS:
        abort(400, description='Ставка от 0.10 до 500.00 тестовых GRAM')
    return cents


def survival_sector(settings, number):
    """Server probability in basis points; shrinks as shards accumulate."""
    chance = settings['base_bps']
    for _ in range(1, number):
        chance = max(450, chance * settings['decay_bps'] // 10000)
    return chance


def generate_steps(settings):
    """All RNG takes place before a single ball moves on the client."""
    target = settings['min_shards'] + secrets.randbelow(
        settings['max_shards'] - settings['min_shards'] + 1)
    steps = []
    for shard in range(1, target + 1):
        chance = survival_sector(settings, shard)
        safe = secrets.randbelow(10000) < chance
        steps.append(dict(
            shard=shard,
            sector_bps=chance,
            multiplier=amount(settings['step'] * shard) + 'x',
            safe=safe,
            exit=safe and shard == target,
        ))
        if not safe:
            break
    return steps, bool(steps and steps[-1]['exit'])


def install_escape(app, db, auth):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS escape_test_wallets (
                user_id INTEGER PRIMARY KEY,
                balance_cents INTEGER NOT NULL,
                created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS escape_test_rounds (
                user_id INTEGER NOT NULL,
                request_id TEXT NOT NULL,
                round_id TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                stake_cents INTEGER NOT NULL,
                success INTEGER NOT NULL,
                multiplier_bp INTEGER NOT NULL,
                payout_cents INTEGER NOT NULL,
                shards INTEGER NOT NULL,
                steps_json TEXT NOT NULL,
                created INTEGER NOT NULL,
                PRIMARY KEY(user_id,request_id)
            );
            CREATE INDEX IF NOT EXISTS escape_test_rounds_created
                ON escape_test_rounds(created);
        """)

    def wallet(user_id):
        db().execute(
            'INSERT INTO escape_test_wallets VALUES(?,?,?) ON CONFLICT DO NOTHING',
            (user_id, TEST_INITIAL_CENTS, int(time.time())))
        # No real demo_accounts or wallet_balances are touched.
        return int(db().execute(
            'SELECT balance_cents FROM escape_test_wallets WHERE user_id=?',
            (user_id,)).fetchone()['balance_cents'])

    def summarize_round(row):
        return dict(
            id=row['round_id'],
            difficulty=row['difficulty'],
            stake=amount(int(row['stake_cents'])),
            success=bool(row['success']),
            multiplier=amount(int(row['multiplier_bp'])) + 'x',
            payout=amount(int(row['payout_cents'])),
            shards=int(row['shards']),
            steps=json.loads(row['steps_json']),
            created=int(row['created']),
            demo=True,
        )

    def best_since(timestamp):
        row = db().execute("""
            SELECT r.user_id,r.round_id,r.difficulty,r.payout_cents,
                   r.multiplier_bp,r.shards,r.created,
                   COALESCE(NULLIF(u.username,''),NULLIF(u.name,''),'Игрок') player
            FROM escape_test_rounds r
            LEFT JOIN users u ON u.id=r.user_id
            WHERE r.success=1 AND r.created >= ?
            ORDER BY r.payout_cents DESC,r.multiplier_bp DESC,r.created DESC LIMIT 1
        """, (timestamp,)).fetchone()
        if not row:
            return None
        name = str(row['player'])[:32]
        return dict(player=name, payout=amount(int(row['payout_cents'])),
                    multiplier=amount(int(row['multiplier_bp'])) + 'x',
                    difficulty=row['difficulty'], shards=int(row['shards']),
                    created=int(row['created']), demo=True)

    @app.get('/api/escape/state')
    @auth()
    def escape_state():
        uid = g.user['id']
        with db():
            balance = wallet(uid)
        now = datetime.now(BERLIN)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = (day_start - timedelta(days=day_start.weekday()))
        recent = db().execute("""
            SELECT * FROM escape_test_rounds WHERE user_id=?
            ORDER BY created DESC,round_id DESC LIMIT 10
        """, (uid,)).fetchall()
        return dict(
            demo=True, currency='TEST GRAM', balance=amount(balance),
            difficulties={
                key: dict(label=value['label'],
                          step=amount(value['step']) + 'x',
                          first_sector=value['base_bps']/100,
                          min_shards=value['min_shards'],
                          max_shards=value['max_shards'],
                          accent=value['accent'])
                for key, value in DIFFICULTIES.items()
            },
            best_day=best_since(int(day_start.timestamp())),
            best_week=best_since(int(week_start.timestamp())),
            recent=[summarize_round(row) for row in recent],
        )

    @app.post('/api/escape/play')
    @auth()
    def escape_play():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, description='Неверные данные игры')
        mode = body.get('difficulty')
        if not isinstance(mode, str) or mode not in DIFFICULTIES:
            abort(400, description='Выберите Light, Mid или Epic')
        request_id = body.get('request_id')
        if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', request_id):
            abort(400, description='Некорректный идентификатор раунда')
        wager = stake_cents(body.get('stake'))
        user_id = g.user['id']
        with db():
            conn = db()
            conn.execute('BEGIN IMMEDIATE')
            existing = conn.execute(
                'SELECT * FROM escape_test_rounds WHERE user_id=? AND request_id=?',
                (user_id, request_id)).fetchone()
            if existing:
                if existing['difficulty'] != mode or existing['stake_cents'] != wager:
                    abort(409, description='Такой запрос уже использован с другой ставкой')
                result = summarize_round(existing)
                result['balance'] = amount(wallet(user_id))
                return result
            before = wallet(user_id)
            if before < wager:
                abort(409, description='Недостаточно тестового GRAM-баланса')
            steps, success = generate_steps(DIFFICULTIES[mode])
            multiplier_bp = DIFFICULTIES[mode]['step'] * len(steps)
            # The multiplier is shown even for losses; only winners receive a payout.
            payout = (wager * multiplier_bp // 100) if success else 0
            new_balance = before - wager + payout
            conn.execute('UPDATE escape_test_wallets SET balance_cents=? WHERE user_id=?',
                         (new_balance, user_id))
            round_id = 'esc-' + uuid.uuid4().hex
            created = int(time.time())
            conn.execute(
                'INSERT INTO escape_test_rounds VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                (user_id, request_id, round_id, mode, wager,
                 1 if success else 0, multiplier_bp, payout, len(steps),
                 json.dumps(steps), created),
            )
            result = dict(id=round_id, difficulty=mode, stake=amount(wager),
                          success=success, multiplier=amount(multiplier_bp) + 'x',
                          payout=amount(payout), shards=len(steps), steps=steps,
                          created=created, demo=True, balance=amount(new_balance))
        return result

    @app.post('/api/escape/test-balance/reset')
    @auth()
    def escape_reset_test_balance():
        """Refill only when exhausted. Does not affect real assets or ledger."""
        uid = g.user['id']
        with db():
            conn = db()
            conn.execute('BEGIN IMMEDIATE')
            current = wallet(uid)
            if current >= MIN_STAKE_CENTS:
                abort(409, description='Тестовый баланс ещё не исчерпан')
            conn.execute('UPDATE escape_test_wallets SET balance_cents=? WHERE user_id=?',
                         (TEST_INITIAL_CENTS, uid))
        return dict(ok=True, balance=amount(TEST_INITIAL_CENTS), demo=True)
