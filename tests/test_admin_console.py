"""Security and reporting checks for the Crafter liquid-glass admin console."""
import json
import sqlite3
import time

from test_app import client, signed


def test_maintenance_is_admin_only_and_enforced_server_side(client):
    admin = signed(42)
    member = signed(43)
    assert client.get('/api/me', headers=member).status_code == 200
    assert client.get('/api/site/maintenance').json['enabled'] is False
    assert client.post('/api/admin/maintenance', headers=member, json={
        'enabled': True, 'confirm': 'ENABLE_MAINTENANCE'}).status_code == 403
    assert client.post('/api/admin/maintenance', headers=admin, json={
        'enabled': True}).status_code == 400
    assert client.post('/api/admin/maintenance', headers=admin, json={
        'enabled': True, 'confirm': 'ENABLE_MAINTENANCE',
        'message': 'Обновляем сервис'}).status_code == 200

    assert client.get('/api/site/snow').status_code == 200
    public = client.get('/api/site/maintenance').json
    assert public['enabled'] is True and public['message'] == 'Обновляем сервис'
    assert client.get('/api/me', headers=member).status_code == 503
    blocked = client.post('/api/craft/quote', headers=member, json={})
    assert blocked.status_code == 503 and blocked.json['maintenance']
    assert client.get('/api/admin/status', headers=member).status_code == 503
    assert client.get('/api/me', headers=signed(42, token='forged')).status_code == 503
    assert client.get('/api/site/maintenance/access', headers=member).json['is_admin'] is False
    assert client.get('/api/site/maintenance/access', headers=admin).json['is_admin'] is True

    # Admin bypasses actual API enforcement, not a client-side visibility flag.
    assert client.get('/api/me', headers=admin).status_code == 200
    assert client.get('/api/admin/status', headers=admin).status_code == 200
    html = client.get('/')
    assert html.status_code == 200
    assert b'crafter-maintenance' in html.data
    assert b'is-active' in html.data
    assert b'crafter-maintenance-retry' in html.data
    assert client.get('/health').status_code == 200

    assert client.post('/api/admin/maintenance', headers=admin, json={
        'enabled': False, 'confirm': 'DISABLE_MAINTENANCE'}).status_code == 200
    assert client.get('/api/me', headers=member).status_code == 200
    assert client.get('/api/site/maintenance').json['enabled'] is False


def test_admin_finance_reports_verified_cash_flows_without_claiming_profit(client):
    h = signed(42)
    member = signed(43)
    assert client.get('/api/me', headers=member).status_code == 200
    now = int(time.time())
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        conn.execute("INSERT INTO ton_deposits VALUES (?,?,?,?,?,?)",
                     ('dep1', 43, json.dumps({'gram':'10.00','ton':'1.20'}),
                      'confirmed', now, 'tx1'))
        conn.execute("INSERT INTO ton_deposits VALUES (?,?,?,?,?,?)",
                     ('dep2', 43, json.dumps({'gram':'9999.00','ton':'999'}),
                      'pending', now, None))
        conn.execute("INSERT INTO ton_withdrawals VALUES (?,?,?,?,?,?)",
                     ('wd1', 43, json.dumps({'gram':'4.00','ton':'0.40'}),
                      'confirmed', now, 'tx2'))
        conn.execute("INSERT INTO ton_withdrawals VALUES (?,?,?,?,?,?)",
                     ('wd2', 43, json.dumps({'gram':'7','ton':'0.7'}),
                      'queued', now, None))
    assert client.get('/api/admin/finance', headers=member).status_code == 403
    resp = client.get('/api/admin/finance?period=week', headers=h)
    assert resp.status_code == 200, resp.json
    report = resp.json
    assert report['totals']['deposit_gram'] == '10.00'
    assert report['totals']['withdraw_gram'] == '4.00'
    assert report['totals']['deposit_ton'] == '1.20'
    assert report['totals']['withdraw_ton'] == '0.40'
    assert report['net_gram'] == '6.00'
    assert report['counts']['deposit_pending'] == 1
    assert report['authoritative_profit'] is None
    assert len(report['series']) == 1
    assert 'прибыл' in report['finance_note'].lower()
    own = client.get('/api/admin/users/43/finance?period=week', headers=h)
    assert own.status_code == 200 and own.json['net_gram'] == '6.00'
    assert client.get('/api/admin/users/44/finance?period=week', headers=h).status_code == 404
    assert client.get('/api/admin/finance?period=custom&from=2026-11-01&to=2026-10-01',
                      headers=h).status_code == 400
    assert client.get('/api/admin/finance?period=bad', headers=h).status_code == 400


def test_admin_user_page_and_account_details_are_separate_and_private(client):
    assert client.get('/api/me', headers=signed(43, username='sample')).status_code == 200
    page = client.get('/admin/user/43')
    assert page.status_code == 200
    assert b'data-admin-user="43"' in page.data
    assert b'admin-console-ui.js' in page.data
    assert client.get('/api/admin/user/43', headers=signed(43)).status_code == 403
    info = client.get('/api/admin/user/43', headers=signed(42))
    assert info.status_code == 200, info.json
    assert info.json['user']['id'] == 43
    assert info.json['user']['username'] == 'sample'
    assert info.json['user']['gifts'] == 0
    assert info.json['deposits'] == [] and info.json['withdrawals'] == []


def test_mode_management_is_authenticated_and_changes_actual_game_access(client):
    admin, member = signed(42), signed(43)
    assert client.get('/api/me', headers=member).status_code == 200
    assert client.get('/api/site/modes').json['modes'] == {
        'craft': True, 'arena': True, 'staking': True, 'upgrade': True
    }
    assert client.post('/api/admin/modes',headers=member,json={
        'mode':'craft','enabled':False,'confirm':'SET_MODE'}).status_code == 403
    assert client.post('/api/admin/modes',headers=admin,json={
        'mode':'craft','enabled':False,'confirm':'SET_MODE'}).status_code == 200
    assert client.get('/api/site/modes').json['modes']['craft'] is False
    blocked = client.get('/api/craft/targets',headers=member)
    assert blocked.status_code == 503 and blocked.json['mode_disabled'] == 'craft'
    assert client.get('/api/me',headers=member).status_code == 200
    assert client.get('/api/craft/targets',headers=admin).status_code != 503
    assert client.post('/api/admin/modes',headers=admin,json={
        'mode':'craft','enabled':True,'confirm':'SET_MODE'}).status_code == 200
    assert client.get('/api/craft/targets',headers=member).status_code != 503


def test_liquid_glass_admin_and_maintenance_assets_exist():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    html = (root/'templates/admin.html').read_text(encoding='utf-8')
    app = (root/'templates/index.html').read_text(encoding='utf-8')
    css = (root/'static/admin-glass-v2.css').read_text(encoding='utf-8')
    maintenance = (root/'static/site-maintenance.css').read_text(encoding='utf-8')
    frontend = (root/'static/admin-page.js').read_text(encoding='utf-8')
    assert 'admin-console-ui.js' in html
    assert 'admin-glass-v2.css' in html
    assert 'site-maintenance.css' in app
    assert 'crafter-maintenance-gear' in maintenance
    assert 'backdrop-filter:blur' in css
    assert 'admin-finance' not in frontend or 'finance:' in frontend
    assert 'maintenance:' in frontend
    assert "openAdminUserPage" in (root/'static/admin-console-ui.js').read_text(encoding='utf-8')
