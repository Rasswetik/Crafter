import io

from test_app import client, signed
from test_resale import telegram_messages  # noqa: F401  (autouse notification stubs)

import pytest

import creator_apps


@pytest.fixture(autouse=True)
def tiktok_views(monkeypatch):
    """No network: the number of views of a video comes from this table (5000 unless the test says otherwise)."""
    table = {'default': 5000}
    creator_apps._views_cache.clear()
    monkeypatch.setattr(creator_apps, 'fetch_views', lambda url: table.get(url, table['default']))
    return table


WALLET = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N'
URL = 'https://www.tiktok.com/@creator/video/7311111111111111111'


def form(**over):
    data = {'platform': 'tiktok', 'username': '@creator_one', 'video_url': URL, 'wallet': WALLET,
            'record': (io.BytesIO(b'\x00\x00\x00\x18ftypmp42' + b'0' * 2048), 'stats.mp4', 'video/mp4')}
    data.update(over)
    return data


def apply(client, uid=501, **over):
    return client.post('/api/creators/apply', headers=signed(uid), data=form(**over), content_type='multipart/form-data')


def test_application_flow_with_support_chat(client):
    client.get('/api/me', headers=signed(501, username='creator_one'))
    assert client.get('/api/creators/me', headers=signed(501)).json['applications'] == []
    done = apply(client)
    assert done.status_code == 200 and done.json['number'] == 1001
    me = client.get('/api/creators/me', headers=signed(501)).json
    assert me['applications'][0]['status'] == 'new' and me['applications'][0]['platform_name'] == 'TikTok'
    chat = client.get('/api/creators/apps/1001', headers=signed(501)).json
    assert chat['messages'][0]['author'] == 'support'
    sent = client.post('/api/creators/apps/1001/message', headers=signed(501), json={'text': 'Когда выплата?'})
    assert sent.status_code == 200 and sent.json['messages'][-1]['author'] == 'user'
    # another player cannot read or write it
    assert client.get('/api/creators/apps/1001', headers=signed(502)).status_code == 404
    assert client.post('/api/creators/apps/1001/message', headers=signed(502), json={'text': 'x'}).status_code == 404
    # administrators see the queue, the chat and the recording
    admin = signed()
    listing = client.get('/api/admin/creators/apps', headers=admin).json
    assert listing['applications'][0]['number'] == 1001 and listing['applications'][0]['waiting_reply'] is True
    assert client.get('/api/admin/creators/apps/1001/record', headers=admin).status_code == 200
    assert client.post('/api/admin/creators/apps/1001/message', headers=admin, json={'text': 'Проверяем запись'}).status_code == 200
    changed = client.post('/api/admin/creators/apps/1001/status', headers=admin, json={'status': 'approved', 'amount': '12,50', 'views': 10000, 'note': 'ok'})
    assert changed.status_code == 200 and changed.json['application']['status_text'].startswith('Одобрена')
    mine = client.get('/api/creators/apps/1001', headers=signed(501)).json
    assert [m['author'] for m in mine['messages']].count('support') >= 3
    assert mine['application']['amount'] == '12,50'
    # players cannot use the admin endpoints
    assert client.get('/api/admin/creators/apps', headers=signed(501)).status_code == 403
    assert client.post('/api/admin/creators/apps/1001/status', headers=signed(501), json={'status': 'paid'}).status_code == 403


def test_application_is_validated(client):
    client.get('/api/me', headers=signed(503))
    assert apply(client, 503, wallet='not-a-wallet').status_code == 400
    assert apply(client, 503, video_url='https://youtube.com/watch?v=abc').status_code == 400
    assert apply(client, 503, username='no').status_code == 400
    assert apply(client, 503, platform='youtube').status_code == 400
    assert apply(client, 503, record=(io.BytesIO(b'x'), 'stats.png', 'image/png')).status_code == 400
    bare = form()
    bare.pop('record')
    assert client.post('/api/creators/apply', headers=signed(503), data=bare, content_type='multipart/form-data').status_code == 400
    assert apply(client, 503).status_code == 200
    assert apply(client, 503).status_code == 409                  # the same video twice
    assert client.get('/api/creators/me').status_code in (401, 200)


def test_video_needs_1000_views_and_is_checked_while_typing(client, tiktok_views):
    client.get('/api/me', headers=signed(510))
    few = 'https://www.tiktok.com/@creator/video/7300000000000000001'
    tiktok_views[few] = 420
    checked = client.post('/api/creators/check-link', headers=signed(510), json={'url': few}).json
    assert checked['ok'] is False and checked['state'] == 'few' and checked['views'] == 420
    assert apply(client, 510, video_url=few).status_code == 400                      # not accepted
    good = client.post('/api/creators/check-link', headers=signed(510), json={'url': URL}).json
    assert good['ok'] is True and good['state'] == 'enough' and good['views'] == 5000
    done = apply(client, 510)
    assert done.status_code == 200
    mine = client.get('/api/creators/apps/%d' % done.json['number'], headers=signed(510)).json['application']
    assert mine['views'] == 5000                                                      # the checked views are saved
    assert client.post('/api/creators/check-link', headers=signed(510), json={'url': 'https://youtube.com/x'}).json['state'] == 'bad_link'


def test_unreadable_page_goes_to_the_administrator(client, tiktok_views):
    client.get('/api/me', headers=signed(511))
    unknown = 'https://www.tiktok.com/@creator/video/7300000000000000002'
    tiktok_views[unknown] = None
    assert client.post('/api/creators/check-link', headers=signed(511), json={'url': unknown}).json['state'] == 'unknown'
    done = apply(client, 511, video_url=unknown)
    assert done.status_code == 200
    detail = client.get('/api/admin/creators/apps/%d' % done.json['number'], headers=signed()).json['application']
    assert 'вручную' in detail['admin_note']
