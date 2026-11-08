"""Website sign-in through the Telegram Mini App (no passwords, no Telegram widget).

Flow
  1. Browser  -> POST /api/web-login/start            -> {token, secret, link}  (link opens the Mini App with startapp=login_<token>)
  2. Mini App -> GET  /api/web-login/info?token=      (Telegram-authenticated) to show "who is asking"
  3. Mini App -> POST /api/web-login/confirm {token}  (Telegram-authenticated) -> {code}; then it opens the site in a browser
  4. Browser  -> POST /api/web-login/claim {token, secret | code}  -> {session}; the secret is held by the tab that
     started the login, the code is carried by the "return to browser" link. Whichever arrives first wins, once.
  5. The browser keeps the session in localStorage and sends it as X-Crafter-Web-Session. Only SHA-256 hashes of
     secrets and sessions are stored.
"""
import hashlib
import re
import secrets
import threading
import time

from flask import abort, g, request

LOGIN_TTL = 300                       # a sign-in request lives 5 minutes
SESSION_TTL = 30 * 24 * 3600          # a web session lives 30 days
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{16,40}$')
SECRET_RE = re.compile(r'^[A-Za-z0-9_-]{30,80}$')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def describe_agent(agent):
    """Short, safe device label for the confirmation window."""
    agent = agent or ''
    system = ('Windows' if 'Windows' in agent else 'Android' if 'Android' in agent else
              'iPhone' if 'iPhone' in agent else 'Mac' if 'Macintosh' in agent else
              'Linux' if 'Linux' in agent else 'устройство')
    browser = ('Edge' if 'Edg/' in agent else 'Opera' if 'OPR/' in agent else 'Chrome' if 'Chrome/' in agent else
               'Firefox' if 'Firefox/' in agent else 'Safari' if 'Safari/' in agent else 'браузер')
    return browser + ' · ' + system


