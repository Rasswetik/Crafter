from io import BytesIO

from PIL import Image

from app import create_app
from test_app import signed


def test_banner_publication_and_image_survive_edit_and_restart(tmp_path):
    config = {'TESTING': True, 'DATABASE': str(tmp_path / 'banners.db'),
              'DEMO_MODE': False, 'BOT_TOKEN': 'test-token', 'ADMIN_IDS': {42}}
    client = create_app(config).test_client()
    assert client.get('/admin').status_code == 200
    assert client.get('/api/admin/banners', headers=signed(43)).status_code == 403

    fields = {'title': 'Lucky Craft', 'action': 'lucky', 'sort_order': '10',
              'focus_x': '50', 'focus_y': '65', 'zoom': '125'}
    image = BytesIO()
    Image.effect_noise((450, 120), 60).save(image, 'PNG')
    assert image.tell() > 16384
    image.seek(0)
    headers = signed()
    create = client.post('/api/admin/banners', headers=headers, data={**fields, 'image': (image, 'banner.png')})
    assert create.status_code == 200
    banner_id = create.json['id']
    assert not client.get('/api/banners').json['banners']
    draft = client.get('/api/admin/banners', headers=headers).json['banners'][0]
    assert not draft['enabled']

    path = f'/api/admin/banners/{banner_id}'
    rejected = client.post(path, headers=headers, data={**fields, 'action': 'link', 'target': 'javascript:alert(1)'})
    assert rejected.status_code == 400
    published = client.post(path, headers=headers, data={**fields, 'title': 'Witch Hat', 'action': 'collection',
                            'target': 'witchhat', 'enabled': '1', 'focus_x': '10'})
    assert published.status_code == 200
    settings = {'enabled': True, 'interval': 7}
    assert client.post('/api/admin/banners/carousel', headers=headers, json=settings).status_code == 200

    client = create_app(config).test_client()
    data = client.get('/api/banners').json
    assert {key:data['carousel'][key] for key in settings} == settings
    assert data['carousel']['show_counter'] is False
    assert data['carousel']['show_dots'] is True
    assert data['carousel']['auto_rotate'] is True
    # Dots and autoplay are independent. Swipes must still work when both are off.
    assert client.post('/api/admin/banners/carousel', headers=headers, json={
        'enabled': True, 'interval': 7, 'show_dots': False,
        'show_counter': False, 'auto_rotate': False,
    }).status_code == 200
    updated = client.get('/api/banners').json['carousel']
    assert updated['enabled'] is True and updated['interval'] == 7
    assert updated['show_dots'] is False and updated['auto_rotate'] is False
    banner, = data['banners']
    assert (banner['target'], banner['focus_x'], banner['image_url']) == ('witchhat', 10, draft['image_url'])
    asset = client.get(banner['image_url'])
    assert asset.status_code == 200
    assert asset.mimetype == 'image/webp'
    assert Image.open(BytesIO(asset.data)).size == (450, 120)
    assert client.post(path + '/delete', headers=headers, json={}).status_code == 200
    assert client.get(banner['image_url']).status_code == 404
