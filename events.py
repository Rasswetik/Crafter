"""Configurable image-based events and leaderboards for Crafter.

Display-only prize descriptions: payouts are not transferred automatically.
"""
import json
import re
import time
import uuid
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from io import BytesIO
from PIL import Image, UnidentifiedImageError

from flask import abort, request, send_file

from banners import artwork, MAX_IMAGE_SIZE

METRICS = {
    'arena_wins': ('arena_result', 'Победы в Arena', 'побед'),
    'arena_winnings': ('arena_result', 'Выиграно GRAM', 'GRAM'),
    'craft_wins': ('craft', 'Успешные крафты', 'крафтов'),
    'sales_volume': ('sale', 'Продажи на маркете', 'GRAM'),
}
MONEY_METRICS = {'arena_winnings', 'sales_volume'}
HEX = re.compile(r'#[0-9a-fA-F]{6}\Z')
ID = re.compile(r'[0-9a-f]{32}\Z')


def install_events(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_events (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                metric TEXT NOT NULL,
                start_at INTEGER NOT NULL,
                end_at INTEGER NOT NULL,
                enabled INTEGER NOT NULL,
                accent TEXT NOT NULL,
                show_leaderboard INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                prizes TEXT NOT NULL,
                image_key TEXT NOT NULL,
                image BYTEA NOT NULL
            );
            CREATE TABLE IF NOT EXISTS crafter_event_prize_images (
                event_id TEXT NOT NULL,
                place INTEGER NOT NULL,
                image_key TEXT NOT NULL,
                image BYTEA NOT NULL,
                PRIMARY KEY(event_id,place)
            );
            CREATE TABLE IF NOT EXISTS crafter_event_prize_gifs (
                event_id TEXT NOT NULL,
                place INTEGER NOT NULL,
                image_key TEXT NOT NULL,
                image BYTEA NOT NULL,
                PRIMARY KEY(event_id,place)
            );
            CREATE INDEX IF NOT EXISTS crafter_events_visible
                ON crafter_events(enabled,sort_order);
            CREATE INDEX IF NOT EXISTS crafter_events_history
                ON history(kind,created);
        """)

    def validate_id(event_id):
        if not ID.fullmatch(event_id):
            abort(404)

    def metadata(row, prizes_by_event):
        item = dict(row)
        item.pop('image', None)
        item['enabled'] = bool(item['enabled'])
        item['show_leaderboard'] = bool(item['show_leaderboard'])
        item['metric_label'] = METRICS[item['metric']][1]
        item['score_unit'] = METRICS[item['metric']][2]
        item['image_url'] = '/media/event/{}/{}.webp'.format(item['id'], item.pop('image_key'))
        raw_prizes = json.loads(item['prizes'])
        prize_slots = []
        for place, original in enumerate(raw_prizes[:3], 1):
            prize = original.copy() if isinstance(original, dict) else {'label': str(original)}
            kind = prize.get('type', 'image')
            if kind not in ('image', 'gram', 'telegram', 'none'):
                kind = 'image'
            image_key, mime = prizes_by_event[item['id']].get(place, (None, None))
            prize_slots.append({
                'place': place, 'label': str(prize.get('label', ''))[:120],
                'type': kind,
                'telegram_url': prize.get('telegram_url', '') if kind == 'telegram' else '',
                'telegram_slug': prize.get('telegram_slug', '') if kind == 'telegram' else '',
                'image_url': ('/media/event/{}/prize/{}/{}.{}'.format(
                    item['id'], place, image_key, 'gif' if mime == 'image/gif' else 'webp')
                    if image_key else None),
            })
        item['prizes'] = prize_slots
        now = int(time.time())
        item['status'] = ('upcoming' if now < item['start_at'] else
                          'finished' if now > item['end_at'] else 'active')
        return item

    def listing(admin=False):
        query = ('SELECT id,title,description,metric,start_at,end_at,enabled,accent,'
                 'show_leaderboard,sort_order,prizes,image_key FROM crafter_events '
                 + ('' if admin else 'WHERE enabled=1 ')
                 + 'ORDER BY sort_order ASC,start_at DESC,id')
        rows = db().execute(query).fetchall()
        ids = [row['id'] for row in rows]
        prizes_by_event = defaultdict(dict)
        if ids:
            id_set = set(ids)
            for image in db().execute('SELECT event_id,place,image_key FROM crafter_event_prize_images'):
                if image['event_id'] in id_set:
                    prizes_by_event[image['event_id']][image['place']] = (image['image_key'], 'image/webp')
            for image in db().execute('SELECT event_id,place,image_key FROM crafter_event_prize_gifs'):
                if image['event_id'] in id_set:
                    prizes_by_event[image['event_id']][image['place']] = (image['image_key'], 'image/gif')
        return [metadata(row, prizes_by_event) for row in rows]

    def ranking(event, limit=50):
        metric = event['metric']
        kind = METRICS[metric][0]
        end = min(int(time.time()), int(event['end_at']))
        if end < event['start_at']:
            return []
        query = """SELECT h.user_id,h.payload,u.name,u.username,a.photo_url
            FROM history h LEFT JOIN users u ON u.id=h.user_id
            LEFT JOIN user_avatars a ON a.user_id=h.user_id
            WHERE h.kind=? AND h.created>=? AND h.created<=?"""
        totals = defaultdict(lambda: Decimal(0))
        players = {}
        for entry in db().execute(query, (kind, event['start_at'], end)):
            uid = entry['user_id']
            if uid is None or uid <= 0:
                continue  # Never place the house bot on a public leaderboard.
            try:
                payload = json.loads(entry['payload'])
                if metric in ('arena_wins', 'craft_wins'):
                    amount = Decimal(1) if payload.get('success') is True else Decimal(0)
                elif metric == 'arena_winnings':
                    amount = (Decimal(str(payload.get('prize_value') or '0'))
                              if payload.get('success') is True else Decimal(0))
                else:
                    amount = Decimal(str(payload.get('price') or '0'))
            except (ValueError, TypeError, InvalidOperation):
                continue
            if amount <= 0 or not amount.is_finite():
                continue
            totals[uid] += amount
            players[uid] = {
                'id': str(uid),
                'name': (entry['name'] or entry['username'] or 'Игрок'),
                'photo_url': entry['photo_url'] or '',
            }
        leaders = sorted(totals.items(), key=lambda row: (-row[1], row[0]))[:limit]
        result = []
        for index, (uid, value) in enumerate(leaders, 1):
            score = value.quantize(Decimal('0.01')) if metric in MONEY_METRICS else value
            result.append({'rank': index, 'score': format(score, 'f'), **players[uid]})
        return result

    @app.get('/api/events')
    def public_events():
        return {'events': listing()}

    @app.get('/api/events/<event_id>')
    def public_event(event_id):
        validate_id(event_id)
        events = listing()
        event = next((item for item in events if item['id'] == event_id), None)
        if event is None:
            abort(404, description='Событие не найдено')
        return {'event': event, 'leaders': ranking(event) if event['show_leaderboard'] else []}

    @app.get('/api/admin/events')
    @auth(admin=True)
    def admin_events():
        return {'events': listing(admin=True), 'metrics': [
            {'value': key, 'label': value[1], 'unit': value[2]}
            for key, value in METRICS.items()
        ]}

    @app.post('/api/admin/events', defaults={'event_id': None})
    @app.post('/api/admin/events/<event_id>')
    @auth(admin=True)
    def save_event(event_id):
        request.max_content_length = MAX_IMAGE_SIZE * 4 + 65536
        form = request.form
        title = form.get('title', '').strip()
        description = form.get('description', '').strip()
        metric = form.get('metric')
        accent = form.get('accent', '#9164e9')
        try:
            start_at = int(form.get('start_at', ''))
            end_at = int(form.get('end_at', ''))
            sort_order = int(form.get('sort_order', '0'))
        except (ValueError, TypeError, OverflowError):
            abort(400, description='Некорректные даты или порядок')
        if not 1 <= len(title) <= 90 or len(description) > 700:
            abort(400, description='Название: до 90 символов, описание: до 700')
        if metric not in METRICS or not HEX.fullmatch(accent):
            abort(400, description='Выберите показатель и цвет')
        if not 1577836800 <= start_at < end_at <= 4102444800:
            abort(400, description='Проверьте даты начала и окончания')
        if not 0 <= sort_order <= 999:
            abort(400, description='Порядок: от 0 до 999')
        prize_labels = [form.get('prize_{}'.format(i), '').strip() for i in (1, 2, 3)]
        if any(len(label) > 120 for label in prize_labels):
            abort(400, description='Описание награды: до 120 символов')
        prizes = []
        for place, label in enumerate(prize_labels, 1):
            kind = form.get('prize_type_{}'.format(place), 'image')
            if kind not in ('image', 'gram', 'telegram', 'none'):
                abort(400, description='Выберите вид награды')
            telegram_url = form.get('prize_link_{}'.format(place), '').strip()
            slug = ''
            if kind == 'telegram':
                match = re.fullmatch(
                    r'https://(?:t\.me|telegram\.me)/nft/([A-Za-z][A-Za-z0-9]{1,70}-[0-9]{1,10})/?',
                    telegram_url)
                if not match:
                    abort(400, description='Ссылка должна иметь вид https://t.me/nft/PlushPepe-123')
                slug = match.group(1)
                telegram_url = 'https://t.me/nft/' + slug
            else:
                telegram_url = ''
            prizes.append({'label': label, 'type': kind, 'telegram_url': telegram_url,
                           'telegram_slug': slug})
        enabled = int(form.get('enabled') == '1')
        show_leaderboard = int(form.get('show_leaderboard') == '1')
        upload_names = ['image', 'prize_image_1', 'prize_image_2', 'prize_image_3']
        uploads = {}
        for name in upload_names:
            file = request.files.get(name)
            if file and file.filename:
                file.stream.seek(0, 2)
                if file.stream.tell() > MAX_IMAGE_SIZE:
                    abort(413, description='Изображение не должно превышать 5 МБ')
                file.stream.seek(0)
                if name != 'image':
                    raw = file.stream.read()
                    file.stream.seek(0)
                    try:
                        with Image.open(BytesIO(raw)) as image:
                            if image.format == 'GIF':
                                if image.width * image.height > 4_000_000 or getattr(image, 'n_frames', 1) > 180:
                                    abort(400, description='GIF: до 180 кадров и 4 МП')
                                uploads[name] = ('image/gif', raw)
                                continue
                    except (OSError, ValueError, UnidentifiedImageError):
                        abort(400, description='Загрузите PNG, WebP, JPEG или GIF')
                uploads[name] = ('image/webp', artwork(file))
        values = (title, description, metric, start_at, end_at, enabled, accent,
                  show_leaderboard, sort_order, json.dumps(prizes, ensure_ascii=False))
        if event_id is not None:
            validate_id(event_id)
        with db():
            db().execute('BEGIN IMMEDIATE')
            if event_id is None:
                if not uploads.get('image'):
                    abort(400, description='Добавьте PNG/JPEG/WebP обложку события')
                if db().execute('SELECT COUNT(*) FROM crafter_events').fetchone()[0] >= 50:
                    abort(409, description='Можно создать до 50 событий')
                event_id = uuid.uuid4().hex
                db().execute('INSERT INTO crafter_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                             (event_id, *values, uuid.uuid4().hex, uploads['image'][1]))
            else:
                if not db().execute('SELECT id FROM crafter_events WHERE id=?', (event_id,)).fetchone():
                    abort(404, description='Событие не найдено')
                db().execute('''UPDATE crafter_events SET title=?,description=?,metric=?,
                    start_at=?,end_at=?,enabled=?,accent=?,show_leaderboard=?,
                    sort_order=?,prizes=? WHERE id=?''', (*values, event_id))
                if 'image' in uploads:
                    db().execute('UPDATE crafter_events SET image_key=?,image=? WHERE id=?',
                                 (uuid.uuid4().hex, uploads['image'][1], event_id))
            for place in (1, 2, 3):
                if (form.get('remove_prize_image_{}'.format(place)) == '1'
                        or prizes[place - 1]['type'] in ('gram', 'telegram', 'none')):
                    db().execute('DELETE FROM crafter_event_prize_images WHERE event_id=? AND place=?',
                                 (event_id, place))
                    db().execute('DELETE FROM crafter_event_prize_gifs WHERE event_id=? AND place=?',
                                 (event_id, place))
                key = 'prize_image_{}'.format(place)
                if key in uploads and prizes[place - 1]['type'] == 'image':
                    mime, payload = uploads[key]
                    target = ('crafter_event_prize_gifs' if mime == 'image/gif'
                              else 'crafter_event_prize_images')
                    other = ('crafter_event_prize_images' if mime == 'image/gif'
                             else 'crafter_event_prize_gifs')
                    db().execute('DELETE FROM ' + other + ' WHERE event_id=? AND place=?',
                                 (event_id, place))
                    db().execute('INSERT INTO ' + target + """
                        (event_id,place,image_key,image) VALUES(?,?,?,?)
                        ON CONFLICT(event_id,place) DO UPDATE SET
                        image_key=excluded.image_key,image=excluded.image""",
                                 (event_id, place, uuid.uuid4().hex, payload))
        audit('Crafter leaderboard event saved')
        return {'id': event_id}

    @app.post('/api/admin/events/<event_id>/delete')
    @auth(admin=True)
    def delete_event(event_id):
        validate_id(event_id)
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('DELETE FROM crafter_event_prize_images WHERE event_id=?', (event_id,))
            db().execute('DELETE FROM crafter_event_prize_gifs WHERE event_id=?', (event_id,))
            if not db().execute('DELETE FROM crafter_events WHERE id=?', (event_id,)).rowcount:
                abort(404, description='Событие не найдено')
        audit('Crafter leaderboard event deleted')
        return {'ok': True}

    @app.get('/media/event/<event_id>/<key>.webp')
    def event_image(event_id, key):
        validate_id(event_id)
        if not ID.fullmatch(key):
            abort(404)
        row = db().execute('SELECT image FROM crafter_events WHERE id=? AND image_key=?',
                           (event_id, key)).fetchone()
        if not row:
            abort(404)
        response = send_file(BytesIO(row['image']), mimetype='image/webp',
                             etag=key, conditional=True, max_age=86400)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/media/event/<event_id>/prize/<int:place>/<key>.webp')
    def event_prize_image(event_id, place, key):
        validate_id(event_id)
        if place not in (1, 2, 3) or not ID.fullmatch(key):
            abort(404)
        row = db().execute('''SELECT image FROM crafter_event_prize_images
            WHERE event_id=? AND place=? AND image_key=?''',
                           (event_id, place, key)).fetchone()
        if not row:
            abort(404)
        response = send_file(BytesIO(row['image']), mimetype='image/webp',
                             etag=key, conditional=True, max_age=86400)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/media/event/<event_id>/prize/<int:place>/<key>.gif')
    def event_prize_gif(event_id, place, key):
        validate_id(event_id)
        if place not in (1, 2, 3) or not ID.fullmatch(key):
            abort(404)
        row = db().execute('SELECT image FROM crafter_event_prize_gifs '
                           'WHERE event_id=? AND place=? AND image_key=?',
                           (event_id, place, key)).fetchone()
        if not row:
            abort(404)
        response = send_file(BytesIO(row['image']), mimetype='image/gif',
                             etag=key, conditional=True, max_age=86400)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

