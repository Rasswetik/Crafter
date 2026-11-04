"""Regression coverage for public TON Connect manifest and official collection PNG proxy."""
import os

from test_app import client, signed


def test_manifest_is_public_cors_safe_and_has_valid_png(client, monkeypatch):
    monkeypatch.setenv('RENDER_EXTERNAL_URL','https://crafter-v3sb.onrender.com/')
    for path in ('/tonconnect-manifest.json','/tonconnect-manifest-v2.json'):
        result=client.get(path, headers={'Origin':'https://wallet.example.org'})
        assert result.status_code == 200
        assert result.content_type.startswith('application/json')
        assert result.headers['Access-Control-Allow-Origin']=='*'
        assert result.headers['Cache-Control'].startswith('no-cache')
        assert result.json['url']=='https://crafter-v3sb.onrender.com'
        assert result.json['name']=='Crafter'
        assert result.json['iconUrl']=='https://crafter-v3sb.onrender.com/static/assets/wallet-icon.png'
    asset=client.get('/static/assets/wallet-icon.png')
    assert asset.status_code==200
    assert asset.data.startswith(b'\x89PNG\r\n\x1a\n')


def test_manifest_ignores_stale_custom_origin_on_render(client,monkeypatch):
    monkeypatch.setenv('RENDER_EXTERNAL_URL','https://crafter-v3sb.onrender.com')
    monkeypatch.setenv('RENDER','true')
    client.post('/api/admin/tonconnect',headers=signed(),json={'public_url':'https://stale.example.net'})
    result=client.get('/api/wallet',headers=signed())
    assert result.status_code==200
    assert result.json['manifest_url']=='https://crafter-v3sb.onrender.com/tonconnect-manifest-v2.json'


def test_collection_thumbnail_is_strictly_validated_and_cached(client,monkeypatch):
    import collection_media
    token=b'RIFF'+b'\x00'*4+b'WEBP'+b'0123456789'
    monkeypatch.setattr(collection_media,'load_collection_thumbnail',lambda slug:(token,'image/webp'))
    response=client.get('/media/collection/luckylocket')
    assert response.status_code==200
    assert response.data==token
    assert response.headers['X-Content-Type-Options']=='nosniff'
    assert client.get('/media/collection/..%2Fetc%2Fpasswd').status_code==404
    assert client.get('/media/collection/abc$%21').status_code==404
    assert client.get('/media/collection/UPPER').status_code==404
