"""The automatic payout engine must fail closed without a dedicated hot wallet."""
import json
import os
import time
import sqlite3
from decimal import Decimal

from test_app import client, signed


def test_auto_withdraw_disabled_and_admin_only(client):
    assert client.get('/api/me', headers=signed(42)).status_code == 200
    admin = signed(42)
    path = '/api/admin/tonconnect/auto'
    assert client.get(path, headers=signed(43)).status_code == 403
    info = client.get(path, headers=admin)
    assert info.status_code == 200
    assert info.json['policy']['enabled'] is False
    assert info.json['policy']['max_ton'] == '0.25'
    assert info.json['payouts'] == []
    assert client.application.extensions['crafter_auto_payout']()['status'] == 'blocked'
    assert client.post(path, headers=admin,json={
        'enabled': True, 'max_ton': '0.25',
        'daily_ton': '1', 'reserve_ton': '0.5'
    }).status_code == 409


def test_auto_policy_limits_and_explicit_db_requirement(client):
    client.get('/api/me', headers=signed(42))
    original=client.application.config['DATABASE_URL']
    # Test only: DB remains the isolated test SQLite connection; we simulate
    # presence of a shared durable store for policy validation.
    client.application.config['DATABASE_URL']='postgresql://test-only'
    try:
        api='/api/admin/tonconnect/auto'
        assert client.post(api, headers=signed(42),json={
            'enabled':True,'max_ton':'1.01','daily_ton':'1','reserve_ton':'0.5'
        }).status_code == 400
        assert client.post(api, headers=signed(42),json={
            'enabled':True,'max_ton':'0','daily_ton':'1','reserve_ton':'0.5'
        }).status_code == 400
        saved=client.post(api, headers=signed(42),json={
            'enabled':True,'max_ton':'0.1','daily_ton':'1','reserve_ton':'0.5',
            'payout_address':'0:'+'5'*64
        })
        assert saved.status_code == 200, saved.json
        assert saved.json['policy']['enabled'] is True
        assert client.get(api, headers=signed(42)).json['policy']['max_ton'] == '0.1'
        disabled=client.post(api, headers=signed(42),json={
            'enabled':False,'max_ton':'0.1','daily_ton':'1','reserve_ton':'0.5'
        })
        assert disabled.status_code == 200
    finally:
        client.application.config['DATABASE_URL']=original


def test_withdrawals_queue_auto_only_after_policy_enabled(client, monkeypatch):
    import wallet
    admin=signed(42)
    client.get('/api/me',headers=admin)
    with sqlite3.connect(client.application.config['DATABASE']) as testdb:
        testdb.execute("UPDATE demo_accounts SET balance='20' WHERE user_id=42")
    sender='0:'+'1'*64
    receiver='0:'+'2'*64
    monkeypatch.setattr(wallet, 'rpc',
       lambda network, method, params, key: '10000000000')
    assert client.post('/api/admin/tonconnect',headers=admin,json={
        'enabled':True,'withdraw_enabled':True,'network':'testnet',
        'receiver':sender,'gram_per_ton':'1','withdraw_daily':'30',
        'withdraw_max':'20'
    }).status_code == 200
    assert client.post('/api/wallet/connect',headers=admin,json={
        'address':receiver,'network':'testnet'
    }).status_code == 200
    first=client.post('/api/wallet/withdraw',headers=admin,json={
        'request_id':'manual-original','gram':'1'
    })
    assert first.status_code == 200,first.json
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        p=json.loads(db.execute('SELECT payload FROM ton_withdrawals WHERE id=?',
                                (first.json['id'],)).fetchone()[0])
        assert p['auto_eligible'] is False
    original=client.application.config['DATABASE_URL']
    client.application.config['DATABASE_URL']='postgresql://test-only'
    try:
        assert client.post('/api/admin/tonconnect/auto',headers=admin,json={
          'enabled':True,'max_ton':'1','daily_ton':'3','reserve_ton':'0.5',
          'payout_address':sender
        }).status_code == 200
        second=client.post('/api/wallet/withdraw',headers=admin,json={
            'request_id':'autopayout-new','gram':'1'
        })
        assert second.status_code == 200,second.json
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            p=json.loads(db.execute('SELECT payload FROM ton_withdrawals WHERE id=?',
                                    (second.json['id'],)).fetchone()[0])
            assert p['auto_eligible'] is True
        # No signer is configured: worker refuses, without moving the request.
        for name in ('CRAFTER_PAYOUT_MNEMONIC','CRAFTER_PAYOUT_EXECUTE'):
            monkeypatch.delenv(name,raising=False)
        try:
            with client.application.app_context():
                client.application.extensions['crafter_auto_payout']()
        except RuntimeError as ex:
            assert 'not armed' in str(ex)
        else:
            raise AssertionError('Unarmed payout worker was allowed to run')
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            assert db.execute('SELECT status FROM ton_withdrawals WHERE id=?',
                (second.json['id'],)).fetchone()[0] == 'queued'
            assert db.execute('SELECT COUNT(*) FROM ton_auto_payouts').fetchone()[0] == 0
    finally:
        client.application.config['DATABASE_URL']=original


