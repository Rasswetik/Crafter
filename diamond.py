"""The casino «Diamond»: the wheel of fortune with a growing jackpot and VIP levels.

12 sectors with prizes from the real catalog (set in the admin). One free spin a day (more with the VIP level), more spins for balls (the price grows during the day, there is a limit
of paid spins a day). Every tenth paid spin is a guaranteed good prize. A part of every paid spin goes to the common jackpot, the jackpot sector gives the whole pool and the pool
starts again. Everything is decided here (the client only turns the wheel to the answer); a repeated request does not give a second spin; the odds are shown to the players.
"""
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
RNG = secrets.SystemRandom()


def ball(n):
    return [{'kind': 'BALL', 'amount': str(n), 'count': 1}]


def default_sectors():
    pack = lambda n: [{'kind': 'PACK', 'amount': 'vicecity', 'count': n}]
    rows = [(ball(50), 220, 'common'), (ball(100), 170, 'common'), (pack(1), 80, 'rare'), (ball(200), 120, 'common'), (ball(75), 180, 'common'), (ball(400), 40, 'rare'),
            (ball(500), 50, 'rare'), (ball(150), 100, 'common'), (pack(2), 25, 'epic'), (ball(300), 60, 'rare'), (ball(1000), 20, 'epic'), ([], 10, 'jackpot')]
    return [{'reward': r, 'weight': w, 'tier': t} for r, w, t in rows]


def default_settings():
    return {'enabled': False, 'title': 'Казино Diamond', 'subtitle': 'Крутите колесо, копите VIP-уровень и ловите общий джекпот.',
            'sectors': default_sectors(), 'free_daily': 1, 'max_paid': 5, 'price_base': 100, 'price_step': 100, 'pity_every': 10,
            'jackpot_start': 5000, 'jackpot_rake': 20,
            'vip_xp': [0, 100, 400, 1200], 'vip_extra_free': [0, 1, 1, 2], 'vip_discount': [0, 5, 10, 20], 'xp_free': 5, 'xp_paid': 10}


