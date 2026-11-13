from test_app import client, signed


def _wallet(client, admin, uid, balls):
    r = client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': str(uid), 'balls': str(balls), 'donate': '0', 'tinsel': '0'})
    assert r.status_code == 200, r.get_data(as_text=True)


def _balls(client, uid):
    return client.get('/api/new-year', headers=signed(uid)).json['balance']['balls']


def test_exchange_author_code_and_reward(client):
    admin, player, author = signed(42), signed(43), signed(44)
    for h in (player, author):
        client.get('/api/me', headers=h)
    client.post('/api/admin/new-year/settings', headers=admin, json={'enabled': True})
    section = client.post('/api/admin/new-year/shop-sections', headers=admin, json={'title': 'Обмен', 'icon': 'builtin:gem', 'bg': 'fireworks', 'kind': 'exchange', 'enabled': True}).json['id']
    tile = client.post('/api/admin/new-year/exchange', headers=admin, json={'section_id': section, 'group_title': 'GRAM', 'pay_cur': 'BALLS', 'pay_amount': '1000', 'get_cur': 'GRAM', 'get_amount': '0.5', 'bonus': '0.1'})
    assert tile.status_code == 200, tile.get_data(as_text=True)
    # a tile must be between different currencies and live in an exchange section
    assert client.post('/api/admin/new-year/exchange', headers=admin, json={'section_id': section, 'pay_cur': 'GRAM', 'pay_amount': '1', 'get_cur': 'GRAM', 'get_amount': '1'}).status_code == 400
    assert client.post('/api/admin/new-year/exchange', headers=admin, json={'section_id': 'packs', 'pay_cur': 'GRAM', 'pay_amount': '1', 'get_cur': 'BALLS', 'get_amount': '1'}).status_code == 400
    _wallet(client, admin, 43, 3000)
    shown = client.get('/api/shop-items', headers=player).json
    assert [x['id'] for x in shown['exchanges']] == [tile.json['id']] and shown['author']['code'] == ''
    # author codes: made by the administrator, bound to the author
    assert client.post('/api/admin/new-year/author-codes', headers=admin, json={'code': 'ab', 'owner_id': '44'}).status_code == 400
    assert client.post('/api/admin/new-year/author-codes', headers=admin, json={'code': 'author', 'owner_id': '999'}).status_code == 404
    assert client.post('/api/admin/new-year/author-codes', headers=admin, json={'code': 'author', 'owner_id': '44'}).status_code == 200
    assert client.post('/api/admin/new-year/author-codes', headers=player, json={'code': 'mine', 'owner_id': '43'}).status_code == 403
    assert client.post('/api/author-code', headers=player, json={'code': 'nope'}).status_code == 404
    assert client.post('/api/author-code', headers=author, json={'code': 'AUTHOR'}).status_code == 409            # not your own code
    assert client.post('/api/author-code', headers=player, json={'code': ' author '}).json['code'] == 'AUTHOR'
    assert client.get('/api/shop-items', headers=player).json['author']['code'] == 'AUTHOR'
    # an exchange: 1000 balls -> 0.6 GRAM, 5% of the paid balls go to the author
    req = {'exchange_id': tile.json['id'], 'request_id': 'exchange-req-001'}
    got = client.post('/api/shop-exchange/buy', headers=player, json=req)
    assert got.status_code == 200 and got.json['got'] == {'currency': 'GRAM', 'amount': '0.6'} and got.json['balance']['balls'] == 2000
    assert client.post('/api/shop-exchange/buy', headers=player, json=req).json == got.json                       # a repeat is free
    assert _balls(client, 43) == 2000 and _balls(client, 44) == 50
    # a purchase in the shop pays the author too: 400 balls -> 20
    item = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'GRAM', 'amount': '1', 'price_balls': '400'}).json['id']
    assert client.post('/api/shop-items/buy', headers=player, json={'item_id': item, 'request_id': 'shop-req-0001'}).status_code == 200
    assert _balls(client, 44) == 70
    # the rate is the administrator's; a switched-off code pays nothing
    assert client.post('/api/admin/new-year/author-rate', headers=admin, json={'percent': '60'}).status_code == 400
    assert client.post('/api/admin/new-year/author-rate', headers=admin, json={'percent': '10'}).status_code == 200
    assert client.post('/api/admin/new-year/author-codes/AUTHOR/toggle', headers=admin).status_code == 200
    client.post('/api/shop-items/buy', headers=player, json={'item_id': item, 'request_id': 'shop-req-0002'})
    assert _balls(client, 44) == 70
    listing = client.get('/api/admin/new-year/exchange', headers=admin).json
    assert listing['percent'] == '10' and listing['codes'][0]['supporters'] == 1 and listing['codes'][0]['earned_balls'] == 70
    # not enough money / out of stock
    poor = signed(45)
    client.get('/api/me', headers=poor)
    assert client.post('/api/shop-exchange/buy', headers=poor, json={'exchange_id': tile.json['id'], 'request_id': 'exchange-req-002'}).status_code == 409
    # deleting the section removes its plates
    assert client.post('/api/admin/new-year/shop-sections/%s/delete' % section, headers=admin).status_code == 200
    assert client.get('/api/shop-items', headers=player).json['exchanges'] == []


def test_offer_quick_edit_and_move_to_a_built_in_section(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    iid = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'GRAM', 'amount': '1', 'price_balls': '100'}).json['id']
    edit = client.post('/api/admin/new-year/shop/%s/style' % iid, headers=admin, json={
        'title': 'Новое имя', 'price_balls': '80', 'old_price_balls': '120', 'stock': '5', 'per_user': '2', 'badge': 'ХИТ', 'description': 'Описание',
        'starts_at_msk': '2099-01-01T10:00', 'ends_at_msk': '2099-01-02T10:00', 'section_id': 'bundles'})
    assert edit.status_code == 200, edit.get_data(as_text=True)
    row = next(i for i in client.get('/api/admin/new-year/shop', headers=admin).json['items'] if i['id'] == iid)
    assert (row['title'], row['price_balls'], row['old_price_balls'], row['stock'], row['per_user'], row['badge'], row['section_id']) == ('Новое имя', 80, 120, 5, 2, 'ХИТ', 'bundles')
    assert row['ends_at'] - row['starts_at'] == 86400
    for bad in ({'old_price_balls': '50'}, {'section_id': 'gifts'}, {'section_id': 'nope'}, {'ends_at_msk': '2000-01-01T10:00'}, {'title': ' '}):
        assert client.post('/api/admin/new-year/shop/%s/style' % iid, headers=admin, json=bad).status_code == 400, bad
