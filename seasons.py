"""Unified Crafter season: merge Arena and Craft successes into one leaderboard.

A season snapshots the two chosen scoring windows and assigns one point per
successful Arena round and one point per successful Craft. No balances, NFTs,
individual ledgers, or historical events are modified by merging.
"""
import json
import re
import time
import uuid
from collections import defaultdict
from flask import abort, request

ACTIVE_KEY = 'crafter_unified_season_v1'
BANNER_FIELDS = ('enabled', 'event_id', 'start_at', 'end_at', 'title', 'hide_after_end')
SEASON_ID = re.compile(r'^[0-9a-f]{32}$')


def season_ranking(db, event, limit=100):
    row = db().execute(
        'SELECT * FROM crafter_event_seasons WHERE season_event_id=?',
        (event['id'],)).fetchone()
    if not row:
        return []
    results = defaultdict(lambda: {'arena_score': 0, 'craft_score': 0})
    players = {}
    now = int(time.time())
    query = """SELECT h.user_id,h.payload,u.name,u.username,a.photo_url
        FROM history h
        LEFT JOIN users u ON u.id=h.user_id
        LEFT JOIN user_avatars a ON a.user_id=h.user_id
        WHERE h.kind=? AND h.created>=? AND h.created<=? AND h.user_id>0"""
    for kind, field, start, end in (
        ('arena_result', 'arena_score', row['arena_start'], row['arena_end']),
        ('craft', 'craft_score', row['craft_start'], row['craft_end']),
    ):
        end = min(now, int(end))
        if end < int(start):
            continue
        for record in db().execute(query, (kind, start, end)):
            try:
                if json.loads(record['payload']).get('success') is not True:
                    continue
            except (ValueError, TypeError):
                continue
            uid = int(record['user_id'])
            results[uid][field] += 1
            players[uid] = {
                'id': str(uid),
                'name': record['name'] or record['username'] or 'Игрок',
                'photo_url': record['photo_url'] or '',
            }
    order = sorted(results, key=lambda uid: (
        -(results[uid]['arena_score'] + results[uid]['craft_score']), uid))
    return [{
        'rank': idx, 'score': str(results[uid]['arena_score'] + results[uid]['craft_score']),
        'arena_score': str(results[uid]['arena_score']),
        'craft_score': str(results[uid]['craft_score']),
        **players[uid]
    } for idx, uid in enumerate(order[:limit], 1)]


