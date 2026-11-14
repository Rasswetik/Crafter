from test_app import client, signed


def tap(client, player, sid, revision, rid):
    return client.post('/api/drops/sessions/%s/tap' % sid, headers=player, json={'request_id': rid, 'revision': revision})


def test_drop_four_attempts_one_reward(client):
    admin, player = signed(42), signed(53)
    client.get('/api/me', headers=player)
    assert client.post('/api/drops/snowman_drop/open', headers=player).status_code == 409          # nothing in the inventory yet
    granted = client.post('/api/admin/drops/grant', headers=admin, json={'user_id': 53, 'drop_id': 'snowman_drop', 'qty': 2})
    assert granted.status_code == 200, granted.get_data(as_text=True)
    mine = client.get('/api/drops', headers=player).json['drops']
    assert mine[0]['id'] == 'snowman_drop' and mine[0]['qty'] == 2
    start = client.post('/api/drops/snowman_drop/open', headers=player).json
    assert start['attempts_left'] == 4 and start['rarity'] == 0 and start['qty'] == 1 and 'reward' not in start
    assert client.post('/api/drops/snowman_drop/open', headers=player).json['session_id'] == start['session_id']      # the same session, nothing is spent twice
    sid, last = start['session_id'], 0
    for i in range(4):
        res = tap(client, player, sid, i, 'request-number-%d' % i)
        assert res.status_code == 200, res.get_data(as_text=True)
        body = res.json
        assert body['attempt'] == i + 1 and body['rarity'] >= last          # the rarity never goes down
        last = body['rarity']
        if i == 0:
            assert tap(client, player, sid, 0, 'request-number-0').json == body      # a repeat gives the same answer
            assert tap(client, player, sid, 0, 'request-other-0').status_code == 409    # an old revision
        if i < 3:
            assert 'reward' not in body and body['state'] == 'ready'
    assert body['state'] == 'revealed' and body['reward']['kind'] in ('GRAM', 'BALL', 'PACK', 'NFT')
    assert tap(client, player, sid, 4, 'request-number-9').status_code == 409
    assert client.get('/api/drops/sessions/%s' % sid, headers=player).json['reward'] == body['reward']
    assert client.get('/api/drops/sessions/%s' % sid, headers=signed(77)).status_code == 404       # somebody else's session


def test_drop_chances_and_shop(client):
    admin, player = signed(42), signed(53)
    client.get('/api/me', headers=player)
    ch = client.get('/api/drops/snowman_drop/chances', headers=player).json
    assert abs(sum(x['chance'] for x in ch['rarities']) - 100) < 0.01 and abs(sum(x['chance'] for x in ch['loot']) - 100) < 0.05
    assert len(ch['loot']) == 40
    item = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'DROP', 'amount': 'snowman_drop', 'bundle': 3, 'price_balls': 0, 'size': 'small'})
    assert item.status_code == 200, item.get_data(as_text=True)
    lot = next(x for x in client.get('/api/shop-items', headers=player).json['items'] if x['kind'] == 'DROP')
    assert lot['drop']['id'] == 'snowman_drop' and lot['title'] == 'Snowman Drop ×3'
    bought = client.post('/api/shop-items/buy', headers=player, json={'item_id': lot['id'], 'request_id': 'drop-req-00001'})
    assert bought.status_code == 200, bought.get_data(as_text=True)
    assert bought.json['drop_granted']['qty'] == 3
    assert client.get('/api/drops', headers=player).json['drops'][0]['qty'] == 3


def test_choice_offer_with_its_own_price_per_option(client):
    admin, player = signed(42), signed(53)
    client.get('/api/me', headers=player)
    made = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'mode': 'choice', 'price_balls': 500, 'size': 'small',
                                                                      'contents': [{'pack_id': 'newyear', 'count': 1}, {'pack_id': 'snowman', 'count': 1, 'price': 0}]})
    assert made.status_code == 200, made.get_data(as_text=True)
    lot = next(x for x in client.get('/api/shop-items', headers=player).json['items'] if x['mode'] == 'choice')
    assert [c['price'] for c in lot['contents']] == [None, 0]
    dear = client.post('/api/shop-items/buy', headers=player, json={'item_id': lot['id'], 'request_id': 'choice-req-0001', 'choice': 'newyear'})
    assert dear.status_code == 409                                                  # the common price is 500, the player has nothing
    cheap = client.post('/api/shop-items/buy', headers=player, json={'item_id': lot['id'], 'request_id': 'choice-req-0002', 'choice': 'snowman'})
    assert cheap.status_code == 200, cheap.get_data(as_text=True)                  # this option costs 0
