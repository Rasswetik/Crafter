"""Общее ядро: SQLite-база и логика проверки. Им пользуются и бот, и мини-приложение."""
import base64
import io
import json
import os
import sqlite3
import threading
import time

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH") or os.path.join(HERE, "app.db")
OCR_LOCK = threading.Lock()

COUNTRIES = [
    ("ru", "Россия", "🇷🇺", "ru"), ("ua", "Украина", "🇺🇦", "uk"), ("by", "Беларусь", "🇧🇾", "ru"),
    ("kz", "Казахстан", "🇰🇿", "ru"), ("uz", "Узбекистан", "🇺🇿", "ru"), ("ge", "Грузия", "🇬🇪", "en"),
    ("am", "Армения", "🇦🇲", "ru"), ("az", "Азербайджан", "🇦🇿", "ru"), ("us", "США", "🇺🇸", "en"),
    ("gb", "Великобритания", "🇬🇧", "en"), ("de", "Германия", "🇩🇪", "de"), ("tr", "Турция", "🇹🇷", "tr"),
    ("pl", "Польша", "🇵🇱", "pl"),
]
LANG_OF = {c[0]: c[3] for c in COUNTRIES}


class CheckError(Exception):
    pass


# ---------------- база ----------------
def conn():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, country TEXT DEFAULT 'ru', created REAL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS checks(
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, created REAL NOT NULL,
            source TEXT, store TEXT, app_name TEXT, app_url TEXT, text TEXT, review_date TEXT, rating INTEGER,
            verdict TEXT NOT NULL, score REAL, review_url TEXT, checked INTEGER, matched_author TEXT,
            country TEXT, details TEXT, thumb TEXT)""")
        c.execute("CREATE INDEX IF NOT EXISTS ix_checks_user ON checks(user_id, verdict, created DESC)")


def upsert_user(uid, first_name=None, username=None):
    with conn() as c:
        c.execute("INSERT OR IGNORE INTO users(id,first_name,username,country,created) VALUES(?,?,?,?,?)",
                  (uid, first_name, username, "ru", time.time()))
        if first_name or username:
            c.execute("UPDATE users SET first_name=COALESCE(?,first_name), username=COALESCE(?,username) WHERE id=?",
                      (first_name, username, uid))


def get_country(uid):
    with conn() as c:
        r = c.execute("SELECT country FROM users WHERE id=?", (uid,)).fetchone()
    return r["country"] if r and r["country"] else "ru"


def set_country(uid, country):
    if country not in LANG_OF:
        raise CheckError("Неизвестная страна")
    upsert_user(uid)
    with conn() as c:
        c.execute("UPDATE users SET country=? WHERE id=?", (country, uid))


def row_to_dict(r):
    d = dict(r)
    d["details"] = json.loads(d["details"]) if d.get("details") else []
    d["found"] = d["verdict"] != "not_found"
    return d


def list_checks(uid, found=None, q=None, limit=200, offset=0):
    sql, args = "SELECT * FROM checks WHERE user_id=?", [uid]
    if found is True:
        sql += " AND verdict!='not_found'"
    elif found is False:
        sql += " AND verdict='not_found'"
    if q:
        sql += " AND (LOWER(app_name) LIKE ? OR LOWER(text) LIKE ?)"
        args += [f"%{q.lower()}%"] * 2
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [limit, offset]
    with conn() as c:
        return [row_to_dict(r) for r in c.execute(sql, args).fetchall()]


def count_checks(uid, found):
    with conn() as c:
        r = c.execute("SELECT COUNT(*) n FROM checks WHERE user_id=? AND verdict" + ("!=" if found else "=") + "'not_found'",
                      (uid,)).fetchone()
    return r["n"]


def stats(uid):
    f, n = count_checks(uid, True), count_checks(uid, False)
    return {"found": f, "not_found": n, "total": f + n}


def get_check(uid, cid):
    with conn() as c:
        r = c.execute("SELECT * FROM checks WHERE id=? AND user_id=?", (cid, uid)).fetchone()
    return row_to_dict(r) if r else None


def delete_check(uid, cid):
    with conn() as c:
        c.execute("DELETE FROM checks WHERE id=? AND user_id=?", (cid, uid))


def clear_checks(uid, found=None):
    sql, args = "DELETE FROM checks WHERE user_id=?", [uid]
    if found is True:
        sql += " AND verdict!='not_found'"
    elif found is False:
        sql += " AND verdict='not_found'"
    with conn() as c:
        c.execute(sql, args)


# ---------------- распознавание и проверка ----------------
def make_thumb(data, size=150):
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        im.thumbnail((size, size * 2))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=60)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def scan_image(data):
    """Скриншот -> {store, app_name, review_text, date, rating, thumb}. Бесплатно, локально (EasyOCR)."""
    import ocr
    with OCR_LOCK:
        d = ocr.scan(data)
    d.pop("lines", None)
    d["thumb"] = make_thumb(data)
    return d


def _slim(r):
    m = r.get("match") or {}
    return {"store": r["store"], "status": r.get("status"), "score": r.get("score", 0), "checked": r.get("checked", 0),
            "app": r.get("app"), "review_url": r.get("review_url"), "error": r.get("error"), "partial": r.get("partial"),
            "match": {k: m.get(k) for k in ("author", "title", "text", "rating", "date")} if m else None}


def run_check(uid, app, text, store="unknown", date=None, rating=None, thumb=None, source="app", country=None):
    """Каждый раз проверяет заново в магазине (никакого кэша между людьми) и сохраняет результат в базу."""
    from checker import check
    app, text = (app or "").strip(), (text or "").strip()
    if not app or not text:
        raise CheckError("Нужны название приложения и текст отзыва")
    country = country or get_country(uid)
    stores = (store,) if store in ("apple", "play") else ("apple", "play")
    results = check(app, text, country, LANG_OF.get(country, "ru"), stores)
    rank = {"found": 2, "similar": 1, "not_found": 0}
    good = [r for r in results if r.get("status")]
    if not good:
        raise CheckError("Не удалось связаться с магазином: " + "; ".join(r.get("error", "") for r in results)[:200])
    best = max(good, key=lambda r: (rank[r["status"]], r.get("score", 0)))
    m = best.get("match") or {}
    upsert_user(uid)
    with conn() as c:
        cur = c.execute(
            """INSERT INTO checks(user_id,created,source,store,app_name,app_url,text,review_date,rating,verdict,score,
               review_url,checked,matched_author,country,details,thumb) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uid, time.time(), source, best["store"], best["app"]["name"], best["app"]["url"], text, date, rating,
             best["status"], best.get("score", 0), best.get("review_url"), best.get("checked", 0), m.get("author"),
             country, json.dumps([_slim(r) for r in results], ensure_ascii=False), thumb))
        cid = cur.lastrowid
    return get_check(uid, cid)
