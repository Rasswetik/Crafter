import hashlib,hmac,json,sqlite3,time
from urllib.parse import urlencode
import pytest
from app import create_app,DEMO_GIFTS

def signed(uid=42,age=0,token='test-token',**profile):
    data={'auth_date':str(int(time.time())-age),'user':json.dumps({'id':uid,'first_name':'Test',**profile})}
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
def test_craft_targets_use_priced_collection_in_cached_duplicates(client):
    collection_id = '5882260270843168924'
    rows = [
        {'id': collection_id, 'name': 'UFC Mystery Box', 'floor_price': '0', 'photo_url': ''},
        {'id': collection_id, 'name': 'UFC Strike', 'floor_price': '17', 'photo_url': 'https://example.com/strike.png'},
    ]
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)', ('thermos:collections', json.dumps(rows), int(time.time())))

    response = client.get('/api/craft/targets', headers=signed())
    assert response.status_code == 200
    assert response.json['collections'] == [
        {**rows[1], 'photo_url': '/static/assets/collection-ufc-strike.webp'},
    ]

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
    monkeypatch.setattr('app.secrets.choice', lambda items: items[0])
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
    listing = {**DEMO_GIFTS[0], 'id': 'real-lot', 'number': 333,
               'background': {'center_color': 10}, 'price_unit': 'GRAM'}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)',
                   ('public:market:', json.dumps({'gifts': [listing]}), int(time.time())))
    quote = client.post('/api/craft/quote', headers=headers,
                        json={'gift_ids': craft_inputs[:4], 'target_id': 'snoop'})
    assert quote.status_code == 200
    payload = {'quote_id': quote.json['quote_id'], 'request_id': 'unique-craft'}
    result = client.post('/api/craft', headers=headers, json=payload)
    assert result.status_code == 200 and result.json['success']
    assert result.json['consumed'] == craft_inputs[:4]
    gift = result.json['gift']
    assert (gift['number'], gift['source_id'], gift['image']) == (333, 'real-lot', listing['image'])
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
    # Query-suffixed static paths must be embedded, not fetched from /static offline.
    assert b'src="/static/app.js?' not in result.data
    assert b'href="/static/staking.css?' not in result.data
    assert b'function renderGamesHub()' in result.data
    assert b'function renderOffersInbox(' in result.data
    assert result.headers['Cache-Control']=='no-cache, must-revalidate'

def test_market_key_is_optional_and_failure_is_honest(client,monkeypatch):
    import portals_public, thermos
    def deny(*args, **kwargs):
        raise OSError('unavailable')
    monkeypatch.setattr(portals_public, 'listings', deny)
    monkeypatch.setattr(thermos, 'gifts', deny)
    r=client.get('/api/market',headers=signed())
    assert r.status_code == 502 and r.json['error']


def test_craft_keeps_actual_listing_attributes_and_image(client, craft_inputs):
    listing = {**DEMO_GIFTS[0], 'id': 'listed-black', 'backdrop': 'Black',
               'symbol': 'Rain Drop', 'price_unit': 'GRAM', 'image': 'https://example.test/exact.png'}
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
    assert (gift['backdrop'], gift['symbol'], gift['image']) == ('Black', 'Rain Drop', listing['image'])
    assert gift['source_id'] == listing['id']
    assert not client.get('/api/market', headers=headers).json['gifts']


def test_craft_without_available_listing_keeps_materials(client, craft_inputs, monkeypatch):
    import portals_public
    monkeypatch.setattr(portals_public, 'listings', lambda *_: {'gifts': []})
    headers = signed()
    result = client.post('/api/craft/quote', headers=headers,
                         json={'gift_ids': craft_inputs[:1], 'target_id': 'snoop'})
    assert result.status_code == 409
    assert len(client.get('/api/inventory', headers=headers).json['gifts']) == len(craft_inputs)


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


