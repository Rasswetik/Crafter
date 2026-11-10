import sqlite3
import time
import uuid
from decimal import Decimal

from test_app import client, signed


def add_history(client, count):
    with sqlite3.connect(client.application.config['DATABASE']) as con:
        for _ in range(count):
            con.execute('INSERT INTO history VALUES(?,?,?,?,?)', (uuid.uuid4().hex, 50, 'craft', '{}', int(time.time())))


def balance(client, who):
    return Decimal(client.get('/api/me', headers=who).json['balance'])


def test_default_pack_and_admin_validation(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    data = client.get('/api/admin/new-year/packs', headers=admin).json
    pack = data['packs'][0]
    assert pack['title'] == 'New Year' and len(pack['prizes']) > 15
    assert {p['amount'] for p in pack['prizes'] if p['kind'] == 'GRAM'} >= {'0.2', '0.5', '1', '2', '2.5', '3', '5'}
    assert client.get('/api/admin/new-year/packs', headers=player).status_code == 403
    bad = dict(pack, card_weights={'1': 0, '2': 0, '3': 0, '4': 0, '5': 0})
    assert client.post('/api/admin/new-year/packs', headers=admin, json=bad).status_code == 400
    assert client.post('/api/admin/new-year/packs', headers=admin, json=dict(pack, prizes=[])).status_code == 400
    saved = client.post('/api/admin/new-year/packs', headers=admin, json=dict(pack, title='Новый пак'))
    assert saved.status_code == 200 and saved.json['id'] == pack['id']


def test_buy_open_and_sell(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    client.post('/api/admin/new-year/packs', headers=admin, json=dict(pack, for_sale=True, price_balls=10,
                card_weights={'1': 0, '2': 0, '3': 1, '4': 0, '5': 0}))
    state = client.get('/api/packs', headers=player).json
    assert state['shop'][0]['price_balls'] == 10 and state['mine'] == []
    buy = lambda rid: client.post('/api/packs/buy', headers=player, json={'pack_id': pack['id'], 'request_id': rid})
    assert buy('buy-request-1').status_code == 409                       # no balls
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': 43, 'balls': '10'})
    got = buy('buy-request-1')
    assert got.status_code == 200 and got.json['balance']['balls'] == 0
    assert buy('buy-request-1').json['user_pack_id'] == got.json['user_pack_id']   # idempotent
    upid = got.json['user_pack_id']
    inv = client.get('/api/inventory', headers=player).json['gifts']
    item = next(x for x in inv if x['id'] == 'packitem-' + upid)
    assert item['name'] == 'Pack' and item['model'] == 'New Year' and item['pack_item'] and item['status'] == 'unlisted'
    assert item['backdrop'] and item['background']['center_color'] and item['number'] >= 1
    assert client.get('/api/packs', headers=player).json['mine'][0]['id'] == upid
    before = balance(client, player)
    opened = client.post('/api/packs/open', headers=player, json={'user_pack_id': upid})
    assert opened.status_code == 200 and len(opened.json['cards']) == 3
    gram = sum(Decimal(c['amount']) for c in opened.json['cards'] if c['kind'] == 'GRAM')
    assert balance(client, player) == before + gram
    again = client.post('/api/packs/open', headers=player, json={'user_pack_id': upid})
    assert again.json['cards'] == opened.json['cards'] and balance(client, player) == before + gram   # no double credit
    assert client.post('/api/packs/open', headers=signed(44), json={'user_pack_id': upid}).status_code in (404, 401)
    assert client.get('/api/packs', headers=player).json['mine'] == []
    assert not any(x['id'] == 'packitem-' + upid for x in client.get('/api/inventory', headers=player).json['gifts'])   # consumed

    nfts = [c for c in opened.json['cards'] if c['kind'] == 'NFT']
    if nfts:
        ids = [c['nft_id'] for c in nfts]
        worth = sum(Decimal(c['value']) for c in nfts)
        sold = client.post('/api/packs/sell', headers=player, json={'nft_ids': ids})
        assert sold.status_code == 200 and Decimal(sold.json['amount']) == worth
        assert client.post('/api/packs/sell', headers=player, json={'nft_ids': ids}).status_code == 409


def test_community_pack_reward_promo_and_redeemed_flag(client):
    client.application.config['COMMUNITY_CACHE_SECONDS'] = 0
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    client.post('/api/admin/new-year/community', headers=admin, json={'title': 'Цель', 'metric': 'craft', 'target': '5', 'enabled': True})
    assert client.post('/api/admin/new-year/community/milestones', headers=admin, json={
        'title': 'Пак', 'threshold': 5, 'reward_kind': 'PACK', 'reward_amount': 'missing', 'supply': 3}).status_code == 400
    made = client.post('/api/admin/new-year/community/milestones', headers=admin, json={
        'title': 'Пак', 'threshold': 5, 'reward_kind': 'PACK', 'reward_amount': pack['id'], 'supply': 3, 'price_balls': 0})
    gram = client.post('/api/admin/new-year/community/milestones', headers=admin, json={
        'title': 'Промо', 'threshold': 5, 'reward_kind': 'GRAM', 'reward_amount': '1', 'supply': 3, 'price_balls': 0})
    add_history(client, 5)
    state = client.get('/api/community', headers=player).json['milestones']
    assert {m['reward_kind'] for m in state} == {'PACK', 'GRAM'} and state[0]['pack']['title'] == 'New Year'
    claim = lambda mid, rid: client.post('/api/community/claim', headers=player, json={'milestone_id': mid, 'request_id': rid})
    pk = claim(made.json['id'], 'claim-pack-001')
    assert pk.status_code == 200 and len(pk.json['pack_id']) == 32
    assert len(client.get('/api/packs', headers=player).json['mine']) == 1
    opened = client.post('/api/packs/open', headers=player, json={'user_pack_id': pk.json['pack_id']})
    assert opened.status_code == 200
    by_id = {m['id']: m for m in client.get('/api/community', headers=player).json['milestones']}
    assert by_id[made.json['id']]['redeemed'] is True            # opened pack leaves the market

    pr = claim(gram.json['id'], 'claim-gram-001')
    assert client.get('/api/community', headers=player).json['milestones'][1]['redeemed'] is False
    assert client.post('/api/promocodes/redeem', headers=player, json={'code': pr.json['code']}).status_code == 200
    by_id = {m['id']: m for m in client.get('/api/community', headers=player).json['milestones']}
    assert by_id[gram.json['id']]['redeemed'] is True            # activated code leaves the market

    code = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'PACK', 'reward': pack['id'], 'pack_count': 2, 'limit': 1})
    assert code.status_code == 200
    r = client.post('/api/promocodes/redeem', headers=player, json={'code': code.json['code']})
    assert r.status_code == 200 and r.json['pack_id'] and len(r.json['pack_ids']) == 2
    assert len(client.get('/api/packs', headers=player).json['mine']) == 2


