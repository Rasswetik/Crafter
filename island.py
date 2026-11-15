"""The mode «Остров сокровищ»: an expedition on an island that is generated anew for every run.

The player pays one ticket and walks up the map (8 rows, 2-3 places in a row, the boss on top): chests, traps, merchants, camps, riddles, events and elites.
Lives, luck and a backpack with the loot are kept by the server; after every place the player may take the loot and leave, or go on. When the lives are over
the player keeps only a part of the backpack. Relics found on the way are kept for good and give small bonuses to the next runs.
Everything is decided here (the map is saved in the run, the outcomes are rolled with a cryptographic generator at the moment of the step);
the client only chooses a place. Prizes come from the real catalog (admin-set tables) and are given by the common mechanism of rewards.
Also here: tickets (a free one every day, more for balls), the explorer level, the weekly leaderboard «Капитаны» with prizes.
"""
import json
import math
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

from flask import abort, g, request

SETTINGS_KEY = 'island_v1'
MSK = timezone(timedelta(hours=3))
ROWS = 8
RNG = secrets.SystemRandom()

RELICS = {
    'shield': ('Ракушка-щит', 'rare', 'r01_shield', 'Первая ловушка за забег не наносит урона.'),
    'compass': ('Счастливый компас', 'common', 'r02_compass_lucky', 'Забег начинается с удачей +25.'),
    'boots': ('Сапоги следопыта', 'common', 'r03_boots', 'Костёр лечит на 1 жизнь больше.'),
    'lantern': ('Волшебный фонарь', 'rare', 'r04_lantern', 'В загадке показывает одну дверь с ловушкой.'),
    'parrot': ('Попугай-вещун', 'common', 'r05_parrot', 'В событиях исходы чаще хорошие.'),
    'map': ('Обрывок карты', 'common', 'r06_map_scrap', 'Сундуки с шансом 35% дают ещё одну добычу.'),
    'magnet': ('Магнит для монет', 'rare', 'r07_coin_magnet', 'Шары в добыче +25%.'),
    'heart': ('Сердце-самоцвет', 'epic', 'r08_heart_gem', 'Одна дополнительная жизнь на забег.'),
    'flask': ('Фляга с ромом', 'epic', 'r09_rum_flask', 'Раз за забег спасает от гибели: остаётся 1 жизнь.'),
    'crown': ('Корона из ракушек', 'epic', 'r10_crown_shell', 'За победу над боссом ещё одна награда высшего уровня.'),
    'pearl': ('Чёрная жемчужина', 'rare', 'r11_pearl', 'Скидка 30% у торговца.'),
    'anchor': ('Якорь капитана', 'rare', 'r12_anchor', 'При гибели теряется вдвое меньше добычи.'),
}
RELIC_ORDER = list(RELICS)
TYPES = ('chest', 'trap', 'merchant', 'camp', 'riddle', 'event', 'elite', 'boss')
TYPE_TITLES = {'chest': 'Сундук', 'trap': 'Ловушка', 'merchant': 'Торговец', 'camp': 'Костёр', 'riddle': 'Загадка', 'event': 'Событие', 'elite': 'Страж', 'boss': 'Босс'}
# the odds of a place by the row (1..7); the boss is always row 8
WEIGHTS = {
    1: {'chest': 5, 'trap': 2, 'riddle': 3, 'event': 3},
    2: {'chest': 5, 'trap': 3, 'riddle': 3, 'event': 3, 'merchant': 1},
    3: {'chest': 4, 'trap': 3, 'riddle': 3, 'event': 3, 'elite': 2, 'merchant': 1},
    4: {'chest': 4, 'trap': 3, 'riddle': 3, 'event': 3, 'elite': 2, 'camp': 3, 'merchant': 2},
    5: {'chest': 4, 'trap': 3, 'riddle': 3, 'event': 3, 'elite': 3, 'camp': 2, 'merchant': 2},
    6: {'chest': 4, 'trap': 3, 'riddle': 3, 'event': 2, 'elite': 3, 'camp': 3, 'merchant': 2},
    7: {'camp': 6, 'merchant': 4, 'chest': 3, 'elite': 2, 'riddle': 2},
}
EVENTS = {
    'parrot': {'title': 'Раненый попугай', 'text': 'В траве лежит попугай с повязанной лапкой. Он смотрит на вас с надеждой.', 'image': 'icons/i_event',
               'options': [{'label': 'Помочь', 'outcomes': [(70, {'luck': 15, 'loot': 0, 'msg': 'Попугай благодарно крикнул и подарил находку.'}), (30, {'luck': 5, 'msg': 'Попугай улетел, а вам стало легче на душе.'})]},
                           {'label': 'Пройти мимо', 'outcomes': [(100, {'msg': 'Вы пошли дальше.'})]}]},
    'raft': {'title': 'Старый плот', 'text': 'У воды качается плот. Говорят, он выносит к тайнику, но течение здесь коварное.', 'image': 'map/boat',
             'options': [{'label': 'Прокатиться', 'outcomes': [(50, {'loot': 1, 'msg': 'Течение вынесло к тайнику!'}), (30, {'life': -1, 'luck': -5, 'msg': 'Плот перевернулся, вы чудом выплыли.'}), (20, {'luck': 10, 'msg': 'Прогулка вышла удачной.'})]},
                         {'label': 'Не рисковать', 'outcomes': [(100, {'msg': 'Осторожность не повредит.'})]}]},
    'idol': {'title': 'Золотой идол', 'text': 'Среди камней блестит идол. Слишком красиво, чтобы быть без подвоха.', 'image': 'icons/i_relic',
             'options': [{'label': 'Взять', 'outcomes': [(45, {'loot': 2, 'msg': 'Идол ваш, и за него дают очень много!'}), (55, {'life': -1, 'luck': -10, 'msg': 'Идол оказался с секретом.'})]},
                         {'label': 'Оставить', 'outcomes': [(100, {'luck': 5, 'msg': 'Иногда лучше уйти. Удача это ценит.'})]}]},
    'well': {'title': 'Колодец желаний', 'text': 'Старый колодец с прохладной водой. На дне блестят монеты.', 'image': 'icons/i_clover',
             'options': [{'label': 'Попить', 'outcomes': [(60, {'life': 1, 'msg': 'Вода оказалась целебной.'}), (40, {'luck': -5, 'msg': 'Вода как вода.'})]},
                         {'label': 'Бросить монету', 'outcomes': [(50, {'luck': 20, 'msg': 'Колодец услышал желание!'}), (50, {'msg': 'Эхо ответило тишиной.'})]}]},
    'bottle': {'title': 'Бутылка с запиской', 'text': 'Волна выбросила бутылку. Внутри обрывок карты.', 'image': 'loot/treasure_map',
               'options': [{'label': 'Идти по карте', 'outcomes': [(55, {'loot': 1, 'msg': 'Карта привела к кладу.'}), (25, {'relic': True, 'msg': 'Под камнем лежала реликвия!'}), (20, {'life': -1, 'msg': 'Карта вела в ловушку.'})]},
                           {'label': 'Выбросить', 'outcomes': [(100, {'msg': 'Бутылка уплыла обратно.'})]}]},
}


