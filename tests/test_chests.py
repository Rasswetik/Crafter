from test_app import client, signed


def test_chest_default_and_open_by_shop_and_promo(client):
    admin, player = signed(42), signed(53)
    client.get('/api/me', headers=player)
    info = client.get('/api/chests/gingerbread', headers=player).json
    assert info['loot']
    item = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'CHEST', 'amount': 'gingerbread', 'price_balls': 0, 'size': 'small'})
    assert item.status_code == 200, item.get_data(as_text=True)
    items = client.get('/api/shop-items', headers=player).json['items']
    lot = next(x for x in items if x['kind'] == 'CHEST')
    assert lot['chest']['id'] == 'gingerbread' and lot['title'] == 'Ginger Box'
    bought = client.post('/api/shop-items/buy', headers=player, json={'item_id': lot['id'], 'request_id': 'chest-req-0001'})
    assert bought.status_code == 200, bought.get_data(as_text=True)
    opened = bought.json['chest_open']
    assert 1 <= len(opened['items']) <= 6
    again = client.post('/api/shop-items/buy', headers=player, json={'item_id': lot['id'], 'request_id': 'chest-req-0001'}).json
    assert again['chest_open']['items'] == opened['items']          # the same request gives the same result, nothing is rolled twice
    code = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'CHEST', 'reward': 'gingerbread', 'limit': 1})
    assert code.status_code == 200, code.get_data(as_text=True)
    red = client.post('/api/promocodes/redeem', headers=player, json={'code': code.json['code']})
    assert red.status_code == 200 and red.json['chest_open']['items']


def test_chest_admin_validation_and_preview(client):
    admin = signed(42)
    bad = client.post('/api/admin/new-year/chests', headers=admin, json={'title': 'x', 'rolls': {'1': 1}, 'loot': []})
    assert bad.status_code == 400
    ok = client.post('/api/admin/new-year/chests', headers=admin, json={'title': 'Тест', 'rolls': {'2': 1}, 'enabled': True,
                     'loot': [{'kind': 'BALL', 'amount': '5-9', 'weight': 1}, {'kind': 'GRAM', 'amount': '0.1', 'weight': 1}]})
    assert ok.status_code == 200, ok.get_data(as_text=True)
    prev = client.post('/api/admin/new-year/chests/%s/preview' % ok.json['id'], headers=admin).json
    assert len(prev['items']) == 2 and prev['preview']
    assert client.post('/api/admin/new-year/chests/%s/delete' % ok.json['id'], headers=admin).status_code == 200


def test_ginger_box_follows_the_drop_sheet(client):
    admin, player = signed(42), signed(55)
    client.get('/api/me', headers=player)
    info = client.get('/api/chests/gingerbread', headers=player).json
    assert [r['count'] for r in info['rolls']] == [3, 4, 5, 6] and [r['chance'] for r in info['rolls']] == [50, 30, 15, 5]
    once = {(x['kind'], x['amount']): x['chance'] for x in info['loot']}
    assert abs(once[('GRAM', '0.1')] - 49.8047) < .01 and abs(once[('BALL', '5')] - 34.5575) < .01
    assert abs(once[('NFT', 'santahat:Warm Winter')] - 0.1935) < .001 and abs(once[('NFT', 'gingercookie:Original')] - 0.0161) < .001
    assert not [x for x in info['loot'] if x['kind'] == 'PACK' and x['amount'] in ('gifton', 'goshan', 'nikolay')]
    assert abs(sum(x['chance'] for x in info['loot'] if x['kind'] == 'NFT') - 1.0742) > 0       # the sum is not a probability: several can drop together
    for _ in range(40):
        res = client.post('/api/admin/new-year/chests/gingerbread/preview', headers=admin).json
        kinds = [i['kind'] for i in res['items']]
        assert 3 <= len(kinds) <= 6 and kinds[0] == 'GRAM' and kinds[1] == 'BALL' and kinds[2] in ('PACK', 'NFT')


def test_direct_nft_goes_to_the_inventory(client):
    admin, player = signed(42), signed(56)
    client.get('/api/me', headers=player)
    made = client.post('/api/admin/new-year/chests', headers=admin, json={'title': 'NFT', 'rolls': {'1': 1}, 'enabled': True, 'settings': {'guaranteed': ['PACK'], 'bonus': {'PACK': 1}},
                       'loot': [{'kind': 'NFT', 'amount': 'santahat:Warm Winter', 'weight': 1}]})
    assert made.status_code == 200, made.get_data(as_text=True)
    code = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'CHEST', 'reward': made.json['id'], 'limit': 1}).json['code']
    got = client.post('/api/promocodes/redeem', headers=player, json={'code': code}).json['chest_open']['items'][0]
    assert got['kind'] == 'NFT' and got['title'] == 'Warm Winter' and got['collection'] == 'Santa Hat' and got['nft_id']
    assert client.post('/api/admin/new-year/chests', headers=admin, json={'title': 'bad', 'rolls': {'1': 1}, 'loot': [{'kind': 'NFT', 'amount': 'nope:x', 'weight': 1}]}).status_code == 400


def test_snowman_box_follows_its_sheet(client):
    admin, player = signed(42), signed(57)
    client.get('/api/me', headers=player)
    info = client.get('/api/chests/snowman', headers=player).json
    once = {(x['kind'], x['amount']): x['chance'] for x in info['loot']}
    assert info['chest']['title'] == 'Snowman Box' and info['chest']['bg_collection']
    assert abs(once[('GRAM', '0.1')] - 49.060744) < .01 and abs(once[('PACK', 'snowman')] - 26.667351) < .01
    assert abs(once[('NFT', 'vicecream:Iceman')] - 0.359309) < .001 and abs(once[('NFT', 'snowmittens:Mistletoe')] - 0.022497) < .001
    assert not [x for x in info['loot'] if x['amount'] in ('gifton', 'goshan', 'nikolay')]
    for _ in range(60):
        kinds = [i['kind'] for i in client.post('/api/admin/new-year/chests/snowman/preview', headers=admin).json['items']]
        assert 3 <= len(kinds) <= 6 and kinds[:3] == ['GRAM', 'BALL', 'PACK']
