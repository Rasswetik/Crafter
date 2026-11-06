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
