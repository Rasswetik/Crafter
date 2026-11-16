"""The casino «Diamond»: three wheels of fortune, slot machines, a common jackpot and VIP levels.

Wheels: «Классика» (a free spin every day), «Золотое» and «Бриллиантовое» (open with the VIP level, bigger prizes, bigger prices). Every wheel has 12 sectors with prizes from the real
catalog, its own price that grows during the day, a limit of paid spins a day and a guaranteed good prize every N paid spins.
Slots: three reels, a bet in balls, a paytable shown to the player (with the theoretical return), a limit of spins and of bets a day.
One jackpot for everything: a part of every paid spin and of every bet goes to the pool; the jackpot sector of a wheel and three diamonds in the slots give the whole pool.
Everything is decided here (the client only shows the answer); a repeated request does not give a second spin; the odds are shown to the players.
"""
import itertools
import json
import secrets
import time
import uuid
from datetime import timedelta, timezone

from flask import abort, g, request

SETTINGS_KEY = 'diamond_v1'
MSK = timezone(timedelta(hours=3))
TIERS = ('common', 'rare', 'epic', 'jackpot')
SECTORS = 12
WHEEL_IDS = ('classic', 'gold', 'diamond', 'royal')
SLOT_IDS = ('coin', 'cyan', 'pink', 'gold', 'silver', 'crown', 'badge', 'diamond')
RNG = secrets.SystemRandom()


def ball(n):
    return [{'kind': 'BALL', 'amount': str(int(n)), 'count': 1}]


def pack(n):
    return [{'kind': 'PACK', 'amount': 'vicecity', 'count': n}]


def sector_rows(m, packs):
    """The sectors of a wheel: the base values multiplied by m, the packs by `packs`."""
    rows = [(ball(50 * m), 220, 'common'), (ball(100 * m), 170, 'common'), (pack(packs), 80, 'rare'), (ball(200 * m), 120, 'common'), (ball(75 * m), 180, 'common'), (ball(400 * m), 40, 'rare'),
            (ball(500 * m), 50, 'rare'), (ball(150 * m), 100, 'common'), (pack(packs * 2), 25, 'epic'), (ball(300 * m), 60, 'rare'), (ball(1000 * m), 20, 'epic'), ([], 10, 'jackpot')]
    return [{'reward': r, 'weight': w, 'tier': t} for r, w, t in rows]


def gram(v):
    return [{'kind': 'GRAM', 'amount': str(v), 'count': 1}]


def royal_rows():
    """The expensive wheel: big balls, GRAM and packs. NFT gifts and Telegram gifts are added by the administrator from the catalog (any sector can hold them)."""
    rows = [(ball(3000), 200, 'common'), (ball(6000), 170, 'common'), (gram(1), 90, 'rare'), (pack(6), 70, 'rare'), (ball(10000), 110, 'common'), (gram(3), 40, 'epic'),
            (ball(20000), 50, 'rare'), (ball(4500), 150, 'common'), (gram(10), 20, 'epic'), (pack(10), 25, 'epic'), (ball(50000), 10, 'epic'), ([], 30, 'jackpot')]
    return [{'reward': r, 'weight': w, 'tier': t} for r, w, t in rows]


def default_wheels():
    return [
        {'id': 'classic', 'title': 'Классика', 'vip_min': 0, 'free_daily': 1, 'max_paid': 5, 'price_base': 100, 'price_step': 100, 'pity_every': 10, 'sectors': sector_rows(1, 1)},
        {'id': 'gold', 'title': 'Золотое', 'vip_min': 1, 'free_daily': 0, 'max_paid': 5, 'price_base': 500, 'price_step': 250, 'pity_every': 8, 'sectors': sector_rows(4, 2)},
        {'id': 'diamond', 'title': 'Бриллиантовое', 'vip_min': 2, 'free_daily': 0, 'max_paid': 4, 'price_base': 2000, 'price_step': 1000, 'pity_every': 6, 'sectors': sector_rows(12, 4)},
        {'id': 'royal', 'title': 'Королевское', 'vip_min': 3, 'free_daily': 0, 'max_paid': 3, 'price_base': 8000, 'price_step': 4000, 'pity_every': 5, 'sectors': royal_rows()},
    ]


