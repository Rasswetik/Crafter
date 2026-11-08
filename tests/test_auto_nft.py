import asyncio
import json
import sqlite3

import pytest

import relayer_transfer as rt
from test_app import client, signed


GID = '11111111-2222-3333-4444-555555555555'


def make_gift(origin, **extra):
    return {'id': GID, 'name': 'Snoop Dogg', 'number': 77, 'price': '1', 'price_unit': 'GRAM',
            'origin': origin, **extra}


def queue(client, gift):
    client.get('/api/me', headers=signed(43))
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (gift['id'], json.dumps(gift)))
        db.execute("UPDATE demo_accounts SET balance='5' WHERE user_id=43")
    url = '/api/portals/withdraw' if gift['origin'] == 'portals-partner' else '/api/gifts/withdraw'
    r = client.post(url, headers=signed(43), json={'gift_id': gift['id'], 'request_id': 'w-1'})
    assert r.status_code == 200, r.json
    return r.json['id']


def enable(client, monkeypatch):
    monkeypatch.setitem(client.application.extensions, 'crafter_relayer_credentials', lambda: (1, 'h', 's', 777))
    r = client.post('/api/admin/auto-nft', headers=signed(), json={'enabled': True, 'confirm': 'SET_AUTO_NFT'})
    assert r.status_code == 200 and r.json['enabled'] is True


def run(client):
    with client.application.app_context():
        return client.application.extensions['crafter_auto_nft_process']()


def state(client, wid):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        job = db.execute('SELECT stage,note FROM auto_nft_jobs WHERE withdrawal_id=?', (wid,)).fetchone()
        inv = db.execute("SELECT status FROM inventory WHERE user_id=43 AND nft_id=?", (GID,)).fetchone()
        wd = db.execute('SELECT status FROM gift_withdrawals WHERE id=?', (wid,)).fetchone()
    return job, inv, wd


def test_enable_needs_connected_relayer_and_admin(client):
    body = {'enabled': True, 'confirm': 'SET_AUTO_NFT'}
    client.get('/api/me', headers=signed(43))
    assert client.post('/api/admin/auto-nft', headers=signed(43), json=body).status_code == 403
    assert client.post('/api/admin/auto-nft', headers=signed(), json=body).status_code == 409
    assert client.get('/api/admin/auto-nft', headers=signed()).json['enabled'] is False


def test_relayer_gift_goes_straight_to_user(client, monkeypatch):
    sent = []

    async def fake_transfer(api_id, api_hash, session, slug, to_user_id, to_username=''):
        sent.append((slug, to_user_id))
        return True
    monkeypatch.setattr(rt, 'transfer', fake_transfer)
    wid = queue(client, make_gift('telegram-deposit', telegram_slug='snoop-77',
                                  telegram_url='https://t.me/nft/snoop-77'))
    enable(client, monkeypatch)
    run(client)
    job, inv, wd = state(client, wid)
    assert sent == [('snoop-77', 43)]
    assert job[0] == 'done' and inv is None and wd[0] == 'confirmed'
    run(client)
    assert len(sent) == 1                                  # never transferred twice


def test_portals_gift_path_via_relayer(client, monkeypatch):
    calls = []

    def partner(method, path, body=None, query=None):
        calls.append((method, path))
        if path == 'nfts/withdraw':
            assert body['recipient_id'] == 777 and body['unsafe_transfer'] is False
            return {'withdrawals_ids': [9]}
        return {'statuses': [{'id': 9, 'status': 'completed'}]}
    monkeypatch.setitem(client.application.extensions, 'crafter_portals_partner', partner)
    sent = []

    async def found(*a, **k):
        return 'snoop-77'

    async def fake_transfer(api_id, api_hash, session, slug, to_user_id, to_username=''):
        sent.append(slug)
        return True
    monkeypatch.setattr(rt, 'find_on_relayer', found)
    monkeypatch.setattr(rt, 'transfer', fake_transfer)
    enable(client, monkeypatch)
    wid = queue(client, make_gift('portals-partner'))
    for _ in range(5):
        run(client)
    job, inv, wd = state(client, wid)
    assert [c[1] for c in calls] == ['nfts/withdraw', 'nfts/withdrawals/statuses']
    assert sent == ['snoop-77'] and job[0] == 'done' and wd[0] == 'confirmed' and inv is None


