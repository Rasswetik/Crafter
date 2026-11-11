"""Creators programme page: rates per 1000 views, the rules of the ad insert and the ready ad videos.

The page is not linked anywhere on the site. It opens by its address (/creators) or from Telegram through the
Mini App link with the start parameter "creators" (https://t.me/<bot>?startapp=creators): the application
shell redirects there, see static/creators-link.js.

The ad videos are NOT public: they live outside /static and are served only to a signed-in player through a
short-lived signed link (GET /api/creators/banners gives the links).
"""
import hashlib
import hmac
import math
import time
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from flask import abort, g, render_template, request, send_file

# category -> (title, short note, USD per 1000 views)
RATES = (
    ('tg', 'Telegram и подарки', 'Ролики про Telegram, подарки, NFT-подарки, мини-приложения', Decimal('1.25')),
    ('cs', 'Игры: CS2, Dota', 'Нарезки, хайлайты, обзоры по CS2 и Dota 2', Decimal('0.90')),
    ('games', 'Остальные игры', 'Roblox, Standoff 2 и любые другие игры', Decimal('0.65')),
    ('memes', 'Мемы, сериалы и нарезки', 'Мемы, фильмы, сериалы и другие нарезки', Decimal('0.15')),
)
MIN_PAYOUT = Decimal('10')
WINDOW_DAYS = 5
BANNERS = (
    ('upgrade', 'Апгрейд', 'Lol Pop превращается в Nail Bracelet с шансом 5%', 'upgrade.mp4'),
    ('craft', 'Крафт', 'Четыре подарка в кубе дают новый подарок', 'craft.mp4'),
)
ROOT = Path(__file__).resolve().parent
BANNER_DIR = ROOT / 'data' / 'creators_banners'
LINK_TTL = 15 * 60


def money(value):
    return format(Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), 'f').replace('.', ',')


def install_creators(app, auth=None):
    def secret():
        return (app.config.get('BOT_TOKEN') or 'crafter-creators').encode()

    def sign(user_id, key, expires):
        return hmac.new(secret(), ('%s:%s:%s' % (user_id, key, expires)).encode(), hashlib.sha256).hexdigest()[:32]

    def rates():
        out = []
        for key, title, note, rate in RATES:
            out.append({'key': key, 'title': title, 'note': note, 'rate': str(rate), 'rate_text': money(rate),
                        'example': money(rate * 10), 'minimum_views': math.ceil(MIN_PAYOUT / rate * 1000)})
        return out

    @app.get('/creators')
    def creators_page():
        bot = app.config.get('BOT_USERNAME') or 'crafter_app'
        response = app.make_response(render_template(
            'creators.html', rates=rates(), minimum=int(MIN_PAYOUT), days=WINDOW_DAYS,
            site=request.url_root.rstrip('/'), bot=bot, link='https://t.me/' + bot + '?startapp=creators'))
        response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        response.headers['Cache-Control'] = 'no-cache'
        return response

    @app.get('/creators/my')
    def creators_my_page():
        response = app.make_response(render_template('creators_my.html'))
        response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        response.headers['Cache-Control'] = 'no-cache'
        return response

    if auth is None:
        return

    @app.get('/api/creators/banners')
    @auth()
    def creators_banners():
        """The ad videos for a signed-in player: each link works for 15 minutes and only for this player."""
        expires = int(time.time()) + LINK_TTL
        uid = g.user['id']
        items = []
        for key, title, note, filename in BANNERS:
            path = BANNER_DIR / filename
            if path.is_file():
                token = '%d.%s' % (expires, sign(uid, key, expires))
                items.append({'key': key, 'title': title, 'note': note, 'size': round(path.stat().st_size / 1048576, 1),
                              'url': '/creators/file/%s/%d/%s.mp4' % (key, uid, token)})
        return {'banners': items}

    @app.get('/creators/file/<key>/<int:uid>/<expires>.<signature>.mp4')
    def creators_banner_file(key, uid, expires, signature):
        entry = next((b for b in BANNERS if b[0] == key), None)
        try:
            exp = int(expires)
        except ValueError:
            abort(404)
        if not entry or exp < time.time() or not hmac.compare_digest(signature, sign(uid, key, exp)):
            abort(404)
        path = BANNER_DIR / entry[3]
        if not path.is_file():
            abort(404)
        response = send_file(path, mimetype='video/mp4', conditional=True, as_attachment=request.args.get('download') == '1',
                             download_name='crafter-%s.mp4' % key)
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        return response
