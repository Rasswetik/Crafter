"""Advent calendar: one free cell per day, opened at a fixed hour, only for subscribers of a Telegram channel.

The administrator binds a channel (the bot must be its administrator so it can check members), sets the
start date and edits the reward of every cell: GRAM, New Year balls, card packs or a personal promo code.
"""
import json
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from flask import abort, g, request

from telegram_bot import bot_api

KINDS = ('GRAM', 'BALL', 'PACK', 'PROMO')
PROMO_KINDS = ('GRAM', 'BALL', 'PACK')
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
SETTINGS_KEY = 'advent_v1'
CHANNEL_KEY = 'advent_channel_v1'
_LIMIT = 10**9
now = time.time          # replaced in tests

DEFAULT_PLAN = (
    ('BALL', '', '50', 1), ('PROMO', 'GRAM', '0.3', 1), ('BALL', '', '100', 1), ('GRAM', '', '0.5', 1), ('BALL', '', '150', 1), ('PACK', '', '', 1),
    ('PROMO', 'BALL', '200', 1), ('BALL', '', '100', 1), ('GRAM', '', '1', 1), ('BALL', '', '200', 1), ('PROMO', 'GRAM', '0.5', 1), ('PACK', '', '', 1),
    ('BALL', '', '150', 1), ('GRAM', '', '1.5', 1), ('BALL', '', '250', 1), ('PROMO', 'BALL', '300', 1), ('BALL', '', '150', 1), ('PACK', '', '', 1),
    ('GRAM', '', '2', 1), ('BALL', '', '300', 1), ('PROMO', 'GRAM', '1', 1), ('BALL', '', '400', 1), ('PACK', '', '', 2), ('PACK', '', '', 3),
)


def plain(d):
    return format(d.normalize(), 'f') if d else '0'


