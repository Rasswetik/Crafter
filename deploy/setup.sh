#!/usr/bin/env bash
# Crafter one-shot installer for a fresh Ubuntu 22.04/24.04 VPS (run as root).
#   git clone https://github.com/Rasswetik/Crafter.git /tmp/crafter-setup && bash /tmp/crafter-setup/deploy/setup.sh
# Or with an uploaded archive:  apt-get install -y unzip && mkdir -p /opt/crafter && unzip -o Crafter-server.zip -d /opt/crafter && bash /opt/crafter/deploy/setup.sh
# Safe to re-run: it updates the code and keeps your .env and database.
set -euo pipefail

REPO="https://github.com/Rasswetik/Crafter.git"
APP=/opt/crafter

if [ "$(id -u)" -ne 0 ]; then echo "Запустите от root (sudo -i)"; exit 1; fi

echo "== 1/7 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git python3-venv python3-pip nginx certbot python3-certbot-nginx postgresql ufw fail2ban curl openssl

echo "== 2/7 Swap (если мало памяти)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 3/7 Пользователь и код"
id crafter >/dev/null 2>&1 || useradd -m -s /bin/bash crafter
mkdir -p "$APP" && chown crafter:crafter "$APP"
chown -R crafter:crafter "$APP"      # a clone made by root must be owned by crafter before git pull
if [ -d "$APP/.git" ]; then
  sudo -u crafter git -C "$APP" pull --ff-only
elif [ -f "$APP/app.py" ]; then
  echo "Код уже загружен в $APP (из архива) — GitHub не нужен"
  chown -R crafter:crafter "$APP"
else
  sudo -u crafter git clone "$REPO" "$APP"
fi
sudo -u crafter bash -c "cd $APP && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt"

echo "== 4/7 База данных PostgreSQL"
ENV="$APP/.env"
if [ ! -f "$ENV" ]; then
  DBPASS="$(openssl rand -hex 16)"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='crafter'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE USER crafter WITH PASSWORD '$DBPASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='crafter'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE crafter OWNER crafter;"
  sudo -u postgres psql -c "ALTER USER crafter WITH PASSWORD '$DBPASS';" >/dev/null

  echo "== 5/7 Настройки (.env)"
  read -rp "Домен сайта (например crafter.example.com), Enter чтобы пропустить: " DOMAIN
  read -rsp "BOT_TOKEN Telegram-бота (ввод скрыт): " BOT_TOKEN; echo
  read -rp  "BOT_USERNAME (без @): " BOT_USERNAME
  read -rp  "Ваш числовой Telegram ID (администратор): " ADMIN_ID
  FERNET="$("$APP/.venv/bin/python" -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  cat > "$ENV" <<EOF
DEMO_MODE=0
MARKET_TEST_PURCHASES=1
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME
PRIMARY_ADMIN_ID=$ADMIN_ID
ADMIN_IDS=$ADMIN_ID
DATABASE_URL=postgresql://crafter:$DBPASS@127.0.0.1:5432/crafter
CRAFTER_PORTALS_FERNET_KEY=$FERNET
MARKET_REFRESH_SECONDS=900
CATALOG_REFRESH_ON_START=1
PORT=5000
EOF
  chown crafter:crafter "$ENV" && chmod 600 "$ENV"
  echo "$DOMAIN" > /etc/crafter-domain
else
  echo ".env уже есть — оставляю как есть"
  DOMAIN="$(cat /etc/crafter-domain 2>/dev/null || true)"
fi

echo "== 6/7 Служба приложения"
cp "$APP/deploy/crafter.service" /etc/systemd/system/crafter.service
systemctl daemon-reload
systemctl enable crafter >/dev/null
systemctl restart crafter

echo "== 7/7 nginx, брандмауэр, HTTPS"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/crafter <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;
    client_max_body_size 8m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/crafter /etc/nginx/sites-enabled/crafter
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null

sleep 3
if curl -fsS http://127.0.0.1:5000/health >/dev/null; then echo "Приложение отвечает: OK"; else
  echo "Приложение не отвечает. Логи: journalctl -u crafter -n 80 --no-pager"; fi

if [ -n "${DOMAIN:-}" ]; then
  echo "Выпускаю HTTPS-сертификат для $DOMAIN (домен должен указывать на IP этого сервера)..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "Сертификат не выпущен. Проверьте A-запись домена и повторите: certbot --nginx -d $DOMAIN"
fi
echo
echo "Готово. Проверьте: ${DOMAIN:+https://$DOMAIN/health}${DOMAIN:-http://IP_СЕРВЕРА/health}"
echo "Дальше: BotFather -> адрес Mini App, админка -> раздел «Термос» -> токен, Relayer, режим покупок."
