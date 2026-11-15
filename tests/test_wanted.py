import json
import sqlite3
import time

from test_app import client, signed
from test_pass import add_history


def setup_event(client, admin, **over):
    cfg = client.get('/api/admin/wanted', headers=admin).json['settings']
    cfg.update(enabled=True, starts_at='', ends_at='', release_at='2030-01-01 00:00')
    cfg.update(over)
    res = client.post('/api/admin/wanted', headers=admin, json={'settings': {k: cfg[k] for k in ('enabled', 'title', 'subtitle', 'starts_at', 'ends_at', 'release_at', 'day_one_stars', 'bonus_mult', 'bonus_hours', 'leader_places', 'leader_rewards')}})
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.json


def test_event_is_off_until_the_administrator_switches_it_on(client):
    admin, player = signed(42), signed(71)
    client.get('/api/me', headers=player)
    state = client.get('/api/wanted', headers=player).json
    assert state['enabled'] is False and len(state['missions']) == 7 and state['level'] == 0
    assert client.post('/api/wanted/claim', headers=player, json={'mission_id': 'first_theft'}).status_code == 409
    assert client.post('/api/admin/wanted', headers=player, json={'settings': {}}).status_code in (401, 403)
    saved = setup_event(client, admin)
    assert saved['settings']['enabled'] and saved['settings']['starts_at'] > 0               # the progress counts from the first switch on


def test_missions_open_in_order_and_give_stars_and_prizes_once(client):
    admin, player = signed(42), signed(72)
    client.get('/api/me', headers=player)
    setup_event(client, admin)
    time.sleep(1.1)
    st = lambda: client.get('/api/wanted', headers=player).json
    assert [m['status'] for m in st()['missions']][:2] == ['active', 'locked']
    claim = lambda mid: client.post('/api/wanted/claim', headers=player, json={'mission_id': mid})
    assert claim('first_theft').status_code == 409                                           # nothing done yet
    assert claim('car').status_code == 409                                                   # the previous mission is not taken
    add_history(client, 72, 'pack_open', {'pack': 'vicecity'}, n=3)
    add_history(client, 72, 'pack_open', {'pack': 'oceandrive'}, n=5)                        # other packs do not count for the Vice City mission
    assert st()['missions'][0]['progress'] == 3 and st()['missions'][0]['status'] == 'ready'
    res = claim('first_theft')
    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.json['level_after'] == 1 and res.json['new_stars'] == [1] and res.json['given']['items']
    assert claim('first_theft').status_code == 409                                           # one prize only
    assert st()['level'] == 1 and st()['stars'][0]['got'] and not st()['stars'][1]['got']
    add_history(client, 72, 'upgrade', n=5)
    res = claim('car')
    assert res.status_code == 200 and res.json['level_after'] == 1 and res.json['new_stars'] == []   # the second mission keeps one star


def test_leaders_progress_and_reset(client):
    admin, player = signed(42), signed(73)
    client.get('/api/me', headers=player)
    setup_event(client, admin)
    time.sleep(1.1)
    add_history(client, 73, 'arena_result', {}, n=2)
    leaders = client.get('/api/wanted/leaders', headers=player).json
    assert leaders['me']['points'] == 6 and leaders['leaders'][0]['points'] >= 6 and len(leaders['prizes']) == 3 and leaders['prizes']['1'][0]['kind'] == 'BALL'
    add_history(client, 73, 'pack_open', {'pack': 'vicecity'}, n=3)
    assert client.post('/api/wanted/claim', headers=player, json={'mission_id': 'first_theft'}).status_code == 200
    assert client.post('/api/admin/wanted/reset', headers=admin, json={'user_id': 73}).json['removed'] == 1
    assert client.get('/api/wanted', headers=player).json['level'] == 0


