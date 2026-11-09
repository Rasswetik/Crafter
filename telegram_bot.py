"""Telegram /start settings and authenticated webhook."""
import base64
import binascii
from decimal import Decimal
import hmac
import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from flask import Response, abort, request
from html import escape


def bot_api(token, method, payload, sticker=None):
    if sticker is None:
        body = json.dumps(payload).encode()
        headers = {'Content-Type': 'application/json'}
    else:
        boundary = secrets.token_hex(16)
        body = b''.join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            for key, value in payload.items()
        )
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="sticker"; filename="gift.tgs"\r\n'
                 f'Content-Type: application/x-tgsticker\r\n\r\n').encode()
        body += sticker + f'\r\n--{boundary}--\r\n'.encode()
        headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
    req = Request(f'https://api.telegram.org/bot{token}/{method}', data=body, headers=headers)
    try:
        with urlopen(req, timeout=3 if sticker is not None else 5) as response:
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


GIFT_TEMPLATE = '🎁 You received {count} {gift_word} from {sender}: {gifts}!\n\nOpen your inventory to see them.'
GIFT_TEMPLATE_STYLES = {'b', 'i', 'u', 's', 'tg-spoiler', 'code'}
GIFT_TEMPLATE_FIELDS = {'count', 'gift_word', 'sender', 'gifts', 'message'}
GIFT_TEMPLATE_TOKEN = re.compile(r'(</?[a-z-]+>|\{[a-z_]+\})')


def render_gift_template(template, values):
    chunks = []
    styles = []
    for index, part in enumerate(GIFT_TEMPLATE_TOKEN.split(template)):
        if index % 2 and part.startswith('<'):
            name = part.strip('</>')
            if name not in GIFT_TEMPLATE_STYLES:
                chunks.append(escape(part))
                continue
            if part.startswith('</'):
                if not styles or styles.pop() != name:
                    raise ValueError('Закройте стили в обратном порядке')
            else:
                styles.append(name)
            chunks.append(part)
        elif index % 2 and part[1:-1] in GIFT_TEMPLATE_FIELDS:
            chunks.append(values[part[1:-1]])
        else:
            chunks.append(escape(part))
    if styles:
        raise ValueError('Закройте все теги стилей')
    return ''.join(chunks)


PHRASES = {
    'sale': {'title': 'Подарок продан', 'text': '💰 {gift} has been sold\nYou received: {amount} Gram', 'fields': ('gift', 'amount')},
    'purchase': {'title': 'Подарок куплен', 'text': '✅ Successfully purchased {gift} for {price} GRAM. The gift is now in your Crafter inventory.',
                 'fields': ('gift', 'price'), 'button': ('purchase_button', '🎁 VIEW COLLECTIBLE')},
    'offer_received': {'title': 'Новый оффер', 'text': '🎁 New offer: {gift} — {amount} GRAM. Open Crafter to accept it.', 'fields': ('gift', 'amount')},
    'offer_withdrawn': {'title': 'Оффер отозван', 'text': '↩️ Offer withdrawn: {gift} — {amount} GRAM.', 'fields': ('gift', 'amount')},
    'deposit': {'title': 'Пополнение баланса', 'text': '💸Баланс обновлен\n\n⬆️Депозит: {amount} GRAM успешно зачислено\n\n🔎 Посмотреть транзакцию\n\n{link}',
                'fields': ('amount', 'link')},
    'api_key': {'title': 'Команда /api: ключ партнёрского API', 'fields': ('key', 'docs'),
                'text': '🔑 <b>Ваш API-ключ</b> (тапните, чтобы увидеть; долгое нажатие — скопировать):\n\n<tg-spoiler><code>{key}</code></tg-spoiler>\n\n⚠️ <b>Никому не передавайте этот ключ.</b>\nКлюч даёт полный доступ к вашему аккаунту Crafter — включая баланс, покупки и подарки. Любой, кто его получит, сможет тратить ваш баланс и переводить ваши подарки.\n\nНаша команда и поддержка никогда не запрашивают этот ключ. Если кто-то просит его — это мошенники.\n\nЕсли ключ утёк, немедленно напишите в поддержку @crafter_support для замены.\n\n📖 Документация по API: {docs}'},
    'api_denied': {'title': 'Команда /api: нет доступа', 'fields': (),
                   'text': '🔒 API-ключ выдаётся тем, кто хотя бы один раз открыл приложение Crafter. Откройте приложение, затем отправьте /api ещё раз.'},
    'advent': {'title': 'Новая ячейка адвент-календаря', 'text': '🎄 Новая ячейка адвент-календаря уже открыта!\n\nСкорее заберите подарок {day}-го дня 🎁',
               'fields': ('day',), 'button': ('advent_button', 'Открыть адвент')},
}
PHRASE_TOKEN = re.compile(r'(\[\[emoji:[0-9]{1,25}\]\]|</?[a-z-]+>|\{[a-z_]+\})')


