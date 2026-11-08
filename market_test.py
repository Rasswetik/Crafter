"""Non-financial gift-preview purchases for the temporary testing period.

Never use a displayed market price to debit real GRAM or claim NFT custody.
Test gifts are visible in inventory, but cannot be traded or withdrawn.
"""
import json
import re
import time
import uuid

from flask import abort, g, request


def install_market_test(app, db, auth, record, demo_gifts):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS market_test_receipts(
            user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            payload TEXT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY(user_id,request_id)
        );
        """)

    @app.post('/api/market/test/buy')
    @auth()
    def buy_test_gifts():
        if not app.config.get('MARKET_TEST_PURCHASES', False):
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
            rewards=[]
            for nft_id in ids:
                original=found[nft_id]
                if not original.get('name') or original.get('catalog_only'):
                    abort(409,description='Выбранная модель пока не доступна')
                gift={**original,'id':'market-test-'+uuid.uuid4().hex,'source_id':nft_id,
                      'origin':'market-test','test_only':True,'catalog_only':True,
                      'source_price':str(original.get('price','')),
                      'price':'0','price_unit':'GRAM'}
                # Use only authoritative link in fetched data: never invent NFT custody.
                link=gift.get('telegram_url')
                if not isinstance(link,str) or not re.fullmatch(
                        r'https://t\.me/nft/[a-z0-9]+-[1-9][0-9]*',link,re.I):
                    gift.pop('telegram_url',None)
                db().execute(
                    "INSERT INTO inventory(user_id,nft_id,payload,status) VALUES(?,?,?,'unlisted')",
                    (uid,gift['id'],json.dumps(gift,ensure_ascii=False)))
                record('market_test_buy',{'gift':gift,'source_id':nft_id,
                                          'test_mode':True},uid=uid)
                rewards.append(gift)
            balance=db().execute(
                'SELECT balance FROM demo_accounts WHERE user_id=?',(uid,)).fetchone()
            result={'ok':True,'gifts':rewards,'balance':str(balance[0]) if balance else '0',
                    'test_mode':True,'total':'0'}
            db().execute(
                'INSERT INTO market_test_receipts(user_id,request_id,payload,result) VALUES(?,?,?,?)',
                (uid,rid,json.dumps(normalized_ids),json.dumps(result,ensure_ascii=False)))
        return result
