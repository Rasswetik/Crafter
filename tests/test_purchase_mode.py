import json
import sqlite3

import pytest

from app import DEMO_GIFTS
from test_app import client, signed
from test_resale import telegram_messages  # noqa: F401
import upgrade


def set_mode(client, mode, uid=42):
    return client.post('/api/admin/purchase-mode', headers=signed(uid),
                       json={'mode': mode, 'confirm': 'SET_PURCHASE_MODE'})


def test_default_is_test_and_work_needs_everything(client):
    info = client.get('/api/admin/purchase-mode', headers=signed()).json
    assert info['mode'] == 'test' and info['can_work'] is False and info['missing']
    assert client.get('/api/me', headers=signed()).json['market_test_purchases'] is True
    refused = set_mode(client, 'work')
    assert refused.status_code == 409 and 'РАБОТА' in refused.json['error']
    assert client.get('/api/admin/purchase-mode', headers=signed()).json['mode'] == 'test'


def test_only_admins_and_valid_requests(client):
    client.get('/api/me', headers=signed(43))
    assert set_mode(client, 'test', uid=43).status_code == 403
    assert client.post('/api/admin/purchase-mode', headers=signed(),
                       json={'mode': 'work'}).status_code == 400


def test_work_mode_switch_when_ready(client, monkeypatch):
    # Simulate a configured, verified key + durable DB + server gate.
    monkeypatch.setenv('CRAFTER_PORTALS_LIVE_PURCHASES', '1')
    client.application.config['DATABASE_URL'] = 'postgresql://x'
    monkeypatch.setenv('PORTALS_API_KEY', 'k' * 20)
    import time
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO portals_partner_policy VALUES (1,0,?) ON CONFLICT(id) DO UPDATE SET verified_at=excluded.verified_at",
                   (int(time.time()),))
    assert set_mode(client, 'work').json['mode'] == 'work'
    me = client.get('/api/me', headers=signed()).json
    assert me['market_test_purchases'] is False and me['purchase_mode'] == 'work'
    # test purchases are refused in work mode
    assert client.post('/api/market/test/buy', headers=signed(),
                       json={'gift_ids': ['x'], 'request_id': 'req-12345678'}).status_code == 409
    assert set_mode(client, 'test').json['mode'] == 'test'


def test_test_mode_gifts_can_be_staked(client, monkeypatch):
    client.get('/api/me', headers=signed(43))
    gift = {**DEMO_GIFTS[1], 'id': 'market-test-1', 'origin': 'market-test', 'test_only': True,
            'catalog_only': True, 'price': '0', 'price_unit': 'GRAM',
            'source_price': '3.5', 'source_price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (gift['id'], json.dumps(gift)))
    stakes = client.get('/api/upgrade/stakes', headers=signed(43)).json['gifts']
    assert [g['id'] for g in stakes] == ['market-test-1'] and stakes[0]['upgrade_value'] == '3.50'
    # in work mode a test gift is no longer a valid stake
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings VALUES ('purchase_mode_v1', ?)", (json.dumps({'mode': 'work'}),))
    assert client.get('/api/upgrade/stakes', headers=signed(43)).json['gifts'] == []


LOT = '11111111-2222-3333-4444-555555555555'


@pytest.fixture
def work_ready(client, monkeypatch):
    import time
    monkeypatch.setenv('CRAFTER_PORTALS_LIVE_PURCHASES', '1')
    monkeypatch.setenv('PORTALS_API_KEY', 'k' * 20)
    client.application.config['DATABASE_URL'] = 'postgresql://x'
    client.get('/api/me', headers=signed(43))
    gift = {'id': LOT, 'name': 'Snoop Dogg', 'collection_id': 'snoop', 'number': 7, 'price': '5', 'price_unit': 'GRAM',
            'source': 'portals', 'model': 'Emerald', 'image': 'https://x/y.png'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO portals_partner_policy VALUES (1,1,?)", (int(time.time()),))
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:t', json.dumps(
            {'source': 'portals', 'price_unit': 'GRAM', 'gifts': [gift]}), int(time.time())))
        db.execute("UPDATE demo_accounts SET balance='20' WHERE user_id=43")
    import portals_public
    monkeypatch.setattr('portals_partner.time.sleep', lambda _s: None)
    return portals_public


def buy(client):
    return client.post('/api/portals/buy', headers=signed(43),
                       json={'gift_ids': [LOT], 'request_id': 'req-1', 'expected_total': '5'})


def test_work_mode_blocks_when_lot_is_gone_from_portals(client, work_ready, monkeypatch):
    monkeypatch.setattr(work_ready, 'listings', lambda *_a, **_k: {'gifts': []})
    r = buy(client)
    assert r.status_code == 409 and 'недоступен' in r.json['error']
    assert client.get('/api/me', headers=signed(43)).json['balance'].startswith('20')


