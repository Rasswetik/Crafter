"""Thermos (swap.coffee) trading backend: one API for Portals, Tonnel and MRKT lots, priced in TON.

Docs: https://docs.swap.coffee/technical-guides/thermos/backend-api  (beta, 2 requests/second).

* The API token (from the @thermos bot, `/api`) is stored encrypted like the Portals key and exchanged
  for a 24 h JWT, sent as `Authorization: Bearer <jwt>`.
* WORK mode purchases verify the lot is still listed, verify the Thermos balance, reserve the user's GRAM,
  buy with action WITHDRAW_OTHER so the gift lands directly on the relayer account, then poll the task.
* A buy whose result is unknown is NEVER repeated: the order goes to "review" and the reserve stays held.
"""
import json
import os
import re
import secrets
import threading
import time
from decimal import Decimal, InvalidOperation, ROUND_UP
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import abort, g, request
from werkzeug.exceptions import HTTPException

BASE = 'https://backend.thermos.gifts/api/v1'
NANO = Decimal(10) ** 9
FEE_WITHDRAW_OTHER_TON = Decimal('0.2')
MARKETS = ('PORTALS', 'TONNEL', 'MRKT')
MIN_INTERVAL = 0.55            # 2 requests / second


def to_nano(ton):
    return int((Decimal(str(ton)) * NANO).to_integral_value())