def test_collection_overview_counts_local_and_demo_purchases(client):
    now = int(time.time())
    collection = {'id': 'snoop', 'name': 'Snoop Dogg', 'photo_url': '/static/assets/snoop.webp',
                  'floor_price': '5', 'price_unit': 'TON'}
    purchase = {'gift': {'name': 'Snoop Dogg'}, 'price': '3.25', 'scope': 'application'}
    demo_purchase = {'name': 'Snoop Dogg', 'price': '1.15', 'demo': True}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?, ?, ?)', ('thermos:collections', json.dumps([collection]), now))
        db.execute('INSERT INTO cache VALUES (?, ?, ?)', (
            'thermos:attributes:snoop', json.dumps({'models': [{'name': 'Emerald', 'image_url': '/model.svg'}]}), now))
        for i, (kind, payload, created) in enumerate([
            ('buy', purchase, now), ('buy', demo_purchase, now - 90000),
            ('craft', purchase, now), ('buy', {'name': 'Other', 'price': '40'}, now),
        ]):
            db.execute('INSERT INTO history VALUES (?, ?, ?, ?, ?)',
                       (str(i), 42, kind, json.dumps(payload), created))
    result = client.get('/api/collections/snoop/overview', headers=signed())
    assert result.status_code == 200
    assert result.json['volume_24h'] == '3.25'
    assert result.json['volume_total'] == '4.40'
    assert result.json['models'] == [{'name': 'Emerald', 'image': '/model.svg'}]
    assert b'id="collection-screen"' in client.get('/collections/snoop').data


def test_fragment_media_validates_numbered_slug_and_serves_image(client, monkeypatch):
    import fragment_media

    def image(slug):
        assert slug == 'nailbracelet-284453'
        return b'\xff\xd8\xff', 'image/jpeg'

    monkeypatch.setattr(fragment_media, 'fragment_image', image)
    result = client.get('/media/fragment/nailbracelet-284453')
    assert result.status_code == 200 and result.content_type == 'image/jpeg'
    assert result.headers['Cache-Control'] == 'public, max-age=86400'
    assert client.get('/media/fragment/127.0.0.1').status_code == 404


def test_market_activity_filters_collection_model_and_type(client):
    now = int(time.time())
    gift = {'name': 'Witch Hat', 'collection_id': 'hat', 'model': 'Arcade',
            'image': '/static/assets/hat.webp', 'number': 10}
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        for i, (kind, payload) in enumerate([
            ('buy', {'gift': gift, 'price': '5.75', 'private': 42}),
            ('buy', {'gift': {**gift, 'model': 'Another'}, 'price': '9'}),
            ('buy', {'gift': {**gift, 'name': 'Other', 'collection_id': 'other'}, 'price': '50'}),
            ('craft', {'success': True, 'gift': {**gift, 'source_id': 'lot'}, 'mode': 'lucky'}),
        ]):
            db.execute('INSERT INTO history VALUES (?,?,?,?,?)', (str(i), 42, kind, json.dumps(payload), now))
    result = client.get('/api/market/activity?collections=hat&model=Arcade&types=buy', headers=signed())
    assert result.status_code == 200
    assert result.json['turnover'] == '5.75' and result.json['purchases'] == 1
    assert result.json['models'] == ['Another', 'Arcade']
    assert result.json['items'][0]['gift']['name'] == 'Witch Hat'
    assert b'private' not in result.data


def test_wallet_history_includes_purchases_and_paginates_by_user(client):
    headers = signed()
    client.get('/api/me', headers=headers)
    lot = {**DEMO_GIFTS[0], 'id': 'wallet-lot', 'price': '4.25', 'price_unit': 'GRAM'}
    now = int(time.time())
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute('INSERT INTO cache VALUES (?,?,?)',
                   ('public:market:', json.dumps({'gifts': [lot]}), now))
        db.execute('UPDATE demo_accounts SET balance=? WHERE user_id=42', ('20',))
        db.executemany('INSERT INTO history VALUES (?,?,?,?,?)', [
            (f'legacy-{i}', 42, 'buy', json.dumps({'name':'Legacy gift','price':'1'}), now - 600)
            for i in range(32)
        ])
        db.execute('INSERT INTO history VALUES (?,?,?,?,?)',
                   ('private', 43, 'buy', json.dumps({'price': '1000'}), now))

    purchase = client.post('/api/local/buy', headers=headers,
                           json={'id': lot['id'], 'request_id': 'wallet-single'})
    assert purchase.status_code == 200
    assert client.post('/api/admin/users/42/balance', headers=headers, json={'balance': '18'}).status_code == 200
    history = client.get('/api/wallet/history', headers=headers).json
    by_kind = {item['kind']:item for item in history['items'][:2]}
    assert by_kind['buy']['data']['price'] == '4.25'
    assert by_kind['buy']['data']['gift']['source_id'] == lot['id']
    assert by_kind['balance_adjustment']['data']['gram'] == '2.25'
    assert len(history['items']) == 30
    second = client.get('/api/wallet/history', headers=headers,
                        query_string={'before': history['next_cursor']}).json
    rows = history['items'] + second['items']
    assert len({item['id'] for item in rows}) == len(rows) == 34
    assert second['next_cursor'] is None
    assert [item['id'] for item in client.get('/api/wallet/history', headers=signed(43)).json['items']] == ['private']
    filtered = client.get('/api/wallet/history?types=balance_adjustment', headers=headers).json
    assert filtered['items'] == [by_kind['balance_adjustment']]
    assert client.get('/api/wallet/history?before=invalid', headers=headers).status_code == 400


