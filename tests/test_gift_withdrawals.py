import json
import sqlite3

from test_app import client, signed


def _deposit_gift(client, uid=43, id='telegram-luckylocket-5469'):
    h = signed(uid)
    assert client.get('/api/me', headers=h).status_code == 200
    gift = {
        'id': id, 'name':'Lucky Locket', 'collection_id':'luckylocket',
        'number':5469, 'source_number':5469, 'origin':'telegram-deposit',
        'telegram_url':'https://t.me/nft/luckylocket-5469',
        'image':'https://nft.fragment.com/gift/luckylocket-5469.webp'
    }
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (?,?,?,'unlisted')",
                   (uid,id,json.dumps(gift)))
        db.execute("INSERT INTO demo_accounts(user_id,balance) VALUES (?,?) "
                   "ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
                   (uid,'1.0'))
    return gift


def test_manual_nft_withdrawals_are_atomic_and_refundable(client):
    gift=_deposit_gift(client)
    user=signed(43)
    admin=signed()
    data={'gift_id':gift['id'],'request_id':'request-1'}
    queued=client.post('/api/gifts/withdraw',headers=user,json=data)
    assert queued.status_code==200,queued.json
    assert queued.json['status']=='queued'
    assert queued.json['fee_gram']=='0.4'
    assert queued.json['mode']=='manual'
    assert client.get('/api/balance',headers=user).json['balance']=='0.6'
    assert client.post('/api/gifts/withdraw',headers=user,json=data).json==queued.json
    pending=client.get('/api/inventory',headers=user).json['gifts'][0]
    assert pending['status']=='withdrawing'
    assert client.post('/api/gifts/withdraw',headers=user,
                       json={'gift_id':gift['id'],'request_id':'request-2'}).status_code==409
    assert client.get('/api/admin/withdrawals',headers=user).status_code==403
    inbox=client.get('/api/admin/withdrawals',headers=admin)
    assert inbox.status_code==200
    assert inbox.json['gifts'][0]['receiver_user_id']==43
    assert inbox.json['gifts'][0]['gift']['number']==5469
    wid=queued.json['id']
    route='/api/admin/withdrawals/gift/'+wid+'/resolve'
    assert client.post(route,headers=admin,json={'decision':'confirmed','note':'x'}).status_code==400
    assert client.post(route,headers=admin,
                       json={'decision':'failed','note':'Relayer transfer unavailable'}).status_code==200
    assert client.get('/api/inventory',headers=user).json['gifts'][0]['status']=='unlisted'
    assert client.get('/api/balance',headers=user).json['balance']=='1.0'
    assert client.post(route,headers=admin,
                       json={'decision':'failed','note':'repeated'}).status_code==409
    assert client.get('/api/wallet/history?types=gift_withdraw_failed',
                      headers=user).json['items'][0]['kind']=='gift_withdraw_failed'
    second=client.post('/api/gifts/withdraw',headers=user,
                       json={'gift_id':gift['id'],'request_id':'request-3'})
    assert second.status_code==200
    assert client.get('/api/balance',headers=user).json['balance']=='0.6'
    response=client.post('/api/admin/withdrawals/gift/'+second.json['id']+'/resolve',
                         headers=admin,json={'decision':'confirmed','note':'Telegram transfer verified #5469'})
    assert response.status_code==200
    assert client.get('/api/inventory',headers=user).json['gifts']==[]
    history=client.get('/api/wallet/history?types=withdraw',headers=user).json['items']
    assert history[0]['data']['gift']['number']==5469
    assert client.post('/api/admin/withdrawals/gift/'+second.json['id']+'/resolve',
                       headers=admin,json={'decision':'confirmed','note':'again-1234'}).status_code==409


def test_nft_withdrawal_rejects_unverified_virtual_prizes(client):
    gift=_deposit_gift(client,id='virtual-model-01')
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        gift['origin']='application-craft'
        db.execute('UPDATE inventory SET payload=? WHERE user_id=? AND nft_id=?',
                   (json.dumps(gift),43,'virtual-model-01'))
    result=client.post('/api/gifts/withdraw',headers=signed(43),
                       json={'gift_id':'virtual-model-01','request_id':'attempt'})
    assert result.status_code==409
    assert client.get('/api/inventory',headers=signed(43)).json['gifts'][0]['status']=='unlisted'


def test_admin_can_read_service_wallet_balance_without_its_private_key(client,monkeypatch):
    import wallet
    admin=signed()
    receiver='0:'+'a'*64
    settings={'enabled':False,'network':'testnet','receiver':receiver,'gram_per_ton':'1'}
    assert client.post('/api/admin/tonconnect',headers=admin,json=settings).status_code==200
    def fake_rpc(network,method,params,key=''):
        assert network=='testnet' and method=='getAddressBalance'
        assert params['address']==receiver
        return '6500000000'
    monkeypatch.setattr(wallet,'rpc',fake_rpc)
    path='/api/admin/tonconnect/receiver/balance'
    assert client.get(path,headers=signed(43)).status_code==403
    result=client.get(path,headers=admin)
    assert result.status_code==200
    assert result.json['balance_ton']=='6.500000000'


def test_player_sees_status_reason_and_gets_a_message(client, monkeypatch):
    sent = []
    monkeypatch.setattr('telegram_bot.bot_api', lambda token, method, payload, sticker=None: sent.append((method, payload)) or True)
    gift = _deposit_gift(client)
    user, admin = signed(43), signed()
    wid = client.post('/api/gifts/withdraw', headers=user, json={'gift_id': gift['id'], 'request_id': 'request-9'}).json['id']
    mine, = client.get('/api/gifts/withdrawals', headers=user).json['items']
    assert mine['gift_id'] == gift['id'] and mine['status'] == 'queued' and 'администратором' in mine['text'] and mine['reason'] == ''
    assert client.get('/api/admin/withdrawals', headers=admin).json['gifts'][0]['auto'] is None
    route = '/api/admin/withdrawals/gift/' + wid + '/resolve'
    assert client.post(route, headers=admin, json={'decision': 'failed', 'note': ''}).status_code == 400       # the reason is required
    assert client.post(route, headers=admin, json={'decision': 'failed', 'note': 'Подарок недоступен на релейере'}).status_code == 200
    mine, = client.get('/api/gifts/withdrawals', headers=user).json['items']
    assert mine['status'] == 'failed' and mine['reason'] == 'Подарок недоступен на релейере' and 'возвращён' in mine['text']
    message = [p for m, p in sent if m == 'sendMessage' and p['chat_id'] == 43]
    assert message and 'Причина: Подарок недоступен на релейере' in message[-1]['text']
    history = client.get('/api/wallet/history?types=gift_withdraw_failed', headers=user).json['items'][0]
    assert history['data']['reason'] == 'Подарок недоступен на релейере'
