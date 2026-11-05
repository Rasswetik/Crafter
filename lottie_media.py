"""Read-only proxies for vetted public Telegram gift Lottie animations.

No user-supplied hostnames or redirects are allowed.
"""
import json
import re
from functools import lru_cache
from urllib.error import URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from flask import abort, Response


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


SLUG = re.compile(r'^[a-z][a-z0-9]{1,70}-[0-9]{1,10}$')
MAX_JSON = 1_500_000


@lru_cache(maxsize=128)
def public_gift_lottie(source):
    if source == 'magnate':
        url = 'https://cdn.changes.tg/gifts/models/Plush%20Pepe/lottie/Magnate.json'
    elif SLUG.fullmatch(source):
        url = 'https://nft.fragment.com/gift/' + source + '.lottie.json'
    else:
        return None
    opener = build_opener(NoRedirect)
    try:
        req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Crafter/1.0'})
        with opener.open(req, timeout=3) as response:
            if response.status != 200:
                return None
            data = response.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            return None
        payload = json.loads(data)
        if (not isinstance(payload, dict) or
            not isinstance(payload.get('layers'), list) or
            not 0 < int(payload.get('w', 0)) <= 1024 or
            not 0 < int(payload.get('h', 0)) <= 1024):
            return None
        return data
    except (URLError, OSError, ValueError, TypeError, KeyError, OverflowError):
        return None


def install_lottie_media(app):
    def send_lottie(slug):
        data = public_gift_lottie(slug)
        if data is None:
            abort(404, description='Animation not available')
        response = Response(data, mimetype='application/json')
        response.headers['Cache-Control'] = 'public, max-age=86400'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/media/crafter/magnate.json')
    def magnate_lottie():
        return send_lottie('magnate')

    @app.get('/media/crafter/gift/<slug>.json')
    def gift_lottie(slug):
        if not SLUG.fullmatch(slug):
            abort(404)
        return send_lottie(slug)
