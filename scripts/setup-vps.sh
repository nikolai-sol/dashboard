#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/dashboard"
NGINX_CONF="/etc/nginx/conf.d/dashboard-next.conf"
TLS_CERT="/usr/local/mgr5/etc/manager.crt"
TLS_KEY="/usr/local/mgr5/etc/manager.key"

echo "=== Setup dashboard-next on Beget VPS ==="

mkdir -p "$APP_DIR" /var/log

node -v
pm2 -v
nginx -v

cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name dashboard.bayesly.digital 5.35.85.218;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /_next/static/ {
        alias /var/www/dashboard/.next/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
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
    server_name dashboard.bayesly.digital 5.35.85.218;

    ssl_certificate "$TLS_CERT";
    ssl_certificate_key "$TLS_KEY";
    ssl_ciphers EECDH:+AES256:-3DES:RSA+AES:!NULL:!RC4;
    ssl_prefer_server_ciphers on;
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location /_next/static/ {
        alias /var/www/dashboard/.next/static/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
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

echo "=== Setup complete ==="
echo "Next step: npm run deploy"
