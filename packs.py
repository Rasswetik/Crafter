"""Card packs: a pack holds 1-5 face-down cards, each card is a GRAM balance prize or a seasonal gift.

Packs are configured by administrators (card-count chances and prize chances), can be given as
community rewards, promo-code rewards or sold for New Year balls, and are opened with one request.
Gift prizes are catalog items: they can be sold back instantly for their value but never withdrawn.
"""
import threading
import gzip
from urllib.parse import quote
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
COLLECTION = ('packs', 'Lucky Pack')
# NFT-style backdrops: (name, centre colour, edge colour)
BACKDROPS = (('Moonstone', 0x8FC1D4, 0x3C7C93), ('Persimmon', 0xF08A4B, 0xB9501F), ('Emerald', 0x3FBF8A, 0x14684A), ('Raspberry', 0xE0557F, 0x8E1F46),
             ('Sapphire', 0x4F86E8, 0x1E3E8F), ('Amber', 0xF2B94B, 0xAE7416), ('Lavender', 0xB79CF0, 0x6A4BB5), ('Burgundy', 0xA13A4C, 0x4B1520),
             ('Pacific Cyan', 0x3BC4D9, 0x14788C), ('Midnight Blue', 0x4A5AA8, 0x161C45), ('Coral', 0xF27B6B, 0xAA3A33), ('Mint Green', 0x7AD9A8, 0x2F8B63),
             ('Fuchsia', 0xD960C7, 0x7E1F75), ('Silver Blue', 0x9FB6CF, 0x4F6580), ('Tomato', 0xE8503E, 0x8F1C14), ('Cobalt Blue', 0x3F6BD6, 0x172E80))
# More backdrops, each described by hue / saturation / lightness so that a family reads as one colour.
_FAMILIES = {
    # blues and cyans
    'Navy Blue': (226, .62, .40), 'Sky Blue': (200, .78, .64), 'Steel Blue': (207, .40, .54), 'Azure Blue': (206, .85, .56),
    'French Blue': (214, .60, .60), 'Ice Blue': (197, .55, .76), 'Indigo Dye': (238, .50, .44), 'Ultramarine': (236, .72, .52),
    'Turquoise': (176, .62, .52), 'Mexican Pink': (335, .65, .66),
    # greens, mint and snow whites
    'Pine Green': (160, .55, .34), 'Hunter Green': (145, .40, .36), 'Jade Green': (150, .50, .50), 'Malachite': (142, .70, .46),
    'Shamrock Green': (140, .55, .46), 'Pacific Green': (168, .58, .46), 'Pistachio': (88, .38, .64), 'Ivory White': (60, .20, .88),
    'Platinum': (210, .08, .78), 'Roman Silver': (215, .10, .62), 'Tangerine': (30, .90, .58),
    # violets, wine and berries
    'Dark Lilac': (280, .30, .50), 'Electric Purple': (280, .80, .58), 'Royal Violet': (268, .60, .46), 'English Violet': (285, .28, .40),
    'Grape': (285, .50, .38), 'Fandango': (318, .60, .46), 'Purple': (275, .55, .50), 'Carmine': (350, .75, .45),
    'Rosewood': (352, .45, .40), 'Strawberry': (348, .70, .58), 'Coral Red': (5, .72, .58),
    # reds for Christmas Carol
    'Crimson': (348, .78, .42), 'Ruby': (345, .80, .46), 'Cherry': (352, .75, .40), 'Brick Red': (8, .55, .40), 'Garnet': (350, .65, .34),
    'Scarlet': (4, .85, .50), 'Poinsettia': (355, .70, .44),
    # silver and ice for Silverfrost
    'Gunmetal': (215, .10, .38), 'Titanium': (210, .08, .50), 'Graphite': (220, .08, .28), 'Slate': (212, .18, .42), 'Pewter': (200, .06, .58),
    'Frost': (195, .30, .80), 'Glacier': (196, .45, .70), 'Cloud': (210, .15, .82), 'Mist': (200, .12, .72), 'Silver': (210, .03, .74),
    'Arctic': (190, .50, .62), 'Steel Grey': (215, .12, .46), 'Nickel': (210, .07, .64), 'Chrome': (205, .10, .70),
    # more violets for Winter
    'Amethyst': (275, .45, .54), 'Orchid': (300, .40, .60), 'Plum': (300, .38, .34), 'Twilight': (255, .40, .38), 'Iris': (250, .55, .58), 'Mauve': (290, .25, .58),
    # gingerbread, caramel and cocoa
    'Caramel': (30, .62, .50), 'Cocoa': (22, .50, .32), 'Cinnamon': (18, .60, .40), 'Gingerbread': (26, .55, .42), 'Honey': (40, .75, .55),
    'Toffee': (32, .50, .45), 'Chestnut': (14, .50, .36), 'Mahogany': (10, .60, .28), 'Copper': (24, .62, .48), 'Biscuit': (36, .45, .58),
    'Maple': (20, .70, .42), 'Mocha': (24, .35, .34), 'Burnt Sienna': (16, .68, .43), 'Praline': (28, .40, .40), 'Sugar Brown': (30, .55, .36),
    # honey and gold
    'Gold': (46, .80, .50), 'Goldenrod': (44, .75, .52), 'Mustard': (48, .70, .44), 'Beeswax': (42, .60, .60), 'Saffron': (38, .85, .54),
    'Marigold': (36, .90, .52), 'Butterscotch': (34, .70, .50), 'Sunflower': (50, .85, .56), 'Citrine': (45, .65, .46), 'Topaz': (40, .55, .48),
    'Ochre': (38, .60, .38), 'Dandelion': (52, .80, .60), 'Buttercup': (49, .72, .62), 'Candlelight': (43, .68, .56),
}


