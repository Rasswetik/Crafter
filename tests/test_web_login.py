import sqlite3
import time

from test_app import client, signed


def start(client):
    client.application.config['BOT_USERNAME'] = 'crafter_app'
    r = client.post('/api/web-login/start', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'})
    assert r.status_code == 200, r.json
    return r.json


def test_full_flow_and_session_authenticates_the_user(client):
    client.get('/api/me', headers=signed(43))
    s = start(client)
    assert s['link'] == 'https://t.me/crafter_app?startapp=login_' + s['token']
    assert len('login_' + s['token']) <= 64
    # still waiting for the Telegram confirmation
    assert client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).json == {'status': 'pending'}
    # the Mini App sees which device is asking, then confirms (Telegram-authenticated only)
    info = client.get('/api/web-login/info?token=' + s['token'], headers=signed(43))
    assert info.status_code == 200 and 'Chrome' in info.json['device'] and 'Windows' in info.json['device']
    assert client.get('/api/web-login/info?token=' + s['token']).status_code == 401
    confirmed = client.post('/api/web-login/confirm', headers=signed(43), json={'token': s['token']})
    assert confirmed.status_code == 200 and confirmed.json['code']
    # the starting browser claims the session once
    done = client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']})
    assert done.status_code == 200 and done.json['status'] == 'ok'
    session = done.json['session']
    assert client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).status_code == 409
    me = client.get('/api/me', headers={'X-Crafter-Web-Session': session})
    assert me.status_code == 200 and me.json['user']['id'] == 43
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        stored = [r[0] for r in db.execute('SELECT token_hash FROM web_sessions')]
    assert session not in stored and len(stored) == 1                       # only the hash is stored


def test_return_link_code_also_works_and_wrong_proof_is_rejected(client):
    client.get('/api/me', headers=signed(43))
    s = start(client)
    code = client.post('/api/web-login/confirm', headers=signed(43), json={'token': s['token']}).json['code']
    assert client.post('/api/web-login/claim', json={'token': s['token'], 'secret': 'x' * 40}).status_code == 403
    ok = client.post('/api/web-login/claim', json={'token': s['token'], 'code': code})
    assert ok.status_code == 200 and ok.json['session']
    # the original tab arrives second and is told the login is already used
    assert client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).status_code == 409


def test_web_session_cannot_confirm_other_logins_and_expires_and_logs_out(client):
    client.get('/api/me', headers=signed(43))
    s = start(client)
    client.post('/api/web-login/confirm', headers=signed(43), json={'token': s['token']})
    session = client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).json['session']
    other = start(client)
    # a signed-in website session must not be able to approve a new login
    r = client.post('/api/web-login/confirm', headers={'X-Crafter-Web-Session': session}, json={'token': other['token']})
    assert r.status_code == 403
    assert client.post('/api/web-login/logout', headers={'X-Crafter-Web-Session': session}).status_code == 200
    assert client.get('/api/me', headers={'X-Crafter-Web-Session': session}).status_code == 401
    assert client.get('/api/me', headers={'X-Crafter-Web-Session': 'z' * 43}).status_code == 401


def test_expired_request_is_gone(client):
    client.get('/api/me', headers=signed(43))
    s = start(client)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('UPDATE web_login_requests SET expires=?', (int(time.time()) - 5,))
    assert client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).status_code == 410
    assert client.post('/api/web-login/confirm', headers=signed(43), json={'token': s['token']}).status_code == 410


def test_banned_user_cannot_use_a_web_session(client):
    client.get('/api/me', headers=signed(43))
    s = start(client)
    client.post('/api/web-login/confirm', headers=signed(43), json={'token': s['token']})
    session = client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).json['session']
    assert client.get('/api/me', headers={'X-Crafter-Web-Session': session}).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO user_bans(user_id,reason,actor,created) VALUES (43,'test',42,1)")
    assert client.get('/api/me', headers={'X-Crafter-Web-Session': session}).status_code == 403


def test_start_requires_a_configured_bot(client):
    client.application.config['BOT_USERNAME'] = ''
    assert client.post('/api/web-login/start').status_code == 503


def _session_for(client, uid):
    client.get('/api/me', headers=signed(uid))
    s = start(client)
    client.post('/api/web-login/confirm', headers=signed(uid), json={'token': s['token']})
    return client.post('/api/web-login/claim', json={'token': s['token'], 'secret': s['secret']}).json['session']


def test_maintenance_sign_in_works_and_only_admins_pass(client):
    admin_session = _session_for(client, 42)               # 42 is the administrator in the test app
    member_session = _session_for(client, 43)
    assert client.post('/api/admin/maintenance', headers=signed(42), json={
        'enabled': True, 'confirm': 'ENABLE_MAINTENANCE', 'message': 'Работы'}).status_code == 200
    # signing in is still possible during maintenance for everybody
    fresh = start(client)
    assert fresh['token']
    assert client.post('/api/web-login/claim', json={'token': fresh['token'], 'secret': fresh['secret']}).json == {'status': 'pending'}
    # a signed-in administrator passes the maintenance gate, a regular member does not
    assert client.get('/api/me', headers={'X-Crafter-Web-Session': admin_session}).status_code == 200
    blocked = client.get('/api/me', headers={'X-Crafter-Web-Session': member_session})
    assert blocked.status_code == 503 and blocked.json['maintenance']
    assert client.get('/api/me').status_code == 503                      # anonymous visitor: sign-in screen
    access = client.get('/api/site/maintenance/access', headers={'X-Crafter-Web-Session': admin_session})
    assert access.status_code == 200 and access.json['is_admin'] is True
    assert client.post('/api/web-login/logout', headers={'X-Crafter-Web-Session': admin_session}).status_code == 200
