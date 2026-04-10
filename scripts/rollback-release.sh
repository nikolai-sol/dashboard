#!/bin/bash
set -euo pipefail

VPS="${VPS:-beget}"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_NAME="${APP_NAME:-dashboard-next}"
APP_PORT="${APP_PORT:-3001}"
APP_PARENT_DIR="$(dirname "$APP_DIR")"
APP_BASENAME="$(basename "$APP_DIR")"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"
TARGET_BACKUP="${1:-}"

ssh "$VPS" "APP_DIR='$APP_DIR' BACKUPS_DIR='$BACKUPS_DIR' TARGET_BACKUP='$TARGET_BACKUP' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' bash -s" <<'REMOTE'
set -euo pipefail

APP_DIR="${APP_DIR:?}"
BACKUPS_DIR="${BACKUPS_DIR:?}"
TARGET_BACKUP="${TARGET_BACKUP:-}"
APP_NAME="${APP_NAME:?}"
APP_PORT="${APP_PORT:?}"
ROLLBACK_ID="$(date -u +%Y%m%d%H%M%S)"
CURRENT_SNAPSHOT="$BACKUPS_DIR/${ROLLBACK_ID}-manual-rollback"
FAILED_DIR="$BACKUPS_DIR/${ROLLBACK_ID}-rollback-failed"

if [ ! -d "$BACKUPS_DIR" ]; then
  echo "Backup directory does not exist: $BACKUPS_DIR" >&2
  exit 1
fi

if [ -z "$TARGET_BACKUP" ]; then
  TARGET_BACKUP="$(find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*-failed' | sort -r | head -n 1)"
fi

if [ -z "$TARGET_BACKUP" ] || [ ! -d "$TARGET_BACKUP" ]; then
  echo "Rollback target not found." >&2
  exit 1
fi

if [ -e "$APP_DIR" ]; then
  mv "$APP_DIR" "$CURRENT_SNAPSHOT"
fi

mv "$TARGET_BACKUP" "$APP_DIR"

restore_current() {
  local reason="$1"

  echo "Rollback failed: $reason"
  set +e

  if [ -d "$APP_DIR" ]; then
    rm -rf "$FAILED_DIR"
    mv "$APP_DIR" "$FAILED_DIR"
  fi

  if [ -d "$CURRENT_SNAPSHOT" ]; then
    mv "$CURRENT_SNAPSHOT" "$APP_DIR"
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

cd "$APP_DIR"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" || restore_current "pm2 restart failed"
else
  pm2 start ecosystem.config.js --only "$APP_NAME" || restore_current "pm2 start failed"
fi
pm2 save || restore_current "pm2 save failed"

health_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done

if [ "$health_ok" -ne 1 ]; then
  restore_current "health check failed"
fi

echo "Rolled back using $(basename "$TARGET_BACKUP")."
REMOTE
