import json

from test_app import client, signed
from test_pass import make_season


def test_santa_and_goshan_drops_have_exact_chances_and_their_own_art(client):
    admin, player = signed(42), signed(61)
    client.get('/api/me', headers=player)
    for drop_id, art in (('santa_drop', 'santa'), ('goshan_drop', 'goshan')):
        info = client.get('/api/drops/%s/chances' % drop_id, headers=player).json
        assert info['drop']['art'] == art and info['drop']['image'].endswith('/%s.png' % art)
        assert [r['chance'] for r in info['rarities']] == [49.5, 28.0, 15.0, 5.0, 2.0, 0.5]
        assert len(info['loot']) == 40 and abs(sum(x['chance'] for x in info['loot']) - 100) < 0.05
        assert abs(info['kinds']['NFT'] - 1.74) < 0.01                                   # a direct NFT: 1.74% per drop
        assert client.post('/api/admin/drops/grant', headers=admin, json={'user_id': 61, 'drop_id': drop_id, 'qty': 1}).status_code == 200
        start = client.post('/api/drops/%s/open' % drop_id, headers=player).json
        sid = start['session_id']
        for i in range(4):
            res = client.post('/api/drops/sessions/%s/tap' % sid, headers=player, json={'request_id': 'req-%s-%d' % (drop_id, i), 'revision': i})
            assert res.status_code == 200, res.get_data(as_text=True)
        assert res.json['state'] == 'revealed' and res.json['reward']['kind'] in ('GRAM', 'BALL', 'PACK', 'NFT')


def test_goshan_box_gives_two_to_six_rewards(client):
    admin, player = signed(42), signed(62)
    client.get('/api/me', headers=player)
    info = client.get('/api/chests/goshan', headers=player).json
    assert info['chest']['title'] == 'Goshan Box'
    seen = set()
    for _ in range(40):
        r = client.post('/api/admin/new-year/chests/goshan/preview', headers=admin)
        assert r.status_code == 200, r.get_data(as_text=True)
        seen.add(len(r.json['items']))
    assert seen and min(seen) >= 2 and max(seen) <= 6


def test_pass_plus_is_sold_in_the_shop(client):
    admin, player = signed(42), signed(63)
    client.get('/api/me', headers=player)
    item = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PASS', 'price_balls': 120, 'size': 'small'})
    assert item.status_code == 200, item.get_data(as_text=True)
    iid = item.json['id']
    buy = lambda rid: client.post('/api/shop-items/buy', headers=player, json={'item_id': iid, 'request_id': rid})
    assert buy('pass-buy-0001').status_code == 409                                       # no season at all: nothing is sold
    make_season(client, admin)
    listed = [x for x in client.get('/api/shop-items', headers=player).json['items'] if x['kind'] == 'PASS'][0]
    assert listed['title'] == 'Pass Plus' and listed['pass']['season']['title'] == 'Зимний сезон' and not listed['pass']['owned']
    assert buy('pass-buy-0002').status_code == 409                                       # no balls
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '63', 'balls': '500', 'donate': '0', 'tinsel': '0'})
    ok = buy('pass-buy-0003')
    assert ok.status_code == 200, ok.get_data(as_text=True)
    assert ok.json['pass_plus'] and ok.json['balance']['balls'] == 380
    assert client.get('/api/pass', headers=player).json['me']['plus'] is True
    assert buy('pass-buy-0004').status_code == 409                                       # already open: the balls are not taken
    assert client.get('/api/pass', headers=player).json['me']['balance']['balls'] == 380
    listed = [x for x in client.get('/api/shop-items', headers=player).json['items'] if x['kind'] == 'PASS'][0]
    assert listed['pass']['owned'] is True
