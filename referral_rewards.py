"""Five-tier referral commission accrual from verified in-app fees.

Commissions are sourced from actual settled platform fee history, not deposits,
demo purchases, or simulated balances. Referral balances can be moved to GRAM.
"""
import json
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from flask import abort, g, request

TIERS=(5,6,7,8,10)
THRESHOLDS=(0,5,15,30,50)
MIN_WITHDRAW=Decimal('1')
CENT=Decimal('0.000001')

def tier_for(ref_count):
    return max(0,sum(ref_count>=threshold for threshold in THRESHOLDS)-1)

def install_referral_rewards(app,db,auth,record,audit):
    with app.app_context(),db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS referral_balances(
            user_id BIGINT PRIMARY KEY, balance TEXT NOT NULL DEFAULT '0',
            total_earned TEXT NOT NULL DEFAULT '0',
            total_withdrawn TEXT NOT NULL DEFAULT '0'
        );
        CREATE TABLE IF NOT EXISTS referral_earnings(
            history_id TEXT PRIMARY KEY, referred_id BIGINT NOT NULL,
            referrer_id BIGINT NOT NULL, fee TEXT NOT NULL, rate BIGINT NOT NULL,
            reward TEXT NOT NULL, created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS referral_withdrawals(
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(user_id,request_id)
        );
        """)

    def user_snapshot(uid):
        count=db().execute("SELECT count(*) FROM users WHERE referrer=?",(uid,)).fetchone()[0]
        tier=tier_for(int(count))
        row=db().execute("SELECT * FROM referral_balances WHERE user_id=?",(uid,)).fetchone()
        return {'referrals':int(count),'level':tier+1,'rate':TIERS[tier],
                'levels':list(TIERS),'thresholds':list(THRESHOLDS),
                'until_next': max(0,THRESHOLDS[tier+1]-count) if tier<4 else 0,
                'progress': 100 if tier==4 else max(0,min(100,
                   round((count-THRESHOLDS[tier])*100/
                          (THRESHOLDS[tier+1]-THRESHOLDS[tier])))),
                'balance':row['balance'] if row else '0',
                'total_earned':row['total_earned'] if row else '0',
                'total_withdrawn':row['total_withdrawn'] if row else '0',
                'min_withdraw':str(MIN_WITHDRAW)}

    def accrue(uid,history_id,kind,payload):
        if kind not in ('arena_result','sale'):
            return
        # Arena fees are attached only to the winner result.
        try:fee=Decimal(str(payload.get('fee_gram' if kind=='arena_result' else 'fee', '0')))
        except (InvalidOperation,ValueError,TypeError):return
        if not fee.is_finite() or fee<=0 or fee>Decimal('10000000'):
            return
        row=db().execute("SELECT referrer FROM users WHERE id=?",(uid,)).fetchone()
        if not row or not row['referrer'] or row['referrer']==uid:return
        referrer=row['referrer']
        count=db().execute("SELECT count(*) FROM users WHERE referrer=?",(referrer,)).fetchone()[0]
        rate=TIERS[tier_for(int(count))]
        earned=(fee*Decimal(rate)/100).quantize(CENT,rounding=ROUND_DOWN)
        if earned<=0:return
        if not db().execute("INSERT INTO referral_earnings(history_id,referred_id,referrer_id,fee,rate,reward,created) "
                     "VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                     (history_id,uid,referrer,str(fee),rate,str(earned),int(time.time()))).rowcount:
            return
        db().execute("INSERT INTO referral_balances(user_id,balance,total_earned,total_withdrawn) VALUES(?,?,?,?) "
                     "ON CONFLICT(user_id) DO NOTHING",(referrer,'0','0','0'))
        before=db().execute("SELECT balance,total_earned FROM referral_balances WHERE user_id=?",(referrer,)).fetchone()
        db().execute("UPDATE referral_balances SET balance=?,total_earned=? WHERE user_id=?",
                     (str(Decimal(before['balance'])+earned),str(Decimal(before['total_earned'])+earned),referrer))

    @app.get('/api/referrals')
    @auth()
    def referral_status():
        return user_snapshot(g.user['id'])

    @app.post('/api/referrals/withdraw')
    @auth()
    def referral_withdraw():
        body=request.get_json(silent=True) or {}
        rid=body.get('request_id')
        if not isinstance(rid,str) or not 8<=len(rid)<=100 or not all(c.isalnum() or c in '_-' for c in rid):
            abort(400,description='Некорректный номер запроса')
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            prev=db().execute("SELECT result FROM referral_withdrawals WHERE user_id=? AND request_id=?",
                              (uid,rid)).fetchone()
            if prev:return json.loads(prev['result'])
            row=db().execute("SELECT balance,total_withdrawn FROM referral_balances WHERE user_id=?",
                             (uid,)).fetchone()
            amount=Decimal(str(row['balance'])) if row else Decimal('0')
            if amount<MIN_WITHDRAW:
                abort(409,description='Вывод реферальных начислений доступен от 1 GRAM')
            account=db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",(uid,)).fetchone()
            current=Decimal(str(account['balance'])) if account else Decimal('0')
            target=current+amount
            db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) "
                         "ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",(uid,str(target)))
            db().execute("UPDATE referral_balances SET balance='0',total_withdrawn=? WHERE user_id=?",
                         (str(Decimal(row['total_withdrawn'])+amount),uid))
            result={'ok':True,'amount':str(amount),'balance':str(target),'referral_balance':'0'}
            db().execute("INSERT INTO referral_withdrawals(user_id,request_id,result) VALUES(?,?,?)",
                         (uid,rid,json.dumps(result)))
            record('referral_withdraw',{'amount':str(amount),'source':'settled_fee_commission'},uid=uid)
        return result

    return user_snapshot,accrue
