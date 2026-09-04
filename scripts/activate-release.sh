#!/bin/bash
set -euo pipefail

if [[ "$#" -gt 0 ]]; then
  [[ "$#" -eq 9 ]] || {
    echo "Expected 9 positional activation arguments" >&2
    exit 1
  }
  APP_DIR="$1"
  BACKUPS_DIR="$2"
  STAGE_DIR="$3"
  APP_NAME="$4"
  APP_PORT="$5"
  KEEP_BACKUPS="$6"
  RELEASE_ID="$7"
  PUBLIC_APP_HOST="$8"
  RELEASE_SHA="$9"
else
  APP_DIR="${APP_DIR:?}"
  BACKUPS_DIR="${BACKUPS_DIR:?}"
  STAGE_DIR="${STAGE_DIR:?}"
  APP_NAME="${APP_NAME:?}"
  APP_PORT="${APP_PORT:?}"
  KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
  RELEASE_ID="${RELEASE_ID:?}"
  RELEASE_SHA="${RELEASE_SHA:?}"
  PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-}"
fi

fail_validation() {
  echo "$1" >&2
  exit 1
}

validate_release_id() {
  [[ -n "$RELEASE_ID" && "${#RELEASE_ID}" -le 128 && "$RELEASE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
    || fail_validation "Invalid release ID"
}

validate_remote_path() {
  local label="$1"
  local value="$2"
  [[ -n "$value" && "${#value}" -le 512 && "$value" =~ ^/[A-Za-z0-9._/-]+$ && "$value" != "/" ]] \
    || fail_validation "Invalid $label"
  case "/${value#/}/" in
    *//*|*/./*|*/../*) fail_validation "Invalid $label" ;;
  esac
}

validate_release_id
validate_remote_path "APP_DIR" "$APP_DIR"
validate_remote_path "BACKUPS_DIR" "$BACKUPS_DIR"
validate_remote_path "STAGE_DIR" "$STAGE_DIR"
[[ -n "$APP_NAME" && "${#APP_NAME}" -le 64 && "$APP_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail_validation "Invalid APP_NAME"
[[ "$APP_PORT" =~ ^[0-9]+$ && "$APP_PORT" -ge 1 && "$APP_PORT" -le 65535 ]] \
  || fail_validation "Invalid APP_PORT"
[[ "$KEEP_BACKUPS" =~ ^[0-9]+$ && "$KEEP_BACKUPS" -le 100 ]] \
  || fail_validation "Invalid KEEP_BACKUPS"
[[ -z "$PUBLIC_APP_HOST" || ( "${#PUBLIC_APP_HOST}" -le 255 && "$PUBLIC_APP_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ) ]] \
  || fail_validation "Invalid PUBLIC_APP_HOST"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail_validation "Expected release source SHA is not a full Git SHA"

COMPATIBILITY_MARKER=".shared-password-db-auth-v1"
SOURCE_SHA_FILE=".release-source-sha"
PREVIOUS_DIR="$BACKUPS_DIR/${RELEASE_ID}-previous"
FAILED_DIR="$BACKUPS_DIR/${RELEASE_ID}-failed"

is_compatible_release() {
  local release_dir="$1"
  [[ -f "$release_dir/$COMPATIBILITY_MARKER" && ! -L "$release_dir/$COMPATIBILITY_MARKER" ]]
}

read_release_sha() {
  local release_dir="$1"
  local metadata_file="$release_dir/$SOURCE_SHA_FILE"
  local source_sha
  if [[ ! -f "$metadata_file" || -L "$metadata_file" ]]; then
    return 1
  fi
  source_sha="$(cat "$metadata_file")"
  if [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then
    return 1
  fi
  printf '%s\n' "$source_sha"
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

if ! STAGED_RELEASE_SHA="$(read_release_sha "$STAGE_DIR")"; then
  echo "Staged release source SHA metadata is missing or invalid" >&2
  exit 1
fi
if [[ "$STAGED_RELEASE_SHA" != "$RELEASE_SHA" ]]; then
  echo "Staged release source SHA $STAGED_RELEASE_SHA does not match expected source SHA $RELEASE_SHA" >&2
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

if ! ACTIVE_RELEASE_SHA="$(read_release_sha "$APP_DIR")" || [[ "$ACTIVE_RELEASE_SHA" != "$RELEASE_SHA" ]]; then
  rollback "source SHA attestation failed"
fi

find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk "NR>$KEEP_BACKUPS" | while IFS= read -r stale_backup; do
  rm -rf "$stale_backup"
done

echo "Release activated successfully."