def render_phrase(config, key, values, template=None):
    """HTML text of a bot phrase: administrator override or default, with {fields}, styles and custom emoji."""
    spec = PHRASES[key]
    template = template if template is not None else ((config.get('phrases') or {}).get(key) or spec['text'])
    chars = config.get('emoji_chars') or {}
    chunks, styles = [], []
    for index, part in enumerate(PHRASE_TOKEN.split(template)):
        if not index % 2:
            chunks.append(escape(part))
        elif part.startswith('[['):
            ident = part[8:-2]
            chunks.append(f'<tg-emoji emoji-id="{ident}">{escape(chars.get(ident, "⭐"))}</tg-emoji>')
        elif part.startswith('<'):
            name = part.strip('</>')
            if name not in GIFT_TEMPLATE_STYLES:
                chunks.append(escape(part))
            elif part.startswith('</'):
                if not styles or styles.pop() != name:
                    raise ValueError('Закройте стили в обратном порядке')
                chunks.append(part)
            else:
                styles.append(name)
                chunks.append(part)
        elif part[1:-1] in spec['fields']:
            chunks.append(str(values.get(part[1:-1], '')))
        else:
            chunks.append(escape(part))
    if styles:
        raise ValueError('Закройте все теги стилей')
    return ''.join(chunks)


def phrase_button(config, key):
    spec = PHRASES[key]['button']
    return (config.get('phrases') or {}).get(spec[0]) or spec[1]


def notify_advent(config, user_id, day, default_token, url=''):
    """Tell a player that a new advent cell can be opened now."""
    token = config.get('token') or default_token
    if not token:
        return False
    message = {'chat_id': user_id, 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True},
               'text': render_phrase(config, 'advent', {'day': escape(str(day))})}
    if https_url(url):
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        query.update(view='new-year', open='advent')
        message['reply_markup'] = {'inline_keyboard': [[{'text': phrase_button(config, 'advent'), 'web_app': {'url': parts._replace(query=urlencode(query)).geturl()}}]]}
    bot_api(token, 'sendMessage', message)
    return True


def notify_gift_transfer(config, recipient, gifts, sender, origin, default_token, personal_message=''):
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
    template = config.get('gift_template') or GIFT_TEMPLATE
    values = {'count': str(len(gifts)), 'gift_word': 'gift' if len(gifts) == 1 else 'gifts',
              'sender': escape(source), 'gifts': ', '.join(labels) + extra, 'message': escape(personal_message)}
    text = render_gift_template(template, values)
    if personal_message and '{message}' not in template:
        text += '\n\n' + values['message']
    message = {'chat_id': recipient, 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True}, 'text': text}
    if https_url(url):
        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        query['view'] = 'gifts'
        inventory_url = parts._replace(query=urlencode(query)).geturl()
        message['reply_markup'] = {'inline_keyboard': [[{'text': config.get('gift_button_text') or 'View Inventory', 'web_app': {'url': inventory_url}}]]}
    bot_api(token, 'sendMessage', message)


def sale_sticker(gift):
    parts = [str(gift.get(key) or '').strip() for key in ('name','model')]
    if any(not part or part in ('.','..') or len(part) > 120 for part in parts):
        return None
    url = 'https://api.changes.tg/model/' + '/'.join(quote(part, safe='') for part in parts) + '.tgs'
    try:
        with urlopen(url, timeout=2) as response:
            asset = response.read(65537)
        if len(asset) <= 65536 and asset.startswith(b'\x1f\x8b'):
            return asset
    except (OSError, ValueError):
        return None
    return None


