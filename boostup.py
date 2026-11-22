"""BoostUp: a Crafter player moves a gift from the Crafter relayer to BoostUp.

Flow (see /boostup-api for the instruction that BoostUp receives):

1. A player sends a gift to the Crafter relayer. The deposit monitor credits it to the player's Crafter inventory and, when this
   integration is on, the bot asks "Куда отправить подарок?" with two buttons: «В маркет» (the Crafter inventory) and «В BoostUp».
2. «В BoostUp» opens the confirmation in the mini app: the gift as a big animation, its name and its price in GRAM; the button
   «Подтвердить» opens a second window «Точно передать?».
3. The player confirms. In ONE transaction the gift leaves the player's inventory and enters the Crafter inventory of the BoostUp account
   (a Crafter account of BoostUp). Nothing is sent through Telegram: no waiting, no Stars, no unknown outcome.
4. Crafter calls BoostUp (a signed webhook, repeated until it answers). BoostUp finds the gift in its Crafter inventory (the ordinary
   Partner API key of that account), puts this NFT into the player's BoostUp inventory and confirms with its deposit key (BUP/...).

Two keys: the ordinary Partner API key (CRT/...) that every player gets from the bot, and this personal key BUP/... for the deposit only.
Nothing is credited to a balance: the gift itself is what BoostUp receives.
"""
import hashlib
import hmac
import ipaddress
import json
import os
import socket
import string
import threading
import time
import uuid
from collections import defaultdict, deque
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from html import escape
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from flask import abort, g, jsonify, render_template, request

from partner_api import plain
from telegram_bot import TelegramUnsure, bot_api, premium_map, send_message, with_premium_emoji

SETTINGS_KEY = 'boostup_v1'
KEY_PREFIX = 'BUP/'
BASE = '/api/boostup/v1'
ALPHABET = string.ascii_letters + string.digits
RATE_LIMIT, RATE_WINDOW = 60, 10.0
DEFAULTS = {'enabled': False, 'webhook_url': '', 'version': 1, 'percent': '100', 'account_id': 0}
BACKOFF = (10, 30, 120, 600, 1800, 3600)          # seconds between webhook attempts; the last value repeats
ACTIVE = ('offered', 'delivered', 'credited', 'returned')
STATUS_TEXT = {
    'offered': 'Ожидает подтверждения игрока',
    'delivered': 'Подарок передан BoostUp, ждём зачисления',
    'credited': 'Подарок зачислен в инвентарь BoostUp',
    'returned': 'Подарок возвращён игроку в инвентарь Crafter',
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def post_webhook(url, headers, body):
    """-> (HTTP status, text of the answer). Redirects are never followed. Network errors are raised."""
    opener = build_opener(NoRedirect)
    try:
        with opener.open(Request(url, data=body, headers=headers, method='POST'), timeout=8) as response:
            return response.status, response.read(4096).decode('utf-8', 'replace')
    except HTTPError as error:
        return error.code, error.read(4096).decode('utf-8', 'replace')


def webhook_allowed(url):
    """https only, and only to addresses of the public internet (the address is set by an administrator, but is never trusted blindly)."""
    parts = urlsplit(str(url or ''))
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
        return False
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)
        return bool(infos) and all(ipaddress.ip_address(item[4][0]).is_global for item in infos)
    except (OSError, ValueError):
        return False


