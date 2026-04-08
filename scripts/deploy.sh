#!/bin/bash
set -euo pipefail

VPS="${VPS:-beget}"
VPS_DIR="${VPS_DIR:-/var/www/dashboard}"
TMP_ENV="$(mktemp)"

cleanup() {
  rm -f "$TMP_ENV"
}
trap cleanup EXIT

echo "Building standalone bundle..."
npm ci
NODE_ENV=production npm run build

echo "Rendering production env from VPS secrets..."
bash scripts/render-production-env.sh "$TMP_ENV"

echo "Packaging build artifacts..."
rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/src .next/standalone/ecosystem.config.js .next/standalone/package.json .next/standalone/.env
mkdir -p .next/standalone/.next .next/standalone/src/schemas
cp -R .next/static .next/standalone/.next/static
if [ -d public ]; then
  cp -R public .next/standalone/public
fi
cp "$TMP_ENV" .next/standalone/.env
cp ecosystem.config.js .next/standalone/
cp package.json .next/standalone/
cp src/schemas/*.yaml .next/standalone/src/schemas/

echo "Uploading to VPS..."
ssh "$VPS" "mkdir -p '$VPS_DIR' /var/log"
rsync -avz --delete .next/standalone/ "$VPS:$VPS_DIR/"

echo "Restarting PM2 app..."
ssh "$VPS" "bash -lc '
  cd $VPS_DIR
  if pm2 describe dashboard-next >/dev/null 2>&1; then
    pm2 restart dashboard-next
  else
    pm2 start ecosystem.config.js --only dashboard-next
  fi
  pm2 save
  pm2 list
  curl -fsS http://127.0.0.1:3001/api/health
'"

echo "Deploy complete."