def test_wallet_deposit_checks_sender_balance_and_confirms_after_unlink(client, monkeypatch):
    from tonsdk.utils import Address
    import wallet

    headers = signed()
    sender, receiver, other = ('0:' + char * 64 for char in ('1', '2', '3'))
    settings = {'enabled': True, 'network': 'testnet', 'receiver': receiver, 'gram_per_ton': '2',
                'withdraw_enabled': True}
    assert client.post('/api/admin/tonconnect', headers=headers, json=settings).status_code == 200

    def post(path, body):
        return client.post('/api/wallet/' + path, headers=headers, json=body)

    assert post('connect', {'address': sender, 'network': 'mainnet'}).status_code == 409
    assert post('connect', {'address': sender, 'network': 'testnet'}).status_code == 200
    transactions = []

    def mock_rpc(network, method, params, key):
        assert network == 'testnet'
        if method == 'getAddressBalance':
            assert params == {'address': sender}
            return '1700000001'
        assert method == 'getTransactions' and params['address'] == receiver
        return transactions

    monkeypatch.setattr(wallet, 'rpc', mock_rpc)
    balance = client.get('/api/wallet/balance', headers=headers).json
    assert balance == {'address': sender, 'network': 'testnet', 'balance_ton': '1.700000001'}
    assert post('deposit', {'gram': '3.25', 'sender': other}).status_code == 409
    assert post('deposit', {'gram': '0.10', 'sender': sender}).status_code == 400
    result = post('deposit', {'gram': '3.25', 'sender': sender})
    assert result.status_code == 200
    intent = result.json
    transaction = intent['transaction']
    assert transaction['network'] == '-3' and transaction['from'] == sender
    message = transaction['messages'][0]
    destination = Address(message['address'])
    assert destination.is_user_friendly and destination.is_test_only
    assert destination.to_string(False) == receiver
    assert message['amount'] == '1625000000' and message['payload']

    check_path = 'deposit/' + intent['id'] + '/check'
    assert post('disconnect', {'address': other, 'network': 'testnet'}).status_code == 200
    assert client.get('/api/wallet/balance', headers=headers).status_code == 200
    assert post('disconnect', {'address': sender, 'network': 'testnet'}).status_code == 200
    assert client.get('/api/wallet/balance', headers=headers).status_code == 409
    assert client.get('/api/wallet', headers=headers).json['connected'] is None
    assert post(check_path, {}).json == {'status': 'pending'}
    initial = client.get('/api/wallet', headers=headers).json['balance']
    assert client.get('/api/wallet/history', headers=headers).json['items'][0]['status'] == 'pending'

    memo = 'crafter:' + intent['id']
    chain_message = {'source':other, 'destination':receiver, 'value':message['amount'], 'message':memo}
    transactions.append({'in_msg':chain_message, 'transaction_id':{'hash':'deposit-hash'}, 'utime':int(time.time())})
    assert post(check_path, {}).json == {'status': 'pending'}
    chain_message['source'] = sender
    assert post(check_path, {}).json['status'] == 'confirmed'
    assert post(check_path, {}).json == {'status': 'confirmed'}
    from decimal import Decimal
    assert Decimal(client.get('/api/wallet', headers=headers).json['balance']) == Decimal(initial) + Decimal('3.25')

    assert post('connect', {'address': sender, 'network': 'testnet'}).status_code == 200
    withdrawal = post('withdraw', {'gram': '1.25', 'request_id': 'wallet-withdrawal'})
    assert withdrawal.status_code == 200
    history = client.get('/api/wallet/history', headers=headers).json['items']
    assert [(item['kind'], item['status'], item['data']['gram']) for item in history] == [
        ('withdraw_funds', 'queued', '1.25'), ('deposit', 'confirmed', '3.25')]

    available_after_request = client.get('/api/wallet', headers=headers).json
    assert available_after_request['funded_balance'] == '2.00'
    assert available_after_request['withdrawable'] == '2.00'
    wid = withdrawal.json['id']
    assert post('withdraw/' + wid + '/cancel', {}).status_code == 200
    assert post('withdraw/' + wid + '/cancel', {}).json == {'status':'cancelled'}
    assert client.post('/api/admin/tonconnect/withdraw/' + wid + '/prepare',
                       headers=headers, json={}).status_code == 409
    assert client.post('/api/wallet/withdraw/' + wid + '/cancel',
                       headers=signed(43), json={}).status_code == 404
    restored = client.get('/api/wallet', headers=headers).json
    assert restored['funded_balance'] == '3.25'
    assert restored['withdrawable'] == '3.25'
    assert client.get('/api/wallet/history', headers=headers).json['items'][0]['status'] == 'cancelled'
    # Idempotency keys from an already cancelled request must not create a new payout.
    assert post('withdraw', {'gram':'1.25', 'request_id':'wallet-withdrawal'}).json['status'] == 'cancelled'



