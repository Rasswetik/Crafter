import json
import sqlite3

import relayer_transfer
from test_app import client, signed


def seed(client):
    for uid in (42, 43):
        client.get('/api/me', headers=signed(uid))
    keep = {'id': 'telegram-snoop-7', 'name': 'Snoop Dogg', 'origin': 'telegram-deposit', 'price': '0',
            'telegram_slug': 'snoop-7'}
    gone = {'id': 'telegram-old-1', 'name': 'Old', 'origin': 'telegram-deposit', 'price': '0', 'telegram_slug': 'old-1'}
    demo = {'id': 'demo-x', 'name': 'Snoop Dogg', 'origin': 'admin-grant', 'price': '5', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for g in (keep, demo):
            db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (g['id'], json.dumps(g)))
        # receipts: snoop-7 is still on the relayer, old-1 was withdrawn long ago
        for slug, g in (('snoop-7', keep), ('old-1', gone)):
            db.execute("INSERT INTO telegram_gift_receipts VALUES (?,?,?,?,?,?,?)",
                       (slug, 43, 43, 'credited', json.dumps(g), 1, 1))
        db.execute("UPDATE demo_accounts SET balance='100' WHERE user_id=43")
        db.execute("INSERT INTO wallet_balances VALUES (43,'mainnet','12.5')")
        db.execute("INSERT INTO history VALUES ('h1',43,'buy','{}',1)")
        db.execute("INSERT INTO staking_accounts VALUES (43, 1)")
        db.execute("INSERT INTO connected_wallets VALUES (43, 'EQwallet', 'mainnet', 1)") if False else None


def relayer(client, monkeypatch, slugs):
    monkeypatch.setitem(client.application.extensions, 'crafter_relayer_credentials', lambda: (1, 'h', 's', 777))

    async def held(*a, **k):
        return set(slugs)
    monkeypatch.setattr(relayer_transfer, 'held_slugs', held)


def test_reset_wipes_everything_and_restores_relayer_gifts(client, monkeypatch):
    seed(client)
    relayer(client, monkeypatch, {'snoop-7'})
    preview = client.get('/api/admin/data-reset', headers=signed()).json
    assert preview['relayer_checked'] is True and preview['gifts_to_restore'] == 1
    body = {'confirm': 'RESET_ALL_PLAYER_DATA'}
    assert client.post('/api/admin/data-reset', headers=signed(43), json=body).status_code == 403
    assert client.post('/api/admin/data-reset', headers=signed(), json={}).status_code == 400
    r = client.post('/api/admin/data-reset', headers=signed(), json=body)
    assert r.status_code == 200 and r.json['restored_gifts'] == 1
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert [x[0] for x in db.execute("SELECT nft_id FROM inventory")] == ['telegram-snoop-7']   # old-1 not restored
        assert db.execute("SELECT balance FROM demo_accounts WHERE user_id=43").fetchone()[0] == '0'
        assert db.execute("SELECT count(*) FROM history").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM wallet_balances").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM staking_accounts").fetchone()[0] == 0      # activate staking again
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] >= 2                  # accounts stay
        assert db.execute("SELECT count(*) FROM telegram_gift_receipts").fetchone()[0] == 2  # no double credit later


def test_reset_without_relayer_keeps_deposited_gifts(client):
    seed(client)
    r = client.post('/api/admin/data-reset', headers=signed(), json={'confirm': 'RESET_ALL_PLAYER_DATA'})
    assert r.status_code == 200 and r.json['relayer_checked'] is False
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert [x[0] for x in db.execute("SELECT nft_id FROM inventory")] == ['telegram-snoop-7']
        assert db.execute("SELECT balance FROM demo_accounts WHERE user_id=43").fetchone()[0] == '0'


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
