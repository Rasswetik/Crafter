"""Bounded image fallback for numbered Fragment gifts."""
import re
from functools import lru_cache
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from flask import Response, abort


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@lru_cache(maxsize=32)
def fragment_image(slug):
    opener = build_opener(NoRedirect)
    for extension in ('.large.jpg', '.webp'):
        req = Request('https://nft.fragment.com/gift/' + slug + extension,
                      headers={'Accept': 'image/jpeg,image/webp,image/png'})
        try:
            with opener.open(req, timeout=3) as response:
                data = response.read(2_000_001)
        except (URLError, TimeoutError, OSError):
            continue
        if len(data) > 2_000_000:
            continue
        if data.startswith(b'\xff\xd8\xff'):
            return data, 'image/jpeg'
        if data.startswith(b'RIFF') and data[8:12] == b'WEBP':
            return data, 'image/webp'
        if data.startswith(b'\x89PNG\r\n\x1a\n'):
            return data, 'image/png'
    raise LookupError(slug)


def serve_fragment_gift(slug):
    if not re.fullmatch(r'[a-z0-9]{1,60}-[1-9][0-9]{0,14}', slug):
        abort(404)
    try:
        data, content_type = fragment_image(slug)
    except LookupError:
        abort(404)
    return Response(data, mimetype=content_type, headers={
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
    })