def test_milestone_title_is_generated_when_empty(client):
    admin = signed(42)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    client.post('/api/admin/new-year/community', headers=admin, json={'title': 'Цель', 'metric': 'craft', 'target': '100', 'enabled': True})
    mk = lambda **kw: client.post('/api/admin/new-year/community/milestones', headers=admin, json=dict(threshold=10, supply=5, **kw))
    assert mk(reward_kind='PACK', reward_amount=pack['id']).status_code == 200
    assert mk(reward_kind='GRAM', reward_amount='2').status_code == 200
    assert mk(reward_kind='BALL', reward_amount='50').status_code == 200
    titles = {m['title'] for m in client.get('/api/admin/new-year/community', headers=admin).json['milestones']}
    assert titles == {'New Year', 'Промокод на 2 GRAM', '50 шаров'}
    shown = client.get('/api/admin/new-year/community', headers=admin).json['milestones']
    assert next(m for m in shown if m['reward_kind'] == 'PACK')['image_url'] == pack['image']


def test_pack_contents_and_shop_items(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    info = client.get('/api/packs/' + pack['id'] + '/contents', headers=player).json
    assert abs(sum(p['chance'] for p in info['prizes']) - 100) < 0.5 and info['prizes'][0]['kind'] == 'GRAM'
    assert abs(sum(c['chance'] for c in info['cards']) - 100) < 0.5
    assert client.get('/api/shop-items', headers=player).json['items'] == []
    mk = lambda **kw: client.post('/api/admin/new-year/shop', headers=admin, json=kw)
    assert client.post('/api/admin/new-year/shop', headers=player, json={'kind': 'GRAM', 'amount': '1'}).status_code == 403
    assert mk(kind='GRAM', amount='2.5', price_balls=10, stock=2, per_user=1).status_code == 200
    assert mk(kind='BALL', amount='40', price_balls=5).status_code == 200
    assert mk(kind='PACK', amount=pack['id'], price_balls=0).status_code == 200
    assert mk(kind='PROMO', promo_kind='GRAM', amount='1', price_balls=0).status_code == 200
    assert mk(kind='PACK', amount='nope').status_code == 400
    items = {i['kind']: i for i in client.get('/api/shop-items', headers=player).json['items']}
    assert set(items) == {'GRAM', 'BALL', 'PACK', 'PROMO'} and items['PACK']['title'] == 'New Year'
    buy = lambda kind, rid: client.post('/api/shop-items/buy', headers=player, json={'item_id': items[kind]['id'], 'request_id': rid})
    assert buy('GRAM', 'shop-req-0001').status_code == 409                      # no balls yet
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': 43, 'balls': '30'})
    before = balance(client, player)
    g1 = buy('GRAM', 'shop-req-0001')
    assert g1.status_code == 200 and balance(client, player) == before + Decimal('2.5') and g1.json['balance']['balls'] == 20
    assert buy('GRAM', 'shop-req-0001').json == g1.json and balance(client, player) == before + Decimal('2.5')   # idempotent
    assert buy('GRAM', 'shop-req-0002').status_code == 409                      # per-user limit
    assert buy('BALL', 'shop-req-0003').json['balance']['balls'] == 20 - 5 + 40
    assert len(buy('PACK', 'shop-req-0004').json['pack_id']) == 32
    code = buy('PROMO', 'shop-req-0005').json['code']
    assert client.post('/api/promocodes/redeem', headers=signed(44), json={'code': code}).status_code in (401, 403, 404)
    assert client.post('/api/promocodes/redeem', headers=player, json={'code': code}).status_code == 200
    assert client.post('/api/admin/new-year/shop/' + items['GRAM']['id'] + '/delete', headers=admin).status_code == 409
    assert client.post('/api/admin/new-year/shop/' + items['BALL']['id'] + '/status', headers=admin, json={'status': 'hidden'}).status_code == 200
    assert 'BALL' not in {i['kind'] for i in client.get('/api/shop-items', headers=player).json['items']}


def test_pack_item_cannot_leave_the_app_and_can_be_listed(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'amount': pack['id'], 'price_balls': 0})
    item = client.get('/api/shop-items', headers=player).json['items'][0]
    bought = client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'pack-shop-001'}).json
    nft = 'packitem-' + bought['pack_id']
    assert client.post('/api/inventory/action', headers=player, json={'action': 'withdraw', 'gift_ids': [nft]}).status_code in (400, 409)
    assert client.post('/api/gifts/withdraw', headers=player, json={'gift_ids': [nft]}).status_code in (400, 404, 409)
    listed = client.post('/api/resale/listings', headers=player, json={'action': 'sell', 'items': [{'id': nft, 'price': '3'}]})
    assert listed.status_code == 200, listed.json
    assert client.post('/api/packs/open', headers=player, json={'user_pack_id': bought['pack_id']}).status_code == 409   # listed
    client.post('/api/resale/listings', headers=player, json={'action': 'unlist', 'items': [{'id': nft}]})
    assert client.post('/api/packs/open', headers=player, json={'user_pack_id': bought['pack_id']}).status_code == 200


