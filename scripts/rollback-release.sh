#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VPS="${VPS:-beget}"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_NAME="${APP_NAME:-dashboard-next}"
APP_PORT="${APP_PORT:-3001}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-5.35.85.218}"
APP_PARENT_DIR="$(dirname "$APP_DIR")"
APP_BASENAME="$(basename "$APP_DIR")"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"
TARGET_BACKUP="${1:-}"

ssh "$VPS" "APP_DIR='$APP_DIR' BACKUPS_DIR='$BACKUPS_DIR' TARGET_BACKUP='$TARGET_BACKUP' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' PUBLIC_APP_HOST='$PUBLIC_APP_HOST' bash -s" \
  < "$SCRIPT_DIR/rollback-release-remote.sh"
