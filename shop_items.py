"""Seasonal shop items besides NFT lots: GRAM balance, New Year balls, card packs and buyer-bound promo codes.

Items are paid for in New Year balls (0 = free), can have a stock and a per-player limit.
"""
import re
import secrets
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'PROMO')
PROMO_KINDS = ('GRAM', 'BALL', 'PACK', 'STAR')
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
_LIMIT = 10**9


def plain(d):
    return format(d.normalize(), 'f') if d else '0'


def install_shop_items(app, db, auth, record, audit):
    with app.app_context(), db():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS shop_items(
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, promo_kind TEXT NOT NULL DEFAULT '',
            amount TEXT NOT NULL, title TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '',
            price_balls BIGINT NOT NULL DEFAULT 0, stock BIGINT, per_user BIGINT,
            sold BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shop_item_buys(
            item_id TEXT NOT NULL, user_id BIGINT NOT NULL, request_id TEXT NOT NULL,
            result TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(user_id,request_id)
        );
        """)

        database = db()
        if hasattr(database, 'connection') and database.connection is not None:
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS bundle BIGINT NOT NULL DEFAULT 1")
        else:
            cols = [r['name'] for r in database.execute("PRAGMA table_info(shop_items)").fetchall()]
            if 'bundle' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN bundle BIGINT NOT NULL DEFAULT 1")

    import json

    def wallet_balls(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def view(row, uid=None):
        mine = 0
        if uid:
            mine = int(db().execute("SELECT COUNT(*) AS n FROM shop_item_buys WHERE item_id=? AND user_id=?", (row['id'], uid)).fetchone()['n'])
        pack = None
        pid = row['amount'] if row['kind'] == 'PACK' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'PACK') else None
        if pid and app.extensions.get('crafter_pack_short'):
            pack = app.extensions['crafter_pack_short'](pid)
        star = None
        if row['kind'] == 'STAR' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'STAR'):
            star = app.extensions['crafter_star_gift_short'](row['amount'])
        left = None if row['stock'] is None else max(0, int(row['stock']) - int(row['sold']))
        return {'id': row['id'], 'kind': row['kind'], 'promo_kind': row['promo_kind'], 'amount': row['amount'],
                'title': row['title'], 'image_url': row['image_url'] or (pack['image'] if pack else '') or (star['image'] if star else ''), 'pack': pack, 'star': star,
                'price_balls': int(row['price_balls']), 'stock': row['stock'], 'left': left, 'sold': int(row['sold']),
                'per_user': row['per_user'], 'bundle': int(row['bundle'] or 1), 'mine': mine, 'status': row['status']}

    @app.get('/api/shop-items')
    @auth()
    def shop_items():
        rows = db().execute("SELECT * FROM shop_items WHERE status='active' ORDER BY created").fetchall()
        return {'items': [view(r, g.user['id']) for r in rows]}

    @app.post('/api/shop-items/buy')
    @auth()
    def shop_items_buy():
        body = request.get_json(silent=True) or {}
        iid, rid = body.get('item_id'), body.get('request_id')
        if not isinstance(iid, str) or not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', rid):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute("SELECT item_id,result FROM shop_item_buys WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
            if done:
                if done['item_id'] != iid:
                    abort(409, description='Номер покупки уже использован')
                return json.loads(done['result'])
            row = db().execute("SELECT * FROM shop_items WHERE id=? AND status='active'", (iid,)).fetchone()
            if not row:
                abort(409, description='Товар недоступен')
            if row['stock'] is not None and int(row['sold']) >= int(row['stock']):
                abort(409, description='Товар закончился')
            if row['per_user'] is not None:
                have = db().execute("SELECT COUNT(*) AS n FROM shop_item_buys WHERE item_id=? AND user_id=?", (iid, uid)).fetchone()['n']
                if int(have) >= int(row['per_user']):
                    abort(409, description='Лимит покупок на игрока исчерпан')
            price, balls = int(row['price_balls']), wallet_balls(uid)
            if balls < price:
                abort(409, description='Недостаточно новогодних шаров')
            if price:
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls - price, uid))
            balls -= price
            result = {'ok': True, 'kind': row['kind'], 'title': row['title'], 'balance': {'balls': balls}}
            now = int(time.time())
            if row['kind'] == 'GRAM':
                acc = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
                after = (Decimal(str(acc['balance'])) if acc else Decimal('0')) + Decimal(row['amount'])
                db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                result.update(gram=row['amount'], gram_balance=str(after))
            elif row['kind'] == 'BALL':
                gain = int(row['amount'])
                if balls + gain > _LIMIT:
                    abort(409, description='Баланс шаров превысит максимум')
                db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls + gain, uid))
                balls += gain
                result.update(balls_gain=gain, balance={'balls': balls})
            elif row['kind'] == 'PACK':
                ids = [app.extensions['crafter_grant_pack'](uid, row['amount'], 'shop:' + iid) for _ in range(int(row['bundle'] or 1))]
                result.update(pack_id=ids[0], pack_ids=ids)
            elif row['kind'] == 'STAR':
                ids = [app.extensions['crafter_grant_star_gift'](uid, row['amount'], 'shop:' + iid) for _ in range(int(row['bundle'] or 1))]
                result.update(star_gift=row['amount'], gift_ids=ids, count=len(ids))
            else:
                code = ''
                for _ in range(30):
                    cand = 'NY-' + ''.join(secrets.choice(ALPHABET) for _ in range(4)) + '-' + ''.join(secrets.choice(ALPHABET) for _ in range(4))
                    if not db().execute("SELECT 1 FROM promo_codes WHERE code=?", (cand,)).fetchone():
                        code = cand
                        break
                if not code:
                    abort(503, description='Не удалось создать код, повторите')
                db().execute("INSERT INTO promo_codes(code,reward,currency,uses_limit,used,active,created_by,created,owner_id) VALUES(?,?,?,?,0,1,?,?,?)",
                             (code, (row['amount'] + ':' + str(int(row['bundle'] or 1))) if row['promo_kind'] in ('PACK', 'STAR') else row['amount'], row['promo_kind'], 1, uid, now, uid))
                result['code'] = code
            db().execute("UPDATE shop_items SET sold=sold+1 WHERE id=?", (iid,))
            db().execute("INSERT INTO shop_item_buys(item_id,user_id,request_id,result,created) VALUES(?,?,?,?,?)",
                         (iid, uid, rid, json.dumps(result, ensure_ascii=False), now))
            record('shop_item_buy', {'item': iid, 'kind': row['kind'], 'price_balls': price}, uid=uid)
        return result

    # ---- administration (permission section: new-year) ----
    @app.get('/api/admin/new-year/shop')
    @auth(admin=True)
    def admin_shop():
        rows = db().execute("SELECT * FROM shop_items ORDER BY created DESC LIMIT 200").fetchall()
        return {'items': [view(r) for r in rows]}

    def whole(value, low, high, name):
        try:
            n = int(value)
        except (TypeError, ValueError):
            abort(400, description='Укажите целое число: ' + name)
        if str(value).strip() != str(n) or not low <= n <= high:
            abort(400, description=name + ': от ' + str(low) + ' до ' + str(high))
        return n

    @app.post('/api/admin/new-year/shop')
    @auth(admin=True)
    def admin_shop_create():
        body = request.get_json(silent=True) or {}
        kind, promo = body.get('kind'), body.get('promo_kind') or ''
        if kind not in KINDS:
            abort(400, description='Неизвестный тип товара')
        if kind == 'PROMO' and promo not in PROMO_KINDS:
            abort(400, description='Тип промокода: GRAM, шары или пак')
        eff = promo if kind == 'PROMO' else kind
        if eff == 'PACK':
            amount = str(body.get('amount') or '')
            if not app.extensions['crafter_pack_exists'](amount):
                abort(400, description='Выберите существующий пак')
        elif eff == 'STAR':
            amount = str(body.get('amount') or '')
            if not app.extensions['crafter_star_gift_exists'](amount):
                abort(400, description='Выберите подарок Telegram')
        elif eff == 'BALL':
            amount = str(whole(body.get('amount'), 1, _LIMIT, 'Шары'))
        else:
            from packs import money
            amount = plain(money(body.get('amount')))
        price = whole(body.get('price_balls', 0), 0, _LIMIT, 'Цена')
        stock = None if str(body.get('stock') or '').strip() == '' else whole(body.get('stock'), 1, 1000000, 'Количество')
        per_user = None if str(body.get('per_user') or '').strip() == '' else whole(body.get('per_user'), 1, 1000, 'Лимит на игрока')
        bundle = 1
        if eff in ('PACK', 'STAR'):
            bundle = whole(body.get('bundle') or 1, 1, 20, 'Штук за одну покупку')
        image = str(body.get('image_url') or '').strip()
        if image and not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        title = str(body.get('title') or '').strip()[:80]
        if not title:
            if eff == 'PACK':
                title = (app.extensions['crafter_pack_short'](amount) or {}).get('title', 'Пак') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'STAR':
                title = (app.extensions['crafter_star_gift_short'](amount) or {}).get('title', 'Подарок') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'BALL':
                title = amount + ' шаров'
            else:
                title = amount + ' GRAM'
            if kind == 'PROMO':
                title = 'Промокод: ' + title
        iid = uuid.uuid4().hex
        with db():
            db().execute("INSERT INTO shop_items(id,kind,promo_kind,amount,title,image_url,price_balls,stock,per_user,bundle,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (iid, kind, promo if kind == 'PROMO' else '', amount, title, image, price, stock, per_user, bundle, int(time.time())))
        audit('Shop item created: ' + title)
        return {'ok': True, 'id': iid}

    @app.post('/api/admin/new-year/shop/<iid>/status')
    @auth(admin=True)
    def admin_shop_status(iid):
        status = (request.get_json(silent=True) or {}).get('status')
        if status not in ('active', 'hidden'):
            abort(400, description='Статус: active или hidden')
        with db():
            if not db().execute("UPDATE shop_items SET status=? WHERE id=?", (status, iid)).rowcount:
                abort(404, description='Товар не найден')
        audit('Shop item ' + iid + ' ' + status)
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/delete')
    @auth(admin=True)
    def admin_shop_delete(iid):
        with db():
            if db().execute("SELECT 1 FROM shop_item_buys WHERE item_id=? LIMIT 1", (iid,)).fetchone():
                abort(409, description='Товар уже покупали — скройте его вместо удаления')
            if not db().execute("DELETE FROM shop_items WHERE id=?", (iid,)).rowcount:
                abort(404, description='Товар не найден')
        audit('Shop item deleted ' + iid)
        return {'ok': True}
