"""Community events: a shared goal (e.g. 10 000 crafts) with reward milestones.

Progress is derived from the existing ledger (`history`). When a milestone is
reached its reward appears in the seasonal shop; every buyer receives a unique
promo code (one activation) bound to the buyer, paid in New Year balls or free.
"""
import re
import secrets
import time
import uuid

from flask import abort, g, request

METRICS = {'craft': ('craft',), 'upgrade': ('upgrade',), 'buy': ('buy',), 'sale': ('sale',)}
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
EVENT_ID = 'main'
_LIMIT = 10**9


def install_community_events(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS community_events(
            id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            metric TEXT NOT NULL, target BIGINT NOT NULL, starts BIGINT NOT NULL,
            enabled BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS community_milestones(
            id TEXT PRIMARY KEY, event_id TEXT NOT NULL, threshold BIGINT NOT NULL,
            title TEXT NOT NULL, reward_kind TEXT NOT NULL, reward_amount TEXT NOT NULL,
            supply BIGINT NOT NULL, price_balls BIGINT NOT NULL DEFAULT 0,
            image_url TEXT NOT NULL DEFAULT '', reached_at BIGINT, created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS community_claims(
            milestone_id TEXT NOT NULL, user_id BIGINT NOT NULL, code TEXT NOT NULL,
            price BIGINT NOT NULL, created BIGINT NOT NULL, request_id TEXT NOT NULL,
            PRIMARY KEY(milestone_id,user_id)
        );
        """)
        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS owner_id BIGINT")
        else:
            columns = [r['name'] for r in database.execute("PRAGMA table_info(promo_codes)").fetchall()]
            if columns and 'owner_id' not in columns:
                database.execute("ALTER TABLE promo_codes ADD COLUMN owner_id BIGINT")

    cache = {'key': None, 'value': 0, 'at': 0.0}

    def event_row():
        return db().execute("SELECT * FROM community_events WHERE id=?", (EVENT_ID,)).fetchone()

    def progress_of(event):
        key = (event['metric'], int(event['starts']))
        if cache['key'] == key and time.time() - cache['at'] < app.config.get('COMMUNITY_CACHE_SECONDS', 5):
            return cache['value']
        kinds = METRICS.get(event['metric'], ('craft',))
        marks = ','.join('?' for _ in kinds)
        row = db().execute(
            "SELECT COUNT(*) AS n FROM history WHERE kind IN (" + marks + ") AND created>=?",
            (*kinds, int(event['starts']))).fetchone()
        value = int(row['n'] if row else 0)
        cache.update(key=key, value=value, at=time.time())
        return value

    def wallet_balls(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def mark_reached(event, progress):
        now = int(time.time())
        rows = db().execute(
            "SELECT id FROM community_milestones WHERE event_id=? AND reached_at IS NULL AND threshold<=?",
            (event['id'], progress)).fetchall()
        if rows:
            with db():
                for row in rows:
                    db().execute("UPDATE community_milestones SET reached_at=? WHERE id=? AND reached_at IS NULL",
                                 (now, row['id']))

    def sold_counts(event_id):
        rows = db().execute(
            "SELECT c.milestone_id AS id,COUNT(*) AS n FROM community_claims c "
            "JOIN community_milestones m ON m.id=c.milestone_id WHERE m.event_id=? GROUP BY c.milestone_id",
            (event_id,)).fetchall()
        return {r['id']: int(r['n']) for r in rows}

    def milestones_for(event, uid):
        progress = progress_of(event)
        mark_reached(event, progress)
        rows = db().execute(
            "SELECT * FROM community_milestones WHERE event_id=? ORDER BY threshold ASC", (event['id'],)).fetchall()
        sold = sold_counts(event['id'])
        mine = {r['milestone_id']: r['code'] for r in db().execute(
            "SELECT milestone_id,code FROM community_claims WHERE user_id=?", (uid,)).fetchall()} if uid else {}
        used = set()
        if uid:
            used = {r['code'] for r in db().execute("SELECT code FROM promo_claims WHERE user_id=?", (uid,)).fetchall()}
            opened = {r['id'] for r in db().execute("SELECT id FROM user_packs WHERE user_id=? AND opened_at IS NOT NULL", (uid,)).fetchall()}
        else:
            opened = set()
        short = app.extensions.get('crafter_pack_short')
        out = []
        for r in rows:
            taken = sold.get(r['id'], 0)
            code = mine.get(r['id'])
            pack = short(r['reward_amount']) if r['reward_kind'] == 'PACK' and short else None
            star = app.extensions['crafter_star_gift_short'](r['reward_amount']) if r['reward_kind'] == 'STAR' else None
            redeemed = bool(code) and (code.startswith('STAR:') or ((code[5:] in opened) if code.startswith('PACK:') else (code in used)))
            out.append({'id': r['id'], 'threshold': int(r['threshold']), 'title': r['title'],
                        'reward_kind': r['reward_kind'], 'reward_amount': r['reward_amount'],
                        'supply': int(r['supply']), 'sold': taken, 'left': max(0, int(r['supply']) - taken),
                        'price_balls': int(r['price_balls']), 'image_url': r['image_url'] or (pack['image'] if pack else '') or (star['image'] if star else ''),
                        'pack': pack, 'star': star, 'redeemed': redeemed,
                        'reached': int(r['threshold']) <= progress, 'reached_at': r['reached_at'],
                        'code': code})
        return progress, out

    def payload(uid):
        event = event_row()
        if not event or (not event['enabled'] and not g.is_admin):
            return {'event': None}
        progress, milestones = milestones_for(event, uid)
        return {'event': {'title': event['title'], 'description': event['description'],
                          'metric': event['metric'], 'target': int(event['target']),
                          'enabled': bool(event['enabled'])},
                'progress': progress, 'milestones': milestones,
                'balance': {'balls': wallet_balls(uid)}}

    @app.get('/api/community')
    @auth()
    def community_state():
        return payload(g.user['id'])

    @app.post('/api/community/claim')
    @auth()
    def community_claim():
        body = request.get_json(silent=True) or {}
        mid, rid = body.get('milestone_id'), body.get('request_id')
        if not isinstance(mid, str) or not re.fullmatch(r'[a-f0-9]{32}', mid):
            abort(400, description='Неверная награда')
        if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', rid):
            abort(400, description='Неверный номер запроса')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            event = event_row()
            if not event or not event['enabled']:
                abort(409, description='Событие сейчас выключено')
            row = db().execute("SELECT * FROM community_milestones WHERE id=? AND event_id=?",
                               (mid, event['id'])).fetchone()
            if not row:
                abort(404, description='Награда не найдена')
            have = db().execute("SELECT code FROM community_claims WHERE milestone_id=? AND user_id=?",
                                (mid, uid)).fetchone()
            if have:
                return {'ok': True, 'code': have['code'], 'repeat': True,
                        'balance': {'balls': wallet_balls(uid)}}
            progress = progress_of(event)
            if int(row['threshold']) > progress:
                abort(409, description='Цель ещё не достигнута')
            taken = db().execute("SELECT COUNT(*) AS n FROM community_claims WHERE milestone_id=?", (mid,)).fetchone()['n']
            if int(taken) >= int(row['supply']):
                abort(409, description='Тираж награды закончился')
            price = int(row['price_balls'])
            balls = wallet_balls(uid)
            if balls < price:
                abort(409, description='Недостаточно новогодних шаров')
            if price:
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls - price, uid))
            now = int(time.time())
            if row['reward_kind'] == 'PACK':
                upid = app.extensions['crafter_grant_pack'](uid, row['reward_amount'], 'community:' + mid)
                db().execute("INSERT INTO community_claims(milestone_id,user_id,code,price,created,request_id) VALUES(?,?,?,?,?,?)",
                             (mid, uid, 'PACK:' + upid, price, now, rid))
                record('community_claim', {'milestone': mid, 'pack': row['reward_amount'], 'price_balls': price}, uid=uid)
                return {'ok': True, 'pack_id': upid, 'balance': {'balls': balls - price}}
            if row['reward_kind'] == 'STAR':
                gid = app.extensions['crafter_grant_star_gift'](uid, row['reward_amount'], 'community:' + mid)
                db().execute("INSERT INTO community_claims(milestone_id,user_id,code,price,created,request_id) VALUES(?,?,?,?,?,?)",
                             (mid, uid, 'STAR:' + gid, price, now, rid))
                record('community_claim', {'milestone': mid, 'star_gift': row['reward_amount'], 'price_balls': price}, uid=uid)
                return {'ok': True, 'star_gift': row['reward_amount'], 'gift_id': gid, 'balance': {'balls': balls - price}}
            code = ''
            for _ in range(30):
                candidate = 'NY-' + ''.join(secrets.choice(CODE_ALPHABET) for _ in range(4)) + '-' + \
                            ''.join(secrets.choice(CODE_ALPHABET) for _ in range(4))
                if not db().execute("SELECT 1 FROM promo_codes WHERE code=?", (candidate,)).fetchone():
                    code = candidate
                    break
            if not code:
                abort(503, description='Не удалось создать код, повторите')
            db().execute(
                "INSERT INTO promo_codes(code,reward,currency,uses_limit,used,active,created_by,created,owner_id) "
                "VALUES(?,?,?,?,0,1,?,?,?)",
                (code, row['reward_amount'], row['reward_kind'], 1, uid, now, uid))
            db().execute("INSERT INTO community_claims(milestone_id,user_id,code,price,created,request_id) "
                         "VALUES(?,?,?,?,?,?)", (mid, uid, code, price, now, rid))
            record('community_claim', {'milestone': mid, 'code': code, 'price_balls': price,
                                       'reward': row['reward_amount'], 'currency': row['reward_kind']}, uid=uid)
        return {'ok': True, 'code': code, 'balance': {'balls': balls - price}}

    # ---- administration (permission section: new-year) ----
    def clean_text(value, limit, name, required=True):
        text = value.strip() if isinstance(value, str) else ''
        if required and not text:
            abort(400, description='Заполните поле: ' + name)
        if len(text) > limit:
            abort(400, description='Слишком длинное поле: ' + name)
        return text

    def whole(value, low, high, name):
        try:
            number = int(value)
        except (TypeError, ValueError):
            abort(400, description='Укажите целое число: ' + name)
        if str(value).strip() != str(number) or not low <= number <= high:
            abort(400, description=name + ': от ' + str(low) + ' до ' + str(high))
        return number

    @app.get('/api/admin/new-year/community')
    @auth(admin=True)
    def admin_community():
        event = event_row()
        if not event:
            return {'event': None, 'milestones': [], 'metrics': list(METRICS)}
        progress, milestones = milestones_for(event, g.user['id'])
        return {'event': {'title': event['title'], 'description': event['description'],
                          'metric': event['metric'], 'target': int(event['target']),
                          'enabled': bool(event['enabled']), 'starts': int(event['starts'])},
                'progress': progress, 'milestones': milestones, 'metrics': list(METRICS)}

    @app.post('/api/admin/new-year/community')
    @auth(admin=True)
    def admin_community_save():
        body = request.get_json(silent=True) or {}
        title = clean_text(body.get('title'), 80, 'название')
        description = clean_text(body.get('description'), 300, 'описание', required=False)
        metric = body.get('metric')
        if metric not in METRICS:
            abort(400, description='Неизвестный показатель')
        target = whole(body.get('target'), 1, _LIMIT, 'Цель')
        enabled = 1 if body.get('enabled') in (True, 'true', 1, '1', 'on') else 0
        restart = body.get('restart') in (True, 'true', 1, '1', 'on')
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            event = event_row()
            if not event:
                db().execute("INSERT INTO community_events(id,title,description,metric,target,starts,enabled,created) "
                             "VALUES(?,?,?,?,?,?,?,?)", (EVENT_ID, title, description, metric, target, now, enabled, now))
            else:
                starts = now if restart or metric != event['metric'] else int(event['starts'])
                db().execute("UPDATE community_events SET title=?,description=?,metric=?,target=?,starts=?,enabled=? WHERE id=?",
                             (title, description, metric, target, starts, enabled, EVENT_ID))
                if starts != int(event['starts']):
                    db().execute("UPDATE community_milestones SET reached_at=NULL WHERE event_id=?", (EVENT_ID,))
        cache['key'] = None
        audit('Community event saved: ' + title)
        return {'ok': True}

    @app.post('/api/admin/new-year/community/milestones')
    @auth(admin=True)
    def admin_community_milestone():
        body = request.get_json(silent=True) or {}
        event = event_row()
        if not event:
            abort(409, description='Сначала создайте событие')
        title = clean_text(body.get('title'), 80, 'название награды', required=False)
        threshold = whole(body.get('threshold'), 1, int(event['target']), 'Порог')
        kind = body.get('reward_kind')
        if kind not in ('GRAM', 'BALL', 'PACK', 'STAR'):
            abort(400, description='Награда: GRAM, шары, пак или подарок Telegram')
        if kind == 'STAR':
            amount = str(body.get('reward_amount') or '')
            if not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
        elif kind == 'PACK':
            amount = str(body.get('reward_amount') or '')
            if not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
        elif kind == 'BALL':
            amount = str(whole(body.get('reward_amount'), 1, _LIMIT, 'Награда в шарах'))
        else:
            from promocodes import to_amount
            amount = str(to_amount(body.get('reward_amount')))
        if not title:
            if kind == 'STAR':
                title = (app.extensions['crafter_star_gift_short'](amount) or {}).get('title', 'Подарок')
            elif kind == 'PACK':
                found = app.extensions['crafter_pack_short'](amount)
                title = found['title'] if found else 'Пак'
            elif kind == 'BALL':
                title = amount + ' шаров'
            else:
                title = 'Промокод на ' + amount + ' GRAM'
        supply = whole(body.get('supply'), 1, 1000000, 'Тираж')
        price = whole(body.get('price_balls', 0), 0, _LIMIT, 'Цена в шарах')
        image = clean_text(body.get('image_url'), 400, 'картинка', required=False)
        if image and not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        mid = uuid.uuid4().hex
        with db():
            db().execute("INSERT INTO community_milestones(id,event_id,threshold,title,reward_kind,reward_amount,"
                         "supply,price_balls,image_url,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                         (mid, event['id'], threshold, title, kind, amount, supply, price, image, int(time.time())))
        audit('Community milestone created: ' + title)
        return {'ok': True, 'id': mid}

    @app.post('/api/admin/new-year/community/milestones/<mid>/delete')
    @auth(admin=True)
    def admin_community_milestone_delete(mid):
        with db():
            if not db().execute("DELETE FROM community_milestones WHERE id=?", (mid,)).rowcount:     # already claimed rewards stay with the players
                abort(404, description='Награда не найдена')
            db().execute("DELETE FROM community_claims WHERE milestone_id=?", (mid,))
        audit('Community milestone deleted ' + mid)
        return {'ok': True}
