"""Card packs: a pack holds 1-5 face-down cards, each card is a GRAM balance prize or a seasonal gift.

Packs are configured by administrators (card-count chances and prize chances), can be given as
community rewards, promo-code rewards or sold for New Year balls, and are opened with one request.
Gift prizes are catalog items: they can be sold back instantly for their value but never withdrawn.
"""
import gzip
import json
import re
import secrets
import time
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

from flask import abort, g, request

ROOT = Path(__file__).resolve().parent
SEASONAL = ('candycane', 'cookieheart', 'gingercookie', 'holidaydrink', 'jinglebells', 'partysparkler',
            'santahat', 'sleighbell', 'snowglobe', 'snowmittens', 'spicedwine', 'winterwreath', 'xmasstocking')
DEFAULT_PACK = 'newyear'
DEFAULT_IMAGE = '/static/assets/packs/default-pack.webp'
NEW_YEAR_IMAGE = '/static/assets/packs/new-year-pack.webp'
COLLECTION = ('packs', 'Pack')
# NFT-style backdrops: (name, centre colour, edge colour)
BACKDROPS = (('Moonstone', 0x8FC1D4, 0x3C7C93), ('Persimmon', 0xF08A4B, 0xB9501F), ('Emerald', 0x3FBF8A, 0x14684A), ('Raspberry', 0xE0557F, 0x8E1F46),
             ('Sapphire', 0x4F86E8, 0x1E3E8F), ('Amber', 0xF2B94B, 0xAE7416), ('Lavender', 0xB79CF0, 0x6A4BB5), ('Burgundy', 0xA13A4C, 0x4B1520),
             ('Pacific Cyan', 0x3BC4D9, 0x14788C), ('Midnight Blue', 0x4A5AA8, 0x161C45), ('Coral', 0xF27B6B, 0xAA3A33), ('Mint Green', 0x7AD9A8, 0x2F8B63),
             ('Fuchsia', 0xD960C7, 0x7E1F75), ('Silver Blue', 0x9FB6CF, 0x4F6580), ('Tomato', 0xE8503E, 0x8F1C14), ('Cobalt Blue', 0x3F6BD6, 0x172E80))
_LIMIT = 10**9
_rng = secrets.SystemRandom()


def singular(name):
    if name.endswith(('Bells', 'Mittens')):
        return name
    return name[:-1] if name.endswith('s') else name


_CATALOG = {}


def catalog():
    """Every gift collection with its models, from the bundled catalogue snapshot (cached)."""
    if not _CATALOG:
        path = ROOT / 'data/catalog_seed.json.gz'
        try:
            rows = json.loads(gzip.decompress(path.read_bytes())).get('collections', [])
        except (OSError, ValueError):
            rows = []
        for r in rows:
            if r.get('id'):
                _CATALOG[r['id']] = r
    return _CATALOG


def catalog_model(cid, model):
    for m in (catalog().get(cid) or {}).get('models', []):
        if str(m.get('name', '')).replace('\xa0', ' ').strip().lower() == str(model).replace('\xa0', ' ').strip().lower():
            return m
    return None


def seasonal_collections():
    path = ROOT / 'data/catalog_seed.json.gz'
    if not path.exists():
        return []
    try:
        rows = json.loads(gzip.decompress(path.read_bytes())).get('collections', [])
    except (OSError, ValueError):
        return []
    found = {r.get('id'): r for r in rows if r.get('id') in SEASONAL}
    out = []
    for cid in SEASONAL:
        r = found.get(cid)
        if not r:
            continue
        try:
            value = Decimal(str(r.get('floor_price') or '0'))
        except InvalidOperation:
            value = Decimal('0')
        out.append({'id': cid, 'name': singular(r.get('name') or cid), 'image': r.get('photo_url') or '',
                    'value': plain(value)})
    return out


def plain(d):
    return format(d.normalize(), 'f') if d else '0'


def money(value, name='сумма'):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        abort(400, description='Неверная ' + name)
    if not amount.is_finite() or not Decimal('0.01') <= amount <= Decimal('100000') or amount != amount.quantize(Decimal('0.000001')):
        abort(400, description='Сумма: от 0.01 до 100000, до 6 знаков')
    return amount


