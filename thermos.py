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

def collections():
    return [dict(id=str(c['id']),short_name=str(c['id']),name=c['name'],photo_url=c['image_url'],floor_price=ton(c.get('stats',{}).get('floor')),price_unit='TON') for c in request('collections')]

def gifts(params, catalog):
    collection=next((c for c in catalog if c['id']==params.get('collection_id')),None)
    body={'markets':['PORTALS'],'per_page':20,'page':max(0,int(params.get('offset',0)))//20+1,'ordering':'PRICE_ASC' if params.get('sort_by')=='price asc' else 'PRICE_DESC'}
    if collection:body['collections']=[collection['name']]
    if params.get('search'):body['query']=params['search']
    for src,dst in [('filter_by_models','models'),('filter_by_backdrops','backdrops'),('filter_by_symbols','symbols')]:
        if params.get(src):body[dst]=[params[src]]
    data=request('gifts',body)
    ids={c['name']:c['id'] for c in catalog}
    return dict(gifts=[dict(id=g['external_id'],name=g['collection'],collection_id=ids.get(g['collection'],''),model=g.get('model',{}).get('name',''),backdrop=g.get('backdrop',{}).get('name',''),symbol=g.get('symbol',{}).get('name',''),price=ton(g['price']),price_unit='TON',number=g['number'],image=g['image_url'],marketplace=g['marketplace']) for g in data.get('items',[])],total=data.get('count',0),demo=False,source='thermos')