def install_boostup(app, db, auth, audit, record, bot_settings):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS boostup_deposits(
            id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, gift_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
            price_ton TEXT, price_gram TEXT, floor_ton TEXT, percent TEXT, rate TEXT, account_id BIGINT NOT NULL DEFAULT 0,
            attempts INTEGER NOT NULL DEFAULT 0, next_try BIGINT NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
            created BIGINT NOT NULL, updated BIGINT NOT NULL, confirmed BIGINT, delivered BIGINT, credited BIGINT
        );
        CREATE INDEX IF NOT EXISTS boostup_deposits_user ON boostup_deposits(user_id,created);
        CREATE INDEX IF NOT EXISTS boostup_deposits_work ON boostup_deposits(status,next_try);
        CREATE TABLE IF NOT EXISTS boostup_lease(id INTEGER PRIMARY KEY, until BIGINT NOT NULL);
        """)
        db().execute("INSERT INTO boostup_lease VALUES(1,0) ON CONFLICT(id) DO NOTHING")
    try:                                                          # how the gift came: 'relayer' (sent to the relayer, chosen in the bot) or 'transfer' (given inside Crafter)
        with app.app_context(), db():
            db().execute("ALTER TABLE boostup_deposits ADD COLUMN via TEXT NOT NULL DEFAULT 'relayer'")
    except Exception:
        pass                                                      # the column exists already

    # ---------------- settings, deposit key, signing secret ----------------
    def settings():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (SETTINGS_KEY,)).fetchone()
        try:
            data = json.loads(row['payload']) if row else {}
        except (TypeError, ValueError):
            data = {}
        data = data if isinstance(data, dict) else {}
        return {**DEFAULTS, **{key: data[key] for key in DEFAULTS if key in data}}

    def save_settings(data):
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (SETTINGS_KEY, json.dumps(data, ensure_ascii=False)))

    base_secret = hashlib.sha256(('crafter-boostup:' + (app.config.get('BOT_TOKEN') or app.config.get('SECRET_KEY') or 'dev-secret')).encode()).digest()

    def derive(label, version):
        return hmac.new(base_secret, f'{label}:{version}'.encode(), hashlib.sha256).digest()

    def api_token(version):
        number = int.from_bytes(derive('token', version), 'big')
        chars = []
        while len(chars) < 40:
            number, rest = divmod(number, len(ALPHABET))
            chars.append(ALPHABET[rest])
        return KEY_PREFIX + ''.join(chars)

    def signing_secret(version):
        return derive('hook', version).hex()

    def current_keys():
        """The personal key BUP/... and the signing secret that are valid now (for the administrator and for tools/boostup_keys.py)."""
        version = settings()['version']
        return {'token': api_token(version), 'signing_secret': signing_secret(version), 'version': version}

    app.extensions['crafter_boostup_keys'] = current_keys

    def account_view(account_id):
        if not account_id:
            return None
        row = db().execute("SELECT id,name,username FROM users WHERE id=?", (account_id,)).fetchone()
        return {'telegram_id': str(account_id), 'username': (row['username'] if row else None) or None, 'name': (row['name'] if row else None) or None}

    # ---------------- bot helpers ----------------
    def bot_token():
        return bot_settings().get('token') or app.config['BOT_TOKEN']

    def app_url():
        config = bot_settings()
        url = str(config.get('app_url') or os.getenv('RENDER_EXTERNAL_URL', '') or os.getenv('PUBLIC_APP_URL', '')).rstrip('/')
        return url if url.startswith('https://') else ''

    def icon(token, char):
        ident = premium_map(token).get(char)               # the emoji of the GiftNews_icons set, when the set is available
        return {'icon_custom_emoji_id': ident} if ident else {}

    def without_icons(markup):
        rows = [[{k: v for k, v in button.items() if k != 'icon_custom_emoji_id'} for button in row] for row in (markup or {}).get('inline_keyboard', [])]
        return {'inline_keyboard': rows}

    def send(uid, text, buttons=None):
        token = bot_token()
        if not token:
            return None
        message = {'chat_id': uid, 'parse_mode': 'HTML', 'text': text, 'link_preview_options': {'is_disabled': True}}
        if buttons:
            message['reply_markup'] = {'inline_keyboard': buttons}
        try:
            return send_message(token, message)
        except TelegramUnsure:
            app.logger.warning('BoostUp bot message: Telegram did not answer, it is not repeated (it may have been delivered)')
            return {'unsure': True}                              # not None: the message is not sent a second time
        except Exception:
            try:
                if buttons:
                    message['reply_markup'] = without_icons(message['reply_markup'])
                return bot_api(token, 'sendMessage', message)
            except Exception:
                app.logger.warning('BoostUp bot message was not delivered')
                return None

    def edit(callback, text, buttons):
        token = bot_token()
        source = callback.get('message') or {}
        target = {'chat_id': (source.get('chat') or {}).get('id'), 'message_id': source.get('message_id'), 'parse_mode': 'HTML',
                  'link_preview_options': {'is_disabled': True}}
        markup = {'inline_keyboard': buttons}
        for attempt in range(3):
            try:
                body = {**target, 'text': with_premium_emoji(token, text) if attempt == 0 else text, 'reply_markup': markup if attempt < 2 else without_icons(markup)}
                return bot_api(token, 'editMessageText', body)
            except TelegramUnsure:
                return None                                      # an edit may have gone through; the next press shows the real state
            except Exception:
                continue
        app.logger.warning('BoostUp bot message was not edited')

    def gift_link(gift):
        return '<a href="' + escape(str(gift.get('telegram_url') or ''), quote=True) + '">' + escape(str(gift.get('name', '')) + ' #' + str(gift.get('number', ''))) + '</a>'

    def choice_text(gift):
        return '🎁 <b>Подарок получен</b>\n\n' + gift_link(gift) + ' уже у релейера Crafter.\n\n<b>Куда отправить подарок?</b>'

    def choice_buttons(token, offer_id):
        url = app_url()
        row = []
        if url:
            row.append({'text': 'В маркет', 'web_app': {'url': url + '/?view=gifts'}, **icon(token, '🛒')})
        row.append({'text': 'В BoostUp', 'callback_data': 'bu:go:' + offer_id, **icon(token, '🚀')})
        return [row]

    def confirm_text(gift):
        return ('🚀 <b>Отправка подарка в BoostUp</b>\n\n' + gift_link(gift) + '\n\n'
                'Чтобы подтвердить, нажмите кнопку ниже. Откроется окно с этим подарком и его ценой. '
                'Подтвердите передачу в нём: подарок будет передан BoostUp и появится в вашем инвентаре BoostUp.')

    # ---------------- price (information: the gift itself is what BoostUp receives) ----------------
    def gift_value(gift, percent):
        ctx = app.extensions['crafter_pack_ctx']
        import thermos
        canon = ctx['canonical_name']
        wanted = canon(gift.get('name', ''))
        collection = next((c for c in ctx['public_catalog']() if canon(c.get('name', '')) == wanted), None)
        if not collection:
            return None
        try:
            ctx['ensure_listings'](collection, Decimal('0.01'), Decimal('100000000'))      # refreshes the real floor (see thermos.remember_floors)
        except Exception:
            pass
        rate = Decimal(str(ctx['gram_per_ton']()))
        known = thermos._ROBUST.get(thermos.canon(collection['name']))
        ton = known[0] if known and time.time() - known[1] < thermos.ROBUST_TTL else None
        if ton is None:
            try:
                value = Decimal(str(collection.get('floor_price') or '0'))
            except InvalidOperation:
                value = Decimal(0)
            if value > 0:
                ton = value if collection.get('price_unit', 'GRAM') == 'TON' else value / rate
        if not ton or ton <= 0:
            return None
        share = Decimal(str(percent)) / 100
        value_ton = (ton * share).quantize(Decimal('0.01'), ROUND_DOWN)
        if value_ton <= 0:
            return None
        return {'ton': value_ton, 'gram': (value_ton * rate).quantize(Decimal('0.01'), ROUND_DOWN), 'floor_ton': ton.quantize(Decimal('0.01')),
                'percent': str(percent), 'rate': rate}

    # ---------------- views ----------------
    def lottie_of(gift):
        slug = str(gift.get('telegram_slug') or '')
        return '/media/crafter/gift/' + slug + '.json' if slug else ''

    def gift_view(gift):
        return {'gift_id': gift.get('id'), 'name': gift.get('name'), 'number': gift.get('number'), 'collection': gift.get('name'), 'model': gift.get('model') or '',
                'backdrop': gift.get('backdrop') or '', 'symbol': gift.get('symbol') or '', 'slug': gift.get('telegram_slug'),
                'url': gift.get('telegram_url'), 'image': gift.get('image') or ''}

    def value_view(row):
        if not row['price_ton']:
            return None
        return {'ton': plain(row['price_ton']), 'gram': plain(row['price_gram']), 'floor_ton': plain(row['floor_ton']), 'percent': row['percent'],
                'rate_gram_per_ton': plain(row['rate'])}

    def deposit_view(row):
        gift = json.loads(row['payload'])
        user = db().execute("SELECT name,username FROM users WHERE id=?", (row['user_id'],)).fetchone()
        return {'deposit_id': row['id'], 'status': row['status'], 'status_text': STATUS_TEXT.get(row['status'], row['status']),
                'telegram_id': str(row['user_id']), 'username': (user['username'] if user else None) or None, 'name': (user['name'] if user else None) or None,
                'gift': gift_view(gift), 'value': value_view(row), 'account': account_view(row['account_id']),
                'created': row['created'], 'confirmed': row['confirmed'], 'delivered': row['delivered'], 'credited': row['credited'],
                'attempts': row['attempts'], 'note': row['note'] or None, 'via': row.get('via') or 'relayer'}

    def load(deposit_id):
        row = db().execute("SELECT * FROM boostup_deposits WHERE id=?", (deposit_id,)).fetchone()
        return dict(row) if row else None

    def update(deposit_id, **fields):
        fields['updated'] = int(time.time())
        with db():
            db().execute('UPDATE boostup_deposits SET ' + ','.join(key + '=?' for key in fields) + ' WHERE id=?', (*fields.values(), deposit_id))

    wake = threading.Event()

    # ---------------- 1. the offer after a deposit ----------------
    def start_offer(uid, gift):
        """Called by the deposit monitor. True = the question «Куда отправить подарок?» was sent (the standard message is not needed)."""
        config = settings()
        if not config['enabled'] or not config['account_id'] or gift.get('origin') != 'telegram-deposit' or not gift.get('telegram_slug'):
            return False
        token = bot_token()
        if not token:
            return False
        offer_id = 'bu_' + uuid.uuid4().hex[:24]
        now = int(time.time())
        with db():
            db().execute("INSERT INTO boostup_deposits(id,user_id,gift_id,payload,status,account_id,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                         (offer_id, uid, gift['id'], json.dumps(gift, ensure_ascii=False), 'offered', config['account_id'], now, now))
        if send(uid, choice_text(gift), choice_buttons(token, offer_id)) is None:
            with db():
                db().execute("DELETE FROM boostup_deposits WHERE id=?", (offer_id,))
            return False
        return True

    app.extensions['crafter_deposit_notify'] = start_offer

    def on_transfer(sender_id, recipient_id, gifts):
        """The second way of depositing: a player gives a gift to the Crafter account of BoostUp (the button «Передать» in the app or the Partner API).
        The gift is already in the inventory of BoostUp, so the deposit is `delivered` at once and BoostUp is told by the same webhook as for the first way."""
        config = settings()
        try:
            same = bool(config['account_id']) and int(recipient_id) == int(config['account_id'])
        except (TypeError, ValueError):
            same = False
        if not config['enabled'] or not same or sender_id == recipient_id:
            return
        record_transfer(config, sender_id, int(recipient_id), gifts)

    def record_transfer(config, sender_id, recipient_id, gifts, quiet=False):
        now = int(time.time())
        for gift in gifts:
            if gift.get('pack_item') or gift.get('test_only') or gift.get('catalog_only'):
                continue
            if db().execute("SELECT 1 FROM boostup_deposits WHERE user_id=? AND gift_id=? AND status IN ('delivered','credited') AND via='transfer' AND created>=?",
                            (sender_id, gift['id'], now - 3 * 86400)).fetchone():
                continue                                             # this transfer is already a deposit
            try:
                value = gift_value(gift, config['percent'])
            except Exception:
                value = None                                     # the price is only information: the deposit does not wait for it
            deposit_id = 'bu_' + uuid.uuid4().hex[:24]
            with db():
                db().execute("INSERT INTO boostup_deposits(id,user_id,gift_id,payload,status,price_ton,price_gram,floor_ton,percent,rate,account_id,confirmed,delivered,next_try,note,via,created,updated) "
                             "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             (deposit_id, sender_id, gift['id'], json.dumps(gift, ensure_ascii=False), 'delivered',
                              str(value['ton']) if value else None, str(value['gram']) if value else None, str(value['floor_ton']) if value else None,
                              str(value['percent']) if value else None, str(value['rate']) if value else None, recipient_id, now, now, now,
                              'Передача внутри Crafter', 'transfer', now, now))
            try:
                send(sender_id, '🚀 <b>Подарок передан BoostUp</b>\n\n' + gift_link(gift) + ' передан BoostUp. Он сейчас появится в вашем инвентаре BoostUp.')
            except Exception:
                pass
        wake.set()

    app.extensions['crafter_transfer_hook'] = on_transfer
    catch_up_at = [0]

    def catch_up():
        """A safety net for the second way: transfers to the BoostUp account of the last 3 days that did not become a deposit (the hook failed, the server
        restarted in the middle of the request, the account was set later) are registered now. A gift that is no longer with BoostUp is skipped."""
        if time.time() - catch_up_at[0] < 30:
            return
        catch_up_at[0] = time.time()
        config = settings()
        if not config['enabled'] or not config['account_id']:
            return
        account = int(config['account_id'])
        user = db().execute("SELECT username FROM users WHERE id=?", (account,)).fetchone()
        if not user or not user['username']:
            return
        rows = db().execute("SELECT user_id,payload,created FROM history WHERE kind='transfer' AND created>=? AND payload LIKE ? ORDER BY created",
                            (int(time.time()) - 3 * 86400, '%' + json.dumps(user['username'])[1:-1] + '%')).fetchall()
        for row in rows:
            try:
                data = json.loads(row['payload'])
            except (TypeError, ValueError):
                continue
            if data.get('boostup') or str((data.get('recipient') or {}).get('username', '')).casefold() != user['username'].casefold():
                continue
            fresh = []
            for gift in data.get('gifts') or []:
                held = db().execute("SELECT status FROM inventory WHERE user_id=? AND nft_id=?", (account, gift.get('id'))).fetchone()
                done = db().execute("SELECT 1 FROM boostup_deposits WHERE user_id=? AND gift_id=? AND created>=?", (row['user_id'], gift.get('id'), int(row['created']) - 120)).fetchone()
                if held and held['status'] == 'unlisted' and not done:
                    fresh.append(gift)
            if fresh:
                record_transfer(config, row['user_id'], account, fresh)

    # ---------------- 2. buttons of the bot ----------------
    def on_callback(callback):
        parts = str(callback.get('data') or '').split(':')
        if len(parts) != 3 or parts[0] != 'bu':
            return
        token, sender = bot_token(), (callback.get('from') or {}).get('id')

        def answer(text='', alert=False):
            try:
                bot_api(token, 'answerCallbackQuery', {'callback_query_id': callback.get('id'), 'text': text, 'show_alert': alert})
            except Exception:
                pass

        row = load(parts[2])
        if not row or row['user_id'] != sender:
            return answer('Это предложение не найдено', True)
        if row['status'] != 'offered':
            return answer(STATUS_TEXT.get(row['status'], 'Уже обработано'), True)
        gift = json.loads(row['payload'])
        still_here = db().execute("SELECT 1 FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'", (row['user_id'], row['gift_id'])).fetchone()
        if not still_here:
            return answer('Этого подарка уже нет в вашем инвентаре Crafter', True)
        answer()
        if parts[1] == 'go':
            url = app_url()
            if not url:
                return answer('Окно подтверждения сейчас недоступно', True)
            edit(callback, confirm_text(gift), [
                [{'text': 'Открыть подтверждение', 'web_app': {'url': url + '/boostup/confirm?offer=' + row['id']}, **icon(token, '✅')}],
                [{'text': 'Назад', 'callback_data': 'bu:back:' + row['id'], **icon(token, '↩️')}]])
        elif parts[1] == 'back':
            edit(callback, choice_text(gift), choice_buttons(token, row['id']))

    app.extensions['crafter_bot_callback'] = on_callback

    # ---------------- 3. the mini app: the confirmation ----------------
    @app.get('/boostup/confirm')
    def confirm_page():
        response = app.make_response(render_template('boostup_confirm.html'))
        response.headers['Cache-Control'] = 'no-store'
        return response

    def own_offer(deposit_id):
        row = load(deposit_id)
        if not row or row['user_id'] != g.user['id']:
            abort(404, description='Предложение не найдено')
        return row

    def offer_reply(row, value=None):
        gift = json.loads(row['payload'])
        shown = value_view(row) if row['price_ton'] else (
            {'ton': plain(value['ton']), 'gram': plain(value['gram']), 'floor_ton': plain(value['floor_ton']), 'percent': value['percent'],
             'rate_gram_per_ton': plain(value['rate'])} if value else None)
        return {'ok': True, 'id': row['id'], 'status': row['status'], 'status_text': STATUS_TEXT.get(row['status'], row['status']), 'gift': gift_view(gift),
                'lottie': lottie_of(gift), 'value': shown, 'can_confirm': row['status'] == 'offered' and bool(shown), 'note': row['note'] or ''}

    @app.get('/api/boostup/offer/<offer_id>')
    @auth()
    def offer_get(offer_id):
        row = own_offer(offer_id)
        value = gift_value(json.loads(row['payload']), settings()['percent']) if row['status'] == 'offered' else None
        return offer_reply(row, value)

    @app.post('/api/boostup/offer/<offer_id>/confirm')
    @auth()
    def offer_confirm(offer_id):
        row = own_offer(offer_id)
        if row['status'] != 'offered':
            return offer_reply(row)                              # a repeated tap: the same answer, nothing happens twice
        config = settings()
        if not config['enabled'] or not config['account_id']:
            abort(409, description='Передача в BoostUp сейчас отключена')
        account = int(config['account_id'])
        gift = json.loads(row['payload'])
        value = gift_value(gift, config['percent'])
        if not value:
            abort(409, description='Цена подарка пока не определена. Попробуйте чуть позже')
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            fresh = db().execute("SELECT status FROM boostup_deposits WHERE id=?", (offer_id,)).fetchone()
            if not fresh or fresh['status'] != 'offered':
                abort(409, description='Предложение уже обработано')
            owned = db().execute("SELECT status FROM inventory WHERE user_id=? AND nft_id=?", (row['user_id'], row['gift_id'])).fetchone()
            if not owned or owned['status'] != 'unlisted':
                abort(409, description='Этого подарка уже нет в вашем инвентаре Crafter')
            receiver = db().execute("SELECT name,username FROM users WHERE id=?", (account,)).fetchone()
            if not receiver:
                abort(409, description='Аккаунт BoostUp в Crafter не найден')
            if db().execute("SELECT 1 FROM inventory WHERE user_id=? AND nft_id=?", (account, row['gift_id'])).fetchone():
                abort(409, description='Этот подарок уже есть у BoostUp')
            # the whole move is one transaction: the gift is either with the player or with BoostUp, never nowhere
            db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'", (row['user_id'], row['gift_id']))
            db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted')", (account, row['gift_id'], row['payload']))
            db().execute("UPDATE boostup_deposits SET status='delivered',price_ton=?,price_gram=?,floor_ton=?,percent=?,rate=?,account_id=?,confirmed=?,delivered=?,updated=?,next_try=? WHERE id=?",
                         (str(value['ton']), str(value['gram']), str(value['floor_ton']), str(value['percent']), str(value['rate']), account, now, now, now, now, offer_id))
            sender = {'name': g.user.get('first_name', ''), 'username': g.user.get('username', '')}
            record('transfer', {'gifts': [gift], 'recipient': {'name': receiver['name'], 'username': receiver['username']}, 'message': '', 'boostup': offer_id}, uid=row['user_id'])
            record('gift_received', {'gifts': [gift], 'sender': sender, 'message': '', 'boostup': offer_id}, uid=account)
        send(row['user_id'], '🚀 <b>Подарок передан BoostUp</b>\n\n' + gift_link(gift) + ' передан BoostUp. Он сейчас появится в вашем инвентаре BoostUp.')
        wake.set()
        return offer_reply(load(offer_id))

    # ---------------- 4. BoostUp is told ----------------
    def webhook_body(row):
        view = deposit_view(row)
        return {'event': 'deposit.delivered', **{key: view[key] for key in ('deposit_id', 'telegram_id', 'username', 'name', 'gift', 'value', 'account',
                                                                              'via', 'created', 'confirmed', 'delivered')}}

    def sign(config, raw):
        stamp = str(int(time.time()))
        digest = hmac.new(signing_secret(config['version']).encode(), stamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        return {'Content-Type': 'application/json', 'User-Agent': 'Crafter-BoostUp/1', 'X-Crafter-Timestamp': stamp,
                'X-Crafter-Signature': 'sha256=' + digest}

    def notify_boostup(row):
        """delivered -> credited when BoostUp answers {"ok": true}; otherwise it is repeated (10 s, 30 s, 2 min, 10 min, 30 min, then hourly)."""
        if not row or row['status'] != 'delivered':
            return
        config = settings()
        attempts = row['attempts'] + 1

        def later(note):
            update(row['id'], attempts=attempts, next_try=int(time.time()) + BACKOFF[min(attempts - 1, len(BACKOFF) - 1)], note=note[:300])

        if not webhook_allowed(config['webhook_url']):
            return later('Адрес webhook BoostUp не задан или недопустим')
        raw = json.dumps(webhook_body(row), ensure_ascii=False, separators=(',', ':')).encode()
        try:
            status, text = post_webhook(config['webhook_url'], {**sign(config, raw), 'X-Crafter-Event': 'deposit.delivered'}, raw)
        except Exception as error:
            return later('BoostUp не ответил: ' + type(error).__name__)
        try:
            answer = json.loads(text) if text else {}
        except ValueError:
            answer = {}
        if 200 <= status < 300 and isinstance(answer, dict) and answer.get('ok') is True:
            return mark_credited(row['id'], answer.get('external_id'))
        later('BoostUp ответил HTTP %d' % status)

    def mark_credited(deposit_id, external=None):
        row = load(deposit_id)
        if not row or row['status'] != 'delivered':
            return False
        update(deposit_id, status='credited', credited=int(time.time()), note=('BoostUp: ' + str(external))[:300] if external else '')
        gift = json.loads(row['payload'])
        send(row['user_id'], '✅ <b>Подарок в инвентаре BoostUp</b>\n\n' + gift_link(gift) + ' зачислен в ваш инвентарь BoostUp.')
        return True

    def process():
        """One pass of the worker: repeats the calls to BoostUp. Safe to call repeatedly (a database lease)."""
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            got = db().execute('UPDATE boostup_lease SET until=? WHERE id=1 AND until<=?', (now + 120, now)).rowcount
        if not got:
            return {'busy': True}
        done = 0
        try:
            try:
                catch_up()
            except Exception:
                app.logger.warning('BoostUp catch-up failed', exc_info=True)
            rows = db().execute("SELECT * FROM boostup_deposits WHERE status='delivered' AND next_try<=? ORDER BY created LIMIT 10", (now,)).fetchall()
            for row in rows:
                try:
                    notify_boostup(dict(row))
                    done += 1
                except Exception as error:
                    app.logger.warning('BoostUp step failed: %s', type(error).__name__)
        finally:
            with db():
                db().execute('UPDATE boostup_lease SET until=0 WHERE id=1')
        return {'processed': done}

    app.extensions['crafter_boostup_process'] = process

    def worker():
        while True:
            wake.wait(timeout=10)
            wake.clear()
            try:
                with app.app_context():
                    process()
            except Exception:
                app.logger.warning('BoostUp worker failed')

    if not app.config.get('TESTING'):
        threading.Thread(target=worker, daemon=True, name='boostup-worker').start()

    # ---------------- API for BoostUp: the personal deposit key BUP/... ----------------
    hits, hits_lock = defaultdict(deque), threading.Lock()

    def api_error(status, code, message):
        response = jsonify({'ok': False, 'error': message, 'code': code})
        response.status_code = status
        if status == 429:
            response.headers['Retry-After'] = '10'
        abort(response)

    def authorize():
        header = request.headers.get('Authorization', '')
        if request.headers.get('Origin'):
            api_error(403, 'browser_forbidden', 'API работает только с серверов: уберите заголовок Origin')
        if not header.startswith('Bearer ' + KEY_PREFIX):
            api_error(401, 'unauthorized', 'Передайте ключ пополнения: Authorization: Bearer BUP/…')
        config = settings()
        if not hmac.compare_digest(header[7:].strip().encode(), api_token(config['version']).encode()):
            api_error(401, 'unauthorized', 'Ключ не подходит или заменён')
        if not config['enabled']:
            api_error(403, 'disabled', 'Интеграция сейчас отключена')
        now = time.monotonic()
        with hits_lock:
            queue = hits['api']
            while queue and now - queue[0] > RATE_WINDOW:
                queue.popleft()
            if len(queue) >= RATE_LIMIT:
                api_error(429, 'rate_limited', f'Не больше {RATE_LIMIT} запросов за {int(RATE_WINDOW)} секунд')
            queue.append(now)
        return config

    def api(fn):
        def run(*args, **kwargs):
            authorize()
            return fn(*args, **kwargs)
        run.__name__ = fn.__name__
        return run

    @app.get(BASE + '/ping')
    @api
    def api_ping():
        config = settings()
        return jsonify({'ok': True, 'enabled': config['enabled'], 'webhook_configured': bool(config['webhook_url']), 'account': account_view(config['account_id'])})

    @app.get(BASE + '/deposits')
    @api
    def api_deposits():
        status = request.args.get('status', '')
        if status and status not in ACTIVE:
            api_error(400, 'bad_request', 'status: ' + ', '.join(ACTIVE[1:]))
        try:
            limit, after = max(1, min(100, int(request.args.get('limit', 50)))), int(request.args.get('after', 0))
        except ValueError:
            api_error(400, 'bad_request', 'limit и after — целые числа')
        query = "SELECT * FROM boostup_deposits WHERE status!='offered' AND created>=?" + (" AND status=?" if status else '') + " ORDER BY created DESC LIMIT ?"
        args = (after, status, limit) if status else (after, limit)
        return jsonify({'ok': True, 'deposits': [deposit_view(dict(row)) for row in db().execute(query, args).fetchall()]})

    @app.get(BASE + '/deposits/<deposit_id>')
    @api
    def api_deposit(deposit_id):
        row = load(deposit_id)
        if not row or row['status'] == 'offered':
            api_error(404, 'deposit_not_found', 'Такого пополнения нет')
        return jsonify({'ok': True, 'deposit': deposit_view(row)})

    @app.post(BASE + '/deposits/<deposit_id>/ack')
    @api
    def api_ack(deposit_id):
        row = load(deposit_id)
        if not row or row['status'] == 'offered':
            api_error(404, 'deposit_not_found', 'Такого пополнения нет')
        body = request.get_json(silent=True) or {}
        if row['status'] == 'credited':
            return jsonify({'ok': True, 'status': 'credited', 'repeat': True})
        if row['status'] != 'delivered':
            api_error(409, 'not_delivered', 'Это пополнение нельзя подтвердить: статус ' + row['status'])
        mark_credited(deposit_id, str(body.get('external_id') or '')[:100] or None)
        return jsonify({'ok': True, 'status': 'credited'})

    # ---------------- administration ----------------
    def admin_view():
        config = settings()
        counts = {row['status']: row['n'] for row in db().execute("SELECT status,count(*) n FROM boostup_deposits GROUP BY status")}
        rows = [deposit_view(dict(row)) for row in db().execute("SELECT * FROM boostup_deposits WHERE status!='offered' ORDER BY created DESC LIMIT 40").fetchall()]
        origin = app_url() or request.url_root.rstrip('/')
        return {'ok': True, 'settings': {key: config[key] for key in ('enabled', 'webhook_url', 'percent')}, 'account': account_view(config['account_id']),
                'token': api_token(config['version']), 'signing_secret': signing_secret(config['version']), 'docs': origin + '/boostup-api',
                'api': origin + BASE, 'counts': counts, 'deposits': rows}

    @app.get('/api/admin/boostup')
    @auth(admin=True)
    def admin_get():
        return admin_view()

    def refresh_bot_updates():
        """Buttons of the bot arrive as callback_query: the webhook of the bot must ask Telegram for them."""
        config = bot_settings()
        token = bot_token()
        if token and config.get('webhook_url') and config.get('secret'):
            bot_api(token, 'setWebhook', {'url': config['webhook_url'], 'secret_token': config['secret'],
                                          'allowed_updates': ['message', 'callback_query'], 'max_connections': 1})

    def find_account(raw):
        text = str(raw or '').strip().lstrip('@')
        if text.isdigit():
            row = db().execute("SELECT id FROM users WHERE id=?", (int(text),)).fetchone()
        else:
            row = db().execute("SELECT id FROM users WHERE lower(username)=lower(?)", (text,)).fetchone() if text else None
        if not row:
            abort(400, description='Этот аккаунт ещё не открывал Crafter: откройте приложение с аккаунта BoostUp и повторите')
        return int(row['id'])

    @app.post('/api/admin/boostup')
    @auth(admin=True)
    def admin_save():
        body = request.get_json(silent=True) or {}
        if body.get('confirm') != 'SET_BOOSTUP':
            abort(400, description='Подтвердите изменение')
        config = settings()
        if type(body.get('enabled')) is bool:
            config['enabled'] = body['enabled']
        if 'webhook_url' in body:
            url = str(body['webhook_url'] or '').strip()
            if url and not webhook_allowed(url):
                abort(400, description='Адрес webhook должен быть https и вести на публичный сервер')
            config['webhook_url'] = url
        if 'percent' in body:
            try:
                percent = Decimal(str(body['percent']))
            except InvalidOperation:
                abort(400, description='Процент — число')
            if not percent.is_finite() or not Decimal('1') <= percent <= Decimal('100'):
                abort(400, description='Процент от флора: от 1 до 100')
            config['percent'] = plain(percent)
        if str(body.get('account') or '').strip():
            config['account_id'] = find_account(body['account'])
        if config['enabled'] and not config['webhook_url']:
            abort(400, description='Сначала укажите адрес webhook BoostUp')
        if config['enabled'] and not config['account_id']:
            abort(400, description='Сначала укажите аккаунт BoostUp в Crafter (Telegram ID или @username)')
        save_settings(config)
        warning = ''
        if config['enabled']:
            try:
                refresh_bot_updates()
            except Exception:
                warning = 'Настройки сохранены, но Telegram не принял обновление webhook бота: нажмите «Подключить» в разделе бота'
        audit('BoostUp settings saved')
        return {**admin_view(), 'warning': warning}

    @app.post('/api/admin/boostup/rotate')
    @auth(admin=True)
    def admin_rotate():
        if (request.get_json(silent=True) or {}).get('confirm') != 'ROTATE_BOOSTUP':
            abort(400, description='Подтвердите замену ключа')
        config = settings()
        config['version'] = int(config['version']) + 1
        save_settings(config)
        audit('BoostUp key rotated')
        return admin_view()

    @app.post('/api/admin/boostup/test')
    @auth(admin=True)
    def admin_test():
        config = settings()
        if not webhook_allowed(config['webhook_url']):
            abort(400, description='Адрес webhook не задан или недопустим')
        raw = json.dumps({'event': 'ping', 'sent': int(time.time())}, separators=(',', ':')).encode()
        try:
            status, text = post_webhook(config['webhook_url'], {**sign(config, raw), 'X-Crafter-Event': 'ping'}, raw)
        except Exception as error:
            return {'ok': False, 'error': 'BoostUp не ответил: ' + type(error).__name__}
        return {'ok': 200 <= status < 300, 'status': status, 'answer': text[:300]}

    @app.post('/api/admin/boostup/deposits/<deposit_id>/retry')
    @auth(admin=True)
    def admin_retry(deposit_id):
        row = load(deposit_id)
        if not row or row['status'] != 'delivered':
            abort(409, description='Это пополнение не ждёт повторной отправки')
        update(deposit_id, next_try=int(time.time()))
        wake.set()
        return {'ok': True}

    @app.post('/api/admin/boostup/deposits/<deposit_id>/return')
    @auth(admin=True)
    def admin_return(deposit_id):
        row = load(deposit_id)
        if (request.get_json(silent=True) or {}).get('confirm') != 'RETURN_BOOSTUP':
            abort(400, description='Подтвердите возврат')
        if not row or row['status'] != 'delivered':
            abort(409, description='Вернуть можно только подарок, который BoostUp ещё не зачислил')
        gift = json.loads(row['payload'])
        with db():
            db().execute('BEGIN IMMEDIATE')
            held = db().execute("SELECT status FROM inventory WHERE user_id=? AND nft_id=?", (row['account_id'], row['gift_id'])).fetchone()
            if not held or held['status'] != 'unlisted':
                abort(409, description='Подарка нет в свободном инвентаре аккаунта BoostUp: он выставлен, продан или выведен')
            db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'", (row['account_id'], row['gift_id']))
            db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted') ON CONFLICT DO NOTHING", (row['user_id'], row['gift_id'], row['payload']))
            db().execute("UPDATE boostup_deposits SET status='returned',note=?,updated=? WHERE id=?", ('Возврат администратором', int(time.time()), deposit_id))
            record('gift_received', {'gifts': [gift], 'sender': {'name': 'BoostUp', 'username': ''}, 'message': '', 'boostup': deposit_id}, uid=row['user_id'])
        audit('BoostUp deposit ' + deposit_id + ' returned to the player')
        send(row['user_id'], '↩️ <b>Подарок не отправлен в BoostUp</b>\n\n' + gift_link(gift) + ' вернулся в ваш инвентарь Crafter.')
        return {'ok': True}

    # ---------------- the instruction for BoostUp ----------------
    @app.get('/boostup-api')
    def boostup_docs():
        config = settings()
        account = account_view(config['account_id'])
        origin = request.url_root.rstrip('/')
        return render_template('boostup_api.html', base=origin + BASE, site=origin, partner_base=origin + '/api/partner/v1',
                               account=('@' + account['username']) if account and account['username'] else (account['telegram_id'] if account else 'аккаунт BoostUp'),
                               limit=RATE_LIMIT, window=int(RATE_WINDOW), bot=app.config.get('BOT_USERNAME') or 'crafter_app')

    return settings
