from test_app import client, signed


def test_chain_steps_are_taken_in_order(client):
    admin, player = signed(42), signed(60)
    client.get('/api/me', headers=player)
    made = client.post('/api/admin/new-year/chains', headers=admin, json={'title': 'Цепочка', 'subtitle': 'Заберите всё', 'enabled': True, 'steps': [
        {'label': 'Шаг 1', 'kind': 'GRAM', 'amount': '0.5', 'price_balls': 0},
        {'label': 'Шаг 2', 'kind': 'BALL', 'amount': '100', 'price_balls': 0},
        {'label': 'Шаг 3', 'kind': 'CHEST', 'amount': 'gingerbread', 'price_balls': 100000},
        {'label': 'Шаг 4', 'kind': 'NFT', 'amount': 'santahat:Warm Winter', 'price_balls': 0}]})
    assert made.status_code == 200, made.get_data(as_text=True)
    chain = client.get('/api/chains', headers=player).json['chains'][0]
    states = [s['state'] for s in chain['steps']]
    assert states == ['ready', 'locked', 'locked', 'locked'] and chain['total'] == 4
    s1, s2, s3, s4 = [s['id'] for s in chain['steps']]
    assert client.post('/api/chains/claim', headers=player, json={'step_id': s2}).status_code == 409       # not in order
    first = client.post('/api/chains/claim', headers=player, json={'step_id': s1})
    assert first.status_code == 200 and first.json['result']['kind'] == 'GRAM'
    assert client.post('/api/chains/claim', headers=player, json={'step_id': s1}).json['again']            # taken twice: nothing more is given
    assert client.post('/api/chains/claim', headers=player, json={'step_id': s2}).status_code == 200
    broke = client.post('/api/chains/claim', headers=player, json={'step_id': s3})
    assert broke.status_code == 409                                                                       # not enough balls for the paid step
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '60', 'balls': '200000', 'donate': '0', 'tinsel': '0'})
    paid = client.post('/api/chains/claim', headers=player, json={'step_id': s3})
    assert paid.status_code == 200 and paid.json['chest_open']['items']
    last = client.post('/api/chains/claim', headers=player, json={'step_id': s4})
    assert last.status_code == 200 and last.json['nft']['nft_id']
    after = client.get('/api/chains', headers=player).json['chains'][0]
    assert after['done'] == 4 and [s['state'] for s in after['steps']] == ['done'] * 4


def test_chain_admin_checks(client):
    admin = signed(42)
    bad = client.post('/api/admin/new-year/chains', headers=admin, json={'title': 'x', 'steps': [{'kind': 'PACK', 'amount': 'nope'}]})
    assert bad.status_code == 400
    assert client.post('/api/admin/new-year/chains', headers=admin, json={'title': '', 'steps': []}).status_code == 400


def test_a_step_holds_several_prizes(client):
    admin, player = signed(42), signed(61)
    client.get('/api/me', headers=player)
    made = client.post('/api/admin/new-year/chains', headers=admin, json={'title': 'Много призов', 'enabled': True, 'steps': [
        {'label': 'Шаг 1', 'price_balls': 0, 'rewards': [
            {'kind': 'PACK', 'amount': 'newyear', 'count': 2}, {'kind': 'CHEST', 'amount': 'snowman', 'count': 2}, {'kind': 'GRAM', 'amount': '1.5'}, {'kind': 'BALL', 'amount': '50'},
            {'kind': 'NFT', 'amount': 'santahat:Warm Winter'}]}]})
    assert made.status_code == 200, made.get_data(as_text=True)
    step = client.get('/api/chains', headers=player).json['chains'][0]['steps'][0]
    assert len(step['rewards']) == 5 and 'Ящик' not in step['reward_title'] and step['reward_title'].count('+') == 4
    before = client.get('/api/me', headers=player).json
    got = client.post('/api/chains/claim', headers=player, json={'step_id': step['id']})
    assert got.status_code == 200, got.get_data(as_text=True)
    d = got.json
    assert len(d['pack_ids']) == 2 and len(d['chest_opens']) == 2 and d['nft']['nft_id'] and len(d['result']['rewards']) == 5
    assert client.post('/api/admin/new-year/chains', headers=admin, json={'title': 'x', 'steps': [{'rewards': []}]}).status_code == 400
    assert client.post('/api/admin/new-year/chains', headers=admin, json={'title': 'x', 'steps': [{'rewards': [{'kind': 'CHEST', 'amount': 'nope'}]}]}).status_code == 400
