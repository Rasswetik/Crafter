"""Partner API v1: other projects trade on Crafter through a personal API key (``CRT/...``).

* The key is issued by the bot command /api, only to accounts that opened the app at least once.
* One key = one account: its balance, gifts and purchases. Card packs are never part of the API.
* Lots of the Crafter market (players) and of the connected market (Portals/Thermos) are listed together.
* Every POST needs an Idempotency-Key and is saved, so a retry never buys twice.

Money is a decimal string in GRAM (``"12.5"``); every price also has a ``*_nano`` field (1 GRAM = 10^9).
"""
import collections
import hashlib
import hmac
import json
import re
import string
import threading
import time
from decimal import Decimal, InvalidOperation

from flask import Response, abort, g, jsonify, render_template, request

KEY_PREFIX = 'CRT/'
ALPHABET = string.ascii_letters + string.digits
BASE = '/api/partner/v1'
RATE_LIMIT, RATE_WINDOW = 30, 10.0
OP_ID = re.compile(r'^[A-Za-z0-9_-]{16,80}$')
CRAFTER_LOT = re.compile(r'^crafter-[0-9a-f]{32}$')
RIGHTS = ['read', 'buy', 'sell', 'transfer', 'withdraw', 'offers']
NANO = Decimal(10) ** 9


class PartnerError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def nano(value):
    return str(int((Decimal(str(value)) * NANO).to_integral_value()))


def plain(value):
    value = Decimal(str(value))
    return format(value.normalize(), 'f') if value else '0'


def parse_money(body, name):
    """Accepts ``<name>`` as a GRAM string or ``<name>_nano`` as integer nano units."""
    raw, raw_nano = body.get(name), body.get(name + '_nano')
    try:
        if raw_nano is not None:
            value = Decimal(str(raw_nano)) / NANO
        elif raw is not None:
            value = Decimal(str(raw))
        else:
            raise PartnerError(400, 'bad_request', 'Укажите ' + name + ' (строка в GRAM) или ' + name + '_nano')
    except InvalidOperation:
        raise PartnerError(400, 'bad_request', 'Неверное число в поле ' + name)
    if not value.is_finite() or value <= 0 or value > Decimal('100000000'):
        raise PartnerError(400, 'bad_request', 'Сумма в поле ' + name + ' должна быть больше нуля')
    return value.quantize(Decimal('0.000001'))


