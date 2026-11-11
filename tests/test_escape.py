import hashlib
import sqlite3
from decimal import Decimal

import escape_game
from test_app import client, signed


def fund(client, uid, amount):
    assert client.get('/api/me', headers=signed(uid)).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(amount), uid))


def money(client, uid):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        return Decimal(db.execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()[0])


def play(client, uid, rid, bet='1', level='mid'):
    return client.post('/api/escape/play', headers=signed(uid), json={'bet': bet, 'level': level, 'request_id': rid})


def test_return_to_player_is_the_same_on_every_level():
    steps = {'lite': Decimal('0.10'), 'mid': Decimal('0.15'), 'epic': Decimal('0.20')}
    for level, setup in escape_game.LEVELS.items():
        assert setup['step'] == steps[level]
        assert abs(escape_game.green_chance(level) * escape_game.expected_multiplier(level) - escape_game.RTP) < 1e-9, level
    assert escape_game.play_round('seed', 'c', 0, 'lite')['multiplier'] == steps['lite'] * escape_game.play_round('seed', 'c', 0, 'lite')['bounces']


def test_round_is_provably_fair_and_settled_on_the_balance(client):
    fund(client, 701, 50)
    info = client.get('/api/escape/state', headers=signed(701)).json
    hash_before = info['hash']
    done = play(client, 701, 'escape-test-0001')
    assert done.status_code == 200
    r = done.json['round']
    assert hashlib_sha(r['seed']) == hash_before == r['hash']                 # the seed shown after the round matches the hash shown before it
    again = escape_game.play_round(r['seed'], r['client_seed'], r['nonce'], r['level'])
    assert again['bounces'] == r['bounces'] and again['win'] == r['win']      # and anybody can recompute the result
    assert done.json['next_hash'] != hash_before                              # the next round is committed to a new seed
    bet = Decimal('1')
    expected = Decimal('50') - bet + (Decimal(r['payout']) if r['win'] else 0)
    assert money(client, 701) == expected and Decimal(done.json['balance']) == expected
    assert Decimal(r['multiplier']) == Decimal('0.15') * r['bounces']                  # the game starts at 0x, Mid adds 0.15x per bounce


def hashlib_sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def test_same_request_is_not_charged_twice_and_limits_are_enforced(client):
    fund(client, 702, 10)
    first = play(client, 702, 'escape-test-0002')
    assert first.status_code == 200
    after = money(client, 702)
    repeat = play(client, 702, 'escape-test-0002')
    assert repeat.status_code == 200 and repeat.json['repeat'] is True and money(client, 702) == after
    assert play(client, 702, 'escape-test-0003', bet='0.01').status_code == 400
    assert play(client, 702, 'escape-test-0004', bet='500').status_code == 400
    assert play(client, 702, 'escape-test-0005', level='nope').status_code == 400
    fund(client, 703, '0.05')
    assert play(client, 703, 'escape-test-0006', bet='0.1').status_code == 409      # not enough GRAM


def test_history_stats_and_the_mode_switch(client):
    fund(client, 704, 20)
    assert play(client, 704, 'escape-test-0007').status_code == 200
    history = client.get('/api/escape/history', headers=signed(704)).json['rounds']
    assert len(history) == 1 and history[0]['seed']
    state = client.get('/api/escape/state', headers=signed(704)).json
    assert state['online'] >= 1 and {l['key'] for l in state['levels']} == {'lite', 'mid', 'epic'}
    admin = signed()
    off = client.post('/api/admin/modes', headers=admin, json={'mode': 'escape', 'enabled': False, 'confirm': 'SET_MODE'})
    assert off.status_code == 200
    assert client.get('/api/escape/state', headers=signed(704)).status_code == 503       # a disabled mode is blocked on the server
    assert client.get('/api/escape/state', headers=admin).status_code == 200              # administrators can still open it
