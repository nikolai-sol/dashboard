#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="$(cd -P -- "$SCRIPT_DIR/.." && pwd)"

if [[ -n "${SSH_BIN+x}" || -n "${DEPLOY_SSH_BIN+x}" || \
      -n "${DEPLOY_ACTIVE_RELEASE_READER+x}" || -n "${DEPLOY_LOCK_DIR+x}" || \
      -n "${DASHBOARD_DEPLOY_LOCK_DIR+x}" || -n "${GIT_SSH+x}" || \
      -n "${GIT_SSH_COMMAND+x}" || -n "${RSYNC_RSH+x}" ]]; then
  echo "Refusing metadata bootstrap: authority override variables are not accepted." >&2
  exit 1
fi

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 FULL_SOURCE_SHA ACTIVE_BUILD_ID" >&2
  exit 1
fi

SOURCE_SHA="$1"
EXPECTED_BUILD_ID="$2"
VPS="${VPS:-beget}"
SSH_BIN="/usr/bin/ssh"
APP_DIR="/var/www/dashboard"
DEPLOY_LOCK_DIR="/var/www/.dashboard-next-deploy.lock"
LOCK_OWNER_TOKEN="metadata-bootstrap-$(date -u +%Y%m%d%H%M%S)-$$-${RANDOM}"
LOCK_RELEASE_REQUIRED=0

fail() {
  echo "Refusing metadata bootstrap: $1" >&2
  exit 1
}

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] \
  || fail "supply exactly one lowercase full commit SHA"
[[ -n "$EXPECTED_BUILD_ID" && "${#EXPECTED_BUILD_ID}" -le 256 && \
   "$EXPECTED_BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
  || fail "active build ID must be one 1-256 character build identity"
[[ -n "$VPS" && "${#VPS}" -le 255 && "$VPS" =~ ^[A-Za-z0-9][A-Za-z0-9._@:-]*$ ]] \
  || fail "invalid VPS"

if [[ "$(git -C "$APP_SOURCE_DIR" cat-file -t "$SOURCE_SHA" 2>/dev/null || true)" != commit ]]; then
  fail "supplied SHA does not directly identify a local commit object"
fi
CANDIDATE_SHA="$(git -C "$APP_SOURCE_DIR" rev-parse HEAD)"
if ! git -C "$APP_SOURCE_DIR" merge-base --is-ancestor "$SOURCE_SHA" "$CANDIDATE_SHA"; then
  fail "supplied commit $SOURCE_SHA is not an ancestor of candidate HEAD $CANDIDATE_SHA"
fi

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
  local remote_command
  if [[ "$action" == acquire ]]; then
    remote_command="$(build_remote_bash_command --lock-dir "$DEPLOY_LOCK_DIR" acquire \
      "$LOCK_OWNER_TOKEN" metadata-bootstrap "$SOURCE_SHA")"
  else
    remote_command="$(build_remote_bash_command --lock-dir "$DEPLOY_LOCK_DIR" release "$LOCK_OWNER_TOKEN")"
  fi
  "$SSH_BIN" "$VPS" "$remote_command" < "$SCRIPT_DIR/dashboard-deploy-lock.sh"
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$LOCK_RELEASE_REQUIRED" -eq 1 ]]; then
    if ! run_lock_command release; then
      echo "Metadata bootstrap could not release the shared dashboard lock; inspect owner metadata before recovery." >&2
      [[ "$status" -ne 0 ]] || status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

LOCK_RELEASE_REQUIRED=1
run_lock_command acquire

CURRENT_CANDIDATE_SHA="$(git -C "$APP_SOURCE_DIR" rev-parse HEAD)"
if [[ "$CURRENT_CANDIDATE_SHA" != "$CANDIDATE_SHA" ]] || \
   ! git -C "$APP_SOURCE_DIR" merge-base --is-ancestor "$SOURCE_SHA" "$CURRENT_CANDIDATE_SHA"; then
  fail "candidate HEAD changed before metadata publication; no metadata was written"
fi

REMOTE_COMMAND="$(build_remote_bash_command "$APP_DIR" "$SOURCE_SHA" "$EXPECTED_BUILD_ID")"
"$SSH_BIN" "$VPS" "$REMOTE_COMMAND" < "$SCRIPT_DIR/bootstrap-release-source-metadata-remote.sh"
