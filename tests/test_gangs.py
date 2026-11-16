import json
import sqlite3
import time

from test_app import client, signed
from test_pass import add_history
from gangs import week_bounds


def enable(client, admin, **over):
    cfg = client.get('/api/admin/gangs', headers=admin).json['settings']
    cfg.update(enabled=True, **over)
    res = client.post('/api/admin/gangs', headers=admin, json=cfg)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.json


def history_at(client, uid, kind, created, n=1):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for i in range(n):
            db.execute("INSERT INTO history(id,user_id,kind,payload,created) VALUES(?,?,?,?,?)", ('g%s%s%d%d' % (kind, uid, i, time.time_ns()), uid, kind, '{}', created))


def set_joined(client, uid, joined):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("UPDATE gang_members SET joined=? WHERE user_id=?", (joined, uid))


def test_off_until_enabled_then_join_and_switch(client):
    admin, p = signed(42), signed(91)
    client.get('/api/me', headers=p)
    st = client.get('/api/gangs', headers=p).json
    assert st['enabled'] is False and 'gangs' not in st
    assert client.post('/api/gangs/join', headers=p, json={'gang': 'goshan'}).status_code == 409
    assert client.post('/api/admin/gangs', headers=p, json={}).status_code in (401, 403)
    enable(client, admin)
    assert client.post('/api/gangs/join', headers=p, json={'gang': 'bandit'}).status_code == 400
    st = client.post('/api/gangs/join', headers=p, json={'gang': 'goshan'}).json
    assert st['me']['gang'] == 'goshan' and [x['id'] for x in st['gangs']] == ['goshan', 'nikolay'] and len(st['districts']) == 6
    assert client.post('/api/gangs/join', headers=p, json={'gang': 'nikolay'}).json['me']['gang'] == 'nikolay'      # no points yet: can switch
    add_history(client, 91, 'arena_result', {}, n=2)
    add_history(client, 91, 'arena_result', {}, n=2)
    client.get('/api/gangs', headers=p)
    assert client.post('/api/gangs/join', headers=p, json={'gang': 'goshan'}).status_code == 409      # the first points are in: the gang cannot be changed


def test_points_districts_daily_cap_and_underdog(client):
    admin = signed(42)
    a, b, c = signed(92), signed(93), signed(94)
    for h in (a, b, c):
        client.get('/api/me', headers=h)
    enable(client, admin, daily_cap=10)
    client.post('/api/gangs/join', headers=a, json={'gang': 'goshan'})
    client.post('/api/gangs/join', headers=b, json={'gang': 'goshan'})
    client.post('/api/gangs/join', headers=c, json={'gang': 'nikolay'})
    add_history(client, 92, 'arena_result', {}, n=2)          # 6 points, Downtown
    add_history(client, 93, 'pack_open', {}, n=20)            # 40 raw points, capped at 10, Ocean Beach
    add_history(client, 94, 'pack_open', {}, n=1)             # 2 points, Ocean Beach
    st = client.get('/api/gangs', headers=a).json
    goshan, nikolay = st['gangs']
    assert goshan['members'] == 2 and nikolay['members'] == 1
    assert goshan['raw'] == 16 and nikolay['raw'] == 2                               # the cap cut the 40 points of the second player
    assert nikolay['mult'] == 1.5 and nikolay['points'] == 3                         # the smaller gang gets the multiplier (limited by 150%)
    by = {d['key']: d for d in st['districts']}
    assert by['downtown']['owner'] == 'goshan' and by['beach']['owner'] == 'goshan' and by['port']['owner'] == ''
    assert st['me']['gang'] == 'goshan' and st['me']['points'] == 6 and st['me']['rank_in_gang'] == 2


def test_finished_war_is_summed_up_once_and_prizes_are_taken_once(client):
    admin, w, l = signed(42), signed(95), signed(96)
    for h in (w, l):
        client.get('/api/me', headers=h)
    enable(client, admin)
    client.post('/api/gangs/join', headers=w, json={'gang': 'goshan'})
    client.post('/api/gangs/join', headers=l, json={'gang': 'nikolay'})
    start, _ = week_bounds(int(time.time()))
    prev = start - 3 * 86400                                  # the middle of the last week
    set_joined(client, 95, prev - 86400)
    set_joined(client, 96, prev - 86400)
    history_at(client, 95, 'arena_result', prev, n=30)       # 90 raw points in a day, capped at 300 -> 90
    history_at(client, 96, 'pack_open', prev, n=5)           # 10 points
    st = client.get('/api/gangs', headers=w).json
    assert len(st['claims']) == 1 and st['claims'][0]['won'] is True and st['claims'][0]['rewards']
    assert client.get('/api/gangs', headers=l).json['claims'][0]['won'] is False
    war = st['claims'][0]['war']
    res = client.post('/api/gangs/claim', headers=w, json={'war': war})
    assert res.status_code == 200 and res.json['given']['items']
    assert client.post('/api/gangs/claim', headers=w, json={'war': war}).status_code == 409
    assert client.get('/api/gangs', headers=w).json['claims'][0]['claimed'] is True
    assert client.post('/api/gangs/claim', headers=signed(97), json={'war': war}).status_code == 404
    leaders = client.get('/api/gangs/leaders', headers=w).json
    assert 'top' in leaders and set(leaders['gangs']) == {'goshan', 'nikolay'}


def test_too_few_points_gets_no_prize_and_admin_validation(client):
    admin, p = signed(42), signed(98)
    client.get('/api/me', headers=p)
    enable(client, admin)
    client.post('/api/gangs/join', headers=p, json={'gang': 'nikolay'})
    start, _ = week_bounds(int(time.time()))
    prev = start - 3 * 86400
    set_joined(client, 98, prev - 86400)
    history_at(client, 98, 'sale', prev, n=2)                 # 2 points, the minimum is 20
    st = client.get('/api/gangs', headers=p).json
    assert st['claims'][0]['rewards'] == [] and client.post('/api/gangs/claim', headers=p, json={'war': st['claims'][0]['war']}).status_code == 409
    cfg = client.get('/api/admin/gangs', headers=admin).json['settings']
    assert client.post('/api/admin/gangs', headers=admin, json=dict(cfg, daily_cap='abc')).status_code == 400
    assert client.post('/api/admin/gangs', headers=admin, json=dict(cfg, underdog_max=50)).status_code == 400
    assert client.post('/api/admin/gangs', headers=admin, json=dict(cfg, win_reward=[{'kind': 'PACK', 'amount': 'no-such', 'count': 1}])).status_code == 400


def test_sleeping_accounts_do_not_give_the_other_gang_a_bonus(client):
    admin = signed(42)
    players = [signed(100 + i) for i in range(5)]
    for h in players:
        client.get('/api/me', headers=h)
    enable(client, admin)
    for h in players[:4]:
        client.post('/api/gangs/join', headers=h, json={'gang': 'goshan'})
    client.post('/api/gangs/join', headers=players[4], json={'gang': 'nikolay'})
    add_history(client, 100, 'arena_result', {}, n=2)          # one active player in Goshan, three sleeping ones
    add_history(client, 104, 'arena_result', {}, n=2)          # one active player in Nikolay
    st = client.get('/api/gangs', headers=players[0]).json
    assert st['gangs'][0]['members'] == 4 and st['gangs'][1]['members'] == 1
    assert st['gangs'][1]['mult'] == 1.0 and st['gangs'][0]['points'] == st['gangs'][1]['points'] == 6
