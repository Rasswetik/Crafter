"""Ordinary Telegram gifts (Bear, Rose, Cake ...) as Crafter inventory items.

* 1 GRAM = 100 Stars: a 15★ gift is worth 0.15 GRAM and is shown with that price.
* They never reach the market. The owner can only sell (the site buys it back at once for its GRAM value) or
  withdraw it: the relayer account then sends a real Telegram gift paid with its own Stars, signed
  "Gift from Crafter".
* They can be used wherever a gift with a GRAM value is accepted (upgrade stakes, craft) and handed out as a
  reward (advent, promo codes, shop, community goals) through app.extensions['crafter_grant_star_gift'].
* Automatic withdrawal is OFF until an administrator enables it. A send whose outcome is unknown is never
  repeated: the withdrawal goes to "review" for an operator.
"""
import os
from pathlib import Path
import asyncio
import json
import threading
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

import relayer_stars as rs

STARS_PER_GRAM = 100
MESSAGE = 'Gift from Crafter'
POLL_SECONDS = 20
LOW_STARS_RETRY = 300
SETTINGS_KEY = 'star_gift_withdraw_v1'
STATE_KEY = 'star_gift_state_v1'

# (key, name, emoji, stars) — the ordinary Telegram gifts.
CATALOG = [
    ('heart', 'Heart', '❤️', 15), ('bear', 'Bear', '🧸', 15),
    ('rose', 'Rose', '🌹', 25), ('gift', 'Gift', '🎁', 25),
    ('cake', 'Cake', '🎂', 50), ('bouquet', 'Bouquet', '💐', 50), ('rocket', 'Rocket', '🚀', 50), ('champagne', 'Champagne', '🍾', 50),
    ('trophy', 'Trophy', '🏆', 100), ('ring', 'Ring', '💍', 100), ('diamond', 'Diamond', '💎', 100),
]
BY_KEY = {key: dict(key=key, name=name, emoji=emoji, stars=stars) for key, name, emoji, stars in CATALOG}


def gram_value(stars):
    return (Decimal(int(stars)) / STARS_PER_GRAM).quantize(Decimal('0.01'))


def catalog_view():
    return [{**item, 'price': format(gram_value(item['stars']), 'f'), 'image': '/static/assets/stargifts/' + item['key'] + '.png'}
            for item in BY_KEY.values()]


def is_star_gift(gift):
    return bool(isinstance(gift, dict) and gift.get('star_gift'))


