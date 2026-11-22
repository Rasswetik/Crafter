import json
import sqlite3
import time
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from telethon.tl import types

import telegram_bot
import telegram_deposits
from test_app import client, signed

ADMIN = signed()
GIFT_ID = 'telegram-plushpepe-4102'


def entry(sender, date, slug='PlushPepe-4102', title='Plush Pepe', number=4102):
    return SimpleNamespace(gift=SimpleNamespace(slug=slug, title=title, num=number, attributes=[]),
                           from_id=types.PeerUser(user_id=sender) if sender else None, date=date, refunded=False)


@pytest.fixture
def relayer(client, monkeypatch):
    """A connected relayer account that holds whatever the test puts into `held`; every message of the bot is collected in `sent`."""
    key = Fernet.generate_key()
    monkeypatch.setenv('TELEGRAM_SESSION_KEY', key.decode())
    fernet = Fernet(key)
    enc = lambda value: fernet.encrypt(value.encode()).decode()
    config = {'api_id_encrypted': enc('12345'), 'api_hash_encrypted': enc('a' * 32), 'session': enc('session'), 'account_id': 99,
              'account_username': 'relayer', 'baseline_done': True}
    for uid, name in ((43, 'anna'), (44, 'bob'), (55, 'shop')):
        assert client.get('/api/me', headers=signed(uid, username=name)).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings(key,payload) VALUES('telegram_deposit_connection',?)", (json.dumps(config),))
    held, sent = [], []

    async def fake_fetch(api_id, api_hash, session):
        return 99, 'relayer', list(held)
    monkeypatch.setattr(telegram_deposits, 'fetch_received', fake_fetch)
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload, sticker=None: sent.append((method, payload)) or {'message_id': 1})
    return held, sent, client


def rows(client, sql, *args):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        return db.execute(sql, args).fetchall()


def scan(client):
    reply = client.post('/api/admin/telegram-deposits/sync', headers=ADMIN)
    assert reply.status_code == 200, reply.json
    return reply.json


def test_every_arrival_of_a_gift_is_handled_and_the_gift_belongs_to_the_one_who_sent_it(relayer):
    held, sent, client = relayer
    now = int(time.time())
    letters = lambda chat: [p for m, p in sent if m == 'sendMessage' and p['chat_id'] == chat]

    held.append(entry(43, now - 100))
    assert scan(client)['credited'] == 1
    assert rows(client, 'SELECT user_id,status FROM inventory WHERE nft_id=?', GIFT_ID) == [(43, 'unlisted')]
    assert len(letters(43)) == 1                                                                         # one message, not two
    with client.application.app_context():                                                               # the scan tells which gifts the relayer holds
        assert client.application.extensions['crafter_relayer_holds']() == {'plushpepe-4102'}
    assert scan(client)['credited'] == 0 and len(letters(43)) == 1                                       # the same arrival is not handled twice

    # the gift leaves (withdrawn) and is sent again later: a NEW arrival, the player gets the message and the gift again
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('DELETE FROM inventory WHERE nft_id=?', (GIFT_ID,))
    held[:] = [entry(43, now + 3600)]
    assert scan(client)['credited'] == 1
    assert rows(client, 'SELECT user_id FROM inventory WHERE nft_id=?', GIFT_ID) == [(43,)]
    assert len(letters(43)) == 2 and scan(client)['credited'] == 0 and len(letters(43)) == 2

    # another account sends the same gift: it counts for that account, and it is gone from the first one (also from the market)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO crafter_listings(id,seller_id,gift_id,price,listed_at) VALUES('crafter-x',43,?,'5',?)", (GIFT_ID, now))
    held[:] = [entry(44, now + 7200)]
    assert scan(client)['credited'] == 1
    assert rows(client, 'SELECT user_id FROM inventory WHERE nft_id=?', GIFT_ID) == [(44,)]
    assert rows(client, 'SELECT 1 FROM crafter_listings WHERE gift_id=?', GIFT_ID) == []
    assert len(letters(44)) == 1

    # the account of a market (a supplier): the gift belongs to the project, nobody's inventory, no message
    assert client.post('/api/admin/suppliers', headers=ADMIN, json={'ids': ['55'], 'confirm': 'SET_SUPPLIERS'}).json['ids'] == [55]
    held[:] = [entry(55, now + 10800)]
    assert scan(client)['credited'] == 0
    assert rows(client, 'SELECT user_id FROM inventory WHERE nft_id=?', GIFT_ID) == []
    assert rows(client, 'SELECT sender_id FROM project_gifts WHERE slug=?', 'PlushPepe-4102') == [(55,)]
    assert len(letters(55)) == 0 and len(letters(44)) == 1
    stored = client.get('/api/admin/suppliers', headers=ADMIN).json
    assert stored['project_gifts'] == 1 and stored['recent'][0]['sender_id'] == 55

    assert client.post('/api/admin/suppliers', headers=signed(43), json={'ids': [], 'confirm': 'SET_SUPPLIERS'}).status_code == 403
    assert client.post('/api/admin/suppliers', headers=ADMIN, json={'ids': ['abc'], 'confirm': 'SET_SUPPLIERS'}).status_code == 400


def test_a_message_is_not_sent_again_when_telegram_does_not_answer(monkeypatch):
    calls = []

    def timed_out(token, method, payload, sticker=None):
        calls.append(method)
        raise telegram_bot.TelegramUnsure(description='timeout')
    monkeypatch.setattr(telegram_bot, 'bot_api', timed_out)
    monkeypatch.setattr(telegram_bot, 'premium_map', lambda token: {'🎁': '1'})                          # a premium version of the text exists
    with pytest.raises(telegram_bot.TelegramUnsure):
        telegram_bot.send_message('t', {'chat_id': 1, 'parse_mode': 'HTML', 'text': '🎁 Подарок'})
    assert calls == ['sendMessage']                                                                       # it may be delivered already: no second, plain copy

    calls.clear()
    refused = []

    def refuses_premium(token, method, payload, sticker=None):
        refused.append(payload['text'])
        if len(refused) == 1:
            raise telegram_bot.BadGateway(description='refused')                                          # Telegram answered: it does not accept the premium emoji
        return {'message_id': 1}
    monkeypatch.setattr(telegram_bot, 'bot_api', refuses_premium)
    telegram_bot.send_message('t', {'chat_id': 1, 'parse_mode': 'HTML', 'text': '🎁 Подарок'})
    assert len(refused) == 2 and '<tg-emoji' in refused[0] and '<tg-emoji' not in refused[1]            # a refusal still falls back to the plain text
