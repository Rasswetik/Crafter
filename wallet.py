"""TON Connect funding: wallet signatures stay client-side; credit only verified chain messages."""
import os,json,time,uuid,base64
from decimal import Decimal,InvalidOperation,ROUND_DOWN,ROUND_UP
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from urllib.error import URLError
from pathlib import Path
from flask import request,g,abort,jsonify

DEFAULTS=dict(enabled=False,network='testnet',receiver='',app_name='Crafter',public_url='',gram_per_ton='1',min_deposit='0.1',max_deposit='100',withdraw_enabled=False,withdraw_max='2500',withdraw_daily='20000',rpc_key='')
def address(raw):
    from tonsdk.utils import Address
    try:return Address(raw).to_string(False)
    except Exception:abort(400,description='Некорректный адрес TON')
def amount(value,places='0.01'):
    try:
        v=Decimal(str(value))
        if not v.is_finite() or v<=0 or v>Decimal('1000000000'):raise ValueError()
        result=v.quantize(Decimal(places),rounding=ROUND_DOWN)
        if result<=0:raise ValueError()
        return result
    except Exception:abort(400,description='Укажите корректную сумму')
def payload(memo):
    from tonsdk.boc import Cell
    cell=Cell();cell.bits.write_uint(0,32);cell.bits.write_string(memo)
    return base64.b64encode(cell.to_boc(False)).decode()
def rpc(network,method,params,key=''):
    host='https://toncenter.com/api/v2/' if network=='mainnet' else 'https://testnet.toncenter.com/api/v2/'
    headers={'Accept':'application/json'}
    if key:headers['X-API-Key']=key
    try:
        with urlopen(Request(host+method+'?'+urlencode(params),headers=headers),timeout=8) as r:data=json.load(r)
    except (URLError,TimeoutError,ValueError):abort(502,description='TON RPC временно недоступен')
    if not data.get('ok'):abort(502,description='TON RPC временно недоступен')
    return data.get('result')
def confirmed_message(transactions,recipient,sender,nano,memo,created):
    for tx in transactions:
        msg=tx.get('in_msg') or {}
        try:
            if address(msg.get('destination',''))!=recipient or address(msg.get('source',''))!=sender:continue
            text=msg.get('message','')
            if not text:
                encoded=msg.get('msg_data',{}).get('text','')
                try:text=base64.b64decode(encoded).decode()
                except Exception:text=''
            if text!=memo or int(msg.get('value',0))!=int(nano) or int(tx.get('utime',0))<created-30:continue
            if tx.get('description',{}).get('aborted') or msg.get('bounced'):continue
            return tx.get('transaction_id',{}).get('hash')
        except Exception:continue
    return None