def _rgb(h, s, l):
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h / 360, max(0, min(1, l)), s)
    return (round(r * 255) << 16) | (round(g * 255) << 8) | round(b * 255)


_known = {b[0] for b in BACKDROPS}
BACKDROPS = BACKDROPS + tuple((name, _rgb(h, s, min(.9, l + .09)), _rgb(h, s, max(.12, l - .2)))
                              for name, (h, s, l) in _FAMILIES.items() if name not in _known)

# Each pack has its own family of backdrops that suit it. The families may touch, but only a little.
PACK_BACKDROPS = {
    'newyear': ('Sapphire', 'Cobalt Blue', 'Midnight Blue', 'Pacific Cyan', 'Silver Blue', 'Navy Blue', 'Sky Blue', 'Steel Blue',
                'Azure Blue', 'French Blue', 'Ice Blue', 'Indigo Dye', 'Ultramarine', 'Turquoise', 'Fuchsia', 'Mexican Pink'),     # blues, two pinks
    'snowman': ('Mint Green', 'Emerald', 'Pine Green', 'Hunter Green', 'Jade Green', 'Malachite', 'Shamrock Green', 'Pacific Green',
                'Pistachio', 'Moonstone', 'Ivory White', 'Platinum', 'Roman Silver', 'Persimmon', 'Tangerine', 'Silver Blue'),    # pines and snow, a carrot
    'winter': ('Lavender', 'Dark Lilac', 'Electric Purple', 'Royal Violet', 'English Violet', 'Grape', 'Fandango', 'Purple',
               'Amethyst', 'Orchid', 'Plum', 'Twilight', 'Iris', 'Mauve', 'Midnight Blue', 'Indigo Dye'),                          # violet dusk
    'silverfrost': ('Gunmetal', 'Titanium', 'Graphite', 'Slate', 'Pewter', 'Frost', 'Glacier', 'Cloud', 'Mist', 'Silver',
                    'Arctic', 'Steel Grey', 'Nickel', 'Chrome', 'Ice Blue', 'Steel Blue'),                                           # silver and ice
    'gingerbread': ('Caramel', 'Cocoa', 'Cinnamon', 'Gingerbread', 'Honey', 'Toffee', 'Chestnut', 'Mahogany',
                    'Copper', 'Biscuit', 'Maple', 'Mocha', 'Burnt Sienna', 'Praline', 'Sugar Brown', 'Amber'),                       # biscuit, caramel and cocoa
    'honey': ('Gold', 'Goldenrod', 'Mustard', 'Beeswax', 'Saffron', 'Marigold', 'Butterscotch', 'Sunflower',
              'Citrine', 'Topaz', 'Ochre', 'Dandelion', 'Buttercup', 'Candlelight', 'Honey', 'Amber'),                           # honey and gold
    'christmas': ('Burgundy', 'Raspberry', 'Carmine', 'Rosewood', 'Strawberry', 'Coral Red', 'Tomato', 'Coral',
                  'Crimson', 'Ruby', 'Cherry', 'Brick Red', 'Garnet', 'Scarlet', 'Poinsettia', 'Persimmon'),                       # reds, one orange
}


# The accent colour of a pack (r g b): the opening screen glows with it instead of one common blue.
PACK_ACCENTS = {'newyear': '59 134 238', 'snowman': '63 191 138', 'winter': '150 120 240', 'christmas': '226 84 96', 'silverfrost': '150 192 222', 'gingerbread': '224 150 80', 'honey': '240 190 60'}
DEFAULT_ACCENT = '59 134 238'


