import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from app import DEMO_GIFTS
from test_app import client, signed


def prepare_sale(client):
    for uid in (42, 43, 44):
        assert client.get('/api/me', headers=signed(uid)).status_code == 200
    gift = {**DEMO_GIFTS[0], 'id': 'trade-gift', 'origin': 'local-purchase', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (42, ?, ?, 'unlisted')", (gift['id'], json.dumps(gift)))
        db.execute("UPDATE demo_accounts SET balance='20.00' WHERE user_id IN (43,44)")
        db.execute("INSERT INTO wallet_balances VALUES (43,'mainnet','15.00')")
    return gift


def change_listing(client, action, price=None, uid=42):
    items = [{'id': 'trade-gift', 'price': price}]
    return client.post('/api/resale/listings', headers=signed(uid), json={'action': action, 'items': items})


def test_resale_edit_withdraw_and_settle(client):
    gift = prepare_sale(client)
    assert change_listing(client, 'sell', '5.001').status_code == 400
    assert change_listing(client, 'sell', '5', uid=43).status_code == 409
    assert change_listing(client, 'sell', '5').status_code == 200
    market_url = '/api/market?source=crafter'
    own_lot, = client.get(market_url, headers=signed(42)).json['gifts']
    assert own_lot['own_listing']
    lot, = client.get(market_url, headers=signed(43)).json['gifts']
    assert not lot['own_listing']
    assert 'seller_id' not in lot
    assert change_listing(client, 'edit', '12,50').status_code == 200
    assert client.get(market_url + '&min_price=13', headers=signed(43)).json['gifts'] == []
    payload = {'id': lot['id'], 'expected_price': '5.00', 'request_id': 'stable-buy'}
    assert client.post('/api/resale/buy', headers=signed(43), json=payload).status_code == 409
    assert change_listing(client, 'unlist').status_code == 200
    assert client.get(market_url, headers=signed(43)).json['gifts'] == []
    unlisted, = client.get('/api/inventory', headers=signed(42)).json['gifts']
    assert unlisted['status'] == 'unlisted'
    assert unlisted['price'] == gift['price']
    assert change_listing(client, 'sell', '12.50').status_code == 200
    lot, = client.get(market_url, headers=signed(43)).json['gifts']
    payload.update(id=lot['id'], expected_price='12.50')
    assert client.post('/api/resale/buy', headers=signed(42), json=payload).status_code == 409
    purchase = client.post('/api/resale/buy', headers=signed(43), json=payload)
    assert purchase.status_code == 200
    assert purchase.json['fee'] == '0.50'
    assert purchase.json['balance'] == '7.50'
    assert client.post('/api/resale/buy', headers=signed(43), json=payload).json == purchase.json
    assert client.get(market_url, headers=signed(44)).json['gifts'] == []
    assert client.get('/api/inventory', headers=signed(42)).json['gifts'] == []
    acquired, = client.get('/api/inventory', headers=signed(43)).json['gifts']
    assert (acquired['id'], acquired['number'], acquired['status']) == (gift['id'], gift['number'], 'unlisted')
    seller = client.get('/api/me', headers=signed(42)).json
    buyer = client.get('/api/me', headers=signed(43)).json
    assert (seller['balance'], seller['sold'], buyer['inventory_value']) == ('12.00', 1, gift['price'])
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert db.execute('SELECT gram FROM wallet_balances WHERE user_id=43').fetchone() == ('7.50',)
        assert db.execute('SELECT gram FROM wallet_balances WHERE user_id=42').fetchone() is None


def test_only_one_buyer_can_take_a_resale_lot(client):
    prepare_sale(client)
    assert change_listing(client, 'sell', '10.00').status_code == 200
    lot, = client.get('/api/market?source=crafter', headers=signed()).json['gifts']
    barrier = Barrier(2)

    def buy(uid):
        with client.application.test_client() as other:
            barrier.wait(timeout=5)
            response = other.post('/api/resale/buy', headers=signed(uid),
                                  json={'id': lot['id'], 'expected_price': '10', 'request_id': 'race'})
            return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(buy, (43, 44)))
    assert statuses == [200, 409]
    assert client.get('/api/me', headers=signed(42)).json['balance'] == '9.60'
