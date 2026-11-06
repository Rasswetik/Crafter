"""Editable Ice Arena event banner: safe uploaded images/GIFs and visual layers."""
import json
import re
import time
import uuid
from io import BytesIO

from flask import abort, request, send_file
from PIL import Image, ImageOps, UnidentifiedImageError

CONFIG_KEY = 'ice_arena_banner_v1'
CRAFT_KEY = 'crafter_craft_event_banner_v1'
ASSET = re.compile(r'^/media/ice-banner/([0-9a-f]{32})\.(gif|webp)$')
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
LAYER_ID = re.compile(r'^[a-zA-Z0-9_-]{1,45}$')
FONTS = {'system', 'rounded', 'mono', 'serif', 'condensed', 'heavy', 'bold', 'geometric', 'clean', 'classic', 'display', 'futuristic'}
FORMAT = {'hh:mm:ss','mm:ss','days','dhms','dhms-en','dhm-en',
          'hms-en','days-only','hours-only','minutes-only','seconds-only'}
TYPES = {'title', 'text', 'timer', 'image', 'gram'}
ROOMS = {'all', 'public', 'private'}
MAX_ASSET = 8 * 1024 * 1024


def default_banner(kind='arena'):
    now = int(time.time())
    return {
        'enabled': False, 'event_id': '', 'source_block_id': '', 'rooms': 'all', 'hide_after_end': True,
        'title': 'Событие крафта' if kind == 'craft' else 'Ледяная охота',
        'start_at': now + 1800, 'end_at': now + 88200,
        'height': 112, 'width_pct': 100, 'radius': 22,
        'background_color': '#3b265f' if kind == 'craft' else '#075b9e',
        'background_asset': '', 'background_fit': 'cover',
        'background_mode': 'solid', 'background_second_color': '#48bee5',
        'background_tint': 0, 'background_focus_x': 50, 'background_focus_y': 50,
        'layers': [
            {'id': 'headline', 'type': 'title', 'text': 'Событие крафта' if kind == 'craft' else 'Ледяная охота',
             'x': 4, 'y': 19, 'w': 53, 'h': 60, 'font': 'rounded',
             'font_size': 24, 'font_weight': 800, 'color': '#ffffff',
             'bg_color': '#0a477a', 'bg_opacity': 0, 'radius': 0,
             'align': 'left', 'format': 'hh:mm:ss', 'asset': '',
             'fit': 'contain', 'z': 1},
            {'id': 'countdown', 'type': 'timer', 'text': '',
             'x': 69, 'y': 22, 'w': 27, 'h': 56, 'font': 'mono',
             'font_size': 17, 'font_weight': 800, 'color': '#0e3a62',
             'bg_color': '#ffffff', 'bg_opacity': 1, 'radius': 20,
             'align': 'center', 'format': 'hh:mm:ss', 'asset': '',
             'fit': 'contain', 'z': 3},
        ]
    }


