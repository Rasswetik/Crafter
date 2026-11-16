import sqlite3

from test_app import client, signed


def enable(client, admin, **over):
    cfg = client.get('/api/admin/diamond', headers=admin).json['settings']
    cfg.update(enabled=True, **over)
    res = client.post('/api/admin/diamond', headers=admin, json=cfg)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.json


def give_balls(client, uid, n):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO new_year_wallets(user_id,balls) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balls=excluded.balls", (uid, n))


def balls(client, h):
    return client.get('/api/diamond', headers=h).json['balls']


def sectors(weights, tiers=None, reward=None):
    out = []
    for i, w in enumerate(weights):
        tier = (tiers or {}).get(i, 'common')
        out.append({'weight': w, 'tier': tier, 'reward': [] if tier == 'jackpot' else (reward or [{'kind': 'BALL', 'amount': '10', 'count': 1}])})
    return out


def test_closed_by_default_free_spin_once_a_day(client):
    admin, p = signed(42), signed(111)
    client.get('/api/me', headers=p)
    closed = client.get('/api/diamond', headers=p).json
    assert closed['enabled'] is False and 'sectors' not in closed
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).status_code == 409
    assert client.post('/api/admin/diamond', headers=p, json={}).status_code in (401, 403)
    enable(client, admin)
    st = client.get('/api/diamond', headers=p).json
    assert len(st['sectors']) == 12 and st['free_left'] == 1 and abs(sum(s['chance'] for s in st['sectors']) - 100) < 0.1
    res = client.post('/api/diamond/spin', headers=p, json={'mode': 'free'})
    assert res.status_code == 200 and 0 <= res.json['sector'] < 12 and res.json['state']['free_left'] == 0
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).status_code == 409
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'nope'}).status_code == 400


def test_paid_spins_price_limit_and_the_same_request_twice(client):
    admin, p = signed(42), signed(112)
    client.get('/api/me', headers=p)
    enable(client, admin, max_paid=2, price_base=100, price_step=100, sectors=sectors([1] * 12, {0: 'rare', 11: 'jackpot'}))
    give_balls(client, 112, 1000)
    st = client.get('/api/diamond', headers=p).json
    assert st['price'] == 100 and st['paid_left'] == 2
    r1 = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a1'})
    assert r1.status_code == 200
    spent = 1000 - balls(client, p)
    again = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a1'})
    assert again.status_code == 200 and again.json['again'] is True and again.json['sector'] == r1.json['sector']
    assert 1000 - balls(client, p) == spent                                       # the second request took nothing and gave nothing
    assert client.get('/api/diamond', headers=p).json['price'] == 200             # the price grows during the day
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a2'}).status_code == 200
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a3'}).status_code == 409   # the daily limit
    q = signed(113)
    client.get('/api/me', headers=q)
    assert client.post('/api/diamond/spin', headers=q, json={'mode': 'paid'}).status_code == 409                       # no money


def test_the_guaranteed_prize_comes_on_schedule(client):
    admin, p = signed(42), signed(114)
    client.get('/api/me', headers=p)
    enable(client, admin, max_paid=10, price_base=1, price_step=0, pity_every=3, sectors=sectors([1000, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], {1: 'rare', 10: 'epic', 11: 'jackpot'}))
    give_balls(client, 114, 100)
    tiers = []
    for i in range(3):
        res = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'p%d' % i})
        assert res.status_code == 200, res.get_data(as_text=True)
        tiers.append(res.json['tier'])
    assert tiers[2] in ('rare', 'epic')                                           # the third paid spin is a good prize at the latest


def test_jackpot_gives_the_pool_and_it_starts_again(client):
    admin, p = signed(42), signed(115)
    client.get('/api/me', headers=p)
    enable(client, admin, price_base=100, price_step=0, jackpot_start=5000, jackpot_rake=20, sectors=sectors([0] * 11 + [1], {5: 'rare', 11: 'jackpot'}))
    give_balls(client, 115, 1000)
    assert client.get('/api/diamond', headers=p).json['jackpot'] == 5000
    before = balls(client, p)
    res = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'j1'})
    assert res.status_code == 200 and res.json['tier'] == 'jackpot' and res.json['jackpot'] == 5020      # the pool and 20 percent of the price
    assert balls(client, p) == before - 100 + 5020
    assert res.json['state']['jackpot'] == 5000                                                           # the pool starts again
    wins = client.get('/api/diamond', headers=p).json['wins']
    assert wins and wins[0]['jackpot'] == 5020


def test_vip_levels_bonus_spins_and_admin_validation(client):
    admin, p = signed(42), signed(116)
    client.get('/api/me', headers=p)
    enable(client, admin, free_daily=1, xp_free=100, vip_xp=[0, 100, 400, 1200], vip_extra_free=[0, 1, 1, 2], vip_discount=[0, 5, 10, 20])
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).json['state']['vip']['level'] == 1       # 100 points: Silver
    st = client.get('/api/diamond', headers=p).json
    assert st['free_left'] == 1 and st['free_total'] == 2                                                              # a bonus spin from the level
    cfg = client.get('/api/admin/diamond', headers=admin).json['settings']
    assert client.post('/api/admin/diamond', headers=admin, json=dict(cfg, sectors=cfg['sectors'][:5])).status_code == 400
    assert client.post('/api/admin/diamond', headers=admin, json=dict(cfg, vip_xp=[5, 1, 2, 3])).status_code == 400
    bad = [dict(s) for s in cfg['sectors']]
    bad[0] = dict(bad[0], reward=[{'kind': 'PACK', 'amount': 'no-such', 'count': 1}])
    assert client.post('/api/admin/diamond', headers=admin, json=dict(cfg, sectors=bad)).status_code == 400
    nojp = [dict(s, tier='common') if s['tier'] == 'jackpot' else s for s in cfg['sectors']]
    assert client.post('/api/admin/diamond', headers=admin, json=dict(cfg, sectors=nojp)).status_code == 400
