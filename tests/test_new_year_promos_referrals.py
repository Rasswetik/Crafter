"""Integration checks for the November 2026 Crafter seasonal release."""
import json
import sqlite3
import time

from test_app import client, signed
import new_year


def test_new_year_permissions_lots_balances_and_idempotent_checkout(client,monkeypatch):
    monkeypatch.setattr(new_year,'telegram_nft_metadata',lambda slug: {
        'model':'Iron Rose','symbol':'Coonskin Cap','backdrop':'Persimmon',
        'image':'https://nft.fragment.com/verified/photo.webp',
        'rarity':{'model':30},'telegram_verified_at':int(time.time()),
        'metadata_source':'telegram'
    })
    monkeypatch.setattr(new_year,'portals_collection_floor',lambda slug:'4.28')
    admin=signed(42)
    player=signed(43)
    assert client.get('/api/me',headers=admin).status_code==200
    assert client.get('/api/me',headers=player).status_code==200
    assert client.get('/api/new-year',headers=player).status_code==404
    assert client.get('/api/admin/new-year',headers=player).status_code==403
    assert client.get('/api/admin/new-year',headers=admin).json['enabled'] is False

    created=client.post('/api/admin/new-year/lots',headers=admin,json={
        'url':'https://t.me/nft/ChillFlame-426793','price':'250','model':'Iron Rose',
        'symbol':'Coonskin Cap','backdrop':'Persimmon','floor_price':'4.28'})
    assert created.status_code==200,created.json
    lot_id=created.json['id']
    repeat=client.post('/api/admin/new-year/lots',headers=admin,json={
        'url':'https://t.me/nft/ChillFlame-426793','price':'250'})
    assert repeat.status_code==409
    assert client.post('/api/admin/new-year/lots',headers=player,json={
        'url':'https://t.me/nft/AnotherGift-7','price':'5'}).status_code==403

    credited=client.post('/api/admin/new-year/wallet',headers=admin,json={
        'user_id':43,'balls':'300','donate':'7','tinsel':'15'})
    assert credited.status_code==200,credited.json
    assert credited.json['balance']=={'balls':300,'donate':7,'tinsel':15}
    assert client.post('/api/admin/new-year/settings',headers=admin,json={'enabled':True}).status_code==200
    offer=client.get('/api/new-year',headers=player).json
    assert offer['enabled']
    assert offer['lots'][0]['gift']['model']=='Iron Rose'
    assert offer['lots'][0]['gift']['number']==426793
    assert offer['lots'][0]['price']==250
    assert offer['lots'][0]['gift']['image']=='https://nft.fragment.com/verified/photo.webp'
    preview=client.get('/api/new-year/lots/'+lot_id+'/details',headers=player)
    assert preview.status_code==200
    assert preview.json['lot']['gift']['floor_unit']=='GRAM'
    season_wallet=client.get('/api/admin/new-year/users/43/wallet',headers=admin)
    assert season_wallet.status_code==200
    assert season_wallet.json['balance']['balls']==300
    assert client.get('/api/admin/new-year/users/43/wallet',headers=player).status_code==403


    order={'lot_id':lot_id,'request_id':'new-year-first-order'}
    first=client.post('/api/new-year/buy',headers=player,json=order)
    assert first.status_code==200,first.json
    assert first.json['balance']=={'balls':50,'donate':7,'tinsel':15}
    reward=first.json['gift']
    assert reward['test_only'] and reward['catalog_only']
    assert reward['origin']=='new-year-test'
    assert reward['telegram_url']=='https://t.me/nft/ChillFlame-426793'
    retry=client.post('/api/new-year/buy',headers=player,json=order)
    assert retry.status_code==200 and retry.json==first.json
    assert client.post('/api/new-year/buy',headers=player,json={
        'lot_id':lot_id,'request_id':'new-year-second-order'}).status_code==409
    assert not client.get('/api/new-year',headers=player).json['lots']
    other=signed(44)
    assert client.get('/api/me',headers=other).status_code==200
    assert client.post('/api/admin/new-year/wallet',headers=admin,
                       json={'user_id':44,'balls':'300'}).status_code==200
    assert client.post('/api/new-year/buy',headers=other,
                       json={'lot_id':lot_id,'request_id':'other-player-order'}).status_code==409
    assert client.get('/api/new-year',headers=other).json['balance']['balls']==300
    gifts=client.get('/api/inventory',headers=player).json['gifts']
    assert len([item for item in gifts if item['id']==reward['id']])==1
    assert client.get('/api/me',headers=player).json['inventory_value']=='0'
    assert client.post('/api/resale/listings',headers=player,json={
        'action':'sell','items':[{'id':reward['id'],'price':'1.0'}]}).status_code==409
    assert client.post('/api/admin/new-year/lots/'+lot_id+'/status',
                       headers=admin,json={'status':'active'}).status_code==409


def test_promo_numeric_auto_generated_usage_limit_and_balances(client):
    admin=signed(42)
    for uid in (42,43,44,45):
        assert client.get('/api/me',headers=signed(uid)).status_code==200
    assert client.get('/api/admin/promocodes',headers=signed(43)).status_code==403
    made=client.post('/api/admin/promocodes',headers=admin,json={
        'code':'','reward':'0.1','limit':'2'})
    assert made.status_code==200,made.json
    code=made.json['code']
    assert len(code)==8 and code.isdigit()
    for uid in (43,44):
        redemption=client.post('/api/promocodes/redeem',headers=signed(uid),
                               json={'code':code})
        assert redemption.status_code==200,redemption.json
        assert redemption.json['balance']=='0.1'
        assert client.get('/api/balance',headers=signed(uid)).json['balance']=='0.1'
    assert client.post('/api/promocodes/redeem',headers=signed(43),
                       json={'code':code}).status_code==409
    assert client.post('/api/promocodes/redeem',headers=signed(45),
                       json={'code':code}).status_code==409
    rows=client.get('/api/admin/promocodes',headers=admin).json['codes']
    assert rows[0]['used']==2


