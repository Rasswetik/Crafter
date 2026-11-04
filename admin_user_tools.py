"""Admin tools: gift inventory inspection, ban/unban, inventory correction, audit log.

These actions modify ONLY Crafter's internal ledger. Never transfer Telegram NFTs.
"""
import json
import time

from flask import abort, g, request


def install_admin_user_tools(app, db, auth, audit, record):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS user_bans (
                user_id INTEGER PRIMARY KEY,
                reason TEXT NOT NULL,
                actor INTEGER NOT NULL,
                created INTEGER NOT NULL
            );
        """)

    @app.get('/api/admin/users/<int:uid>/inventory')
    @auth(admin=True)
    def admin_inventory(uid):
        if not db().execute('SELECT 1 FROM users WHERE id=?', (uid,)).fetchone():
            abort(404, description='Пользователь не найден')
        try:
            offset = int(request.args.get('offset', 0))
        except (ValueError, TypeError):
            abort(400, description='Некорректное смещение')
        if not 0 <= offset <= 100000:
            abort(400, description='Некорректное смещение')
        rows = db().execute("""
            SELECT nft_id,payload,status FROM inventory
            WHERE user_id=? ORDER BY nft_id LIMIT 101 OFFSET ?
        """, (uid,offset)).fetchall()
        gifts = []
        for row in rows[:100]:
            try:
                gift = json.loads(row['payload'])
            except (ValueError,TypeError):
                gift = {}
            gifts.append({**gift, 'id':row['nft_id'], 'status':row['status']})
        return {'gifts':gifts, 'has_more':len(rows)>100,'next_offset':offset+len(gifts)}

    @app.get('/api/admin/logs')
    @auth(admin=True)
    def admin_logs():
        try:
            uid = int(request.args['user_id']) if request.args.get('user_id') else None
            limit = int(request.args.get('limit', 100))
        except (ValueError,TypeError):
            abort(400,description='Некорректные параметры журнала')
        if not 1 <= limit <= 200:
            abort(400,description='Количество записей: от 1 до 200')
        if uid is not None and uid <= 0:
            abort(400,description='Некорректный Telegram ID')
        user_history = db().execute("""
            SELECT user_id,kind,payload,created FROM history
            WHERE (? IS NULL OR user_id=?)
            ORDER BY created DESC LIMIT ?
        """,(uid,uid,limit)).fetchall()
        activity=[]
        for row in user_history:
            try: data=json.loads(row['payload'])
            except (ValueError,TypeError): data={}
            # Do not emit session/API credentials or full arbitrary history payload.
            gift = data.get('gift') or (data.get('gifts') or [{}])[0]
            activity.append({
                'type':'history','user_id':row['user_id'],
                'kind':row['kind'],'created':row['created'],
                'gift':{'name':str(gift.get('name',''))[:100],
                        'number':gift.get('number')} if isinstance(gift,dict) else {},
                'amount':str(data.get('gram',data.get('price','')))[:40],
            })
        if uid is None:
            audits = db().execute('SELECT actor,action,created FROM audit ORDER BY id DESC LIMIT ?',
                                  (limit,)).fetchall()
        else:
            audits = db().execute('SELECT actor,action,created FROM audit WHERE actor=? ORDER BY id DESC LIMIT ?',
                                  (uid,limit)).fetchall()
        for row in audits:
            activity.append({'type':'audit','user_id':row['actor'],
                             'action':str(row['action'])[:250],'created':row['created']})
        activity.sort(key=lambda entry:entry['created'],reverse=True)
        return {'items':activity[:limit]}

    @app.get('/api/admin/users/<int:uid>/offers')
    @auth(admin=True)
    def admin_user_offers(uid):
        rows=db().execute("""
            SELECT id,buyer_id,seller_id,status,price,quantity,remaining,created,gift_json
            FROM crafter_offers WHERE buyer_id=? OR seller_id=?
            ORDER BY created DESC,id DESC LIMIT 100
        """,(uid,uid)).fetchall()
        return {'offers':[{
            'id':r['id'],'type':'placed' if r['buyer_id']==uid else 'received',
            'status':r['status'],'price':r['price'],'quantity':r['quantity'],
            'remaining':r['remaining'],'created':r['created'],
            'gift':{
                'name':json.loads(r['gift_json']).get('name',''),
                'number':json.loads(r['gift_json']).get('number'),
            },
        } for r in rows]}

    @app.post('/api/admin/users/<int:uid>/ban')
    @auth(admin=True)
    def admin_ban_user(uid):
        if uid in app.config['ADMIN_IDS'] or uid == g.user['id']:
            abort(403,description='Нельзя заблокировать администратора')
        if not db().execute('SELECT 1 FROM users WHERE id=?', (uid,)).fetchone():
            abort(404,description='Пользователь не найден')
        data = request.get_json(silent=True)
        if not isinstance(data,dict) or type(data.get('banned')) is not bool:
            abort(400,description='Укажите статус блокировки')
        reason = str(data.get('reason') or '').strip()
        if len(reason)>200:
            abort(400,description='Причина слишком длинная')
        with db():
            db().execute('BEGIN IMMEDIATE')
            if data['banned']:
                db().execute("""
                    INSERT INTO user_bans(user_id,reason,actor,created)
                    VALUES(?,?,?,?)
                    ON CONFLICT(user_id) DO UPDATE
                    SET reason=excluded.reason,actor=excluded.actor,created=excluded.created
                """,(uid,reason,g.user['id'],int(time.time())))
            else:
                db().execute('DELETE FROM user_bans WHERE user_id=?',(uid,))
        audit(('Banned' if data['banned'] else 'Unbanned') + ' user ' + str(uid))
        return {'ok':True,'banned':data['banned']}

    @app.post('/api/admin/users/<int:uid>/gifts/remove')
    @auth(admin=True)
    def admin_remove_gift(uid):
        data = request.get_json(silent=True)
        if (not isinstance(data,dict) or data.get('confirm')!='REMOVE_GIFT'
                or not isinstance(data.get('gift_id'),str)
                or not 1 <= len(data['gift_id']) <= 200):
            abort(400,description='Подтвердите удаление подарка')
        gift_id=data['gift_id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            row=db().execute('SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?',
                             (uid,gift_id)).fetchone()
            if not row:
                abort(404,description='Подарок не найден')
            if row['status']!='unlisted':
                abort(409,description='Сначала снимите подарок с продажи/стейкинга')
            gift=json.loads(row['payload'])
            affected=db().execute("""
                DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'
            """,(uid,gift_id)).rowcount
            if affected!=1:
                abort(409,description='Состояние подарка изменилось')
            record('gift_removed',{'gift':gift,'actor':g.user['id']},uid=uid)
        audit('Gift removed: '+str(uid)+' / '+gift_id[:90])
        return {'ok':True,'gift_id':gift_id}