def install_seasons(app, db, auth, audit):
    from arena_banner import CONFIG_KEY, CRAFT_KEY, default_banner
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_event_seasons (
                season_event_id TEXT PRIMARY KEY,
                arena_event_id TEXT NOT NULL,
                craft_event_id TEXT NOT NULL,
                arena_start INTEGER NOT NULL,
                arena_end INTEGER NOT NULL,
                craft_start INTEGER NOT NULL,
                craft_end INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
        """)

    def active_record():
        stored = db().execute(
            'SELECT payload FROM settings WHERE key=?', (ACTIVE_KEY,)).fetchone()
        if not stored:
            return None
        try:
            data = json.loads(stored['payload'])
            return data if isinstance(data, dict) and data.get('season_event_id') else None
        except (TypeError, ValueError):
            return None

    def banner_config(kind):
        key = CRAFT_KEY if kind == 'craft' else CONFIG_KEY
        stored = db().execute('SELECT payload FROM settings WHERE key=?', (key,)).fetchone()
        if not stored:
            return default_banner(kind)
        try:
            config = json.loads(stored['payload'])
            if isinstance(config, dict):
                return {**default_banner(kind), **config}
        except (TypeError, ValueError):
            pass
        return default_banner(kind)

    def write_banner(kind, config):
        key = CRAFT_KEY if kind == 'craft' else CONFIG_KEY
        db().execute("""INSERT INTO settings(key,payload) VALUES(?,?)
            ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
            (key, json.dumps(config, ensure_ascii=False)))

    @app.get('/api/admin/seasons')
    @auth(admin=True)
    def list_seasons():
        active = active_record()
        rows = db().execute("""SELECT s.*,e.title,e.enabled,e.start_at,e.end_at
            FROM crafter_event_seasons s JOIN crafter_events e
            ON s.season_event_id=e.id ORDER BY s.created_at DESC""").fetchall()
        return {'active': active['season_event_id'] if active else None,
                'seasons': [{**dict(row), 'active': bool(active and
                    active['season_event_id'] == row['season_event_id'])} for row in rows]}

    @app.post('/api/admin/seasons/merge')
    @auth(admin=True)
    def merge_season():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, description='Передайте два лидерборда')
        arena_id = body.get('arena_event_id')
        craft_id = body.get('craft_event_id')
        title = str(body.get('title', '')).strip()
        if not all(isinstance(x, str) and SEASON_ID.fullmatch(x)
                   for x in (arena_id, craft_id)) or arena_id == craft_id:
            abort(400, description='Выберите разные события Arena и Крафтов')
        if not 1 <= len(title) <= 90:
            abort(400, description='Укажите название сезона до 90 символов')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if active_record():
                abort(409, description='Уже есть активный общий сезон. Сначала отвяжите его.')
            selected = db().execute(
                'SELECT id,title,metric,start_at,end_at,accent FROM crafter_events WHERE id IN (?,?)',
                (arena_id, craft_id)).fetchall()
            sources = {entry['id']: entry for entry in selected}
            arena, craft = sources.get(arena_id), sources.get(craft_id)
            if not arena or not craft or arena['metric'] != 'arena_wins' or craft['metric'] != 'craft_wins':
                abort(400, description='Выберите топ по победам Arena и топ успешных крафтов')
            if db().execute('SELECT COUNT(*) FROM crafter_events').fetchone()[0] >= 50:
                abort(409, description='Достигнут лимит в 50 событий')
            start = min(arena['start_at'], craft['start_at'])
            end = max(arena['end_at'], craft['end_at'])
            season_id = uuid.uuid4().hex
            description = (
                'Один общий сезон Arena и Крафтов. Победа в Arena = 1 очко; '
                'успешный крафт = 1 очко. Для каждого режима учитывается '
                'период выбранного лидерборда.')
            prizes = json.dumps([], ensure_ascii=False)
            db().execute("""INSERT INTO crafter_events
                (id,title,description,metric,start_at,end_at,enabled,accent,
                 show_leaderboard,sort_order,prizes,image_key,image)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (season_id, title, description, 'season_points', start, end, 1,
                 arena['accent'], 1, 0, prizes, 'none', b''))
            db().execute("""INSERT INTO crafter_event_seasons
                (season_event_id,arena_event_id,craft_event_id,arena_start,arena_end,
                 craft_start,craft_end,created_at) VALUES(?,?,?,?,?,?,?,?)""",
                (season_id, arena_id, craft_id, arena['start_at'], arena['end_at'],
                 craft['start_at'], craft['end_at'], int(time.time())))
            backups = {}
            for kind in ('arena', 'craft'):
                before = banner_config(kind)
                backups[kind] = {name: before.get(name) for name in BANNER_FIELDS}
                updated = {**before, 'enabled': True, 'event_id': season_id,
                           'start_at': start, 'end_at': end,
                           'title': title, 'hide_after_end': True}
                # Keep each existing banner's artwork, GIFs, geometry and fonts.
                write_banner(kind, updated)
            db().execute("""INSERT INTO settings(key,payload) VALUES(?,?)
                ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
                (ACTIVE_KEY, json.dumps({
                    'season_event_id': season_id,
                    'arena_event_id': arena_id,
                    'craft_event_id': craft_id,
                    'banner_backups': backups
                }, ensure_ascii=False)))
        audit('Arena and Craft leaderboards merged into one season: ' + season_id)
        return {'ok': True, 'id': season_id, 'title': title,
                'arena_event_id': arena_id, 'craft_event_id': craft_id}

    @app.post('/api/admin/seasons/unlink')
    @auth(admin=True)
    def unlink_season():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('season_event_id'), str):
            abort(400, description='Выберите сезон')
        season_id = body['season_event_id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            active = active_record()
            if not active or active['season_event_id'] != season_id:
                abort(409, description='Этот сезон уже не привязан к баннерам')
            for kind in ('arena', 'craft'):
                current = banner_config(kind)
                if current.get('event_id') != season_id:
                    continue
                saved = active.get('banner_backups', {}).get(kind, {})
                if not isinstance(saved, dict):
                    continue
                current.update({key: saved[key] for key in BANNER_FIELDS if key in saved})
                write_banner(kind, current)
            db().execute('DELETE FROM settings WHERE key=?', (ACTIVE_KEY,))
        audit('Shared Arena and Craft season banners unlinked: ' + season_id)
        return {'ok': True, 'season_event_id': season_id}
