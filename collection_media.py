"""Strictly bounded public Fragment collection-thumbnail proxy.

Images are fetched only from Fragment's fixed public HTTPS origin. User input
is a limited gift slug, so the endpoint cannot be used as an SSRF proxy.
Successful responses are cached in-process and by downstream browsers.
"""
import re
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from flask import Response, abort


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@lru_cache(maxsize=256)
def load_collection_thumbnail(slug):
    request = Request(
        'https://fragment.com/file/gifts/' + slug + '/thumb.webp',
        headers={'Accept': 'image/webp,image/png,image/jpeg',
                 'User-Agent': 'Mozilla/5.0 Crafter/1.0'},
    )
    try:
        with build_opener(NoRedirect).open(request, timeout=5) as response:
            content = response.read(1_500_001)
    except (HTTPError, URLError, TimeoutError, OSError):
        raise LookupError(slug)
    if len(content) > 1_500_000:
        raise LookupError(slug)
    if content.startswith(b'RIFF') and content[8:12] == b'WEBP':
        return content, 'image/webp'
    if content.startswith(b'\x89PNG\r\n\x1a\n'):
        return content, 'image/png'
    if content.startswith(b'\xff\xd8\xff'):
        return content, 'image/jpeg'
    raise LookupError(slug)


def serve_collection_thumbnail(slug):
    if not re.fullmatch(r'[a-z0-9]{2,60}', slug):
        abort(404)
    try:
        data, media_type = load_collection_thumbnail(slug)
    except LookupError:
        abort(404)
    return Response(data, mimetype=media_type, headers={
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff'
    })


# Serve the exact transparent gift model/symbol artwork in Telegram WebViews.
# The upstream host and path kind are fixed; clients cannot proxy arbitrary URLs.
from urllib.parse import quote
from flask import request


def _valid_trait_segment(value):
    return isinstance(value, str) and 1 <= len(value) <= 120 and value == value.strip() and not any(
        ord(char) < 32 or char in '/\\?#' for char in value
    )


@lru_cache(maxsize=1024)
def load_trait_png(kind, gift, name):
    url = ('https://api.changes.tg/' + kind + '/' + quote(gift, safe='')
           + '/' + quote(name, safe='') + '.png?size=128')
    upstream = Request(url, headers={
        'Accept': 'image/png', 'User-Agent': 'Mozilla/5.0 Crafter/1.0',
    })
    try:
        with build_opener(NoRedirect).open(upstream, timeout=6) as response:
            data = response.read(1_000_001)
    except (HTTPError, URLError, TimeoutError, OSError):
        raise LookupError((gift, name))
    if len(data) > 1_000_000 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise LookupError((gift, name))
    return data


def serve_trait_png(kind):
    gift, name = request.args.get('gift', ''), request.args.get('name', '')
    if kind not in ('model', 'symbol') or not _valid_trait_segment(gift) or not _valid_trait_segment(name):
        abort(404)
    try:
        data = load_trait_png(kind, gift, name)
    except LookupError:
        abort(404)
    return Response(data, mimetype='image/png', headers={
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
    })
