import json
import sqlite3

import pytest

import telegram_bot
from test_app import client, signed
from test_resale import change_listing, prepare_sale

BASE = '/api/partner/v1'


def issue(client, uid):
    with client.application.app_context():
        return client.application.extensions['crafter_partner_key'](uid)


def key_for(client, uid):
    client.get('/api/me', headers=signed(uid))
    return issue(client, uid)


def bearer(key, op=None):
    headers = {'Authorization': 'Bearer ' + key}
    if op:
        headers['Idempotency-Key'] = op
    return headers


@pytest.fixture(autouse=True)
def quiet_bot(monkeypatch):
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload, sticker=None: True)
    monkeypatch.setattr('telegram_bot.sale_sticker', lambda gift: None)


def test_key_format_and_rules(client):
    assert issue(client, 777) is None                                     # never opened the app
    key = key_for(client, 42)
    assert key.startswith('CRT/') and len(key) == 44 and key[4:].isalnum()
    assert key_for(client, 42) == key and key_for(client, 43) != key
    assert client.get(BASE + '/account').status_code == 401
    assert client.get(BASE + '/account', headers=bearer('CRT/nope')).status_code == 401
    assert client.get(BASE + '/account', headers={**bearer(key), 'Origin': 'https://evil.example'}).status_code == 403
    account = client.get(BASE + '/account', headers=bearer(key)).json
    assert account['account']['id'] == '42' and account['currency'] == 'GRAM' and 'balance_nano' in account


def test_rate_limit(client):
    key = key_for(client, 42)
    codes = [client.get(BASE + '/account', headers=bearer(key)).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30] == 429


def test_docs_and_openapi_are_public(client):
    page = client.get('/partner-api')
    assert page.status_code == 200 and 'Idempotency-Key' in page.get_data(as_text=True)
    spec = client.get('/partner-api.openapi.json').json
    assert spec['openapi'].startswith('3.') and '/buy' in spec['paths']


def test_trading_flow_with_idempotency(client):
    prepare_sale(client)
    seller, buyer = key_for(client, 42), key_for(client, 43)
    inventory = client.get(BASE + '/inventory', headers=bearer(seller)).json['gifts']
    assert inventory[0]['gift_id'] == 'trade-gift' and inventory[0]['status'] == 'unlisted'

    sell = client.post(BASE + '/sell', headers=bearer(seller, 'sell-op-0000000001'), json={'gift_id': 'trade-gift', 'price': '12.5'})
    assert sell.status_code == 200 and sell.json['result']['price_nano'] == '12500000000'
    assert client.post(BASE + '/sell', headers=bearer(seller), json={'gift_id': 'trade-gift', 'price': '1'}).json['code'] == 'idempotency_required'

    name = client.get(BASE + '/inventory', headers=bearer(seller)).json['gifts'][0]['name']
    lots = client.get(BASE + '/lots', query_string={'collection': name, 'source': 'crafter'}, headers=bearer(buyer)).json
    lot = next(x for x in lots['lots'] if x['source'] == 'crafter')
    assert lot['price'] == '12.5'
    assert client.get(BASE + '/lots', query_string={'collection': name, 'source': 'crafter'}, headers=bearer(seller)).json['total'] == 0

    too_low = client.post(BASE + '/buy', headers=bearer(buyer, 'buy-op-00000000001'), json={'lot_id': lot['lot_id'], 'max_price': '10'})
    assert too_low.status_code == 409 and too_low.json['result']['code'] == 'price_changed'

    body = {'lot_id': lot['lot_id'], 'max_price': '13'}
    bought = client.post(BASE + '/buy', headers=bearer(buyer, 'buy-op-00000000002'), json=body)
    assert bought.status_code == 200 and bought.json['status'] == 'done'
    again = client.post(BASE + '/buy', headers=bearer(buyer, 'buy-op-00000000002'), json=body)
    assert again.status_code == 200 and again.json['result'] == bought.json['result'] and again.json['repeat']
    conflict = client.post(BASE + '/buy', headers=bearer(buyer, 'buy-op-00000000002'), json={**body, 'max_price': '14'})
    assert conflict.status_code == 409 and conflict.json['code'] == 'conflict'
    op = client.get(BASE + '/operations/buy-op-00000000002', headers=bearer(buyer)).json
    assert op['status'] == 'done'
    assert client.get(BASE + '/operations/missing-operation-id-1', headers=bearer(buyer)).status_code == 404

    mine = client.get(BASE + '/inventory', headers=bearer(buyer)).json['gifts']
    assert [x['gift_id'] for x in mine] == ['trade-gift']
    assert client.get(BASE + '/inventory', headers=bearer(seller)).json['gifts'] == []


