#!/bin/bash
set -euo pipefail

if [[ "$#" -ne 9 ]]; then
  echo "Expected ACTION, APP_DIR, BACKUPS_DIR, TARGET_BACKUP, APP_NAME, APP_PORT, PUBLIC_APP_HOST, LOCK_OWNER_TOKEN, and ROLLBACK_ID positional arguments" >&2
  exit 1
fi

ACTION="$1"
APP_DIR="$2"
BACKUPS_DIR="$3"
TARGET_BACKUP="$4"
APP_NAME="$5"
APP_PORT="$6"
PUBLIC_APP_HOST="$7"
LOCK_OWNER_TOKEN="$8"
ROLLBACK_ID="$9"
FIXED_DEPLOY_LOCK_DIR="/var/www/.dashboard-next-deploy.lock"
COMPATIBILITY_MARKER=".shared-password-db-auth-v1"
SOURCE_SHA_FILE=".release-source-sha"
CURRENT_SNAPSHOT="$BACKUPS_DIR/${ROLLBACK_ID}-manual-rollback"
FAILED_DIR="$BACKUPS_DIR/${ROLLBACK_ID}-rollback-failed"
CURRENT_SOURCE_SHA=""
TARGET_SOURCE_SHA=""

fail() {
  echo "$1" >&2
  exit 1
}

validate_remote_path() {
  local label="$1"
  local value="$2"
  [[ -n "$value" && "${#value}" -le 512 && "$value" =~ ^/[A-Za-z0-9._/-]+$ && "$value" != / ]] \
    || fail "Invalid $label"
  case "/${value#/}/" in
    *//*|*/./*|*/../*) fail "Invalid $label" ;;
  esac
}

validate_remote_path APP_DIR "$APP_DIR"
validate_remote_path BACKUPS_DIR "$BACKUPS_DIR"
if [[ -n "$TARGET_BACKUP" ]]; then
  validate_remote_path TARGET_BACKUP "$TARGET_BACKUP"
  [[ "$(dirname -- "$TARGET_BACKUP")" == "$BACKUPS_DIR" ]] \
    || fail "TARGET_BACKUP must be one direct child of BACKUPS_DIR"