def default_slots():
    sym = lambda i, w, p3, p2: {'id': i, 'weight': w, 'pay3': p3, 'pay2': p2}
    return {'enabled': True, 'bets': [50, 100, 250, 500], 'max_spins': 200, 'daily_bet_cap': 20000, 'rake': 5, 'xp': 3,
            'symbols': [sym('coin', 30, 7, 1.2), sym('cyan', 22, 11, 1.8), sym('pink', 18, 18, 2.5), sym('gold', 12, 35, 3.5), sym('silver', 8, 70, 7), sym('crown', 5, 180, 14), sym('badge', 3, 450, 35), sym('diamond', 2, 0, 0)]}


def default_settings():
    return {'enabled': False, 'title': 'Казино Diamond', 'subtitle': 'Три колеса, слоты, VIP-уровни и общий джекпот.',
            'wheels': default_wheels(), 'jackpot_start': 5000, 'jackpot_rake': 20,
            'vip_xp': [0, 100, 400, 1200], 'vip_extra_free': [0, 1, 1, 2], 'vip_discount': [0, 5, 10, 20], 'xp_free': 5, 'xp_paid': 10, 'slots': default_slots()}


def day_of(now):
    return int((now + 3 * 3600) // 86400)


def slot_rtp(symbols):
    """The theoretical return of the slots without the jackpot: every combination of three reels is counted."""
    total = sum(max(0, float(s['weight'])) for s in symbols) or 1.0
    p = {s['id']: max(0, float(s['weight'])) / total for s in symbols}
    by = {s['id']: s for s in symbols}
    rtp = hit = 0.0
    for a, b, c in itertools.product(symbols, repeat=3):
        pr = p[a['id']] * p[b['id']] * p[c['id']]
        pay = 0.0
        if a['id'] == b['id'] == c['id']:
            pay = float(by[a['id']]['pay3']) if a['id'] != 'diamond' else 0.0
        elif a['id'] == b['id']:
            pay = float(by[a['id']]['pay2'])
        if pay > 0:
            hit += pr
        rtp += pr * pay
    return {'rtp': round(rtp * 100, 1), 'hit': round(hit * 100, 1), 'jackpot': round(p.get('diamond', 0) ** 3 * 100, 5)}


def install_diamond(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS diamond_users (
                user_id BIGINT PRIMARY KEY, day BIGINT NOT NULL DEFAULT 0, free_used BIGINT NOT NULL DEFAULT 0, paid_used BIGINT NOT NULL DEFAULT 0,
                xp BIGINT NOT NULL DEFAULT 0, pity BIGINT NOT NULL DEFAULT 0, spins BIGINT NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS diamond_use (
                user_id BIGINT NOT NULL, wheel TEXT NOT NULL, day BIGINT NOT NULL DEFAULT 0, free_used BIGINT NOT NULL DEFAULT 0, paid_used BIGINT NOT NULL DEFAULT 0, pity BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY(user_id, wheel)
            );
            CREATE TABLE IF NOT EXISTS diamond_slot_day (user_id BIGINT PRIMARY KEY, day BIGINT NOT NULL DEFAULT 0, spins BIGINT NOT NULL DEFAULT 0, bets BIGINT NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS diamond_state (key TEXT PRIMARY KEY, value BIGINT NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS diamond_spins (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, request_id TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0, sector BIGINT NOT NULL,
                tier TEXT NOT NULL, jackpot BIGINT NOT NULL DEFAULT 0, reward TEXT NOT NULL DEFAULT '[]', created BIGINT NOT NULL, wheel TEXT NOT NULL DEFAULT 'classic'
            );
            CREATE TABLE IF NOT EXISTS diamond_slot_spins (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, request_id TEXT NOT NULL DEFAULT '', bet BIGINT NOT NULL, reels TEXT NOT NULL, win BIGINT NOT NULL DEFAULT 0, jackpot BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
            );
        """)
    with app.app_context(), db():                                       # the first version of the table had no column for the wheel
        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE diamond_spins ADD COLUMN IF NOT EXISTS wheel TEXT NOT NULL DEFAULT 'classic'")
        else:
            cols = {r[1] for r in database.execute("PRAGMA table_info(diamond_spins)").fetchall()}
            if 'wheel' not in cols:
                database.execute("ALTER TABLE diamond_spins ADD COLUMN wheel TEXT NOT NULL DEFAULT 'classic'")

    # ------------------------------------------------------------------ settings and the pool
    def settings():
        out = default_settings()
        row = db().execute("SELECT payload FROM settings WHERE key=?", (SETTINGS_KEY,)).fetchone()
        try:
            raw = json.loads(row['payload']) if row else {}
        except (ValueError, TypeError):
            raw = {}
        if isinstance(raw, dict):
            for k in out:
                if k in raw:
                    out[k] = raw[k]
            if 'wheels' not in raw and raw.get('sectors'):              # the first version had one wheel: it becomes «Классика»
                w = out['wheels'][0]
                for k in ('sectors', 'free_daily', 'max_paid', 'price_base', 'price_step', 'pity_every'):
                    if k in raw:
                        w[k] = raw[k]
            if isinstance(raw.get('slots'), dict):
                out['slots'] = {**default_slots(), **raw['slots']}
        return out

    def save_settings(cfg):
        db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (SETTINGS_KEY, json.dumps(cfg)))

    def pool_get(cfg):
        row = db().execute("SELECT value FROM diamond_state WHERE key='pool'").fetchone()
        if not row:
            db().execute("INSERT INTO diamond_state(key,value) VALUES('pool',?) ON CONFLICT DO NOTHING", (int(cfg['jackpot_start']),))
            return int(cfg['jackpot_start'])
        return int(row['value'])

    def pool_set(v):
        db().execute("INSERT INTO diamond_state(key,value) VALUES('pool',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (int(v),))

    def clean(raw, where):
        return app.extensions['crafter_reward_clean'](raw if isinstance(raw, list) else [])

    def described(rewards):
        return [app.extensions['crafter_reward_describe'](dict(r)) for r in rewards]

    # ------------------------------------------------------------------ the player
    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def pay(uid, amount):
        if amount <= 0:
            return
        have = balls_of(uid)
        if have < amount:
            abort(409, description='Недостаточно: шаров')
        db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
        db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (have - amount, uid))

    def user_row(uid):
        row = db().execute("SELECT * FROM diamond_users WHERE user_id=?", (uid,)).fetchone()
        if not row:
            db().execute("INSERT INTO diamond_users(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
            row = db().execute("SELECT * FROM diamond_users WHERE user_id=?", (uid,)).fetchone()
        return row

    def use_row(uid, wheel_id, now):
        today = day_of(now)
        row = db().execute("SELECT * FROM diamond_use WHERE user_id=? AND wheel=?", (uid, wheel_id)).fetchone()
        if not row:
            db().execute("INSERT INTO diamond_use(user_id,wheel,day) VALUES(?,?,?) ON CONFLICT DO NOTHING", (uid, wheel_id, today))
            row = db().execute("SELECT * FROM diamond_use WHERE user_id=? AND wheel=?", (uid, wheel_id)).fetchone()
        if int(row['day']) != today:                                    # a new day: the counters start again, the guarantee counter stays
            db().execute("UPDATE diamond_use SET day=?,free_used=0,paid_used=0 WHERE user_id=? AND wheel=?", (today, uid, wheel_id))
            row = db().execute("SELECT * FROM diamond_use WHERE user_id=? AND wheel=?", (uid, wheel_id)).fetchone()
        return row

    def vip_level(cfg, xp):
        lv = 0
        for i, need in enumerate(cfg['vip_xp']):
            if xp >= int(need):
                lv = i
        return lv

    def wheel_of(cfg, wid):
        for w in cfg['wheels']:
            if w['id'] == wid:
                return w
        abort(400, description='Такого колеса нет')

    def limits(cfg, wheel, use, level):
        free_total = int(wheel['free_daily']) + (int(cfg['vip_extra_free'][level]) if int(wheel['free_daily']) > 0 else 0)
        disc = int(cfg['vip_discount'][level])
        paid_used = int(use['paid_used'])
        price = max(0, int(round((int(wheel['price_base']) + int(wheel['price_step']) * paid_used) * (100 - disc) / 100.0)))
        return {'free_total': free_total, 'free_left': max(0, free_total - int(use['free_used'])), 'paid_left': max(0, int(wheel['max_paid']) - paid_used), 'price': price, 'discount': disc,
                'locked': level < int(wheel['vip_min'])}

    def sector_view(wheel):
        total = sum(max(0, int(s['weight'])) for s in wheel['sectors']) or 1
        return [{'i': i, 'tier': s['tier'], 'jackpot': s['tier'] == 'jackpot', 'chance': round(int(s['weight']) / total * 100, 2), 'rewards': described(s['reward'])} for i, s in enumerate(wheel['sectors'])]

    def names_of(ids):
        out = {}
        if ids:
            for u in db().execute("SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id IN (%s)" % ','.join('?' * len(ids)), tuple(ids)).fetchall():
                out[int(u['id'])] = u
        return out

    def slot_day(uid, now):
        today = day_of(now)
        row = db().execute("SELECT * FROM diamond_slot_day WHERE user_id=?", (uid,)).fetchone()
        if not row:
            db().execute("INSERT INTO diamond_slot_day(user_id,day) VALUES(?,?) ON CONFLICT DO NOTHING", (uid, today))
            row = db().execute("SELECT * FROM diamond_slot_day WHERE user_id=?", (uid,)).fetchone()
        if int(row['day']) != today:
            db().execute("UPDATE diamond_slot_day SET day=?,spins=0,bets=0 WHERE user_id=?", (today, uid))
            row = db().execute("SELECT * FROM diamond_slot_day WHERE user_id=?", (uid,)).fetchone()
        return row

    def slots_view(cfg, uid, now):
        sl = cfg['slots']
        if not sl['enabled']:
            return {'enabled': False}
        day = slot_day(uid, now)
        total = sum(max(0, float(s['weight'])) for s in sl['symbols']) or 1.0
        last = db().execute("SELECT * FROM diamond_slot_spins WHERE user_id=? ORDER BY created DESC LIMIT 6", (uid,)).fetchall()
        return {'enabled': True, 'bets': [int(b) for b in sl['bets']], 'spins_left': max(0, int(sl['max_spins']) - int(day['spins'])), 'bet_left': max(0, int(sl['daily_bet_cap']) - int(day['bets'])),
                'symbols': [{'id': s['id'], 'chance': round(max(0, float(s['weight'])) / total * 100, 1), 'pay3': float(s['pay3']), 'pay2': float(s['pay2']), 'jackpot': s['id'] == 'diamond'} for s in sl['symbols']],
                'return': slot_rtp(sl['symbols']), 'last': [{'reels': json.loads(x['reels']), 'bet': int(x['bet']), 'win': int(x['win']), 'jackpot': int(x['jackpot']), 'at': int(x['created'])} for x in last]}

    def view(uid, now):
        cfg = settings()
        admin = bool(getattr(g, 'is_admin', False))
        base = {'enabled': bool(cfg['enabled']), 'admin': admin, 'title': cfg['title'], 'subtitle': cfg['subtitle'], 'now': now}
        if not cfg['enabled'] and not admin:
            return base
        urow = user_row(uid)
        xp = int(urow['xp'])
        level = vip_level(cfg, xp)
        nxt = int(cfg['vip_xp'][level + 1]) if level + 1 < len(cfg['vip_xp']) else None
        wheels = []
        for w in cfg['wheels']:
            use = use_row(uid, w['id'], now)
            lim = limits(cfg, w, use, level)
            wheels.append({'id': w['id'], 'title': w['title'], 'vip_min': int(w['vip_min']), 'locked': lim['locked'], 'free_left': lim['free_left'], 'free_total': lim['free_total'], 'paid_left': lim['paid_left'], 'max_paid': int(w['max_paid']),
                           'price': lim['price'], 'pity_every': int(w['pity_every']), 'pity_left': max(0, int(w['pity_every']) - int(use['pity'])), 'sectors': sector_view(w)})
        big = db().execute("SELECT * FROM diamond_spins WHERE tier IN ('epic','jackpot') ORDER BY created DESC LIMIT 8").fetchall()
        sbig = db().execute("SELECT * FROM diamond_slot_spins WHERE jackpot>0 ORDER BY created DESC LIMIT 4").fetchall()
        nm = names_of(list({int(b['user_id']) for b in list(big) + list(sbig)}))
        wins = [{'name': (nm.get(int(b['user_id'])) or {'name': ''})['name'] or 'Игрок', 'tier': b['tier'], 'jackpot': int(b['jackpot']), 'rewards': described(json.loads(b['reward'])), 'at': int(b['created']), 'where': b['wheel']} for b in big]
        wins += [{'name': (nm.get(int(b['user_id'])) or {'name': ''})['name'] or 'Игрок', 'tier': 'jackpot', 'jackpot': int(b['jackpot']), 'rewards': [], 'at': int(b['created']), 'where': 'slots'} for b in sbig]
        wins.sort(key=lambda x: -x['at'])
        mine = db().execute("SELECT * FROM diamond_spins WHERE user_id=? ORDER BY created DESC LIMIT 6", (uid,)).fetchall()
        return {**base, 'jackpot': pool_get(cfg), 'balls': balls_of(uid), 'wheels': wheels, 'slots': slots_view(cfg, uid, now),
                'vip': {'level': level, 'xp': xp, 'next': nxt, 'discount': int(cfg['vip_discount'][level]), 'levels': [{'need': int(n), 'free': int(cfg['wheels'][0]['free_daily']) + int(cfg['vip_extra_free'][i]), 'discount': int(cfg['vip_discount'][i])} for i, n in enumerate(cfg['vip_xp'])]},
                'spins': int(urow['spins']), 'wins': wins[:8], 'mine': [{'tier': m['tier'], 'mode': m['mode'], 'wheel': m['wheel'], 'jackpot': int(m['jackpot']), 'rewards': described(json.loads(m['reward'])), 'at': int(m['created'])} for m in mine]}

    @app.get('/api/diamond')
    @auth()
    def diamond_state():
        with db():
            return view(g.user['id'], int(time.time()))

    @app.get('/api/diamond/enabled')
    @auth()
    def diamond_enabled():
        cfg = settings()
        return {'enabled': bool(cfg['enabled']), 'title': cfg['title'], 'admin': bool(getattr(g, 'is_admin', False))}

    def pick(wheel, good_only):
        pairs = [(max(0, int(s['weight'])), i) for i, s in enumerate(wheel['sectors']) if (s['tier'] in ('rare', 'epic') if good_only else True)]
        total = sum(w for w, _ in pairs)
        if total <= 0:
            pairs = [(1, i) for i in range(len(wheel['sectors']))]
            total = len(pairs)
        point = RNG.uniform(0, total)
        for w, i in pairs:
            point -= w
            if point <= 0:
                return i
        return pairs[-1][1]

    @app.post('/api/diamond/spin')
    @auth()
    def diamond_spin():
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        mode = str(body.get('mode') or '')
        wid = str(body.get('wheel') or 'classic')
        rid = str(body.get('request_id') or '')[:64]
        if mode not in ('free', 'paid'):
            abort(400, description='Выберите бесплатную или платную прокрутку')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not cfg['enabled']:
                abort(409, description='Казино сейчас закрыто')
            wheel = wheel_of(cfg, wid)
            if rid:
                old = db().execute("SELECT * FROM diamond_spins WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
                if old:                                                 # the same request again: the same answer, nothing is given twice
                    return {'ok': True, 'again': True, 'wheel': old['wheel'], 'sector': int(old['sector']), 'tier': old['tier'], 'jackpot': int(old['jackpot']), 'rewards': described(json.loads(old['reward'])), 'state': view(uid, now)}
            urow = user_row(uid)
            level = vip_level(cfg, int(urow['xp']))
            use = use_row(uid, wid, now)
            lim = limits(cfg, wheel, use, level)
            if lim['locked']:
                abort(409, description='Это колесо открывается с VIP-уровня «%s»' % ('Бронза', 'Серебро', 'Золото', 'Бриллиант')[min(3, int(wheel['vip_min']))])
            price = 0
            pity = int(use['pity'])
            if mode == 'free':
                if lim['free_left'] <= 0:
                    abort(409, description='Бесплатные прокрутки на сегодня закончились')
            else:
                if lim['paid_left'] <= 0:
                    abort(409, description='Платные прокрутки на сегодня закончились')
                price = lim['price']
                pay(uid, price)
                pity += 1
            pool = pool_get(cfg)
            if price:
                pool += int(price * int(cfg['jackpot_rake']) / 100)
            guaranteed = mode == 'paid' and pity >= int(wheel['pity_every'])
            idx = pick(wheel, guaranteed)
            sector = wheel['sectors'][idx]
            prizes = [dict(r) for r in sector['reward']]
            jackpot = 0
            if sector['tier'] == 'jackpot':
                jackpot = pool
                prizes.append({'kind': 'BALL', 'amount': str(jackpot), 'count': 1})
                pool = int(cfg['jackpot_start'])
            if mode == 'paid' and (guaranteed or sector['tier'] in ('rare', 'epic', 'jackpot')):
                pity = 0
            pool_set(pool)
            xp = int(urow['xp']) + int(cfg['xp_paid'] if mode == 'paid' else cfg['xp_free'])
            db().execute("UPDATE diamond_users SET xp=?,spins=spins+1 WHERE user_id=?", (xp, uid))
            db().execute("UPDATE diamond_use SET free_used=free_used+?,paid_used=paid_used+?,pity=? WHERE user_id=? AND wheel=?", (1 if mode == 'free' else 0, 1 if mode == 'paid' else 0, pity, uid, wid))
            db().execute("INSERT INTO diamond_spins(id,user_id,request_id,mode,price,sector,tier,jackpot,reward,created,wheel) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (uuid.uuid4().hex, uid, rid, mode, price, idx, sector['tier'], jackpot, json.dumps(prizes), now, wid))
            given = app.extensions['crafter_reward_give'](uid, prizes, 'diamond:%s:%s' % (wid, mode)) if prizes else {'items': []}
            out = {'ok': True, 'wheel': wid, 'sector': idx, 'tier': sector['tier'], 'jackpot': jackpot, 'rewards': described(prizes), 'given': given, 'level_up': vip_level(cfg, xp) > level, 'state': view(uid, now)}
        audit('Diamond spin: %s %s sector %d by %s' % (wid, mode, idx, uid))
        return out

    # ------------------------------------------------------------------ the slots
    def pick_symbol(symbols):
        total = sum(max(0.0, float(s['weight'])) for s in symbols)
        if total <= 0:
            return symbols[0]['id']
        point = RNG.uniform(0, total)
        for s in symbols:
            point -= max(0.0, float(s['weight']))
            if point <= 0:
                return s['id']
        return symbols[-1]['id']

    @app.post('/api/diamond/slots/spin')
    @auth()
    def diamond_slots_spin():
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        rid = str(body.get('request_id') or '')[:64]
        try:
            bet = int(body.get('bet'))
        except (TypeError, ValueError):
            abort(400, description='Выберите ставку')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            sl = cfg['slots']
            if not cfg['enabled'] or not sl['enabled']:
                abort(409, description='Слоты сейчас закрыты')
            if bet not in [int(b) for b in sl['bets']]:
                abort(400, description='Такой ставки нет')
            if rid:
                old = db().execute("SELECT * FROM diamond_slot_spins WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
                if old:
                    return {'ok': True, 'again': True, 'reels': json.loads(old['reels']), 'bet': int(old['bet']), 'win': int(old['win']), 'jackpot': int(old['jackpot']), 'state': view(uid, now)}
            day = slot_day(uid, now)
            if int(day['spins']) >= int(sl['max_spins']):
                abort(409, description='Прокрутки слотов на сегодня закончились')
            if int(day['bets']) + bet > int(sl['daily_bet_cap']):
                abort(409, description='Лимит ставок на сегодня исчерпан')
            pay(uid, bet)
            reels = [pick_symbol(sl['symbols']) for _ in range(3)]
            by = {s['id']: s for s in sl['symbols']}
            pool = pool_get(cfg) + int(bet * int(sl['rake']) / 100)
            win = jackpot = 0
            mult = 0.0
            if reels[0] == reels[1] == reels[2]:
                if reels[0] == 'diamond':
                    jackpot = pool
                    pool = int(cfg['jackpot_start'])
                else:
                    mult = float(by[reels[0]]['pay3'])
            elif reels[0] == reels[1]:
                mult = float(by[reels[0]]['pay2'])
            win = int(bet * mult)
            pool_set(pool)
            urow = user_row(uid)
            xp = int(urow['xp']) + int(sl['xp'])
            level = vip_level(cfg, int(urow['xp']))
            db().execute("UPDATE diamond_users SET xp=?,spins=spins+1 WHERE user_id=?", (xp, uid))
            db().execute("UPDATE diamond_slot_day SET spins=spins+1,bets=bets+? WHERE user_id=?", (bet, uid))
            db().execute("INSERT INTO diamond_slot_spins(id,user_id,request_id,bet,reels,win,jackpot,created) VALUES(?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, uid, rid, bet, json.dumps(reels), win, jackpot, now))
            total = win + jackpot
            given = app.extensions['crafter_reward_give'](uid, ball(total), 'diamond:slots') if total > 0 else {'items': []}
            out = {'ok': True, 'reels': reels, 'bet': bet, 'win': win, 'jackpot': jackpot, 'mult': mult, 'given': given, 'level_up': vip_level(cfg, xp) > level, 'state': view(uid, now)}
        audit('Diamond slots: bet %d win %d by %s' % (bet, win + jackpot, uid))
        return out

    # ------------------------------------------------------------------ admin
    def num(v, lo, hi, what):
        try:
            n = int(float(str(v).replace(',', '.').replace(' ', '')))
        except (TypeError, ValueError):
            abort(400, description='%s: нужно число' % what)
        if not lo <= n <= hi:
            abort(400, description='%s: от %d до %d' % (what, lo, hi))
        return n

    def fnum(v, lo, hi, what):
        try:
            n = float(str(v).replace(',', '.').replace(' ', ''))
        except (TypeError, ValueError):
            abort(400, description='%s: нужно число' % what)
        if not lo <= n <= hi:
            abort(400, description='%s: от %s до %s' % (what, lo, hi))
        return round(n, 3)

    def admin_view():
        cfg = settings()
        st = db().execute("SELECT COUNT(*) AS n,SUM(price) AS p,SUM(CASE WHEN mode='paid' THEN 1 ELSE 0 END) AS paid FROM diamond_spins").fetchone()
        ss = db().execute("SELECT COUNT(*) AS n,SUM(bet) AS b,SUM(win) AS w FROM diamond_slot_spins").fetchone()
        jp = db().execute("SELECT * FROM diamond_spins WHERE tier='jackpot' ORDER BY created DESC LIMIT 5").fetchall()
        nm = names_of(list({int(b['user_id']) for b in jp}))
        return {'settings': cfg, 'pool': pool_get(cfg), 'stats': {'spins': int(st['n'] or 0), 'paid': int(st['paid'] or 0), 'income': int(st['p'] or 0), 'slot_spins': int(ss['n'] or 0), 'slot_bets': int(ss['b'] or 0), 'slot_wins': int(ss['w'] or 0)},
                'return': slot_rtp(cfg['slots']['symbols']),
                'jackpots': [{'user_id': str(b['user_id']), 'name': (nm.get(int(b['user_id'])) or {'name': ''})['name'], 'amount': int(b['jackpot']), 'at': int(b['created'])} for b in jp]}

    @app.get('/api/admin/diamond')
    @auth(admin=True)
    def admin_diamond():
        with db():
            return admin_view()

    def wheel_in(src, old, i):
        label = 'Колесо %d' % (i + 1)
        w = dict(old)
        w['title'] = ' '.join(str(src.get('title') or old['title']).split())[:24] or old['title']
        w['vip_min'] = num(src.get('vip_min', old['vip_min']), 0, 3, label + ': VIP-уровень')
        for key, lo, hi, what in (('free_daily', 0, 20, 'бесплатных в день'), ('max_paid', 0, 50, 'платных в день'), ('price_base', 0, 10000000, 'цена первой'), ('price_step', 0, 10000000, 'рост цены'), ('pity_every', 2, 100, 'гарантия каждые N')):
            w[key] = num(src.get(key, old[key]), lo, hi, label + ': ' + what)
        sectors = src.get('sectors')
        if isinstance(sectors, list):
            if len(sectors) != SECTORS:
                abort(400, description='%s: секторов должно быть %d' % (label, SECTORS))
            new = []
            for k, sec in enumerate(sectors):
                tier = str(sec.get('tier') or 'common')
                if tier not in TIERS:
                    abort(400, description='%s, сектор %d: неизвестный уровень' % (label, k + 1))
                reward = clean(sec.get('reward') or [], 'Сектор %d' % (k + 1))
                if not reward and tier != 'jackpot':
                    abort(400, description='%s, сектор %d: нужна награда' % (label, k + 1))
                new.append({'reward': reward, 'weight': num(sec.get('weight'), 0, 100000, '%s: вес сектора %d' % (label, k + 1)), 'tier': tier})
            if sum(x['weight'] for x in new) <= 0:
                abort(400, description='%s: сумма весов должна быть больше нуля' % label)
            if not any(x['tier'] == 'jackpot' for x in new):
                abort(400, description='%s: нужен хотя бы один сектор джекпота' % label)
            if not any(x['tier'] in ('rare', 'epic') for x in new):
                abort(400, description='%s: нужен редкий или эпический сектор для гарантии' % label)
            w['sectors'] = new
        return w

    @app.post('/api/admin/diamond')
    @auth(admin=True)
    def admin_diamond_save():
        s = request.get_json(silent=True) or {}
        with db():
            cfg = settings()
            cfg['enabled'] = bool(s.get('enabled'))
            cfg['title'] = ' '.join(str(s.get('title') or cfg['title']).split())[:60] or cfg['title']
            cfg['subtitle'] = ' '.join(str(s.get('subtitle') or '').split())[:160]
            for key, lo, hi, label in (('jackpot_start', 0, 1000000000, 'Стартовый джекпот'), ('jackpot_rake', 0, 100, 'Доля в джекпот, %'), ('xp_free', 0, 1000, 'Опыт за бесплатную'), ('xp_paid', 0, 1000, 'Опыт за платную')):
                cfg[key] = num(s.get(key, cfg[key]), lo, hi, label)
            for key, label, hi in (('vip_xp', 'Опыт для VIP', 10000000), ('vip_extra_free', 'Бонусные бесплатные', 20), ('vip_discount', 'Скидка VIP, %', 100)):
                src = s.get(key)
                if isinstance(src, list):
                    if len(src) != 4:
                        abort(400, description='%s: нужно 4 значения' % label)
                    cfg[key] = [num(v, 0, hi, label) for v in src]
            if cfg['vip_xp'][0] != 0 or any(cfg['vip_xp'][i] >= cfg['vip_xp'][i + 1] for i in range(3)):
                abort(400, description='Опыт для VIP: от нуля и по возрастанию')
            ws = s.get('wheels')
            if isinstance(ws, list):
                by = {w.get('id'): w for w in ws if isinstance(w, dict)}
                cfg['wheels'] = [wheel_in(by.get(old['id']) or {}, old, i) for i, old in enumerate(cfg['wheels'])]
            sl = s.get('slots')
            if isinstance(sl, dict):
                new = dict(cfg['slots'])
                new['enabled'] = bool(sl.get('enabled'))
                bets = sl.get('bets')
                if isinstance(bets, list):
                    vals = sorted({num(b, 1, 100000000, 'Ставка') for b in bets if str(b).strip()})
                    if not 1 <= len(vals) <= 6:
                        abort(400, description='Ставок должно быть от 1 до 6')
                    new['bets'] = vals
                for key, lo, hi, label in (('max_spins', 1, 100000, 'Прокруток слотов в день'), ('daily_bet_cap', 1, 1000000000, 'Лимит ставок в день'), ('rake', 0, 100, 'Доля ставки в джекпот, %'), ('xp', 0, 1000, 'Опыт за прокрутку')):
                    new[key] = num(sl.get(key, new[key]), lo, hi, label)
                syms = sl.get('symbols')
                if isinstance(syms, list):
                    if [x.get('id') for x in syms] != list(SLOT_IDS):
                        abort(400, description='Символы слотов: нужны все %d, по порядку' % len(SLOT_IDS))
                    new['symbols'] = [{'id': x['id'], 'weight': fnum(x.get('weight'), 0, 100000, 'Вес символа'), 'pay3': fnum(x.get('pay3', 0), 0, 100000, 'Выплата за три'), 'pay2': fnum(x.get('pay2', 0), 0, 100000, 'Выплата за два')} for x in syms]
                    if sum(x['weight'] for x in new['symbols']) <= 0:
                        abort(400, description='Сумма весов символов должна быть больше нуля')
                    r = slot_rtp(new['symbols'])
                    if r['rtp'] > 150:
                        abort(400, description='Отдача слотов %s%%: так игроки будут выигрывать больше, чем ставят. Уменьшите выплаты' % r['rtp'])
                cfg['slots'] = new
            save_settings(cfg)
        audit('Diamond settings saved')
        with db():
            return admin_view()

    @app.post('/api/admin/diamond/pool')
    @auth(admin=True)
    def admin_diamond_pool():
        amount = num((request.get_json(silent=True) or {}).get('amount'), 0, 1000000000, 'Джекпот')
        with db():
            db().execute('BEGIN IMMEDIATE')
            pool_set(amount)
        audit('Diamond jackpot set to %d' % amount)
        with db():
            return admin_view()
