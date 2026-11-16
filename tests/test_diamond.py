import copy
import sqlite3

from test_app import client, signed


def cfg_of(client, admin):
    return client.get('/api/admin/diamond', headers=admin).json['settings']


def enable(client, admin, wheel=None, widx=0, slots=None, **over):
    cfg = cfg_of(client, admin)
    cfg.update(enabled=True, **over)
    if wheel:
        cfg['wheels'][widx].update(wheel)
    if slots:
        cfg['slots'].update(slots)
    res = client.post('/api/admin/diamond', headers=admin, json=cfg)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.json


def give_balls(client, uid, n):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO new_year_wallets(user_id,balls) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balls=excluded.balls", (uid, n))


def balls(client, h):
    return client.get('/api/diamond', headers=h).json['balls']


def wheel(client, h, wid='classic'):
    return next(w for w in client.get('/api/diamond', headers=h).json['wheels'] if w['id'] == wid)


def sectors(weights, tiers=None, reward=None):
    out = []
    for i, w in enumerate(weights):
        tier = (tiers or {}).get(i, 'common')
        out.append({'weight': w, 'tier': tier, 'reward': [] if tier == 'jackpot' else (reward or [{'kind': 'BALL', 'amount': '10', 'count': 1}])})
    return out


def only(symbol, others=0, pay3=7):
    ids = ('coin', 'cyan', 'pink', 'gold', 'silver', 'crown', 'badge', 'diamond')
    return [{'id': i, 'weight': 1 if i == symbol else others, 'pay3': pay3 if i != 'diamond' else 0, 'pay2': 1.2} for i in ids]


def test_closed_by_default_three_wheels_free_spin_once_a_day(client):
    admin, p = signed(42), signed(111)
    client.get('/api/me', headers=p)
    closed = client.get('/api/diamond', headers=p).json
    assert closed['enabled'] is False and 'wheels' not in closed
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).status_code == 409
    assert client.post('/api/admin/diamond', headers=p, json={}).status_code in (401, 403)
    enable(client, admin)
    st = client.get('/api/diamond', headers=p).json
    assert [w['id'] for w in st['wheels']] == ['classic', 'gold', 'diamond', 'royal'] and [w['locked'] for w in st['wheels']] == [False, True, True, True]
    assert all(len(w['sectors']) == 12 and abs(sum(s['chance'] for s in w['sectors']) - 100) < 0.1 for w in st['wheels'])
    assert wheel(client, p)['free_left'] == 1
    res = client.post('/api/diamond/spin', headers=p, json={'mode': 'free'})
    assert res.status_code == 200 and 0 <= res.json['sector'] < 12 and wheel(client, p)['free_left'] == 0
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).status_code == 409
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'nope'}).status_code == 400
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free', 'wheel': 'nowhere'}).status_code == 400


def test_paid_spins_price_limit_and_the_same_request_twice(client):
    admin, p = signed(42), signed(112)
    client.get('/api/me', headers=p)
    enable(client, admin, wheel={'max_paid': 2, 'price_base': 100, 'price_step': 100, 'sectors': sectors([1] * 12, {0: 'rare', 11: 'jackpot'})})
    give_balls(client, 112, 1000)
    w = wheel(client, p)
    assert w['price'] == 100 and w['paid_left'] == 2
    r1 = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a1'})
    assert r1.status_code == 200
    spent = 1000 - balls(client, p)
    again = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a1'})
    assert again.status_code == 200 and again.json['again'] is True and again.json['sector'] == r1.json['sector']
    assert 1000 - balls(client, p) == spent                                       # the second request took nothing and gave nothing
    assert wheel(client, p)['price'] == 200                                       # the price grows during the day
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a2'}).status_code == 200
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'a3'}).status_code == 409   # the daily limit
    q = signed(113)
    client.get('/api/me', headers=q)
    assert client.post('/api/diamond/spin', headers=q, json={'mode': 'paid'}).status_code == 409                       # no money


def test_the_guaranteed_prize_comes_on_schedule(client):
    admin, p = signed(42), signed(114)
    client.get('/api/me', headers=p)
    enable(client, admin, wheel={'max_paid': 10, 'price_base': 1, 'price_step': 0, 'pity_every': 3, 'sectors': sectors([1000, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], {1: 'rare', 10: 'epic', 11: 'jackpot'})})
    give_balls(client, 114, 100)
    tiers = []
    for i in range(3):
        res = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'p%d' % i})
        assert res.status_code == 200, res.get_data(as_text=True)
        tiers.append(res.json['tier'])
    assert tiers[2] in ('rare', 'epic')


def test_jackpot_gives_the_pool_and_it_starts_again(client):
    admin, p = signed(42), signed(115)
    client.get('/api/me', headers=p)
    enable(client, admin, jackpot_start=5000, jackpot_rake=20, wheel={'price_base': 100, 'price_step': 0, 'sectors': sectors([0] * 11 + [1], {5: 'rare', 11: 'jackpot'})})
    give_balls(client, 115, 1000)
    assert client.get('/api/diamond', headers=p).json['jackpot'] == 5000
    before = balls(client, p)
    res = client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'request_id': 'j1'})
    assert res.status_code == 200 and res.json['tier'] == 'jackpot' and res.json['jackpot'] == 5020
    assert balls(client, p) == before - 100 + 5020
    assert res.json['state']['jackpot'] == 5000
    wins = client.get('/api/diamond', headers=p).json['wins']
    assert wins and wins[0]['jackpot'] == 5020


