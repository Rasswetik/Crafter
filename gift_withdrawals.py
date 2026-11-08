"""Manual queue for Telegram NFT withdrawals.

This module intentionally never claims to transfer a Telegram NFT itself.
Only authenticated administrators may mark a request fulfilled after verifying
that the *exact* gift was transferred out of the custody account.
"""
import json
import re
import time
from decimal import Decimal

from flask import abort, g, request

FEE_GRAM = Decimal('0.4')
_TELEGRAM_NFT = re.compile(r'^https://(?:t\.me|telegram\.me)/nft/[a-z0-9]+-[1-9][0-9]*$', re.I)


def install_gift_withdrawals(app, db, auth, record, audit):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS gift_withdrawals (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                gift_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL,
                created INTEGER NOT NULL,
                updated INTEGER NOT NULL,
                note TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nft_withdraw_fee_receipts(
                id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, amount TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'charged'
            );
            CREATE INDEX IF NOT EXISTS gift_withdrawals_pending
                ON gift_withdrawals(status,created);
            CREATE INDEX IF NOT EXISTS gift_withdrawals_user
                ON gift_withdrawals(user_id,created);
        """)


    def debit_fee(uid,operation_id):
        row=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
        current=Decimal(str(row['balance'])) if row else Decimal('0')
        if current < FEE_GRAM:
            abort(409,description='Для вывода необходимо 0,4 GRAM на балансе Crafter')
        after=current-FEE_GRAM
        db().execute('INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) '
                     'ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance',
                     (uid,str(after)))
        db().execute('INSERT INTO nft_withdraw_fee_receipts(id,user_id,amount,status) '
                     'VALUES(?,?,?,?)',(operation_id,uid,str(FEE_GRAM),'charged'))
        return after

    def refund_fee(uid,operation_id):
        receipt=db().execute('SELECT amount,status FROM nft_withdraw_fee_receipts '
                             'WHERE id=? AND user_id=?',(operation_id,uid)).fetchone()
        if not receipt or receipt['status']!='charged':
            return False
        row=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
        previous=Decimal(str(row['balance'])) if row else Decimal('0')
        db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                     (str(previous+Decimal(receipt['amount'])),uid))
        db().execute('UPDATE nft_withdraw_fee_receipts SET status=? WHERE id=?',
                     ('refunded',operation_id))
        return True

    # Used by partner-withdrawal fallback. It only queues verified inventory gifts
    # after a custody lookup, and shares the same transaction/idempotency guard.
    def queue_manual(uid,gift_id,rid,allow_partner=False,reason=''):
        wid='gw-'+str(uid)+'-'+rid
        with db():
            db().execute('BEGIN IMMEDIATE')
            old=db().execute('SELECT gift_id,status,payload FROM gift_withdrawals '
                             'WHERE id=? AND user_id=?',(wid,uid)).fetchone()
            if old:
                if old['gift_id']!=gift_id:
                    abort(409,description='Этот номер заявки уже использован')
                return {'id':wid,'status':old['status'],'mode':'manual','fee_gram':str(FEE_GRAM),
                        'balance':json.loads(old['payload']).get('balance_after')}
            row=db().execute('SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?',
                             (uid,gift_id)).fetchone()
            if not row or row['status']!='unlisted':
                abort(409,description='Подарок недоступен для вывода')
            gift=json.loads(row['payload'])
            if gift.get('catalog_only') or gift.get('test_only'):
                abort(409,description='Тестовый NFT нельзя вывести')
            relayer=(gift.get('origin')=='telegram-deposit' and
                     _TELEGRAM_NFT.fullmatch(str(gift.get('telegram_url') or '')))
            fallback=(allow_partner and gift.get('origin')=='portals-partner')
            if not relayer and not fallback:
                abort(409,description='Нужен подтверждённый подарок Relayer или Portals')
            after=debit_fee(uid,wid)
            now=int(time.time())
            payload={'gift':gift,'receiver_user_id':uid,
                     'receiver_username':g.user.get('username') or '',
                     'fee_gram':str(FEE_GRAM),'balance_after':str(after),
                     'custody_check':reason or 'relayer-account'}
            db().execute('INSERT INTO gift_withdrawals VALUES(?,?,?,?,?,?,?,?)',
                         (wid,uid,gift_id,json.dumps(payload,ensure_ascii=False),
                          'queued',now,now,reason[:500]))
            db().execute("UPDATE inventory SET status='withdrawing' "
                         "WHERE user_id=? AND nft_id=? AND status='unlisted'",(uid,gift_id))
            record('gift_withdraw_requested',payload)
        return {'id':wid,'status':'queued','mode':'manual','fee_gram':str(FEE_GRAM),
                'balance':str(after)}

    app.extensions['crafter_nft_queue_manual']=queue_manual
    app.extensions['crafter_nft_debit_fee']=debit_fee
    app.extensions['crafter_nft_refund_fee']=refund_fee


    @app.post('/api/gifts/withdraw')
    @auth()
    def request_gift_withdrawal():
        data=request.get_json(silent=True)
        if not isinstance(data,dict):
            abort(400)
        gift_id,rid=data.get('gift_id'),data.get('request_id')
        if not isinstance(gift_id,str) or not 1<=len(gift_id)<=200:
            abort(400,description='Некорректный подарок')
        if not isinstance(rid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',rid):
            abort(400,description='Некорректный номер заявки')
        if app.config['DEMO_MODE']:
            abort(409,description='Вывод демоподарков недоступен')
        return queue_manual(g.user['id'],gift_id,rid)

    @app.get('/api/admin/withdrawals')
    @app.get('/api/admin/withdrawals/nft')
    @app.get('/api/admin/withdrawals/ton')
    @auth(admin=True)
    def admin_withdrawals():
        ton = []
        for row in db().execute("""SELECT t.id,t.user_id,t.payload,t.status,t.created,t.tx,
                u.name,u.username FROM ton_withdrawals t
                LEFT JOIN users u ON u.id=t.user_id
                ORDER BY t.created DESC,t.id DESC LIMIT 150"""):
            entry = json.loads(row['payload'])
            ton.append({'id': row['id'], 'user_id': row['user_id'],
                        'name': row['name'], 'username': row['username'],
                        'status': row['status'], 'created': row['created'],
                        'tx': row['tx'], 'gram': entry.get('gram'),
                        'ton': entry.get('ton'), 'network': entry.get('network'),
                        'receiver': entry.get('receiver'), 'sender': entry.get('sender')})
        gifts = []
        for row in db().execute("""SELECT w.id,w.user_id,w.gift_id,w.payload,w.status,w.created,
                w.note,u.name,u.username FROM gift_withdrawals w
                LEFT JOIN users u ON u.id=w.user_id
                ORDER BY w.created DESC,w.id DESC LIMIT 150"""):
            entry = json.loads(row['payload'])
            gifts.append({'id': row['id'], 'user_id': row['user_id'],
                          'name': row['name'], 'username': row['username'],
                          'status': row['status'], 'created': row['created'],
                          'note': row['note'],
                          'mode':'manual', 'fee_gram':entry.get('fee_gram','0'),
                          'gift': entry.get('gift', {}),
                          'receiver_user_id': entry.get('receiver_user_id'),
                          'receiver_username': entry.get('receiver_username')})
        if request.path.endswith('/nft'):
            return {'ton': [], 'gifts': gifts}
        if request.path.endswith('/ton'):
            return {'ton': ton, 'gifts': []}
        return {'ton': ton, 'gifts': gifts}

    @app.post('/api/admin/withdrawals/gift/<wid>/resolve')
    @auth(admin=True)
    def resolve_gift_withdrawal(wid):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or data.get('decision') not in ('confirmed', 'failed'):
            abort(400)
        note = str(data.get('note') or '').strip()
        if len(note) > 500:
            abort(400, description='Комментарий слишком длинный')
        decision = data['decision']
        if decision == 'confirmed' and len(note) < 8:
            abort(400, description='Укажите ссылку на перевод NFT или идентификатор подтверждения (не менее 8 символов)')
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute('SELECT * FROM gift_withdrawals WHERE id=?', (wid,)).fetchone()
            if not row:
                abort(404, description='Заявка не найдена')
            if row['status'] != 'queued':
                abort(409, description='Заявка уже обработана')
            data = json.loads(row['payload'])
            owner = row['user_id']
            gift = data['gift']
            owned = db().execute('SELECT status FROM inventory WHERE user_id=? AND nft_id=?',
                                 (owner, row['gift_id'])).fetchone()
            if not owned or owned['status'] != 'withdrawing':
                abort(409, description='Статус подарка изменился. Требуется ручная проверка.')
            if decision == 'confirmed':
                db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='withdrawing'",
                             (owner, row['gift_id']))
                record('withdraw', {'gift': gift, 'receiver_user_id': data['receiver_user_id'],
                                    'confirmation': note}, uid=owner)
            else:
                db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='withdrawing'",
                             (owner, row['gift_id']))
                if refund_fee(owner,wid):
                    record('nft_withdraw_fee_refunded',{'withdrawal_id':wid,'amount':str(FEE_GRAM)},uid=owner)
                record('gift_withdraw_failed', {'gift': gift, 'reason': note}, uid=owner)
            db().execute('UPDATE gift_withdrawals SET status=?,updated=?,note=? WHERE id=?',
                         (decision, int(time.time()), note, wid))
            audit('NFT withdrawal ' + wid + ' manually marked ' + decision)
        return {'status': decision}
