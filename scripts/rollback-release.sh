#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${SSH_BIN+x}" || -n "${DEPLOY_SSH_BIN+x}" || \
      -n "${DEPLOY_LOCK_DIR+x}" || -n "${DASHBOARD_DEPLOY_LOCK_DIR+x}" || \
      -n "${GIT_SSH+x}" || -n "${GIT_SSH_COMMAND+x}" || -n "${RSYNC_RSH+x}" ]]; then
  echo "Refusing rollback: mandatory rollback authority override variables are not accepted." >&2
  exit 1
fi

if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [/absolute/path/to/dashboard-backups/TARGET]" >&2
  exit 1
fi

VPS="${VPS:-beget}"
SSH_BIN="/usr/bin/ssh"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_NAME="${APP_NAME:-dashboard-next}"
APP_PORT="${APP_PORT:-3001}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-5.35.85.218}"
APP_PARENT_DIR="$(dirname -- "$APP_DIR")"
APP_BASENAME="$(basename -- "$APP_DIR")"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"
TARGET_BACKUP="${1:-}"
DEPLOY_LOCK_DIR="/var/www/.dashboard-next-deploy.lock"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
ROLLBACK_ID="rollback-${TIMESTAMP}-$$-${RANDOM}"
LOCK_OWNER_TOKEN="${ROLLBACK_ID}-${RANDOM}"
LOCK_RELEASE_REQUIRED=0
ROLLBACK_SUCCEEDED=0
LOCK_HELPER_SNAPSHOT=""

fail_validation() {
  echo "Refusing rollback: $1" >&2
  exit 1
}

validate_remote_path() {
  local label="$1"
  local value="$2"
  [[ -n "$value" && "${#value}" -le 512 && "$value" =~ ^/[A-Za-z0-9._/-]+$ && "$value" != / ]] \
    || fail_validation "Invalid $label"
  case "/${value#/}/" in
    *//*|*/./*|*/../*) fail_validation "Invalid $label" ;;
  esac
}

validate_remote_path APP_DIR "$APP_DIR"
validate_remote_path BACKUPS_DIR "$BACKUPS_DIR"
if [[ -n "$TARGET_BACKUP" ]]; then
  validate_remote_path TARGET_BACKUP "$TARGET_BACKUP"
  [[ "$(dirname -- "$TARGET_BACKUP")" == "$BACKUPS_DIR" ]] \
    || fail_validation "TARGET_BACKUP must be one direct child of BACKUPS_DIR"
fi
[[ -n "$VPS" && "${#VPS}" -le 255 && "$VPS" =~ ^[A-Za-z0-9][A-Za-z0-9._@:-]*$ ]] \
  || fail_validation "Invalid VPS"
[[ -n "$APP_NAME" && "${#APP_NAME}" -le 64 && "$APP_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail_validation "Invalid APP_NAME"
[[ "$APP_PORT" =~ ^[0-9]+$ && "$APP_PORT" -ge 1 && "$APP_PORT" -le 65535 ]] \
  || fail_validation "Invalid APP_PORT"
[[ -z "$PUBLIC_APP_HOST" || ( "${#PUBLIC_APP_HOST}" -le 255 && \
   "$PUBLIC_APP_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ) ]] \
  || fail_validation "Invalid PUBLIC_APP_HOST"

build_remote_bash_command() {
  local command="bash -s --"
  local argument escaped
  for argument in "$@"; do
    printf -v escaped '%q' "$argument"
    command="$command $escaped"
  done
  printf '%s\n' "$command"
}

run_lock_command() {
  local action="$1"
  local source_sha="${2:-}"
  local remote_command
  if [[ "$action" == acquire ]]; then
    remote_command="$(build_remote_bash_command --lock-dir "$DEPLOY_LOCK_DIR" acquire \
      "$LOCK_OWNER_TOKEN" "$ROLLBACK_ID" "$source_sha")"
  else
    remote_command="$(build_remote_bash_command --lock-dir "$DEPLOY_LOCK_DIR" release "$LOCK_OWNER_TOKEN")"
  fi
  "$SSH_BIN" "$VPS" "$remote_command" < "$LOCK_HELPER_SNAPSHOT"
}

run_remote_rollback() {
  local action="$1"
  local remote_command
  remote_command="$(build_remote_bash_command "$action" "$APP_DIR" "$BACKUPS_DIR" \
    "$TARGET_BACKUP" "$APP_NAME" "$APP_PORT" "$PUBLIC_APP_HOST" "$LOCK_OWNER_TOKEN" "$ROLLBACK_ID")"
  "$SSH_BIN" "$VPS" "$remote_command" < "$SCRIPT_DIR/rollback-release-remote.sh"
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$LOCK_RELEASE_REQUIRED" -eq 1 ]]; then
    if ! run_lock_command release; then
      echo "Rollback could not release the shared dashboard lock; inspect owner metadata before recovery." >&2
      [[ "$status" -ne 0 ]] || status=1
    fi
  fi
  if [[ -n "$LOCK_HELPER_SNAPSHOT" ]]; then
    rm -f -- "$LOCK_HELPER_SNAPSHOT"
  fi
  if [[ "$status" -eq 0 && "$ROLLBACK_SUCCEEDED" -eq 1 ]]; then
    echo "Rollback complete."
  fi
  exit "$status"
}
trap cleanup EXIT

if [[ ! -f "$SCRIPT_DIR/dashboard-deploy-lock.sh" || -L "$SCRIPT_DIR/dashboard-deploy-lock.sh" ]]; then
  fail_validation "shared dashboard lock helper is missing or unsafe"
fi
umask 077
# Keep cleanup authority outside APP_DIR even if a packaged invocation inherits
# a TMPDIR located inside the release that the remote operation will swap.
LOCK_HELPER_SNAPSHOT="$(mktemp "/tmp/dashboard-deploy-lock.XXXXXX")"
cp -- "$SCRIPT_DIR/dashboard-deploy-lock.sh" "$LOCK_HELPER_SNAPSHOT"
chmod 600 "$LOCK_HELPER_SNAPSHOT"

CURRENT_SOURCE_SHA="$(run_remote_rollback inspect-current)"
[[ "$CURRENT_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail_validation "active release inspection did not return one trusted full SHA"

LOCK_RELEASE_REQUIRED=1
run_lock_command acquire "$CURRENT_SOURCE_SHA"
run_remote_rollback rollback
ROLLBACK_SUCCEEDED=1
