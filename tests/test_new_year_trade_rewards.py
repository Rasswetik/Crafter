"""New Year 10 balls/TON rewards only for settled live market trades."""
import json
import sqlite3

from test_app import client, signed


def _setup(client, gram_per_ton='2'):
    admin, buyer=signed(42), signed(43)
    for auth in (admin,buyer):
        assert client.get('/api/me',headers=auth).status_code==200
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO settings(key,payload) VALUES('tonconnect',?) "
                           "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                           (json.dumps({'gram_per_ton':gram_per_ton}),))
        connection.execute("UPDATE demo_accounts SET balance='100' WHERE user_id=43")
    assert client.post('/api/admin/new-year/settings',headers=admin,
                       json={'enabled':True}).status_code==200
    return admin,buyer


def _deposit(client,index):
    gift={'id':'season-trade-'+str(index),'name':'Lucky Locket',
          'collection_id':'luckylocket','number':1000+index,'model':'Main',
          'price_unit':'GRAM','origin':'telegram-deposit',
          'telegram_url':f'https://t.me/nft/luckylocket-{1000+index}'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO inventory VALUES (42, ?, ?, 'unlisted')",
                           (gift['id'],json.dumps(gift)))
    return gift


def _trade(client, gift, price, suffix):
    admin,buyer=signed(42),signed(43)
    posted=client.post('/api/resale/listings',headers=admin,json={
        'action':'sell','items':[{'id':gift['id'],'price':price}]})
    assert posted.status_code==200,posted.json
    offer=next(item for item in client.get('/api/market?source=crafter',
                                          headers=buyer).json['gifts']
               if item['number']==gift['number'])
    order={'id':offer['id'],'expected_price':price,'request_id':'season-buy-'+suffix}
    bought=client.post('/api/resale/buy',headers=buyer,json=order)
    assert bought.status_code==200,bought.json
    return order,bought.json


def test_winter_trade_rewards_exact_ton_conversion_both_parties_and_no_double_credit(client,monkeypatch):
    # Notifications are not part of reward settlement.
    monkeypatch.setattr('telegram_bot.bot_api',lambda *args,**kwargs:None)
    admin,buyer=_setup(client,'2')   # 2 GRAM = 1 TON
    item=_deposit(client,1)
    # Merely listing the item does not grant any balls.
    posted=client.post('/api/resale/listings',headers=admin,json={
        'action':'sell','items':[{'id':item['id'],'price':'5.00'}]})
    assert posted.status_code==200
    assert client.get('/api/balance',headers=admin).json['new_year']['balls']==0
    offer=client.get('/api/market?source=crafter',headers=buyer).json['gifts'][0]
    payload={'id':offer['id'],'expected_price':'5.00','request_id':'unique-ball-trade'}
    purchased=client.post('/api/resale/buy',headers=buyer,json=payload)
    assert purchased.status_code==200,purchased.json
    assert client.get('/api/balance',headers=admin).json['new_year']['balls']==25
    assert client.get('/api/balance',headers=buyer).json['new_year']['balls']==25
    retry=client.post('/api/resale/buy',headers=buyer,json=payload)
    assert retry.status_code==200 and retry.json==purchased.json
    assert client.get('/api/balance',headers=buyer).json['new_year']['balls']==25
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        entries=connection.execute("SELECT user_id,balls_delta FROM new_year_trade_rewards ORDER BY user_id").fetchall()
        assert entries==[(42,25),(43,25)]
    me=client.get('/api/me',headers=buyer).json
    assert me['new_year_reward_per_ton']==10
    assert me['new_year_gram_per_ton']=='2'


def test_winter_remainder_carries_over_small_sales(client,monkeypatch):
    monkeypatch.setattr('telegram_bot.bot_api',lambda *args,**kwargs:None)
    admin,buyer=_setup(client,'2')
    for n in range(2):
        gift=_deposit(client,n+1)
        _trade(client,gift,'0.10',str(n))
    # Each 0.10 GRAM transaction earns 0.5 balls; both trades equal 1.
    assert client.get('/api/balance',headers=admin).json['new_year']['balls']==1
    assert client.get('/api/balance',headers=buyer).json['new_year']['balls']==1
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        fraction=connection.execute("SELECT fraction FROM new_year_trade_remainders WHERE user_id=42").fetchone()[0]
        assert fraction in ('0.00','0.0','0')


def test_preview_only_and_disabled_event_never_credit_balls(client):
    user=signed(42)
    assert client.get('/api/me',headers=user).status_code==200
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==0
    mock=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':['missing'],'request_id':'test-buy-operation'})
    assert mock.status_code in (400,409)
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==0


def test_reward_ui_and_english_seasonal_copy_are_wired():
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    html=(root/'templates/index.html').read_text(encoding='utf-8')
    detail=(root/'static/catalog-ui.js').read_text(encoding='utf-8')
    resale=(root/'static/resale.js').read_text(encoding='utf-8')
    rewards=(root/'static/new-year-rewards.js').read_text(encoding='utf-8')
    locales=(root/'static/preferences.js').read_text(encoding='utf-8')
    new_year=(root/'static/new-year.js').read_text(encoding='utf-8')
    assert 'new-year-rewards.js' in html
    assert 'new-year-rewards.css' in html
    assert 'crafterSeasonRewardForFloor' in detail
    assert "crafterSeasonRewardHTML?.('purchase'" in detail
    assert 'crafterSeasonRewardUpdate' in resale
    assert 'После завершённой сделки' in rewards
    assert "['Новый год','New Year']" in locales or '["Новый год","New Year"]' in locales
    assert 'Администрация пока не разместила новогодние лоты.' not in new_year
    assert 'Совсем скоро здесь появятся новогодние подарки.' in new_year
