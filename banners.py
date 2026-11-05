"""Market banners and uploaded artwork stored with the rest of the application data."""
import json
import re
import uuid
from io import BytesIO
from urllib.parse import urlsplit

from flask import abort, request, send_file
from PIL import Image, ImageOps

MAX_IMAGE_SIZE = 5 * 1024 * 1024
ACTIONS = {'none', 'market', 'lucky', 'craft', 'gifts', 'offers', 'history',
           'profile', 'referrals', 'wallet', 'activity', 'collection', 'link',
           'games', 'arena', 'events', 'staking', 'staking-rules', 'stake-gifts', 'gift-deposit', 'craft-rules', 'settings'}


def number(value, minimum, maximum, label):
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        result = minimum - 1
    if type(value) in (bool, float) or not minimum <= result <= maximum:
        abort(400, description=f'{label}: допустимо от {minimum} до {maximum}')
    return result


def clean_target(action, value):
    if action == 'collection':
        if not re.fullmatch(r'[\w-]{1,100}', value):
            abort(400, description='Выберите коллекцию')
        return value
    if action == 'link':
        try:
            url = urlsplit(value)
            valid = url.scheme == 'https' and url.hostname and not (url.username or url.password)
            url.port
        except ValueError:
            valid = False
        if not valid or len(value) > 2048 or re.search(r'[\x00-\x20\x7f\\]', value):
            abort(400, description='Укажите корректную HTTPS-ссылку')
        return value
    return ''


def artwork(file):
    if not file:
        return None
    try:
        with Image.open(file.stream, formats=['PNG', 'JPEG', 'WEBP']) as source:
            if source.width * source.height > 24_000_000 or getattr(source, 'is_animated', False):
                raise ValueError('unsupported dimensions or frames')
            image = ImageOps.exif_transpose(source)
            image.thumbnail((1920, 1920))
            image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
            result = BytesIO()
            image.save(result, format='WEBP', quality=88)
            return result.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError):
        abort(400, description='Загрузите статичное изображение PNG, JPEG или WebP до 5 МБ')


def install_banners(app, db, auth, audit):
    with app.app_context():
        db().executescript('''CREATE TABLE IF NOT EXISTS market_banners (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, sort_order INTEGER NOT NULL,
            enabled INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
            focus_x INTEGER NOT NULL, focus_y INTEGER NOT NULL, zoom INTEGER NOT NULL,
            image_key TEXT NOT NULL, image BYTEA NOT NULL
        );''')
        db().commit()

    def listing(admin=False):
        row = db().execute("SELECT payload FROM settings WHERE key='banner_carousel'").fetchone()
        carousel = json.loads(row[0]) if row else {'enabled': False, 'interval': 5}
        carousel['show_counter'] = bool(carousel.get('show_counter', False))
        carousel['show_dots'] = bool(carousel.get('show_dots', True))
        carousel['auto_rotate'] = bool(carousel.get('auto_rotate', True))
        query = ('SELECT id,title,sort_order,enabled,action,target,focus_x,focus_y,zoom,image_key FROM market_banners '
                 + ('' if admin else 'WHERE enabled=1 ') + 'ORDER BY sort_order,id')
        rows = [dict(row) for row in db().execute(query)]
        for row in rows:
            row['enabled'] = bool(row['enabled'])
            row['image_url'] = f"/media/banner/{row['id']}/{row.pop('image_key')}.webp"
        return {'banners': rows, 'carousel': carousel}

    @app.get('/api/banners')
    def public_banners():
        return listing()

    @app.get('/api/admin/banners')
    @auth(admin=True)
    def admin_banners():
        return listing(admin=True)

    @app.post('/api/admin/banners/carousel')
    @auth(admin=True)
    def update_banner_carousel():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or type(data.get('enabled')) is not bool:
            abort(400, description='Укажите режим карусели')
        if type(data.get('show_counter', False)) is not bool:
            abort(400, description='Укажите, отображать ли счётчик баннеров')
        if type(data.get('show_dots', True)) is not bool or type(data.get('auto_rotate', True)) is not bool:
            abort(400, description='Настройки точек и автопрокрутки должны быть переключателями')
        value = {'enabled': data['enabled'],
                 'interval': number(data.get('interval'), 2, 60, 'Интервал'),
                 'show_counter': data.get('show_counter', False),
                 'show_dots': data.get('show_dots', True),
                 'auto_rotate': data.get('auto_rotate', True)}
        db().execute("INSERT INTO settings VALUES('banner_carousel',?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload",
                     (json.dumps(value),))
        db().commit()
        audit('Market banner carousel updated')
        return {'carousel': value}

    @app.post('/api/admin/banners', defaults={'banner_id': None})
    @app.post('/api/admin/banners/<banner_id>')
    @auth(admin=True)
    def save_banner(banner_id):
        request.max_content_length = MAX_IMAGE_SIZE + 32 * 1024
        form = request.form
        title = form.get('title', '').strip()
        action = form.get('action')
        if not title or len(title) > 80 or action not in ACTIONS:
            abort(400, description='Укажите название баннера и действие')
        params = (
            title, number(form.get('sort_order'), 0, 999, 'Порядок'), int(form.get('enabled') == '1'),
            action, clean_target(action, form.get('target', '').strip()),
            number(form.get('focus_x'), 0, 100, 'Позиция по горизонтали'),
            number(form.get('focus_y'), 0, 100, 'Позиция по вертикали'),
            number(form.get('zoom'), 100, 250, 'Масштаб'),
        )
        upload = request.files.get('image')
        if upload and upload.stream.seek(0, 2) > MAX_IMAGE_SIZE:
            abort(413, description='Файл должен весить не больше 5 МБ')
        if upload:
            upload.stream.seek(0)
        image = artwork(upload)
        if banner_id is None:
            if image is None:
                abort(400, description='Добавьте изображение баннера')
            banner_id = uuid.uuid4().hex
            with db():
                db().execute('BEGIN IMMEDIATE')
                if db().execute('SELECT count(*) FROM market_banners').fetchone()[0] >= 20:
                    abort(409, description='Можно добавить до 20 баннеров')
                db().execute('INSERT INTO market_banners VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                             (banner_id, *params, uuid.uuid4().hex, image))
        else:
            fields = 'title=?,sort_order=?,enabled=?,action=?,target=?,focus_x=?,focus_y=?,zoom=?'
            if image is not None:
                fields += ',image_key=?,image=?'
                params += (uuid.uuid4().hex, image)
            if not db().execute(f'UPDATE market_banners SET {fields} WHERE id=?', (*params, banner_id)).rowcount:
                abort(404, description='Баннер не найден')
            db().commit()
        audit('Market banner saved')
        return {'id': banner_id}

    @app.post('/api/admin/banners/<banner_id>/delete')
    @auth(admin=True)
    def delete_banner(banner_id):
        if not db().execute('DELETE FROM market_banners WHERE id=?', (banner_id,)).rowcount:
            abort(404, description='Баннер не найден')
        db().commit()
        audit('Market banner deleted')
        return {'ok': True}

    @app.get('/media/banner/<banner_id>/<key>.webp')
    def market_banner_image(banner_id, key):
        row = db().execute('SELECT image FROM market_banners WHERE id=? AND image_key=?',
                           (banner_id, key)).fetchone()
        if not row:
            abort(404)
        response = send_file(BytesIO(row[0]), mimetype='image/webp', etag=key, conditional=True, max_age=0)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
