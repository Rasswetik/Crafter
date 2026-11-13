"""Sections of the New Year market: the tabs with an icon, a picture on the right and a background of their own.

Six built-in sections choose their offers by a rule (sales, packs, bundles, resources, rewards, gifts); the administrator can
restyle them and add any number of own sections, then put offers into them. Pictures (PNG, JPEG, WEBP, GIF, SVG) are uploaded
into the database and served from /media/shop/<id>."""
import json
import re
import time
import uuid

from flask import Response, abort, request

DEFAULTS = (
    ('featured', 'Акции', 'featured', 'builtin:star', 'village'),
    ('packs', 'Паки', 'packs', 'builtin:pack', 'night'),
    ('bundles', 'Наборы', 'bundles', 'builtin:bundle', 'candy'),
    ('res', 'Ресурсы', 'res', 'builtin:gem', 'emerald'),
    ('rewards', 'Награды', 'rewards', 'builtin:cup', 'gold'),
    ('gifts', 'Подарки', 'gifts', 'builtin:gift', 'snow'),
)
BACKGROUNDS = ('village', 'snow', 'night', 'aurora', 'garland', 'frost', 'candy', 'blue', 'violet', 'crimson', 'emerald', 'gold',
               'tree', 'stars', 'mitten', 'cozy', 'ice', 'pine', 'berry', 'cocoa', 'polar', 'moon',
               'cabin', 'bauble', 'gifts', 'sparklers', 'champagne', 'northpole', 'wreath', 'skating', 'santa', 'sunrise', 'desert', 'jungle', 'cherry', 'space', 'cyber', 'bubbles', 'storm', 'hex',
               'nikolay', 'goshan', 'gifton', 'collab',
               'fireworks', 'confetti', 'galaxy', 'neon', 'sunset', 'ocean', 'forest', 'mint', 'rose', 'steel', 'lava', 'snowstorm',
               'softsky', 'softberry', 'softmint', 'softgold', 'softnight', 'softrose', 'softocean', 'softlilac', 'softember', 'softcocoa', 'softpine', 'softslate')
MAX_MEDIA = 15_000_000
MAX_SECTIONS = 30
MEDIA_PATH = re.compile(r'/media/shop/[0-9a-f]{32}')
UNSAFE_SVG = re.compile(rb'<\s*script|javascript:|\bon[a-z]+\s*=|<\s*foreignobject|<!entity|<\s*iframe|<\s*object|<\s*embed|xlink:href\s*=\s*["\']\s*(?:https?:|//|data:)|href\s*=\s*["\']\s*(?:https?:|//)', re.I)


def sniff(body):
    """The real type of an uploaded picture, or '' when it is not an allowed picture."""
    if body.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if body.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if body[:4] == b'RIFF' and body[8:12] == b'WEBP':
        return 'image/webp'
    if body[:4] == b'GIF8':
        return 'image/gif'
    head = body[:600].lstrip(b'\xef\xbb\xbf \t\r\n').lower()
    if (head.startswith(b'<svg') or head.startswith(b'<?xml')) and b'<svg' in body[:2000].lower() and not UNSAFE_SVG.search(body):
        return 'image/svg+xml'
    return ''


