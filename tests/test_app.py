import hashlib,hmac,json,sqlite3,time
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
    assert client.post('/api/craft/quote',headers=signed(),json={'gift_ids':['demo-snoop']}).status_code==409
    assert client.get('/api/inventory',headers=signed()).json['gifts']==[]
def test_selection_persists(client):
    data={'selection':{'snoopdogg':['Emerald']}}
    assert client.post('/api/admin/selection',headers=signed(),json=data).status_code==200
    assert client.get('/api/admin/selection',headers=signed()).json==data
    assert client.post('/api/admin/selection',headers=signed(43),json=data).status_code==403
@pytest.fixture
def craft_inputs(client, monkeypatch):
    import thermos
    monkeypatch.setattr(thermos, 'collections', lambda: [
        {'id': 'snoop', 'name': 'Snoop Dogg', 'floor_price': '10', 'photo_url': '/static/assets/snoop.webp'}
    ])
    monkeypatch.setattr(thermos, 'request', lambda *_: {
        'Snoop Dogg': {'models': [{'name': 'Emerald', 'image_url': '/static/assets/snoop.webp'}]}
    })
    monkeypatch.setattr('app.secrets.randbelow', lambda _: 0)
    client.get('/api/me', headers=signed())
    gifts = [{**DEMO_GIFTS[0], 'id': f'input-{i}', 'number': 100+i, 'origin': 'admin-grant'}
             for i in range(5)]
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.executemany('INSERT INTO inventory VALUES (42, ?, ?, \'unlisted\')',
                       [(gift['id'], json.dumps(gift)) for gift in gifts])
    return [gift['id'] for gift in gifts]

def test_craft_limit_rejects_fifth_gift_and_existing_oversized_quote(client, craft_inputs):
    headers = signed()
    quote = {'gift_ids': craft_inputs, 'target_id': 'snoop'}
    assert client.post('/api/craft/quote', headers=headers, json=quote).status_code == 400
    assert client.post('/api/craft/quote', headers=headers,
                       json={**quote, 'gift_ids': [craft_inputs[0]]*2}).status_code == 400

    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO craft_quotes VALUES (?, 42, ?, ?)',
                   ('legacy-oversize', json.dumps(quote), int(time.time())))
    result = client.post('/api/craft', headers=headers,
                         json={'quote_id': 'legacy-oversize', 'request_id': 'legacy-oversize'})
    assert result.status_code == 400
    assert len(client.get('/api/inventory', headers=headers).json['gifts']) == 5
    assert not client.get('/api/history', headers=headers).json['items']

def test_demo_listing_and_purchase(tmp_path):
    c=create_app({'DATABASE':str(tmp_path/'ops.db'),'DEMO_MODE':True}).test_client()
    assert c.post('/api/inventory/action',json={'action':'sell','gift_ids':['demo-snoop'],'price':'15.25'}).status_code==200
    gift=next(g for g in c.get('/api/inventory').json['gifts'] if g['id']=='demo-snoop')
    assert gift['status']=='listed' and gift['price']=='15.25'
    assert c.post('/api/craft/quote',json={'gift_ids':['demo-snoop'],'target_id':'demo-amulet'}).status_code==409
    assert c.post('/api/inventory/action',json={'action':'unlist','gift_ids':['demo-snoop']}).status_code==200
    assert c.post('/api/demo/buy',json={'id':'demo-snoop'}).status_code==200
    assert c.get('/api/me').json['balance']=='90.51'
    assert len(c.get('/api/inventory').json['gifts'])==5
    assert len(c.get('/api/history').json['items'])==3

def test_four_gift_craft_awards_numbered_result_once(client, craft_inputs):
    headers = signed()
    quote = client.post('/api/craft/quote', headers=headers,
                        json={'gift_ids': craft_inputs[:4], 'target_id': 'snoop'})
    assert quote.status_code == 200
    payload = {'quote_id': quote.json['quote_id'], 'request_id': 'unique-craft'}
    result = client.post('/api/craft', headers=headers, json=payload)
    assert result.status_code == 200 and result.json['success']
    assert result.json['consumed'] == craft_inputs[:4]
    gift = result.json['gift']
    assert gift['number'] > 0 and gift['background'] and gift['image']
    assert client.post('/api/craft', headers=headers, json=payload).json == result.json
    assert len(client.get('/api/history', headers=headers).json['items']) == 1
    assert {gift['id'], craft_inputs[4]} == {
        item['id'] for item in client.get('/api/inventory', headers=headers).json['gifts']
    }

def test_preview_contains_real_cube_renderer(client):
    result=client.get('/preview')
    assert result.status_code==200
    assert b'Rounded solid cube' in result.data
    assert b'CrafterCube.draw' in result.data
    assert b'window.fetch=async' in result.data
    assert result.headers['Cache-Control']=='no-cache, must-revalidate'

def test_market_key_is_optional_and_failure_is_honest(client,monkeypatch):
    import portals_public, thermos
    def deny(*args, **kwargs):
        raise OSError('unavailable')
    monkeypatch.setattr(portals_public, 'listings', deny)
    monkeypatch.setattr(thermos, 'gifts', deny)
    r=client.get('/api/market',headers=signed())
    assert r.status_code == 502 and r.json['error']
