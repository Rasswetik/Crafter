import gzip
import os, json, time, hmac, hashlib, sqlite3, secrets, threading, uuid
from decimal import Decimal
from functools import wraps
from pathlib import Path
from urllib.parse import parse_qsl, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from flask import Flask, request, jsonify, render_template, g, abort
from dotenv import load_dotenv
load_dotenv()
ROOT = Path(__file__).parent

def verify_telegram(raw, token):
    pairs = parse_qsl(raw, keep_blank_values=True)
    if len(dict(pairs)) != len(pairs): raise ValueError('duplicate fields')
    data = dict(pairs)
    received = data.pop('hash', '')
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, '\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received): raise ValueError('signature')
    age = time.time() - int(data.get('auth_date', 0))
    if age < -30 or age > 3600: raise ValueError('expired')
    user = json.loads(data['user'])
    if type(user.get('id')) is not int or user['id'] <= 0: raise ValueError('user')
    return user

DEMO_GIFTS = [
 dict(id='demo-snoop',name='Snoop Dogg',collection_id='snoop',model='Emerald',backdrop='Gold',price='9.49',number=303022,image='/static/assets/snoop.webp'),
 dict(id='demo-amulet',name='Faith Amulet',collection_id='amulet',model='Moon Palace',backdrop='Gold',price='8.88',number=29726,image='/static/assets/amulet.webp'),
 dict(id='demo-snoop2',name='Snoop Dogg',collection_id='snoop',model='Emerald',backdrop='Gold',price='10.20',number=303024,image='/static/assets/snoop.webp'),
 dict(id='demo-amulet2',name='Faith Amulet',collection_id='amulet',model='Moon Palace',backdrop='Gold',price='12.50',number=29729,image='/static/assets/amulet.webp')]

