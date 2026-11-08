import io
import json
import sqlite3
import time
from urllib.error import URLError

import pytest
from cryptography.fernet import Fernet

import thermos
import thermos_market
from test_app import client, signed

LOT = 'lot-thermos-1'


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def wired(client, monkeypatch):
    monkeypatch.setenv('CRAFTER_PORTALS_FERNET_KEY', Fernet.generate_key().decode())
    monkeypatch.setenv('THERMOS_API_TOKEN', 'thermos-test-token')
    monkeypatch.setattr('thermos_market.time.sleep', lambda _s: None)
    monkeypatch.setitem(client.application.extensions, 'crafter_relayer_credentials', lambda: (1, 'h', 's', 777))
    monkeypatch.setattr(thermos, 'collections', lambda: [])
    monkeypatch.setattr(thermos, 'gifts', lambda *a, **k: {'gifts': [{'id': LOT, 'price': '2'}]})
    client.get('/api/me', headers=signed(43))
    gift = {'id': LOT, 'name': 'Snoop Dogg', 'collection_id': 'snoop', 'number': 7, 'price': '2', 'price_unit': 'TON',
            'marketplace': 'PORTALS', 'model': 'Emerald', 'image': 'https://x/y.png'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings VALUES ('purchase_mode_v1', ?)", (json.dumps({'mode': 'work'}),))
        db.execute("INSERT INTO settings VALUES ('market_backend_v1', ?)", (json.dumps({'backend': 'thermos'}),))
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:t', json.dumps(
            {'source': 'thermos', 'price_unit': 'TON', 'gifts': [gift]}), int(time.time())))
        db.execute("UPDATE demo_accounts SET balance='100' WHERE user_id=43")
    return client


def fake_api(balance_ton='10', buy='success', calls=None):
    def opener(req, timeout=None):
        url, method = req.full_url, req.get_method()
        if calls is not None:
            calls.append((method, url.split('/api/v1')[1].split('?')[0], req.data))
        if '/auth/api-token' in url:
            return Resp(json.dumps({'account': {'effective_balance': int(float(balance_ton) * 1e9), 'telegram_user_id': 5},
                                    'token': 'jwt'}).encode())
        if url.endswith('/gifts/buy'):
            if buy == 'network':
                raise URLError('down')
            return Resp(json.dumps({'task_id': 't1'}).encode())
        if '/tasks/' in url:
            state = 'SUCCESS' if buy == 'success' else 'FAILURE'
            return Resp(json.dumps({'combined_state': state,
                                    'sub_tasks': [{'state': state, 'error_message': 'sold'}]}).encode())
        if '/balance/deposit' in url:
            return Resp(json.dumps({'address': 'EQdeposit', 'memo': 'm1'}).encode())
        raise AssertionError(url)
    return opener


def buy(client, **extra):
    return client.post('/api/thermos/buy', headers=signed(43),
                       json={'gift_ids': [LOT], 'request_id': 'req-thermos-1', 'expected_total_ton': '2', **extra})


def balance(client):
    return client.get('/api/me', headers=signed(43)).json['balance']


def test_admin_token_is_encrypted_and_never_returned(client, monkeypatch):
    monkeypatch.setenv('CRAFTER_PORTALS_FERNET_KEY', Fernet.generate_key().decode())
    monkeypatch.delenv('THERMOS_API_TOKEN', raising=False)
    client.get('/api/me', headers=signed(43))
    assert client.post('/api/admin/thermos/token', headers=signed(43), json={'token': 'abcdefgh1234'}).status_code == 403
    r = client.post('/api/admin/thermos/token', headers=signed(), json={'token': 'abcdefgh1234'})
    assert r.status_code == 200 and r.json['token_configured'] is True and 'abcdefgh1234' not in json.dumps(r.json)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        stored = db.execute("SELECT payload FROM settings WHERE key='thermos_token_v1'").fetchone()[0]
    assert 'abcdefgh1234' not in stored


def test_check_shows_balance_and_deposit_address(wired, monkeypatch):
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api())
    r = wired.post('/api/admin/thermos/check', headers=signed(), json={})
    assert r.status_code == 200 and r.json['balance_ton'] == '10' and r.json['deposit_address'] == 'EQdeposit'


def test_buy_delivers_to_relayer_and_credits_inventory(wired, monkeypatch):
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    calls = []
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(calls=calls))
    r = buy(wired)
    assert r.status_code == 200 and r.json['status'] == 'complete', r.json
    sent = json.loads(next(c[2] for c in calls if c[1] == '/gifts/buy'))
    action = sent['gifts'][0]['action']
    assert action['type'] == 'WITHDRAW_OTHER' and action['recipient_telegram_id'] == 777
    assert sent['gifts'][0]['market_source'] == 'PORTALS' and sent['gifts'][0]['price'] == 2_000_000_000
    gifts = wired.get('/api/inventory', headers=signed(43)).json['gifts']
    assert [g['origin'] for g in gifts] == ['thermos']
    assert balance(wired).startswith('80')                       # 2 TON * 10 GRAM/TON reserved
    assert buy(wired).json['order_id'] == r.json['order_id']       # idempotent, no second purchase
    assert len([c for c in calls if c[1] == '/gifts/buy']) == 1


def test_buy_refused_when_thermos_balance_too_low_or_lot_gone(wired, monkeypatch):
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='1'))
    assert buy(wired).status_code == 409
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='10'))
    monkeypatch.setattr(thermos, 'gifts', lambda *a, **k: {'gifts': []})
    r = buy(wired, request_id='x')
    assert r.status_code in (400, 409) and balance(wired).startswith('100')