def default_loot():
    ball = lambda n, w: {'weight': w, 'reward': [{'kind': 'BALL', 'amount': str(n), 'count': 1}]}
    pack = lambda n, w: {'weight': w, 'reward': [{'kind': 'PACK', 'amount': 'vicecity', 'count': n}]}
    return {'0': [ball(60, 50), ball(120, 30), ball(200, 15)], '1': [ball(250, 45), ball(400, 30), ball(600, 15), pack(1, 10)], '2': [ball(800, 40), ball(1200, 30), ball(2000, 15), pack(2, 15)]}


def default_settings():
    return {'enabled': False, 'title': 'Остров сокровищ', 'subtitle': 'Выберите путь по острову, копите добычу и вовремя уходите с ней.',
            'ticket_price': 300, 'free_daily': 1, 'ticket_max': 3, 'buy_max': 6, 'lives': 3, 'death_loss': 60, 'daily_balls_cap': 20000,
            'price_heal': 150, 'price_luck': 100, 'price_relic': 500, 'relic_dupe_balls': 150,
            'loot': default_loot(), 'boss_rewards': [{'kind': 'BALL', 'amount': '3000', 'count': 1}, {'kind': 'PACK', 'amount': 'vicecity', 'count': 3}],
            'leader_places': 3, 'leader_rewards': {'1': [{'kind': 'BALL', 'amount': '5000', 'count': 1}], '2': [{'kind': 'BALL', 'amount': '2500', 'count': 1}], '3': [{'kind': 'BALL', 'amount': '1000', 'count': 1}]}}