def test_wallet_withdraw_backing_daily_quota_and_processing_cannot_be_cancelled(client):
    from decimal import Decimal
    headers = signed()
    sender = '0:' + '1' * 64
    receiver = '0:' + '2' * 64
    assert client.get('/api/me', headers=headers).status_code == 200
    assert client.post('/api/admin/tonconnect', headers=headers, json={
        'enabled': True, 'network':'testnet', 'receiver':receiver,
        'withdraw_enabled':True, 'gram_per_ton':'1',
        'withdraw_max':'10','withdraw_daily':'2',
    }).status_code == 200
    assert client.post('/api/wallet/connect', headers=headers,
                       json={'address':sender,'network':'testnet'}).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("UPDATE demo_accounts SET balance='10.00' WHERE user_id=42")
    info = client.get('/api/wallet', headers=headers).json
    assert Decimal(info['balance']) == Decimal('10')
    assert Decimal(info['withdrawable']) == Decimal('0')
    assert client.post('/api/wallet/withdraw', headers=headers,
                       json={'gram':'1.00','request_id':'unbacked'}).status_code == 409
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO wallet_balances VALUES(42,'testnet','2.00')")
    info = client.get('/api/wallet', headers=headers).json
    assert Decimal(info['withdrawable']) == Decimal('2')
    assert client.post('/api/wallet/withdraw', headers=headers,
                       json={'gram':'1.259','request_id':'not-rounded'}).status_code == 400
    request1 = client.post('/api/wallet/withdraw', headers=headers,
                           json={'gram':'1.25','request_id':'first'})
    assert request1.status_code == 200
    assert client.post('/api/wallet/withdraw', headers=headers,
                       json={'gram':'1.00','request_id':'first'}).status_code == 409
    info = client.get('/api/wallet', headers=headers).json
    assert Decimal(info['withdrawable']) == Decimal('0.75')
    assert Decimal(info['withdraw_daily_remaining']) == Decimal('0.75')
    assert client.post('/api/wallet/withdraw', headers=headers,
                       json={'gram':'1.00','request_id':'over-daily'}).status_code == 409
    # Only queued payouts may be cancelled/refunded.
    assert client.post('/api/wallet/withdraw/' + request1.json['id'] + '/cancel',
                       headers=headers, json={}).status_code == 200
    info = client.get('/api/wallet', headers=headers).json
    assert Decimal(info['withdrawable']) == Decimal('2')
    assert Decimal(info['withdraw_daily_remaining']) == Decimal('2')
    request2 = client.post('/api/wallet/withdraw', headers=headers,
                           json={'gram':'0.50','request_id':'prepared'})
    assert request2.status_code == 200
    prepared = client.post('/api/admin/tonconnect/withdraw/' + request2.json['id'] + '/prepare',
                           headers=headers, json={})
    assert prepared.status_code == 200
    assert client.post('/api/wallet/withdraw/' + request2.json['id'] + '/cancel',
                       headers=headers, json={}).status_code == 409
    info = client.get('/api/wallet', headers=headers).json
    assert Decimal(info['withdrawable']) == Decimal('1.50')


