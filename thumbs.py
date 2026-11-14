"""Small copies of big pictures for phones: /thumb?u=<path>&w=<width>. A phone decodes every picture it shows into memory
(a 1672x941 background is ~6 MB, a 4000 px upload is 60 MB), and a market with a dozen of such cards makes the browser of
Telegram kill the page. Only our own pictures are allowed: static/assets/{chests,packs} and uploaded /media/shop/<id>."""
import hashlib
import io
import os
import re

from flask import Response, abort, request

STATIC_OK = re.compile(r'/static/assets/(chests|packs)/[A-Za-z0-9_.-]+\.(png|webp|jpg|jpeg)')
MEDIA_OK = re.compile(r'/media/shop/([0-9a-f]{32})')
WIDTHS = (120, 200, 320, 480, 640, 800, 1000, 1280)


def install_thumbs(app, db):
    folder = os.path.join(app.instance_path, 'thumbs')

    def stamp_of(u):                                       # uploads never change under their id; our files change with their time
        if MEDIA_OK.fullmatch(u):
            return 'm'
        if STATIC_OK.fullmatch(u):
            path = os.path.join(app.root_path, u.lstrip('/'))
            if os.path.isfile(path):
                return str(int(os.path.getmtime(path)))
        abort(404)

    def read(u):
        m = MEDIA_OK.fullmatch(u)
        if m:
            row = db().execute("SELECT mime,body FROM shop_media WHERE id=?", (m.group(1),)).fetchone()
            if not row or not row['body'] or not str(row['mime']).startswith('image/') or row['mime'] == 'image/svg+xml':
                abort(404)
            return bytes(row['body'])
        with open(os.path.join(app.root_path, u.lstrip('/')), 'rb') as fh:
            return fh.read()

    @app.get('/thumb')
    def thumb():
        u = str(request.args.get('u') or '')
        try:
            want = int(request.args.get('w') or 480)
        except ValueError:
            want = 480
        width = next((x for x in WIDTHS if x >= want), WIDTHS[-1])
        cached = os.path.join(folder, '%s-%s.webp' % (hashlib.sha1(('%s|%d' % (u, width)).encode()).hexdigest(), stamp_of(u)))
        if not os.path.isfile(cached):
            from PIL import Image
            try:
                im = Image.open(io.BytesIO(read(u)))
                im.load()
            except Exception:
                abort(415)
            if im.width > width:
                im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
            im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
            os.makedirs(folder, exist_ok=True)
            tmp = cached + '.%d.tmp' % os.getpid()
            im.save(tmp, 'WEBP', quality=80, method=4)
            os.replace(tmp, cached)
        with open(cached, 'rb') as fh:
            body = fh.read()
        response = Response(body, mimetype='image/webp')
        response.headers['Cache-Control'] = 'public, max-age=604800'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
