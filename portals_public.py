"""Public Portals catalogue and native listing order, without a partner key."""
import json
from urllib.request import Request,urlopen
from urllib.parse import urlencode

def get(path,params):
    req=Request('https://portal-market.com/api/'+path+'?'+urlencode(params),headers={'Accept':'application/json'})
    with urlopen(req,timeout=4) as response:return json.load(response)

def listings(params,catalog):
    order=params.get('sort_by','listed_at desc')
    allowed={'listed_at desc','price asc','price desc','external_collection_number asc','external_collection_number desc','model_rarity asc','model_rarity desc'}
    if order not in allowed:raise ValueError('Invalid sort order')
    query={k:v for k,v in params.items() if k in ('search','filter_by_models','filter_by_backdrops','filter_by_symbols','min_price','max_price','offset')}
    query.update(limit=20,status='listed',sort_by=order)
    collection=next((c for c in catalog if c['id']==params.get('collection_id')),None)
    if params.get('collection_id'):
        if not collection:raise ValueError('Unknown collection')
        cols=get('collections',{'limit':5000});cols=cols if isinstance(cols,list) else cols.get('collections',cols.get('items',[]))
        native=next(c for c in cols if c['name']==collection['name']);query['collection_id']=native['id']
    if (params.get('min_price') or params.get('max_price')) and params.get('price_unit','GRAM')!='GRAM':raise ValueError('Price currency changed')
    data=get('nfts/search',query);ids={c['name']:c['id'] for c in catalog};gifts=[]
    for n in data['results']:
        attrs={a['type'].lower():a.get('value','') for a in n.get('attributes',[])}
        rarity={a['type'].lower():a.get('rarity_per_mille') for a in n.get('attributes',[])}
        gifts.append(dict(id=n['id'],name=n['name'],collection_id=ids.get(n['name'],n['collection_id']),model=attrs.get('model',''),symbol=attrs.get('symbol',''),backdrop=attrs.get('backdrop',''),rarity=rarity,number=n.get('external_collection_number'),image=n['photo_url'],price=str(n['price']),price_unit='GRAM',floor_price=n.get('floor_price'),listed_at=n.get('listed_at'),purchase_url='https://t.me/portals_market_bot/market?startapp=gift_'+n['id']))
    return dict(gifts=gifts,total=data.get('total_count',0),source='portals',price_unit='GRAM',sort_by=order,demo=False)
