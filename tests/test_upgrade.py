import json
import sqlite3
from decimal import Decimal

import pytest

from app import DEMO_GIFTS
from test_app import client, signed
from test_resale import change_listing, prepare_sale
from test_resale import telegram_messages  # noqa: F401  (autouse notification stubs)
import upgrade


def test_chance_formula_and_roll():
    assert upgrade.chance_bps(Decimal('3'), Decimal('10')) == 2850
    assert upgrade.chance_bps(Decimal('0'), Decimal('10')) == 0
    assert upgrade.roll_wins(0, 2850) and upgrade.roll_wins(2849, 2850)
    assert not upgrade.roll_wins(2850, 2850) and not upgrade.roll_wins(0, 0)


@pytest.fixture
def setup(client, monkeypatch):
    import portals_public
    import thermos
    monkeypatch.setattr(thermos, 'collections', lambda: [
        {'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '10', 'photo_url': '/static/assets/snoop.webp'}])
    monkeypatch.setattr(thermos, 'request', lambda *_: {'Snoop Dogg': {'models': [{'name': 'Emerald', 'image_url': '/static/assets/snoop.webp'}]}})

    def offline(*_a, **_k):
        raise OSError('offline')
    monkeypatch.setattr(portals_public, 'listings', offline)
    monkeypatch.setattr(thermos, 'gifts', offline)
    prepare_sale(client)
    assert change_listing(client, 'sell', '10').status_code == 200      # user 42 lists a 10 GRAM lot
    stake = {**DEMO_GIFTS[1], 'id': 'stake-1', 'origin': 'local-purchase', 'price': '3.00', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (stake['id'], json.dumps(stake)))
    return stake


def targets(client):
    return client.get('/api/upgrade/targets?stake_id=stake-1&collection_id=snoop', headers=signed(43))


def test_targets_and_quote_show_chance(client, setup):
    found = targets(client)
    assert found.status_code == 200
    gift, = found.json['gifts']
    assert gift['source'] == 'crafter' and gift['price'] == '10.00' and gift['chance'] == 28.5
    quote = client.post('/api/upgrade/quote', headers=signed(43), json={
        'stake_id': 'stake-1', 'collection_id': 'snoop', 'listing_id': gift['id']})
    assert quote.status_code == 200 and quote.json['chance'] == 28.5


def test_win_moves_lot_to_user_and_burns_stake(client, setup, monkeypatch):
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 0)
    gift, = targets(client).json['gifts']
    quote = client.post('/api/upgrade/quote', headers=signed(43), json={
        'stake_id': 'stake-1', 'collection_id': 'snoop', 'listing_id': gift['id']}).json
    body = {'quote_id': quote['quote_id'], 'request_id': 'r-1'}
    result = client.post('/api/upgrade', headers=signed(43), json=body)
    assert result.status_code == 200 and result.json['success'] is True
    assert client.post('/api/upgrade', headers=signed(43), json=body).json == result.json   # idempotent
    ids = [g['id'] for g in client.get('/api/inventory', headers=signed(43)).json['gifts']]
    assert 'stake-1' not in ids and 'trade-gift' in ids


def test_loss_burns_stake_without_reward(client, setup, monkeypatch):
    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 9999)
    gift, = targets(client).json['gifts']
    quote = client.post('/api/upgrade/quote', headers=signed(43), json={
        'stake_id': 'stake-1', 'collection_id': 'snoop', 'listing_id': gift['id']}).json
    result = client.post('/api/upgrade', headers=signed(43), json={'quote_id': quote['quote_id'], 'request_id': 'r-2'})
    assert result.json['success'] is False and result.json['gift'] is None
    assert [g['id'] for g in client.get('/api/inventory', headers=signed(43)).json['gifts']] == []


def test_rejects_other_users_gifts_and_cheap_targets(client, setup):
    assert client.get('/api/upgrade/targets?stake_id=stake-1&collection_id=snoop', headers=signed(44)).status_code == 409
    cheap = {**DEMO_GIFTS[1], 'id': 'big-stake', 'origin': 'local-purchase', 'price': '50.00', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (cheap['id'], json.dumps(cheap)))
    found = client.get('/api/upgrade/targets?stake_id=big-stake&collection_id=snoop', headers=signed(43))
    assert found.json['gifts'] == []      # a 10 GRAM lot is not an upgrade for a 50 GRAM stake


def test_crafter_market_lots_come_first(client, setup, monkeypatch):
    # a cheaper Portals lot must still be listed after the Crafter player lot
    portals_lot = {'id': 'p-1', 'name': 'Snoop Dogg', 'collection_id': 'snoop', 'number': 5, 'model': 'Emerald',
                   'image': 'x', 'price': '8', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        import time
        db.execute("INSERT INTO cache VALUES (?,?,?)", ('public:market:t', json.dumps({'gifts': [portals_lot]}), int(time.time())))
    gifts = targets(client).json['gifts']
    assert [g['source'] for g in gifts] == ['crafter', 'portals']


def test_collections_list_puts_crafter_market_first(client, setup):
    r = client.get('/api/upgrade/collections?stake_id=stake-1', headers=signed(43))
    assert r.status_code == 200
    first = r.json['collections'][0]
    assert first['name'] == 'Snoop Dogg' and first['crafter'] == 1


def test_deposited_relayer_gift_is_valued_at_collection_floor(client, setup):
    gift = {**DEMO_GIFTS[1], 'id': 'telegram-dep-1', 'origin': 'telegram-deposit', 'price': '0', 'price_unit': 'GRAM',
            'name': 'Snoop Dogg'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (43, ?, ?, 'unlisted')", (gift['id'], json.dumps(gift)))
    stakes = {g['id']: g for g in client.get('/api/upgrade/stakes', headers=signed(43)).json['gifts']}
    assert 'telegram-dep-1' in stakes and Decimal(stakes['telegram-dep-1']['upgrade_value']) > 0


def test_collections_carry_a_floor_price_in_gram_for_the_price_filter(client, setup):
    r = client.get('/api/upgrade/collections?stake_id=stake-1', headers=signed(43))
    snoop = next(c for c in r.json['collections'] if c['name'] == 'Snoop Dogg')
    assert Decimal(snoop['floor']) > 0


def set_balance(client, uid, amount):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(amount)))


def money_of(client, uid):
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        return Decimal(db.execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()[0])


def test_gram_stake_wins_and_loses_from_balance(client, setup, monkeypatch):
    # work mode: a GRAM stake plays for real lots; the listed gift must sit on the relayer
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO settings VALUES ('purchase_mode_v1', ?)", (json.dumps({'mode': 'work'}),))
        for nft_id, payload in db.execute("SELECT nft_id,payload FROM inventory WHERE user_id=42").fetchall():
            gift = json.loads(payload)
            gift['origin'] = 'telegram-deposit'
            db.execute("UPDATE inventory SET payload=? WHERE user_id=42 AND nft_id=?", (json.dumps(gift), nft_id))
    set_balance(client, 43, '20')
    stakes = client.get('/api/upgrade/stakes', headers=signed(43)).json
    assert stakes['balance'] == '20' and stakes['gram_min'] == '0.1'
    get_targets = lambda sid: client.get('/api/upgrade/targets?stake_id=%s&collection_id=snoop' % sid, headers=signed(43))
    assert get_targets('gram:0.05').status_code == 400                 # below the minimum
    assert get_targets('gram:500').status_code == 409                 # more than the balance
    gift, = get_targets('gram:3').json['gifts']
    assert gift['chance'] == 28.5                                     # same formula as a 3 GRAM gift
    quote = lambda: client.post('/api/upgrade/quote', headers=signed(43), json={'stake_id': 'gram:3', 'collection_id': 'snoop', 'listing_id': gift['id']}).json

    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 9999)
    lost = client.post('/api/upgrade', headers=signed(43), json={'quote_id': quote()['quote_id'], 'request_id': 'g-1'})
    assert lost.json['success'] is False and money_of(client, 43) == Decimal('17')
    assert 'stake-1' in [g['id'] for g in client.get('/api/inventory', headers=signed(43)).json['gifts']]      # the gift stake is untouched

    monkeypatch.setattr('upgrade.secrets.randbelow', lambda _: 0)
    q = quote()
    won = client.post('/api/upgrade', headers=signed(43), json={'quote_id': q['quote_id'], 'request_id': 'g-2'})
    assert won.json['success'] is True and money_of(client, 43) == Decimal('14') and won.json['gift']
    assert client.post('/api/upgrade', headers=signed(43), json={'quote_id': q['quote_id'], 'request_id': 'g-2'}).json == won.json
    assert money_of(client, 43) == Decimal('14')                       # repeat does not charge again


def test_collections_without_any_possible_lot_in_the_price_range_are_hidden(client, setup, monkeypatch):
    import thermos
    monkeypatch.setattr(thermos, 'collections', lambda: [
        {'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '10', 'photo_url': '/static/assets/snoop.webp'},
        {'id': 'pricey', 'name': 'Pricey Gift', 'floor_price': '5000', 'photo_url': '/static/assets/snoop.webp'},
        {'id': 'cheap', 'name': 'Cheap Gift', 'floor_price': '1', 'photo_url': '/static/assets/snoop.webp'}])
    names = [c['name'] for c in client.get('/api/upgrade/collections?stake_id=stake-1', headers=signed(43)).json['collections']]
    assert 'Pricey Gift' not in names and 'Snoop Dogg' in names and 'Cheap Gift' in names
