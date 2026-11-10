import json
import sqlite3

import pytest

import relayer_stars as rs
import star_gifts
from test_app import client, signed
from test_resale import telegram_messages  # noqa: F401  (autouse notification stubs)
from test_upgrade import setup  # noqa: F401


def grant(client, uid, key, count=1):
    client.get('/api/me', headers=signed(uid, username='user%d' % uid))
    done = client.post('/api/admin/star-gifts/grant', headers=signed(), json={'user_id': uid, 'key': key, 'count': count})
    assert done.status_code == 200
    return [g for g in client.get('/api/inventory', headers=signed(uid)).json['gifts'] if g.get('star_gift')]


def balance(client, uid):
    return client.get('/api/me', headers=signed(uid)).json['balance']


def relayer(client, monkeypatch, outcome=None):
    client.application.extensions['crafter_relayer_credentials'] = lambda: (1, 'hash', 'session', 777)
    sent = []

    async def send(api_id, api_hash, session, to_id, to_username, stars, emoji, text, before_send, tg_id=None):
        if isinstance(outcome, Exception) and not isinstance(outcome, rs.LowBalance) and not getattr(outcome, 'after_send', False):
            raise outcome
        if isinstance(outcome, rs.LowBalance):
            raise outcome
        before_send()
        if outcome is not None:
            raise outcome
        sent.append((to_id, to_username, stars, emoji, text))
        return True

    monkeypatch.setattr(rs, 'send', send)
    return sent


def enable(client):
    assert client.post('/api/admin/star-gifts', headers=signed(), json={'enabled': True, 'confirm': 'SET_STAR_GIFTS'}).status_code == 200


def test_catalog_and_prices(client):
    gifts = {g['key']: g for g in client.get('/api/star-gifts/catalog', headers=signed()).json['gifts']}
    assert gifts['bear']['price'] == '0.15' and gifts['rose']['price'] == '0.25' and gifts['cake']['price'] == '0.50' and gifts['diamond']['price'] == '1.00'
    gift, = grant(client, 43, 'bear')
    assert gift['price'] == '0.15' and gift['stars'] == 15 and gift['image'].endswith('/bear.svg') and gift['origin'] == 'star-gift'


def test_sell_credits_balance_once(client):
    gift, = grant(client, 43, 'rose')
    before = float(balance(client, 43))
    sold = client.post('/api/star-gifts/sell', headers=signed(43), json={'gift_id': gift['id']})
    assert sold.status_code == 200 and sold.json['amount'] == '0.25'
    assert round(float(balance(client, 43)) - before, 2) == 0.25
    assert client.post('/api/star-gifts/sell', headers=signed(43), json={'gift_id': gift['id']}).status_code == 404
    assert [g for g in client.get('/api/inventory', headers=signed(43)).json['gifts'] if g.get('star_gift')] == []
    assert client.post('/api/star-gifts/sell', headers=signed(44), json={'gift_id': gift['id']}).status_code == 404


def test_not_for_market_and_not_for_nft_withdraw(client):
    gift, = grant(client, 43, 'cake')
    listed = client.post('/api/resale/listings', headers=signed(43), json={'action': 'sell', 'items': [{'id': gift['id'], 'price': '1'}]})
    assert listed.status_code == 409
    assert client.post('/api/gifts/withdraw', headers=signed(43), json={'gift_id': gift['id'], 'request_id': 'r1'}).status_code in (409,)


def test_withdraw_sends_gift_from_crafter(client, monkeypatch):
    gift, = grant(client, 43, 'bear')
    sent = relayer(client, monkeypatch)
    queued = client.post('/api/star-gifts/withdraw', headers=signed(43, username='user43'), json={'gift_id': gift['id']})
    assert queued.status_code == 200 and queued.json['auto'] is False
    held, = [g for g in client.get('/api/inventory', headers=signed(43)).json['gifts'] if g.get('star_gift')]
    assert held['status'] == 'withdrawing'
    assert client.post('/api/star-gifts/sell', headers=signed(43), json={'gift_id': gift['id']}).status_code == 409
    assert client.post('/api/admin/star-gifts/run', headers=signed(), json={}).status_code == 409      # automation is off
    enable(client)
    assert client.post('/api/admin/star-gifts/run', headers=signed(), json={}).json['processed'] == 1
    assert sent == [(43, 'user43', 15, '🧸', 'Gift from Crafter')]
    assert [g for g in client.get('/api/inventory', headers=signed(43)).json['gifts'] if g.get('star_gift')] == []
    job, = client.get('/api/admin/star-gifts', headers=signed()).json['jobs']
    assert job['status'] == 'confirmed'
    assert client.post('/api/admin/star-gifts/run', headers=signed(), json={}).json['processed'] == 0      # never repeated


