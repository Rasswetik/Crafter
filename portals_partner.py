"""Portals partner operations: server-side key, shared 1 rps gate, verified purchases.

Public catalogue searches are handled by portals_public.py and never use this key.
Real paid endpoints fail closed unless an operator configures and tests the key
and deliberately unlocks live purchasing. Never retry an ambiguous paid POST.
"""
import json
import os
import re
import secrets
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import abort, g, request
from werkzeug.exceptions import HTTPException

from resale import cap_funded_balance

BASE = "https://portal-market.com/partners/"
CENT = Decimal("0.01")
RATE_WINDOW_MS = 1150
MAX_BATCH = 50

def to_gram(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        abort(400, description="Некорректная цена GRAM")
    if not amount.is_finite() or amount < CENT or amount > Decimal("1000000"):
        abort(400, description="Некорректная цена GRAM")
    if amount != amount.quantize(Decimal("0.000000001")):
        abort(400, description="Цена GRAM должна содержать не более 9 знаков после запятой")
    return amount

def install_portals_partner(app, db, auth, record, audit):
    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS portals_partner_credentials (
                id INTEGER PRIMARY KEY, encrypted_key TEXT NOT NULL, updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portals_partner_rate_gate (
                id INTEGER PRIMARY KEY, slot_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portals_partner_orders (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
                request_id TEXT NOT NULL, payload TEXT NOT NULL,
                status TEXT NOT NULL, reserved_gram TEXT NOT NULL,
                response TEXT NOT NULL, created INTEGER NOT NULL,
                UNIQUE(user_id,request_id)
            );
            CREATE TABLE IF NOT EXISTS portals_partner_order_items (
                nft_id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
                price TEXT NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portals_partner_withdrawals (
                id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, nft_id TEXT NOT NULL,
                request_id TEXT NOT NULL, status TEXT NOT NULL,
                portal_withdrawal_id INTEGER, created INTEGER NOT NULL,
                UNIQUE(user_id,request_id)
            );
            CREATE TABLE IF NOT EXISTS portals_partner_policy (
                id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL,
                verified_at INTEGER NOT NULL
            );
        """)
        db().commit()

    def cipher():
        key = os.getenv("CRAFTER_PORTALS_FERNET_KEY", "")
        if not key:
            return None
        try:
            from cryptography.fernet import Fernet
            return Fernet(key.encode())
        except Exception:
            return None

    def partner_key():
        row = db().execute("SELECT encrypted_key FROM portals_partner_credentials WHERE id=1").fetchone()
        if row:
            box = cipher()
            if not box:
                return ""
            try:
                return box.decrypt(row["encrypted_key"].encode()).decode()
            except Exception:
                return ""
        return os.getenv("PORTALS_API_KEY", "")

    def rate_slot():
        # A committed database lease, not an in-process lock: shared by all
        # Gunicorn workers, and by every authorised partner operation.
        if not app.config.get("DATABASE_URL"):
            abort(503, description="Для Partner API нужна общая PostgreSQL база")
        now = int(time.time() * 1000)
        with db():
            db().execute("BEGIN IMMEDIATE")
            row = db().execute("SELECT slot_ms FROM portals_partner_rate_gate WHERE id=1").fetchone()
            at = max(now, int(row["slot_ms"]) + RATE_WINDOW_MS) if row else now
            if at - now > 10000:
                abort(503, description="Очередь Portals загружена. Повторите запрос позже")
            db().execute("INSERT INTO portals_partner_rate_gate VALUES (1,?) ON CONFLICT(id) DO UPDATE SET slot_ms=excluded.slot_ms", (at,))
        time.sleep(max(0, at - int(time.time()*1000)) / 1000)

    def partner(method, path, body=None, query=None):
        if (method, path) not in {
            ("GET", "users/wallets/"), ("GET", "nfts/owned"),
            ("POST", "nfts"), ("POST", "nfts/withdraw"),
            ("GET", "nfts/withdrawals/statuses"),
        }:
            abort(400, description="Недопустимая операция Portals")
        key = partner_key()
        if not key:
            abort(409, description="Ключ Portals Partner API ещё не настроен")
        rate_slot()
        url = BASE + path + ("?" + urlencode(query, doseq=True) if query else "")
        headers = {"Accept":"application/json", "Authorization":"partners " + key}
        encoded = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            encoded = json.dumps(body, ensure_ascii=False).encode()
        try:
            with urlopen(Request(url, data=encoded, headers=headers, method=method), timeout=18) as response:
                return json.load(response)
        except HTTPError as error:
            # Do not expose third-party text that could contain secrets.
            if error.code in (401,403):
                abort(502, description="Portals отклонил партнёрский ключ или подписку")
            if error.code == 429:
                abort(503, description="Portals: лимит запросов, повторите позже")
            if error.code == 422:
                abort(409, description="Portals отклонил цену или наличие подарка")
            abort(502, description="Portals временно не выполнил запрос")
        except (URLError, TimeoutError, ValueError):
            # After a paid POST, never resend: the outcome may be unknown.
            abort(503, description="Нет подтверждения от Portals. Операция требует проверки, не повторяйте оплату")

    def policy():
        row=db().execute("SELECT enabled,verified_at FROM portals_partner_policy WHERE id=1").fetchone()
        return (bool(row["enabled"]), int(row["verified_at"])) if row else (False,0)

    def status():
        row = db().execute("SELECT updated FROM portals_partner_credentials WHERE id=1").fetchone()
        enabled, checked_at=policy()
        key_present=bool(partner_key())
        server_gate=os.getenv("CRAFTER_PORTALS_LIVE_PURCHASES") == "1"
        verified=checked_at > 0 and int(time.time())-checked_at < 3600
        return {
            "key_configured": key_present,
            "key_location": "encrypted_db" if row else ("environment" if os.getenv("PORTALS_API_KEY") else "none"),
            "encryption_ready": bool(cipher()),
            "durable_db": bool(app.config.get("DATABASE_URL")),
            "live_purchases": bool(server_gate and enabled and key_present and app.config.get("DATABASE_URL")),
            "server_gate": server_gate,
            "operator_enabled": enabled,
            "verified_recently": verified,
            "can_enable":bool(server_gate and key_present and verified and app.config.get("DATABASE_URL")),
            "public_catalog_without_key": True,
            "partner_limit_rps": 1,
        }

    @app.get("/api/admin/portal/partner")
    @auth(admin=True)
    def portal_partner_info():
        return status()

    @app.post("/api/admin/portal/partner/key")
    @auth(admin=True)
    def portal_partner_save_key():
        payload = request.get_json(silent=True) or {}
        key = payload.get("key")
        if not isinstance(key,str) or not 12 <= len(key.strip()) <= 500 or any(c.isspace() for c in key.strip()):
            abort(400, description="Введите действующий Partner API key Portals без пробелов")
        box = cipher()
        if not box or not app.config.get("DATABASE_URL"):
            abort(503, description="Нужно настроить CRAFTER_PORTALS_FERNET_KEY и PostgreSQL в Render")
        token = box.encrypt(key.strip().encode()).decode()
        with db():
            db().execute("INSERT INTO portals_partner_credentials VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,updated=excluded.updated",
                         (token, int(time.time())))
        with db():
            db().execute("INSERT INTO portals_partner_policy VALUES (1,0,0) ON CONFLICT(id) DO UPDATE SET enabled=0,verified_at=0")
        audit("Portals Partner API key saved (redacted)")
        return status()

    @app.post("/api/admin/portal/partner/check")
    @auth(admin=True)
    def portal_partner_check():
        details = partner("GET", "users/wallets/")
        with db():
            db().execute("INSERT INTO portals_partner_policy VALUES (1,0,?) ON CONFLICT(id) DO UPDATE SET verified_at=excluded.verified_at",
                         (int(time.time()),))
        return {**status(), "connected":True,
                "balance":str(details.get("balance","—")),
                "frozen_funds":str(details.get("frozen_funds","—"))}

    @app.post("/api/admin/portal/partner/activate")
    @auth(admin=True)
    def portal_partner_activate():
        body=request.get_json(silent=True) or {}
        enabled=body.get("enabled")
        if type(enabled) is not bool:abort(400)
        if enabled:
            current=status()
            if not current["can_enable"] or body.get("confirmation")!="ВКЛЮЧИТЬ РЕАЛЬНЫЕ ПОКУПКИ":
                abort(409, description="Сначала проверьте ключ и подключение к PostgreSQL")
        with db():
            row=policy()
            db().execute("INSERT INTO portals_partner_policy VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled",
                         (int(enabled),row[1]))
        audit("Portals live checkout " + ("enabled" if enabled else "disabled"))
        return status()

    @app.get("/api/admin/portal/partner/orders")
    @auth(admin=True)
    def portal_partner_orders():
        rows = db().execute("SELECT id,user_id,request_id,status,reserved_gram,created FROM portals_partner_orders ORDER BY created DESC LIMIT 30").fetchall()
        return {"orders":[dict(row) for row in rows]}

    def public_rows(ids):
        found = {}
        threshold = int(time.time()) - 75
        for row in db().execute("SELECT payload FROM cache WHERE key LIKE 'public:market:%' AND updated>=?", (threshold,)):
            try:
                data = json.loads(row["payload"])
            except (TypeError,ValueError):
                continue
            if data.get("source") != "portals" or data.get("price_unit") != "GRAM":
                continue
            for gift in data.get("gifts", []):
                if gift.get("id") in ids and gift.get("price_unit") == "GRAM" and gift.get("id") not in found:
                    found[gift["id"]] = gift
        return found

    def summary(row):
        try:
            result = json.loads(row["response"])
        except Exception:
            result = {}
        return {"ok":row["status"] == "complete", "status":row["status"],
                "order_id":row["id"], "request_id":row["request_id"], **result}

    @app.get("/api/portals/purchase/<rid>")
    @auth()
    def portal_purchase_status(rid):
        row = db().execute("SELECT * FROM portals_partner_orders WHERE user_id=? AND request_id=?",
                           (g.user["id"],rid)).fetchone()
        if not row:
            abort(404)
        return summary(row)

    @app.post("/api/portals/buy")
    @auth()
    def portal_purchase():
        payload = request.get_json(silent=True)
        if not isinstance(payload,dict):
            abort(400)
        ids = payload.get("gift_ids")
        rid = payload.get("request_id")
        if (not isinstance(ids,list) or not 1 <= len(ids) <= MAX_BATCH or
            len(set(map(str,ids))) != len(ids) or
            not all(isinstance(x,str) and re.fullmatch(r"[a-fA-F0-9-]{36}", x) for x in ids) or
            not isinstance(rid,str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,100}",rid)):
            abort(400, description="Неверные ID подарков или номер запроса")
        # Guard defaults OFF, so no real funds move until separately approved.
        if app.config["DEMO_MODE"] or not status()["live_purchases"]:
            abort(409, description="Реальные покупки Portals выключены. Администратор должен проверить ключ и активировать оплату.")
        if not partner_key() or not app.config.get("DATABASE_URL"):
            abort(409, description="Нет защищённого ключа Partner API или PostgreSQL")
        ids = sorted(ids)
        with db():
            db().execute("BEGIN IMMEDIATE")
            previous = db().execute("SELECT * FROM portals_partner_orders WHERE user_id=? AND request_id=?",
                                    (g.user["id"],rid)).fetchone()
            if previous:
                if json.loads(previous["payload"]) != ids:
                    abort(409, description="Номер покупки уже использован для других подарков")
                return summary(previous)
            found = public_rows(set(ids))
            if len(found) != len(ids):
                abort(409, description="Данные Portals устарели. Обновите каталог перед покупкой.")
            prices = {gift_id:to_gram(found[gift_id]["price"]) for gift_id in ids}
            total = sum(prices.values(), Decimal("0"))
            if payload.get("expected_total") is not None:
                # UI shows 2 decimals, but partner pricing may be fractional
                # to 9 decimals. Never round the actual paid API price.
                visible = sum((p.quantize(CENT, rounding=ROUND_HALF_UP) for p in prices.values()), Decimal("0"))
                if to_gram(payload["expected_total"]) != visible:
                    abort(409, description="Цена изменилась — обновите корзину")
            row = db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",(g.user["id"],)).fetchone()
            balance = Decimal(row["balance"]) if row else Decimal("0")
            if total > balance:
                abort(409, description="Недостаточно GRAM в Crafter")
            for gift_id in ids:
                other = db().execute("SELECT status FROM portals_partner_order_items WHERE nft_id=?", (gift_id,)).fetchone()
                if other:
                    if other["status"] == "failed":
                        db().execute("DELETE FROM portals_partner_order_items WHERE nft_id=? AND status='failed'",(gift_id,))
                    else:
                        abort(409, description="Этот подарок уже находится в обработке")
            order_id = secrets.token_hex(16)
            db().execute("UPDATE demo_accounts SET balance=? WHERE user_id=?",(str(balance-total),g.user["id"]))
            db().execute("INSERT INTO portals_partner_orders VALUES (?,?,?,?,?,?,?,?)",
                         (order_id,g.user["id"],rid,json.dumps(ids),"processing",str(total),"{}",int(time.time())))
            for gift_id in ids:
                db().execute("INSERT INTO portals_partner_order_items VALUES(?,?,?,?)",
                             (gift_id,order_id,str(prices[gift_id]),"processing"))
        try:
            response = partner("POST","nfts", {"nft_details":[{"id":x,"price":str(prices[x])} for x in ids]})
        except Exception as error:
            # Network failure or timeout could have completed the purchase.
            # Keep reserved GRAM; never re-send this paid POST automatically.
            with db():
                db().execute("UPDATE portals_partner_orders SET status='review',response=? WHERE id=?",
                             (json.dumps({"note":"Неопределённый результат Portals. Требуется ручная сверка."}),order_id))
                db().execute("UPDATE portals_partner_order_items SET status='review' WHERE order_id=?", (order_id,))
            if isinstance(error, HTTPException):
                abort(409,description="Покупка требует ручной сверки. Не нажимайте «Оплатить» повторно.")
            raise
        results = response.get("purchase_results")
        valid = (isinstance(results,list) and len(results) == len(ids) and
                 {x.get("id") for x in results if isinstance(x,dict)} == set(ids) and
                 all(x.get("status") in ("success","failed") for x in results if isinstance(x,dict)))
        if not valid:
            with db():
                db().execute("UPDATE portals_partner_orders SET status='review',response=? WHERE id=?",
                             (json.dumps({"note":"Portals вернул неизвестный формат результата"}),order_id))
            abort(409, description="Нужна ручная проверка результатов Portals")
        success_ids = {x["id"] for x in results if x["status"] == "success"}
        expected_spent = sum((prices[x] for x in success_ids), Decimal("0"))
        if (int(response.get("total_purchased",-1)) != len(success_ids) or
            Decimal(str(response.get("total_spent","-1"))) != expected_spent):
            with db():
                db().execute("UPDATE portals_partner_orders SET status='review',response=? WHERE id=?",
                             (json.dumps({"note":"Расхождение итогов Portals и результата по NFT"}),order_id))
            abort(409, description="Расхождение суммы Portals — требуется ручная сверка")
        with db():
            db().execute("BEGIN IMMEDIATE")
            row=db().execute("SELECT balance FROM demo_accounts WHERE user_id=?",(g.user["id"],)).fetchone()
            current_balance=Decimal(row["balance"])
            refund=total-expected_spent
            final_balance=current_balance+refund
            db().execute("UPDATE demo_accounts SET balance=? WHERE user_id=?",
                         (str(final_balance),g.user["id"]))
            gifts=[]
            for gift_id in ids:
                db().execute("UPDATE portals_partner_order_items SET status=? WHERE nft_id=?",
                             ("purchased" if gift_id in success_ids else "failed",gift_id))
                if gift_id not in success_ids:
                    continue
                gift={**found[gift_id],
                      "id":gift_id,
                      "price":str(prices[gift_id]),
                      "source_id":gift_id,
                      "origin":"portals-partner",
                      "partner_custody":True,
                      "price_unit":"GRAM"}
                db().execute("INSERT INTO inventory VALUES (?,?,?,?)",
                             (g.user["id"],gift_id,json.dumps(gift),"unlisted"))
                gifts.append(gift)
                record("buy",{"gift":gift,"price":str(prices[gift_id]),"scope":"portals-partner"})
            if gifts:
                cap_funded_balance(db(),g.user["id"],final_balance)
            result={"gifts":gifts,"failed":[{"id":x["id"],"reason":x.get("reason","")} for x in results if x["status"]=="failed"],
                    "balance":str(final_balance),"total":str(expected_spent),"scope":"portals-partner"}
            db().execute("UPDATE portals_partner_orders SET status='complete',response=? WHERE id=?",
                         (json.dumps(result,ensure_ascii=False),order_id))
        return {"ok":True,"status":"complete","order_id":order_id,**result}

    @app.post("/api/portals/withdraw")
    @auth()
    def portal_withdraw():
        data=request.get_json(silent=True) or {}
        gift_id=data.get("gift_id")
        rid=data.get("request_id")
        if not isinstance(gift_id,str) or not re.fullmatch(r"[a-fA-F0-9-]{36}",gift_id) or \
           not isinstance(rid,str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,100}",rid):
            abort(400)
        if not app.config.get("DATABASE_URL") or not partner_key():
            abort(409,description="Partner API не настроен")
        with db():
            db().execute("BEGIN IMMEDIATE")
            old=db().execute("SELECT * FROM portals_partner_withdrawals WHERE user_id=? AND request_id=?",
                             (g.user["id"],rid)).fetchone()
            if old:
                if old["nft_id"]!=gift_id:abort(409,description="Номер запроса использован")
                return {"ok":True,"status":old["status"],"withdrawal_id":old["portal_withdrawal_id"]}
            row=db().execute("SELECT payload,status FROM inventory WHERE user_id=? AND nft_id=?",
                             (g.user["id"],gift_id)).fetchone()
            if not row or row["status"]!="unlisted":
                abort(409,description="Подарок нельзя вывести")
            gift=json.loads(row["payload"])
            if gift.get("origin")!="portals-partner":
                abort(409,description="Для этого подарка используйте его собственный способ вывода")
            db().execute("INSERT INTO portals_partner_withdrawals VALUES(?,?,?,?,?,?,?)",
                         (secrets.token_hex(16),g.user["id"],gift_id,rid,"processing",None,int(time.time())))
            db().execute("UPDATE inventory SET status='withdrawing' WHERE user_id=? AND nft_id=?",
                         (g.user["id"],gift_id))
        try:
            response=partner("POST","nfts/withdraw",{"gift_ids":[gift_id],"recipient_id":g.user["id"],"unsafe_transfer":False})
            withdraw_ids=response.get("withdrawals_ids")
            if not isinstance(withdraw_ids,list) or len(withdraw_ids)!=1 or type(withdraw_ids[0]) is not int:
                raise RuntimeError("Unknown withdrawal response")
        except Exception:
            with db():
                db().execute("UPDATE portals_partner_withdrawals SET status='review' WHERE user_id=? AND request_id=?",
                             (g.user["id"],rid))
            abort(409,description="Результат вывода неизвестен. Не повторяйте запрос; обратитесь в поддержку.")
        with db():
            db().execute("UPDATE portals_partner_withdrawals SET status='pending',portal_withdrawal_id=? WHERE user_id=? AND request_id=?",
                         (withdraw_ids[0],g.user["id"],rid))
        return {"ok":True,"status":"pending","withdrawal_id":withdraw_ids[0]}

    @app.post("/api/portals/withdraw/check")
    @auth()
    def portal_withdraw_check():
        data=request.get_json(silent=True) or {}
        rid=data.get("request_id")
        row=db().execute("SELECT * FROM portals_partner_withdrawals WHERE user_id=? AND request_id=?",
                         (g.user["id"],rid)).fetchone()
        if not row:
            abort(404)
        if row["status"] != "pending":
            return {"status":row["status"]}
        response=partner("GET","nfts/withdrawals/statuses",query={"ids":[row["portal_withdrawal_id"]]})
        match=next((x for x in response.get("statuses",[]) if x.get("id")==row["portal_withdrawal_id"]),None)
        if not match:
            return {"status":"pending"}
        state=match.get("status")
        if state not in ("completed","recovered","errored","pending","unknown"):
            state="unknown"
        if state=="completed":
            with db():
                db().execute("BEGIN IMMEDIATE")
                db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='withdrawing'",
                             (g.user["id"],row["nft_id"]))
                db().execute("UPDATE portals_partner_withdrawals SET status='completed' WHERE id=?",(row["id"],))
        elif state in ("errored","recovered"):
            with db():
                db().execute("BEGIN IMMEDIATE")
                db().execute("UPDATE inventory SET status='unlisted' WHERE user_id=? AND nft_id=? AND status='withdrawing'",
                             (g.user["id"],row["nft_id"]))
                db().execute("UPDATE portals_partner_withdrawals SET status=? WHERE id=?",
                             (state,row["id"]))
        return {"status":state,"withdrawal_id":row["portal_withdrawal_id"]}