def test_admin_edits_missions_and_rewards_are_checked(client):
    admin = signed(42)
    data = client.get('/api/admin/wanted', headers=admin).json
    missions = data['missions']
    assert client.post('/api/admin/wanted', headers=admin, json={'missions': [dict(missions[0], reward='Кошка 5')]}).status_code == 400
    assert client.post('/api/admin/wanted', headers=admin, json={'missions': [dict(missions[0], metric='nothing')]}).status_code == 400
    ok = client.post('/api/admin/wanted', headers=admin, json={'missions': [dict(missions[0], reward='Шары 7'), dict(missions[1], title='Новая тачка')], 'stars': [{'star': 1, 'reward': 'Шары 5'}]})
    assert ok.status_code == 200 and len(ok.json['missions']) == 2
    assert ok.json['missions'][0]['reward'] == [{'kind': 'BALL', 'amount': '7', 'count': 1}] and ok.json['stars'][0]['reward'] == [{'kind': 'BALL', 'amount': '5', 'count': 1}]


def test_day_one_badge_goes_to_those_with_enough_stars_at_the_release(client):
    admin, player, late = signed(42), signed(74), signed(75)
    for h in (player, late):
        client.get('/api/me', headers=h)
    setup_event(client, admin, day_one_stars=1)
    with sqlite3.connect(client.application.config['DATABASE']) as conn:                   # the release is a few seconds ahead (the form has minutes only)
        cfg = json.loads(conn.execute("SELECT payload FROM settings WHERE key='wanted_event_v1'").fetchone()[0])
        cfg['release_at'] = int(time.time()) + 4
        conn.execute("UPDATE settings SET payload=? WHERE key='wanted_event_v1'", (json.dumps(cfg),))
    time.sleep(1.1)
    add_history(client, 74, 'pack_open', {'pack': 'vicecity'}, n=3)
    assert client.post('/api/wanted/claim', headers=player, json={'mission_id': 'first_theft'}).status_code == 200
    time.sleep(5)
    assert client.get('/api/wanted', headers=player).json['day_one']['got'] is True
    assert client.get('/api/wanted', headers=late).json['day_one']['got'] is False


def test_top_prizes_come_from_the_catalog_and_are_paid_once(client):
    admin, first, second = signed(42), signed(76), signed(77)
    for h in (first, second):
        client.get('/api/me', headers=h)
    setup_event(client, admin)
    time.sleep(1.1)
    add_history(client, 76, 'arena_result', {}, n=4)
    add_history(client, 77, 'arena_result', {}, n=1)
    cfg = client.get('/api/admin/wanted', headers=admin).json['settings']
    base = {k: cfg[k] for k in ('enabled', 'title', 'subtitle', 'starts_at', 'ends_at', 'release_at', 'day_one_stars', 'bonus_mult', 'bonus_hours')}
    base.update(starts_at=None, ends_at=None, release_at=None)
    bad = dict(base, leader_places=2, leader_rewards={'1': [{'kind': 'PACK', 'amount': 'no-such-pack', 'count': 1}]})
    assert client.post('/api/admin/wanted', headers=admin, json={'settings': bad}).status_code == 400          # only real packs
    good = dict(base, leader_places=2, leader_rewards={'1': [{'kind': 'BALL', 'amount': '500', 'count': 1}, {'kind': 'EMOJI', 'amount': 'wisecraft-cash', 'count': 1}], '2': [{'kind': 'BALL', 'amount': '50', 'count': 1}]})
    saved = client.post('/api/admin/wanted', headers=admin, json={'settings': good})
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert [t['user_id'] for t in saved.json['top']][:2] == ['76', '77']
    paid = client.post('/api/admin/wanted/payout', headers=admin, json={})
    assert paid.status_code == 200 and [p['place'] for p in paid.json['payouts']] == [1, 2]
    assert client.post('/api/admin/wanted/payout', headers=admin, json={}).status_code == 409                # only once
    assert client.get('/api/wanted/leaders', headers=first).json['paid'] is True
    assert client.post('/api/admin/wanted/payout/reset', headers=admin, json={}).json['payouts'] == []