def test_failed_purchase_refunds_and_unknown_is_held(wired, monkeypatch):
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(buy='failure'))
    assert buy(wired).status_code == 409 and balance(wired).startswith('100')       # refunded
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(buy='network'))
    r = buy(wired, request_id='req-thermos-2')
    assert r.status_code == 409 and 'сверки' in r.json['error']
    assert balance(wired).startswith('80')                                          # reserve stays held
    with sqlite3.connect(wired.application.config['DATABASE']) as db:
        assert db.execute("SELECT status FROM thermos_orders WHERE request_id='req-thermos-2'").fetchone()[0] == 'review'


def test_games_can_buy_gate_uses_thermos_in_work_mode(wired, monkeypatch):
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    gate = wired.application.extensions['crafter_portals_can_buy']
    gift = {'id': LOT, 'collection_id': 'snoop', 'number': 7, 'price': '2', 'price_unit': 'TON'}
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='10'))
    with wired.application.app_context():
        gate(gift, 20)                                         # listed + funded: passes silently
        monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='0.5'))
        from werkzeug.exceptions import HTTPException
        with pytest.raises(HTTPException):
            gate(gift, 20)


def setup_upgrade(wired, monkeypatch, buy):
    from app import DEMO_GIFTS
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    monkeypatch.setattr(thermos, 'collections', lambda: [{'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '2', 'photo_url': ''}])
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(buy=buy))
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _n: 0)       # always a win
    stake = {**DEMO_GIFTS[1], 'id': 'stk-1', 'origin': 'local-purchase', 'price': '5.00', 'price_unit': 'GRAM'}
    with sqlite3.connect(wired.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (stake['id'], json.dumps(stake)))
    quote = wired.post('/api/upgrade/quote', headers=signed(43), json={
        'stake_id': 'stk-1', 'collection_id': 'snoop', 'listing_id': LOT})
    assert quote.status_code == 200, quote.json
    return quote.json['quote_id']


def spin(wired, quote_id):
    return wired.post('/api/upgrade', headers=signed(43), json={'quote_id': quote_id, 'request_id': 'up-1'})


def test_upgrade_win_buys_the_lot_on_thermos_for_real(wired, monkeypatch):
    result = spin(wired, setup_upgrade(wired, monkeypatch, 'success'))
    assert result.status_code == 200 and result.json['success'] is True and result.json['gift']['origin'] == 'thermos'
    ids = [g['origin'] for g in wired.get('/api/inventory', headers=signed(43)).json['gifts']]
    assert ids == ['thermos']                    # stake burned, purchased lot credited (waiting on the relayer)


def test_upgrade_win_with_failed_purchase_returns_the_stake(wired, monkeypatch):
    result = spin(wired, setup_upgrade(wired, monkeypatch, 'failure'))
    assert result.json['success'] is False and result.json['refunded'] is True
    ids = [g['id'] for g in wired.get('/api/inventory', headers=signed(43)).json['gifts']]
    assert ids == ['stk-1']


def test_work_mode_with_thermos_needs_no_portals_or_render_settings(wired, monkeypatch):
    """With Thermos as the market, WORK mode depends only on the Thermos token/balance and the relayer."""
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='5'))
    with sqlite3.connect(wired.application.config['DATABASE']) as db:
        db.execute("DELETE FROM settings WHERE key='purchase_mode_v1'")
    info = wired.get('/api/admin/purchase-mode', headers=signed()).json
    assert info['backend'] == 'thermos' and info['missing'] == [] and info['can_work'] is True
    r = wired.post('/api/admin/purchase-mode', headers=signed(), json={'mode': 'work', 'confirm': 'SET_PURCHASE_MODE'})
    assert r.status_code == 200 and r.json['mode'] == 'work'


def test_work_mode_with_thermos_explains_what_is_missing(wired, monkeypatch):
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='0'))
    monkeypatch.setitem(wired.application.extensions, 'crafter_relayer_credentials',
                        lambda: (_ for _ in ()).throw(ValueError('no relayer')))
    r = wired.post('/api/admin/purchase-mode', headers=signed(), json={'mode': 'work', 'confirm': 'SET_PURCHASE_MODE'})
    assert r.status_code == 409
    text = r.json['error']
    assert 'Relayer' in text and 'CRAFTER_PORTALS_LIVE_PURCHASES' not in text
    assert 'Баланс Thermos' not in text            # an empty Thermos balance never blocks WORK mode


def test_empty_thermos_balance_does_not_block_work_mode_and_players_get_a_generic_error(wired, monkeypatch):
    monkeypatch.setitem(wired.application.extensions, 'crafter_new_year_trade_conversion', lambda: 10)
    monkeypatch.setattr(thermos_market, 'urlopen', fake_api(balance_ton='0'))
    with sqlite3.connect(wired.application.config['DATABASE']) as db:
        db.execute("DELETE FROM settings WHERE key='purchase_mode_v1'")
    r = wired.post('/api/admin/purchase-mode', headers=signed(), json={'mode': 'work', 'confirm': 'SET_PURCHASE_MODE'})
    assert r.status_code == 200 and r.json['mode'] == 'work'
    bought = buy(wired)
    assert bought.status_code == 409 and bought.json['error'] == 'Ошибка покупки. Попробуйте позже.'
    assert balance(wired).startswith('100')                     # nothing was charged
