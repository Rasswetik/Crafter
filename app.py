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
    Path(app.config['DATABASE']).parent.mkdir(parents=True,exist_ok=True)
    def db():
        if 'db' not in g:
            g.db=sqlite3.connect(app.config['DATABASE'],timeout=10);g.db.row_factory=sqlite3.Row
        return g.db
    @app.teardown_appcontext
    def close(error):
        if 'db' in g:g.db.close()
    with app.app_context():
        db().executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, username TEXT, referrer INTEGER, created INTEGER); CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, payload TEXT, updated INTEGER); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor INTEGER, action TEXT, created INTEGER); CREATE TABLE IF NOT EXISTS inventory(user_id INTEGER, nft_id TEXT, payload TEXT, status TEXT DEFAULT 'unlisted', PRIMARY KEY(user_id,nft_id)); CREATE TABLE IF NOT EXISTS demo_accounts(user_id INTEGER PRIMARY KEY,balance TEXT); CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,user_id INTEGER,kind TEXT,payload TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS craft_requests(user_id INTEGER,request_id TEXT,result TEXT,PRIMARY KEY(user_id,request_id));'''); db().commit()
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
        public_paths={'nfts/search':'nfts/search','collections/preview':'collections','market/config':'collections'}
        if not key and path not in public_paths:
            return {'attribute_floors':{}}
        base='https://portal-market.com/partners/' if key else 'https://portal-market.com/api/'
        remote_path=path if key else public_paths[path]
        if not key and path in {'market/config','collections/preview'}:
            params={**(params or {}),'limit':100}
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
        return dict(user=g.user,is_admin=g.is_admin,demo=app.config['DEMO_MODE'],inventory_count=len(owned()),balance=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0] if app.config['DEMO_MODE'] else '0',inventory_value=str(sum(Decimal(x['price']) for x in owned())),bought=db().execute("SELECT count(*) FROM history WHERE user_id=? AND kind='buy'",(g.user['id'],)).fetchone()[0],sold=0,volume='0',referrals=refs,referral_level=1,referral_progress=min(refs*10,100),invite_link=link)
    @app.post('/api/referral')
    @auth()
    def referral():
        # start_param is signed inside initData; never trust a separate client referrer.
        raw=dict(parse_qsl(request.headers.get('X-Telegram-Init-Data',''))).get('start_param','')
        if raw.startswith('ref_') and raw[4:].isdigit():
            ref=int(raw[4:]);row=db().execute('SELECT 1 FROM users WHERE id=?',(ref,)).fetchone()
            if ref!=g.user['id'] and row:db().execute('UPDATE users SET referrer=? WHERE id=? AND referrer IS NULL AND created>=?',(ref,g.user['id'],int(time.time())-60));db().commit()
        return {'ok':True}
    @app.get('/api/catalog')
    @auth()
    def catalog():
        collections,updated=cached('collections',[]);attributes,_=cached('attributes',{})
        return dict(collections=collections,attributes=attributes,updated_at=updated,demo=app.config['DEMO_MODE'])
    @app.get('/api/market')
    @auth()
    def market():
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
            return {'gifts':[],'demo':False,'source':'unavailable','warning':'Portal не ответил на открытый запрос. Живые цены пока не загружены.'}

    @app.get('/api/inventory')
    @auth()
    def inventory():
        # A partner token belongs to the operator, NOT to all Mini App users.
        return {'gifts':owned(),'demo':app.config['DEMO_MODE']}
    @app.get('/api/craft/targets')
    @auth()
    def craft_targets():
        return {'gifts':DEMO_GIFTS if app.config['DEMO_MODE'] else [],'demo':app.config['DEMO_MODE']}
    @app.post('/api/craft')
    @auth()
    def craft():
        if not app.config['DEMO_MODE']:abort(409,description='Реальный крафт ещё не настроен')
        data=request.get_json() or {};ids=data.get('gift_ids',[]);request_id=data.get('request_id')
        if request_id is not None and (not isinstance(request_id,str) or len(request_id)>100):abort(400)
        if not isinstance(ids,list) or not 1<=len(ids)<=4 or any(not isinstance(x,str) for x in ids) or len(set(ids))!=len(ids):abort(400,description='Выберите от 1 до 4 разных подарков')
        target=next((x for x in DEMO_GIFTS if x['id']==data.get('target_id')),None)
        if not target:abort(400,description='Выберите результат крафта')
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior=db().execute('SELECT result FROM craft_requests WHERE user_id=? AND request_id=?',(g.user['id'],request_id)).fetchone() if request_id else None
            if prior:return json.loads(prior[0])
            eligible={x['id'] for x in owned() if x['status']=='unlisted'}
            if any(x not in eligible for x in ids):abort(409,description='Подарок уже использован или выставлен на продажу')
            chance=min(len(ids)*20,80);success=secrets.randbelow(100)<chance
            for nft in ids:db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?',(g.user['id'],nft))
            reward={**target,'id':'crafted-'+uuid.uuid4().hex,'number':secrets.randbelow(999999),'crafted':True} if success else None
            if reward:db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
            result={'demo':True,'success':success,'chance':chance,'gift':reward,'consumed':ids}
            record('craft',result)
            if request_id:db().execute('INSERT INTO craft_requests VALUES(?,?,?)',(g.user['id'],request_id,json.dumps(result)))
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
        return {'configured':bool(app.config['PORTALS_API_KEY']),'mode':'partner' if app.config['PORTALS_API_KEY'] else 'public','updated_at':t,'collections':len(c),'users':db().execute('SELECT count(*) FROM users').fetchone()[0],'audit':[dict(x) for x in db().execute('SELECT actor,action,created FROM audit ORDER BY id DESC LIMIT 20')]}
    @app.post('/api/admin/portal/test')
    @auth(admin=True)
    def test_portal():
        portal('market/config');audit('Portal: connection checked');return {'ok':True}
    @app.post('/api/admin/portal/sync')
    @auth(admin=True)
    def sync():
        c=portal('collections/preview').get('collections',[]);a=portal('collections/attribute-floors').get('attribute_floors',{})
        if not isinstance(c,list) or not isinstance(a,dict):abort(502,description='Неожиданный формат ответа Portals')
        now=int(time.time())
        with db():
            for k,v in [('collections',c),('attributes',a)]:db().execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(k,json.dumps(v),now))
        audit('Portal: catalog synchronized');return {'ok':True,'collections':len(c),'updated_at':now}
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
    return app

app=create_app()
if __name__=='__main__':app.run(host='127.0.0.1',port=int(os.getenv('PORT','5000')),debug=False)
