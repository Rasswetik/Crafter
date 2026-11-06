"""Unified season: additive Arena and Craft ranking, linked banners and safe unlink."""
import json
import sqlite3
import time

from test_app import client, signed


def test_unified_season_aggregates_successes_and_preserves_mode_banners(client):
    from arena_banner import CONFIG_KEY, CRAFT_KEY, default_banner

    admin = signed(42)
    for uid in (42, 43, 44):
        assert client.get('/api/me', headers=signed(uid)).status_code == 200

    now = int(time.time())
    start, end = now - 900, now + 600

    def make_event(title, metric):
        response = client.post('/api/admin/events', headers=admin, data={
            'title': title, 'description': '', 'metric': metric,
            'start_at': str(start), 'end_at': str(end),
            'accent': '#9164e9', 'sort_order': '10',
            'enabled': '1', 'show_leaderboard': '1',
            'prizes_json': '[]'
        })
        assert response.status_code == 200, response.json
        return response.json['id']

    arena_id = make_event('Arena wins', 'arena_wins')
    craft_id = make_event('Craft wins', 'craft_wins')
    originals = {
        'arena': {**default_banner('arena'), 'enabled': True,
                  'event_id': arena_id, 'start_at': start, 'end_at': end,
                  'background_color': '#114477'},
        'craft': {**default_banner('craft'), 'enabled': True,
                  'event_id': craft_id, 'start_at': start, 'end_at': end,
                  'background_color': '#793b91'},
    }

    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for kind, key in [('arena', CONFIG_KEY), ('craft', CRAFT_KEY)]:
            db.execute("INSERT INTO settings(key,payload) VALUES (?,?)",
                       (key, json.dumps(originals[kind])))
        history = [
            ('arena_result', 43, True), ('arena_result', 43, True),
            ('arena_result', 44, True), ('arena_result', 44, False),
            ('craft', 43, True), ('craft', 44, True), ('craft', 44, True),
            ('craft', 44, False)
        ]
        for i, (kind, uid, success) in enumerate(history):
            db.execute("INSERT INTO history VALUES (?,?,?,?,?)",
                       ('season-history-'+str(i), uid, kind,
                        json.dumps({'success': success}), now-120))

    assert client.post('/api/admin/seasons/merge', headers=signed(43), json={}).status_code == 403
    payload = {'title': 'Arena x Craft | Season 1', 'arena_event_id': arena_id,
               'craft_event_id': craft_id}
    merged = client.post('/api/admin/seasons/merge', headers=admin, json=payload)
    assert merged.status_code == 200, merged.json
    season_id = merged.json['id']
    assert season_id not in (arena_id, craft_id)
    assert client.post('/api/admin/seasons/merge', headers=admin, json=payload).status_code == 409

    season = client.get('/api/events/'+season_id)
    assert season.status_code == 200, season.json
    event = season.json['event']
    assert event['metric'] == 'season_points'
    assert event['score_unit'] == 'очков'
    leaders = season.json['leaders']
    assert [(r['id'], r['score'], r['arena_score'], r['craft_score']) for r in leaders] == [
        ('43', '3', '2', '1'), ('44', '3', '1', '2')
    ]

    arena_banner = client.get('/api/arena/banner').json['banner']
    craft_banner = client.get('/api/craft/banner').json['banner']
    assert arena_banner['event_id'] == season_id
    assert craft_banner['event_id'] == season_id
    assert arena_banner['background_color'] == '#114477'
    assert craft_banner['background_color'] == '#793b91'

    assert client.get('/api/admin/seasons', headers=admin).json['active'] == season_id
    assert client.post('/api/admin/events/'+arena_id+'/delete', headers=admin).status_code == 409
    assert client.post('/api/admin/events/'+season_id+'/delete', headers=admin).status_code == 409

    unlink = client.post('/api/admin/seasons/unlink', headers=admin,
                         json={'season_event_id': season_id})
    assert unlink.status_code == 200, unlink.json
    assert client.get('/api/admin/seasons', headers=admin).json['active'] is None
    assert client.get('/api/arena/banner').json['banner']['event_id'] == arena_id
    assert client.get('/api/craft/banner').json['banner']['event_id'] == craft_id
    assert client.get('/api/events/'+season_id).json['leaders'] == leaders
    assert client.post('/api/admin/seasons/unlink', headers=admin,
                       json={'season_event_id': season_id}).status_code == 409