def create_app(config=None):
    app = Flask(__name__)
    app.config.update(DATABASE=os.getenv('DATABASE',str(ROOT/'instance/app.sqlite3')), DEMO_MODE=os.getenv('DEMO_MODE','0')=='1', BOT_TOKEN=os.getenv('BOT_TOKEN',''), ADMIN_IDS={int(x.strip()) for x in os.getenv('ADMIN_IDS','').split(',') if x.strip().isdigit()}, PORTALS_API_KEY=os.getenv('PORTALS_API_KEY',''), BOT_USERNAME=os.getenv('BOT_USERNAME',''), MAX_CONTENT_LENGTH=16384)
    if config: app.config.update(config)
    catalog_seed=json.loads(gzip.decompress((ROOT/'data/catalog_seed.json.gz').read_bytes())) if (ROOT/'data/catalog_seed.json.gz').exists() else {'collections':[]}
    catalog_job={'running':False,'completed':0,'total':0,'error':'','updated_at':None}
    Path(app.config['DATABASE']).parent.mkdir(parents=True,exist_ok=True)
    def db():
        if 'db' not in g:
            g.db=sqlite3.connect(app.config['DATABASE'],timeout=10);g.db.row_factory=sqlite3.Row
        return g.db
    @app.teardown_appcontext
    def close(error):
        if 'db' in g:g.db.close()
    with app.app_context():
        db().executescript('''CREATE TABLE IF NOT EXISTS craft_quotes(id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, username TEXT, referrer INTEGER, created INTEGER); CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, payload TEXT, updated INTEGER); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor INTEGER, action TEXT, created INTEGER); CREATE TABLE IF NOT EXISTS inventory(user_id INTEGER, nft_id TEXT, payload TEXT, status TEXT DEFAULT 'unlisted', PRIMARY KEY(user_id,nft_id)); CREATE TABLE IF NOT EXISTS demo_accounts(user_id INTEGER PRIMARY KEY,balance TEXT); CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,user_id INTEGER,kind TEXT,payload TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS craft_requests(user_id INTEGER,request_id TEXT,result TEXT,PRIMARY KEY(user_id,request_id));'''); db().commit()
    def auth(admin=False):
        def deco(fn):
            @wraps(fn)
            def run(*args,**kwargs):
                raw=request.headers.get('X-Telegram-Init-Data','')
                try:
                    if raw and app.config['BOT_TOKEN']:g.user=verify_telegram(raw,app.config['BOT_TOKEN'])
                    elif app.config['DEMO_MODE']:g.user={'id':1,'first_name':'Гошан','username':'goshan_wow'}
                    else:abort(401,description='Откройте приложение через Telegram')
                except (ValueError,KeyError,TypeError,json.JSONDecodeError):abort(401,description='Недействительная авторизация Telegram')
                g.is_admin=g.user['id'] in app.config['ADMIN_IDS']
                if admin and not g.is_admin:abort(403,description='Доступ только для администратора')
                db().execute('INSERT INTO users VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username',(g.user['id'],g.user.get('first_name',''),g.user.get('username',''),None,int(time.time())));db().commit()
                if app.config['DEMO_MODE']:
                    with db():
                        fresh=db().execute('INSERT OR IGNORE INTO demo_accounts VALUES(?,?)',(g.user['id'],'100')).rowcount
                        if fresh:
                            for gift in DEMO_GIFTS:db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],gift['id'],json.dumps(gift),'unlisted'))
                if not app.config['DEMO_MODE']:
                    db().execute('INSERT OR IGNORE INTO demo_accounts VALUES(?,?)',(g.user['id'],'0'));db().commit()
                return fn(*args,**kwargs)
            return run
        return deco
    @app.errorhandler(HTTPError)
    def upstream(e):return jsonify(error='Ошибка Portals',status=e.code),502
    @app.errorhandler(Exception)
    def errors(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e,HTTPException):return jsonify(error=e.description),e.code
        app.logger.exception('Request failed')
        return jsonify(error='Ошибка сервера'),500
    def cached(key,default=None):
        row=db().execute('SELECT * FROM cache WHERE key=?',(key,)).fetchone()
        return (json.loads(row['payload']),row['updated']) if row else (default,None)
    def audit(action):
        db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',(g.user['id'],action,int(time.time())));db().commit()
    api_lock=threading.Lock();last_call=[0.0]
    def portal(path,params=None):
        key=app.config['PORTALS_API_KEY']
        public_paths={'nfts/search':'nfts/search','collections/preview':'collections','market/config':'collections','collections/filters':'collections/filters'}
        if not key and path not in public_paths:
            return {'attribute_floors':{}}
        base='https://portal-market.com/partners/' if key else 'https://portal-market.com/api/'
        remote_path=path if key else public_paths[path]
        if not key and path in {'market/config','collections/preview'}:
            params={**(params or {}),'limit':5000}
        headers={'Accept':'application/json'}
        if key:headers['Authorization']='partners '+key
        with api_lock:
            time.sleep(max(0,1.05-(time.monotonic()-last_call[0])))
            req=Request(base+remote_path+('?' + urlencode(params) if params else ''),headers=headers)
            try:
                with urlopen(req,timeout=20) as response:result=json.load(response)
            except (URLError,TimeoutError):abort(502,description='Источник Portal сейчас недоступен. Сохранённые данные остаются доступны.')
            finally:last_call[0]=time.monotonic()
        return result
    def normalized(n):
        attrs={a.get('type','').lower():a.get('value',a.get('name','')) for a in n.get('attributes',[]) if isinstance(a,dict)}
        return dict(id=n['id'],name=n.get('name','Gift'),collection_id=n.get('collection_id',''),model=attrs.get('model',''),backdrop=attrs.get('backdrop',''),price=str(n.get('price') or n.get('floor_price') or '0'),number=n.get('external_collection_number',''),image=n.get('photo_url',''))
    @app.get('/')
    def index():return render_template('index.html')
    @app.get('/preview')
    def preview():
        from build_preview import build_preview
        return build_preview()
    @app.after_request
    def cache_control(response):
        if request.path=='/' or request.path=='/preview' or request.path.startswith('/static/'):
            response.headers['Cache-Control']='no-cache, must-revalidate'
        return response
    @app.get('/health')
    def health():return {'ok':True}
    @app.get('/api/me')
    @auth()
    def me():
        refs=db().execute('SELECT count(*) FROM users WHERE referrer=?',(g.user['id'],)).fetchone()[0]
        link=f"https://t.me/{app.config['BOT_USERNAME']}?startapp=ref_{g.user['id']}" if app.config['BOT_USERNAME'] else None
        return dict(user=g.user,is_admin=g.is_admin,demo=app.config['DEMO_MODE'],inventory_count=len(owned()),balance=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0],inventory_value_ton=str(sum(Decimal(x['price']) for x in owned() if x.get('price_unit')=='TON')),inventory_value=str(sum(Decimal(x['price']) for x in owned() if x.get('price_unit')!='TON')),bought=db().execute("SELECT count(*) FROM history WHERE user_id=? AND kind='buy'",(g.user['id'],)).fetchone()[0],sold=0,volume='0',referrals=refs,referral_level=1,referral_progress=min(refs*10,100),invite_link=link)
    @app.post('/api/referral')
    @auth()
    def referral():
        # start_param is signed inside initData; never trust a separate client referrer.
        raw=dict(parse_qsl(request.headers.get('X-Telegram-Init-Data',''))).get('start_param','')
        if raw.startswith('ref_') and raw[4:].isdigit():
            ref=int(raw[4:]);row=db().execute('SELECT 1 FROM users WHERE id=?',(ref,)).fetchone()
            if ref!=g.user['id'] and row:db().execute('UPDATE users SET referrer=? WHERE id=? AND referrer IS NULL AND created>=?',(ref,g.user['id'],int(time.time())-60));db().commit()
        return {'ok':True}
    def public_catalog():
        rows,updated=cached('thermos:collections',[])
        if rows and time.time()-updated<300:return rows
        import thermos
        try:
            rows=thermos.collections()
            db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',('thermos:collections',json.dumps(rows),int(time.time())));db().commit()
        except Exception:
            if not rows:raise
        return rows
    @app.get('/api/catalog')
    @auth()
    def catalog():
        if not app.config['PORTALS_API_KEY']:
            try:return dict(collections=public_catalog(),attributes={},source='thermos',price_unit='TON',demo=app.config['DEMO_MODE'])
            except Exception:pass
        collections,updated=cached('collections',[]);attributes,_=cached('attributes',{})
        if not collections:collections=[{k:v for k,v in c.items() if k!='models'} for c in catalog_seed['collections']]
        return dict(collections=collections,attributes=attributes,updated_at=updated,demo=app.config['DEMO_MODE'],source='portals' if updated else 'snapshot',snapshot_updated_at=catalog_seed.get('updated_at'))
    def collection_attributes(slug):
        key='thermos:attributes:'+slug;data,updated=cached(key)
        if data and time.time()-updated<300:return data
        import thermos
        c=next((c for c in public_catalog() if c['id']==slug),None)
        if not c:return dict(models=[],backdrops=[],symbols=[])
        try:
            data=thermos.request('attributes',{'collections':[c['name']]}).get(c['name'],{})
            db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(key,json.dumps(data),int(time.time())));db().commit()
            return data
        except Exception:
            if data:return data
            raise
    def collection_models(slug):
        if not app.config['PORTALS_API_KEY']:
            import thermos
            return [dict(name=m['name'],image=m.get('image_url',''),price=thermos.ton(m.get('stats',{}).get('floor')),price_unit='TON',price_source='thermos') for m in collection_attributes(slug).get('models',[])]
        live,_=cached('models:'+slug)
        return live or next((c.get('models',[]) for c in catalog_seed['collections'] if c['id']==slug or c['short_name']==slug),[])
    @app.get('/api/collections/<slug>/models')
    @auth()
    def models(slug):return {'models':collection_models(slug)}
    @app.get('/api/collections/<slug>/attributes')
    @auth()
    def attributes(slug):return collection_attributes(slug)
    @app.get('/api/market')
    @auth()
    def market():
        if not app.config['PORTALS_API_KEY'] and not app.config['DEMO_MODE']:
            import thermos
            params={k:request.args[k][:150] for k in ('search','collection_id','filter_by_models','filter_by_backdrops','filter_by_symbols','sort_by','offset','min_price','max_price','price_unit') if request.args.get(k)}
            try:
                for price_key in ('min_price','max_price'):
                    if price_key in params:
                        val=Decimal(params[price_key])
                        if not val.is_finite() or val<0 or val>1000000000:raise ValueError()
                if 'min_price' in params and 'max_price' in params and Decimal(params['min_price'])>Decimal(params['max_price']):raise ValueError()
            except Exception:abort(400,description='Недопустимый диапазон цены')
            key='public:market:'+urlencode(sorted(params.items()))
            previous,updated=cached(key)
            if previous and time.time()-updated<60:return previous
            try:
                rows,_=cached('thermos:collections',[])
                try:
                    import portals_public
                    result=portals_public.listings(params,rows)
                except Exception:
                    if (params.get('min_price') or params.get('max_price')) and params.get('price_unit')=='GRAM':abort(502,description='Фильтр цены GRAM временно недоступен. Повторите запрос.')
                    result=thermos.gifts(params,rows)
                db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(key,json.dumps(result),int(time.time())));db().commit()
                return result
            except Exception:
                if previous:return {**previous,'warning':'Показаны сохранённые предложения. Цены могут измениться.'}
                abort(502,description='Каталог временно недоступен. Повторите загрузку.')
        if not app.config['PORTALS_API_KEY'] and app.config['DEMO_MODE']:return {'gifts':DEMO_GIFTS,'demo':True,'source':'demo'}
        allowed={'search','collection_id','filter_by_models','filter_by_backdrops','sort_by','offset'}
        params={k:request.args[k][:150] for k in allowed if request.args.get(k)};params.update(limit=40,status='listed')
        cache_key='market:'+urlencode(sorted(params.items()))
        previous,updated=cached(cache_key)
        if previous and int(time.time())-updated<60:return {**previous,'updated_at':updated}
        try:
            data=portal('nfts/search',params)
            result={'gifts':[normalized(n) for n in data.get('results',[])],'demo':False,'source':'portals','total':data.get('total_count',0)}
            db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(cache_key,json.dumps(result),int(time.time())));db().commit()
            return result
        except Exception as error:
            from werkzeug.exceptions import HTTPException
            if not isinstance(error,HTTPException):raise
            if previous:return {**previous,'stale':True,'updated_at':updated,'warning':'Portal недоступен — показаны сохранённые цены'}
            rows=[]
            for c in catalog_seed['collections']:
                if params.get('collection_id') and c['id']!=params['collection_id']:continue
                for m in c['models']:
                    if params.get('filter_by_models') and m['name']!=params['filter_by_models']:continue
                    if params.get('search') and params['search'].lower() not in (c['name']+' '+m['name']).lower():continue
                    rows.append(dict(id=c['id']+':'+m['name'],collection_id=c['id'],name=c['name'],model=m['name'],backdrop='',price=m['price'],image=m['image'],number='',catalog_only=True))
            if params.get('sort_by')=='price asc':rows.sort(key=lambda x:Decimal(x['price']))
            offset=max(0,int(params.get('offset',0)))
            return {'gifts':rows[offset:offset+40],'total':len(rows),'demo':False,'source':'snapshot','warning':'Сохранённый каталог · оценочные цены TON. Обновление Portal пока недоступно.'}


    @app.get('/api/inventory')
    @auth()
    def inventory():
        # A partner token belongs to the operator, NOT to all Mini App users.
        return {'gifts':owned(),'demo':app.config['DEMO_MODE']}
    @app.get('/api/craft/targets')
    @auth()
    def craft_targets():
        return {'collections':public_catalog(),'scope':'application'}
    def make_quote(data):
        ids=data.get('gift_ids',[])
        if not isinstance(ids,list) or not 1<=len(ids)<=100 or any(not isinstance(x,str) for x in ids) or len(set(ids))!=len(ids):abort(400,description='Выберите от 1 до 100 подарков')
        gifts={x['id']:x for x in owned() if x['status']=='unlisted'}
        if any(x not in gifts for x in ids):abort(409,description='Подарок недоступен')
        chosen=[gifts[x] for x in ids]
        if any(x.get('origin') not in ('admin-grant','application-craft') for x in chosen):abort(409,description='Доступны подарки внутреннего инвентаря Crafter')
        catalog=public_catalog();target=next((c for c in catalog if c['id']==data.get('target_id')),None)
        if not target:abort(400,description='Выберите коллекцию результата')
        floors={c['name']:Decimal(c['floor_price']) for c in catalog}
        if any(x['name'] not in floors for x in chosen):abort(409,description='Не удалось оценить коллекцию')
        value=sum(floors[x['name']] for x in chosen);cost=Decimal(target['floor_price'])
        if value<=0 or cost<=0:abort(409,description='Нет актуальной оценки подарков')
        models=collection_models(target['id'])
        if not models:abort(409,description='Модели коллекции пока недоступны')
        allowed=db().execute("SELECT payload FROM settings WHERE key='selection'").fetchone()
        permitted=json.loads(allowed[0]).get(target['id']) if allowed else None
        if permitted is not None:models=[m for m in models if m['name'] in permitted]
        if not models:abort(409,description='Администратор не выбрал модели результата')
        chance=min(9500,int(value/cost*Decimal(9500)))
        reward_model=min(models,key=lambda m:Decimal(m.get('price') or 0))
        return dict(gift_ids=ids,target_id=target['id'],chance_bps=chance,input_value=str(value),target_value=str(cost),target=target,model=reward_model,scope='application')
    @app.post('/api/craft/quote')
    @auth()
    def craft_quote():
        q=make_quote(request.get_json() or {});qid=uuid.uuid4().hex
        db().execute('INSERT INTO craft_quotes VALUES(?,?,?,?)',(qid,g.user['id'],json.dumps(q),int(time.time())));db().commit()
        return dict(quote_id=qid,chance=q['chance_bps']/100,input_value=q['input_value'],target_value=q['target_value'],price_unit='TON',expires_at=int(time.time())+120,scope='application')
    @app.post('/api/craft')
    @auth()
    def craft():
        data=request.get_json() or {};request_id=data.get('request_id');qid=data.get('quote_id')
        if not isinstance(request_id,str) or not 1<=len(request_id)<=100 or not isinstance(qid,str):abort(400)
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior=db().execute('SELECT result FROM craft_requests WHERE user_id=? AND request_id=?',(g.user['id'],request_id)).fetchone()
            if prior:return json.loads(prior[0])
            row=db().execute('SELECT payload,created FROM craft_quotes WHERE id=? AND user_id=?',(qid,g.user['id'])).fetchone()
            if not row or time.time()-row['created']>120:abort(409,description='Расчёт устарел. Повторите выбор.')
            q=json.loads(row['payload']);ids=q['gift_ids'];eligible={x['id'] for x in owned() if x['status']=='unlisted'}
            if any(x not in eligible for x in ids):abort(409,description='Подарок уже использован или выставлен на продажу')
            success=secrets.randbelow(10000)<q['chance_bps'];reward=None
            if success:
                t=q['target'];m=q['model'];reward=dict(id='craft-'+uuid.uuid4().hex,name=t['name'],collection_id=t['id'],model=m['name'],backdrop='',price=t['floor_price'],price_unit='TON',image=m.get('image') or t['photo_url'],number='',origin='application-craft',crafted=True)
            for nft in ids:db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?',(g.user['id'],nft))
            if reward:db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
            result=dict(success=success,chance=q['chance_bps']/100,gift=reward,consumed=ids,scope='application')
            record('craft',result)
            db().execute('INSERT INTO craft_requests VALUES(?,?,?)',(g.user['id'],request_id,json.dumps(result)))
            db().execute('DELETE FROM craft_quotes WHERE id=?',(qid,))
        return result
    def owned():
        return [{**json.loads(r['payload']),'status':r['status']} for r in db().execute('SELECT payload,status FROM inventory WHERE user_id=?',(g.user['id'],))]
    def record(kind,payload):
        db().execute('INSERT INTO history VALUES(?,?,?,?,?)',(uuid.uuid4().hex,g.user['id'],kind,json.dumps(payload),int(time.time())))
    @app.get('/api/history')
    @auth()
    def history():
        return {'items':[dict(id=r['id'],kind=r['kind'],created=r['created'],data=json.loads(r['payload'])) for r in db().execute('SELECT * FROM history WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 100',(g.user['id'],))]}
    @app.post('/api/inventory/action')
    @auth()
    def inventory_action():
        if not app.config['DEMO_MODE']:abort(409,description='Операции с реальными подарками ещё не подключены')
        data=request.get_json() or {};ids=data.get('gift_ids',[]);action=data.get('action')
        if action not in {'sell','unlist','withdraw','transfer'} or not isinstance(ids,list) or not ids or len(ids)>100 or any(not isinstance(x,str) for x in ids) or len(set(ids))!=len(ids):abort(400)
        with db():
            db().execute('BEGIN IMMEDIATE')
            gifts={x['id']:x for x in owned()}
            if any(x not in gifts for x in ids):abort(409,description='Подарок недоступен')
            for nft in ids:
                gift=gifts[nft]
                if action=='sell':
                    try:price=Decimal(str(data.get('price','0')))
                    except Exception:abort(400,description='Некорректная цена')
                    if not price.is_finite() or price<=0 or price>1000000:abort(400,description='Некорректная цена')
                    gift['price']=str(price);db().execute("UPDATE inventory SET status='listed',payload=? WHERE user_id=? AND nft_id=?",(json.dumps(gift),g.user['id'],nft))
                elif action=='unlist':db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=?",(g.user['id'],nft))
                else:
                    if gift['status']!='unlisted':abort(409,description='Сначала снимите подарок с продажи')
                    if action=='transfer' and not str(data.get('recipient','')).strip():abort(400,description='Укажите получателя')
                    db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?',(g.user['id'],nft))
            record(action,{'gifts':[gifts[x] for x in ids],'recipient':data.get('recipient'),'demo':True})
        return {'ok':True,'demo':True}
    @app.post('/api/demo/buy')
    @auth()
    def demo_buy():
        if not app.config['DEMO_MODE']:abort(409)
        nft=next((x for x in DEMO_GIFTS if x['id']==(request.get_json() or {}).get('id')),None)
        if not nft:abort(404)
        with db():
            db().execute('BEGIN IMMEDIATE')
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
            if balance<Decimal(nft['price']):abort(409,description='Не хватает тестового баланса')
            reward={**nft,'id':'purchased-'+uuid.uuid4().hex,'number':secrets.randbelow(999999)}
            db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-Decimal(nft['price'])),g.user['id']))
            record('buy',reward)
        return {'ok':True,'gift':reward,'demo':True}
    @app.get('/api/admin/status')
    @auth(admin=True)
    def status():
        c,t=cached('collections',[])
        return {'configured':bool(app.config['PORTALS_API_KEY']),'mode':'partner' if app.config['PORTALS_API_KEY'] else 'public','updated_at':t,'collections':len(c),'sync':dict(catalog_job),'users':db().execute('SELECT count(*) FROM users').fetchone()[0],'audit':[dict(x) for x in db().execute('SELECT actor,action,created FROM audit ORDER BY id DESC LIMIT 20')]}
    @app.post('/api/admin/portal/test')
    @auth(admin=True)
    def test_portal():
        portal('market/config');audit('Portal: connection checked');return {'ok':True}
    @app.post('/api/admin/portal/sync')
    @auth(admin=True)
    def sync():
        audit('Portal: catalog refresh started')
        return start_catalog_refresh()
    def start_catalog_refresh():
        if catalog_job['running']:return {'ok':True,**catalog_job}
        catalog_job.update(running=True,completed=0,total=0,error='')
        def worker():
            with app.app_context():
                try:
                    data=portal('collections/preview');rows=data.get('collections') or data.get('items') or []
                    if not rows:raise ValueError('Источник вернул пустой каталог')
                    rows=[{**c,'short_name':c.get('short_name') or c.get('shortName') or '', 'photo_url':c.get('photo_url') or 'https://portal-market.com/collection_previews/'+str(c.get('short_name') or c.get('shortName') or '')+'.webp'} for c in rows]
                    catalog_job['total']=len(rows)
                    with db():db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',('collections',json.dumps(rows),int(time.time())))
                    for c in rows:
                        slug=c.get('short_name') or c.get('shortName')
                        if not slug:continue
                        try:
                            result=portal('collections/filters',{'short_names':slug})
                            def find_models(node):
                                if isinstance(node,dict):
                                    if isinstance(node.get('models'),(dict,list)):return node['models']
                                    for v in node.values():
                                        found=find_models(v)
                                        if found:return found
                                return None
                            models=find_models(result) or {};seed={m['name']:m for m in collection_models(slug)};parsed=[]
                            for name,value in (models.items() if isinstance(models,dict) else [(x.get('name') or x.get('value'),x) for x in models if isinstance(x,dict)]):
                                if not name:continue
                                price=value.get('floor_price',value.get('floor',value.get('price',0))) if isinstance(value,dict) else value
                                parsed.append({'name':name,'price':str(price or 0),'image':seed.get(name,{}).get('image',c.get('photo_url','')),'price_source':'portals'})
                            if parsed:
                                with db():db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',('models:'+slug,json.dumps(parsed),int(time.time())))
                        except Exception as error:catalog_job['error']='Часть моделей не обновлена: '+str(error)[:100]
                        catalog_job['completed']+=1
                    catalog_job['updated_at']=int(time.time())
                except Exception as error:catalog_job['error']='Portal не обновлён: '+str(error)[:150]
                finally:catalog_job['running']=False
        threading.Thread(target=worker,daemon=True).start()
        return {'ok':True,**catalog_job}
    @app.get('/api/admin/users')
    @auth(admin=True)
    def users():
        query='%'+request.args.get('search','')[:100]+'%'
        rows=db().execute('SELECT u.*, COALESCE(a.balance,0) balance,(SELECT count(*) FROM inventory i WHERE i.user_id=u.id) gifts FROM users u LEFT JOIN demo_accounts a ON a.user_id=u.id WHERE CAST(u.id AS TEXT) LIKE ? OR u.name LIKE ? OR u.username LIKE ? ORDER BY u.created DESC LIMIT 100',(query,query,query)).fetchall()
        return {'users':[dict(r) for r in rows]}
    @app.post('/api/admin/users/<int:uid>/balance')
    @auth(admin=True)
    def user_balance(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():abort(404)
        try:amount=Decimal(str((request.get_json() or {}).get('balance')))
        except Exception:abort(400,description='Укажите баланс числом')
        if not amount.is_finite() or amount<0 or amount>1000000000:abort(400,description='Недопустимый баланс')
        db().execute('INSERT OR REPLACE INTO demo_accounts VALUES(?,?)',(uid,str(amount.quantize(Decimal('0.01')))));db().commit();audit('Balance edited: '+str(uid))
        return {'ok':True}
    @app.post('/api/admin/users/<int:uid>/gifts')
    @auth(admin=True)
    def user_gift(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():abort(404)
        data=request.get_json() or {};slug=data.get('collection_id');name=data.get('model')
        collection=next((c for c in public_catalog() if c['id']==slug or c['short_name']==slug),None)
        model=next((m for m in collection_models(slug) if m['name']==name),None)
        if not collection or not model:abort(400,description='Выберите коллекцию и модель из каталога')
        gift=dict(id='grant-'+uuid.uuid4().hex,name=collection['name'],collection_id=slug,model=name,backdrop='',price=model['price'],image=model['image'],number='',origin='admin-grant',price_unit=model.get('price_unit','TON'))
        db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(uid,gift['id'],json.dumps(gift),'unlisted'));db().commit();audit('Gift granted: '+str(uid)+' '+collection['name']+' / '+name)
        return {'ok':True,'gift':gift}
    @app.get('/api/admin/selection')
    @auth(admin=True)
    def get_selection():
        row=db().execute("SELECT payload FROM settings WHERE key='selection'").fetchone();return {'selection':json.loads(row[0]) if row else {}}
    @app.post('/api/admin/selection')
    @auth(admin=True)
    def set_selection():
        selection=(request.get_json() or {}).get('selection',{})
        if not isinstance(selection,dict) or len(selection)>1000 or any(not isinstance(v,list) or any(not isinstance(x,str) for x in v) for v in selection.values()):abort(400)
        db().execute("INSERT OR REPLACE INTO settings VALUES('selection',?)",(json.dumps(selection),));db().commit();audit('Craft model selection updated');return {'ok':True}
    if not app.config.get('TESTING') and os.getenv('CATALOG_REFRESH_ON_START','0')=='1':
        start_catalog_refresh()
    return app

app=create_app()
if __name__=='__main__':app.run(host='127.0.0.1',port=int(os.getenv('PORT','5000')),debug=False)

