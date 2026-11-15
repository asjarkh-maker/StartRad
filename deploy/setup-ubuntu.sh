#!/usr/bin/env bash
# Установка сайта «Только да» на Ubuntu/Debian. Запускать от root:
#   bash setup-ubuntu.sh                      # сайт по IP-адресу, http
#   bash setup-ubuntu.sh example.ru me@mail.ru # с доменом и HTTPS (Let's Encrypt)
# Повторный запуск безопасен: обновит код и перезапустит сайт.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="https://github.com/asjarkh-maker/startrad.git"
BRANCH="feature/tolko-da-service"
APP=/opt/tolko-da
ZIP=/root/startrad.zip

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root (или через sudo)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Пакеты"
apt-get update -y
apt-get install -y curl git nginx unzip ca-certificates rsync

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Код сайта"
mkdir -p "$APP"
if [ -f "$ZIP" ]; then
  tmp=$(mktemp -d)
  unzip -oq "$ZIP" -d "$tmp"
  src=$(find "$tmp" -maxdepth 2 -name server.js -printf '%h\n' | head -1)
  [ -n "$src" ] || { echo "В $ZIP нет server.js"; exit 1; }
  rsync -a --exclude data --exclude node_modules "$src"/ "$APP"/
  rm -rf "$tmp"
else
  tmp=$(mktemp -d)
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$tmp" || {
    echo
    echo "Не удалось скачать репозиторий (возможно, он приватный)."
    echo "Скачайте ZIP ветки на свой компьютер и загрузите на сервер:"
    echo "  scp startrad.zip root@<IP>:/root/startrad.zip"
    echo "затем запустите этот скрипт снова."
    exit 1
  }
  rsync -a --exclude .git --exclude data --exclude node_modules "$tmp"/ "$APP"/
  rm -rf "$tmp"
fi

echo "==> Зависимости"
cd "$APP"
npm ci --omit=dev
mkdir -p data
chown -R www-data:www-data "$APP/data"

echo "==> Служба"
cat > /etc/systemd/system/tolko-da.service <<UNIT
[Unit]
Description=Tolko da
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=$(command -v node) server.js
Environment=PORT=3000
Environment=PAYMENT_MODE=dev
User=www-data
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable tolko-da >/dev/null
systemctl restart tolko-da

echo "==> nginx"
cat > /etc/nginx/sites-available/tolko-da <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN:-_};
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/tolko-da /etc/nginx/sites-enabled/tolko-da
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
fi

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  echo "==> HTTPS для $DOMAIN"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || echo "Не удалось выпустить сертификат: проверьте, что домен указывает на этот сервер."
fi

sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)
echo
echo "Готово. Ответ сайта: HTTP $code"
ip=$(curl -s -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo "Откройте: http://${DOMAIN:-$ip}/"
echo "Логи сайта:  journalctl -u tolko-da -f"
