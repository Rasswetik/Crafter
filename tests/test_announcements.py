"""Regression tests for announcement editing, visibility, and entry frequency."""
import sqlite3

from app import create_app
from test_app import signed


def test_announcement_assets_are_loaded_in_app_and_admin(tmp_path):
    app = create_app({'TESTING': True, 'DATABASE': str(tmp_path / 'wiring.db'),
                      'BOT_TOKEN': 'test-token', 'ADMIN_IDS': {42}, 'DEMO_MODE': False})
    client = app.test_client()
    home = client.get('/').data.decode()
    admin = client.get('/admin').data.decode()
    assert '/static/announcements.css' in home
    assert '/static/announcements.js' in home
    assert '/static/loading.js' in home
    assert '/static/announcements-admin.js' in admin
    assert '/static/announcements-admin.css' in admin
    assert admin.index('/static/announcements-admin.js') < admin.index('/static/admin-page.js')


def test_announcement_appears_first_visit_and_again_after_three_visits(tmp_path):
    database = tmp_path / 'announcements.db'
    app = create_app({'TESTING': True, 'DATABASE': str(database),
                      'BOT_TOKEN': 'test-token', 'ADMIN_IDS': {42}, 'DEMO_MODE': False})
    client = app.test_client()

    assert client.get('/api/admin/announcements', headers=signed(43)).status_code == 403
    invalid = client.post('/api/admin/announcements', headers=signed(), json={
        'title': 'Unsafe media', 'media': 'javascript:alert(1)', 'enabled': True})
    assert invalid.status_code == 400

    create = client.post('/api/admin/announcements', headers=signed(), json={
        'title': 'Season announcement', 'description': 'New rewards',
        'enabled': True, 'frequency': 3, 'close_delay': 2,
        'button_text': 'Arena', 'button_url': '/?view=arena',
    })
    assert create.status_code == 200, create.data
    item = create.json['announcement']
    assert item['frequency'] == 3

    visitor = signed(43)
    first = client.post('/api/announcements/entry', headers=visitor, json={})
    assert first.status_code == 200, first.data
    assert first.json['announcement']['id'] == item['id']
    immediate = client.post('/api/announcements/entry', headers=visitor, json={})
    assert immediate.status_code == 200
    assert immediate.json['announcement'] is None

    for visit in range(1, 4):
        with sqlite3.connect(database) as db:
            db.execute('UPDATE crafter_announcement_visits SET last_entry=last_entry-60 '
                       'WHERE user_id=? AND announcement_id=?', (43, item['id']))
        response = client.post('/api/announcements/entry', headers=visitor, json={})
        assert response.status_code == 200, response.data
        assert (response.json['announcement'] is not None) is (visit == 3)
