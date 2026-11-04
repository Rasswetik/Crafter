"""Read-only public gift data. All prices are TON, never GRAM."""
import json
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
    return [dict(id=str(c['id']),short_name=str(c['id']),name=c['name'],photo_url=c['image_url'],floor_price=ton(c.get('stats',{}).get('floor')),price_unit='TON') for c in request('collections')]

def gifts(params, catalog):
    collection_ids = set(params['collection_id'].split(',')) if params.get('collection_id') else set()
    collections = [item['name'] for item in catalog if str(item['id']) in collection_ids]
    if collection_ids and len(collections) != len(collection_ids):
        raise ValueError('Unknown collection')
    body={'markets':['PORTALS'],'per_page':20,'page':max(0,int(params.get('offset',0)))//20+1,'ordering':{'price asc':'PRICE_ASC','price desc':'PRICE_DESC','external_collection_number asc':'NUMBER_ASC','external_collection_number desc':'NUMBER_DESC','model_rarity asc':'MODEL_RARITY_ASC','model_rarity desc':'MODEL_RARITY_DESC'}.get(params.get('sort_by'),'PRICE_ASC')}
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
    return dict(gifts=[dict(id=g['external_id'],name=g['collection'],collection_id=ids.get(g['collection'],''),model=g.get('model',{}).get('name',''),backdrop=g.get('backdrop',{}).get('name',''),background={k:v for k,v in g.get('backdrop',{}).items() if k in ('center_color','edge_color')},symbol=g.get('symbol',{}).get('name',''),price=ton(g['price']),price_unit='TON',number=g['number'],image=g['image_url'],marketplace=g['marketplace']) for g in data.get('items',[])],total=data.get('count',0),demo=False,source='thermos',price_unit='TON',sort_by=params.get('sort_by') if params.get('sort_by') not in (None,'listed_at desc') else 'price asc',warning='Сортировка по новым временно недоступна в Portals. Показаны цены по возрастанию.' if params.get('sort_by') in (None,'listed_at desc') else '')
