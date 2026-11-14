import json
import sqlite3
import time

from test_app import client, signed


def make_season(client, admin, **extra):
    body = {'number': 5, 'title': 'Зимний сезон', 'subtitle': 'Сезон 5', 'plus_price': 300, 'plus_currency': 'BALL', 'level_price': 50, 'level_currency': 'BALL', 'enabled': True,
            'theme': {'c1': '#5b2cff', 'c2': '#c24fd8', 'pattern': 'snow'},
            'levels': [{'xp': 100, 'free': [{'kind': 'BALL', 'amount': '10'}], 'plus': [{'kind': 'GRAM', 'amount': '0.5'}]},
                       {'xp': 200, 'free': [{'kind': 'PACK', 'amount': 'newyear', 'count': 1}], 'plus': [{'kind': 'CHEST', 'amount': 'santa', 'count': 1}]},
                       {'xp': 300, 'free': [], 'plus': [{'kind': 'DROP', 'amount': 'snowman_drop', 'count': 1}]}]}
    body.update(extra)
    made = client.post('/api/admin/pass/season', headers=admin, json=body)
    assert made.status_code == 200, made.get_data(as_text=True)
    return made.json['id']


def add_history(client, uid, kind, payload=None, n=1):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for i in range(n):
            db.execute("INSERT INTO history(id,user_id,kind,payload,created) VALUES(?,?,?,?,?)", ('h%s%s%d%d' % (kind, uid, i, time.time_ns()), uid, kind, json.dumps(payload or {}), int(time.time())))


def test_pass_levels_quests_and_purchases(client):
    admin, player = signed(42), signed(55)
    client.get('/api/me', headers=player)
    assert client.get('/api/pass', headers=player).json['season'] is None
    sid = make_season(client, admin)
    quests = [{'kind': 'daily', 'title': 'Сделайте 2 апгрейда', 'metric': 'upgrade', 'target': 2, 'xp': 150, 'icon': 'upgrade'},
              {'kind': 'mega', 'title': 'Первый мега', 'metric': 'craft', 'target': 1, 'xp': 100, 'reward': [{'kind': 'BALL', 'amount': '25'}]},
              {'kind': 'mega', 'title': 'Второй мега', 'metric': 'craft', 'target': 3, 'xp': 100},
              {'kind': 'season', 'title': 'Только Plus', 'metric': 'deposit_gram', 'target': 5, 'xp': 50, 'plus_only': True}]
    saved = client.post('/api/admin/pass/quests', headers=admin, json={'season_id': sid, 'quests': quests})
    assert saved.status_code == 200, saved.get_data(as_text=True)
    state = client.get('/api/pass', headers=player).json
    assert state['season']['title'] == 'Зимний сезон' and state['me']['level'] == 0 and len(state['levels']) == 3
    daily = state['quests']['daily'][0]
    assert daily['progress'] == 0 and not daily['done']
    assert client.post('/api/pass/quest/claim', headers=player, json={'quest_id': daily['id']}).status_code == 409        # not done yet
    add_history(client, 55, 'upgrade', n=2)
    daily = client.get('/api/pass', headers=player).json['quests']['daily'][0]
    assert daily['progress'] == 2 and daily['done']
    got = client.post('/api/pass/quest/claim', headers=player, json={'quest_id': daily['id']})
    assert got.status_code == 200 and got.json['xp'] == 150 and got.json['level_after'] == 1
    assert client.post('/api/pass/quest/claim', headers=player, json={'quest_id': daily['id']}).status_code == 409        # once a day
    mega = client.get('/api/pass', headers=player).json['quests']['mega']
    assert mega[0]['locked'] is False and mega[1]['locked'] is True                                                 # a chain
    assert client.post('/api/pass/claim', headers=player, json={'level': 1, 'track': 'plus'}).status_code == 409
    free = client.post('/api/pass/claim', headers=player, json={'level': 1, 'track': 'free'})
    assert free.status_code == 200 and free.json['balance']['balls'] == 10
    assert client.post('/api/pass/claim', headers=player, json={'level': 2, 'track': 'free'}).status_code == 409        # level 2 is not reached
    assert client.post('/api/pass/buy-plus', headers=player).status_code == 409                                          # no balls
    client.post('/api/admin/new-year/wallet', headers=admin, json={'user_id': '55', 'balls': '1000', 'donate': '0', 'tinsel': '0'})
    plus = client.post('/api/pass/buy-plus', headers=player)
    assert plus.status_code == 200 and plus.json['plus'] and plus.json['balance']['balls'] == 710
    assert client.post('/api/pass/buy-plus', headers=player).json['again']                                                # no second payment
    lvl = client.post('/api/pass/buy-level', headers=player, json={'count': 2})
    assert lvl.status_code == 200 and lvl.json['level'] == 3 and lvl.json['balance']['balls'] == 610
    everything = client.post('/api/pass/claim', headers=player, json={'track': 'all'})
    assert everything.status_code == 200, everything.get_data(as_text=True)
    assert everything.json['given']['chest_opens'] and everything.json['given']['drop_granted']['qty'] == 1
    assert client.post('/api/pass/claim', headers=player, json={'track': 'all'}).status_code == 409                       # nothing left
    plus_quest = client.get('/api/pass', headers=player).json['quests']['season'][0]
    assert plus_quest['plus_only'] and not plus_quest['done']


def test_pass_admin_checks_and_hidden_season(client):
    admin, player = signed(42), signed(56)
    client.get('/api/me', headers=player)
    assert client.post('/api/admin/pass/season', headers=admin, json={'title': '', 'levels': []}).status_code == 400
    bad = client.post('/api/admin/pass/season', headers=admin, json={'title': 'x', 'levels': [{'xp': 10, 'free': [{'kind': 'PACK', 'amount': 'nope'}]}]})
    assert bad.status_code == 400
    sid = make_season(client, admin, enabled=False)
    assert client.get('/api/pass', headers=player).json['season'] is None                                                # a hidden season is not shown
    assert client.post('/api/admin/pass/season', headers=signed(56), json={'title': 'x'}).status_code in (401, 403)
    listing = client.get('/api/admin/pass', headers=admin).json
    assert listing['seasons'][0]['id'] == sid and any(m['key'] == 'upgrade' for m in listing['metrics'])
    ended = make_season(client, admin, title='Старый', number=1, ends_at_msk='2020-01-01T00:00', starts_at_msk='2019-01-01T00:00')
    assert client.get('/api/pass', headers=player).json['season'] is None
    assert client.post('/api/admin/pass/season/%s/delete' % ended, headers=admin).status_code == 200


def test_season_has_its_own_page(client):
    page = client.get('/season')
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    assert 'id="sp-app"' in html and 'season-page.js' in html and 'season-core.js' in html
