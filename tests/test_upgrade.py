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
