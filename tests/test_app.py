import hashlib,hmac,json,time
from urllib.parse import urlencode
import pytest
from app import create_app,DEMO_GIFTS

def signed(uid=42,age=0,token='test-token'):
    data={'auth_date':str(int(time.time())-age),'user':json.dumps({'id':uid,'first_name':'Test'})}
    key=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
    data['hash']=hmac.new(key,'\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(),hashlib.sha256).hexdigest()
    return {'X-Telegram-Init-Data':urlencode(data)}
@pytest.fixture
def client(tmp_path):
    return create_app({'TESTING':True,'DATABASE':str(tmp_path/'test.db'),'BOT_TOKEN':'test-token','ADMIN_IDS':{42},'DEMO_MODE':False}).test_client()
def test_auth_and_roles(client):
    assert client.get('/api/me').status_code==401
    assert client.get('/api/me',headers=signed()).json['is_admin'] is True
    assert client.get('/api/admin/status',headers=signed(43)).status_code==403
    assert client.get('/api/admin/status',headers=signed()).status_code==200
def test_forged_and_stale(client):
    assert client.get('/api/me',headers=signed(token='wrong')).status_code==401
    assert client.get('/api/me',headers=signed(age=4000)).status_code==401
    h=signed();h['X-Telegram-Init-Data']+='&user=%7B%22id%22%3A42%7D'
    assert client.get('/api/me',headers=h).status_code==401
def test_live_craft_blocked_and_inventory_isolated(client):
    assert client.post('/api/craft',headers=signed(),json={'gift_ids':['demo-snoop']}).status_code==409
    assert client.get('/api/inventory',headers=signed()).json['gifts']==[]
def test_selection_persists(client):
    data={'selection':{'snoopdogg':['Emerald']}}
    assert client.post('/api/admin/selection',headers=signed(),json=data).status_code==200
    assert client.get('/api/admin/selection',headers=signed()).json==data
    assert client.post('/api/admin/selection',headers=signed(43),json=data).status_code==403
def test_demo_craft(tmp_path):
    c=create_app({'DATABASE':str(tmp_path/'demo.db'),'DEMO_MODE':True}).test_client()
    assert c.post('/api/craft',json={'gift_ids':['demo-snoop','demo-snoop']}).status_code==400
    assert c.post('/api/craft',json={'gift_ids':['foreign']}).status_code==400
    r=c.post('/api/craft',json={'gift_ids':['demo-snoop'],'target_id':'demo-amulet'})
    assert r.status_code==200 and r.json['demo'] and r.json['chance']==20
    assert len(c.get('/api/inventory').json['gifts'])==(4 if r.json['success'] else 3)
    assert not any(x['id']=='demo-snoop' for x in c.get('/api/inventory').json['gifts'])

def test_demo_listing_and_purchase(tmp_path):
    c=create_app({'DATABASE':str(tmp_path/'ops.db'),'DEMO_MODE':True}).test_client()
    assert c.post('/api/inventory/action',json={'action':'sell','gift_ids':['demo-snoop'],'price':'15.25'}).status_code==200
    gift=next(g for g in c.get('/api/inventory').json['gifts'] if g['id']=='demo-snoop')
    assert gift['status']=='listed' and gift['price']=='15.25'
    assert c.post('/api/craft',json={'gift_ids':['demo-snoop'],'target_id':'demo-amulet'}).status_code==409
    assert c.post('/api/inventory/action',json={'action':'unlist','gift_ids':['demo-snoop']}).status_code==200
    assert c.post('/api/demo/buy',json={'id':'demo-snoop'}).status_code==200
    assert c.get('/api/me').json['balance']=='90.51'
    assert len(c.get('/api/inventory').json['gifts'])==5
    assert len(c.get('/api/history').json['items'])==3

def test_craft_idempotency(tmp_path):
    c=create_app({'DATABASE':str(tmp_path/'craft.db'),'DEMO_MODE':True}).test_client()
    payload={'gift_ids':['demo-snoop'],'target_id':'demo-amulet','request_id':'unique-craft'}
    a=c.post('/api/craft',json=payload);b=c.post('/api/craft',json=payload)
    assert a.status_code==200 and b.json==a.json
    assert len(c.get('/api/history').json['items'])==1
    assert c.post('/api/craft',json={**payload,'request_id':'another-craft'}).status_code==409

def test_preview_contains_real_cube_renderer(client):
    result=client.get('/preview')
    assert result.status_code==200
    assert b'Software-projected solid cube' in result.data
    assert b'CrafterCube.draw' in result.data
    assert b'window.fetch=async' in result.data
    assert result.headers['Cache-Control']=='no-cache, must-revalidate'

def test_market_key_is_optional_and_failure_is_honest(client,monkeypatch):
    import app
    def deny(*a,**k):raise app.URLError('unavailable')
    monkeypatch.setattr(app,'urlopen',deny)
    r=client.get('/api/market',headers=signed())
    assert r.status_code==200 and r.json['source']=='unavailable'
    assert r.json['gifts']==[] and r.json['warning']