def verified_nft_link(gift):
    """Return only a validated direct Telegram NFT link from known gift identity.

    An arbitrary display number on a synthetic gift is not proof that an NFT
    exists. Prefer a previously provided Telegram URL/slug or a real source number.
    """
    url = str(gift.get('telegram_url') or '')
    if re.fullmatch(r'https://(?:t\.me|telegram\.me)/nft/[a-z0-9]+-[1-9][0-9]*', url, re.I):
        return url
    slug = str(gift.get('telegram_slug') or '')
    if not re.fullmatch(r'[a-z0-9]+-[1-9][0-9]*', slug, re.I):
        collection = re.sub(r'[^a-zA-Z0-9]', '', str(gift.get('name') or '')).lower()
        serial = str(gift.get('source_number') or '')
        slug = f'{collection}-{serial}' if collection and re.fullmatch(r'[1-9][0-9]*', serial) else ''
    return f'https://t.me/nft/{slug}' if slug else ''


def notify_gift_sale(config, seller, gift, proceeds, default_token):
    token = config.get('token') or default_token
    if not token:
        return
    name = str(gift.get('name') or 'Gift')
    number = str(gift.get('number') or '')
    if gift.get('pack_item') and gift.get('model'):
        name = f"{name} {gift['model']}"
    label = escape(name + (f' #{number}' if number else ''))
    url = verified_nft_link(gift)
    if url:
        label = f'<a href="{escape(url, quote=True)}">{label}</a>'
    amount = str(proceeds)
    if '.' in amount:
        amount = amount.rstrip('0').rstrip('.')
    bot_api(token, 'sendMessage', {
        'chat_id': seller, 'parse_mode': 'HTML',
        'link_preview_options': {'url':url, 'prefer_large_media':True, 'show_above_text':False} if url else {'is_disabled':True},
        'text': render_phrase(config, 'sale', {'gift': label, 'amount': escape(amount)}),
    })
    sticker = sale_sticker(gift)
    if sticker:
        try:
            bot_api(token, 'sendSticker', {'chat_id': seller}, sticker=sticker)
        except Exception:
            # The receipt has already been sent. Media failure must not retry it.
            pass



def notify_offer_event(config, seller, gift, price, event, default_token):
    """Notify the actual seller of a backed offer creation/withdrawal."""
    token = config.get('token') or default_token
    if not token or event not in ('received', 'withdrawn'):
        return
    gift_name = str(gift.get('name') or 'Gift')
    if gift.get('pack_item') and gift.get('model'):
        gift_name += ' ' + str(gift['model'])
    label = escape(gift_name + (f" #{gift['number']}" if gift.get('number') else ''))
    url = str(gift.get('telegram_url') or '')
    if re.fullmatch(r'https://(?:t\.me|telegram\.me)/nft/[a-z0-9]+-[1-9][0-9]*', url, re.I):
        label = '<a href="' + escape(url, quote=True) + '">' + label + '</a>'
    amount = str(price)
    if '.' in amount:
        amount = amount.rstrip('0').rstrip('.')
    message = render_phrase(config, 'offer_received' if event == 'received' else 'offer_withdrawn', {'gift': label, 'amount': escape(amount)})
    bot_api(token, 'sendMessage', {'chat_id': seller, 'parse_mode': 'HTML',
                                  'link_preview_options': {'is_disabled': True},
                                  'text': message})



def ton_transaction_link(tx_hash, network):
    """Use the *verified incoming transaction hash*, never the TON Connect intent ID.

    TON Center can report a 256-bit hash as hex, Base64 or Base64URL.
    Tonscan's /tx/ route expects lowercase hexadecimal.
    """
    if network not in ('mainnet', 'testnet') or not isinstance(tx_hash, str):
        return None
    value = tx_hash.strip()
    if re.fullmatch(r'[0-9a-fA-F]{64}', value):
        hex_hash = value.lower()
    else:
        try:
            raw = base64.b64decode(value, altchars=b'-_', validate=True)
            if len(raw) != 32:
                return None
            hex_hash = raw.hex()
        except (ValueError, binascii.Error):
            return None
    host = 'tonscan.org' if network == 'mainnet' else 'testnet.tonscan.org'
    return f'https://{host}/tx/{hex_hash}'


