import json
import sqlite3
import time

import pytest

from app import create_app, DEMO_GIFTS
from tests.test_app import signed


@pytest.fixture
def world(tmp_path):
    app = create_app({'TESTING': True, 'DATABASE': str(tmp_path / 'auction.db'), 'BOT_TOKEN': 'test-token',
                      'ADMIN_IDS': {42}, 'DEMO_MODE': False})
    client = app.test_client()
    for uid in (42, 43, 44):
        client.get('/api/me', headers=signed(uid))
    path = app.config['DATABASE']
    gift = {**DEMO_GIFTS[0], 'id': 'gift-a', 'number': 7, 'origin': 'admin-grant'}
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO inventory VALUES (42,'gift-a',?,'unlisted')", (json.dumps(gift),))
        for uid in (42, 43, 44):
            db.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', ('100', uid))

    def sql(query, *args):
        with sqlite3.connect(path) as db:
            return db.execute(query, args).fetchall()

    return client, sql


def make(client, price='10', minutes=60, rid='a1', gift='gift-a'):
    return client.post('/api/auctions', headers=signed(42),
                       json={'gift_id': gift, 'start_price': price, 'minutes': minutes, 'request_id': rid})


def bid(client, uid, auction, amount, rid):
    return client.post('/api/auctions/%s/bid' % auction, headers=signed(uid),
                       json={'amount': amount, 'request_id': rid})


def balance(sql, uid):
    return sql('SELECT balance FROM demo_accounts WHERE user_id=?', uid)[0][0]


def test_create_locks_the_gift_and_is_idempotent(world):
    client, sql = world
    answer = make(client)
    assert answer.status_code == 200, answer.get_data(as_text=True)
    auction = answer.json['auction']
    assert auction['min_bid'] == '10.00' and auction['own'] and auction['can_cancel']
    assert sql("SELECT status FROM inventory WHERE nft_id='gift-a'")[0][0] == 'auction'
    assert make(client).json['auction']['id'] == auction['id']
    assert len(sql('SELECT * FROM crafter_auctions')) == 1
    # a gift in escrow cannot be put up twice nor sold on the market
    assert make(client, rid='a2').status_code == 409
    sale = client.post('/api/resale/listings', headers=signed(42),
                       json={'action': 'sell', 'items': [{'id': 'gift-a', 'price': '5'}]})
    assert sale.status_code == 409