def test_transfer_gifts_atomically_and_record_anonymous_history(client, monkeypatch):
    import telegram_bot
    calls = []
    monkeypatch.setattr(telegram_bot, 'bot_api', lambda _, method, body: calls.append((method, body)))
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://crafter.example')
    sender = signed()
    recipient = signed(43, username='Other_User', photo_url='https://t.me/i/userpic/320/example.jpg')
    client.get('/api/me', headers=sender)
    client.get('/api/me', headers=recipient)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("UPDATE users SET username='Other_User' WHERE id=43")
        db.executemany('INSERT INTO inventory VALUES(42,?,?,?)', [
            ('available', json.dumps({**DEMO_GIFTS[0], 'id':'available'}), 'unlisted'),
            ('listed', json.dumps({**DEMO_GIFTS[0], 'id':'listed'}), 'listed'),
        ])
    lookup = client.get('/api/inventory/recipient?username=other_user', headers=sender)
    assert lookup.json['recipient']['id'] == 43
    assert lookup.json['recipient']['photo_url'] == 'https://t.me/i/userpic/320/example.jpg'
    route = '/api/inventory/transfer'
    body = {'gift_ids':['available','listed'], 'recipient_id':43, 'username':'Other_User', 'anonymous':True,
            'request_id':'same-request', 'message':'<b>Enjoy!</b>'}
    assert client.post(route, headers=sender, json=body).status_code == 409
    assert not calls
    body['gift_ids'] = ['available']
    assert client.post(route, headers=sender, json=body).status_code == 200
    assert client.post(route, headers=sender, json=body).status_code == 200
    assert len(calls) == 1
    assert calls[0][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] == 'https://crafter.example?view=gifts'
    assert calls[0][1]['chat_id'] == 43 and 'anonymous' in calls[0][1]['text']
    assert '&lt;b&gt;Enjoy!&lt;/b&gt;' in calls[0][1]['text']
    assert client.post(route, headers=sender, json={**body, 'message':'Changed'}).status_code == 409
    assert [gift['id'] for gift in client.get('/api/inventory', headers=sender).json['gifts']] == ['listed']
    assert [gift['id'] for gift in client.get('/api/inventory', headers=recipient).json['gifts']] == ['available']
    sent = client.get('/api/history', headers=sender).json['items']
    received = client.get('/api/history', headers=recipient).json['items']
    assert len(sent) == len(received) == 1
    assert sent[0]['kind'] == 'transfer' and sent[0]['data']['recipient']['username'] == 'Other_User'
    assert received[0]['kind'] == 'gift_received' and received[0]['data']['sender'] is None
    assert received[0]['data']['message'] == '<b>Enjoy!</b>'


def test_import_bot_emoji_and_apply_to_greeting_and_button(client, monkeypatch):
    import telegram_bot
    calls = []
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://crafter.example')
    def bot_api(token, method, payload):
        calls.append((method, payload))
        if method == 'getMe':
            return {'id': 123, 'is_bot': True, 'username': 'crafter_bot'}
        if method == 'getStickerSet':
            return {'stickers':[{'custom_emoji_id':'123456789012345678', 'emoji':'💎', 'thumbnail':{'file_id':'preview'}}]}
        return True
    monkeypatch.setattr(telegram_bot, 'bot_api', bot_api)
    route = '/api/admin/telegram-bot'
    result = client.post(route+'/emoji', headers=signed(), json={'value':'https://t.me/addemoji/Gems'})
    assert result.json['emoji_library'] == [{'id':'123456789012345678', 'emoji':'💎'}]
    result = client.post(route, headers=signed(), json={
        'greeting':'<Crafter> [[emoji:123456789012345678]]',
        'buttons':[{'text':'Открыть','type':'web_app','url':'','style':'primary','icon_custom_emoji_id':'123456789012345678'}],
    })
    assert result.status_code == 200
    assert client.post(route+'/connect', headers=signed(), json={}).status_code == 200
    secret = calls[-1][1]['secret_token']
    event = {'update_id':1, 'message':{'chat':{'id':42,'type':'private'}, 'text':'/start'}}
    assert client.post('/api/telegram/webhook/123', json=event, headers={'X-Telegram-Bot-Api-Secret-Token':secret}).status_code == 200
    message = calls[-1][1]
    assert message['text'] == '&lt;Crafter&gt; <tg-emoji emoji-id="123456789012345678">💎</tg-emoji>'
    assert message['parse_mode'] == 'HTML'
    button = message['reply_markup']['inline_keyboard'][0][0]
    assert button['style'] == 'primary' and button['icon_custom_emoji_id'] == '123456789012345678'


