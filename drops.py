"""Drops (Snowman Drop): an item that lives in the inventory as a stack. One item = one session = four attempts to raise the rarity = one reward.

The server decides everything at the start: it rolls the four steps and the reward in advance and keeps them private; the client only sees the
current rarity and the number of attempts left. Every tap carries a request id (a repeat gives the same answer) and the revision of the session
(an old revision gives 409). The reward is given in the same transaction as the fourth tap. The rules are in drops_seed.py."""
import json
import random
import re
import time
import uuid

from flask import abort, g, request

from drops_seed import DROPS

rng = random.SystemRandom()
RARITY_KEYS = ('common', 'rare', 'epic', 'mythic', 'legendary', 'secret')
IMAGES = {'snowman_drop': '/static/assets/drops/snowman.png'}
REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{7,99}')


def pick(weights):
    total = sum(weights)
    ticket = rng.randrange(total)
    for i, w in enumerate(weights):
        if ticket < w:
            return i
        ticket -= w
    raise RuntimeError('unreachable')


def plan(cfg):
    """The private plan of one drop: the rarity after each attempt and the reward."""
    rarity, steps = 0, []
    for _ in range(cfg['attempts']):
        rarity = pick(cfg['transitions'][rarity])
        steps.append(rarity)
    kind = cfg['categories'][pick(cfg['category_weights'][rarity])]
    index = pick(cfg['reward_weights'][kind][rarity])
    return steps, {'kind': kind, 'spec': cfg['rewards'][kind][index], 'index': index}


def final_chances(cfg):
    """Exact chances for the whole drop: the final rarity and every reward (percent)."""
    n = len(cfg['rarities'])
    dist = [1.0] + [0.0] * (n - 1)
    for _ in range(cfg['attempts']):
        nxt = [0.0] * n
        for i, p in enumerate(dist):
            if p:
                row = cfg['transitions'][i]
                tot = sum(row)
                for j, w in enumerate(row):
                    nxt[j] += p * w / tot
        dist = nxt
    rewards = {}
    for r, pr in enumerate(dist):
        ctot = sum(cfg['category_weights'][r])
        for ci, kind in enumerate(cfg['categories']):
            pc = cfg['category_weights'][r][ci] / ctot
            ws = cfg['reward_weights'][kind][r]
            wt = sum(ws)
            for i, w in enumerate(ws):
                if w:
                    key = (kind, i)
                    rewards[key] = rewards.get(key, 0.0) + pr * pc * w / wt
    return dist, rewards


