"""Crafter New Year event: administrator-controlled test gift market and balances.

A Telegram NFT URL supplies display metadata, not proof of custody.
New-year purchases intentionally create non-transferable TEST inventory entries.
No on-chain or Portals purchase is performed by these routes.
"""
import json
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
import re
import time
import uuid
from urllib.error import HTTPError, URLError

from portals_public import get as portals_get
from flask import abort, g, request

_NFT = re.compile(r"^https://(?:t\.me|telegram\.me)/nft/([A-Za-z][A-Za-z0-9_-]{2,90}-[1-9][0-9]{0,14})/?$", re.I)
_LIMIT = 10**9



def telegram_nft_metadata(slug):
    """Retrieve exact collectible traits from Telegram's public NFT page.

    Avoid relying on Portals listing availability for ownership-independent
    attributes. The public page is descriptive, never custody proof.
    """
    from html import unescape
    from html.parser import HTMLParser
    from urllib.parse import urlsplit
    from urllib.request import Request, urlopen

    class GiftPageParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.meta={}
            self.current=''
            self.cell=''
            self.cells=[]
            self.rows=[]
            self.in_row=False
        def handle_starttag(self,tag,attrs):
            attr=dict(attrs)
            if tag=='meta':
                key=(attr.get('name') or attr.get('property') or '').lower()
                if key and isinstance(attr.get('content'),str):
                    self.meta[key]=attr['content']
            if tag=='tr':
                self.in_row=True
                self.cells=[]
            elif self.in_row and tag in ('th','td'):
                self.current=tag
                self.cell=''
        def handle_data(self,data):
            if self.current:
                self.cell+=' '+data
        def handle_endtag(self,tag):
            if tag==self.current and tag in ('th','td'):
                self.cells.append((tag,self.cell.strip()))
                self.current=''
            if tag=='tr':
                if self.cells:self.rows.append(self.cells)
                self.in_row=False
    request=Request('https://t.me/nft/'+slug,headers={
        'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; Crafter/1.0)'})
    try:
        with urlopen(request,timeout=6) as response:
            actual=urlsplit(response.geturl())
            if actual.hostname not in ('t.me','telegram.me') or actual.path.lower().rstrip('/')!='/nft/'+slug.lower():
                raise ValueError('Collectible link was redirected')
            html=response.read(1_250_001)
            if len(html)>1_250_000:
                raise ValueError('Telegram page too large')
    except (HTTPError,URLError,TimeoutError,OSError,ValueError):
        abort(503,description='Telegram сейчас не возвращает данные NFT. Попробуйте позже.')
    parser=GiftPageParser()
    parser.feed(html.decode('utf-8','replace'))
    meta=parser.meta
    description=unescape(meta.get('twitter:description') or meta.get('og:description') or '')
    fields={}
    for line in description.splitlines():
        match=re.match(r'^\s*(Model|Backdrop|Background|Symbol|Pattern)\s*:\s*(.*?)\s*$',line,re.I)
        if match:
            fields[match.group(1).lower()]=match.group(2)
    for row in parser.rows:
        th=next((value for tag,value in row if tag=='th'),None)
        td=next((value for tag,value in row if tag=='td'),None)
        if th and td and th.strip().lower() in ('model','backdrop','background','symbol','pattern'):
            fields[th.strip().lower()]=td
    def parse_trait(*keys):
        for key in keys:
            value=fields.get(key,'')
            if value:
                raw=re.sub(r'\s+',' ',value).strip()
                rare=re.search(r'\s+(\d+(?:\.\d+)?)\s*%\s*$',raw)
                val=raw[:rare.start()].strip() if rare else raw
                return val[:100],float(rare.group(1)) if rare else None
        return '',None
    model,model_rarity=parse_trait('model')
    symbol,symbol_rarity=parse_trait('symbol','pattern')
    backdrop,backdrop_rarity=parse_trait('backdrop','background')
    if not all((model,symbol,backdrop)):
        abort(503,description='Telegram не вернул модель, узор или фон этого NFT.')
    title=meta.get('og:title') or meta.get('twitter:title') or ''
    idx=slug.rsplit('-',1)[-1]
    if title:
        numbers=re.findall(r'#(\d+)',title)
        if numbers and idx not in numbers:
            abort(409,description='Telegram вернул информацию о другом NFT.')
    rarity={}
    for key,value in (('model',model_rarity),('symbol',symbol_rarity),('backdrop',backdrop_rarity)):
        if value is not None and 0<=value<=100:
            rarity[key]=value*10
    image=meta.get('og:image') or meta.get('twitter:image') or ''
    if not isinstance(image,str) or not image.startswith('https://'):
        image='https://nft.fragment.com/gift/'+slug.lower()+'.webp'
    return {'model':model,'symbol':symbol,'backdrop':backdrop,
            'image':image,'rarity':rarity,'telegram_verified_at':int(time.time()),
            'metadata_source':'telegram'}

