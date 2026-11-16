"""The event «Войны банд»: Гошан против Николая (Vice City).

Every week (Monday 00:00 - Sunday 24:00, Moscow time) two gangs fight for six districts. A player joins one gang; the points come from the history of the player
(arena rounds, packs, upgrades, crafts, purchases...), so no other module has to be changed. A district goes to the gang that has more points in the action that belongs
to it. The gang with fewer players gets a multiplier of points (so the war stays fair), and a player can bring only a limited number of points a day.
When the week is over the server sums everything up once (lazily, on the first request), and every player takes his prizes with a button: for the victory or
a consolation prize, for every district of his gang, for his personal level and for a place in the common top. All prizes come from the real catalog.
"""
import json
import time
from datetime import datetime, timedelta, timezone

from flask import abort, g, request

from wanted import POINTS

SETTINGS_KEY = 'gangs_v1'
MSK = timezone(timedelta(hours=3))
GANG_IDS = ('goshan', 'nikolay')
COLORS = {'goshan': '#27d3ff', 'nikolay': '#ff4fa8'}
DISTRICTS = (
    ('beach', 'Оушен-Бич', 'Открывайте паки', ('pack_open',)),
    ('downtown', 'Даунтаун', 'Играйте на арене', ('arena_result',)),
    ('havana', 'Малая Гавана', 'Делайте апгрейды', ('upgrade',)),
    ('port', 'Порт', 'Крафтите подарки', ('craft',)),
    ('island', 'Стар-Айленд', 'Покупайте и продавайте', ('shop_item_buy', 'buy', 'sale')),
    ('point', 'Вайс-Пойнт', 'Забирайте цепочки и подарки', ('chain_claim', 'freebie_claim')),
)
KIND_DISTRICT = {k: d[0] for d in DISTRICTS for k in d[3]}
RANKS = ((0, 'Новичок'), (50, 'Бегун'), (150, 'Водила'), (400, 'Авторитет'), (900, 'Легенда'))


def ball(n):
    return [{'kind': 'BALL', 'amount': str(n), 'count': 1}]


def default_settings():
    return {'enabled': False, 'title': 'Войны банд', 'subtitle': 'Гошан против Николая: захватывайте районы Вайс-Сити всю неделю.',
            'gangs': {'goshan': {'name': 'Гошан', 'slogan': 'Бирюзовая волна'}, 'nikolay': {'name': 'Николай', 'slogan': 'Розовый закат'}},
            'daily_cap': 300, 'underdog_max': 150, 'min_points': 20,
            'win_reward': ball(1500), 'lose_reward': ball(400), 'district_reward': ball(200),
            'tiers': [{'points': 50, 'reward': ball(100)}, {'points': 150, 'reward': ball(300)}, {'points': 400, 'reward': [{'kind': 'PACK', 'amount': 'vicecity', 'count': 1}]}],
            'top_places': 3, 'top_rewards': {'1': ball(3000), '2': ball(1500), '3': ball(700)}}


def week_bounds(now):
    d = datetime.fromtimestamp(now, MSK)
    start = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(start.timestamp()), int((start + timedelta(days=7)).timestamp())


def week_id(start):
    iso = datetime.fromtimestamp(start, MSK).isocalendar()
    return '%d-W%02d' % (iso[0], iso[1])


def rank_of(points):
    cur, nxt = RANKS[0], None
    for i, r in enumerate(RANKS):
        if points >= r[0]:
            cur = r
            nxt = RANKS[i + 1] if i + 1 < len(RANKS) else None
    return {'level': RANKS.index(cur) + 1, 'title': cur[1], 'next': {'title': nxt[1], 'need': nxt[0]} if nxt else None}


