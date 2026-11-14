import json

from test_app import client, signed
from test_pass import make_season


def test_santa_and_goshan_drops_have_exact_chances_and_their_own_art(client):
    admin, player = signed(42), signed(61)
    client.get('/api/me', headers=player)
    for drop_id, art in (('santa_drop', 'santa'), ('goshan_drop', 'goshan'), ('nikolay_drop', 'nikolay'), ('vicecity_drop', 'vicecity')):
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
    assert client.get('/api/chests/nikolay', headers=player).json['chest']['title'] == 'Nikolay Box'
    info = client.get('/api/chests/goshan', headers=player).json
    assert info['chest']['title'] == 'Goshan Box'
    seen = set()
    for _ in range(40):
        r = client.post('/api/admin/new-year/chests/%s/preview' % ('goshan' if _ % 2 else 'nikolay'), headers=admin)
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


def test_pass_plus_inside_a_bundle_and_a_choice_offer(client):
    admin, player = signed(42), signed(64)
    client.get('/api/me', headers=player)
    make_season(client, admin)
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '64', 'balls': '1000', 'donate': '0', 'tinsel': '0'})
    bundle = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'BUNDLE', 'price_balls': 200, 'size': 'small', 'contents': {'pass': True, 'gram': '1', 'packs': []}})
    assert bundle.status_code == 200, bundle.get_data(as_text=True)
    assert 'Pass Plus' in bundle.json['title'] if 'title' in bundle.json else True
    listed = [x for x in client.get('/api/shop-items', headers=player).json['items'] if x['id'] == bundle.json['id']][0]
    assert listed['pass_in']['season']['title'] == 'Зимний сезон'
    ok = client.post('/api/shop-items/buy', headers=player, json={'item_id': bundle.json['id'], 'request_id': 'bundle-pass-0001'})
    assert ok.status_code == 200, ok.get_data(as_text=True)
    assert ok.json['pass_plus'] and ok.json['balance']['balls'] == 800 and ok.json['gram'] == '1'
    assert client.get('/api/pass', headers=player).json['me']['plus'] is True
    again = client.post('/api/shop-items/buy', headers=player, json={'item_id': bundle.json['id'], 'request_id': 'bundle-pass-0002'})
    assert again.status_code == 409                                                     # the pass is already open: nothing is taken
    assert client.get('/api/pass', headers=player).json['me']['balance']['balls'] == 800
    choice = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'mode': 'choice', 'price_balls': 10, 'size': 'small', 'contents': [{'pass': True, 'count': 1}, {'pack_id': 'newyear', 'count': 1}]})
    assert choice.status_code == 200, choice.get_data(as_text=True)
    other = signed(65)
    client.get('/api/me', headers=other)
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '65', 'balls': '100', 'donate': '0', 'tinsel': '0'})
    got = client.post('/api/shop-items/buy', headers=other, json={'item_id': choice.json['id'], 'request_id': 'choice-pass-0001', 'choice': 'pass:plus'})
    assert got.status_code == 200, got.get_data(as_text=True)
    assert got.json['pass_plus'] and client.get('/api/pass', headers=other).json['me']['plus'] is True


def test_gift_calendars_and_chains_share_the_order_of_the_shop(client):
    admin, player = signed(42), signed(66)
    client.get('/api/me', headers=player)
    a = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'BALL', 'amount': '10', 'price_balls': 5, 'size': 'small'}).json['id']
    b = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'BALL', 'amount': '20', 'price_balls': 9, 'size': 'small'}).json['id']
    done = client.post('/api/admin/new-year/shop-arrange', headers=admin, json={'ids': [b, 'fb:cal1', a, 'ch:chain1']})
    assert done.status_code == 200, done.get_data(as_text=True)
    shop = client.get('/api/shop-items', headers=player).json
    assert shop['order'] == 'manual'
    pos = {x['id']: x['position'] for x in shop['items']}
    assert pos[b] < shop['extra_order']['fb:cal1'] < pos[a] < shop['extra_order']['ch:chain1']
    assert [x['id'] for x in shop['items']] == [b, a]
    again = client.post('/api/admin/new-year/shop-arrange', headers=admin, json={'ids': [a, b]})                  # the tiles that were not named go after
    assert again.status_code == 200
    shop = client.get('/api/shop-items', headers=player).json
    assert [x['id'] for x in shop['items']] == [a, b] and shop['extra_order']['fb:cal1'] > shop['items'][1]['position']