def backdrops_for(pack_id):
    names = PACK_BACKDROPS.get(pack_id)
    pool = [b for b in BACKDROPS if names and b[0] in names]
    return pool or list(BACKDROPS)


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
                # gifts together are about 3.4 cards in a thousand (one pack in ~200)... cheaper ones a little more often
                total = 3.4
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
        return {'id': p['id'], 'title': p['title'], 'image': p['image_url'], 'accent': PACK_ACCENTS.get(p['id'], DEFAULT_ACCENT)}

    # One card in a pack is an NFT with a chance of about 0.34%: roughly one gift per 200 opened packs.
    NFT_CARD_SHARE = 0.0034

    def tune_packs_rarer():
        """Once: make every pack stingier. NFT weights are scaled down (never up) to the target share, big GRAM prizes shrink."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v3'").fetchone():
            return
        with db():
            for pack in db().execute("SELECT id FROM packs").fetchall():
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall()
                for r in rows:
                    try:
                        big = r['kind'] == 'GRAM' and Decimal(r['amount'] or '0') >= 2
                    except Exception:
                        big = False
                    if big:
                        db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * 0.4, 4), r['id']))
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = sum(float(r['weight']) for r in rows if r['kind'] == 'NFT')
                if gram <= 0 or nft <= 0:
                    continue
                wanted = NFT_CARD_SHARE / (1 - NFT_CARD_SHARE) * gram
                if nft > wanted:
                    factor = wanted / nft
                    for r in rows:
                        if r['kind'] == 'NFT':
                            db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * factor, 5), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v3','1') ON CONFLICT(key) DO NOTHING")

    # Every pack uses the same stingy balance table: a card is almost always 0.1 GRAM, big sums are very rare.
    STANDARD_GRAM = (('0.1', 840), ('0.2', 100), ('0.3', 35), ('0.5', 14), ('0.75', 6), ('1', 3), ('1.5', 1.2), ('2', .5), ('3', .2), ('5', .08), ('10', .02), ('20', .006))
    CARD_WEIGHTS = {'1': 60, '2': 24, '3': 10, '4': 4, '5': 1.5, '6': .5}      # 60% of packs hold one card, up to six
    SILVERFROST_IMAGE = '/static/assets/packs/silverfrost-pack.webp'
    SILVERFROST_GIFTS = (('xmasstocking', 'Frozen Moss', '4.53'), ('candycane', 'Blue Bliss', '4.70'), ('partysparkler', 'Cyan Sizzle', '5.67'),
                         ('gingercookie', 'Frozen Dough', '5.71'), ('winterwreath', 'Negative', '6.05'), ('eternalcandle', 'Blue Steel', '8.00'),
                         ('santahat', 'Below Zero', '8.20'), ('snowglobe', 'Diamond', '8.37'), ('snowmittens', 'Pingu', '9.77'), ('jinglebells', 'Glacier', '11.33'))
    CHRISTMAS_IMAGE = '/static/assets/packs/christmas-pack.webp'
    CHRISTMAS_GIFTS = (('snowglobe', 'Crimson Cabin'), ('hangingstar', 'Christmas'), ('snowmittens', 'Rudolph'), ('gingercookie', 'Cookie Claus'),
                       ('jinglebells', 'Nutcracker'), ('eternalcandle', 'Red Melter'), ('xmasstocking', 'Caramel Fest'),
                       ('winterwreath', 'Holly Leaves'), ('spicedwine', 'Gluhwein'), ('candycane', 'Cherry Charm', '5'))      # Cherry Charm instead of the bear
    WINTER_IMAGE = '/static/assets/packs/winter-pack.webp'
    # (collection, model, value in GRAM): winter gifts up to 15 inclusive. The first group is the model list of the reference pack, the second
    # one is the cheap new-year gifts of the Snowman pack.
    WINTER_GIFTS = (
        ('snowmittens', 'Mistletoe', '15'), ('recordplayer', 'Winter', '14.38'), ('sakuraflower', 'Snowdrop', '13.39'), ('jinglebells', 'Cozy Winter', '12.24'),
        ('sleighbell', 'Blizzard', '11.22'), ('snowglobe', 'Sky Terrace', '8.62'), ('snowglobe', 'Winter', '7.18'), ('springbasket', 'Penguin', '6.86'),
        ('santahat', 'Warm Winter', '6.84'), ('faithamulet', 'Winter', '5.87'), ('bdaycandle', 'Winter Fun', '5.25'), ('bdaycandle', 'Winter Noon', '4.9'),
        ('candycane', 'Blue Bliss', '4.24'), ('tamagadget', 'Winter', '4.18'), ('lunarsnake', 'The Deadliest', '4.08'), ('lunarsnake', 'Blizzard', '4.07'),
        ('jellybunny', 'Snowman', '11'), ('gingercookie', 'Snowman', '5.61'), ('happybrownie', 'Snowman', '4.45'), ('bunnymuffin', 'Snowman', '10.79'),
        ('winterwreath', 'Snowman', '7.6'), ('hangingstar', 'Snowman', '10.71'), ('snowmittens', 'Frost Fingers', '10.5'), ('xmasstocking', 'Translucent', '4.18'),
        ('vicecream', 'Iceman', '4.08'),
    )
    # per-mille chance of one card being this GRAM amount: plenty of small balances, big ones are rare
    WINTER_GRAM = (('0.1', 560), ('0.2', 170), ('0.3', 90), ('0.5', 70), ('0.75', 40), ('1', 36), ('1.5', 16), ('2', 8), ('3', 4), ('5', 2), ('10', .6), ('20', .2))

    def seed_winter_pack():
        if db().execute("SELECT 1 FROM settings WHERE key='packs_winter_v1'").fetchone():
            return
        with db():
            if not pack_row('winter'):
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             ('winter', 'Winter', WINTER_IMAGE, json.dumps({'1': 58, '2': 30, '3': 12}), 0, 0, 1, int(time.time())))
                pos = 0
                for amount, weight in WINTER_GRAM:
                    put_prize('winter', pos, 'GRAM', amount, '', 'GRAM', '', amount, weight)
                    pos += 1
                gifts = []
                for cid, model, value in WINTER_GIFTS:
                    col, m = catalog().get(cid), catalog_model(cid, model)
                    if col and m:
                        gifts.append((cid, singular(col.get('name') or cid), m['image'], value, model))
                total = 3.4                      # about one gift per 200 openings, cheaper ones a little more often
                inv = [1 / float(g[3]) for g in gifts]
                for g, w in zip(gifts, inv):
                    put_prize('winter', pos, 'NFT', '', g[0], g[1], g[2], g[3], round(total * w / (sum(inv) or 1), 4), g[4])
                    pos += 1
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_winter_v1','1') ON CONFLICT(key) DO NOTHING")

    # One gift per ~400 openings, and the bigger balance prizes are cut again.
    NFT_CARD_SHARE_V4 = 0.0017

    def tune_packs_stingier():
        if db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v4'").fetchone():
            return
        with db():
            for pack in db().execute("SELECT id FROM packs").fetchall():
                for r in db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall():
                    try:
                        amount = Decimal(r['amount'] or '0') if r['kind'] == 'GRAM' else Decimal('0')
                    except Exception:
                        amount = Decimal('0')
                    factor = Decimal('0.3') if amount >= 2 else Decimal('0.5') if amount >= Decimal('0.5') else Decimal('1')
                    if factor != 1:
                        db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * float(factor), 5), r['id']))
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = sum(float(r['weight']) for r in rows if r['kind'] == 'NFT')
                if gram > 0 and nft > 0:
                    wanted = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram
                    if nft > wanted:
                        for r in rows:
                            if r['kind'] == 'NFT':
                                db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * wanted / nft, 6), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v4','1') ON CONFLICT(key) DO NOTHING")

    def fix_pack_backdrops():
        """Once: every existing pack gets a backdrop from its own pack's set (the old ones were drawn from one common list)."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_backdrops_v2'").fetchone():
            return
        with db():
            for row in db().execute("SELECT user_id,nft_id,payload FROM inventory WHERE payload LIKE ?", ('%"pack_item": true%',)).fetchall():
                try:
                    gift = json.loads(row['payload'])
                except ValueError:
                    continue
                if not gift.get('pack_item'):
                    continue
                pool = backdrops_for(gift.get('pack_id'))
                if gift.get('backdrop') in {b[0] for b in pool}:
                    continue
                bd = _rng.choice(pool)
                gift['backdrop'], gift['background'] = bd[0], {'center_color': bd[1], 'edge_color': bd[2]}
                db().execute("UPDATE inventory SET payload=? WHERE user_id=? AND nft_id=?", (json.dumps(gift, ensure_ascii=False), row['user_id'], row['nft_id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_backdrops_v2','1') ON CONFLICT(key) DO NOTHING")

    def seed_christmas_pack():
        if db().execute("SELECT 1 FROM settings WHERE key='packs_christmas_v1'").fetchone():
            return
        with db():
            if not pack_row('christmas'):
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             ('christmas', 'Christmas Carol', CHRISTMAS_IMAGE, json.dumps(CARD_WEIGHTS), 0, 0, 1, int(time.time())))
                pos = 0
                for amount, weight in STANDARD_GRAM:
                    put_prize('christmas', pos, 'GRAM', amount, '', 'GRAM', '', amount, weight)
                    pos += 1
                gifts = []
                for cid, model, *shown in CHRISTMAS_GIFTS:
                    col, m = catalog().get(cid), catalog_model(cid, model)
                    if col and m:
                        gifts.append((cid, singular(col.get('name') or cid), m['image'], shown[0] if shown else str(m.get('price') or '5'), model))
                gram = sum(w for _, w in STANDARD_GRAM)
                total = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram                  # about one gift per 400 openings
                inv = [1 / max(float(g[3]), 1.0) for g in gifts]
                for g, w in zip(gifts, inv):
                    put_prize('christmas', pos, 'NFT', '', g[0], g[1], g[2], g[3], round(total * w / (sum(inv) or 1), 6), g[4])
                    pos += 1
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_christmas_v1','1') ON CONFLICT(key) DO NOTHING")

    def seed_silverfrost_pack():
        if db().execute("SELECT 1 FROM settings WHERE key='packs_silverfrost_v1'").fetchone():
            return
        with db():
            if not pack_row('silverfrost'):
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             ('silverfrost', 'Silverfrost', SILVERFROST_IMAGE, json.dumps(CARD_WEIGHTS), 0, 0, 1, int(time.time())))
                pos = 0
                for amount, weight in STANDARD_GRAM:
                    put_prize('silverfrost', pos, 'GRAM', amount, '', 'GRAM', '', amount, weight)
                    pos += 1
                gifts = []
                for cid, model, value in SILVERFROST_GIFTS:
                    col, m = catalog().get(cid), catalog_model(cid, model)
                    if col and m:
                        gifts.append((cid, singular(col.get('name') or cid), m['image'], value, model))
                gram = sum(w for _, w in STANDARD_GRAM)
                total = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram                    # about one gift per 400 openings
                inv = [1 / max(float(g[3]), 1.0) for g in gifts]
                for g, w in zip(gifts, inv):
                    put_prize('silverfrost', pos, 'NFT', '', g[0], g[1], g[2], g[3], round(total * w / (sum(inv) or 1), 6), g[4])
                    pos += 1
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_silverfrost_v1','1') ON CONFLICT(key) DO NOTHING")

    def tune_packs_final():
        """Once: one stingy balance table and fewer multi-card packs for every pack; gifts stay at one per ~400 openings."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v5'").fetchone():
            return
        table = dict(STANDARD_GRAM)
        with db():
            for pack in db().execute("SELECT id FROM packs").fetchall():
                db().execute("UPDATE packs SET card_weights=? WHERE id=?", (json.dumps(CARD_WEIGHTS), pack['id']))
                for r in db().execute("SELECT * FROM pack_prizes WHERE pack_id=? AND kind='GRAM'", (pack['id'],)).fetchall():
                    key = str(r['amount'])
                    weight = table[key] if key in table else round(float(r['weight']) * 0.3, 5)
                    db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (weight, r['id']))
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = sum(float(r['weight']) for r in rows if r['kind'] == 'NFT')
                if gram > 0 and nft > 0:
                    wanted = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram
                    if nft > wanted:
                        for r in rows:
                            if r['kind'] == 'NFT':
                                db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * wanted / nft, 6), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v5','1') ON CONFLICT(key) DO NOTHING")

    def rename_pack_items():
        """Once: packs already in inventories belong to the collection "Lucky Pack"."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_renamed_v1'").fetchone():
            return
        with db():
            for row in db().execute("SELECT user_id,nft_id,payload FROM inventory WHERE payload LIKE ?", ('%"pack_item": true%',)).fetchall():
                try:
                    gift = json.loads(row['payload'])
                except ValueError:
                    continue
                if gift.get('pack_item') and gift.get('name') != COLLECTION[1]:
                    gift['name'], gift['collection_name'] = COLLECTION[1], COLLECTION[1]
                    db().execute("UPDATE inventory SET payload=? WHERE user_id=? AND nft_id=?", (json.dumps(gift, ensure_ascii=False), row['user_id'], row['nft_id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_renamed_v1','1') ON CONFLICT(key) DO NOTHING")

    def tune_card_counts():
        """Once: the stock packs hold one card in 60% of openings and up to six."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v6'").fetchone():
            return
        with db():
            for pack_id in PACK_BACKDROPS:
                db().execute("UPDATE packs SET card_weights=? WHERE id=?", (json.dumps(CARD_WEIGHTS), pack_id))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v6','1') ON CONFLICT(key) DO NOTHING")

    BETTER_GRAM = (('0.1', 620), ('0.2', 170), ('0.3', 80), ('0.5', 55), ('0.75', 30), ('1', 24), ('1.5', 11), ('2', 5.5), ('3', 2.5), ('5', 1), ('10', .35), ('20', .12))
    BETTER_CARDS = {'1': 52, '2': 26, '3': 13, '4': 6, '5': 2, '6': 1}
    BETTER_NFT_SHARE = 0.008

    def tune_packs_better():
        """Once: a little better prizes. Fewer 0.1 GRAM cards, more mid-size balance prizes, more cards per pack, gifts about five times as likely."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_tuned_v7'").fetchone():
            return
        table = dict(BETTER_GRAM)
        with db():
            for pack in db().execute("SELECT id FROM packs").fetchall():
                db().execute("UPDATE packs SET card_weights=? WHERE id=?", (json.dumps(BETTER_CARDS), pack['id']))
                for r in db().execute("SELECT * FROM pack_prizes WHERE pack_id=? AND kind='GRAM'", (pack['id'],)).fetchall():
                    key = str(r['amount'])
                    if key in table:
                        db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (table[key], r['id']))
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id=?", (pack['id'],)).fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = sum(float(r['weight']) for r in rows if r['kind'] == 'NFT')
                if gram > 0 and nft > 0:
                    wanted = BETTER_NFT_SHARE / (1 - BETTER_NFT_SHARE) * gram
                    for r in rows:
                        if r['kind'] == 'NFT':
                            db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * wanted / nft, 6), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_tuned_v7','1') ON CONFLICT(key) DO NOTHING")

    def drop_christmas_bear():
        """Once: the 169-value Toy Bear leaves Christmas Carol; the other gifts share its chance."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_christmas_v2'").fetchone():
            return
        with db():
            if db().execute("DELETE FROM pack_prizes WHERE pack_id='christmas' AND collection_id='toybear'").rowcount:
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id='christmas'").fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = [r for r in rows if r['kind'] == 'NFT']
                have = sum(float(r['weight']) for r in nft)
                if gram > 0 and have > 0:
                    wanted = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram
                    for r in nft:
                        db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(float(r['weight']) * wanted / have, 6), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_christmas_v2','1') ON CONFLICT(key) DO NOTHING")

    def add_cherry_charm():
        """Once: Cherry Charm (Candy Cane, value 5) joins Christmas Carol; gift chances are spread by value again."""
        if db().execute("SELECT 1 FROM settings WHERE key='packs_christmas_v3'").fetchone():
            return
        with db():
            if pack_row('christmas') and not db().execute("SELECT 1 FROM pack_prizes WHERE pack_id='christmas' AND collection_id='candycane' AND model='Cherry Charm'").fetchone():
                col, m = catalog().get('candycane'), catalog_model('candycane', 'Cherry Charm')
                if col and m:
                    put_prize('christmas', 98, 'NFT', '', 'candycane', singular(col.get('name') or 'candycane'), m['image'], '5', 0.0001, 'Cherry Charm')
                rows = db().execute("SELECT * FROM pack_prizes WHERE pack_id='christmas'").fetchall()
                gram = sum(float(r['weight']) for r in rows if r['kind'] == 'GRAM')
                nft = [r for r in rows if r['kind'] == 'NFT']
                inv = [1 / max(float(r['value'] or 1), 1.0) for r in nft]
                if gram > 0 and nft:
                    total = NFT_CARD_SHARE_V4 / (1 - NFT_CARD_SHARE_V4) * gram
                    for r, w in zip(nft, inv):
                        db().execute("UPDATE pack_prizes SET weight=? WHERE id=?", (round(total * w / sum(inv), 6), r['id']))
            db().execute("INSERT INTO settings(key,payload) VALUES('packs_christmas_v3','1') ON CONFLICT(key) DO NOTHING")


    # ---- premium packs: ten gifts each, their own tables, seeded once after every general tuning ----
    def premium_prizes(pack_id, gifts, gram_table, share):
        """The prize rows of a premium pack: the balance ladder, then the gifts with chances spread by value."""
        pos = 0
        for amount, weight in gram_table:
            put_prize(pack_id, pos, 'GRAM', amount, '', 'GRAM', '', amount, weight)
            pos += 1
        found = []
        for cid, model, value in gifts:
            col = catalog().get(cid)
            if not col:
                continue
            name = singular(col.get('name') or cid)
            m = catalog_model(cid, model)
            picture = m['image'] if m else 'https://api.changes.tg/model/%s/%s.png?size=128' % (quote(name), quote(model))
            found.append((cid, name, picture, value, model))
        gram = sum(w for _, w in gram_table)
        total = share / (1 - share) * gram
        inv = [1 / max(float(g[3]), 1.0) for g in found]
        for g, w in zip(found, inv):
            put_prize(pack_id, pos, 'NFT', '', g[0], g[1], g[2], g[3], round(total * w / (sum(inv) or 1), 6), g[4])
            pos += 1

    def seed_premium_pack(pack_id, title, image, gifts, gram_table, cards, share, flag):
        if db().execute("SELECT 1 FROM settings WHERE key=?", (flag,)).fetchone():
            return
        with db():
            if not pack_row(pack_id):
                db().execute("INSERT INTO packs(id,title,image_url,card_weights,for_sale,price_balls,enabled,created) VALUES(?,?,?,?,?,?,?,?)",
                             (pack_id, title, image, json.dumps(cards), 0, 0, 1, int(time.time())))
                premium_prizes(pack_id, gifts, gram_table, share)
            db().execute("INSERT INTO settings(key,payload) VALUES(?,'1') ON CONFLICT(key) DO NOTHING", (flag,))

    # Gingerbread House: the top pack. An opening is worth about 1000 balls (the other packs 250-400), that is about 1.6 GRAM.
    GINGERBREAD_GIFTS = (('snowglobe', 'Ginger House', '25'), ('gingercookie', 'Original', '55'), ('jinglebells', 'Gingerbread', '27'),
                         ('winterwreath', 'Gingerbread', '19'), ('hangingstar', 'Gingerbread', '33'), ('holidaydrink', 'Ginger Joker', '11'),
                         ('candycane', 'Amber Glitter', '20'), ('xmasstocking', 'Caramel Fest', '20'), ('spicedwine', 'Chocolate Cherry', '16'),
                         ('eternalcandle', 'Hot Cocoa', '18'))
    GINGERBREAD_GRAM = (('0.2', 470), ('0.3', 230), ('0.5', 140), ('0.75', 70), ('1', 52), ('1.5', 24), ('2', 13), ('3', 7), ('5', 3.4),
                        ('10', 1.2), ('20', .4), ('50', .09), ('100', .02), ('250', .004))
    GINGERBREAD_CARDS = {'1': 20, '2': 32, '3': 28, '4': 14, '5': 6}         # 2.54 cards per opening, never a 0.1 card
    GINGERBREAD_NFT_SHARE = 0.009                                            # a gift on one card in 110: about one pack in 44

    # Honey Holidays: an opening is worth about 0.3 TON, gifts are worth 11-55, the ladder reaches 50 GRAM
    HONEY_GIFTS = (('gingercookie', 'Golden Boy', '55'), ('candycane', 'Honeycomb', '20'), ('winterwreath', 'Honey Dew', '19'),
                   ('eternalcandle', 'Thick Honey', '18'), ('sleighbell', 'Beehive', '22'), ('holidaydrink', 'Gold Dust', '11'),
                   ('spicedwine', 'Golden Glow', '16'), ('jinglebells', 'Bell Hive', '27'), ('snowmittens', 'Honey Wine', '13'),
                   ('santahat', 'Golden Tide', '20'))
    HONEY_GRAM = (('0.1', 790), ('0.2', 105), ('0.3', 45), ('0.5', 28), ('0.75', 12), ('1', 8), ('1.5', 4), ('2', 2.2), ('3', 1.1),
                  ('5', .5), ('10', .18), ('20', .06), ('50', .012))
    HONEY_CARDS = {'1': 62, '2': 27, '3': 8, '4': 3}                          # 1.52 cards per opening
    HONEY_NFT_SHARE = 0.0015                                                  # one card in 670 is a gift: about one pack in 440

    def seed_gingerbread_pack():
        seed_premium_pack('gingerbread', 'Gingerbread House', '/static/assets/packs/gingerbread-pack.webp', GINGERBREAD_GIFTS,
                          GINGERBREAD_GRAM, GINGERBREAD_CARDS, GINGERBREAD_NFT_SHARE, 'packs_gingerbread_v1')

    def buff_gingerbread_pack():
        """Once more: Gingerbread House is the top pack (about 1000 balls). An existing pack gets the new card counts and prize table."""
        flag = 'packs_gingerbread_v2'
        if db().execute("SELECT 1 FROM settings WHERE key=?", (flag,)).fetchone():
            return
        with db():
            if pack_row('gingerbread'):
                db().execute("DELETE FROM pack_prizes WHERE pack_id=?", ('gingerbread',))
                db().execute("UPDATE packs SET card_weights=? WHERE id=?", (json.dumps(GINGERBREAD_CARDS), 'gingerbread'))
                premium_prizes('gingerbread', GINGERBREAD_GIFTS, GINGERBREAD_GRAM, GINGERBREAD_NFT_SHARE)
            db().execute("INSERT INTO settings(key,payload) VALUES(?,'1') ON CONFLICT(key) DO NOTHING", (flag,))

    def seed_honey_pack():
        seed_premium_pack('honey', 'Honey Holidays', '/static/assets/packs/honey-pack.webp', HONEY_GIFTS,
                          HONEY_GRAM, HONEY_CARDS, HONEY_NFT_SHARE, 'packs_honey_v1')

    with app.app_context():
        tune_default_pack()
        seed_snowman_pack()
        tune_packs_rarer()
        seed_winter_pack()
        tune_packs_stingier()
        seed_christmas_pack()
        tune_packs_final()
        fix_pack_backdrops()
        rename_pack_items()
        tune_card_counts()
        drop_christmas_bear()
        add_cherry_charm()
        seed_silverfrost_pack()
        tune_packs_better()
        seed_gingerbread_pack()
        buff_gingerbread_pack()
        seed_honey_pack()

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
        serial = int(db().execute("SELECT COUNT(*) AS n FROM user_packs").fetchone()['n'])      # one running number for all packs
        bd = _rng.choice(backdrops_for(pack_id))
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
        warm([r['pid'] for r in mine])             # the owner is about to open them: load the market lots now
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
                          'chance': round(float(p['weight']) / total * 100, 5)})
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
        warm([pid])
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
            if not hit or now - hit[0] > (300 if hit[1] else 20):
                try:
                    hit = (now, market_lots(p))
                except Exception:
                    hit = (now, [])
                avail_cache[p['id']] = hit
            out[p['id']] = list(hit[1])
        return out

    warming = set()

    def warm(pack_ids):
        """Loads the market lots of these packs in the background, so the next pack opens without waiting for the market."""
        if not work_mode():
            return
        todo = [x for x in dict.fromkeys(pack_ids) if x not in warming]
        if not todo:
            return
        warming.update(todo)

        def job():
            try:
                with app.app_context():
                    for pid in todo:
                        try:
                            availability(prizes_of(pid))
                        except Exception:
                            pass
            finally:
                warming.difference_update(todo)
        threading.Thread(target=job, daemon=True).start()

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

    def open_one(uid, upid):
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
            counts = [(int(k), float(v)) for k, v in json.loads(pack['card_weights']).items() if float(v) > 0 and 1 <= int(k) <= 6]
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
                            'name': str(shown['name']), 'number': shown.get('number'),
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
                                  'name': prize['name'], 'number': gift['number'], 'image': gift['image'], 'value': worth})
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
                        db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',        # audit() commits: not allowed inside a transaction on PostgreSQL
                                     (uid, 'Pack gift purchase needs review: ' + str(shown.get('name')) + ' for ' + str(uid), int(time.time())))
                    result['credited'] = plain(total) if total else '0'
                    db().execute("UPDATE user_packs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), upid))
        record('pack_open', {'pack': pack['id'], 'cards': cards, 'credited': result['credited']}, uid=uid)
        return result

    @app.post('/api/packs/open')
    @auth()
    def packs_open():
        body = request.get_json(silent=True) or {}
        upid = body.get('user_pack_id')
        if not isinstance(upid, str) or not re.fullmatch(r'[a-f0-9]{32}', upid):
            abort(400, description='Неверный пак')
        return open_one(g.user['id'], upid)

    @app.post('/api/packs/open-many')
    @auth()
    def packs_open_many():
        """Opens a pile of packs in one request (the client shows only the total). One broken pack never stops the rest."""
        from werkzeug.exceptions import HTTPException
        ids = (request.get_json(silent=True) or {}).get('user_pack_ids')
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 500 or len(set(map(str, ids))) != len(ids)
                or any(not isinstance(x, str) or not re.fullmatch(r'[a-f0-9]{32}', x) for x in ids)):
            abort(400, description='Неверный список паков')
        results, failed = [], []
        for upid in ids:
            try:
                results.append(open_one(g.user['id'], upid))
            except HTTPException as error:
                failed.append({'id': upid, 'error': str(error.description)})
            db().commit()                      # finish this pack's last writes before the next one starts its transaction
        return {'results': results, 'failed': failed}

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
        for k in '123456':
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