def test_unknown_transfer_result_is_never_repeated(client, monkeypatch):
    attempts = []

    async def broken(*a, **k):
        attempts.append(1)
        raise asyncio.TimeoutError()
    monkeypatch.setattr(rt, 'transfer', broken)
    wid = queue(client, make_gift('telegram-deposit', telegram_slug='snoop-77',
                                  telegram_url='https://t.me/nft/snoop-77'))
    enable(client, monkeypatch)
    for _ in range(3):
        run(client)
    job, inv, wd = state(client, wid)
    assert len(attempts) == 1 and job[0] == 'review'
    assert wd[0] == 'queued' and inv[0] == 'withdrawing'     # stays for the operator, nothing refunded


def test_portals_failure_restores_gift_and_refunds_fee(client, monkeypatch):
    def partner(method, path, body=None, query=None):
        if path == 'nfts/withdraw':
            return {'withdrawals_ids': [9]}
        return {'statuses': [{'id': 9, 'status': 'errored'}]}
    monkeypatch.setitem(client.application.extensions, 'crafter_portals_partner', partner)
    enable(client, monkeypatch)
    wid = queue(client, make_gift('portals-partner'))
    for _ in range(3):
        run(client)
    job, inv, wd = state(client, wid)
    assert job[0] == 'failed' and wd[0] == 'failed' and inv[0] == 'unlisted'
    assert client.get('/api/me', headers=signed(43)).json['balance'].startswith('5')


