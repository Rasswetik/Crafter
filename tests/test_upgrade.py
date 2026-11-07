"""Upgrade uses a paid, atomic internal GRAM bank. Native TON is not relabeled."""
import json
import sqlite3

import pytest

from app import DEMO_GIFTS
from test_app import client, signed


@pytest.fixture(autouse=True)
def no_telegram_messages(monkeypatch):
    monkeypatch.setattr('telegram_bot.bot_api', lambda *args, **kwargs: {})
    monkeypatch.setattr('telegram_bot.sale_sticker', lambda gift: None)


def setup_upgrade(client, *, bank=True):
    for uid in (42, 43, 44, 50):
        assert client.get('/api/me', headers=signed(uid)).status_code == 200
    if bank:
        client.application.config['UPGRADE_BANK_USER_ID'] = 50
    gift = {**DEMO_GIFTS[0], 'id': 'upgrade-sale-gift', 'number': 909091,
            'price': '10.00', 'price_unit': 'GRAM', 'origin': 'local-purchase'}
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        conn.execute("INSERT INTO inventory VALUES (42, ?, ?, 'unlisted')",
                     (gift['id'], json.dumps(gift)))
        conn.execute("UPDATE demo_accounts SET balance='5.00' WHERE user_id=43")
        conn.execute("UPDATE demo_accounts SET balance='50.00' WHERE user_id=50")
    sale = client.post('/api/resale/listings', headers=signed(42), json={
        'action': 'sell', 'items': [{'id': gift['id'], 'price': '10.00'}]})
    assert sale.status_code == 200, sale.json
    lot = client.get('/api/market?source=crafter', headers=signed(43)).json['gifts'][0]
    return gift, lot


def quote(client, lot_id, mode='balance', **extra):
    return client.post('/api/upgrade/quote', headers=signed(43), json={
        'lot_id': lot_id, 'stake_mode': mode, 'amount': '2.00', **extra})


def test_upgrade_collection_targets_are_live_crafter_listings(client):
    _, lot = setup_upgrade(client)
    collections = client.get('/api/upgrade/collections', headers=signed(43)).json['collections']
    assert len(collections) == 1
    assert collections[0]['floor'] == '10.00'
    assert collections[0]['count'] == 1
    response = client.get('/api/upgrade/lots?collection=' + collections[0]['key'], headers=signed(43))
    assert response.status_code == 200
    assert response.json['lots'][0]['id'] == lot['id']
    assert response.json['lots'][0]['price_unit'] == 'GRAM'
    assert client.get('/api/upgrade/collections', headers=signed(42)).json['collections'] == []


def test_upgrade_balance_win_is_paid_by_bank_and_idempotent(client, monkeypatch):
    gift, lot = setup_upgrade(client)
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 0)
    q = quote(client, lot['id'])
    assert q.status_code == 200, q.json
    assert q.json['chance'] == 20.0
    payload = {'request_id': 'spin-test-1234', 'quote_id': q.json['quote_id']}
    played = client.post('/api/upgrade/play', headers=signed(43), json=payload)
    assert played.status_code == 200, played.json
    assert played.json['success']
    assert played.json['gift']['id'] == gift['id']
    assert client.post('/api/upgrade/play', headers=signed(43), json=payload).json == played.json
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert db.execute('SELECT balance FROM demo_accounts WHERE user_id=43').fetchone()[0] == '3.00'
        assert db.execute('SELECT balance FROM demo_accounts WHERE user_id=50').fetchone()[0] == '42.00'
        assert db.execute('SELECT balance FROM demo_accounts WHERE user_id=42').fetchone()[0] == '9.60'
        row = db.execute("SELECT user_id,status FROM inventory WHERE nft_id=?", (gift['id'],)).fetchone()
        assert row == (43, 'unlisted')
        assert db.execute('SELECT count(*) FROM upgrade_rounds').fetchone()[0] == 1


def test_upgrade_gift_loss_transfers_real_stake_to_bank(client, monkeypatch):
    _, target = setup_upgrade(client)
    stake = {**DEMO_GIFTS[1], 'id': 'upgrade-stake-gift', 'number': 99933,
             'price': '2.00', 'price_unit': 'GRAM', 'origin': 'local-purchase'}
    appraisal = {**DEMO_GIFTS[1], 'id': 'upgrade-appraisal', 'number': 909038,
                 'price': '7.00', 'price_unit': 'GRAM', 'origin': 'local-purchase'}
    with sqlite3.connect(client.application.config['DATABASE']) as conn:
        conn.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')",
                     (stake['id'], json.dumps(stake)))
        conn.execute("INSERT INTO inventory VALUES (44, ?, ?, 'unlisted')",
                     (appraisal['id'], json.dumps(appraisal)))
    assert client.post('/api/resale/listings', headers=signed(44), json={
        'action': 'sell', 'items': [{'id': appraisal['id'], 'price': '7.00'}]}).status_code == 200
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 9999)
    q = quote(client, target['id'], 'gift', gift_id=stake['id'])
    assert q.status_code == 200, q.json
    assert q.json['chance'] == 20.0
    played = client.post('/api/upgrade/play', headers=signed(43),
                         json={'request_id': 'gift-spin-loss', 'quote_id': q.json['quote_id']})
    assert played.status_code == 200, played.json
    assert not played.json['success']
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert db.execute('SELECT user_id FROM inventory WHERE nft_id=?', (stake['id'],)).fetchone() == (50,)
        assert db.execute('SELECT balance FROM demo_accounts WHERE user_id=50').fetchone() == ('50.00',)
        assert db.execute('SELECT balance FROM demo_accounts WHERE user_id=43').fetchone() == ('5.00',)


def test_upgrade_changed_lot_fails_without_spending(client):
    _, lot = setup_upgrade(client)
    q = quote(client, lot['id'])
    assert q.status_code == 200, q.json
    assert client.post('/api/resale/listings', headers=signed(42), json={
        'action': 'edit', 'items': [{'id': 'upgrade-sale-gift', 'price': '12.00'}]}).status_code == 200
    response = client.post('/api/upgrade/play', headers=signed(43), json={
        'request_id': 'changed-lot-req', 'quote_id': q.json['quote_id']})
    assert response.status_code == 409
    assert client.get('/api/me', headers=signed(43)).json['balance'] == '5.00'


def test_upgrade_disabled_bank_and_native_ton_are_honest(client):
    _, lot = setup_upgrade(client, bank=False)
    info = client.get('/api/upgrade/info', headers=signed(43)).json
    assert info['native_ton_enabled'] is False
    assert info['enabled'] is False
    assert quote(client, lot['id'], 'ton').status_code == 400
    q = quote(client, lot['id'])
    assert q.status_code == 200
    response = client.post('/api/upgrade/play', headers=signed(43), json={
        'request_id': 'bank-not-ready', 'quote_id': q.json['quote_id']})
    assert response.status_code == 503
    assert client.get('/api/me', headers=signed(43)).json['balance'] == '5.00'
