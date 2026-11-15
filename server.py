"""Сервер мини-приложения: раздаёт webapp/ и API. Авторизация через подпись Telegram (initData)."""
import base64
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, parse_qsl, urlparse

import core

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "webapp")
MAX_BODY = 20 * 1024 * 1024
TEXT_TYPES = (".html", ".css", ".js", ".svg", ".json")


def verify_init_data(init_data, token, max_age=86400 * 7):
    """Проверка подписи Telegram WebApp. Возвращает dict пользователя или None."""
    if not init_data or not token:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        their = pairs.pop("hash", "")
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        mine = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mine, their):
            return None
        if time.time() - int(pairs.get("auth_date", 0)) > max_age:
            return None
        return json.loads(pairs["user"])
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    token = ""
    allow_browser = False

    # ---- утилиты ----
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise core.CheckError("Файл слишком большой")
        return json.loads(self.rfile.read(n) or b"{}")

    def current_user(self):
        u = verify_init_data(self.headers.get("X-Init-Data", ""), self.token)
        if u:
            core.upsert_user(u["id"], u.get("first_name"), u.get("username"))
            return {"id": u["id"], "first_name": u.get("first_name") or "", "username": u.get("username") or ""}
        if self.allow_browser:  # открыто в обычном браузере: один общий тестовый пользователь
            core.upsert_user(1, "Гость", None)
            return {"id": 1, "first_name": "Гость", "username": ""}
        return None

    # ---- маршруты ----
    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            return self.api("GET", url)
        self.static(url.path)

    def do_POST(self):
        self.api("POST", urlparse(self.path))

    def static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(WEB) or not os.path.isfile(full):
            self.send_response(404)
            self.end_headers()
            return
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(TEXT_TYPES):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def api(self, method, url):
        route = url.path[5:]
        if route == "health":
            return self.send_json({"ok": True})
        user = self.current_user()
        if not user:
            return self.send_json({"error": "Откройте мини-приложение из Telegram"}, 401)
        uid = user["id"]
        q = parse_qs(url.query)
        try:
            if method == "GET" and route == "me":
                return self.send_json({
                    "user": user, "country": core.get_country(uid), "stats": core.stats(uid),
                    "countries": [{"code": c[0], "name": c[1], "flag": c[2]} for c in core.COUNTRIES]})
            if method == "GET" and route == "history":
                s = (q.get("status") or [""])[0]
                found = True if s == "found" else False if s == "not_found" else None
                return self.send_json({"items": core.list_checks(uid, found, (q.get("q") or [""])[0].strip() or None),
                                       "stats": core.stats(uid)})
            if method == "POST":
                d = self.read_json()
                if route == "settings":
                    core.set_country(uid, d.get("country"))
                    return self.send_json({"ok": True})
                if route == "scan":
                    return self.send_json(core.scan_image(base64.b64decode(d["image"])))
                if route == "check":
                    item = core.run_check(uid, d.get("app"), d.get("text"), d.get("store") or "unknown", d.get("date"),
                                          d.get("rating"), d.get("thumb"), "app")
                    return self.send_json({"item": item, "stats": core.stats(uid)})
                if route == "delete":
                    core.delete_check(uid, int(d["id"]))
                    return self.send_json({"stats": core.stats(uid)})
                if route == "clear":
                    s = d.get("status")
                    core.clear_checks(uid, True if s == "found" else False if s == "not_found" else None)
                    return self.send_json({"stats": core.stats(uid)})
            return self.send_json({"error": "Не найдено"}, 404)
        except core.CheckError as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa
            logging.exception("api %s", route)
            self.send_json({"error": "Внутренняя ошибка: %s" % e}, 500)

    def log_message(self, *a):
        pass


def make_server(port, token="", allow_browser=False):
    Handler.token = token
    Handler.allow_browser = allow_browser
    host = "0.0.0.0" if os.environ.get("HOST_ALL") else "127.0.0.1"
    return ThreadingHTTPServer((host, port), Handler)