fi
[[ "$ACTION" == inspect-current || "$ACTION" == rollback ]] || fail "Invalid rollback action"
[[ -n "$APP_NAME" && "${#APP_NAME}" -le 64 && "$APP_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail "Invalid APP_NAME"
[[ "$APP_PORT" =~ ^[0-9]+$ && "$APP_PORT" -ge 1 && "$APP_PORT" -le 65535 ]] \
  || fail "Invalid APP_PORT"
[[ -z "$PUBLIC_APP_HOST" || ( "${#PUBLIC_APP_HOST}" -le 255 && \
   "$PUBLIC_APP_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ) ]] \
  || fail "Invalid PUBLIC_APP_HOST"
[[ -n "$ROLLBACK_ID" && "${#ROLLBACK_ID}" -le 128 && \
   "$ROLLBACK_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Invalid rollback ID"
[[ -n "$LOCK_OWNER_TOKEN" && "$LOCK_OWNER_TOKEN" != *$'\n'* && "$LOCK_OWNER_TOKEN" != *'='* ]] \
  || fail "Invalid rollback lock owner token"

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
  if [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ ]] || \
     ! cmp -s "$metadata_file" <(printf '%s\n' "$source_sha"); then
    return 1
  fi
  printf '%s\n' "$source_sha"
}

start_release() {
  local release_dir="$1"
  cd -P -- "$release_dir" &&
    pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --update-env
}

require_current_source_sha() {
  if [[ ! -d "$APP_DIR" || -L "$APP_DIR" ]] || ! CURRENT_SOURCE_SHA="$(read_release_sha "$APP_DIR")"; then
    fail "Active fixed release lacks trusted full-SHA metadata. Run scripts/bootstrap-release-source-metadata.sh with reviewed commit and build evidence before rollback."
  fi
}

validate_lock_owner() {
  local owner_file="$FIXED_DEPLOY_LOCK_DIR/owner"
  local recorded_owner recorded_id recorded_sha
  if [[ ! -d "$FIXED_DEPLOY_LOCK_DIR" || ! -f "$owner_file" || -L "$owner_file" ]]; then
    fail "Rollback requires ownership of the shared dashboard deployment lock."
  fi
  if [[ -n "$(find "$FIXED_DEPLOY_LOCK_DIR" -mindepth 1 -maxdepth 1 ! -name owner -print -quit)" ]]; then
    fail "Rollback found unknown shared dashboard deployment lock contents and stopped."
  fi
  recorded_owner="$(sed -n 's/^owner_token=//p' "$owner_file")"
  recorded_id="$(sed -n 's/^release_id=//p' "$owner_file")"
  recorded_sha="$(sed -n 's/^source_sha=//p' "$owner_file")"
  [[ "$recorded_owner" == "$LOCK_OWNER_TOKEN" && "$recorded_id" == "$ROLLBACK_ID" && \
     "$recorded_sha" == "$CURRENT_SOURCE_SHA" ]] \
    || fail "Rollback does not own the shared dashboard deployment lock for the attested active release."
}

require_current_source_sha
if [[ "$ACTION" == inspect-current ]]; then
  printf '%s\n' "$CURRENT_SOURCE_SHA"
  exit 0
fi
validate_lock_owner

if [[ ! -d "$BACKUPS_DIR" || -L "$BACKUPS_DIR" ]]; then
  fail "Backup directory does not exist or is unsafe: $BACKUPS_DIR"
fi

if [[ -z "$TARGET_BACKUP" ]]; then
  while IFS= read -r candidate; do
    if is_compatible_release "$candidate"; then
      TARGET_BACKUP="$candidate"
      break
    fi
  done < <(find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*-failed' | sort -r)
fi

if [[ -z "$TARGET_BACKUP" || ! -d "$TARGET_BACKUP" || -L "$TARGET_BACKUP" ]]; then
  fail "Compatible rollback target not found."
fi
validate_remote_path TARGET_BACKUP "$TARGET_BACKUP"
[[ "$(dirname -- "$TARGET_BACKUP")" == "$BACKUPS_DIR" ]] \
  || fail "Rollback target must be one direct child of the backup directory."
if ! is_compatible_release "$TARGET_BACKUP"; then
  fail "Rollback target is missing the shared-password compatibility marker."
fi
if ! TARGET_SOURCE_SHA="$(read_release_sha "$TARGET_BACKUP")"; then
  fail "Rollback target lacks trusted full-SHA metadata. Rebuild the legacy backup as a reviewed release with trusted full-SHA metadata; do not infer its commit from a directory name."
fi
if [[ -e "$CURRENT_SNAPSHOT" || -L "$CURRENT_SNAPSHOT" || -e "$FAILED_DIR" || -L "$FAILED_DIR" ]]; then
  fail "Rollback audit directories already exist for $ROLLBACK_ID; no release was moved."
fi

mv "$APP_DIR" "$CURRENT_SNAPSHOT"
mv "$TARGET_BACKUP" "$APP_DIR"

restore_current() {
  local reason="$1"
  local restored_sha=""

  echo "Rollback failed: $reason" >&2
  set +e

  if [[ -d "$APP_DIR" && ! -L "$APP_DIR" && ! -e "$FAILED_DIR" ]]; then
    mv "$APP_DIR" "$FAILED_DIR"
  fi

  if [[ -d "$CURRENT_SNAPSHOT" && ! -L "$CURRENT_SNAPSHOT" ]] && \
     is_compatible_release "$CURRENT_SNAPSHOT" && \
     restored_sha="$(read_release_sha "$CURRENT_SNAPSHOT")" && \
     [[ "$restored_sha" == "$CURRENT_SOURCE_SHA" ]]; then
    mv "$CURRENT_SNAPSHOT" "$APP_DIR"
    if start_release "$APP_DIR" && \
       [[ "$(read_release_sha "$APP_DIR" 2>/dev/null || true)" == "$CURRENT_SOURCE_SHA" ]]; then
      pm2 save || true
    else
      pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
      pm2 save || true
      echo "Attested current release reload failed; service left stopped fail-closed." >&2
    fi
  else
    pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
    pm2 save || true
    echo "No attested compatible current release; service left stopped fail-closed." >&2
  fi

  exit 1
}

start_release "$APP_DIR" || restore_current "pm2 startOrReload failed"
[[ "$(read_release_sha "$APP_DIR" 2>/dev/null || true)" == "$TARGET_SOURCE_SHA" ]] \
  || restore_current "target source SHA attestation failed"
pm2 save || restore_current "pm2 save failed"

health_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done

[[ "$health_ok" -eq 1 ]] || restore_current "health check failed"
PUBLIC_APP_HOST="$PUBLIC_APP_HOST" APP_PORT="$APP_PORT" \
  bash "$APP_DIR/scripts/verify-loopback-listener.sh" \
  || restore_current "listener isolation check failed"
[[ "$(read_release_sha "$APP_DIR" 2>/dev/null || true)" == "$TARGET_SOURCE_SHA" ]] \
  || restore_current "post-health source SHA attestation failed"

echo "Rolled back using $(basename -- "$TARGET_BACKUP") at source SHA $TARGET_SOURCE_SHA."
