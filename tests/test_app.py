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

def test_craft_claims_market_serial_and_blocks_purchase(client, craft_inputs):
    headers = signed()
    listing = {**DEMO_GIFTS[0], 'id': 'market-original', 'number': 29563, 'price_unit': 'GRAM'}
    alternate = {**listing, 'id': 'same-gift-on-another-feed'}
    other = {**listing, 'id': 'other-model', 'number': 29564, 'model': 'Different'}
    now = int(time.time())
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.executemany('INSERT INTO cache VALUES (?, ?, ?)', [
            ('public:market:', json.dumps({'gifts': [listing, other]}), now),
            ('public:market:offset=20', json.dumps({'gifts': [alternate]}), now - 1),
        ])
    quote = client.post('/api/craft/quote', headers=headers,
                        json={'gift_ids': craft_inputs[:1], 'target_id': 'snoop'}).json
    request = {'quote_id': quote['quote_id'], 'request_id': 'market-craft'}
    result = client.post('/api/craft', headers=headers, json=request)
    assert result.status_code == 200
    reward = result.json['gift']
    assert (reward['number'], reward['source_number'], reward['source_id']) == (29563, 29563, listing['id'])
    assert client.post('/api/craft', headers=headers, json=request).json == result.json
    assert [gift['id'] for gift in client.get('/api/market', headers=headers).json['gifts']] == [other['id']]
    assert not client.get('/api/market?offset=20', headers=headers).json['gifts']
    buy = client.post('/api/local/buy', headers=headers,
                      json={'id': alternate['id'], 'request_id': 'purchase'})
    assert buy.status_code == 409 and 'недоступен' in buy.json['error']

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


def test_craft_keeps_black_background_and_symbol_when_market_has_only_floor(client, craft_inputs, monkeypatch):
    import thermos
    from app import DEMO_GIFTS
    monkeypatch.setattr(thermos, 'request', lambda *_: {'Snoop Dogg': {
        'models': [{'name': 'Emerald', 'image_url': '/static/assets/snoop.webp'}],
        'backdrops': [{'name': 'Gold'}],
        'symbols': [{'name': 'Rain Drop'}],
    }})
    monkeypatch.setattr('app.secrets.choice', lambda items: items[-1])
    listing = {**DEMO_GIFTS[0], 'id': 'floor-listing', 'symbol': 'Rain Drop', 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)',
                   ('public:market:', json.dumps({'gifts': [listing]}), int(time.time())))
    headers = signed()
    quote = client.post('/api/craft/quote', headers=headers,
                        json={'gift_ids': craft_inputs[:1], 'target_id': 'snoop'}).json
    result = client.post('/api/craft', headers=headers,
                         json={'quote_id': quote['quote_id'], 'request_id': 'black-craft'})
    assert result.status_code == 200
    gift = result.json['gift']
    assert (gift['backdrop'], gift['symbol']) == ('Black', 'Rain Drop')
    assert 'source_id' not in gift
    assert client.get('/api/market', headers=headers).json['gifts'][0]['id'] == listing['id']


def test_lucky_craft_awards_exact_lot_and_rejects_other_quote(client, craft_inputs):
    headers = signed()
    first = {**DEMO_GIFTS[0], 'id': 'cheaper', 'number': 321, 'price': '1', 'price_unit': 'GRAM'}
    target = {**first, 'id': 'lucky', 'number': 71904, 'price': '20',
              'model': 'Radagast', 'symbol': 'Baphomet', 'backdrop': 'Silver Blue'}
    alias = {**target, 'id': 'lucky-alias'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)',
                   ('public:market:', json.dumps({'gifts': [first, target, alias]}), int(time.time())))

    def quote(input_id):
        result = client.post('/api/craft/quote', headers=headers, json={
            'gift_ids': [input_id], 'target_id': 'snoop', 'listing_id': target['id'],
        })
        assert result.status_code == 200
        assert result.json['chance'] == 47.5
        return result.json['quote_id']

    winning, stale = [quote(input_id) for input_id in craft_inputs[:2]]
    result = client.post('/api/craft', headers=headers, json={'quote_id': winning, 'request_id': winning})
    assert result.status_code == 200
    reward = result.json['gift']
    assert (reward['source_id'], reward['number'], reward['symbol']) == ('lucky', 71904, 'Baphomet')
    assert [gift['id'] for gift in client.get('/api/market', headers=headers).json['gifts']] == ['cheaper']
    rejected = client.post('/api/craft', headers=headers, json={'quote_id': stale, 'request_id': stale})
    assert rejected.status_code == 409
    inventory = client.get('/api/inventory', headers=headers).json['gifts']
    assert craft_inputs[1] in {gift['id'] for gift in inventory}


