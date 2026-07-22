#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_PORT="${APP_PORT:-3001}"
DOMAIN="${DOMAIN:-dashboards.adreports.ru}"
SERVER_ALIASES="${SERVER_ALIASES:-5.35.85.218}"
SERVER_NAMES="${SERVER_NAMES:-$DOMAIN $SERVER_ALIASES}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/dashboard-next.conf}"
TLS_CERT="${TLS_CERT:-/etc/letsencrypt/live/$DOMAIN/fullchain.pem}"
TLS_KEY="${TLS_KEY:-/etc/letsencrypt/live/$DOMAIN/privkey.pem}"
APP_PARENT_DIR="$(dirname "$APP_DIR")"
APP_BASENAME="$(basename "$APP_DIR")"
RELEASES_DIR="${RELEASES_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-releases}"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"

echo "=== Setup dashboard-next on Beget VPS ==="

mkdir -p "$APP_DIR" "$RELEASES_DIR" "$BACKUPS_DIR" /var/log

for required_bin in node pm2 nginx ss curl; do
  command -v "$required_bin" >/dev/null 2>&1 || {
    echo "Missing required binary: $required_bin" >&2
    exit 1
  }
done

if [[ ! -f "$TLS_CERT" || ! -f "$TLS_KEY" ]]; then
  echo "TLS certificate files not found: $TLS_CERT / $TLS_KEY" >&2
  exit 1
fi

node -v
pm2 -v
nginx -v

cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name $SERVER_NAMES;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /_next/static/ {
        alias $APP_DIR/.next/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 30s;
    }

    client_max_body_size 10M;
}

server {
    listen 443 ssl;
    server_name $SERVER_NAMES;

    ssl_certificate "$TLS_CERT";
    ssl_certificate_key "$TLS_KEY";
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /_next/static/ {
        alias $APP_DIR/.next/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 30s;
    }

    client_max_body_size 10M;
}
NGINX

nginx -t
systemctl reload nginx

if pm2 describe dashboard-next >/dev/null 2>&1; then
  PUBLIC_APP_HOST="${SERVER_ALIASES%% *}" APP_PORT="$APP_PORT" \
    bash "$SCRIPT_DIR/verify-loopback-listener.sh"
else
  echo "Runtime listener verification is deferred until the first deploy."
fi

echo "=== Setup complete ==="
echo "App dir: $APP_DIR"
echo "Releases dir: $RELEASES_DIR"
echo "Backups dir: $BACKUPS_DIR"
echo "Next step: npm run deploy"
echo "Post-deploy listener check: PUBLIC_APP_HOST='${SERVER_ALIASES%% *}' APP_PORT='$APP_PORT' bash scripts/verify-loopback-listener.sh"
