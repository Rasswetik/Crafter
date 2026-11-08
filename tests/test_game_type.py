import json
import sqlite3

from test_app import client, signed


def seed(client):
    for uid in (42, 43):
        client.get('/api/me', headers=signed(uid))
    keep = {'id': 'telegram-keep', 'name': 'Snoop Dogg', 'origin': 'telegram-deposit', 'price': '0'}
    demo = {'id': 'demo-x', 'name': 'Snoop Dogg', 'origin': 'admin-grant', 'price': '5', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (keep['id'], json.dumps(keep)))
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (demo['id'], json.dumps(demo)))
        db.execute("UPDATE demo_accounts SET balance='100' WHERE user_id=43")
        db.execute("INSERT INTO wallet_balances VALUES (43,'mainnet','12.5')")
        db.execute("INSERT INTO history VALUES ('h1',43,'buy','{}',1)")
        db.execute("INSERT INTO staking_accounts VALUES (43, 1)")


def test_reset_keeps_deposited_nfts_and_verified_funds(client):
    seed(client)
    body = {'confirm': 'RESET_ALL_STATS'}
    assert client.post('/api/admin/game-type/reset', headers=signed(43), json=body).status_code == 403
    assert client.post('/api/admin/game-type/reset', headers=signed(), json={}).status_code == 400
    r = client.post('/api/admin/game-type/reset', headers=signed(), json=body)
    assert r.status_code == 200 and r.json['removed']['inventory'] == 1
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert [x[0] for x in db.execute("SELECT nft_id FROM inventory WHERE user_id=43")] == ['telegram-keep']
        assert db.execute("SELECT balance FROM demo_accounts WHERE user_id=43").fetchone()[0] == '12.5'
        assert db.execute("SELECT count(*) FROM history").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM staking_accounts").fetchone()[0] == 0   # staking must be re-activated


def test_switch_to_real_is_persistent_and_admin_only(client):
    seed(client)
    app = client.application
    app.config['DEMO_MODE'] = True
    assert client.post('/api/admin/game-type/real', headers=signed(43), json={'confirm': 'SWITCH_TO_REAL'}).status_code == 403
    r = client.post('/api/admin/game-type/real', headers=signed(), json={'confirm': 'SWITCH_TO_REAL'})
    assert r.json['type'] == 'real' and app.config['DEMO_MODE'] is False
    from app import create_app
    again = create_app({'TESTING': True, 'DATABASE': app.config['DATABASE'], 'BOT_TOKEN': 'test-token',
                        'ADMIN_IDS': {42}, 'DEMO_MODE': True})
    assert again.config['DEMO_MODE'] is False                 # persisted choice survives a restart
