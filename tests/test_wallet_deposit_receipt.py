"""Confirmed GRAM deposit Telegram receipts must contain the real Tonscan tx link."""
import base64
import time
from decimal import Decimal
from test_app import signed, client


def test_tonscan_link_normalizes_ton_center_hashes():
    from telegram_bot import ton_transaction_link
    digest = bytes.fromhex('50b76b157f04cca338ba812dd212c5ee9529512e8f5b1a2cef0b89bddc8f30f5')
    expected = digest.hex()
    for value in (digest.hex(),digest.hex().upper(),
                  base64.b64encode(digest).decode(),
                  base64.urlsafe_b64encode(digest).decode()):
        assert ton_transaction_link(value,'mainnet') == 'https://tonscan.org/tx/' + expected
        assert ton_transaction_link(value,'testnet') == 'https://testnet.tonscan.org/tx/' + expected
    for value in ('fake-hash','', 'unsafe/redirect', 'ab'*20):
        assert ton_transaction_link(value,'mainnet') is None
    assert ton_transaction_link(digest.hex(),'invalid-network') is None


def test_telegram_receipt_has_exact_verified_amount_and_transaction(client,monkeypatch):
    import telegram_bot
    import wallet
    from tonsdk.utils import Address
    source='0:'+'1'*64
    receiver='0:'+'2'*64
    headers=signed()
    assert client.get('/api/me',headers=headers).status_code == 200
    settings={'enabled':True,'network':'testnet','receiver':receiver,
              'gram_per_ton':'2','min_deposit':'0.1','max_deposit':'50'}
    assert client.post('/api/admin/tonconnect',headers=headers,json=settings).status_code==200
    assert client.post('/api/wallet/connect',headers=headers,json={'address':source,'network':'testnet'}).status_code==200
    send=[]
    monkeypatch.setattr(telegram_bot,'bot_api',
        lambda token,method,payload: send.append((token,method,payload)) or True)
    transactions=[]
    def rpc(network,method,params,key):
        if method=='getAddressBalance':return '9999999999'
        assert method=='getTransactions' and network=='testnet'
        return transactions
    monkeypatch.setattr(wallet,'rpc',rpc)
    created=client.post('/api/wallet/deposit',headers=headers,json={'gram':'1.00','sender':source})
    assert created.status_code==200,created.json
    did=created.json['id']
    check='/api/wallet/deposit/'+did+'/check'
    assert client.post(check,headers=headers,json={}).json=={'status':'pending'}
    assert send==[]
    digest=bytes.fromhex('50b76b157f04cca338ba812dd212c5ee9529512e8f5b1a2cef0b89bddc8f30f5')
    tx_hash=base64.b64encode(digest).decode()
    transactions.append({'transaction_id':{'hash':tx_hash},'utime':int(time.time()),
        'in_msg':{'destination':receiver,'source':source,'value':'500000000',
                  'message':'crafter:'+did}})
    credited=client.post(check,headers=headers,json={})
    assert credited.status_code==200,credited.json
    assert credited.json['status']=='confirmed'
    assert Decimal(credited.json['balance']) >= Decimal('1')
    assert len(send)==1
    token,method,payload=send[0]
    assert method=='sendMessage'
    assert payload['chat_id']==42
    assert payload['text']==(
       '💸Баланс обновлен\n\n'
       '⬆️Депозит: 1 GRAM успешно зачислено\n\n'
       '🔎 Посмотреть транзакцию\n\n'
       'https://testnet.tonscan.org/tx/'+digest.hex())
    assert payload['link_preview_options']=={'is_disabled':True}
    assert client.post(check,headers=headers,json={}).json=={'status':'confirmed'}
    assert len(send)==1


def test_failed_telegram_delivery_does_not_undo_credit(client,monkeypatch):
    import telegram_bot, wallet
    source='0:'+'4'*64
    receiver='0:'+'5'*64
    headers=signed()
    client.get('/api/me',headers=headers)
    client.post('/api/admin/tonconnect',headers=headers,json={
      'enabled':True,'network':'testnet','receiver':receiver,'gram_per_ton':'1'})
    client.post('/api/wallet/connect',headers=headers,json={'address':source,'network':'testnet'})
    deposited=client.post('/api/wallet/deposit',headers=headers,json={'gram':'1','sender':source}).json
    calls=[]
    def mock_api(token,method,payload):
        calls.append(payload)
        if len(calls)==1:raise RuntimeError('Telegram temporarily unavailable')
        return True
    monkeypatch.setattr(telegram_bot,'bot_api',mock_api)
    digest=bytes.fromhex('a3'*32)
    transactions=[{'in_msg':{'source':source,'destination':receiver,'value':'1000000000',
                              'message':'crafter:'+deposited['id']},
                   'transaction_id':{'hash':base64.b64encode(digest).decode()},
                   'utime':int(time.time())}]
    monkeypatch.setattr(wallet,'rpc',lambda network,method,params,key:transactions)
    check='/api/wallet/deposit/'+deposited['id']+'/check'
    assert client.post(check,headers=headers,json={}).json['status']=='confirmed'
    balance=Decimal(client.get('/api/wallet',headers=headers).json['balance'])
    assert len(calls)==1
    assert client.post(check,headers=headers,json={}).json=={'status':'confirmed'}
    assert len(calls)==2
    assert Decimal(client.get('/api/wallet',headers=headers).json['balance'])==balance
    assert client.post(check,headers=headers,json={}).json=={'status':'confirmed'}
    assert len(calls)==2