def install_wallet(app,db,auth,record,audit):
    with app.app_context():
        db().executescript('''CREATE TABLE IF NOT EXISTS connected_wallets(user_id INTEGER PRIMARY KEY,address TEXT,network TEXT);CREATE TABLE IF NOT EXISTS wallet_balances(user_id INTEGER,network TEXT,gram TEXT,PRIMARY KEY(user_id,network));CREATE TABLE IF NOT EXISTS ton_deposits(id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,status TEXT,created INTEGER,tx TEXT);CREATE TABLE IF NOT EXISTS ton_transactions(network TEXT,hash TEXT,PRIMARY KEY(network,hash));CREATE TABLE IF NOT EXISTS ton_withdrawals(id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,status TEXT,created INTEGER,tx TEXT);''');db().commit()
    def config():
        row=db().execute("SELECT payload FROM settings WHERE key='tonconnect'").fetchone()
        return {**DEFAULTS,**(json.loads(row[0]) if row else {}),'rpc_key':os.getenv('TONCENTER_API_KEY') or (json.loads(row[0]).get('rpc_key','') if row else '')}
    def storage():
        path=Path(app.config['DATABASE']).resolve();mounted=Path('/var/data')
        durable=not os.getenv('RENDER') or (os.path.ismount(mounted) and path.is_relative_to(mounted))
        return dict(engine='sqlite',durable=durable,path=str(path))
    def ready(c):
        if not c['enabled'] or not c['receiver']:abort(409,description='TON Connect не настроен администратором')
        if c['network']=='mainnet' and not storage()['durable']:abort(409,description='Для mainnet требуется постоянное хранилище базы')
    def public(c):return {k:v for k,v in c.items() if k!='rpc_key'}
    def origin(c):return (c.get('public_url') or os.getenv('RENDER_EXTERNAL_URL') or request.url_root).rstrip('/')
    def verified_balance(network):
        row=db().execute('SELECT gram FROM wallet_balances WHERE user_id=? AND network=?',(g.user['id'],network)).fetchone()
        return Decimal(row[0]) if row else Decimal(0)
    @app.get('/tonconnect-manifest.json')
    def ton_manifest():
        c=config();root=origin(c)
        response=jsonify(url=root,name=c['app_name'],iconUrl=root+'/static/assets/wallet-icon.png')
        response.headers['Access-Control-Allow-Origin']='*'
        return response
    @app.get('/api/wallet')
    @auth()
    def wallet_info():
        c=config();row=db().execute('SELECT address,network FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
        balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
        paid=min(balance,verified_balance(c['network']))
        dep=[dict(id=r['id'],status=r['status'],created=r['created'],**json.loads(r['payload'])) for r in db().execute('SELECT * FROM ton_deposits WHERE user_id=? ORDER BY created DESC LIMIT 30',(g.user['id'],))]
        withdrawals=[dict(id=r['id'],status=r['status'],created=r['created'],**json.loads(r['payload'])) for r in db().execute('SELECT * FROM ton_withdrawals WHERE user_id=? ORDER BY created DESC LIMIT 30',(g.user['id'],))]
        return dict(config=public(c),connected=dict(row) if row else None,balance=str(balance),withdrawable=str(paid),deposits=dep,withdrawals=withdrawals,manifest_url=origin(c)+'/tonconnect-manifest.json')
    @app.post('/api/wallet/connect')
    @auth()
    def connect():
        c=config();data=request.get_json() or {};raw=address(data.get('address',''));network=data.get('network')
        if network!=c['network']:abort(409,description='Выберите сеть '+c['network'])
        db().execute('INSERT OR REPLACE INTO connected_wallets VALUES(?,?,?)',(g.user['id'],raw,network));db().commit()
        return {'ok':True}
    @app.post('/api/wallet/disconnect')
    @auth()
    def disconnect():
        db().execute('DELETE FROM connected_wallets WHERE user_id=?',(g.user['id'],));db().commit();return {'ok':True}
    @app.post('/api/wallet/deposit')
    @auth()
    def deposit():
        c=config();ready(c);data=request.get_json() or {};requested=amount(data['gram']) if data.get('gram') else None;value=(requested/Decimal(c['gram_per_ton'])).quantize(Decimal('0.000000001'),rounding=ROUND_UP) if requested else amount(data.get('ton'),'0.000000001')
        if not Decimal(c['min_deposit'])<=value<=Decimal(c['max_deposit']):abort(400,description='Сумма вне лимитов пополнения')
        row=db().execute('SELECT * FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
        if not row or row['network']!=c['network']:abort(409,description='Подключите кошелёк нужной сети')
        now=int(time.time())
        if db().execute("SELECT count(*) FROM ton_deposits WHERE user_id=? AND created>?",(g.user['id'],now-60)).fetchone()[0]>=5:abort(429,description='Повторите через минуту')
        did=uuid.uuid4().hex;memo='crafter:'+did;nano=str(int(value*1000000000));credit=requested or (value*Decimal(c['gram_per_ton'])).quantize(Decimal('.01'),rounding=ROUND_DOWN)
        if credit<=0:abort(400,description='Сумма слишком мала')
        p=dict(network=c['network'],receiver=address(c['receiver']),sender=row['address'],ton=str(value),nano=nano,gram=str(credit),memo=memo)
        db().execute('INSERT INTO ton_deposits VALUES(?,?,?,?,?,NULL)',(did,g.user['id'],json.dumps(p),'pending',now));db().commit()
        return dict(id=did,gram=str(credit),transaction=dict(validUntil=now+600,network='-239' if c['network']=='mainnet' else '-3',messages=[dict(address=c['receiver'],amount=nano,payload=payload(memo))]))
    @app.post('/api/wallet/deposit/<did>/check')
    @auth()
    def check_deposit(did):
        row=db().execute('SELECT * FROM ton_deposits WHERE id=? AND user_id=?',(did,g.user['id'])).fetchone()
        if not row:abort(404)
        if row['status']=='confirmed':return {'status':'confirmed'}
        p=json.loads(row['payload']);c=config()
        found=confirmed_message(rpc(p['network'],'getTransactions',{'address':p['receiver'],'limit':100,'archival':'true'},c['rpc_key']),p['receiver'],p['sender'],p['nano'],p['memo'],row['created'])
        if not found:return {'status':'pending'}
        with db():
            db().execute('BEGIN IMMEDIATE')
            latest=db().execute('SELECT status FROM ton_deposits WHERE id=?',(did,)).fetchone()[0]
            if latest=='confirmed':return {'status':'confirmed'}
            try:db().execute('INSERT INTO ton_transactions VALUES(?,?)',(p['network'],found))
            except Exception:abort(409,description='Перевод уже обработан')
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])+Decimal(p['gram'])
            paid=verified_balance(p['network'])+Decimal(p['gram'])
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance),g.user['id']))
            db().execute('INSERT OR REPLACE INTO wallet_balances VALUES(?,?,?)',(g.user['id'],p['network'],str(paid)))
            db().execute("UPDATE ton_deposits SET status='confirmed',tx=? WHERE id=?",(found,did));record('deposit',dict(gram=p['gram'],ton=p['ton'],network=p['network'],tx=found))
        return {'status':'confirmed','balance':str(balance)}
    @app.post('/api/wallet/withdraw')
    @auth()
    def withdraw():
        c=config();ready(c)
        if not c['withdraw_enabled']:abort(409,description='Вывод временно отключён')
        data=request.get_json() or {};rid=data.get('request_id');value=amount(data.get('gram'))
        if not isinstance(rid,str) or not 1<=len(rid)<=80:abort(400)
        wid='w-'+str(g.user['id'])+'-'+rid
        with db():
            db().execute('BEGIN IMMEDIATE')
            old=db().execute('SELECT id,status FROM ton_withdrawals WHERE id=?',(wid,)).fetchone()
            if old:return dict(old)
            w=db().execute('SELECT * FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
            if not w or w['network']!=c['network']:abort(409,description='Подключите кошелёк нужной сети')
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0]);paid=verified_balance(c['network'])
            if value>min(balance,paid):abort(409,description='Для вывода доступны только подтверждённые пополнения TON')
            used=sum(Decimal(json.loads(r[0])['gram']) for r in db().execute("SELECT payload FROM ton_withdrawals WHERE user_id=? AND created>? AND status!='cancelled'",(g.user['id'],int(time.time())-86400)))
            if value>Decimal(c['withdraw_max']) or used+value>Decimal(c['withdraw_daily']):abort(409,description='Превышен лимит вывода')
            nano=int(value/Decimal(c['gram_per_ton'])*1000000000)
            if nano<=0:abort(400)
            p=dict(receiver=w['address'],sender=address(c['receiver']),network=c['network'],gram=str(value),nano=str(nano),ton=str(Decimal(nano)/1000000000),memo='crafter-withdraw:'+uuid.uuid4().hex)
            db().execute('INSERT INTO ton_withdrawals VALUES(?,?,?,?,?,NULL)',(wid,g.user['id'],json.dumps(p),'queued',int(time.time())))
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-value),g.user['id']))
            db().execute('UPDATE wallet_balances SET gram=? WHERE user_id=? AND network=?',(str(paid-value),g.user['id'],c['network']))
            record('withdraw_request',p)
        return dict(id=wid,status='queued')
    @app.get('/api/admin/database/backup')
    @auth(admin=True)
    def database_backup():
        import sqlite3,tempfile
        from flask import send_file
        handle=tempfile.NamedTemporaryFile(suffix='.sqlite3',delete=False);path=handle.name;handle.close()
        try:
            target=sqlite3.connect(path)
            try:
                db().backup(target)
                target.execute('PRAGMA secure_delete=ON')
                row = target.execute("SELECT payload FROM settings WHERE key='telegram_bot'").fetchone()
                if row:
                    config = json.loads(row[0])
                    for key in ('token', 'secret', 'bot_id', 'username', 'webhook_url'):
                        config.pop(key, None)
                    with target:
                        target.execute("UPDATE settings SET payload=? WHERE key='telegram_bot'",
                                       (json.dumps(config),))
                    target.execute('VACUUM')
            finally:target.close()
            response=send_file(path,as_attachment=True,download_name='crafter-backup.sqlite3',mimetype='application/vnd.sqlite3')
            response.call_on_close(lambda:os.unlink(path) if os.path.exists(path) else None)
            return response
        except Exception:
            if os.path.exists(path):os.unlink(path)
            raise
    @app.get('/api/admin/tonconnect')
    @auth(admin=True)
    def admin_config():
        c=config();pending=[dict(id=r['id'],user_id=r['user_id'],status=r['status'],created=r['created'],**json.loads(r['payload'])) for r in db().execute("SELECT * FROM ton_withdrawals WHERE status IN ('queued','processing') ORDER BY created LIMIT 100")]
        return dict(config=public(c),rpc_key_configured=bool(c['rpc_key']),storage=storage(),withdrawals=pending)
    @app.post('/api/admin/tonconnect')
    @auth(admin=True)
    def set_config():
        c=config();data=request.get_json() or {}
        for k in DEFAULTS:
            if k in data:
                if k=='rpc_key' and not data[k]:continue
                c[k]=data[k]
        if c['network'] not in ('mainnet','testnet') or type(c['enabled']) is not bool or type(c['withdraw_enabled']) is not bool:abort(400)
        for k in ('gram_per_ton','min_deposit','max_deposit','withdraw_max','withdraw_daily'):c[k]=str(amount(c[k],'0.000000001'))
        if Decimal(c['min_deposit'])>Decimal(c['max_deposit']):abort(400)
        if c['receiver']:address(c['receiver'])
        if not isinstance(c['app_name'],str) or not 1<=len(c['app_name'])<=50:abort(400)
        if not isinstance(c['rpc_key'],str) or len(c['rpc_key'])>256:abort(400)
        if c['public_url'] and not str(c['public_url']).startswith('https://'):abort(400,description='Адрес приложения должен начинаться с https://')
        if c['enabled'] and not c['receiver']:abort(400,description='Укажите адрес приёма TON')
        if c['enabled'] and c['network']=='mainnet' and not storage()['durable']:abort(409,description='Сначала подключите постоянную базу данных')
        db().execute("INSERT OR REPLACE INTO settings VALUES('tonconnect',?)",(json.dumps(c),));db().commit();audit('TON Connect settings updated');return {'ok':True}
    @app.post('/api/admin/tonconnect/withdraw/<wid>/prepare')
    @auth(admin=True)
    def prepare_withdraw(wid):
        with db():
            db().execute('BEGIN IMMEDIATE');row=db().execute('SELECT * FROM ton_withdrawals WHERE id=?',(wid,)).fetchone()
            if not row or row['status']!='queued':abort(409,description='Перевод уже подготовлен. Проверьте его статус перед повторной отправкой.')
            p=json.loads(row['payload']);db().execute("UPDATE ton_withdrawals SET status='processing' WHERE id=?",(wid,))
        return dict(transaction=dict(validUntil=int(time.time())+600,network='-239' if p['network']=='mainnet' else '-3',messages=[dict(address=p['receiver'],amount=p['nano'],payload=payload(p['memo']))]),sender=p['sender'])
    @app.post('/api/admin/tonconnect/withdraw/<wid>/check')
    @auth(admin=True)
    def check_withdraw(wid):
        row=db().execute('SELECT * FROM ton_withdrawals WHERE id=?',(wid,)).fetchone()
        if not row:abort(404)
        if row['status']=='confirmed':return {'status':'confirmed'}
        if row['status']!='processing':abort(409)
        p=json.loads(row['payload']);c=config();tx=confirmed_message(rpc(p['network'],'getTransactions',{'address':p['receiver'],'limit':100,'archival':'true'},c['rpc_key']),p['receiver'],p['sender'],p['nano'],p['memo'],row['created'])
        if not tx:return {'status':'processing'}
        with db():
            db().execute('INSERT OR IGNORE INTO ton_transactions VALUES(?,?)',(p['network'],tx))
            db().execute("UPDATE ton_withdrawals SET status='confirmed',tx=? WHERE id=?",(tx,wid));audit('Withdrawal confirmed: '+wid)
        return {'status':'confirmed'}
