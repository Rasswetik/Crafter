"""Telegram /start settings and authenticated webhook."""
import hmac
import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import Request, urlopen

from flask import Response, abort, request
from html import escape


def bot_api(token, method, payload):
    req = Request(f'https://api.telegram.org/bot{token}/{method}',
                  data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=5) as response:
            result = json.load(response)
    except HTTPError as error:
        if error.code in (401, 404) and method == 'getMe':
            abort(400, description='Telegram отклонил токен бота')
        abort(502, description='Telegram отклонил запрос к Bot API')
    except (URLError, TimeoutError, ValueError):
        abort(502, description='Telegram Bot API временно недоступен')
    if not result.get('ok'):
        abort(502, description='Telegram отклонил запрос к Bot API')
    return result.get('result')


def https_url(value):
    try:
        url = urlsplit(value)
        return url.scheme == 'https' and url.hostname and not (url.username or url.password)
    except ValueError:
        return False


def notify_gift_transfer(config, recipient, gifts, sender, origin, default_token):
    token = config.get('token') or default_token
    if not token:
        return
    source = 'an anonymous sender' if sender is None else (
        '@' + sender['username'] if sender['username'] else sender['name'] or 'another Crafter user'
    )
    labels = []
    for gift in gifts[:7]:
        name = gift['name']
        label = escape(name + (f" #{gift['number']}" if gift.get('number') else ''))
        slug = re.sub(r'[^a-zA-Z0-9]', '', name).lower()
        serial = str(gift.get('source_number') or '')
        labels.append(f'<a href="https://t.me/nft/{slug}-{serial}">{label}</a>' if slug and serial.isdecimal() else label)
    extra = f' and {len(gifts)-7} others' if len(gifts) > 7 else ''
    url = config.get('app_url') or os.getenv('RENDER_EXTERNAL_URL') or origin
    message = {'chat_id': recipient, 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True},
               'text': f'🎁 You received {len(gifts)} {"gift" if len(gifts) == 1 else "gifts"} from {escape(source)}: '
                       + ', '.join(labels) + extra + '!\n\nOpen your inventory to see them.'}
    if https_url(url):
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        query['view'] = 'gifts'
        inventory_url = parts._replace(query=urlencode(query)).geturl()
        message['reply_markup'] = {'inline_keyboard': [[{'text': 'View Inventory', 'web_app': {'url': inventory_url}}]]}
    bot_api(token, 'sendMessage', message)


