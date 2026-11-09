from datetime import datetime, timedelta, timezone

import pytest

import advent
from test_app import client, signed

MSK = timezone(timedelta(hours=3))


class Telegram:
    def __init__(self):
        self.status = 'left'
        self.bot_status = 'administrator'

    def __call__(self, token, method, payload, sticker=None):
        if method == 'getChat':
            return {'id': -1001234567890, 'type': 'channel', 'title': 'Crafter News', 'username': 'crafter_news'}
        if method == 'getMe':
            return {'id': 999}
        if method == 'getChatMember':
            return {'status': self.bot_status if payload['user_id'] == 999 else self.status}
        raise AssertionError(method)


@pytest.fixture
def tg(monkeypatch):
    fake = Telegram()
    monkeypatch.setattr(advent, 'bot_api', fake)
    return fake


def at(monkeypatch, y, m, d, h, mi=0):
    monkeypatch.setattr(advent, 'now', lambda: datetime(y, m, d, h, mi, tzinfo=MSK).timestamp())


def setup_calendar(client, enabled=True, require_sub=True):
    admin = signed(42)
    r = client.post('/api/admin/new-year/advent/settings', headers=admin, json={'enabled': enabled, 'start': '2026-12-01', 'days': 24, 'tz': 3, 'hour': 10, 'require_sub': require_sub})
    assert r.status_code == 200, r.json
    return admin


def test_channel_binding_needs_bot_admin(client, tg):
    admin, player = signed(42), signed(43)
    assert client.post('/api/admin/new-year/advent/channel', headers=player, json={'channel': '@crafter_news'}).status_code == 403
    assert client.post('/api/admin/new-year/advent/channel', headers=admin, json={'channel': 'not a channel!'}).status_code == 400
    tg.bot_status = 'member'
    assert client.post('/api/admin/new-year/advent/channel', headers=admin, json={'channel': '@crafter_news'}).status_code == 409
    tg.bot_status = 'administrator'
    bound = client.post('/api/admin/new-year/advent/channel', headers=admin, json={'channel': 'https://t.me/crafter_news'})
    assert bound.status_code == 200 and bound.json['channel']['title'] == 'Crafter News'
    assert client.get('/api/admin/new-year/advent', headers=admin).json['channel']['username'] == 'crafter_news'


def test_cells_open_daily_for_subscribers_only(client, tg, monkeypatch):
    admin, player = setup_calendar(client), signed(43)
    client.get('/api/me', headers=player)
    client.post('/api/admin/new-year/advent/channel', headers=admin, json={'channel': '@crafter_news'})
    assert client.get('/api/advent', headers=player).json == {'enabled': True, **{k: v for k, v in client.get('/api/advent', headers=player).json.items() if k != 'enabled'}}
    at(monkeypatch, 2026, 11, 30, 23)
    assert all(d['state'] == 'locked' for d in client.get('/api/advent', headers=player).json['days'])
    at(monkeypatch, 2026, 12, 1, 9, 59)
    assert client.post('/api/advent/open', headers=player, json={'day': 1}).status_code == 409          # not yet 10:00
    at(monkeypatch, 2026, 12, 1, 10, 0)
    state = client.get('/api/advent', headers=player).json
    assert state['days'][0]['state'] == 'ready' and state['days'][1]['state'] == 'locked' and state['subscribed'] is False
    assert client.post('/api/advent/open', headers=player, json={'day': 1}).status_code == 403          # not subscribed
    tg.status = 'member'
    monkeypatch.setattr(advent, 'now', lambda: datetime(2026, 12, 1, 10, 1, tzinfo=MSK).timestamp() + 60)   # skip the membership cache
    opened = client.post('/api/advent/open', headers=player, json={'day': 1})
    assert opened.status_code == 200 and opened.json['reward']['kind'] == 'BALL' and opened.json['reward']['balls'] == 50
    assert client.post('/api/advent/open', headers=player, json={'day': 1}).json['repeat'] is True            # no second reward
    assert client.get('/api/new-year', headers=signed(42)).status_code in (200, 404)
    assert client.post('/api/advent/open', headers=player, json={'day': 2}).status_code == 409
    at(monkeypatch, 2026, 12, 2, 10, 5)
    tg.status = 'member'
    promo = client.post('/api/advent/open', headers=player, json={'day': 2}).json['reward']
    assert promo['kind'] == 'PROMO' and promo['code'].startswith('NY-')
    assert client.post('/api/promocodes/redeem', headers=signed(44), json={'code': promo['code']}).status_code in (401, 403, 404)
    assert client.post('/api/promocodes/redeem', headers=player, json={'code': promo['code']}).status_code == 200


def test_free_calendar_without_channel_pack_and_edits(client, tg, monkeypatch):
    admin, player = setup_calendar(client), signed(43)
    client.get('/api/me', headers=player)
    at(monkeypatch, 2026, 12, 6, 12)
    # no channel is bound: everybody can open; the day-6 cell gives a pack
    reward = client.post('/api/advent/open', headers=player, json={'day': 6}).json['reward']
    assert reward['kind'] == 'PACK' and len(reward['pack_ids']) == 1
    assert len(client.get('/api/packs', headers=player).json['mine']) == 1
    # admin edits a cell
    bad = client.post('/api/admin/new-year/advent/days/7', headers=admin, json={'kind': 'GRAM', 'amount': 'abc'})
    assert bad.status_code == 400
    ok = client.post('/api/admin/new-year/advent/days/7', headers=admin, json={'kind': 'GRAM', 'amount': '2.5', 'title': 'Двойной подарок'})
    assert ok.status_code == 200
    at(monkeypatch, 2026, 12, 8, 12)
    got = client.post('/api/advent/open', headers=player, json={'day': 7}).json['reward']
    assert got['title'] == 'Двойной подарок' and got['gram_balance'] and got['amount'] == '2.5'
    # switched off: players cannot open and see nothing
    setup_calendar(client, enabled=False)
    assert client.get('/api/advent', headers=player).json == {'enabled': False}
    assert client.post('/api/advent/open', headers=player, json={'day': 8}).status_code == 409


def test_admin_can_reset_the_calendar(client, tg, monkeypatch):
    admin, player = setup_calendar(client, require_sub=False), signed(43)
    client.get('/api/me', headers=player)
    at(monkeypatch, 2026, 12, 3, 12)
    assert client.post('/api/advent/open', headers=player, json={'day': 1}).status_code == 200
    assert client.post('/api/admin/new-year/advent/reset', headers=player, json={'confirm': 'RESET_ADVENT'}).status_code == 403
    assert client.post('/api/admin/new-year/advent/reset', headers=admin, json={}).status_code == 400
    client.post('/api/admin/new-year/advent/days/2', headers=admin, json={'kind': 'BALL', 'amount': '777'})
    assert client.post('/api/admin/new-year/advent/reset', headers=admin, json={'confirm': 'RESET_ADVENT'}).status_code == 200
    days = client.get('/api/advent', headers=player).json['days']
    assert days[0]['state'] == 'ready' and not [d for d in days if d['state'] == 'opened']
    assert client.post('/api/advent/open', headers=player, json={'day': 1}).json.get('repeat') is None          # can be opened again
    assert next(d for d in client.get('/api/admin/new-year/advent', headers=admin).json['days'] if d['day'] == 2)['amount'] == '777'   # rewards stay
    client.post('/api/admin/new-year/advent/reset', headers=admin, json={'confirm': 'RESET_ADVENT', 'rewards': True})
    assert next(d for d in client.get('/api/admin/new-year/advent', headers=admin).json['days'] if d['day'] == 2)['kind'] == 'PROMO'   # defaults are back
