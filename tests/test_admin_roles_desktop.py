"""Admin grants, desktop view, snow and winter maintenance regressions."""
import json
import sqlite3
from pathlib import Path
from test_app import client, signed
from app import create_app


def test_primary_admin_grants_section_only_rights_and_revokes(client):
    owner, delegate, other=signed(42),signed(43),signed(44)
    assert client.get('/api/me',headers=other).status_code==200
    assert client.get('/api/me',headers=delegate).status_code==200
    me=client.get('/api/me',headers=owner).json
    assert me['is_primary_admin'] is True
    assert me['admin_permissions']==['*']
    assert client.get('/api/admin/admins',headers=delegate).status_code==403
    granted=client.post('/api/admin/admins',headers=owner,json={
        'user_id':43,'role':'sections','permissions':['maintenance']})
    assert granted.status_code==200,granted.json
    person=client.get('/api/me',headers=delegate).json
    assert person['is_admin'] is True
    assert person['is_primary_admin'] is False
    assert person['admin_permissions']==['maintenance']
    assert client.get('/api/admin/maintenance',headers=delegate).status_code==200
    for path in ('/api/admin/finance','/api/admin/admins','/api/admin/users',
                 '/api/admin/withdrawals','/api/admin/tonconnect/auto',
                 '/api/admin/withdrawals/nft','/api/admin/withdrawals/ton'):
        assert client.get(path,headers=delegate).status_code==403,path
    assert client.post('/api/admin/maintenance',headers=delegate,json={
        'enabled':False,'confirm':'DISABLE_MAINTENANCE'}).status_code==200
    assert client.post('/api/admin/admins',headers=delegate,json={
        'user_id':44,'role':'full'}).status_code==403
    assert client.post('/api/admin/admins',headers=owner,json={
        'user_id':42,'role':'sections','permissions':['maintenance']}).status_code==403
    revoked=client.post('/api/admin/admins/43/revoke',headers=owner,json={})
    assert revoked.status_code==200,revoked.json
    assert client.get('/api/me',headers=delegate).json['is_admin'] is False
    assert client.get('/api/admin/maintenance',headers=delegate).status_code==403
    assert client.get('/api/admin/admins',headers=owner).status_code==200


def test_full_admin_cannot_manage_other_admins(client):
    owner,person=signed(42),signed(43)
    client.get('/api/me',headers=person)
    r=client.post('/api/admin/admins',headers=owner,json={
        'user_id':43,'role':'full','permissions':[]})
    assert r.status_code==200,r.json
    assert client.get('/api/admin/finance',headers=person).status_code==200
    assert client.get('/api/admin/admins',headers=person).status_code==403
    assert client.post('/api/admin/admins/42/revoke',headers=person,json={}).status_code==403


def test_role_grants_validate_identity_and_prevent_invalid_permissions(client):
    a=signed(42)
    assert client.post('/api/admin/admins',headers=a,json={
        'user_id':4449999,'role':'full'}).status_code==404
    client.get('/api/me',headers=signed(43))
    for data in (
        {'user_id':43,'role':'sections','permissions':[]},
        {'user_id':43,'role':'sections','permissions':['finance','finance']},
        {'user_id':43,'role':'sections','permissions':['database']},
        {'user_id':43,'role':'primary','permissions':['*']},
    ):
        assert client.post('/api/admin/admins',headers=a,json=data).status_code==400,data
    assert client.get('/api/admin/admins',headers=signed(42,token='wrong')).status_code==401


def test_multi_static_admin_requires_explicit_primary_config(tmp_path):
    cfg={'TESTING':True,'DATABASE':str(tmp_path/'multi.db'),
         'BOT_TOKEN':'test-token','ADMIN_IDS':{42,44},'DEMO_MODE':False}
    client=create_app(cfg).test_client()
    assert client.get('/api/me',headers=signed(42)).json['is_primary_admin'] is False
    assert client.get('/api/admin/admins',headers=signed(42)).status_code==403
    cfg['PRIMARY_ADMIN_ID']='42'
    cl=create_app({**cfg,'DATABASE':str(tmp_path/'explicit.db')}).test_client()
    assert cl.get('/api/me',headers=signed(42)).json['is_primary_admin'] is True
    assert cl.get('/api/me',headers=signed(44)).json['is_primary_admin'] is False


def test_winter_restore_and_administrator_can_still_turn_snow_off(client):
    initial=client.get('/api/site/snow').json
    assert initial['enabled'] is True
    assert client.post('/api/admin/site/snow',headers=signed(42),json={
        'enabled':False,'density':'normal','speed':'normal','size':'normal'
    }).status_code==200
    assert client.get('/api/site/snow').json['enabled'] is False


def test_desktop_and_maintenance_are_real_code_not_static_mockups():
    root=Path(__file__).resolve().parent.parent
    desktop=(root/'static/desktop-nav.js').read_text(encoding='utf-8')
    css=(root/'static/desktop-nav.css').read_text(encoding='utf-8')
    splash=(root/'static/desktop-splash.css').read_text(encoding='utf-8')
    overlay=(root/'static/site-maintenance.css').read_text(encoding='utf-8')
    page=(root/'templates/index.html').read_text(encoding='utf-8')
    admin=(root/'static/admin-page.js').read_text(encoding='utf-8')
    assert 'crafterDesktopNavRefresh' in desktop and "go('profile')" in desktop
    assert 'crafter-desktop-sidebar' in css and 'repeat(11,minmax(0,1fr))' in css
    assert 'min-aspect-ratio:16/9' in splash and 'max-height:680px' in splash
    assert 'crafter-maintenance-snow' in overlay and 'crafter-top-canopy.svg' in overlay
    assert 'desktop-nav.js' in page and 'skeleton-responsive.css' in page
    assert "window.scrollTo({top:0" not in admin
    assert 'savedNavScroll' in admin