def test_shop_pack_bundle_gives_several_packs(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    assert client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'amount': pack['id'], 'bundle': 25}).status_code == 400
    made = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'amount': pack['id'], 'bundle': 5, 'per_user': 2, 'price_balls': 0})
    assert made.status_code == 200
    item = client.get('/api/shop-items', headers=player).json['items'][0]
    assert item['bundle'] == 5 and item['title'].endswith('×5')
    got = client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'bundle-req-001'}).json
    assert len(got['pack_ids']) == 5 and len(client.get('/api/packs', headers=player).json['mine']) == 5
    assert client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'bundle-req-001'}).json == got   # repeat is free
    client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'bundle-req-002'})
    assert client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'bundle-req-003'}).status_code == 409   # per-player limit of 2 purchases


def _nft_only_pack(client, admin):
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    nft = [p for p in pack['prizes'] if p['kind'] == 'NFT'][:2]
    gram = [p for p in pack['prizes'] if p['kind'] == 'GRAM'][:1]
    pack.update(card_weights={'1': 0, '2': 0, '3': 1, '4': 0, '5': 0}, prizes=[*nft, *[dict(p, weight=1) for p in gram]])
    for p in nft:
        p['weight'] = 1000
    assert client.post('/api/admin/new-year/packs', headers=admin, json=pack).status_code == 200
    return pack