def install_web_login(app, db, auth, audit, bot_username):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS web_login_requests (
                token TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, status TEXT NOT NULL,
                user_id INTEGER, return_hash TEXT, agent TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL,
                expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS web_sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, agent TEXT NOT NULL DEFAULT '',
                created INTEGER NOT NULL, expires INTEGER NOT NULL, last_seen INTEGER NOT NULL
            );
        """)

    limiter, limiter_lock = {}, threading.Lock()

    def throttle(bucket, limit, window=60):
        ip = (request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0]).strip()
        now = time.time()
        with limiter_lock:
            if len(limiter) > 5000:
                limiter.clear()
            hits = [t for t in limiter.get((bucket, ip), []) if now - t < window]
            if len(hits) >= limit:
                abort(429, description='Слишком много попыток. Подождите минуту.')
            hits.append(now)
            limiter[(bucket, ip)] = hits

    def cleanup():
        now = int(time.time())
        with db():
            db().execute('DELETE FROM web_login_requests WHERE expires<?', (now - 600,))
            db().execute('DELETE FROM web_sessions WHERE expires<?', (now,))

    def web_user(raw):
        """User for a web session token, or None. Used by the shared auth decorator."""
        if not isinstance(raw, str) or not SECRET_RE.fullmatch(raw):
            return None
        now = int(time.time())
        row = db().execute('SELECT user_id,expires,last_seen FROM web_sessions WHERE token_hash=?',
                           (digest(raw),)).fetchone()
        if not row or row['expires'] < now:
            return None
        if now - row['last_seen'] > 600:
            with db():
                db().execute('UPDATE web_sessions SET last_seen=? WHERE token_hash=?', (now, digest(raw)))
        user = db().execute('SELECT id,name,username FROM users WHERE id=?', (row['user_id'],)).fetchone()
        if not user:
            return None
        photo = db().execute('SELECT photo_url FROM user_avatars WHERE user_id=?', (user['id'],)).fetchone()
        return {'id': int(user['id']), 'first_name': user['name'] or '', 'username': user['username'] or '',
                'photo_url': photo['photo_url'] if photo else None}
    app.extensions['crafter_web_session_user'] = web_user

    @app.post('/api/web-login/start')
    def web_login_start():
        throttle('start', 15)
        cleanup()
        username = (bot_username() or '').strip().lstrip('@')
        if not username:
            abort(503, description='Бот не настроен: укажите BOT_USERNAME')
        token, secret = secrets.token_urlsafe(16), secrets.token_urlsafe(32)
        now = int(time.time())
        with db():
            db().execute('INSERT INTO web_login_requests(token,secret_hash,status,agent,created,expires) VALUES(?,?,?,?,?,?)',
                         (token, digest(secret), 'pending', describe_agent(request.headers.get('User-Agent', ''))[:80],
                          now, now + LOGIN_TTL))
        return {'token': token, 'secret': secret, 'expires_in': LOGIN_TTL,
                'link': f'https://t.me/{username}?startapp=login_{token}',
                'app_link': f'tg://resolve?domain={username}&startapp=login_{token}'}

    def pending_request(token):
        if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
            abort(400, description='Неверный запрос входа')
        row = db().execute('SELECT * FROM web_login_requests WHERE token=?', (token,)).fetchone()
        if not row or row['expires'] < int(time.time()):
            abort(410, description='Срок запроса истёк. Начните вход на сайте заново.')
        return row

    def telegram_only():
        if not request.headers.get('X-Telegram-Init-Data'):
            abort(403, description='Подтвердить вход можно только внутри Telegram')

    @app.get('/api/web-login/info')
    @auth()
    def web_login_info():
        telegram_only()
        row = pending_request(request.args.get('token', ''))
        return {'device': row['agent'], 'status': row['status'], 'expires_in': max(0, row['expires'] - int(time.time()))}

    @app.post('/api/web-login/confirm')
    @auth()
    def web_login_confirm():
        telegram_only()
        row = pending_request((request.get_json(silent=True) or {}).get('token'))
        if row['status'] != 'pending':
            abort(409, description='Этот вход уже подтверждён')
        code = secrets.token_urlsafe(32)
        with db():
            db().execute("UPDATE web_login_requests SET status='confirmed',user_id=?,return_hash=? "
                         "WHERE token=? AND status='pending'", (g.user['id'], digest(code), row['token']))
        audit('Website login confirmed')
        return {'ok': True, 'code': code}

    @app.post('/api/web-login/claim')
    def web_login_claim():
        throttle('claim', 90)
        body = request.get_json(silent=True) or {}
        row = pending_request(body.get('token'))
        proof = body.get('secret') or body.get('code')
        if not isinstance(proof, str) or not SECRET_RE.fullmatch(proof):
            abort(400, description='Неверные данные входа')
        if digest(proof) not in (row['secret_hash'], row['return_hash'] or '-'):
            abort(403, description='Этот вход принадлежит другому браузеру')
        if row['status'] == 'pending':
            return {'status': 'pending'}
        if row['status'] != 'confirmed':
            abort(409, description='Вход уже использован')
        session = secrets.token_urlsafe(32)
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            took = db().execute("UPDATE web_login_requests SET status='used' WHERE token=? AND status='confirmed'",
                                (row['token'],)).rowcount
            if not took:
                abort(409, description='Вход уже использован')
            db().execute('INSERT INTO web_sessions VALUES (?,?,?,?,?,?)',
                         (digest(session), row['user_id'], row['agent'], now, now + SESSION_TTL, now))
        return {'status': 'ok', 'session': session}

    @app.post('/api/web-login/logout')
    def web_login_logout():
        raw = request.headers.get('X-Crafter-Web-Session', '')
        if SECRET_RE.fullmatch(raw):
            with db():
                db().execute('DELETE FROM web_sessions WHERE token_hash=?', (digest(raw),))
        return {'ok': True}
