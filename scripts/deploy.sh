#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VPS="${VPS:-beget}"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_NAME="${APP_NAME:-dashboard-next}"
APP_PORT="${APP_PORT:-3001}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
GIT_REVISION="$(git -C "$APP_SOURCE_DIR" rev-parse --short HEAD 2>/dev/null || echo local)"
RELEASE_ID="${RELEASE_ID:-${TIMESTAMP}-${GIT_REVISION}}"
APP_PARENT_DIR="$(dirname "$APP_DIR")"
APP_BASENAME="$(basename "$APP_DIR")"
RELEASES_DIR="${RELEASES_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-releases}"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"
REMOTE_STAGE_DIR="$RELEASES_DIR/$RELEASE_ID"
TMP_ENV="$(mktemp)"

cleanup() {
  rm -f "$TMP_ENV"
}
trap cleanup EXIT

cd "$APP_SOURCE_DIR"

echo "Building standalone bundle for release $RELEASE_ID..."
npm ci
npm run build

echo "Rendering production env from VPS secrets..."
bash scripts/render-production-env.sh "$TMP_ENV"

echo "Packaging build artifacts..."
rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/src .next/standalone/ecosystem.config.js .next/standalone/package.json .next/standalone/.env .next/standalone/scripts
mkdir -p .next/standalone/.next .next/standalone/src/schemas .next/standalone/scripts
cp -R .next/static .next/standalone/.next/static
if [ -d public ]; then
  cp -R public .next/standalone/public
fi
cp "$TMP_ENV" .next/standalone/.env
cp ecosystem.config.js .next/standalone/
cp package.json .next/standalone/
cp scripts/rollback-release.sh .next/standalone/scripts/
cp src/schemas/*.yaml .next/standalone/src/schemas/

echo "Uploading staged release to VPS..."
ssh "$VPS" "mkdir -p '$RELEASES_DIR' '$BACKUPS_DIR' /var/log"
rsync -avz --delete .next/standalone/ "$VPS:$REMOTE_STAGE_DIR/"

echo "Activating staged release with automatic rollback on failure..."
ssh "$VPS" "APP_DIR='$APP_DIR' BACKUPS_DIR='$BACKUPS_DIR' STAGE_DIR='$REMOTE_STAGE_DIR' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' KEEP_BACKUPS='$KEEP_BACKUPS' RELEASE_ID='$RELEASE_ID' bash -s" <<'REMOTE'
set -euo pipefail

APP_DIR="${APP_DIR:?}"
BACKUPS_DIR="${BACKUPS_DIR:?}"
STAGE_DIR="${STAGE_DIR:?}"
APP_NAME="${APP_NAME:?}"
APP_PORT="${APP_PORT:?}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
RELEASE_ID="${RELEASE_ID:?}"
PREVIOUS_DIR="$BACKUPS_DIR/${RELEASE_ID}-previous"
FAILED_DIR="$BACKUPS_DIR/${RELEASE_ID}-failed"

rollback() {
  local reason="$1"

  echo "Activation failed: $reason"
  set +e

  if [ -d "$APP_DIR" ]; then
    rm -rf "$FAILED_DIR"
    mv "$APP_DIR" "$FAILED_DIR"
  fi

  if [ -d "$PREVIOUS_DIR" ]; then
    mv "$PREVIOUS_DIR" "$APP_DIR"
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      pm2 restart "$APP_NAME"
    else
      cd "$APP_DIR"
      pm2 start ecosystem.config.js --only "$APP_NAME"
    fi
    pm2 save || true
  fi

  exit 1
}

if [ ! -d "$STAGE_DIR" ]; then
  echo "Staged release not found: $STAGE_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUPS_DIR"
rm -rf "$PREVIOUS_DIR" "$FAILED_DIR"

if [ -e "$APP_DIR" ]; then
  mv "$APP_DIR" "$PREVIOUS_DIR"
fi

mv "$STAGE_DIR" "$APP_DIR"

if ! cd "$APP_DIR"; then
  rollback "unable to enter app directory"
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" || rollback "pm2 restart failed"
else
  pm2 start ecosystem.config.js --only "$APP_NAME" || rollback "pm2 start failed"
fi

pm2 save || rollback "pm2 save failed"
curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null || rollback "health check failed"

find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk "NR>$KEEP_BACKUPS" | while IFS= read -r stale_backup; do
  rm -rf "$stale_backup"
done

echo "Release activated successfully."
REMOTE

echo "Deploy complete."
