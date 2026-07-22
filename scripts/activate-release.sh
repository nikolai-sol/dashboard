#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:?}"
BACKUPS_DIR="${BACKUPS_DIR:?}"
STAGE_DIR="${STAGE_DIR:?}"
APP_NAME="${APP_NAME:?}"
APP_PORT="${APP_PORT:?}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
RELEASE_ID="${RELEASE_ID:?}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-}"
COMPATIBILITY_MARKER=".shared-password-db-auth-v1"
PREVIOUS_DIR="$BACKUPS_DIR/${RELEASE_ID}-previous"
FAILED_DIR="$BACKUPS_DIR/${RELEASE_ID}-failed"

is_compatible_release() {
  local release_dir="$1"
  [[ -f "$release_dir/$COMPATIBILITY_MARKER" && ! -L "$release_dir/$COMPATIBILITY_MARKER" ]]
}

start_release() {
  local release_dir="$1"
  cd -P -- "$release_dir" &&
    pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
}

rollback() {
  local reason="$1"

  echo "Activation failed: $reason" >&2
  set +e

  if [[ -d "$APP_DIR" ]]; then
    rm -rf "$FAILED_DIR"
    mv "$APP_DIR" "$FAILED_DIR"
  fi

  if [[ -d "$PREVIOUS_DIR" ]] && is_compatible_release "$PREVIOUS_DIR"; then
    mv "$PREVIOUS_DIR" "$APP_DIR"
    if start_release "$APP_DIR"; then
      pm2 save || true
    else
      pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
      pm2 save || true
      echo "Compatible predecessor reload failed; service left stopped fail-closed." >&2
    fi
  else
    pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
    pm2 save || true
    echo "No compatible predecessor; service left stopped fail-closed." >&2
  fi

  exit 1
}

if [[ ! -d "$STAGE_DIR" ]]; then
  echo "Staged release not found: $STAGE_DIR" >&2
  exit 1
fi

if ! is_compatible_release "$STAGE_DIR"; then
  echo "Staged release is missing the shared-password compatibility marker" >&2
  exit 1
fi

mkdir -p "$BACKUPS_DIR"
rm -rf "$PREVIOUS_DIR" "$FAILED_DIR"

if [[ -e "$APP_DIR" ]]; then
  mv "$APP_DIR" "$PREVIOUS_DIR"
fi

mv "$STAGE_DIR" "$APP_DIR"

if ! cd "$APP_DIR"; then
  rollback "unable to enter app directory"
fi

if [[ -f "$APP_DIR/fetch_google_ads_canonical.py" ]]; then
  if [[ ! -x "$APP_DIR/.gads-venv/bin/python" ]]; then
    python3 -m venv "$APP_DIR/.gads-venv" || rollback "unable to create Google Ads Python venv"
  fi
  "$APP_DIR/.gads-venv/bin/python" -m pip install --upgrade pip >/dev/null || rollback "unable to upgrade Google Ads Python venv pip"
  "$APP_DIR/.gads-venv/bin/python" -m pip install python-dotenv google-ads mysql-connector-python requests >/dev/null || rollback "unable to install collector Python dependencies"
fi

start_release "$APP_DIR" || rollback "pm2 startOrReload failed"

pm2 save || rollback "pm2 save failed"

health_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done

if [[ "$health_ok" -ne 1 ]]; then
  rollback "health check failed"
fi

PUBLIC_APP_HOST="$PUBLIC_APP_HOST" APP_PORT="$APP_PORT" \
  bash "$APP_DIR/scripts/verify-loopback-listener.sh" || rollback "listener isolation check failed"

find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk "NR>$KEEP_BACKUPS" | while IFS= read -r stale_backup; do
  rm -rf "$stale_backup"
done

echo "Release activated successfully."
