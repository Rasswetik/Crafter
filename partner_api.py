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
INLINE_WAIT = 20.0                       # seconds a purchase may take before the API answers 202 «processing"
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

    # last_used / requests are statistics: they are collected in memory and written at most once every USAGE_FLUSH seconds (one commit instead of one per request)
    USAGE_FLUSH = 15.0
    usage, usage_lock, usage_flushed = {}, threading.Lock(), [time.monotonic()]

    def note_use(uid):
        batch = None
        with usage_lock:
            entry = usage.setdefault(uid, [0, 0])
            entry[0] += 1
            entry[1] = int(time.time())
            if time.monotonic() - usage_flushed[0] >= USAGE_FLUSH:
                batch, usage_flushed[0] = dict(usage), time.monotonic()
                usage.clear()
        if batch:
            try:
                with db():
                    db().executemany("UPDATE partner_keys SET last_used=?,requests=requests+? WHERE user_id=?",
                                     [(seen, count, user) for user, (count, seen) in batch.items()])
            except Exception:
                app.logger.warning('Partner API usage counters were not saved')

    def authorize():
        header = request.headers.get('Authorization', '')
        if request.headers.get('Origin'):
            raise PartnerError(403, 'browser_forbidden', 'API работает только с серверов: уберите заголовок Origin и не вызывайте его из браузера')
        if not header.startswith('Bearer ') or not header[7:].startswith(KEY_PREFIX):
            raise PartnerError(401, 'unauthorized', 'Передайте ключ: Authorization: Bearer CRT/…')
        digest = key_hash(header[7:].strip())
        user = db().execute("SELECT k.user_id,u.id AS known,u.name,u.username,"
                            "(SELECT 1 FROM user_bans b WHERE b.user_id=k.user_id LIMIT 1) AS banned "
                            "FROM partner_keys k LEFT JOIN users u ON u.id=k.user_id WHERE k.key_hash=?", (digest,)).fetchone()
        if not user:
            raise PartnerError(401, 'unauthorized', 'Ключ не найден или заменён')
        uid = int(user['user_id'])
        if user['known'] is None:
            raise PartnerError(401, 'unauthorized', 'Аккаунт не найден')
        if user['banned']:
            raise PartnerError(403, 'banned', 'Аккаунт заблокирован')
        now = time.monotonic()
        with hits_lock:
            queue = hits[digest]
            while queue and now - queue[0] > RATE_WINDOW:
                queue.popleft()
            if len(queue) >= RATE_LIMIT:
                raise PartnerError(429, 'rate_limited', f'Не больше {RATE_LIMIT} запросов за {int(RATE_WINDOW)} секунд на один ключ')
            queue.append(now)
        note_use(uid)
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

    catalog_memo = [0.0, None]

    def public_catalog():
        """The catalogue of collections (refreshed by the app every 5 minutes); kept for 5 seconds here so a request does not re-read and re-parse it."""
        now = time.monotonic()
        if catalog_memo[1] is None or now - catalog_memo[0] > 5.0:
            catalog_memo[1], catalog_memo[0] = pack_ctx()['public_catalog'](), now
        return catalog_memo[1]

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
        for c in public_catalog():
            floor = floor_gram(c)
            out.append({'id': str(c['id']), 'name': c['name'], 'image': c.get('photo_url') or '',
                        'floor': plain(floor) if floor else None, 'floor_nano': nano(floor) if floor else None})
        return jsonify({'ok': True, 'collections': out, 'count': len(out)})

    def find_collection(raw):
        ctx = pack_ctx()
        canon = ctx['canonical_name']
        for c in public_catalog():
            if str(c['id']) == str(raw) or canon(c.get('name', '')) == canon(str(raw)):
                return c
        raise PartnerError(404, 'collection_not_found', 'Такой коллекции нет. Список: GET /collections')

    @app.get(BASE + '/models')
    @partner
    def p_models():
        if not request.args.get('collection', '').strip():
            raise PartnerError(400, 'collection_required', 'Укажите collection — ID или название коллекции. Список: GET /collections')
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

    def slug_of(gift):
        """The Telegram slug of a gift (PlushPepe-4102): known for deposits, made from the name and the number for the gifts bought on Thermos."""
        return str(gift.get('telegram_slug') or (re.sub(r'[^A-Za-z0-9]', '', str(gift.get('name') or '')) + '-' + str(gift.get('number') or ''))).lower()

    def relayer_holds():
        return app.extensions['crafter_relayer_holds']() if 'crafter_relayer_holds' in app.extensions else None

    def crafter_candidates(uid):
        """Open lots of other players as (canonical collection name, lot id, price, gift), read and parsed once."""
        ctx, canon = pack_ctx(), pack_ctx()['canonical_name']
        work = ctx['work_mode']()
        holds = relayer_holds() if work else None
        rows = db().execute("""SELECT l.id,l.price,i.payload FROM crafter_listings l
            JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
            WHERE l.seller_id!=? ORDER BY l.listed_at DESC""", (uid,)).fetchall()
        out = []
        for row in rows:
            gift = json.loads(row['payload'])
            if gift.get('pack_item') or gift.get('star_gift') or gift.get('pack_prize') or gift.get('catalog_only') or gift.get('test_only'):
                continue                                           # card packs and virtual gifts are not part of the API
            if work and gift.get('origin') != 'telegram-deposit':
                if not (gift.get('origin') == 'thermos' and holds is not None and slug_of(gift) in holds):
                    continue                                       # in the working mode only the gifts that the relayer really holds are offered
            if holds is not None and slug_of(gift) not in holds:
                continue                                           # the gift is not on the relayer any more: it cannot be delivered, so it is not offered
            try:
                price = Decimal(str(row['price']))
            except InvalidOperation:
                continue
            out.append((canon(gift.get('name', '')), row['id'], price, gift))
        return out

    def crafter_lots(collection, uid, candidates=None):
        name = pack_ctx()['canonical_name'](collection['name'])
        out = []
        for canon_name, lot_id, price, gift in (crafter_candidates(uid) if candidates is None else candidates):
            if canon_name != name:
                continue
            lot = lot_view(gift, price, lot_id, 'crafter', 'Crafter')
            lot['collection_id'] = str(collection['id'])
            out.append(lot)
        return out

    def market_lots(collection, fetch=True, max_age=None):
        ctx = pack_ctx()
        if fetch:                                                  # fetch=False: only what is already cached (used when the time budget of a call is spent)
            try:
                ctx['ensure_listings'](collection, Decimal('0.01'), Decimal('100000000'))
            except Exception:
                pass
        rate = Decimal(str(ctx['gram_per_ton']()))
        out = []
        for gift, price in (ctx['market_candidates'](collection, max_age) if max_age else (ctx.get('market_candidates_fresh') or ctx['market_candidates'])(collection)):
            unit = gift.get('price_unit', 'GRAM')
            if unit == 'TON':
                price = (Decimal(str(price)) * rate).quantize(Decimal('0.01')) if (ctx['thermos_backend']() or ctx['test_mode']()) else None
            elif unit != 'GRAM':
                price = None
            if price is None or gift.get('pack_item') or not gift.get('image'):
                continue
            # `market` is the connected market the lot is bought on (Thermos when the server runs through it); `marketplace` is the exchange behind it
            underlying = str(gift.get('marketplace') or '').upper()
            market = 'Thermos' if ctx['thermos_backend']() else (underlying.title() or 'Portals')
            lot = lot_view(gift, price, 'm.' + str(collection['id']) + '.' + str(gift['id']), 'market', market)
            lot['marketplace'] = underlying or market.upper()
            lot['collection_id'] = str(collection['id'])
            out.append(lot)
        return out

    # All collections in one request (the rate limit is per request, so a client must not need one request per collection).
    # The merged list is kept for 30 seconds per key; the market of a collection is fetched at most once a minute (ensure_listings caches it).
    # A call that runs out of its time budget answers with what is cached and complete=false: the next call continues where it stopped.
    # The market is never asked from this request (Thermos answers 429 when it is asked too often): a collection whose page is older than 90 seconds is put
    # into a queue, and ONE background worker refreshes the queue at a safe pace. The answer is made from the cached pages (not older than 5 minutes).
    ALL_TTL, STALE_AFTER = 15.0, 90
    all_cache = {}
    refresh_queue, refresh_lock = collections.OrderedDict(), threading.Lock()

    def queue_refresh(collection):
        with refresh_lock:
            refresh_queue.setdefault(str(collection['id']), collection)

    def refresher():
        time.sleep(15)
        while True:
            with refresh_lock:
                item = refresh_queue.popitem(last=False)[1] if refresh_queue else None
            if item is None:
                time.sleep(3)
                continue
            try:
                with app.app_context():
                    pack_ctx()['ensure_listings'](item, Decimal('0.01'), Decimal('100000000'))      # cached for a minute; a request limit only makes it fail fast
            except Exception:
                pass
            time.sleep(0.1)

    if not app.config.get('TESTING'):
        threading.Thread(target=refresher, daemon=True, name='partner-market-refresh').start()

    def all_lots(source, uid):
        key = (source, uid)
        hit = all_cache.get(key)
        if hit and time.time() - hit[0] < ALL_TTL:
            return hit[1], True, hit[0]
        ctx = pack_ctx()
        out, matched = [], set()
        players = crafter_candidates(uid) if source in ('all', 'crafter') else []
        ages = {}
        if source in ('all', 'market'):
            ages = {row['key']: int(row['updated']) for row in db().execute("SELECT key,updated FROM cache WHERE key LIKE 'public:market:upgrade:%'").fetchall()}
        canon = ctx['canonical_name']
        for collection in public_catalog():
            if source in ('all', 'crafter'):
                matched.add(canon(collection['name']))
                out += crafter_lots(collection, uid, players)
            if source in ('all', 'market'):
                if time.time() - ages.get('public:market:upgrade:%s:0:100000000' % collection['id'], 0) > STALE_AFTER:
                    queue_refresh(collection)
                out += market_lots(collection, False, 300)
        for canon_name, lot_id, price, gift in players:            # lots of players in collections that are not in the catalogue of the market
            if canon_name not in matched:
                lot = lot_view(gift, price, lot_id, 'crafter', 'Crafter')
                lot['collection_id'] = str(gift.get('collection_id') or canon_name)
                out.append(lot)
        all_cache[key] = (time.time(), out)
        if len(all_cache) > 200:
            all_cache.pop(min(all_cache, key=lambda k: all_cache[k][0]), None)
        return out, True, all_cache[key][0]

    @app.get(BASE + '/lots')
    @partner
    def p_lots():
        raw_collection = request.args.get('collection', '').strip()
        source = request.args.get('source', 'all')
        if source not in ('all', 'crafter', 'market'):
            raise PartnerError(400, 'bad_request', 'source: all, crafter или market')
        collection, as_of = None, int(time.time())
        if raw_collection:
            try:
                collection = find_collection(raw_collection)
            except PartnerError:
                # a collection of players that the market does not have: its lots of players are still shown
                canon = pack_ctx()['canonical_name']
                own = [c for c in crafter_candidates(g.partner['id']) if c[0] == canon(raw_collection) or str(c[3].get('collection_id') or '') == raw_collection]
                if not own or source == 'market':
                    raise
                collection = {'id': str(own[0][3].get('collection_id') or own[0][0]), 'name': own[0][3].get('name') or raw_collection}
        lots, complete = [], True
        if collection is None:
            lots, complete, as_of = all_lots(source, g.partner['id'])
            as_of = int(as_of)
        else:
            if source in ('all', 'crafter'):
                lots += crafter_lots(collection, g.partner['id'])
            if source in ('all', 'market'):
                lots += market_lots(collection)
        wanted = request.args.get('market', '').strip().lower()
        if wanted == 'thermos':                                    # «Thermos» is the backend of the connected market, not a name on the lot
            lots = [x for x in lots if x['source'] == 'market'] if pack_ctx()['thermos_backend']() else []
        elif wanted:
            lots = [x for x in lots if wanted in (str(x['market']).lower(), str(x.get('marketplace', '')).lower())]
        model = request.args.get('model', '').strip().lower()
        if model:
            lots = [x for x in lots if x['model'].lower() == model]
        number = request.args.get('number', '').strip()
        if number:
            lots = [x for x in lots if str(x['number']) == number]
        lots.sort(key=lambda x: Decimal(x['price']), reverse=request.args.get('sort') == 'price_desc')
        try:
            page, limit = max(1, int(request.args.get('page', 1))), min(50 if collection else 500, max(1, int(request.args.get('limit', 20))))
        except ValueError:
            raise PartnerError(400, 'bad_request', 'page и limit — целые числа')
        chunk = lots[(page - 1) * limit:page * limit]
        reply = {'ok': True, 'collection': {'id': str(collection['id']), 'name': collection['name']} if collection else None, 'page': page, 'limit': limit,
                 'total': len(lots), 'has_more': page * limit < len(lots), 'as_of': as_of, 'lots': chunk}
        if collection is None:
            reply['complete'] = complete
        return jsonify(reply)

    @app.get(BASE + '/lots/<path:lot_id>')
    @partner
    def p_lot(lot_id):
        """One lot, checked now: is it still for sale, and if not, why. For the Crafter market this is the database and the relayer; for the connected
        market the lot is asked from the market itself (when the market cannot be asked now, the answer says so and comes from the cache)."""
        checked = int(time.time())

        def reply(lot, available, reason=None, live=False, note=None):
            return jsonify({'ok': True, 'lot_id': lot_id, 'available': available, 'reason': reason, 'live': live, 'checked': checked, 'note': note, 'lot': lot})
        ctx = pack_ctx()
        if CRAFTER_LOT.match(lot_id):
            row = db().execute("""SELECT l.id,l.price,l.seller_id,i.payload,i.status FROM crafter_listings l
                LEFT JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id WHERE l.id=?""", (lot_id,)).fetchone()
            if not row or not row['payload']:
                return reply(None, False, 'sold_or_unlisted')
            gift = json.loads(row['payload'])
            if row['status'] != 'listed':
                return reply(None, False, 'not_listed')
            if row['seller_id'] == g.partner['id']:
                return reply(None, False, 'own_lot')
            if gift.get('pack_item') or gift.get('star_gift') or gift.get('pack_prize') or gift.get('catalog_only') or gift.get('test_only'):
                return reply(None, False, 'not_available')
            holds = relayer_holds() if ctx['work_mode']() else None
            if ctx['work_mode']() and gift.get('origin') != 'telegram-deposit' and not (gift.get('origin') == 'thermos' and holds is not None and slug_of(gift) in holds):
                return reply(None, False, 'not_deliverable')
            if holds is not None and slug_of(gift) not in holds:
                return reply(None, False, 'not_on_relayer')
            return reply(lot_view(gift, Decimal(str(row['price'])), row['id'], 'crafter', 'Crafter'), True, live=True)
        match = re.match(r'^m\.([^.]+)\.(.+)$', lot_id)
        if not match:
            raise PartnerError(400, 'bad_request', 'Неверный lot_id: берите его из GET /lots')
        collection = find_collection(match.group(1))
        found = next((x for x in market_lots(collection, False, 900) if x['lot_id'] == lot_id), None)
        gift = next((x for x, _p in ctx['market_candidates'](collection, 900) if str(x.get('id')) == match.group(2)), None)
        if not found or gift is None:
            return reply(None, False, 'not_in_market')
        listed = app.extensions['crafter_thermos_still_listed'](gift, gift['price']) if 'crafter_thermos_still_listed' in app.extensions else None
        if listed is False:
            return reply(None, False, 'sold_or_price_changed', live=True)
        if listed is None:
            return reply(found, True, live=False, note='Маркет сейчас не отвечает (лимит запросов): ответ из кэша, покупка всё равно проверит лот на маркете')
        return reply(found, True, live=True)

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

    STUCK_AFTER = 150

    def settle_stuck(row):
        """An operation that is still «processing» long after it began was interrupted (the server was restarted): its real outcome is read from the records
        of the purchase, otherwise it becomes «review» (unknown). Nobody has to wait for it for ever."""
        row = dict(row)
        if row['status'] != 'processing' or time.time() - int(row['created']) < STUCK_AFTER:
            return row
        uid, op = row['user_id'], row['op_id']
        http, payload = 503, {'ok': False, 'error': 'Операция прервана (перезапуск сервера). Итог неизвестен: сверьте баланс и инвентарь, новую операцию не создавайте', 'code': 'review'}
        if row['method'] == 'buy':
            order = db().execute("SELECT status,response FROM thermos_orders WHERE user_id=? AND request_id=?", (uid, op)).fetchone()
            receipt = db().execute("SELECT result FROM crafter_sale_receipts WHERE buyer_id=? AND request_id=?", (uid, op)).fetchone()
            if order and order['status'] == 'complete':
                done = json.loads(order['response'] or '{}')
                first = (done.get('gifts') or [{}])[0]
                http, payload = 200, {'state': 'done', 'recovered': True, 'gift': {'gift_id': first.get('id'), 'name': first.get('name'), 'number': first.get('number'), 'model': first.get('model') or ''},
                                      'balance': plain(balance_of(uid))}
            elif order and order['status'] == 'failed':
                http, payload = 409, {'ok': False, 'error': 'Покупка не выполнена, деньги возвращены', 'code': 'rejected'}
            elif receipt:
                http, payload = 200, {'state': 'done', 'recovered': True, 'balance': plain(balance_of(uid))}
        status = 'done' if http < 300 else ('review' if http == 503 else 'failed')
        with db():
            db().execute("UPDATE partner_ops SET status=?,http=?,result=?,finished=? WHERE user_id=? AND op_id=? AND status='processing'",
                         (status, http, json.dumps(payload, ensure_ascii=False), int(time.time()), uid, op))
        row.update(status=status, http=http, result=json.dumps(payload, ensure_ascii=False), finished=int(time.time()))
        return row

    @app.get(BASE + '/operations')
    @partner
    def p_operations():
        """The latest operations of the key (up to 100): to find out what became of the requests whose answer was lost."""
        status = request.args.get('status', '')
        if status and status not in ('processing', 'done', 'failed', 'review'):
            raise PartnerError(400, 'bad_request', 'status: processing, done, failed или review')
        try:
            limit = max(1, min(100, int(request.args.get('limit', 30))))
        except ValueError:
            raise PartnerError(400, 'bad_request', 'limit — целое число')
        rows = db().execute("SELECT * FROM partner_ops WHERE user_id=? ORDER BY created DESC LIMIT ?", (g.partner['id'], 100)).fetchall()
        out = []
        for row in rows:
            row = settle_stuck(row)
            if status and row['status'] != status:
                continue
            out.append({'operation_id': row['op_id'], 'method': row['method'], 'status': row['status'], 'http': row['http'], 'created': int(row['created']),
                        'finished': row['finished'], 'result': json.loads(row['result']) if row['result'] else None})
        return jsonify({'ok': True, 'operations': out[:limit]})

    @app.get(BASE + '/operations/<op_id>')
    @partner
    def p_operation(op_id):
        row = db().execute("SELECT * FROM partner_ops WHERE user_id=? AND op_id=?", (g.partner['id'], op_id)).fetchone()
        if not row:
            raise PartnerError(404, 'operation_not_found', 'Операции с таким Idempotency-Key нет. Отправьте исходный запрос с тем же ключом.')
        row = settle_stuck(row)
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
        earlier = db().execute("SELECT * FROM partner_ops WHERE user_id=? AND op_id=?", (uid, op_id)).fetchone()
        if earlier:
            settle_stuck(earlier)                                  # an interrupted «processing» becomes final before the repeat is answered
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
        def execute():
            try:
                return 200, handler(body, op_id)
            except PartnerError as error:
                return error.status, {'ok': False, 'error': error.message, 'code': error.code}
            except Exception:
                app.logger.exception('Partner operation failed')
                return 503, {'ok': False, 'error': 'Результат неизвестен: проверьте GET /operations/{id}', 'code': 'review'}

        def finish(http, payload):
            status = 'done' if http < 300 else ('review' if http == 503 else 'failed')
            with db():
                db().execute("UPDATE partner_ops SET status=?,http=?,result=?,finished=? WHERE user_id=? AND op_id=?", (status, http, json.dumps(payload, ensure_ascii=False), int(time.time()), uid, op_id))
            record('partner_' + name, {'op': op_id, 'status': status}, uid=uid)
            return status

        if name == 'buy':
            # Buying on the connected market waits for the market (up to 40 seconds). The client must not wait that long: after INLINE_WAIT seconds the
            # answer is 202 «processing» and the operation goes on in the background; its result is read from GET /operations/{operation_id}.
            outcome = {}

            def work(partner):
                with app.app_context():
                    g.partner = g.user = partner
                    code, answer = execute()
                    outcome.update(http=code, payload=answer, status=finish(code, answer))
            worker = threading.Thread(target=work, args=(dict(g.partner),), daemon=True, name='partner-buy')
            worker.start()
            worker.join(INLINE_WAIT)
            if 'status' not in outcome:
                slow = jsonify({'ok': True, 'operation_id': op_id, 'status': 'processing', 'result': None,
                                'note': 'Покупка выполняется. Итог: GET /operations/' + op_id})
                slow.status_code = 202
                return slow
            http, payload, status = outcome['http'], outcome['payload'], outcome['status']
        else:
            http, payload = execute()
            status = finish(http, payload)
        response = jsonify({'ok': http < 300, 'operation_id': op_id, 'status': status, 'result': payload})
        response.status_code = http
        return response

    def relay_error(status, body):
        message = body.get('error') or body.get('message') or 'Операция отклонена'
        code = {400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'rejected'}.get(status, 'failed' if status < 500 else 'review')
        if status == 409 and re.search(r'price|цен', message, re.I):
            code = 'price_changed'                                 # the lot was re-priced or bought by somebody else: take another lot or ask GET /lots again
        raise PartnerError(status if status in (400, 403, 404, 409) else (503 if status >= 500 else 409), code, message)

    def lot_for_buy(lot_id):
        """(kind, price, collection, native id) for a lot id from GET /lots."""
        if CRAFTER_LOT.match(lot_id):
            row = db().execute("SELECT l.price,i.payload FROM crafter_listings l JOIN inventory i ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed' WHERE l.id=?", (lot_id,)).fetchone()
            gift = json.loads(row['payload']) if row else None
            if not row or gift.get('pack_item') or gift.get('test_only') or gift.get('catalog_only'):
                raise PartnerError(404, 'lot_not_found', 'Лот уже продан или снят с продажи')
            holds = app.extensions['crafter_relayer_holds']() if pack_ctx()['work_mode']() and 'crafter_relayer_holds' in app.extensions else None
            if holds is not None and str(gift.get('telegram_slug') or '').lower() not in holds:
                raise PartnerError(404, 'lot_not_found', 'Подарка уже нет на релейере: лот недоступен')
            return 'crafter', Decimal(str(row['price'])), None, lot_id
        match = re.match(r'^m\.([^.]+)\.(.+)$', lot_id)
        if not match:
            raise PartnerError(400, 'bad_request', 'Неверный lot_id: берите его из GET /lots')
        collection = find_collection(match.group(1))
        found = next((x for x in market_lots(collection, False, 300) if x['lot_id'] == lot_id), None)   # the same pages as the catalogue showed; the purchase re-checks the lot on the market itself
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
        paid = body.get('pay_withdraw_fee', False)
        if type(paid) is not bool:
            raise PartnerError(400, 'bad_request', 'pay_withdraw_fee — true или false')
        if paid:                                                   # everything that can be checked is checked before the gift moves
            from gift_withdrawals import FEE_GRAM
            problem = app.extensions['crafter_nft_can_withdraw'](g.partner['id'], gift['gift_id'])
            if problem:
                raise PartnerError(409, 'withdraw_unavailable', problem + '. Передайте подарок без pay_withdraw_fee')
            if balance_of(g.partner['id']) < FEE_GRAM:
                raise PartnerError(409, 'insufficient_balance', 'Для оплаты вывода получателю нужно ' + plain(FEE_GRAM) + ' GRAM на балансе')
        status, reply = internal('POST', '/api/inventory/transfer', {'gift_ids': [gift['gift_id']], 'recipient_id': recipient, 'request_id': op_id, 'username': row['username'], 'quiet': paid})
        if status != 200:
            relay_error(status, reply)
        result = {'gift_id': gift['gift_id'], 'state': 'done', 'telegram_id': str(recipient), 'fee': '0'}
        if not paid:
            return result
        # the sender pays; the gift goes to the receiver's Telegram instead of staying in the receiver's inventory
        w_status, w_reply = internal('POST', '/api/gifts/withdraw-paid', {'gift_id': gift['gift_id'], 'recipient_id': recipient, 'username': row['username'], 'request_id': op_id})
        if w_status == 200:
            result['fee'] = plain(FEE_GRAM)
            result['withdraw'] = {'status': 'queued', 'withdrawal_id': w_reply.get('id'), 'fee': plain(FEE_GRAM), 'balance': plain(balance_of(g.partner['id'])),
                                  'note': 'Подарок выводится получателю в Telegram. Он получит сообщение от Crafter, когда вывод завершится'}
        else:                                                      # the gift stays in the receiver's Crafter inventory, nothing is charged
            result['withdraw'] = {'status': 'unavailable', 'fee': '0', 'reason': w_reply.get('error') or w_reply.get('message') or 'Вывод не удался',
                                  'note': 'Подарок передан в инвентарь получателя в Crafter, комиссия не списана'}
        return result

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
        sent = {'gift_id': gift['gift_id'], 'request_id': op_id}
        target = body.get('telegram_id')
        to = None
        if target not in (None, ''):                           # the relayer sends the gift to THIS Telegram account (a player of the partner), not to the owner of the key
            try:
                receiver = int(str(target))
            except ValueError:
                raise PartnerError(400, 'bad_request', 'telegram_id — число')
            if receiver != g.partner['id']:
                known = db().execute("SELECT username FROM users WHERE id=?", (receiver,)).fetchone()
                username = re.sub(r'^@', '', str(body.get('username') or (known['username'] if known else '') or '').strip())
                if not known and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{4,31}', username):
                    raise PartnerError(400, 'username_required', 'Получателя нет в Crafter: укажите его @username в поле username, иначе Telegram не найдёт аккаунт')
                if username and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{4,31}', username):
                    raise PartnerError(400, 'bad_request', 'username: латиница, цифры и _, от 5 до 32 символов')
                sent.update(receiver_id=receiver, receiver_username=username)
                to = {'telegram_id': str(receiver), 'username': username or None}
        status, reply = internal('POST', '/api/gifts/withdraw', sent)
        if status != 200:
            relay_error(status, reply)
        return {'gift_id': gift['gift_id'], 'withdrawal_id': reply.get('id'), 'status': reply.get('status', 'queued'), 'fee': plain(reply.get('fee_gram', '0')), 'to': to,
                'note': ('Подарок отправит релейер Crafter получателю в Telegram. Статус: GET /withdrawals' if to else 'Подарок отправит релейер Crafter вам в Telegram. Статус: GET /withdrawals')}

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
