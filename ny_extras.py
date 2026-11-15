"""Small switches of the New Year section and of the interface.

* Section locks: an administrator sets a moment when «Новогодний маркет», «События сообщества» or the
  «Адвент-календарь» opens. Until then the button is grey with a countdown (the advent calendar is also
  closed on the server, so the API cannot be used to peek).
* Hidden admin panel: while the switch is on, the admin entry disappears from the navigation and the profile;
  an administrator opens it again by typing 777 in the top-up amount.
"""
import json
import re
import time

from flask import abort, request

SECTIONS = ('market', 'community', 'advent', 'season')
HUB_CARDS = ('market', 'community', 'advent', 'season')
HUB_BG_KEY = 'ny_hub_bg_v1'
LOCKS_KEY = 'ny_locks_v1'
HIDDEN_KEY = 'admin_panel_hidden_v1'
HIDDEN_SECTIONS_KEY = 'ny_hidden_sections_v1'


def install_ny_extras(app, db, auth, audit):
    def read(key, default):
        row = db().execute("SELECT payload FROM settings WHERE key=?", (key,)).fetchone()
        try:
            return json.loads(row['payload']) if row else default
        except (ValueError, TypeError):
            return default

    def write(key, value):
        db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                     (key, json.dumps(value)))

    def locks():
        raw = read(LOCKS_KEY, {})
        out = {}
        for name in SECTIONS:
            try:
                ts = int(raw.get(name) or 0)
            except (TypeError, ValueError, AttributeError):
                ts = 0
            if ts > 0:
                out[name] = ts
        return out

    def left(section):
        ts = locks().get(section)
        return max(0, ts - int(time.time())) if ts else 0

    def hidden():
        return bool(read(HIDDEN_KEY, {}).get('hidden') is True)

    def hidden_sections():
        raw = read(HIDDEN_SECTIONS_KEY, {})
        return [k for k in SECTIONS if isinstance(raw, dict) and raw.get(k) is True]

    def hub_bg():
        raw = read(HUB_BG_KEY, {})
        return {k: v for k, v in (raw.items() if isinstance(raw, dict) else []) if k in HUB_CARDS and isinstance(v, str) and v}

    app.extensions['crafter_ny_hub_bg'] = hub_bg
    app.extensions['crafter_ny_hidden_sections'] = hidden_sections
    app.extensions['crafter_ny_lock_left'] = left
    app.extensions['crafter_admin_hidden'] = hidden

    @app.get('/api/new-year/locks')
    @auth()
    def ny_locks():
        now = int(time.time())
        return {'now': now, 'locks': {k: v for k, v in locks().items() if v > now}, 'hidden': hidden_sections(), 'hub_bg': hub_bg()}

    @app.post('/api/admin/new-year/hub-bg')
    @auth(admin=True)
    def admin_hub_bg():
        body = request.get_json(silent=True) or {}
        card, bg = str(body.get('card') or ''), str(body.get('bg') or '').strip()
        if card not in HUB_CARDS:
            abort(400, description='Неизвестная кнопка')
        if bg:
            from shop_sections import BACKGROUNDS
            ok = bg in BACKGROUNDS or (bg.startswith('image:') and (re.fullmatch(r'/media/shop/[0-9a-f]{32}', bg[6:]) or re.fullmatch(r'/static/assets/chests/[A-Za-z0-9_.-]+', bg[6:])))
            if not ok:
                abort(400, description='Фон: выберите готовый или загрузите свою картинку')
        with db():
            raw = read(HUB_BG_KEY, {})
            raw = raw if isinstance(raw, dict) else {}
            if bg:
                raw[card] = bg
            else:
                raw.pop(card, None)
            write(HUB_BG_KEY, raw)
        audit('Events button background: ' + card)
        return {'ok': True, 'hub_bg': hub_bg()}

    # ---- the button «События» of the games page: the administrator changes its texts, picture and background
    TILE_KEY = 'events_tile_v1'
    TILE_ART = re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]{1,120}\.(?:svg|png|webp|gif|webm)')

    def tile_cfg():
        raw = read(TILE_KEY, {})
        raw = raw if isinstance(raw, dict) else {}
        art = str(raw.get('art') or '')
        kind = ''
        m = re.fullmatch(r'/media/shop/([0-9a-f]{32})', art)
        if m:
            row = db().execute("SELECT mime FROM shop_media WHERE id=?", (m.group(1),)).fetchone()
            kind = 'video' if row and row['mime'] == 'video/webm' else 'image'
        return {'title': str(raw.get('title') or '')[:40], 'subtitle': str(raw.get('subtitle') or '')[:140], 'button': str(raw.get('button') or '')[:24],
                'bg': str(raw.get('bg') or ''), 'art': art, 'art_kind': kind, 'shade': 0 if raw.get('shade') is False else 1}

    MUSIC_KEY = 'event_music_v1'
    TRACKS = [{'id': 'newyear', 'title': 'Новый год: «Jingle Bells» (колокольчики)', 'url': ''},
              {'id': 'vice', 'title': 'Vice City: «Neon Boulevard» (синтвейв, 2:55)', 'url': '/static/assets/audio/vice-city-event.mp3?v=1'}]

    def music_cfg():
        raw = read(MUSIC_KEY, {})
        raw = raw if isinstance(raw, dict) else {}
        mode = raw.get('mode') if raw.get('mode') in ('newyear', 'vice', 'off') else 'newyear'
        try:
            volume = max(5, min(100, int(raw.get('volume', 70))))
        except (TypeError, ValueError):
            volume = 70
        track = next((t for t in TRACKS if t['id'] == mode), None)
        return {'mode': mode, 'volume': volume, 'url': track['url'] if track else '', 'tracks': TRACKS}

    @app.get('/api/event-music')
    @auth()
    def event_music():
        return {'music': music_cfg()}

    @app.post('/api/admin/event-music')
    @auth(admin=True)
    def admin_event_music():
        body = request.get_json(silent=True) or {}
        mode = str(body.get('mode') or '')
        if mode not in ('newyear', 'vice', 'off'):
            abort(400, description='Выберите музыку: Новый год, Vice City или выключить')
        try:
            volume = int(body.get('volume'))
        except (TypeError, ValueError):
            abort(400, description='Громкость: число от 5 до 100')
        if not 5 <= volume <= 100:
            abort(400, description='Громкость: число от 5 до 100')
        with db():
            write(MUSIC_KEY, {'mode': mode, 'volume': volume})
        audit('Event music: %s, volume %d' % (mode, volume))
        return {'ok': True, 'music': music_cfg()}

    @app.get('/api/events-tile')
    @auth()
    def events_tile():
        return {'tile': tile_cfg()}

    @app.post('/api/admin/events-tile')
    @auth(admin=True)
    def admin_events_tile():
        body = request.get_json(silent=True) or {}
        if body.get('reset'):
            with db():
                db().execute("DELETE FROM settings WHERE key=?", (TILE_KEY,))
            audit('Events tile reset')
            return {'ok': True, 'tile': tile_cfg()}
        title = ' '.join(str(body.get('title') or '').split())[:40]
        subtitle = ' '.join(str(body.get('subtitle') or '').split())[:140]
        button = ' '.join(str(body.get('button') or '').split())[:24]
        bg, art = str(body.get('bg') or '').strip(), str(body.get('art') or '').strip()
        if bg:
            from shop_sections import BACKGROUNDS
            if not (bg in BACKGROUNDS or (bg.startswith('image:') and TILE_ART.fullmatch(bg[6:]))):
                abort(400, description='Фон: выберите готовый или загрузите свою картинку')
        if art and art != 'none' and not TILE_ART.fullmatch(art):
            abort(400, description='Рисунок: загрузите SVG, PNG, WebP, GIF или WebM, или выберите «без рисунка»')
        with db():
            write(TILE_KEY, {'title': title, 'subtitle': subtitle, 'button': button, 'bg': bg, 'art': art, 'shade': 0 if body.get('shade') is False else 1})
        audit('Events tile saved')
        return {'ok': True, 'tile': tile_cfg()}

    @app.get('/api/admin/new-year/locks')
    @auth(admin=True)
    def admin_ny_locks():
        return {'now': int(time.time()), 'locks': locks(), 'sections': list(SECTIONS), 'hidden': hidden_sections()}

    @app.post('/api/admin/new-year/locks')
    @auth(admin=True)
    def admin_ny_locks_save():
        body = (request.get_json(silent=True) or {}).get('locks')
        if not isinstance(body, dict):
            abort(400, description='Неверные данные')
        out = {}
        for name in SECTIONS:
            value = body.get(name)
            if value in (None, '', 0, '0'):
                continue
            try:
                ts = int(value)
            except (TypeError, ValueError):
                abort(400, description='Неверное время открытия')
            if not time.time() - 86400 <= ts <= time.time() + 3 * 365 * 86400:
                abort(400, description='Время открытия слишком далеко')
            out[name] = ts
        hide = (request.get_json(silent=True) or {}).get('hidden')
        with db():
            write(LOCKS_KEY, out)
            if isinstance(hide, dict):
                write(HIDDEN_SECTIONS_KEY, {k: bool(hide.get(k)) for k in SECTIONS})
        audit('New Year locks saved')
        return {'ok': True, 'locks': out, 'hidden': hidden_sections()}

    @app.post('/api/admin/ui/admin-hidden')
    @auth(admin=True)
    def admin_hidden_set():
        flag = (request.get_json(silent=True) or {}).get('hidden')
        if not isinstance(flag, bool):
            abort(400, description='hidden: true или false')
        with db():
            write(HIDDEN_KEY, {'hidden': flag})
        audit('Admin panel hidden: ' + str(flag))
        return {'ok': True, 'hidden': flag}
