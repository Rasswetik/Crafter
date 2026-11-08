"""Preview-mode craft and seasonal ball accrual without real TON or NFT custody."""
import json
import sqlite3
import time

from test_app import client, signed


def _season_setup(client, monkeypatch):
    import thermos
    collections=[
        {'id':'lunar','name':'Lunar Snake','floor_price':'1.25',
         'photo_url':'https://example.org/lunar.webp','price_unit':'TON'},
        {'id':'astral','name':'Astral Shard','floor_price':'2.50',
         'photo_url':'https://example.org/astral.webp','price_unit':'TON'},
    ]
    monkeypatch.setattr(thermos,'collections',lambda:collections)
    admin=signed(42)
    assert client.get('/api/me',headers=admin).status_code==200
    assert client.post('/api/admin/new-year/settings',headers=admin,json={'enabled':True}).status_code==200
    source={'id':'preview-nft-100','name':'Lunar Snake','collection_id':'lunar',
            'number':12345,'model':'Main','symbol':'Sparkle','backdrop':'Night',
            'price':'1.25','price_unit':'TON',
            'image':'https://example.org/lunar.webp'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO cache(key,payload,updated) VALUES(?,?,?)",
                           ('public:market:preview-craft',json.dumps({'gifts':[source]}),int(time.time())))
    return source


def test_preview_purchase_awards_ton_balls_without_charging_gram(client,monkeypatch):
    source=_season_setup(client,monkeypatch)
    user=signed(43)
    assert client.get('/api/me',headers=user).status_code==200
    first=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':[source['id']],'request_id':'test-craft-purchase-1'})
    assert first.status_code==200,first.json
    gift=first.json['gifts'][0]
    assert gift['test_only'] and gift['catalog_only']
    assert gift['origin']=='market-test' and gift['source_price_unit']=='TON'
    assert first.json['balance']=='0'
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==12
    again=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':[source['id']],'request_id':'test-craft-purchase-1'})
    assert again.json==first.json
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==12


def test_preview_craft_works_without_real_market_listing_and_awards_balls(client,monkeypatch):
    source=_season_setup(client,monkeypatch)
    user=signed(43)
    client.get('/api/me',headers=user)
    bought=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':[source['id']],'request_id':'preview-craft-purchase-2'})
    assert bought.status_code==200,bought.json
    gift=bought.json['gifts'][0]
    quote=client.post('/api/craft/quote',headers=user,json={
        'gift_ids':[gift['id']],'target_id':'astral'})
    assert quote.status_code==200,quote.json
    assert quote.json['mode']=='preview' and quote.json['price_unit']=='TON'
    assert quote.json['input_value']=='1.25'
    assert quote.json['chance']>0
    monkeypatch.setattr('app.secrets.randbelow',lambda n:0)
    payload={'quote_id':quote.json['quote_id'],'request_id':quote.json['quote_id']}
    result=client.post('/api/craft',headers=user,json=payload)
    assert result.status_code==200,result.json
    assert result.json['success'] and result.json['test_mode']
    assert result.json['balls_earned']==13  # includes 0.5 carried from the purchase
    reward=result.json['gift']
    assert reward['test_only'] and reward['catalog_only'] and reward['origin']=='demo-craft'
    assert reward['name']=='Astral Shard'
    assert reward['image']=='https://example.org/astral.webp'
    inventory=client.get('/api/inventory',headers=user).json['gifts']
    assert [x['id'] for x in inventory]==[reward['id']]
    assert client.get('/api/balance',headers=user).json['balance']=='0'
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==25
    assert client.post('/api/craft',headers=user,json=payload).json==result.json
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==25
    # Preview gifts cannot go into the real-player trade queue.
    assert client.post('/api/resale/listings',headers=user,json={
        'action':'sell','items':[{'id':reward['id'],'price':'5'}]}).status_code==409


def test_preview_sale_credits_only_balls_and_cannot_touch_real_nft(client,monkeypatch):
    source=_season_setup(client,monkeypatch)
    user=signed(43)
    client.get('/api/me',headers=user)
    purchased=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':[source['id']],'request_id':'preview-sale-purchase'})
    gift=purchased.json['gifts'][0]
    request={'gift_id':gift['id'],'price':'2.50','request_id':'preview-sale-confirm'}
    paid=client.post('/api/market/test/sell',headers=user,json=request)
    assert paid.status_code==200,paid.json
    assert paid.json['test_mode'] and paid.json['price_unit']=='TON'
    assert not client.get('/api/inventory',headers=user).json['gifts']
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==37
    assert client.get('/api/balance',headers=user).json['balance']=='0'
    assert client.post('/api/market/test/sell',headers=user,json=request).json==paid.json
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==37
    # Authenticated player-owned, real gift is forbidden in the preview flow.
    real={'id':'genuine-deposit','name':'Lunar Snake','price':'2','origin':'telegram-deposit',
          'telegram_url':'https://t.me/nft/LunarSnake-1234'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO inventory VALUES(?,?,?,'unlisted')",
                           (43,real['id'],json.dumps(real)))
    bad=client.post('/api/market/test/sell',headers=user,json={
        'gift_id':real['id'],'price':'2','request_id':'preview-real-reject'})
    assert bad.status_code==409
    assert client.get('/api/balance',headers=user).json['new_year']['balls']==37


def test_mixed_real_and_preview_craft_rejected(client,monkeypatch):
    source=_season_setup(client,monkeypatch)
    user=signed(43)
    client.get('/api/me',headers=user)
    result=client.post('/api/market/test/buy',headers=user,json={
        'gift_ids':[source['id']],'request_id':'preview-mixed-1'})
    test_id=result.json['gifts'][0]['id']
    real={'id':'real-grant','name':'Lunar Snake','price':'2','origin':'admin-grant',
          'price_unit':'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute("INSERT INTO inventory VALUES(?,?,?,'unlisted')",
                           (43,real['id'],json.dumps(real)))
    quote=client.post('/api/craft/quote',headers=user,json={
        'gift_ids':[test_id,real['id']],'target_id':'astral'})
    assert quote.status_code==409
    assert 'смешивать' in quote.json['error']


def test_preview_craft_and_reward_interface_hooks():
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    index=(root/'templates/index.html').read_text(encoding='utf-8')
    catalog=(root/'static/catalog-ui.js').read_text(encoding='utf-8')
    forge=(root/'static/forge.js').read_text(encoding='utf-8')
    rewards=(root/'static/new-year-rewards.js').read_text(encoding='utf-8')
    assert 'new-year-rewards.js' in index
    assert "market/test/sell" in rewards
    assert "openPreviewGiftSale" in catalog
    assert "craftEnglish" in catalog
    assert "crafterSeasonBalanceRefresh" in forge
    assert 'class="forge-season-earned"' in forge
    assert 'Automatically earned' in forge
    assert 'Автоматически начислено' in forge
    assert 'result.balls_earned' in forge
    assert "crafterSeasonRewardHTML?.('craft'" not in catalog
    assert "document.querySelector('.craft-page .crafter-season-reward')" not in catalog