def _grant_pack(client, admin, player, rid):
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'PACK', 'amount': pack['id'], 'price_balls': 0})
    item = client.get('/api/shop-items', headers=player).json['items'][-1]
    return client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': rid}).json['pack_id']


def test_work_mode_gifts_need_real_market_lots(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    _nft_only_pack(client, admin)
    ctx = client.application.extensions['crafter_pack_ctx']
    ctx['work_mode'] = lambda: True
    ctx['test_mode'] = lambda: False

    # no gifts on the market: the pack can only drop GRAM, whatever the paper chances say
    ctx['market_candidates'] = lambda target: []
    ctx['ensure_listings'] = lambda *a: None
    first = client.post('/api/packs/open', headers=player, json={'user_pack_id': _grant_pack(client, admin, player, 'work-req-001')}).json
    assert [c['kind'] for c in first['cards']] == ['GRAM'] * 3

    # lots exist and the purchase succeeds: the gift is bought and lands in the inventory with its own picture
    bought = []
    def candidates(target):
        return [({'id': 'lot-%s-%d' % (target['id'], i), 'name': target['name'], 'number': 100 + i, 'model': 'Model %d' % i, 'image': 'https://img.example/%d.png' % i,
                  'price': '9', 'price_unit': 'GRAM', 'backdrop': 'Persimmon', 'symbol': 'Star', 'collection_id': target['id']}, Decimal('9')) for i in range(3)]
    ctx['market_candidates'] = candidates
    client.application.extensions['crafter_pack_avail_cache'].clear()
    ctx['acquire'] = lambda gifts: (bought.append(gifts[0]['id']) or ('ok', ''))
    second = client.post('/api/packs/open', headers=player, json={'user_pack_id': _grant_pack(client, admin, player, 'work-req-002')}).json
    nfts = [c for c in second['cards'] if c['kind'] == 'NFT']
    assert nfts and len(bought) == len(nfts) and all(c['image'].startswith('https://img.example/') for c in nfts)
    inv = {x['id']: x for x in client.get('/api/inventory', headers=player).json['gifts']}
    assert all(c['nft_id'] in inv and inv[c['nft_id']]['origin'] == 'thermos' for c in nfts)

    # purchase fails: the card turns into the gift value in GRAM
    ctx['acquire'] = lambda gifts: ('failed', 'no')
    client.application.extensions['crafter_pack_avail_cache'].clear()
    before = balance(client, player)
    third = client.post('/api/packs/open', headers=player, json={'user_pack_id': _grant_pack(client, admin, player, 'work-req-003')}).json
    assert not [c for c in third['cards'] if c['kind'] == 'NFT'] and balance(client, player) > before


def test_test_mode_gifts_show_a_model_picture(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    _nft_only_pack(client, admin)
    opened = client.post('/api/packs/open', headers=player, json={'user_pack_id': _grant_pack(client, admin, player, 'test-req-001')}).json
    nfts = [c for c in opened['cards'] if c['kind'] == 'NFT']
    assert nfts and all(c['image'] for c in nfts)


def test_default_pack_has_01_gram_and_rare_gifts_and_ton_prices(client):
    import json
    import sqlite3
    import time
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    grams = {p['amount']: p['weight'] for p in pack['prizes'] if p['kind'] == 'GRAM'}
    assert '0.1' in grams and grams['0.1'] == max(grams.values())
    nft = [p for p in pack['prizes'] if p['kind'] == 'NFT']
    total = sum(p['weight'] for p in pack['prizes'])
    assert sum(p['weight'] for p in nft) / total < 0.03                      # gifts are a few percent of a card at most
    # prices come from the active market in GRAM: Thermos reports TON
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO cache VALUES(?,?,?)", ('thermos:collections', json.dumps([{'name': 'Snow Mittens', 'floor_price': '9', 'price_unit': 'TON'}]), int(time.time())))
        db.execute("INSERT INTO cache VALUES(?,?,?)", ('collections', json.dumps([{'name': 'Snow Mittens', 'floor_price': '3.01'}]), int(time.time())))
    ctx = client.application.extensions['crafter_pack_ctx']
    ctx['thermos_backend'] = lambda: True
    ctx['gram_per_ton'] = lambda: 1
    info = client.get('/api/packs/' + pack['id'] + '/contents', headers=player).json
    assert next(p for p in info['prizes'] if p['name'] == 'Snow Mittens')['value'] == '9'
    ctx['thermos_backend'] = lambda: False
    info = client.get('/api/packs/' + pack['id'] + '/contents', headers=player).json
    assert next(p for p in info['prizes'] if p['name'] == 'Snow Mittens')['value'] == '3.01'


def test_snowman_pack_economy_and_contents(client):
    from decimal import Decimal as D
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    packs = {p['id']: p for p in client.get('/api/admin/new-year/packs', headers=admin).json['packs']}
    assert packs['newyear']['title'] == 'New Year' and packs['snowman']['title'] == 'Snowman'
    snow = packs['snowman']
    gifts = [p for p in snow['prizes'] if p['kind'] == 'NFT']
    assert len(gifts) == 12 and all(g['model'] and g['image'].startswith('https://') for g in gifts)
    assert {g['collection_id'] for g in gifts}.isdisjoint({'toybear', 'genielamp'})       # no teddy bear, no genie lamp
    assert {'snowmittens', 'vicecream', 'springbasket'} <= {g['collection_id'] for g in gifts}
    total = sum(p['weight'] for p in snow['prizes'])
    cards = {int(k): v for k, v in snow['card_weights'].items()}
    mean_cards = sum(k * v for k, v in cards.items()) / sum(cards.values())
    ev_card = sum(float(D(p['value'] if p['kind'] == 'NFT' else p['amount'])) * p['weight'] for p in snow['prizes']) / total
    gift_share = sum(p['weight'] for p in gifts) / total
    assert 0.15 <= ev_card * mean_cards <= 0.4                                             # an opening is worth well under half a GRAM
    assert 0.3 <= 100 * mean_cards * gift_share <= 0.9                                     # about one gift per 200 openings
    grams = {p['amount'] for p in snow['prizes'] if p['kind'] == 'GRAM'}
    assert {'0.1', '0.2', '0.5', '1', '2', '3', '5', '10'} <= grams
    info = client.get('/api/packs/snowman/contents', headers=player).json
    assert next(p for p in info['prizes'] if p['model'] == 'Frost Fingers')['name'] == 'Snow Mittens'


def test_admin_can_pick_any_collection_and_model(client):
    admin = signed(42)
    cat = client.get('/api/admin/new-year/catalog', headers=admin).json['collections']
    assert len(cat) > 100 and any(c['id'] == 'toybear' for c in cat)
    models = client.get('/api/admin/new-year/catalog/toybear/models', headers=admin).json['models']
    assert any(m['name'] == 'Snowman' for m in models)
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    prize = {'kind': 'NFT', 'collection_id': 'toybear', 'model': 'Snowman', 'value': '38.19', 'weight': 1}
    saved = client.post('/api/admin/new-year/packs', headers=admin, json=dict(pack, prizes=[prize, {'kind': 'GRAM', 'amount': '1', 'weight': 5}]))
    assert saved.status_code == 200
    back = next(p for p in client.get('/api/admin/new-year/packs', headers=admin).json['packs'] if p['id'] == pack['id'])
    nft = next(p for p in back['prizes'] if p['kind'] == 'NFT')
    assert nft['model'] == 'Snowman' and nft['name'] == 'Toy Bear' and nft['value'] == '38.19'
    bad = client.post('/api/admin/new-year/packs', headers=admin, json=dict(pack, prizes=[dict(prize, model='No Such Model')]))
    assert bad.status_code == 400


def test_winter_pack_is_rare_cheap_and_listed_lots_know_their_pack(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    packs = {p['id']: p for p in client.get('/api/admin/new-year/packs', headers=admin).json['packs']}
    winter = packs['winter']
    assert winter['title'] == 'Winter' and winter['image'].endswith('winter-pack.webp')
    gifts = [p for p in winter['prizes'] if p['kind'] == 'NFT']
    assert len(gifts) >= 20 and all(float(p['value']) <= 15 for p in gifts)                 # nothing above 15
    total = sum(p['weight'] for p in winter['prizes'])
    cards = {int(k): v for k, v in winter['card_weights'].items()}
    mean = sum(k * v for k, v in cards.items()) / sum(cards.values())
    assert 0.3 <= 100 * mean * sum(p['weight'] for p in gifts) / total <= 0.9               # about one gift per 200 openings
    assert len([p for p in winter['prizes'] if p['kind'] == 'GRAM']) >= 10                  # lots of balance prizes
    assert 'pack_id' in __import__('inspect').getsource(__import__('resale'))


def test_pack_collection_page_shows_all_three_packs_as_png_models(client):
    player = signed(43)
    client.get('/api/me', headers=player)
    for key in ('pack', 'packs', 'Pack'):
        info = client.get('/api/collections/' + key + '/overview', headers=player)
        assert info.status_code == 200 and info.json['pack'] and info.json['collection']['name'] == 'Pack'
    models = info.json['models']
    assert {m['name'] for m in models} >= {'New Year', 'Snowman', 'Winter'}
    assert all(m['image'].startswith('/static/assets/packs/') for m in models)
    assert info.json['collection']['photo_url'] == models[0]['image']


def test_packs_share_one_running_number_and_cannot_be_crafted(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    for pack in ('winter', 'newyear', 'snowman', 'winter'):
        assert client.post('/api/admin/users/43/packs', headers=admin, json={'pack_id': pack}).status_code == 200
    items = [g for g in client.get('/api/inventory', headers=player).json['gifts'] if g.get('pack_item')]
    assert sorted(g['number'] for g in items) == [1, 2, 3, 4]                       # one order, not one per model
    assert {g['model'] for g in items} == {'Winter', 'New Year', 'Snowman'}
    craft = client.post('/api/craft/quote', headers=player, json={'gift_ids': [items[0]['id']], 'target_id': 'snoop'})
    assert craft.status_code == 409


def test_pack_opening_script_keeps_every_function_it_calls():
    import re
    from pathlib import Path
    code = (Path(__file__).resolve().parent.parent / 'static/packs.js').read_text(encoding='utf-8')
    for name in ('cardMarkup', 'tearPack', 'openInside', 'open', 'granted', 'openMany'):
        assert re.search(r'(async\s+)?function\s+' + name + r'\s*\(', code), name          # a slice edit once dropped cardMarkup and no pack could be opened
    assert 'catch (err)' in code and 'the show failed' in code                                 # a failing animation reveals the cards instead of freezing


def test_every_pack_has_its_own_backdrop_set():
    import packs
    names = {b[0] for b in packs.BACKDROPS}
    sets = {k: set(v) for k, v in packs.PACK_BACKDROPS.items()}
    assert set(sets) == {'newyear', 'snowman', 'winter'} and all(v <= names and len(v) == 6 for v in sets.values())
    for a in sets:
        for b in sets:
            if a < b:
                assert len(sets[a] & sets[b]) <= 1                                   # they may meet, but only a little
    assert {b[0] for b in packs.backdrops_for('winter')} == sets['winter']
    assert len(packs.backdrops_for('custom-pack')) == len(packs.BACKDROPS)           # a pack made by hand draws from all


def test_a_pack_gets_a_backdrop_from_its_own_set(client):
    import packs
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    for pack in ('winter', 'newyear', 'snowman'):
        for _ in range(6):
            client.post('/api/admin/users/43/packs', headers=admin, json={'pack_id': pack})
    items = [g for g in client.get('/api/inventory', headers=player).json['gifts'] if g.get('pack_item')]
    assert len(items) == 18
    for g in items:
        assert g['backdrop'] in packs.PACK_BACKDROPS[g['pack_id']]
        assert g['background']['center_color'] and g['background']['edge_color']