def day_of(now):
    return int((now + 3 * 3600) // 86400)


def week_of(now):
    d = datetime.fromtimestamp(now, MSK).isocalendar()
    return '%d-W%02d' % (d[0], d[1])


def level_of(xp):
    return min(10, 1 + int(math.sqrt(max(0, xp) / 40.0)))


def slots_of(level):
    return min(6, 2 + (level - 1) // 2)


def weighted(pairs):
    total = sum(w for w, _ in pairs)
    pick = RNG.uniform(0, total)
    for w, v in pairs:
        pick -= w
        if pick <= 0:
            return v
    return pairs[-1][1]


def make_map():
    """8 rows; the boss is alone on the last one. Every place has a way forward and every place of the next row can be reached."""
    rows = []
    for r in range(1, ROWS):
        count = RNG.choice((2, 3, 3)) if r < ROWS - 1 else RNG.choice((2, 3))
        pool = dict(WEIGHTS[r])
        kinds = []
        for _ in range(count):
            t = weighted([(w, k) for k, w in pool.items()])
            kinds.append(t)
            if pool.get(t, 0) > 1:
                pool[t] = max(1, pool[t] // 2)          # fewer repeats in one row
        if r in (4, 7) and not any(k in ('camp', 'merchant') for k in kinds):
            kinds[RNG.randrange(count)] = 'camp'
        rows.append([{'id': 'r%dn%d' % (r, i), 'row': r, 'col': i, 'of': count, 'type': kinds[i], 'next': []} for i in range(count)])
    rows.append([{'id': 'r%dn0' % ROWS, 'row': ROWS, 'col': 0, 'of': 1, 'type': 'boss', 'next': []}])
    for a, b in zip(rows, rows[1:]):
        for n in a:
            n['next'] = [min(len(b) - 1, max(0, round(n['col'] * (len(b) - 1) / max(1, len(a) - 1))))] if len(a) > 1 else [0]
            if len(b) > 1 and RNG.random() < 0.5:
                extra = min(len(b) - 1, n['next'][0] + RNG.choice((-1, 1)))
                if extra >= 0 and extra not in n['next']:
                    n['next'].append(extra)
        for j, m in enumerate(b):
            if not any(j in n['next'] for n in a):
                near = min(a, key=lambda n: abs(n['col'] * (len(b) - 1) / max(1, len(a) - 1) - j))
                near['next'].append(j)
        for n in a:
            n['next'] = sorted('r%dn%d' % (n['row'] + 1, j) for j in set(n['next']))
    return [n for row in rows for n in row]


def install_island(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS island_users (
                user_id BIGINT PRIMARY KEY, tickets BIGINT NOT NULL DEFAULT 0, free_day BIGINT NOT NULL DEFAULT 0, xp BIGINT NOT NULL DEFAULT 0,
                equipped TEXT NOT NULL DEFAULT '[]', best_depth BIGINT NOT NULL DEFAULT 0, runs BIGINT NOT NULL DEFAULT 0, wins BIGINT NOT NULL DEFAULT 0,
                paid_day BIGINT NOT NULL DEFAULT 0, paid_balls BIGINT NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS island_relics_owned (user_id BIGINT NOT NULL, relic TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(user_id, relic));
            CREATE TABLE IF NOT EXISTS island_runs (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'active', seq BIGINT NOT NULL DEFAULT 0, depth BIGINT NOT NULL DEFAULT 0,
                lives BIGINT NOT NULL, max_lives BIGINT NOT NULL, luck BIGINT NOT NULL DEFAULT 0, pos TEXT NOT NULL DEFAULT '', map TEXT NOT NULL,
                visited TEXT NOT NULL DEFAULT '[]', bag TEXT NOT NULL DEFAULT '[]', relics TEXT NOT NULL DEFAULT '[]', pending TEXT NOT NULL DEFAULT '',
                flags TEXT NOT NULL DEFAULT '{}', score BIGINT NOT NULL DEFAULT 0, elites BIGINT NOT NULL DEFAULT 0, found TEXT NOT NULL DEFAULT '[]',
                created BIGINT NOT NULL, ended BIGINT NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS island_weekly (week TEXT NOT NULL, user_id BIGINT NOT NULL, score BIGINT NOT NULL DEFAULT 0, best_depth BIGINT NOT NULL DEFAULT 0, runs BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(week, user_id));
            CREATE TABLE IF NOT EXISTS island_payouts (week TEXT NOT NULL, place BIGINT NOT NULL, user_id BIGINT NOT NULL, score BIGINT NOT NULL, reward TEXT NOT NULL DEFAULT '[]', created BIGINT NOT NULL, PRIMARY KEY(week, place));
        """)

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

    def clean(raw, where):
        try:
            return app.extensions['crafter_reward_clean'](raw)
        except Exception as err:
            if hasattr(err, 'description'):
                raise
            abort(400, description='%s: %s' % (where, err))

    def described(rewards):
        return [app.extensions['crafter_reward_describe'](dict(r)) for r in rewards]

    # ------------------------------------------------------------------ the player
    def user_row(uid, now):
        row = db().execute("SELECT * FROM island_users WHERE user_id=?", (uid,)).fetchone()
        if not row:
            cfg = settings()
            db().execute("INSERT INTO island_users(user_id,tickets,free_day) VALUES(?,?,?) ON CONFLICT DO NOTHING", (uid, int(cfg['free_daily']), day_of(now)))
            row = db().execute("SELECT * FROM island_users WHERE user_id=?", (uid,)).fetchone()
        return row

    def refill(uid, now):
        """A free ticket every day, saved up to the limit."""
        cfg = settings()
        row = user_row(uid, now)
        today = day_of(now)
        if int(row['free_day']) < today:
            gain = (today - int(row['free_day'])) * int(cfg['free_daily'])
            have = int(row['tickets'])
            new = max(have, min(int(cfg['ticket_max']), have + gain))
            db().execute("UPDATE island_users SET tickets=?,free_day=? WHERE user_id=?", (new, today, uid))
            row = db().execute("SELECT * FROM island_users WHERE user_id=?", (uid,)).fetchone()
        return row

    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def pay(uid, amount):
        if amount <= 0:
            return
        have = balls_of(uid)
        if have < amount:
            abort(409, description='Недостаточно: %s' % (app.extensions.get('crafter_currency_name') or 'шаров'))
        db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
        db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (have - amount, uid))

    def owned_relics(uid):
        return [r['relic'] for r in db().execute("SELECT relic FROM island_relics_owned WHERE user_id=? ORDER BY created", (uid,)).fetchall()]

    def equipped_of(row, owned):
        try:
            ids = json.loads(row['equipped'] or '[]')
        except ValueError:
            ids = []
        slots = slots_of(level_of(int(row['xp'])))
        return [i for i in ids if i in owned and i in RELICS][:slots]

    def grant_relic(uid, relic, now):
        """A new relic goes into the collection (and into a free slot); a repeat is paid in balls."""
        owned = owned_relics(uid)
        if relic in owned:
            return False
        db().execute("INSERT INTO island_relics_owned(user_id,relic,created) VALUES(?,?,?) ON CONFLICT DO NOTHING", (uid, relic, now))
        row = user_row(uid, now)
        eq = equipped_of(row, owned)
        if len(eq) < slots_of(level_of(int(row['xp']))):
            db().execute("UPDATE island_users SET equipped=? WHERE user_id=?", (json.dumps(eq + [relic]), uid))
        return True

    def relic_info(rid, has=True):
        t = RELICS[rid]
        return {'id': rid, 'title': t[0], 'rarity': t[1], 'image': '/static/assets/island/relics/%s.webp' % t[2], 'text': t[3], 'owned': has}

    # ------------------------------------------------------------------ the bag
    def bag_add(bag, reward):
        for it in bag:
            if it['kind'] == reward['kind'] and str(it['amount']) == str(reward['amount']):
                if reward['kind'] in ('BALL', 'GRAM'):
                    it['amount'] = str(int(it['amount']) + int(reward['amount'])) if reward['kind'] == 'BALL' else str(it['amount'])
                    it['count'] = int(it.get('count') or 1) + (0 if reward['kind'] == 'BALL' else int(reward.get('count') or 1))
                else:
                    it['count'] = int(it.get('count') or 1) + int(reward.get('count') or 1)
                return
        bag.append({'kind': reward['kind'], 'amount': str(reward['amount']), 'count': int(reward.get('count') or 1)})

    def roll_loot(cfg, tier, flags, relics):
        """One piece of loot from the table of the tier (0 shallow, 1 middle, 2 deep)."""
        table = cfg['loot'].get(str(max(0, min(2, tier)))) or []
        if not table:
            return []
        entry = weighted([(max(1, int(e.get('weight') or 1)), e) for e in table])
        out = []
        for r in entry.get('reward') or []:
            r = dict(r)
            if r['kind'] == 'BALL' and 'magnet' in relics:
                r['amount'] = str(int(int(r['amount']) * 1.25))
            out.append(r)
        return out

    def tier_of(depth, luck, bonus=0):
        base = 0 if depth <= 3 else 1 if depth <= 6 else 2
        if RNG.random() < luck / 220.0:
            bonus += 1
        return max(0, min(2, base + bonus))

    # ------------------------------------------------------------------ the run
    def active_run(uid):
        return db().execute("SELECT * FROM island_runs WHERE user_id=? AND status='active' ORDER BY created DESC", (uid,)).fetchone()

    def load(run):
        return {'map': json.loads(run['map']), 'visited': json.loads(run['visited']), 'bag': json.loads(run['bag']), 'relics': json.loads(run['relics']),
                'pending': json.loads(run['pending']) if run['pending'] else None, 'flags': json.loads(run['flags']), 'found': json.loads(run['found'])}

    def store(run_id, st, **cols):
        db().execute("UPDATE island_runs SET map=?,visited=?,bag=?,relics=?,pending=?,flags=?,found=? WHERE id=?",
                     (json.dumps(st['map']), json.dumps(st['visited']), json.dumps(st['bag']), json.dumps(st['relics']), json.dumps(st['pending']) if st['pending'] else '', json.dumps(st['flags']), json.dumps(st['found']), run_id))
        if cols:
            sets = ','.join('%s=?' % k for k in cols)
            db().execute("UPDATE island_runs SET %s,seq=seq+1 WHERE id=?" % sets, (*cols.values(), run_id))
        else:
            db().execute("UPDATE island_runs SET seq=seq+1 WHERE id=?", (run_id,))

    def bag_value(bag):
        return sum(int(i['amount']) for i in bag if i['kind'] == 'BALL')

    def run_view(run):
        st = load(run)
        cfg = settings()
        by_id = {n['id']: n for n in st['map']}
        pos = by_id.get(run['pos'])
        options = [n['id'] for n in st['map'] if n['row'] == 1] if not pos else list(pos['next'])
        visited = set(st['visited'])
        nodes = []
        for n in st['map']:
            state = 'done' if n['id'] in visited else 'open' if (run['status'] == 'active' and not st['pending'] and n['id'] in options) else 'locked'
            nodes.append({'id': n['id'], 'row': n['row'], 'col': n['col'], 'of': n['of'], 'type': n['type'], 'next': n['next'], 'state': state})
        pending = None
        if st['pending']:
            p = st['pending']
            pending = {'type': p['type'], 'node': p.get('node'), 'title': p.get('title'), 'text': p.get('text'), 'image': p.get('image')}
            if p['type'] == 'riddle':
                pending['doors'] = 3
                pending['revealed'] = p.get('revealed')
            elif p['type'] == 'merchant':
                pending['offers'] = p['offers']
            elif p['type'] == 'event':
                pending['options'] = [o['label'] for o in p['options']]
            elif p['type'] == 'boss':
                pending['hp'] = p['hp']
                pending['max_hp'] = p['max_hp']
        return {'id': run['id'], 'status': run['status'], 'seq': int(run['seq']), 'depth': int(run['depth']), 'lives': int(run['lives']), 'max_lives': int(run['max_lives']), 'luck': int(run['luck']),
                'pos': run['pos'], 'nodes': nodes, 'bag': described(st['bag']), 'bag_value': bag_value(st['bag']), 'pending': pending, 'can_cashout': run['status'] == 'active' and not st['pending'] and bool(st['bag']),
                'relics': [relic_info(r) for r in st['relics']], 'score': int(run['score']), 'found': [relic_info(r) for r in st['found']],
                'death_loss': int(cfg['death_loss']) // (2 if 'anchor' in st['relics'] else 1)}

    def hub_view(uid, now):
        cfg = settings()
        row = refill(uid, now)
        owned = owned_relics(uid)
        level = level_of(int(row['xp']))
        slots = slots_of(level)
        nxt = 40 * level * level if level < 10 else None
        run = active_run(uid)
        return {'enabled': bool(cfg['enabled']), 'title': cfg['title'], 'subtitle': cfg['subtitle'], 'now': now, 'admin': bool(getattr(g, 'is_admin', False)),
                'tickets': int(row['tickets']), 'ticket_max': int(cfg['ticket_max']), 'buy_max': int(cfg['buy_max']), 'ticket_price': int(cfg['ticket_price']), 'balls': balls_of(uid),
                'next_free': (day_of(now) + 1) * 86400 - 3 * 3600, 'xp': int(row['xp']), 'level': level, 'xp_next': nxt, 'slots': slots, 'best_depth': int(row['best_depth']), 'runs': int(row['runs']), 'wins': int(row['wins']),
                'relics': [relic_info(r, r in owned) for r in RELIC_ORDER], 'equipped': equipped_of(row, owned), 'run': run_view(run) if run else None,
                'boss_rewards': described(cfg['boss_rewards']), 'rules': {'lives': int(cfg['lives']), 'death_loss': int(cfg['death_loss'])}}

    @app.get('/api/island')
    @auth()
    def island_state():
        with db():
            return hub_view(g.user['id'], int(time.time()))

    @app.get('/api/island/enabled')
    @auth()
    def island_enabled():
        cfg = settings()
        return {'enabled': bool(cfg['enabled']), 'title': cfg['title']}

    @app.post('/api/island/ticket')
    @auth()
    def island_buy_ticket():
        uid, now = g.user['id'], int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not cfg['enabled']:
                abort(409, description='Режим сейчас закрыт')
            row = refill(uid, now)
            if int(row['tickets']) >= int(cfg['buy_max']):
                abort(409, description='Билетов уже максимум')
            pay(uid, int(cfg['ticket_price']))
            db().execute("UPDATE island_users SET tickets=tickets+1 WHERE user_id=?", (uid,))
            return hub_view(uid, now)

    @app.post('/api/island/equip')
    @auth()
    def island_equip():
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        ids = body.get('ids')
        if not isinstance(ids, list):
            abort(400, description='Не выбраны реликвии')
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = user_row(uid, now)
            owned = owned_relics(uid)
            seen = []
            for i in ids:
                if i in owned and i in RELICS and i not in seen:
                    seen.append(i)
            if len(seen) > slots_of(level_of(int(row['xp']))):
                abort(409, description='Все слоты заняты')
            db().execute("UPDATE island_users SET equipped=? WHERE user_id=?", (json.dumps(seen), uid))
            return hub_view(uid, now)

    @app.post('/api/island/start')
    @auth()
    def island_start():
        uid, now = g.user['id'], int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not cfg['enabled']:
                abort(409, description='Режим сейчас закрыт')
            if active_run(uid):
                abort(409, description='Экспедиция уже идёт')
            row = refill(uid, now)
            if int(row['tickets']) < 1:
                abort(409, description='Нет билетов экспедиции')
            db().execute("UPDATE island_users SET tickets=tickets-1,runs=runs+1 WHERE user_id=?", (uid,))
            owned = owned_relics(uid)
            relics = equipped_of(row, owned)
            lives = int(cfg['lives']) + (1 if 'heart' in relics else 0)
            luck = 25 if 'compass' in relics else 0
            rid = uuid.uuid4().hex
            db().execute("INSERT INTO island_runs(id,user_id,lives,max_lives,luck,map,relics,created) VALUES(?,?,?,?,?,?,?,?)", (rid, uid, lives, lives, luck, json.dumps(make_map()), json.dumps(relics), now))
            return hub_view(uid, now)

    # ------------------------------------------------------------------ effects
    def lose_life(R, st, msg, log):
        R['lives'] -= 1
        log.append({'t': 'life', 'v': -1})
        if R['lives'] <= 0 and 'flask' in st['relics'] and not st['flags'].get('flask'):
            st['flags']['flask'] = True
            R['lives'] = 1
            log.append({'t': 'save', 'text': 'Фляга с ромом спасла от гибели!'})

    def add_luck(R, n):
        R['luck'] = max(0, min(100, R['luck'] + n))

    def find_relic(uid, R, st, now, log, force=False):
        pool = [r for r in RELIC_ORDER if r not in owned_relics(uid) and r not in st['found']]
        if not pool:
            return
        rid = RNG.choice(pool)
        st['found'].append(rid)
        grant_relic(uid, rid, now)
        log.append({'t': 'relic', 'relic': relic_info(rid)})

    def give_loot(cfg, R, st, tier, log, extra_chance=True):
        loot = roll_loot(cfg, tier, st['flags'], st['relics'])
        for r in loot:
            bag_add(st['bag'], r)
        log.append({'t': 'loot', 'items': described(loot), 'tier': tier})
        if extra_chance and 'map' in st['relics'] and RNG.random() < 0.35:
            more = roll_loot(cfg, tier, st['flags'], st['relics'])
            for r in more:
                bag_add(st['bag'], r)
            log.append({'t': 'loot', 'items': described(more), 'tier': tier, 'bonus': True})

    def apply_effect(uid, cfg, R, st, eff, now, log, luck_mod=0):
        if eff.get('life'):
            if eff['life'] < 0:
                lose_life(R, st, '', log)
            else:
                before = R['lives']
                R['lives'] = min(R['max_lives'], R['lives'] + eff['life'])
                log.append({'t': 'life', 'v': R['lives'] - before})
        if eff.get('luck'):
            add_luck(R, eff['luck'])
            log.append({'t': 'luck', 'v': eff['luck']})
        if 'loot' in eff:
            give_loot(cfg, R, st, tier_of(R['depth'], R['luck'] + luck_mod, eff['loot']), log, extra_chance=False)
        if eff.get('relic'):
            find_relic(uid, R, st, now, log)

    def finish(uid, run, R, st, status, cfg, now):
        """The end of a run: the prizes of the bag are given once (the status changes first), the score goes to the week."""
        bag = st['bag']
        kept = []
        loss = int(cfg['death_loss']) // (2 if 'anchor' in st['relics'] else 1)
        if status == 'dead':
            for it in bag:
                it = dict(it)
                if it['kind'] == 'BALL':
                    it['amount'] = str(int(int(it['amount']) * (100 - loss) / 100))
                    if int(it['amount']) > 0:
                        kept.append(it)
                else:
                    n = 0
                    for _ in range(int(it.get('count') or 1)):
                        if RNG.random() * 100 >= loss:
                            n += 1
                    if n:
                        it['count'] = n
                        kept.append(it)
        else:
            kept = [dict(i) for i in bag]
        if status == 'won':
            for r in cfg['boss_rewards']:
                kept.append(dict(r))
            if 'crown' in st['relics']:
                for r in roll_loot(cfg, 2, st['flags'], st['relics']):
                    kept.append(r)
        # a daily limit of balls from this mode
        row = user_row(uid, now)
        today = day_of(now)
        paid = int(row['paid_balls']) if int(row['paid_day']) == today else 0
        room = max(0, int(cfg['daily_balls_cap']) - paid)
        balls = 0
        final = []
        for r in kept:
            if r['kind'] == 'BALL':
                a = min(int(r['amount']), room - balls)
                if a <= 0:
                    continue
                balls += a
                r = dict(r, amount=str(a))
            final.append(r)
        merged = []
        for r in final:
            bag_add(merged, r)
        score = int(R['depth']) * 10 + int(R.get('elites', 0)) * 5 + (60 if status == 'won' else 10 if status == 'cashed' else 0)
        db().execute("UPDATE island_runs SET status=?,lives=?,luck=?,depth=?,score=?,ended=?,pending='' WHERE id=?", (status, R['lives'], R['luck'], R['depth'], score, now, run['id']))
        xp = int(R['depth']) * 5 + (100 if status == 'won' else 0) + int(R.get('elites', 0)) * 15
        db().execute("UPDATE island_users SET xp=xp+?,best_depth=CASE WHEN best_depth<? THEN ? ELSE best_depth END,wins=wins+?,paid_day=?,paid_balls=? WHERE user_id=?",
                     (xp, int(R['depth']), int(R['depth']), 1 if status == 'won' else 0, today, paid + balls, uid))
        week = week_of(now)
        db().execute("INSERT INTO island_weekly(week,user_id,score,best_depth,runs) VALUES(?,?,?,?,1) ON CONFLICT(week,user_id) DO UPDATE SET score=CASE WHEN excluded.score>island_weekly.score THEN excluded.score ELSE island_weekly.score END,"
                     "best_depth=CASE WHEN excluded.best_depth>island_weekly.best_depth THEN excluded.best_depth ELSE island_weekly.best_depth END,runs=island_weekly.runs+1", (week, uid, score, int(R['depth'])))
        given = app.extensions['crafter_reward_give'](uid, merged, 'island:' + run['id'][:8]) if merged else {'items': []}
        return {'given': given, 'kept': described(merged), 'score': score, 'xp': xp, 'status': status}

    def start_pending(uid, cfg, R, st, node, now, log):
        t = node['type']
        depth = R['depth']
        if t == 'riddle':
            doors = ['loot', 'empty', 'trap']
            RNG.shuffle(doors)
            if RNG.random() < R['luck'] / 150.0 and 'trap' in doors:
                doors[doors.index('trap')] = 'empty'
            rev = None
            if 'lantern' in st['relics'] and 'trap' in doors:
                rev = doors.index('trap')
            st['pending'] = {'type': 'riddle', 'node': node['id'], 'doors': doors, 'revealed': rev, 'title': 'Три двери', 'text': 'За одной из дверей награда, за другой ловушка, а за третьей пусто. Выбирайте.', 'image': 'icons/i_riddle'}
        elif t == 'merchant':
            disc = 0.7 if 'pearl' in st['relics'] else 1.0
            offers = [{'id': 'heal', 'title': 'Целебная настойка', 'text': '+1 жизнь', 'price': int(int(cfg['price_heal']) * disc), 'image': 'ui/heart_full'},
                      {'id': 'luck', 'title': 'Клевер удачи', 'text': 'Удача +25', 'price': int(int(cfg['price_luck']) * disc), 'image': 'ui/luck_clover'},
                      {'id': 'relic', 'title': 'Редкая реликвия', 'text': 'Случайная реликвия', 'price': int(int(cfg['price_relic']) * disc), 'image': 'icons/i_relic'}]
            st['pending'] = {'type': 'merchant', 'node': node['id'], 'offers': offers, 'title': 'Торговец', 'text': 'Гость издалека разложил товар. Платить придётся из кошелька.', 'image': 'icons/i_merchant'}
        elif t == 'event':
            key = RNG.choice(list(EVENTS))
            ev = EVENTS[key]
            st['pending'] = {'type': 'event', 'node': node['id'], 'key': key, 'title': ev['title'], 'text': ev['text'], 'image': ev['image'], 'options': [{'label': o['label']} for o in ev['options']]}
        elif t == 'boss':
            st['pending'] = {'type': 'boss', 'node': node['id'], 'hp': 3, 'max_hp': 3, 'title': 'Хозяин глубин', 'text': 'Огромный осьминог охраняет главный клад. Бейте, пока не кончились жизни.', 'image': 'icons/i_boss'}

    @app.post('/api/island/step')
    @auth()
    def island_step():
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        node_id = str(body.get('node') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            run = active_run(uid)
            if not run:
                abort(404, description='Экспедиции нет')
            st = load(run)
            if st['pending']:
                abort(409, description='Сначала закончите встречу')
            by_id = {n['id']: n for n in st['map']}
            pos = by_id.get(run['pos'])
            allowed = [n['id'] for n in st['map'] if n['row'] == 1] if not pos else pos['next']
            if node_id not in allowed:
                abort(409, description='Туда не пройти')
            node = by_id[node_id]
            R = {'lives': int(run['lives']), 'max_lives': int(run['max_lives']), 'luck': int(run['luck']), 'depth': int(node['row']), 'elites': int(run['elites'])}
            st['visited'].append(node_id)
            log = []
            t = node['type']
            result = {'type': t, 'node': node_id}
            if t == 'chest':
                mimic = RNG.random() < max(0.03, 0.12 - R['luck'] / 1000.0) and R['depth'] >= 2
                if mimic:
                    result['mimic'] = True
                    lose_life(R, st, '', log)
                    add_luck(R, -5)
                    give_loot(cfg, R, st, tier_of(R['depth'], R['luck'], -1), log, extra_chance=False)
                else:
                    add_luck(R, 4)
                    give_loot(cfg, R, st, tier_of(R['depth'], R['luck']), log)
                    if R['depth'] >= 3 and RNG.random() < 0.08:
                        find_relic(uid, R, st, now, log)
            elif t == 'trap':
                saved = False
                if 'shield' in st['relics'] and not st['flags'].get('shield'):
                    st['flags']['shield'] = True
                    saved = 'shield'
                elif RNG.random() < R['luck'] / 220.0:
                    saved = 'luck'
                if saved:
                    result['saved'] = saved
                    add_luck(R, 3)
                else:
                    lose_life(R, st, '', log)
                    add_luck(R, -8)
            elif t == 'camp':
                heal = 1 + (1 if 'boots' in st['relics'] else 0)
                before = R['lives']
                R['lives'] = min(R['max_lives'], R['lives'] + heal)
                log.append({'t': 'life', 'v': R['lives'] - before})
                add_luck(R, 10)
                result['healed'] = R['lives'] - before
            elif t == 'elite':
                chance = max(0.3, min(0.9, 0.38 + R['luck'] / 250.0 + 0.05 * len(st['relics']) + (0.05 if R['depth'] <= 4 else 0)))
                if RNG.random() < chance:
                    result['won'] = True
                    R['elites'] += 1
                    add_luck(R, 6)
                    for _ in range(2):
                        give_loot(cfg, R, st, tier_of(R['depth'], R['luck'], 1), log, extra_chance=False)
                    if RNG.random() < 0.15:
                        find_relic(uid, R, st, now, log)
                else:
                    result['won'] = False
                    lose_life(R, st, '', log)
                    add_luck(R, -10)
                result['chance'] = int(chance * 100)
            else:
                start_pending(uid, cfg, R, st, node, now, log)
                result['pending'] = True
            result['log'] = log
            return step_save(uid, cfg, run, R, st, node_id, result, now)

    def step_save(uid, cfg, run, R, st, node_id, result, now):
        status = 'active'
        end = None
        if R['lives'] <= 0:
            status = 'dead'
        if status != 'active':
            end = finish(uid, run, R, st, status, cfg, now)
            st['pending'] = None
            store(run['id'], st, pos=node_id)
            db().execute("UPDATE island_runs SET lives=?,luck=?,depth=? WHERE id=?", (max(0, R['lives']), R['luck'], R['depth'], run['id']))
        else:
            store(run['id'], st, pos=node_id, lives=R['lives'], luck=R['luck'], depth=R['depth'], elites=R['elites'])
        out = {'ok': True, 'result': result, 'end': end}
        out['state'] = hub_view(uid, now)
        return out

    @app.post('/api/island/choose')
    @auth()
    def island_choose():
        """A choice inside a meeting: a door of the riddle, an offer of the merchant, an option of the event, an attack on the boss."""
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        choice = body.get('choice')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            run = active_run(uid)
            if not run:
                abort(404, description='Экспедиции нет')
            st = load(run)
            p = st['pending']
            if not p:
                abort(409, description='Выбирать нечего')
            R = {'lives': int(run['lives']), 'max_lives': int(run['max_lives']), 'luck': int(run['luck']), 'depth': int(run['depth']), 'elites': int(run['elites'])}
            log = []
            result = {'type': p['type'], 'node': p.get('node')}
            if p['type'] == 'riddle':
                try:
                    door = int(choice)
                except (TypeError, ValueError):
                    abort(400, description='Выберите дверь')
                if not 0 <= door < 3:
                    abort(400, description='Выберите дверь')
                what = p['doors'][door]
                result['door'] = door
                result['what'] = what
                result['doors'] = p['doors']
                if what == 'loot':
                    add_luck(R, 4)
                    give_loot(cfg, R, st, tier_of(R['depth'], R['luck'], 1), log, extra_chance=False)
                elif what == 'trap':
                    lose_life(R, st, '', log)
                    add_luck(R, -6)
                st['pending'] = None
            elif p['type'] == 'merchant':
                if choice == 'leave':
                    st['pending'] = None
                    result['left'] = True
                else:
                    offer = next((o for o in p['offers'] if o['id'] == choice), None)
                    if not offer:
                        abort(400, description='Такого товара нет')
                    if offer['id'] == 'heal' and R['lives'] >= R['max_lives']:
                        abort(409, description='Жизни и так полные')
                    pay(uid, int(offer['price']))
                    if offer['id'] == 'heal':
                        R['lives'] += 1
                        log.append({'t': 'life', 'v': 1})
                    elif offer['id'] == 'luck':
                        add_luck(R, 25)
                        log.append({'t': 'luck', 'v': 25})
                    else:
                        pool = [r for r in RELIC_ORDER if r not in owned_relics(uid)]
                        if pool:
                            find_relic(uid, R, st, now, log)
                        else:
                            bag_add(st['bag'], {'kind': 'BALL', 'amount': str(int(cfg['relic_dupe_balls'])), 'count': 1})
                            log.append({'t': 'loot', 'items': described([{'kind': 'BALL', 'amount': str(int(cfg['relic_dupe_balls'])), 'count': 1}]), 'tier': 0})
                    p['offers'] = [o for o in p['offers'] if o['id'] != offer['id']]
                    result['bought'] = offer['id']
                    if not p['offers']:
                        st['pending'] = None
                    else:
                        st['pending'] = p
            elif p['type'] == 'event':
                try:
                    idx = int(choice)
                except (TypeError, ValueError):
                    abort(400, description='Выберите вариант')
                ev = EVENTS[p['key']]
                if not 0 <= idx < len(ev['options']):
                    abort(400, description='Выберите вариант')
                outs = ev['options'][idx]['outcomes']
                bonus = 25 if 'parrot' in st['relics'] else 0
                pairs = []
                for w, eff in outs:
                    good = bool(eff.get('loot') is not None or eff.get('luck', 0) > 0 or eff.get('life', 0) > 0 or eff.get('relic'))
                    pairs.append((w * (1 + bonus / 100.0) if good else w, eff))
                eff = weighted(pairs)
                result['msg'] = eff.get('msg', '')
                apply_effect(uid, cfg, R, st, eff, now, log, luck_mod=0)
                st['pending'] = None
            elif p['type'] == 'boss':
                chance = max(0.45, min(0.92, 0.55 + R['luck'] / 300.0 + 0.04 * len(st['relics'])))
                result['chance'] = int(chance * 100)
                if RNG.random() < chance:
                    p['hp'] -= 1
                    result['hit'] = True
                    log.append({'t': 'boss', 'v': -1})
                else:
                    result['hit'] = False
                    lose_life(R, st, '', log)
                    add_luck(R, -5)
                if p['hp'] <= 0:
                    result['defeated'] = True
                    st['pending'] = None
                    R['elites'] += 3
                    pool = [r for r in RELIC_ORDER if r not in owned_relics(uid)]
                    if pool:
                        find_relic(uid, R, st, now, log)
                else:
                    st['pending'] = p
            result['log'] = log
            status = 'active'
            end = None
            if R['lives'] <= 0:
                status = 'dead'
            elif p['type'] == 'boss' and result.get('defeated'):
                status = 'won'
            if status != 'active':
                end = finish(uid, run, R, st, status, cfg, now)
                st['pending'] = None
                store(run['id'], st)
                db().execute("UPDATE island_runs SET lives=?,luck=? WHERE id=?", (max(0, R['lives']), R['luck'], run['id']))
            else:
                store(run['id'], st, lives=R['lives'], luck=R['luck'], elites=R['elites'])
            return {'ok': True, 'result': result, 'end': end, 'state': hub_view(uid, now)}

    @app.post('/api/island/cashout')
    @auth()
    def island_cashout():
        uid, now = g.user['id'], int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            run = active_run(uid)
            if not run:
                abort(404, description='Экспедиции нет')
            st = load(run)
            if st['pending']:
                abort(409, description='Сначала закончите встречу')
            if not st['bag']:
                abort(409, description='В рюкзаке пусто')
            R = {'lives': int(run['lives']), 'max_lives': int(run['max_lives']), 'luck': int(run['luck']), 'depth': int(run['depth']), 'elites': int(run['elites'])}
            end = finish(uid, run, R, st, 'cashed', cfg, now)
            store(run['id'], st)
            return {'ok': True, 'end': end, 'state': hub_view(uid, now)}

    # ------------------------------------------------------------------ leaders «Капитаны»
    def leaders_rows(week, limit=20):
        return db().execute("SELECT w.user_id,w.score,w.best_depth,w.runs FROM island_weekly w WHERE w.week=? ORDER BY w.score DESC, w.best_depth DESC, w.user_id LIMIT ?", (week, limit)).fetchall()

    @app.get('/api/island/leaders')
    @auth()
    def island_leaders():
        now = int(time.time())
        cfg = settings()
        week = week_of(now)
        rows = leaders_rows(week)
        ids = [int(r['user_id']) for r in rows]
        names = {}
        if ids:
            marks = ','.join('?' * len(ids))
            for u in db().execute("SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id IN (%s)" % marks, tuple(ids)).fetchall():
                names[int(u['id'])] = u
        badges = app.extensions['crafter_emoji_statuses'](ids) if ids else {}
        out = [{'rank': i + 1, 'id': str(r['user_id']), 'name': (names.get(int(r['user_id'])) or {'name': ''})['name'] or 'Игрок', 'photo': (names[int(r['user_id'])]['photo_url'] or '') if int(r['user_id']) in names else '',
                'score': int(r['score']), 'depth': int(r['best_depth']), 'runs': int(r['runs']), 'emoji': badges.get(int(r['user_id']))} for i, r in enumerate(rows)]
        me = db().execute("SELECT score FROM island_weekly WHERE week=? AND user_id=?", (week, g.user['id'])).fetchone()
        mine = None
        if me:
            rank = db().execute("SELECT COUNT(*) AS n FROM island_weekly WHERE week=? AND score>?", (week, int(me['score']))).fetchone()
            mine = {'rank': int(rank['n']) + 1, 'score': int(me['score'])}
        places = int(cfg['leader_places'])
        prizes = {str(i): described(cfg['leader_rewards'].get(str(i)) or []) for i in range(1, places + 1)}
        week_end = datetime.fromtimestamp(now, MSK)
        week_end = (week_end + timedelta(days=7 - week_end.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return {'week': week, 'ends': int(week_end.timestamp()), 'leaders': out, 'me': mine, 'prizes': prizes, 'places': places, 'now': now}

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
        week = week_of(now)
        prev = week_of(now - 7 * 86400)
        paid = {w: [dict(r) for r in db().execute("SELECT place,user_id,score FROM island_payouts WHERE week=? ORDER BY place", (w,)).fetchall()] for w in (week, prev)}
        stats = db().execute("SELECT COUNT(*) AS n, SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN status='dead' THEN 1 ELSE 0 END) AS dead, SUM(CASE WHEN status='cashed' THEN 1 ELSE 0 END) AS cashed FROM island_runs").fetchone()
        top = [{'place': i + 1, 'user_id': str(r['user_id']), 'score': int(r['score'])} for i, r in enumerate(leaders_rows(prev, int(cfg['leader_places'])))]
        return {'settings': cfg, 'week': week, 'prev_week': prev, 'paid': paid, 'top_prev': top,
                'stats': {'runs': int(stats['n'] or 0), 'won': int(stats['won'] or 0), 'dead': int(stats['dead'] or 0), 'cashed': int(stats['cashed'] or 0)},
                'relics': [relic_info(r) for r in RELIC_ORDER]}

    @app.get('/api/admin/island')
    @auth(admin=True)
    def admin_island():
        with db():
            return admin_view()

    @app.post('/api/admin/island')
    @auth(admin=True)
    def admin_island_save():
        s = request.get_json(silent=True) or {}
        with db():
            cfg = settings()
            cfg['enabled'] = bool(s.get('enabled'))
            cfg['title'] = ' '.join(str(s.get('title') or cfg['title']).split())[:60] or cfg['title']
            cfg['subtitle'] = ' '.join(str(s.get('subtitle') or '').split())[:160]
            cfg['ticket_price'] = num(s.get('ticket_price', cfg['ticket_price']), 0, 1000000, 'Цена билета')
            cfg['free_daily'] = num(s.get('free_daily', cfg['free_daily']), 0, 10, 'Бесплатных билетов в день')
            cfg['ticket_max'] = num(s.get('ticket_max', cfg['ticket_max']), 0, 20, 'Накопление билетов')
            cfg['buy_max'] = num(s.get('buy_max', cfg['buy_max']), 1, 50, 'Максимум билетов')
            cfg['lives'] = num(s.get('lives', cfg['lives']), 1, 10, 'Жизни')
            cfg['death_loss'] = num(s.get('death_loss', cfg['death_loss']), 0, 100, 'Потеря при гибели, %')
            cfg['daily_balls_cap'] = num(s.get('daily_balls_cap', cfg['daily_balls_cap']), 0, 100000000, 'Суточный лимит')
            for k, label in (('price_heal', 'Цена настойки'), ('price_luck', 'Цена клевера'), ('price_relic', 'Цена реликвии'), ('relic_dupe_balls', 'Замена повтора реликвии')):
                cfg[k] = num(s.get(k, cfg[k]), 0, 100000000, label)
            loot = s.get('loot')
            if isinstance(loot, dict):
                new = {}
                for tier in ('0', '1', '2'):
                    entries = []
                    for e in (loot.get(tier) or [])[:20]:
                        reward = clean(e.get('reward') or [], 'Добыча')
                        if reward:
                            entries.append({'weight': num(e.get('weight', 1), 1, 1000, 'Вес'), 'reward': reward})
                    if not entries:
                        abort(400, description='В таблице добычи %d должна быть хотя бы одна награда' % (int(tier) + 1))
                    new[tier] = entries
                cfg['loot'] = new
            if 'boss_rewards' in s:
                cfg['boss_rewards'] = clean(s.get('boss_rewards') or [], 'Награда за босса')
            cfg['leader_places'] = num(s.get('leader_places', cfg['leader_places']), 1, 10, 'Мест с призами')
            lr = s.get('leader_rewards')
            if isinstance(lr, dict):
                cfg['leader_rewards'] = {str(i): clean(lr.get(str(i)) or [], 'Место %d' % i) for i in range(1, int(cfg['leader_places']) + 1)}
            save_settings(cfg)
        audit('Island settings saved')
        with db():
            return admin_view()

    @app.post('/api/admin/island/tickets')
    @auth(admin=True)
    def admin_island_tickets():
        body = request.get_json(silent=True) or {}
        try:
            uid = int(str(body.get('user_id') or '').strip())
        except ValueError:
            abort(400, description='Нужен Telegram ID')
        amount = num(body.get('amount', 1), -50, 50, 'Билетов')
        with db():
            db().execute('BEGIN IMMEDIATE')
            user_row(uid, int(time.time()))
            db().execute("UPDATE island_users SET tickets=CASE WHEN tickets+?<0 THEN 0 ELSE tickets+? END WHERE user_id=?", (amount, amount, uid))
            row = db().execute("SELECT tickets FROM island_users WHERE user_id=?", (uid,)).fetchone()
        audit('Island tickets %+d for %s' % (amount, uid))
        return {'ok': True, 'tickets': int(row['tickets'])}

    @app.post('/api/admin/island/payout')
    @auth(admin=True)
    def admin_island_payout():
        """Prizes of «Капитаны» for a finished week (the last one by default): once per week, the places are written down."""
        body = request.get_json(silent=True) or {}
        now = int(time.time())
        week = str(body.get('week') or week_of(now - 7 * 86400))
        if week == week_of(now):
            abort(409, description='Неделя ещё идёт: выдайте награды после её конца')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute("SELECT 1 FROM island_payouts WHERE week=? LIMIT 1", (week,)).fetchone():
                abort(409, description='Награды за эту неделю уже выданы')
            cfg = settings()
            done = []
            for i, r in enumerate(leaders_rows(week, int(cfg['leader_places'])), 1):
                reward = cfg['leader_rewards'].get(str(i)) or []
                if reward:
                    app.extensions['crafter_reward_give'](int(r['user_id']), reward, 'island-top:%s:%d' % (week, i))
                db().execute("INSERT INTO island_payouts(week,place,user_id,score,reward,created) VALUES(?,?,?,?,?,?)", (week, i, int(r['user_id']), int(r['score']), json.dumps(reward), now))
                done.append(i)
            if not done:
                abort(409, description='За эту неделю никто не играл')
        audit('Island weekly prizes paid: %s (%d)' % (week, len(done)))
        with db():
            return admin_view()

    @app.post('/api/admin/island/reset')
    @auth(admin=True)
    def admin_island_reset():
        """Closes the running expedition of a player without prizes (for a stuck run) and gives the ticket back."""
        body = request.get_json(silent=True) or {}
        try:
            uid = int(str(body.get('user_id') or '').strip())
        except ValueError:
            abort(400, description='Нужен Telegram ID')
        with db():
            db().execute('BEGIN IMMEDIATE')
            run = active_run(uid)
            if not run:
                abort(404, description='Активной экспедиции нет')
            db().execute("UPDATE island_runs SET status='void',ended=? WHERE id=?", (int(time.time()), run['id']))
            db().execute("UPDATE island_users SET tickets=tickets+1 WHERE user_id=?", (uid,))
        audit('Island run voided for %s' % uid)
        return {'ok': True}