def test_market_requests_all_selected_collections(client, monkeypatch):
    import thermos

    now = int(time.time())
    catalog = [{'id': 'snoop', 'name': 'Snoop Dogg'}, {'id': 'amulet', 'name': 'Faith Amulet'}]
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)', ('thermos:collections', json.dumps(catalog), now))

    def request(path, body):
        assert path == 'gifts'
        assert set(body['collections']) == {'Snoop Dogg', 'Faith Amulet'}
        assert body['page'] == 2
        return {'count': 21, 'items': [
            {'external_id': 'two', 'collection': 'Faith Amulet', 'number': 5, 'price': '1000000000',
             'image_url': '', 'marketplace': 'PORTALS'},
        ]}

    monkeypatch.setattr(thermos, 'request', request)
    result = client.get('/api/market?collection_id=snoop,amulet&offset=20', headers=signed())
    assert result.status_code == 200
    assert [gift['collection_id'] for gift in result.json['gifts']] == ['amulet']
    assert result.json['next_offset'] == 40


def test_telegram_bot_settings_connect_start_and_menu(client, monkeypatch):
    import telegram_bot

    token = '12345:fake_telegram_bot_token'
    calls = []
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://crafter.example')

    def telegram_api(key, method, payload):
        assert key == token
        calls.append((method, payload))
        if method == 'getMe':
            return {'is_bot': True, 'id': 12345, 'username': 'crafter_example_bot'}
        return True

    monkeypatch.setattr(telegram_bot, 'bot_api', telegram_api)
    route = '/api/admin/telegram-bot'
    assert client.get(route, headers=signed(43)).status_code == 403
    settings = {
        'token': token, 'greeting': 'Добро пожаловать!', 'menu_text': 'Открыть меню', 'app_url': '',
        'buttons': [{'text': 'Crafter', 'type': 'web_app', 'url': ''},
                    {'text': 'Правила', 'type': 'url', 'url': 'https://crafter.example/rules'}],
    }
    saved = client.post(route, headers=signed(), json=settings)
    assert saved.status_code == 200
    assert saved.json['token_configured'] and token.encode() not in saved.data
    assert client.get('/api/me', headers=signed(token=token)).status_code == 200

    connected = client.post(route + '/connect', headers=signed(), json={})
    assert connected.json['connected']
    method, webhook = calls[-1]
    assert method == 'setWebhook'
    assert webhook['url'] == 'https://crafter.example/api/telegram/webhook/12345'
    hook = '/api/telegram/webhook/12345'
    event = {'update_id': 10, 'message': {'chat': {'id': 42, 'type': 'private'}, 'text': '/start ref_5'}}
    header = {'X-Telegram-Bot-Api-Secret-Token': webhook['secret_token']}
    assert client.post(hook, json=event).status_code == 403
    assert client.post(hook, headers=header, json=event).status_code == 200
    assert client.post(hook, headers=header, json=event).status_code == 200
    sent = [body for method, body in calls if method == 'sendMessage']
    assert len(sent) == 1 and sent[0]['text'] == settings['greeting']
    assert sent[0]['reply_markup']['inline_keyboard'] == [
        [{'text': 'Crafter', 'web_app': {'url': 'https://crafter.example'}}],
        [{'text': 'Правила', 'url': 'https://crafter.example/rules'}],
    ]
    assert client.post(route + '/menu', headers=signed(), json={}).status_code == 200
    assert calls[-1] == ('setChatMenuButton', {'menu_button': {
        'type': 'web_app', 'text': 'Открыть меню', 'web_app': {'url': 'https://crafter.example'},
    }})
    backup = client.get('/api/admin/database/backup', headers=signed())
    assert backup.status_code == 200
    assert token.encode() not in backup.data and webhook['secret_token'].encode() not in backup.data