def day_of(now):
    return int((now + 3 * 3600) // 86400)


def install_diamond(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS diamond_users (
                user_id BIGINT PRIMARY KEY, day BIGINT NOT NULL DEFAULT 0, free_used BIGINT NOT NULL DEFAULT 0, paid_used BIGINT NOT NULL DEFAULT 0,
                xp BIGINT NOT NULL DEFAULT 0, pity BIGINT NOT NULL DEFAULT 0, spins BIGINT NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS diamond_state (key TEXT PRIMARY KEY, value BIGINT NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS diamond_spins (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, request_id TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0, sector BIGINT NOT NULL,
                tier TEXT NOT NULL, jackpot BIGINT NOT NULL DEFAULT 0, reward TEXT NOT NULL DEFAULT '[]', created BIGINT NOT NULL
            );
        """)

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

    def user_row(uid, now):
        today = day_of(now)
        row = db().execute("SELECT * FROM diamond_users WHERE user_id=?", (uid,)).fetchone()
        if not row:
            db().execute("INSERT INTO diamond_users(user_id,day) VALUES(?,?) ON CONFLICT DO NOTHING", (uid, today))
            row = db().execute("SELECT * FROM diamond_users WHERE user_id=?", (uid,)).fetchone()
        if int(row['day']) != today:
            db().execute("UPDATE diamond_users SET day=?,free_used=0,paid_used=0 WHERE user_id=?", (today, uid))
            row = db().execute("SELECT * FROM diamond_users WHERE user_id=?", (uid,)).fetchone()
        return row

    def vip_level(cfg, xp):
        lv = 0
        for i, need in enumerate(cfg['vip_xp']):
            if xp >= int(need):
                lv = i
        return lv

    def limits(cfg, row):
        lv = vip_level(cfg, int(row['xp']))
        free_total = int(cfg['free_daily']) + int(cfg['vip_extra_free'][lv])
        disc = int(cfg['vip_discount'][lv])
        paid_used = int(row['paid_used'])
        price = max(0, int(round((int(cfg['price_base']) + int(cfg['price_step']) * paid_used) * (100 - disc) / 100.0)))
        return {'level': lv, 'free_total': free_total, 'free_left': max(0, free_total - int(row['free_used'])), 'paid_left': max(0, int(cfg['max_paid']) - paid_used), 'price': price, 'discount': disc}

    def sector_view(cfg):
        total = sum(max(0, int(s['weight'])) for s in cfg['sectors']) or 1
        out = []
        for i, s in enumerate(cfg['sectors']):
            out.append({'i': i, 'tier': s['tier'], 'jackpot': s['tier'] == 'jackpot', 'chance': round(int(s['weight']) / total * 100, 2), 'rewards': described(s['reward'])})
        return out

    def names_of(ids):
        out = {}
        if ids:
            for u in db().execute("SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id IN (%s)" % ','.join('?' * len(ids)), tuple(ids)).fetchall():
                out[int(u['id'])] = u
        return out

    def view(uid, now):
        cfg = settings()
        admin = bool(getattr(g, 'is_admin', False))
        base = {'enabled': bool(cfg['enabled']), 'admin': admin, 'title': cfg['title'], 'subtitle': cfg['subtitle'], 'now': now}
        if not cfg['enabled'] and not admin:
            return base
        row = user_row(uid, now)
        lim = limits(cfg, row)
        xp = int(row['xp'])
        nxt = int(cfg['vip_xp'][lim['level'] + 1]) if lim['level'] + 1 < len(cfg['vip_xp']) else None
        big = db().execute("SELECT * FROM diamond_spins WHERE tier IN ('epic','jackpot') ORDER BY created DESC LIMIT 8").fetchall()
        nm = names_of(list({int(b['user_id']) for b in big}))
        wins = [{'name': (nm.get(int(b['user_id'])) or {'name': ''})['name'] or 'Игрок', 'tier': b['tier'], 'jackpot': int(b['jackpot']), 'rewards': described(json.loads(b['reward'])), 'at': int(b['created'])} for b in big]
        mine = db().execute("SELECT * FROM diamond_spins WHERE user_id=? ORDER BY created DESC LIMIT 6", (uid,)).fetchall()
        return {**base, 'jackpot': pool_get(cfg), 'sectors': sector_view(cfg), 'balls': balls_of(uid), 'free_left': lim['free_left'], 'free_total': lim['free_total'], 'paid_left': lim['paid_left'], 'max_paid': int(cfg['max_paid']), 'price': lim['price'],
                'vip': {'level': lim['level'], 'xp': xp, 'next': nxt, 'discount': lim['discount'], 'levels': [{'need': int(n), 'free': int(cfg['free_daily']) + int(cfg['vip_extra_free'][i]), 'discount': int(cfg['vip_discount'][i])} for i, n in enumerate(cfg['vip_xp'])]},
                'pity_left': max(0, int(cfg['pity_every']) - int(row['pity'])), 'pity_every': int(cfg['pity_every']), 'spins': int(row['spins']), 'wins': wins,
                'mine': [{'tier': m['tier'], 'mode': m['mode'], 'jackpot': int(m['jackpot']), 'rewards': described(json.loads(m['reward'])), 'at': int(m['created'])} for m in mine]}

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

    def pick(cfg, good_only):
        pairs = [(max(0, int(s['weight'])), i) for i, s in enumerate(cfg['sectors']) if (s['tier'] in ('rare', 'epic') if good_only else True)]
        total = sum(w for w, _ in pairs)
        if total <= 0:
            pairs = [(1, i) for i in range(len(cfg['sectors']))]
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
        rid = str(body.get('request_id') or '')[:64]
        if mode not in ('free', 'paid'):
            abort(400, description='Выберите бесплатную или платную прокрутку')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not cfg['enabled']:
                abort(409, description='Казино сейчас закрыто')
            if rid:
                old = db().execute("SELECT * FROM diamond_spins WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
                if old:                                                 # the same request again: the answer is the same, nothing is given twice
                    return {'ok': True, 'again': True, 'sector': int(old['sector']), 'tier': old['tier'], 'jackpot': int(old['jackpot']), 'rewards': described(json.loads(old['reward'])), 'state': view(uid, now)}
            row = user_row(uid, now)
            lim = limits(cfg, row)
            price = 0
            pity = int(row['pity'])
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
            guaranteed = mode == 'paid' and pity >= int(cfg['pity_every'])
            idx = pick(cfg, guaranteed)
            sector = cfg['sectors'][idx]
            prizes = [dict(r) for r in sector['reward']]
            jackpot = 0
            if sector['tier'] == 'jackpot':
                jackpot = pool
                prizes.append({'kind': 'BALL', 'amount': str(jackpot), 'count': 1})
                pool = int(cfg['jackpot_start'])
            if mode == 'paid' and (guaranteed or sector['tier'] in ('rare', 'epic', 'jackpot')):
                pity = 0
            pool_set(pool)
            xp = int(row['xp']) + int(cfg['xp_paid'] if mode == 'paid' else cfg['xp_free'])
            db().execute("UPDATE diamond_users SET free_used=free_used+?,paid_used=paid_used+?,xp=?,pity=?,spins=spins+1 WHERE user_id=?", (1 if mode == 'free' else 0, 1 if mode == 'paid' else 0, xp, pity, uid))
            db().execute("INSERT INTO diamond_spins(id,user_id,request_id,mode,price,sector,tier,jackpot,reward,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                         (uuid.uuid4().hex, uid, rid, mode, price, idx, sector['tier'], jackpot, json.dumps(prizes), now))
            given = app.extensions['crafter_reward_give'](uid, prizes, 'diamond:%s' % mode) if prizes else {'items': []}
            out = {'ok': True, 'sector': idx, 'tier': sector['tier'], 'jackpot': jackpot, 'rewards': described(prizes), 'given': given, 'level_up': vip_level(cfg, xp) > lim['level'], 'state': view(uid, now)}
        audit('Diamond spin: %s sector %d by %s' % (mode, idx, uid))
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

    def admin_view():
        cfg = settings()
        st = db().execute("SELECT COUNT(*) AS n,SUM(price) AS p,SUM(CASE WHEN mode='paid' THEN 1 ELSE 0 END) AS paid FROM diamond_spins").fetchone()
        jp = db().execute("SELECT * FROM diamond_spins WHERE tier='jackpot' ORDER BY created DESC LIMIT 5").fetchall()
        nm = names_of(list({int(b['user_id']) for b in jp}))
        return {'settings': cfg, 'pool': pool_get(cfg), 'stats': {'spins': int(st['n'] or 0), 'paid': int(st['paid'] or 0), 'income': int(st['p'] or 0)},
                'jackpots': [{'user_id': str(b['user_id']), 'name': (nm.get(int(b['user_id'])) or {'name': ''})['name'], 'amount': int(b['jackpot']), 'at': int(b['created'])} for b in jp]}

    @app.get('/api/admin/diamond')
    @auth(admin=True)
    def admin_diamond():
        with db():
            return admin_view()

    @app.post('/api/admin/diamond')
    @auth(admin=True)
    def admin_diamond_save():
        s = request.get_json(silent=True) or {}
        with db():
            cfg = settings()
            cfg['enabled'] = bool(s.get('enabled'))
            cfg['title'] = ' '.join(str(s.get('title') or cfg['title']).split())[:60] or cfg['title']
            cfg['subtitle'] = ' '.join(str(s.get('subtitle') or '').split())[:160]
            for key, lo, hi, label in (('free_daily', 0, 20, 'Бесплатных прокруток в день'), ('max_paid', 0, 50, 'Платных прокруток в день'), ('price_base', 0, 10000000, 'Цена первой платной'), ('price_step', 0, 10000000, 'Рост цены'),
                                       ('pity_every', 2, 100, 'Гарантия каждые N платных'), ('jackpot_start', 0, 1000000000, 'Стартовый джекпот'), ('jackpot_rake', 0, 100, 'Доля в джекпот, %'),
                                       ('xp_free', 0, 1000, 'Опыт за бесплатную'), ('xp_paid', 0, 1000, 'Опыт за платную')):
                cfg[key] = num(s.get(key, cfg[key]), lo, hi, label)
            for key, label, hi in (('vip_xp', 'Опыт для VIP', 10000000), ('vip_extra_free', 'Бонусные бесплатные', 20), ('vip_discount', 'Скидка VIP, %', 100)):
                src = s.get(key)
                if isinstance(src, list):
                    if len(src) != 4:
                        abort(400, description='%s: нужно 4 значения' % label)
                    cfg[key] = [num(v, 0, hi, label) for v in src]
            if cfg['vip_xp'][0] != 0 or any(cfg['vip_xp'][i] >= cfg['vip_xp'][i + 1] for i in range(3)):
                abort(400, description='Опыт для VIP: от нуля и по возрастанию')
            sectors = s.get('sectors')
            if isinstance(sectors, list):
                if len(sectors) != SECTORS:
                    abort(400, description='Секторов должно быть %d' % SECTORS)
                new = []
                for i, sec in enumerate(sectors):
                    tier = str(sec.get('tier') or 'common')
                    if tier not in TIERS:
                        abort(400, description='Сектор %d: неизвестный уровень' % (i + 1))
                    reward = clean(sec.get('reward') or [], 'Сектор %d' % (i + 1))
                    if not reward and tier != 'jackpot':
                        abort(400, description='Сектор %d: нужна награда' % (i + 1))
                    new.append({'reward': reward, 'weight': num(sec.get('weight'), 0, 100000, 'Вес сектора %d' % (i + 1)), 'tier': tier})
                if sum(x['weight'] for x in new) <= 0:
                    abort(400, description='Сумма весов должна быть больше нуля')
                if not any(x['tier'] == 'jackpot' for x in new):
                    abort(400, description='Нужен хотя бы один сектор джекпота')
                if not any(x['tier'] in ('rare', 'epic') for x in new):
                    abort(400, description='Нужен хотя бы один редкий или эпический сектор для гарантии')
                cfg['sectors'] = new
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
