"""Telegram NFT deposit monitor: read-only MTProto account, durable encrypted session.

The worker only observes received collectible gifts. It NEVER transfers,
converts, sells or otherwise acts on gifts in the Telegram account.
"""
import asyncio
import json
import os
import re
import threading
import time
from html import escape

from cryptography.fernet import Fernet, InvalidToken
from flask import abort, request
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession
from telethon.tl import functions, types

from telegram_bot import bot_api


def gift_payload(entry):
    """Build a Crafter gift from Telegram's authoritative unique-gift slug."""
    item = getattr(entry, 'gift', None)
    slug = str(getattr(item, 'slug', '') or '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{4,120}', slug):
        return None
    title = str(getattr(item, 'title', '') or '').strip()
    number = int(getattr(item, 'num', 0) or 0)
    if not title or number <= 0:
        return None
    model = symbol = backdrop = ''
    background = {}
    for attribute in (getattr(item, 'attributes', None) or ()):
        kind = type(attribute).__name__
        if kind == 'StarGiftAttributeModel':
            model = str(getattr(attribute, 'name', '') or '')
        elif kind == 'StarGiftAttributePattern':
            symbol = str(getattr(attribute, 'name', '') or '')
        elif kind == 'StarGiftAttributeBackdrop':
            backdrop = str(getattr(attribute, 'name', '') or '')
            background = {
                'name': backdrop,
                'center_color': getattr(attribute, 'center_color', 0),
                'edge_color': getattr(attribute, 'edge_color', 0),
                'pattern_color': getattr(attribute, 'pattern_color', 0),
                'text_color': getattr(attribute, 'text_color', 0),
            }
    return dict(
        id='telegram-' + slug.lower(),
        name=title, collection_id=re.sub(r'[^a-z0-9]', '', title.lower()),
        number=number, source_number=number, model=model, symbol=symbol,
        backdrop=backdrop, background=background, price='0', floor_price='0',
        price_unit='GRAM', origin='telegram-deposit',
        telegram_slug=slug, telegram_url='https://t.me/nft/' + slug,
        image='https://nft.fragment.com/gift/' + slug.lower() + '.webp',
    )


def sender_user_id(entry):
    """Do not trust displayed usernames or guess identity of anonymous senders."""
    peer = getattr(entry, 'from_id', None)
    if isinstance(peer, types.PeerUser):
        return int(peer.user_id)
    return None


async def with_client(api_id, api_hash, session, operation):
    client = TelegramClient(StringSession(session), api_id, api_hash,
                            connection_retries=1, request_retries=1, timeout=12)
    await client.connect()
    try:
        return await operation(client)
    finally:
        await client.disconnect()


async def fetch_received(api_id, api_hash, session):
    async def read(client):
        if not await client.is_user_authorized():
            raise ValueError('Telegram-сессия недействительна: подключите аккаунт заново')
        me = await client.get_me()
        records = []
        offset = ''
        # Page through the entire collection, including unsaved gifts.
        # Never silently interpret a truncated page set as a full baseline.
        for _ in range(100):
            result = await client(functions.payments.GetSavedStarGiftsRequest(
                peer=types.InputPeerSelf(), offset=offset, limit=100,
                exclude_hosted=True,
            ))
            records.extend(result.gifts)
            next_offset = getattr(result, 'next_offset', None)
            if not next_offset or next_offset == offset:
                return int(me.id), (getattr(me, 'username', '') or ''), records
            offset = next_offset
        raise ValueError('Слишком много подарков для одной сверки (>10 000)')
    return await with_client(api_id, api_hash, session, read)