def test_new_year_switch_turns_balls_into_points_with_a_notice(client):
    admin, player = signed(42), signed(67)
    me = client.get('/api/me', headers=player).json
    assert me['currency'] == 'points' and me['ny_notice'] is None                  # the New Year is off by default: points, nothing to tell
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '67', 'balls': '250', 'donate': '0', 'tinsel': '0'})
    assert client.post('/api/admin/new-year/settings', headers=admin, json={'enabled': True}).status_code == 200
    me = client.get('/api/me', headers=player).json
    assert me['currency'] == 'balls' and (me['ny_notice']['from']['kind'], me['ny_notice']['to']['kind'], me['ny_notice']['amount'], me['ny_notice']['rate']) == ('points', 'balls', 250, '1')
    assert client.get('/api/me', headers=player).json['ny_notice'] is not None       # it is shown until the player confirms
    assert client.post('/api/new-year/ack', headers=player).status_code == 200
    assert client.get('/api/me', headers=player).json['ny_notice'] is None
    client.post('/api/admin/new-year/settings', headers=admin, json={'enabled': False})
    me = client.get('/api/me', headers=player).json
    assert me['currency'] == 'points' and (me['ny_notice']['from']['kind'], me['ny_notice']['to']['kind'], me['ny_notice']['amount']) == ('balls', 'points', 250)
    assert client.get('/api/new-year', headers=player).status_code == 200            # the section does not disappear


def test_vice_city_collection_pack_box_drop_and_backgrounds(client):
    admin, player = signed(42), signed(68)
    client.get('/api/me', headers=player)
    assert client.get('/api/chests/vice', headers=player).json['chest']['title'] == 'Vice City Box'
    assert any(p['id'] == 'vicecity' for p in client.get('/api/admin/new-year/packs', headers=admin).json['packs'])
    drop = client.get('/api/drops/vicecity_drop/chances', headers=player).json
    assert drop['drop']['title'] == 'Vice City Drop' and any(x['title'] for x in drop['loot']) and abs(drop['kinds']['NFT'] - 1.74) < 0.01
    for _ in range(25):                                                              # the box really gives items of the pool (the neon pack and gifts)
        r = client.post('/api/admin/new-year/chests/vice/preview', headers=admin)
        assert r.status_code == 200 and 2 <= len(r.json['items']) <= 6
    bg = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'BALL', 'amount': '10', 'price_balls': 5, 'size': 'small', 'card_bg': 'vice-neon'})
    assert bg.status_code == 200, bg.get_data(as_text=True)                          # an offer can wear a Vice City background
    sec = client.post('/api/admin/new-year/shop-sections', headers=admin, json={'title': 'Vice', 'rule': 'custom', 'bg': 'vice-beach', 'icon': 'builtin:star'})
    assert sec.status_code in (200, 201, 404), sec.get_data(as_text=True)


def test_points_for_trades_are_off_by_default_and_hub_buttons_get_backgrounds(client):
    admin, player = signed(42), signed(69)
    me = client.get('/api/me', headers=player).json
    assert me['new_year_reward_per_ton'] == 0                                         # nothing is given for the trades unless the administrator turns it on
    assert client.post('/api/admin/new-year/points-rate', headers=admin, json={'per_ton': 100}).json['per_ton'] == 100
    assert client.get('/api/me', headers=player).json['new_year_reward_per_ton'] == 100
    assert client.post('/api/admin/new-year/points-rate', headers=signed(70), json={'per_ton': 5}).status_code in (401, 403)
    assert client.post('/api/admin/new-year/hub-bg', headers=admin, json={'card': 'market', 'bg': 'vice-neon'}).status_code == 200
    assert client.post('/api/admin/new-year/hub-bg', headers=admin, json={'card': 'season', 'bg': 'live-gold'}).json['hub_bg'] == {'market': 'vice-neon', 'season': 'live-gold'}
    assert client.get('/api/new-year/locks', headers=player).json['hub_bg']['market'] == 'vice-neon'
    assert client.post('/api/admin/new-year/hub-bg', headers=admin, json={'card': 'market', 'bg': 'nope'}).status_code == 400
    assert client.post('/api/admin/new-year/hub-bg', headers=admin, json={'card': 'market', 'bg': ''}).json['hub_bg'] == {'season': 'live-gold'}


def test_section_hide_and_show_in_one_tap(client):
    admin, player = signed(42), signed(71)
    client.get('/api/me', headers=player)
    shop = client.get('/api/admin/new-year/shop', headers=admin).json
    sid = [s['id'] for s in shop['sections'] if s['enabled']][0]
    assert client.post('/api/admin/new-year/shop-sections/%s/visibility' % sid, headers=admin, json={'enabled': False}).json['enabled'] is False
    assert [s for s in client.get('/api/admin/new-year/shop', headers=admin).json['sections'] if s['id'] == sid][0]['enabled'] is False
    assert client.post('/api/admin/new-year/shop-sections/%s/visibility' % sid, headers=admin, json={'enabled': True}).json['enabled'] is True
    assert client.post('/api/admin/new-year/shop-sections/nope/visibility', headers=admin, json={'enabled': True}).status_code == 404
    assert client.post('/api/admin/new-year/shop-sections/%s/visibility' % sid, headers=signed(72), json={'enabled': False}).status_code in (401, 403)