def install_star_gifts(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS star_gift_withdrawals (
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, gift_id TEXT NOT NULL, payload TEXT NOT NULL,
                status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', retry_at BIGINT NOT NULL DEFAULT 0,
                created BIGINT NOT NULL, updated BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS star_gift_withdrawals_open ON star_gift_withdrawals(status,created);
            CREATE TABLE IF NOT EXISTS star_gift_lease (id INTEGER PRIMARY KEY, until BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS star_gift_assets (
                key TEXT PRIMARY KEY, tg_id BIGINT, stars INTEGER NOT NULL, png BYTEA, updated BIGINT NOT NULL);
        """)
        db().execute("INSERT INTO star_gift_lease VALUES(1,0) ON CONFLICT(id) DO NOTHING")
        # one-time: the first built-in pictures were drawn like emoji; the real Telegram gift pictures replace them everywhere
        if not db().execute("SELECT 1 FROM settings WHERE key='star_gift_png_v1'").fetchone():
            for key in BY_KEY:
                db().execute("UPDATE inventory SET payload=REPLACE(payload,?,?) WHERE payload LIKE ?", ('/stargifts/' + key + '.svg', '/stargifts/' + key + '.png', '%/stargifts/' + key + '.svg%'))
                db().execute("UPDATE star_gift_withdrawals SET payload=REPLACE(payload,?,?) WHERE payload LIKE ?", ('/stargifts/' + key + '.svg', '/stargifts/' + key + '.png', '%/stargifts/' + key + '.svg%'))
            db().execute("INSERT INTO settings(key,payload) VALUES('star_gift_png_v1','{}') ON CONFLICT(key) DO NOTHING")

    # ---------------- Telegram assets (PNG, Stars price, id used for sending) ----------------
    def assets():
        return {r['key']: r for r in db().execute("SELECT key,tg_id,stars,updated,(png IS NOT NULL) AS has_png FROM star_gift_assets")}

    def current_stars(key):
        row = db().execute("SELECT stars FROM star_gift_assets WHERE key=?", (key,)).fetchone()
        return int(row['stars']) if row else BY_KEY[key]['stars']

    def catalog_now():
        known = assets()
        out = []
        for item in BY_KEY.values():
            row = known.get(item['key'])
            stars = int(row['stars']) if row else item['stars']
            image = ('/media/stargift/' + item['key'] + '.png?v=' + str(row['updated']) + 'b') if row and row['has_png'] else '/static/assets/stargifts/' + item['key'] + '.png'
            out.append({**item, 'stars': stars, 'price': format(gram_value(stars), 'f'), 'image': image,
                        'telegram_gift_id': str(row['tg_id']) if row and row['tg_id'] else None, 'synced': bool(row)})
        return out

    ART_CACHE = {}

    @app.get('/media/stargift/<key>.png')
    def star_gift_png(key):
        row = db().execute("SELECT png,updated FROM star_gift_assets WHERE key=?", (key,)).fetchone()
        if not row or not row['png']:
            abort(404)
        import stargift_art
        token = (key, row['updated'])
        if token not in ART_CACHE:
            ART_CACHE.clear()
            try:
                ART_CACHE[token] = stargift_art.compose(bytes(row['png']), key)       # the gift on a background of its own colour
            except Exception:
                # the downloaded picture is broken: show the bundled one instead of an empty frame
                bundled = Path(app.root_path) / 'static' / 'assets' / 'stargifts' / (os.path.basename(key) + '.png')
                if not bundled.is_file():
                    abort(404)
                ART_CACHE[token] = bundled.read_bytes()
        response = app.response_class(ART_CACHE[token], mimetype='image/png')
        response.headers['Cache-Control'] = 'public, max-age=86400, immutable'
        return response

    # ---------------- items ----------------
    def make_gift(key):
        item = next(x for x in catalog_now() if x['key'] == key)
        price = item['price']
        return {'id': 'stargift-' + uuid.uuid4().hex, 'name': item['name'], 'number': '', 'model': '', 'symbol': '', 'backdrop': '',
                'image': item['image'], 'price': price, 'price_unit': 'GRAM',
                'collection_id': 'stargift-' + key, 'origin': 'star-gift', 'star_gift': True,
                'star_key': key, 'stars': item['stars'], 'emoji': item['emoji'], 'telegram_gift_id': item['telegram_gift_id']}

    def grant(uid, key, source='', record_event=True):
        """Give one ordinary gift. Must run inside a transaction."""
        if key not in BY_KEY:
            abort(409, description='Такого подарка нет в каталоге')
        gift = make_gift(key)
        db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted')",
                     (uid, gift['id'], json.dumps(gift, ensure_ascii=False)))
        if record_event:
            record('gift_granted', {'gift': gift, 'source': source or 'star-gift'}, uid=uid)
        return gift['id']

    app.extensions['crafter_grant_star_gift'] = grant
    app.extensions['crafter_star_gift_exists'] = lambda key: key in BY_KEY
    def short(key):
        item = next((x for x in catalog_now() if x['key'] == key), None)
        return {'title': item['name'], 'emoji': item['emoji'], 'stars': item['stars'], 'image': item['image'], 'price': item['price']} if item else None
    app.extensions['crafter_star_gift_short'] = short
    app.extensions['crafter_star_gift_catalog'] = catalog_now

    @app.get('/api/star-gifts/catalog')
    @auth()
    def star_catalog():
        return {'gifts': catalog_now(), 'stars_per_gram': STARS_PER_GRAM}

    def credit(uid, amount):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        after = (Decimal(str(row['balance'])) if row else Decimal('0')) + amount
        db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
                     (uid, str(after)))
        return after

    def own_star_gift(uid, gift_id, status='unlisted'):
        row = db().execute("SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?", (uid, gift_id)).fetchone()
        gift = json.loads(row['payload']) if row else None
        if not row or not is_star_gift(gift):
            abort(404, description='Подарок не найден')
        if row['status'] != status:
            abort(409, description='Подарок сейчас недоступен для этого действия')
        return gift

    @app.post('/api/star-gifts/sell')
    @auth()
    def star_sell():
        data = request.get_json(silent=True)
        gift_id = data.get('gift_id') if isinstance(data, dict) else None
        if not isinstance(gift_id, str) or not 1 <= len(gift_id) <= 200:
            abort(400, description='Некорректный подарок')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            gift = own_star_gift(uid, gift_id)
            amount = gram_value(gift['stars'])
            db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'", (uid, gift_id))
            after = credit(uid, amount)
            record('star_gift_sold', {'gift': gift, 'amount': format(amount, 'f')}, uid=uid)
        return {'ok': True, 'amount': format(amount, 'f'), 'balance': str(after)}

    # ---------------- withdrawal ----------------
    def now():
        return int(time.time())

    @app.post('/api/star-gifts/withdraw')
    @auth()
    def star_withdraw():
        data = request.get_json(silent=True)
        gift_id = data.get('gift_id') if isinstance(data, dict) else None
        if not isinstance(gift_id, str) or not 1 <= len(gift_id) <= 200:
            abort(400, description='Некорректный подарок')
        uid = g.user['id']
        wid = 'sw-' + uuid.uuid4().hex
        with db():
            db().execute('BEGIN IMMEDIATE')
            gift = own_star_gift(uid, gift_id)
            db().execute("UPDATE inventory SET status='withdrawing' WHERE user_id=? AND nft_id=? AND status='unlisted'", (uid, gift_id))
            known = db().execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
            payload = {'gift': gift, 'receiver_user_id': uid, 'receiver_username': g.user.get('username') or (known['username'] if known else '') or ''}
            db().execute("INSERT INTO star_gift_withdrawals(id,user_id,gift_id,payload,status,created,updated) VALUES(?,?,?,?,'queued',?,?)",
                         (wid, uid, gift_id, json.dumps(payload, ensure_ascii=False), now(), now()))
            record('star_gift_withdraw_requested', {'gift': gift, 'withdrawal_id': wid}, uid=uid)
        return {'ok': True, 'id': wid, 'status': 'queued', 'auto': enabled()}

    def set_row(wid, **fields):
        fields['updated'] = now()
        with db():
            db().execute('UPDATE star_gift_withdrawals SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=?', (*fields.values(), wid))

    def finalize(wid, decision, note):
        """decision: 'confirmed' (gift delivered) or 'failed' (gift returns to the inventory)."""
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT * FROM star_gift_withdrawals WHERE id=?", (wid,)).fetchone()
            if not row:
                abort(404, description='Заявка не найдена')
            if row['status'] in ('confirmed', 'failed'):
                abort(409, description='Заявка уже обработана')
            payload = json.loads(row['payload'])
            uid = row['user_id']
            if decision == 'confirmed':
                db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='withdrawing'", (uid, row['gift_id']))
                record('star_gift_withdraw', {'gift': payload['gift'], 'withdrawal_id': wid}, uid=uid)
            else:
                db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='withdrawing'", (uid, row['gift_id']))
                record('star_gift_withdraw_failed', {'gift': payload['gift'], 'reason': note}, uid=uid)
            db().execute("UPDATE star_gift_withdrawals SET status=?,note=?,updated=? WHERE id=?", (decision, note[:300], now(), wid))
        tell = app.extensions.get('crafter_notify_withdrawal')
        if tell:
            tell(uid, payload['gift'], decision == 'confirmed', '' if decision == 'confirmed' else note)

    def enabled():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (SETTINGS_KEY,)).fetchone()
        try:
            return bool(row and json.loads(row[0]).get('enabled'))
        except (ValueError, TypeError, AttributeError):
            return False
    app.extensions['crafter_star_gift_auto_enabled'] = enabled

    def save_state(**fields):
        row = db().execute("SELECT payload FROM settings WHERE key=?", (STATE_KEY,)).fetchone()
        state = json.loads(row[0]) if row else {}
        state.update(fields)
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (STATE_KEY, json.dumps(state)))

    def load_state():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (STATE_KEY,)).fetchone()
        try:
            return json.loads(row[0]) if row else {}
        except ValueError:
            return {}

    def creds():
        return app.extensions['crafter_relayer_credentials']()

    def step(row):
        wid = row['id']
        payload = json.loads(row['payload'])
        gift = payload['gift']
        item = BY_KEY.get(gift.get('star_key'))
        if not item:
            return set_row(wid, status='review', note='Неизвестный подарок каталога')
        api_id, api_hash, session, _ = creds()

        def before_send():
            set_row(wid, status='sending', note='Отправка в Telegram')

        try:
            known = db().execute("SELECT tg_id FROM star_gift_assets WHERE key=?", (item['key'],)).fetchone()
            asyncio.run(rs.send(api_id, api_hash, session, payload['receiver_user_id'], payload.get('receiver_username', ''),
                                current_stars(item['key']), item['emoji'], MESSAGE, before_send, tg_id=known['tg_id'] if known else None))
        except rs.LowBalance as error:
            save_state(stars=error.have, checked=now(), error='')
            return set_row(wid, retry_at=now() + LOW_STARS_RETRY, note='Мало Stars на релейере: %d из %d' % (error.have, error.need))
        except rs.GiftUnavailable:
            return set_row(wid, retry_at=now() + LOW_STARS_RETRY, note='Telegram сейчас не предлагает подарок ' + item['name'])
        except rs.Unresolvable:
            return finalize(wid, 'failed', 'Не удалось найти получателя: укажите @username в Telegram и повторите вывод')
        except rs.Rejected as error:
            return finalize(wid, 'failed', 'Telegram отклонил подарок: ' + str(error))
        except Exception:
            row_now = db().execute("SELECT status FROM star_gift_withdrawals WHERE id=?", (wid,)).fetchone()
            if row_now and row_now['status'] == 'sending':
                return set_row(wid, status='review', note='Результат отправки неизвестен — проверьте вручную, повтор запрещён')
            raise
        finalize(wid, 'confirmed', 'auto-relayer')

    def process():
        """Advance every waiting withdrawal by one attempt. Safe to call repeatedly."""
        if not getattr(g, 'user', None):
            g.user = {'id': 0, 'username': 'star-gifts'}
        stamp = now()
        with db():
            db().execute('BEGIN IMMEDIATE')
            got = db().execute('UPDATE star_gift_lease SET until=? WHERE id=1 AND until<=?', (stamp + 120, stamp)).rowcount
        if not got:
            return {'busy': True}
        done = 0
        try:
            rows = db().execute("SELECT * FROM star_gift_withdrawals WHERE status='queued' AND retry_at<=? ORDER BY created LIMIT 10", (stamp,)).fetchall()
            for row in rows:
                try:
                    step(dict(row))
                    done += 1
                except Exception as error:
                    app.logger.warning('star gift step failed: %s', type(error).__name__)
                    cur = db().execute("SELECT status FROM star_gift_withdrawals WHERE id=?", (row['id'],)).fetchone()
                    if cur and cur['status'] == 'queued':
                        set_row(row['id'], retry_at=now() + 60, note=('retry: ' + type(error).__name__)[:200])
        finally:
            with db():
                db().execute('UPDATE star_gift_lease SET until=0 WHERE id=1')
        return {'processed': done}
    def my_star_withdrawals(uid):
        auto_on = enabled()
        out = []
        for row in db().execute("SELECT id,gift_id,payload,status,note,retry_at,created,updated FROM star_gift_withdrawals WHERE user_id=? ORDER BY created DESC LIMIT 30", (uid,)):
            gift = json.loads(row['payload']).get('gift', {})
            if row['status'] == 'queued':
                if row['note'] and row['retry_at'] > now():
                    text = 'Подарок будет отправлен чуть позже: Telegram временно не принимает отправку'
                else:
                    text = 'Заявка принята, подарок отправляется в Telegram' if auto_on else 'Заявка принята и ждёт обработки администратором'
            else:
                text = {'sending': 'Подарок отправляется в Telegram', 'review': 'Заявка передана администратору на проверку',
                        'confirmed': 'Подарок отправлен вам в Telegram', 'failed': 'Вывод не выполнен, подарок возвращён в инвентарь'}.get(row['status'], row['status'])
            out.append({'id': row['id'], 'kind': 'star', 'gift_id': row['gift_id'], 'name': gift.get('name'), 'number': None, 'stars': gift.get('stars'),
                        'status': row['status'], 'text': text, 'reason': row['note'] if row['status'] == 'failed' else '',
                        'created': row['created'], 'updated': row['updated']})
        return out
    app.extensions['crafter_star_withdrawals'] = my_star_withdrawals
    app.extensions['crafter_star_gift_process'] = process

    # ---------------- administration ----------------
    def overview():
        try:
            creds()
            connected = True
        except Exception:
            connected = False
        rows = [dict(r) for r in db().execute(
            "SELECT w.id,w.user_id,w.status,w.note,w.retry_at,w.created,w.updated,w.payload,u.name,u.username FROM star_gift_withdrawals w "
            "LEFT JOIN users u ON u.id=w.user_id ORDER BY w.created DESC LIMIT 50")]
        jobs = []
        for r in rows:
            gift = json.loads(r.pop('payload')).get('gift', {})
            picture = next((x['image'] for x in catalog_now() if x['key'] == gift.get('star_key')), gift.get('image'))
            jobs.append({**r, 'gift_name': gift.get('name'), 'image': picture, 'stars': gift.get('stars')})
        counts = {r['status']: r['n'] for r in db().execute("SELECT status,COUNT(*) AS n FROM star_gift_withdrawals GROUP BY status")}
        state = load_state()
        catalog = catalog_now()
        report = [
            (bool(enabled()), 'Автовывод включён' if enabled() else 'Автовывод выключен'),
            (connected, 'Аккаунт релейера подключён' if connected else 'Аккаунт релейера не подключён'),
            (not state.get('error') and bool(state.get('checked')), 'Связь с Telegram проверена' if state.get('checked') and not state.get('error') else (state.get('error') or 'Связь с Telegram ещё не проверялась: нажмите «Проверить и загрузить из Telegram»')),
            (state.get('stars') is not None and int(state.get('stars') or 0) >= 15, 'Звёзд на релейере: ' + str(state.get('stars', '—')) + ' (нужно хотя бы 15 на подарок)'),
            (all(i['synced'] for i in catalog), 'Настоящие картинки и ID из Telegram загружены: ' + str(sum(1 for i in catalog if i['synced'])) + ' из ' + str(len(catalog))),
        ]
        return {'enabled': enabled(), 'relayer_connected': connected, 'state': state, 'counts': counts, 'jobs': jobs,
                'catalog': catalog, 'message': MESSAGE, 'report': [{'ok': ok, 'text': text} for ok, text in report]}

    @app.get('/api/admin/star-gifts')
    @auth(admin=True)
    def star_admin():
        return overview()

    @app.post('/api/admin/star-gifts')
    @auth(admin=True)
    def star_admin_set():
        body = request.get_json(silent=True) or {}
        if type(body.get('enabled')) is not bool or body.get('confirm') != 'SET_STAR_GIFTS':
            abort(400, description='Подтвердите изменение')
        if body['enabled']:
            try:
                creds()
            except Exception:
                abort(409, description='Сначала подключите аккаунт Relayer')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (SETTINGS_KEY, json.dumps({'enabled': body['enabled']})))
        audit('Star gift auto withdrawal ' + ('enabled' if body['enabled'] else 'disabled'))
        return overview()

    def sync_assets():
        """Connects to Telegram through the relayer and loads the real gift ids, Stars prices and PNG pictures."""
        wanted = [(i['key'], i['stars'], i['emoji']) for i in BY_KEY.values()]
        try:
            api_id, api_hash, session, _ = creds()
        except Exception:
            save_state(error='Релейер не подключён', checked=now())
            return False
        try:
            result = asyncio.run(rs.sync(api_id, api_hash, session, wanted))
            with db():
                for key, info in result['gifts'].items():
                    old = db().execute("SELECT png FROM star_gift_assets WHERE key=?", (key,)).fetchone()
                    png = info['png'] if info['png'] else (old['png'] if old else None)
                    db().execute("INSERT INTO star_gift_assets(key,tg_id,stars,png,updated) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
                                 "tg_id=excluded.tg_id,stars=excluded.stars,png=excluded.png,updated=excluded.updated",
                                 (key, info['tg_id'], info['stars'], png, now()))
            save_state(stars=result['stars'], gifts={k: True for k in result['gifts']}, pngs=sum(1 for v in result['gifts'].values() if v['png']), checked=now(), error='')
            return True
        except Exception as error:
            save_state(error='Не удалось проверить: ' + type(error).__name__ + ': ' + str(error)[:120] + '. Нажмите «Проверить доступ сервера к Telegram»: это покажет, блокирует ли сеть сервера Telegram.', checked=now())
            return False

    @app.post('/api/admin/star-gifts/check')
    @auth(admin=True)
    def star_admin_check():
        sync_assets()
        return overview()

    @app.post('/api/admin/star-gifts/network')
    @auth(admin=True)
    def star_admin_network():
        from telegram_deposits import telegram_network_report
        return {'report': telegram_network_report()}

    @app.post('/api/admin/star-gifts/run')
    @auth(admin=True)
    def star_admin_run():
        if not enabled():
            abort(409, description='Автовывод выключен')
        return {**process(), **overview()}

    @app.post('/api/admin/star-gifts/<wid>/resolve')
    @auth(admin=True)
    def star_admin_resolve(wid):
        body = request.get_json(silent=True) or {}
        if body.get('decision') not in ('confirmed', 'failed'):
            abort(400)
        finalize(wid, body['decision'], str(body.get('note') or 'решение администратора')[:300])
        audit('Star gift withdrawal ' + wid + ' marked ' + body['decision'])
        return overview()

    @app.post('/api/admin/star-gifts/grant')
    @auth(admin=True)
    def star_admin_grant():
        body = request.get_json(silent=True) or {}
        try:
            uid, count = int(body.get('user_id')), int(body.get('count') or 1)
        except (TypeError, ValueError):
            abort(400, description='Укажите игрока и количество')
        if not 1 <= count <= 50 or body.get('key') not in BY_KEY:
            abort(400, description='Выберите подарок и количество от 1 до 50')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
                abort(404, description='Игрок не найден')
            for _ in range(count):
                grant(uid, body['key'], 'admin')
        audit('Star gift %s x%d granted to %d' % (body['key'], count, uid))
        return {'ok': True}

    last_sync = {'at': 0.0}

    def background():
        while True:
            try:
                with app.app_context():
                    if enabled():
                        process()
                    if time.time() - last_sync['at'] > 1800 and not all(i['synced'] for i in catalog_now()):
                        last_sync['at'] = time.time()          # pictures, ids and prices are missing: load them, no button needed
                        sync_assets()
            except Exception:
                app.logger.warning('star gift background loop failed')
            time.sleep(POLL_SECONDS)

    if not app.config.get('TESTING'):
        threading.Thread(target=background, daemon=True, name='star-gifts').start()