def test_vip_unlocks_the_gold_wheel_and_bonus_spins(client):
    admin, p = signed(42), signed(116)
    client.get('/api/me', headers=p)
    enable(client, admin, xp_free=100, vip_xp=[0, 100, 400, 1200], vip_extra_free=[0, 1, 1, 2], vip_discount=[0, 5, 10, 20])
    give_balls(client, 116, 100000)
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'wheel': 'gold'}).status_code == 409        # a closed wheel
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'free'}).json['state']['vip']['level'] == 1          # 100 points: Silver
    w = wheel(client, p)
    assert w['free_left'] == 1 and w['free_total'] == 2                                                                  # a bonus spin from the level
    gold = wheel(client, p, 'gold')
    assert gold['locked'] is False and gold['price'] == int(round(500 * 0.95))                                          # 5 percent discount
    assert client.post('/api/diamond/spin', headers=p, json={'mode': 'paid', 'wheel': 'gold'}).status_code == 200
    assert wheel(client, p, 'diamond')['locked'] is True and wheel(client, p, 'royal')['locked'] is True
    royal = wheel(client, p, 'royal')
    kinds = {r['kind'] for sec in royal['sectors'] for r in sec['rewards']}
    assert 'GRAM' in kinds and 'BALL' in kinds                                                                     # the expensive wheel can drop GRAM


def test_slots_pay_by_the_table_limits_and_the_same_request(client):
    admin, p = signed(42), signed(117)
    client.get('/api/me', headers=p)
    enable(client, admin, slots={'enabled': True, 'bets': [50, 100], 'max_spins': 2, 'daily_bet_cap': 1000, 'symbols': only('coin', pay3=1.4)})
    give_balls(client, 117, 1000)
    st = client.get('/api/diamond', headers=p).json['slots']
    assert st['enabled'] and st['bets'] == [50, 100] and st['spins_left'] == 2 and len(st['symbols']) == 8
    assert client.post('/api/diamond/slots/spin', headers=p, json={'bet': 75}).status_code == 400
    res = client.post('/api/diamond/slots/spin', headers=p, json={'bet': 100, 'request_id': 's1'})
    assert res.status_code == 200 and res.json['reels'] == ['coin', 'coin', 'coin'] and res.json['win'] == 140 and res.json['jackpot'] == 0
    assert balls(client, p) == 1000 - 100 + 140
    again = client.post('/api/diamond/slots/spin', headers=p, json={'bet': 100, 'request_id': 's1'})
    assert again.status_code == 200 and again.json['again'] is True and balls(client, p) == 1000 - 100 + 140
    assert client.post('/api/diamond/slots/spin', headers=p, json={'bet': 50, 'request_id': 's2'}).status_code == 200
    assert client.post('/api/diamond/slots/spin', headers=p, json={'bet': 50, 'request_id': 's3'}).status_code == 409   # the limit of spins
    poor = signed(118)
    client.get('/api/me', headers=poor)
    assert client.post('/api/diamond/slots/spin', headers=poor, json={'bet': 50}).status_code == 409


def test_slots_jackpot_gives_the_pool(client):
    admin, p = signed(42), signed(119)
    client.get('/api/me', headers=p)
    enable(client, admin, jackpot_start=5000, slots={'enabled': True, 'bets': [100], 'rake': 10, 'symbols': only('diamond')})
    give_balls(client, 119, 500)
    res = client.post('/api/diamond/slots/spin', headers=p, json={'bet': 100})
    assert res.status_code == 200 and res.json['reels'] == ['diamond'] * 3 and res.json['jackpot'] == 5010
    assert balls(client, p) == 500 - 100 + 5010 and res.json['state']['jackpot'] == 5000


def test_admin_validation_and_the_return_of_the_slots(client):
    admin = signed(42)
    cfg = cfg_of(client, admin)
    ok = client.get('/api/admin/diamond', headers=admin).json['return']
    assert 80 <= ok['rtp'] <= 100                                                                           # the default slots return about 90 percent
    assert client.post('/api/admin/diamond', headers=admin, json=dict(cfg, vip_xp=[5, 1, 2, 3])).status_code == 400
    bad = copy.deepcopy(cfg)
    bad['wheels'][0]['sectors'] = bad['wheels'][0]['sectors'][:5]
    assert client.post('/api/admin/diamond', headers=admin, json=bad).status_code == 400
    bad = copy.deepcopy(cfg)
    bad['wheels'][1]['sectors'][0]['reward'] = [{'kind': 'PACK', 'amount': 'no-such', 'count': 1}]
    assert client.post('/api/admin/diamond', headers=admin, json=bad).status_code == 400
    bad = copy.deepcopy(cfg)
    bad['wheels'][2]['sectors'] = [dict(s, tier='common') if s['tier'] == 'jackpot' else s for s in bad['wheels'][2]['sectors']]
    assert client.post('/api/admin/diamond', headers=admin, json=bad).status_code == 400
    bad = copy.deepcopy(cfg)
    bad['slots']['symbols'][0]['pay3'] = 100000                                                              # a machine that pays out more than it takes
    assert client.post('/api/admin/diamond', headers=admin, json=bad).status_code == 400
    bad = copy.deepcopy(cfg)
    bad['slots']['symbols'] = bad['slots']['symbols'][::-1]
    assert client.post('/api/admin/diamond', headers=admin, json=bad).status_code == 400
