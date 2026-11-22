import hashlib
import hmac
import json
import sqlite3
import time
from decimal import Decimal

import pytest

import boostup
from test_app import client, signed

BASE = '/api/boostup/v1'
GIFT = {'id': 'telegram-plushpepe-4102', 'name': 'Plush Pepe', 'collection_id': 'plush', 'number': 4102, 'source_number': 4102, 'model': 'Vice City',
        'backdrop': 'Black', 'symbol': 'Star', 'origin': 'telegram-deposit', 'telegram_slug': 'PlushPepe-4102', 'telegram_url': 'https://t.me/nft/PlushPepe-4102',
        'image': 'https://nft.fragment.com/gift/plushpepe-4102.webp', 'price': '0', 'price_unit': 'GRAM'}
USER = signed(43, username='anna')
BOOSTUP = signed(77, username='boostup_relayer')       # the Crafter account of BoostUp: the gifts arrive in its inventory
ADMIN = signed()


@pytest.fixture
def bot(monkeypatch):
    sent = []

    def fake(token, method, payload, sticker=None):
        sent.append((method, payload))
        return {'message_id': 7}
    monkeypatch.setattr('telegram_bot.bot_api', fake)
    monkeypatch.setattr(boostup, 'bot_api', fake)
    monkeypatch.setattr(boostup, 'webhook_allowed', lambda url: True)
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://crafter.example')
    return sent


@pytest.fixture
def world(client, bot, monkeypatch):
    """Integration on, a player with a gift on the relayer, the Crafter account of BoostUp, a collection with a floor and a BoostUp that answers."""
    app = client.application
    assert client.get('/api/me', headers=USER).status_code == 200
    assert client.get('/api/me', headers=BOOSTUP).status_code == 200
    now = int(time.time())
    with sqlite3.connect(app.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43,?,?,'unlisted')", (GIFT['id'], json.dumps(GIFT)))
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('thermos:collections', json.dumps([
            {'id': 'plush', 'short_name': 'plush', 'name': 'Plush Pepe', 'photo_url': '', 'floor_price': '100', 'price_unit': 'TON'}]), now))
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:upgrade:plush:0:100000000', json.dumps({'gifts': []}), now))   # fresh: no request to the market
    saved = client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'enabled': True, 'webhook_url': 'https://boostup.example/hook',
                                                                    'account': '@boostup_relayer'})
    assert saved.status_code == 200, saved.json
    hooks = []
    answer = {'value': (200, '{"ok": true, "external_id": "bx-1"}')}

    def fake_post(url, headers, body):
        hooks.append((url, headers, body))
        result = answer['value']
        if isinstance(result, Exception):
            raise result
        return result
    monkeypatch.setattr(boostup, 'post_webhook', fake_post)
    return {'app': app, 'hooks': hooks, 'answer': answer, 'token': saved.json['token'], 'secret': saved.json['signing_secret']}


def run_worker(world):
    with world['app'].app_context():
        return world['app'].extensions['crafter_boostup_process']()


def offer(world, bot):
    with world['app'].app_context():
        assert world['app'].extensions['crafter_deposit_notify'](43, GIFT) is True
    message = [p for m, p in bot if m == 'sendMessage'][-1]
    buttons = [b for row in message['reply_markup']['inline_keyboard'] for b in row]
    return message, buttons, next(b['callback_data'] for b in buttons if b['text'] == 'В BoostUp').split(':')[2]


def confirm(client, offer_id):
    return client.post('/api/boostup/offer/' + offer_id + '/confirm', headers=USER, json={})


def api(client, world, path, method='get', **kwargs):
    return getattr(client, method)(BASE + path, headers={'Authorization': 'Bearer ' + world['token']}, **kwargs)