def install_thermos_market(app, db, auth, record, audit, ctx):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS thermos_orders (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL,
                status TEXT NOT NULL, reserved_gram TEXT NOT NULL, response TEXT NOT NULL, created INTEGER NOT NULL,
                UNIQUE(user_id, request_id)
            );
            CREATE TABLE IF NOT EXISTS thermos_order_items (
                gift_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, price TEXT NOT NULL, status TEXT NOT NULL
            );
        """)

    lock = threading.Lock()
    clock = {'last': 0.0}
    jwt = {'token': '', 'exp': 0}

    # ---- credentials -------------------------------------------------------------------------------
    def cipher():
        key = os.getenv('CRAFTER_PORTALS_FERNET_KEY', '')
        if not key:
            return None
        try:
            from cryptography.fernet import Fernet
            return Fernet(key.encode())
        except Exception:
            return None

    def api_token():
        row = db().execute("SELECT payload FROM settings WHERE key='thermos_token_v1'").fetchone()
        if row:
            box = cipher()
            try:
                return box.decrypt(json.loads(row[0])['encrypted'].encode()).decode() if box else ''
            except Exception:
                return ''
        return os.getenv('THERMOS_API_TOKEN', '')

    def backend():
        row = db().execute("SELECT payload FROM settings WHERE key='market_backend_v1'").fetchone()
        try:
            value = json.loads(row[0]).get('backend') if row else None
        except (ValueError, TypeError, AttributeError):
            value = None
        return value if value in ('portals', 'thermos') else 'portals'
    app.extensions['crafter_market_backend'] = backend

    # ---- HTTP --------------------------------------------------------------------------------------
    def raw(method, path, body=None, query=None, bearer=None):
        with lock:                                       # one request in flight, <= 2 per second
            wait = MIN_INTERVAL - (time.time() - clock['last'])
            if wait > 0:
                time.sleep(wait)
            clock['last'] = time.time()
            url = BASE + path + ('?' + urlencode(query) if query else '')
            headers = {'Accept': 'application/json'}
            data = None
            if body is not None:
                headers['Content-Type'] = 'application/json'
                data = json.dumps(body).encode()
            if bearer:
                headers['Authorization'] = 'Bearer ' + bearer
            with urlopen(Request(url, data=data, headers=headers, method=method), timeout=15) as response:
                return json.load(response)

    def login():
        token = api_token()
        if not token:
            abort(409, description='Токен Thermos не настроен')
        try:
            data = raw('POST', '/auth/api-token', query={'api_token': token})
        except HTTPError as error:
            abort(502, description='Thermos отклонил токен' if error.code in (401, 403) else 'Thermos временно недоступен')
        except (URLError, TimeoutError, ValueError):
            abort(503, description='Thermos недоступен')
        jwt.update(token=data.get('token', ''), exp=time.time() + 23 * 3600)
        jwt['account'], jwt['account_at'] = data, time.time()
        return data

    def remember_error(method, path, error):
        try:
            text = error.read().decode('utf-8', 'replace')[:300]
        except Exception:
            text = ''
        note = {'at': int(time.time()), 'where': method + ' ' + path.split('?')[0], 'code': error.code, 'answer': re.sub(r'[\r\n]+', ' ', text)}
        app.logger.warning('Thermos refused %s: %s %s', note['where'], error.code, note['answer'])
        try:
            with db():
                db().execute("INSERT INTO settings(key,payload) VALUES('thermos_last_error_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", (json.dumps(note, ensure_ascii=False),))
        except Exception:
            pass

    def last_error():
        try:
            row = db().execute("SELECT payload FROM settings WHERE key='thermos_last_error_v1'").fetchone()
            return json.loads(row[0]) if row else None
        except Exception:
            return None

    def call(method, path, body=None, query=None):
        """Authenticated call. Re-logins once on 401. Errors are sanitised; never retry an ambiguous POST."""
        if not jwt['token'] or jwt['exp'] < time.time():
            login()
        for attempt in (0, 1):
            try:
                return raw(method, path, body, query, jwt['token'])
            except HTTPError as error:
                if error.code == 401 and attempt == 0:
                    login()
                    continue
                remember_error(method, path, error)
                if error.code == 429:
                    abort(503, description='Thermos: лимит запросов, повторите позже')
                if error.code in (400, 404, 409, 422):
                    abort(409, description='Thermos отклонил операцию (цена или наличие изменились)')
                abort(502, description='Thermos временно не выполнил запрос')
            except (URLError, TimeoutError, ValueError):
                abort(503, description='Нет подтверждения от Thermos. Операция требует проверки, не повторяйте оплату')
    app.extensions['crafter_thermos_call'] = call

    def wait_task(task_id, limit=40):
        end = time.time() + limit
        pause = 0.35
        while time.time() < end:
            state = call('GET', '/tasks/' + str(task_id))
            combined = state.get('combined_state') or state.get('state')
            if combined in ('SUCCESS', 'FAILURE'):
                return state
            time.sleep(pause)
            pause = min(1.0, pause + 0.2)             # quick first looks: most purchases finish within a second or two
        return None

    # ---- checks ------------------------------------------------------------------------------------
    def ratio():
        return Decimal(str(app.extensions['crafter_new_year_trade_conversion']()))

    def ton_of(gift, price_gram=None):
        if gift.get('price_unit') == 'TON':
            return Decimal(str(gift['price']))
        return (Decimal(str(price_gram)) / ratio())

    def still_listed(gift, ton_price):
        """Ask the Thermos catalogue whether this exact lot is still listed at the same TON price."""
        import thermos
        catalog = ctx['public_catalog']()
        params = {'collection_id': str(gift.get('collection_id') or ''), 'search': str(gift.get('number') or ''),
                  'sort_by': 'price asc', 'markets': str(gift.get('marketplace') or 'PORTALS').upper()}
        try:
            live = thermos.gifts(params, catalog)['gifts']
        except (OSError, ValueError, KeyError, StopIteration):
            abort(503, description='Не удалось проверить наличие лота на Thermos. Повторите позже')
        return any(x['id'] == gift['id'] and Decimal(str(x['price'])) == Decimal(str(ton_price)) for x in live)

    def balance_ton():
        account = login().get('account', {})
        return Decimal(str(account.get('effective_balance', 0))) / NANO

    def can_buy(gift, price_gram):
        """WORK mode gate for games: lot still listed on Thermos and the Thermos balance covers it."""
        if app.extensions['crafter_purchase_mode']() != 'work' or not gift.get('id'):
            return
        ton_price = ton_of(gift, price_gram)
        if not still_listed(gift, ton_price):
            abort(409, description='Лот уже недоступен на маркете или цена изменилась — выберите другой')
        if balance_ton() < ton_price + FEE_WITHDRAW_OTHER_TON:
            abort(409, description='Ошибка покупки. Попробуйте позже.')

    portals_can_buy = app.extensions.get('crafter_portals_can_buy')

    def dispatch_can_buy(gift, price):
        if backend() == 'thermos':
            return can_buy(gift, price)
        if portals_can_buy:
            return portals_can_buy(gift, price)
    app.extensions['crafter_portals_can_buy'] = dispatch_can_buy

    def relayer_id():
        try:
            return int(app.extensions['crafter_relayer_credentials']()[3])
        except Exception:
            return None

    # ---- acquisition (shared by the shop and the games) ---------------------------------------------
    def acquire(gifts):
        """Buy lots on Thermos; the gifts go straight to the relayer. -> ('ok'|'failed'|'unknown', note)."""
        recipient = relayer_id()
        if recipient is None:
            return 'failed', 'Релейер не подключён'
        items = []
        for gift in gifts:
            items.append({'external_id': gift['id'], 'price': str(to_nano(ton_of(gift, gift.get('price')))),
                          'market_source': str(gift.get('marketplace') or 'PORTALS').upper(),
                          'action': {'type': 'WITHDRAW_OTHER', 'recipient_telegram_id': recipient,
                                     'anonymous': True, 'keep_on_balance': False}})
        try:
            response = call('POST', '/gifts/buy', {'gifts': items})
        except HTTPException as error:
            # 4xx/409 means Thermos refused before charging; 5xx/network may have been processed.
            return ('failed', 'Thermos отклонил покупку') if error.code == 409 else ('unknown', 'Результат покупки неизвестен')
        except Exception:
            return 'unknown', 'Результат покупки неизвестен'
        task = response.get('task_id')
        if not task:
            return 'unknown', 'Thermos не вернул задачу'
        try:
            state = wait_task(task)
        except HTTPException:
            return 'unknown', 'Не удалось получить статус покупки'
        if state is None:
            return 'unknown', 'Покупка ещё выполняется'
        if state.get('combined_state') == 'SUCCESS':
            return 'ok', ''
        subs = state.get('sub_tasks') or []
        if subs and all(s.get('state') == 'FAILURE' for s in subs):
            return 'failed', str(subs[0].get('error_message') or 'Покупка не выполнена')[:200]
        return 'unknown', 'Часть покупки выполнена — требуется ручная сверка'
    app.extensions['crafter_thermos_acquire'] = acquire

    def owns_gift(slug):
        """True only when Thermos explicitly says the account owns this unique gift (docs: GET /gifts/me/owned/{name})."""
        if not api_token():
            return False
        try:
            answer = call('GET', '/gifts/me/owned/' + re.sub(r'[^A-Za-z0-9_-]', '', str(slug)))
        except HTTPException:
            return False
        if not isinstance(answer, dict):
            return False
        for key in ('owned', 'is_owned', 'exists', 'credited'):
            if key in answer:
                return answer[key] is True
        return bool(answer.get('owned_gift_id') or answer.get('id'))
    app.extensions['crafter_thermos_owns'] = owns_gift

    def work_blockers():
        """Requirements for WORK mode when Thermos is the market. None -> not Thermos, use the Portals rules."""
        if backend() != 'thermos':
            return None
        missing = []
        if not api_token():
            missing.append('Не сохранён токен Thermos (админка → «Термос»)')
        else:
            try:
                balance_ton()                 # only proves the token works; a zero balance does not block WORK mode
            except HTTPException as error:
                missing.append(str(error.description))
        if relayer_id() is None:
            missing.append('Не подключён Relayer: купленные подарки доставляются на него')
        return missing
    app.extensions['crafter_work_blockers'] = work_blockers

    # ---- automatic TON withdrawals: paid straight from the Thermos balance (POST /balance/withdraw, fee 0.1 TON) ----
    WITHDRAW_FEE_TON = Decimal('0.1')

    def auto_withdraw_enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='thermos_auto_withdraw_v1'").fetchone()
        if not row:
            return True                                    # on by default as soon as the Thermos token is saved; the switch turns it off
        try:
            return bool(json.loads(row[0]).get('enabled') is True)
        except (ValueError, TypeError, AttributeError):
            return False

    def cron_wallet_enabled():
        row = db().execute("SELECT payload FROM settings WHERE key='crafter_auto_payout_policy'").fetchone()
        try:
            return bool(row and json.loads(row[0]).get('enabled') is True)
        except (ValueError, TypeError, AttributeError):
            return False

    def system_audit(message):
        with db():
            db().execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)', (0, message, int(time.time())))

    def refund_withdrawal(wid, uid, payload, why):
        with db():
            db().execute('BEGIN IMMEDIATE')
            row = db().execute('SELECT status FROM ton_withdrawals WHERE id=?', (wid,)).fetchone()
            if not row or row['status'] != 'processing':
                return
            payload = {**payload, 'thermos': {**payload.get('thermos', {}), 'state': 'refused', 'why': why[:200]}}
            db().execute("UPDATE ton_withdrawals SET status='cancelled',payload=? WHERE id=?", (json.dumps(payload), wid))
            account = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
            current = Decimal(str(account['balance'])) if account else Decimal(0)
            db().execute("INSERT INTO demo_accounts(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance",
                         (uid, str(current + Decimal(payload['gram']))))
        system_audit('Thermos TON withdrawal refused, GRAM returned: ' + wid)

    def auto_withdraw_once():
        """One pass: settle the withdrawals already sent, then send the queued ones. A send whose result is unknown is never repeated."""
        if not auto_withdraw_enabled() or not api_token() or cron_wallet_enabled():
            return {'sent': 0, 'settled': 0}
        call_ = app.extensions['crafter_thermos_call']
        sent = settled = 0
        for row in db().execute("SELECT id,user_id,payload FROM ton_withdrawals WHERE status='processing'").fetchall():
            p = json.loads(row['payload'])
            ref = (p.get('thermos') or {}).get('id')
            if ref is None:
                continue
            try:
                state = str(call_('GET', '/balance/withdraw/status/' + str(ref)).get('status') or '').upper()
            except HTTPException:
                continue
            if state == 'PROCESSED':
                with db():
                    db().execute("UPDATE ton_withdrawals SET status='confirmed',tx=? WHERE id=? AND status='processing'", ('thermos:' + str(ref), row['id']))
                system_audit('Thermos TON withdrawal confirmed: ' + row['id'])
                settled += 1
            elif state == 'FAILED':
                refund_withdrawal(row['id'], row['user_id'], p, 'Thermos не смог отправить вывод')
                settled += 1
        queued = db().execute("SELECT id,user_id,payload FROM ton_withdrawals WHERE status='queued' ORDER BY created LIMIT 5").fetchall()
        if queued:
            try:
                free = app.extensions['crafter_thermos_balance']()
            except HTTPException:
                return {'sent': sent, 'settled': settled}
        for row in queued:
            p = json.loads(row['payload'])
            need = Decimal(p['nano']) / NANO + WITHDRAW_FEE_TON
            if free < need:
                break                                      # not enough TON on Thermos yet: stays queued, tried again later
            with db():
                db().execute('BEGIN IMMEDIATE')
                claimed = db().execute("UPDATE ton_withdrawals SET status='processing',payload=? WHERE id=? AND status='queued'",
                                       (json.dumps({**p, 'thermos': {'state': 'sending', 'at': int(time.time())}}), row['id'])).rowcount
            if not claimed:
                continue
            free -= need
            try:
                answer = call_('POST', '/balance/withdraw', {'amount': int(p['nano']), 'destination': p['receiver']})
            except HTTPException as error:
                if error.code == 409:                      # Thermos refused before sending anything
                    refund_withdrawal(row['id'], row['user_id'], p, 'Thermos отклонил вывод')
                else:                                      # unknown outcome: do NOT repeat, leave it for a manual check
                    with db():
                        db().execute("UPDATE ton_withdrawals SET payload=? WHERE id=?", (json.dumps({**p, 'thermos': {'state': 'unknown', 'at': int(time.time())}}), row['id']))
                    system_audit('Thermos TON withdrawal needs a manual check: ' + row['id'])
                continue
            ref = answer.get('id') if isinstance(answer, dict) else None
            with db():
                db().execute("UPDATE ton_withdrawals SET payload=? WHERE id=?", (json.dumps({**p, 'thermos': {'state': 'sent', 'id': ref, 'at': int(time.time())}}), row['id']))
            system_audit('Thermos TON withdrawal sent: ' + row['id'])
            sent += 1
        return {'sent': sent, 'settled': settled}
    app.extensions['crafter_thermos_balance'] = balance_ton
    app.extensions['crafter_thermos_withdraw_once'] = auto_withdraw_once

    def start_withdraw_worker():
        def loop():
            while True:
                try:
                    with app.app_context():
                        app.extensions['crafter_thermos_withdraw_once']()
                except Exception:
                    app.logger.exception('Thermos auto-withdraw pass failed')
                time.sleep(20)
        threading.Thread(target=loop, name='thermos-auto-withdraw', daemon=True).start()
    if not app.config.get('TESTING') and os.getenv('CRAFTER_NO_WORKERS') != '1':
        start_withdraw_worker()

    @app.post('/api/admin/thermos/auto-withdraw')
    @auth(admin=True)
    def thermos_auto_withdraw_toggle():
        flag = (request.get_json(silent=True) or {}).get('enabled')
        if not isinstance(flag, bool):
            abort(400, description='enabled: true или false')
        if flag and not api_token():
            abort(409, description='Сначала сохраните токен Thermos')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('thermos_auto_withdraw_v1',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (json.dumps({'enabled': flag}),))
        audit('Thermos TON auto-withdraw ' + ('on' if flag else 'off'))
        return overview()

    # ---- admin -------------------------------------------------------------------------------------
    def overview():
        return {'backend': backend(), 'token_configured': bool(api_token()), 'encryption_ready': bool(cipher()),
                'markets': list(MARKETS), 'auto_withdraw': auto_withdraw_enabled(), 'last_error': last_error()}

    @app.get('/api/admin/thermos')
    @auth(admin=True)
    def thermos_overview():
        return overview()

    @app.post('/api/admin/thermos/token')
    @auth(admin=True)
    def thermos_save_token():
        token = (request.get_json(silent=True) or {}).get('token')
        if not isinstance(token, str) or not 8 <= len(token.strip()) <= 600 or any(c.isspace() for c in token.strip()):
            abort(400, description='Введите токен Thermos без пробелов')
        box = cipher()
        if not box:
            abort(503, description='Нужно задать CRAFTER_PORTALS_FERNET_KEY')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('thermos_token_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (json.dumps({'encrypted': box.encrypt(token.strip().encode()).decode(), 'updated': int(time.time())}),))
        jwt.update(token='', exp=0)
        audit('Thermos API token saved (redacted)')
        return overview()

    @app.post('/api/admin/thermos/check')
    @auth(admin=True)
    def thermos_check():
        data = login()
        account = data.get('account', {})
        deposit = call('GET', '/balance/deposit', query={'currency': 'TON'})
        return {**overview(), 'connected': True, 'telegram_user_id': account.get('telegram_user_id'),
                'balance_ton': str(Decimal(str(account.get('effective_balance', 0))) / NANO),
                'deposit_address': deposit.get('address'), 'deposit_memo': deposit.get('memo')}

    @app.post('/api/admin/thermos/backend')
    @auth(admin=True)
    def thermos_set_backend():
        body = request.get_json(silent=True) or {}
        if body.get('backend') not in ('portals', 'thermos') or body.get('confirm') != 'SET_MARKET_BACKEND':
            abort(400, description='Выберите источник маркета и подтвердите')
        if body['backend'] == 'thermos' and not api_token():
            abort(409, description='Сначала сохраните токен Thermos')
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES('market_backend_v1',?) "
                         "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (json.dumps({'backend': body['backend']}),))
        audit('Market backend: ' + body['backend'])
        return overview()

    # ---- shop purchase (WORK mode) ---------------------------------------------------------------
    def public_rows(ids):
        found = {}
        for row in db().execute("SELECT payload FROM cache WHERE key LIKE 'public:market:%' AND updated>=? ORDER BY updated DESC",
                                (int(time.time()) - 90,)):
            try:
                data = json.loads(row['payload'])
            except (TypeError, ValueError):
                continue
            if data.get('source') != 'thermos':
                continue
            for gift in data.get('gifts', []):
                if gift.get('id') in ids and gift['id'] not in found:
                    found[gift['id']] = gift
        return found

    @app.post('/api/thermos/buy')
    @auth()
    def thermos_buy():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400)
        ids, rid = data.get('gift_ids'), data.get('request_id')
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 20 or len(set(map(str, ids))) != len(ids)
                or not all(isinstance(x, str) and 1 <= len(x) <= 120 for x in ids)
                or not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9:_-]{1,100}', rid)):
            abort(400, description='Неверные подарки или номер запроса')
        if backend() != 'thermos' or app.extensions['crafter_purchase_mode']() != 'work' or app.config['DEMO_MODE']:
            abort(409, description='Покупка через Thermos сейчас выключена')
        if not api_token():
            abort(409, description='Токен Thermos не настроен')
        uid = g.user['id']
        ids = sorted(ids)
        replay = db().execute('SELECT 1 FROM thermos_orders WHERE user_id=? AND request_id=?', (uid, rid)).fetchone()
        found = {}
        if not replay:
            found = public_rows(set(ids))
            if len(found) != len(ids):
                abort(409, description='Данные маркета устарели. Обновите каталог перед покупкой.')
            for gift in found.values():
                if gift.get('price_unit') != 'TON':
                    abort(409, description='Неподдерживаемая цена лота')
                if not still_listed(gift, gift['price']):
                    abort(409, description='Лот уже недоступен или цена изменилась. Обновите маркет')
            need = sum((Decimal(str(x['price'])) for x in found.values()), Decimal(0)) + FEE_WITHDRAW_OTHER_TON * len(ids)
            if balance_ton() < need:
                abort(409, description='Ошибка покупки. Попробуйте позже.')
        with db():
            db().execute('BEGIN IMMEDIATE')
            previous = db().execute('SELECT * FROM thermos_orders WHERE user_id=? AND request_id=?', (uid, rid)).fetchone()
            if previous:
                if json.loads(previous['payload']) != ids:
                    abort(409, description='Номер покупки уже использован для других подарков')
                return {'ok': previous['status'] == 'complete', 'status': previous['status'],
                        'order_id': previous['id'], **json.loads(previous['response'])}
            prices = {i: (Decimal(str(found[i]['price'])) * ratio()).quantize(Decimal('0.01'), rounding=ROUND_UP) for i in ids}
            total = sum(prices.values(), Decimal(0))
            expected_ton = data.get('expected_total_ton')
            if expected_ton is not None:
                try:
                    shown = sum((Decimal(str(found[i]['price'])) for i in ids), Decimal(0))
                    if Decimal(str(expected_ton)) != shown:
                        abort(409, description='Цена изменилась — обновите маркет')
                except (InvalidOperation, ValueError):
                    abort(400)
            row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
            balance = Decimal(row['balance']) if row else Decimal(0)
            if total > balance:
                abort(409, description='Недостаточно GRAM на балансе Crafter')
            for gid in ids:
                other = db().execute('SELECT status FROM thermos_order_items WHERE gift_id=?', (gid,)).fetchone()
                if other and other['status'] != 'failed':
                    abort(409, description='Этот подарок уже находится в обработке')
                if other:
                    db().execute("DELETE FROM thermos_order_items WHERE gift_id=? AND status='failed'", (gid,))
            order_id = secrets.token_hex(16)
            db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(balance - total), uid))
            db().execute('INSERT INTO thermos_orders VALUES (?,?,?,?,?,?,?,?)',
                         (order_id, uid, rid, json.dumps(ids), 'processing', str(total), '{}', int(time.time())))
            for gid in ids:
                db().execute('INSERT INTO thermos_order_items VALUES (?,?,?,?)', (gid, order_id, str(prices[gid]), 'processing'))
        outcome, note = acquire([found[i] for i in ids])
        if outcome == 'unknown':
            with db():
                db().execute("UPDATE thermos_orders SET status='review',response=? WHERE id=?",
                             (json.dumps({'note': note}), order_id))
                db().execute("UPDATE thermos_order_items SET status='review' WHERE order_id=?", (order_id,))
            abort(409, description='Покупка требует ручной сверки. Не нажимайте «Оплатить» повторно.')
        refused = None
        with db():
            db().execute('BEGIN IMMEDIATE')
            if outcome == 'failed':
                row = db().execute('SELECT balance FROM demo_accounts WHERE user_id=?', (uid,)).fetchone()
                db().execute('UPDATE demo_accounts SET balance=? WHERE user_id=?', (str(Decimal(row['balance']) + total), uid))
                db().execute("UPDATE thermos_order_items SET status='failed' WHERE order_id=?", (order_id,))
                db().execute("UPDATE thermos_orders SET status='failed',response=? WHERE id=?",
                             (json.dumps({'note': note}), order_id))
                refused = note or 'Thermos отказал'
            else:
                gifts = []
                for gid in ids:
                    original = found[gid]
                    gift = {**original, 'id': gid, 'price': str(prices[gid]), 'price_unit': 'GRAM', 'source_id': gid,
                            'source_price': str(original['price']), 'source_price_unit': 'TON',
                            'origin': 'thermos', 'relayer_pending': True}
                    db().execute('INSERT INTO inventory VALUES (?,?,?,?)', (uid, gid, json.dumps(gift), 'unlisted'))
                    db().execute("UPDATE thermos_order_items SET status='purchased' WHERE gift_id=?", (gid,))
                    record('buy', {'gift': gift, 'price': str(prices[gid]), 'scope': 'thermos'})
                    gifts.append(gift)
                result = {'gifts': gifts, 'balance': str(balance - total), 'total': str(total), 'scope': 'thermos'}
                db().execute("UPDATE thermos_orders SET status='complete',response=? WHERE id=?",
                             (json.dumps(result, ensure_ascii=False), order_id))
        if refused is not None:        # abort only AFTER the refund transaction has committed
            abort(409, description='Покупка не выполнена: ' + refused + '. GRAM возвращены.')
        return {'ok': True, 'status': 'complete', 'order_id': order_id, **result}
