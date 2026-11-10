import time

from test_app import client, signed


def test_section_locks_and_hidden_admin(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    assert client.get('/api/new-year/locks', headers=player).json['locks'] == {}
    soon = int(time.time()) + 3 * 86400
    assert client.post('/api/admin/new-year/locks', headers=player, json={'locks': {'advent': soon}}).status_code == 403
    assert client.post('/api/admin/new-year/locks', headers=admin, json={'locks': {'advent': soon, 'community': 'x'}}).status_code == 400
    assert client.post('/api/admin/new-year/locks', headers=admin, json={'locks': {'advent': soon}}).status_code == 200
    assert client.get('/api/new-year/locks', headers=player).json['locks'] == {'advent': soon}
    client.post('/api/admin/new-year/locks', headers=admin, json={'locks': {}})
    assert client.get('/api/new-year/locks', headers=player).json['locks'] == {}
    assert client.get('/api/me', headers=admin).json['admin_hidden'] is False
    assert client.post('/api/admin/ui/admin-hidden', headers=admin, json={'hidden': True}).status_code == 200
    assert client.get('/api/me', headers=admin).json['admin_hidden'] is True
    assert client.get('/api/me', headers=player).json['admin_hidden'] is False


def test_advent_cells_have_shapes_extras_and_order(client):
    admin = signed(42)
    state = client.get('/api/admin/new-year/advent', headers=admin).json
    days = {d['day']: d for d in state['days']}
    assert state['shapes'] == ['sq', 'wide', 'tall', 'big'] and len({d['shape'] for d in days.values()}) == 4
    assert days[7]['extra'] and days[1]['kind'] == 'BALL' and int(days[1]['amount']) <= 50
    save = lambda day, **kw: client.post('/api/admin/new-year/advent/days/%d' % day, headers=admin, json={'kind': 'BALL', 'amount': '5', **kw})
    assert save(3, shape='cube').status_code == 400
    assert save(3, shape='wide', extra=[{'kind': 'GRAM', 'amount': '0.5'}, {'kind': 'BALL', 'amount': '7'}]).status_code == 200
    assert save(3, shape='wide', extra=[{'kind': 'GRAM', 'amount': 'bad'}]).status_code == 400
    again = {d['day']: d for d in client.get('/api/admin/new-year/advent', headers=admin).json['days']}
    assert again[3]['shape'] == 'wide' and [x['kind'] for x in again[3]['extra']] == ['GRAM', 'BALL']
    assert client.post('/api/admin/new-year/advent/days/3/move', headers=admin, json={'direction': 'up'}).status_code == 200
    order = [d['day'] for d in client.get('/api/admin/new-year/advent', headers=admin).json['days']]
    assert order[:3] == [1, 3, 2]
