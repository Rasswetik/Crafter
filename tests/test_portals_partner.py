"""Portals: secure key handling and fake-wire checkout; no real API calls."""
import io
import json
import os
import sqlite3
import time
from cryptography.fernet import Fernet
from app import create_app
from test_app import signed

NFT = "147ae6ab-4d7d-4085-94db-87181b8e3919"

class FakeResponse:
    def __init__(self, result):
        self.result = result
    def __enter__(self):
        return io.BytesIO(json.dumps(self.result).encode())
    def __exit__(self, *args):
        return None

def make_partner(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAFTER_PORTALS_FERNET_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("CRAFTER_PORTALS_LIVE_PURCHASES", "1")
    monkeypatch.delenv("PORTALS_API_KEY", raising=False)
    app = create_app({"TESTING":True,"DATABASE":str(tmp_path / "portal.db"),
                      "BOT_TOKEN":"test-token","ADMIN_IDS":{42},"DEMO_MODE":False})
    client = app.test_client()
    client.get("/api/me", headers=signed())
    # The configured backend in production must be actual PostgreSQL. In
    # this isolated test only, flip the guard while retaining SQLite fixture.
    app.config["DATABASE_URL"] = "postgresql://isolated-test"
    return client

def save_key(client):
    key = "test_portals_partner_api_token_only"
    response = client.post("/api/admin/portal/partner/key",
        headers=signed(), json={"key":key})
    assert response.status_code == 200, response.json
    assert response.json["key_configured"] is True
    assert key not in json.dumps(response.json)
    with sqlite3.connect(client.application.config["DATABASE"]) as db:
        row = db.execute("SELECT encrypted_key FROM portals_partner_credentials WHERE id=1").fetchone()
        assert key not in row[0]
    return key

def test_partner_key_requires_admin_and_masks_secret(tmp_path,monkeypatch):
    client=make_partner(tmp_path,monkeypatch)
    assert client.get("/api/admin/portal/partner",headers=signed(43)).status_code==403
    assert client.post("/api/admin/portal/partner/key",headers=signed(43),
       json={"key":"unauthorized_partner_token"}).status_code==403
    key=save_key(client)
    info=client.get("/api/admin/portal/partner",headers=signed()).json
    assert key not in json.dumps(info)
    assert info["partner_limit_rps"]==1
    assert info["public_catalog_without_key"] is True

def test_partner_checkout_is_real_idempotent_and_partially_reconciled(tmp_path,monkeypatch):
    client=make_partner(tmp_path,monkeypatch)
    import portals_public  # work-mode availability check: Portals still lists the lot at the same price
    monkeypatch.setattr(portals_public,'listings',lambda *a,**k:{'gifts':[{'id':NFT,'price':'4.25'}]})
    key=save_key(client)
    seen=[]
    def fake_wire(req,timeout=None):
        seen.append(req)
        assert req.get_header("Authorization") == "partners " + key
        if req.full_url.endswith("/partners/users/wallets/"):
            return FakeResponse({"balance":"25","frozen_funds":"0"})
        assert req.full_url.endswith("/partners/nfts")
        assert json.loads(req.data)["nft_details"]==[{"id":NFT,"price":"4.25"}]
        return FakeResponse({"purchase_results":[{"id":NFT,"status":"success","price":"4.25"}],
                             "total_purchased":1,"total_spent":"4.25"})
    monkeypatch.setattr("portals_partner.urlopen",fake_wire)
    # Live checkout remains fail-closed until an administrator verifies the
    # real partner connection and explicitly enables purchases.
    pre=client.post("/api/portals/buy",headers=signed(),
       json={"gift_ids":[NFT],"request_id":"preflight","expected_total":"4.25"})
    assert pre.status_code==409
    checked=client.post("/api/admin/portal/partner/check",headers=signed(),json={})
    assert checked.status_code==200, checked.json
    unlocked=client.post("/api/admin/portal/partner/activate",headers=signed(),
       json={"enabled":True,"confirmation":"ВКЛЮЧИТЬ РЕАЛЬНЫЕ ПОКУПКИ"})
    assert unlocked.status_code==200 and unlocked.json["live_purchases"] is True
    with sqlite3.connect(client.application.config["DATABASE"]) as db:
        db.execute("UPDATE demo_accounts SET balance='20' WHERE user_id=42")
        db.execute("INSERT INTO cache VALUES (?,?,?)", (
            "public:market:sort=latest",
            json.dumps({"source":"portals","price_unit":"GRAM",
             "gifts":[{"id":NFT,"name":"Test Real NFT","price":"4.25",
                       "price_unit":"GRAM","number":77,"image":"/static/assets/snoop.webp"}]}),
            int(time.time())))
    order={"gift_ids":[NFT],"request_id":"first-portal-buy","expected_total":"4.25"}
    first=client.post("/api/portals/buy",headers=signed(),json=order)
    assert first.status_code==200, first.json
    assert first.json["total"]=="4.25"
    assert first.json["gifts"][0]["origin"]=="portals-partner"
    assert first.json["gifts"][0]["id"]==NFT
    second=client.post("/api/portals/buy",headers=signed(),json=order)
    assert second.status_code==200 and second.json["order_id"]==first.json["order_id"]
    assert len([req for req in seen if req.full_url.endswith("/partners/nfts")])==1
    with sqlite3.connect(client.application.config["DATABASE"]) as db:
        assert db.execute("SELECT balance FROM demo_accounts WHERE user_id=42").fetchone()[0]=="15.75"
        assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id=42 AND nft_id=?",(NFT,)).fetchone()[0]==1

def test_partner_checkout_refuses_stale_without_outgoing_request(tmp_path,monkeypatch):
    client=make_partner(tmp_path,monkeypatch)
    save_key(client)
    monkeypatch.setattr("portals_partner.urlopen",lambda *args,**kwargs: (_ for _ in ()).throw(AssertionError("wire called")))
    with sqlite3.connect(client.application.config["DATABASE"]) as db:
        db.execute("UPDATE demo_accounts SET balance='20' WHERE user_id=42")
    order={"gift_ids":[NFT],"request_id":"not-in-cache","expected_total":"4.25"}
    assert client.post("/api/portals/buy",headers=signed(),json=order).status_code==409


def test_partner_nft_withdrawal_missing_custody_routes_to_manual_without_transfer(tmp_path,monkeypatch):
    client=make_partner(tmp_path,monkeypatch)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (?,?,?,'unlisted')",
            (42,NFT,json.dumps({"id":NFT,"name":"Lucky Locket",
               "origin":"portals-partner","catalog_only":False})))
        db.execute("UPDATE demo_accounts SET balance='2.0' WHERE user_id=42")
    result=client.post('/api/portals/withdraw',headers=signed(),json={
        'gift_id':NFT,'request_id':'unavailable-custody'})
    assert result.status_code==200,result.json
    assert result.json['mode']=='manual' and result.json['fee_gram']=='0.4'
    assert client.get('/api/balance',headers=signed()).json['balance']=='1.6'
    assert client.post('/api/portals/withdraw',headers=signed(),json={
        'gift_id':NFT,'request_id':'unavailable-custody'}).json==result.json
    queue=client.get('/api/admin/withdrawals/nft',headers=signed()).json['gifts']
    assert len(queue)==1 and queue[0]['gift']['id']==NFT
    failed=client.post('/api/admin/withdrawals/gift/'+queue[0]['id']+'/resolve',
        headers=signed(),json={'decision':'failed','note':'Portals custody not confirmed'})
    assert failed.status_code==200
    assert client.get('/api/balance',headers=signed()).json['balance']=='2.0'


