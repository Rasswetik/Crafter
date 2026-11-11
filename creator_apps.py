"""Creators programme: payout applications for ad videos, with a support chat for every application.

A player signs in with Telegram (Mini App initData or a web session), fills in the form on /creators and attaches
a screen recording. The bot writes the application number; the player follows the status and talks to support on
the same page ("Мои заявки"). Administrators work with the applications in the admin section "Заявки по видео".
"""
import re
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from flask import abort, g, jsonify, request, send_file

PLATFORMS = {'tiktok': 'TikTok'}
STATUSES = {
    'new': 'Отправлена',
    'review': 'На рассмотрении',
    'need_info': 'Нужны уточнения',
    'approved': 'Одобрена, ждёт выплаты',
    'paid': 'Выплачена',
    'rejected': 'Отклонена',
}
CLOSED = {'paid', 'rejected'}
STATUS_EMOJI = {'new': '✅', 'review': '🔎', 'need_info': '⚠', 'approved': '✅', 'paid': '💰', 'rejected': '❌'}
MAX_FILE = 120 * 1024 * 1024
VIDEO_EXT = {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp', '.avi'}
TIKTOK_HOSTS = ('tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com')
USERNAME_RE = re.compile(r'^@?[A-Za-z0-9_]{3,32}$')
OPEN_LIMIT = 5


def tiktok_url(raw):
    """Normalised TikTok link or None."""
    raw = (raw or '').strip()
    if not raw or len(raw) > 300:
        return None
    if not re.match(r'^https?://', raw, re.I):
        raw = 'https://' + raw
    try:
        parts = urlparse(raw)
    except ValueError:
        return None
    host = (parts.hostname or '').lower()
    if not any(host == h or host.endswith('.' + h) for h in TIKTOK_HOSTS):
        return None
    if len(parts.path.strip('/')) < 3:
        return None
    return 'https://' + host + parts.path.rstrip('/')


def install_creator_apps(app, db, auth, record, audit, notify_user):
    """notify_user(user_id, text, number) sends a bot message with the "Рассмотреть" button (a no-op when the bot is off)."""
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS creator_apps (
                number BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, platform TEXT NOT NULL, tg_username TEXT NOT NULL DEFAULT '',
                video_url TEXT NOT NULL, wallet TEXT NOT NULL, status TEXT NOT NULL, amount TEXT NOT NULL DEFAULT '',
                views BIGINT NOT NULL DEFAULT 0, admin_note TEXT NOT NULL DEFAULT '', record_name TEXT NOT NULL DEFAULT '',
                created BIGINT NOT NULL, updated BIGINT NOT NULL, user_seen BIGINT NOT NULL DEFAULT 0, admin_seen BIGINT NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS creator_messages (
                id TEXT PRIMARY KEY, number BIGINT NOT NULL, author TEXT NOT NULL, author_id BIGINT NOT NULL DEFAULT 0,
                body TEXT NOT NULL, created BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS creator_apps_user ON creator_apps(user_id, created);
            CREATE INDEX IF NOT EXISTS creator_messages_number ON creator_messages(number, created);
        """)

    def folder():
        path = Path(app.config['DATABASE']).parent / 'creator_uploads'
        path.mkdir(parents=True, exist_ok=True)
        return path

    def view(row, with_admin=False):
        out = {'number': row['number'], 'platform': row['platform'], 'platform_name': PLATFORMS.get(row['platform'], row['platform']),
               'video_url': row['video_url'], 'wallet': row['wallet'], 'status': row['status'], 'status_text': STATUSES.get(row['status'], row['status']),
               'amount': row['amount'], 'views': int(row['views'] or 0), 'created': row['created'], 'updated': row['updated'],
               'closed': row['status'] in CLOSED, 'has_record': bool(row['record_name'])}
        out['tg_username'] = row['tg_username']
        if with_admin:
            out.update(user_id=row['user_id'], tg_username=row['tg_username'], admin_note=row['admin_note'])
        return out

    def messages(number):
        return [{'id': m['id'], 'author': m['author'], 'text': m['body'], 'created': m['created']}
                for m in db().execute('SELECT * FROM creator_messages WHERE number=? ORDER BY created, id', (number,)).fetchall()]

    def add_message(number, author, author_id, body):
        db().execute('INSERT INTO creator_messages(id,number,author,author_id,body,created) VALUES(?,?,?,?,?,?)',
                     (uuid.uuid4().hex, number, author, author_id, body, int(time.time())))

    def own(number):
        row = db().execute('SELECT * FROM creator_apps WHERE number=? AND user_id=?', (number, g.user['id'])).fetchone()
        if not row:
            abort(404, description='Заявка не найдена')
        return row

    def clean_text(value, limit):
        value = re.sub(r'\s+', ' ', str(value or '')).strip()
        return value[:limit]

    # ---------------- player ----------------
    @app.get('/api/creators/me')
    @auth()
    def creators_me():
        rows = db().execute('SELECT * FROM creator_apps WHERE user_id=? ORDER BY number DESC', (g.user['id'],)).fetchall()
        user = g.user
        unread = 0
        out = []
        for row in rows:
            item = view(row)
            last = db().execute("SELECT created FROM creator_messages WHERE number=? AND author='support' ORDER BY created DESC LIMIT 1", (row['number'],)).fetchone()
            item['unread'] = bool(last and int(last['created']) > int(row['user_seen'] or 0))
            tail = db().execute("SELECT body,created FROM creator_messages WHERE number=? ORDER BY created DESC, id DESC LIMIT 1", (row['number'],)).fetchone()
            item['last_text'] = (tail['body'][:80] if tail else '')
            item['last_at'] = int(tail['created']) if tail else int(row['created'])
            unread += 1 if item['unread'] else 0
            out.append(item)
        return {'user': {'id': user['id'], 'username': user.get('username') or '', 'name': user.get('first_name') or ''},
                'applications': out, 'unread': unread, 'platforms': [{'key': k, 'name': v} for k, v in PLATFORMS.items()],
                'statuses': STATUSES}

    @app.post('/api/creators/apply')
    @auth()
    def creators_apply():
        request.max_content_length = MAX_FILE + 1024 * 1024
        form = request.form
        platform = form.get('platform', '')
        if platform not in PLATFORMS:
            abort(400, description='Выберите платформу')
        username = (form.get('username') or '').strip()
        if not USERNAME_RE.fullmatch(username):
            abort(400, description='Укажите ваш Telegram юзернейм')
        username = username.lstrip('@')
        url = tiktok_url(form.get('video_url'))
        if not url:
            abort(400, description='Вставьте ссылку на ролик в TikTok')
        wallet_raw = (form.get('wallet') or '').strip()
        try:
            from tonsdk.utils import Address
            Address(wallet_raw)
        except Exception:
            abort(400, description='Укажите адрес кошелька в сети Gram')
        file = request.files.get('record')
        if not file or not file.filename:
            abort(400, description='Прикрепите запись экрана со статистикой')
        ext = Path(file.filename).suffix.lower()
        if ext not in VIDEO_EXT or not (file.mimetype or '').startswith(('video/', 'application/octet-stream')):
            abort(400, description='Запись экрана должна быть видеофайлом')
        uid = g.user['id']
        if db().execute('SELECT 1 FROM creator_apps WHERE video_url=?', (url,)).fetchone():
            abort(409, description='На этот ролик уже подана заявка')
        open_count = db().execute("SELECT COUNT(*) AS n FROM creator_apps WHERE user_id=? AND status NOT IN ('paid','rejected')", (uid,)).fetchone()['n']
        if open_count >= OPEN_LIMIT:
            abort(429, description='Слишком много заявок в работе. Дождитесь решения по прежним.')
        now = int(time.time())
        name = secrets.token_hex(12) + ext
        target = folder() / name
        file.save(target)
        if target.stat().st_size > MAX_FILE:
            target.unlink(missing_ok=True)
            abort(413, description='Файл слишком большой (максимум 120 МБ)')
        number = None
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute('SELECT 1 FROM creator_apps WHERE video_url=?', (url,)).fetchone():
                target.unlink(missing_ok=True)
                abort(409, description='На этот ролик уже подана заявка')
            number = int(db().execute('SELECT COALESCE(MAX(number),1000)+1 AS n FROM creator_apps').fetchone()['n'])
            db().execute('INSERT INTO creator_apps(number,user_id,platform,tg_username,video_url,wallet,status,record_name,created,updated,user_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                         (number, uid, platform, username, url, wallet_raw, 'new', name, now, now, now))
            add_message(number, 'support', 0, 'Заявка получена. Мы проверим запись экрана и ссылку на ролик и ответим здесь. Статус будет меняться на этой странице.')
        audit_text = 'Creator application #%d from %s' % (number, uid)
        db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)', (uid, audit_text, now))
        db().commit()
        try:
            notify_user(uid, '✅ Ваша заявка №%d отправлена.\n\n🔎 Мы проверим запись экрана и ролик и ответим вам. Статус заявки и чат с поддержкой можно открыть ниже.' % number, number)
        except Exception:
            pass
        return {'ok': True, 'number': number}

    @app.get('/api/creators/apps/<int:number>')
    @auth()
    def creators_app(number):
        row = own(number)
        with db():
            db().execute('UPDATE creator_apps SET user_seen=? WHERE number=?', (int(time.time()), number))
        return {'application': view(row), 'messages': messages(number)}

    @app.post('/api/creators/apps/<int:number>/message')
    @auth()
    def creators_message(number):
        row = own(number)
        body = clean_text((request.get_json(silent=True) or {}).get('text'), 1500)
        if not body:
            abort(400, description='Напишите сообщение')
        count = db().execute("SELECT COUNT(*) AS n FROM creator_messages WHERE number=? AND author='user' AND created>?", (number, int(time.time()) - 600)).fetchone()['n']
        if count >= 12:
            abort(429, description='Слишком часто. Подождите немного.')
        with db():
            add_message(number, 'user', g.user['id'], body)
            db().execute('UPDATE creator_apps SET updated=?, admin_seen=0, user_seen=? WHERE number=?', (int(time.time()), int(time.time()), number))
        return {'ok': True, 'messages': messages(number)}

    # ---------------- administrators ----------------
    @app.get('/api/admin/creators/apps')
    @auth(admin=True)
    def admin_creator_apps():
        status = request.args.get('status', '')
        sql = 'SELECT * FROM creator_apps'
        args = []
        if status in STATUSES:
            sql += ' WHERE status=?'
            args.append(status)
        rows = db().execute(sql + ' ORDER BY (CASE WHEN status IN (\'paid\',\'rejected\') THEN 1 ELSE 0 END), updated DESC LIMIT 300', args).fetchall()
        counts = {r['status']: r['n'] for r in db().execute('SELECT status, COUNT(*) AS n FROM creator_apps GROUP BY status').fetchall()}
        items = []
        for row in rows:
            item = view(row, True)
            last = db().execute("SELECT author FROM creator_messages WHERE number=? ORDER BY created DESC, id DESC LIMIT 1", (row['number'],)).fetchone()
            item['waiting_reply'] = bool(last and last['author'] == 'user')
            items.append(item)
        return {'applications': items, 'counts': counts, 'statuses': STATUSES}

    def admin_row(number):
        row = db().execute('SELECT * FROM creator_apps WHERE number=?', (number,)).fetchone()
        if not row:
            abort(404, description='Заявка не найдена')
        return row

    @app.get('/api/admin/creators/apps/<int:number>')
    @auth(admin=True)
    def admin_creator_app(number):
        row = admin_row(number)
        with db():
            db().execute('UPDATE creator_apps SET admin_seen=? WHERE number=?', (int(time.time()), number))
        return {'application': view(row, True), 'messages': messages(number), 'statuses': STATUSES}

    @app.get('/api/admin/creators/apps/<int:number>/record')
    @auth(admin=True)
    def admin_creator_record(number):
        row = admin_row(number)
        path = folder() / Path(row['record_name']).name
        if not row['record_name'] or not path.is_file():
            abort(404, description='Запись экрана не найдена')
        return send_file(path, conditional=True)

    @app.post('/api/admin/creators/apps/<int:number>/status')
    @auth(admin=True)
    def admin_creator_status(number):
        row = admin_row(number)
        data = request.get_json(silent=True) or {}
        status = data.get('status')
        if status not in STATUSES:
            abort(400, description='Неверный статус')
        amount = clean_text(data.get('amount', row['amount']), 20)
        if amount and not re.fullmatch(r'\d{1,7}([.,]\d{1,2})?', amount):
            abort(400, description='Сумма в долларах, например 12,50')
        try:
            views = int(data.get('views', row['views']) or 0)
        except (TypeError, ValueError):
            abort(400, description='Просмотры: целое число')
        note = clean_text(data.get('note', row['admin_note']), 500)
        now = int(time.time())
        with db():
            db().execute('UPDATE creator_apps SET status=?, amount=?, views=?, admin_note=?, updated=? WHERE number=?',
                         (status, amount, max(0, views), note, now, number))
            if status != row['status']:
                add_message(number, 'support', g.user['id'], 'Статус заявки: ' + STATUSES[status] + ('. Сумма к выплате: ' + amount + ' $' if status in ('approved', 'paid') and amount else ''))
        db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)', (g.user['id'], 'Creator application #%d: %s' % (number, status), now))
        db().commit()
        if status != row['status']:
            try:
                notify_user(row['user_id'], STATUS_EMOJI.get(status, '🔎') + ' Заявка №%d: %s.' % (number, STATUSES[status]) + ('\n\n💰 Сумма к выплате: %s $.' % amount if status in ('approved', 'paid') and amount else ''), number)
            except Exception:
                pass
        return {'ok': True, 'application': view(admin_row(number), True), 'messages': messages(number)}

    @app.post('/api/admin/creators/apps/<int:number>/message')
    @auth(admin=True)
    def admin_creator_message(number):
        row = admin_row(number)
        body = clean_text((request.get_json(silent=True) or {}).get('text'), 1500)
        if not body:
            abort(400, description='Напишите сообщение')
        with db():
            add_message(number, 'support', g.user['id'], body)
            db().execute('UPDATE creator_apps SET updated=?, admin_seen=? WHERE number=?', (int(time.time()), int(time.time()), number))
        try:
            notify_user(row['user_id'], '⭐ Сообщение по заявке №%d:\n\n%s' % (number, body[:300]), number)
        except Exception:
            pass
        return {'ok': True, 'messages': messages(number)}
