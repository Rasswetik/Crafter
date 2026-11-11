"""Creators programme page: rates per 1000 views, the rules of the ad insert and the ready ad videos.

The page is not linked anywhere on the site. It opens by its address (/creators) or from Telegram through the
Mini App link with the start parameter "creators" (https://t.me/<bot>?startapp=creators): the application
shell redirects there, see static/creators-link.js.
"""
import math
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from flask import render_template, request

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
    ('arena', 'Арена', 'Ставки игроков, шар выбирает победителя и забирает банк', 'arena.mp4'),
    ('packs', 'Паки', 'Новогодние паки: GRAM и редкие подарки', 'packs.mp4'),
    ('newyear', 'Новогоднее обновление', 'Адвент, маркет, паки и события сообщества', 'newyear.mp4'),
)
ROOT = Path(__file__).resolve().parent


def money(value):
    return format(Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), 'f').replace('.', ',')


def install_creators(app):
    def rates():
        out = []
        for key, title, note, rate in RATES:
            out.append({'key': key, 'title': title, 'note': note, 'rate': str(rate), 'rate_text': money(rate),
                        'example': money(rate * 10), 'minimum_views': math.ceil(MIN_PAYOUT / rate * 1000)})
        return out

    def banners():
        found = []
        for key, title, note, filename in BANNERS:
            path = ROOT / 'static' / 'creators' / filename
            if path.is_file():
                found.append({'key': key, 'title': title, 'note': note, 'url': '/static/creators/' + filename,
                              'size': round(path.stat().st_size / 1048576, 1)})
        return found

    @app.get('/creators')
    def creators_page():
        bot = app.config.get('BOT_USERNAME') or 'crafter_app'
        response = app.make_response(render_template(
            'creators.html', rates=rates(), banners=banners(), minimum=int(MIN_PAYOUT), days=WINDOW_DAYS,
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
