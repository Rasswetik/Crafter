# Deploying Crafter on your own server

**Быстрый путь (Ubuntu VPS, от root):**
```bash
git clone https://github.com/Rasswetik/Crafter.git /tmp/crafter-setup && bash /tmp/crafter-setup/deploy/setup.sh
```
Скрипт ставит пакеты, PostgreSQL, приложение, nginx, HTTPS и спрашивает только домен, BOT_TOKEN, BOT_USERNAME и ваш Telegram ID. Ниже — те же шаги вручную.

Ubuntu/Debian with systemd + nginx + PostgreSQL. Render still works (`gunicorn.conf.py` reads `PORT`).

## 1. Install
```bash
sudo useradd -m crafter
sudo mkdir -p /opt/crafter && sudo chown crafter:crafter /opt/crafter
sudo -u crafter git clone https://github.com/Rasswetik/Crafter.git /opt/crafter
cd /opt/crafter && sudo -u crafter python3 -m venv .venv
sudo -u crafter .venv/bin/pip install -r requirements.txt
sudo -u crafter cp .env.example .env   # then edit .env
```

## 2. Configure `.env`
Required: `BOT_TOKEN`, `BOT_USERNAME`, `ADMIN_IDS` (+ `PRIMARY_ADMIN_ID`), `DATABASE_URL`.
Set `DEMO_MODE=0` only after the Portals steps below. Never commit `.env`.

## 3. Portals Market
1. Generate the encryption key and put it in `CRAFTER_PORTALS_FERNET_KEY`:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
2. Start the app, open the admin panel → Portals Partner, paste the Partner API key (stored encrypted) and press **Check**.
3. Real purchases stay **off** until all four are true: `CRAFTER_PORTALS_LIVE_PURCHASES=1`, PostgreSQL configured,
   key verified within the last hour, and an admin confirms "ВКЛЮЧИТЬ РЕАЛЬНЫЕ ПОКУПКИ". Portals allows 1 request/second;
   the app enforces it across workers. A paid request that times out is never retried — it goes to manual review.
4. Market refresh: `MARKET_REFRESH_SECONDS=900` refreshes the catalogue every 15 min (0 = off, min 60);
   the admin panel shows `auto_refresh` (interval, last run, last error) and has a manual sync button.

## 4. Run
```bash
sudo cp deploy/crafter.service /etc/systemd/system/
sudo systemctl enable --now crafter
sudo cp deploy/nginx.conf /etc/nginx/sites-available/crafter   # set your domain
sudo ln -s /etc/nginx/sites-available/crafter /etc/nginx/sites-enabled/
sudo certbot --nginx -d crafter.example.com && sudo systemctl reload nginx
```
Keep **one** gunicorn worker (`gunicorn.conf.py`): the refresh scheduler and rate limiter assume it.

## 5. Telegram
BotFather → `/newapp` or the bot's Menu Button → URL `https://crafter.example.com/`. Set the same domain for TON Connect (see `TON_CONNECT.md`).

## 6. Backups
Back up PostgreSQL (`pg_dump`) daily. For the SQLite fallback, see `scripts/restore_sqlite.py`.

## 7. Автовывод TON
См. `docs/AUTO_PAYOUT_TIMEWEB.md` (systemd timer вместо Render Cron).