def test_auto_payout_wizard_preflight_is_read_only_and_validates_address(client, monkeypatch):
    import wallet
    admin=signed(42)
    client.get('/api/me',headers=admin)
    assert client.get('/api/admin/tonconnect/auto/preflight',headers=signed(43)).status_code==403
    initial=client.get('/api/admin/tonconnect/auto/preflight',headers=admin)
    assert initial.status_code==200
    assert initial.json['ready'] is False
    assert initial.json['balance_ton'] is None
    original=client.application.config['DATABASE_URL']
    client.application.config['DATABASE_URL']='postgresql://test-only'
    source='0:'+'7'*64
    another='0:'+'8'*64
    try:
        invalid=client.post('/api/admin/tonconnect/auto',headers=admin,json={
            'enabled':False,'payout_address':'not-a-ton-address',
            'max_ton':'0.2','daily_ton':'1','reserve_ton':'0.5'
        })
        assert invalid.status_code==400
        save=client.post('/api/admin/tonconnect/auto',headers=admin,json={
            'enabled':False,'payout_address':source,
            'max_ton':'0.2','daily_ton':'1','reserve_ton':'0.5'
        })
        assert save.status_code==200,save.json
        assert save.json['policy']['payout_address']==source
        assert client.post('/api/admin/tonconnect',headers=admin,json={
            'enabled':True,'withdraw_enabled':True,'network':'testnet',
            'receiver':'0:'+'1'*64
        }).status_code==200
        calls=[]
        def rpc_stub(network,method,params,key):
            calls.append(method)
            assert method=='getWalletInformation'
            assert params['address']==source
            return {'wallet':True,'wallet_type':'wallet v4 r2','balance':'700000000',
                    'seqno':0}
        monkeypatch.setattr(wallet,'rpc',rpc_stub)
        checked=client.get('/api/admin/tonconnect/auto/preflight',headers=admin)
        assert checked.status_code==200,checked.json
        assert checked.json['balance_ton']=='0.7'
        assert checked.json['wallet_v4r2'] is True
        assert checked.json['balance_ok'] is True
        assert checked.json['worker']['ready'] is False
        assert checked.json['ready'] is False
        assert calls==['getWalletInformation']
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            db.execute('''INSERT INTO ton_auto_worker_health
                (singleton,checked_at,ready,network,address,state)
                VALUES(1,?,?,?,?,?)''',(int(time.time()),1,'testnet',source,'configured'))
        checked=client.get('/api/admin/tonconnect/auto/preflight',headers=admin)
        assert checked.json['ready'] is True
        with sqlite3.connect(client.application.config['DATABASE']) as db:
            db.execute('''INSERT INTO ton_auto_payouts
                (withdrawal_id,status,signed_boc,seqno,sender,created,updated,confirmed_tx)
                VALUES('test-outstanding','review','mock-only',1,?,1,1,NULL)''',(source,))
        blocked=client.post('/api/admin/tonconnect/auto',headers=admin,json={
            'enabled':False,'payout_address':another,
            'max_ton':'0.2','daily_ton':'1','reserve_ton':'0.5'
        })
        assert blocked.status_code==409
        blocked_preflight=client.get('/api/admin/tonconnect/auto/preflight',headers=admin)
        assert blocked_preflight.json['unsettled']==1
        assert blocked_preflight.json['ready'] is False
    finally:
        client.application.config['DATABASE_URL']=original
