"""Isolated, opt-in TON hot-wallet payouts.

The user's TON Connect wallet is NEVER used for unattended signing. Only a
dedicated V4R2 hot wallet, whose seed exists in a separate Render cron service,
can authorize automatic transfers. An unknown broadcast is NEVER automatically
resent or refunded. Existing manual withdrawals remain manual.
"""
import base64
import json
import os
import time
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import abort, request

POLICY_KEY = "crafter_auto_payout_policy"
POLICY = {
    "enabled": False,
    "max_ton": "0.25",
    "daily_ton": "1",
    "reserve_ton": "0.50",
}
ATTEMPT_ACTIVE = ("prepared", "broadcast", "review")
ATTEMPT_FINAL = ("confirmed",)


def _ton(value):
    try:
        n = Decimal(str(value))
    except (ValueError, TypeError, InvalidOperation):
        abort(400, description="Введите корректный лимит TON")
    if not n.is_finite() or n <= 0 or n > 1000 or n.as_tuple().exponent < -9:
        abort(400, description="Лимит TON должен быть положительным")
    return n


def install_auto_payout(app, db, auth, audit, wallet_config, storage, rpc, verified_transfer):
    with app.app_context():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS ton_auto_payouts (
            withdrawal_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            signed_boc TEXT NOT NULL,
            seqno INTEGER NOT NULL,
            sender TEXT NOT NULL,
            created INTEGER NOT NULL,
            updated INTEGER NOT NULL,
            confirmed_tx TEXT
        );
        CREATE INDEX IF NOT EXISTS ton_auto_payout_status
        ON ton_auto_payouts(status,created);
        """)

    def policy():
        row = db().execute("SELECT payload FROM settings WHERE key=?", (POLICY_KEY,)).fetchone()
        if not row:
            return dict(POLICY)
        try:
            p = json.loads(row["payload"])
            return {**POLICY, **(p if isinstance(p, dict) else {})}
        except (ValueError, TypeError):
            return dict(POLICY)

    def public_state():
        p = policy()
        cfg = wallet_config()
        attempts = db().execute("""SELECT withdrawal_id,status,seqno,created,updated,confirmed_tx
            FROM ton_auto_payouts ORDER BY created DESC LIMIT 20""").fetchall()
        return {
            "policy": p,
            "network": cfg["network"],
            "durable_db": bool(app.config["DATABASE_URL"]),
            "operator_address": os.environ.get("CRAFTER_PAYOUT_ADDRESS", ""),
            "payouts": [dict(row) for row in attempts],
            "worker_configured_on_web": False,
            "instructions": "Настройте ключи только в отдельном Render Cron Job.",
        }

    @app.get("/api/admin/tonconnect/auto")
    @auth(admin=True)
    def payout_settings():
        return public_state()

    @app.post("/api/admin/tonconnect/auto")
    @auth(admin=True)
    def save_payout_settings():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400, description="Некорректные настройки")
        enabled = data.get("enabled")
        if type(enabled) is not bool:
            abort(400, description="Укажите состояние автовыплат")
        per = _ton(data.get("max_ton"))
        daily = _ton(data.get("daily_ton"))
        reserve = _ton(data.get("reserve_ton"))
        if per > daily:
            abort(400, description="Лимит операции превышает суточный лимит")
        if enabled and not app.config["DATABASE_URL"]:
            abort(409, description="Для автовыплат нужен общий постоянный PostgreSQL")
        p = {"enabled": enabled, "max_ton": str(per),
             "daily_ton": str(daily), "reserve_ton": str(reserve)}
        with db():
            db().execute("""INSERT INTO settings(key,payload) VALUES(?,?)
                ON CONFLICT(key) DO UPDATE SET payload=excluded.payload""",
                (POLICY_KEY, json.dumps(p)))
        audit("Auto-payout policy updated (no transfer): " + ("enabled" if enabled else "disabled"))
        return {"ok": True, "policy": p}

    def signer(config):
        # No mnemonic is stored in the Crafter database, passed to users, or
        # accepted via HTTP. The cron worker alone receives the secret.
        if os.getenv("CRAFTER_PAYOUT_EXECUTE") != "1":
            raise RuntimeError("Payout worker is not armed")
        network = os.getenv("CRAFTER_PAYOUT_NETWORK")
        if network not in ("mainnet", "testnet") or network != config["network"]:
            raise RuntimeError("Payout wallet network differs from Crafter")
        if network == "mainnet" and os.getenv("CRAFTER_PAYOUT_MAINNET_UNLOCK") != "YES_I_ACCEPT_REAL_PAYOUTS":
            raise RuntimeError("Mainnet automatic signing is locked")
        seed = os.getenv("CRAFTER_PAYOUT_MNEMONIC", "").split()
        if len(seed) != 24:
            raise RuntimeError("Dedicated payout wallet seed is not configured")
        from tonsdk.contract.wallet import Wallets, WalletVersionEnum
        _, _, _, wallet = Wallets.from_mnemonics(seed, WalletVersionEnum.v4r2)
        addr = wallet.address.to_string(False)
        configured = os.getenv("CRAFTER_PAYOUT_ADDRESS", "")
        if not configured or addr != configured:
            raise RuntimeError("Derived payout address differs from the approved address")
        return wallet, addr

    def send_boc(config, signed_boc):
        host = ("https://toncenter.com/api/v2/sendBoc"
                if config["network"] == "mainnet" else
                "https://testnet.toncenter.com/api/v2/sendBoc")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if config.get("rpc_key"):
            headers["X-API-Key"] = config["rpc_key"]
        req = Request(host, data=json.dumps({"boc": signed_boc}).encode(),
                      headers=headers, method="POST")
        # Even an HTTP timeout is ambiguous: the network may have accepted
        # the message. Never sign/broadcast another transfer automatically.
        try:
            with urlopen(req, timeout=12) as response:
                body = json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            raise RuntimeError("Payout broadcast outcome unknown") from exc
        if body.get("ok") is not True:
            raise RuntimeError("Payout broadcast not confirmed by RPC")
        return True

    def confirmed(transfer, sender, withdrawal):
        payload = json.loads(withdrawal["payload"])
        transactions = rpc(payload["network"], "getTransactions",
                           {"address": payload["receiver"], "limit": 100, "archival": "true"},
                           wallet_config()["rpc_key"])
        return verified_transfer(transactions, payload["receiver"], sender,
                                 payload["nano"], payload["memo"], withdrawal["created"])

    def reconcile_one():
        pending = db().execute("""SELECT a.*,w.payload,w.status AS withdraw_status,
                   w.created AS withdrawal_created
            FROM ton_auto_payouts a JOIN ton_withdrawals w
            ON w.id=a.withdrawal_id
            WHERE a.status IN ('prepared','broadcast','review')
            ORDER BY a.created LIMIT 1""").fetchone()
        if not pending:
            return None
        wid = pending["withdrawal_id"]
        withdrawal = {"payload": pending["payload"], "created": pending["withdrawal_created"]}
        # If a manual verification already confirmed this payout, close outbox.
        if pending["withdraw_status"] == "confirmed":
            with db():
                db().execute("""UPDATE ton_auto_payouts SET status='confirmed',updated=?
                    WHERE withdrawal_id=?""", (int(time.time()), wid))
            return {"status": "confirmed", "id": wid}
        tx = confirmed(None, pending["sender"], withdrawal)
        if tx:
            with db():
                db().execute("BEGIN IMMEDIATE")
                db().execute("""INSERT INTO ton_transactions(network,hash)
                    VALUES(?,?) ON CONFLICT DO NOTHING""",
                    (wallet_config()["network"], tx))
                db().execute("""UPDATE ton_withdrawals SET status='confirmed',tx=?
                    WHERE id=? AND status='processing'""", (tx, wid))
                db().execute("""UPDATE ton_auto_payouts SET status='confirmed',
                    confirmed_tx=?,updated=? WHERE withdrawal_id=?""",
                    (tx, int(time.time()), wid))
            audit("Automatic TON payout confirmed: " + wid)
            return {"status": "confirmed", "id": wid}
        # Leave every uncertain payment in manual review forever, unless
        # an actual chain receipt is found. Never re-credit/refund automatically.
        if int(time.time()) - int(pending["created"]) > 900:
            with db():
                db().execute("""UPDATE ton_auto_payouts SET status='review',updated=?
                    WHERE withdrawal_id=?""", (int(time.time()), wid))
            return {"status": "needs_review", "id": wid}
        return {"status": "awaiting_chain", "id": wid}

    def run_once():
        if not app.config["DATABASE_URL"]:
            return {"status": "blocked", "reason": "PostgreSQL is required"}
        config = wallet_config()
        # Reconcile an already sent payout even after emergency pause.
        pending = reconcile_one()
        if pending is not None:
            return pending
        p = policy()
        if not p["enabled"] or not config["enabled"] or not config["withdraw_enabled"]:
            return {"status": "disabled"}
        wallet, sender = signer(config)
        row = db().execute("""SELECT * FROM ton_withdrawals
            WHERE status='queued' ORDER BY created ASC LIMIT 50""").fetchall()
        ready = []
        for candidate in row:
            info = json.loads(candidate["payload"])
            if info.get("auto_eligible") is True and info["network"] == config["network"]:
                ready.append((candidate, info))
        if not ready:
            return {"status": "idle"}
        withdrawal, info = ready[0]
        wid = withdrawal["id"]
        payout_ton = Decimal(info["nano"]) / Decimal(10**9)
        if payout_ton > Decimal(p["max_ton"]):
            return {"status": "review_limit", "id": wid}
        since = int(time.time()) - 86400
        recent = db().execute("""SELECT w.payload FROM ton_auto_payouts a
            JOIN ton_withdrawals w ON w.id=a.withdrawal_id
            WHERE a.created>? AND a.status IN ('prepared','broadcast','review','confirmed')""",
            (since,)).fetchall()
        spent = sum((Decimal(json.loads(item["payload"])["nano"]) for item in recent), Decimal(0))
        if spent + Decimal(info["nano"]) > Decimal(p["daily_ton"]) * 10**9:
            return {"status": "daily_limit", "id": wid}
        remote = rpc(config["network"], "getWalletInformation",
                     {"address": sender}, config["rpc_key"])
        wallet_type = str(remote.get("wallet_type", "")).lower().replace(" ", "")
        if remote.get("wallet") is not True or "v4r2" not in wallet_type:
            return {"status": "invalid_hot_wallet"}
        seqno = int(remote["seqno"])
        balance = Decimal(str(remote["balance"]))
        if balance < Decimal(info["nano"]) + Decimal(p["reserve_ton"]) * 10**9:
            return {"status": "insufficient_ton", "id": wid}
        # Build a transfer with the UNIQUE memo already assigned to this
        # request. Sign exactly one BOC and persist it before broadcasting.
        transfer = wallet.create_transfer_message(
            to_addr=info["receiver"], amount=int(info["nano"]),
            seqno=seqno, payload=info["memo"], send_mode=3)
        boc = base64.b64encode(transfer["message"].to_boc(False)).decode()
        now = int(time.time())
        with db():
            db().execute("BEGIN IMMEDIATE")
            active = db().execute("""SELECT 1 FROM ton_auto_payouts
                WHERE status IN ('prepared','broadcast','review') LIMIT 1""").fetchone()
            current = db().execute("SELECT status FROM ton_withdrawals WHERE id=?", (wid,)).fetchone()
            if active or not current or current["status"] != "queued":
                return {"status": "busy"}
            info["sender"] = sender
            db().execute("""UPDATE ton_withdrawals SET status='processing',payload=?
                WHERE id=? AND status='queued'""", (json.dumps(info), wid))
            db().execute("""INSERT INTO ton_auto_payouts
                (withdrawal_id,status,signed_boc,seqno,sender,created,updated,confirmed_tx)
                VALUES (?,'prepared',?,?,?,?,?,NULL)""",
                (wid, boc, seqno, sender, now, now))
        try:
            send_boc(config, boc)
            label = "broadcast"
        except Exception:
            label = "review"
            app.logger.exception("Autopayout may have been broadcast: manual review required")
        with db():
            db().execute("""UPDATE ton_auto_payouts SET status=?,updated=?
                WHERE withdrawal_id=? AND status='prepared'""",
                (label, int(time.time()), wid))
        audit("Automatic payout submitted for chain confirmation: " + wid)
        return {"status": label, "id": wid}

    app.extensions["crafter_auto_payout"] = run_once
    app.extensions["crafter_auto_policy"] = policy
