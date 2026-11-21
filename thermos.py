"""Read-only public gift data. All prices are TON, never GRAM."""
import json
import time
from decimal import Decimal
from urllib.request import Request, urlopen

def request(path, body=None):
    req=Request('https://proxy.thermos.gifts/api/v1/'+path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Accept':'application/json','Content-Type':'application/json'})
    with urlopen(req,timeout=8) as response:
        return json.load(response)

def ton(value):
    return str(Decimal(str(value or '0'))/Decimal(1000000000))

COLLECTION_PREVIEWS = {
    '5834651202612102354': '/static/assets/collection-durovs-glasses.webp',
    '5882260270843168924': '/static/assets/collection-ufc-strike.webp',
}

def unique_collections(rows):
    by_id = {}
    for row in rows:
        key = str(row['id'])
        existing = by_id.get(key)
        if existing is None or (not Decimal(existing['floor_price'] or '0') and Decimal(row['floor_price'] or '0') > 0):
            by_id[key] = row
    return [dict(row, photo_url=COLLECTION_PREVIEWS[key]) if key in COLLECTION_PREVIEWS else row
            for key, row in by_id.items()]

def collections():
    rows = [dict(id=str(c['id']),short_name=str(c['id']),name=c['name'],photo_url=c['image_url'],floor_price=ton(c.get('stats',{}).get('floor')),price_unit='TON') for c in request('collections')]
    for row in rows:
        row['floor_price'] = repaired_floor(row, rows)
    return rows


def repaired_floor(row, rows):
    """A collection floor far below the reference (wrong currency or one broken lot, e.g. Snow Mittens at 3.16 TON instead of ~9)
    is replaced by the cheapest believable lot, or by the reference floor when no lot can be read."""
    try:
        floor = Decimal(str(row['floor_price'] or '0'))
    except Exception:
        return row['floor_price']
    reference = seed_floors().get(canon(row['name']))
    if not reference or (floor > 0 and floor >= reference * MIN_SHARE_OF_FLOOR):
        return row['floor_price']
    try:
        lots = gifts({'collection_id': row['id'], 'sort_by': 'price asc'}, rows).get('gifts', [])
        prices = [Decimal(str(lot['price'])) for lot in lots if Decimal(str(lot['price'])) > 0]
        if prices:
            return str(min(prices))
    except Exception:
        pass
    return str(reference)

_SEED_FLOORS = {}


def canon(value):
    import re
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


def seed_floors():
    """Reference floors from the bundled catalogue snapshot: protection against lots with a broken price."""
    if not _SEED_FLOORS:
        import gzip
        from pathlib import Path
        try:
            rows = json.loads(gzip.decompress((Path(__file__).resolve().parent / 'data/catalog_seed.json.gz').read_bytes())).get('collections', [])
        except (OSError, ValueError):
            rows = []
        for r in rows:
            try:
                value = Decimal(str(r.get('floor_price') or '0'))
            except Exception:
                continue
            if value > 0:
                _SEED_FLOORS[canon(r.get('name'))] = value
    return _SEED_FLOORS


MIN_SHARE_OF_FLOOR = Decimal('0.4')

# The floor reported by the market is dragged down by the broken lots themselves (Snow Mittens: "floor" 3.0 TON while the real lots start at 10),
# so the real floor is read from the lots: the lowest price at which at least CLUSTER_LOTS lots of at least two different markets stand within
# CLUSTER_BAND of each other. Broken lots usually come from one market (MRKT) and may stand in a group of their own: one market is not enough.
CLUSTER_LOTS, CLUSTER_BAND, BUGGED_BELOW, ROBUST_TTL = 3, Decimal('1.25'), Decimal('0.8'), 1800
_ROBUST = {}
FLOORS_LOADER = None        # set by the app: a callable -> {canonical name: [floor, time]}, the floors found by the background sweep (shared by all workers)


def robust_floor(prices, markets=None):
    """prices: Decimals; markets: the market of each price (same order) or None when it is not known."""
    pairs = sorted((p, (markets[i] if markets else '')) for i, p in enumerate(prices) if p > 0)
    for index, (price, _market) in enumerate(pairs):
        window = [pair for pair in pairs[index:] if pair[0] <= price * CLUSTER_BAND]
        if len(window) >= CLUSTER_LOTS and (not markets or len({pair[1] for pair in window}) >= 2):
            return price
    return None


def remember_floors(lots, now=None):
    """Called with the cheapest lots of a collection: stores its real floor, or forgets it when the lots do not show one."""
    now = time.time() if now is None else now
    by_name = {}
    for lot in lots:
        try:
            by_name.setdefault(canon(lot['name']), []).append((Decimal(str(lot['price'])), str(lot.get('marketplace') or '')))
        except Exception:
            continue
    for key, items in by_name.items():
        markets = [m for _p, m in items] if any(m for _p, m in items) else None
        floor = robust_floor([p for p, _m in items], markets)
        if floor:
            _ROBUST[key] = (floor, now)
        else:
            _ROBUST.pop(key, None)


def snapshot_floors():
    """The floors that are known now, ready to be stored: {canonical name: [floor, time]}."""
    return {key: [str(value[0]), value[1]] for key, value in _ROBUST.items() if time.time() - value[1] < ROBUST_TTL}


def known_floor(key):
    """The real floor of a collection: found by this process, or by the background sweep of any worker. None when it is not known (or too old)."""
    now = time.time()
    own = _ROBUST.get(key)
    if own and now - own[1] < ROBUST_TTL:
        return own[0]
    if FLOORS_LOADER:
        try:
            item = (FLOORS_LOADER() or {}).get(key)
            if item and now - float(item[1]) < ROBUST_TTL:
                return Decimal(str(item[0]))
        except Exception:
            return None
    return None


def plausible_price(name, price_ton, catalog_floors):
    """A lot far below the collection floor is a data error (wrong currency or a broken listing), not a bargain: such lots cannot be bought.
    Two rules, both must pass: not below 40 % of the reference floor (catalogue snapshot / market), and not below 80 % of the real floor read from the lots."""
    key = canon(name)
    try:
        price = Decimal(str(price_ton))
    except Exception:
        return False
    reference = max([v for v in (catalog_floors.get(key), seed_floors().get(key)) if v] or [Decimal('0')])
    if reference > 0 and price < reference * MIN_SHARE_OF_FLOOR:
        return False
    real = known_floor(key)
    return not (real and price < real * BUGGED_BELOW)


def drop_broken(lots):
    """The lots of a listing without those whose price is far below the floor of their collection (TON prices only)."""
    return [lot for lot in lots if lot.get('price_unit', 'TON') != 'TON' or plausible_price(lot.get('name'), lot.get('price'), {})]


def gifts(params, catalog):
    collection_ids = set(params['collection_id'].split(',')) if params.get('collection_id') else set()
    collections = [item['name'] for item in catalog if str(item['id']) in collection_ids]
    if collection_ids and len(collections) != len(collection_ids):
        raise ValueError('Unknown collection')
    body={'markets':[m for m in (params.get('markets') or 'PORTALS').split(',') if m in ('PORTALS','TONNEL','MRKT')] or ['PORTALS'],'per_page':20,'page':max(0,int(params.get('offset',0)))//20+1,'ordering':{'price asc':'PRICE_ASC','price desc':'PRICE_DESC','external_collection_number asc':'NUMBER_ASC','external_collection_number desc':'NUMBER_DESC','model_rarity asc':'MODEL_RARITY_ASC','model_rarity desc':'MODEL_RARITY_DESC'}.get(params.get('sort_by'),'PRICE_ASC')}
    if collections:body['collections']=collections
    if params.get('search'):body['query']=params['search']
    for src,dst in [('filter_by_models','models'),('filter_by_backdrops','backdrops'),('filter_by_symbols','symbols')]:
        if params.get(src):body[dst]=[name.strip() for name in params[src].split(',') if name.strip()]
    price_range={}
    for key,out in [('min_price','min'),('max_price','max')]:
        if params.get(key):price_range[out]=str(int(Decimal(params[key])*1000000000))
    if price_range:body['price_range']=price_range
    data=request('gifts',body)
    ids={c['name']:c['id'] for c in catalog}
    floors = {}
    for item in catalog:
        try:
            value = Decimal(str(item.get('floor_price') or '0'))
        except Exception:
            continue
        if value > 0:
            floors[canon(item.get('name'))] = max(value, floors.get(canon(item.get('name')), Decimal('0')))
    lots = [dict(id=g['external_id'],name=g['collection'],collection_id=ids.get(g['collection'],''),model=g.get('model',{}).get('name',''),backdrop=g.get('backdrop',{}).get('name',''),background={k:v for k,v in g.get('backdrop',{}).items() if k in ('center_color','edge_color')},symbol=g.get('symbol',{}).get('name',''),price=ton(g['price']),price_unit='TON',number=g['number'],image=g['image_url'],marketplace=g['marketplace']) for g in data.get('items',[])]
    # the cheapest page of one whole collection shows its real floor (not with a price/trait filter: they cut the cheapest lots away)
    try:
        cheapest = (len(collection_ids) == 1 and params.get('sort_by') == 'price asc' and int(params.get('offset', 0)) == 0 and
                    not any(params.get(k) for k in ('filter_by_models', 'filter_by_backdrops', 'filter_by_symbols', 'search')) and
                    Decimal(str(params.get('min_price') or 0)) <= 1 and Decimal(str(params.get('max_price') or 10 ** 9)) >= 10 ** 6)
    except Exception:
        cheapest = False
    if cheapest:
        remember_floors(lots)
    lots = [lot for lot in lots if plausible_price(lot['name'], lot['price'], floors)]
    return dict(gifts=lots,total=data.get('count',0),demo=False,source='thermos',price_unit='TON',sort_by=params.get('sort_by') if params.get('sort_by') not in (None,'listed_at desc') else 'price asc',warning='Сортировка по новым временно недоступна в Portals. Показаны цены по возрастанию.' if params.get('sort_by') in (None,'listed_at desc') else '')