def test_work_mode_buys_after_verification(client, work_ready, monkeypatch):
    monkeypatch.setattr(work_ready, 'listings', lambda *_a, **_k: {'gifts': [{'id': LOT, 'price': '5'}]})
    import io
    import portals_partner

    class Resp(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(portals_partner, 'urlopen', lambda *a, **k: Resp(json.dumps({
        'purchase_results': [{'id': LOT, 'status': 'success'}], 'total_purchased': 1, 'total_spent': '5'}).encode()))
    r = buy(client)
    assert r.status_code == 200 and r.json['status'] == 'complete'
    ids = [g['source_id'] for g in client.get('/api/inventory', headers=signed(43)).json['gifts']]
    assert ids == [LOT]
    assert client.get('/api/me', headers=signed(43)).json['balance'].startswith('15')


def test_upgrade_requires_buyable_portals_lot_in_work_mode(client, work_ready, monkeypatch):
    # work mode, stake worth 1 GRAM, target Portals lot worth 5 GRAM listed in cache
    import portals_partner
    monkeypatch.setattr(work_ready, 'listings', lambda *_a, **_k: {'gifts': []})   # lot vanished on Portals
    monkeypatch.setattr('thermos.collections', lambda: [{'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '5', 'photo_url': ''}])
    stake = {**DEMO_GIFTS[1], 'id': 'stk', 'origin': 'local-purchase', 'price': '1.00', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (stake['id'], json.dumps(stake)))
        db.execute("UPDATE settings SET payload=? WHERE key='purchase_mode_v1'", (json.dumps({'mode': 'work'}),)) if False else \
            db.execute("INSERT OR REPLACE INTO settings VALUES ('purchase_mode_v1', ?)", (json.dumps({'mode': 'work'}),))
    r = client.post('/api/upgrade/quote', headers=signed(43),
                    json={'stake_id': 'stk', 'collection_id': 'snoop', 'listing_id': LOT})
    assert r.status_code == 409          # not listed on Portals any more -> no upgrade


def test_test_mode_upgrade_accepts_ton_priced_lot_without_checks(client, monkeypatch):
    """TEST mode: no Portals verification at all; a test gift can be staked on a TON-priced market lot."""
    import time
    import portals_public

    def offline(*_a, **_k):
        raise AssertionError('Portals must not be contacted for verification in TEST mode')
    monkeypatch.setattr('portals_partner.urlopen', offline)
    monkeypatch.setattr('thermos.collections', lambda: [{'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '1', 'photo_url': ''}])
    monkeypatch.setattr(portals_public, 'listings', lambda *a, **k: (_ for _ in ()).throw(OSError('offline')))
    monkeypatch.setattr('thermos.gifts', lambda *a, **k: (_ for _ in ()).throw(OSError('offline')))
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _n: 0)
    client.get('/api/me', headers=signed(43))
    stake = {**DEMO_GIFTS[1], 'id': 'market-test-9', 'origin': 'market-test', 'test_only': True, 'catalog_only': True,
             'price': '0', 'price_unit': 'GRAM', 'source_price': '2', 'source_price_unit': 'GRAM'}
    lot = {'id': 'lot-ton', 'name': 'Snoop Dogg', 'collection_id': 'snoop', 'number': 55, 'model': '', 'image': 'https://x/y.png',
           'price': '1', 'price_unit': 'TON'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (stake['id'], json.dumps(stake)))
        db.execute("INSERT INTO settings VALUES ('tonconnect', ?)", (json.dumps({'gram_per_ton': '10'}),))
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:t', json.dumps({'gifts': [lot]}), int(time.time())))
    found = client.get('/api/upgrade/targets?stake_id=market-test-9&collection_id=snoop', headers=signed(43))
    assert found.status_code == 200
    gift, = found.json['gifts']
    assert gift['id'] == 'lot-ton' and gift['price_unit'] == 'GRAM'
    quote = client.post('/api/upgrade/quote', headers=signed(43), json={
        'stake_id': 'market-test-9', 'collection_id': 'snoop', 'listing_id': 'lot-ton'})
    assert quote.status_code == 200
    result = client.post('/api/upgrade', headers=signed(43), json={'quote_id': quote.json['quote_id'], 'request_id': 'rr-1'})
    assert result.status_code == 200 and result.json['success'] is True
    assert result.json['gift']['test_only'] is True          # a test stake yields a test reward
    gifts = client.get('/api/inventory', headers=signed(43)).json['gifts']
    assert [g['origin'] for g in gifts] == ['demo-craft']


def test_test_mode_purchase_checks_and_debits_the_players_balance(client):
    import time
    client.get('/api/me', headers=signed(43))
    gift = {'id': 'lot-1', 'name': 'Snoop Dogg', 'collection_id': 'snoop', 'number': 3, 'price': '5', 'price_unit': 'GRAM',
            'model': 'x', 'image': 'https://x/y.png'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:t', json.dumps({'gifts': [gift]}), int(time.time())))
    body = {'gift_ids': ['lot-1'], 'request_id': 'req-balance-1'}
    r = client.post('/api/market/test/buy', headers=signed(43), json=body)
    assert r.status_code == 409 and 'Недостаточно GRAM' in r.json['error']          # balance 0 -> real error
    assert client.get('/api/inventory', headers=signed(43)).json['gifts'] == []
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("UPDATE demo_accounts SET balance='20' WHERE user_id=43")
    ok = client.post('/api/market/test/buy', headers=signed(43), json={**body, 'request_id': 'req-balance-2'})
    assert ok.status_code == 200 and ok.json['balance'].startswith('15')
