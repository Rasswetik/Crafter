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
    assert pack['title'] == 'Новогодний пак' and len(pack['prizes']) > 15
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
    before = balance(client, player)
    opened = client.post('/api/packs/open', headers=player, json={'user_pack_id': upid})
    assert opened.status_code == 200 and len(opened.json['cards']) == 3
    gram = sum(Decimal(c['amount']) for c in opened.json['cards'] if c['kind'] == 'GRAM')
    assert balance(client, player) == before + gram
    again = client.post('/api/packs/open', headers=player, json={'user_pack_id': upid})
    assert again.json['cards'] == opened.json['cards'] and balance(client, player) == before + gram   # no double credit
    assert client.post('/api/packs/open', headers=signed(44), json={'user_pack_id': upid}).status_code in (404, 401)
    assert client.get('/api/packs', headers=player).json['mine'] == []

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
    assert {m['reward_kind'] for m in state} == {'PACK', 'GRAM'} and state[0]['pack']['title'] == 'Новогодний пак'
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

    code = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'PACK', 'reward': pack['id'], 'limit': 1})
    assert code.status_code == 200
    r = client.post('/api/promocodes/redeem', headers=player, json={'code': code.json['code']})
    assert r.status_code == 200 and r.json['pack_id']
    assert len(client.get('/api/packs', headers=player).json['mine']) == 1
