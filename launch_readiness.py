"""Admin-only readiness check and conservative reset of LOCAL simulated gifts.

NEVER invokes Portals, TON, Telegram or any outside service. A real NFT cannot
be returned to Portals by deleting its Crafter database row. The reset ONLY
removes gifts explicitly tagged as synthetic and never touches real deposits,
balance ledgers, wallet payments or historical audit entries.
"""
import hashlib
import json
import os
import secrets
import time
from flask import abort, g, request

SYNTHETIC_ORIGINS = frozenset(("local-purchase", "application-craft", "admin-grant"))
CONFIRM_TEXT = "СБРОС ТЕСТОВЫХ ПОДАРКОВ"
MAX_RESET = 5000
TTL = 180


def install_launch_readiness(app, db, auth, audit):
    with app.app_context(), db():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS launch_reset_plans (
                token TEXT PRIMARY KEY, actor INTEGER NOT NULL,
                signature TEXT NOT NULL, created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS launch_reset_backups (
                batch_id TEXT NOT NULL, user_id INTEGER NOT NULL, nft_id TEXT NOT NULL,
                payload TEXT NOT NULL, status TEXT NOT NULL,
                created INTEGER NOT NULL, PRIMARY KEY(batch_id,user_id,nft_id)
            );
        """)

    def classification():
        rows = db().execute("SELECT user_id,nft_id,payload,status FROM inventory").fetchall()
        eligible = []
        protected = []
        obstructed = []
        for row in rows:
            try:
                gift = json.loads(row["payload"])
            except (TypeError, ValueError):
                protected.append((row["user_id"], row["nft_id"]))
                continue
            origin = str(gift.get("origin") or "")
            is_fake = (origin in SYNTHETIC_ORIGINS or
                       (origin == "" and str(row["nft_id"]).startswith("demo-")))
            if not is_fake:
                protected.append((row["user_id"], row["nft_id"]))
            elif row["status"] != "unlisted":
                obstructed.append((row["user_id"], row["nft_id"], row["status"]))
            else:
                eligible.append((row["user_id"], row["nft_id"], row["payload"], row["status"]))
        # Do not delete any gift referenced in an active Crafter listing or
        # an incomplete withdrawal. Never break assets during transfer.
        listed = {(r["seller_id"], r["gift_id"]) for r in db().execute(
            "SELECT seller_id,gift_id FROM crafter_listings")}
        pending = {(r["user_id"], r["gift_id"]) for r in db().execute(
            "SELECT user_id,gift_id FROM gift_withdrawals WHERE status IN ('queued','pending','processing')")}
        kept = []
        for row in eligible:
            if (row[0], row[1]) in listed or (row[0], row[1]) in pending:
                obstructed.append((row[0], row[1], "pending"))
            else:
                kept.append(row)
        eligible = kept
        # Deterministic digest guards against a concurrent change since preview.
        serial = json.dumps(
            sorted([(str(a), str(b), str(s)) for a,b,_,s in eligible]) +
            sorted([(str(a), str(b), str(s)) for a,b,s in obstructed]),
            separators=(",", ":"), ensure_ascii=False)
        signature = hashlib.sha256(serial.encode()).hexdigest()
        return eligible, protected, obstructed, signature

    def snapshot():
        eligible, protected, blocked, signature = classification()
        local_purchases = db().execute("SELECT COUNT(*) FROM local_purchases").fetchone()[0]
        return {
            "candidate_gifts": len(eligible),
            "protected_gifts": len(protected),
            "blocked_gifts": len(blocked),
            "local_purchases": int(local_purchases),
            "portals_key_configured": bool(app.config["PORTALS_API_KEY"]),
            "durable_database": bool(app.config.get("DATABASE_URL")),
            "reset_unlocked": os.getenv("CRAFTER_ALLOW_LOCAL_RESET") == "1",
            "demo_mode": bool(app.config["DEMO_MODE"]),
            "portals_real_purchases_enabled": False,
            "note": "Реальные депозиты и история платежей не удаляются. Сброс локальных записей не возвращает NFT на Portals.",
            "signature": signature,
        }

    @app.get("/api/admin/launch/readiness")
    @auth(admin=True)
    def launch_readiness():
        info = snapshot()
        info.pop("signature", None)
        return info

    @app.post("/api/admin/launch/prepare")
    @auth(admin=True)
    def launch_prepare():
        info = snapshot()
        if info["blocked_gifts"]:
            abort(409, description="Есть активные лоты, стейкинг или заявки на вывод. Сначала завершите эти операции.")
        if info["candidate_gifts"] > MAX_RESET:
            abort(409, description="Слишком много записей для автоматической очистки. Требуется ручная миграция.")
        token = secrets.token_urlsafe(28)
        with db():
            db().execute("INSERT INTO launch_reset_plans VALUES (?,?,?,?)",
                         (token, g.user["id"], info["signature"], int(time.time())))
        info.pop("signature", None)
        return {**info, "token": token, "valid_seconds": TTL}

    @app.post("/api/admin/launch/reset-local")
    @auth(admin=True)
    def launch_reset_local():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or data.get("confirmation") != CONFIRM_TEXT or \
                data.get("first_ack") is not True or \
                data.get("second_ack") is not True or \
                data.get("third_ack") is not True:
            abort(400, description="Нужны все три подтверждения и точная фраза")
        # Deliberate server-side release gate; this is OFF by default on live.
        if os.getenv("CRAFTER_ALLOW_LOCAL_RESET") != "1":
            abort(403, description="Очистка заблокирована сервером. Сначала нужен подтверждённый бэкап и разрешение.")
        token = data.get("token")
        if not isinstance(token, str) or len(token) > 128:
            abort(400)
        with db():
            db().execute("BEGIN IMMEDIATE")
            plan = db().execute("SELECT * FROM launch_reset_plans WHERE token=?",
                                (token,)).fetchone()
            if not plan or plan["actor"] != g.user["id"] or \
                    int(time.time()) - plan["created"] > TTL:
                abort(409, description="План истёк. Подготовьте предварительный просмотр заново.")
            eligible, protected, blocked, signature = classification()
            if blocked or signature != plan["signature"] or len(eligible) > MAX_RESET:
                abort(409, description="Инвентари изменились или есть активные операции. Сброс отменён.")
            batch = secrets.token_hex(16)
            now = int(time.time())
            for uid, gift_id, payload, status in eligible:
                db().execute("INSERT INTO launch_reset_backups VALUES (?,?,?,?,?,?)",
                             (batch, uid, gift_id, payload, status, now))
                removed = db().execute("DELETE FROM inventory WHERE user_id=? AND nft_id=? AND status='unlisted'",
                                       (uid, gift_id))
                if removed.rowcount != 1:
                    abort(409, description="Изменение инвентаря во время очистки")
            # Drop only local simulation locks. Do NOT delete receipts, balance,
            # transaction history, TON withdrawals, real gift deposits or offers.
            db().execute("DELETE FROM local_sold")
            db().execute("DELETE FROM local_purchases")
            db().execute("DELETE FROM launch_reset_plans WHERE token=?", (token,))
            db().execute("INSERT INTO audit(actor,action,created) VALUES (?,?,?)",
                         (g.user["id"], "Local-only reset snapshot " + batch +
                          " removed " + str(len(eligible)) + " synthetic gifts", now))
        return {"ok": True, "removed_local_gifts": len(eligible),
                "protected_real_gifts": len(protected), "backup_batch": batch,
                "external_gifts_moved": False}