def install_telegram_deposits(app, db, auth, audit, record, bot_settings):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS telegram_gift_receipts (
              slug TEXT PRIMARY KEY, sender_id INTEGER, recipient_id INTEGER,
              status TEXT NOT NULL, payload TEXT NOT NULL, received INTEGER NOT NULL,
              processed INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS telegram_gift_monitor (
              id INTEGER PRIMARY KEY, lease_until INTEGER NOT NULL DEFAULT 0,
              last_scan INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
            );
        """)
        db().execute("""INSERT INTO telegram_gift_monitor(id,lease_until,last_scan,last_error)
                        VALUES(1,0,0,'') ON CONFLICT(id) DO NOTHING""")

    def config():
        row = db().execute("SELECT payload FROM settings WHERE key='telegram_deposit_connection'").fetchone()
        return json.loads(row[0]) if row else {}

    def save(settings):
        db().execute("""INSERT INTO settings(key,payload) VALUES('telegram_deposit_connection',?)
                        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
                     (json.dumps(settings),))
        db().commit()

    def credentials():
        # Operator-supplied credentials override legacy Render environment variables.
        # Both are encrypted in the existing persistent settings database.
        c = config()
        if c.get('api_id_encrypted') and c.get('api_hash_encrypted'):
            value = decrypt(c['api_id_encrypted'])
            secret = decrypt(c['api_hash_encrypted'])
        else:
            value = os.getenv('TELEGRAM_API_ID', '').strip()
            secret = os.getenv('TELEGRAM_API_HASH', '').strip()
        if not re.fullmatch(r'[1-9][0-9]{0,15}', value) or not re.fullmatch(r'[a-fA-F0-9]{32}', secret):
            raise ValueError('Укажите API ID и API Hash в разделе Relayer')
        return int(value), secret.lower()

    def cipher():
        key = os.getenv('TELEGRAM_SESSION_KEY', '').strip()
        if not key:
            raise ValueError('Задайте TELEGRAM_SESSION_KEY в Render (Fernet-ключ)')
        try:
            return Fernet(key.encode('ascii'))
        except (ValueError, TypeError):
            raise ValueError('TELEGRAM_SESSION_KEY должен быть Fernet-ключом')

    def encrypt(value):
        return cipher().encrypt(value.encode()).decode()

    def decrypt(value):
        try:
            return cipher().decrypt(value.encode()).decode()
        except (InvalidToken, ValueError):
            raise ValueError('Не удалось расшифровать сессию. Проверьте TELEGRAM_SESSION_KEY')

    def available():
        c = config()
        stored = bool(c.get('api_id_encrypted') and c.get('api_hash_encrypted'))
        env = bool(os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH'))
        return bool(os.getenv('TELEGRAM_SESSION_KEY')) and (stored or env)

    def status():
        c = config()
        mon = db().execute('SELECT last_scan,last_error,lease_until FROM telegram_gift_monitor WHERE id=1').fetchone()
        counts = {r['status']: r['count'] for r in db().execute(
            'SELECT status,count(*) count FROM telegram_gift_receipts GROUP BY status')}
        return dict(
            configured=available(), connected=bool(c.get('session')),
            api_credentials_source=('relayer' if c.get('api_id_encrypted') and c.get('api_hash_encrypted')
                                    else 'render' if os.getenv('TELEGRAM_API_ID') and os.getenv('TELEGRAM_API_HASH')
                                    else 'missing'),
            session_key_configured=bool(os.getenv('TELEGRAM_SESSION_KEY')),
            notification_emoji=c.get('notification_emoji') or '🎁',
            account_id=c.get('account_id'), account_name=c.get('account_name', ''),
            account_username=c.get('account_username', ''),
            baseline_done=bool(c.get('baseline_done')),
            phone_pending=bool(c.get('pending') and int(c['pending'].get('created', 0)) > time.time() - 600),
            last_scan=mon['last_scan'] if mon else 0,
            last_error=mon['last_error'] if mon else '',
            checking=bool(mon and mon['lease_until'] > time.time()),
            totals=counts,
        )

    def notify(uid, gift):
        settings = bot_settings()
        token = settings.get('token') or app.config['BOT_TOKEN']
        if not token:
            return
        url = escape(gift['telegram_url'], quote=True)
        label = escape(gift['name'] + ' #' + str(gift['number']))
        emoji = escape(config().get('notification_emoji') or '🎁')
        msg = dict(chat_id=uid, parse_mode='HTML', disable_web_page_preview=True,
                   text=f"{emoji} <a href=\"{url}\">{label}</a> just passed through the crafter.\n\n"
                        "It's now in your inventory — go take a look.")
        app_url = settings.get('app_url') or os.getenv('RENDER_EXTERNAL_URL', '')
        if app_url.startswith('https://'):
            from urllib.parse import urlsplit, parse_qsl, urlencode
            u = urlsplit(app_url)
            q = dict(parse_qsl(u.query))
            q['view'] = 'gifts'
            dest = u._replace(query=urlencode(q)).geturl()
            msg['reply_markup'] = {'inline_keyboard': [[
                {'text': 'View in Inventory', 'web_app': {'url': dest}}]]}
        bot_api(token, 'sendMessage', msg)

    def scan():
        api_id, api_hash = credentials()
        c = config()
        if not c.get('session'):
            raise ValueError('Подключите аккаунт Telegram')
        account_id, account_username, received = asyncio.run(fetch_received(api_id, api_hash, decrypt(c['session'])))
        if int(account_id) != int(c['account_id']):
            raise ValueError('Telegram-сессия авторизована от другого аккаунта')
        if c.get('account_username') != account_username:
            c['account_username'] = account_username
            save(c)
        # Baseline: items already owned when monitoring is first enabled are not deposits.
        baseline = not c.get('baseline_done')
        added = []
        seen = 0
        for entry in sorted(received, key=lambda x: getattr(x, 'date', 0) or 0):
            if getattr(entry, 'refunded', False):
                continue
            gift = gift_payload(entry)
            if gift is None:
                continue  # Only collectible gifts with an original Telegram slug.
            seen += 1
            sender = sender_user_id(entry)
            received_at = getattr(entry, 'date', None)
            if hasattr(received_at, 'timestamp'):
                received_at = int(received_at.timestamp())
            elif not isinstance(received_at, int):
                received_at = int(time.time())
            with db():
                db().execute('BEGIN IMMEDIATE')
                exists = db().execute('SELECT 1 FROM telegram_gift_receipts WHERE slug=?',
                                      (gift['telegram_slug'],)).fetchone()
                if exists:
                    continue
                # A sender without a verified numeric Telegram ID cannot be attributed.
                registered = (sender is not None and
                              db().execute('SELECT 1 FROM users WHERE id=?', (sender,)).fetchone())
                inventory_exists = db().execute(
                    'SELECT 1 FROM inventory WHERE nft_id=? LIMIT 1', (gift['id'],)).fetchone()
                status_code = ('baseline' if baseline else
                               'duplicate' if inventory_exists else
                               'credited' if registered else
                               'unmatched' if sender else 'anonymous')
                recipient = sender if status_code == 'credited' else None
                db().execute("""INSERT INTO telegram_gift_receipts
                  (slug,sender_id,recipient_id,status,payload,received,processed)
                  VALUES(?,?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING""",
                             (gift['telegram_slug'], sender, recipient, status_code,
                              json.dumps(gift), received_at, int(time.time())))
                if recipient:
                    db().execute('INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)',
                                 (recipient, gift['id'], json.dumps(gift), 'unlisted'))
                    record('gift_received', dict(gifts=[gift], sender={'name': 'Telegram deposit',
                           'username': ''}, telegram=True), uid=recipient)
                    added.append((recipient, gift))
        if baseline:
            c['baseline_done'] = True
            save(c)
        with db():
            db().execute('UPDATE telegram_gift_monitor SET last_scan=?,last_error=? WHERE id=1',
                         (int(time.time()), ''))
        for uid, gift in added:
            try:
                notify(uid, gift)
            except Exception:
                app.logger.warning('Telegram NFT deposit notification failed for gift %s', gift['telegram_slug'])
        return dict(ok=True, scanned=seen, credited=len(added), initial_baseline=baseline)

    def run_scan():
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            locked = db().execute(
                'UPDATE telegram_gift_monitor SET lease_until=? WHERE id=1 AND lease_until<=?',
                (now + 150, now)).rowcount
        if not locked:
            return dict(ok=False, busy=True)
        try:
            return scan()
        except Exception as error:
            description = str(error)[:180]
            app.logger.warning('Telegram gift monitor: %s', type(error).__name__)
            with db():
                db().execute('UPDATE telegram_gift_monitor SET last_error=? WHERE id=1',
                             (description,))
            raise
        finally:
            with db():
                db().execute('UPDATE telegram_gift_monitor SET lease_until=0 WHERE id=1')

    @app.get('/api/telegram-deposits/receiver')
    @auth()
    def public_deposit_recipient():
        # Show only the public destination handle; never expose phone, API keys or MTProto session.
        c = config()
        username = str(c.get('account_username') or '').strip().lstrip('@')
        valid = bool(re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{4,31}', username))
        # Do not direct valuable gifts to a receiver before initial reconciliation.
        configured = bool(c.get('session')) and available() and valid
        connected = configured and bool(c.get('baseline_done'))
        response = app.json.response({
            'connected': connected,
            'username': username if connected else '',
            'display_name': 'Crafter Relayer',
            'status': 'ready' if connected else 'initial_sync' if configured else 'not_connected',
        })
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/admin/telegram-deposits')
    @auth(admin=True)
    def deposit_status():
        return status()

    @app.get('/api/admin/telegram-deposits/history')
    @auth(admin=True)
    def deposit_history():
        rows = db().execute('SELECT * FROM telegram_gift_receipts ORDER BY processed DESC LIMIT 100')
        return {'items': [
            dict(slug=r['slug'], sender_id=r['sender_id'], recipient_id=r['recipient_id'],
                 status=r['status'], gift=json.loads(r['payload']),
                 received=r['received'], processed=r['processed']) for r in rows]}

    @app.post('/api/admin/telegram-deposits/credentials')
    @auth(admin=True)
    def save_credentials():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400, description='Некорректные настройки Relayer')
        api_id = str(data.get('api_id') or '').strip()
        api_hash = str(data.get('api_hash') or '').strip()
        emoji = data.get('emoji')
        if (api_id or api_hash) and (not re.fullmatch(r'[1-9][0-9]{0,15}', api_id)
                                    or not re.fullmatch(r'[a-fA-F0-9]{32}', api_hash)):
            abort(400, description='Для подключения укажите API ID (число) и API Hash (32 символа)')
        if emoji is not None:
            if (not isinstance(emoji, str) or not 1 <= len(emoji.strip()) <= 16
                    or any(ord(char) < 32 or char in '<>' for char in emoji)):
                abort(400, description='Эмодзи должно быть не длиннее 16 символов, без разметки')
        if not api_id and not api_hash and emoji is None:
            abort(400, description='Заполните поля для сохранения')
        c = config()
        if api_id and api_hash:
            pending_login = c.get('pending') or {}
            if c.get('session') or int(pending_login.get('created', 0)) > time.time() - 600:
                abort(409, description='Перед изменением API ID и API Hash отключите Telegram или завершите вход')
            try:
                c['api_id_encrypted'] = encrypt(api_id)
                c['api_hash_encrypted'] = encrypt(api_hash.lower())
            except ValueError:
                abort(409, description='На сервере не задан корректный TELEGRAM_SESSION_KEY')
        if emoji is not None:
            c['notification_emoji'] = emoji.strip()
        save(c)
        audit('Telegram relayer credentials or notification settings updated')
        return {'ok': True, **status()}

    @app.post('/api/admin/telegram-deposits/send-code')
    @auth(admin=True)
    def send_code():
        api_id, api_hash = credentials()
        cipher()
        phone = str((request.get_json(silent=True) or {}).get('phone', '')).strip()
        if not re.fullmatch(r'\+[1-9]\d{6,14}', phone):
            abort(400, description='Укажите номер в формате +79990000000')
        c = config()
        p = c.get('pending') or {}
        if int(p.get('created', 0)) > time.time() - 60:
            abort(429, description='Повторный запрос кода доступен через минуту')

        async def request_code(client):
            sent = await client.send_code_request(phone)
            return sent.phone_code_hash, client.session.save()
        try:
            phone_hash, session = asyncio.run(with_client(api_id, api_hash, '', request_code))
        except Exception:
            abort(502, description='Не удалось отправить код Telegram')
        c['pending'] = dict(phone=phone, hash=phone_hash, session=encrypt(session),
                            created=int(time.time()), password_required=False)
        save(c)
        audit('Telegram deposit login code requested')
        return {'ok': True, 'step': 'code'}

    def pending():
        c = config()
        p = c.get('pending') or {}
        if not p or time.time() - int(p.get('created', 0)) > 600:
            abort(409, description='Срок действия входа истёк. Запросите код повторно')
        return c, p

    def complete(client):
        async def result():
            me = await client.get_me()
            if not me or getattr(me, 'bot', False):
                raise ValueError('Необходим пользовательский Telegram-аккаунт')
            return dict(id=int(me.id), name=' '.join(filter(None, (me.first_name, me.last_name))),
                        username=str(me.username or ''))
        return result()

    @app.post('/api/admin/telegram-deposits/verify-code')
    @auth(admin=True)
    def verify_code():
        api_id, api_hash = credentials()
        c, p = pending()
        code = re.sub(r'\s+', '', str((request.get_json(silent=True) or {}).get('code', '')))
        if not re.fullmatch(r'[0-9]{4,8}', code):
            abort(400, description='Введите код Telegram')
        async def login(client):
            try:
                await client.sign_in(phone=p['phone'], code=code, phone_code_hash=p['hash'])
            except SessionPasswordNeededError:
                return None, None
            return await complete(client), client.session.save()
        try:
            profile, session = asyncio.run(with_client(api_id, api_hash, decrypt(p['session']), login))
        except Exception:
            abort(400, description='Не удалось подтвердить код Telegram')
        if profile is None:
            p['password_required'] = True
            save(c)
            return {'ok': True, 'step': 'password'}
        c.update(session=encrypt(session), account_id=profile['id'],
                 account_name=profile['name'], account_username=profile['username'],
                 baseline_done=False)
        c.pop('pending', None)
        save(c)
        audit('Telegram deposit account connected')
        return {'ok': True, 'step': 'connected', **status()}

    @app.post('/api/admin/telegram-deposits/verify-password')
    @auth(admin=True)
    def verify_password():
        api_id, api_hash = credentials()
        c, p = pending()
        if not p.get('password_required'):
            abort(409, description='Сначала подтвердите код')
        password = str((request.get_json(silent=True) or {}).get('password', ''))
        if not password or len(password) > 512:
            abort(400, description='Введите пароль двухэтапной проверки')
        async def login(client):
            await client.sign_in(password=password)
            return await complete(client), client.session.save()
        try:
            profile, session = asyncio.run(with_client(api_id, api_hash, decrypt(p['session']), login))
        except Exception:
            abort(400, description='Неверный пароль двухэтапной проверки')
        c.update(session=encrypt(session), account_id=profile['id'],
                 account_name=profile['name'], account_username=profile['username'],
                 baseline_done=False)
        c.pop('pending', None)
        save(c)
        audit('Telegram deposit account connected with 2FA')
        return {'ok': True, 'step': 'connected', **status()}

    @app.post('/api/admin/telegram-deposits/check')
    @auth(admin=True)
    def check_connection():
        api_id, api_hash = credentials()
        c = config()
        if not c.get('session'):
            abort(409, description='Telegram не подключён')
        async def test(client):
            return await client.is_user_authorized(), await client.get_me()
        ok, me = asyncio.run(with_client(api_id, api_hash, decrypt(c['session']), test))
        connected = bool(ok and me and int(me.id) == int(c['account_id']))
        if connected:
            name = ' '.join(filter(None, (me.first_name, me.last_name)))
            username = str(getattr(me, 'username', '') or '')
            if c.get('account_name') != name or c.get('account_username') != username:
                c['account_name'], c['account_username'] = name, username
                save(c)
        return {'connected': connected, 'account_id': c['account_id'],
                'account_name': c.get('account_name', ''),
                'account_username': c.get('account_username', '')}

    @app.post('/api/admin/telegram-deposits/sync')
    @auth(admin=True)
    def sync_deposits():
        if not config().get('session'):
            abort(409, description='Подключите Telegram-аккаунт')
        try:
            return run_scan()
        except Exception:
            abort(502, description='Ошибка сверки. Подробности доступны в статусе подключения')

    @app.post('/api/admin/telegram-deposits/disconnect')
    @auth(admin=True)
    def disconnect_telegram_deposits():
        c = config()
        c.pop('session', None)
        c.pop('pending', None)
        c.update(baseline_done=False, account_id=None, account_name='', account_username='')
        save(c)
        audit('Telegram deposit session disconnected')
        return {'ok': True}

    def background():
        # Gunicorn may spawn multiple workers; the DB lease allows one active poll.
        while True:
            try:
                with app.app_context():
                    if config().get('session') and available():
                        run_scan()
            except Exception:
                app.logger.warning('Telegram background deposit check failed')
            time.sleep(45)

    if not app.config.get('TESTING') and os.getenv('TELEGRAM_DEPOSIT_POLL', '1') == '1':
        threading.Thread(target=background, daemon=True, name='telegram-gift-monitor').start()