def install_shop_sections(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS shop_sections (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, rule TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', bg TEXT NOT NULL DEFAULT 'night',
                position BIGINT NOT NULL DEFAULT 0, enabled BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shop_media (
                id TEXT PRIMARY KEY, mime TEXT NOT NULL, body BYTEA, created BIGINT NOT NULL
            );
        """)
        if not db().execute("SELECT 1 FROM shop_sections LIMIT 1").fetchone():
            now = int(time.time())
            for number, (sid, title, rule, icon, bg) in enumerate(DEFAULTS):
                db().execute("INSERT INTO shop_sections(id,title,kind,rule,icon,preview,bg,position,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (sid, title, 'smart', rule, icon, '', bg, number, 1, now))
        if not db().execute("SELECT 1 FROM shop_sections WHERE id='collabs'").fetchone():          # the section of collaborations stands after the packs
            row = db().execute("SELECT position FROM shop_sections WHERE id='packs'").fetchone()
            if row:
                at = int(row['position'])
                db().execute("UPDATE shop_sections SET position=position+1 WHERE position>?", (at,))
                db().execute("INSERT INTO shop_sections(id,title,kind,rule,icon,preview,bg,position,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             ('collabs', 'Коллаборации', 'smart', 'collab', 'builtin:crown', '', 'collab', at + 1, 1, int(time.time())))

    def view(row):
        return {'id': row['id'], 'title': row['title'], 'kind': row['kind'], 'rule': row['rule'], 'icon': row['icon'],
                'preview': row['preview'], 'bg': row['bg'], 'enabled': bool(row['enabled'])}

    def sections(all_sections):
        rows = db().execute("SELECT * FROM shop_sections ORDER BY position,created").fetchall()
        return [view(r) for r in rows if all_sections or r['enabled']]

    app.extensions['crafter_shop_sections'] = sections
    app.extensions['crafter_shop_section_exists'] = lambda sid: bool(db().execute("SELECT 1 FROM shop_sections WHERE id=? AND kind IN ('custom','smart') AND id<>'gifts'", (sid,)).fetchone())

    def clean_title(value):
        title = ' '.join(str(value or '').split())[:24]
        if not title:
            abort(400, description='Введите название раздела')
        return title

    def clean_picture(value, builtin_ok):
        value = str(value or '').strip()
        if not value:
            return ''
        if MEDIA_PATH.fullmatch(value) or (builtin_ok and re.fullmatch(r'builtin:[a-z0-9_-]{1,24}', value)):
            return value
        abort(400, description='Картинка: загрузите файл или выберите значок из набора')

    def clean_bg(value):
        value = str(value or '').strip() or 'night'
        if value in BACKGROUNDS or (value.startswith('image:') and MEDIA_PATH.fullmatch(value[6:])):
            return value
        abort(400, description='Фон: выберите готовый или загрузите свою картинку')

    @app.post('/api/admin/new-year/shop-sections')
    @auth(admin=True)
    def admin_section_save():
        body = request.get_json(silent=True) or {}
        title = clean_title(body.get('title'))
        icon, preview, bg = clean_picture(body.get('icon'), True), clean_picture(body.get('preview'), False), clean_bg(body.get('bg'))
        enabled = 1 if body.get('enabled') in (True, 1, '1', 'true', 'on') else 0
        sid = body.get('id')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if sid:
                if not db().execute("UPDATE shop_sections SET title=?,icon=?,preview=?,bg=?,enabled=? WHERE id=?",
                                    (title, icon, preview, bg, enabled, str(sid))).rowcount:
                    abort(404, description='Раздел не найден')
            else:
                if db().execute("SELECT COUNT(*) AS n FROM shop_sections").fetchone()['n'] >= MAX_SECTIONS:
                    abort(409, description='Разделов не может быть больше %d' % MAX_SECTIONS)
                sid = uuid.uuid4().hex[:12]
                kind = 'exchange' if body.get('kind') == 'exchange' else 'custom'
                position = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM shop_sections").fetchone()['n'])
                db().execute("INSERT INTO shop_sections(id,title,kind,rule,icon,preview,bg,position,enabled,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (sid, title, kind, '', icon, preview, bg, position, enabled, int(time.time())))
        audit('Shop section saved: ' + title)
        return {'ok': True, 'id': sid}

    @app.post('/api/admin/new-year/shop-sections/<sid>/delete')
    @auth(admin=True)
    def admin_section_delete(sid):
        with db():
            row = db().execute("SELECT kind,title FROM shop_sections WHERE id=?", (sid,)).fetchone()
            if not row:
                abort(404, description='Раздел не найден')
            if row['kind'] not in ('custom', 'exchange'):
                abort(409, description='Встроенный раздел нельзя удалить: его можно выключить')
            db().execute("UPDATE shop_items SET section_id=NULL WHERE section_id=?", (sid,))
            db().execute("DELETE FROM shop_exchanges WHERE section_id=?", (sid,))
            db().execute("DELETE FROM shop_sections WHERE id=?", (sid,))
        audit('Shop section deleted: ' + row['title'])
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-sections-arrange')
    @auth(admin=True)
    def admin_sections_arrange():
        wanted = (request.get_json(silent=True) or {}).get('ids')
        if not isinstance(wanted, list) or len(wanted) > 200 or any(not isinstance(i, str) for i in wanted):
            abort(400, description='ids: список разделов в нужном порядке')
        with db():
            db().execute('BEGIN IMMEDIATE')
            known = [r['id'] for r in db().execute("SELECT id FROM shop_sections ORDER BY position,created").fetchall()]
            chosen = [i for i in dict.fromkeys(wanted) if i in known]
            for number, item in enumerate(chosen + [i for i in known if i not in chosen]):
                db().execute("UPDATE shop_sections SET position=? WHERE id=?", (number, item))
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-media')
    @auth(admin=True)
    def admin_media_upload():
        request.max_content_length = MAX_MEDIA + 32768
        upload = request.files.get('file')
        if upload is None:
            abort(400, description='Выберите файл')
        body = upload.read(MAX_MEDIA + 1)
        if not body or len(body) > MAX_MEDIA:
            abort(413, description='Файл должен быть не больше 15 МБ')
        mime = sniff(body)
        if not mime:
            abort(415, description='Нужна картинка: PNG, JPEG, WEBP, GIF или безопасный SVG')
        mid = uuid.uuid4().hex
        with db():
            db().execute("INSERT INTO shop_media(id,mime,body,created) VALUES(?,?,?,?)", (mid, mime, body, int(time.time())))
        return {'ok': True, 'url': '/media/shop/' + mid, 'mime': mime}

    # ---- the library of own backgrounds: uploaded pictures are remembered and can be picked again for any offer ----
    LIB_KEY = 'shop_bg_library_v1'

    def library():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (LIB_KEY,)).fetchone()
        try:
            items = json.loads(row['payload']) if row else []
        except ValueError:
            items = []
        return [x for x in items if isinstance(x, dict) and re.fullmatch(r'/media/shop/[0-9a-f]{32}', str(x.get('url', '')))]

    def save_library(items):
        db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (LIB_KEY, json.dumps(items, ensure_ascii=False)))

    app.extensions['crafter_bg_library'] = library

    @app.post('/api/admin/new-year/shop-bg-library')
    @auth(admin=True)
    def admin_bg_library_add():
        body = request.get_json(silent=True) or {}
        url = str(body.get('url') or '')
        if not re.fullmatch(r'/media/shop/[0-9a-f]{32}', url):
            abort(400, description='Сначала загрузите картинку')
        name = ' '.join(str(body.get('name') or '').split())[:40] or 'Свой фон'
        with db():
            db().execute('BEGIN IMMEDIATE')
            items = [x for x in library() if x['url'] != url]
            items.insert(0, {'url': url, 'name': name})
            save_library(items[:60])
        return {'ok': True, 'library': items[:60]}

    @app.post('/api/admin/new-year/shop-bg-library/delete')
    @auth(admin=True)
    def admin_bg_library_delete():
        url = str((request.get_json(silent=True) or {}).get('url') or '')
        with db():
            db().execute('BEGIN IMMEDIATE')
            items = [x for x in library() if x['url'] != url]
            save_library(items)
        return {'ok': True, 'library': items}

    @app.get('/media/shop/<mid>')
    def shop_media(mid):
        if not re.fullmatch(r'[0-9a-f]{32}', mid):
            abort(404)
        row = db().execute("SELECT mime,body FROM shop_media WHERE id=?", (mid,)).fetchone()
        if not row or not row['body']:
            abort(404)
        response = Response(bytes(row['body']), mimetype=row['mime'])
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if row['mime'] == 'image/svg+xml':
            response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
        return response