def portals_collection_floor(slug):
    """Best-effort Portals floor for a collection; never block NFT details."""
    canonical=lambda value: re.sub(r'[^a-z0-9]','',str(value or '').lower())
    name=canonical(slug.rsplit('-',1)[0])
    try:
        raw=portals_get('collections',{'limit':5000})
        rows=raw if isinstance(raw,list) else raw.get('collections',raw.get('items',[]))
        collection=next((item for item in rows if canonical(item.get('name'))==name),None)
        if not collection:
            return ''
        floor=collection.get('floor_price')
        if floor is not None and float(floor)>0:
            return str(floor)
        if not collection.get('id'):
            return ''
        result=portals_get('nfts/search',{
            'collection_id':collection['id'],'status':'listed',
            'sort_by':'price asc','limit':1,'offset':0})
        gifts=result.get('results',[])
        if gifts and float(gifts[0].get('price',0))>0:
            return str(gifts[0]['price'])
    except (HTTPError,URLError,TimeoutError,KeyError,ValueError,TypeError,OSError,StopIteration):
        pass
    return ''

def collectible_metadata(slug):
    verified=telegram_nft_metadata(slug)
    verified['floor_price']=portals_collection_floor(slug)
    verified['floor_unit']='GRAM'
    verified['floor_checked_at']=int(time.time())
    return verified