def test_the_gift_goes_from_the_player_into_the_crafter_inventory_of_boostup(client, world, bot):
    message, buttons, offer_id = offer(world, bot)
    assert 'Куда отправить подарок?' in message['text'] and message['chat_id'] == 43
    assert [b['text'] for b in buttons] == ['В маркет', 'В BoostUp'] and buttons[0]['web_app']['url'].startswith('https://crafter.example')

    callback = {'id': 'cb1', 'data': 'bu:go:' + offer_id, 'from': {'id': 43}, 'message': {'message_id': 9, 'chat': {'id': 43}}}
    with world['app'].app_context():
        world['app'].extensions['crafter_bot_callback']({**callback, 'from': {'id': 44}})              # somebody else's button
        assert [p for m, p in bot if m == 'answerCallbackQuery'][-1]['show_alert'] is True
        world['app'].extensions['crafter_bot_callback'](callback)
    edited = [p for m, p in bot if m == 'editMessageText'][-1]
    assert 'подтвердить' in edited['text'].lower() and edited['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] == 'https://crafter.example/boostup/confirm?offer=' + offer_id

    assert client.get('/api/me', headers=signed(44, username='bob')).status_code == 200
    assert client.get('/api/boostup/offer/' + offer_id, headers=signed(44, username='bob')).status_code == 404
    shown = client.get('/api/boostup/offer/' + offer_id, headers=USER).json
    assert shown['can_confirm'] and shown['value']['ton'] == '100' and Decimal(shown['value']['gram']) > 0
    assert shown['gift']['slug'] == 'PlushPepe-4102' and shown['lottie'] == '/media/crafter/gift/PlushPepe-4102.json'

    done = confirm(client, offer_id)
    assert done.status_code == 200 and done.json['status'] == 'delivered'
    assert client.get('/api/inventory', headers=USER).json['gifts'] == []                              # it left the inventory of the player
    held = client.get('/api/inventory', headers=BOOSTUP).json['gifts']
    assert [(g['id'], g['status']) for g in held] == [(GIFT['id'], 'unlisted')]                        # and it is in the Crafter inventory of BoostUp, at once
    assert confirm(client, offer_id).json['status'] == 'delivered'                                     # a second tap changes nothing
    assert len(client.get('/api/inventory', headers=BOOSTUP).json['gifts']) == 1

    with client.application.app_context():                                                              # the ordinary Partner API key of that account sees the gift
        key = client.application.extensions['crafter_partner_key'](77)
    seen = client.get('/api/partner/v1/inventory', headers={'Authorization': 'Bearer ' + key}).json['gifts']
    assert [g['gift_id'] for g in seen] == [GIFT['id']]

    assert run_worker(world) == {'processed': 1}
    url, headers, body = world['hooks'][0]
    assert url == 'https://boostup.example/hook' and headers['X-Crafter-Event'] == 'deposit.delivered'
    expected = hmac.new(world['secret'].encode(), headers['X-Crafter-Timestamp'].encode() + b'.' + body, hashlib.sha256).hexdigest()
    assert headers['X-Crafter-Signature'] == 'sha256=' + expected
    event = json.loads(body)
    assert event['deposit_id'] == offer_id and event['telegram_id'] == '43' and event['username'] == 'anna'
    assert event['gift']['slug'] == 'PlushPepe-4102' and event['gift']['gift_id'] == GIFT['id'] and event['value']['ton'] == '100'
    assert event['account'] == {'telegram_id': '77', 'username': 'boostup_relayer', 'name': 'Test'}

    deposit = api(client, world, '/deposits/' + offer_id).json['deposit']
    assert deposit['status'] == 'credited' and deposit['note'] == 'BoostUp: bx-1'
    texts = [p['text'] for m, p in bot if m == 'sendMessage']
    assert any('Подарок передан BoostUp' in t for t in texts) and any('Подарок в инвентаре BoostUp' in t for t in texts)
    assert run_worker(world) == {'processed': 0} and len(world['hooks']) == 1                         # nothing is sent twice
    history = client.get('/api/history', headers=USER).json['items']
    assert any(item['kind'] == 'transfer' for item in history)


def test_a_gift_given_to_boostup_inside_crafter_is_a_deposit_too(client, world, bot):
    give = lambda rid, who=USER, to=77, name='boostup_relayer', ids=None: client.post('/api/inventory/transfer', headers=who, json={
        'gift_ids': ids or [GIFT['id']], 'recipient_id': to, 'request_id': rid, 'username': name})
    sent = give('give-0001')                                                                           # the button «Передать» in the app: no bot question needed
    assert sent.status_code == 200, sent.json
    assert [g['id'] for g in client.get('/api/inventory', headers=BOOSTUP).json['gifts']] == [GIFT['id']]
    deposits = api(client, world, '/deposits?status=delivered').json['deposits']
    assert len(deposits) == 1 and deposits[0]['via'] == 'transfer' and deposits[0]['telegram_id'] == '43' and deposits[0]['gift']['slug'] == 'PlushPepe-4102'
    assert run_worker(world) == {'processed': 1}
    event = json.loads(world['hooks'][0][2])
    assert event['via'] == 'transfer' and event['deposit_id'] == deposits[0]['deposit_id'] and event['gift']['gift_id'] == GIFT['id']
    assert api(client, world, '/deposits/' + deposits[0]['deposit_id']).json['deposit']['status'] == 'credited'
    assert any('Подарок передан BoostUp' in p['text'] for m, p in bot if m == 'sendMessage')
    assert give('give-0001').status_code == 200 and len(api(client, world, '/deposits').json['deposits']) == 1      # the same request is not a second deposit

    # BoostUp giving a gift to a player is not a deposit
    back = give('give-0002', who=BOOSTUP, to=43, name='anna')
    assert back.status_code == 200 and len(api(client, world, '/deposits').json['deposits']) == 1


def test_webhook_is_repeated_until_boostup_answers(client, world, bot):
    _message, _buttons, offer_id = offer(world, bot)
    confirm(client, offer_id)
    world['answer']['value'] = (500, 'oops')
    run_worker(world)
    row = api(client, world, '/deposits/' + offer_id).json['deposit']
    assert row['status'] == 'delivered' and row['attempts'] == 1 and row['note'] == 'BoostUp ответил HTTP 500'
    assert run_worker(world) == {'processed': 0}                                                       # the next attempt waits (10 seconds)
    world['answer']['value'] = OSError('down')
    assert client.post('/api/admin/boostup/deposits/' + offer_id + '/retry', headers=ADMIN, json={}).status_code == 200
    run_worker(world)
    assert api(client, world, '/deposits/' + offer_id).json['deposit']['note'].startswith('BoostUp не ответил')
    world['answer']['value'] = (200, '{"ok": true}')
    client.post('/api/admin/boostup/deposits/' + offer_id + '/retry', headers=ADMIN, json={})
    run_worker(world)
    assert api(client, world, '/deposits/' + offer_id).json['deposit']['status'] == 'credited'
    assert len(client.get('/api/inventory', headers=BOOSTUP).json['gifts']) == 1                       # the gift moved once, only the call was repeated


def test_ack_through_the_api_and_the_protection_of_the_api(client, world, bot):
    _message, _buttons, offer_id = offer(world, bot)
    assert api(client, world, '/deposits/' + offer_id).status_code == 404                              # not confirmed by the player: invisible
    confirm(client, offer_id)
    world['answer']['value'] = (503, '')
    run_worker(world)
    first = api(client, world, '/deposits/' + offer_id + '/ack', 'post', json={'external_id': 'mine-1'})
    assert first.status_code == 200 and first.json['status'] == 'credited'
    assert api(client, world, '/deposits/' + offer_id + '/ack', 'post', json={}).json['repeat'] is True
    assert [d['deposit_id'] for d in api(client, world, '/deposits?status=credited').json['deposits']] == [offer_id]
    assert api(client, world, '/deposits?status=nope').status_code == 400
    assert api(client, world, '/ping').json['account']['username'] == 'boostup_relayer'
    assert client.get(BASE + '/ping').status_code == 401
    assert client.get(BASE + '/ping', headers={'Authorization': 'Bearer BUP/wrong'}).status_code == 401
    assert client.get(BASE + '/ping', headers={'Authorization': 'Bearer ' + world['token'], 'Origin': 'https://evil.example'}).status_code == 403
    with client.application.app_context():
        ordinary = client.application.extensions['crafter_partner_key'](77)
    assert client.get(BASE + '/ping', headers={'Authorization': 'Bearer ' + ordinary}).status_code == 401     # the ordinary key is another key: it does not open the deposit API
    assert client.get('/api/partner/v1/account', headers={'Authorization': 'Bearer ' + world['token']}).status_code == 401   # and the deposit key does not open the Partner API


def test_the_administrator_can_take_the_gift_back_until_boostup_credits_it(client, world, bot):
    _message, _buttons, offer_id = offer(world, bot)
    confirm(client, offer_id)
    world['answer']['value'] = (500, '')
    run_worker(world)
    with sqlite3.connect(world['app'].config['DATABASE']) as db:
        db.execute("UPDATE inventory SET status='listed' WHERE user_id=77")
    refused = client.post('/api/admin/boostup/deposits/' + offer_id + '/return', headers=ADMIN, json={'confirm': 'RETURN_BOOSTUP'})
    assert refused.status_code == 409                                                                  # BoostUp has already put it on sale
    with sqlite3.connect(world['app'].config['DATABASE']) as db:
        db.execute("UPDATE inventory SET status='unlisted' WHERE user_id=77")
    assert client.post('/api/admin/boostup/deposits/' + offer_id + '/return', headers=ADMIN, json={}).status_code == 400
    assert client.post('/api/admin/boostup/deposits/' + offer_id + '/return', headers=ADMIN, json={'confirm': 'RETURN_BOOSTUP'}).status_code == 200
    assert [g['id'] for g in client.get('/api/inventory', headers=USER).json['gifts']] == [GIFT['id']]
    assert client.get('/api/inventory', headers=BOOSTUP).json['gifts'] == []
    assert api(client, world, '/deposits/' + offer_id).json['deposit']['status'] == 'returned'
    assert api(client, world, '/deposits/' + offer_id + '/ack', 'post', json={}).status_code == 409   # a returned gift cannot be credited
    assert any('Подарок не отправлен в BoostUp' in p['text'] for m, p in bot if m == 'sendMessage')


def test_settings_keys_and_pages(client, world, bot):
    token, secret = world['token'], world['secret']
    assert token.startswith('BUP/') and len(token) == 44
    rotated = client.post('/api/admin/boostup/rotate', headers=ADMIN, json={'confirm': 'ROTATE_BOOSTUP'}).json
    assert rotated['token'] != token and rotated['signing_secret'] != secret
    assert client.get(BASE + '/ping', headers={'Authorization': 'Bearer ' + token}).status_code == 401       # the old key stops working at once
    assert client.post('/api/admin/boostup', headers=signed(43), json={'confirm': 'SET_BOOSTUP', 'enabled': False}).status_code == 403
    assert client.post('/api/admin/boostup', headers=ADMIN, json={'enabled': False}).status_code == 400
    assert client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'percent': '0'}).status_code == 400
    assert client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'account': '@nobody_here'}).status_code == 400   # it never opened Crafter
    saved = client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'account': '77', 'percent': '95'})
    assert saved.json['account']['username'] == 'boostup_relayer' and saved.json['settings']['percent'] == '95'
    off = client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'enabled': False})
    assert off.json['settings']['enabled'] is False
    with world['app'].app_context():
        assert world['app'].extensions['crafter_deposit_notify'](43, GIFT) is False                      # off: the standard message is sent instead
    docs = client.get('/boostup-api')
    assert docs.status_code == 200 and 'deposit.delivered' in docs.get_data(as_text=True) and '@boostup_relayer' in docs.get_data(as_text=True)
    page = client.get('/boostup/confirm')
    assert page.status_code == 200 and page.headers['Cache-Control'] == 'no-store'


def test_enabling_needs_an_account_and_a_webhook(client, bot, monkeypatch):
    monkeypatch.setattr(boostup, 'webhook_allowed', lambda url: True)
    assert client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'enabled': True}).status_code == 400
    assert client.post('/api/admin/boostup', headers=ADMIN, json={'confirm': 'SET_BOOSTUP', 'enabled': True, 'webhook_url': 'https://b.example/h'}).status_code == 400


def test_webhook_address_is_limited_to_the_public_internet():
    for url in ('http://boostup.example/hook', 'https://localhost/hook', 'https://127.0.0.1/hook', 'https://user:pass@boostup.example/hook', '', 'https://'):
        assert boostup.webhook_allowed(url) is False