def install_packs(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS packs(
            id TEXT PRIMARY KEY, title TEXT NOT NULL, image_url TEXT NOT NULL,
            card_weights TEXT NOT NULL, for_sale BIGINT NOT NULL DEFAULT 0,
            price_balls BIGINT NOT NULL DEFAULT 0, enabled BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pack_prizes(
            id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, kind TEXT NOT NULL, amount TEXT NOT NULL DEFAULT '',
            collection_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL DEFAULT '0', weight DOUBLE PRECISION NOT NULL, position BIGINT NOT NULL DEFAULT 0,
            model TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS user_packs(
            id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, pack_id TEXT NOT NULL, source TEXT NOT NULL,
            request_id TEXT, created BIGINT NOT NULL, opened_at BIGINT, result TEXT
        );
        """)
        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE pack_prizes ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT ''")
        else:
            cols = [r['name'] for r in database.execute("PRAGMA table_info(pack_prizes)").fetchall()]
            if 'model' not in cols:
                database.execute("ALTER TABLE pack_prizes ADD COLUMN model TEXT NOT NULL DEFAULT ''")
        if not db().execute("SELECT 1 FROM packs WHERE id=?", (DEFAULT_PACK,)).fetchone() \
                and not db().execute("SELECT 1 FROM packs LIMIT 1").fetchone():
            now = int(time.time())
            db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                         (DEFAULT_PACK, 'New Year', NEW_YEAR_IMAGE,
                          json.dumps({'1': 30, '2': 30, '3': 20, '4': 12, '5': 8}), 0, 0, 1, now))
            rows = [('GRAM', a, '', 'GRAM', '', a, w) for a, w in
                    (('0.1', 400), ('0.2', 300), ('0.5', 200), ('1', 120), ('2', 60), ('2.5', 40), ('3', 30), ('5', 10))]
            for c in seasonal_collections():
                try:
                    v = Decimal(c['value'])
                except InvalidOperation:
                    continue
                if v > 0:
                    rows.append(('NFT', '', c['id'], c['name'], c['image'], c['value'], max(0.3, round(45 / float(v), 2))))
            for pos, (kind, amount, cid, name, image, value, weight) in enumerate(rows):
                db().execute("INSERT INTO pack_prizes(id,pack_id,kind,amount,collection_id,name,image,value,weight,position) "
                             "VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (uuid.uuid4().hex, DEFAULT_PACK, kind, str(amount), cid, name, image, str(value), float(weight), pos))

    def put_prize(pid, pos, kind, amount, cid, name, image, value, weight, model=''):
        db().execute("INSERT INTO pack_prizes(id,pack_id,kind,amount,collection_id,name,image,value,weight,position,model) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                     (uuid.uuid4().hex, pid, kind, amount, cid, name, image, value, weight, pos, model))

    def _canon(v):
        return re.sub(r'[^a-z0-9]', '', str(v or '').lower())

    def live_value(prize):
        """Current floor of the prize collection on the connected market, in GRAM. The saved value is only a fallback."""
        if prize['kind'] != 'NFT':
            return Decimal(prize['amount'] or '0')
        if prize.get('model') if isinstance(prize, dict) else prize['model']:
            return Decimal(prize['value'] or '0')
        want = _canon(prize['name']) or _canon(prize['collection_id'])
        ctx = pack_ctx()
        thermos = bool(ctx and ctx['thermos_backend']())
        try:
            rate = Decimal(str(ctx['gram_per_ton']())) if ctx else Decimal('1')
        except Exception:
            rate = Decimal('1')
        order = ('thermos:collections', 'collections') if thermos else ('collections', 'thermos:collections')
        for key in order:
            row = db().execute("SELECT payload FROM cache WHERE key=?", (key,)).fetchone()
            if not row:
                continue
            try:
                rows = json.loads(row['payload'])
            except ValueError:
                continue
            for c in rows if isinstance(rows, list) else []:
                names = {_canon(c.get('name')), _canon(c.get('short_name')), _canon(c.get('id'))}
                if want in names or want + 's' in names or _canon(prize['collection_id']) in names:
                    try:
                        v = Decimal(str(c.get('floor_price') or '0'))
                    except InvalidOperation:
                        continue
                    if v > 0:
                        unit = c.get('price_unit') or ('TON' if key == 'thermos:collections' else 'GRAM')
                        return (v * rate if unit == 'TON' else v).quantize(Decimal('0.01'))
        return Decimal(prize['value'] or '0')

    SNOWMAN_IMAGE = '/static/assets/packs/snowman-pack.webp'
    # (collection, model, GRAM value from the market screenshots)
    SNOWMAN_GIFTS = (('jellybunny', 'Snowman', '11'), ('gingercookie', 'Snowman', '5.61'), ('happybrownie', 'Snowman', '4.45'),
                     ('bunnymuffin', 'Snowman', '10.79'), ('winterwreath', 'Snowman', '7.6'), ('hangingstar', 'Snowman', '10.71'),
                     ('snowmittens', 'Frost Fingers', '10.5'), ('xmasstocking', 'Translucent', '4.18'), ('bdaycandle', 'Winter Fun', '5.25'),
                     ('springbasket', 'Penguin', '6.86'), ('vicecream', 'Iceman', '4.08'), ('snowglobe', 'Winter', '7.18'))
    # per-mille chance of one card being this GRAM amount (the gifts share the rest)
    SNOWMAN_GRAM = (('0.1', 700), ('0.2', 150), ('0.3', 60), ('0.5', 40), ('1', 22), ('2', 9), ('3', 4), ('5', 1.5), ('10', .4))

    def seed_snowman_pack():
        if db().execute("SELECT 1 FROM settings WHERE key='packs_snowman_v1'").fetchone():
            return
        with db():
            if not pack_row('snowman'):
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             ('snowman', 'Snowman', SNOWMAN_IMAGE, json.dumps({'1': 62, '2': 28, '3': 10}), 0, 0, 1, int(time.time())))
                pos = 0
                for amount, weight in SNOWMAN_GRAM:
                    put_prize('snowman', pos, 'GRAM', amount, '', 'GRAM', '', amount, weight)
                    pos += 1
                gifts = []
                for cid, model, value in SNOWMAN_GIFTS:
                    col, m = catalog().get(cid), catalog_model(cid, model)
                    if col and m:
                        gifts.append((cid, singular(col.get('name') or cid), m['image'], value, model))
                # gifts together are about 1.5 cards in a thousand... cheaper ones a little more often
                total = 15.0
                inv = [1 / float(g[3]) for g in gifts]
                for g, w in zip(gifts, inv):
                    put_prize('snowman', pos, 'NFT', '', g[0], g[1], g[2], g[3], round(total * w / (sum(inv) or 1), 3), g[4])
                    pos += 1
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_snowman_v1','1') ON CONFLICT(key) DO NOTHING")
            db().execute("UPDATE packs SET title='New Year' WHERE id=? AND title='Новогодний пак'", (DEFAULT_PACK,))

    def tune_default_pack():
        """Once: add 0.1 GRAM and make the gifts rarer in the default pack, unless the administrator already changed it."""
        marker = db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v2'").fetchone()
        if marker:
            return
        with db():
            rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=? ORDER BY position", (DEFAULT_PACK,)).fetchall()
            if rows:
                old_nft = all(abs(float(r['weight']) - round(75 / float(r['value']), 2)) < 0.011 for r in rows if r['kind'] == 'NFT' and Decimal(r['value'] or '0') > 0)
                if old_nft:
                    for r in rows:
                        if r['kind'] == 'NFT' and Decimal(r['value'] or '0') > 0:
                            db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (max(0.3, round(45 / float(r['value']), 2)), r['id']))
                    if not any(r['kind'] == 'GRAM' and r['amount'] == '0.1' for r in rows):
                        db().execute("INSERT INTO pack_prizes(id,pack_id,kind,amount,collection_id,name,image,value,weight,position) VALUES(?,?,?,?,?,?,?,?,?,?)",
                                     (uuid.uuid4().hex, DEFAULT_PACK, 'GRAM', '0.1', '', 'GRAM', '', '0.1', 400.0, -1))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v2','1') ON CONFLICT(key) DO NOTHING")


    def pack_row(pid):
        return db().execute("SELECT * FROM packs WHERE id=?", (pid,)).fetchone()

    def prizes_of(pid):
        return db().execute("SELECT * FROM pack_prizes WHERE pack_id=? ORDER BY position", (pid,)).fetchall()

    def short(p):
        return {'id': p['id'], 'title': p['title'], 'image': p['image_url']}

    with app.app_context():
        tune_default_pack()
        seed_snowman_pack()

    def grant(uid, pack_id, source, request_id=None):
        """Give one unopened pack to a player. Must run inside a transaction."""
        pack = pack_row(pack_id)
        if not pack:
            abort(409, description='Пак не найден')
        if request_id:
            have = db().execute("SELECT id FROM user_packs WHERE user_id=? AND request_id=?", (uid, request_id)).fetchone()
            if have:
                return have['id']
        upid = uuid.uuid4().hex
        db().execute("INSERT INTO user_packs(id,user_id,pack_id,source,request_id,created) VALUES(?,?,?,?,?,?)",
                     (upid, uid, pack_id, source, request_id, int(time.time())))
        serial = int(db().execute("SELECT COUNT(*) AS n FROM user_packs WHERE pack_id=?", (pack_id,)).fetchone()['n'])
        bd = _rng.choice(BACKDROPS)
        gift = {'id': 'packitem-' + upid, 'name': COLLECTION[1], 'number': serial, 'model': pack['title'],
                'symbol': '', 'image': pack['image_url'], 'price': '0', 'price_unit': 'GRAM',
                'backdrop': bd[0], 'background': {'center_color': bd[1], 'edge_color': bd[2]},
                'collection_id': COLLECTION[0], 'collection_name': COLLECTION[1], 'origin': 'pack', 'pack_item': True,
                'pack_id': pack_id, 'user_pack_id': upid}
        db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)",
                     (uid, gift['id'], json.dumps(gift, ensure_ascii=False), 'unlisted'))
        return upid

    app.extensions['crafter_grant_pack'] = grant
    app.extensions['crafter_pack_exists'] = lambda pid: bool(pack_row(pid))
    app.extensions['crafter_pack_short'] = lambda pid: (short(pack_row(pid)) if pack_row(pid) else None)

    def credit(uid, amount):
        account = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        before = Decimal(str(account['balance'])) if account else Decimal('0')
        after = before + amount
        db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
                     (uid, str(after)))
        return after

    def pick(weights):
        total = sum(w for _, w in weights)
        point = _rng.uniform(0, total)
        run = 0.0
        for item, w in weights:
            run += w
            if point <= run:
                return item
        return weights[-1][0]

    @app.get('/api/packs')
    @auth()
    def packs_state():
        uid = g.user['id']
        mine = db().execute(
            "SELECT u.id,u.source,p.id AS pid,p.title,p.image_url FROM user_packs u JOIN packs p ON p.id=u.pack_id "
            "JOIN inventory i ON i.nft_id='packitem-'||u.id "
            "WHERE i.user_id=? AND u.opened_at IS NULL ORDER BY u.created", (uid,)).fetchall()
        shop = db().execute("SELECT * FROM packs WHERE for_sale=1 AND enabled=1 ORDER BY created").fetchall()
        return {'mine': [{'id': r['id'], 'source': r['source'], 'pack': {'id': r['pid'], 'title': r['title'], 'image': r['image_url']}} for r in mine],
                'shop': [{**short(p), 'price_balls': int(p['price_balls'])} for p in shop]}

    @app.get('/api/packs/<pid>/contents')
    @auth()
    def packs_contents(pid):
        pack = pack_row(pid)
        if not pack or not pack['enabled']:
            abort(404, description='Пак не найден')
        prizes = prizes_of(pid)
        total = sum(float(p['weight']) for p in prizes) or 1.0
        cards = {int(k): float(v) for k, v in json.loads(pack['card_weights']).items() if float(v) > 0}
        ctotal = sum(cards.values()) or 1.0
        items = []
        for p in prizes:
            if float(p['weight']) <= 0:
                continue
            v = live_value(p)
            items.append({'kind': p['kind'], 'amount': p['amount'], 'name': p['name'], 'model': p['model'], 'image': p['image'], 'value': plain(v),
                          'chance': round(float(p['weight']) / total * 100, 2)})
        items.sort(key=lambda x: (Decimal(x['value'] or '0'), x['kind']))
        values = [Decimal(x['value'] or '0') for x in items] or [Decimal('0')]
        return {'pack': short(pack), 'prizes': items, 'min': plain(min(values)), 'max': plain(max(values)),
                'cards': [{'count': k, 'chance': round(v / ctotal * 100, 2)} for k, v in sorted(cards.items())]}

    @app.post('/api/packs/buy')
    @auth()
    def packs_buy():
        body = request.get_json(silent=True) or {}
        pid, rid = body.get('pack_id'), body.get('request_id')
        if not isinstance(pid, str) or not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', rid):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            pack = pack_row(pid)
            if not pack or not pack['enabled'] or not pack['for_sale']:
                abort(409, description='Пак сейчас не продаётся')
            done = db().execute("SELECT id FROM user_packs WHERE user_id=? AND request_id=?", (uid, 'buy:' + rid)).fetchone()
            row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
            balls = int(row['balls']) if row else 0
            if done:
                return {'ok': True, 'user_pack_id': done['id'], 'balance': {'balls': balls}}
            price = int(pack['price_balls'])
            if balls < price:
                abort(409, description='Недостаточно новогодних шаров')
            if price:
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls - price, uid))
            upid = grant(uid, pid, 'shop', 'buy:' + rid)
            record('pack_buy', {'pack': pid, 'price_balls': price}, uid=uid)
        return {'ok': True, 'user_pack_id': upid, 'balance': {'balls': balls - price}}

    # ---- real market access for gift prizes ----
    avail_cache = {}
    app.extensions['crafter_pack_avail_cache'] = avail_cache

    def pack_ctx():
        return app.extensions.get('crafter_pack_ctx')

    def work_mode():
        ctx = pack_ctx()
        return bool(ctx and ctx['work_mode']())

    def market_lots(prize):
        """Cheapest real lots of the prize collection on the connected market: [(listing view, GRAM price)]."""
        ctx = pack_ctx()
        canon = ctx['canonical_name']
        target = next((c for c in ctx['public_catalog']() if canon(c.get('name', '')) == canon(prize['name'])
                       or str(c.get('id')) == str(prize['collection_id'])), None)
        if not target:
            return []
        floor = live_value(prize)
        limit = max(floor * Decimal('2'), Decimal('1'))
        try:
            ctx['ensure_listings'](target, Decimal('0.01'), limit)
        except Exception:
            pass
        rate = Decimal(str(ctx['gram_per_ton']()))
        lots = []
        for gift, price in ctx['market_candidates'](target):
            unit = gift.get('price_unit', 'GRAM')
            if unit == 'TON':
                price = (Decimal(str(price)) * rate).quantize(Decimal('0.01')) if ctx['thermos_backend']() else None
            elif unit != 'GRAM':
                price = None
            if price is None or Decimal(str(price)) > limit or not gift.get('image') or not gift.get('model'):
                continue
            if prize['model'] and str(gift.get('model', '')).replace('\xa0', ' ').strip().lower() != prize['model'].replace('\xa0', ' ').strip().lower():
                continue
            shown = {'id': gift['id'], 'name': gift.get('name'), 'number': gift.get('number'), 'model': gift.get('model', ''),
                     'backdrop': gift.get('backdrop', ''), 'symbol': gift.get('symbol', ''), 'image': gift.get('image', ''),
                     'background': gift.get('background'), 'collection_id': gift.get('collection_id'),
                     'price': str(price), 'price_unit': 'GRAM', 'source': 'portals',
                     'market': gift.get('marketplace') or ('Thermos' if ctx['thermos_backend']() else 'Portals'),
                     'marketplace': gift.get('marketplace')}
            if unit == 'TON':
                shown['ton_price'] = str(gift['price'])
            lots.append((shown, Decimal(str(price))))
        lots.sort(key=lambda x: x[1])
        return lots[:6]

    def availability(prizes):
        """prize id -> real lots (WORK mode). Cached for two minutes so opening a pack stays quick."""
        out, now = {}, time.time()
        for p in prizes:
            if p['kind'] != 'NFT' or float(p['weight']) <= 0:
                continue
            hit = avail_cache.get(p['id'])
            if not hit or now - hit[0] > (120 if hit[1] else 20):
                try:
                    hit = (now, market_lots(p))
                except Exception:
                    hit = (now, [])
                avail_cache[p['id']] = hit
            out[p['id']] = list(hit[1])
        return out

    def test_models(cid):
        path = ROOT / 'data/catalog_seed.json.gz'
        try:
            rows = json.loads(gzip.decompress(path.read_bytes())).get('collections', [])
        except (OSError, ValueError):
            return []
        for c in rows:
            if c.get('id') == cid:
                return [m for m in c.get('models', []) if m.get('image')]
        return []

    @app.post('/api/packs/open')
    @auth()
    def packs_open():
        body = request.get_json(silent=True) or {}
        upid = body.get('user_pack_id')
        if not isinstance(upid, str) or not re.fullmatch(r'[a-f0-9]{32}', upid):
            abort(400, description='Неверный пак')
        uid = g.user['id']
        real = work_mode()
        early = db().execute("SELECT pack_id,opened_at FROM user_packs WHERE id=?", (upid,)).fetchone()
        lots_by_prize = availability(prizes_of(early['pack_id'])) if (real and early and not early['opened_at']) else {}
        pending = []        # [(card, listing, price)] real purchases to make after the pack is opened
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT * FROM user_packs WHERE id=?", (upid,)).fetchone()
            if not row:
                abort(404, description='Пак не найден')
            if row['opened_at']:
                if int(row['user_id']) != uid:
                    abort(404, description='Пак не найден')
                return {**json.loads(row['result']), 'repeat': True}
            item = db().execute("SELECT status FROM inventory WHERE user_id=? AND nft_id=?", (uid, 'packitem-' + upid)).fetchone()
            if not item:
                abort(404, description='Пак не найден')
            if item['status'] != 'unlisted':
                abort(409, description='Сначала снимите пак с продажи')
            db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=?", (uid, 'packitem-' + upid))
            pack = pack_row(row['pack_id'])
            prizes = [p for p in prizes_of(row['pack_id']) if float(p['weight']) > 0]
            if not pack or not prizes:
                abort(409, description='Пак ещё не настроен')
            counts = [(int(k), float(v)) for k, v in json.loads(pack['card_weights']).items() if float(v) > 0 and 1 <= int(k) <= 5]
            if not counts:
                abort(409, description='В паке не заданы шансы количества карточек')
            n = pick(counts)
            cards, total, used = [], Decimal('0'), set()
            for _ in range(n):
                pool = list(prizes)
                while True:
                    # Gifts that are not available on the market cannot drop in WORK mode; their chance is zero.
                    eligible = [p for p in pool if p['kind'] == 'GRAM' or not real or
                                any(l[0]['id'] not in used for l in lots_by_prize.get(p['id'], []))]
                    if not eligible:
                        eligible = [p for p in prizes if p['kind'] == 'GRAM']
                    if not eligible:
                        abort(409, description='Сейчас в паке нечего выдать: подарков нет на маркете')
                    prize = pick([(p, float(p['weight'])) for p in eligible])
                    break
                if prize['kind'] == 'GRAM':
                    amount = Decimal(prize['amount'])
                    total += amount
                    cards.append({'kind': 'GRAM', 'amount': plain(amount), 'title': '+' + plain(amount) + ' GRAM'})
                elif real:
                    shown, price = next(l for l in lots_by_prize[prize['id']] if l[0]['id'] not in used)
                    used.add(shown['id'])
                    card = {'kind': 'NFT', 'nft_id': 'thermos-' + uuid.uuid4().hex, 'title': str(shown['name']) + ' ' + str(shown['model']),
                            'image': shown['image'], 'value': plain(price), 'real': True}
                    cards.append(card)
                    pending.append((card, shown, price))
                else:
                    worth = plain(live_value(prize))
                    models = test_models(prize['collection_id'])
                    model = ({'name': prize['model'], 'image': prize['image']} if prize['model'] else (_rng.choice(models) if models else None))
                    bd = _rng.choice(BACKDROPS)
                    gift = {'id': 'pack-' + uuid.uuid4().hex, 'name': prize['name'], 'number': _rng.randint(1000, 99999),
                            'model': model['name'].replace('\xa0', ' ') if model else '', 'symbol': '', 'backdrop': bd[0],
                            'background': {'center_color': bd[1], 'edge_color': bd[2]},
                            'image': model['image'] if model else prize['image'], 'price': worth,
                            'price_unit': 'GRAM', 'floor_price': worth, 'floor_unit': 'GRAM',
                            'collection_id': prize['collection_id'], 'origin': 'pack', 'catalog_only': True,
                            'test_only': True, 'pack_prize': True}
                    db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)",
                                 (uid, gift['id'], json.dumps(gift, ensure_ascii=False), 'unlisted'))
                    cards.append({'kind': 'NFT', 'nft_id': gift['id'], 'title': prize['name'] + (' ' + gift['model'] if gift['model'] else ''),
                                  'image': gift['image'], 'value': worth})
            after = credit(uid, total)
            result = {'ok': True, 'pack': short(pack), 'cards': cards, 'balance': str(after),
                      'credited': plain(total) if total else '0'}
            db().execute("UPDATE user_packs SET opened_at=?,result=?,user_id=? WHERE id=?",
                         (int(time.time()), json.dumps(result, ensure_ascii=False), uid, upid))
        if pending:
            ctx = pack_ctx()
            for card, shown, price in pending:
                try:
                    outcome, note = ctx['acquire']([shown])
                except Exception:
                    outcome, note = 'unknown', ''
                with db():
                    db().execute('BEGIN IMMEDIATE')
                    if outcome == 'ok':
                        gift = {**shown, 'id': card['nft_id'], 'source_id': shown['id'], 'origin': 'thermos', 'price': str(price),
                                'price_unit': 'GRAM', 'relayer_pending': True, 'source_price': str(shown.get('ton_price') or shown['price']),
                                'source_price_unit': 'TON' if shown.get('ton_price') else 'GRAM'}
                        db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)",
                                     (uid, card['nft_id'], json.dumps(gift, ensure_ascii=False), 'unlisted'))
                        card.pop('real', None)
                    elif outcome == 'failed':
                        card.clear()
                        card.update(kind='GRAM', amount=plain(price), title='+' + plain(price) + ' GRAM', note='Подарок не удалось выкупить — зачислена его стоимость')
                        total += price
                        result['balance'] = str(credit(uid, price))
                    else:
                        card.update(pending=True, nft_id=None, note='Подарок появится в инвентаре после проверки')
                        audit('Pack gift purchase needs review: ' + str(shown.get('name')) + ' for ' + str(uid))
                    result['credited'] = plain(total) if total else '0'
                    db().execute("UPDATE user_packs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), upid))
        record('pack_open', {'pack': pack['id'], 'cards': cards, 'credited': result['credited']}, uid=uid)
        return result

    @app.post('/api/packs/sell')
    @auth()
    def packs_sell():
        body = request.get_json(silent=True) or {}
        ids = body.get('nft_ids')
        if not isinstance(ids, list) or not ids or len(ids) > 5 or any(not isinstance(x, str) for x in ids) or len(set(ids)) != len(ids):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        total = Decimal('0')
        with db():
            db().execute('BEGIN IMMEDIATE')
            for nft in ids:
                row = db().execute("SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?", (uid, nft)).fetchone()
                if not row:
                    abort(409, description='Подарок уже продан или недоступен')
                gift = json.loads(row['payload'])
                if not gift.get('pack_prize') or row['status'] != 'unlisted':
                    abort(409, description='Этот подарок нельзя продать здесь')
                total += Decimal(str(gift.get('price') or '0'))
                db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=?", (uid, nft))
            after = credit(uid, total)
            record('pack_sell', {'nft_ids': ids, 'amount': str(total)}, uid=uid)
        return {'ok': True, 'amount': plain(total), 'balance': str(after)}

    # ---- administration (permission section: new-year) ----
    def admin_pack(p):
        return {**short(p), 'card_weights': json.loads(p['card_weights']), 'for_sale': bool(p['for_sale']),
                'price_balls': int(p['price_balls']), 'enabled': bool(p['enabled']),
                'prizes': [{'kind': r['kind'], 'amount': r['amount'], 'collection_id': r['collection_id'], 'name': r['name'],
                            'image': r['image'], 'value': r['value'], 'weight': r['weight'], 'model': r['model']} for r in prizes_of(p['id'])]}

    @app.get('/api/admin/new-year/packs')
    @auth(admin=True)
    def admin_packs():
        rows = db().execute("SELECT * FROM packs ORDER BY created").fetchall()
        cols = []
        for c in seasonal_collections():
            v = live_value({'kind': 'NFT', 'name': c['name'], 'collection_id': c['id'], 'value': c['value']})
            cols.append({**c, 'value': plain(v)})
        return {'packs': [admin_pack(p) for p in rows], 'collections': cols}

    @app.get('/api/admin/new-year/catalog')
    @auth(admin=True)
    def admin_catalog():
        out = []
        for cid, c in catalog().items():
            try:
                v = Decimal(str(c.get('floor_price') or '0'))
            except InvalidOperation:
                v = Decimal('0')
            out.append({'id': cid, 'name': singular(c.get('name') or cid), 'image': c.get('photo_url') or '', 'value': plain(v), 'models': len(c.get('models', []))})
        out.sort(key=lambda x: x['name'].lower())
        return {'collections': out}

    @app.get('/api/admin/new-year/catalog/<cid>/models')
    @auth(admin=True)
    def admin_catalog_models(cid):
        c = catalog().get(cid)
        if not c:
            abort(404, description='Коллекция не найдена')
        return {'models': [{'name': str(m.get('name', '')).replace('\xa0', ' '), 'image': m.get('image', ''), 'price': str(m.get('price') or '')} for m in c.get('models', []) if m.get('image')]}

    @app.post('/api/admin/new-year/packs')
    @auth(admin=True)
    def admin_pack_save():
        body = request.get_json(silent=True) or {}
        title = str(body.get('title') or '').strip()
        if not 1 <= len(title) <= 80:
            abort(400, description='Название пака: 1–80 символов')
        image = str(body.get('image_url') or DEFAULT_IMAGE).strip()
        if not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        raw = body.get('card_weights')
        weights = {}
        for k in '12345':
            try:
                v = float((raw or {}).get(k, 0) or 0)
            except (TypeError, ValueError):
                abort(400, description='Шансы количества карточек — числа')
            if v < 0 or v > _LIMIT:
                abort(400, description='Неверный шанс количества карточек')
            weights[k] = v
        if sum(weights.values()) <= 0:
            abort(400, description='Задайте хотя бы один шанс количества карточек')
        try:
            price = int(body.get('price_balls') or 0)
        except (TypeError, ValueError):
            abort(400, description='Цена — целое число шаров')
        if not 0 <= price <= _LIMIT:
            abort(400, description='Цена: от 0 до 1 000 000 000')
        raw_prizes = body.get('prizes')
        if not isinstance(raw_prizes, list) or not 1 <= len(raw_prizes) <= 80:
            abort(400, description='В паке должно быть от 1 до 80 призов')
        rows = []
        for item in raw_prizes:
            if not isinstance(item, dict):
                abort(400, description='Неверный приз')
            try:
                weight = float(item.get('weight'))
            except (TypeError, ValueError):
                abort(400, description='Шанс приза — число')
            if not 0 < weight <= _LIMIT:
                abort(400, description='Шанс приза: больше 0')
            if item.get('kind') == 'GRAM':
                amount = money(item.get('amount'))
                rows.append(('GRAM', plain(amount), '', 'GRAM', '', plain(amount), weight, ''))
            elif item.get('kind') == 'NFT':
                col = catalog().get(item.get('collection_id'))
                if not col:
                    abort(400, description='Неизвестный подарок')
                model = str(item.get('model') or '').strip()
                found = catalog_model(col['id'], model) if model else None
                if model and not found:
                    abort(400, description='У этого подарка нет такой модели')
                base = Decimal(str(col.get('floor_price') or '0'))
                given = item.get('value') or (found or {}).get('price') or (plain(base) if base else '')
                if not given or str(given) in ('0', '0.0'):
                    abort(400, description='У подарка нет цены — укажите цену продажи')
                value = money(given, 'цена продажи')
                rows.append(('NFT', '', col['id'], singular(col.get('name') or col['id']), (found or {}).get('image') or col.get('photo_url') or '', plain(value), weight, (found or {}).get('name', '') if found else ''))
            else:
                abort(400, description='Тип приза: GRAM или подарок')
        pid = body.get('id') if isinstance(body.get('id'), str) and re.fullmatch(r'[a-z0-9_-]{1,40}', body.get('id') or '') else None
        now = int(time.time())
        with db():
            db().execute('BEGIN IMMEDIATE')
            if pid and pack_row(pid):
                db().execute("UPDATE packs SET title=?,image_url=?,card_weights=?,for_sale=?,price_balls=?,enabled=? WHERE id=?",
                             (title, image, json.dumps(weights), int(bool(body.get('for_sale'))), price, int(body.get('enabled', True) is not False), pid))
                db().execute("DELETE FROM pack_prizes WHERE pack_id=?", (pid,))
            else:
                pid = uuid.uuid4().hex[:12]
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             (pid, title, image, json.dumps(weights), int(bool(body.get('for_sale'))), price, int(body.get('enabled', True) is not False), now))
            for pos, (kind, amount, cid, name, img, value, weight, model) in enumerate(rows):
                put_prize(pid, pos, kind, amount, cid, name, img, value, weight, model)
        audit('Pack saved: ' + title)
        return {'ok': True, 'id': pid}

    @app.post('/api/admin/new-year/packs/<pid>/delete')
    @auth(admin=True)
    def admin_pack_delete(pid):
        with db():
            if db().execute("SELECT 1 FROM user_packs WHERE pack_id=? LIMIT 1", (pid,)).fetchone():
                abort(409, description='Этот пак уже выдавали — отключите его вместо удаления')
            if db().execute("SELECT 1 FROM community_milestones WHERE reward_kind='PACK' AND reward_amount=? LIMIT 1", (pid,)).fetchone():
                abort(409, description='Пак используется как награда события')
            db().execute("DELETE FROM pack_prizes WHERE pack_id=?", (pid,))
            if not db().execute("DELETE FROM packs WHERE id=?", (pid,)).rowcount:
                abort(404, description='Пак не найден')
        audit('Pack deleted ' + pid)
        return {'ok': True}
