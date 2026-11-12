"""Player pictures for leaderboards.

Telegram gives the app a photo link only to some clients, so many players have no row in user_avatars and appeared
without a picture. Their picture is fetched once through the bot (getUserProfilePhotos) and kept in the database; every
leaderboard then points to /media/avatar/<id>."""
import json
import time
import urllib.request

from flask import Response, abort

FOUND_TTL = 7 * 86400
MISSING_TTL = 6 * 3600
MAX_BYTES = 400_000


def fallback(user_id, photo_url):
    """The stored link when there is one, otherwise the proxied picture of a real player."""
    if photo_url:
        return photo_url
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return ''
    return '/media/avatar/%d' % uid if uid > 0 else ''


def install_avatars(app, db):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS avatar_media (
                user_id INTEGER PRIMARY KEY, mime TEXT NOT NULL, body BYTEA, updated INTEGER NOT NULL
            );
        """)

    def telegram(method, params):
        token = app.config.get('BOT_TOKEN') or ''
        if not token:
            return None
        url = 'https://api.telegram.org/bot%s/%s' % (token, method)
        request = urllib.request.Request(url, data=json.dumps(params).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=6) as answer:
            data = json.loads(answer.read(200_000))
        return data.get('result') if data.get('ok') else None

    def download(user_id):
        photos = telegram('getUserProfilePhotos', {'user_id': user_id, 'limit': 1})
        sizes = (photos or {}).get('photos') or []
        if not sizes or not sizes[0]:
            return None
        pick = sorted(sizes[0], key=lambda s: s.get('width', 0))
        chosen = next((s for s in pick if s.get('width', 0) >= 160), pick[-1])
        info = telegram('getFile', {'file_id': chosen['file_id']})
        path = (info or {}).get('file_path')
        if not path or '..' in path:
            return None
        link = 'https://api.telegram.org/file/bot%s/%s' % (app.config['BOT_TOKEN'], path)
        with urllib.request.urlopen(link, timeout=8) as answer:
            body = answer.read(MAX_BYTES + 1)
        return body if 0 < len(body) <= MAX_BYTES else None

    @app.get('/media/avatar/<int:user_id>')
    def player_avatar(user_id):
        if user_id <= 0 or not db().execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
            abort(404)
        row = db().execute('SELECT mime,body,updated FROM avatar_media WHERE user_id=?', (user_id,)).fetchone()
        age = time.time() - row['updated'] if row else None
        fresh = row is not None and age < (FOUND_TTL if row['body'] else MISSING_TTL)
        if not fresh:
            try:
                body = download(user_id)
            except Exception:
                body = None
                if row and row['body']:
                    fresh = True          # Telegram is unreachable: keep showing the old picture
            if not fresh:
                db().execute('INSERT INTO avatar_media VALUES(?,?,?,?) ON CONFLICT (user_id) DO UPDATE '
                             'SET mime=excluded.mime,body=excluded.body,updated=excluded.updated',
                             (user_id, 'image/jpeg', body, int(time.time())))
                db().commit()
                row = {'mime': 'image/jpeg', 'body': body}
        if not row or not row['body']:
            abort(404)
        response = Response(bytes(row['body']), mimetype=row['mime'] or 'image/jpeg')
        response.headers['Cache-Control'] = 'public, max-age=3600'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