def install_telegram_bot(app, db, auth, audit):
    lock = threading.Lock()
    with app.app_context(), db():
        db().executescript('''CREATE TABLE IF NOT EXISTS telegram_start_updates
                       (bot_id INTEGER, update_id INTEGER, created INTEGER, PRIMARY KEY(bot_id, update_id))''')

    def settings():
        row = db().execute("SELECT payload FROM settings WHERE key='telegram_bot'").fetchone()
        saved = json.loads(row[0]) if row else {}
        return {
            'username': app.config['BOT_USERNAME'], 'greeting': 'Добро пожаловать в Crafter!',
            'buttons': [{'text': 'Открыть Crafter', 'type': 'web_app', 'url': ''}],
            'app_url': '', 'menu_text': '', 'emoji_library': {}, **saved,
        }

    def token_for(config):
        return config.get('token') or app.config['BOT_TOKEN']

    def public_settings(config):
        return {key: config[key] for key in ('username', 'greeting', 'buttons', 'app_url', 'menu_text')} | {
            'token_configured': bool(token_for(config)), 'connected': bool(config.get('webhook_url')),
            'emoji_library': [{'id': key, 'emoji': item['emoji']} for key, item in config['emoji_library'].items()],
        }

    def save(config):
        with db():
            db().execute("INSERT INTO settings VALUES('telegram_bot', ?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload", (json.dumps(config),))

    def app_url(config):
        url = config['app_url'] or os.getenv('RENDER_EXTERNAL_URL') or request.url_root
        if not https_url(url):
            abort(400, description='Укажите публичный HTTPS-адрес Mini App')
        return url

    @app.get('/api/admin/telegram-bot')
    @auth(admin=True)
    def read_bot():
        response = app.json.response(public_settings(settings()))
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.post('/api/admin/telegram-bot')
    @auth(admin=True)
    def update_bot():
        data = request.get_json()
        if not isinstance(data, dict):
            abort(400)
        fields = {}
        for name, limit in [('greeting', 4096), ('menu_text', 64), ('app_url', 1024), ('token', 128)]:
            value = data.get(name, '')
            if not isinstance(value, str) or len(value) > limit:
                abort(400, description='Проверьте длину полей настроек бота')
            fields[name] = value.strip()
        buttons = data.get('buttons')
        if not fields['greeting'] or not isinstance(buttons, list) or len(buttons) > 8:
            abort(400, description='Укажите приветствие и не более 8 кнопок')
        if fields['app_url'] and not https_url(fields['app_url']):
            abort(400, description='Адрес Mini App должен начинаться с https://')
        clean = []
        for button in buttons:
            if not isinstance(button, dict):
                abort(400)
            text, kind, url = (button.get(key) for key in ('text', 'type', 'url'))
            if (not isinstance(text, str) or not 1 <= len(text.strip()) <= 64 or kind not in ('url', 'web_app')
                    or not isinstance(url, str) or len(url) > 1024 or
                    ((url or kind == 'url') and not https_url(url))):
                abort(400, description='Укажите подпись и HTTPS-ссылку для каждой кнопки')
            style, emoji = button.get('style', ''), button.get('icon_custom_emoji_id', '')
            if style not in ('', 'primary', 'success', 'danger') or not isinstance(emoji, str) or (
                    emoji and not re.fullmatch(r'[0-9]{1,25}', emoji)):
                abort(400, description='Проверьте цвет кнопки и ID эмодзи')
            clean.append(dict(text=text.strip(), type=kind, url=url))
            if style:
                clean[-1]['style'] = style
            if emoji:
                clean[-1]['icon_custom_emoji_id'] = emoji
        with lock:
            config = settings()
            token = fields.pop('token')
            if token and token != token_for(config):
                if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
                    abort(400, description='Проверьте формат токена от BotFather')
                bot = bot_api(token, 'getMe', {})
                if not isinstance(bot, dict) or not bot.get('is_bot') or type(bot.get('id')) is not int:
                    abort(400, description='Telegram не подтвердил бота')
                config.update(token=token, bot_id=bot['id'], username=bot.get('username', ''),
                              webhook_url='', secret='')
            config.update(fields, buttons=clean)
            save(config)
            audit('Telegram bot settings updated')
            return public_settings(config)

    @app.post('/api/admin/telegram-bot/emoji')
    @auth(admin=True)
    def import_emoji():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        value = data.get('value')
        if not isinstance(value, str) or len(value) > 3000:
            abort(400)
        value = value.strip()
        ids = list(dict.fromkeys(re.split(r'[\s,]+', value)))
        with lock:
            config = settings()
            token = token_for(config)
            if not token:
                abort(400, description='Сначала сохраните токен бота')
            if 1 <= len(ids) <= 100 and all(re.fullmatch(r'[0-9]{1,25}', item) for item in ids):
                stickers = bot_api(token, 'getCustomEmojiStickers', {'custom_emoji_ids': ids})
            else:
                match = re.fullmatch(r'(?:https://t\.me/addemoji/)?([A-Za-z][A-Za-z0-9_]{0,63})/?', value)
                if not match:
                    abort(400, description='Введите ID эмодзи или ссылку на набор t.me/addemoji')
                stickers = bot_api(token, 'getStickerSet', {'name': match[1]}).get('stickers', [])
            imported = {}
            for sticker in stickers:
                ident = sticker.get('custom_emoji_id')
                if isinstance(ident, str) and re.fullmatch(r'[0-9]{1,25}', ident):
                    thumbnail = (sticker.get('thumbnail') or {}).get('file_id')
                    if not thumbnail and not (sticker.get('is_animated') or sticker.get('is_video')):
                        thumbnail = sticker.get('file_id')
                    imported[ident] = {'emoji': sticker.get('emoji') or '⭐', 'thumbnail': thumbnail}
            if not imported:
                abort(400, description='В Telegram не найдено премиум-эмодзи')
            if len(config['emoji_library'] | imported) > 500:
                abort(409, description='В библиотеке можно хранить до 500 эмодзи')
            config['emoji_library'].update(imported)
            save(config)
        return public_settings(config)

    @app.get('/api/admin/telegram-bot/emoji/<emoji_id>')
    @auth(admin=True)
    def emoji_thumbnail(emoji_id):
        config = settings()
        item = config['emoji_library'].get(emoji_id)
        token = token_for(config)
        if not item or not item.get('thumbnail') or not token:
            abort(404)
        info = bot_api(token, 'getFile', {'file_id': item['thumbnail']})
        path = info.get('file_path', '')
        if not re.fullmatch(r'[A-Za-z0-9_/-]+\.(?:webp|jpg|jpeg|png)', path, re.I):
            abort(404)
        try:
            with urlopen(f'https://api.telegram.org/file/bot{token}/{path}', timeout=5) as response:
                image = response.read(262145)
        except (OSError, ValueError):
            abort(502)
        if not image or len(image) > 262144:
            abort(404)
        kind = path.rsplit('.', 1)[1].lower()
        return Response(image, mimetype='image/' + ('jpeg' if kind in ('jpg','jpeg') else kind),
                        headers={'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff'})

    @app.post('/api/admin/telegram-bot/connect')
    @auth(admin=True)
    def connect_bot():
        with lock:
            config = settings()
            token = token_for(config)
            if not token:
                abort(400, description='Сначала сохраните токен бота')
            origin = os.getenv('RENDER_EXTERNAL_URL') or os.getenv('PUBLIC_APP_URL') or request.url_root
            if not https_url(origin):
                abort(400, description='Для webhook нужен публичный HTTPS-адрес Crafter')
            bot = bot_api(token, 'getMe', {})
            bot_id = bot['id']
            secret = config.get('secret') or secrets.token_urlsafe(32)
            url = f"{origin.rstrip('/')}/api/telegram/webhook/{bot_id}"
            bot_api(token, 'setWebhook', {'url': url, 'secret_token': secret,
                                        'allowed_updates': ['message'], 'max_connections': 1})
            config.update(bot_id=bot_id, username=bot.get('username', ''), secret=secret, webhook_url=url)
            save(config)
            audit('Telegram bot webhook connected')
            return public_settings(config)

    @app.post('/api/admin/telegram-bot/menu')
    @auth(admin=True)
    def update_menu():
        with lock:
            config = settings()
            token = token_for(config)
            if not token:
                abort(400, description='Сначала сохраните токен бота')
            menu = {'type': 'default'}
            if config['menu_text']:
                menu = {'type': 'web_app', 'text': config['menu_text'], 'web_app': {'url': app_url(config)}}
            bot_api(token, 'setChatMenuButton', {'menu_button': menu})
            audit('Telegram chat menu updated')
            return {'ok': True}

    @app.post('/api/telegram/webhook/<int:bot_id>')
    def telegram_update(bot_id):
        with lock:
            return handle_update(bot_id)

    def handle_update(bot_id):
        config = settings()
        secret = config.get('secret')
        supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
        if bot_id != config.get('bot_id') or not secret or not hmac.compare_digest(secret.encode(), supplied.encode()):
            abort(403)
        update = request.get_json(silent=True)
        if not isinstance(update, dict) or type(update.get('update_id')) is not int:
            abort(400)
        message = update.get('message')
        if not isinstance(message, dict):
            return {'ok': True}
        chat = message.get('chat')
        if not isinstance(chat, dict) or not isinstance(message.get('text'), str):
            return {'ok': True}
        if chat.get('type') != 'private' or type(chat.get('id')) is not int:
            return {'ok': True}
        parts = message.get('text', '').split(maxsplit=1)
        username = config['username'].lower()
        if not parts or parts[0].lower() not in ('/start', f'/start@{username}'):
            return {'ok': True}
        update_id = update['update_id']
        if db().execute('SELECT 1 FROM telegram_start_updates WHERE bot_id=? AND update_id=?',
                        (bot_id, update_id)).fetchone():
            return {'ok': True}
        keyboard = []
        for button in config['buttons']:
            url = button['url'] or app_url(config)
            action = {'url': url} if button['type'] == 'url' else {'web_app': {'url': url}}
            options = {key: button[key] for key in ('style', 'icon_custom_emoji_id') if button.get(key)}
            keyboard.append([{'text': button['text'], **action, **options}])
        greeting = config['greeting']
        message = {'chat_id': chat['id'], 'text': greeting, 'reply_markup': {'inline_keyboard': keyboard}}
        if re.search(r'\[\[emoji:[0-9]{1,25}\]\]', greeting):
            parts = re.split(r'\[\[emoji:([0-9]{1,25})\]\]', greeting)
            for index in range(1, len(parts), 2):
                ident = parts[index]
                fallback = escape(config['emoji_library'].get(ident, {}).get('emoji', '⭐'))
                parts[index] = f'<tg-emoji emoji-id="{ident}">{fallback}</tg-emoji>'
            for index in range(0, len(parts), 2):
                parts[index] = escape(parts[index])
            message.update(text=''.join(parts), parse_mode='HTML')
        bot_api(token_for(config), 'sendMessage', message)
        with db():
            db().execute('INSERT INTO telegram_start_updates VALUES(?, ?, ?) ON CONFLICT DO NOTHING',
                         (bot_id, update_id, int(time.time())))
            db().execute('DELETE FROM telegram_start_updates WHERE created < ?', (int(time.time()) - 604800,))
        return {'ok': True}

    return settings
