from test_app import client, signed


def enable(client, admin, **over):
    cfg = client.get('/api/admin/island', headers=admin).json['settings']
    cfg.update(enabled=True, **over)
    res = client.post('/api/admin/island', headers=admin, json=cfg)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.json


def play(client, headers, cashout_after=None):
    """Walks the island choosing the first open place until the run ends. Returns the last answer."""
    last = None
    for _ in range(80):
        st = client.get('/api/island', headers=headers).json['run']
        if not st:
            return last
        if st['pending']:
            p = st['pending']
            choice = 'leave' if p['type'] == 'merchant' else 0
            res = client.post('/api/island/choose', headers=headers, json={'choice': choice})
        else:
            if cashout_after and st['depth'] >= cashout_after and st['can_cashout']:
                return client.post('/api/island/cashout', headers=headers, json={})
            node = next(n for n in st['nodes'] if n['state'] == 'open')
            res = client.post('/api/island/step', headers=headers, json={'node': node['id']})
        assert res.status_code == 200, res.get_data(as_text=True)
        last = res
        if res.json.get('end'):
            return res
    raise AssertionError('the run did not end')


def test_closed_by_default_and_one_run_at_a_time(client):
    admin, p = signed(42), signed(81)
    client.get('/api/me', headers=p)
    st = client.get('/api/island', headers=p).json
    assert st['enabled'] is False and st['tickets'] >= 1 and len(st['relics']) == 12
    assert client.post('/api/island/start', headers=p, json={}).status_code == 409
    assert client.post('/api/admin/island', headers=p, json={}).status_code in (401, 403)
    enable(client, admin)
    assert client.post('/api/island/start', headers=p, json={}).status_code == 200
    assert client.post('/api/island/start', headers=p, json={}).status_code == 409


def test_map_is_valid_and_run_ends_with_one_payout(client):
    admin, p = signed(42), signed(82)
    client.get('/api/me', headers=p)
    enable(client, admin)
    for _ in range(3):
        client.post('/api/admin/island/tickets', headers=admin, json={'user_id': 82, 'amount': 3})
        started = client.post('/api/island/start', headers=p, json={})
        assert started.status_code == 200, started.get_data(as_text=True)
        run = started.json['run']
        nodes = {n['id']: n for n in run['nodes']}
        assert max(n['row'] for n in nodes.values()) == 8 and sum(1 for n in nodes.values() if n['type'] == 'boss') == 1
        assert all(2 <= sum(1 for m in nodes.values() if m['row'] == r) <= 3 for r in range(1, 8))
        for n in nodes.values():
            if n['row'] < 8:
                assert n['next'] and all(x in nodes and nodes[x]['row'] == n['row'] + 1 for x in n['next'])
        assert all(any(m['id'] in n['next'] for n in nodes.values()) for m in nodes.values() if m['row'] > 1)
        assert sum(1 for n in nodes.values() if n['state'] == 'open') == sum(1 for n in nodes.values() if n['row'] == 1)
        res = play(client, p)
        assert res.json['end']['status'] in ('dead', 'won')
        assert client.get('/api/island', headers=p).json['run'] is None
        assert client.post('/api/island/cashout', headers=p, json={}).status_code == 404


def test_cannot_skip_places_and_cashout_needs_loot(client):
    admin, p = signed(42), signed(83)
    client.get('/api/me', headers=p)
    enable(client, admin)
    run = client.post('/api/island/start', headers=p, json={}).json['run']
    far = next(n for n in run['nodes'] if n['row'] == 5)
    assert client.post('/api/island/step', headers=p, json={'node': far['id']}).status_code == 409
    assert client.post('/api/island/cashout', headers=p, json={}).status_code == 409
    res = play(client, p, cashout_after=2)
    assert res.status_code == 200
    end = res.json.get('end')
    assert end is None or end['status'] in ('cashed', 'dead', 'won')


def test_tickets_equip_and_leaders(client):
    admin, p = signed(42), signed(84)
    client.get('/api/me', headers=p)
    enable(client, admin, ticket_price=0)
    t = client.get('/api/island', headers=p).json['tickets']
    assert client.post('/api/island/ticket', headers=p, json={}).json['tickets'] == t + 1
    for _ in range(10):
        if client.post('/api/island/ticket', headers=p, json={}).status_code == 409:
            break
    else:
        raise AssertionError('no ticket limit')
    assert client.post('/api/island/equip', headers=p, json={'ids': ['shield']}).json['equipped'] == []
    client.post('/api/island/start', headers=p, json={})
    play(client, p)
    leaders = client.get('/api/island/leaders', headers=p).json
    assert leaders['leaders'] and leaders['me']['rank'] == 1 and leaders['prizes']['1'][0]['kind'] == 'BALL'
    assert client.post('/api/admin/island/payout', headers=admin, json={}).status_code in (200, 409)


def test_admin_validation(client):
    admin = signed(42)
    cfg = client.get('/api/admin/island', headers=admin).json['settings']
    assert client.post('/api/admin/island', headers=admin, json=dict(cfg, lives=0)).status_code == 400
    assert client.post('/api/admin/island', headers=admin, json=dict(cfg, loot={'0': [], '1': cfg['loot']['1'], '2': cfg['loot']['2']})).status_code == 400
    assert client.post('/api/admin/island', headers=admin, json=dict(cfg, boss_rewards=[{'kind': 'PACK', 'amount': 'no-such-pack', 'count': 1}])).status_code == 400