def test_unlist_transfer_and_packs_excluded(client):
    prepare_sale(client)
    owner = key_for(client, 42)
    assert client.post(BASE + '/transfer', headers=bearer(owner, 'transfer-op-00000001'), json={'gift_id': 'trade-gift', 'telegram_id': '99999'}).json['result']['code'] == 'recipient_not_found'
    assert client.post(BASE + '/sell', headers=bearer(owner, 'sell-op-0000000002a'), json={'gift_id': 'trade-gift', 'price': '8'}).status_code == 200
    assert client.post(BASE + '/unlist', headers=bearer(owner, 'unlist-op-0000000001'), json={'gift_id': 'trade-gift'}).status_code == 200
    no_name = client.post(BASE + '/transfer', headers=bearer(owner, 'transfer-op-00000003'), json={'gift_id': 'trade-gift', 'telegram_id': '44'})
    assert no_name.json['result']['code'] == 'recipient_no_username'
    client.get('/api/me', headers=signed(44, username='bob'))
    moved = client.post(BASE + '/transfer', headers=bearer(owner, 'transfer-op-00000002'), json={'gift_id': 'trade-gift', 'telegram_id': '44'})
    assert moved.status_code == 200 and moved.json['result']['telegram_id'] == '44'
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        pack = {'id': 'pack-x', 'name': 'Pack', 'pack_item': True, 'price': '1', 'number': 1}
        db.execute("INSERT INTO inventory VALUES (42, 'pack-x', ?, 'unlisted')", (json.dumps(pack),))
    assert 'pack-x' not in [x['gift_id'] for x in client.get(BASE + '/inventory', headers=bearer(owner)).json['gifts']]
    assert client.post(BASE + '/sell', headers=bearer(owner, 'sell-op-0000000003'), json={'gift_id': 'pack-x', 'price': '1'}).status_code == 404


def test_rotation_replaces_key_and_bot_command(client, monkeypatch):
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://crafter.example')
    old = key_for(client, 43)
    assert client.post('/api/admin/partner/rotate', headers=signed(43), json={'user_id': 43}).status_code == 403
    assert client.post('/api/admin/partner/rotate', headers=signed(), json={'user_id': 43}).json['version'] == 2
    assert client.get(BASE + '/account', headers=bearer(old)).status_code == 401
    new = issue(client, 43)
    assert new != old and client.get(BASE + '/account', headers=bearer(new)).status_code == 200

    calls = []

    def fake(token, method, payload, sticker=None):
        calls.append((method, payload))
        return {'is_bot': True, 'id': 12345, 'username': 'crafter_example_bot'} if method == 'getMe' else True

    monkeypatch.setattr(telegram_bot, 'bot_api', fake)
    admin = signed()
    client.post('/api/admin/telegram-bot', headers=admin, json={'token': '12345:fake_telegram_bot_token', 'greeting': 'Hi', 'buttons': [{'text': 'Crafter', 'type': 'web_app', 'url': ''}]})
    client.post('/api/admin/telegram-bot/connect', headers=admin, json={})
    secret = next(p for m, p in calls if m == 'setWebhook')['secret_token']
    hook, header = '/api/telegram/webhook/12345', {'X-Telegram-Bot-Api-Secret-Token': secret}
    del calls[:]
    client.post(hook, headers=header, json={'update_id': 1, 'message': {'chat': {'id': 43, 'type': 'private'}, 'text': '/api'}})
    client.post(hook, headers=header, json={'update_id': 2, 'message': {'chat': {'id': 5555, 'type': 'private'}, 'text': '/api'}})
    texts = [p['text'] for m, p in calls if m == 'sendMessage']
    assert new in texts[0] and 'tg-spoiler' in texts[0] and '/partner-api' in texts[0]
    assert new not in texts[1] and 'хотя бы один раз' in texts[1]


