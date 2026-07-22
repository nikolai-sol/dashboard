#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:?}"
BACKUPS_DIR="${BACKUPS_DIR:?}"
TARGET_BACKUP="${TARGET_BACKUP:-}"
APP_NAME="${APP_NAME:?}"
APP_PORT="${APP_PORT:?}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-}"
COMPATIBILITY_MARKER=".shared-password-db-auth-v1"
ROLLBACK_ID="$(date -u +%Y%m%d%H%M%S)"
CURRENT_SNAPSHOT="$BACKUPS_DIR/${ROLLBACK_ID}-manual-rollback"
FAILED_DIR="$BACKUPS_DIR/${ROLLBACK_ID}-rollback-failed"

is_compatible_release() {
  local release_dir="$1"
  [[ -f "$release_dir/$COMPATIBILITY_MARKER" && ! -L "$release_dir/$COMPATIBILITY_MARKER" ]]
}

start_release() {
  local release_dir="$1"
  cd -P -- "$release_dir" &&
    pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
}

if [[ ! -d "$BACKUPS_DIR" ]]; then
  echo "Backup directory does not exist: $BACKUPS_DIR" >&2
  exit 1
fi

if [[ -z "$TARGET_BACKUP" ]]; then
  while IFS= read -r candidate; do
    if is_compatible_release "$candidate"; then
      TARGET_BACKUP="$candidate"
      break
    fi
  done < <(find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*-failed' | sort -r)
fi

if [[ -z "$TARGET_BACKUP" || ! -d "$TARGET_BACKUP" ]]; then
  echo "Compatible rollback target not found." >&2
  exit 1
fi

if ! is_compatible_release "$TARGET_BACKUP"; then
  echo "Rollback target is missing the shared-password compatibility marker" >&2
  exit 1
fi

if [[ -e "$APP_DIR" ]]; then
  mv "$APP_DIR" "$CURRENT_SNAPSHOT"
fi

mv "$TARGET_BACKUP" "$APP_DIR"

restore_current() {
  local reason="$1"

  echo "Rollback failed: $reason" >&2
  set +e

  if [[ -d "$APP_DIR" ]]; then
    rm -rf "$FAILED_DIR"
    mv "$APP_DIR" "$FAILED_DIR"
  fi

  if [[ -d "$CURRENT_SNAPSHOT" ]] && is_compatible_release "$CURRENT_SNAPSHOT"; then
    mv "$CURRENT_SNAPSHOT" "$APP_DIR"
    if start_release "$APP_DIR"; then
      pm2 save || true
    else
      pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
      pm2 save || true
      echo "Compatible current release reload failed; service left stopped fail-closed." >&2
    fi
  else
    pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
    pm2 save || true
    echo "No compatible current release; service left stopped fail-closed." >&2
  fi

  exit 1
}

start_release "$APP_DIR" || restore_current "pm2 startOrReload failed"
pm2 save || restore_current "pm2 save failed"

health_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done

if [[ "$health_ok" -ne 1 ]]; then
  restore_current "health check failed"
fi

PUBLIC_APP_HOST="$PUBLIC_APP_HOST" APP_PORT="$APP_PORT" \
  bash "$APP_DIR/scripts/verify-loopback-listener.sh" || restore_current "listener isolation check failed"

echo "Rolled back using $(basename "$TARGET_BACKUP")."
