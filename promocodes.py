"""Administrative GRAM or seasonal-ball promo rewards."""
import json
import secrets
import re
import string
import time
import uuid
from decimal import Decimal, InvalidOperation

from flask import abort, g, request

ALPHABET='0123456789'
AMOUNT_PRECISION=Decimal('0.000001')

def to_amount(value):
    try:amount=Decimal(str(value))
    except (ValueError, TypeError, InvalidOperation):abort(400,description='Некорректная сумма награды')
    if not amount.is_finite() or amount<Decimal('0.000001') or amount>Decimal('100000'):
        abort(400,description='Награда должна быть от 0.000001 до 100000 GRAM')
    if amount!=amount.quantize(AMOUNT_PRECISION):
        abort(400,description='Максимум 6 знаков после запятой')
    return amount

def install_promocodes(app, db, auth, record, audit):
    with app.app_context(),db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS promo_codes(
                code TEXT PRIMARY KEY, reward TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'GRAM',
                uses_limit BIGINT NOT NULL, used BIGINT NOT NULL DEFAULT 0,
                active BIGINT NOT NULL DEFAULT 1, created_by BIGINT NOT NULL,
                created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS promo_claims(
                code TEXT NOT NULL, user_id BIGINT NOT NULL, claimed_at BIGINT NOT NULL,
                reward TEXT NOT NULL, PRIMARY KEY(code,user_id)
            );
        """)
        # Existing production promo codes are always denominated in GRAM.
        # Add the field without rebuilding the table or losing usage history.
        database=db()
        if hasattr(database,'connection') and not isinstance(database.connection,type(None)):
            database.execute("ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GRAM'")
        else:
            columns=[row['name'] for row in database.execute("PRAGMA table_info(promo_codes)").fetchall()]
            if 'currency' not in columns:
                database.execute("ALTER TABLE promo_codes ADD COLUMN currency TEXT NOT NULL DEFAULT 'GRAM'")

    @app.get('/api/admin/promocodes')
    @auth(admin=True)
    def promo_admin_list():
        rows=db().execute("SELECT * FROM promo_codes ORDER BY created DESC LIMIT 300").fetchall()
        return {'codes':[dict(row) for row in rows]}

    @app.post('/api/admin/promocodes')
    @auth(admin=True)
    def promo_create():
        body=request.get_json(silent=True) or {}
        code=str(body.get('code') or '').strip().upper()
        if code and (not re.fullmatch(r'[A-Z0-9_-]{4,32}',code)):
            abort(400,description='Код: 4–32 символа, латинские буквы, цифры и _ -')
        try:limit=int(body.get('limit',0))
        except (TypeError, ValueError):abort(400,description='Неверный лимит активаций')
        if str(body.get('limit',0))!=str(limit) or not 1<=limit<=1000000:
            abort(400,description='Количество активаций: 1–1000000')
        currency=body.get('currency','GRAM')
        if currency not in ('GRAM','BALL'):
            abort(400,description='Тип награды: основной баланс или новогодние шары')
        if currency=='GRAM':
            reward=str(to_amount(body.get('reward')))
        else:
            raw=body.get('reward')
            try: balls=int(raw)
            except (ValueError,TypeError):abort(400,description='Введите целое число шаров')
            if str(raw)!=str(balls) or not 1<=balls<=1000000000:
                abort(400,description='Награда: от 1 до 1 000 000 000 шаров')
            reward=str(balls)
        with db():
            db().execute('BEGIN IMMEDIATE')
            if code:
                if db().execute("SELECT 1 FROM promo_codes WHERE code=?",(code,)).fetchone():
                    abort(409,description='Промокод уже существует')
            else:
                for _ in range(20):
                    generated=''.join(secrets.choice(ALPHABET) for _ in range(8))
                    if not db().execute("SELECT 1 FROM promo_codes WHERE code=?",(generated,)).fetchone():
                        code=generated;break
                if not code:abort(503,description='Не удалось создать уникальный код')
            db().execute(
                "INSERT INTO promo_codes(code,reward,currency,uses_limit,used,active,created_by,created) "
                "VALUES(?,?,?,?,0,1,?,?)",
                (code,reward,currency,limit,g.user['id'],int(time.time())))
        audit('Promo created '+code)
        return {'ok':True,'code':code,'reward':reward,'currency':currency,'limit':limit}

    @app.post('/api/admin/promocodes/<code>/status')
    @auth(admin=True)
    def promo_toggle(code):
        body=request.get_json(silent=True) or {}
        enabled=body.get('active')
        if type(enabled) is not bool:abort(400,description='Укажите статус')
        with db():
            changed=db().execute(
                "UPDATE promo_codes SET active=? WHERE code=?",(int(enabled),code)).rowcount
            if not changed:abort(404,description='Промокод не найден')
        audit('Promo '+code+(' enabled' if enabled else ' disabled'))
        return {'ok':True,'active':enabled}

    @app.post('/api/promocodes/redeem')
    @auth()
    def redeem_code():
        body=request.get_json(silent=True) or {}
        code=body.get('code')
        if not isinstance(code,str) or not re.fullmatch(r'[A-Za-z0-9_-]{4,32}',code.strip()):
            abort(400,description='Неверный промокод')
        code=code.strip().upper()
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            row=db().execute("SELECT * FROM promo_codes WHERE code=?",(code,)).fetchone()
            if not row:abort(404,description='Промокод не найден')
            if db().execute("SELECT 1 FROM promo_claims WHERE code=? AND user_id=?",
                            (code,uid)).fetchone():
                abort(409,description='Этот промокод уже активирован')
            owner=row['owner_id'] if 'owner_id' in row.keys() else None
            if owner is not None and int(owner)!=int(uid):
                abort(403,description='Этот промокод привязан к другому игроку')
            if not row['active'] or row['used']>=row['uses_limit']:
                abort(409,description='Промокод недействителен или активации закончились')
            if db().execute(
                "UPDATE promo_codes SET used=used+1 WHERE code=? AND active=1 AND used<uses_limit",
                (code,)).rowcount!=1:
                abort(409,description='Активации закончились')
            currency=row['currency'] or 'GRAM'
            account=db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",(uid,)).fetchone()
            before=Decimal(str(account['balance'])) if account else Decimal('0')
            after=before
            new_year_balance=None
            if currency=='BALL':
                wallet=db().execute("SELECT balls,donate,tinsel FROM new_year_wallets WHERE user_id=?",(uid,)).fetchone()
                count=int(wallet['balls']) if wallet else 0
                updated=count+int(row['reward'])
                if updated>1000000000:
                    abort(409,description='Баланс новогодних шаров превысит максимальное значение')
                db().execute("INSERT INTO new_year_wallets(user_id,balls) VALUES(?,?) "
                             "ON CONFLICT(user_id) DO UPDATE SET balls=excluded.balls",(uid,updated))
                new_year_balance={'balls':updated,'donate':int(wallet['donate']) if wallet else 0,
                                  'tinsel':int(wallet['tinsel']) if wallet else 0}
            else:
                after=before+Decimal(row['reward'])
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) "
                             "ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
                             (uid,str(after)))
            db().execute("INSERT INTO promo_claims(code,user_id,claimed_at,reward) VALUES(?,?,?,?)",
                         (code,uid,int(time.time()),row['reward']))
            record('promo_redeem',{'code':code,'reward':row['reward'],'currency':currency,
                                   'balance_after':str(after),'new_year_balance':new_year_balance},uid=uid)
        return {'ok':True,'reward':row['reward'],'balance':str(after),
                'currency':currency,'new_year_balance':new_year_balance}
