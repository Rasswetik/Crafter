"""End-to-end offline simulation of auto TON payout signing and reconciliation."""
import json
import sqlite3
import time
from decimal import Decimal

from test_app import client, signed


def test_automatic_payout_broadcasts_once_and_waits_for_chain(client, monkeypatch):
    import auto_payout
    import wallet as wallet_module
    from tonsdk.contract.wallet import Wallets

    user_id=42
    hot='0:'+'3'*64
    receiver='0:'+'2'*64
    deposit='0:'+'1'*64
    headers=signed(user_id)
    assert client.get('/api/me',headers=headers).status_code == 200
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("UPDATE demo_accounts SET balance='10' WHERE user_id=42")

    assert client.post('/api/admin/tonconnect',headers=headers,json={
        'network':'testnet','receiver':deposit,
        'enabled':True,'withdraw_enabled':True,'gram_per_ton':'1',
        'withdraw_max':'20','withdraw_daily':'20'
    }).status_code == 200
    assert client.post('/api/wallet/connect',headers=headers,
                       json={'address':receiver,'network':'testnet'}).status_code == 200
    original=client.application.config['DATABASE_URL']
    client.application.config['DATABASE_URL']='postgresql://test-only'

    class FakeMessage:
        def to_boc(self, state_init=False):
            return b'fake-signed-once'

    class FakeWallet:
        class address:
            @staticmethod
            def to_string(test_only=False):
                return hot
        def create_transfer_message(self, **kwargs):
            assert kwargs['to_addr'] == receiver
            assert kwargs['amount'] == 1000000000
            assert kwargs['seqno'] == 7
            assert kwargs['send_mode'] == 3
            assert kwargs['payload'].startswith('crafter-withdraw:')
            return {'message':FakeMessage()}

    monkeypatch.setattr(Wallets,'from_mnemonics',
                        staticmethod(lambda mnemonic,version: (mnemonic,b'',b'',FakeWallet())))
    monkeypatch.setenv('CRAFTER_PAYOUT_EXECUTE','1')
    monkeypatch.setenv('CRAFTER_PAYOUT_NETWORK','testnet')
    monkeypatch.setenv('CRAFTER_PAYOUT_ADDRESS',hot)
    monkeypatch.setenv('CRAFTER_PAYOUT_MNEMONIC',' '.join(['dummy']*24))

    chain=[]
    def fake_rpc(network,method,params,key):
        assert network == 'testnet'
        if method=='getWalletInformation':
            return {'wallet':True,'wallet_type':'wallet v4 r2','seqno':7,
                    'balance':'5000000000'}
        if method=='getTransactions':
            return chain
        raise AssertionError(method)

    monkeypatch.setattr(wallet_module,'rpc',fake_rpc)
    broadcast=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def read(self):return b'{"ok":true}'
    # urllib json.load uses the response.read() stream.
    monkeypatch.setattr(auto_payout,'urlopen',
                        lambda req,timeout=12:(broadcast.append(req) or Response()))
    try:
        res=client.post('/api/admin/tonconnect/auto',headers=headers,json={
            'enabled':True,'max_ton':'1','daily_ton':'2','reserve_ton':'0.5'
        })
        assert res.status_code == 200,res.json
        request=client.post('/api/wallet/withdraw',headers=headers,json={
            'gram':'1','request_id':'auto-simulated'})
        assert request.status_code == 200,request.json
        wid=request.json['id']
        with client.application.app_context():
            run=client.application.extensions['crafter_auto_payout']
            first=run()
            assert first=={'status':'broadcast','id':wid}
            assert len(broadcast)==1
            second=run()
            assert second=={'status':'awaiting_chain','id':wid}
            assert len(broadcast)==1
            with sqlite3.connect(client.application.config['DATABASE']) as db:
                p=json.loads(db.execute('SELECT payload FROM ton_withdrawals WHERE id=?',
                                        (wid,)).fetchone()[0])
            chain.append({
                'transaction_id':{'hash':'b'*64},
                'utime':int(time.time()),
                'in_msg':{'source':hot,'destination':receiver,'value':p['nano'],
                          'message':p['memo']}
            })
            third=run()
            assert third=={'status':'confirmed','id':wid}
            assert len(broadcast)==1
            assert run()=={'status':'idle'}
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            assert db.execute('SELECT status FROM ton_withdrawals WHERE id=?',
                              (wid,)).fetchone()[0]=='confirmed'
            assert db.execute('SELECT status FROM ton_auto_payouts WHERE withdrawal_id=?',
                              (wid,)).fetchone()[0]=='confirmed'
            assert Decimal(db.execute('SELECT balance FROM demo_accounts WHERE user_id=?',
                                      (user_id,)).fetchone()[0])==Decimal('9')
    finally:
        client.application.config['DATABASE_URL']=original