def notify_gram_deposit(config, recipient, gram, tx_hash, network, default_token):
    """Send a Telegram balance receipt after committed on-chain confirmation."""
    token = config.get('token') or default_token
    url = ton_transaction_link(tx_hash, network)
    if not token or not url:
        return False
    value = Decimal(str(gram))
    if not value.is_finite() or value <= 0:
        return False
    amount = format(value.normalize(), 'f')
    bot_api(token, 'sendMessage', {
        'chat_id': int(recipient),
        'parse_mode': 'HTML',
        'text': render_phrase(config, 'deposit', {'amount': escape(amount), 'link': escape(url)}),
        'link_preview_options': {'is_disabled': True},
    })
    return True


def notify_gift_purchase(config, buyer, gift, price, default_token):
    token = config.get('token') or default_token
    if not token:
        return
    gift_name = str(gift.get('name') or 'Gift')
    if gift.get('pack_item') and gift.get('model'):
        gift_name += ' ' + str(gift['model'])
    label = escape(gift_name + (f" #{gift['number']}" if gift.get('number') else ''))
    url = '' if gift.get('test_only') else verified_nft_link(gift)
    if url:
        label = f'<a href="{escape(url, quote=True)}">{label}</a>'
    amount = str(price).rstrip('0').rstrip('.') if '.' in str(price) else str(price)
    message = render_phrase(config, 'purchase', {'gift': label, 'price': escape(amount)})
    if url:
        message += (f'\n\n🔗 <a href="{escape(url, quote=True)}">'
                    'View NFT in Telegram</a>')
    kwargs = {'chat_id':buyer, 'parse_mode':'HTML', 'text':message,
              'link_preview_options': {'url':url,'prefer_large_media':True,
                                       'show_above_text':False} if url else {'is_disabled':True}}
    if url:
        kwargs['reply_markup'] = {'inline_keyboard': [[{'text': phrase_button(config, 'purchase'), 'url': url}]]}
    bot_api(token,'sendMessage',kwargs)



