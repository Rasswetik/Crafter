"""Seasonal shop items besides NFT lots: GRAM balance, New Year balls, card packs and buyer-bound promo codes.

Items are paid for in New Year balls (0 = free), can have a stock and a per-player limit.
"""
import re
import secrets
import time
import uuid
from decimal import Decimal

from flask import abort, g, request

KINDS = ('GRAM', 'BALL', 'PACK', 'STAR', 'PROMO', 'BUNDLE')
PROMO_KINDS = ('GRAM', 'BALL', 'PACK', 'STAR')
SIZES = ('small', 'wide', 'tall', 'large', 'banner')     # 1x1, 2x1 stretched, 1x2 long, 2x2 big, a whole row
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
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS old_price_balls BIGINT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS contents TEXT")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS position INTEGER")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT 'small'")
            database.execute("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''")
        else:
            cols = [r['name'] for r in database.execute("PRAGMA table_info(shop_items)").fetchall()]
            if 'bundle' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN bundle BIGINT NOT NULL DEFAULT 1")
            if 'old_price_balls' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN old_price_balls BIGINT")
            if 'contents' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN contents TEXT")
            if 'position' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN position INTEGER")
            if 'size' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN size TEXT NOT NULL DEFAULT 'small'")
            if 'description' not in cols:
                database.execute("ALTER TABLE shop_items ADD COLUMN description TEXT NOT NULL DEFAULT ''")

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
        mix, parts = None, {}
        if row['contents']:
            try:
                raw = json.loads(row['contents'])
                if isinstance(raw, dict):
                    parts = {'gram': raw.get('gram') or None, 'balls': int(raw.get('balls') or 0) or None}
                    raw = raw.get('packs') or []
                mix = [{'pack': app.extensions['crafter_pack_short'](c['pack_id']), 'count': int(c['count'])} for c in raw]
                mix = [c for c in mix if c['pack']] or None
            except (ValueError, KeyError, TypeError):
                mix = None
        star = None
        if row['kind'] == 'STAR' or (row['kind'] == 'PROMO' and row['promo_kind'] == 'STAR'):
            star = app.extensions['crafter_star_gift_short'](row['amount'])
        left = None if row['stock'] is None else max(0, int(row['stock']) - int(row['sold']))
        return {'id': row['id'], 'kind': row['kind'], 'promo_kind': row['promo_kind'], 'amount': row['amount'],
                'title': row['title'], 'image_url': row['image_url'] or (pack['image'] if pack else '') or (star['image'] if star else ''), 'pack': pack, 'star': star, 'contents': mix, 'gram': parts.get('gram'), 'balls': parts.get('balls'),
                'price_balls': int(row['price_balls']), 'old_price_balls': (int(row['old_price_balls']) if row['old_price_balls'] else None),
                'discount_percent': (round((1 - int(row['price_balls']) / int(row['old_price_balls'])) * 100) if row['old_price_balls'] and int(row['old_price_balls']) > int(row['price_balls']) else None),
                'stock': row['stock'], 'left': left, 'sold': int(row['sold']),
                'per_user': row['per_user'], 'bundle': int(row['bundle'] or 1), 'mine': mine, 'status': row['status'],
                'size': row['size'] if row['size'] in SIZES else 'small', 'description': row['description'] or ''}

    def order_mode():
        row = db().execute("SELECT payload FROM settings WHERE key='shop_items_order_v1'").fetchone()
        try:
            return 'manual' if row and json.loads(row['payload']).get('mode') == 'manual' else 'price'
        except (ValueError, TypeError, AttributeError):
            return 'price'

    def ordered(rows):
        if order_mode() == 'manual':
            return sorted(rows, key=lambda r: (r['position'] is None, r['position'] or 0, int(r['price_balls']), r['created']))
        return sorted(rows, key=lambda r: (int(r['price_balls']), r['created']))

    @app.get('/api/shop-items')
    @auth()
    def shop_items():
        rows = ordered(db().execute("SELECT * FROM shop_items WHERE status='active'").fetchall())
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
            elif row['kind'] == 'BUNDLE':
                spec = json.loads(row['contents'] or '{}')
                ids = [app.extensions['crafter_grant_pack'](uid, c['pack_id'], 'shop:' + iid) for c in spec.get('packs', []) for _ in range(int(c['count']))]
                if spec.get('gram'):
                    acc = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
                    after = (Decimal(str(acc['balance'])) if acc else Decimal('0')) + Decimal(spec['gram'])
                    db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(after)))
                    result.update(gram=spec['gram'], gram_balance=str(after))
                if spec.get('balls'):
                    gain = int(spec['balls'])
                    if balls + gain > _LIMIT:
                        abort(409, description='Баланс шаров превысит максимум')
                    db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
                    db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (balls + gain, uid))
                    balls += gain
                    result.update(balls_gain=gain, balance={'balls': balls})
                if ids:
                    result.update(pack_id=ids[0], pack_ids=ids)
            elif row['kind'] == 'PACK':
                if row['contents']:                                  # a mixed set: every pack of the set is given
                    ids = [app.extensions['crafter_grant_pack'](uid, c['pack_id'], 'shop:' + iid) for c in json.loads(row['contents']) for _ in range(int(c['count']))]
                else:
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
        rows = ordered(db().execute("SELECT * FROM shop_items").fetchall())[:300]
        return {'items': [view(r) for r in rows], 'order': order_mode()}

    def whole(value, low, high, name):
        try:
            n = int(value)
        except (TypeError, ValueError):
            abort(400, description='Укажите целое число: ' + name)
        if str(value).strip() != str(n) or not low <= n <= high:
            abort(400, description=name + ': от ' + str(low) + ' до ' + str(high))
        return n

    def parse_item(body):
        kind, promo = body.get('kind'), body.get('promo_kind') or ''
        if kind not in KINDS:
            abort(400, description='Неизвестный тип товара')
        if kind == 'PROMO' and promo not in PROMO_KINDS:
            abort(400, description='Тип промокода: GRAM, шары или пак')
        eff = promo if kind == 'PROMO' else kind
        mix, mix_title = None, ''
        bundle_spec = None
        packs_in = body.get('contents')
        if kind == 'BUNDLE':
            spec_in = packs_in if isinstance(packs_in, dict) else {}
            packs_in = spec_in.get('packs') if isinstance(spec_in.get('packs'), list) else []
            from packs import money
            gram_in = str(spec_in.get('gram') or '').strip()
            gram = plain(money(gram_in)) if gram_in not in ('', '0') else ''
            balls_in = str(spec_in.get('balls') or '').strip()
            balls_n = whole(balls_in, 1, _LIMIT, 'Шары') if balls_in not in ('', '0') else 0
            bundle_spec = {'gram': gram, 'balls': balls_n}
        if (kind == 'PACK' or kind == 'BUNDLE') and isinstance(packs_in, list) and packs_in:
            merged = {}
            for entry in packs_in:
                pid = str((entry or {}).get('pack_id') or '')
                try:
                    n = int((entry or {}).get('count') or 0)
                except (TypeError, ValueError):
                    abort(400, description='Количество паков в наборе — целое число')
                if n <= 0:
                    continue
                if not app.extensions['crafter_pack_exists'](pid):
                    abort(400, description='В наборе есть несуществующий пак')
                merged[pid] = merged.get(pid, 0) + n
            if not merged or sum(merged.values()) > 500:
                abort(400, description='В наборе от 1 до 500 паков')
            mix = json.dumps([{'pack_id': k, 'count': v} for k, v in merged.items()])
            if bundle_spec is not None:
                bundle_spec['packs'] = json.loads(mix)
            mix_title = ' + '.join(((app.extensions['crafter_pack_short'](k) or {}).get('title', 'Пак')) + (' ×' + str(v) if v > 1 else '') for k, v in merged.items())
            body = {**body, 'amount': next(iter(merged)), 'bundle': sum(merged.values())}
        if eff == 'BUNDLE':
            if not (bundle_spec.get('packs') or bundle_spec['gram'] or bundle_spec['balls']):
                abort(400, description='Добавьте в бандл хотя бы один пак, GRAM или шары')
            bundle_spec.setdefault('packs', [])
            mix = json.dumps(bundle_spec)
            amount = bundle_spec['packs'][0]['pack_id'] if bundle_spec['packs'] else ''
            parts_t = [mix_title] if mix_title else []
            if bundle_spec['gram']:
                parts_t.append(bundle_spec['gram'] + ' GRAM')
            if bundle_spec['balls']:
                parts_t.append(str(bundle_spec['balls']) + ' шаров')
            mix_title = 'Бандл: ' + ' + '.join(parts_t)
        elif eff == 'PACK':
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
        old_price = None
        if str(body.get('old_price_balls') or '').strip() not in ('', '0'):
            old_price = whole(body.get('old_price_balls'), 1, _LIMIT, 'Старая цена')
            if old_price <= price:
                abort(400, description='Старая цена должна быть больше текущей: иначе скидки нет')
        stock = None if str(body.get('stock') or '').strip() == '' else whole(body.get('stock'), 1, 1000000, 'Количество')
        per_user = None if str(body.get('per_user') or '').strip() == '' else whole(body.get('per_user'), 1, 1000, 'Лимит на игрока')
        bundle = 1
        if eff == 'BUNDLE':
            bundle = max(1, sum(c['count'] for c in bundle_spec['packs']))
        elif eff in ('PACK', 'STAR'):
            bundle = whole(body.get('bundle') or 1, 1, 20, 'Штук за одну покупку')
        image = str(body.get('image_url') or '').strip()
        if image and not (image.startswith('https://') or re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image)):
            abort(400, description='Картинка: ссылка https:// или файл из /static/')
        title = str(body.get('title') or '').strip()[:80]
        if not title:
            if eff in ('PACK', 'BUNDLE') and mix_title:
                title = mix_title[:80]
            elif eff == 'PACK':
                title = (app.extensions['crafter_pack_short'](amount) or {}).get('title', 'Пак') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'STAR':
                title = (app.extensions['crafter_star_gift_short'](amount) or {}).get('title', 'Подарок') + (' ×' + str(bundle) if bundle > 1 else '')
            elif eff == 'BALL':
                title = amount + ' шаров'
            else:
                title = amount + ' GRAM'
            if kind == 'PROMO':
                title = 'Промокод: ' + title
        size = str(body.get('size') or 'small')
        if size not in SIZES:
            abort(400, description='Размер плитки: обычная, широкая, длинная, большая или баннер')
        description = ' '.join(str(body.get('description') or '').split())[:240]
        return (kind, promo if kind == 'PROMO' else '', amount, title, image, price, old_price, stock, per_user, bundle, mix, size, description)

    @app.post('/api/admin/new-year/shop')
    @auth(admin=True)
    def admin_shop_create():
        vals = parse_item(request.get_json(silent=True) or {})
        iid = uuid.uuid4().hex
        with db():
            position = None
            if order_mode() == 'manual':
                position = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM shop_items").fetchone()['n'])
            db().execute("INSERT INTO shop_items(id,kind,promo_kind,amount,title,image_url,price_balls,old_price_balls,stock,per_user,bundle,contents,size,description,position,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (iid,) + vals + (position, int(time.time())))
        audit('Shop item created: ' + vals[3])
        return {'ok': True, 'id': iid}

    @app.post('/api/admin/new-year/shop/<iid>/edit')
    @auth(admin=True)
    def admin_shop_edit(iid):
        vals = parse_item(request.get_json(silent=True) or {})
        with db():
            if not db().execute("UPDATE shop_items SET kind=?,promo_kind=?,amount=?,title=?,image_url=?,price_balls=?,old_price_balls=?,stock=?,per_user=?,bundle=?,contents=?,size=?,description=? WHERE id=?",
                                vals + (iid,)).rowcount:
                abort(404, description='Товар не найден')
        audit('Shop item edited: ' + vals[3])
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/size')
    @auth(admin=True)
    def admin_shop_size(iid):
        size = (request.get_json(silent=True) or {}).get('size')
        if size not in SIZES:
            abort(400, description='Размер плитки: обычная, широкая, длинная, большая или баннер')
        with db():
            row = db().execute("SELECT title FROM shop_items WHERE id=?", (iid,)).fetchone()
            if not row:
                abort(404, description='Товар не найден')
            db().execute("UPDATE shop_items SET size=? WHERE id=?", (size, iid))
        audit('Shop item size: ' + row['title'] + ' -> ' + size)
        return {'ok': True}

    @app.post('/api/admin/new-year/shop/<iid>/move')
    @auth(admin=True)
    def admin_shop_move(iid):
        direction = (request.get_json(silent=True) or {}).get('direction')
        if direction not in ('up', 'down'):
            abort(400, description='direction: up или down')
        with db():
            db().execute('BEGIN IMMEDIATE')
            rows = ordered(db().execute("SELECT * FROM shop_items").fetchall())
            ids = [r['id'] for r in rows]
            if iid not in ids:
                abort(404, description='Товар не найден')
            at = ids.index(iid)
            to = at - 1 if direction == 'up' else at + 1
            if 0 <= to < len(ids):
                ids[at], ids[to] = ids[to], ids[at]
            for number, item in enumerate(ids, 1):
                db().execute("UPDATE shop_items SET position=? WHERE id=?", (number, item))
            db().execute("INSERT INTO settings(key,payload) VALUES('shop_items_order_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps({'mode': 'manual'}),))
        return {'ok': True}

    @app.post('/api/admin/new-year/shop-order')
    @auth(admin=True)
    def admin_shop_order():
        if (request.get_json(silent=True) or {}).get('mode') != 'price':
            abort(400, description='mode: price')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('shop_items_order_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps({'mode': 'price'}),))
        return {'ok': True}

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
            if not db().execute("DELETE FROM shop_items WHERE id=?", (iid,)).rowcount:         # it may have been bought: what players already got stays theirs
                abort(404, description='Товар не найден')
            db().execute("DELETE FROM shop_item_buys WHERE item_id=?", (iid,))
        audit('Shop item deleted ' + iid)
        return {'ok': True}
