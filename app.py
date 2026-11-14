import gzip
import re, unicodedata
import os, json, time, hmac, hashlib, sqlite3, secrets, threading, uuid
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from flask import Flask, request, jsonify, render_template, g, abort
from dotenv import load_dotenv
from database import Postgres
from resale import cap_funded_balance, install_resale
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

CRAFT_GIFT_LIMIT = 4

DEMO_GIFTS = [
 dict(id='demo-snoop',name='Snoop Dogg',collection_id='snoop',model='Emerald',backdrop='Gold',price='9.49',number=303022,image='/static/assets/snoop.webp'),
 dict(id='demo-amulet',name='Faith Amulet',collection_id='amulet',model='Moon Palace',backdrop='Gold',price='8.88',number=29726,image='/static/assets/amulet.webp'),
 dict(id='demo-snoop2',name='Snoop Dogg',collection_id='snoop',model='Emerald',backdrop='Gold',price='10.20',number=303024,image='/static/assets/snoop.webp'),
 dict(id='demo-amulet2',name='Faith Amulet',collection_id='amulet',model='Moon Palace',backdrop='Gold',price='12.50',number=29729,image='/static/assets/amulet.webp')]

def create_app(config=None):
    app = Flask(__name__)
    app.config.update(DATABASE=os.getenv('DATABASE',str(Path('/var/data/crafter.sqlite3') if Path('/var/data').is_dir() else ROOT/'instance/app.sqlite3')), DEMO_MODE=os.getenv('DEMO_MODE','0')=='1', BOT_TOKEN=os.getenv('BOT_TOKEN',''), ADMIN_IDS={int(x.strip()) for x in os.getenv('ADMIN_IDS','').split(',') if x.strip().isdigit()}, PORTALS_API_KEY=os.getenv('PORTALS_API_KEY',''), BOT_USERNAME=os.getenv('BOT_USERNAME',''), PRIMARY_ADMIN_ID=os.getenv('PRIMARY_ADMIN_ID',''), MAX_CONTENT_LENGTH=16384, MARKET_TEST_PURCHASES=os.getenv('MARKET_TEST_PURCHASES','1')!='0')
    app.config['DATABASE_URL'] = os.getenv('DATABASE_URL', '')
    if config: app.config.update(config)
    catalog_seed=json.loads(gzip.decompress((ROOT/'data/catalog_seed.json.gz').read_bytes())) if (ROOT/'data/catalog_seed.json.gz').exists() else {'collections':[]}
    catalog_job={'running':False,'completed':0,'total':0,'error':'','updated_at':None}
    postgres_url = app.config['DATABASE_URL']
    # Free-tier PostgreSQL is not reliable with a long-lived connection pool:
    # connection acquisition can time out even when only a few visitors are online.
    # Use request-scoped connections and close them in teardown.
    if not postgres_url:
        Path(app.config['DATABASE']).parent.mkdir(parents=True,exist_ok=True)
    def db():
        if 'db' not in g:
            if postgres_url:
                g.db = Postgres(postgres_url)
                return g.db
            g.db=sqlite3.connect(app.config['DATABASE'],timeout=10);g.db.row_factory=sqlite3.Row
            g.db.execute('PRAGMA busy_timeout=10000')
            g.db.execute('PRAGMA journal_mode=WAL')
            g.db.execute('PRAGMA foreign_keys=ON')
        return g.db
    @app.teardown_appcontext
    def close(error):
        if 'db' in g:g.db.close()
    with app.app_context():
        db().executescript('''CREATE TABLE IF NOT EXISTS local_numbers(collection_id TEXT,number INTEGER,PRIMARY KEY(collection_id,number)); CREATE TABLE IF NOT EXISTS local_purchases(user_id INTEGER,request_id TEXT,result TEXT,PRIMARY KEY(user_id,request_id)); CREATE TABLE IF NOT EXISTS local_sold(source_id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS craft_quotes(id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, username TEXT, referrer INTEGER, created INTEGER); CREATE TABLE IF NOT EXISTS user_avatars(user_id INTEGER PRIMARY KEY,photo_url TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, payload TEXT, updated INTEGER); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor INTEGER, action TEXT, created INTEGER); CREATE TABLE IF NOT EXISTS inventory(user_id INTEGER, nft_id TEXT, payload TEXT, status TEXT DEFAULT 'unlisted', PRIMARY KEY(user_id,nft_id)); CREATE TABLE IF NOT EXISTS demo_accounts(user_id INTEGER PRIMARY KEY,balance TEXT); CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,user_id INTEGER,kind TEXT,payload TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS craft_requests(user_id INTEGER,request_id TEXT,result TEXT,PRIMARY KEY(user_id,request_id));'''); db().commit()
    from admin_roles import (ensure_admin_tables, resolve_primary_admin,
                             access_for_id, can_access_admin_path)
    with app.app_context(), db():
        ensure_admin_tables(db())
    primary_admin_id = resolve_primary_admin(app.config)
    def admin_access(uid):
        return access_for_id(db(), uid, app.config['ADMIN_IDS'], primary_admin_id)

    def gift_number(collection_id,preferred=None):
        try:preferred=int(preferred)
        except (TypeError,ValueError):preferred=None
        for attempt in range(50):
            number=preferred if attempt==0 and preferred and preferred>0 else secrets.randbelow(999999)+1
            inserted = db().execute('INSERT INTO local_numbers VALUES(?,?) ON CONFLICT DO NOTHING',
                                    (collection_id, number))
            if inserted.rowcount:
                return number
        abort(409,description='Не удалось присвоить номер подарка')
    with app.app_context(),db():
        for row in db().execute('SELECT user_id,nft_id,payload FROM inventory').fetchall():
            gift=json.loads(row['payload'])
            try:existing_number=int(gift.get('number') or 0)
            except (ValueError,TypeError):existing_number=0
            if existing_number>0:
                db().execute('INSERT INTO local_numbers VALUES(?,?) ON CONFLICT DO NOTHING',(gift.get('collection_id',gift['name']),existing_number))
            if existing_number<=0:
                gift['number']=gift_number(gift.get('collection_id',gift['name']))
                db().execute('UPDATE inventory SET payload=? WHERE user_id=? AND nft_id=?',(json.dumps(gift),row['user_id'],row['nft_id']))
            if gift.get('origin') in ('admin-grant','application-craft'):
                gift.setdefault('source_price_unit',gift.get('price_unit','TON'));gift['price_unit']='GRAM'
                if not gift.get('background') and not gift.get('source_id'):
                    cache_row=db().execute('SELECT payload FROM cache WHERE key=?',('thermos:attributes:'+str(gift.get('collection_id','')),)).fetchone()
                    backgrounds=json.loads(cache_row[0]).get('backdrops',[]) if cache_row else []
                    gift['background']=backgrounds[int(hashlib.sha256(gift['id'].encode()).hexdigest(),16)%len(backgrounds)] if backgrounds else {'center_color':5140105,'edge_color':2503750}
                    if gift['background'].get('name'):gift['backdrop']=gift['background']['name']
                db().execute('UPDATE inventory SET payload=? WHERE user_id=? AND nft_id=?',(json.dumps(gift),row['user_id'],row['nft_id']))
    def market_collectible_key(gift):
        number = str(gift.get('number') or '')
        name = canonical_name(gift.get('name', ''))
        if name and re.fullmatch(r'[1-9][0-9]{0,14}', number):
            return f'craft-collectible:{name}:{number}'
        return None

    def hide_claimed_market_gifts(result):
        sold = {row[0] for row in db().execute('SELECT source_id FROM local_sold')}
        return {**result, 'gifts': [gift for gift in result['gifts']
                                  if gift['id'] not in sold and market_collectible_key(gift) not in sold]}

    BAD_LOTS_KEY='thermos:badlots'
    def hidden_lots():
        """Lots that Thermos listed but refused or no longer had: hidden from the market for a while so nobody hits them again."""
        row=db().execute('SELECT payload FROM cache WHERE key=?',(BAD_LOTS_KEY,)).fetchone()
        try:data=json.loads(row['payload']) if row else {}
        except (TypeError,ValueError):data={}
        limit=int(time.time())-6*3600
        return {k:v for k,v in data.items() if v>limit}
    def hide_lots(ids):
        data=hidden_lots();stamp=int(time.time())
        for gid in ids:data[str(gid)]=stamp
        with db():
            db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(BAD_LOTS_KEY,json.dumps(data),stamp))
    app.extensions['crafter_hide_lots']=hide_lots
    def local_market_rows(result):
        bad=hidden_lots()
        if bad:result={**result,'gifts':[x for x in result.get('gifts',[]) if str(x.get('id')) not in bad]}
        # Local test prices use the source numeric amount in app GRAM; no FX or external purchase.
        result = hide_claimed_market_gifts(result)
        return {**result,'price_unit':'GRAM',
                'market_price_unit':result.get('price_unit','TON'),
                'market_price_source':result.get('source','unknown'),
                'gifts':[{**g,'source_price_unit':g.get('source_price_unit',g.get('price_unit','GRAM')),
                   'price_unit':'GRAM','source_price':g.get('source_price',g['price']),
                   'price':str(Decimal(str(g['price'])).quantize(Decimal('0.01'))),
                   'local_price':str(Decimal(str(g['price'])).quantize(Decimal('0.01')))} for g in result['gifts']],
                'purchase_mode':'local',
                'warning':(
                   'Внешние котировки указаны в TON (Thermos), а не в GRAM Portals. '
                   'Чтобы видеть цены GRAM из Portals, нужен ключ Partner API.'
                   + (' ' + result['warning'] if result.get('warning') else '')
                   if result.get('source')=='thermos' else result.get('warning',''))}
    # Avoid writing the users, avatars and balance tables on every GET poll.
    # Mutating requests still refresh the identity before changing balances.
    auth_touch = {}
    auth_touch_lock = threading.Lock()

    def auth(admin=False):
        def deco(fn):
            @wraps(fn)
            def run(*args,**kwargs):
                raw=request.headers.get('X-Telegram-Init-Data','')
                web_session=request.headers.get('X-Crafter-Web-Session','')
                internal_user=request.environ.get('crafter.internal_user')   # set only by the server itself (partner API), never by a client
                try:
                    if internal_user:
                        g.user=dict(internal_user)
                    elif raw:
                        # The environment token is normally enough. Do not query
                        # bot settings in PostgreSQL on every authenticated poll.
                        primary = app.config['BOT_TOKEN']
                        if primary:
                            try:
                                g.user = verify_telegram(raw, primary)
                            except ValueError:
                                pass
                        if 'user' not in g:
                            fallback = bot_settings().get('token')
                            if not fallback or fallback == primary:
                                raise ValueError('signature')
                            g.user = verify_telegram(raw, fallback)
                    elif web_session:
                        found=app.extensions['crafter_web_session_user'](web_session)
                        if not found:abort(401,description='Сессия сайта истекла. Войдите снова.')
                        g.user=found
                    elif app.config['DEMO_MODE']:g.user={'id':1,'first_name':'Гошан','username':'goshan_wow'}
                    else:abort(401,description='Откройте приложение через Telegram')
                except (ValueError,KeyError,TypeError,json.JSONDecodeError):abort(401,description='Недействительная авторизация Telegram')
                role = admin_access(g.user['id'])
                g.is_admin = role['is_admin']
                g.is_primary_admin = role['is_primary_admin']
                g.admin_permissions = role['permissions']
                if admin and not g.is_admin:
                    abort(403,description='Доступ только для администратора')
                if (admin or request.path.startswith('/api/admin/')) and not can_access_admin_path(role, request.path):
                    abort(403,description='Недостаточно прав на этот раздел админки')
                if not g.is_admin and db().execute(
                        'SELECT 1 FROM user_bans WHERE user_id=?',(g.user['id'],)).fetchone():
                    abort(403,description='Ваш аккаунт Crafter заблокирован. Обратитесь к администратору.')
                uid = g.user['id']
                photo = g.user.get('photo_url')
                photo = (photo if isinstance(photo, str) and len(photo) <= 2048
                         and not any(ord(char) < 33 for char in photo) and https_url(photo) else None)
                fingerprint = (g.user.get('first_name', ''), g.user.get('username', ''), photo)
                seen_at = time.monotonic()
                with auth_touch_lock:
                    previous = auth_touch.get(uid)
                    needs_touch = (request.method != 'GET' or previous is None
                                   or previous[0] != fingerprint or seen_at - previous[1] > 60)
                if needs_touch:
                    db().execute('INSERT INTO users VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE '
                                 'SET name=excluded.name,username=excluded.username',
                                 (uid, fingerprint[0], fingerprint[1], None, int(time.time())))
                    db().commit()
                    if photo:
                        db().execute('INSERT INTO user_avatars VALUES(?,?) ON CONFLICT (user_id) DO UPDATE '
                                     'SET photo_url=excluded.photo_url WHERE user_avatars.photo_url!=excluded.photo_url',
                                     (uid, photo))
                        db().commit()
                    if app.config['DEMO_MODE']:
                        with db():
                            fresh=db().execute('INSERT INTO demo_accounts VALUES(?,?) ON CONFLICT DO NOTHING',
                                               (uid, '100')).rowcount
                            if fresh:
                                for gift in DEMO_GIFTS:
                                    db().execute('INSERT INTO inventory VALUES(?,?,?,?)',
                                                 (uid, gift['id'], json.dumps(gift), 'unlisted'))
                    else:
                        db().execute('INSERT INTO demo_accounts VALUES(?,?) ON CONFLICT DO NOTHING', (uid, '0'))
                        db().commit()
                    with auth_touch_lock:
                        if len(auth_touch) >= 2048:
                            auth_touch.clear()
                        auth_touch[uid] = (fingerprint, seen_at)
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
        if getattr(g,'is_admin',False):          # an administrator sees what actually failed, a player sees the short text
            return jsonify(error='Ошибка сервера: '+type(e).__name__+': '+str(e)[:240]),500
        return jsonify(error='Ошибка сервера'),500
    def cached(key,default=None):
        row=db().execute('SELECT * FROM cache WHERE key=?',(key,)).fetchone()
        return (json.loads(row['payload']),row['updated']) if row else (default,None)
    def audit(action):
        db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',(g.user['id'],action,int(time.time())));db().commit()
    api_lock=threading.Lock();last_call=[0.0]
    def portal(path,params=None):
        # Public catalogue never consumes the Partner quota or uses its key.
        public_paths={'nfts/search':'nfts/search','collections/preview':'collections',
                      'market/config':'collections','collections/filters':'collections/filters'}
        if path not in public_paths:
            return {'attribute_floors':{}}
        base='https://portal-market.com/api/'
        remote_path=public_paths[path]
        if path in {'market/config','collections/preview'}:
            params={**(params or {}),'limit':5000}
        headers={'Accept':'application/json'}
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
        # The official partner feed quotes real listing/floor prices in GRAM.
        price=n.get('price') or n.get('floor_price') or '0'
        return dict(id=n['id'],name=n.get('name','Gift'),collection_id=n.get('collection_id',''),model=attrs.get('model',''),symbol=attrs.get('symbol',attrs.get('pattern','')),backdrop=attrs.get('backdrop',''),price=str(price),price_unit='GRAM',source_price_unit='GRAM',floor_price=n.get('floor_price'),number=n.get('external_collection_number',''),image=n.get('photo_url',''))
    def is_maintenance_enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='site_maintenance_v2'").fetchone()
        if not row:
            return False
        try:
            return bool(json.loads(row['payload']).get('enabled'))
        except (ValueError, TypeError):
            return False

    @app.get('/')
    def index():
        return render_template('index.html', site_maintenance=is_maintenance_enabled())

    # every section of the app has its own address: a refresh (or a shared link) opens that very section
    for _path in ('/market', '/gifts', '/hub', '/craft', '/upgrade', '/arena', '/staking', '/profile', '/new-year', '/wallet', '/deposit', '/withdraw', '/cart', '/auctions', '/author'):
        app.add_url_rule(_path, 'section_' + _path.strip('/').replace('-', '_'), index)

    for _rule, _name in (('/new-year/market', 'section_new_year_market'), ('/new-year/market/<path:lot>', 'section_new_year_lot')):
        app.add_url_rule(_rule, _name, lambda lot=None: index())

    @app.get('/shop/preview')
    def shop_preview_page():
        # a drawing board for the market: the administrator sends offers to it with postMessage; it holds no data
        return render_template('shop_preview.html')

    @app.get('/auctions/<auction_id>')
    def auction_lot_page(auction_id):
        if not re.fullmatch(r'auction-[0-9a-f]{32}', auction_id):
            abort(404)
        return index()

    @app.get('/admin')
    def admin_page():
        return render_template('admin.html')

    @app.get('/admin/user/<int:uid>')
    def admin_user_page(uid):
        return render_template('admin_user.html', uid=uid)


    @app.get('/favicon.ico')
    def site_favicon():
        return app.send_static_file('favicon.ico')
    @app.get('/collections/<slug>')
    def collection_page(slug):
        return render_template('index.html')

    from fragment_media import serve_fragment_gift
    from collection_media import serve_collection_thumbnail, serve_trait_png
    app.add_url_rule('/media/fragment/<slug>', view_func=serve_fragment_gift)
    app.add_url_rule('/media/collection/<slug>', view_func=serve_collection_thumbnail)
    app.add_url_rule('/media/trait/<kind>', view_func=serve_trait_png)

    @app.get('/preview')
    def preview():
        from build_preview import build_preview
        return build_preview()
    @app.after_request
    def cache_control(response):
        if request.path.startswith('/auctions') or request.path.startswith('/shop/') or request.path.startswith('/new-year/') or request.path in {'/', '/admin', '/preview', '/api/banners', '/market', '/gifts', '/hub', '/craft', '/upgrade', '/arena', '/staking', '/profile', '/new-year', '/wallet', '/deposit', '/withdraw', '/cart', '/author'} or request.path.startswith('/static/'):
            response.headers['Cache-Control']='no-cache, must-revalidate'
        return response
    @app.get('/health')
    def health():
        if postgres_url:
            db().execute('SELECT 1').fetchone()
        return {'ok': True}
    def purchase_mode():
        """'test' (gift bought without Portals checks) or 'work' (Portals availability + balance + real purchase).
        Set from the admin panel; MARKET_TEST_PURCHASES is only the default before it is set."""
        row = db().execute("SELECT payload FROM settings WHERE key='purchase_mode_v1'").fetchone()
        if row:
            try:
                mode = json.loads(row[0]).get('mode')
            except (ValueError, TypeError, AttributeError):
                mode = None
            if mode in ('test', 'work'):
                return mode
        return 'test' if app.config.get('MARKET_TEST_PURCHASES') else 'work'
    app.extensions['crafter_purchase_mode'] = purchase_mode
    app.extensions['crafter_public_catalog'] = lambda: public_catalog()
    def positive_price(value):
        try:
            price = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
        return price if price.is_finite() and price > 0 else None

    @app.get('/api/balance')
    @auth()
    def live_balance():
        uid=g.user['id']
        row=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
        balls=db().execute('SELECT balls,donate,tinsel FROM new_year_wallets WHERE user_id=?',(uid,)).fetchone()
        referred=db().execute('SELECT balance FROM referral_balances WHERE user_id=?',(uid,)).fetchone()
        response=jsonify(user_id=uid,balance=str(row[0]) if row else '0',
                         referral_balance=str(referred[0]) if referred else '0',
                         new_year={key:int(balls[key]) if balls else 0 for key in ('balls','donate','tinsel')})
        response.headers['Cache-Control']='no-store'
        return response

    @app.get('/api/me')
    @auth()
    def me():
        expire_offers(g.user['id'])
        refs=db().execute('SELECT count(*) FROM users WHERE referrer=?',(g.user['id'],)).fetchone()[0]
        username = bot_settings()['username']
        link = f"https://t.me/{username}?startapp=ref_{g.user['id']}" if username else None
        inventory = [gift for gift in owned() if gift['status'] not in ('staked', 'arena')]
        valuation = {'GRAM': Decimal(0), 'TON': Decimal(0)}
        cached_floors = {}
        for key, unit in (('thermos:collections', 'TON'), ('collections', 'GRAM')):
            for collection in cached(key, [])[0]:
                price = positive_price(collection.get('floor_price'))
                if price:
                    cached_floors[canonical_name(collection.get('name') or '')] = (price, unit)
        for gift in inventory:
            # Preview-only gifts are not real, transferable NFT assets.
            if gift.get('test_only'):
                continue
            price = positive_price(gift.get('price'))
            unit = 'TON' if gift.get('price_unit') == 'TON' else 'GRAM'
            if price is None:
                price = positive_price(gift.get('floor_price'))
                if price and gift.get('source_price_unit') in valuation:
                    unit = gift['source_price_unit']
            if price is None:
                price, unit = cached_floors.get(canonical_name(gift.get('name') or ''), (Decimal(0), unit))
            valuation[unit] += price
        bought = sold = games_played = 0
        volume = best_game_win = Decimal(0)
        for row in db().execute("SELECT kind,payload FROM history WHERE user_id=? AND kind IN ('buy','sale','craft','arena_result')", (g.user['id'],)):
            payload = json.loads(row['payload'])
            if row['kind'] in ('craft', 'arena_result'):
                games_played += 1
                gift = payload.get('gift') or {}
                if payload.get('success') and (payload.get('prize_value') or gift.get('price_unit') == 'GRAM'):
                    best_game_win = max(best_game_win, positive_price(payload.get('prize_value', gift.get('price'))) or Decimal(0))
                continue
            bought += row['kind'] == 'buy'
            sold += row['kind'] == 'sale'
            price = positive_price(payload.get('price'))
            if price:
                volume += price
        balance = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (g.user['id'],)).fetchone()[0]
        referral_data=referral_snapshot(g.user['id'])
        return dict(user=g.user, is_admin=g.is_admin, admin_hidden=bool(g.is_admin and app.extensions.get('crafter_admin_hidden', lambda: False)()), is_primary_admin=g.is_primary_admin,
                    admin_permissions=g.admin_permissions, demo=app.config['DEMO_MODE'],
                    inventory_count=len(inventory), balance=balance, inventory_value_ton=str(valuation['TON']),
                    inventory_value=str(valuation['GRAM']), bought=bought, sold=sold, volume=str(volume),
                    games_played=games_played, best_game_win=str(best_game_win),
                    referrals=referral_data['referrals'],
                    referral_level=referral_data['level'],
                    referral_progress=referral_data['progress'],
                    referral_until_next=referral_data['until_next'],
                    referral_tier_rates=referral_data['levels'], referral_commission_live=True,
                    referral_balance=referral_data['balance'], referral_rate=referral_data['rate'],
                    referral_earned=referral_data['total_earned'], new_year_enabled=new_year_enabled(),
                    new_year_reward_per_ton=10, new_year_gram_per_ton=str(seasonal_conversion()),
                    market_test_purchases=purchase_mode() == 'test', purchase_mode=purchase_mode(),
                    market_backend=app.extensions['crafter_market_backend'](),
                    invite_link=link)

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
        import thermos
        rows,updated=cached('thermos:collections',[])
        if rows and time.time()-updated<300:return thermos.unique_collections(rows)
        try:
            rows=thermos.collections()
            db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',('thermos:collections',json.dumps(rows),int(time.time())));db().commit()
        except Exception:
            if not rows:raise
        return thermos.unique_collections(rows)
    @app.get('/api/catalog')
    @auth()
    def catalog():
        # Official public API first. No Partner key or request slot is consumed.
        collections,updated=cached('portals:public:collections',[])
        if not collections or not updated or int(time.time())-updated>300:
            try:
                raw=portal('collections/preview')
                items=raw if isinstance(raw,list) else (raw.get('collections') or raw.get('items') or raw.get('results') or [])
                fresh=[]
                for c in items:
                    if not isinstance(c,dict) or not c.get('id') or not c.get('name'):
                        continue
                    short=c.get('short_name') or c.get('shortName') or ''
                    price=c.get('floor_price') or c.get('floor') or '0'
                    fresh.append({**c, 'short_name':short,
                                  'photo_url':c.get('photo_url') or ('https://portal-market.com/collection_previews/'+str(short)+'.webp' if short else ''),
                                  'floor_price':str(price), 'price_unit':'GRAM'})
                if fresh:
                    collections=fresh
                    updated=int(time.time())
                    with db():
                        db().execute('INSERT INTO cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',
                                     ('portals:public:collections',json.dumps(collections),updated))
            except Exception:
                pass
        if collections:
            return dict(collections=collections,attributes={},source='portals_public',price_unit='GRAM',
                        updated_at=updated,demo=app.config['DEMO_MODE'])
        # An independent market source is displayed as TON, never relabelled GRAM.
        try:return dict(collections=public_catalog(),attributes={},source='thermos',price_unit='TON',demo=app.config['DEMO_MODE'])
        except Exception:pass
        collections,updated=cached('collections',[]);attributes,_=cached('attributes',{})
        if not collections:collections=[{k:v for k,v in c.items() if k!='models'} for c in catalog_seed['collections']]
        return dict(collections=collections,attributes=attributes,updated_at=updated,
                    demo=app.config['DEMO_MODE'],source='portals' if updated else 'snapshot',
                    snapshot_updated_at=catalog_seed.get('updated_at'))
    @app.get('/api/market/collection-volumes')
    @auth()
    def market_collection_volumes():
        # Completed local-market sales only; never confuse listed volume with traded volume.
        cutoff=int(time.time())-86400
        volumes={}
        for row in db().execute("SELECT payload FROM history WHERE kind='sale' AND created>=?", (cutoff,)):
            try:
                sale=json.loads(row['payload'])
                if sale.get('scope')!='crafter':
                    continue
                name=str((sale.get('gift') or {}).get('name','')).strip().casefold()
                price=Decimal(str(sale.get('price') or '0'))
                if name and price.is_finite() and price>0:
                    volumes[name]=volumes.get(name,Decimal(0))+price
            except (TypeError, ValueError, InvalidOperation):
                continue
        response=app.json.response({'volumes':{key:format(value.quantize(Decimal('0.01')),'f')
                         for key,value in volumes.items()},'unit':'GRAM'})
        response.headers['Cache-Control']='private,max-age=60'
        return response

    def canonical_name(value):
        text=unicodedata.normalize('NFKC',str(value)).casefold()
        name=re.sub(r"[^\w]",'',text)
        return 'ufcstrike' if name=='ufcmysterybox' else name
    def market_collection_keys(values):
        keys = {canonical_name(value) for value in values if value}
        if keys:
            for item in (cached('thermos:collections', [])[0] + cached('collections', [])[0] + catalog_seed['collections']):
                if canonical_name(str(item.get('id') or '')) in keys:
                    keys.add(canonical_name(item.get('name') or ''))
        return keys

    def catalog_collection(value):
        return next((c for c in public_catalog() if str(value) in (str(c['id']),str(c.get('short_name',''))) or canonical_name(value)==canonical_name(c['name'])),None)
    def collection_attributes(slug):
        key='thermos:attributes:'+slug;data,updated=cached(key)
        if data and time.time()-updated<300:return data
        import thermos
        c=catalog_collection(slug)
        if not c:return dict(models=[],backdrops=[],symbols=[])
        try:
            data=thermos.request('attributes',{'collections':[c['name']]}).get(c['name'],{})
            db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(key,json.dumps(data),int(time.time())));db().commit()
            return data
        except Exception:
            if data:return data
            raise
    def collection_models(slug):
        if not app.config['PORTALS_API_KEY']:
            import thermos
            return [dict(name=m['name'],image=m.get('image_url',''),price=thermos.ton(m.get('stats',{}).get('floor')),price_unit='TON',price_source='thermos') for m in collection_attributes(slug).get('models',[])]
        live,_=cached('models:'+slug)
        models=live or next((c.get('models',[]) for c in catalog_seed['collections'] if c['id']==slug or c['short_name']==slug),[])
        collection=next((c for c in cached('collections',[])[0] + catalog_seed['collections'] if
                         str(c.get('id'))==slug or str(c.get('short_name'))==slug),None)
        name=(collection or {}).get('name','')
        return [{**m,'image':('https://api.changes.tg/model/'+quote(name,safe='')+'/'+
                quote(str(m['name']),safe='')+'.png?size=128') if name and m.get('name') else ''}
                for m in models]
    @app.get('/api/collections/<slug>/overview')
    @auth()
    def collection_overview(slug):
        if canonical_name(slug) in ('pack', 'packs', 'luckypack'):
            # the Pack collection: its "models" are our card packs, shown by their PNG pictures
            packs = db().execute("SELECT id,title,image_url FROM packs WHERE enabled=1 ORDER BY created").fetchall()
            totals, cutoff = [Decimal(0), Decimal(0)], int(time.time()) - 86400
            for row in db().execute("SELECT payload,created FROM history WHERE kind='sale'"):
                try:
                    entry = json.loads(row['payload'])
                    if not (entry.get('gift') or {}).get('pack_item'):
                        continue
                    paid = Decimal(str(entry.get('price')))
                except (InvalidOperation, ValueError, TypeError):
                    continue
                if paid.is_finite() and paid > 0:
                    totals[1] += paid
                    if row['created'] >= cutoff:
                        totals[0] += paid
            models = [{'name': p['title'], 'image': p['image_url']} for p in packs]
            return dict(collection={'id': 'packs', 'short_name': 'packs', 'name': 'Lucky Pack', 'photo_url': models[0]['image'] if models else '',
                                    'floor_price': None, 'price_unit': 'GRAM'},
                        models=models, volume_24h=str(totals[0]), volume_total=str(totals[1]), pack=True)
        try:
            collection = catalog_collection(slug)
        except (OSError, ValueError):
            collection = None
        snapshot = next((item for item in catalog_seed['collections']
                         if str(item['id']) == slug or canonical_name(item['name']) == canonical_name(slug)), None)
        collection = collection or snapshot
        if not collection:
            abort(404, description='Коллекция не найдена')
        name = canonical_name(collection['name'])
        totals = [Decimal(0), Decimal(0)]
        cutoff = int(time.time()) - 86400
        for row in db().execute("SELECT payload,created FROM history WHERE kind='buy'"):
            entry = json.loads(row['payload'])
            gift = entry.get('gift') or entry
            if canonical_name(gift.get('name', '')) != name:
                continue
            try:
                paid = Decimal(str(gift.get('price') if gift.get('origin') == 'local-purchase' and entry.get('scope') != 'crafter' else entry.get('price', gift.get('price'))))
            except InvalidOperation:
                continue
            if paid.is_finite() and paid > 0:
                totals[1] += paid
                if row['created'] >= cutoff:
                    totals[0] += paid
        models = (snapshot or {}).get('models', [])
        attrs, _ = cached('thermos:attributes:' + str(collection['id']), {})
        if attrs.get('models'):
            models = [dict(name=item['name'], image=item.get('image_url', '')) for item in attrs['models'] if item.get('name')]
        if not models:
            try:
                models = collection_models(str(collection['id']))
            except (OSError, ValueError):
                models = []
        return dict(collection={k: v for k, v in collection.items() if k != 'models'},
                    models=models, volume_24h=str(totals[0]), volume_total=str(totals[1]))

    @app.get('/api/collections/<slug>/models')
    @auth()
    def models(slug):return {'models':collection_models(slug)}
    @app.get('/api/collections/<slug>/attributes')
    @auth()
    def attributes(slug):
        if canonical_name(slug) in ('luckypack', 'pack', 'packs'):
            # packs: the models are the packs themselves, the backdrops are the ones of the pack sets
            import packs as pack_module
            rows = db().execute("SELECT title,image_url FROM packs WHERE enabled=1 ORDER BY created").fetchall()
            names = {n for v in pack_module.PACK_BACKDROPS.values() for n in v}
            return {'models': [{'name': r['title'], 'image_url': r['image_url']} for r in rows],
                    'backdrops': [{'name': b[0], 'center_color': b[1], 'edge_color': b[2]} for b in pack_module.BACKDROPS if b[0] in names], 'symbols': []}
        if request.args.get('source') != 'portals':
            return collection_attributes(slug)
        try:
            data = collection_attributes(slug)
        except (ValueError, OSError):
            data = {}
        collection = catalog_collection(slug)
        if not collection or not collection.get('short_name'):
            return data
        import portals_public
        cache_key = 'portals:backdrops:' + collection['short_name']
        rows, updated = cached(cache_key, {})
        if not updated or time.time() - updated > 900:
            try:
                rows = portals_public.backdrops(collection['short_name'])
                with db():
                    db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',
                                 (cache_key, json.dumps(rows), int(time.time())))
            except (ValueError, OSError, TypeError):
                pass
        if not rows:
            return data
        merged = {row['name']: row for row in data.get('backdrops', []) if row.get('name')}
        for name, row in rows.items():
            merged[name] = {**merged.get(name, {}), **row, 'name': name}
        return {**data, 'backdrops': list(merged.values())}

    @app.get('/api/market')
    @auth()
    def market():
        if request.args.get('source') == 'crafter':
            return resale_market()
        collection_ids = list(dict.fromkeys(request.args.get('collection_id', '').split(',')))
        multi_collection = len(collection_ids) > 1
        if multi_collection and (len(collection_ids) > 20 or any(not item or len(item) > 100 for item in collection_ids)):
            abort(400, description='Выберите до 20 коллекций')
        if not app.config['DEMO_MODE']:
            import thermos
            facet_fields={'filter_by_models','filter_by_backdrops','filter_by_symbols'}
            params={k:request.args[k][:1000 if k in facet_fields else 150] for k in ('search','collection_id','filter_by_models','filter_by_backdrops','filter_by_symbols','sort_by','offset','min_price','max_price','price_unit') if request.args.get(k)}
            multi_trait=any(len([value for value in params.get(field,'').split(',') if value])>1 for field in facet_fields)
            try:
                for price_key in ('min_price','max_price'):
                    if price_key in params:
                        val=Decimal(params[price_key])
                        if not val.is_finite() or val<0 or val>1000000000:raise ValueError()
                if 'min_price' in params and 'max_price' in params and Decimal(params['min_price'])>Decimal(params['max_price']):raise ValueError()
            except Exception:abort(400,description='Недопустимый диапазон цены')
            if multi_collection:
                params['collection_id'] = ','.join(sorted(collection_ids))
            key='public:market:'+urlencode(sorted(params.items()))
            previous,updated=cached(key)
            if previous and time.time()-updated<60:return local_market_rows(previous)
            try:
                rows,_=cached('thermos:collections',[])
                # Prefer public Portals listings (no partner quota), then an independent
                # TON-denominated market source if public listings fail.
                if app.extensions['crafter_market_backend']()=='thermos':
                    params['markets']='PORTALS,TONNEL,MRKT'
                if multi_collection or multi_trait or app.extensions['crafter_market_backend']()=='thermos':
                    result=thermos.gifts(params,rows or public_catalog())
                else:
                    try:
                        import portals_public
                        result=portals_public.listings(params,rows or public_catalog())
                    except Exception:
                        result=thermos.gifts(params,rows or public_catalog())
                result['next_offset']=max(0,int(params.get('offset',0)))+20
                result['has_more']=len(result['gifts'])>=20
                db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(key,json.dumps(result),int(time.time())));db().commit()
                return local_market_rows(result)
            except Exception:
                if previous:return local_market_rows({**previous,'warning':'Показаны сохранённые предложения. Цены могут измениться.'})
                abort(502,description='Каталог временно недоступен. Повторите загрузку.')
        if not app.config['PORTALS_API_KEY'] and app.config['DEMO_MODE']:return {'gifts':DEMO_GIFTS,'demo':True,'source':'demo'}
        allowed={'search','collection_id','filter_by_models','filter_by_backdrops','filter_by_symbols','sort_by','offset'}
        params={k:request.args[k][:150] for k in allowed if request.args.get(k)};params.update(limit=40,status='listed')
        cache_key='market:'+urlencode(sorted(params.items()))
        previous,updated=cached(cache_key)
        if previous and int(time.time())-updated<60:return hide_claimed_market_gifts({**previous,'updated_at':updated})
        try:
            data=portal('nfts/search',params)
            result={'gifts':[normalized(n) for n in data.get('results',[])],'demo':False,'source':'portals','total':data.get('total_count',0),'next_offset':max(0,int(params.get('offset',0)))+40,'has_more':len(data.get('results',[]))>=40}
            db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(cache_key,json.dumps(result),int(time.time())));db().commit()
            return hide_claimed_market_gifts(result)
        except Exception as error:
            from werkzeug.exceptions import HTTPException
            if not isinstance(error,HTTPException):raise
            if previous:return hide_claimed_market_gifts({**previous,'stale':True,'updated_at':updated,'warning':'Portal недоступен — показаны сохранённые цены'})
            rows=[]
            for c in catalog_seed['collections']:
                if params.get('collection_id') and c['id']!=params['collection_id']:continue
                for m in c['models']:
                    if params.get('filter_by_models') and m['name']!=params['filter_by_models']:continue
                    if params.get('search') and params['search'].lower() not in (c['name']+' '+m['name']).lower():continue
                    rows.append(dict(id=c['id']+':'+m['name'],collection_id=c['id'],name=c['name'],model=m['name'],backdrop='',price=m['price'],image=m['image'],number='',catalog_only=True))
            if params.get('sort_by')=='price asc':rows.sort(key=lambda x:Decimal(x['price']))
            offset=max(0,int(params.get('offset',0)))
            return {'gifts':rows[offset:offset+40],'total':len(rows),'next_offset':offset+40,'has_more':offset+40<len(rows),'demo':False,'source':'snapshot','warning':'Сохранённый каталог · оценочные цены TON. Обновление Portal пока недоступно.'}


    @app.get('/api/market/activity')
    @auth()
    def market_activity():
        collections = market_collection_keys(request.args.get('collections', '')[:2000].split(','))
        kinds = set(request.args.get('types', '').split(',')) - {''}
        query = request.args.get('search', '').strip().casefold()[:100]
        offset = request.args.get('offset', 0, type=int)
        offset = max(0, offset)
        traits = {key: request.args.get(key, '')[:150] for key in ('model', 'backdrop', 'symbol')}
        model_names = set()
        items = []
        total = 0
        turnover = Decimal(0)
        purchases = 0
        active_lots = resale_activity_lots()
        for row in db().execute("SELECT kind,payload,created,user_id FROM history WHERE kind IN ('buy','sell','listing_price','craft') ORDER BY created DESC,rowid DESC"):
            entry = json.loads(row['payload'])
            kind = row['kind']
            if kind == 'craft':
                if not entry.get('success') or not (entry.get('listing_id') or entry.get('gift', {}).get('source_id')):
                    continue
                kind = 'lucky_craft' if entry.get('mode') == 'lucky' else 'craft'
            gifts = entry.get('gifts', []) if kind in ('sell','listing_price') else [entry.get('gift') or entry]
            for gift in gifts:
                if collections and not collections.intersection(map(canonical_name, (gift.get('collection_id', ''), gift.get('name', '')))):
                    continue
                if query and query not in ' '.join(str(gift.get(k, '')) for k in ('name','model','number')).casefold():
                    continue
                if any(traits[key] and traits[key] != gift.get(key) for key in ('backdrop', 'symbol')):
                    continue
                if gift.get('model'):
                    model_names.add(gift['model'])
                if (traits['model'] and traits['model'] != gift.get('model')) or (kinds and kind not in kinds):
                    continue
                price = None
                if kind == 'buy':
                    try:
                        paid = Decimal(str(gift.get('price') if gift.get('origin') == 'local-purchase' and entry.get('scope') != 'crafter' else entry.get('price', gift.get('price'))))
                    except InvalidOperation:
                        continue
                    if not paid.is_finite() or paid <= 0:
                        continue
                    turnover += paid
                    purchases += 1
                    price = str(paid)
                elif kind in ('sell','listing_price'):
                    price = gift.get('price')
                if offset <= total < offset + 35:
                    public_gift = {key: gift[key] for key in (
                        'name','number','model','image','background','backdrop','symbol','origin','source_number',
                        'collection_id','floor_price','price_unit','rarity','telegram_url'
                    ) if key in gift}
                    item = dict(kind=kind, gift=public_gift, created=row['created'], price=price)
                    if kind in ('sell','listing_price'):
                        live = active_lots.get((row['user_id'], gift.get('id')))
                        if live and (gift.get('listing_id') == live[0] or
                                     (not gift.get('listing_id') and row['created'] >= live[1])):
                            item['listing_id'] = live[0]
                    items.append(item)
                total += 1
        return dict(items=items, has_more=total > offset + 35,
                    total=total, purchases=purchases, turnover=str(turnover), models=sorted(model_names))

    @app.get('/api/inventory')
    @auth()
    def inventory():
        # A partner token belongs to the operator, NOT to all Mini App users.
        gifts = [gift for gift in owned() if gift['status'] not in ('staked', 'arena')]
        symbols_by_collection = {}
        for gift in gifts:
            if gift.get('symbol') or gift.get('source_id') or gift.get('origin') not in ('admin-grant', 'application-craft'):
                continue
            collection_id = gift.get('collection_id', '')
            if collection_id not in symbols_by_collection:
                attrs, _ = cached('thermos:attributes:' + str(collection_id), {})
                symbols_by_collection[collection_id] = [
                    item['name'] for item in attrs.get('symbols', []) if item.get('name')
                ]
            symbols = symbols_by_collection[collection_id]
            if symbols:
                index = int(hashlib.sha256(gift['id'].encode()).hexdigest(), 16) % len(symbols)
                gift['symbol'] = symbols[index]
        floor = app.extensions.get('crafter_pack_floor', lambda: None)()
        for gift in gifts:
            if gift.get('pack_item') and floor is not None:
                gift['crafter_floor_gram'] = str(floor)          # the cheapest pack lot on the Craft Market
        return {'gifts': gifts, 'demo': app.config['DEMO_MODE']}
    @app.get('/api/craft/targets')
    @auth()
    def craft_targets():
        return {'collections':public_catalog(),'scope':'application'}
    def make_quote(data):
        ids=data.get('gift_ids',[])
        if (not isinstance(ids, list) or not 1 <= len(ids) <= CRAFT_GIFT_LIMIT
                or any(not isinstance(item, str) for item in ids) or len(set(ids)) != len(ids)):
            abort(400, description='Выберите от 1 до 4 подарков')
        gifts={x['id']:x for x in owned() if x['status']=='unlisted'}
        if any(x not in gifts for x in ids):abort(409,description='Подарок недоступен')
        chosen=[gifts[x] for x in ids]
        preview=[bool(x.get('test_only')) for x in chosen]
        if any(preview):
            if not all(preview):
                abort(409,description='В одном крафте нельзя смешивать демо и настоящие подарки')
            if purchase_mode() != 'test':
                abort(409,description='Демонстрационный крафт отключён')
            if any(x.get('origin') not in ('market-test','demo-craft') for x in chosen):
                abort(409,description='Этот тестовый подарок не подходит для крафта')
            # Isolated preview mode: no live listing is required or claimed.
            catalog=public_catalog()
            target=next((c for c in catalog if str(c['id'])==str(data.get('target_id'))),None)
            if not target:
                abort(400,description='Выберите коллекцию результата')
            ratio=app.extensions['crafter_new_year_trade_conversion']()
            try:
                target_ton=Decimal(str(target.get('floor_price') or 0))
                if not target_ton.is_finite() or target_ton<=0:
                    abort(409,description='Нет цены выбранной коллекции для демо-крафта')
                source_floors={canonical_name(c['name']):Decimal(str(c.get('floor_price') or 0))
                               for c in catalog if c.get('name')}
                total_ton=Decimal(0)
                for item in chosen:
                    amount=Decimal(str(item.get('source_price') or 0))
                    unit=item.get('source_price_unit') or 'GRAM'
                    if amount<=0:
                        amount=source_floors.get(canonical_name(item.get('name','')),Decimal(0))
                        unit='TON'
                    if not amount.is_finite() or amount<=0 or unit not in ('TON','GRAM'):
                        abort(409,description='Нет оценки тестового подарка для крафта')
                    total_ton+=amount if unit=='TON' else amount/ratio
            except (ValueError,TypeError,InvalidOperation):
                abort(409,description='Невозможно рассчитать стоимость демо-крафта')
            return dict(gift_ids=ids,target_id=str(target['id']),target={
                            'id':target['id'],'name':target['name'],
                            'photo_url':target.get('photo_url') or ''},
                        listing_id='preview:'+str(target['id']),
                        listing_source='preview',listing_price=str(target_ton),
                        target_value=str(target_ton),input_value=str(total_ton),
                        price_unit='TON',mode='preview',scope='application',
                        chance_bps=min(9500,int(total_ton/target_ton*Decimal(9500))))
        if any(x.get('origin') not in ('admin-grant','application-craft','local-purchase','star-gift') for x in chosen):abort(409,description='Доступны подарки внутреннего инвентаря Crafter')
        listing_id = data.get('listing_id')
        if isinstance(listing_id, str) and listing_id.startswith('crafter-'):
            lot = available_crafter_lot(listing_id, g.user['id'])
            gift = json.loads(lot['payload'])
            if purchase_mode() == 'work' and gift.get('origin') not in app.extensions['crafter_real_origins']:
                abort(409, description='Этого подарка нет на релейере — выберите другой')
            target_id = str(gift.get('collection_id') or canonical_name(gift.get('name') or ''))
            if str(data.get('target_id')) != target_id:
                abort(400, description='Выберите коллекцию результата')
            values = [positive_price(item.get('price')) if item.get('price_unit') == 'GRAM' else None for item in chosen]
            if any(value is None for value in values):
                abort(409, description='Для этого крафта нужны подарки с оценкой в GRAM')
            value = sum(values)
            cost = Decimal(lot['price'])
            return dict(gift_ids=ids, target_id=target_id, listing_id=listing_id,
                        listing_price=str(cost), target_value=str(cost), input_value=str(value),
                        mode='lucky', listing_source='crafter', price_unit='GRAM',
                        chance_bps=min(9500, int(value / cost * Decimal(9500))), scope='application')
        catalog=public_catalog();target=next((c for c in catalog if c['id']==data.get('target_id')),None)
        if not target:abort(400,description='Выберите коллекцию результата')
        floors={canonical_name(c['name']):Decimal(c['floor_price']) for c in catalog}
        if any(canonical_name(x['name']) not in floors and not x.get('star_gift') for x in chosen):abort(409,description='Не удалось оценить коллекцию')
        def craft_value(x):
            if x.get('star_gift'):                      # ordinary Telegram gift: its GRAM value, in the catalogue's unit
                gram=Decimal(str(x.get('price') or 0))
                return gram/Decimal(str(app.extensions['crafter_new_year_trade_conversion']())) if target.get('price_unit')=='TON' else gram
            return floors[canonical_name(x['name'])]
        value=sum(craft_value(x) for x in chosen);cost=Decimal(target['floor_price'])
        if value<=0 or cost<=0:abort(409,description='Нет актуальной оценки подарков')
        listing_id = data.get('listing_id')
        mode = 'lucky' if listing_id is not None else 'collection'
        if mode == 'lucky':
            if not isinstance(listing_id, str) or not 1 <= len(listing_id) <= 150:
                abort(400, description='Некорректный лот')
            listing = lucky_listing(target, listing_id)
            cost = Decimal(str(listing['price']))
        else:
            row = db().execute("SELECT payload FROM settings WHERE key='selection'").fetchone()
            permitted = json.loads(row[0]).get(target['id']) if row else None
            listing = collection_craft_listing(target, catalog, permitted)
        if not listing.get('resale') and listing.get('price_unit', 'GRAM') == 'GRAM':
            app.extensions['crafter_portals_can_buy'](listing, Decimal(str(listing['price'])))   # work mode only
        return dict(gift_ids=ids, target_id=target['id'], target=target, listing_id=listing['id'],
                    listing_key=market_collectible_key(listing), listing_price=str(listing['price']),
                    target_value=str(cost), input_value=str(value), mode=mode,
                    chance_bps=min(9500, int(value / cost * Decimal(9500))), scope='application')

    def collection_craft_listing(target, catalog, permitted):
        def available_listing():
            candidates = {}
            for gift, _ in craft_market_candidates(target):
                if gift.get('model') and gift.get('image') and (permitted is None or gift['model'] in permitted):
                    candidates.setdefault(market_collectible_key(gift), gift)
            return secrets.choice(list(candidates.values())) if candidates else None

        listing = available_listing()
        if listing:
            return listing
        if permitted == []:
            abort(409, description='Администратор не выбрал модели результата')
        import portals_public
        import thermos
        params = {'collection_id': target['id'], 'sort_by': 'price asc'}
        if permitted:
            params['filter_by_models'] = permitted[0]
        try:
            try:
                offers = portals_public.listings(params, catalog)
            except (OSError, ValueError, StopIteration, KeyError):
                offers = thermos.gifts(params, catalog)
            key = 'public:market:craft:' + str(target['id'])
            with db():
                db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',
                             (key, json.dumps(offers), int(time.time())))
        except (OSError, ValueError, KeyError):
            abort(503, description='Не удалось обновить лоты для крафта. Попробуйте ещё раз.')
        listing = available_listing()
        if listing is None:
            abort(409, description='В маркете пока нет доступного лота этой коллекции с изображением')
        return listing

    def reward_attributes(collection_id):
        attrs = collection_attributes(collection_id)
        backdrops = {item['name']: item for item in attrs.get('backdrops', []) if item.get('name')}
        for name, center, edge in [('Onyx Black', 0x505658, 0x24282A), ('Black', 0x343434, 0x101010)]:
            backdrops.setdefault(name, dict(name=name, center_color=center, edge_color=edge))
        symbols = [item['name'] for item in attrs.get('symbols', []) if item.get('name')]
        return secrets.choice(list(backdrops.values())), secrets.choice(symbols) if symbols else ''

    @app.post('/api/craft/quote')
    @auth()
    def craft_quote():
        q=make_quote(request.get_json() or {});qid=uuid.uuid4().hex
        db().execute('INSERT INTO craft_quotes VALUES(?,?,?,?)',(qid,g.user['id'],json.dumps(q),int(time.time())));db().commit()
        return dict(quote_id=qid,chance=q['chance_bps']/100,input_value=q['input_value'],target_value=q['target_value'],price_unit=q.get('price_unit','TON'),mode=q.get('mode','collection'),expires_at=int(time.time())+120,scope='application')

    def craft_market_candidates(target):
        sold = {row[0] for row in db().execute('SELECT source_id FROM local_sold')}
        reserved = {row[0] for row in db().execute(
            'SELECT number FROM local_numbers WHERE collection_id=?', (target['id'],))}
        pages = db().execute(
            "SELECT payload FROM cache WHERE (key LIKE 'public:market:%' OR key LIKE 'market:%') "
            "AND updated >= ? ORDER BY updated DESC", (int(time.time()) - 300,))
        collection_name = canonical_name(target['name'])
        for row in pages:
            for gift in json.loads(row['payload']).get('gifts', []):
                source_id = gift.get('id')
                key = market_collectible_key(gift)
                if (not source_id or source_id in sold or not key or key in sold or
                        gift.get('catalog_only') or gift.get('pack_item') or canonical_name(gift.get('name', '')) != collection_name or
                        int(gift['number']) in reserved or gift.get('price_unit', 'GRAM') not in ('GRAM', 'TON')):
                    continue
                try:
                    price = Decimal(str(gift.get('price'))).quantize(Decimal('0.01'))
                except InvalidOperation:
                    continue
                if price.is_finite() and price > 0:
                    yield gift, price

    def lucky_listing(target, listing_id):
        gift = next((gift for gift, _ in craft_market_candidates(target) if gift['id'] == listing_id), None)
        if gift is None:
            abort(409, description='Лот Lucky Craft недоступен. Обновите маркет и выберите подарок.')
        return gift

    def award_market_gift(target, gift, price):
        source_id = gift['id']
        number = int(gift['number'])
        db().execute('INSERT INTO local_numbers VALUES (?, ?)', (target['id'], number))
        db().executemany('INSERT INTO local_sold VALUES (?)', [(source_id,), (market_collectible_key(gift),)])
        return {**gift, 'id': 'craft-' + uuid.uuid4().hex, 'collection_id': target['id'],
                'source_id': source_id, 'source_number': number, 'number': number,
                'source_price': gift['price'], 'source_price_unit': gift.get('price_unit', 'GRAM'),
                'price': str(price), 'price_unit': 'GRAM', 'origin': 'application-craft', 'crafted': True}

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
            q = json.loads(row['payload'])
            ids = q['gift_ids']
            if not 1 <= len(ids) <= CRAFT_GIFT_LIMIT:
                abort(400, description='Выберите от 1 до 4 подарков')
            eligible = {gift['id'] for gift in owned() if gift['status'] == 'unlisted'}
            if any(x not in eligible for x in ids):abort(409,description='Подарок уже использован или выставлен на продажу')
            if not q.get('listing_id'):
                abort(409, description='Расчёт устарел. Выберите цель крафта заново.')
            expected_price = Decimal(q.get('listing_price', q['target_value']))
            internal = q.get('listing_source') == 'crafter'
            preview=q.get('listing_source')=='preview'
            if preview:
                if purchase_mode() != 'test':
                    abort(409,description='Демо-крафт отключён')
                rows=db().execute("SELECT nft_id,payload,status FROM inventory WHERE user_id=?",
                                  (g.user['id'],)).fetchall()
                by_id={row['nft_id']:(json.loads(row['payload']),row['status']) for row in rows}
                if any(item not in by_id or by_id[item][1]!='unlisted' or
                       not by_id[item][0].get('test_only') or
                       by_id[item][0].get('origin') not in ('market-test','demo-craft')
                       for item in ids):
                    abort(409,description='Материалы демо-крафта изменились')
                listing=None
                matches=True
            elif internal:
                listing = available_crafter_lot(q['listing_id'], g.user['id'])
                matches = Decimal(listing['price']) == expected_price
            else:
                listing = lucky_listing(q['target'], q['listing_id'])
                matches = (market_collectible_key(listing) == q['listing_key'] and
                           Decimal(str(listing['price'])) == expected_price)
            if not matches:
                abort(409, description='Лот изменился. Обновите расчёт крафта.')
            success = secrets.randbelow(10000) < q['chance_bps']
            reward = internal_sale = None
            if success and preview:
                target=q['target']
                reward=dict(id='demo-craft-'+uuid.uuid4().hex,
                            name=target['name'],collection_id=target['id'],
                            number=gift_number(str(target['id'])),
                            image=target.get('photo_url') or '',
                            model='Demo craft',symbol='',backdrop='',
                            price='0',price_unit='GRAM',source_price=str(expected_price),
                            source_price_unit='TON',origin='demo-craft',
                            test_only=True,catalog_only=True,crafted=True)
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)',
                             (g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
            elif success and internal:
                internal_sale = settle_crafter_lot(listing, g.user['id'], 'lucky')
                reward = internal_sale['gift']
            elif success:
                reward = award_market_gift(q['target'], listing, expected_price.quantize(Decimal('0.01')))
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
            burned={x['id']:x for x in owned()}
            for nft in ids:
                db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?',(g.user['id'],nft))
                if nft in burned:                      # burned: the real gift stays on the relayer and goes on sale
                    app.extensions['crafter_house_relist'](burned[nft],g.user['id'],'craft',positive_price(burned[nft].get('price')) if burned[nft].get('price_unit','GRAM')=='GRAM' else None)
            result=dict(success=success,chance=q['chance_bps']/100,gift=reward,consumed=ids,scope='application',mode=q.get('mode','lucky'))
            if preview:
                result.update(test_mode=True,input_value=q['input_value'],price_unit='TON')
            if internal:
                result.update(listing_id=q['listing_id'], prize_value=str(expected_price))
            earned_balls=record('craft',result)
            if preview:
                result['balls_earned']=int(earned_balls or 0)
            db().execute('INSERT INTO craft_requests VALUES(?,?,?)',(g.user['id'],request_id,json.dumps(result)))
            db().execute('DELETE FROM craft_quotes WHERE id=?',(qid,))
        if internal_sale:
            notify_crafter_sale(listing['seller_id'], internal_sale)
        return result
    def owned():
        rows = db().execute('''SELECT i.payload,i.status,l.price AS listing_price
            FROM inventory i LEFT JOIN crafter_listings l ON l.seller_id=i.user_id AND l.gift_id=i.nft_id
            WHERE i.user_id=?''', (g.user['id'],))
        return [{**json.loads(row['payload']), 'status': row['status'],
                 'listing_price': row['listing_price']} for row in rows]
    def record(kind,payload,*,uid=None):
        owner = g.user['id'] if uid is None else uid
        # Snapshot the on-platform GRAM balance at the moment of the ledger event.
        # Older events cannot be reconstructed reliably from today's balance.
        snapshot = dict(payload)
        account = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (owner,)).fetchone()
        if account:
            snapshot['balance_after'] = str(account['balance'])
        history_id=uuid.uuid4().hex
        db().execute('INSERT INTO history VALUES(?,?,?,?,?)',
                     (history_id,owner,kind,json.dumps(snapshot),int(time.time())))
        accrue_referral(owner,history_id,kind,snapshot)
        earned_balls=0
        if (callback := app.extensions.get('crafter_new_year_trade_accrue')):
            earned_balls=callback(owner,history_id,kind,snapshot)
        return int(earned_balls or 0)
    @app.get('/api/history')
    @auth()
    def history():
        return {'items':[dict(id=r['id'],kind=r['kind'],created=r['created'],data=json.loads(r['payload'])) for r in db().execute('SELECT * FROM history WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 100',(g.user['id'],))]}
    with app.app_context(), db():
        db().executescript("""CREATE TABLE IF NOT EXISTS gift_transfers
                        (sender_id INTEGER, request_id TEXT, payload TEXT,
                         PRIMARY KEY(sender_id, request_id))""")
        db().execute("CREATE INDEX IF NOT EXISTS users_username_nocase ON users(lower(username))")

    @app.get('/api/inventory/recipient')
    @auth()
    def inventory_recipient():
        username = request.args.get('username', '').strip().lstrip('@')
        if not re.fullmatch(r'[A-Za-z0-9_]{3,32}', username):
            return {'recipient': None}
        row = db().execute(
            'SELECT u.id,u.name,u.username,a.photo_url FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id '
            'WHERE lower(u.username)=lower(?) AND u.id!=? ORDER BY u.id LIMIT 2',
            (username, g.user['id']),
        ).fetchall()
        return {'recipient': dict(row[0]) if len(row) == 1 else None}

    @app.post('/api/inventory/transfer')
    @auth()
    def inventory_transfer():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        ids, recipient_id, request_id = (data.get(key) for key in ('gift_ids', 'recipient_id', 'request_id'))
        anonymous = data.get('anonymous', False)
        message = data.get('message', '')
        if not isinstance(message, str) or len(message) > 300 or '\x00' in message:
            abort(400, description='Сообщение должно содержать до 300 символов')
        message = message.strip()
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 100 or
                any(not isinstance(item, str) or not 1 <= len(item) <= 200 for item in ids) or
                len(set(ids)) != len(ids) or type(recipient_id) is not int or
                not 0 < recipient_id < 2**63 or recipient_id == g.user['id'] or
                not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', request_id) or
                type(anonymous) is not bool):
            abort(400, description='Проверьте подарки и получателя')
        sender_id = g.user['id']
        order = dict(ids=sorted(ids), recipient_id=recipient_id, anonymous=anonymous)
        if message:
            order['message'] = message
        with db():
            db().execute('BEGIN IMMEDIATE')
            existing = db().execute('SELECT payload FROM gift_transfers WHERE sender_id=? AND request_id=?',
                                    (sender_id, request_id)).fetchone()
            if existing:
                if json.loads(existing[0]) != order:
                    abort(409, description='Этот запрос уже использован')
                return {'ok': True, 'gift_ids': ids}
            recipient = db().execute('SELECT name,username FROM users WHERE id=? AND username IS NOT NULL AND username!=?',
                                     (recipient_id, '')).fetchone()
            if not recipient or recipient['username'].casefold() != str(data.get('username', '')).casefold():
                abort(409, description='Проверьте имя получателя и выберите его снова')
            inventory = {gift['id']: gift for gift in owned()}
            if any(gift_id not in inventory or inventory[gift_id]['status'] != 'unlisted' for gift_id in ids):
                abort(409, description='Один из подарков недоступен для отправки')
            gifts = [inventory[gift_id] for gift_id in ids]
            if any(gift.get('test_only') or gift.get('catalog_only') or gift.get('pack_item') for gift in gifts):
                abort(409,description='Тестовые подарки нельзя отправлять')
            conflict = db().execute(
                'SELECT 1 FROM inventory WHERE user_id=? AND nft_id IN (' + ','.join('?' for _ in ids) + ') LIMIT 1',
                [recipient_id, *ids],
            ).fetchone()
            if conflict:
                abort(409, description='Один из подарков уже есть у получателя')
            db().executemany('UPDATE inventory SET user_id=? WHERE user_id=? AND nft_id=?',
                             [(recipient_id, sender_id, gift_id) for gift_id in ids])
            record('transfer', {'gifts': gifts, 'recipient': dict(recipient), 'message': message})
            sender = None if anonymous else {'name': g.user.get('first_name', ''), 'username': g.user.get('username', '')}
            record('gift_received', {'gifts': gifts, 'sender': sender, 'message': message}, uid=recipient_id)
            db().execute('INSERT INTO gift_transfers VALUES (?,?,?)', (sender_id, request_id, json.dumps(order)))
        try:
            notify_gift_transfer(bot_settings(), recipient_id, gifts, sender, request.url_root, app.config['BOT_TOKEN'], message)
        except Exception:
            app.logger.warning('Telegram gift notification was not delivered')
        try:
            from telegram_bot import notify_gift_sent
            notify_gift_sent(bot_settings(), sender_id, gifts, dict(recipient), app.config['BOT_TOKEN'])
        except Exception:
            app.logger.warning('Telegram sender receipt was not delivered')
        return {'ok': True, 'gift_ids': ids}

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
            if any(gifts[x].get('test_only') for x in ids):abort(409,description='Тестовые подарки нельзя выводить или продавать')
            for nft in ids:
                gift=gifts[nft]
                if action=='sell':
                    if gift['status'] != 'unlisted':abort(409,description='Подарок нельзя продавать во время стейкинга')
                    try:price=Decimal(str(data.get('price','0')))
                    except Exception:abort(400,description='Некорректная цена')
                    if not price.is_finite() or price<=0 or price>1000000:abort(400,description='Некорректная цена')
                    gift['price']=str(price);db().execute("UPDATE inventory SET status='listed',payload=? WHERE user_id=? AND nft_id=?",(json.dumps(gift),g.user['id'],nft))
                elif action=='unlist':
                    if gift['listing_price'] is not None:
                        abort(409, description='Снимите лот через продажу Crafter')
                    if gift['status'] != 'listed':abort(409,description='Подарок не выставлен на продажу')
                    db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=?",(g.user['id'],nft))
                else:
                    if gift['status']!='unlisted':abort(409,description='Сначала снимите подарок с продажи')
                    if action=='transfer' and not str(data.get('recipient','')).strip():abort(400,description='Укажите получателя')
                    db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=?',(g.user['id'],nft))
            record(action,{'gifts':[gifts[x] for x in ids],'recipient':data.get('recipient'),'demo':True})
        return {'ok':True,'demo':True}
    @app.post('/api/local/buy')
    @auth()
    def local_buy():
        if not app.config['DEMO_MODE'] and not app.config.get('TESTING'):
            abort(409,description='Локальные имитации покупок отключены. Используйте Portals Partner API')
        data=request.get_json() or {};source_id=data.get('id');rid=data.get('request_id')
        if not isinstance(source_id,str) or not isinstance(rid,str) or not 1<=len(rid)<=100:abort(400)
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior=db().execute('SELECT result FROM local_purchases WHERE user_id=? AND request_id=?',(g.user['id'],rid)).fetchone()
            if prior:return json.loads(prior[0])
            if db().execute('SELECT 1 FROM local_sold WHERE source_id=?',(source_id,)).fetchone():abort(409,description='Этот подарок уже куплен локально')
            gift=None
            for row in db().execute("SELECT payload FROM cache WHERE key LIKE 'public:market:%' AND updated>=? ORDER BY updated DESC",(int(time.time())-6*3600,)):
                gift=next((item for item in json.loads(row[0]).get('gifts',[]) if item['id']==source_id),None)
                if gift:break
            if not gift:abort(409,description='Предложение устарело. Обновите маркет.')
            if db().execute('SELECT 1 FROM local_sold WHERE source_id=?',(market_collectible_key(gift),)).fetchone():
                abort(409, description='Этот подарок уже недоступен на маркете')
            source_unit=gift.get('price_unit','GRAM')
            if source_unit not in ('GRAM','TON'):abort(409,description='Неизвестная валюта предложения')
            price=Decimal(gift['price']).quantize(Decimal('0.01'))
            if not price.is_finite() or price<=0:abort(409,description='Нет цены подарка')
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
            if data.get('expected_price') is not None:
                try:expected=Decimal(str(data['expected_price'])).quantize(Decimal('0.01'))
                except Exception:abort(400)
                if expected!=price:abort(409,description='Цена подарка изменилась. Обновите маркет.')
            if price>balance:abort(409,description='Недостаточно GRAM на локальном балансе')
            collectible_key = market_collectible_key(gift)
            gift={**gift,'source_price':gift['price'],'price':str(price),'source_price_unit':source_unit,'price_unit':'GRAM','id':'local-'+uuid.uuid4().hex,'source_id':source_id,'source_number':gift.get('number'),'number':gift_number(gift.get('collection_id') or gift['name'],gift.get('number')),'origin':'local-purchase'}
            cap_funded_balance(db(), g.user['id'], balance - price)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-price),g.user['id']))
            db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],gift['id'],json.dumps(gift),'unlisted'))
            db().execute('INSERT INTO local_sold VALUES(?)',(source_id,))
            if collectible_key:
                db().execute('INSERT INTO local_sold VALUES(?) ON CONFLICT DO NOTHING',(collectible_key,))
            result=dict(ok=True,gift=gift,balance=str(balance-price),scope='application')
            record('buy',dict(gift=gift,price=str(price),scope='application'))
            db().execute('INSERT INTO local_purchases VALUES(?,?,?)',(g.user['id'],rid,json.dumps(result)))
        return result
    @app.post('/api/local/cart/buy')
    @auth()
    def buy_cart():
        if not app.config['DEMO_MODE'] and not app.config.get('TESTING'):
            abort(409,description='Локальные имитации покупок отключены. Используйте Portals Partner API')
        data=request.get_json() or {};ids=data.get('gift_ids');rid=data.get('request_id')
        if not isinstance(ids,list) or not 1<=len(ids)<=100 or any(not isinstance(x,str) for x in ids) or len(ids)!=len(set(ids)):abort(400,description='Выберите подарки в корзине')
        if not isinstance(rid,str) or not 1<=len(rid)<=80:abort(400)
        rid='cart:'+rid
        with db():
            db().execute('BEGIN IMMEDIATE')
            prior=db().execute('SELECT result FROM local_purchases WHERE user_id=? AND request_id=?',(g.user['id'],rid)).fetchone()
            if prior:return json.loads(prior[0])
            sold={r[0] for r in db().execute('SELECT source_id FROM local_sold')}
            if any(gid in sold for gid in ids):abort(409,description='Один из подарков уже куплен. Обновите корзину.')
            found={}
            for row in db().execute("SELECT payload FROM cache WHERE key LIKE 'public:market:%' AND updated>=? ORDER BY updated DESC",(int(time.time())-6*3600,)):
                for gift in json.loads(row[0]).get('gifts',[]):
                    if gift['id'] in ids and gift['id'] not in found:found[gift['id']]=gift
                if len(found)==len(ids):break
            if len(found)!=len(ids):abort(409,description='Цены в корзине устарели. Обновите маркет.')
            keys = [key for gift in found.values() if (key := market_collectible_key(gift))]
            if len(keys) != len(set(keys)) or any(key in sold for key in keys):
                abort(409, description='Один из подарков уже недоступен на маркете')
            total=Decimal(0)
            for gift in found.values():
                price=Decimal(gift['price']).quantize(Decimal('0.01'))
                if not price.is_finite() or price<=0 or gift.get('price_unit') not in ('GRAM','TON'):abort(409,description='Нет цены подарка')
                total+=price
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
            if data.get('expected_total') is not None:
                try:expected=Decimal(str(data['expected_total'])).quantize(Decimal('0.01'))
                except Exception:abort(400)
                if expected!=total:abort(409,description='Цены в корзине изменились. Обновите маркет.')
            if total>balance:abort(409,description='Недостаточно GRAM на балансе')
            rewards=[]
            for source_id in ids:
                gift=found[source_id]
                reward={**gift,'source_price':gift['price'],'price':str(Decimal(gift['price']).quantize(Decimal('0.01'))),'id':'local-'+uuid.uuid4().hex,'source_id':source_id,'source_number':gift.get('number'),'source_price_unit':gift.get('price_unit'),'price_unit':'GRAM','number':gift_number(gift.get('collection_id') or gift['name'],gift.get('number')),'origin':'local-purchase'}
                db().execute('INSERT INTO inventory VALUES(?,?,?,?)',(g.user['id'],reward['id'],json.dumps(reward),'unlisted'))
                db().execute('INSERT INTO local_sold VALUES(?)',(source_id,))
                record('buy',dict(gift=reward,price=reward['price'],scope='application'))
                rewards.append(reward)
            cap_funded_balance(db(), g.user['id'], balance - total)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-total),g.user['id']))
            db().executemany('INSERT INTO local_sold VALUES(?) ON CONFLICT DO NOTHING', [(key,) for key in keys])
            result=dict(ok=True,gifts=rewards,balance=str(balance-total),total=str(total),scope='application')
            db().execute('INSERT INTO local_purchases VALUES(?,?,?)',(g.user['id'],rid,json.dumps(result)))
        return result
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
            cap_funded_balance(db(), g.user['id'], balance - Decimal(nft['price']))
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-Decimal(nft['price'])),g.user['id']))
            record('buy',reward)
        return {'ok':True,'gift':reward,'demo':True}
    @app.get('/api/admin/status')
    @auth(admin=True)
    def status():
        c,t=cached('collections',[])
        return {'configured':bool(app.config['PORTALS_API_KEY']),'mode':'public','updated_at':t,'collections':len(c),'sync':dict(catalog_job),'auto_refresh':dict(app.extensions.get('crafter_market_refresh',{})),'users':db().execute('SELECT count(*) FROM users').fetchone()[0],'audit':[dict(x) for x in db().execute('SELECT actor,action,created FROM audit ORDER BY id DESC LIMIT 20')]}
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
                    data=portal('collections/preview');rows=(data if isinstance(data,list) else (data.get('collections') or data.get('items') or data.get('results') or []))
                    if not rows:raise ValueError('Источник вернул пустой каталог')
                    rows=[{**c,'short_name':c.get('short_name') or c.get('shortName') or '', 'photo_url':c.get('photo_url') or 'https://portal-market.com/collection_previews/'+str(c.get('short_name') or c.get('shortName') or '')+'.webp'} for c in rows]
                    catalog_job['total']=len(rows)
                    with db():db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',('collections',json.dumps(rows),int(time.time())))
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
                                parsed.append({'name':name,'price':str(price or 0),'image':('https://api.changes.tg/model/'+quote(str(c.get('name') or ''),safe='')+'/'+quote(str(name),safe='')+'.png?size=128') if c.get('name') else '', 'price_source':'portals'})
                            if parsed:
                                with db():db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',('models:'+slug,json.dumps(parsed),int(time.time())))
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
        rows=db().execute('SELECT u.*, COALESCE(a.balance,\'0\') balance,(SELECT count(*) FROM inventory i WHERE i.user_id=u.id) gifts, EXISTS(SELECT 1 FROM user_bans WHERE user_id=u.id) AS banned FROM users u LEFT JOIN demo_accounts a ON a.user_id=u.id WHERE CAST(u.id AS TEXT) LIKE ? OR u.name LIKE ? OR u.username LIKE ? ORDER BY u.created DESC LIMIT 100',(query,query,query)).fetchall()
        return {'users':[dict(r) for r in rows]}
    @app.post('/api/admin/users/<int:uid>/balance')
    @auth(admin=True)
    def user_balance(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():abort(404)
        try:amount=Decimal(str((request.get_json() or {}).get('balance')))
        except Exception:abort(400,description='Укажите баланс числом')
        if not amount.is_finite() or amount<0 or amount>1000000000:abort(400,description='Недопустимый баланс')
        balance = amount.quantize(Decimal('0.01'))
        with db():
            db().execute('BEGIN IMMEDIATE')
            previous = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
            change = balance - (Decimal(previous['balance']) if previous else Decimal(0))
            db().execute('INSERT INTO demo_accounts VALUES(?,?) ON CONFLICT (user_id) DO UPDATE SET balance=excluded.balance', (uid, str(balance)))
            if change:
                record('balance_adjustment', {'gram': str(change)}, uid=uid)
        audit('Balance edited: '+str(uid))
        return {'ok':True}
    @app.post('/api/admin/users/<int:uid>/gifts')
    @auth(admin=True)
    def user_gift(uid):
        abort(409, description='Модели из каталога больше не выдаются. Выдайте NFT по ссылке (он должен быть на релейере или в Thermos), обычный подарок или пак.')
    @app.get('/api/admin/selection')
    @auth(admin=True)
    def get_selection():
        row=db().execute("SELECT payload FROM settings WHERE key='selection'").fetchone();return {'selection':json.loads(row[0]) if row else {}}
    @app.post('/api/admin/selection')
    @auth(admin=True)
    def set_selection():
        selection=(request.get_json() or {}).get('selection',{})
        if not isinstance(selection,dict) or len(selection)>1000 or any(not isinstance(v,list) or any(not isinstance(x,str) for x in v) for v in selection.values()):abort(400)
        db().execute("INSERT INTO settings VALUES('selection',?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload",(json.dumps(selection),));db().commit();audit('Craft model selection updated');return {'ok':True}
    from telegram_bot import (https_url, install_telegram_bot, notify_gift_sale,
                              notify_gift_transfer, notify_offer_event, notify_gift_purchase)
    bot_settings = install_telegram_bot(app, db, auth, audit)
    from telegram_bot import notify_withdrawal

    def tell_withdrawal(uid, gift, ok, reason='', via=''):
        try:
            notify_withdrawal(bot_settings(), uid, gift, ok, reason, app.config['BOT_TOKEN'], via)
        except Exception:
            app.logger.warning('Withdrawal notification was not delivered')
    app.extensions['crafter_notify_withdrawal'] = tell_withdrawal

    def tell_text(uid, html):
        try:
            from telegram_bot import bot_api
            token = bot_settings().get('token') or app.config['BOT_TOKEN']
            if token:
                bot_api(token, 'sendMessage', {'chat_id': uid, 'parse_mode': 'HTML', 'text': html, 'link_preview_options': {'is_disabled': True}})
        except Exception:
            app.logger.warning('Telegram message was not delivered')
    app.extensions['crafter_notify_text'] = tell_text

    def tell_withdraw_done(uid, gram, url):
        try:
            from telegram_bot import notify_gram_withdraw
            return notify_gram_withdraw(bot_settings(), uid, gram, url, app.config['BOT_TOKEN'])
        except Exception:
            app.logger.warning('Withdrawal receipt was not delivered')
            return False
    app.extensions['crafter_notify_withdraw_done'] = tell_withdraw_done
    from telegram_deposits import install_telegram_deposits
    install_telegram_deposits(app, db, auth, audit, record, bot_settings)
    from wallet import install_wallet
    install_wallet(app,db,auth,record,audit,bot_settings)
    from gift_withdrawals import install_gift_withdrawals
    install_gift_withdrawals(app,db,auth,record,audit)
    def notify_crafter_sale(seller, trade):
        if seller == app.extensions.get('crafter_house_id'):
            return                                  # the house account is not a Telegram user
        try:
            notify_gift_sale(bot_settings(), seller, trade['gift'], trade['proceeds'], app.config['BOT_TOKEN'])
        except Exception:
            app.logger.warning('Telegram gift sale notification was not delivered')

    def notify_crafter_offer(seller, gift, price, event):
        try:
            notify_offer_event(bot_settings(), seller, gift, price, event, app.config['BOT_TOKEN'])
        except Exception:
            app.logger.warning('Telegram offer notification was not delivered')

    def notify_crafter_purchase(buyer, trade):
        try:
            notify_gift_purchase(bot_settings(), buyer, trade['gift'], trade['price'], app.config['BOT_TOKEN'])
        except Exception:
            app.logger.warning('Telegram purchase notification was not delivered')

    from referral_rewards import install_referral_rewards
    referral_snapshot,accrue_referral=install_referral_rewards(app,db,auth,record,audit)
    from new_year import install_new_year
    new_year_enabled=install_new_year(app,db,auth,record,audit)
    from new_year_trade_rewards import install_new_year_trade_rewards
    seasonal_accrue,seasonal_conversion=install_new_year_trade_rewards(app,db,audit)
    app.extensions['crafter_new_year_trade_accrue']=seasonal_accrue
    app.extensions['crafter_new_year_trade_conversion']=seasonal_conversion
    from packs import install_packs
    install_packs(app,db,auth,record,audit)
    from promocodes import install_promocodes
    install_promocodes(app,db,auth,record,audit)
    from advent import install_advent
    from telegram_bot import notify_advent
    install_advent(app,db,auth,record,audit,lambda: (bot_settings().get('token') or app.config['BOT_TOKEN']),
                   notify=lambda uid, day: notify_advent(bot_settings(), uid, day, app.config['BOT_TOKEN'],
                                                         bot_settings().get('app_url') or os.getenv('RENDER_EXTERNAL_URL') or os.getenv('PUBLIC_APP_URL') or ''))
    from shop_items import install_shop_items
    from shop_sections import install_shop_sections
    install_shop_sections(app,db,auth,audit)
    from shop_exchange import install_shop_exchange
    install_shop_exchange(app,db,auth,audit,record)
    from thumbs import install_thumbs
    install_thumbs(app,db)
    from chests import install_chests
    install_chests(app,db,auth,audit,record)
    from chains import install_chains
    install_chains(app,db,auth,audit,record)
    from freebies import install_freebies
    install_freebies(app,db,auth,audit,record)
    install_shop_items(app,db,auth,record,audit)
    from community_events import install_community_events
    install_community_events(app,db,auth,record,audit)
    from market_test import install_market_test
    install_market_test(app,db,auth,record,DEMO_GIFTS)
    from offers import install_offer_display, install_trading_offers
    close_lot_offers, expire_offers, register_offers = install_trading_offers(
        app, db, auth, record, canonical_name, notify_crafter_sale,
        notify_crafter_offer, notify_crafter_purchase)
    app.extensions['crafter_close_lot_offers'] = close_lot_offers
    resale_market, resale_activity_lots, available_crafter_lot, settle_crafter_lot = install_resale(
        app, db, auth, record, canonical_name, market_collection_keys,
        notify_crafter_sale, close_lot_offers, notify_crafter_purchase)

    def offer_collection(value):
        if canonical_name(value) in ('luckypack', 'pack', 'packs'):
            first = db().execute("SELECT image_url FROM packs WHERE enabled=1 ORDER BY created LIMIT 1").fetchone()
            return {'id': 'packs', 'short_name': 'packs', 'name': 'Lucky Pack', 'photo_url': first['image_url'] if first else ''}
        for key in ('thermos:collections', 'collections'):
            for item in cached(key, [])[0]:
                if value == str(item.get('id')) or canonical_name(value) == canonical_name(item.get('name') or ''):
                    return item
        for item in catalog_seed['collections']:
            if value == str(item.get('id')) or canonical_name(value) == canonical_name(item.get('name') or ''):
                return item
        for row in db().execute("SELECT payload FROM inventory WHERE status IN ('listed','unlisted')"):
            gift = json.loads(row['payload'])
            if not gift.get('catalog_only') and (value == str(gift.get('collection_id')) or
                    canonical_name(value) == canonical_name(gift.get('name') or '')):
                return {'name':gift['name'],'photo_url':gift.get('image','')}
        return None

    register_offers(available_crafter_lot, settle_crafter_lot, offer_collection)
    install_offer_display(app, db, auth, canonical_name)
    from banners import install_banners
    install_banners(app, db, auth, audit)
    from events import install_events
    install_events(app, db, auth, audit, record, canonical_name,
                   available_crafter_lot, settle_crafter_lot, notify_crafter_purchase,
                   notify_crafter_sale)
    from event_pages import install_event_pages
    install_event_pages(app, db, auth, audit)
    from announcements import install_announcements
    install_announcements(app, db, auth, audit)
    from arena_banner import install_arena_banner
    install_arena_banner(app, db, auth, audit)
    from site_snow import install_snow
    install_snow(app, db, auth, audit)
    from lottie_media import install_lottie_media
    install_lottie_media(app)
    from staking import install_staking
    def staking_catalog():
        import thermos
        rows, _ = cached('thermos:collections', [])
        portals_rows, _ = cached('collections', [])
        return [*portals_rows, *thermos.unique_collections(rows)]

    demo_stake_prices = (
        {gift['id']: gift['price'] for gift in DEMO_GIFTS} if app.config['DEMO_MODE'] else {}
    )
    install_staking(app, db, auth, record, audit, staking_catalog, canonical_name, demo_stake_prices)

    from arena import install_arena
    install_arena(app, db, auth, record, staking_catalog, canonical_name, demo_stake_prices)
    from admin_user_tools import install_admin_user_tools
    install_admin_user_tools(app, db, auth, audit, record)
    from admin_console import install_admin_console
    install_admin_console(app, db, auth, audit, verify_telegram, bot_settings, admin_access)
    from admin_roles import install_admin_management
    install_admin_management(app, db, auth, audit, admin_access)
    from launch_readiness import install_launch_readiness
    install_launch_readiness(app, db, auth, audit)
    from portals_partner import install_portals_partner
    install_portals_partner(app, db, auth, record, audit)
    from house_market import install_house_market
    install_house_market(app, db, auth, record, audit)
    from ny_extras import install_ny_extras
    install_ny_extras(app, db, auth, audit)
    from thermos_market import install_thermos_market
    install_thermos_market(app, db, auth, record, audit, dict(public_catalog=public_catalog))
    from star_gifts import install_star_gifts
    install_star_gifts(app, db, auth, record, audit)
    from nft_grant import install_nft_grant
    install_nft_grant(app, db, auth, record, audit)
    from auto_nft import install_auto_nft
    install_auto_nft(app, db, auth, audit)
    from game_type import install_game_type
    install_game_type(app, db, auth, audit)
    from web_login import install_web_login
    install_web_login(app, db, auth, audit, lambda: (bot_settings().get('username') or app.config['BOT_USERNAME']))
    if not app.config.get('TESTING') and os.getenv('CATALOG_REFRESH_ON_START','0')=='1':
        start_catalog_refresh()
    def ensure_upgrade_listings(target, low, high):
        import portals_public
        import thermos
        key = 'public:market:upgrade:%s:%d:%d' % (target['id'], int(low), int(high))
        fresh = db().execute('SELECT 1 FROM cache WHERE key=? AND updated>=?', (key, int(time.time()) - 60)).fetchone()
        if fresh:
            return
        params = {'collection_id': target['id'], 'sort_by': 'price asc',
                  'min_price': str(int(low)), 'max_price': str(int(high) + 1)}
        try:
            try:
                offers = portals_public.listings(params, public_catalog())
            except (OSError, ValueError, StopIteration, KeyError):
                offers = thermos.gifts(params, public_catalog())
        except (OSError, ValueError, KeyError):
            return  # Crafter player lots can still be offered
        with db():
            db().execute('INSERT INTO cache VALUES(?,?,?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',
                         (key, json.dumps(offers), int(time.time())))
    from upgrade import install_upgrade
    install_upgrade(app, db, auth, record, dict(
        owned=owned, positive_price=positive_price, public_catalog=public_catalog,
        canonical_name=canonical_name, market_candidates=craft_market_candidates,
        ensure_listings=ensure_upgrade_listings, award_market_gift=award_market_gift,
        available_crafter_lot=available_crafter_lot, settle_crafter_lot=settle_crafter_lot,
        notify_sale=notify_crafter_sale, test_mode=lambda: purchase_mode() == 'test',
        work_mode=lambda: purchase_mode() == 'work',
        thermos_backend=lambda: app.extensions['crafter_market_backend']() == 'thermos',
        acquire=lambda gifts: app.extensions['crafter_thermos_acquire'](gifts),
        can_buy=lambda gift, price: app.extensions['crafter_portals_can_buy'](gift, price),
        gram_per_ton=lambda: app.extensions['crafter_new_year_trade_conversion']()))
    from partner_api import install_partner_api
    install_partner_api(app,db,auth,record,audit)
    from auctions import install_auctions

    def notify_crafter_auction(event, user_id, gift, amount, auction_id=None):
        if user_id == app.extensions.get('crafter_house_id'):
            return
        try:
            from telegram_bot import notify_auction_event
            origin = bot_settings().get('app_url') or os.getenv('RENDER_EXTERNAL_URL') or os.getenv('PUBLIC_APP_URL') or ''
            link = origin.rstrip('/') + ('/auctions/' + auction_id if auction_id else '/auctions') if origin else ''
            notify_auction_event(bot_settings(), user_id, event, gift, amount, app.config['BOT_TOKEN'], link)
        except Exception:
            app.logger.warning('Telegram auction notification was not delivered')
    install_auctions(app, db, auth, record, notify_crafter_sale, notify_crafter_purchase, notify_crafter_auction)
    from avatars import install_avatars
    install_avatars(app, db)
    from creators import install_creators
    install_creators(app, auth)
    from creator_apps import install_creator_apps
    from telegram_bot import notify_creator

    def creator_notice(user_id, text, number):
        origin = bot_settings().get('app_url') or os.getenv('RENDER_EXTERNAL_URL') or os.getenv('PUBLIC_APP_URL') or request.url_root
        return notify_creator(bot_settings(), user_id, text, number, origin, app.config['BOT_TOKEN'])
    install_creator_apps(app,db,auth,record,audit,creator_notice)
    app.extensions['crafter_pack_ctx'] = dict(
        public_catalog=public_catalog, canonical_name=canonical_name, market_candidates=craft_market_candidates,
        ensure_listings=ensure_upgrade_listings, test_mode=lambda: purchase_mode() == 'test',
        work_mode=lambda: purchase_mode() == 'work',
        thermos_backend=lambda: app.extensions['crafter_market_backend']() == 'thermos',
        acquire=lambda gifts: app.extensions['crafter_thermos_acquire'](gifts),
        gram_per_ton=lambda: app.extensions['crafter_new_year_trade_conversion']())
    if not app.config.get('TESTING'):
        from market_refresh import refresh_interval, start_market_refresh
        start_market_refresh(start_catalog_refresh, refresh_interval(), app.extensions.setdefault('crafter_market_refresh', {}))
    return app

app=create_app()
if __name__=='__main__':app.run(host='127.0.0.1',port=int(os.getenv('PORT','5000')),debug=False)

