"""The event «Vice City: Розыск» (in honour of the release of the long-awaited game).

The player takes «missions» one after another; every mission is an ordinary action in the app (open packs, upgrade, play the arena...). The progress is
counted from the history of the player since the start of the event, so nothing has to be written in the other modules and old actions do not count.
A claimed mission gives its prizes and raises the wanted level (0-5 stars); every new star gives a prize of its own (a badge of the collection Crafter Vice).
It is a separate system: it has nothing to do with the quests of the season pass (only the list of metrics and the way of giving prizes are shared).

Also here: the countdown to the release, the leaderboard «Король Вайс-Сити», the badge «Day One» for those who had enough stars at the moment of the release,
and a bonus day (the balls of the missions are multiplied) right after the release.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import abort, g, request

from pass_tables import parse_rewards, rewards_text
from season_pass import METRICS, PACK_METRICS

SETTINGS_KEY = 'wanted_event_v1'
SEED_KEY = 'wanted_seed_v1'
MSK = timezone(timedelta(hours=3))
DAY_ONE_BADGE = 'wisecraft-dayone'
MAX_MISSIONS = 12
POINTS = {'arena_result': 3, 'pack_open': 2, 'upgrade': 2, 'craft': 2, 'shop_item_buy': 1, 'buy': 1, 'sale': 1, 'chain_claim': 1, 'freebie_claim': 1}

DEFAULT_MISSIONS = (
    ('first_theft', 'Первая кража', 'Открыть 3 пака Vice City.', 'open_vicecity', 3, 1, 'Шары 100', 'm1_first_theft'),
    ('car', 'Тачка', 'Сделать 5 апгрейдов.', 'upgrade', 5, 1, 'Шары 150', 'm2_car'),
    ('bank_heist', 'Ограбление банка', 'Сыграть 10 раундов на арене.', 'arena', 10, 2, 'Шары 250', 'm3_bank_heist'),
    ('smuggling', 'Контрабанда', 'Совершить 3 продажи на маркете.', 'market_sale', 3, 2, 'Шары 300', 'm4_smuggling'),
    ('cash', 'Налик', 'Потратить 5 000 шаров в магазине.', 'balls_spent', 5000, 3, 'Шары 400', 'm5_cash'),
    ('workshop', 'Мастерская', 'Сделать 5 крафтов.', 'craft', 5, 4, 'Шары 500', 'm6_workshop'),
    ('finale', 'Финальное дело', 'Сыграть 20 раундов на арене.', 'arena', 20, 5, 'Шары 1000; Пак vicecity', 'm7_finale'),
)
DEFAULT_STARS = {1: 'Значок wisecraft-wanted', 2: 'Значок wisecraft-cash', 3: 'Значок wisecraft-shades', 4: 'Значок wisecraft-sunset', 5: 'Значок wisecraft-diamond'}


def default_release():
    return int(datetime(2026, 11, 19, 0, 0, tzinfo=MSK).timestamp())


def default_settings():
    return {'enabled': False, 'title': 'Vice City: Розыск', 'subtitle': 'Проходите миссии, получайте звёзды розыска и награды до выхода игры.',
            'starts_at': 0, 'ends_at': 0, 'release_at': default_release(), 'day_one_stars': 3, 'bonus_mult': 2, 'bonus_hours': 24,
            'leader_prizes': ['Гифт и 5 000 GRAM', '2 500 GRAM', '1 000 GRAM']}


def install_wanted(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS wanted_missions (
                id TEXT PRIMARY KEY, position BIGINT NOT NULL DEFAULT 0, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                metric TEXT NOT NULL, target BIGINT NOT NULL DEFAULT 1, level_after BIGINT NOT NULL DEFAULT 1, reward TEXT NOT NULL DEFAULT '[]',
                image TEXT NOT NULL DEFAULT '', enabled BIGINT NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS wanted_stars (star BIGINT PRIMARY KEY, reward TEXT NOT NULL DEFAULT '[]');
            CREATE TABLE IF NOT EXISTS wanted_claims (
                user_id BIGINT NOT NULL, mission_id TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(user_id, mission_id)
            );
        """)
        if not db().execute("SELECT 1 FROM settings WHERE key=?", (SEED_KEY,)).fetchone():
            for i, (mid, title, desc, metric, target, level, reward, img) in enumerate(DEFAULT_MISSIONS):
                db().execute("INSERT INTO wanted_missions(id,position,title,description,metric,target,level_after,reward,image,enabled) VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING",
                             (mid, i + 1, title, desc, metric, target, level, json.dumps(parse_rewards(reward, 'награда')), '/static/assets/wanted/missions/%s.webp' % img))
            for star, text in DEFAULT_STARS.items():
                db().execute("INSERT INTO wanted_stars(star,reward) VALUES(?,?) ON CONFLICT DO NOTHING", (star, json.dumps(parse_rewards(text, 'звезда'))))
            db().execute("INSERT INTO settings(key,payload) VALUES(?,'1') ON CONFLICT DO NOTHING", (SEED_KEY,))

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

    def active(cfg, now):
        return bool(cfg['enabled'] and cfg['starts_at'] and now >= cfg['starts_at'] and (not cfg['ends_at'] or now < cfg['ends_at']))

    def rewards_of(text):
        try:
            data = json.loads(text or '[]')
        except ValueError:
            return []
        return [x for x in data if isinstance(x, dict) and x.get('kind')]

    def described(rewards, mult=1):
        out = []
        for r in rewards:
            r = dict(r)
            if r['kind'] == 'BALL' and mult != 1:
                r['amount'] = str(int(r['amount']) * mult)
            out.append(app.extensions['crafter_reward_describe'](r))
        return out

    # ------------------------------------------------------------------ progress
    def progress(uid, metric, since, now):
        import json as _json
        title, kinds, field = METRICS.get(metric, (None, (), None))
        if not kinds:
            return 0
        marks = ','.join('?' * len(kinds))
        if metric in PACK_METRICS:
            n = 0
            for r in db().execute("SELECT payload FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created<=? LIMIT 5000" % marks, (uid, *kinds, since, now)).fetchall():
                try:
                    n += 1 if _json.loads(r['payload']).get('pack') == PACK_METRICS[metric] else 0
                except Exception:
                    continue
            return n
        if field is None:
            row = db().execute("SELECT COUNT(*) AS n FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created<=?" % marks, (uid, *kinds, since, now)).fetchone()
            return int(row['n'])
        total = Decimal('0')
        for r in db().execute("SELECT payload FROM history WHERE user_id=? AND kind IN (%s) AND created>=? AND created<=? LIMIT 5000" % marks, (uid, *kinds, since, now)).fetchall():
            try:
                v = _json.loads(r['payload']).get(field)
                total += Decimal(str(v)) if v not in (None, '') else 0
            except Exception:
                continue
        return int(total)

    def missions_rows():
        return db().execute("SELECT * FROM wanted_missions WHERE enabled=1 ORDER BY position, id").fetchall()

    def claims_of(uid):
        return {r['mission_id']: int(r['created']) for r in db().execute("SELECT mission_id,created FROM wanted_claims WHERE user_id=?", (uid,)).fetchall()}

    def level_of(rows, claims):
        return max([int(m['level_after']) for m in rows if m['id'] in claims] or [0])

    def bonus_mult(cfg, now):
        end = cfg['release_at'] + int(cfg['bonus_hours']) * 3600
        return int(cfg['bonus_mult']) if cfg['release_at'] and cfg['release_at'] <= now < end and int(cfg['bonus_mult']) > 1 else 1

    def day_one(uid, cfg, rows, claims, now):
        """The badge «Day One»: for those who had enough stars at the moment of the release (given once, when the player comes after it)."""
        if not cfg['release_at'] or now < cfg['release_at'] or not cfg['starts_at']:
            return False
        ext = app.extensions
        if ext['crafter_emoji_owned'](uid, DAY_ONE_BADGE) if 'crafter_emoji_owned' in ext else False:
            return True
        before = {k: v for k, v in claims.items() if v < cfg['release_at']}
        if level_of(rows, before) >= int(cfg['day_one_stars']) and ext['crafter_emoji_exists'](DAY_ONE_BADGE):
            ext['crafter_grant_emoji'](uid, DAY_ONE_BADGE, 'wanted-day-one')
            return True
        return False

    def view(uid, now):
        cfg = settings()
        rows = missions_rows()
        claims = claims_of(uid)
        level = level_of(rows, claims)
        since = cfg['starts_at'] or now
        mult = bonus_mult(cfg, now)
        out, prev_done = [], True
        for m in rows:
            done = m['id'] in claims
            have = progress(uid, m['metric'], since, now) if (prev_done and not done and cfg['starts_at']) else (int(m['target']) if done else 0)
            target = int(m['target'])
            status = 'claimed' if done else 'locked' if not prev_done else ('ready' if have >= target else 'active')
            out.append({'id': m['id'], 'title': m['title'], 'description': m['description'], 'metric': METRICS.get(m['metric'], ('',))[0], 'target': target, 'progress': min(have, target),
                        'level_after': int(m['level_after']), 'image': m['image'], 'status': status, 'rewards': described(rewards_of(m['reward']), mult)})
            prev_done = prev_done and done
        stars = []
        for s in db().execute("SELECT * FROM wanted_stars ORDER BY star").fetchall():
            stars.append({'star': int(s['star']), 'rewards': described(rewards_of(s['reward'])), 'got': level >= int(s['star'])})
        d1 = day_one(uid, cfg, rows, claims, now) if cfg['enabled'] else False
        em = app.extensions['crafter_emoji_short'](DAY_ONE_BADGE)
        return {'enabled': bool(cfg['enabled']), 'active': active(cfg, now), 'title': cfg['title'], 'subtitle': cfg['subtitle'], 'now': now, 'starts_at': cfg['starts_at'], 'ends_at': cfg['ends_at'],
                'release_at': cfg['release_at'], 'released': bool(cfg['release_at'] and now >= cfg['release_at']), 'level': level, 'missions': out, 'stars': stars,
                'bonus': {'mult': mult, 'until': cfg['release_at'] + int(cfg['bonus_hours']) * 3600 if mult > 1 else 0}, 'day_one': {'stars': int(cfg['day_one_stars']), 'got': d1, 'badge': em},
                'leader_prizes': cfg['leader_prizes']}

    @app.get('/api/wanted')
    @auth()
    def wanted_state():
        now = int(time.time())
        with db():
            return view(g.user['id'], now)

    @app.get('/api/wanted/enabled')
    @auth()
    def wanted_enabled():
        cfg = settings()
        return {'enabled': bool(cfg['enabled']), 'title': cfg['title'], 'release_at': cfg['release_at']}

    @app.post('/api/wanted/claim')
    @auth()
    def wanted_claim():
        uid, now = g.user['id'], int(time.time())
        body = request.get_json(silent=True) or {}
        mid = str(body.get('mission_id') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            cfg = settings()
            if not active(cfg, now):
                abort(409, description='Событие сейчас не идёт')
            rows = missions_rows()
            ids = [m['id'] for m in rows]
            if mid not in ids:
                abort(404, description='Миссии нет')
            mission = rows[ids.index(mid)]
            claims = claims_of(uid)
            if mid in claims:
                abort(409, description='Награда уже получена')
            if any(m['id'] not in claims for m in rows[:ids.index(mid)]):
                abort(409, description='Сначала пройдите предыдущую миссию')
            if progress(uid, mission['metric'], cfg['starts_at'], now) < int(mission['target']):
                abort(409, description='Миссия ещё не выполнена')
            before = level_of(rows, claims)
            db().execute("INSERT INTO wanted_claims(user_id,mission_id,created) VALUES(?,?,?)", (uid, mid, now))
            claims[mid] = now
            after = level_of(rows, claims)
            mult = bonus_mult(cfg, now)
            prizes = []
            for r in rewards_of(mission['reward']):
                r = dict(r)
                if r['kind'] == 'BALL' and mult != 1:
                    r['amount'] = str(int(r['amount']) * mult)
                prizes.append(r)
            new_stars = [s for s in range(before + 1, after + 1)]
            for s in new_stars:
                row = db().execute("SELECT reward FROM wanted_stars WHERE star=?", (s,)).fetchone()
                prizes += rewards_of(row['reward']) if row else []
            given = app.extensions['crafter_reward_give'](uid, prizes, 'wanted:' + mid) if prizes else {'items': []}
        audit('Wanted mission claimed: %s by %s' % (mid, uid))
        return {'ok': True, 'given': given, 'level_before': before, 'level_after': after, 'new_stars': new_stars, 'bonus': mult}

    # ------------------------------------------------------------------ leaderboard «Король Вайс-Сити»
    @app.get('/api/wanted/leaders')
    @auth()
    def wanted_leaders():
        now = int(time.time())
        cfg = settings()
        if not cfg['starts_at']:
            return {'leaders': [], 'me': None, 'prizes': cfg['leader_prizes']}
        marks = ','.join('?' * len(POINTS))
        score = {}
        for r in db().execute("SELECT user_id,kind,COUNT(*) AS n FROM history WHERE kind IN (%s) AND created>=? AND created<=? GROUP BY user_id,kind" % marks, (*POINTS, cfg['starts_at'], now)).fetchall():
            score[int(r['user_id'])] = score.get(int(r['user_id']), 0) + POINTS[r['kind']] * int(r['n'])
        order = sorted(score.items(), key=lambda x: (-x[1], x[0]))
        top = order[:20]
        names = {}
        if top:
            marks2 = ','.join('?' * len(top))
            for u in db().execute("SELECT u.id,u.name,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id IN (%s)" % marks2, tuple(u for u, _ in top)).fetchall():
                names[int(u['id'])] = u
        badges = app.extensions['crafter_emoji_statuses']([u for u, _ in top])
        leaders = [{'rank': i + 1, 'id': str(u), 'name': (names.get(u) or {'name': ''})['name'] or 'Игрок', 'photo': (names.get(u) or {'photo_url': ''})['photo_url'] if names.get(u) else '',
                    'points': p, 'emoji': badges.get(u)} for i, (u, p) in enumerate(top)]
        me = g.user['id']
        mine = next(((i + 1, p) for i, (u, p) in enumerate(order) if u == me), None)
        return {'leaders': leaders, 'me': {'rank': mine[0], 'points': mine[1]} if mine else None, 'prizes': cfg['leader_prizes'],
                'points': {'arena_result': 'раунд арены', 'pack_open': 'открытие пака', 'upgrade': 'апгрейд', 'craft': 'крафт'}, 'weights': POINTS}

    # ------------------------------------------------------------------ admin
    def admin_view():
        cfg = settings()
        missions = db().execute("SELECT * FROM wanted_missions ORDER BY position, id").fetchall()
        stars = {int(s['star']): rewards_text(rewards_of(s['reward'])) for s in db().execute("SELECT * FROM wanted_stars").fetchall()}
        return {'settings': cfg, 'metrics': [{'key': k, 'title': v[0]} for k, v in METRICS.items()],
                'missions': [{'id': m['id'], 'title': m['title'], 'description': m['description'], 'metric': m['metric'], 'target': int(m['target']), 'level_after': int(m['level_after']),
                              'reward': rewards_text(rewards_of(m['reward'])), 'image': m['image'], 'enabled': bool(m['enabled'])} for m in missions],
                'stars': [{'star': s, 'reward': stars.get(s, '')} for s in range(1, 6)]}

    @app.get('/api/admin/wanted')
    @auth(admin=True)
    def admin_wanted():
        return admin_view()

    def num(v, lo, hi, what):
        try:
            n = int(str(v).replace(' ', ''))
        except (TypeError, ValueError):
            abort(400, description='%s: целое число' % what)
        if not lo <= n <= hi:
            abort(400, description='%s: от %d до %d' % (what, lo, hi))
        return n

    def parse_time(v):
        v = str(v or '').strip()
        if not v:
            return 0
        try:
            return int(datetime.fromisoformat(v).replace(tzinfo=MSK).timestamp())
        except ValueError:
            abort(400, description='Дата: формат ГГГГ-ММ-ДД ЧЧ:ММ (по Москве)')

    @app.post('/api/admin/wanted')
    @auth(admin=True)
    def admin_wanted_save():
        body = request.get_json(silent=True) or {}
        s = body.get('settings') or {}
        now = int(time.time())
        cfg = settings()
        cfg['enabled'] = bool(s.get('enabled'))
        cfg['title'] = ' '.join(str(s.get('title') or cfg['title']).split())[:60]
        cfg['subtitle'] = ' '.join(str(s.get('subtitle') or '').split())[:200]
        cfg['starts_at'] = parse_time(s.get('starts_at')) if s.get('starts_at') not in (None,) else cfg['starts_at']
        cfg['ends_at'] = parse_time(s.get('ends_at')) if s.get('ends_at') not in (None,) else cfg['ends_at']
        cfg['release_at'] = parse_time(s.get('release_at')) if s.get('release_at') not in (None,) else cfg['release_at']
        cfg['day_one_stars'] = num(s.get('day_one_stars', cfg['day_one_stars']), 1, 5, 'Звёзд для Day One')
        cfg['bonus_mult'] = num(s.get('bonus_mult', cfg['bonus_mult']), 1, 10, 'Множитель бонуса')
        cfg['bonus_hours'] = num(s.get('bonus_hours', cfg['bonus_hours']), 1, 240, 'Часов бонуса')
        prizes = s.get('leader_prizes')
        if isinstance(prizes, list):
            cfg['leader_prizes'] = [' '.join(str(x).split())[:80] for x in prizes[:3]]
        if cfg['enabled'] and not cfg['starts_at']:
            cfg['starts_at'] = now                                   # the progress counts from the moment the event is switched on for the first time
        missions = body.get('missions')
        stars = body.get('stars')
        with db():
            if isinstance(missions, list):
                if not 1 <= len(missions) <= MAX_MISSIONS:
                    abort(400, description='Миссий: от 1 до %d' % MAX_MISSIONS)
                clean, seen = [], set()
                for i, m in enumerate(missions):
                    mid = str(m.get('id') or '').strip().lower()
                    if not mid:
                        import uuid
                        mid = 'm' + uuid.uuid4().hex[:8]
                    if mid in seen:
                        abort(400, description='Одинаковый код миссии: %s' % mid)
                    seen.add(mid)
                    title = ' '.join(str(m.get('title') or '').split())[:50]
                    if not title:
                        abort(400, description='Миссия %d: введите название' % (i + 1))
                    metric = str(m.get('metric') or '')
                    if metric not in METRICS:
                        abort(400, description='Миссия «%s»: выберите, что считать' % title)
                    try:
                        reward = parse_rewards(m.get('reward'), 'Миссия «%s»' % title)
                    except ValueError as err:
                        abort(400, description=str(err))
                    img = str(m.get('image') or '').strip()
                    if img and not (img.startswith('/static/assets/') or img.startswith('/media/shop/')):
                        abort(400, description='Картинка миссии: неверная ссылка')
                    clean.append((mid, i + 1, title, ' '.join(str(m.get('description') or '').split())[:200], metric, num(m.get('target'), 1, 10 ** 9, 'Миссия «%s»: сколько' % title),
                                  num(m.get('level_after'), 0, 5, 'Звёзд после миссии'), json.dumps(reward), img, 0 if m.get('enabled') is False else 1))
                db().execute("DELETE FROM wanted_missions")
                for row in clean:
                    db().execute("INSERT INTO wanted_missions(id,position,title,description,metric,target,level_after,reward,image,enabled) VALUES(?,?,?,?,?,?,?,?,?,?)", row)
            if isinstance(stars, list):
                for x in stars:
                    star = num(x.get('star'), 1, 5, 'Звезда')
                    try:
                        reward = parse_rewards(x.get('reward'), 'Звезда %d' % star)
                    except ValueError as err:
                        abort(400, description=str(err))
                    db().execute("INSERT INTO wanted_stars(star,reward) VALUES(?,?) ON CONFLICT(star) DO UPDATE SET reward=excluded.reward", (star, json.dumps(reward)))
            save_settings(cfg)
        audit('Wanted event saved')
        return admin_view()

    @app.post('/api/admin/wanted/reset')
    @auth(admin=True)
    def admin_wanted_reset():
        body = request.get_json(silent=True) or {}
        try:
            uid = int(str(body.get('user_id') or '').strip())
        except ValueError:
            abort(400, description='Telegram ID игрока: число')
        with db():
            n = db().execute("DELETE FROM wanted_claims WHERE user_id=?", (uid,)).rowcount
        audit('Wanted progress reset for %s' % uid)
        return {'ok': True, 'removed': n}