def install_drops(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS drop_stock (
                user_id BIGINT NOT NULL, drop_id TEXT NOT NULL, qty BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, drop_id)
            );
            CREATE TABLE IF NOT EXISTS drop_sessions (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, drop_id TEXT NOT NULL, version TEXT NOT NULL, steps TEXT NOT NULL, reward TEXT NOT NULL,
                attempt BIGINT NOT NULL DEFAULT 0, revision BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', responses TEXT NOT NULL DEFAULT '{}',
                source TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_drop_sessions_user ON drop_sessions(user_id, drop_id, status);
        """)

    def short(drop_id):
        cfg = DROPS.get(drop_id)
        if not cfg:
            return None
        return {'id': drop_id, 'title': cfg['title'], 'image': IMAGES.get(drop_id, ''), 'attempts': cfg['attempts'], 'rarities': cfg['rarities']}

    def stock_of(uid, drop_id):
        row = db().execute("SELECT qty FROM drop_stock WHERE user_id=? AND drop_id=?", (uid, drop_id)).fetchone()
        return int(row['qty']) if row else 0

    def grant(uid, drop_id, qty, source):
        if drop_id not in DROPS:
            abort(404, description='Такого дропа нет')
        qty = int(qty)
        if qty < 1 or qty > 1000:
            abort(400, description='Количество: от 1 до 1000')
        db().execute("INSERT INTO drop_stock(user_id,drop_id,qty) VALUES(?,?,?) ON CONFLICT(user_id,drop_id) DO UPDATE SET qty=drop_stock.qty+excluded.qty", (uid, drop_id, qty))
        return stock_of(uid, drop_id)

    def reward_item(reward):
        kind, spec = reward['kind'], reward['spec']
        return app.extensions['crafter_loot_item'](spec[0], spec[1], 1)

    def public(row, extra=None):
        cfg = DROPS[row['drop_id']]
        out = {'session_id': row['id'], 'drop': short(row['drop_id']), 'revision': int(row['revision']), 'attempt': int(row['attempt']), 'attempts': cfg['attempts'],
               'attempts_left': cfg['attempts'] - int(row['attempt']), 'rarity': 0 if not int(row['attempt']) else json.loads(row['steps'])[int(row['attempt']) - 1],
               'state': 'ready' if int(row['attempt']) < cfg['attempts'] else 'revealed'}
        out['rarity_key'] = RARITY_KEYS[out['rarity']]
        out['rarity_name'] = cfg['rarities'][out['rarity']]
        if row['status'] == 'done':
            out['reward'] = json.loads(row['reward'])['item']
        out.update(extra or {})
        return out

    @app.get('/api/drops')
    @auth()
    def drops_mine():
        uid = g.user['id']
        active = {r['drop_id']: r['id'] for r in db().execute("SELECT id,drop_id FROM drop_sessions WHERE user_id=? AND status='active'", (uid,)).fetchall()}
        out = []
        for drop_id in DROPS:
            qty = stock_of(uid, drop_id)
            if qty or drop_id in active:
                out.append({**short(drop_id), 'qty': qty, 'session_id': active.get(drop_id)})
        return {'drops': out}

    @app.get('/api/drops/<drop_id>/chances')
    @auth()
    def drop_chances(drop_id):
        cfg = DROPS.get(drop_id)
        if not cfg:
            abort(404, description='Такого дропа нет')
        dist, rewards = final_chances(cfg)
        loot = []
        for (kind, i), p in sorted(rewards.items(), key=lambda kv: -kv[1]):
            spec = cfg['rewards'][kind][i]
            item = app.extensions['crafter_loot_item'](spec[0], spec[1], 1)
            loot.append({'kind': item['kind'], 'title': item['title'], 'image': item['image'], 'amount': item['amount'], 'collection': item.get('collection', ''), 'chance': round(p * 100, 3)})
        kinds = {}
        for x in loot:
            kinds[x['kind']] = round(kinds.get(x['kind'], 0) + x['chance'], 3)
        return {'drop': short(drop_id), 'rarities': [{'key': RARITY_KEYS[i], 'name': cfg['rarities'][i], 'chance': round(p * 100, 3)} for i, p in enumerate(dist)],
                'kinds': kinds, 'loot': loot, 'transitions': [[round(w / sum(row) * 100, 2) for w in row] for row in cfg['transitions']]}

    @app.post('/api/drops/<drop_id>/open')
    @auth()
    def drop_open(drop_id):
        """Start the opening of one item of the stack (or come back to the one that is not finished)."""
        uid = g.user['id']
        cfg = DROPS.get(drop_id)
        if not cfg:
            abort(404, description='Такого дропа нет')
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT * FROM drop_sessions WHERE user_id=? AND drop_id=? AND status='active' ORDER BY created LIMIT 1", (uid, drop_id)).fetchone()
            if not row:
                if stock_of(uid, drop_id) < 1:
                    abort(409, description='У вас нет такого дропа')
                db().execute("UPDATE drop_stock SET qty=qty-1 WHERE user_id=? AND drop_id=?", (uid, drop_id))
                steps, reward = plan(cfg)
                sid = uuid.uuid4().hex
                db().execute("INSERT INTO drop_sessions(id,user_id,drop_id,version,steps,reward,created) VALUES(?,?,?,?,?,?,?)",
                             (sid, uid, drop_id, cfg['version'], json.dumps(steps), json.dumps(reward), int(time.time())))
                row = db().execute("SELECT * FROM drop_sessions WHERE id=?", (sid,)).fetchone()
            return public(row, {'qty': stock_of(uid, drop_id)})

    @app.get('/api/drops/sessions/<sid>')
    @auth()
    def drop_session(sid):
        row = db().execute("SELECT * FROM drop_sessions WHERE id=? AND user_id=?", (sid, g.user['id'])).fetchone()
        if not row:
            abort(404, description='Сессия не найдена')
        return public(row, {'qty': stock_of(g.user['id'], row['drop_id'])})

    @app.post('/api/drops/sessions/<sid>/tap')
    @auth()
    def drop_tap(sid):
        uid = g.user['id']
        body = request.get_json(silent=True) or {}
        request_id = str(body.get('request_id') or '')
        if not REQUEST_ID.fullmatch(request_id):
            abort(400, description='Нужен уникальный номер запроса')
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT * FROM drop_sessions WHERE id=? AND user_id=?", (sid, uid)).fetchone()
            if not row:
                abort(404, description='Сессия не найдена')
            responses = json.loads(row['responses'] or '{}')
            if request_id in responses:                               # the same request again: the same answer, nothing is rolled twice
                return responses[request_id]
            cfg = DROPS[row['drop_id']]
            if int(body.get('revision', -1)) != int(row['revision']):
                abort(409, description='Состояние изменилось, обновляем')
            if int(row['attempt']) >= cfg['attempts']:
                abort(409, description='Дроп уже открыт')
            attempt, reward = int(row['attempt']) + 1, json.loads(row['reward'])
            status = 'active'
            if attempt == cfg['attempts']:                            # the last attempt: the reward is given in this very transaction
                item = reward_item(reward)
                app.extensions['crafter_grant_loot'](uid, [item], 'drop:' + row['id'])
                reward['item'] = item
                status = 'done'
            db().execute("UPDATE drop_sessions SET attempt=?, revision=revision+1, status=?, reward=? WHERE id=?", (attempt, status, json.dumps(reward, ensure_ascii=False), sid))
            row = db().execute("SELECT * FROM drop_sessions WHERE id=?", (sid,)).fetchone()
            answer = public(row, {'qty': stock_of(uid, row['drop_id'])})
            responses[request_id] = answer
            db().execute("UPDATE drop_sessions SET responses=? WHERE id=?", (json.dumps(responses, ensure_ascii=False), sid))
            if status == 'done':
                audit('Drop opened %s: %s' % (row['drop_id'], reward['item'].get('title')))
            return answer

    @app.get('/api/admin/drops')
    @auth(admin=True)
    def admin_drops():
        out = []
        for drop_id, cfg in DROPS.items():
            dist, _ = final_chances(cfg)
            opened = db().execute("SELECT COUNT(*) AS n FROM drop_sessions WHERE drop_id=? AND status='done'", (drop_id,)).fetchone()['n']
            out.append({**short(drop_id), 'version': cfg['version'], 'opened': int(opened), 'final': [round(p * 100, 3) for p in dist]})
        return {'drops': out}

    @app.post('/api/admin/drops/grant')
    @auth(admin=True)
    def admin_drops_grant():
        body = request.get_json(silent=True) or {}
        try:
            uid = int(body.get('user_id'))
        except (TypeError, ValueError):
            abort(400, description='Укажите числовой номер пользователя')
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            abort(404, description='Пользователь не найден')
        with db():
            total = grant(uid, str(body.get('drop_id') or ''), body.get('qty') or 1, 'admin')
        audit('Drop granted %s x%s to %s' % (body.get('drop_id'), body.get('qty') or 1, uid))
        return {'ok': True, 'qty': total}

    app.extensions['crafter_grant_drop'] = lambda uid, drop_id, qty, source: grant(uid, drop_id, qty, source)
    app.extensions['crafter_drop_exists'] = lambda drop_id: drop_id in DROPS
    app.extensions['crafter_drop_short'] = short