def test_ordinary_gifts_have_their_own_requests(client):
    key, other = key_for(client, 43), key_for(client, 44)
    client.post('/api/admin/star-gifts/grant', headers=signed(), json={'user_id': 43, 'key': 'rose', 'count': 2})
    catalog = client.get(BASE + '/star-gifts', headers=bearer(key)).json
    rose = next(g for g in catalog['gifts'] if g['key'] == 'rose')
    assert catalog['stars_per_gram'] == 100 and rose['stars'] == 25 and rose['price'] == '0.25' and rose['price_nano'] == '250000000'
    assert rose['image_url'].startswith('http') and 'telegram_gift_id' in rose
    mine = client.get(BASE + '/star-gifts/inventory', headers=bearer(key)).json['gifts']
    assert [g['key'] for g in mine] == ['rose', 'rose'] and mine[0]['status'] == 'available'
    assert client.get(BASE + '/inventory', headers=bearer(key)).json['gifts'] == []          # not mixed with NFT gifts
    sold = client.post(BASE + '/star-gifts/sell', headers=bearer(key, 'star-sell-0000000001'), json={'gift_id': mine[0]['gift_id']})
    assert sold.status_code == 200 and sold.json['result']['amount'] == '0.25'
    assert client.post(BASE + '/star-gifts/sell', headers=bearer(key, 'star-sell-0000000001'), json={'gift_id': mine[0]['gift_id']}).json['repeat']
    assert client.post(BASE + '/star-gifts/sell', headers=bearer(other, 'star-sell-0000000002'), json={'gift_id': mine[1]['gift_id']}).status_code == 404
    queued = client.post(BASE + '/star-gifts/withdraw', headers=bearer(key, 'star-wd-00000000001'), json={'gift_id': mine[1]['gift_id']})
    assert queued.status_code == 200 and queued.json['result']['state'] == 'accepted'
    assert client.get(BASE + '/star-gifts/inventory', headers=bearer(key)).json['gifts'][0]['status'] == 'withdrawing'
    client.post('/api/admin/star-gifts/grant', headers=signed(), json={'user_id': 43, 'key': 'cake'})
    cake, = [g for g in client.get(BASE + '/star-gifts/inventory', headers=bearer(key)).json['gifts'] if g['key'] == 'cake']
    client.get('/api/me', headers=signed(44, username='bob'))
    moved = client.post(BASE + '/star-gifts/transfer', headers=bearer(key, 'star-tr-00000000001'), json={'gift_id': cake['gift_id'], 'telegram_id': '44'})
    assert moved.status_code == 200 and moved.json['result']['telegram_id'] == '44'
    assert client.get('/partner-api').status_code == 200
    assert '/star-gifts/withdraw' in client.get('/partner-api.openapi.json').json['paths']


def test_ton_withdrawal_through_the_api(client):
    key = key_for(client, 42)
    wallet = client.get(BASE + '/ton/wallet', headers=bearer(key)).json
    assert wallet['ok'] and wallet['connected'] is False
    assert client.get(BASE + '/ton/withdrawals', headers=bearer(key)).json['withdrawals'] == []
    assert client.get(BASE + '/ton/withdrawals/nope', headers=bearer(key)).status_code == 404
    assert client.post(BASE + '/ton/withdraw', headers=bearer(key), json={'gram': '5'}).status_code == 400          # no Idempotency-Key
    r = client.post(BASE + '/ton/withdraw', headers=bearer(key, 'ton-test-000000001'), json={'gram': '5.00'})
    assert r.status_code in (409, 503) and r.json['ok'] is False                                                    # no wallet / no TON Connect here
    spec = client.get('/partner-api.openapi.json').json
    assert '/ton/withdraw' in spec['paths'] and '/ton/withdrawals/{withdrawal_id}' in spec['paths']
    page = client.get('/partner-api').get_data(as_text=True)
    assert 'id="ton"' in page and 'href="#ton"' in page and 'IntersectionObserver' in page