def install_gangs(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS gang_members (user_id BIGINT PRIMARY KEY, gang TEXT NOT NULL, joined BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS gang_wars (war TEXT PRIMARY KEY, winner TEXT NOT NULL DEFAULT '', gangs TEXT NOT NULL DEFAULT '{}', districts TEXT NOT NULL DEFAULT '{}', cfg TEXT NOT NULL DEFAULT '{}', created BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS gang_war_users (
                war TEXT NOT NULL, user_id BIGINT NOT NULL, gang TEXT NOT NULL, points BIGINT NOT NULL, top BIGINT NOT NULL DEFAULT 0, claimed BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY(war, user_id)
            );
        """)
    cache = {'t': 0, 'key': None, 'v': None}

    # ------------------------------------------------------------------ settings
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
        cache['v'] = None

    def clean(raw, where):
        return app.extensions['crafter_reward_clean'](raw if isinstance(raw, list) else [])

    def described(rewards):
        return [app.extensions['crafter_reward_describe'](dict(r)) for r in rewards]

    # ------------------------------------------------------------------ the count of points
    def compute(start, end, cfg):
        """Points of every member, of the gangs and of the districts for the window [start, end)."""
        members = {int(m['user_id']): (m['gang'], int(m['joined'])) for m in db().execute("SELECT * FROM gang_members WHERE joined<?", (end,)).fetchall()}
        counts = {g_: 0 for g_ in GANG_IDS}
        for gang, _ in members.values():
            if gang in counts:
                counts[gang] += 1
        marks = ','.join('?' * len(POINTS))
        rows = db().execute(
            "SELECT h.user_id AS uid,h.kind AS kind,(h.created+10800)/86400 AS d,COUNT(*) AS n FROM history h JOIN gang_members m ON m.user_id=h.user_id "
            "WHERE h.kind IN (%s) AND h.created>=? AND h.created<? AND h.created>=m.joined GROUP BY h.user_id,h.kind,(h.created+10800)/86400" % marks, (*POINTS, start, end)).fetchall()
        per_day = {}
        for r in rows:
            per_day.setdefault((int(r['uid']), int(r['d'])), []).append((r['kind'], int(r['n'])))
        cap = int(cfg['daily_cap'])
        users, dist = {}, {d[0]: {g_: 0.0 for g_ in GANG_IDS} for d in DISTRICTS}
        for (uid, _), items in per_day.items():
            if uid not in members:
                continue
            gang = members[uid][0]
            raw = sum(POINTS[k] * n for k, n in items)
            scale = min(1.0, cap / raw) if cap > 0 and raw > 0 else 1.0
            for k, n in items:
                p = POINTS[k] * n * scale
                users[uid] = users.get(uid, 0.0) + p
                if gang in dist[KIND_DISTRICT[k]]:
                    dist[KIND_DISTRICT[k]][gang] += p
        totals = {g_: 0.0 for g_ in GANG_IDS}
        for uid, p in users.items():
            totals[members[uid][0]] += p
        mult = {g_: 1.0 for g_ in GANG_IDS}
        # the multiplier looks at the players who really play this week, so a crowd of sleeping accounts does not give the other gang a bonus
        active = {g_: sum(1 for u, p in users.items() if p > 0 and members[u][0] == g_) for g_ in GANG_IDS}
        big, small = max(GANG_IDS, key=lambda x: active[x]), min(GANG_IDS, key=lambda x: active[x])
        if active[small] > 0 and active[big] > active[small]:
            mult[small] = min(active[big] / active[small], max(1.0, int(cfg['underdog_max']) / 100.0))
        score = {g_: totals[g_] * mult[g_] for g_ in GANG_IDS}
        owner = {}
        for key, per in dist.items():
            a, b = per['goshan'] * mult['goshan'], per['nikolay'] * mult['nikolay']
            owner[key] = 'goshan' if a > b else 'nikolay' if b > a else ''
        winner = 'goshan' if score['goshan'] > score['nikolay'] else 'nikolay' if score['nikolay'] > score['goshan'] else ''
        return {'members': members, 'counts': counts, 'users': users, 'raw': totals, 'mult': mult, 'score': score, 'dist': dist, 'owner': owner, 'winner': winner}

    def current(cfg, now):
        start, end = week_bounds(now)
        if not app.testing and cache['v'] is not None and cache['key'] == (start, now // 20):
            return cache['v']
        v = compute(start, end, cfg)
        cache.update(v=v, key=(start, now // 20))
        return v

    def finalize_old(now):
        """Sums up the finished weeks that have not been summed up (the four last ones). Done before anything changes in the gangs."""
        cfg = settings()
        start, _ = week_bounds(now)
        for k in range(1, 5):
            s = start - k * 7 * 86400
            e = s + 7 * 86400
            wid = week_id(s)
            if db().execute("SELECT 1 FROM gang_wars WHERE war=?", (wid,)).fetchone():
                continue
            c = compute(s, e, cfg)
            if not c['users']:
                continue
            order = sorted(c['users'].items(), key=lambda x: (-x[1], x[0]))
            top = {uid: i + 1 for i, (uid, p) in enumerate(order[:int(cfg['top_places'])]) if p >= int(cfg['min_points'])}
            snap = {key: cfg[key] for key in ('win_reward', 'lose_reward', 'district_reward', 'tiers', 'top_rewards', 'min_points')}
            db().execute("INSERT INTO gang_wars(war,winner,gangs,districts,cfg,created) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                         (wid, c['winner'], json.dumps({g_: int(c['score'][g_]) for g_ in GANG_IDS}), json.dumps(c['owner']), json.dumps(snap), int(time.time())))
            for uid, p in c['users'].items():
                db().execute("INSERT INTO gang_war_users(war,user_id,gang,points,top) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING", (wid, uid, c['members'][uid][0], int(p), top.get(uid, 0)))

    def rewards_for(war, row):
        """What a player takes for a finished war: a list of rewards (empty when he did too little)."""
        snap = json.loads(war['cfg'])
        pts = int(row['points'])
        if pts < int(snap.get('min_points', 0)):
            return []
        owner = json.loads(war['districts'])
        out = list(snap['win_reward'] if war['winner'] == row['gang'] else snap['lose_reward'])
        for _ in range(sum(1 for v in owner.values() if v == row['gang'])):
            out += snap['district_reward']
        reached = [t for t in snap['tiers'] if pts >= int(t['points'])]
        if reached:
            out += max(reached, key=lambda t: int(t['points']))['reward']
        if int(row['top']):
            out += snap['top_rewards'].get(str(int(row['top'])), [])
        return out

    def my_state(uid, cfg, c, now):
        mem = c['members'].get(uid)
        if not mem:
            row = db().execute("SELECT * FROM gang_members WHERE user_id=?", (uid,)).fetchone()
            mem = (row['gang'], int(row['joined'])) if row else None
        if not mem:
            return None
        pts = int(c['users'].get(uid, 0))
        gang_users = sorted(((u, p) for u, p in c['users'].items() if c['members'][u][0] == mem[0]), key=lambda x: (-x[1], x[0]))
        rank = next((i + 1 for i, (u, _) in enumerate(gang_users) if u == uid), None)
        d0 = now - (now + 10800) % 86400
        rows = db().execute("SELECT kind,COUNT(*) AS n FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created>=? GROUP BY kind" % ','.join('?' * len(POINTS)), (uid, *POINTS, d0, mem[1])).fetchall()
        today = sum(POINTS[r['kind']] * int(r['n']) for r in rows)
        return {'gang': mem[0], 'points': pts, 'rank_in_gang': rank, 'rank': rank_of(pts), 'today': min(today, int(cfg['daily_cap'])) if int(cfg['daily_cap']) else today, 'cap': int(cfg['daily_cap']),
                'can_switch': pts == 0, 'tiers': [{'points': int(t['points']), 'reward': described(t['reward']), 'reached': pts >= int(t['points'])} for t in cfg['tiers']]}

    def view(uid, now):
        cfg = settings()
        admin = bool(getattr(g, 'is_admin', False))
        base = {'enabled': bool(cfg['enabled']), 'admin': admin, 'title': cfg['title'], 'subtitle': cfg['subtitle'], 'now': now}
        if not cfg['enabled'] and not admin:
            return base
        finalize_old(now)
        c = current(cfg, now)
        start, end = week_bounds(now)
        gangs = []
        total = c['score']['goshan'] + c['score']['nikolay']
        for gid in GANG_IDS:
            gangs.append({'id': gid, 'name': cfg['gangs'][gid]['name'], 'slogan': cfg['gangs'][gid]['slogan'], 'color': COLORS[gid], 'members': c['counts'][gid], 'points': int(c['score'][gid]),
                          'raw': int(c['raw'][gid]), 'mult': round(c['mult'][gid], 2), 'share': round(c['score'][gid] / total * 100, 1) if total else 50.0})
        districts = [{'key': d[0], 'title': d[1], 'hint': d[2], 'goshan': int(c['dist'][d[0]]['goshan'] * c['mult']['goshan']), 'nikolay': int(c['dist'][d[0]]['nikolay'] * c['mult']['nikolay']), 'owner': c['owner'][d[0]]} for d in DISTRICTS]
        claims = []
        for war in db().execute("SELECT * FROM gang_wars ORDER BY war DESC LIMIT 4").fetchall():
            row = db().execute("SELECT * FROM gang_war_users WHERE war=? AND user_id=?", (war['war'], uid)).fetchone()
            if not row:
                continue
            rewards = rewards_for(war, row)
            claims.append({'war': war['war'], 'gang': row['gang'], 'won': war['winner'] == row['gang'], 'draw': not war['winner'], 'points': int(row['points']), 'top': int(row['top']), 'districts': sum(1 for v in json.loads(war['districts']).values() if v == row['gang']),
                           'claimed': bool(row['claimed']), 'rewards': described(rewards)})
        lw = db().execute("SELECT * FROM gang_wars ORDER BY war DESC LIMIT 1").fetchone()
        last = {'war': lw['war'], 'winner': lw['winner'], 'gangs': json.loads(lw['gangs'])} if lw else None
        prizes = {'win': described(cfg['win_reward']), 'lose': described(cfg['lose_reward']), 'district': described(cfg['district_reward']), 'min_points': int(cfg['min_points']),
                  'top': {k: described(v) for k, v in cfg['top_rewards'].items() if int(k) <= int(cfg['top_places'])}}
        return {**base, 'war': {'id': week_id(start), 'starts': start, 'ends': end}, 'gangs': gangs, 'districts': districts, 'me': my_state(uid, cfg, c, now), 'claims': claims, 'prizes': prizes,
                'last': last, 'daily_cap': int(cfg['daily_cap']), 'weights': {k: v for k, v in POINTS.items()}, 'underdog': {'gang': next((x for x in GANG_IDS if c['mult'][x] > 1), ''), 'mult': round(max(c['mult'].values()), 2)}}

    @app.get('/api/gangs')
    @auth()
    def gangs_state():
        with db():
            return view(g.user['id'], int(time.time()))

    @app.get('/api/gangs/enabled')
    @auth()
    def gangs_enabled():
        cfg = settings()
        return {'enabled': bool(cfg['enabled']), 'title': cfg['title'], 'admin': bool(getattr(g, 'is_admin', False))}

    @app.post('/api/gangs/join')
    @auth()
    def gangs_join():
        uid, now = g.user['id'], int(time.time())
        gang = str((request.get_json(silent=True) or {}).get('gang') or '')
        if gang not in GANG_IDS:
            abort(400, description='Выберите банду')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not cfg['enabled']:
                abort(409, description='Войны банд сейчас нет')
            finalize_old(now)
            row = db().execute("SELECT * FROM gang_members WHERE user_id=?", (uid,)).fetchone()
            if row and row['gang'] == gang:
                return view(uid, now)
            if row:
                start, end = week_bounds(now)
                if compute(start, end, cfg)['users'].get(uid, 0) > 0:
                    abort(409, description='Банду можно сменить только до первых очков в этой войне')
                db().execute("UPDATE gang_members SET gang=?,joined=? WHERE user_id=?", (gang, now, uid))
            else:
                db().execute("INSERT INTO gang_members(user_id,gang,joined) VALUES(?,?,?)", (uid, gang, now))
            cache['v'] = None
            out = view(uid, now)
        audit('Gang joined: %s by %s' % (gang, uid))
        return out

    @app.post('/api/gangs/claim')
    @auth()
    def gangs_claim():
        uid, now = g.user['id'], int(time.time())
        wid = str((request.get_json(silent=True) or {}).get('war') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            war = db().execute("SELECT * FROM gang_wars WHERE war=?", (wid,)).fetchone()
            row = db().execute("SELECT * FROM gang_war_users WHERE war=? AND user_id=?", (wid, uid)).fetchone()
            if not war or not row:
                abort(404, description='Награды за эту войну нет')
            if row['claimed']:
                abort(409, description='Награда уже получена')
            rewards = rewards_for(war, row)
            if not rewards:
                abort(409, description='В этой войне мало очков для награды')
            db().execute("UPDATE gang_war_users SET claimed=1 WHERE war=? AND user_id=?", (wid, uid))
            given = app.extensions['crafter_reward_give'](uid, rewards, 'gangs:' + wid)
        audit('Gang prizes claimed: %s by %s' % (wid, uid))
        return {'ok': True, 'given': given}

    @app.get('/api/gangs/leaders')
    @auth()
    def gangs_leaders():
        now = int(time.time())
        cfg = settings()
        if not cfg['enabled'] and not getattr(g, 'is_admin', False):
            return {'gangs': {}, 'top': []}
        with db():
            c = current(cfg, now)
            order = sorted(c['users'].items(), key=lambda x: (-x[1], x[0]))
            ids = [u for u, _ in order[:30]]
            names = {}
            if ids:
                for u in db().execute("SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id IN (%s)" % ','.join('?' * len(ids)), tuple(ids)).fetchall():
                    names[int(u['id'])] = u
            badges = app.extensions['crafter_emoji_statuses'](ids) if ids else {}

            def row(i, u, p):
                n = names.get(u)
                return {'rank': i, 'id': str(u), 'name': (n['name'] if n else '') or 'Игрок', 'photo': (n['photo_url'] if n else '') or '', 'points': int(p), 'gang': c['members'][u][0], 'emoji': badges.get(u), 'title': rank_of(int(p))['title']}
            per = {g_: [] for g_ in GANG_IDS}
            for u, p in order:
                if len(per[c['members'][u][0]]) < 10 and u in names:
                    per[c['members'][u][0]].append(row(len(per[c['members'][u][0]]) + 1, u, p))
            me = g.user['id']
            pos = next((i + 1 for i, (u, _) in enumerate(order) if u == me), None)
            return {'top': [row(i + 1, u, p) for i, (u, p) in enumerate(order[:10]) if u in names], 'gangs': per, 'me': {'rank': pos, 'points': int(c['users'].get(me, 0))} if pos else None}

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
        now = int(time.time())
        finalize_old(now)
        c = current(cfg, now)
        wars = [{'war': w['war'], 'winner': w['winner'], 'gangs': json.loads(w['gangs'])} for w in db().execute("SELECT * FROM gang_wars ORDER BY war DESC LIMIT 6").fetchall()]
        return {'settings': cfg, 'counts': c['counts'], 'wars': wars, 'war': week_id(week_bounds(now)[0]), 'districts': [{'key': d[0], 'title': d[1]} for d in DISTRICTS]}

    @app.get('/api/admin/gangs')
    @auth(admin=True)
    def admin_gangs():
        with db():
            return admin_view()

    @app.post('/api/admin/gangs')
    @auth(admin=True)
    def admin_gangs_save():
        s = request.get_json(silent=True) or {}
        with db():
            cfg = settings()
            cfg['enabled'] = bool(s.get('enabled'))
            cfg['title'] = ' '.join(str(s.get('title') or cfg['title']).split())[:60] or cfg['title']
            cfg['subtitle'] = ' '.join(str(s.get('subtitle') or '').split())[:160]
            gs = s.get('gangs') if isinstance(s.get('gangs'), dict) else {}
            for gid in GANG_IDS:
                src = gs.get(gid) or {}
                cfg['gangs'][gid] = {'name': ' '.join(str(src.get('name') or cfg['gangs'][gid]['name']).split())[:24] or cfg['gangs'][gid]['name'], 'slogan': ' '.join(str(src.get('slogan') or '').split())[:40]}
            cfg['daily_cap'] = num(s.get('daily_cap', cfg['daily_cap']), 0, 100000, 'Потолок очков в сутки')
            cfg['underdog_max'] = num(s.get('underdog_max', cfg['underdog_max']), 100, 400, 'Множитель меньшей банды, %')
            cfg['min_points'] = num(s.get('min_points', cfg['min_points']), 0, 100000, 'Очков для награды')
            for key, label in (('win_reward', 'Победа'), ('lose_reward', 'Утешительная награда'), ('district_reward', 'Награда за район')):
                if key in s:
                    cfg[key] = clean(s[key], label)
            if isinstance(s.get('tiers'), list):
                tiers = []
                for t in s['tiers'][:6]:
                    tiers.append({'points': num(t.get('points'), 1, 1000000, 'Очки уровня'), 'reward': clean(t.get('reward') or [], 'Уровень')})
                cfg['tiers'] = sorted(tiers, key=lambda x: x['points'])
            cfg['top_places'] = num(s.get('top_places', cfg['top_places']), 0, 10, 'Мест в топе')
            tr = s.get('top_rewards')
            if isinstance(tr, dict):
                cfg['top_rewards'] = {str(i): clean(tr.get(str(i)) or [], 'Место %d' % i) for i in range(1, int(cfg['top_places']) + 1)}
            save_settings(cfg)
        audit('Gangs settings saved')
        with db():
            return admin_view()

    @app.post('/api/admin/gangs/remove')
    @auth(admin=True)
    def admin_gangs_remove():
        try:
            uid = int(str((request.get_json(silent=True) or {}).get('user_id') or '').strip())
        except ValueError:
            abort(400, description='Нужен Telegram ID')
        with db():
            db().execute('BEGIN IMMEDIATE')
            finalize_old(int(time.time()))
            gone = db().execute("DELETE FROM gang_members WHERE user_id=?", (uid,)).rowcount
            cache['v'] = None
        audit('Gang member removed: %s' % uid)
        return {'ok': True, 'removed': gone}
