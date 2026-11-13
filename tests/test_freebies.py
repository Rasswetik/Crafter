import time

from test_app import client, signed


def _msk(offset_seconds):
    t = time.gmtime(time.time() + 3 * 3600 + offset_seconds)
    return time.strftime('%Y-%m-%dT%H:%M', t)


def test_freebies_open_in_time_and_leave_a_receipt(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)
    ev = client.post('/api/admin/new-year/freebies/event', headers=admin, json={'title': 'Подарки Нового года', 'enabled': True}).json['id']
    pack = client.get('/api/admin/new-year/packs', headers=admin).json['packs'][0]
    mk = lambda **kw: client.post('/api/admin/new-year/freebies/gift', headers=admin, json={'event_id': ev, **kw})
    first = mk(label='День 1', unlock_at_msk=_msk(-3600), kind='PACK', amount=pack['id'], count=2, golden=True, size='large').json['id']
    later = mk(label='День 2', unlock_at_msk=_msk(86400), kind='BALL', amount='500').json['id']
    balls = mk(label='День 0', unlock_at_msk=_msk(-7200), kind='BALL', amount='500').json['id']
    gram = mk(label='Бонус', unlock_at_msk=_msk(-60), kind='GRAM', amount='0.5').json['id']
    assert mk(label='x', unlock_at_msk='вчера', kind='BALL', amount='1').status_code == 400
    assert mk(label='x', unlock_at_msk=_msk(0), kind='PACK', amount='nope').status_code == 400
    shown = client.get('/api/freebies', headers=player).json
    event = shown['events'][0]
    states = {x['label']: x['state'] for x in event['gifts']}
    assert states == {'День 0': 'ready', 'День 1': 'ready', 'Бонус': 'ready', 'День 2': 'locked'}
    assert all('amount' not in x and 'kind' not in x for x in event['gifts'])                   # the rewards are a surprise
    assert event['gifts'][1]['golden'] and event['gifts'][1]['size'] == 'large' and event['next_unlock'] and event['ready'] == 3
    assert client.post('/api/freebies/claim', headers=player, json={'gift_id': later}).status_code == 409   # too early
    got = client.post('/api/freebies/claim', headers=player, json={'gift_id': first}).json
    assert got['result']['title'].endswith('×2') and got['result']['image'] and len(got['pack_ids']) == 2
    assert client.post('/api/freebies/claim', headers=player, json={'gift_id': first}).json['again'] is True   # no second reward
    assert len(client.get('/api/packs', headers=player).json['mine']) == 2
    ball = client.post('/api/freebies/claim', headers=player, json={'gift_id': balls}).json
    assert ball['balance']['balls'] == 500 and ball['result']['title'] == '500 шаров'
    money = client.post('/api/freebies/claim', headers=player, json={'gift_id': gram}).json
    assert money['result']['title'] == '0.5 GRAM'
    after = {x['label']: x for x in client.get('/api/freebies', headers=player).json['events'][0]['gifts']}
    assert after['День 1']['state'] == 'claimed' and after['День 1']['reward']['title'].endswith('×2')
    # a series: the same reward every 12 hours, every second box is golden
    made = client.post('/api/admin/new-year/freebies/series', headers=admin, json={'event_id': ev, 'start_msk': _msk(3600), 'step_hours': 12, 'number': 4, 'golden_every': 2, 'kind': 'GRAM', 'amount': '0.1'})
    assert made.status_code == 200 and made.json['created'] == 4
    listing = client.get('/api/admin/new-year/freebies', headers=admin).json['events'][0]
    assert listing['total'] == 8 and sum(1 for x in listing['gifts'] if x['golden']) == 3
    # an event can be switched off, then players do not see it
    assert client.post('/api/admin/new-year/freebies/event', headers=admin, json={'id': ev, 'title': 'Подарки', 'enabled': False}).status_code == 200
    assert client.get('/api/freebies', headers=player).json['events'] == []
    assert client.post('/api/admin/new-year/freebies/event', headers=player, json={'title': 'x'}).status_code == 403
    assert client.post('/api/admin/new-year/freebies/event/%s/delete' % ev, headers=admin).status_code == 200


def test_freebies_event_has_its_own_period(client):
    admin, player = signed(42), signed(43)
    client.get('/api/me', headers=player)

    def made(**kw):
        ev = client.post('/api/admin/new-year/freebies/event', headers=admin, json={'title': 'Подарки', 'enabled': True, **kw})
        assert ev.status_code == 200, ev.get_data(as_text=True)
        client.post('/api/admin/new-year/freebies/gift', headers=admin, json={'event_id': ev.json['id'], 'label': 'День 1', 'unlock_at_msk': _msk(-3600), 'kind': 'BALL', 'amount': '10'})
        return ev.json['id']
    ended = made(ends_at_msk=_msk(-60))                                  # the box opened long ago, the event is over
    assert client.get('/api/freebies', headers=player).json['events'] == []
    gid = client.get('/api/admin/new-year/freebies', headers=admin).json['events'][0]['gifts'][0]['id']
    assert client.post('/api/freebies/claim', headers=player, json={'gift_id': gid}).status_code == 409
    client.post('/api/admin/new-year/freebies/event/%s/delete' % ended, headers=admin)
    made(starts_at_msk=_msk(3600), ends_at_msk=_msk(7200))               # not started yet
    assert client.get('/api/freebies', headers=player).json['events'] == []
    running = made(starts_at_msk=_msk(-3600), ends_at_msk=_msk(7200))   # running: opened boxes can be taken until the end
    shown = client.get('/api/freebies', headers=player).json['events']
    assert [x['id'] for x in shown] == [running] and shown[0]['ends_at']
    assert client.post('/api/admin/new-year/freebies/event', headers=admin, json={'title': 'x', 'starts_at_msk': _msk(100), 'ends_at_msk': _msk(50)}).status_code == 400
