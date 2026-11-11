import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from app import DEMO_GIFTS
from test_app import client, signed


@pytest.fixture(autouse=True)
def telegram_messages(monkeypatch):
    calls = []
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload: calls.append((method, payload)))
    monkeypatch.setattr('telegram_bot.sale_sticker', lambda gift: None)
    return calls


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


def test_resale_edit_withdraw_and_settle(client, telegram_messages):
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
    assert len(telegram_messages) == 2
    seller_message = next(message for method,message in telegram_messages
                          if method == 'sendMessage' and message['chat_id'] == 42)
    buyer_message = next(message for method,message in telegram_messages
                         if method == 'sendMessage' and message['chat_id'] == 43)
    assert 'Вы получили: 12 GRAM' in seller_message['text']
    assert 'Вы успешно купили' in buyer_message['text']
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


def test_internal_floor_and_activity_open_the_current_listing(client):
    gift = prepare_sale(client)
    second = {**gift, 'id': 'second-gift', 'number': gift['number'] + 1}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (42, ?, ?, 'unlisted')", (second['id'], json.dumps(second)))
    assert change_listing(client, 'sell', '10.00').status_code == 200
    assert client.post('/api/resale/listings', headers=signed(42), json={
        'action': 'sell', 'items': [{'id': second['id'], 'price': '7.00'}]}).status_code == 200

    headers = signed(43)
    market = '/api/market?source=crafter&collection_id=snoop'
    lots = client.get(market, headers=headers).json
    assert [lot['price'] for lot in lots['gifts']] == ['7.00', '10.00']
    assert lots['collection_floor_gram'] == '7.00'
    assert all(lot['crafter_floor_gram'] == '7.00' for lot in lots['gifts'])
    lot_id = lots['gifts'][1]['id']
    assert change_listing(client, 'edit', '6.00').status_code == 200
    activity = client.get('/api/market/activity?types=sell', headers=headers).json['items']
    entry = next(item for item in activity if item['gift']['number'] == gift['number'])
    assert entry['listing_id'] == lot_id
    listing = client.get('/api/resale/listings/' + lot_id, headers=headers)
    assert listing.json['gift']['price'] == '6.00'
    assert client.get(market, headers=headers).json['collection_floor_gram'] == '6.00'
    assert change_listing(client, 'unlist').status_code == 200
    assert client.get('/api/resale/listings/' + lot_id, headers=headers).status_code == 404
    assert client.get(market, headers=headers).json['collection_floor_gram'] == '7.00'


def test_offer_card_prefers_exact_model_then_falls_back_to_collection(client):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.executemany("INSERT INTO crafter_offer_quotes VALUES (?,?,?,?,?,?,?,?)", [
            ('general', 'snoopdogg', '', '', '', '12.00', 2, None),
            ('model', 'snoopdogg', 'Emerald', '', '', '10.00', 1, None),
            ('expired', 'snoopdogg', 'Ruby', '', '', '20.00', 1, 1),
        ])
    headers = signed()
    url = '/api/market/offers?collection=Snoop%20Dogg'
    # Legacy price quotes are not backed by any buyer balance: they must not
    # masquerade as executable offers or display a fake Sell Now button.
    assert client.get(url, headers=headers).json['best'] is None
    assert client.get(url + '&model=Emerald', headers=headers).json['best'] is None
    assert client.get(url + '&model=Ruby', headers=headers).json['count'] == 0
    assert client.get('/api/market/offers?collection=Unknown', headers=headers).json['best'] is None
    assert client.get(url + ',Another', headers=headers).status_code == 400


def test_crafter_lucky_craft_transfers_prize_and_notifies_seller(client, monkeypatch, telegram_messages):
    gift = prepare_sale(client)
    material = {**gift, 'id': 'craft-material', 'number': 7001, 'price': '5.00'}
    gift.update(telegram_url='https://t.me/nft/snoopdogg-303022')
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('UPDATE inventory SET payload=? WHERE user_id=42 AND nft_id=?',
                   (json.dumps(gift), gift['id']))
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')",
                   (material['id'], json.dumps(material)))
    assert change_listing(client, 'sell', '10.00').status_code == 200
    buyer = signed(43)
    lot, = client.get('/api/market?source=crafter', headers=buyer).json['gifts']
    quote_payload = {'listing_id': lot['id'], 'target_id': gift['collection_id'], 'gift_ids': [material['id']]}
    assert client.post('/api/craft/quote', headers=signed(42),
                       json={**quote_payload, 'gift_ids': [gift['id']]}).status_code == 409
    quote = client.post('/api/craft/quote', headers=buyer, json=quote_payload)
    assert quote.status_code == 200
    assert (quote.json['price_unit'], quote.json['chance']) == ('GRAM', 47.5)
    assert change_listing(client, 'edit', '12.50').status_code == 200
    request = {'quote_id': quote.json['quote_id'], 'request_id': 'lucky-1'}
    assert client.post('/api/craft', headers=buyer, json=request).status_code == 409
    assert len(client.get('/api/inventory', headers=buyer).json['gifts']) == 1
    request['quote_id'] = client.post('/api/craft/quote', headers=buyer, json=quote_payload).json['quote_id']
    monkeypatch.setattr('app.secrets.randbelow', lambda _: 0)
    result = client.post('/api/craft', headers=buyer, json=request)
    assert result.json['success'] and result.json['listing_id'] == lot['id']
    assert client.post('/api/craft', headers=buyer, json=request).json == result.json
    owned, = client.get('/api/inventory', headers=buyer).json['gifts']
    assert owned['id'] == gift['id'] and owned['number'] == gift['number']
    assert client.get('/api/me', headers=buyer).json['balance'] == '20.00'
    assert client.get('/api/me', headers=signed(42)).json['balance'] == '12.00'
    assert client.get('/api/resale/listings/' + lot['id'], headers=buyer).status_code == 404
    (method, message), = telegram_messages
    assert method == 'sendMessage' and message['chat_id'] == 42
    assert '<a href="https://t.me/nft/snoopdogg-303022">Snoop Dogg #303022</a> продан' in message['text']
    assert 'Вы получили: 12 GRAM' in message['text']
