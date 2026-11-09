import sqlite3
import time
import uuid

from test_app import client, signed


def add_history(client, kind, count):
    with sqlite3.connect(client.application.config['DATABASE']) as con:
        for _ in range(count):
            con.execute('INSERT INTO history VALUES(?,?,?,?,?)', (uuid.uuid4().hex, 50, kind, '{}', int(time.time())))


def setup_event(client, enabled=True):
    admin = signed(42)
    assert client.post('/api/admin/new-year/community', headers=admin, json={
        'title': 'Крафтим вместе', 'description': 'Общая цель', 'metric': 'craft',
        'target': '10', 'enabled': enabled}).status_code == 200
    ids = {}
    for threshold, kind, amount, supply, price in ((3, 'GRAM', '1', 2, 0), (10, 'BALL', '500', 5, 20)):
        made = client.post('/api/admin/new-year/community/milestones', headers=admin, json={
            'title': 'Награда %d' % threshold, 'threshold': threshold, 'reward_kind': kind,
            'reward_amount': amount, 'supply': supply, 'price_balls': price})
        assert made.status_code == 200, made.json
        ids[threshold] = made.json['id']
    return ids


def test_permissions_and_hidden_until_enabled(client):
    player = signed(43)
    client.get('/api/me', headers=player)
    assert client.get('/api/admin/new-year/community', headers=player).status_code == 403
    assert client.get('/api/community', headers=player).json == {'event': None}
    setup_event(client, enabled=False)
    assert client.get('/api/community', headers=player).json == {'event': None}
    assert client.get('/api/community', headers=signed(42)).json['event']['title'] == 'Крафтим вместе'


def test_progress_reached_and_claim_flow(client):
    client.application.config['COMMUNITY_CACHE_SECONDS'] = 0
    ids = setup_event(client)
    player, other = signed(43), signed(44)
    client.get('/api/me', headers=player)
    client.get('/api/me', headers=other)
    state = client.get('/api/community', headers=player).json
    assert state['progress'] == 0 and not state['milestones'][0]['reached']
    claim = lambda who, mid, rid='request-0001': client.post('/api/community/claim', headers=who, json={'milestone_id': mid, 'request_id': rid})
    assert claim(player, ids[3]).status_code == 409          # not reached

    add_history(client, 'craft', 3)
    add_history(client, 'upgrade', 5)                          # other metric ignored
    state = client.get('/api/community', headers=player).json
    assert state['progress'] == 3 and state['milestones'][0]['reached'] and state['milestones'][0]['reached_at']
    assert not state['milestones'][1]['reached']

    first = claim(player, ids[3])
    assert first.status_code == 200 and first.json['code'].startswith('NY-')
    again = claim(player, ids[3], 'request-0002')
    assert again.json['code'] == first.json['code']            # one per player
    second = claim(other, ids[3])
    assert second.json['code'] != first.json['code']           # unique codes
    client.get('/api/me', headers=signed(46))
    assert claim(signed(46), ids[3]).status_code == 409        # supply of 2 is exhausted
    assert client.get('/api/community', headers=player).json['milestones'][0]['left'] == 0

    # only the buyer can activate; one activation
    assert client.post('/api/promocodes/redeem', headers=other, json={'code': first.json['code']}).status_code == 403
    done = client.post('/api/promocodes/redeem', headers=player, json={'code': first.json['code']})
    assert done.status_code == 200 and done.json['reward'] == '1'
    assert client.post('/api/promocodes/redeem', headers=player, json={'code': first.json['code']}).status_code == 409


def test_paid_reward_debits_balls(client):
    client.application.config['COMMUNITY_CACHE_SECONDS'] = 0
    ids = setup_event(client)
    player = signed(43)
    client.get('/api/me', headers=player)
    add_history(client, 'craft', 10)
    claim = lambda: client.post('/api/community/claim', headers=player, json={'milestone_id': ids[10], 'request_id': 'paid-request-1'})
    assert claim().status_code == 409                          # no balls yet
    assert client.post('/api/admin/new-year/wallet', headers=signed(42), json={'user_id': 43, 'balls': '25'}).status_code == 200
    got = claim()
    assert got.status_code == 200 and got.json['balance']['balls'] == 5
    assert client.get('/api/community', headers=player).json['milestones'][1]['code'] == got.json['code']
    mid = ids[10]
    assert client.post('/api/admin/new-year/community/milestones/' + mid + '/delete', headers=signed(42)).status_code == 409
