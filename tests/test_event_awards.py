"""Regression checks for real catalog NFT awards: no duplicate purchases."""
import json
import sqlite3
import time

from app import DEMO_GIFTS
from test_app import client, signed


def test_event_award_buys_cheapest_listed_nft_once(client, monkeypatch):
    monkeypatch.setattr('telegram_bot.bot_api', lambda *args, **kwargs: {})
    for user_id in (42, 43, 44, 45):
        assert client.get('/api/me', headers=signed(user_id)).status_code == 200
    now = int(time.time())
    event_id = 'a' * 32
    gift = {**DEMO_GIFTS[0], 'id': 'award-gift', 'origin': 'local-purchase',
            'price_unit': 'GRAM'}
    other = {**gift, 'id': 'expensive-gift', 'number': 999}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO crafter_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (event_id, 'Tournament', '', 'craft_wins', now-200, now-10, 1,
                    '#9164e9', 1, 10,
                    json.dumps([{'type': 'collection', 'collection':gift['name'], 'label':'NFT'}]),
                    'none', b''))
        db.execute("INSERT INTO history VALUES (?,?,?,?,?)",
                   ('history-event-winner',43,'craft',json.dumps({'success':True}),now-40))
        db.execute("INSERT INTO inventory VALUES (44, ?, ?, 'unlisted')",
                   (gift['id'],json.dumps(gift)))
        db.execute("INSERT INTO inventory VALUES (45, ?, ?, 'unlisted')",
                   (other['id'],json.dumps(other)))
        db.execute("UPDATE demo_accounts SET balance='40.00' WHERE user_id=42")
    def sell(uid,gift_id,price):
        response = client.post('/api/resale/listings',headers=signed(uid),
            json={'action':'sell','items':[{'id':gift_id,'price':price}]})
        assert response.status_code == 200, response.json
    sell(44,gift['id'],'5.00')
    sell(45,other['id'],'8.00')
    path='/api/admin/events/'+event_id+'/award/1'
    assert client.get(path,headers=signed(43)).status_code==403
    quote=client.get(path,headers=signed(42))
    assert quote.status_code==200,quote.json
    assert quote.json['price_gram']=='5.00'
    assert quote.json['winner']['id']=='43'
    assert quote.json['source']=='crafter'
    assert client.post(path,headers=signed(42),json={}).status_code==400
    attempt={'confirm':True,'lot_id':quote.json['lot_id'],
             'expected_price_gram':'4.99'}
    assert client.post(path,headers=signed(42),json=attempt).status_code==409
    attempt['expected_price_gram']='5.00'
    awarded=client.post(path,headers=signed(42),json=attempt)
    assert awarded.status_code==200,awarded.json
    assert awarded.json['winner_id']==43
    second=client.post(path,headers=signed(42),json=attempt)
    assert second.status_code==200
    assert second.json['status']=='already_delivered'
    gifts=client.get('/api/inventory',headers=signed(43)).json['gifts']
    assert len(gifts)==1 and gifts[0]['id']==gift['id']
    assert client.get('/api/me',headers=signed(42)).json['balance']=='35.00'
    assert client.get('/api/me',headers=signed(44)).json['balance']=='4.80'
    assert len(client.get('/api/market?source=crafter',headers=signed(42)).json['gifts'])==1
