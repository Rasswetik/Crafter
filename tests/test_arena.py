import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import arena
from test_app import client, signed


def prepare(client, uid, amount):
    assert client.get('/api/me', headers=signed(uid)).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (amount, uid))
        db.execute('INSERT INTO wallet_balances VALUES(?,?,?)', (uid, 'mainnet', amount))


def add_gift(client, uid):
    gift = {'id': 'telegram-arena-7', 'name': 'Arena Test', 'collection_id': 'arena-test',
            'number': 7, 'price': '0', 'origin': 'telegram-deposit', 'price_unit': 'TON',
            'telegram_url': 'https://t.me/nft/arena-7'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (?,?,?,'unlisted')", (uid, gift['id'], json.dumps(gift)))
        catalog = [{'name': gift['name'], 'floor_price': '3'}]
        db.execute('INSERT INTO cache VALUES(?,?,?)', ('collections', json.dumps(catalog), 1))
    return gift['id']


def status(client, uid):
    response = client.get('/api/arena', headers=signed(uid))
    assert response.status_code == 200, response.json
    return response.json


def stake(client, uid, round_id, request_id, amount='0', gifts=None):
    return client.post('/api/arena/stake', headers=signed(uid), json={
        'round_id': round_id, 'request_id': request_id, 'amount': amount, 'gift_ids': gifts or [],
    })


def test_round_draw_and_concurrent_settlement(client, monkeypatch):
    now = 1_000_000
    monkeypatch.setattr(arena, 'clock', lambda: now)
    monkeypatch.setattr(arena.secrets, 'randbelow', lambda total: total - 1)
    prepare(client, 42, '10')
    prepare(client, 43, '2')
    nft = add_gift(client, 42)
    round_id = status(client, 42)['round_id']
    assert client.get('/api/arena/gifts', headers=signed()).json['gifts'][0]['value'] == 3_000_000
    first = stake(client, 42, round_id, 'first', '1', [nft])
    assert first.status_code == 200, first.json
    assert first.json['phase'] == 'waiting'
    assert first.json['bank'] == '4.000000'
    assert client.get('/api/inventory', headers=signed()).json['gifts'] == []
    assert stake(client, 42, round_id, 'second', '0', [nft]).status_code == 409

    now += 2_000
    second = stake(client, 43, round_id, 'all-in', 'all')
    assert second.status_code == 200, second.json
    assert second.json['bet_until'] == now + 15_000
    assert [player['chance'] for player in second.json['players']] == [66.6667, 33.3333]
    assert Decimal(second.json['balance']) == 0
    assert stake(client, 43, round_id, 'all-in', 'all').json['bank'] == '6.000000'
    assert stake(client, 43, round_id, 'all-in', '0.1').status_code == 409
    assert client.post('/api/arena/cancel', headers=signed(), json={'round_id': round_id}).status_code == 409

    now += 15_000
    assert stake(client, 42, round_id, 'late', '1').status_code == 409
    playing = status(client, 42)
    assert playing['phase'] == 'playing' and playing['target'] is None
    now += arena.AIM_MS
    assert status(client, 42)['target'] == '43'
    now += arena.FLIGHT_MS
    assert Decimal(status(client, 43)['balance']) == 0

    now += arena.FINISH_MS
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda uid: status(client.application.test_client(), uid), (42, 43)))
    assert all(result['phase'] == 'result' for result in results)
    winner = results[1]['last_result']
    assert winner['winner']['id'] == '43'
    assert winner['gram'] == '3.000000'
    assert Decimal(results[1]['balance']) == 3
    assert [gift['id'] for gift in client.get('/api/inventory', headers=signed(43)).json['gifts']] == [nft]
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        assert db.execute("SELECT COUNT(*) FROM history WHERE kind='arena_result'").fetchone()[0] == 2
        assert Decimal(db.execute('SELECT gram FROM wallet_balances WHERE user_id=43').fetchone()[0]) == 2

    now += arena.RESULT_MS
    retry = stake(client, 43, round_id, 'all-in', 'all')
    assert retry.status_code == 200 and retry.json['round_id'] == round_id + 1
    assert retry.json['last_result'] == winner
    assert Decimal(retry.json['balance']) == 3


def test_waiting_refunds_restore_escrow_on_timeout_or_cancel(client, monkeypatch):
    now = 1_000_000
    monkeypatch.setattr(arena, 'clock', lambda: now)
    prepare(client, 42, '2')
    nft = add_gift(client, 42)
    round_id = status(client, 42)['round_id']
    for automatic in (True, False):
        result = stake(client, 42, round_id, 'first', '0.5', [nft])
        assert result.status_code == 200 and result.json['can_cancel']
        assert Decimal(result.json['balance']) == Decimal('1.5')
        if automatic:
            now += arena.WAIT_MS
            refunded = status(client, 42)
        else:
            response = client.post('/api/arena/cancel', headers=signed(), json={'round_id': round_id})
            assert response.status_code == 200, response.json
            refunded = response.json
        round_id += 1
        assert refunded['round_id'] == round_id and refunded['bank'] == '0.000000'
        assert Decimal(refunded['balance']) == 2
        assert client.get('/api/inventory', headers=signed()).json['gifts'][0]['status'] == 'unlisted'
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            assert Decimal(db.execute('SELECT gram FROM wallet_balances WHERE user_id=42').fetchone()[0]) == 2


def test_quick_gift_rechecks_cheapest_and_price_without_double_staking(client, monkeypatch):
    monkeypatch.setattr(arena, 'clock', lambda: 1_000_000)
    prepare(client, 42, '2')
    nft = add_gift(client, 42)
    second = {'id': 'arena-valuable', 'name': 'Valuable Gift', 'number': 8,
              'price': '4', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (?,?,?,'unlisted')", (42, second['id'], json.dumps(second)))
    round_id = status(client, 42)['round_id']
    assert [gift['id'] for gift in client.get('/api/arena/gifts', headers=signed()).json['gifts']] == [nft, second['id']]

    def quick(gift_id, value, request_id):
        return client.post('/api/arena/stake', headers=signed(), json={
            'round_id': round_id, 'request_id': request_id, 'amount': '0',
            'gift_ids': [gift_id], 'quick_value': value,
        })

    assert quick(second['id'], 4_000_000, 'wrong-gift').status_code == 409
    assert quick(nft, 2_000_000, 'old-value').status_code == 409
    accepted = quick(nft, 3_000_000, 'first')
    assert accepted.status_code == 200, accepted.json
    assert accepted.json['bank'] == '3.000000'
    assert quick(nft, 3_000_000, 'first').json['bank'] == '3.000000'
    assert quick(nft, 3_000_000, 'duplicate').status_code == 409
    assert quick(second['id'], 4_000_000, 'next').json['bank'] == '7.000000'
    assert client.get('/api/arena/gifts', headers=signed()).json['gifts'] == []
    assert Decimal(status(client, 42)['balance']) == 2