def test_referral_five_levels_and_minimum_cash_out(client):
    assert client.get('/api/me',headers=signed(42)).status_code==200
    for uid in range(43,48):
        assert client.get('/api/me',headers=signed(uid)).status_code==200
    with sqlite3.connect(client.application.config['DATABASE']) as connection:
        connection.execute('UPDATE users SET referrer=42 WHERE id BETWEEN 43 AND 47')
    status=client.get('/api/referrals',headers=signed(42))
    assert status.status_code==200,status.json
    assert status.json['referrals']==5
    assert status.json['level']==2
    assert status.json['rate']==6
    assert status.json['levels']==[5,6,7,8,10]
    response=client.get('/api/me',headers=signed(42)).json
    assert response['referral_level']==2
    assert response['referral_rate']==6
    assert client.post('/api/referrals/withdraw',headers=signed(42),
                       json={'request_id':'referral-withdraw-1'}).status_code==409


def test_telegram_exact_nft_metadata_without_portals_listing(monkeypatch):
    import urllib.request
    from io import BytesIO
    slug='ChillFlame-426793'
    body='''<!doctype html><html><head>
      <meta property="og:title" content="Chill Flame #426793">
      <meta name="twitter:description" content="Model: Iron Rose&#10;Backdrop: Persimmon&#10;Symbol: Coonskin Cap">
      <meta property="og:image" content="https://cdn.telegram.org/gift/exact.png">
      </head><body><table><tr><th>Model</th><td>Iron Rose 3%</td></tr>
      <tr><th>Backdrop</th><td>Persimmon <span>1.2%</span></td></tr>
      <tr><th>Symbol</th><td>Coonskin Cap 0.4%</td></tr></table></body></html>'''
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def geturl(self):return 'https://t.me/nft/'+slug
        def read(self,limit):return body.encode()
    monkeypatch.setattr(urllib.request,'urlopen',lambda *a,**kw:Response())
    data=new_year.telegram_nft_metadata(slug)
    assert data['metadata_source']=='telegram'
    assert data['model']=='Iron Rose'
    assert data['symbol']=='Coonskin Cap'
    assert data['backdrop']=='Persimmon'
    assert data['image']=='https://cdn.telegram.org/gift/exact.png'
    assert data['rarity']=={'model':30.0,'symbol':4.0,'backdrop':12.0}


def test_portals_collection_floor_from_exact_collection(monkeypatch):
    requests=[]
    def fake_portals(path,params):
        requests.append((path,params))
        if path=='collections':
            return {'collections':[{'id':'not-lunar','name':'Another Gift'},
                                   {'id':'lunar-id','name':'Lunar Snake'}]}
        assert path=='nfts/search'
        assert params['collection_id']=='lunar-id' and params['sort_by']=='price asc'
        return {'results':[{'price':'4.23'}]}
    monkeypatch.setattr(new_year,'portals_get',fake_portals)
    assert new_year.portals_collection_floor('LunarSnake-98916')=='4.23'
    assert new_year.portals_collection_floor('MissingGift-1')==''


def test_promo_ball_reward_separate_from_gram_and_repeat_protection(client):
    admin=signed(42)
    first=signed(43)
    second=signed(44)
    for header in (admin,first,second):
        assert client.get('/api/me',headers=header).status_code==200
    made=client.post('/api/admin/promocodes',headers=admin,json={
        'currency':'BALL','reward':'250','limit':'1'})
    assert made.status_code==200,made.json
    code=made.json['code']
    assert made.json['currency']=='BALL'
    assert client.post('/api/admin/promocodes',headers=admin,json={
        'currency':'BALL','reward':'0.5','limit':'1'}).status_code==400
    result=client.post('/api/promocodes/redeem',headers=first,json={'code':code})
    assert result.status_code==200,result.json
    assert result.json['currency']=='BALL'
    assert result.json['new_year_balance']['balls']==250
    assert client.get('/api/balance',headers=first).json['balance']=='0'
    assert client.get('/api/balance',headers=first).json['new_year']['balls']==250
    assert client.post('/api/promocodes/redeem',headers=first,json={'code':code}).status_code==409
    assert client.post('/api/promocodes/redeem',headers=second,json={'code':code}).status_code==409



def test_seasonal_frontend_and_admin_users_navigation_regression():
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    ny=(root/'static/new-year.js').read_text(encoding='utf-8')
    promo=(root/'static/promo-profile.js').read_text(encoding='utf-8')
    admin=(root/'static/admin-page.js').read_text(encoding='utf-8')
    create=(root/'static/promocodes-admin.js').read_text(encoding='utf-8')
    assert 'Лоты публикует администрация Crafter.' not in ny
    assert 'Загрузка данных NFT из Telegram' in ny
    assert 'crafter-referral-panel' in promo
    assert 'sessionStorage.setItem(key' in promo
    assert 'admin-nav-search' in admin
    assert "id: 'users'" in admin or 'users:' in admin      # Users stays a regular, searchable section
    assert 'option value="BALL"' in create
    assert 'option value="GRAM"' in create
    assert "new_year_balance" in promo
