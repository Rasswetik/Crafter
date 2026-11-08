"""Owner-only team administration and graphite UI regression checks."""
from pathlib import Path

from test_app import client, signed


def test_primary_can_grant_by_telegram_username(client):
    owner = signed(42)
    teammate = signed(43, username='TrustedDev')
    assert client.get('/api/me', headers=owner).status_code == 200
    assert client.get('/api/me', headers=teammate).status_code == 200

    new_role = client.post('/api/admin/admins', headers=owner, json={
        'user_id': '@trusteddev', 'role': 'sections',
        'permissions': ['users', 'audit'],
    })
    assert new_role.status_code == 200, new_role.json
    assert new_role.json['admin']['user_id'] == 43
    assert client.get('/api/me', headers=teammate).json['admin_permissions'] == [
        'users', 'audit'
    ]
    # The case and prefix can be omitted, but identity is still matched to the
    # existing verified Telegram account stored on the server.
    new_role = client.post('/api/admin/admins', headers=owner, json={
        'user_id': 'TrustedDev', 'role': 'full', 'permissions': [],
    })
    assert new_role.status_code == 200, new_role.json
    assert client.get('/api/me', headers=teammate).json['admin_permissions'] == ['*']
    assert client.get('/api/admin/admins', headers=teammate).status_code == 403


def test_primary_prevents_misidentification_when_granting(client):
    owner = signed(42, username='SiteOwner')
    assert client.get('/api/me', headers=owner).status_code == 200
    for username, expected in (
        ('@unknown_visitor', 404),
        ('not a Telegram handle', 400),
        ('@SiteOwner', 403),
        (True, 400),
    ):
        response = client.post('/api/admin/admins', headers=owner, json={
            'user_id': username, 'role': 'full',
        })
        assert response.status_code == expected, (username, response.json)


def test_secondary_admin_cannot_grant_roles_by_username(client):
    assert client.get('/api/me', headers=signed(43, username='DelegateUser')).status_code == 200
    assert client.get('/api/me', headers=signed(44, username='AnotherUser')).status_code == 200
    owner = signed(42)
    granted = client.post('/api/admin/admins', headers=owner, json={
        'user_id': '@DelegateUser', 'role': 'full',
    })
    assert granted.status_code == 200
    response = client.post('/api/admin/admins', headers=signed(43, username='DelegateUser'), json={
        'user_id': '@AnotherUser', 'role': 'full',
    })
    assert response.status_code == 403


def test_owner_shortcut_is_visible_and_layout_is_graphite():
    root = Path(__file__).resolve().parent.parent
    admin = (root / 'static/admin-page.js').read_text(encoding='utf-8')
    role_editor = (root / 'static/admin-console-ui.js').read_text(encoding='utf-8')
    style = (root / 'static/admin-graphite.css').read_text(encoding='utf-8')
    template = (root / 'templates/admin.html').read_text(encoding='utf-8')

    assert 'admin-owner-quick' in admin
    assert 'admin-header-owner-button' in admin
    assert "state.me?.is_primary_admin" in admin
    assert "id!=='admins'" in admin
    assert 'adminEditRole' in role_editor
    assert 'Telegram ID или @username' in role_editor
    assert 'admin-role-selection-count' in role_editor
    assert 'admin-role-row-actions' in role_editor
    assert '--admin-surface:#202124cd' in style
    assert 'body.admin-page .admin-navigation' in style
    assert 'body.admin-page .admin-role-options' in style
    assert 'crafter-top-canopy.svg' in style
    assert 'admin-graphite.css' in template