def test_bidding_rules_and_instant_refund_of_the_outbid_player(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    assert bid(client, 42, auction, '10', 'x1').status_code == 409          # own auction
    assert bid(client, 43, auction, '9', 'x2').status_code == 409           # under the start price
    assert bid(client, 43, auction, '10', 'x3').status_code == 200
    assert balance(sql, 43) == '90.00' or float(balance(sql, 43)) == 90.0
    assert bid(client, 43, auction, '20', 'x4').status_code == 409          # already leading
    assert bid(client, 44, auction, '10.40', 'x5').status_code == 409       # below +5 %
    answer = bid(client, 44, auction, '10.50', 'x6')
    assert answer.status_code == 200 and answer.json['auction']['leading'] is True
    assert float(balance(sql, 43)) == 100.0                                 # refunded the moment they were outbid
    assert float(balance(sql, 44)) == 89.5
    assert bid(client, 44, auction, '10.50', 'x6').json['auction']['bid_count'] == 2     # same request: no second debit
    assert float(balance(sql, 44)) == 89.5
    detail = client.get('/api/auctions/' + auction, headers=signed(43)).json['auction']
    assert [b['amount'] for b in detail['bids']] == ['10.50', '10.00']
    assert detail['can_cancel'] is False


def test_not_enough_balance(world):
    client, sql = world
    auction = make(client, price='500').json['auction']['id']
    assert bid(client, 43, auction, '500', 'poor').status_code == 409
    assert float(balance(sql, 43)) == 100.0


def test_winner_gets_the_gift_and_seller_is_paid_minus_fee(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    assert bid(client, 43, auction, '25', 'w1').status_code == 200
    sql('UPDATE crafter_auctions SET ends_at=? WHERE id=?', int(time.time()) - 1, auction)
    listing = client.get('/api/auctions', headers=signed(44)).json
    assert listing['auctions'] == []
    assert sql("SELECT user_id,status FROM inventory WHERE nft_id='gift-a'") == [(43, 'unlisted')]
    assert sql('SELECT status FROM crafter_auctions')[0][0] == 'sold'
    assert float(balance(sql, 43)) == 75.0
    assert float(balance(sql, 42)) == 124.0                                  # 25 - 4 %
    kinds = {row[0] for row in sql('SELECT kind FROM history')}
    assert {'sale', 'buy', 'auction_created', 'auction_bid'} <= kinds
    assert bid(client, 44, auction, '30', 'late').status_code == 409


def test_unsold_gift_returns_to_the_seller(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    sql('UPDATE crafter_auctions SET ends_at=? WHERE id=?', int(time.time()) - 1, auction)
    client.get('/api/auctions', headers=signed(43))
    assert sql("SELECT user_id,status FROM inventory WHERE nft_id='gift-a'") == [(42, 'unlisted')]
    assert sql('SELECT status FROM crafter_auctions')[0][0] == 'unsold'
    assert float(balance(sql, 42)) == 100.0


def test_cancel_only_without_bids(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    assert client.post('/api/auctions/%s/cancel' % auction, headers=signed(43)).status_code == 403
    bid(client, 43, auction, '10', 'c1')
    assert client.post('/api/auctions/%s/cancel' % auction, headers=signed(42)).status_code == 409
    other = make(client, rid='a9', gift='gift-b')
    assert other.status_code == 409                                         # unknown gift
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (42,'gift-b',?,'unlisted')", (json.dumps(DEMO_GIFTS[1]),))
    second = make(client, rid='a10', gift='gift-b').json['auction']['id']
    assert client.post('/api/auctions/%s/cancel' % second, headers=signed(42)).status_code == 200
    assert sql("SELECT status FROM inventory WHERE nft_id='gift-b'")[0][0] == 'unlisted'


def test_late_bid_extends_the_end(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    soon = int(time.time()) + 30
    sql('UPDATE crafter_auctions SET ends_at=? WHERE id=?', soon, auction)
    answer = bid(client, 43, auction, '10', 'e1')
    assert answer.json['auction']['ends_at'] == soon + 120


def test_winner_who_already_owns_the_gift_is_refunded(world):
    client, sql = world
    auction = make(client).json['auction']['id']
    bid(client, 43, auction, '12', 'o1')
    with sqlite3.connect(client.application.config['DATABASE']) as db:       # the same gift id appeared at the winner
        db.execute("INSERT INTO inventory VALUES (43,'gift-a',?,'unlisted')", (json.dumps(DEMO_GIFTS[0]),))
        db.execute('UPDATE crafter_auctions SET ends_at=? WHERE id=?', (int(time.time()) - 1, auction))
    client.get('/api/auctions', headers=signed(44))
    assert float(balance(sql, 43)) == 100.0
    assert sql('SELECT status FROM crafter_auctions')[0][0] == 'unsold'
    assert sql("SELECT status FROM inventory WHERE user_id=42 AND nft_id='gift-a'")[0][0] == 'unlisted'


def test_limit_of_active_auctions(world):
    client, sql = world
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for i in range(12):
            db.execute("INSERT INTO inventory VALUES (42,?,?,'unlisted')", ('extra-%d' % i, json.dumps(DEMO_GIFTS[0])))
    codes = [make(client, rid='r%d' % i, gift='extra-%d' % i).status_code for i in range(12)]
    assert codes[:10] == [200] * 10 and codes[10:] == [409, 409]


def test_duration_limits_and_favorites_and_filters(world):
    client, sql = world
    assert make(client, minutes=29).status_code == 400
    assert make(client, minutes=30 * 24 * 60 + 1).status_code == 400
    ok = make(client, minutes=30 * 24 * 60)
    assert ok.status_code == 200
    auction = ok.json['auction']['id']
    assert client.post('/api/auctions/%s/favorite' % auction, headers=signed(43)).json == {'favorite': True}
    assert client.get('/api/auctions?view=favorites', headers=signed(43)).json['auctions'][0]['favorite'] is True
    assert client.get('/api/auctions?view=favorites', headers=signed(44)).json['auctions'] == []
    assert client.get('/api/auctions?search=nothing-like-this', headers=signed(43)).json['auctions'] == []
    assert client.get('/api/auctions?min_price=11', headers=signed(43)).json['auctions'] == []
    assert len(client.get('/api/auctions?number=7&max_price=10', headers=signed(43)).json['auctions']) == 1
    assert client.post('/api/auctions/%s/favorite' % auction, headers=signed(43)).json == {'favorite': False}


def test_notices_for_outbid_leader_and_seller(world):
    client, sql = world
    seen = []
    import auctions
    app = client.application
    # re-install on a fresh app that records the notices
    from app import create_app
    app2 = create_app({'TESTING': True, 'DATABASE': app.config['DATABASE'], 'BOT_TOKEN': 'test-token',
                       'ADMIN_IDS': {42}, 'DEMO_MODE': False})
    import telegram_bot
    monkey = []
    original = telegram_bot.send_message
    telegram_bot.send_message = lambda token, message: monkey.append(message)
    try:
        c = app2.test_client()
        auction = c.post('/api/auctions', headers=signed(42), json={'gift_id': 'gift-a', 'start_price': '10',
                                                                     'minutes': 60, 'request_id': 'n1'}).json['auction']['id']
        c.post('/api/auctions/%s/bid' % auction, headers=signed(43), json={'amount': '10', 'request_id': 'n2'})
        c.post('/api/auctions/%s/bid' % auction, headers=signed(44), json={'amount': '11', 'request_id': 'n3'})
    finally:
        telegram_bot.send_message = original
    targets = [(m['chat_id'], 'перебили' in m['text'] or 'ставку' in m['text']) for m in monkey]
    assert (43, True) in targets and (42, True) in targets
    assert any(m['chat_id'] == 43 and 'перебили' in m['text'] for m in monkey)


def test_sql_stays_portable_to_postgres():
    """Production runs on PostgreSQL: SQLite-only columns such as rowid must not appear in the queries."""
    import pathlib
    source = (pathlib.Path(__file__).resolve().parent.parent / 'auctions.py').read_text(encoding='utf-8')
    assert 'rowid' not in source.lower()
    assert 'INSERT OR' not in source.upper()
