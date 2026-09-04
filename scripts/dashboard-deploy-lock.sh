#!/bin/bash
set -euo pipefail

DASHBOARD_DEPLOY_LOCK_DIR="${DASHBOARD_DEPLOY_LOCK_DIR:-/var/www/.dashboard-next-deploy.lock}"
OWNER_FILE="$DASHBOARD_DEPLOY_LOCK_DIR/owner"

fail() {
  echo "$1" >&2
  exit 1
}

validate_token() {
  local label="$1"
  local value="$2"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *'='* ]] \
    || fail "Invalid $label"
}

acquire_lock() {
  local owner_token="$1"
  local release_id="$2"
  local source_sha="$3"
  validate_token "owner token" "$owner_token"
  validate_token "release ID" "$release_id"
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid full source SHA"

  umask 077
  if ! mkdir "$DASHBOARD_DEPLOY_LOCK_DIR" 2>/dev/null; then
    echo "Deployment lock is already held at $DASHBOARD_DEPLOY_LOCK_DIR." >&2
    if [[ -f "$OWNER_FILE" && ! -L "$OWNER_FILE" ]]; then
      sed -n '1,5p' "$OWNER_FILE" >&2
    else
      echo "Owner metadata is missing or unrecognized; inspect the lock manually and remove it only after confirming no dashboard deployment is active." >&2
    fi
    return 1
  fi

  if ! (
    umask 077
    printf 'owner_token=%s\nrelease_id=%s\nsource_sha=%s\ncreated_utc=%s\n' \
      "$owner_token" "$release_id" "$source_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OWNER_FILE"
  ); then
    rmdir "$DASHBOARD_DEPLOY_LOCK_DIR" 2>/dev/null || true
    fail "Unable to write deployment lock owner metadata"
  fi

  echo "Dashboard deployment lock acquired: $DASHBOARD_DEPLOY_LOCK_DIR"
}

release_lock() {
  local owner_token="$1"
  validate_token "owner token" "$owner_token"

  if [[ ! -d "$DASHBOARD_DEPLOY_LOCK_DIR" ]]; then
    echo "Deployment lock is already absent: $DASHBOARD_DEPLOY_LOCK_DIR"
    return 0
  fi
  if [[ ! -f "$OWNER_FILE" || -L "$OWNER_FILE" ]]; then
    fail "Refusing to remove deployment lock with missing or unrecognized owner metadata: $DASHBOARD_DEPLOY_LOCK_DIR"
  fi

  local recorded_owner
  recorded_owner="$(sed -n 's/^owner_token=//p' "$OWNER_FILE")"
  if [[ -z "$recorded_owner" || "$recorded_owner" != "$owner_token" ]]; then
    fail "Refusing to release deployment lock owned by another process: $DASHBOARD_DEPLOY_LOCK_DIR"
  fi

  if [[ -n "$(find "$DASHBOARD_DEPLOY_LOCK_DIR" -mindepth 1 -maxdepth 1 ! -name owner -print -quit)" ]]; then
    fail "Deployment lock contains unknown files and was preserved: $DASHBOARD_DEPLOY_LOCK_DIR"
  fi

  rm "$OWNER_FILE"
  if ! rmdir "$DASHBOARD_DEPLOY_LOCK_DIR"; then
    fail "Deployment lock contains unknown files and was preserved: $DASHBOARD_DEPLOY_LOCK_DIR"
  fi
  echo "Dashboard deployment lock released: $DASHBOARD_DEPLOY_LOCK_DIR"
}

ACTION="${1:-}"
case "$ACTION" in
  acquire)
    [[ "$#" -eq 4 ]] || fail "Usage: $0 acquire OWNER_TOKEN RELEASE_ID FULL_SOURCE_SHA"
    acquire_lock "$2" "$3" "$4"
    ;;
  release)
    [[ "$#" -eq 2 ]] || fail "Usage: $0 release OWNER_TOKEN"
    release_lock "$2"
    ;;
  *)
    fail "Usage: $0 {acquire OWNER_TOKEN RELEASE_ID FULL_SOURCE_SHA|release OWNER_TOKEN}"
    ;;
esac
