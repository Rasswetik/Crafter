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
                enabled BIGINT NOT NULL DEFAULT 1, position BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL,
                poster TEXT NOT NULL DEFAULT '', value BIGINT NOT NULL DEFAULT 300, collection_id TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS emoji_collections (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, photo TEXT NOT NULL DEFAULT '', position BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_emojis (
                user_id BIGINT NOT NULL, emoji_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL,
                PRIMARY KEY(user_id, emoji_id)
            );
            CREATE TABLE IF NOT EXISTS user_emoji_status (
                user_id BIGINT PRIMARY KEY, emoji_id TEXT NOT NULL, updated BIGINT NOT NULL
            );
        """)

    with app.app_context(), db():                                       # old tables get the new columns: the still picture (poster) and the value of a badge
        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE emoji_defs ADD COLUMN IF NOT EXISTS poster TEXT NOT NULL DEFAULT ''")
            database.execute("ALTER TABLE emoji_defs ADD COLUMN IF NOT EXISTS value BIGINT NOT NULL DEFAULT 300")
            database.execute("ALTER TABLE emoji_defs ADD COLUMN IF NOT EXISTS collection_id TEXT NOT NULL DEFAULT ''")
        else:
            cols = {r[1] for r in database.execute("PRAGMA table_info(emoji_defs)").fetchall()}
            if 'poster' not in cols:
                database.execute("ALTER TABLE emoji_defs ADD COLUMN poster TEXT NOT NULL DEFAULT ''")
            if 'value' not in cols:
                database.execute("ALTER TABLE emoji_defs ADD COLUMN value BIGINT NOT NULL DEFAULT 300")
            if 'collection_id' not in cols:
                database.execute("ALTER TABLE emoji_defs ADD COLUMN collection_id TEXT NOT NULL DEFAULT ''")
    with app.app_context(), db():                                       # the first badge (the Goshan Vice one with the drop) is retired: only the two greeting badges stay
        if not db().execute("SELECT 1 FROM settings WHERE key='emoji_remove_goshanvice_v1'").fetchone():
            for table in ('emoji_defs', 'user_emojis', 'user_emoji_status'):
                db().execute("DELETE FROM %s WHERE %s='goshanvice'" % (table, 'id' if table == 'emoji_defs' else 'emoji_id'))
            db().execute("INSERT INTO settings(key,payload) VALUES('emoji_remove_goshanvice_v1','1') ON CONFLICT DO NOTHING")

    with app.app_context(), db():                                       # the second badge: Goshan Vice waves (the preview, cut out of its background)
        if not db().execute("SELECT 1 FROM settings WHERE key='emoji_seed_goshanvice_hi_v1'").fetchone():
            db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                         ('goshanvice-hi', 'Goshan Vice: привет', 'Особый значок.', '/static/assets/emoji/goshan-vice-hi.webm', 1, 2, int(time.time())))
            db().execute("INSERT INTO settings(key,payload) VALUES('emoji_seed_goshanvice_hi_v1','1') ON CONFLICT DO NOTHING")
        if not db().execute("SELECT 1 FROM settings WHERE key='emoji_seed_collections_v1'").fetchone():          # the collections Goshan and Nikolay and the badge of Nikolay
            now = int(time.time())
            db().execute("INSERT INTO emoji_collections(id,title,photo,position,created) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING", ('goshan', 'Goshan', '/static/assets/emoji/collection-goshan.png', 1, now))
            db().execute("INSERT INTO emoji_collections(id,title,photo,position,created) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING", ('nikolay', 'Nikolay', '/static/assets/emoji/collection-nikolay.png', 2, now))
            db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created,poster,collection_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                         ('nikolayvice-hi', 'Nikolay Vice: привет', 'Особый значок.', '/static/assets/emoji/nikolay-vice-hi.webm', 1, 3, now, '/static/assets/emoji/nikolay-vice-hi.png', 'nikolay'))
            db().execute("UPDATE emoji_defs SET collection_id='goshan' WHERE id IN ('goshanvice','goshanvice-hi') AND collection_id=''")
            db().execute("INSERT INTO settings(key,payload) VALUES('emoji_seed_collections_v1','1') ON CONFLICT DO NOTHING")
        db().execute("UPDATE emoji_defs SET poster='/static/assets/emoji/goshan-vice-hi.png' WHERE id='goshanvice-hi' AND poster=''")

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
        kind = media_kind(row['media'])
        coll = None
        if row['collection_id']:
            c = db().execute("SELECT * FROM emoji_collections WHERE id=?", (row['collection_id'],)).fetchone()
            if c:
                others = db().execute("SELECT * FROM emoji_defs WHERE collection_id=? AND enabled=1 ORDER BY position, created", (c['id'],)).fetchall()
                coll = {'id': c['id'], 'title': c['title'], 'photo': c['photo'],
                        'emojis': [{'id': o['id'], 'title': o['title'], 'image': (o['media'] if media_kind(o['media']) == 'image' else '') or o['poster'] or ''} for o in others]}
        return {'collection': coll, 'collection_id': row['collection_id'], 'id': row['id'], 'title': row['title'], 'description': row['description'] or 'Особый значок.', 'media': row['media'], 'kind': kind,
                'image': (row['media'] if kind == 'image' else '') or row['poster'] or '', 'poster': row['poster'] or '', 'value': int(row['value']), 'type': 'EMOJI', 'enabled': bool(row['enabled'])}

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

    def owns(uid, eid):
        return bool(uid and db().execute("SELECT 1 FROM user_emojis WHERE user_id=? AND emoji_id=?", (uid, str(eid))).fetchone())

    def value_of(eid):
        row = db().execute("SELECT value FROM emoji_defs WHERE id=?", (str(eid),)).fetchone()
        return int(row['value']) if row else 0

    app.extensions['crafter_emoji_owned'] = owns
    app.extensions['crafter_emoji_value'] = value_of
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
        cols = [{'id': c['id'], 'title': c['title'], 'photo': c['photo']} for c in db().execute("SELECT * FROM emoji_collections ORDER BY position, created").fetchall()]
        return {'emojis': out, 'collections': cols}

    @app.post('/api/admin/emoji-collections')
    @auth(admin=True)
    def admin_emoji_collection_save():
        body = request.get_json(silent=True) or {}
        cid = str(body.get('id') or '').strip().lower()
        title = ' '.join(str(body.get('title') or '').split())[:40]
        photo = str(body.get('photo') or '').strip()
        if not title:
            abort(400, description='Введите название коллекции')
        if photo and not MEDIA_RE.fullmatch(photo):
            abort(400, description='Фото коллекции: загрузите картинку')
        with db():
            if cid:
                if not ID_RE.fullmatch(cid):
                    abort(400, description='Код коллекции: латинские буквы, цифры, - и _')
                old = db().execute("SELECT 1 FROM emoji_collections WHERE id=?", (cid,)).fetchone()
            else:
                cid, old = 'c' + uuid.uuid4().hex[:9], None
            if old:
                db().execute("UPDATE emoji_collections SET title=?,photo=? WHERE id=?", (title, photo, cid))
            else:
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM emoji_collections").fetchone()['n'])
                db().execute("INSERT INTO emoji_collections(id,title,photo,position,created) VALUES(?,?,?,?,?)", (cid, title, photo, pos, int(time.time())))
        audit('Emoji collection saved: %s' % cid)
        return {'ok': True, 'id': cid}

    @app.post('/api/admin/emoji-collections/<cid>/delete')
    @auth(admin=True)
    def admin_emoji_collection_delete(cid):
        with db():
            if not db().execute("DELETE FROM emoji_collections WHERE id=?", (cid,)).rowcount:
                abort(404, description='Коллекция не найдена')
            db().execute("UPDATE emoji_defs SET collection_id='' WHERE collection_id=?", (cid,))
        audit('Emoji collection deleted: %s' % cid)
        return {'ok': True}

    @app.post('/api/admin/emojis')
    @auth(admin=True)
    def admin_emoji_save():
        body = request.get_json(silent=True) or {}
        eid = str(body.get('id') or '').strip().lower()
        title = ' '.join(str(body.get('title') or '').split())[:60]
        desc = ' '.join(str(body.get('description') or '').split())[:240]
        media = str(body.get('media') or '').strip()
        poster = str(body.get('poster') or '').strip()
        coll_id = str(body.get('collection_id') or '').strip()
        if coll_id and not db().execute("SELECT 1 FROM emoji_collections WHERE id=?", (coll_id,)).fetchone():
            abort(400, description='Такой коллекции нет')
        try:
            value = int(str(body.get('value') if body.get('value') not in (None, '') else 300).strip())
        except ValueError:
            abort(400, description='Оценка значка: целое число')
        if not 0 <= value <= 1000000:
            abort(400, description='Оценка значка: от 0 до 1 000 000')
        if poster and not MEDIA_RE.fullmatch(poster):
            abort(400, description='Картинка-превью значка: неверная ссылка')
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
                db().execute("UPDATE emoji_defs SET title=?,description=?,media=?,enabled=?,value=?,poster=?,collection_id=? WHERE id=?", (title, desc, media, enabled, value, poster, coll_id, eid))
            else:
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM emoji_defs").fetchone()['n'])
                db().execute("INSERT INTO emoji_defs(id,title,description,media,enabled,position,created,value,poster,collection_id) VALUES(?,?,?,?,?,?,?,?,?,?)", (eid, title, desc, media, enabled, pos, int(time.time()), value, poster, coll_id))
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