def test_portals_backdrop_catalog_uses_colors_and_floor(monkeypatch):
    import portals_public
    monkeypatch.setattr(portals_public, 'get', lambda *_: {
        'collections': [{'backdrops': {'Black': {'floor_price': '10.5',
            'backdrop': {'center_color': 66051, 'edge_color': 1}}}}]
    })
    assert portals_public.backdrops('test') == {
        'Black': {'center_color': 66051, 'edge_color': 1, 'portal_floor':'10.5'}
    }


def test_gift_notification_template_preserves_only_supported_styles(client, monkeypatch):
    import telegram_bot
    messages = []
    monkeypatch.setattr(telegram_bot, 'bot_api', lambda token, method, payload: messages.append(payload))
    route = '/api/admin/telegram-bot'
    data = {'greeting':'Hello', 'buttons':[], 'gift_template':'<b>From {sender}</b>\n<i>{message}</i> <script>',
            'gift_button_text':'Open gifts'}
    assert client.post(route, headers=signed(), json={**data, 'gift_template':'<b><i>Broken</b></i>'}).status_code == 400
    result = client.post(route, headers=signed(), json=data)
    assert result.status_code == 200
    assert result.json['gift_template'] == data['gift_template']
    telegram_bot.notify_gift_transfer(result.json, 43, [DEMO_GIFTS[0]], {'name':'<someone>', 'username':''},
                                      'https://crafter.example', 'test-token', 'A&B')
    assert messages[0]['text'] == '<b>From &lt;someone&gt;</b>\n<i>A&amp;B</i> &lt;script&gt;'
    assert messages[0]['reply_markup']['inline_keyboard'][0][0]['text'] == 'Open gifts'


def test_staking_deposits_telegram_gift_using_cached_floor(client, monkeypatch):
    import thermos

    def unavailable():
        raise OSError('catalog temporarily unavailable')

    monkeypatch.setattr(thermos, 'collections', unavailable)
    gift = dict(DEMO_GIFTS[0], id='telegram-bdaycandle-123', name='B-Day Candle',
                collection_id='bdaycandle', price='0', origin='telegram-deposit')
    catalog = [{'id': '12345', 'name': 'B Day Candle', 'floor_price': '12.5'}]
    headers = signed()
    assert client.post('/api/staking/activate', headers=headers, json={}).status_code == 200

    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (42, ?, ?, 'unlisted')",
                   (gift['id'], json.dumps(gift)))
        db.execute('INSERT INTO cache VALUES (?, ?, ?)',
                   ('thermos:collections', json.dumps(catalog), int(time.time()) - 3600))

    payload = {'gift_ids': [gift['id']]}
    deposit = client.post('/api/staking/deposit', headers=headers, json=payload)
    assert deposit.status_code == 200
    assert deposit.json['total_staked_gram'] == '12.500000'
    assert client.get('/api/inventory', headers=headers).json['gifts'] == []
    assert client.post('/api/staking/deposit', headers=headers, json=payload).status_code == 409
    assert len(client.get('/api/staking', headers=headers).json['gifts']) == 1


def test_production_market_uses_public_listings_with_partner_key(client, monkeypatch):
    import portals_public

    lot = dict(DEMO_GIFTS[0], price_unit='GRAM')
    monkeypatch.setitem(client.application.config, 'PORTALS_API_KEY', 'test-partner')
    monkeypatch.setattr(portals_public, 'listings', lambda *_: {'gifts': [lot], 'source': 'portals'})

    def unexpected_partner_request(*args, **kwargs):
        pytest.fail('Market browsing spent a partner request')

    monkeypatch.setattr('app.urlopen', unexpected_partner_request)
    response = client.get('/api/market', headers=signed())
    assert response.status_code == 200
    assert response.json['gifts'][0]['id'] == lot['id']
