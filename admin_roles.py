"""Verified Telegram administrator grants and per-section server permissions.

The sole configured primary admin manages grants. An existing one-person ADMIN_IDS
configuration safely identifies that person; multi-admin installations must specify
PRIMARY_ADMIN_ID explicitly rather than guessing by display name/username.
"""
import json
import time
from flask import abort, g, request

SECTIONS = (
    "finance", "users", "maintenance", "audit", "nft_withdraw", "ton_withdraw",
    "tonconnect", "relayer", "crafts", "modes", "staking", "arena", "banners",
    "craft_banner", "ice_banner", "events", "portal", "telegram-bot",
    "announcements", "snow",
)

def ensure_admin_tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS admin_role_grants (
      user_id INTEGER PRIMARY KEY, role TEXT NOT NULL,
      permissions TEXT NOT NULL, updated_by INTEGER NOT NULL,
      updated INTEGER NOT NULL
    )""")

def resolve_primary_admin(config):
    static = set(config.get("ADMIN_IDS", ()))
    explicit = config.get("PRIMARY_ADMIN_ID")
    if explicit is not None and str(explicit).strip():
        try:
            candidate = int(explicit)
        except (ValueError, TypeError):
            return None
        return candidate if candidate > 0 and candidate in static else None
    return next(iter(static)) if len(static) == 1 else None

def access_for_id(db, uid, static_ids, owner_id):
    if uid == owner_id and uid in static_ids:
        return {"is_admin": True, "is_primary_admin": True, "permissions": ["*"]}
    row = db.execute("SELECT role,permissions FROM admin_role_grants WHERE user_id=?",
                     (uid,)).fetchone()
    if row:
        if row["role"] == "removed":
            return {"is_admin": False, "is_primary_admin": False, "permissions": []}
        if row["role"] == "full":
            return {"is_admin": True, "is_primary_admin": False, "permissions": ["*"]}
        if row["role"] == "sections":
            try:
                raw = json.loads(row["permissions"])
            except (ValueError, TypeError):
                raw = []
            permitted = [s for s in SECTIONS if isinstance(raw,list) and s in raw]
            return {"is_admin": bool(permitted), "is_primary_admin": False,
                    "permissions": permitted}
    if uid in static_ids:
        return {"is_admin": True, "is_primary_admin": False, "permissions": ["*"]}
    return {"is_admin": False, "is_primary_admin": False, "permissions": []}

def required_section(path):
    """None means a delegated admin cannot use this unclassified admin endpoint."""
    if not path.startswith("/api/admin/"):
        return None
    p = path[len("/api/admin/"):]
    if p == "admins" or p.startswith("admins/"):
        return "admins"
    if p == "finance":
        return "finance"
    if p.startswith("users/") or p == "users" or p.startswith("user/"):
        # Per-user financial reports are sensitive both to finance and users.
        return "users"
    if p.startswith("maintenance"):
        return "maintenance"
    if p.startswith("logs") or p == "status":
        return "audit"
    if p.startswith("withdrawals/gift/"):
        return "nft_withdraw"
    if p.startswith("withdrawals"):
        return "nft_withdraw|ton_withdraw"
    if p.startswith("tonconnect/auto"):
        return "tonconnect"
    if p.startswith("tonconnect"):
        return "ton_withdraw"
    if p.startswith("telegram-deposits"):
        return "relayer"
    if p.startswith("selection") or p.startswith("crafts"):
        return "crafts"
    if p.startswith("modes"):
        return "modes"
    if p.startswith("staking"):
        return "staking"
    if p.startswith("arena"):
        return "arena"
    if p.startswith("portal"):
        return "portal"
    if p.startswith("site/snow"):
        return "snow"
    if p.startswith("database"):
        return "database"
    if p.startswith("banner"):
        return "banners"
    if p.startswith("events"):
        return "events"
    if p.startswith("announcement"):
        return "announcements"
    return None

def can_access_admin_path(access, path):
    if not access["is_admin"]:
        return False
    required = required_section(path)
    if required == "admins":
        return access["is_primary_admin"]
    if access["is_primary_admin"] or "*" in access["permissions"]:
        return True
    if required is None or required == "database":
        return False
    if required == "nft_withdraw|ton_withdraw":
        return any(p in access["permissions"] for p in ("nft_withdraw", "ton_withdraw"))
    return required in access["permissions"]

def install_admin_management(app, db, auth, audit, access):
    def must_be_primary():
        if not g.is_primary_admin:
            abort(403, description="Управление администраторами доступно только главному админу")

    def entries():
        rows = db().execute(
            """SELECT r.user_id,r.role,r.permissions,r.updated_by,r.updated,
                      u.name,u.username
               FROM admin_role_grants r LEFT JOIN users u ON u.id=r.user_id
               ORDER BY r.updated DESC"""
        ).fetchall()
        records = []
        covered = set()
        for row in rows:
            uid = row["user_id"]
            covered.add(uid)
            record = access(uid)
            records.append({
                "user_id": uid, "name": row["name"] or "", "username": row["username"] or "",
                "role": row["role"], "permissions": record["permissions"],
                "is_admin": record["is_admin"], "is_primary_admin": record["is_primary_admin"],
                "updated_by": row["updated_by"], "updated": row["updated"],
                "from_config": uid in app.config["ADMIN_IDS"],
            })
        for uid in sorted(app.config["ADMIN_IDS"]):
            if uid in covered: continue
            person = db().execute("SELECT name,username FROM users WHERE id=?", (uid,)).fetchone()
            record = access(uid)
            records.append({
                "user_id": uid, "name": person["name"] if person else "",
                "username": person["username"] if person else "",
                "role": "primary" if record["is_primary_admin"] else "full",
                "permissions": record["permissions"], "is_admin": record["is_admin"],
                "is_primary_admin": record["is_primary_admin"], "from_config": True,
            })
        return records

    @app.get("/api/admin/admins")
    @auth(admin=True)
    def list_admin_roles():
        must_be_primary()
        return {"admins": entries(), "sections": list(SECTIONS),
                "primary_admin_id": g.user["id"]}

    @app.post("/api/admin/admins")
    @auth(admin=True)
    def grant_admin_role():
        must_be_primary()
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, description="Укажите пользователя и права")
        try:
            uid = int(body.get("user_id"))
        except (ValueError, TypeError):
            abort(400, description="Telegram ID должен быть числом")
        if uid <= 0 or uid > 2**63 - 1:
            abort(400, description="Недопустимый Telegram ID")
        if uid == g.user["id"]:
            abort(403, description="Нельзя изменить права главного администратора")
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            abort(404, description="Сначала пользователь должен войти в Crafter")
        role = body.get("role")
        if role not in ("full", "sections"):
            abort(400, description="Выберите все права или отдельные разделы")
        raw = body.get("permissions", [])
        if role == "sections":
            if not isinstance(raw,list) or not raw or len(raw) != len(set(map(str,raw))) or any(
                    not isinstance(s,str) or s not in SECTIONS for s in raw):
                abort(400, description="Выберите допустимые разделы")
            permissions = [s for s in SECTIONS if s in raw]
        else:
            permissions = ["*"]
        with db():
            db().execute("BEGIN IMMEDIATE")
            db().execute(
                "INSERT INTO admin_role_grants VALUES(?,?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,"
                "permissions=excluded.permissions,updated_by=excluded.updated_by,"
                "updated=excluded.updated",
                (uid, role, json.dumps(permissions), g.user["id"], int(time.time()))
            )
        audit("Admin rights granted to " + str(uid) + " role=" + role +
              " sections=" + ",".join(permissions))
        return {"ok": True, "admin": {"user_id": uid, "role": role,
                                     "permissions": permissions}}

    @app.delete("/api/admin/admins/<int:uid>")
    @app.post("/api/admin/admins/<int:uid>/revoke")
    @auth(admin=True)
    def revoke_admin_role(uid):
        must_be_primary()
        if uid == g.user["id"]:
            abort(403, description="Главного администратора нельзя удалить")
        if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            abort(404, description="Пользователь не найден")
        with db():
            db().execute("BEGIN IMMEDIATE")
            db().execute(
                "INSERT INTO admin_role_grants VALUES(?,?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,"
                "permissions=excluded.permissions,updated_by=excluded.updated_by,"
                "updated=excluded.updated",
                (uid, "removed", "[]", g.user["id"], int(time.time()))
            )
        audit("Admin rights revoked for " + str(uid))
        return {"ok": True, "user_id": uid, "revoked": True}
