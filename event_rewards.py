"""Admin-approved distribution of real inventory gifts from the internal Craft Market.

This deliberately does not claim to buy Telegram NFTs from the external
Portals marketplace. A real seller-owned inventory item is transferred only
after its internal sale has settled and the sponsor's GRAM is debited.
"""
import json
import time
from decimal import Decimal, InvalidOperation
from flask import abort, g, request
from resale import cap_funded_balance


def install_event_rewards(app, db, auth, record, canonical_name, listing, ranking,
                          available_lot, settle_lot, notify_sale):
    with app.app_context():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS crafter_event_awards (
          event_id TEXT NOT NULL,
          place INTEGER NOT NULL,
          recipient INTEGER NOT NULL,
          lot_id TEXT NOT NULL,
          price TEXT NOT NULL,
          sponsor INTEGER NOT NULL,
          created INTEGER NOT NULL,
          PRIMARY KEY(event_id,place)
        );
        CREATE INDEX IF NOT EXISTS crafter_event_awards_recipient
          ON crafter_event_awards(recipient,created);
        """)

    def get_event(event_id):
        import re
        if not re.fullmatch(r'[0-9a-f]{32}', event_id):
            abort(404)
        event = next((item for item in listing(admin=True) if item['id'] == event_id), None)
        if not event:
            abort(404, description='Событие не найдено')
        if not event['enabled'] or int(time.time()) <= event['end_at']:
            abort(409, description='Награды можно выдавать только после завершения опубликованного события')
        return event

    def eligible_gifts():
        return db().execute("""
          SELECT l.*,i.payload FROM crafter_listings l JOIN inventory i
            ON i.user_id=l.seller_id AND i.nft_id=l.gift_id AND i.status='listed'
        """).fetchall()

    def plan(event, sponsor):
        leaders = {int(row['rank']): int(row['id']) for row in ranking(event, 100)}
        existing = {int(row['place']): row for row in db().execute(
            'SELECT * FROM crafter_event_awards WHERE event_id=?', (event['id'],))}
        candidates = eligible_gifts()
        used = set()
        awards = []
        total = Decimal('0')
        for prize in event['prizes']:
            place = int(prize['place'])
            if prize['type'] not in ('collection', 'model') or place not in leaders:
                continue
            winner = leaders[place]
            if place in existing:
                past = existing[place]
                awards.append({'place':place,'recipient':winner,'status':'issued',
                               'lot_id':past['lot_id'],'price':past['price']})
                continue
            key = canonical_name(prize.get('collection',''))
            model = canonical_name(prize.get('model','')) if prize['type']=='model' else ''
            choices = []
            for lot in candidates:
                if lot['id'] in used or lot['seller_id'] == winner:
                    continue
                try:
                    gift = json.loads(lot['payload'])
                    price = Decimal(lot['price'])
                    if not price.is_finite() or price <= 0 or gift.get('catalog_only'):
                        continue
                    collection_match = (key in (
                        canonical_name(gift.get('name','')),
                        canonical_name(gift.get('collection_id',''))))
                    model_match = not model or canonical_name(gift.get('model','')) == model
                    if collection_match and model_match:
                        choices.append((price, int(lot['listed_at']),lot,gift))
                except (ValueError,TypeError,InvalidOperation):
                    continue
            choices.sort(key=lambda row: (row[0],row[1],row[2]['id']))
            if not choices:
                awards.append({'place':place,'recipient':winner,'status':'unavailable',
                               'collection':prize['collection'],'model':prize.get('model','')})
                continue
            price,_,lot,gift = choices[0]
            used.add(lot['id'])
            total += price
            awards.append({'place':place,'recipient':winner,'status':'ready',
                           'collection':prize['collection'],'model':prize.get('model',''),
                           'gift_name':gift.get('name',''),'gift_number':gift.get('number',''),
                           'lot_id':lot['id'],'price':str(price)})
        row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?',(sponsor,)).fetchone()
        balance = Decimal(row[0]) if row else Decimal(0)
        return {'event_id':event['id'],'awards':awards,'total':str(total),
                'balance':str(balance),'all_available':not any(
                  award['status']=='unavailable' for award in awards)}

    @app.get('/api/admin/events/<event_id>/awards/preview')
    @auth(admin=True)
    def preview_awards(event_id):
        event = get_event(event_id)
        return plan(event,g.user['id'])

    @app.post('/api/admin/events/<event_id>/awards/distribute')
    @auth(admin=True)
    def distribute_awards(event_id):
        incoming = request.get_json(silent=True)
        if not isinstance(incoming,dict) or not isinstance(incoming.get('quotes'),list):
            abort(400,description='Сначала проверьте цены и получателей')
        sponsor = g.user['id']
        notifications = []
        with db():
            connection = db()
            connection.execute('BEGIN IMMEDIATE')
            event = get_event(event_id)
            preview = plan(event,sponsor)
            if not preview['all_available']:
                abort(409,description='Некоторые призы недоступны. Обновите предварительный расчёт')
            pending = [row for row in preview['awards'] if row['status']=='ready']
            if not pending:
                abort(409,description='Нет призов для выдачи')
            expected = [(row['place'],row['recipient'],row['lot_id'],row['price'])
                        for row in pending]
            try:
                provided = [(int(row['place']),int(row['recipient']),row['lot_id'],str(row['price']))
                            for row in incoming['quotes']]
                maximum = Decimal(str(incoming.get('max_total_gram','')))
            except (TypeError,KeyError,ValueError,InvalidOperation,OverflowError):
                abort(400,description='Неверные данные подтверждения')
            if provided != expected:
                abort(409,description='Список победителей или цены изменились. Повторите проверку')
            total = Decimal(preview['total'])
            if not maximum.is_finite() or maximum <= 0 or maximum > Decimal('1000000'):
                abort(400,description='Укажите лимит бюджета от 0,01 до 1 000 000 GRAM')
            if total > maximum:
                abort(409,description='Стоимость призов превышает подтверждённый бюджет')
            balance = Decimal(preview['balance'])
            if total > balance:
                abort(409,description='Недостаточно GRAM на балансе администратора')
            cap_funded_balance(connection,sponsor,balance-total)
            connection.execute('UPDATE demo_accounts SET balance=? WHERE user_id=?',
                               (str(balance-total),sponsor))
            for row in pending:
                lot = available_lot(row['lot_id'],row['recipient'])
                if Decimal(lot['price']) != Decimal(row['price']):
                    abort(409,description='Цена лота изменилась')
                trade = settle_lot(lot,row['recipient'],'event_award')
                connection.execute(
                    'INSERT INTO crafter_event_awards VALUES(?,?,?,?,?,?,?)',
                    (event_id,row['place'],row['recipient'],row['lot_id'],
                     row['price'],sponsor,int(time.time())))
                record('event_prize_received',{
                    'event_id':event_id,'place':row['place'],
                    'gift':trade['gift'],'price':row['price'],
                    'sponsor':sponsor},uid=row['recipient'])
                record('event_prize_purchased',{
                    'event_id':event_id,'place':row['place'],
                    'gift':trade['gift'],'price':row['price'],
                    'recipient':row['recipient']},uid=sponsor)
                notifications.append((lot['seller_id'],trade))
        for seller,trade in notifications:
            try:
                notify_sale(seller,trade)
            except Exception:
                app.logger.warning('Could not notify seller about event reward purchase')
        return {'ok':True,'issued':len(notifications),'total':str(total),
                'message':'Подарки выкуплены из Craft Market и зачислены победителям'}