def install_partner_api(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS partner_keys(
            user_id BIGINT PRIMARY KEY, version BIGINT NOT NULL DEFAULT 1, key_hash TEXT NOT NULL UNIQUE,
            created BIGINT NOT NULL, rotated BIGINT, last_used BIGINT, requests BIGINT NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS partner_ops(
            user_id BIGINT NOT NULL, op_id TEXT NOT NULL, method TEXT NOT NULL, digest TEXT NOT NULL,
            status TEXT NOT NULL, http BIGINT NOT NULL DEFAULT 0, result TEXT, created BIGINT NOT NULL, finished BIGINT,
            PRIMARY KEY(user_id,op_id)
        );
        """)

    secret = hashlib.sha256(('crafter-partner:' + (app.config.get('BOT_TOKEN') or app.config.get('SECRET_KEY') or 'dev-secret')).encode()).digest()

    def make_key(uid, version):
        number = int.from_bytes(hmac.new(secret, f'{uid}:{version}'.encode(), hashlib.sha256).digest(), 'big')
        chars = []
        while len(chars) < 40:
            number, rest = divmod(number, len(ALPHABET))
            chars.append(ALPHABET[rest])
        return KEY_PREFIX + ''.join(chars)

    def key_hash(key):
        return hashlib.sha256(key.encode()).hexdigest()

    def issue_key(uid):
        """The account's key, or None when the account has never opened the app."""
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            return None
        with db():
            row = db().execute("SELECT version FROM partner_keys WHERE user_id=?", (uid,)).fetchone()
            version = int(row['version']) if row else 1
            key = make_key(uid, version)
            if row:
                db().execute("UPDATE partner_keys SET key_hash=? WHERE user_id=?", (key_hash(key), uid))
            else:
                db().execute("INSERT INTO partner_keys(user_id,version,key_hash,created) VALUES(?,?,?,?)", (uid, version, key_hash(key), int(time.time())))
        return key

    app.extensions['crafter_partner_key'] = issue_key

    # ---------------- plumbing ----------------
    hits, hits_lock = collections.defaultdict(collections.deque), threading.Lock()

    @app.errorhandler(PartnerError)
    def partner_error(error):
        response = jsonify({'ok': False, 'error': error.message, 'code': error.code})
        response.status_code = error.status
        if error.status == 429:
            response.headers['Retry-After'] = '10'
        return response

    def authorize():
        header = request.headers.get('Authorization', '')
        if request.headers.get('Origin'):
            raise PartnerError(403, 'browser_forbidden', 'API работает только с серверов: уберите заголовок Origin и не вызывайте его из браузера')
        if not header.startswith('Bearer ') or not header[7:].startswith(KEY_PREFIX):
            raise PartnerError(401, 'unauthorized', 'Передайте ключ: Authorization: Bearer CRT/…')
        digest = key_hash(header[7:].strip())
        row = db().execute("SELECT user_id FROM partner_keys WHERE key_hash=?", (digest,)).fetchone()
        if not row:
            raise PartnerError(401, 'unauthorized', 'Ключ не найден или заменён')
        uid = int(row['user_id'])
        user = db().execute("SELECT id,name,username FROM users WHERE id=?", (uid,)).fetchone()
        if not user:
            raise PartnerError(401, 'unauthorized', 'Аккаунт не найден')
        if db().execute("SELECT 1 FROM user_bans WHERE user_id=?", (uid,)).fetchone():
            raise PartnerError(403, 'banned', 'Аккаунт заблокирован')
        now = time.monotonic()
        with hits_lock:
            queue = hits[digest]
            while queue and now - queue[0] > RATE_WINDOW:
                queue.popleft()
            if len(queue) >= RATE_LIMIT:
                raise PartnerError(429, 'rate_limited', f'Не больше {RATE_LIMIT} запросов за {int(RATE_WINDOW)} секунд на один ключ')
            queue.append(now)
        with db():
            db().execute("UPDATE partner_keys SET last_used=?,requests=requests+1 WHERE user_id=?", (int(time.time()), uid))
        g.partner = {'id': uid, 'first_name': user['name'] or '', 'username': user['username'] or ''}
        g.user = g.partner
        return g.partner

    def partner(fn):
        def run(*args, **kwargs):
            authorize()
            return fn(*args, **kwargs)
        run.__name__ = fn.__name__
        return run

    def internal(method, path, body=None):
        """Call an ordinary Crafter endpoint as the key's owner; all checks of the normal app apply."""
        reply = app.test_client().open(path, method=method, json=body, environ_overrides={'crafter.internal_user': dict(g.partner)})
        return reply.status_code, (reply.get_json(silent=True) or {})

    def balance_of(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal('0')

    def pack_ctx():
        return app.extensions['crafter_pack_ctx']

    # ---------------- reading ----------------
    @app.get(BASE + '/account')
    @partner
    def p_account():
        uid = g.partner['id']
        balance = balance_of(uid)
        wallet = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return jsonify({'ok': True, 'account': {'id': str(uid), 'name': g.partner['first_name'], 'username': g.partner['username']},
                        'balance': plain(balance), 'balance_nano': nano(balance), 'currency': 'GRAM',
                        'new_year_balls': int(wallet['balls']) if wallet else 0, 'rights': RIGHTS,
                        'mode': 'work' if pack_ctx()['work_mode']() else 'test'})

    def floor_gram(c):
        ctx = pack_ctx()
        try:
            value = Decimal(str(c.get('floor_price') or '0'))
        except InvalidOperation:
            return None
        if value <= 0:
            return None
        if c.get('price_unit', 'GRAM') == 'TON':
            value = value * Decimal(str(ctx['gram_per_ton']()))
        return value.quantize(Decimal('0.01'))

    @app.get(BASE + '/collections')
    @partner
    def p_collections():
        out = []
        for c in pack_ctx()['public_catalog']():
            floor = floor_gram(c)
            out.append({'id': str(c['id']), 'name': c['name'], 'image': c.get('photo_url') or '',
                        'floor': plain(floor) if floor else None, 'floor_nano': nano(floor) if floor else None})
        return jsonify({'ok': True, 'collections': out, 'count': len(out)})

    def find_collection(raw):
        ctx = pack_ctx()
        canon = ctx['canonical_name']
        for c in ctx['public_catalog']():
            if str(c['id']) == str(raw) or canon(c.get('name', '')) == canon(str(raw)):
                return c
        raise PartnerError(404, 'collection_not_found', 'Такой коллекции нет. Список: GET /collections')

    @app.get(BASE + '/models')
    @partner
    def p_models():
        collection = find_collection(request.args.get('collection', ''))
        from packs import catalog
        seed = catalog().get(str(collection['id'])) or {}
        models = [{'name': str(m.get('name', '')).replace('\xa0', ' '), 'preview_url': m.get('image') or None, 'floor': m.get('price') or None}
                  for m in seed.get('models', [])]
        backdrops, symbols = [], []
        status, body = internal('GET', '/api/collections/' + str(collection['id']) + '/attributes')
        if status == 200:
            backdrops = [{'name': b.get('name'), 'rarity': b.get('rarity')} for b in body.get('backdrops', [])]
            symbols = [{'name': b.get('name'), 'preview_url': b.get('image_url') or None} for b in body.get('symbols', [])]
        return jsonify({'ok': True, 'collection': {'id': str(collection['id']), 'name': collection['name']},
                        'models': models, 'backdrops': backdrops, 'symbols': symbols})

    def lot_view(gift, price, lot_id, source, market):
        return {'lot_id': lot_id, 'source': source, 'market': market, 'collection': gift.get('name'), 'name': gift.get('name'),
                'number': gift.get('number'), 'model': gift.get('model') or '', 'backdrop': gift.get('backdrop') or '', 'symbol': gift.get('symbol') or '',
                'image': gift.get('image') or '', 'price': plain(price), 'price_nano': nano(price)}

    def crafter_lots(collection, uid):
        ctx, canon = pack_ctx(), pack_ctx()['canonical_name']
        rows = db().execute("""SELECT l.id,l.price,i.payload FROM crafter_listings l
            JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
            WHERE l.seller_id!=? ORDER BY l.listed_at DESC""", (uid,)).fetchall()
        out = []
        for row in rows:
            gift = json.loads(row['payload'])
            if gift.get('pack_item') or gift.get('star_gift') or gift.get('pack_prize') or gift.get('catalog_only') or gift.get('test_only'):
                continue                                           # card packs and virtual gifts are not part of the API
            if ctx['work_mode']() and gift.get('origin') != 'telegram-deposit':
                continue
            if canon(gift.get('name', '')) != canon(collection['name']):
                continue
            try:
                price = Decimal(str(row['price']))
            except InvalidOperation:
                continue
            out.append(lot_view(gift, price, row['id'], 'crafter', 'Crafter'))
        return out

    def market_lots(collection):
        ctx = pack_ctx()
        try:
            ctx['ensure_listings'](collection, Decimal('0.01'), Decimal('100000000'))
        except Exception:
            pass
        rate = Decimal(str(ctx['gram_per_ton']()))
        out = []
        for gift, price in ctx['market_candidates'](collection):
            unit = gift.get('price_unit', 'GRAM')
            if unit == 'TON':
                price = (Decimal(str(price)) * rate).quantize(Decimal('0.01')) if (ctx['thermos_backend']() or ctx['test_mode']()) else None
            elif unit != 'GRAM':
                price = None
            if price is None or gift.get('pack_item') or not gift.get('image'):
                continue
            market = gift.get('marketplace') or ('Thermos' if ctx['thermos_backend']() else 'Portals')
            out.append(lot_view(gift, price, 'm.' + str(collection['id']) + '.' + str(gift['id']), 'market', market))
        return out

    @app.get(BASE + '/lots')
    @partner
    def p_lots():
        collection = find_collection(request.args.get('collection', ''))
        source = request.args.get('source', 'all')
        if source not in ('all', 'crafter', 'market'):
            raise PartnerError(400, 'bad_request', 'source: all, crafter или market')
        lots = []
        if source in ('all', 'crafter'):
            lots += crafter_lots(collection, g.partner['id'])
        if source in ('all', 'market'):
            lots += market_lots(collection)
        model = request.args.get('model', '').strip().lower()
        if model:
            lots = [x for x in lots if x['model'].lower() == model]
        number = request.args.get('number', '').strip()
        if number:
            lots = [x for x in lots if str(x['number']) == number]
        lots.sort(key=lambda x: Decimal(x['price']), reverse=request.args.get('sort') == 'price_desc')
        try:
            page, limit = max(1, int(request.args.get('page', 1))), min(50, max(1, int(request.args.get('limit', 20))))
        except ValueError:
            raise PartnerError(400, 'bad_request', 'page и limit — целые числа')
        chunk = lots[(page - 1) * limit:page * limit]
        return jsonify({'ok': True, 'collection': {'id': str(collection['id']), 'name': collection['name']}, 'page': page, 'limit': limit,
                        'total': len(lots), 'has_more': page * limit < len(lots), 'lots': chunk})

    def own_gifts(uid):
        status, body = internal('GET', '/api/inventory')
        gifts = []
        for gift in body.get('gifts', []) if status == 200 else []:
            if gift.get('pack_item') or gift.get('star_gift') or gift.get('pack_prize') or gift.get('catalog_only') or gift.get('test_only'):
                continue
            if gift.get('status') not in ('unlisted', 'listed'):
                continue
            price = gift.get('listing_price') if gift.get('status') == 'listed' else None
            gifts.append({'gift_id': gift['id'], 'name': gift.get('name'), 'number': gift.get('number'), 'model': gift.get('model') or '',
                          'backdrop': gift.get('backdrop') or '', 'symbol': gift.get('symbol') or '', 'image': gift.get('image') or '',
                          'status': gift['status'], 'listing_price': plain(price) if price else None})
        return gifts

    @app.get(BASE + '/inventory')
    @partner
    def p_inventory():
        gifts = own_gifts(g.partner['id'])
        before = request.args.get('before')
        if before:
            ids = [x['gift_id'] for x in gifts]
            gifts = gifts[ids.index(before) + 1:] if before in ids else []
        chunk = gifts[:50]
        return jsonify({'ok': True, 'gifts': chunk, 'next': chunk[-1]['gift_id'] if len(gifts) > 50 else None})

    @app.get(BASE + '/gifts/<path:gift_id>')
    @partner
    def p_gift(gift_id):
        mine = next((x for x in own_gifts(g.partner['id']) if x['gift_id'] == gift_id), None)
        if mine:
            return jsonify({'ok': True, 'kind': 'own', 'gift': mine})
        if CRAFTER_LOT.match(gift_id):
            row = db().execute("SELECT l.id,l.price,l.gift_id,l.seller_id,i.payload FROM crafter_listings l JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed' WHERE l.id=?", (gift_id,)).fetchone()
            gift = json.loads(row['payload']) if row else None
            if gift and not (gift.get('pack_item') or gift.get('test_only') or gift.get('catalog_only')):
                return jsonify({'ok': True, 'kind': 'lot', 'lot': lot_view(gift, Decimal(str(row['price'])), row['id'], 'crafter', 'Crafter')})
        raise PartnerError(404, 'gift_not_found', 'Подарок не найден: показываются только ваши подарки и открытые лоты Crafter')

    @app.get(BASE + '/operations/<op_id>')
    @partner
    def p_operation(op_id):
        row = db().execute("SELECT * FROM partner_ops WHERE user_id=? AND op_id=?", (g.partner['id'], op_id)).fetchone()
        if not row:
            raise PartnerError(404, 'operation_not_found', 'Операции с таким Idempotency-Key нет. Отправьте исходный запрос с тем же ключом.')
        result = json.loads(row['result']) if row['result'] else None
        response = jsonify({'ok': row['http'] and row['http'] < 300, 'operation_id': op_id, 'status': row['status'], 'method': row['method'], 'result': result})
        response.status_code = 202 if row['status'] == 'processing' else int(row['http'] or 200)
        return response

    # ---------------- writing (idempotent) ----------------
    def run_operation(name, handler):
        op_id = request.headers.get('Idempotency-Key', '')
        if not OP_ID.match(op_id):
            raise PartnerError(400, 'idempotency_required', 'Нужен заголовок Idempotency-Key: 16–80 символов A–Z a–z 0–9 _ -')
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise PartnerError(400, 'bad_request', 'Тело запроса — JSON-объект')
        digest = hashlib.sha256(json.dumps([name, body], sort_keys=True).encode()).hexdigest()
        uid = g.partner['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT * FROM partner_ops WHERE user_id=? AND op_id=?", (uid, op_id)).fetchone()
            if row:
                if row['digest'] != digest:
                    raise PartnerError(409, 'conflict', 'Этот Idempotency-Key уже использован с другим запросом')
                result = json.loads(row['result']) if row['result'] else None
                response = jsonify({'ok': bool(row['http']) and row['http'] < 300, 'operation_id': op_id, 'status': row['status'], 'result': result, 'repeat': True})
                response.status_code = 202 if row['status'] == 'processing' else int(row['http'] or 200)
                return response
            db().execute("INSERT INTO partner_ops(user_id,op_id,method,digest,status,created) VALUES(?,?,?,?,?,?)", (uid, op_id, name, digest, 'processing', int(time.time())))
        try:
            http, payload = 200, handler(body, op_id)
        except PartnerError as error:
            http, payload = error.status, {'ok': False, 'error': error.message, 'code': error.code}
        except Exception:
            app.logger.exception('Partner operation failed')
            http, payload = 503, {'ok': False, 'error': 'Результат неизвестен: проверьте GET /operations/{id}', 'code': 'review'}
        status = 'done' if http < 300 else ('review' if http == 503 else 'failed')
        with db():
            db().execute("UPDATE partner_ops SET status=?,http=?,result=?,finished=? WHERE user_id=? AND op_id=?", (status, http, json.dumps(payload, ensure_ascii=False), int(time.time()), uid, op_id))
        record('partner_' + name, {'op': op_id, 'status': status}, uid=uid)
        response = jsonify({'ok': http < 300, 'operation_id': op_id, 'status': status, 'result': payload})
        response.status_code = http
        return response

    def relay_error(status, body):
        message = body.get('error') or body.get('message') or 'Операция отклонена'
        code = {400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'rejected'}.get(status, 'failed' if status < 500 else 'review')
        raise PartnerError(status if status in (400, 403, 404, 409) else (503 if status >= 500 else 409), code, message)

    def lot_for_buy(lot_id):
        """(kind, price, collection, native id) for a lot id from GET /lots."""
        if CRAFTER_LOT.match(lot_id):
            row = db().execute("SELECT l.price,i.payload FROM crafter_listings l JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed' WHERE l.id=?", (lot_id,)).fetchone()
            gift = json.loads(row['payload']) if row else None
            if not row or gift.get('pack_item') or gift.get('test_only') or gift.get('catalog_only'):
                raise PartnerError(404, 'lot_not_found', 'Лот уже продан или снят с продажи')
            return 'crafter', Decimal(str(row['price'])), None, lot_id
        match = re.match(r'^m\.([^.]+)\.(.+)$', lot_id)
        if not match:
            raise PartnerError(400, 'bad_request', 'Неверный lot_id: берите его из GET /lots')
        collection = find_collection(match.group(1))
        found = next((x for x in market_lots(collection) if x['lot_id'] == lot_id), None)
        if not found:
            raise PartnerError(404, 'lot_not_found', 'Лот уже продан или снят с продажи')
        return 'market', Decimal(found['price']), collection, match.group(2)

    def do_buy(body, op_id):
        lot_id = str(body.get('lot_id') or '')
        limit = parse_money(body, 'max_price')
        kind, price, collection, native = lot_for_buy(lot_id)
        if price > limit:
            raise PartnerError(409, 'price_changed', f'Цена лота {plain(price)} выше max_price {plain(limit)}')
        if kind == 'crafter':
            status, reply = internal('POST', '/api/resale/buy', {'id': native, 'request_id': op_id, 'expected_price': format(price, 'f')})
        else:
            ctx = pack_ctx()
            if ctx['test_mode']():
                status, reply = internal('POST', '/api/market/test/buy', {'gift_ids': [native], 'request_id': op_id})
            elif ctx['work_mode']() and ctx['thermos_backend']():
                status, reply = internal('POST', '/api/thermos/buy', {'gift_ids': [native], 'request_id': op_id})
            else:
                raise PartnerError(409, 'market_unavailable', 'Покупки на подключённом маркете сейчас недоступны')
        if status != 200:
            relay_error(status, reply)
        gift = reply.get('gift') or (reply.get('gifts') or [None])[0] or {}
        return {'lot_id': lot_id, 'state': 'done', 'price': plain(price), 'price_nano': nano(price), 'fee': plain(Decimal(str(reply.get('fee') or '0'))),
                'gift': {'gift_id': gift.get('id'), 'name': gift.get('name'), 'number': gift.get('number'), 'model': gift.get('model') or ''},
                'balance': plain(balance_of(g.partner['id']))}

    def mine_or_fail(gift_id):
        gift = next((x for x in own_gifts(g.partner['id']) if x['gift_id'] == gift_id), None)
        if not gift:
            raise PartnerError(404, 'gift_not_found', 'Подарок не найден среди ваших. Карточные паки через API недоступны.')
        return gift

    def do_sell(body, op_id):
        gift = mine_or_fail(str(body.get('gift_id') or ''))
        price = parse_money(body, 'price')
        if price != price.quantize(Decimal('0.01')):
            raise PartnerError(400, 'bad_request', 'Цена продажи — не больше двух знаков после запятой')
        status, reply = internal('POST', '/api/resale/listings', {'action': 'sell' if gift['status'] == 'unlisted' else 'edit', 'items': [{'id': gift['gift_id'], 'price': format(price, '.2f')}]})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'accepted', 'price': plain(price), 'price_nano': nano(price)}

    def do_unlist(body, op_id):
        gift = mine_or_fail(str(body.get('gift_id') or ''))
        status, reply = internal('POST', '/api/resale/listings', {'action': 'unlist', 'items': [{'id': gift['gift_id']}]})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'done'}

    def do_transfer(body, op_id):
        gift = mine_or_fail(str(body.get('gift_id') or ''))
        try:
            recipient = int(str(body.get('telegram_id')))
        except ValueError:
            raise PartnerError(400, 'bad_request', 'telegram_id — число')
        row = db().execute("SELECT username FROM users WHERE id=?", (recipient,)).fetchone()
        if not row:
            raise PartnerError(404, 'recipient_not_found', 'Получатель ещё не открывал Crafter')
        if not row['username']:
            raise PartnerError(409, 'recipient_no_username', 'У получателя нет @username в Telegram: передача возможна только игроку с именем пользователя')
        status, reply = internal('POST', '/api/inventory/transfer', {'gift_ids': [gift['gift_id']], 'recipient_id': recipient, 'request_id': op_id, 'username': row['username']})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'done', 'telegram_id': str(recipient), 'fee': '0'}

    # ---------------- ordinary Telegram gifts (Bear, Rose ...): a separate set of requests ----------------
    def absolute(path):
        return path if str(path).startswith('http') else request.url_root.rstrip('/') + str(path)

    def star_catalog():
        return [{'key': i['key'], 'name': i['name'], 'stars': i['stars'], 'price': plain(i['price']), 'price_nano': nano(i['price']),
                 'image_url': absolute(i['image']), 'telegram_gift_id': i['telegram_gift_id']} for i in app.extensions['crafter_star_gift_catalog']()]

    def own_star_gifts():
        status, body = internal('GET', '/api/inventory')
        out = []
        for gift in body.get('gifts', []) if status == 200 else []:
            if not gift.get('star_gift') or gift.get('status') not in ('unlisted', 'withdrawing'):
                continue
            out.append({'gift_id': gift['id'], 'key': gift.get('star_key'), 'name': gift.get('name'), 'stars': gift.get('stars'),
                        'price': plain(gift.get('price')), 'price_nano': nano(gift.get('price')), 'image_url': absolute(gift.get('image') or ''),
                        'telegram_gift_id': gift.get('telegram_gift_id'), 'status': 'withdrawing' if gift['status'] == 'withdrawing' else 'available'})
        return out

    @app.get(BASE + '/star-gifts')
    @partner
    def p_star_gifts():
        return jsonify({'ok': True, 'stars_per_gram': 100, 'gifts': star_catalog()})

    @app.get(BASE + '/star-gifts/inventory')
    @partner
    def p_star_inventory():
        return jsonify({'ok': True, 'gifts': own_star_gifts()})

    def star_or_fail(gift_id):
        found = next((x for x in own_star_gifts() if x['gift_id'] == gift_id and x['status'] == 'available'), None)
        if not found:
            raise PartnerError(404, 'gift_not_found', 'Подарок не найден среди ваших обычных подарков или уже выводится')
        return found

    def do_star_sell(body, op_id):
        gift = star_or_fail(str(body.get('gift_id') or ''))
        status, reply = internal('POST', '/api/star-gifts/sell', {'gift_id': gift['gift_id']})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'done', 'amount': plain(reply['amount']), 'amount_nano': nano(reply['amount']), 'balance': plain(balance_of(g.partner['id']))}

    def do_star_withdraw(body, op_id):
        gift = star_or_fail(str(body.get('gift_id') or ''))
        status, reply = internal('POST', '/api/star-gifts/withdraw', {'gift_id': gift['gift_id']})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'accepted', 'withdrawal_id': reply.get('id'), 'telegram_gift_id': gift['telegram_gift_id'],
                'note': 'Подарок отправит релейер Crafter в Telegram с подписью Gift from Crafter'}

    def do_star_transfer(body, op_id):
        gift = star_or_fail(str(body.get('gift_id') or ''))
        try:
            recipient = int(str(body.get('telegram_id')))
        except ValueError:
            raise PartnerError(400, 'bad_request', 'telegram_id — число')
        row = db().execute("SELECT username FROM users WHERE id=?", (recipient,)).fetchone()
        if not row:
            raise PartnerError(404, 'recipient_not_found', 'Получатель ещё не открывал Crafter')
        if not row['username']:
            raise PartnerError(409, 'recipient_no_username', 'У получателя нет @username в Telegram')
        status, reply = internal('POST', '/api/inventory/transfer', {'gift_ids': [gift['gift_id']], 'recipient_id': recipient, 'request_id': op_id, 'username': row['username']})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'state': 'done', 'telegram_id': str(recipient), 'fee': '0'}

    # ---------------- history ----------------
    @app.get(BASE + '/history')
    @partner
    def p_history():
        """Money and gift movements of the account: purchases, sales, transfers, deposits, withdrawals (packs and stars are not shown)."""
        status, body = internal('GET', '/api/history')
        hidden = ('pack', 'star', 'advent', 'shop', 'promo')
        items = [{'id': x['id'], 'kind': x['kind'], 'created': x['created'], 'details': x.get('data')} for x in body.get('items', [])
                 if status == 200 and not any(word in str(x.get('kind')) for word in hidden)]
        try:
            limit = max(1, min(100, int(request.args.get('limit', 50))))
        except ValueError:
            limit = 50
        return jsonify({'ok': True, 'items': items[:limit]})

    # ---------------- offers ----------------
    def offer_view(o):
        return {'offer_id': o.get('id'), 'lot_id': o.get('lot_id'), 'price': plain(o.get('price', '0')), 'price_nano': nano(o.get('price', '0')),
                'collection': o.get('collection') or o.get('collection_name'), 'quantity': o.get('quantity', 1), 'expires_at': o.get('expires_at'),
                'status': o.get('status', 'active'), 'gift': o.get('gift')}

    @app.get(BASE + '/offers')
    @partner
    def p_offers():
        status, body = internal('GET', '/api/offers')
        if status != 200:
            relay_error(status, body)
        return jsonify({'ok': True, 'received': [offer_view(o) for o in body.get('received', [])], 'placed': [offer_view(o) for o in body.get('placed', [])],
                        'collection_offers': [offer_view(o) for o in body.get('collections', [])], 'fee': plain(body.get('fee_gram', '0'))})

    def do_offer_create(body, op_id):
        price = parse_money(body, 'price')
        payload = {'price': plain(price), 'request_id': op_id, 'expiry': body.get('expiry', 'none')}
        if body.get('lot_id'):
            payload['lot_id'] = str(body['lot_id'])
        else:
            payload.update({'collection': str(body.get('collection') or ''), 'quantity': body.get('quantity', 1)})
            for key in ('model', 'backdrop', 'symbol'):
                if body.get(key):
                    payload[key] = str(body[key])
        status, reply = internal('POST', '/api/offers', payload)
        if status != 200:
            relay_error(status, reply)
        return {**offer_view(reply.get('offer') or {}), 'balance': plain(reply.get('balance', '0'))}

    def do_offer_respond(body, op_id):
        offer_id, action = str(body.get('offer_id') or ''), body.get('action')
        if action not in ('accept', 'decline', 'withdraw'):
            raise PartnerError(400, 'bad_request', 'action: accept, decline или withdraw')
        status, reply = internal('POST', '/api/offers/' + offer_id + '/action', {'action': action})
        if status != 200:
            relay_error(status, reply)
        return {'offer_id': offer_id, 'action': action, 'state': 'done'}

    # ---------------- withdrawing an NFT to Telegram ----------------
    def do_nft_withdraw(body, op_id):
        gift = mine_or_fail(str(body.get('gift_id') or ''))
        status, reply = internal('POST', '/api/gifts/withdraw', {'gift_id': gift['gift_id'], 'request_id': op_id})
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'withdrawal_id': reply.get('id'), 'status': reply.get('status', 'queued'), 'fee': plain(reply.get('fee_gram', '0')),
                'note': 'Подарок отправит релейер Crafter вам в Telegram. Статус: GET /withdrawals'}

    @app.get(BASE + '/withdrawals')
    @partner
    def p_nft_withdrawals():
        status, body = internal('GET', '/api/gifts/withdrawals')
        if status != 200:
            relay_error(status, body)
        rows = [{'withdrawal_id': x['id'], 'gift_id': x.get('gift_id'), 'name': x.get('name'), 'number': x.get('number'), 'status': x['status'],
                 'text': x.get('text'), 'reason': x.get('reason') or None, 'can_cancel': bool(x.get('can_cancel')), 'created': x.get('created')}
                for x in body.get('items', []) if x.get('kind') == 'nft']
        return jsonify({'ok': True, 'withdrawals': rows})

    def do_nft_withdraw_cancel(body, op_id):
        wid = str(body.get('withdrawal_id') or '')
        status, reply = internal('POST', '/api/gifts/withdrawals/' + wid + '/cancel', {})
        if status != 200:
            relay_error(status, reply)
        return {'withdrawal_id': wid, 'status': 'cancelled', 'note': 'Подарок вернулся в инвентарь, комиссия возвращена'}

    # ---------------- TON withdrawal: GRAM -> TON on the wallet linked in the app ----------------
    def ton_view(row):
        data = json.loads(row['payload'])
        tx = row['tx'] if 'tx' in row.keys() else None
        link = ('https://tonscan.org/tx/' + tx) if tx and re.fullmatch(r'[0-9a-f]{64}', str(tx)) else None
        status = {'queued': 'queued', 'processing': 'processing', 'confirmed': 'done', 'cancelled': 'cancelled'}.get(row['status'], row['status'])
        return {'withdrawal_id': row['id'], 'status': status, 'gram': plain(data.get('gram', '0')), 'gram_nano': nano(data.get('gram', '0')),
                'ton': plain(data.get('ton', '0')), 'address': data.get('receiver'), 'network': data.get('network'),
                'created': int(row['created']), 'tx_hash': tx if link else None, 'tx_url': link}

    @app.get(BASE + '/ton/wallet')
    @partner
    def p_ton_wallet():
        row = db().execute("SELECT address,network FROM connected_wallets WHERE user_id=?", (g.partner['id'],)).fetchone()
        return jsonify({'ok': True, 'connected': bool(row), 'address': row['address'] if row else None, 'network': row['network'] if row else None,
                        'note': 'TON уходит только на кошелёк, подключённый в приложении (Профиль → Кошелёк). Адрес в запросе передать нельзя.'})

    @app.get(BASE + '/ton/withdrawals')
    @partner
    def p_ton_withdrawals():
        rows = db().execute("SELECT * FROM ton_withdrawals WHERE user_id=? ORDER BY created DESC LIMIT 30", (g.partner['id'],)).fetchall()
        return jsonify({'ok': True, 'withdrawals': [ton_view(r) for r in rows]})

    @app.get(BASE + '/ton/withdrawals/<wid>')
    @partner
    def p_ton_withdrawal(wid):
        row = db().execute("SELECT * FROM ton_withdrawals WHERE user_id=? AND id=?", (g.partner['id'], wid)).fetchone()
        if not row:
            raise PartnerError(404, 'withdrawal_not_found', 'Заявки на вывод с таким номером нет')
        return jsonify({'ok': True, 'withdrawal': ton_view(row)})

    def do_ton_withdraw(body, op_id):
        value = parse_money(body, 'gram')
        status, reply = internal('POST', '/api/wallet/withdraw', {'gram': plain(value), 'request_id': op_id})
        if status != 200:
            relay_error(status, reply)
        row = db().execute("SELECT * FROM ton_withdrawals WHERE user_id=? AND id=?", (g.partner['id'], reply.get('id'))).fetchone()
        view = ton_view(row) if row else {'withdrawal_id': reply.get('id'), 'status': reply.get('status', 'queued')}
        return {**view, 'balance': plain(balance_of(g.partner['id'])),
                'note': 'Заявка принята. Статус: GET /ton/withdrawals/{withdrawal_id}. Когда TON придёт на кошелёк, в статусе появится tx_url.'}

    for route, name, handler in (('/buy', 'buy', do_buy), ('/sell', 'sell', do_sell), ('/unlist', 'unlist', do_unlist), ('/transfer', 'transfer', do_transfer), ('/star-gifts/sell', 'star_sell', do_star_sell), ('/star-gifts/withdraw', 'star_withdraw', do_star_withdraw), ('/star-gifts/transfer', 'star_transfer', do_star_transfer), ('/ton/withdraw', 'ton_withdraw', do_ton_withdraw), ('/offers/create', 'offer_create', do_offer_create), ('/offers/respond', 'offer_respond', do_offer_respond), ('/withdraw', 'nft_withdraw', do_nft_withdraw), ('/withdrawals/cancel', 'nft_withdraw_cancel', do_nft_withdraw_cancel)):
        def make(name=name, handler=handler):
            def view():
                authorize()
                return run_operation(name, handler)
            view.__name__ = 'partner_post_' + name
            return view
        app.add_url_rule(BASE + route, view_func=make(), methods=['POST'])

    # ---------------- administration ----------------
    @app.post('/api/admin/partner/rotate')
    @auth(admin=True)
    def admin_partner_rotate():
        try:
            uid = int((request.get_json(silent=True) or {}).get('user_id'))
        except (TypeError, ValueError):
            abort(400, description='Укажите Telegram ID')
        with db():
            row = db().execute("SELECT version FROM partner_keys WHERE user_id=?", (uid,)).fetchone()
            if not row:
                abort(404, description='У этого игрока нет API-ключа')
            version = int(row['version']) + 1
            db().execute("UPDATE partner_keys SET version=?,key_hash=?,rotated=? WHERE user_id=?", (version, key_hash(make_key(uid, version)), int(time.time()), uid))
        audit('Partner API key rotated for ' + str(uid))
        return {'ok': True, 'version': version}

    # ---------------- documentation ----------------
    def base_url():
        return request.url_root.rstrip('/')

    @app.get('/partner-api')
    def partner_docs():
        return render_template('partner_api.html', base=base_url() + BASE, site=base_url(), bot=app.config.get('BOT_USERNAME') or 'crafter_app',
                               limit=RATE_LIMIT, window=int(RATE_WINDOW))

    @app.get('/partner-api.openapi.json')
    def partner_openapi():
        from partner_openapi import build
        return Response(json.dumps(build(base_url() + BASE), ensure_ascii=False, indent=2), mimetype='application/json')
