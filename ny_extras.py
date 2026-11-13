"""Small switches of the New Year section and of the interface.

* Section locks: an administrator sets a moment when «Новогодний маркет», «События сообщества» or the
  «Адвент-календарь» opens. Until then the button is grey with a countdown (the advent calendar is also
  closed on the server, so the API cannot be used to peek).
* Hidden admin panel: while the switch is on, the admin entry disappears from the navigation and the profile;
  an administrator opens it again by typing 777 in the top-up amount.
"""
import json
import time

from flask import abort, request

SECTIONS = ('market', 'community', 'advent')
LOCKS_KEY = 'ny_locks_v1'
HIDDEN_KEY = 'admin_panel_hidden_v1'
HIDDEN_SECTIONS_KEY = 'ny_hidden_sections_v1'


def install_ny_extras(app, db, auth, audit):
    def read(key, default):
        row = db().execute("SELECT payload FROM settings WHERE key=?", (key,)).fetchone()
        try:
            return json.loads(row['payload']) if row else default
        except (ValueError, TypeError):
            return default

    def write(key, value):
        db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                     (key, json.dumps(value)))

    def locks():
        raw = read(LOCKS_KEY, {})
        out = {}
        for name in SECTIONS:
            try:
                ts = int(raw.get(name) or 0)
            except (TypeError, ValueError, AttributeError):
                ts = 0
            if ts > 0:
                out[name] = ts
        return out

    def left(section):
        ts = locks().get(section)
        return max(0, ts - int(time.time())) if ts else 0

    def hidden():
        return bool(read(HIDDEN_KEY, {}).get('hidden') is True)

    def hidden_sections():
        raw = read(HIDDEN_SECTIONS_KEY, {})
        return [k for k in SECTIONS if isinstance(raw, dict) and raw.get(k) is True]

    app.extensions['crafter_ny_hidden_sections'] = hidden_sections
    app.extensions['crafter_ny_lock_left'] = left
    app.extensions['crafter_admin_hidden'] = hidden

    @app.get('/api/new-year/locks')
    @auth()
    def ny_locks():
        now = int(time.time())
        return {'now': now, 'locks': {k: v for k, v in locks().items() if v > now}, 'hidden': hidden_sections()}

    @app.get('/api/admin/new-year/locks')
    @auth(admin=True)
    def admin_ny_locks():
        return {'now': int(time.time()), 'locks': locks(), 'sections': list(SECTIONS), 'hidden': hidden_sections()}

    @app.post('/api/admin/new-year/locks')
    @auth(admin=True)
    def admin_ny_locks_save():
        body = (request.get_json(silent=True) or {}).get('locks')
        if not isinstance(body, dict):
            abort(400, description='Неверные данные')
        out = {}
        for name in SECTIONS:
            value = body.get(name)
            if value in (None, '', 0, '0'):
                continue
            try:
                ts = int(value)
            except (TypeError, ValueError):
                abort(400, description='Неверное время открытия')
            if not time.time() - 86400 <= ts <= time.time() + 3 * 365 * 86400:
                abort(400, description='Время открытия слишком далеко')
            out[name] = ts
        hide = (request.get_json(silent=True) or {}).get('hidden')
        with db():
            write(LOCKS_KEY, out)
            if isinstance(hide, dict):
                write(HIDDEN_SECTIONS_KEY, {k: bool(hide.get(k)) for k in SECTIONS})
        audit('New Year locks saved')
        return {'ok': True, 'locks': out, 'hidden': hidden_sections()}

    @app.post('/api/admin/ui/admin-hidden')
    @auth(admin=True)
    def admin_hidden_set():
        flag = (request.get_json(silent=True) or {}).get('hidden')
        if not isinstance(flag, bool):
            abort(400, description='hidden: true или false')
        with db():
            write(HIDDEN_KEY, {'hidden': flag})
        audit('Admin panel hidden: ' + str(flag))
        return {'ok': True, 'hidden': flag}