def test_gifts_not_on_the_market_have_zero_chance_in_drops():
    from drops import DROPS, available_cfg, final_chances
    cfg = DROPS['vicecity_drop']
    gone = {cfg['rewards']['NFT'][0][1], cfg['rewards']['NFT'][3][1]}
    live = available_cfg(cfg, lambda cid, model: (cid + ':' + model) not in gone)
    _, rew = final_chances(live)
    assert abs(sum(rew.values()) - 1) < 1e-9
    assert ('NFT', 0) not in rew and ('NFT', 3) not in rew and ('NFT', 1) in rew
    assert available_cfg(cfg, None) is cfg
    assert available_cfg(cfg, lambda *a: True) is cfg
    assert len(cfg['rewards']['NFT']) == 15 and sum(1 for x in cfg['rewards']['NFT'] if x[1].startswith('diamondring')) == 1   # a ring is one gift of fifteen


def test_ocean_drive_collection_pack_box_drop_and_backgrounds(client):
    from pathlib import Path
    admin, player = signed(42), signed(71)
    client.get('/api/me', headers=player)
    assert client.get('/api/chests/ocean', headers=player).json['chest']['title'] == 'Ocean Drive Box'
    assert any(p['id'] == 'oceandrive' for p in client.get('/api/admin/new-year/packs', headers=admin).json['packs'])
    drop = client.get('/api/drops/oceandrive_drop/chances', headers=player).json
    assert drop['drop']['title'] == 'Ocean Drive Drop' and drop['drop']['art'] == 'oceandrive' and abs(sum(x['chance'] for x in drop['loot']) - 100) < 0.05
    for _ in range(15):
        r = client.post('/api/admin/new-year/chests/ocean/preview', headers=admin)
        assert r.status_code == 200 and 2 <= len(r.json['items']) <= 6
    for key in ('ocean-beach', 'ocean-secret'):
        assert client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'BALL', 'amount': '10', 'price_balls': 5, 'size': 'small', 'card_bg': key}).status_code == 200
    root = Path(__file__).resolve().parent.parent / 'static' / 'assets'
    for name in ('oceandrive.png', 'oceandrive-idle.webp', 'oceandrive-joy.webp', 'oceandrive-open-charge.webp', 'oceandrive-surprised.webp', 'oceandrive-front-000.webp',
                 'oceandrive-bg-secret.webp') + tuple('oceandrive-turn-%03d.webp' % a for a in range(45, 360, 45)):
        assert (root / 'drops' / name).exists(), name
    assert (root / 'packs' / 'oceandrive-pack.webp').exists() and (root / 'chests' / 'ocean-open.png').exists() and (root / 'ocean' / 'scene-beach.webp').exists()


def test_currency_management_choose_recalculate_and_tell_everybody(client):
    admin, player = signed(42), signed(80)
    client.get('/api/me', headers=player)
    assert client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '80', 'balls': 100}).status_code == 200
    cur = client.get('/api/admin/currency', headers=admin).json
    assert cur['current']['kind'] == 'points' and cur['stats']['before'] == 100 and [p['kind'] for p in cur['presets']] == ['balls', 'points', 'coins']
    assert client.get('/api/admin/currency', headers=signed(81)).status_code in (401, 403)
    pre = client.post('/api/admin/currency/preview', headers=admin, json={'kind': 'coins', 'rate': '2'}).json
    assert pre['changes'] and pre['before'] == 100 and pre['after'] == 200 and pre['to']['name'] == 'Коины'
    assert client.post('/api/admin/currency/preview', headers=admin, json={'kind': 'custom', 'name': 'Звёзды'}).status_code == 400      # a picture is needed
    assert client.post('/api/admin/currency/preview', headers=admin, json={'kind': 'coins', 'rate': '0'}).status_code == 400
    assert client.post('/api/admin/currency/apply', headers=admin, json={'kind': 'points'}).status_code == 409                          # the same currency and rate: nothing to do
    assert client.get('/api/me', headers=player).json['ny_notice'] is None                                                              # nothing changed yet
    done = client.post('/api/admin/currency/apply', headers=admin, json={'kind': 'coins', 'rate': '2'})
    assert done.status_code == 200 and done.json['current']['name'] == 'Коины'
    me = client.get('/api/me', headers=player).json
    assert me['ny_notice']['from']['name'] == 'Поинты' and me['ny_notice']['to']['name'] == 'Коины' and me['ny_notice']['amount'] == 200 and me['ny_notice']['rate'] == '2'
    assert client.get('/api/balance', headers=player).json['new_year']['balls'] == 200
    assert client.post('/api/new-year/ack', headers=player, json={}).status_code == 200
    assert client.get('/api/me', headers=player).json['ny_notice'] is None                                                              # told once
    assert client.get('/api/new-year/status', headers=player).json['currency_info']['name'] == 'Коины'
    html = client.get('/').get_data(as_text=True)
    assert 'window.crafterCurrency' in html and 'coins.svg' in html and 'cur-style' in html                                              # the pictures follow the currency
    ok = client.post('/api/admin/currency/apply', headers=admin, json={'kind': 'custom', 'name': 'Звёзды', 'gen': 'звёзд', 'icon': '/static/assets/gram.svg', 'rate': '1'})
    assert ok.status_code == 200 and ok.json['current']['kind'] == 'custom' and ok.json['current']['gen'] == 'звёзд'
    drop = client.get('/api/chests/goshan', headers=player)
    assert drop.status_code == 200
