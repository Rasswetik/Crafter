"""Запуск всего: python main.py  (мини-приложение + Telegram-бот, общая база SQLite)."""
import logging
import os
import threading

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))


def main():
    load_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # иначе в логах виден токен бота
    import core
    import server
    core.init_db()
    token = os.environ.get("TELEGRAM_TOKEN", "")
    port = int(os.environ.get("PORT", 8765))
    # ALLOW_BROWSER=1 разрешает открывать мини-приложение в обычном браузере (только для проверки на своём ПК)
    srv = server.make_server(port, token, os.environ.get("ALLOW_BROWSER") == "1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"Мини-приложение: http://localhost:{port}")
    if os.environ.get("HOST_ALL") == "1":  # доступ с телефона и других устройств в той же сети Wi-Fi
        import socket
        try:
            ips = [i for i in socket.gethostbyname_ex(socket.gethostname())[2] if not i.startswith("127.")]
        except OSError:
            ips = []
        for ip in ips:
            print(f"В локальной сети:   http://{ip}:{port}")
    # прогрев распознавания, чтобы первый скриншот не ждал загрузки моделей
    threading.Thread(target=lambda: __import__("ocr").reader(), daemon=True).start()
    if not token:
        print("TELEGRAM_TOKEN не задан: работает только сайт. Укажи токен в файле .env")
        threading.Event().wait()
        return
    import bot
    if not os.environ.get("WEBAPP_URL", "").startswith("https://"):
        print("WEBAPP_URL не задан (нужен https-адрес): кнопка мини-приложения в боте не появится. См. README.md")
    print("Бот запущен. Остановить: Ctrl+C")
    bot.build_application(token).run_polling()


if __name__ == "__main__":
    main()
