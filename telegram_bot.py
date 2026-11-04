"""Telegram /start settings and authenticated webhook."""
import hmac
import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from flask import abort, request


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


def install_telegram_bot(app, db, auth, audit):
    lock = threading.Lock()
    with app.app_context(), db():
        db().execute('''CREATE TABLE IF NOT EXISTS telegram_start_updates
                       (bot_id INTEGER, update_id INTEGER, created INTEGER, PRIMARY KEY(bot_id, update_id))''')

    def settings():
        row = db().execute("SELECT payload FROM settings WHERE key='telegram_bot'").fetchone()
        saved = json.loads(row[0]) if row else {}
        return {
            'username': app.config['BOT_USERNAME'], 'greeting': 'Добро пожаловать в Crafter!',
            'buttons': [{'text': 'Открыть Crafter', 'type': 'web_app', 'url': ''}],
            'app_url': '', 'menu_text': '', **saved,
        }

    def token_for(config):
        return config.get('token') or app.config['BOT_TOKEN']

    def public_settings(config):
        return {key: config[key] for key in ('username', 'greeting', 'buttons', 'app_url', 'menu_text')} | {
            'token_configured': bool(token_for(config)), 'connected': bool(config.get('webhook_url')),
        }

    def save(config):
        with db():
            db().execute("INSERT OR REPLACE INTO settings VALUES('telegram_bot', ?)", (json.dumps(config),))

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
            clean.append(dict(text=text.strip(), type=kind, url=url))
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
            keyboard.append([{'text': button['text'], **action}])
        bot_api(token_for(config), 'sendMessage', {'chat_id': chat['id'], 'text': config['greeting'],
                                                  'reply_markup': {'inline_keyboard': keyboard}})
        with db():
            db().execute('INSERT OR IGNORE INTO telegram_start_updates VALUES (?, ?, ?)',
                         (bot_id, update_id, int(time.time())))
            db().execute('DELETE FROM telegram_start_updates WHERE created < ?', (int(time.time()) - 604800,))
        return {'ok': True}

    return settings