def install_advent(app, db, auth, record, audit, bot_token, notify=None):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS advent_days(
            day BIGINT PRIMARY KEY, kind TEXT NOT NULL, promo_kind TEXT NOT NULL DEFAULT '', amount TEXT NOT NULL DEFAULT '',
            count BIGINT NOT NULL DEFAULT 1, title TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS advent_opens(
            user_id BIGINT NOT NULL, day BIGINT NOT NULL, opened_at BIGINT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY(user_id,day)
        );
        """)

    def read(key, default):
        row = db().execute("SELECT payload FROM settings WHERE key=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return {**default, **json.loads(row['payload'])} if isinstance(default, dict) else json.loads(row['payload'])
        except ValueError:
            return default

    def write(key, value):
        db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                     (key, json.dumps(value, ensure_ascii=False)))

    def cfg():
        c = read(SETTINGS_KEY, {'enabled': False, 'start': date(date.today().year, 12, 1).isoformat(), 'days': 24, 'tz': 3, 'hour': 10, 'require_sub': True})
        return c

    def channel():
        return read(CHANNEL_KEY, None)

    def call(method, payload):
        token = bot_token()
        if not token:
            return None
        try:
            return bot_api(token, method, payload)
        except Exception:
            return None

    sub_cache = {}

    def subscribed(uid):
        ch = channel()
        if not ch:
            return True
        hit = sub_cache.get(uid)
        if hit and now() - hit[0] < 30:
            return hit[1]
        res = call('getChatMember', {'chat_id': ch['id'], 'user_id': uid})
        status = (res or {}).get('status')
        ok = status in ('creator', 'administrator', 'member') or (status == 'restricted' and bool((res or {}).get('is_member')))
        sub_cache[uid] = (now(), ok)
        return ok

    def unlock_ts(c, day):
        try:
            start = date.fromisoformat(c['start'])
        except ValueError:
            start = date.today()
        moment = datetime.combine(start + timedelta(days=day - 1), datetime.min.time()).replace(hour=int(c['hour']),
                                                                                                tzinfo=timezone(timedelta(hours=int(c['tz']))))
        return int(moment.timestamp())

    def ensure_days(count):
        have = {r['day'] for r in db().execute("SELECT day FROM advent_days").fetchall()}
        pack_ok = app.extensions.get('crafter_pack_exists', lambda _: False)('newyear')
        for d in range(1, count + 1):
            if d in have:
                continue
            kind, promo, amount, n = DEFAULT_PLAN[d - 1] if d <= len(DEFAULT_PLAN) else ('BALL', '', '100', 1)
            if kind == 'PACK':
                amount = 'newyear' if pack_ok else ''
                if not pack_ok:
                    kind, amount, n = 'BALL', '100', 1
            if kind == 'PROMO' and promo == 'PACK' and not pack_ok:
                promo, amount = 'BALL', '100'
            db().execute("INSERT INTO advent_days(day,kind,promo_kind,amount,count,title,image_url) VALUES(?,?,?,?,?,?,?)",
                         (d, kind, promo, amount, n, '', ''))

    with app.app_context(), db():
        pass

    def day_row(d):
        return db().execute("SELECT * FROM advent_days WHERE day=?", (d,)).fetchone()

    def title_of(row):
        if row['title']:
            return row['title']
        if row['kind'] == 'GRAM':
            return row['amount'] + ' GRAM'
        if row['kind'] == 'BALL':
            return row['amount'] + ' шаров'
        short = app.extensions.get('crafter_pack_short')
        pack = short(row['amount']) if short and row['amount'] else None
        if row['kind'] == 'PACK':
            return ('Пак ' + (pack['title'] if pack else '')).strip() + (' ×' + str(row['count']) if row['count'] > 1 else '')
        what = {'GRAM': row['amount'] + ' GRAM', 'BALL': row['amount'] + ' шаров'}.get(row['promo_kind'], 'пак ×' + str(row['count']))
        return 'Промокод: ' + what

    def view_day(row, c, uid, opened):
        un = unlock_ts(c, row['day'])
        state = 'opened' if row['day'] in opened else ('ready' if now() >= un else 'locked')
        out = {'day': int(row['day']), 'unlock_at': un, 'state': state, 'kind': row['kind'] if row['kind'] != 'PROMO' else 'PROMO',
               'image_url': row['image_url']}
        if state == 'opened':
            out['reward'] = opened[row['day']]
        return out

    def state_for(uid, admin=False):
        c = cfg()
        count = max(1, min(31, int(c['days'])))
        with db():
            ensure_days(count)
        opened = {r['day']: json.loads(r['result']) for r in db().execute("SELECT day,result FROM advent_opens WHERE user_id=?", (uid,)).fetchall()}
        rows = db().execute("SELECT * FROM advent_days WHERE day<=? ORDER BY day", (count,)).fetchall()
        ch = channel()
        return {'enabled': bool(c['enabled']), 'now': int(now()), 'hour': c['hour'], 'tz': c['tz'], 'require_sub': bool(c['require_sub'] and ch),
                'channel': ({'title': ch['title'], 'username': ch.get('username') or '',
                             'link': ('https://t.me/' + ch['username']) if ch.get('username') else ch.get('invite') or ''} if ch else None),
                'subscribed': subscribed(uid) if ch else None,
                'days': [view_day(r, c, uid, opened) for r in rows]}

    @app.get('/api/advent')
    @auth()
    def advent_state():
        c = cfg()
        if not c['enabled'] and not g.is_admin:
            return {'enabled': False}
        return state_for(g.user['id'])

    def notify_tick():
        """When a new cell has just unlocked, send the players a Telegram message once."""
        c = cfg()
        if not c['enabled'] or notify is None:
            return 0
        count = max(1, min(31, int(c['days'])))
        due = [d for d in range(1, count + 1) if now() >= unlock_ts(c, d)]
        if not due:
            return 0
        day = due[-1]
        state = read('advent_notified_v1', {'day': 0})
        if int(state.get('day', 0)) >= day:
            return 0
        with db():
            write('advent_notified_v1', {'day': day})          # mark first: a crash must not cause a second broadcast
        if now() - unlock_ts(c, day) > 12 * 3600:
            return 0                                           # the server was off for long: stay silent about old news
        sent = 0
        for row in db().execute("SELECT id FROM users").fetchall():
            try:
                if notify(int(row['id']), day):
                    sent += 1
            except Exception:
                pass
            time.sleep(0.05)
        return sent

    app.extensions['crafter_advent_notify_tick'] = notify_tick
    if notify is not None and not app.config.get('TESTING'):
        import threading

        def loop():
            while True:
                time.sleep(60)
                try:
                    with app.app_context():
                        notify_tick()
                except Exception:
                    app.logger.warning('Advent notification round failed')
        threading.Thread(target=loop, daemon=True, name='advent-notify').start()

    @app.get('/api/advent/status')
    @auth()
    def advent_status():
        return {'enabled': bool(cfg()['enabled'])}

    def code_for(uid, kind, amount, count):
        for _ in range(30):
            cand = 'NY-' + ''.join(secrets.choice(CODE_ALPHABET) for _ in range(4)) + '-' + ''.join(secrets.choice(CODE_ALPHABET) for _ in range(4))
            if not db().execute("SELECT 1 FROM promo_codes WHERE code=?", (cand,)).fetchone():
                reward = amount + ':' + str(count) if kind == 'PACK' else amount
                db().execute("INSERT INTO promo_codes(code,reward,currency,uses_limit,used,active,created_by,created,owner_id) VALUES(?,?,?,?,0,1,?,?,?)",
                             (cand, reward, kind, 1, uid, int(now()), uid))
                return cand
        abort(503, description='Не удалось создать код, повторите')

    @app.post('/api/advent/open')
    @auth()
    def advent_open():
        body = request.get_json(silent=True) or {}
        try:
            day = int(body.get('day'))
        except (TypeError, ValueError):
            abort(400, description='Неверный день')
        uid = g.user['id']
        c = cfg()
        if not c['enabled']:
            abort(409, description='Календарь сейчас выключен')
        if not 1 <= day <= max(1, min(31, int(c['days']))):
            abort(400, description='Такого дня нет')
        if now() < unlock_ts(c, day):
            abort(409, description='Эта ячейка ещё закрыта')
        if c['require_sub'] and channel() and not subscribed(uid):
            abort(403, description='Чтобы открывать ячейки, подпишитесь на канал')
        with db():
            db().execute('BEGIN IMMEDIATE')
            have = db().execute("SELECT result FROM advent_opens WHERE user_id=? AND day=?", (uid, day)).fetchone()
            if have:
                return {'ok': True, 'repeat': True, 'day': day, 'reward': json.loads(have['result'])}
            ensure_days(day)
            row = day_row(day)
            reward = {'kind': row['kind'], 'title': title_of(row), 'image_url': row['image_url']}
            if row['kind'] == 'GRAM':
                acc = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
                after = (Decimal(str(acc['balance'])) if acc else Decimal('0')) + Decimal(row['amount'])
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                reward.update(amount=row['amount'], gram_balance=str(after))
            elif row['kind'] == 'BALL':
                wal = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
                after = (int(wal['balls']) if wal else 0) + int(row['amount'])
                db().execute("INSERT INTO new_year_wallets(user_id,balls) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balls=excluded.balls", (uid, after))
                reward.update(amount=row['amount'], balls=after)
            elif row['kind'] == 'PACK':
                ids = [app.extensions['crafter_grant_pack'](uid, row['amount'], 'advent:' + str(day)) for _ in range(int(row['count']))]
                reward.update(pack_ids=ids, count=int(row['count']))
            else:
                reward.update(code=code_for(uid, row['promo_kind'], row['amount'], int(row['count'])), promo_kind=row['promo_kind'])
            db().execute("INSERT INTO advent_opens(user_id,day,opened_at,result) VALUES(?,?,?,?)", (uid, day, int(now()), json.dumps(reward, ensure_ascii=False)))
            record('advent_open', {'day': day, 'kind': row['kind']}, uid=uid)
        return {'ok': True, 'day': day, 'reward': reward}

    # ---- administration (permission section: new-year) ----
    def admin_payload():
        c = cfg()
        count = max(1, min(31, int(c['days'])))
        with db():
            ensure_days(count)
        rows = db().execute("SELECT * FROM advent_days WHERE day<=? ORDER BY day", (count,)).fetchall()
        ch = channel()
        return {'settings': c, 'channel': ch,
                'days': [{'day': int(r['day']), 'kind': r['kind'], 'promo_kind': r['promo_kind'], 'amount': r['amount'], 'count': int(r['count']),
                          'title': r['title'], 'image_url': r['image_url'], 'auto_title': title_of({**dict(r), 'title': ''}),
                          'unlock_at': unlock_ts(c, r['day'])} for r in rows]}

    @app.get('/api/admin/new-year/advent')
    @auth(admin=True)
    def admin_advent():
        return admin_payload()

    @app.post('/api/admin/new-year/advent/settings')
    @auth(admin=True)
    def admin_advent_settings():
        b = request.get_json(silent=True) or {}
        try:
            start = date.fromisoformat(str(b.get('start')))
            days, tz, hour = int(b.get('days')), int(b.get('tz')), int(b.get('hour'))
        except (TypeError, ValueError):
            abort(400, description='Проверьте дату и числа')
        if not 1 <= days <= 31 or not -12 <= tz <= 14 or not 0 <= hour <= 23:
            abort(400, description='Дней: 1–31, часовой пояс −12…+14, час 0–23')
        with db():
            write(SETTINGS_KEY, {'enabled': bool(b.get('enabled')), 'start': start.isoformat(), 'days': days, 'tz': tz, 'hour': hour,
                                 'require_sub': bool(b.get('require_sub', True))})
        audit('Advent settings saved')
        return {'ok': True}

    @app.post('/api/admin/new-year/advent/channel')
    @auth(admin=True)
    def admin_advent_channel():
        raw = str((request.get_json(silent=True) or {}).get('channel') or '').strip()
        m = re.fullmatch(r'(?:https?://)?(?:t\.me/|telegram\.me/)?@?([A-Za-z][A-Za-z0-9_]{3,31})/?', raw)
        chat_id = ('@' + m.group(1)) if m else (raw if re.fullmatch(r'-100\d{5,}', raw) else None)
        if not chat_id:
            abort(400, description='Укажите канал: @username, ссылку t.me/… или числовой id')
        token = bot_token()
        if not token:
            abort(409, description='Бот не настроен: нет токена')
        info = bot_api(token, 'getChat', {'chat_id': chat_id})
        if not info or info.get('type') not in ('channel', 'supergroup', 'group'):
            abort(409, description='Это не канал или группа')
        me = bot_api(token, 'getMe', {})
        try:
            member = bot_api(token, 'getChatMember', {'chat_id': info['id'], 'user_id': me['id']})
        except Exception:
            member = None
        if not member or member.get('status') not in ('administrator', 'creator'):
            abort(409, description='Бот должен быть администратором этого канала. Добавьте его и повторите.')
        data = {'id': info['id'], 'title': info.get('title') or chat_id, 'username': info.get('username') or '', 'invite': info.get('invite_link') or ''}
        with db():
            write(CHANNEL_KEY, data)
        audit('Advent channel bound: ' + data['title'])
        return {'ok': True, 'channel': data}

    @app.post('/api/admin/new-year/advent/channel/clear')
    @auth(admin=True)
    def admin_advent_channel_clear():
        with db():
            db().execute("DELETE FROM settings WHERE key=?", (CHANNEL_KEY,))
        audit('Advent channel cleared')
        return {'ok': True}

    @app.post('/api/admin/new-year/advent/reset')
    @auth(admin=True)
    def admin_advent_reset():
        b = request.get_json(silent=True) or {}
        if b.get('confirm') != 'RESET_ADVENT':
            abort(400, description='Подтвердите сброс')
        with db():
            db().execute("DELETE FROM advent_opens")
            write('advent_notified_v1', {'day': 0})
            if b.get('rewards'):
                db().execute("DELETE FROM advent_days")
        sub_cache.clear()
        audit('Advent reset' + (' with rewards' if b.get('rewards') else ''))
        return {'ok': True}

    @app.post('/api/admin/new-year/advent/days/<int:day>')
    @auth(admin=True)
    def admin_advent_day(day):
        b = request.get_json(silent=True) or {}
        if not 1 <= day <= 31:
            abort(404)
        kind, promo = b.get('kind'), b.get('promo_kind') or ''
        if kind not in KINDS or (kind == 'PROMO' and promo not in PROMO_KINDS):
            abort(400, description='Неверный тип награды')
        eff = promo if kind == 'PROMO' else kind
        try:
            if eff == 'PACK':
                amount = str(b.get('amount') or '')
                if not app.extensions['crafter_pack_exists'](amount):
                    abort(400, description='Выберите существующий пак')
            elif eff == 'BALL':
                n = int(b.get('amount'))
                if not 1 <= n <= _LIMIT:
                    raise ValueError
                amount = str(n)
            else:
                v = Decimal(str(b.get('amount')))
                if not v.is_finite() or not Decimal('0.01') <= v <= Decimal('100000') or v != v.quantize(Decimal('0.000001')):
                    raise ValueError
                amount = plain(v)
            count = int(b.get('count') or 1)
        except (TypeError, ValueError, InvalidOperation):
            abort(400, description='Проверьте количество или сумму')
        if not 1 <= count <= 20:
            abort(400, description='Паков за награду: от 1 до 20')
        image = str(b.get('image_url') or '').strip()
        if image and not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        title = str(b.get('title') or '').strip()[:80]
        with db():
            db().execute("INSERT INTO advent_days(day,kind,promo_kind,amount,count,title,image_url) VALUES(?,?,?,?,?,?,?) "
                         "ON CONFLICT(day) DO UPDATE SET kind=excluded.kind,promo_kind=excluded.promo_kind,amount=excluded.amount,count=excluded.count,title=excluded.title,image_url=excluded.image_url",
                         (day, kind, promo if kind == 'PROMO' else '', amount, count if eff == 'PACK' else 1, title, image))
        audit('Advent day %d saved' % day)
        return {'ok': True}
