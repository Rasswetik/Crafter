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
        conn.execute("INSERT INTO wallet_balances VALUES (50,'mainnet','50.00')")
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
        assert db.execute("SELECT gram FROM wallet_balances WHERE user_id=50 AND network='mainnet'").fetchone() == ('42.00',)
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
        assert db.execute('SELECT user_id FROM inventory WHERE nft_id=?', (stake['id'],)).fetchone() == (-930070002,)
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


def test_gift_upgrade_win_purchases_exact_craft_market_lot(client, monkeypatch):
    seller_gift, target = setup_upgrade(client)
    stake = {**DEMO_GIFTS[0], 'id': 'player-upgrade-input', 'number': 999911,
             'price': '2.00', 'price_unit': 'GRAM', 'origin': 'local-purchase'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')",
                           (stake['id'], json.dumps(stake)))
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 0)
    quoted = quote(client, target['id'], 'gift', gift_id=stake['id'])
    assert quoted.status_code == 200, quoted.json
    assert quoted.json['chance'] == 20.0
    assert quoted.json['playable'] is True
    request_body = {'request_id': 'gift-winning-spin-1', 'quote_id': quoted.json['quote_id']}
    played = client.post('/api/upgrade/play', headers=signed(43), json=request_body)
    assert played.status_code == 200, played.json
    assert played.json['success'] is True
    assert played.json['gift']['id'] == seller_gift['id']
    assert played.json['site_bank_gift_id'] == stake['id']
    assert client.post('/api/upgrade/play', headers=signed(43), json=request_body).json == played.json
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        assert connection.execute('SELECT user_id,status FROM inventory WHERE nft_id=?',
                                  (stake['id'],)).fetchone() == (-930070002, 'unlisted')
        assert connection.execute('SELECT user_id,status FROM inventory WHERE nft_id=?',
                                  (seller_gift['id'],)).fetchone() == (43, 'unlisted')
        assert connection.execute('SELECT balance FROM demo_accounts WHERE user_id=42').fetchone() == ('9.60',)
        assert connection.execute('SELECT balance FROM demo_accounts WHERE user_id=50').fetchone() == ('40.00',)
        assert connection.execute('SELECT COUNT(*) FROM upgrade_rounds').fetchone() == (1,)


def test_gift_upgrades_keep_stake_when_target_changes(client):
    _, target = setup_upgrade(client)
    stake = {**DEMO_GIFTS[0], 'id': 'safe-original-gift', 'number': 888188,
             'price': '3.00', 'price_unit': 'GRAM', 'origin': 'local-purchase'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')",
                           (stake['id'], json.dumps(stake)))
    quoted = quote(client, target['id'], 'gift', gift_id=stake['id'])
    assert quoted.status_code == 200, quoted.json
    edit = client.post('/api/resale/listings', headers=signed(42), json={
        'action': 'edit', 'items': [{'id': 'upgrade-sale-gift', 'price': '12.00'}]})
    assert edit.status_code == 200
    response = client.post('/api/upgrade/play', headers=signed(43), json={
        'quote_id': quoted.json['quote_id'], 'request_id': 'safe-original-gift-req'})
    assert response.status_code == 409
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        assert connection.execute('SELECT user_id,status FROM inventory WHERE nft_id=?',
                                  (stake['id'],)).fetchone() == (43, 'unlisted')


def test_upgrade_layout_requires_wheel_and_two_modal_selections():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    js = (root / 'static/upgrade.js').read_text(encoding='utf-8')
    css = (root / 'static/upgrade.css').read_text(encoding='utf-8')
    page = (root / 'templates/index.html').read_text(encoding='utf-8')
    assert 'ug-wheel-region' in js
    assert 'ug-selection-row' in js
    assert 'ugOpenStakePicker()' in js
    assert 'ugOpenTargetPicker()' in js
    assert 'ugChooseCollection(' in js and 'ugSelectLot(' in js
    assert "stake_mode: 'gift'" in js
    assert 'ug-picker-grid' in js and 'ug-slot-art' in css
    assert 'ug-modes' not in js
    assert 'winter-currency-balance' in page and 'class="balance"' in page
    assert 'wheel-pickers-20261107-v2' in page
