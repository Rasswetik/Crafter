from datetime import datetime, timedelta, timezone

import advent
import telegram_bot
from test_app import client, signed

ROUTE = '/api/admin/telegram-bot'
MSK = timezone(timedelta(hours=3))


def base_payload(**extra):
    return {'greeting': 'Привет', 'buttons': [{'text': 'Открыть', 'type': 'web_app', 'url': ''}], **extra}


def fake_stickers(ids):
    return [{'custom_emoji_id': i, 'emoji': '⭐', 'thumbnail': {'file_id': 'f' + i}} for i in ids]


def test_phrases_are_editable_with_emoji_and_rendered(client, monkeypatch):
    admin = signed(42)
    got = client.get(ROUTE, headers=admin).json
    keys = {p['key'] for p in got['phrases']}
    assert {'sale', 'purchase', 'offer_received', 'offer_withdrawn', 'deposit', 'advent'} <= keys
    assert next(p for p in got['phrases'] if p['key'] == 'sale')['text'] == next(p for p in got['phrases'] if p['key'] == 'sale')['default']
    monkeypatch.setattr(telegram_bot, 'bot_api', lambda token, method, payload, sticker=None: fake_stickers(payload['custom_emoji_ids']) if method == 'getCustomEmojiStickers' else {})
    client.post(ROUTE + '/emoji', headers=admin, json={'value': '111 222'})
    saved = client.post(ROUTE, headers=admin, json=base_payload(phrases={'advent': '<b>Новая ячейка!</b> [[emoji:111]] день {day}', 'advent_button': 'Открыть 🎄', 'bogus': 'x'}))
    assert saved.status_code == 400                                              # unknown phrase
    saved = client.post(ROUTE, headers=admin, json=base_payload(phrases={'advent': '<b>Новая ячейка!</b> [[emoji:111]] день {day}', 'advent_button': 'Открыть 🎄'}))
    assert saved.status_code == 200
    again = client.get(ROUTE, headers=admin).json
    assert next(p for p in again['phrases'] if p['key'] == 'advent')['text'].startswith('<b>Новая ячейка!</b>')
    assert next(p for p in again['phrases'] if p['key'] == 'advent')['button']['text'] == 'Открыть 🎄'
    assert client.post(ROUTE, headers=admin, json=base_payload(phrases={'sale': '<b>без закрытия'})).status_code == 400
    sent = []
    monkeypatch.setattr(telegram_bot, 'bot_api', lambda token, method, payload, sticker=None: sent.append((method, payload)))
    config = {'phrases': {'advent': '<b>Ура</b> [[emoji:111]] {day}'}, 'emoji_chars': {'111': '⭐'}}
    telegram_bot.notify_advent(config, 5, 3, 'tok', 'https://crafter.example')
    message = sent[0][1]
    assert message['text'] == '<b>Ура</b> <tg-emoji emoji-id="111">⭐</tg-emoji> 3'
    button = message['reply_markup']['inline_keyboard'][0][0]
    assert 'open=advent' in button['web_app']['url'] and button['text'] == 'Открыть адвент'


def test_emoji_catalog_has_no_limit_groups_search_and_delete(client, monkeypatch):
    admin = signed(42)
    sets = {'Winter': [str(1000 + i) for i in range(260)], 'Gems': [str(5000 + i) for i in range(30)]}

    def bot_api(token, method, payload, sticker=None):
        if method == 'getStickerSet':
            return {'title': payload['name'], 'stickers': fake_stickers(sets[payload['name']])}
        return fake_stickers(payload['custom_emoji_ids'])
    monkeypatch.setattr(telegram_bot, 'bot_api', bot_api)
    assert client.post(ROUTE + '/emoji', headers=admin, json={'value': 'https://t.me/addemoji/Winter'}).json['emoji_total'] == 260   # more than 100 or 500
    client.post(ROUTE + '/emoji', headers=admin, json={'value': 'Gems'})
    catalog = client.get(ROUTE + '/emoji-catalog?limit=50', headers=admin).json
    assert catalog['all'] == 290 and catalog['total'] == 290 and len(catalog['items']) == 50
    assert {g['name']: g['count'] for g in catalog['groups']} == {'Winter': 260, 'Gems': 30}
    assert client.get(ROUTE + '/emoji-catalog?group=Gems', headers=admin).json['total'] == 30
    assert client.get(ROUTE + '/emoji-catalog?q=winte', headers=admin).json['total'] == 260        # search by group name
    assert client.get(ROUTE + '/emoji-catalog?q=50', headers=admin).json['total'] == 30              # by id prefix
    assert client.get(ROUTE + '/emoji-catalog?offset=280&limit=50', headers=admin).json['items'].__len__() == 10
    assert client.post(ROUTE + '/emoji-catalog', headers=signed(43)).status_code in (403, 404, 405)
    assert client.post(ROUTE + '/emoji/delete', headers=admin, json={'group': 'Gems'}).status_code == 200
    assert client.get(ROUTE + '/emoji-catalog', headers=admin).json['all'] == 260
    assert client.post(ROUTE + '/emoji/delete', headers=admin, json={'ids': ['1000', '1001']}).status_code == 200
    assert client.get(ROUTE + '/emoji-catalog', headers=admin).json['all'] == 258


def test_advent_notification_goes_out_once_per_new_day(client, monkeypatch):
    admin = signed(42)
    client.get('/api/me', headers=signed(43))
    client.get('/api/me', headers=signed(44))
    client.post('/api/admin/new-year/advent/settings', headers=admin, json={'enabled': True, 'start': '2026-12-01', 'days': 24, 'tz': 3, 'hour': 10, 'require_sub': False})
    sent = []
    app = client.application
    raw_tick = app.extensions['crafter_advent_notify_tick']

    def tick():
        with app.app_context():
            return raw_tick()
    monkeypatch.setattr(advent, 'now', lambda: datetime(2026, 12, 1, 10, 5, tzinfo=MSK).timestamp())
    monkeypatch.setattr(telegram_bot, 'bot_api', lambda token, method, payload, sticker=None: sent.append(payload['chat_id']) or {})
    monkeypatch.setattr(advent.time, 'sleep', lambda *_: None)
    first = tick()
    assert first >= 2 and {43, 44} <= set(sent)
    assert tick() == 0                                                                                # same day: nothing again
    monkeypatch.setattr(advent, 'now', lambda: datetime(2026, 12, 2, 10, 1, tzinfo=MSK).timestamp())
    assert tick() >= 2                                                                                # a new day: one more round
    monkeypatch.setattr(advent, 'now', lambda: datetime(2026, 12, 9, 23, 0, tzinfo=MSK).timestamp())
    assert tick() == 0                                                                                # stale unlock is not announced
