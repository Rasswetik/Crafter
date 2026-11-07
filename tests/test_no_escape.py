"""Regression checks for retired Escape mode."""
from pathlib import Path

from test_app import client, signed


def test_escape_removed_from_app_and_navigation(client):
    root = Path(__file__).resolve().parent.parent
    hub = (root / 'static/staking.js').read_text(encoding='utf-8')
    template = (root / 'templates/index.html').read_text(encoding='utf-8')
    app_py = (root / 'app.py').read_text(encoding='utf-8')
    assert 'escape' not in hub.lower()
    assert '/static/escape' not in template
    assert 'install_escape' not in app_py
    assert not (root / 'escape.py').exists()
    assert not (root / 'static/escape.js').exists()
    assert not (root / 'static/escape.css').exists()
    assert 'go(\'arena\')' in hub
    assert 'go(\'craft\')' in hub

    for route in ('/api/escape/state','/api/escape/play',
                  '/api/escape/test-balance/reset'):
        response = client.get(route, headers=signed(43))
        assert response.status_code == 404


def test_escape_removal_preserves_other_crafter_operations(client):
    headers = signed(43)
    assert client.get('/api/me', headers=headers).status_code == 200
    assert client.get('/api/inventory', headers=headers).status_code == 200
