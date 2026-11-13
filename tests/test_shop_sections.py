import json
import sqlite3
import struct
import zlib

from test_app import client, signed

PNG = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0) + b'\x00' * 4


def upload(client, body, name='x.png', who=42):
    import io
    return client.post('/api/admin/new-year/shop-media', headers=signed(who), data={'file': (io.BytesIO(body), name)},
                       content_type='multipart/form-data')


def test_default_sections_exist_and_can_be_restyled(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    sections = client.get('/api/shop-items', headers=admin).json['sections']
    assert [s['id'] for s in sections] == ['featured', 'packs', 'bundles', 'res', 'rewards', 'gifts']
    assert all(s['kind'] == 'smart' for s in sections)
    saved = client.post('/api/admin/new-year/shop-sections', headers=admin,
                        json={'id': 'packs', 'title': 'Все паки', 'icon': 'builtin:tree', 'bg': 'aurora', 'enabled': True})
    assert saved.status_code == 200
    packs = next(s for s in client.get('/api/shop-items', headers=admin).json['sections'] if s['id'] == 'packs')
    assert (packs['title'], packs['icon'], packs['bg']) == ('Все паки', 'builtin:tree', 'aurora')
    assert client.post('/api/admin/new-year/shop-sections/packs/delete', headers=admin).status_code == 409        # built-in


def test_custom_section_with_pictures_and_offers(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    icon = upload(client, PNG).json
    preview = upload(client, PNG).json
    assert icon['url'].startswith('/media/shop/') and icon['mime'] == 'image/png'
    got = client.get(icon['url'])
    assert got.status_code == 200 and got.mimetype == 'image/png' and got.data == PNG
    section = client.post('/api/admin/new-year/shop-sections', headers=admin,
                          json={'title': '  Новый   год ', 'icon': icon['url'], 'preview': preview['url'], 'bg': 'image:' + preview['url'], 'enabled': True}).json['id']
    item = client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'GRAM', 'amount': '1', 'price_balls': '10', 'section_id': section}).json['id']
    shown = client.get('/api/shop-items', headers=admin).json
    assert next(s for s in shown['sections'] if s['id'] == section)['title'] == 'Новый год'
    assert next(i for i in shown['items'] if i['id'] == item)['section_id'] == section
    assert client.post('/api/admin/new-year/shop', headers=admin, json={'kind': 'GRAM', 'amount': '1', 'price_balls': '10', 'section_id': 'nope'}).status_code == 400
    # move the offer out of the section and back in one request
    assert client.post('/api/admin/new-year/shop/%s/section' % item, headers=admin, json={'section_id': ''}).status_code == 200
    assert next(i for i in client.get('/api/shop-items', headers=admin).json['items'] if i['id'] == item)['section_id'] == ''
    client.post('/api/admin/new-year/shop/%s/section' % item, headers=admin, json={'section_id': section})
    # arranging the sections and deleting the custom one frees its offers
    order = [s['id'] for s in client.get('/api/shop-items', headers=admin).json['sections']]
    assert client.post('/api/admin/new-year/shop-sections-arrange', headers=admin, json={'ids': [section] + order[:-1]}).status_code == 200
    assert client.get('/api/shop-items', headers=admin).json['sections'][0]['id'] == section
    assert client.post('/api/admin/new-year/shop-sections/%s/delete' % section, headers=admin).status_code == 200
    assert next(i for i in client.get('/api/shop-items', headers=admin).json['items'] if i['id'] == item)['section_id'] == ''


def test_uploads_are_checked(client):
    admin = signed(42)
    client.get('/api/me', headers=admin)
    assert upload(client, b'<html><script>alert(1)</script></html>', 'x.html').status_code == 415
    assert upload(client, b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'x.svg').status_code == 415
    assert upload(client, b'<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>', 'x.svg').status_code == 415
    assert upload(client, b'x' * 700000, 'big.png').status_code == 413
    ok = upload(client, b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', 'ok.svg')
    assert ok.status_code == 200 and ok.json['mime'] == 'image/svg+xml'
    served = client.get(ok.json['url'])
    assert 'sandbox' in served.headers['Content-Security-Policy'] and served.headers['X-Content-Type-Options'] == 'nosniff'
    assert upload(client, PNG, who=43).status_code == 403
    for bad in ({'title': '', 'bg': 'night'}, {'title': 'x', 'bg': 'rainbow'}, {'title': 'x', 'icon': 'javascript:alert(1)'}, {'title': 'x', 'preview': 'builtin:star'}):
        assert client.post('/api/admin/new-year/shop-sections', headers=admin, json=bad).status_code == 400
    assert client.get('/media/shop/' + 'a' * 32).status_code == 404