def test_partner_withdrawal_checks_exact_owned_nft_and_refunds_errored_transfer(tmp_path,monkeypatch):
    client=make_partner(tmp_path,monkeypatch)
    key=save_key(client)
    with sqlite3.connect(client.application.config['DATABASE']) as db:
        db.execute("INSERT INTO inventory VALUES (?,?,?,'unlisted')",
            (42,NFT,json.dumps({"id":NFT,"name":"Lucky Locket","origin":"portals-partner"})))
        db.execute("UPDATE demo_accounts SET balance='2.0' WHERE user_id=42")
    called=[]
    def fake_wire(req,timeout=None):
        assert req.get_header('Authorization')=='partners '+key
        called.append(req.full_url)
        if '/partners/nfts/owned?' in req.full_url:
            assert 'ids=' in req.full_url
            return FakeResponse({'nfts':[{'id':NFT}]})
        if req.full_url.endswith('/partners/nfts/withdraw'):
            body=json.loads(req.data)
            assert body=={'gift_ids':[NFT],'recipient_id':42,'unsafe_transfer':False}
            return FakeResponse({'withdrawals_ids':[111]})
        if '/partners/nfts/withdrawals/statuses?' in req.full_url:
            return FakeResponse({'statuses':[{'id':111,'status':'errored'}]})
        raise AssertionError(req.full_url)
    monkeypatch.setattr("portals_partner.urlopen",fake_wire)
    data={'gift_id':NFT,'request_id':'partner-withdraw-test'}
    created=client.post('/api/portals/withdraw',headers=signed(),json=data)
    assert created.status_code==200,created.json
    assert created.json['mode']=='portals' and created.json['status']=='pending'
    assert client.get('/api/balance',headers=signed()).json['balance']=='1.6'
    assert client.post('/api/portals/withdraw',headers=signed(),json=data).json['status']=='pending'
    assert len([url for url in called if url.endswith('/partners/nfts/withdraw')])==1
    check=client.post('/api/portals/withdraw/check',headers=signed(),
                      json={'request_id':'partner-withdraw-test'})
    assert check.status_code==200,check.json
    assert check.json['status']=='errored'
    assert client.get('/api/balance',headers=signed()).json['balance']=='2.0'
    assert client.get('/api/inventory',headers=signed()).json['gifts'][0]['status']=='unlisted'
