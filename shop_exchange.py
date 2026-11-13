"""Exchange plates of the special market and author codes.

An exchange section shows plates grouped in columns («Новогодние шары», «GRAM»…): a player pays one currency (New Year balls or GRAM)
and receives the other one, with an optional bonus («75 + ещё 5»). A player can enter the code of a content author: from every
purchase of that player a share (5% by default, the administrator can change it) goes to the owner of the code."""
import json
import re
import time
import uuid
from decimal import ROUND_DOWN, Decimal

from flask import abort, g, request

CURRENCIES = ('BALLS', 'GRAM')
LIMIT_BALLS = 10 ** 9
CODE = re.compile(r'[A-Z0-9_-]{3,20}')
SIX = Decimal('0.000001')
SWITCH_DAYS = 7


def install_shop_exchange(app, db, auth, audit, record):
    from packs import money
    from shop_items import plain

    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS shop_exchanges (
                id TEXT PRIMARY KEY, section_id TEXT NOT NULL, group_title TEXT NOT NULL DEFAULT '',
                pay_cur TEXT NOT NULL, pay_amount TEXT NOT NULL, get_cur TEXT NOT NULL, get_amount TEXT NOT NULL,
                bonus TEXT NOT NULL DEFAULT '0', image TEXT NOT NULL DEFAULT '', per_user BIGINT, stock BIGINT,
                sold BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', position BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shop_exchange_buys (
                user_id BIGINT NOT NULL, request_id TEXT NOT NULL, exchange_id TEXT NOT NULL, result TEXT NOT NULL, created BIGINT NOT NULL,
                PRIMARY KEY(user_id, request_id)
            );
            CREATE TABLE IF NOT EXISTS author_codes (
                code TEXT PRIMARY KEY, owner_id BIGINT NOT NULL, active BIGINT NOT NULL DEFAULT 1, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS author_support (
                user_id BIGINT PRIMARY KEY, code TEXT NOT NULL, changed BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS author_entries (
                id TEXT PRIMARY KEY, code TEXT NOT NULL, user_id BIGINT NOT NULL, created BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS author_earnings (
                id TEXT PRIMARY KEY, owner_id BIGINT NOT NULL, buyer_id BIGINT NOT NULL, code TEXT NOT NULL, currency TEXT NOT NULL,
                amount TEXT NOT NULL, base TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL
            );
        """)

    # ---------- money helpers (everything runs inside the caller's transaction) ----------
    def balls_of(uid):
        row = db().execute("SELECT balls FROM new_year_wallets WHERE user_id=?", (uid,)).fetchone()
        return int(row['balls']) if row else 0

    def set_balls(uid, value):
        db().execute("INSERT INTO new_year_wallets(user_id) VALUES(?) ON CONFLICT DO NOTHING", (uid,))
        db().execute("UPDATE new_year_wallets SET balls=? WHERE user_id=?", (int(value), uid))

    def gram_of(uid):
        row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?", (uid,)).fetchone()
        return Decimal(str(row['balance'])) if row else Decimal('0')

    def set_gram(uid, value):
        db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance", (uid, str(value)))

    def rate():
        row = db().execute("SELECT payload FROM settings WHERE key='author_rate_percent'").fetchone()
        try:
            return Decimal(str(row['payload'])) if row else Decimal('5')
        except Exception:
            return Decimal('5')

    def reward(uid, currency, amount, source):
        """The owner of the author code that a player supports gets a share of the player's purchase."""
        sup = db().execute("SELECT code FROM author_support WHERE user_id=?", (uid,)).fetchone()
        if not sup:
            return None
        code = db().execute("SELECT owner_id FROM author_codes WHERE code=? AND active=1", (sup['code'],)).fetchone()
        if not code or int(code['owner_id']) == int(uid):
            return None
        percent = rate()
        if currency == 'BALLS':
            gain = int(Decimal(int(amount)) * percent / 100)
            if gain < 1:
                return None
            owner = int(code['owner_id'])
            if balls_of(owner) + gain > LIMIT_BALLS:
                return None
            set_balls(owner, balls_of(owner) + gain)
            shown = str(gain)
        else:
            gain = (Decimal(str(amount)) * percent / 100).quantize(SIX, rounding=ROUND_DOWN)
            if gain <= 0:
                return None
            owner = int(code['owner_id'])
            set_gram(owner, gram_of(owner) + gain)
            shown = plain(gain)
        db().execute("INSERT INTO author_earnings(id,owner_id,buyer_id,code,currency,amount,base,source,created) VALUES(?,?,?,?,?,?,?,?,?)",
                     (uuid.uuid4().hex, owner, uid, sup['code'], currency, shown, str(amount), str(source)[:60], int(time.time())))
        return {'currency': currency, 'amount': shown}

    app.extensions['crafter_author_reward'] = reward

    # ---------- what players see ----------
    def exch_view(row, uid=None):
        mine = 0
        if uid:
            mine = int(db().execute("SELECT COUNT(*) AS n FROM shop_exchange_buys WHERE exchange_id=? AND user_id=?", (row['id'], uid)).fetchone()['n'])
        left = None if row['stock'] is None else max(0, int(row['stock']) - int(row['sold']))
        return {'id': row['id'], 'section_id': row['section_id'], 'group_title': row['group_title'], 'pay_cur': row['pay_cur'], 'pay_amount': row['pay_amount'],
                'get_cur': row['get_cur'], 'get_amount': row['get_amount'], 'bonus': row['bonus'], 'image': row['image'],
                'per_user': row['per_user'], 'stock': row['stock'], 'left': left, 'mine': mine, 'status': row['status'], 'position': int(row['position'])}

    def public(uid):
        rows = db().execute("SELECT e.* FROM shop_exchanges e JOIN shop_sections s ON s.id=e.section_id WHERE e.status='active' AND s.enabled=1 AND s.kind='exchange' ORDER BY e.position,e.created").fetchall()
        sup = db().execute("SELECT code FROM author_support WHERE user_id=?", (uid,)).fetchone()
        live = bool(sup and db().execute("SELECT 1 FROM author_codes WHERE code=? AND active=1", (sup['code'],)).fetchone())
        return {'exchanges': [exch_view(r, uid) for r in rows], 'author': {'code': sup['code'] if live else '', 'percent': plain(rate())}}

    app.extensions['crafter_exchange_public'] = public

    @app.post('/api/shop-exchange/buy')
    @auth()
    def exchange_buy():
        body = request.get_json(silent=True) or {}
        eid, rid = body.get('exchange_id'), body.get('request_id')
        if not isinstance(eid, str) or not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', rid):
            abort(400, description='Неверный запрос')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            done = db().execute("SELECT exchange_id,result FROM shop_exchange_buys WHERE user_id=? AND request_id=?", (uid, rid)).fetchone()
            if done:
                if done['exchange_id'] != eid:
                    abort(409, description='Номер покупки уже использован')
                return json.loads(done['result'])
            row = db().execute("SELECT e.* FROM shop_exchanges e JOIN shop_sections s ON s.id=e.section_id WHERE e.id=? AND e.status='active' AND s.enabled=1", (eid,)).fetchone()
            if not row:
                abort(409, description='Обмен недоступен')
            if row['stock'] is not None and int(row['sold']) >= int(row['stock']):
                abort(409, description='Обмен закончился')
            if row['per_user'] is not None:
                have = db().execute("SELECT COUNT(*) AS n FROM shop_exchange_buys WHERE exchange_id=? AND user_id=?", (eid, uid)).fetchone()['n']
                if int(have) >= int(row['per_user']):
                    abort(409, description='Лимит обменов на игрока исчерпан')
            pay_cur, get_cur = row['pay_cur'], row['get_cur']
            pay, got = Decimal(row['pay_amount']), Decimal(row['get_amount']) + Decimal(row['bonus'] or '0')
            # pay
            if pay_cur == 'BALLS':
                have = balls_of(uid)
                if have < int(pay):
                    abort(409, description='Недостаточно новогодних шаров')
                set_balls(uid, have - int(pay))
            else:
                have = gram_of(uid)
                if have < pay:
                    abort(409, description='Недостаточно GRAM')
                set_gram(uid, have - pay)
            # receive
            if get_cur == 'BALLS':
                new = balls_of(uid) + int(got)
                if new > LIMIT_BALLS:
                    abort(409, description='Баланс шаров превысит максимум')
                set_balls(uid, new)
            else:
                set_gram(uid, gram_of(uid) + got)
            reward(uid, pay_cur, int(pay) if pay_cur == 'BALLS' else pay, 'exchange:' + eid)
            result = {'ok': True, 'paid': {'currency': pay_cur, 'amount': plain(pay)}, 'got': {'currency': get_cur, 'amount': plain(got)},
                      'balance': {'balls': balls_of(uid)}, 'gram_balance': str(gram_of(uid))}
            db().execute("UPDATE shop_exchanges SET sold=sold+1 WHERE id=?", (eid,))
            db().execute("INSERT INTO shop_exchange_buys(user_id,request_id,exchange_id,result,created) VALUES(?,?,?,?,?)",
                         (uid, rid, eid, json.dumps(result), int(time.time())))
            record('shop_exchange', {'exchange': eid, 'pay': pay_cur + ':' + plain(pay), 'get': get_cur + ':' + plain(got)}, uid=uid)
        return result

    @app.post('/api/author-code')
    @auth()
    def author_code_enter():
        code = str((request.get_json(silent=True) or {}).get('code') or '').strip().upper()
        if not CODE.fullmatch(code):
            abort(400, description='Код: от 3 до 20 знаков, буквы, цифры, - и _')
        uid = g.user['id']
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute("SELECT owner_id FROM author_codes WHERE code=? AND active=1", (code,)).fetchone()
            if not row:
                abort(404, description='Такого кода автора нет')
            if int(row['owner_id']) == int(uid):
                abort(409, description='Нельзя поддерживать самого себя')
            cur = db().execute("SELECT code,changed FROM author_support WHERE user_id=?", (uid,)).fetchone()
            now = int(time.time())
            if cur and cur['code'] == code:
                return {'ok': True, 'code': code}
            if cur and now - int(cur['changed']) < SWITCH_DAYS * 86400:
                abort(409, description='Сменить автора можно раз в %d дней' % SWITCH_DAYS)
            db().execute("INSERT INTO author_support(user_id,code,changed) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code,changed=excluded.changed", (uid, code, now))
            db().execute("INSERT INTO author_entries(id,code,user_id,created) VALUES(?,?,?,?)", (uuid.uuid4().hex, code, uid, now))
        return {'ok': True, 'code': code}

    @app.get('/api/author/stats')
    @auth()
    def author_stats():
        """The page of an author: how many players entered the code, how many purchases they made, how much was earned."""
        uid = g.user['id']
        codes = [c['code'] for c in db().execute("SELECT code FROM author_codes WHERE owner_id=? ORDER BY created", (uid,)).fetchall()]
        if not codes:
            return {'has_code': False}
        marks = ','.join('?' * len(codes))
        now = int(time.time())
        out = {'has_code': True, 'codes': [], 'percent': plain(rate()), 'now': now}
        for code in codes:
            row = db().execute("SELECT active FROM author_codes WHERE code=?", (code,)).fetchone()
            out['codes'].append({'code': code, 'active': bool(row['active']),
                                 'supporters': int(db().execute("SELECT COUNT(*) AS n FROM author_support WHERE code=?", (code,)).fetchone()['n'])})
        out['supporters'] = sum(c['supporters'] for c in out['codes'])
        out['entries'] = int(db().execute("SELECT COUNT(*) AS n FROM author_entries WHERE code IN (%s)" % marks, tuple(codes)).fetchone()['n'])
        out['entries_week'] = int(db().execute("SELECT COUNT(*) AS n FROM author_entries WHERE code IN (%s) AND created>?" % marks, tuple(codes) + (now - 7 * 86400,)).fetchone()['n'])
        rows = db().execute("SELECT * FROM author_earnings WHERE owner_id=? ORDER BY created DESC", (uid,)).fetchall()
        spent = {'BALLS': 0, 'GRAM': Decimal('0')}
        earned = {'BALLS': 0, 'GRAM': Decimal('0')}
        count = {'BALLS': 0, 'GRAM': 0}
        days = {}
        buyers = set()
        for r_ in rows:
            cur = r_['currency']
            if cur == 'BALLS':
                spent[cur] += int(Decimal(r_['base'])); earned[cur] += int(r_['amount'])
            else:
                spent[cur] += Decimal(r_['base']); earned[cur] += Decimal(r_['amount'])
            count[cur] += 1
            buyers.add(r_['buyer_id'])
            day = time.strftime('%Y-%m-%d', time.gmtime(int(r_['created']) + 3 * 3600))      # days in Moscow time
            d = days.setdefault(day, {'BALLS': 0, 'GRAM': Decimal('0'), 'n': 0})
            d['n'] += 1
            d[cur] += int(r_['amount']) if cur == 'BALLS' else Decimal(r_['amount'])
        out['purchases'] = {'BALLS': count['BALLS'], 'GRAM': count['GRAM'], 'total': count['BALLS'] + count['GRAM']}
        out['spent'] = {'BALLS': spent['BALLS'], 'GRAM': plain(spent['GRAM'])}
        out['earned'] = {'BALLS': earned['BALLS'], 'GRAM': plain(earned['GRAM'])}
        out['buyers'] = len(buyers)
        series = []
        for back in range(13, -1, -1):
            day = time.strftime('%Y-%m-%d', time.gmtime(now + 3 * 3600 - back * 86400))
            d = days.get(day) or {'BALLS': 0, 'GRAM': Decimal('0'), 'n': 0}
            series.append({'day': day, 'balls': d['BALLS'], 'gram': plain(d['GRAM']), 'n': d['n']})
        out['series'] = series
        recent = []
        for r_ in rows[:25]:
            user = db().execute("SELECT name,username FROM users WHERE id=?", (r_['buyer_id'],)).fetchone()
            name = ((user['name'] or user['username']) if user else '') or 'Игрок'
            kind = str(r_['source']).split(':')[0]
            recent.append({'time': int(r_['created']), 'buyer': name[:1] + '…' + name[-1:] if len(name) > 2 else name, 'currency': r_['currency'], 'base': r_['base'], 'amount': r_['amount'],
                           'what': {'shop': 'Магазин', 'pack': 'Пак', 'exchange': 'Обмен'}.get(kind, 'Покупка')})
        out['recent'] = recent
        return out

    # ---------- administration ----------
    def exchange_section(sid):
        return bool(db().execute("SELECT 1 FROM shop_sections WHERE id=? AND kind='exchange'", (sid,)).fetchone())

    def clean_amount(cur, value, name, low_zero=False):
        if cur == 'BALLS':
            try:
                n = int(str(value).strip() or '0')
            except ValueError:
                abort(400, description=name + ': целое число шаров')
            if not (0 if low_zero else 1) <= n <= LIMIT_BALLS:
                abort(400, description=name + ': от %d до %d' % (0 if low_zero else 1, LIMIT_BALLS))
            return str(n)
        if low_zero and str(value).strip() in ('', '0'):
            return '0'
        return plain(money(value, name))

    @app.get('/api/admin/new-year/exchange')
    @auth(admin=True)
    def admin_exchange():
        rows = db().execute("SELECT * FROM shop_exchanges ORDER BY position,created").fetchall()
        sections = [s for s in app.extensions['crafter_shop_sections'](True) if s['kind'] == 'exchange']
        codes = []
        for c in db().execute("SELECT * FROM author_codes ORDER BY created DESC").fetchall():
            user = db().execute("SELECT name,username FROM users WHERE id=?", (c['owner_id'],)).fetchone()
            earned = {'BALLS': 0, 'GRAM': Decimal('0')}
            for r in db().execute("SELECT currency,amount FROM author_earnings WHERE code=?", (c['code'],)).fetchall():
                earned[r['currency']] += int(r['amount']) if r['currency'] == 'BALLS' else Decimal(r['amount'])
            codes.append({'code': c['code'], 'owner_id': int(c['owner_id']), 'owner': (user['name'] or user['username']) if user else '', 'active': bool(c['active']),
                          'supporters': int(db().execute("SELECT COUNT(*) AS n FROM author_support WHERE code=?", (c['code'],)).fetchone()['n']),
                          'earned_balls': earned['BALLS'], 'earned_gram': plain(earned['GRAM'])})
        return {'exchanges': [exch_view(r) for r in rows], 'sections': sections, 'codes': codes, 'percent': plain(rate())}

    @app.post('/api/admin/new-year/exchange')
    @auth(admin=True)
    def admin_exchange_save():
        body = request.get_json(silent=True) or {}
        sid = str(body.get('section_id') or '')
        if not exchange_section(sid):
            abort(400, description='Выберите раздел типа «Обмен»')
        pay_cur, get_cur = str(body.get('pay_cur') or ''), str(body.get('get_cur') or '')
        if pay_cur not in CURRENCIES or get_cur not in CURRENCIES or pay_cur == get_cur:
            abort(400, description='Обмен идёт между шарами и GRAM: валюты должны быть разными')
        pay = clean_amount(pay_cur, body.get('pay_amount'), 'Цена')
        get = clean_amount(get_cur, body.get('get_amount'), 'Получает')
        bonus = clean_amount(get_cur, body.get('bonus') or '0', 'Бонус', low_zero=True)
        group = ' '.join(str(body.get('group_title') or '').split())[:40]
        image = str(body.get('image') or '').strip()
        if image and not re.fullmatch(r'/media/shop/[0-9a-f]{32}', image) and not re.fullmatch(r'/static/[A-Za-z0-9_./-]+', image):
            abort(400, description='Картинка: загрузите PNG')
        per_user = None if str(body.get('per_user') or '').strip() in ('', '0') else int(str(body.get('per_user')))
        stock = None if str(body.get('stock') or '').strip() in ('', '0') else int(str(body.get('stock')))
        status = 'hidden' if body.get('status') == 'hidden' else 'active'
        eid = body.get('id')
        with db():
            if eid:
                if not db().execute("UPDATE shop_exchanges SET section_id=?,group_title=?,pay_cur=?,pay_amount=?,get_cur=?,get_amount=?,bonus=?,image=?,per_user=?,stock=?,status=? WHERE id=?",
                                    (sid, group, pay_cur, pay, get_cur, get, bonus, image, per_user, stock, status, str(eid))).rowcount:
                    abort(404, description='Обмен не найден')
            else:
                eid = uuid.uuid4().hex
                pos = int(db().execute("SELECT COALESCE(MAX(position),0)+1 AS n FROM shop_exchanges").fetchone()['n'])
                db().execute("INSERT INTO shop_exchanges(id,section_id,group_title,pay_cur,pay_amount,get_cur,get_amount,bonus,image,per_user,stock,status,position,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             (eid, sid, group, pay_cur, pay, get_cur, get, bonus, image, per_user, stock, status, pos, int(time.time())))
        audit('Exchange saved: %s %s -> %s %s' % (pay_cur, pay, get_cur, get))
        return {'ok': True, 'id': eid}

    @app.post('/api/admin/new-year/exchange/<eid>/delete')
    @auth(admin=True)
    def admin_exchange_delete(eid):
        with db():
            if not db().execute("DELETE FROM shop_exchanges WHERE id=?", (eid,)).rowcount:
                abort(404, description='Обмен не найден')
        return {'ok': True}

    @app.post('/api/admin/new-year/author-codes')
    @auth(admin=True)
    def admin_author_create():
        body = request.get_json(silent=True) or {}
        code = str(body.get('code') or '').strip().upper()
        if not CODE.fullmatch(code):
            abort(400, description='Код: от 3 до 20 знаков, буквы, цифры, - и _')
        try:
            owner = int(str(body.get('owner_id') or '').strip())
        except ValueError:
            abort(400, description='Укажите Telegram ID игрока цифрами')
        with db():
            if not db().execute("SELECT 1 FROM users WHERE id=?", (owner,)).fetchone():
                abort(404, description='Игрок не найден: он должен хотя бы раз зайти в Crafter')
            if db().execute("SELECT 1 FROM author_codes WHERE code=?", (code,)).fetchone():
                abort(409, description='Такой код уже есть')
            db().execute("INSERT INTO author_codes(code,owner_id,active,created) VALUES(?,?,1,?)", (code, owner, int(time.time())))
        audit('Author code created: ' + code)
        return {'ok': True}

    @app.post('/api/admin/new-year/author-codes/<code>/toggle')
    @auth(admin=True)
    def admin_author_toggle(code):
        with db():
            row = db().execute("SELECT active FROM author_codes WHERE code=?", (code,)).fetchone()
            if not row:
                abort(404, description='Код не найден')
            db().execute("UPDATE author_codes SET active=? WHERE code=?", (0 if row['active'] else 1, code))
        return {'ok': True}

    @app.post('/api/admin/new-year/author-codes/<code>/delete')
    @auth(admin=True)
    def admin_author_delete(code):
        with db():
            if not db().execute("DELETE FROM author_codes WHERE code=?", (code,)).rowcount:
                abort(404, description='Код не найден')
            db().execute("DELETE FROM author_support WHERE code=?", (code,))
        return {'ok': True}

    @app.post('/api/admin/new-year/author-rate')
    @auth(admin=True)
    def admin_author_rate():
        try:
            percent = Decimal(str((request.get_json(silent=True) or {}).get('percent')))
        except Exception:
            abort(400, description='Процент числом')
        if not percent.is_finite() or not Decimal('0') <= percent <= Decimal('50'):
            abort(400, description='Процент автору: от 0 до 50')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('author_rate_percent',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (plain(percent),))
        return {'ok': True}
