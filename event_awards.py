"""Safe admin-confirmed event NFT awards from real Craft Market listings.

No synthetic NFTs: a listed NFT is transferred to the rank winner only after
the administrator explicitly approves the current quoted price.
"""
import json
import time
from decimal import Decimal, InvalidOperation
from flask import request, abort, g


def install_event_awards(app, db, auth, audit, ranking, record, canonical_name,
                         available_lot, settle_lot, notify_purchase, notify_sale):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS crafter_event_awards (
                event_id TEXT NOT NULL,
                place INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                nft_id TEXT NOT NULL,
                lot_id TEXT NOT NULL,
                price TEXT NOT NULL,
                payer_id INTEGER NOT NULL,
                created INTEGER NOT NULL,
                PRIMARY KEY(event_id,place)
            );
        """)

    def event_and_prize(event_id, place):
        if not isinstance(place, int) or not 1 <= place <= 100:
            abort(400, description='Недопустимое призовое место')
        event = db().execute("SELECT * FROM crafter_events WHERE id=?", (event_id,)).fetchone()
        if not event:
            abort(404, description='Событие не найдено')
        if not event['enabled'] or int(event['end_at']) >= int(time.time()):
            abort(409, description='Выдача возможна только после завершения опубликованного события')
        prizes = json.loads(event['prizes'])
        prize = prizes[place-1] if len(prizes) >= place else {}
        if prize.get('type') not in ('collection', 'model'):
            abort(409, description='Для этого места не выбрана награда-коллекция или модель')
        if not prize.get('collection') or (prize.get('type') == 'model' and not prize.get('model')):
            abort(409, description='Выберите коллекцию и модель награды')
        board = ranking(event)
        winner = next((row for row in board if row['rank'] == place), None)
        if not winner:
            abort(409, description='Для этого места пока нет победителя')
        return prize, winner

    def cheapest(prize, winner_id):
        target=canonical_name(prize['collection'])
        model=canonical_name(prize.get('model',''))
        lots=db().execute("""SELECT l.*,i.payload FROM crafter_listings l
            JOIN inventory i ON i.user_id=l.seller_id
             AND i.nft_id=l.gift_id AND i.status='listed'""").fetchall()
        matches=[]
        for lot in lots:
            if int(lot['seller_id'])==winner_id:
                continue
            try:
                gift=json.loads(lot['payload'])
                if canonical_name(gift.get('name',''))!=target and canonical_name(gift.get('collection_id',''))!=target:
                    continue
                if model and canonical_name(gift.get('model',''))!=model:
                    continue
                amount=Decimal(str(lot['price']))
                if not amount.is_finite() or amount<=0:
                    continue
                matches.append((amount,lot))
            except (ValueError, TypeError, InvalidOperation):
                continue
        matches.sort(key=lambda x:(x[0],str(x[1]['id'])))
        return matches[0] if matches else (None,None)

    def receipt(event_id,place):
        row=db().execute("SELECT * FROM crafter_event_awards WHERE event_id=? AND place=?",
                         (event_id,place)).fetchone()
        return dict(row) if row else None

    @app.get('/api/admin/events/<event_id>/award/<int:place>')
    @auth(admin=True)
    def quote_event_award(event_id,place):
        existing=receipt(event_id,place)
        if existing:
            return {'status':'delivered','receipt':existing}
        prize,winner=event_and_prize(event_id,place)
        price,lot=cheapest(prize,int(winner['id']))
        account=db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",
                             (g.user['id'],)).fetchone()
        balance=Decimal(account['balance']) if account else Decimal(0)
        return {'status':'available' if lot else 'unavailable',
                'winner':winner,'prize':prize,
                'lot_id':lot['id'] if lot else None,
                'price_gram':str(price) if price is not None else None,
                'payer_balance_gram':str(balance),'source':'crafter'}

    @app.post('/api/admin/events/<event_id>/award/<int:place>')
    @auth(admin=True)
    def deliver_event_award(event_id,place):
        data=request.get_json(silent=True) or {}
        if not isinstance(data,dict) or data.get('confirm') is not True:
            abort(400,description='Подтвердите покупку приза')
        lot_id=data.get('lot_id')
        expected=data.get('expected_price_gram')
        if not isinstance(lot_id,str) or not isinstance(expected,str):
            abort(400,description='Запросите актуальную цену перед выдачей')
        payer=int(g.user['id'])
        try:
            requested_price=Decimal(expected)
            if not requested_price.is_finite() or requested_price<=0:
                raise ValueError()
        except (InvalidOperation,ValueError):
            abort(400,description='Некорректная подтверждённая цена')
        trade=None
        seller_id=None
        with db():
            db().execute('BEGIN IMMEDIATE')
            existing=receipt(event_id,place)
            if existing:
                return {'ok':True,'status':'already_delivered','receipt':existing}
            prize,winner=event_and_prize(event_id,place)
            winner_id=int(winner['id'])
            price,lot=cheapest(prize,winner_id)
            if lot is None:
                abort(409,description='Подходящий NFT больше не продаётся')
            if lot['id']!=lot_id or price!=requested_price:
                abort(409,description='Самый дешёвый лот или его цена изменились. Обновите предложение')
            lot=available_lot(lot_id,winner_id)
            balance_row=db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",
                                     (payer,)).fetchone()
            balance=Decimal(balance_row['balance']) if balance_row else Decimal(0)
            if balance<price:
                abort(409,description='Недостаточно GRAM у администратора для покупки')
            from resale import cap_funded_balance
            cap_funded_balance(db(),payer,balance-price)
            db().execute("""INSERT INTO demo_accounts(user_id,balance) VALUES(?,?)
                ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance""",
                (payer,str(balance-price)))
            seller_id=int(lot['seller_id'])
            trade=settle_lot(lot,winner_id,'event-award',price)
            gift=trade['gift']
            db().execute("""INSERT INTO crafter_event_awards
                (event_id,place,user_id,nft_id,lot_id,price,payer_id,created)
                VALUES(?,?,?,?,?,?,?,?)""",
                (event_id,place,winner_id,lot['gift_id'],lot_id,str(price),payer,int(time.time())))
            record('gift_received',{'gift':gift,'event_id':event_id,'place':place,
                                    'price':str(price),'scope':'event_award'},uid=winner_id)
            record('event_award_paid',{'gift':gift,'event_id':event_id,
                                       'place':place,'user_id':winner_id,
                                       'gram':'-'+str(price)},uid=payer)
        audit('Event NFT award purchased: '+event_id+' rank '+str(place))
        try:
            notify_purchase(winner_id,trade)
        except Exception:
            app.logger.warning('Event award winner notification failed')
        try:
            notify_sale(seller_id,trade)
        except Exception:
            app.logger.warning('Event award seller notification failed')
        return {'ok':True,'status':'delivered','gift':trade['gift'],
                'price_gram':str(price),'winner_id':winner_id}