def test_low_stars_waits_and_gift_stays_reserved(client, monkeypatch):
    gift, = grant(client, 43, 'diamond')
    relayer(client, monkeypatch, rs.LowBalance(40, 100))
    client.post('/api/star-gifts/withdraw', headers=signed(43), json={'gift_id': gift['id']})
    enable(client)
    client.post('/api/admin/star-gifts/run', headers=signed(), json={})
    info = client.get('/api/admin/star-gifts', headers=signed()).json
    job, = info['jobs']
    assert job['status'] == 'queued' and '40' in job['note'] and info['state']['stars'] == 40
    assert client.post('/api/admin/star-gifts/run', headers=signed(), json={}).json['processed'] == 0      # waits for the retry time


def test_unreachable_recipient_returns_the_gift(client, monkeypatch):
    gift, = grant(client, 43, 'rose')
    relayer(client, monkeypatch, rs.Unresolvable('x'))
    client.post('/api/star-gifts/withdraw', headers=signed(43), json={'gift_id': gift['id']})
    enable(client)
    client.post('/api/admin/star-gifts/run', headers=signed(), json={})
    back, = [g for g in client.get('/api/inventory', headers=signed(43)).json['gifts'] if g.get('star_gift')]
    assert back['status'] == 'unlisted'
    assert client.get('/api/admin/star-gifts', headers=signed()).json['jobs'][0]['status'] == 'failed'


def test_unknown_outcome_goes_to_review_and_is_never_repeated(client, monkeypatch):
    gift, = grant(client, 43, 'rose')
    error = RuntimeError('timeout')
    error.after_send = True
    relayer(client, monkeypatch, error)
    client.post('/api/star-gifts/withdraw', headers=signed(43), json={'gift_id': gift['id']})
    enable(client)
    client.post('/api/admin/star-gifts/run', headers=signed(), json={})
    job, = client.get('/api/admin/star-gifts', headers=signed()).json['jobs']
    assert job['status'] == 'review'
    assert client.post('/api/admin/star-gifts/run', headers=signed(), json={}).json['processed'] == 0
    resolved = client.post('/api/admin/star-gifts/%s/resolve' % job['id'], headers=signed(), json={'decision': 'failed'})
    assert resolved.status_code == 200
    assert [g for g in client.get('/api/inventory', headers=signed(43)).json['gifts'] if g.get('star_gift')][0]['status'] == 'unlisted'


def test_admin_needs_relayer_and_confirmation(client):
    assert client.post('/api/admin/star-gifts', headers=signed(), json={'enabled': True}).status_code == 400
    assert client.post('/api/admin/star-gifts', headers=signed(), json={'enabled': True, 'confirm': 'SET_STAR_GIFTS'}).status_code == 409
    assert client.get('/api/admin/star-gifts', headers=signed(43)).status_code == 403
    assert client.post('/api/admin/star-gifts/grant', headers=signed(43), json={'user_id': 43, 'key': 'bear'}).status_code == 403


def test_can_be_a_stake_in_upgrade(client, setup):
    gift, = grant(client, 43, 'diamond')
    stakes = {g['id']: g for g in client.get('/api/upgrade/stakes', headers=signed(43)).json['gifts']}
    assert gift['id'] in stakes


def test_partner_api_hides_them(client):
    gift, = grant(client, 43, 'bear')
    with client.application.app_context():
        key = client.application.extensions['crafter_partner_key'](43)
    listed = client.get('/api/partner/v1/inventory', headers={'Authorization': 'Bearer ' + key}).json['gifts']
    assert gift['id'] not in [g['gift_id'] for g in listed]


def test_pick_matches_emoji_and_skips_limited():
    class Doc:
        def __init__(self, alt):
            self.attributes = [type('A', (), {'alt': alt})()]

    def gift(i, stars, alt, limited=False):
        return type('G', (), {'id': i, 'stars': stars, 'sticker': Doc(alt), 'limited': limited, 'sold_out': False})()
    gifts = [gift(1, 15, '❤'), gift(2, 15, '🧸'), gift(3, 25, '🌹', limited=True), gift(4, 25, '🌹')]
    assert rs.pick(gifts, 15, '🧸').id == 2
    assert rs.pick(gifts, 15, '❤️').id == 1          # variation selector is ignored
    assert rs.pick(gifts, 25, '🌹').id == 4
    assert rs.pick(gifts, 100, '💎') is None


def mine(client, uid):
    return [g for g in client.get('/api/inventory', headers=signed(uid)).json['gifts'] if g.get('star_gift')]