def install_new_year(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS new_year_wallets (
            user_id BIGINT PRIMARY KEY, balls BIGINT NOT NULL DEFAULT 0,
            donate BIGINT NOT NULL DEFAULT 0, tinsel BIGINT NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS new_year_lots (
            id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
            nft_url TEXT NOT NULL, title TEXT NOT NULL,
            number BIGINT NOT NULL, price BIGINT NOT NULL,
            metadata TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
            created_by BIGINT NOT NULL, created BIGINT NOT NULL,
            buyer_id BIGINT, sold_at BIGINT
        );
        CREATE TABLE IF NOT EXISTS new_year_receipts (
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL, lot_id TEXT NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(user_id,request_id)
        );
        """)

    def enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='new_year_enabled_v1'").fetchone()
        return bool(row and row['payload'] == 'true')

    def wallet(uid):
        row = db().execute(
            "SELECT balls,donate,tinsel FROM new_year_wallets WHERE user_id=?", (uid,)
        ).fetchone()
        return {key:int(row[key]) if row else 0 for key in ('balls','donate','tinsel')}

    def gift_from_lot(row):
        extra = json.loads(row['metadata'])
        return {
            'name':row['title'], 'number':int(row['number']),
            'model':extra.get('model',''), 'symbol':extra.get('symbol',''),
            'backdrop':extra.get('backdrop',''),
            'floor_price':extra.get('floor_price',''),
            'floor_unit':extra.get('floor_unit','GRAM'),
            'rarity':extra.get('rarity',{}),
            'image':extra.get('image') or 'https://nft.fragment.com/gift/'+row['slug'].lower()+'.webp',
            'portal_nft_id':extra.get('portal_nft_id',''),
            'portal_verified_at':extra.get('portal_verified_at',0),
            'telegram_verified_at':extra.get('telegram_verified_at',0),
            'telegram_url':row['nft_url'], 'telegram_slug':row['slug'],
            'collection_id':re.sub(r'[^a-z0-9]','',row['title'].lower()),
            'price_unit':'BALL', 'price':int(row['price'])
        }

    def item(row):
        return dict(id=row['id'],slug=row['slug'],url=row['nft_url'],
                    price=int(row['price']),status=row['status'],
                    gift=gift_from_lot(row),created=int(row['created']),
                    buyer_id=row['buyer_id'])

    # ---- the currency of the site: New Year balls, points, coins or an own one (name and picture). Without a choice it follows the New Year switch (balls / points) ----
    CUR_KEY='currency_v1'
    CUR_LAST='currency_last_v1'
    PRESETS={'balls':{'name':'Шары','gen':'шаров','icon':'/static/assets/new-year-ornament.svg'},
             'points':{'name':'Поинты','gen':'поинтов','icon':'/static/assets/points.svg'},
             'coins':{'name':'Коины','gen':'коинов','icon':'/static/assets/coins.svg'}}
    ICON_OK=re.compile(r'/media/shop/[0-9a-f]{32}|/static/assets/[A-Za-z0-9_./-]{1,100}\.(?:svg|png|webp)')

    def currency():
        row=db().execute("SELECT payload FROM settings WHERE key=?",(CUR_KEY,)).fetchone()
        if row:
            try:
                data=json.loads(row['payload'])
            except (TypeError,ValueError):
                data=None
            if isinstance(data,dict) and data.get('kind') in ('balls','points','coins','custom'):
                base=PRESETS.get(data['kind']) or {}
                name=str(data.get('name') or base.get('name') or 'Валюта')[:24]
                return {'kind':data['kind'],'name':name,'gen':str(data.get('gen') or base.get('gen') or name.lower())[:24],
                        'icon':str(data.get('icon') or base.get('icon') or PRESETS['points']['icon']),'epoch':int(data.get('epoch') or 0)}
        kind='balls' if enabled() else 'points'
        return {'kind':kind,**PRESETS[kind],'epoch':0}

    def cur_sig(c):
        return json.dumps({k:c[k] for k in ('kind','name','gen','icon','epoch')},ensure_ascii=False,sort_keys=True)

    @app.get('/api/new-year/status')
    @auth()
    def new_year_status():
        c=currency()
        return {'enabled':enabled(), 'currency':c['kind'], 'currency_info':c, 'sig':cur_sig(c)}

    def mode():
        return currency()['kind']

    def currency_notice(uid):
        """When the New Year is switched, every player is told once: the balls became points (or the points became balls), the same number."""
        key='ny_currency_seen:'+str(uid)
        row=db().execute("SELECT payload FROM settings WHERE key=?",(key,)).fetchone()
        now=currency()
        sig=cur_sig(now)
        if not row:
            with db():
                db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO NOTHING",(key,sig))
            return None
        if row['payload']==sig:
            return None
        try:
            prev=json.loads(row['payload']) if str(row['payload']).startswith('{') else {'kind':row['payload'],**PRESETS[row['payload']],'epoch':0}
        except Exception:
            prev={'kind':'balls',**PRESETS['balls'],'epoch':0}
        same=all(prev.get(k)==now[k] for k in ('kind','name','icon'))
        if same and (prev.get('epoch')==now['epoch'] or (not prev.get('epoch') and not now['epoch'])):          # only another way of writing the same currency: nothing to tell
            return None
        rate='1'
        try:
            last=db().execute("SELECT payload FROM settings WHERE key=?",(CUR_LAST,)).fetchone()
            last=json.loads(last['payload']) if last else {}
            if int((last.get('to') or {}).get('epoch') or -1)==now['epoch']:
                rate=str(last.get('rate') or '1')
        except Exception:
            pass
        if same and rate=='1':                                                         # recalculated to the same currency one to one: the player sees no change
            return None
        pick=lambda c:{k:c.get(k) for k in ('kind','name','gen','icon')}
        return {'from':pick(prev),'to':pick(now),'amount':wallet(uid)['balls'],'rate':rate}

    @app.post('/api/new-year/ack')
    @auth()
    def new_year_ack():
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         ('ny_currency_seen:'+str(g.user['id']),cur_sig(currency())))
        return {'ok':True,'currency':mode()}

    POINTS_KEY='points_per_ton_v1'

    def points_per_ton():
        row=db().execute("SELECT payload FROM settings WHERE key=?",(POINTS_KEY,)).fetchone()
        try:
            value=Decimal(str(row['payload'])) if row else Decimal('0')
            return int(value) if value.is_finite() and 0<=value<=100000 else 0
        except Exception:
            return 0

    app.extensions['crafter_points_per_ton']=points_per_ton

    @app.post('/api/admin/new-year/points-rate')
    @auth(admin=True)
    def admin_points_rate():
        raw=(request.get_json(silent=True) or {}).get('per_ton')
        try:
            value=int(str(raw).strip() or '0')
        except (TypeError,ValueError):
            abort(400,description='Поинты за 1 TON: целое число, 0 — не начислять')
        if not 0<=value<=100000:
            abort(400,description='Поинты за 1 TON: от 0 до 100 000')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",(POINTS_KEY,str(value)))
        audit('Points per 1 TON set to '+str(value))
        return {'ok':True,'per_ton':value}

    app.extensions['crafter_ny_currency_notice']=currency_notice
    app.extensions['crafter_currency']=currency

    # ---- the administrator: choose the currency and make the recalculation ----
    def clean_currency(body):
        kind=str(body.get('kind') or '')
        if kind in PRESETS:
            c={'kind':kind,**PRESETS[kind]}
        elif kind=='custom':
            name=' '.join(str(body.get('name') or '').split())
            gen=' '.join(str(body.get('gen') or '').split()) or name.lower()
            icon=str(body.get('icon') or '').strip()
            if not 1<=len(name)<=24 or len(gen)>24:
                abort(400,description='Название валюты: от 1 до 24 знаков')
            if not ICON_OK.fullmatch(icon):
                abort(400,description='Загрузите картинку валюты')
            c={'kind':'custom','name':name,'gen':gen,'icon':icon}
        else:
            abort(400,description='Выберите валюту')
        raw=body.get('rate')
        try:
            rate=Decimal(str(raw if raw not in (None,'') else '1').replace(',','.'))
        except InvalidOperation:
            abort(400,description='Курс пересчёта: число')
        if not rate.is_finite() or not Decimal('0.0001')<=rate<=Decimal('100000'):
            abort(400,description='Курс пересчёта: от 0,0001 до 100 000')
        return c,rate

    def after(balls,rate):
        return int((Decimal(int(balls))*rate).quantize(Decimal('1'),rounding=ROUND_HALF_UP))

    def recalc_stats(rate):
        rows=db().execute("SELECT user_id,balls FROM new_year_wallets WHERE balls<>0").fetchall()
        return {'holders':len(rows),'before':sum(int(r['balls']) for r in rows),'after':sum(after(r['balls'],rate) for r in rows),
                'users':int(db().execute("SELECT COUNT(*) AS n FROM users").fetchone()['n'])}

    def changes(c,rate):
        now=currency()
        return not (c['kind']==now['kind'] and c['name']==now['name'] and c['icon']==now['icon'] and rate==Decimal('1'))

    @app.get('/api/admin/currency')
    @auth(admin=True)
    def admin_currency():
        last=db().execute("SELECT payload FROM settings WHERE key=?",(CUR_LAST,)).fetchone()
        try:
            last=json.loads(last['payload']) if last else None
        except (TypeError,ValueError):
            last=None
        return {'current':currency(),'presets':[{'kind':k,**v} for k,v in PRESETS.items()],'stats':recalc_stats(Decimal('1')),'last':last,'new_year':enabled()}

    @app.post('/api/admin/currency/preview')
    @auth(admin=True)
    def admin_currency_preview():
        c,rate=clean_currency(request.get_json(silent=True) or {})
        return {'ok':True,'from':currency(),'to':c,'rate':str(rate),'changes':changes(c,rate),**recalc_stats(rate)}

    @app.post('/api/admin/currency/apply')
    @auth(admin=True)
    def admin_currency_apply():
        c,rate=clean_currency(request.get_json(silent=True) or {})
        if not changes(c,rate):
            abort(409,description='Валюта и курс не меняются: нечего пересчитывать')
        old=currency()
        with db():
            for r in db().execute("SELECT user_id,balls FROM new_year_wallets WHERE balls<>0").fetchall():
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?",(after(r['balls'],rate),r['user_id']))
            new={**c,'epoch':old['epoch']+1}
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",(CUR_KEY,json.dumps(new,ensure_ascii=False)))
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (CUR_LAST,json.dumps({'from':{k:old[k] for k in ('kind','name','gen','icon')},'to':new,'rate':str(rate),'at':int(time.time())},ensure_ascii=False)))
        audit('Currency recalculated %s -> %s, rate %s'%(old['name'],c['name'],rate))
        return {'ok':True,'current':currency(),**recalc_stats(Decimal('1'))}
    app.extensions['crafter_ny_currency_mode']=mode

    @app.get('/api/new-year')
    @auth()
    def new_year_market():
        rows=db().execute(
            "SELECT * FROM new_year_lots WHERE status='active' ORDER BY created DESC"
        ).fetchall()
        return {'enabled':enabled(),'balance':wallet(g.user['id']),
                'lots':[item(row) for row in rows], 'test_mode':True}

    @app.get('/api/admin/new-year')
    @auth(admin=True)
    def admin_new_year():
        rows=db().execute("SELECT * FROM new_year_lots ORDER BY created DESC LIMIT 150").fetchall()
        return {'enabled':enabled(), 'lots':[item(row) for row in rows],
                'my_balance':wallet(g.user['id']), 'points_per_ton':points_per_ton()}

    @app.post('/api/admin/new-year/settings')
    @auth(admin=True)
    def admin_new_year_settings():
        body=request.get_json(silent=True) or {}
        if type(body.get('enabled')) is not bool:
            abort(400,description='Неверное значение переключателя')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('new_year_enabled_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         ('true' if body['enabled'] else 'false',))
        audit('New Year event '+('enabled' if body['enabled'] else 'disabled'))
        return {'ok':True,'enabled':body['enabled']}

    @app.get('/api/new-year/lots/<lot_id>/details')
    @auth()
    def new_year_lot_details(lot_id):
        row = db().execute("SELECT * FROM new_year_lots WHERE id=?",(lot_id,)).fetchone()
        if not row or row['status'] != 'active':
            abort(404, description='Лот уже недоступен')
        extra = json.loads(row['metadata'])
        now=int(time.time())
        update=False
        if int(extra.get('telegram_verified_at') or 0) < now - 86400:
            verified=telegram_nft_metadata(row['slug'])
            extra.update(verified)
            update=True
        if int(extra.get('floor_checked_at') or 0) < now - 600:
            floor=portals_collection_floor(row['slug'])
            if floor or not extra.get('floor_price'):
                extra['floor_price']=floor
            extra['floor_unit']='GRAM'
            extra['floor_checked_at']=now
            update=True
        if update:
            with db():
                db().execute("UPDATE new_year_lots SET metadata=? WHERE id=? AND status='active'",
                             (json.dumps(extra,ensure_ascii=False),lot_id))
            row = db().execute("SELECT * FROM new_year_lots WHERE id=?",(lot_id,)).fetchone()
        return {'ok':True,'lot':item(row)}

    @app.post('/api/admin/new-year/lots')
    @auth(admin=True)
    def admin_new_year_create():
        body=request.get_json(silent=True) or {}
        link=body.get('url')
        match=_NFT.fullmatch(link.strip()) if isinstance(link,str) else None
        if not match:
            abort(400,description='Введите ссылку вида https://t.me/nft/ChillFlame-426793')
        slug=match.group(1)
        prefix, number=slug.rsplit('-',1)
        try:price=int(body.get('price',0))
        except (TypeError,ValueError):abort(400,description='Стоимость укажите целым числом шаров')
        if str(body.get('price','')) != str(price) or not 1<=price<=_LIMIT:
            abort(400,description='Стоимость: от 1 до 1 000 000 000 шаров')
        title=re.sub(r'(?<=[a-z])(?=[A-Z])',' ',prefix.replace('_',' ')).strip()
        # Fetch real NFT attributes and image; never trust manually supplied metadata.
        extra=collectible_metadata(slug)
        lot_id=uuid.uuid4().hex
        with db():
            db().execute('BEGIN IMMEDIATE')
            if db().execute("SELECT 1 FROM new_year_lots WHERE lower(slug)=lower(?)",
                            (slug,)).fetchone():
                abort(409,description='Этот NFT уже есть в новогоднем маркете')
            db().execute(
                "INSERT INTO new_year_lots(id,slug,nft_url,title,number,price,metadata,status,created_by,created) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (lot_id,slug,'https://t.me/nft/'+slug,title,int(number),price,
                 json.dumps(extra,ensure_ascii=False),'active',g.user['id'],int(time.time())))
        audit('New Year lot created '+slug+' for '+str(price)+' balls')
        return {'ok':True,'id':lot_id}

    @app.post('/api/admin/new-year/lots/<lot_id>/status')
    @auth(admin=True)
    def admin_new_year_lot_status(lot_id):
        body=request.get_json(silent=True) or {}
        next_status=body.get('status')
        if next_status not in ('active','hidden'):
            abort(400,description='Можно только скрыть или вернуть непроданный лот')
        with db():
            row=db().execute("SELECT status FROM new_year_lots WHERE id=?", (lot_id,)).fetchone()
            if not row:abort(404)
            if row['status']=='sold':abort(409,description='Проданный NFT нельзя выставить повторно')
            db().execute("UPDATE new_year_lots SET status=? WHERE id=?", (next_status,lot_id))
        audit('New Year lot '+lot_id+' status '+next_status)
        return {'ok':True,'status':next_status}

    @app.get('/api/admin/new-year/users/<int:uid>/wallet')
    @auth(admin=True)
    def new_year_user_wallet(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():
            abort(404,description='Пользователь не найден')
        return {'user_id':uid,'balance':wallet(uid)}

    @app.post('/api/admin/new-year/wallet')
    @auth(admin=True)
    def admin_new_year_grant():
        body=request.get_json(silent=True) or {}
        try:uid=int(body.get('user_id',0))
        except (TypeError,ValueError):abort(400,description='Неверный Telegram ID')
        if uid<=0 or uid>=2**63:
            abort(400,description='Неверный Telegram ID')
        amounts={}
        for key in ('balls','donate','tinsel'):
            try:value=int(body.get(key,0))
            except (ValueError,TypeError):abort(400,description='Укажите целые суммы')
            if str(body.get(key,0))!=str(value) or not -_LIMIT<=value<=_LIMIT:
                abort(400,description='Неверное число '+key)
            amounts[key]=value
        if not any(amounts.values()):
            abort(400,description='Введите сумму зачисления или списания')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if not db().execute('SELECT 1 FROM users WHERE id=?',(uid,)).fetchone():
                abort(404,description='Пользователь ещё не входил в Crafter')
            db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING",(uid,))
            before=wallet(uid)
            after={key:before[key]+amounts[key] for key in amounts}
            if any(not 0<=value<=_LIMIT for value in after.values()):
                abort(409,description='Баланс не может стать отрицательным или превысить лимит')
            db().execute(
                "UPDATE new_year_wallets SET balls=?,donate=?,tinsel=? WHERE user_id=?",
                (after['balls'],after['donate'],after['tinsel'],uid))
            record('new_year_grant',{'admin_id':g.user['id'],'delta':amounts,
                                     'after':after},uid=uid)
        audit('New Year balances modified for '+str(uid))
        return {'ok':True,'balance':after}

    @app.post('/api/new-year/buy')
    @auth()
    def new_year_buy():
        body=request.get_json(silent=True) or {}
        lot_id=body.get('lot_id')
        rid=body.get('request_id')
        if not isinstance(lot_id,str) or not re.fullmatch(r'[a-f0-9]{32}',lot_id):
            abort(400,description='Неверный лот')
        if not isinstance(rid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',rid):
            abort(400,description='Неверный номер покупки')
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            previous=db().execute(
                "SELECT lot_id,result FROM new_year_receipts WHERE user_id=? AND request_id=?",
                (uid,rid)).fetchone()
            if previous:
                if previous['lot_id']!=lot_id:abort(409,description='Номер покупки уже использован')
                return json.loads(previous['result'])
            lot=db().execute("SELECT * FROM new_year_lots WHERE id=? AND status='active'",
                             (lot_id,)).fetchone()
            if not lot:
                abort(409,description='Подарок уже куплен или снят с продажи')
            amount=int(lot['price'])
            before=wallet(uid)
            if before['balls']<amount:
                abort(409,description='Недостаточно новогодних шаров')
            changed=db().execute(
                "UPDATE new_year_lots SET status='sold',buyer_id=?,sold_at=? "
                "WHERE id=? AND status='active'",(uid,int(time.time()),lot_id)).rowcount
            if changed!=1:
                abort(409,description='Этот подарок уже недоступен')
            db().execute(
                "INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING",(uid,))
            db().execute(
                "UPDATE new_year_wallets SET balls=? WHERE user_id=?",(before['balls']-amount,uid))
            gift=gift_from_lot(lot)
            gift.update(
                id='new-year-test-'+uuid.uuid4().hex, origin='new-year-test',
                source_id=lot['id'], price='0', price_unit='GRAM',
                catalog_only=True, test_only=True,
                new_year_price_balls=amount)
            db().execute("INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,?)",
                         (uid,gift['id'],json.dumps(gift,ensure_ascii=False),'unlisted'))
            result={'ok':True,'gift':gift,
                    'balance':{'balls':before['balls']-amount,'donate':before['donate'],
                               'tinsel':before['tinsel']},
                    'test_mode':True}
            db().execute("INSERT INTO new_year_receipts(user_id,request_id,lot_id,result) "
                         "VALUES(?,?,?,?)",(uid,rid,lot_id,json.dumps(result,ensure_ascii=False)))
            record('new_year_buy',{'lot_id':lot_id,'gift':gift,
                                   'price_balls':amount,'test_mode':True},uid=uid)
        return result

    return enabled
