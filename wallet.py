"""TON Connect funding: wallet signatures stay client-side; credit only verified chain messages."""
import os,json,time,uuid,base64
from decimal import Decimal,InvalidOperation,ROUND_DOWN,ROUND_UP
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from urllib.error import URLError
from pathlib import Path
from flask import request,g,abort,jsonify

DEFAULTS=dict(enabled=False,network='testnet',receiver='',app_name='Crafter',public_url='',gram_per_ton='1',min_deposit='0.1',max_deposit='100',withdraw_enabled=False,withdraw_max='2500',withdraw_daily='20000',rpc_key='')
HISTORY_GROUPS = {
    'balance': ('deposit', 'withdraw_funds', 'balance_adjustment', 'stake_claim'),
    'gifts': ('buy', 'sell', 'listing_price', 'unlist', 'withdraw', 'transfer', 'craft', 'gift_granted', 'gift_received', 'sale', 'gift_withdraw_requested', 'gift_withdraw_failed'),
    'offers': ('offer_received', 'offer_created', 'offer_cancelled', 'offer_withdrawn', 'offer_accepted'),
}

def address(raw):
    from tonsdk.utils import Address
    try:return Address(raw).to_string(False)
    except Exception:abort(400,description='Некорректный адрес TON')

def friendly_address(raw, network):
    from tonsdk.utils import Address
    return Address(raw).to_string(True, True, False, network == 'testnet')

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
        db().executescript('''
            CREATE INDEX IF NOT EXISTS history_wallet_user ON history(user_id,created);
            CREATE INDEX IF NOT EXISTS ton_deposits_wallet_user ON ton_deposits(user_id,created);
            CREATE INDEX IF NOT EXISTS ton_withdrawals_wallet_user ON ton_withdrawals(user_id,created);
        ''')
    def config():
        row=db().execute("SELECT payload FROM settings WHERE key='tonconnect'").fetchone()
        return {**DEFAULTS,**(json.loads(row[0]) if row else {}),'rpc_key':os.getenv('TONCENTER_API_KEY') or (json.loads(row[0]).get('rpc_key','') if row else '')}
    def storage():
        if app.config['DATABASE_URL']:
            return dict(engine='postgresql', durable=True, path='Render PostgreSQL')
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

    def used_withdrawal_quota(uid, now=None):
        """Only pending and completed payouts use the rolling 24-hour allowance."""
        cutoff=(int(time.time()) if now is None else int(now))-86400
        rows=db().execute("""SELECT payload FROM ton_withdrawals
            WHERE user_id=? AND created>? AND status IN ('queued','processing','confirmed')""",
            (uid,cutoff)).fetchall()
        return sum((Decimal(json.loads(row['payload'])['gram']) for row in rows),Decimal(0))

    def withdraw_allowance(uid, config, balance):
        """All earned internal GRAM are eligible, regardless of their origin.

        A withdrawal still requires positive ledger balance and must respect
        the operator's transaction and rolling daily limits. This does not
        guarantee the operator's external TON wallet has enough liquidity.
        """
        deposit_metric=max(Decimal(0),verified_balance(config['network']))
        daily_left=max(Decimal(0),Decimal(config['withdraw_daily'])-used_withdrawal_quota(uid))
        return deposit_metric,daily_left,max(Decimal(0),min(balance,daily_left))
    @app.get('/tonconnect-manifest.json')
    def ton_manifest():
        c=config();root=origin(c)
        response=jsonify(url=root,name=c['app_name'],iconUrl=root+'/static/assets/splash-magnate.png')
        response.headers['Access-Control-Allow-Origin']='*'
        return response
    @app.get('/api/wallet')
    @auth()
    def wallet_info():
        c=config();row=db().execute('SELECT address,network FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
        balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
        backed,daily_left,paid=withdraw_allowance(g.user['id'],c,balance)
        dep=[dict(id=r['id'],status=r['status'],created=r['created'],**json.loads(r['payload'])) for r in db().execute('SELECT * FROM ton_deposits WHERE user_id=? ORDER BY created DESC LIMIT 30',(g.user['id'],))]
        withdrawals=[dict(id=r['id'],status=r['status'],created=r['created'],**json.loads(r['payload'])) for r in db().execute('SELECT * FROM ton_withdrawals WHERE user_id=? ORDER BY created DESC LIMIT 30',(g.user['id'],))]
        connected = dict(row, display_address=friendly_address(row['address'], row['network'])) if row else None
        return dict(config=public(c),connected=connected,balance=str(balance),
                    withdrawable=str(paid),funded_balance=str(backed),
                    withdraw_daily_remaining=str(daily_left),
                    deposits=dep,withdrawals=withdrawals,
                    manifest_url=origin(c)+'/tonconnect-manifest.json')
    @app.get('/api/wallet/balance')
    @auth()
    def connected_balance():
        row = db().execute('SELECT address,network FROM connected_wallets WHERE user_id=?', (g.user['id'],)).fetchone()
        c = config()
        if not row or row['network'] != c['network']:
            abort(409, description='Подключите кошелёк нужной сети')
        result = rpc(row['network'], 'getAddressBalance', {'address': row['address']}, c['rpc_key'])
        nano = str(result)
        if not nano.isascii() or not nano.isdecimal() or len(nano) > 30:
            abort(502, description='Не удалось получить баланс кошелька')
        return dict(row, balance_ton=format(Decimal(nano).scaleb(-9), 'f'))
    @app.get('/api/wallet/history')
    @auth()
    def wallet_history():
        uid = g.user['id']
        conditions, params = [], [uid, uid, uid]
        kinds = request.args.get('types', '').split(',')
        if kinds != ['']:
            allowed = {kind for group in HISTORY_GROUPS.values() for kind in group}
            if len(kinds) > len(allowed) or not set(kinds) <= allowed:
                abort(400, description='Неизвестный тип операции')
            conditions.append('kind IN (' + ','.join('?' for _ in kinds) + ')')
            params.extend(kinds)
        cursor = request.args.get('before')
        if cursor is not None:
            try:
                timestamp, source, sequence = map(int, cursor.split(':'))
                if not (0 <= timestamp < 2**63 and source in (0, 1, 2) and 0 < sequence < 2**63):
                    raise ValueError
            except ValueError:
                abort(400, description='Некорректная страница истории')
            conditions.append('(created, source, sequence) < (?, ?, ?)')
            params.extend((timestamp, source, sequence))
        where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
        rows = db().execute('''
            SELECT * FROM (
                SELECT id,kind,payload,created,NULL AS status,0 AS source,rowid AS sequence
                FROM history WHERE user_id=? AND kind NOT IN ('deposit','withdraw_request')
                UNION ALL
                SELECT id,'deposit',payload,created,status,1,rowid FROM ton_deposits WHERE user_id=?
                UNION ALL
                SELECT id,'withdraw_funds',payload,created,status,2,rowid FROM ton_withdrawals WHERE user_id=?
            )
        ''' + where + ' ORDER BY created DESC,source DESC,sequence DESC LIMIT 31', params).fetchall()
        items = [dict(id=r['id'],kind=r['kind'],created=r['created'],status=r['status'],data=json.loads(r['payload'])) for r in rows[:30]]
        next_cursor = ':'.join(str(rows[29][field]) for field in ('created', 'source', 'sequence')) if len(rows) > 30 else None
        return dict(items=items, next_cursor=next_cursor)
    @app.post('/api/wallet/connect')
    @auth()
    def connect():
        c=config();data=request.get_json() or {};raw=address(data.get('address',''));network=data.get('network')
        if network!=c['network']:abort(409,description='Выберите сеть '+c['network'])
        db().execute('INSERT INTO connected_wallets VALUES(?,?,?) ON CONFLICT (user_id) DO UPDATE SET address=excluded.address,network=excluded.network',(g.user['id'],raw,network));db().commit()
        return {'ok':True}
    @app.post('/api/wallet/disconnect')
    @auth()
    def disconnect():
        data = request.get_json() or {}
        query = 'DELETE FROM connected_wallets WHERE user_id=?'
        params = [g.user['id']]
        if 'address' in data:
            query += ' AND address=? AND network=?'
            params.extend((address(data['address']), data.get('network')))
        with db():
            db().execute(query, params)
        return {'ok': True}
    @app.post('/api/wallet/deposit')
    @auth()
    def deposit():
        c=config();ready(c);data=request.get_json() or {};requested=amount(data['gram']) if data.get('gram') else None;value=(requested/Decimal(c['gram_per_ton'])).quantize(Decimal('0.000000001'),rounding=ROUND_UP) if requested else amount(data.get('ton'),'0.000000001')
        if not Decimal(c['min_deposit'])<=value<=Decimal(c['max_deposit']):abort(400,description='Сумма вне лимитов пополнения')
        row=db().execute('SELECT * FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
        if not row or row['network']!=c['network']:abort(409,description='Подключите кошелёк нужной сети')
        if 'sender' in data and address(data['sender']) != row['address']:
            abort(409, description='Кошелёк изменился. Подключите его повторно')
        now=int(time.time())
        if db().execute("SELECT count(*) FROM ton_deposits WHERE user_id=? AND created>?",(g.user['id'],now-60)).fetchone()[0]>=5:abort(429,description='Повторите через минуту')
        did=uuid.uuid4().hex;memo='crafter:'+did;nano=str(int(value*1000000000));credit=requested or (value*Decimal(c['gram_per_ton'])).quantize(Decimal('.01'),rounding=ROUND_DOWN)
        if credit<=0:abort(400,description='Сумма слишком мала')
        p=dict(network=c['network'],receiver=address(c['receiver']),sender=row['address'],ton=str(value),nano=nano,gram=str(credit),memo=memo)
        db().execute('INSERT INTO ton_deposits VALUES(?,?,?,?,?,NULL)',(did,g.user['id'],json.dumps(p),'pending',now));db().commit()
        transaction = {
            'validUntil': now + 600,
            'network': '-239' if p['network'] == 'mainnet' else '-3',
            'from': p['sender'],
            'messages': [dict(address=friendly_address(p['receiver'], p['network']), amount=nano, payload=payload(memo))],
        }
        return dict(id=did, gram=str(credit), transaction=transaction)
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
            db().execute('INSERT INTO wallet_balances VALUES(?,?,?) ON CONFLICT (user_id,network) DO UPDATE SET gram=excluded.gram',(g.user['id'],p['network'],str(paid)))
            db().execute("UPDATE ton_deposits SET status='confirmed',tx=? WHERE id=?",(found,did));record('deposit',dict(gram=p['gram'],ton=p['ton'],network=p['network'],tx=found))
        return {'status':'confirmed','balance':str(balance)}
    @app.post('/api/wallet/withdraw')
    @auth()
    def withdraw():
        c=config();ready(c)
        if not c['withdraw_enabled']:abort(409,description='Вывод временно отключён')
        data=request.get_json(silent=True)
        if not isinstance(data,dict):abort(400,description='Некорректные параметры вывода')
        rid=data.get('request_id')
        value=amount(data.get('gram'))
        if not isinstance(rid,str) or not 1<=len(rid)<=80:abort(400)
        try:
            if Decimal(str(data.get('gram'))) != value:
                abort(400,description='Введите сумму вывода с точностью до 0,01 GRAM')
        except (InvalidOperation,ValueError):
            abort(400,description='Укажите корректную сумму вывода')
        wid='w-'+str(g.user['id'])+'-'+rid
        with db():
            db().execute('BEGIN IMMEDIATE')
            old=db().execute('SELECT id,status,payload FROM ton_withdrawals WHERE id=? AND user_id=?',
                             (wid,g.user['id'])).fetchone()
            if old:
                if Decimal(json.loads(old['payload'])['gram']) != value:
                    abort(409,description='Идентификатор заявки уже использован для другой суммы')
                return {'id':old['id'],'status':old['status']}
            w=db().execute('SELECT * FROM connected_wallets WHERE user_id=?',(g.user['id'],)).fetchone()
            if not w or w['network']!=c['network']:abort(409,description='Подключите кошелёк нужной сети')
            balance=Decimal(db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(g.user['id'],)).fetchone()[0])
            backed,daily_left,allowed=withdraw_allowance(g.user['id'],c,balance)
            if value>balance:
                abort(409,description='Недостаточно GRAM на внутреннем балансе Crafter')
            if value>Decimal(c['withdraw_max']):
                abort(409,description='Сумма превышает лимит одной операции')
            if value>daily_left:
                abort(409,description='Суточный лимит вывода исчерпан')
            if value>allowed:
                abort(409,description='Сумма превышает доступный баланс')
            nano=int(value/Decimal(c['gram_per_ton'])*1000000000)
            if nano<=0:abort(400)
            # Historical payouts used to decrease wallet_balances as a second
            # provenance ledger. New payouts debit only the authoritative
            # demo_accounts balance; otherwise earnings from sales/offers
            # cannot be withdrawn and may lead to negative provenance totals.
            p=dict(receiver=w['address'],sender=address(c['receiver']),network=c['network'],gram=str(value),nano=str(nano),ton=str(Decimal(nano)/1000000000),memo='crafter-withdraw:'+uuid.uuid4().hex,funding_ledger_debited=False)
            db().execute('INSERT INTO ton_withdrawals VALUES(?,?,?,?,?,NULL)',(wid,g.user['id'],json.dumps(p),'queued',int(time.time())))
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance-value),g.user['id']))
            record('withdraw_request',p)
        return dict(id=wid,status='queued')
    @app.post('/api/wallet/withdraw/<wid>/cancel')
    @auth()
    def cancel_queued_withdrawal(wid):
        # A queued withdrawal has never been prepared for TON signing.
        # Processing/confirmed requests must NOT be refunded without chain verification.
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            row=db().execute('SELECT payload,status FROM ton_withdrawals WHERE id=? AND user_id=?',
                             (wid,uid)).fetchone()
            if not row:
                abort(404,description='Заявка не найдена')
            if row['status']=='cancelled':
                return {'status':'cancelled'}
            if row['status']!='queued':
                abort(409,description='Отменить можно только заявку, ещё не отправленную на обработку')
            p=json.loads(row['payload'])
            gram=Decimal(p['gram'])
            wallet_network=p['network']
            db().execute("UPDATE ton_withdrawals SET status='cancelled' WHERE id=? AND user_id=? AND status='queued'",
                         (wid,uid))
            account=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
            current=Decimal(account['balance']) if account else Decimal(0)
            db().execute("""INSERT INTO demo_accounts(user_id,balance) VALUES(?,?)
                ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance""",
                (uid,str(current+gram)))
            # Refund the old provenance ledger only for withdrawals created
            # before this change; they were debited there at reservation time.
            # New withdrawals are reserved ONLY in demo_accounts.
            if p.get('funding_ledger_debited', True):
                row_funded=db().execute('SELECT gram FROM wallet_balances WHERE user_id=? AND network=?',
                                        (uid,wallet_network)).fetchone()
                funded=Decimal(row_funded['gram']) if row_funded else Decimal(0)
                db().execute("""INSERT INTO wallet_balances(user_id,network,gram) VALUES(?,?,?)
                    ON CONFLICT(user_id,network) DO UPDATE SET gram=excluded.gram""",
                    (uid,wallet_network,str(funded+gram)))
        return {'status':'cancelled'}

    @app.get('/api/admin/database/backup')
    @auth(admin=True)
    def database_backup():
        if app.config['DATABASE_URL']:
            abort(409, description='Экспорт SQLite доступен только для SQLite')
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
    @app.get('/api/admin/tonconnect/receiver/balance')
    @auth(admin=True)
    def admin_receiver_balance():
        c = config()
        if not c['receiver']:
            abort(409, description='Укажите кошелёк приёма TON в настройках TON Connect')
        receiver = address(c['receiver'])
        nano = str(rpc(c['network'], 'getAddressBalance',
                       {'address': receiver}, c['rpc_key']))
        if not nano.isascii() or not nano.isdecimal() or len(nano) > 30:
            abort(502, description='Не удалось получить баланс TON')
        return {'receiver': receiver, 'network': c['network'],
                'balance_ton': format(Decimal(nano).scaleb(-9), 'f')}

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
        db().execute("INSERT INTO settings VALUES('tonconnect',?) ON CONFLICT (key) DO UPDATE SET payload=excluded.payload",(json.dumps(c),));db().commit();audit('TON Connect settings updated');return {'ok':True}
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
            db().execute('INSERT INTO ton_transactions VALUES(?,?) ON CONFLICT DO NOTHING',(p['network'],tx))
            db().execute("UPDATE ton_withdrawals SET status='confirmed',tx=? WHERE id=?",(tx,wid));audit('Withdrawal confirmed: '+wid)
        return {'status':'confirmed'}