def test_import_session_connects_the_relayer_and_stores_it_encrypted(client, monkeypatch):
    import telegram_deposits
    from cryptography.fernet import Fernet
    monkeypatch.setenv('TELEGRAM_SESSION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('TELEGRAM_API_ID', '12345')
    monkeypatch.setenv('TELEGRAM_API_HASH', 'a' * 32)
    seen = {}

    async def fake_with_client(api_id, api_hash, session, operation):
        seen['session'] = session

        class C:
            async def is_user_authorized(self):
                return True

            async def get_me(self):
                class Me:
                    id, first_name, last_name, username, bot = 777, 'Relay', 'Er', 'relayer', False
                return Me()
        return await operation(C())
    monkeypatch.setattr(telegram_deposits, 'with_client', fake_with_client)
    client.get('/api/me', headers=signed(43))
    good = '1' + 'A' * 120
    assert client.post('/api/admin/telegram-deposits/import-session', headers=signed(43), json={'session': good}).status_code == 403
    assert client.post('/api/admin/telegram-deposits/import-session', headers=signed(), json={'session': 'nope'}).status_code == 400
    r = client.post('/api/admin/telegram-deposits/import-session', headers=signed(), json={'session': good})
    assert r.status_code == 200 and r.json['connected'] is True and r.json['account_id'] == 777
    assert seen['session'] == good
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        stored = db.execute("SELECT payload FROM settings WHERE key='telegram_deposit_connection'").fetchone()[0]
    assert good not in stored                                  # the session is stored encrypted only


def test_relayer_session_key_is_created_automatically_when_env_is_missing(client, monkeypatch):
    import telegram_deposits
    from pathlib import Path
    monkeypatch.delenv('TELEGRAM_SESSION_KEY', raising=False)
    monkeypatch.setenv('TELEGRAM_API_ID', '12345')
    monkeypatch.setenv('TELEGRAM_API_HASH', 'b' * 32)

    async def fake_with_client(api_id, api_hash, session, operation):
        class C:
            async def is_user_authorized(self):
                return True

            async def get_me(self):
                class Me:
                    id, first_name, last_name, username, bot = 5, 'A', 'B', 'rel', False
                return Me()
        return await operation(C())
    monkeypatch.setattr(telegram_deposits, 'with_client', fake_with_client)
    assert client.get('/api/admin/telegram-deposits', headers=signed()).json['session_key_configured'] is True
    r = client.post('/api/admin/telegram-deposits/import-session', headers=signed(), json={'session': '1' + 'B' * 120})
    assert r.status_code == 200 and r.json['connected'] is True
    key_file = Path(client.application.config['DATABASE']).resolve().parent / 'telegram_session.key'
    assert key_file.exists() and len(key_file.read_text().strip()) == 44          # a Fernet key, created once


class _Attr:
    def __init__(self, kind, name):
        self.__class__ = type(kind, (), {})
        self.name = name


def _entry(slug, title, num):
    from types import SimpleNamespace
    gift = SimpleNamespace(slug=slug, title=title, num=num, attributes=[_Attr('StarGiftAttributeModel', 'Emerald')])
    return SimpleNamespace(gift=gift, refunded=False, from_id=None, date=None)


def _credit_setup(client, monkeypatch, records):
    import telegram_deposits
    from cryptography.fernet import Fernet
    monkeypatch.setenv('TELEGRAM_SESSION_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('TELEGRAM_API_ID', '12345')
    monkeypatch.setenv('TELEGRAM_API_HASH', 'c' * 32)
    client.get('/api/me', headers=signed(43))
    cfg = {'session': telegram_deposits_encrypt(client), 'account_id': 5}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings VALUES ('telegram_deposit_connection', ?)", (json.dumps(cfg),))

    async def fetch(api_id, api_hash, session):
        return 5, 'rel', records
    monkeypatch.setattr(telegram_deposits, 'fetch_received', fetch)


def telegram_deposits_encrypt(client):
    from cryptography.fernet import Fernet
    import os
    return Fernet(os.environ['TELEGRAM_SESSION_KEY'].encode()).encrypt(b'1' + b'A' * 120).decode()


def test_admin_credits_an_nft_by_link_only_if_it_is_on_the_relayer(client, monkeypatch):
    _credit_setup(client, monkeypatch, [_entry('SnoopDogg-77', 'Snoop Dogg', 77)])
    body = {'user_id': '43', 'url': 'https://t.me/nft/SnoopDogg-77'}
    assert client.post('/api/admin/telegram-deposits/credit-link', headers=signed(43), json=body).status_code == 403
    assert client.post('/api/admin/telegram-deposits/credit-link', headers=signed(), json={**body, 'url': 'https://evil.com/x'}).status_code == 400
    missing = client.post('/api/admin/telegram-deposits/credit-link', headers=signed(), json={**body, 'url': 'https://t.me/nft/Other-1'})
    assert missing.status_code == 404                                   # not on the relayer, not in Thermos
    ok = client.post('/api/admin/telegram-deposits/credit-link', headers=signed(), json=body)
    assert ok.status_code == 200 and ok.json['where'] == 'relayer'
    gifts = client.get('/api/inventory', headers=signed(43)).json['gifts']
    assert [(g['origin'], g['number']) for g in gifts] == [('telegram-deposit', 77)]
    again = client.post('/api/admin/telegram-deposits/credit-link', headers=signed(), json=body)
    assert again.status_code == 409                                      # never credited twice
    assert client.post('/api/admin/telegram-deposits/credit-link', headers=signed(),
                       json={'user_id': '999', 'url': 'https://t.me/nft/SnoopDogg-77'}).status_code == 404


def test_admin_can_credit_a_gift_held_in_thermos(client, monkeypatch):
    _credit_setup(client, monkeypatch, [])                                # nothing on the relayer
    monkeypatch.setitem(client.application.extensions, 'crafter_thermos_owns', lambda slug: slug == 'DeskCalendar-1212')
    ok = client.post('/api/admin/telegram-deposits/credit-link', headers=signed(),
                     json={'user_id': '43', 'url': 'https://t.me/nft/DeskCalendar-1212'})
    assert ok.status_code == 200 and ok.json['where'] == 'thermos'
    gift, = client.get('/api/inventory', headers=signed(43)).json['gifts']
    assert gift['origin'] == 'thermos' and gift['number'] == 1212
    nope = client.post('/api/admin/telegram-deposits/credit-link', headers=signed(),
                       json={'user_id': '43', 'url': 'https://t.me/nft/Other-5'})
    assert nope.status_code == 404
