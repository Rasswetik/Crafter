import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from test_app import client, signed
from test_resale import prepare_sale, change_listing


@pytest.fixture(autouse=True)
def notifications(monkeypatch):
    calls = []
    monkeypatch.setattr('telegram_bot.sale_sticker', lambda gift: b'animated-sticker')
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload, **kw: calls.append((method,payload,kw)))
    return calls


def get_balance(client, uid):
    return client.get('/api/me', headers=signed(uid)).json['balance']


def create(client, uid=43, **kwargs):
    data = {'price':'5.00', 'request_id':'offer-1', **kwargs}
    return client.post('/api/offers', headers=signed(uid), json=data)


def action(client, offer, uid, verb, **kwargs):
    return client.post('/api/offers/' + offer + '/action', headers=signed(uid), json={'action':verb, **kwargs})


def test_offer_fee_refunds_and_acceptance(client, notifications):
    gift = prepare_sale(client)
    assert change_listing(client, 'sell', '10.00').status_code == 200
    lot, = client.get('/api/market?source=crafter', headers=signed(43)).json['gifts']
    lot_id = lot['id']
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings VALUES('tonconnect',?)", (json.dumps({'gram_per_ton':'2'}),))
    offer = create(client, lot_id=lot_id).json['offer']
    assert offer['fee'] == '0.020000000'
    assert create(client, lot_id=lot_id).json['offer']['id'] == offer['id']
    assert create(client, lot_id=lot_id, price='6.00').status_code == 409
    assert get_balance(client, 43) == '14.980000000'
    assert action(client, offer['id'], 44, 'accept').status_code == 404
    assert action(client, offer['id'], 43, 'decline').status_code == 403
    assert action(client, offer['id'], 42, 'decline').status_code == 200
    assert get_balance(client, 43) == '19.980000000'
    offer = create(client, lot_id=lot_id, request_id='second').json['offer']
    assert action(client, offer['id'], 43, 'withdraw').status_code == 200
    assert get_balance(client, 43) == '19.960000000'
    offer = create(client, lot_id=lot_id, request_id='third').json['offer']
    assert action(client, offer['id'], 42, 'accept').status_code == 200
    assert action(client, offer['id'], 42, 'accept').status_code == 409
    assert get_balance(client, 42) == '4.80'
    assert get_balance(client, 43) == '14.940000000'
    # Completed offers vanish from active inboxes, but their accounting stays recorded.
    assert client.get('/api/offers', headers=signed(43)).json['placed'] == []
    assert client.get('/api/offers', headers=signed(42)).json['received'] == []
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert db.execute("SELECT status FROM crafter_offers WHERE id=?", (offer['id'],)).fetchone()[0] == 'accepted'
    acquired, = client.get('/api/inventory', headers=signed(43)).json['gifts']
    assert acquired['id'] == gift['id'] and acquired['number'] == gift['number']
    assert [entry[0] for entry in notifications] == ['sendMessage','sendSticker']
    assert all(entry[1]['chat_id'] == 42 for entry in notifications)
    assert notifications[1][2]['sticker'] == b'animated-sticker'


def test_regular_purchase_and_expiry_release_offer_reservations(client):
    prepare_sale(client)
    assert change_listing(client, 'sell', '10.00').status_code == 200
    lot, = client.get('/api/market?source=crafter', headers=signed(43)).json['gifts']
    offer = create(client, lot_id=lot['id'], expiry='day').json['offer']
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('UPDATE crafter_offers SET expires_at=1 WHERE id=?', (offer['id'],))
    assert get_balance(client, 43) == '19.990000000'
    assert client.get('/api/offers', headers=signed(43)).json['placed'] == []
    offer = create(client, lot_id=lot['id'], request_id='again').json['offer']
    assert client.post('/api/resale/buy', headers=signed(44), json={
        'id':lot['id'], 'request_id':'regular', 'expected_price':'10'}).status_code == 200
    assert get_balance(client, 43) == '19.980000000'
    listing = client.get('/api/offers', headers=signed(43)).json['placed']
    assert listing == []


def test_collection_offer_partial_fill_and_withdraw(client):
    gift = prepare_sale(client)
    offer = create(client, collection='Snoop Dogg', model='Emerald', quantity=2).json['offer']
    display = client.get('/api/market/offers?collection=Snoop%20Dogg&model=Emerald', headers=signed(42)).json
    assert display['best']['quantity'] == 2 and display['best']['executable']
    assert action(client, offer['id'], 42, 'accept', gift_id=gift['id']).status_code == 200
    assert client.get('/api/offers', headers=signed(43)).json['collections'][0]['remaining'] == 1
    assert action(client, offer['id'], 43, 'withdraw').status_code == 200
    assert get_balance(client, 43) == '14.990000000'
    assert get_balance(client, 42) == '4.80'


def test_concurrent_offer_and_purchase_settle_at_most_once(client):
    prepare_sale(client)
    assert change_listing(client, 'sell', '10.00').status_code == 200
    lot, = client.get('/api/market?source=crafter', headers=signed(43)).json['gifts']
    offer = create(client, lot_id=lot['id']).json['offer']
    barrier = Barrier(2)

    def run(kind):
        with client.application.test_client() as other:
            barrier.wait(timeout=5)
            if kind == 'offer':
                return action(other, offer['id'], 42, 'accept').status_code
            return other.post('/api/resale/buy', headers=signed(44), json={
                'id':lot['id'], 'request_id':'race', 'expected_price':'10'}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(run, ('offer','buy'))) == [200,409]
    assert get_balance(client, 42) in ('4.80','9.60')