def install_telegram_bot(app, db, auth, audit):
    lock = threading.Lock()
    with app.app_context(), db():
        db().executescript('''CREATE TABLE IF NOT EXISTS telegram_start_updates
                       (bot_id INTEGER, update_id INTEGER, created INTEGER, PRIMARY KEY(bot_id, update_id));
                       CREATE TABLE IF NOT EXISTS telegram_emoji
                       (id TEXT PRIMARY KEY, emoji TEXT NOT NULL, thumbnail TEXT, grp TEXT NOT NULL DEFAULT '', added BIGINT NOT NULL DEFAULT 0)''')

    def migrate_emoji(saved):
        """The old library lived inside the settings JSON (500 at most). Move it into its own table once."""
        old = saved.get('emoji_library') or {}
        if old and not db().execute("SELECT 1 FROM telegram_emoji LIMIT 1").fetchone():
            with db():
                for ident, item in old.items():
                    db().execute("INSERT INTO telegram_emoji(id,emoji,thumbnail,grp,added) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
                                 (ident, item.get('emoji') or '⭐', item.get('thumbnail'), 'Импорт', int(time.time())))

    def settings():
        row = db().execute("SELECT payload FROM settings WHERE key='telegram_bot'").fetchone()
        saved = json.loads(row[0]) if row else {}
        config = {
            'username': app.config['BOT_USERNAME'], 'greeting': 'Добро пожаловать в Crafter!',
            'buttons': [{'text': 'Открыть Crafter', 'type': 'web_app', 'url': ''}],
            'app_url': '', 'menu_text': '', 'emoji_library': {}, 'phrases': {},
            'gift_template': GIFT_TEMPLATE, 'gift_button_text': 'View Inventory', **saved,
        }
        migrate_emoji(saved)
        # Fallback characters only for the custom emoji that the texts really use.
        texts = [config.get('greeting', ''), config.get('gift_template', '')] + [v for v in (config.get('phrases') or {}).values() if isinstance(v, str)]
        ids = sorted({m for t in texts for m in re.findall(r'\[\[emoji:([0-9]{1,25})\]\]', t)})
        chars = {}
        for i in range(0, len(ids), 200):
            chunk = ids[i:i + 200]
            for r in db().execute("SELECT id,emoji FROM telegram_emoji WHERE id IN (" + ','.join('?' for _ in chunk) + ")", chunk).fetchall():
                chars[r['id']] = r['emoji']
        config['emoji_chars'] = chars
        return config

    def token_for(config):
        return config.get('token') or app.config['BOT_TOKEN']

    def phrase_list(config):
        mine = config.get('phrases') or {}
        out = []
        for key, spec in PHRASES.items():
            row = {'key': key, 'title': spec['title'], 'default': spec['text'], 'text': mine.get(key) or spec['text'], 'fields': list(spec['fields'])}
            if spec.get('button'):
                row['button'] = {'key': spec['button'][0], 'default': spec['button'][1], 'text': mine.get(spec['button'][0]) or spec['button'][1]}
            out.append(row)
        return out

    def public_settings(config):
        rows = db().execute("SELECT id,emoji FROM telegram_emoji ORDER BY added,id LIMIT 200").fetchall()
        return {key: config[key] for key in ('username', 'greeting', 'buttons', 'app_url', 'menu_text', 'gift_template', 'gift_button_text')} | {
            'token_configured': bool(token_for(config)), 'connected': bool(config.get('webhook_url')),
            'emoji_library': [{'id': r['id'], 'emoji': r['emoji']} for r in rows],
            'emoji_total': int(db().execute("SELECT COUNT(*) AS n FROM telegram_emoji").fetchone()['n']),
            'phrases': phrase_list(config),
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
        if 'gift_template' in data:
            template = data['gift_template']
            if not isinstance(template, str) or not 1 <= len(template.strip()) <= 1300 or '\x00' in template:
                abort(400, description='Введите шаблон до 1300 символов')
            try:
                rendered = render_gift_template(template, {key: '×' for key in GIFT_TEMPLATE_FIELDS})
            except ValueError as error:
                abort(400, description=str(error))
            if not re.sub(r'</?(?:b|i|u|s|tg-spoiler)>', '', rendered).strip():
                abort(400, description='Добавьте текст уведомления')
            fields['gift_template'] = template.strip()
        if 'gift_button_text' in data:
            label = data['gift_button_text']
            if not isinstance(label, str) or not 1 <= len(label.strip()) <= 64 or '\x00' in label:
                abort(400, description='Введите подпись кнопки до 64 символов')
            fields['gift_button_text'] = label.strip()
        if 'phrases' in data:
            incoming = data['phrases']
            if not isinstance(incoming, dict):
                abort(400)
            saved_phrases = {}
            for key, text in incoming.items():
                spec = PHRASES.get(key)
                button_keys = {v['button'][0]: v['button'] for v in PHRASES.values() if v.get('button')}
                if not isinstance(text, str) or len(text) > 1300 or '\x00' in text:
                    abort(400, description='Фраза: до 1300 символов')
                if spec:
                    if text.strip():
                        try:
                            render_phrase({}, key, {f: '×' for f in spec['fields']}, template=text.strip())
                        except ValueError as error:
                            abort(400, description=str(error))
                        saved_phrases[key] = text.strip()
                elif key in button_keys:
                    if text.strip():
                        if len(text.strip()) > 64:
                            abort(400, description='Подпись кнопки до 64 символов')
                        saved_phrases[key] = text.strip()
                else:
                    abort(400, description='Неизвестная фраза')
            fields['phrases'] = saved_phrases
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
        value, group = data.get('value'), data.get('group', '')
        if not isinstance(value, str) or len(value) > 60000 or not isinstance(group, str) or len(group) > 64:
            abort(400)
        value, group = value.strip(), group.strip()
        ids = list(dict.fromkeys(i for i in re.split(r'[\s,]+', value) if i))
        with lock:
            config = settings()
            token = token_for(config)
            if not token:
                abort(400, description='Сначала сохраните токен бота')
            if ids and all(re.fullmatch(r'[0-9]{1,25}', item) for item in ids):
                stickers = []
                for i in range(0, len(ids), 200):
                    stickers += bot_api(token, 'getCustomEmojiStickers', {'custom_emoji_ids': ids[i:i + 200]}) or []
                group = group or 'Отдельные'
            else:
                match = re.fullmatch(r'(?:https://t\.me/addemoji/)?([A-Za-z][A-Za-z0-9_]{0,63})/?', value)
                if not match:
                    abort(400, description='Введите ID эмодзи или ссылку на набор t.me/addemoji')
                found = bot_api(token, 'getStickerSet', {'name': match[1]}) or {}
                stickers = found.get('stickers', [])
                group = group or str(found.get('title') or match[1])[:64]
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
            with db():
                for ident, item in imported.items():
                    db().execute("INSERT INTO telegram_emoji(id,emoji,thumbnail,grp,added) VALUES(?,?,?,?,?) "
                                 "ON CONFLICT(id) DO UPDATE SET emoji=excluded.emoji,thumbnail=excluded.thumbnail,grp=excluded.grp",
                                 (ident, item['emoji'], item['thumbnail'], group, int(time.time())))
        return public_settings(config)

    @app.get('/api/admin/telegram-bot/emoji-catalog')
    @auth(admin=True)
    def emoji_catalog():
        q = request.args.get('q', '').strip().lower()[:64]
        group = request.args.get('group', '')[:64]
        offset = max(0, request.args.get('offset', 0, type=int))
        limit = min(200, max(1, request.args.get('limit', 120, type=int)))
        where, params = [], []
        if group:
            where.append('grp=?')
            params.append(group)
        if q:
            where.append("(id LIKE ? OR emoji=? OR lower(grp) LIKE ?)")
            params += [q + '%', request.args.get('q', '').strip()[:16], '%' + q + '%']
        clause = (' WHERE ' + ' AND '.join(where)) if where else ''
        total = int(db().execute('SELECT COUNT(*) AS n FROM telegram_emoji' + clause, params).fetchone()['n'])
        rows = db().execute('SELECT id,emoji,grp FROM telegram_emoji' + clause + ' ORDER BY grp,added,id LIMIT ? OFFSET ?', params + [limit, offset]).fetchall()
        groups = db().execute("SELECT grp,COUNT(*) AS n FROM telegram_emoji GROUP BY grp ORDER BY grp").fetchall()
        return {'items': [{'id': r['id'], 'emoji': r['emoji'], 'group': r['grp']} for r in rows], 'total': total,
                'all': int(db().execute('SELECT COUNT(*) AS n FROM telegram_emoji').fetchone()['n']),
                'groups': [{'name': r['grp'], 'count': int(r['n'])} for r in groups]}

    @app.post('/api/admin/telegram-bot/emoji/delete')
    @auth(admin=True)
    def delete_emoji():
        data = request.get_json(silent=True) or {}
        with db():
            if isinstance(data.get('group'), str) and data['group']:
                db().execute('DELETE FROM telegram_emoji WHERE grp=?', (data['group'],))
            elif isinstance(data.get('ids'), list) and all(isinstance(i, str) and re.fullmatch(r'[0-9]{1,25}', i) for i in data['ids']):
                for i in data['ids']:
                    db().execute('DELETE FROM telegram_emoji WHERE id=?', (i,))
            else:
                abort(400, description='Укажите группу или список эмодзи')
        audit('Telegram emoji removed')
        return {'ok': True}

    @app.get('/api/admin/telegram-bot/emoji/<emoji_id>')
    @auth(admin=True)
    def emoji_thumbnail(emoji_id):
        config = settings()
        item = db().execute('SELECT thumbnail FROM telegram_emoji WHERE id=?', (emoji_id,)).fetchone()
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
        command = parts[0].lower() if parts else ''
        is_api = command in ('/api', f'/api@{username}')
        if not parts or (command not in ('/start', f'/start@{username}') and not is_api):
            return {'ok': True}
        update_id = update['update_id']
        if db().execute('SELECT 1 FROM telegram_start_updates WHERE bot_id=? AND update_id=?',
                        (bot_id, update_id)).fetchone():
            return {'ok': True}
        if is_api:
            issue = app.extensions.get('crafter_partner_key')
            key = issue(chat['id']) if issue else None
            origin = config['app_url'] or os.getenv('RENDER_EXTERNAL_URL') or os.getenv('PUBLIC_APP_URL') or request.url_root
            docs = origin.rstrip('/') + '/partner-api'
            reply = {'chat_id': chat['id'], 'parse_mode': 'HTML', 'link_preview_options': {'is_disabled': True},
                     'text': render_phrase(config, 'api_key', {'key': escape(key), 'docs': escape(docs)}) if key else render_phrase(config, 'api_denied', {})}
            bot_api(token_for(config), 'sendMessage', reply)
            with db():
                db().execute('INSERT INTO telegram_start_updates VALUES(?, ?, ?) ON CONFLICT DO NOTHING', (bot_id, update_id, int(time.time())))
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
                fallback = escape((config.get('emoji_chars') or {}).get(ident, '⭐'))
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
