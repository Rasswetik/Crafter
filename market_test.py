"""Non-financial gift-preview purchases for the temporary testing period.

Never use a displayed market price to debit real GRAM or claim NFT custody.
Test gifts are visible in inventory, but cannot be traded or withdrawn.
"""
import json
import re
import time
import uuid
from decimal import Decimal, InvalidOperation, ROUND_UP

from flask import abort, g, request


def install_market_test(app, db, auth, record, demo_gifts):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS market_test_receipts(
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            payload TEXT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY(user_id,request_id)
        );
        CREATE TABLE IF NOT EXISTS market_test_sale_receipts(
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            gift_id TEXT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY(user_id,request_id), UNIQUE(user_id,gift_id)
        );
        """)

    @app.post('/api/market/test/buy')
    @auth()
    def buy_test_gifts():
        if app.extensions['crafter_purchase_mode']() != 'test':
            abort(409,description='Тестовые покупки отключены')
        data=request.get_json(silent=True) or {}
        ids=data.get('gift_ids')
        rid=data.get('request_id')
        if (not isinstance(ids,list) or not 1<=len(ids)<=20
                or any(not isinstance(item,str) or not 1<=len(item)<=180 for item in ids)
                or len(set(ids))!=len(ids)
                or not isinstance(rid,str) or not re.fullmatch(r'[A-Za-z0-9:_-]{8,100}',rid)):
            abort(400,description='Проверьте выбранные подарки')
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            old=db().execute(
                'SELECT payload,result FROM market_test_receipts WHERE user_id=? AND request_id=?',
                (uid,rid)).fetchone()
            normalized_ids=sorted(ids)
            if old:
                if json.loads(old['payload']) != normalized_ids:
                    abort(409,description='Номер покупки уже использован')
                return json.loads(old['result'])
            existing=db().execute(
                "SELECT count(*) FROM inventory WHERE user_id=? AND nft_id LIKE 'market-test-%'",
                (uid,)).fetchone()[0]
            if existing+len(ids)>100:
                abort(409,description='Достигнут лимит тестового инвентаря')
            found={item['id']:item for item in demo_gifts if item['id'] in ids}
            for row in db().execute(
                "SELECT payload FROM cache WHERE key LIKE 'public:market:%' OR key LIKE 'market:%' "
                "ORDER BY updated DESC LIMIT 120"):
                try:items=json.loads(row['payload']).get('gifts',[])
                except (TypeError,ValueError):continue
                for item in items:
                    if item.get('id') in ids and item['id'] not in found and not item.get('catalog_only'):
                        found[item['id']]=item
                if len(found)==len(ids):break
            if len(found)!=len(ids):
                abort(409,description='Обновите маркет и повторите покупку')
            # The player's GRAM balance is always checked and debited; only the market check is skipped.
            ratio=Decimal(str(app.extensions['crafter_new_year_trade_conversion']()))
            def gram_price(item):
                unit=item.get('source_price_unit',item.get('price_unit','GRAM'))
                try:value=Decimal(str(item.get('source_price',item.get('price','0'))))
                except InvalidOperation:abort(409,description='Нет цены подарка')
                return value*ratio if unit=='TON' else value
            total=sum((gram_price(found[i]) for i in ids),Decimal(0)).quantize(Decimal('0.01'),rounding=ROUND_UP)
            if total<=0:abort(409,description='Нет цены подарка')
            account=db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
            balance_now=Decimal(str(account[0])) if account else Decimal(0)
            if total>balance_now:
                abort(409,description='Недостаточно GRAM: нужно %s, на балансе %s'%(total,balance_now.quantize(Decimal('0.01'))))
            from resale import cap_funded_balance
            cap_funded_balance(db(),uid,balance_now-total)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',(str(balance_now-total),uid))
            rewards=[]
            for nft_id in ids:
                original=found[nft_id]
                if not original.get('name') or original.get('catalog_only'):
                    abort(409,description='Выбранная модель пока не доступна')
                gift={**original,'id':'market-test-'+uuid.uuid4().hex,'source_id':nft_id,
                      'origin':'market-test','test_only':True,'catalog_only':True,
                      'source_price':str(original.get('source_price',original.get('price',''))),
                      'source_price_unit':original.get('source_price_unit',original.get('price_unit','GRAM')),
                      'price':'0','price_unit':'GRAM'}
                # Use only authoritative link in fetched data: never invent NFT custody.
                link=gift.get('telegram_url')
                if not isinstance(link,str) or not re.fullmatch(
                        r'https://t\.me/nft/[a-z0-9]+-[1-9][0-9]*',link,re.I):
                    gift.pop('telegram_url',None)
                db().execute(
                    "INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted')",
                    (uid,gift['id'],json.dumps(gift,ensure_ascii=False)))
                raw_price=original.get('source_price',original.get('price','0'))
                raw_unit=original.get('source_price_unit',original.get('price_unit','GRAM'))
                if raw_unit not in ('TON','GRAM'):raw_unit='GRAM'
                record('market_test_buy',{'gift':gift,'source_id':nft_id,
                                          'price':str(raw_price),'price_unit':raw_unit,
                                          'scope':'preview','test_mode':True},uid=uid)
                rewards.append(gift)
            balance=db().execute(
                'SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
            result={'ok':True,'gifts':rewards,'balance':str(balance[0]) if balance else '0',
                    'test_mode':True,'total':'0'}
            db().execute(
                'INSERT INTO market_test_receipts(user_id,request_id,payload,result) VALUES(?,?,?,?)',
                (uid,rid,json.dumps(normalized_ids),json.dumps(result,ensure_ascii=False)))
        return result


    @app.post('/api/market/test/sell')
    @auth()
    def sell_test_gift():
        """Simulated sale of a preview collectible; never creates a public market lot."""
        if app.extensions['crafter_purchase_mode']() != 'test':
            abort(409,description='Демонстрационные продажи отключены')
        data=request.get_json(silent=True) or {}
        gift_id,rid=data.get('gift_id'),data.get('request_id')
        if (not isinstance(gift_id,str) or not 1<=len(gift_id)<=200 or
            not isinstance(rid,str) or not re.fullmatch(r'[A-Za-z0-9:_-]{8,100}',rid)):
            abort(400,description='Некорректный тестовый подарок')
        try:
            price=Decimal(str(data.get('price','0')))
        except (InvalidOperation,ValueError,TypeError):
            abort(400,description='Укажите стоимость тестовой продажи')
        if not price.is_finite() or price<Decimal('0.01') or price>Decimal('1000000') or price!=price.quantize(Decimal('0.01')):
            abort(400,description='Тестовая цена: 0,01–1 000 000,00')
        uid=g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            old=db().execute("SELECT gift_id,result FROM market_test_sale_receipts WHERE user_id=? AND request_id=?",
                             (uid,rid)).fetchone()
            if old:
                if old['gift_id']!=gift_id:
                    abort(409,description='Номер операции использован другим подарком')
                return json.loads(old['result'])
            row=db().execute("SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?",
                             (uid,gift_id)).fetchone()
            if not row or row['status']!='unlisted':
                abort(409,description='Тестовый подарок уже использован')
            gift=json.loads(row['payload'])
            if not gift.get('test_only') or gift.get('origin') not in ('market-test','demo-craft'):
                abort(409,description='Настоящие NFT нельзя продать через демо-операцию')
            unit=gift.get('source_price_unit','GRAM')
            if unit not in ('TON','GRAM'):
                abort(409,description='Невозможно определить валюту тестовой оценки')
            db().execute('DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status=?',
                         (uid,gift_id,'unlisted'))
            record('market_test_sale',{'gift':gift,'price':str(price),'price_unit':unit,
                                       'scope':'preview','test_mode':True},uid=uid)
            result={'ok':True,'gift_id':gift_id,'price':str(price),
                    'price_unit':unit,'test_mode':True}
            db().execute("INSERT INTO market_test_sale_receipts(user_id,request_id,gift_id,result) VALUES(?,?,?,?)",
                         (uid,rid,gift_id,json.dumps(result)))
        return result
