"""Freebies: a row of gift boxes that open by themselves, one after another, at the moments the administrator sets.

An event has a title, pictures (the preview tile in the New Year hub, the background of the page, the regular and the golden box) and
any number of gifts. Every gift has an opening time (Moscow time), a size (normal or large), a golden or regular box and a reward:
GRAM, New Year balls, card packs or gifts of Telegram. A player presses an open box and gets the reward; the box is then replaced by
what was received (the name and the picture)."""
import json
import re
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'CHEST')
SIZES = ('normal', 'large')
LIMIT = 10 ** 9
DEFAULTS = {'preview_bg': '/static/assets/freebies/preview-bg.webp', 'preview_gift': '/static/assets/freebies/preview-gift.webp',
            'page_bg': '/static/assets/freebies/page-bg.webp', 'gift_regular': '/static/assets/freebies/gift-regular.webp',
            'gift_gold': '/static/assets/freebies/gift-gold.webp'}
IMAGE = re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/freebies/[A-Za-z0-9_.-]+')


def install_freebies(app, db, auth, audit, record):
    from packs import money
    from shop_items import plain

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS freebie_events (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, enabled BIGINT NOT NULL DEFAULT 1,
                preview_bg TEXT NOT NULL DEFAULT '', preview_gift TEXT NOT NULL DEFAULT '', page_bg TEXT NOT NULL DEFAULT '',
                gift_regular TEXT NOT NULL DEFAULT '', gift_gold TEXT NOT NULL DEFAULT '', position BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL,
                starts_at BIGINT, ends_at BIGINT
            );
            CREATE TABLE IF NOT EXISTS freebie_gifts (
                id TEXT PRIMARY KEY, event_id TEXT NOT NULL, position BIGINT NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '',
                unlock_at BIGINT NOT NULL, golden BIGINT NOT NULL DEFAULT 0, size TEXT NOT NULL DEFAULT 'normal',
                kind TEXT NOT NULL, amount TEXT NOT NULL, count BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS freebie_claims (
                user_id BIGINT NOT NULL, gift_id TEXT NOT NULL, result TEXT NOT NULL, created BIGINT NOT NULL,
                PRIMARY KEY(user_id, gift_id)
            );
        """)
        database = db()                                            # events made before the period existed
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE freebie_events ADD COLUMN IF NOT EXISTS starts_at BIGINT")
            database.execute("ALTER TABLE freebie_events ADD COLUMN IF NOT EXISTS ends_at BIGINT")
        else:
            cols = [r['name'] for r in database.execute("PRAGMA table_info(freebie_events)").fetchall()]
            for col in ('starts_at', 'ends_at'):
                if col not in cols:
                    database.execute("ALTER TABLE freebie_events ADD COLUMN %s BIGINT" % col)

    def msk_time(value):                                       # 'YYYY-MM-DDTHH:MM' in Moscow time -> unix time
        import calendar
        m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)', str(value or '').strip())
        if not m:
            abort(400, description='Время открытия: дата и часы по Москве')
        try:
            return calendar.timegm(tuple(int(x) for x in m.groups()) + (0,)) - 3 * 3600
        except (ValueError, OverflowError):
            abort(400, description='Время: такой даты нет')

    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def gram_of(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal('0')

    def img(row, key):
        return row[key] or DEFAULTS[key]

    def gift_view(row, claim=None, now=None, secret=False):
        now = now or int(time.time())
        state = 'claimed' if claim else ('ready' if int(row['unlock_at']) <= now else 'locked')
        out = {'id': row['id'], 'label': row['label'], 'golden': bool(row['golden']), 'size': row['size'], 'unlock_at': int(row['unlock_at']), 'state': state}
        if claim:
            out['reward'] = claim
        if not secret:
            out.update(kind=row['kind'], amount=row['amount'], count=int(row['count']))
        return out

    def event_view(row, gifts, claims, now, admin=False):
        out = {'id': row['id'], 'title': row['title'], 'enabled': bool(row['enabled']),
               'starts_at': int(row['starts_at']) if row['starts_at'] else None, 'ends_at': int(row['ends_at']) if row['ends_at'] else None}
        for key in DEFAULTS:
            out[key] = img(row, key)
            if admin:
                out[key + '_custom'] = row[key]
        out['gifts'] = [gift_view(g_, claims.get(g_['id']), now, secret=not admin) for g_ in gifts]
        waiting = [x['unlock_at'] for x in out['gifts'] if x['state'] == 'locked']
        out['next_unlock'] = min(waiting) if waiting else None
        out['ready'] = sum(1 for x in out['gifts'] if x['state'] == 'ready')
        out['total'] = len(out['gifts'])
        out['claimed'] = sum(1 for x in out['gifts'] if x['state'] == 'claimed')
        return out

    def gifts_of(event_id):
        return db().execute("SELECT * FROM freebie_gifts WHERE event_id=? ORDER BY unlock_at, position, created", (event_id,)).fetchall()

    @app.get('/api/freebies')
    @auth()
    def freebies_list():
        now = int(time.time())
        uid = g.user['id']
        claims = {}
        for r in db().execute("SELECT gift_id,result FROM freebie_claims WHERE user_id=?", (uid,)).fetchall():
            claims[r['gift_id']] = json.loads(r['result'])
        events = db().execute("SELECT * FROM freebie_events WHERE enabled=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) ORDER BY position, created", (now, now)).fetchall()
        return {'now': now, 'events': [event_view(e, gifts_of(e['id']), claims, now) for e in events if gifts_of(e['id'])]}

    def receipt(kind, amount, count):
        if kind == 'GRAM':
            return {'title': plain(Decimal(amount)) + ' GRAM', 'image': '/static/assets/gram.svg', 'kind': kind, 'count': 1}
        if kind == 'BALL':
            return {'title': format(int(amount), ',').replace(',', ' ') + ' шаров', 'image': '/static/assets/new-year-ornament.svg', 'kind': kind, 'count': 1}
        if kind == 'PACK':
            pack = app.extensions['crafter_pack_short'](amount) or {}
            return {'title': (pack.get('title') or 'Пак') + (' ×' + str(count) if count > 1 else ''), 'image': pack.get('image') or '', 'kind': kind, 'count': count}
        if kind == 'CHEST':
            chest = app.extensions['crafter_chest_short'](amount) or {}
            return {'title': chest.get('title') or 'Ящик', 'image': chest.get('image') or '', 'kind': kind, 'count': 1}
        star = app.extensions['crafter_star_gift_short'](amount) or {}
        return {'title': (star.get('name') or star.get('title') or 'Подарок') + (' ×' + str(count) if count > 1 else ''), 'image': star.get('image') or '', 'kind': kind, 'count': count}

    @app.post('/api/freebies/claim')
    @auth()
    def freebies_claim():
        gid = (request.get_json(silent=True) or {}).get('gift_id')
        if not isinstance(gid, str):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute("SELECT result FROM freebie_claims WHERE user_id=? AND gift_id=?", (uid, gid)).fetchone()
            if done:
                return {'ok': True, 'result': json.loads(done['result']), 'again': True}
            row = db().execute("SELECT g.*,e.enabled AS ev_on,e.starts_at AS ev_start,e.ends_at AS ev_end FROM freebie_gifts g JOIN freebie_events e ON e.id=g.event_id WHERE g.id=?", (gid,)).fetchone()
            if not row or not row['ev_on']:
                abort(404, description='Подарок не найден')
            if (row['ev_end'] and int(row['ev_end']) <= int(time.time())) or (row['ev_start'] and int(row['ev_start']) > int(time.time())):
                abort(409, description='Это событие сейчас закрыто')
            if int(row['unlock_at']) > int(time.time()):
                abort(409, description='Этот подарок ещё не открылся')
            kind, amount, count = row['kind'], row['amount'], int(row['count'])
            out = {'ok': True}
            if kind == 'GRAM':
                after = gram_of(uid) + Decimal(amount)
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                out['gram_balance'] = str(after)
            elif kind == 'BALL':
                new = balls_of(uid) + int(amount)
                if new > LIMIT:
                    abort(409, description='Баланс шаров превысит максимум')
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (new, uid))
                out['balance'] = {'balls': new}
            elif kind == 'PACK':
                ids = [app.extensions['crafter_grant_pack'](uid, amount, 'freebie:' + gid) for _ in range(count)]
                out.update(pack_id=ids[0], pack_ids=ids)
            elif kind == 'CHEST':
                opened = app.extensions['crafter_open_chest'](uid, amount, 'freebie:' + gid)
                out.update(chest_open=opened, balance=opened['balance'], gram_balance=opened['gram_balance'])
            else:
                ids = [app.extensions['crafter_grant_star_gift'](uid, amount, 'freebie:' + gid) for _ in range(count)]
                out.update(gift_ids=ids)
            result = receipt(kind, amount, count)
            db().execute("INSERT INTO freebie_claims(user_id,gift_id,result,created) VALUES(?,?,?,?)", (uid, gid, json.dumps(result, ensure_ascii=False), int(time.time())))
            record('freebie_claim', {'freebie': gid, 'kind': kind, 'amount': amount, 'count': count}, uid=uid)
            out['result'] = result
            out.setdefault('balance', {'balls': balls_of(uid)})
            out.setdefault('gram_balance', str(gram_of(uid)))
        return out

    # ---------- administration ----------
    def clean_image(value):
        value = str(value or '').strip()
        if value and not IMAGE.fullmatch(value):
            abort(400, description='Картинка: загрузите файл')
        return value

    def admin_event(row, now):
        claims = {}
        for r in db().execute("SELECT gift_id,COUNT(*) AS n FROM freebie_claims GROUP BY gift_id").fetchall():
            claims[r['gift_id']] = int(r['n'])
        out = event_view(row, gifts_of(row['id']), {}, now, admin=True)
        for x in out['gifts']:
            x['taken'] = claims.get(x['id'], 0)
            x.pop('state', None)
            x['opened'] = x['unlock_at'] <= now
        return out

    @app.get('/api/admin/new-year/freebies')
    @auth(admin=True)
    def admin_freebies():
        now = int(time.time())
        rows = db().execute("SELECT * FROM freebie_events ORDER BY position, created").fetchall()
        return {'now': now, 'events': [admin_event(r, now) for r in rows], 'defaults': DEFAULTS}

    @app.post('/api/admin/new-year/freebies/event')
    @auth(admin=True)
    def admin_freebie_event():
        body = request.get_json(silent=True) or {}
        title = ' '.join(str(body.get('title') or '').split())[:40]
        if not title:
            abort(400, description='Введите заголовок')
        imgs = {k: clean_image(body.get(k)) for k in DEFAULTS}
        enabled = 1 if body.get('enabled') in (True, 1, '1', 'true') else 0
        starts = msk_time(body.get('starts_at_msk')) if str(body.get('starts_at_msk') or '').strip() else None
        ends = msk_time(body.get('ends_at_msk')) if str(body.get('ends_at_msk') or '').strip() else None
        if starts and ends and ends <= starts:
            abort(400, description='Конец события должен быть позже начала')
        eid = body.get('id')
        with db():
            if eid:
                if not db().execute("UPDATE freebie_events SET title=?,enabled=?,preview_bg=?,preview_gift=?,page_bg=?,gift_regular=?,gift_gold=?,starts_at=?,ends_at=? WHERE id=?",
                                    (title, enabled, imgs['preview_bg'], imgs['preview_gift'], imgs['page_bg'], imgs['gift_regular'], imgs['gift_gold'], starts, ends, str(eid))).rowcount:
                    abort(404, description='Событие не найдено')
            else:
                eid = uuid.uuid4().hex[:12]
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM freebie_events").fetchone()['n'])
                db().execute("INSERT INTO freebie_events(id,title,enabled,preview_bg,preview_gift,page_bg,gift_regular,gift_gold,position,created,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                             (eid, title, enabled, imgs['preview_bg'], imgs['preview_gift'], imgs['page_bg'], imgs['gift_regular'], imgs['gift_gold'], pos, int(time.time()), starts, ends))
        audit('Freebies event saved: ' + title)
        return {'ok': True, 'id': eid}

    @app.post('/api/admin/new-year/freebies/event/<eid>/delete')
    @auth(admin=True)
    def admin_freebie_event_delete(eid):
        with db():
            if not db().execute("DELETE FROM freebie_events WHERE id=?", (eid,)).rowcount:
                abort(404, description='Событие не найдено')
            ids = [r['id'] for r in db().execute("SELECT id FROM freebie_gifts WHERE event_id=?", (eid,)).fetchall()]
            for gid in ids:
                db().execute("DELETE FROM freebie_claims WHERE gift_id=?", (gid,))
            db().execute("DELETE FROM freebie_gifts WHERE event_id=?", (eid,))
        return {'ok': True}

    def reward_fields(body):
        kind = str(body.get('kind') or '')
        if kind not in KINDS:
            abort(400, description='Награда: GRAM, шары, пак или подарок Telegram')
        count = 1
        if kind == 'GRAM':
            amount = plain(money(body.get('amount'), 'награда'))
        elif kind == 'BALL':
            try:
                n = int(str(body.get('amount')).strip())
            except ValueError:
                abort(400, description='Шары: целое число')
            if not 1 <= n <= LIMIT:
                abort(400, description='Шары: от 1 до %d' % LIMIT)
            amount = str(n)
        else:
            amount = str(body.get('amount') or '')
            if kind == 'CHEST':
                if not app.extensions['crafter_chest_exists'](amount):
                    abort(400, description='Выберите существующий ящик')
                return kind, amount, 1
            if kind == 'PACK' and not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
            if kind == 'STAR' and not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
            try:
                count = int(str(body.get('count') or 1))
            except ValueError:
                abort(400, description='Сколько штук: целое число')
            if not 1 <= count <= 20:
                abort(400, description='Штук в подарке: от 1 до 20')
        return kind, amount, count

    @app.post('/api/admin/new-year/freebies/gift')
    @auth(admin=True)
    def admin_freebie_gift():
        body = request.get_json(silent=True) or {}
        eid = str(body.get('event_id') or '')
        kind, amount, count = reward_fields(body)
        size = 'large' if body.get('size') == 'large' else 'normal'
        golden = 1 if body.get('golden') in (True, 1, '1', 'true') else 0
        label = ' '.join(str(body.get('label') or '').split())[:24]
        unlock = msk_time(body.get('unlock_at_msk'))
        gid = body.get('id')
        with db():
            if not db().execute("SELECT 1 FROM freebie_events WHERE id=?", (eid,)).fetchone():
                abort(404, description='Событие не найдено')
            if gid:
                if not db().execute("UPDATE freebie_gifts SET label=?,unlock_at=?,golden=?,size=?,kind=?,amount=?,count=? WHERE id=? AND event_id=?",
                                    (label, unlock, golden, size, kind, amount, count, str(gid), eid)).rowcount:
                    abort(404, description='Подарок не найден')
            else:
                if int(db().execute("SELECT COUNT(*) AS n FROM freebie_gifts WHERE event_id=?", (eid,)).fetchone()['n']) >= 120:
                    abort(409, description='В событии не больше 120 подарков')
                gid = uuid.uuid4().hex[:12]
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM freebie_gifts WHERE event_id=?", (eid,)).fetchone()['n'])
                db().execute("INSERT INTO freebie_gifts(id,event_id,position,label,unlock_at,golden,size,kind,amount,count,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                             (gid, eid, pos, label, unlock, golden, size, kind, amount, count, int(time.time())))
        return {'ok': True, 'id': gid}

    @app.post('/api/admin/new-year/freebies/series')
    @auth(admin=True)
    def admin_freebie_series():
        """Many gifts at once: the first opens at the given time, the next ones every N hours, the same reward in every one."""
        body = request.get_json(silent=True) or {}
        eid = str(body.get('event_id') or '')
        kind, amount, count = reward_fields(body)
        start = msk_time(body.get('start_msk'))
        try:
            n = int(str(body.get('number') or 0))
            step = Decimal(str(body.get('step_hours') or 24))
            every = int(str(body.get('golden_every') or 0))
        except (ValueError, ArithmeticError):
            abort(400, description='Число подарков, шаг в часах и каждый какой золотой: числа')
        if not 1 <= n <= 60 or not Decimal('0.01') <= step <= 24 * 60 or not 0 <= every <= 60:
            abort(400, description='Подарков от 1 до 60, шаг от 0,01 часа до 60 дней')
        prefix = ' '.join(str(body.get('label_prefix') or 'День').split())[:16]
        size = 'large' if body.get('size') == 'large' else 'normal'
        with db():
            if not db().execute("SELECT 1 FROM freebie_events WHERE id=?", (eid,)).fetchone():
                abort(404, description='Событие не найдено')
            have = int(db().execute("SELECT COUNT(*) AS n FROM freebie_gifts WHERE event_id=?", (eid,)).fetchone()['n'])
            if have + n > 120:
                abort(409, description='В событии не больше 120 подарков')
            pos = int(db().execute("SELECT COALESCE(MAX(position),0) AS n FROM freebie_gifts WHERE event_id=?", (eid,)).fetchone()['n'])
            for i in range(n):
                db().execute("INSERT INTO freebie_gifts(id,event_id,position,label,unlock_at,golden,size,kind,amount,count,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                             (uuid.uuid4().hex[:12], eid, pos + i + 1, '%s %d' % (prefix, have + i + 1), start + int(step * 3600 * i), 1 if every and (i + 1) % every == 0 else 0, size, kind, amount, count, int(time.time())))
        return {'ok': True, 'created': n}

    @app.post('/api/admin/new-year/freebies/gift/<gid>/delete')
    @auth(admin=True)
    def admin_freebie_gift_delete(gid):
        with db():
            if not db().execute("DELETE FROM freebie_gifts WHERE id=?", (gid,)).rowcount:
                abort(404, description='Подарок не найден')
            db().execute("DELETE FROM freebie_claims WHERE gift_id=?", (gid,))
        return {'ok': True}