def install_arena_banner(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript('''
            CREATE TABLE IF NOT EXISTS ice_banner_assets (
                id TEXT PRIMARY KEY, mime TEXT NOT NULL, body BYTEA NOT NULL,
                created_at INTEGER NOT NULL
            );
        ''')

    def read_config(kind='arena'):
        key = CRAFT_KEY if kind == 'craft' else CONFIG_KEY
        row = db().execute('SELECT payload FROM settings WHERE key=?', (key,)).fetchone()
        if not row:
            return default_banner(kind)
        try:
            saved=json.loads(row['payload'])
            if not isinstance(saved,dict):
                return default_banner(kind)
            return {**default_banner(kind), **saved}
        except (ValueError, TypeError):
            return default_banner(kind)

    def boolean(value, label):
        if type(value) is not bool:
            abort(400, description=label + ': требуется переключатель')
        return value

    def integer(value, lower, upper, label):
        if type(value) is not int or not lower <= value <= upper:
            abort(400, description=label + ': некорректное число')
        return value

    def color(value, label):
        if not isinstance(value, str) or not HEX.fullmatch(value):
            abort(400, description=label + ': цвет в формате #RRGGBB')
        return value

    def percent(value, label):
        if type(value) not in (int, float) or not 0 <= value <= 100:
            abort(400, description=label + ': ожидается 0–100')
        return round(float(value), 2)

    def asset_url(value):
        if value in ('', None):
            return ''
        if not isinstance(value, str):
            abort(400, description='Недопустимый файл изображения')
        match = ASSET.fullmatch(value)
        if not match:
            abort(400, description='Можно использовать только изображения, загруженные в Crafter')
        row = db().execute('SELECT mime FROM ice_banner_assets WHERE id=?',
                           (match.group(1),)).fetchone()
        if not row or (match.group(2) == 'gif') != (row['mime'] == 'image/gif'):
            abort(400, description='Изображение отсутствует')
        return value

    def clean_layer(layer, identifiers):
        if not isinstance(layer, dict):
            abort(400, description='Некорректный слой')
        ident = layer.get('id')
        if not isinstance(ident, str) or not LAYER_ID.fullmatch(ident) or ident in identifiers:
            abort(400, description='Идентификатор слоя должен быть уникальным')
        identifiers.add(ident)
        typ = layer.get('type')
        if typ not in TYPES:
            abort(400, description='Неподдерживаемый тип слоя')
        font, fmt, align, fit = (layer.get('font', 'system'), layer.get('format', 'hh:mm:ss'),
                                  layer.get('align', 'center'), layer.get('fit', 'contain'))
        if font not in FONTS or fmt not in FORMAT or align not in ('left', 'center', 'right'):
            abort(400, description='Некорректный шрифт, формат таймера или выравнивание')
        if fit not in ('cover', 'contain'):
            abort(400, description='Некорректное размещение изображения')
        text = layer.get('text', '')
        if not isinstance(text, str) or len(text) > 140:
            abort(400, description='Текст слоя: не более 140 символов')
        opacity = layer.get('bg_opacity', 0)
        if type(opacity) not in (float, int) or not 0 <= opacity <= 1:
            abort(400, description='Прозрачность должна быть от 0 до 1')
        try:
            stroke = float(layer.get('stroke_width', 0))
        except (TypeError, ValueError, OverflowError):
            abort(400, description='Некорректная толщина текста')
        if not 0 <= stroke <= 3:
            abort(400, description='Толщина текста: от 0 до 3 пикселей')
        return {
            'id': ident, 'type': typ, 'text': text,
            'x': percent(layer.get('x'), 'X'), 'y': percent(layer.get('y'), 'Y'),
            'w': percent(layer.get('w'), 'Ширина'), 'h': percent(layer.get('h'), 'Высота'),
            'font': font, 'font_size': integer(layer.get('font_size'), 10, 72, 'Кегль'),
            'stroke_width': round(stroke, 2),
            'font_weight': integer(layer.get('font_weight'), 400, 900, 'Насыщенность'),
            'color': color(layer.get('color'), 'Цвет текста'),
            'bg_color': color(layer.get('bg_color'), 'Цвет подложки'),
            'bg_opacity': round(float(opacity), 2),
            'radius': integer(layer.get('radius'), 0, 90, 'Скругление'),
            'align': align, 'format': fmt, 'asset': asset_url(layer.get('asset', '')),
            'fit': fit, 'z': integer(layer.get('z'), 0, 99, 'Слой'),
        }

    def clean_config(data):
        if not isinstance(data, dict):
            abort(400, description='Передайте параметры баннера')
        layers = data.get('layers', [])
        if not isinstance(layers, list) or len(layers) > 20:
            abort(400, description='Допускается до 20 слоёв')
        identifiers = set()
        start = integer(data.get('start_at'), 1577836800, 4102444800, 'Начало')
        end = integer(data.get('end_at'), 1577836801, 4102444800, 'Окончание')
        if start >= end:
            abort(400, description='Окончание должно быть позже начала')
        room = data.get('rooms')
        if room not in ROOMS:
            abort(400, description='Выберите комнаты')
        event_id = data.get('event_id') or ''
        if not isinstance(event_id, str) or (event_id and not re.fullmatch(r'[0-9a-f]{32}', event_id)):
            abort(400, description='Неизвестное событие')
        linked_event = (db().execute('SELECT enabled FROM crafter_events WHERE id=?',
                                     (event_id,)).fetchone() if event_id else None)
        if event_id and not linked_event:
            abort(404, description='Привязанное событие не найдено')
        source_block_id = data.get('source_block_id') or ''
        if not isinstance(source_block_id,str) or (
                source_block_id and not LAYER_ID.fullmatch(source_block_id)):
            abort(400, description='Некорректный идентификатор блока-источника')
        enabled = boolean(data.get('enabled'), 'Публикация')
        if enabled and not event_id:
            abort(400, description='Для публикации баннера выберите событие с лидербордом')
        if enabled and not linked_event['enabled']:
            abort(400, description='Сначала опубликуйте выбранный ивент в админке')
        title = data.get('title', '')
        if not isinstance(title, str) or len(title) > 90:
            abort(400, description='Название: максимум 90 символов')
        try:
            background_tint = float(data.get('background_tint', 0))
        except (TypeError, ValueError, OverflowError):
            abort(400, description='Некорректное наложение цвета')
        if not 0 <= background_tint <= 0.9:
            abort(400, description='Цветное наложение: от 0 до 0.9')
        return {
            'enabled': enabled,
            'event_id': event_id, 'source_block_id': source_block_id, 'rooms': room,
            'hide_after_end': boolean(data.get('hide_after_end'), 'Скрывать после окончания'),
            'title': title, 'start_at': start, 'end_at': end,
            'height': integer(data.get('height'), 70, 280, 'Высота'),
            'width_pct': integer(data.get('width_pct', 100), 50, 100, 'Ширина'),
            'radius': integer(data.get('radius'), 0, 60, 'Скругление'),
            'background_color': color(data.get('background_color'), 'Цвет фона'),
            'background_asset': asset_url(data.get('background_asset', '')),
            'background_fit': (data.get('background_fit')
                               if data.get('background_fit') in ('cover', 'contain') else 'cover'),
            'background_mode': (data.get('background_mode', 'image' if data.get('background_asset') else 'solid')
                                if data.get('background_mode', 'solid') in ('solid', 'gradient', 'image')
                                else 'solid'),
            'background_second_color': color(data.get('background_second_color', '#48bee5'), 'Второй цвет градиента'),
            'background_tint': round(background_tint, 2),
            'background_focus_x': percent(data.get('background_focus_x', 50), 'Положение фона X'),
            'background_focus_y': percent(data.get('background_focus_y', 50), 'Положение фона Y'),
            'layers': [clean_layer(layer, identifiers) for layer in layers],
        }

    @app.get('/api/arena/banner')
    def public_ice_banner():
        config = read_config()
        room = request.args.get('room', 'public')
        now = int(time.time())
        visible = (config['enabled'] and room in ('public', 'private')
                   and (config['rooms'] == 'all' or config['rooms'] == room)
                   and (not config['hide_after_end'] or now < config['end_at']))
        response = app.json.response({'banner': config if visible else None, 'server_time': now})
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/admin/arena/banner')
    @auth(admin=True)
    def admin_ice_banner():
        return {'banner': read_config(), 'server_time': int(time.time())}

    @app.post('/api/admin/arena/banner')
    @auth(admin=True)
    def save_ice_banner():
        config = clean_config(request.get_json(silent=True))
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE '
                         'SET payload=excluded.payload',
                         (CONFIG_KEY, json.dumps(config, ensure_ascii=False)))
        audit('Ice Arena event banner updated')
        return {'banner': config}


    @app.get('/api/craft/banner')
    def public_craft_banner():
        config=read_config('craft')
        now=int(time.time())
        visible=config['enabled'] and (not config['hide_after_end'] or now<config['end_at'])
        response=app.json.response({'banner':config if visible else None,'server_time':now})
        response.headers['Cache-Control']='no-store'
        return response

    @app.get('/api/admin/craft/banner')
    @auth(admin=True)
    def admin_craft_banner():
        return {'banner':read_config('craft'),'server_time':int(time.time())}

    @app.post('/api/admin/craft/banner/copy-arena')
    @auth(admin=True)
    def copy_ice_banner_to_craft():
        # Copy the entire visual configuration, including timer, image/GIF IDs,
        # layer geometry and linked event. Existing media bytes are shared safely.
        arena=read_config('arena')
        copy=clean_config({**arena, 'rooms':'all'})
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) '
                         'DO UPDATE SET payload=excluded.payload',
                         (CRAFT_KEY,json.dumps(copy,ensure_ascii=False)))
        audit('Ice Arena banner copied to Craft')
        return {'ok':True,'banner':copy}

    @app.post('/api/admin/craft/banner')
    @auth(admin=True)
    def save_craft_banner():
        config=clean_config(request.get_json(silent=True))
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE '
                         'SET payload=excluded.payload',
                         (CRAFT_KEY,json.dumps(config,ensure_ascii=False)))
        audit('Craft event banner updated')
        return {'banner':config}

    @app.post('/api/admin/arena/banner/asset')
    @auth(admin=True)
    def upload_ice_asset():
        request.max_content_length = MAX_ASSET + 32768
        file = request.files.get('file')
        if not file or not file.filename:
            abort(400, description='Выберите изображение или GIF')
        raw = file.stream.read(MAX_ASSET + 1)
        if len(raw) > MAX_ASSET:
            abort(413, description='Максимальный размер файла 8 МБ')
        try:
            with Image.open(BytesIO(raw)) as img:
                if img.format not in ('PNG', 'JPEG', 'WEBP', 'GIF') or img.width * img.height > 12000000:
                    raise ValueError('format or dimensions')
                if img.format == 'GIF' or getattr(img, 'is_animated', False):
                    if img.format != 'GIF' or getattr(img, 'n_frames', 1) > 180:
                        raise ValueError('animation limit')
                    mime = 'image/gif'
                    contents = raw
                    extension = 'gif'
                else:
                    image = ImageOps.exif_transpose(img)
                    image.thumbnail((1600, 900))
                    image = image.convert('RGBA' if 'A' in image.getbands()
                                          or 'transparency' in img.info else 'RGB')
                    buf = BytesIO()
                    image.save(buf, format='WEBP', quality=90, method=4)
                    contents = buf.getvalue()
                    mime = 'image/webp'
                    extension = 'webp'
        except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
            abort(400, description='Поддерживаются PNG, JPEG, WebP и GIF до 180 кадров')
        ident = uuid.uuid4().hex
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO ice_banner_assets VALUES(?,?,?,?)',
                         (ident, mime, contents, int(time.time())))
        audit('Ice Arena banner artwork uploaded')
        return {'url': f'/media/ice-banner/{ident}.{extension}', 'size': len(contents)}

    @app.get('/media/ice-banner/<ident>.<extension>')
    def ice_banner_image(ident, extension):
        if not re.fullmatch(r'[0-9a-f]{32}', ident) or extension not in ('webp', 'gif'):
            abort(404)
        row = db().execute('SELECT mime,body FROM ice_banner_assets WHERE id=?',
                           (ident,)).fetchone()
        if not row or (extension == 'gif') != (row['mime'] == 'image/gif'):
            abort(404)
        response = send_file(BytesIO(row['body']), mimetype=row['mime'],
                             etag=ident, conditional=True, max_age=2592000)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'public, max-age=2592000, immutable'
        return response