def test_promo_code_gives_telegram_gifts(client):
    admin, player = signed(), signed(43)
    client.get('/api/me', headers=player)
    bad = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'STAR', 'reward': 'nope', 'limit': 3})
    assert bad.status_code == 400
    made = client.post('/api/admin/promocodes', headers=admin, json={'currency': 'STAR', 'reward': 'bear', 'pack_count': 2, 'limit': 3})
    assert made.status_code == 200 and made.json['reward'] == 'bear:2'
    got = client.post('/api/promocodes/redeem', headers=player, json={'code': made.json['code']})
    assert got.status_code == 200 and got.json['currency'] == 'STAR' and got.json['count'] == 2
    assert [g['star_key'] for g in mine(client, 43)] == ['bear', 'bear']
    assert client.post('/api/promocodes/redeem', headers=player, json={'code': made.json['code']}).status_code == 409


def test_shop_item_gives_telegram_gifts(client):
    admin, player = signed(), signed(43)
    client.get('/api/me', headers=player)
    assert client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'STAR', 'amount': 'nope'}).status_code == 400
    assert client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'STAR', 'amount': 'rocket', 'bundle': 3, 'price_balls': 0}).status_code == 200
    item, = client.get('/api/shop-items', headers=player).json['items']
    assert item['star']['stars'] == 50 and item['title'] == 'Rocket ×3'
    bought = client.post('/api/shop-items/buy', headers=player, json={'item_id': item['id'], 'request_id': 'star-shop-0001'})
    assert bought.status_code == 200 and bought.json['count'] == 3
    assert len(mine(client, 43)) == 3


def test_community_goal_gives_a_telegram_gift(client):
    import sqlite3, time, uuid
    admin, player = signed(), signed(43)
    client.get('/api/me', headers=player)
    client.application.config['COMMUNITY_CACHE_SECONDS'] = 0
    client.post('/api/admin/new-year/community', headers=admin, json={'title': 'Цель', 'description': 'x', 'metric': 'craft', 'target': '5', 'enabled': True})
    made = client.post('/api/admin/new-year/community/milestones', headers=admin, json={'threshold': 2, 'reward_kind': 'STAR', 'reward_amount': 'ring', 'supply': 5, 'price_balls': 0})
    assert made.status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as con:
        for _ in range(2):
            con.execute('INSERT INTO history VALUES(?,?,?,?,?)', (uuid.uuid4().hex, 50, 'craft', '{}', int(time.time())))
    claim = client.post('/api/community/claim', headers=player, json={'milestone_id': made.json['id'], 'request_id': 'cm-star-0001'})
    assert claim.status_code == 200 and claim.json['star_gift'] == 'ring'
    assert [g['star_key'] for g in mine(client, 43)] == ['ring']
    state = client.get('/api/community', headers=player).json['milestones'][0]
    assert state['redeemed'] and state['star']['stars'] == 100


def test_advent_day_gives_telegram_gifts(client, monkeypatch):
    from datetime import datetime, timedelta, timezone
    import advent
    admin, player = signed(), signed(43)
    client.get('/api/me', headers=player)
    client.post('/api/admin/new-year/advent/settings', headers=admin, json={'enabled': True, 'start': '2026-12-01', 'days': 24, 'tz': 3, 'hour': 10, 'require_sub': False})
    assert client.post('/api/admin/new-year/advent/days/1', headers=admin, json={'kind': 'STAR', 'amount': 'nope'}).status_code == 400
    assert client.post('/api/admin/new-year/advent/days/1', headers=admin, json={'kind': 'STAR', 'amount': 'cake', 'count': 2}).status_code == 200
    stamp = datetime(2026, 12, 1, 12, tzinfo=timezone(timedelta(hours=3))).timestamp()
    monkeypatch.setattr(advent, 'now', lambda: stamp)
    opened = client.post('/api/advent/open', headers=player, json={'day': 1})
    assert opened.status_code == 200 and opened.json['reward']['kind'] == 'STAR' and opened.json['reward']['count'] == 2
    assert opened.json['reward']['title'] == 'Cake ×2'
    assert [g['star_key'] for g in mine(client, 43)] == ['cake', 'cake']


