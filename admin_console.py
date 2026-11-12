"""Crafter administration: maintenance, finance and individual user profiles.

Existing custody, payout and moderation endpoints remain authoritative. Money
flow is not labelled accounting profit. All mutating operations are admin-only.
"""
import json
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from flask import abort, g, jsonify, request

MAINTENANCE_KEY = "site_maintenance_v2"
LAUNCH_KEY = "site_launch_v1"
BERLIN = ZoneInfo("Europe/Berlin")


def install_admin_console(app, db, auth, audit, verify_telegram, bot_settings, admin_access):
    def maintenance():
        row = db().execute(
            "SELECT payload FROM settings WHERE key=?", (MAINTENANCE_KEY,)
        ).fetchone()
        if not row:
            return {"enabled": False, "message": "", "changed_at": None}
        try:
            value = json.loads(row["payload"])
        except (ValueError, TypeError):
            value = {}
        return {
            "enabled": bool(value.get("enabled")),
            "message": str(value.get("message") or "")[:180],
            "changed_at": value.get("changed_at"),
        }

    def launch():
        """The planned opening of the site. While it lies in the future the site is closed for everyone but administrators."""
        row = db().execute("SELECT payload FROM settings WHERE key=?", (LAUNCH_KEY,)).fetchone()
        try:
            value = json.loads(row["payload"]) if row else {}
        except (ValueError, TypeError):
            value = {}
        now = int(time.time())
        opens_at = value.get("opens_at") if isinstance(value.get("opens_at"), int) else None
        active = bool(opens_at and now < opens_at)
        return {"active": active, "opens_at": opens_at if active else None, "now": now}

    def valid_admin_request():
        raw = request.headers.get("X-Telegram-Init-Data", "")
        if not raw:
            web = request.headers.get("X-Crafter-Web-Session", "")
            if web:                                   # a signed-in website session of an administrator passes too
                finder = app.extensions.get("crafter_web_session_user")
                site_user = finder(web) if finder else None
                return bool(site_user and admin_access(site_user["id"])["is_admin"])
            return bool(app.config["DEMO_MODE"] and admin_access(1)["is_admin"])
        token = app.config["BOT_TOKEN"]
        user = None
        if token:
            try:
                user = verify_telegram(raw, token)
            except (ValueError, KeyError, TypeError):
                pass
        if user is None:
            try:
                alternative = bot_settings().get("token")
                if alternative and alternative != token:
                    user = verify_telegram(raw, alternative)
            except (ValueError, KeyError, TypeError):
                pass
        return bool(user and admin_access(user.get("id"))["is_admin"])

    MODE_DEFAULTS = {'craft': True, 'arena': True, 'staking': True, 'upgrade': True}

    def site_modes():
        row = db().execute("SELECT payload FROM settings WHERE key='site_modes_v1'").fetchone()
        if not row:
            return dict(MODE_DEFAULTS)
        try:
            values = json.loads(row['payload'])
        except (ValueError, TypeError):
            values = {}
        if not isinstance(values, dict):
            values = {}
        return {key: bool(values.get(key, value)) for key, value in MODE_DEFAULTS.items()}

    @app.get('/api/site/modes')
    def public_site_modes():
        response = jsonify(modes=site_modes())
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/admin/modes')
    @auth(admin=True)
    def admin_modes():
        return {'modes': site_modes()}

    @app.post('/api/admin/modes')
    @auth(admin=True)
    def admin_update_modes():
        value = request.get_json(silent=True)
        if (not isinstance(value, dict) or value.get('mode') not in MODE_DEFAULTS
                or type(value.get('enabled')) is not bool
                or value.get('confirm') != 'SET_MODE'):
            abort(400, description='Выберите режим и подтвердите изменение')
        modes = site_modes()
        modes[value['mode']] = value['enabled']
        with db():
            db().execute('BEGIN IMMEDIATE')
            db().execute('INSERT INTO settings(key,payload) VALUES(?,?) '
                         'ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
                         ('site_modes_v1', json.dumps(modes)))
        audit('Mode ' + value['mode'] + (' enabled' if value['enabled'] else ' disabled'))
        return {'ok': True, 'modes': site_modes()}
    @app.before_request
    def enforce_site_maintenance():
        path = request.path
        if not path.startswith("/api/"):
            return None
        # Status and authenticated admin check are always available for retry.
        if path in ("/api/site/maintenance", "/api/site/maintenance/access", "/api/site/modes", "/api/site/snow", "/api/site/launch"):
            return None
        # The Telegram bot webhook must keep answering during maintenance, otherwise Telegram queues /start updates (503).
        if path.startswith("/api/telegram/webhook/"):
            return None
        # Signing in must work during maintenance: an administrator logs in first and is then let through.
        if path.startswith("/api/web-login/"):
            return None
        # The countdown screen comes first: it can run together with maintenance and has priority over it.
        countdown = launch()
        if countdown["active"] and not valid_admin_request():
            response = jsonify({"error": "До запуска осталось совсем немного", "launch": True,
                                "opens_at": countdown["opens_at"], "now": countdown["now"]})
            response.status_code = 503
            response.headers["Cache-Control"] = "no-store"
            return response
        state = maintenance()
        if state["enabled"] and not valid_admin_request():
            response = jsonify({
                "error": "Сервис находится на технических работах",
                "maintenance": True,
                "message": state["message"],
            })
            response.status_code = 503
            response.headers["Cache-Control"] = "no-store"
            response.headers["Retry-After"] = "60"
            return response
        # Enforce disabled game modes on the server, not merely by hiding buttons.
        mode = ('craft' if path == '/api/craft' or path.startswith('/api/craft/')
                else 'arena' if path == '/api/arena' or path.startswith('/api/arena/')
                else 'staking' if path == '/api/staking' or path.startswith('/api/staking/')
                else 'upgrade' if path == '/api/upgrade' or path.startswith('/api/upgrade/')
                else None)
        if mode and not site_modes()[mode] and not valid_admin_request():
            return jsonify(error='Режим временно отключён администратором',
                           mode_disabled=mode), 503
        return None

    @app.get("/api/site/maintenance")
    def public_maintenance():
        state = maintenance()
        response = jsonify(state)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/site/launch")
    def public_launch():
        response = jsonify(launch())
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/admin/maintenance/launch")
    @auth(admin=True)
    def admin_launch():
        return launch()

    @app.post("/api/admin/maintenance/launch")
    @auth(admin=True)
    def admin_set_launch():
        raw = (request.get_json(silent=True) or {}).get("opens_at")
        opens_at = None
        if raw not in (None, "", 0):
            try:
                opens_at = int(raw)
            except (TypeError, ValueError):
                abort(400, description="Неверная дата запуска")
            now = int(time.time())
            if not now < opens_at <= now + 366 * 86400:
                abort(400, description="Дата запуска должна быть в будущем, но не дальше года")
        with db():
            db().execute("INSERT INTO settings(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                         (LAUNCH_KEY, json.dumps({"opens_at": opens_at, "changed_by": g.user["id"]})))
        audit("Launch countdown " + ("set" if opens_at else "cleared"))
        return {"ok": True, **launch()}

    @app.get("/api/site/maintenance/access")
    @auth()
    def maintenance_access():
        return {"is_admin": bool(g.is_admin), "maintenance": maintenance()}

    @app.get("/api/admin/maintenance")
    @auth(admin=True)
    def admin_maintenance():
        return maintenance()

    @app.post("/api/admin/maintenance")
    @auth(admin=True)
    def admin_set_maintenance():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or type(data.get("enabled")) is not bool:
            abort(400, description="Укажите состояние технических работ")
        enabled = data["enabled"]
        confirmation = "ENABLE_MAINTENANCE" if enabled else "DISABLE_MAINTENANCE"
        if data.get("confirm") != confirmation:
            abort(400, description="Подтвердите изменение режима")
        reason = str(data.get("message") or "").strip()
        if len(reason) > 180:
            abort(400, description="Сообщение слишком длинное")
        value = {"enabled": enabled, "message": reason,
                 "changed_at": int(time.time()), "actor": g.user["id"]}
        with db():
            db().execute("BEGIN IMMEDIATE")
            db().execute(
                "INSERT INTO settings(key,payload) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                (MAINTENANCE_KEY, json.dumps(value, ensure_ascii=False)),
            )
        audit(("Maintenance enabled" if enabled else "Maintenance disabled") +
              (" by admin " + str(g.user["id"])))
        return {"ok": True, **maintenance()}

    def window_range():
        period = request.args.get("period", "week").lower()
        now = datetime.now(BERLIN)
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == "day":
            start, end = start_today, now
        elif period == "week":
            start, end = start_today - timedelta(days=6), now
        elif period == "month":
            start, end = start_today - timedelta(days=29), now
        elif period == "all":
            start, end = datetime(2020, 1, 1, tzinfo=BERLIN), now
        elif period == "custom":
            try:
                start_date = date.fromisoformat(request.args.get("from", ""))
                end_date = date.fromisoformat(request.args.get("to", ""))
            except ValueError:
                abort(400, description="Укажите даты в формате ГГГГ-ММ-ДД")
            if end_date < start_date or (end_date - start_date).days > 1095:
                abort(400, description="Выберите период до трёх лет")
            if start_date > now.date():
                abort(400, description="Начало периода ещё не наступило")
            start = datetime.combine(start_date, datetime.min.time(), tzinfo=BERLIN)
            end = min(now, datetime.combine(end_date + timedelta(days=1),
                                             datetime.min.time(), tzinfo=BERLIN))
        else:
            abort(400, description="Период: day, week, month, all, custom")
        return period, start, end

    def nonnegative(value):
        try:
            number = Decimal(str(value if value is not None else "0"))
        except (ValueError, InvalidOperation, TypeError):
            return Decimal("0")
        return number if number.is_finite() and number >= 0 else Decimal("0")

    def financial_report(user_id=None):
        period, start, end = window_range()
        # Include transactions completed during the current second.
        start_ts, end_ts = int(start.timestamp()), int(end.timestamp()) + 1
        totals = {
            "deposit_gram": Decimal("0"),
            "deposit_ton": Decimal("0"),
            "withdraw_gram": Decimal("0"),
            "withdraw_ton": Decimal("0"),
        }
        counts = defaultdict(int)
        buckets = defaultdict(lambda: {
            "deposit_gram": Decimal("0"), "deposit_ton": Decimal("0"),
            "withdraw_gram": Decimal("0"), "withdraw_ton": Decimal("0"),
        })
        def add_rows(table, kind, good_status):
            query = (
                f"SELECT payload,status,created FROM {table} "
                "WHERE created>=? AND created<?"
            )
            params = [start_ts, end_ts]
            if user_id is not None:
                query += " AND user_id=?"
                params.append(user_id)
            query += " ORDER BY created DESC LIMIT 25000"
            rows = db().execute(query, tuple(params)).fetchall()
            for row in rows:
                status = str(row["status"] or "")
                counts[kind + "_" + status] += 1
                if status not in good_status:
                    continue
                try:
                    payload = json.loads(row["payload"])
                except (TypeError, ValueError):
                    continue
                if not isinstance(payload, dict):
                    continue
                # Existing wallet payload stores both GRAM credited/reserved
                # and TON chain value. Keep units separate; never add them.
                gram = nonnegative(payload.get("gram"))
                ton = nonnegative(payload.get("ton"))
                timestamp = datetime.fromtimestamp(int(row["created"]), BERLIN)
                days = (end - start).days
                if days > 120:
                    label = timestamp.strftime("%Y-%m")
                elif days > 45:
                    label = (timestamp.date() -
                             timedelta(days=timestamp.weekday())).isoformat()
                else:
                    label = timestamp.strftime("%Y-%m-%d")
                for unit, amount in (("gram", gram), ("ton", ton)):
                    key = kind + "_" + unit
                    totals[key] += amount
                    buckets[label][key] += amount
        add_rows("ton_deposits", "deposit", {"confirmed"})
        add_rows("ton_withdrawals", "withdraw", {"confirmed"})
        deposited = totals["deposit_gram"]
        withdrawn = totals["withdraw_gram"]
        values = {key: str(value.quantize(Decimal(".01")))
                  for key, value in totals.items()}
        series = [{"date": day, **{k: str(v.quantize(Decimal(".01")))
                                   for k, v in vals.items()}}
                  for day, vals in sorted(buckets.items())]
        # The difference is NET CASH FLOW, not business profit; expenses and
        # fees may not have reconciled records.
        return {
            "period": period, "start": start.date().isoformat(),
            "end": end.date().isoformat(), "totals": values,
            "net_gram": str((deposited - withdrawn).quantize(Decimal(".01"))),
            "counts": dict(counts), "series": series,
            "finance_note": "Разница депозитов и выводов — денежный поток, не чистая прибыль. "
                            "Прибыль требует учёта комиссий, расходов и себестоимости.",
            "authoritative_profit": None,
        }

    @app.get("/api/admin/finance")
    @auth(admin=True)
    def admin_finance():
        return financial_report()

    @app.get("/api/admin/users/<int:uid>/finance")
    @auth(admin=True)
    def admin_user_finance(uid):
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            abort(404, description="Пользователь не найден")
        return financial_report(user_id=uid)

    @app.get("/api/admin/user/<int:uid>")
    @auth(admin=True)
    def admin_user_profile(uid):
        user = db().execute(
            "SELECT u.id,u.name,u.username,u.referrer,u.created,"
            "COALESCE(d.balance,'0') balance,"
            "(SELECT count(*) FROM inventory i WHERE i.user_id=u.id) gifts,"
            "EXISTS(SELECT 1 FROM user_bans b WHERE b.user_id=u.id) banned,"
            "(SELECT a.photo_url FROM user_avatars a WHERE a.user_id=u.id) photo_url "
            "FROM users u LEFT JOIN demo_accounts d ON d.user_id=u.id "
            "WHERE u.id=?", (uid,),
        ).fetchone()
        if not user:
            abort(404, description="Пользователь не найден")
        deposits = db().execute(
            "SELECT id,status,created,payload FROM ton_deposits "
            "WHERE user_id=? ORDER BY created DESC LIMIT 30", (uid,)
        ).fetchall()
        withdrawals = db().execute(
            "SELECT id,status,created,payload FROM ton_withdrawals "
            "WHERE user_id=? ORDER BY created DESC LIMIT 30", (uid,)
        ).fetchall()
        gift_withdrawals = db().execute(
            "SELECT id,status,created FROM gift_withdrawals "
            "WHERE user_id=? ORDER BY created DESC LIMIT 30", (uid,)
        ).fetchall()
        latest = db().execute(
            "SELECT id,kind,created FROM history WHERE user_id=? "
            "ORDER BY created DESC LIMIT 40", (uid,)
        ).fetchall()
        def sanitized(rows):
            result = []
            for item in rows:
                try:
                    payload = json.loads(item["payload"])
                except (TypeError, ValueError):
                    payload = {}
                result.append({
                    "id": item["id"], "status": item["status"],
                    "created": item["created"],
                    "gram": str(nonnegative(payload.get("gram"))),
                    "ton": str(nonnegative(payload.get("ton"))),
                    "network": str(payload.get("network") or "")[:20],
                })
            return result
        return {
            "user": dict(user),
            "deposits": sanitized(deposits),
            "withdrawals": sanitized(withdrawals),
            "gift_withdrawals": [dict(row) for row in gift_withdrawals],
            "recent": [dict(row) for row in latest],
        }

    @app.get("/api/admin/crafts/report")
    @auth(admin=True)
    def admin_craft_report():
        recent = db().execute(
            "SELECT user_id,kind,created FROM history "
            "WHERE kind IN ('craft','arena_result','gift_granted') "
            "ORDER BY created DESC LIMIT 100"
        ).fetchall()
        counts = defaultdict(int)
        for row in recent:
            counts[row["kind"]] += 1
        return {"recent": [dict(r) for r in recent],
                "recent_counts": dict(counts),
                "note": "Подсчитаны последние 100 операций; это не полная финансовая статистика."}
