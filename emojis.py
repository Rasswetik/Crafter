"""Badges («значки», emoji): a small animated picture that a player can keep in the inventory and put next to his name as a status, like the emoji status of Telegram.
An administrator makes badges (a title, a description of its own, an animation: WebM with transparency, WebP, GIF, PNG or SVG). A badge is sold like any other prize:
as an offer, inside a bundle, as one of the options of a choice offer, as a prize of the season. It goes to the inventory of the player (one badge of a kind: a second
one is not given). In the profile the player chooses one of his badges: it stands next to his name everywhere."""
import re
import time
import uuid

from flask import Response, abort, request

MAX_MEDIA = 6_000_000
ID_RE = re.compile(r'[a-z0-9][a-z0-9_-]{1,39}')
MEDIA_RE = re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]{1,120}\.(?:webm|webp|png|gif|svg)')


def sniff_media(body):
    """The real type of an uploaded file: WebM (a video with transparency) or a picture; '' when it is something else."""
    if body[:4] == b'\x1a\x45\xdf\xa3' and b'webm' in body[:400]:
        return 'video/webm'
    from shop_sections import sniff
    return sniff(body)


def install_emojis(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS emoji_defs (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', media TEXT NOT NULL DEFAULT '',
                enabled BIGINT NOT NULL DEFAULT 1, position BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_emojis (
                user_id BIGINT NOT NULL, emoji_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL,
                PRIMARY KEY(user_id, emoji_id)
            );
            CREATE TABLE IF NOT EXISTS user_emoji_status (
                user_id BIGINT PRIMARY KEY, emoji_id TEXT NOT NULL, updated BIGINT NOT NULL
            );
        """)

    with app.app_context(), db():                                       # the first badge: the animated emoji of Goshan Vice (an administrator can delete or change it)
        if not db().execute("SELECT 1 FROM settings WHERE key='emoji_seed_goshanvice_v1'").fetchone():
            db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                         ('goshanvice', 'Goshan Vice', 'Особый значок.', '/static/assets/emoji/goshan-vice.webm', 1, 1, int(time.time())))
            db().execute("INSERT INTO settings(key,payload) VALUES('emoji_seed_goshanvice_v1','1') ON CONFLICT DO NOTHING")

    with app.app_context(), db():                                       # the second badge: Goshan Vice waves (the preview, cut out of its background)
        if not db().execute("SELECT 1 FROM settings WHERE key='emoji_seed_goshanvice_hi_v1'").fetchone():
            db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                         ('goshanvice-hi', 'Goshan Vice: привет', 'Особый значок.', '/static/assets/emoji/goshan-vice-hi.webm', 1, 2, int(time.time())))
            db().execute("INSERT INTO settings(key,payload) VALUES('emoji_seed_goshanvice_hi_v1','1') ON CONFLICT DO NOTHING")

    def media_kind(url):
        m = re.fullmatch(r'/media/shop/([0-9a-f]{32})', url or '')
        if m:
            row = db().execute("SELECT mime FROM shop_media WHERE id=?", (m.group(1),)).fetchone()
            return 'video' if row and row['mime'] == 'video/webm' else 'image'
        return 'video' if str(url).endswith('.webm') else 'image'

    def short(row_or_id):
        row = row_or_id if not isinstance(row_or_id, str) else db().execute("SELECT * FROM emoji_defs WHERE id=?", (row_or_id,)).fetchone()
        if not row:
            return None
        return {'id': row['id'], 'title': row['title'], 'description': row['description'] or 'Особый значок.', 'media': row['media'], 'kind': media_kind(row['media']),
                'image': row['media'] if media_kind(row['media']) == 'image' else '', 'type': 'EMOJI', 'enabled': bool(row['enabled'])}

    def exists(eid):
        return bool(db().execute("SELECT 1 FROM emoji_defs WHERE id=? AND enabled=1", (str(eid),)).fetchone())

    def grant(uid, eid, source):
        """Puts a badge into the inventory. Returns True when it is new, False when the player already has it. Runs inside a transaction."""
        if not exists(eid):
            abort(409, description='Такого значка нет')
        done = db().execute("INSERT INTO user_emojis(user_id,emoji_id,source,created) VALUES(?,?,?,?) ON CONFLICT DO NOTHING", (uid, eid, str(source)[:60], int(time.time())))
        return bool(done.rowcount)

    def owned(uid):
        rows = db().execute("SELECT e.* FROM user_emojis u JOIN emoji_defs e ON e.id=u.emoji_id WHERE u.user_id=? AND e.enabled=1 ORDER BY u.created, e.position", (uid,)).fetchall()
        return [short(r) for r in rows]

    def status_of(uid):
        row = db().execute("SELECT e.* FROM user_emoji_status s JOIN emoji_defs e ON e.id=s.emoji_id JOIN user_emojis u ON u.emoji_id=s.emoji_id AND u.user_id=s.user_id "
                           "WHERE s.user_id=? AND e.enabled=1", (uid,)).fetchone()
        s = short(row) if row else None
        return {'id': s['id'], 'title': s['title'], 'media': s['media'], 'kind': s['kind']} if s else None

    def statuses(uids):
        """{user id: its status badge} for a list of players: the names of the players are shown with it."""
        out = {}
        ids = list({int(x) for x in uids if x is not None})[:400]
        if not ids:
            return out
        marks = ','.join('?' * len(ids))
        for r in db().execute("SELECT s.user_id, e.* FROM user_emoji_status s JOIN emoji_defs e ON e.id=s.emoji_id JOIN user_emojis u ON u.emoji_id=s.emoji_id AND u.user_id=s.user_id "
                              "WHERE s.user_id IN (%s) AND e.enabled=1" % marks, tuple(ids)).fetchall():
            out[int(r['user_id'])] = {'id': r['id'], 'title': r['title'], 'media': r['media'], 'kind': media_kind(r['media'])}
        return out

    app.extensions['crafter_emoji_short'] = short
    app.extensions['crafter_emoji_exists'] = exists
    app.extensions['crafter_grant_emoji'] = grant
    app.extensions['crafter_emoji_status'] = status_of
    app.extensions['crafter_emoji_statuses'] = statuses

    # ---- the player
    @app.get('/api/emojis')
    @auth()
    def emojis_mine():
        return {'emojis': owned(g_user_id()), 'status': status_of(g_user_id())}

    def g_user_id():
        from flask import g
        return g.user['id']

    @app.post('/api/emoji-status')
    @auth()
    def emoji_status_set():
        uid = g_user_id()
        eid = str((request.get_json(silent=True) or {}).get('emoji_id') or '')
        with db():
            if not eid:
                db().execute("DELETE FROM user_emoji_status WHERE user_id=?", (uid,))
            else:
                if not db().execute("SELECT 1 FROM user_emojis u JOIN emoji_defs e ON e.id=u.emoji_id WHERE u.user_id=? AND u.emoji_id=? AND e.enabled=1", (uid, eid)).fetchone():
                    abort(409, description='Этого значка нет в вашем инвентаре')
                db().execute("INSERT INTO user_emoji_status(user_id,emoji_id,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET emoji_id=excluded.emoji_id, updated=excluded.updated",
                             (uid, eid, int(time.time())))
        return {'ok': True, 'status': status_of(uid)}

    # ---- the administrator
    @app.get('/api/admin/emojis')
    @auth(admin=True)
    def admin_emojis():
        rows = db().execute("SELECT * FROM emoji_defs ORDER BY position, created").fetchall()
        out = []
        for r in rows:
            s = short(r)
            s['owners'] = int(db().execute("SELECT COUNT(*) AS n FROM user_emojis WHERE emoji_id=?", (r['id'],)).fetchone()['n'])
            out.append(s)
        return {'emojis': out}

    @app.post('/api/admin/emojis')
    @auth(admin=True)
    def admin_emoji_save():
        body = request.get_json(silent=True) or {}
        eid = str(body.get('id') or '').strip().lower()
        title = ' '.join(str(body.get('title') or '').split())[:60]
        desc = ' '.join(str(body.get('description') or '').split())[:240]
        media = str(body.get('media') or '').strip()
        if not title:
            abort(400, description='Введите название значка')
        if not MEDIA_RE.fullmatch(media):
            abort(400, description='Загрузите анимацию значка (WebM, WebP, GIF, PNG или SVG)')
        with db():
            if eid:
                if not ID_RE.fullmatch(eid):
                    abort(400, description='Код значка: латинские буквы, цифры, - и _')
                old = db().execute("SELECT 1 FROM emoji_defs WHERE id=?", (eid,)).fetchone()
            else:
                eid = 'e' + uuid.uuid4().hex[:10]
                old = None
            enabled = 0 if body.get('enabled') is False else 1
            if old:
                db().execute("UPDATE emoji_defs SET title=?,description=?,media=?,enabled=? WHERE id=?", (title, desc, media, enabled, eid))
            else:
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM emoji_defs").fetchone()['n'])
                db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created) VALUES(?,?,?,?,?,?,?)", (eid, title, desc, media, enabled, pos, int(time.time())))
        audit('Emoji saved: %s' % eid)
        return {'ok': True, 'id': eid}

    @app.post('/api/admin/emojis/<eid>/delete')
    @auth(admin=True)
    def admin_emoji_delete(eid):
        with db():
            if not db().execute("DELETE FROM emoji_defs WHERE id=?", (eid,)).rowcount:
                abort(404, description='Значок не найден')
            db().execute("DELETE FROM user_emojis WHERE emoji_id=?", (eid,))
            db().execute("DELETE FROM user_emoji_status WHERE emoji_id=?", (eid,))
        audit('Emoji deleted: %s' % eid)
        return {'ok': True}

    @app.post('/api/admin/emojis/grant')
    @auth(admin=True)
    def admin_emoji_grant():
        body = request.get_json(silent=True) or {}
        try:
            uid = int(body.get('user_id'))
        except (TypeError, ValueError):
            abort(400, description='Укажите числовой номер игрока')
        with db():
            new = grant(uid, str(body.get('emoji_id') or ''), 'admin')
        audit('Emoji %s given to %s' % (body.get('emoji_id'), uid))
        return {'ok': True, 'new': new}

    @app.post('/api/admin/emojis/media')
    @auth(admin=True)
    def admin_emoji_media():
        request.max_content_length = MAX_MEDIA + 32768
        upload = request.files.get('file')
        if upload is None:
            abort(400, description='Выберите файл')
        body = upload.read(MAX_MEDIA + 1)
        if not body or len(body) > MAX_MEDIA:
            abort(413, description='Файл должен быть не больше 6 МБ')
        mime = sniff_media(body)
        if not mime:
            abort(415, description='Нужна анимация: WebM, WebP, GIF, PNG или безопасный SVG')
        mid = uuid.uuid4().hex
        with db():
            db().execute("INSERT INTO shop_media(id,mime,body,created) VALUES(?,?,?,?)", (mid, mime, body, int(time.time())))
        return {'ok': True, 'url': '/media/shop/' + mid, 'mime': mime}