def test_can_be_crafted(client, monkeypatch):
    import time
    from app import DEMO_GIFTS
    from test_app import craft_inputs  # noqa: F401
    import thermos
    monkeypatch.setattr(thermos, 'collections', lambda: [{'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '10', 'photo_url': '/static/assets/snoop.webp'}])
    monkeypatch.setattr(thermos, 'request', lambda *_: {'Snoop Dogg': {'models': [{'name': 'Emerald', 'image_url': '/static/assets/snoop.webp'}]}})
    monkeypatch.setattr('app.secrets.randbelow', lambda _: 0)
    monkeypatch.setattr('app.secrets.choice', lambda items: items[0])
    gift, = grant(client, 42, 'diamond')
    listing = {**DEMO_GIFTS[0], 'id': 'real-lot', 'number': 333, 'background': {'center_color': 10}, 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)', ('public:market:', json.dumps({'gifts': [listing]}), int(time.time())))
    quote = client.post('/api/craft/quote', headers=signed(), json={'gift_ids': [gift['id']], 'target_id': 'snoop'})
    assert quote.status_code == 200, quote.json
    assert quote.json['input_value'] == '1.00'


def test_player_sees_withdrawal_status_and_reason(client, monkeypatch):
    sent = []
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload, sticker=None: sent.append((method, payload)) or True)
    gift, = grant(client, 43, 'rose')
    relayer(client, monkeypatch, rs.Unresolvable('x'))
    client.post('/api/star-gifts/withdraw', headers=signed(43), json={'gift_id': gift['id']})
    item, = client.get('/api/gifts/withdrawals', headers=signed(43)).json['items']
    assert item['kind'] == 'star' and item['status'] == 'queued' and 'администратором' in item['text']
    enable(client)
    client.post('/api/admin/star-gifts/run', headers=signed(), json={})
    item, = client.get('/api/gifts/withdrawals', headers=signed(43)).json['items']
    assert item['status'] == 'failed' and '@username' in item['reason'] and 'возвращён' in item['text']
    assert any(m == 'sendMessage' and p['chat_id'] == 43 and 'Причина' in p['text'] for m, p in sent)


def test_can_be_sent_to_another_player(client):
    gift, = grant(client, 43, 'bouquet')
    client.get('/api/me', headers=signed(44, username='bob'))
    sent = client.post('/api/inventory/transfer', headers=signed(43), json={
        'gift_ids': [gift['id']], 'recipient_id': 44, 'username': 'bob', 'request_id': 'star-send-0001'})
    assert sent.status_code == 200, sent.json
    assert [g['star_key'] for g in mine(client, 44)] == ['bouquet'] and mine(client, 43) == []


def png_bytes():
    from io import BytesIO
    from PIL import Image
    out = BytesIO()
    Image.new('RGBA', (8, 8), (255, 0, 0, 255)).save(out, 'PNG')
    return out.getvalue()


def test_check_loads_ids_prices_and_png_from_telegram(client, monkeypatch):
    client.application.extensions['crafter_relayer_credentials'] = lambda: (1, 'hash', 'session', 777)

    async def sync(api_id, api_hash, session, wanted):
        return {'stars': 420, 'gifts': {key: {'tg_id': 5000 + i, 'stars': stars, 'png': png_bytes() if key == 'bear' else None}
                                        for i, (key, stars, emoji) in enumerate(wanted)}}
    monkeypatch.setattr(rs, 'sync', sync)
    info = client.post('/api/admin/star-gifts/check', headers=signed(), json={}).json
    assert info['state']['stars'] == 420 and info['state']['pngs'] == 1
    catalog = {g['key']: g for g in client.get('/api/star-gifts/catalog', headers=signed(43)).json['gifts']}
    assert catalog['bear']['image'].startswith('/media/stargift/bear.png') and catalog['bear']['telegram_gift_id'] == '5001'
    assert catalog['rose']['image'].endswith('/rose.svg') and catalog['rose']['telegram_gift_id']          # no PNG yet: built-in icon
    served = client.get('/media/stargift/bear.png')
    assert served.status_code == 200 and served.mimetype == 'image/png' and served.data[:4] == b'\x89PNG'
    assert client.get('/media/stargift/rose.png').status_code == 404
    gift, = grant(client, 43, 'bear')
    assert gift['telegram_gift_id'] == '5001' and gift['image'].startswith('/media/stargift/bear.png')


def test_withdrawal_sends_by_the_telegram_gift_id(client, monkeypatch):
    seen = {}

    async def sync(api_id, api_hash, session, wanted):
        return {'stars': 10, 'gifts': {key: {'tg_id': 777, 'stars': stars, 'png': None} for key, stars, emoji in wanted}}

    async def send(api_id, api_hash, session, to_id, to_username, stars, emoji, text, before_send, tg_id=None):
        seen['tg_id'] = tg_id
        before_send()
        return True
    client.application.extensions['crafter_relayer_credentials'] = lambda: (1, 'hash', 'session', 777)
    monkeypatch.setattr(rs, 'sync', sync)
    monkeypatch.setattr(rs, 'send', send)
    client.post('/api/admin/star-gifts/check', headers=signed(), json={})
    gift, = grant(client, 43, 'cake')
    client.post('/api/star-gifts/withdraw', headers=signed(43, username='user43'), json={'gift_id': gift['id']})
    enable(client)
    client.post('/api/admin/star-gifts/run', headers=signed(), json={})
    assert seen['tg_id'] == 777
