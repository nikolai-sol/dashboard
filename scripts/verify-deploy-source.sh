#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BASE_BRANCH="${DEPLOY_BASE_BRANCH:-main}"
DEPLOY_BASE_REF="refs/remotes/$DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH"
DEPLOY_VPS="${DEPLOY_VPS:-${VPS:-beget}}"
DEPLOY_APP_DIR="${DEPLOY_APP_DIR:-${APP_DIR:-/var/www/dashboard}}"
DEPLOY_SSH_BIN="${DEPLOY_SSH_BIN:-ssh}"

fail() {
  echo "Refusing deploy: $1" >&2
  exit 1
}

read_active_release_identity() {
  if [[ -n "${DEPLOY_ACTIVE_RELEASE_READER:-}" ]]; then
    "$DEPLOY_ACTIVE_RELEASE_READER" "$DEPLOY_VPS" "$DEPLOY_APP_DIR"
    return
  fi

  local quoted_app_dir remote_command
  printf -v quoted_app_dir '%q' "$DEPLOY_APP_DIR"
  remote_command="bash -s -- $quoted_app_dir"
  "$DEPLOY_SSH_BIN" "$DEPLOY_VPS" "$remote_command" <<'REMOTE'
set -euo pipefail
DEPLOY_APP_DIR="$1"
metadata_file="$DEPLOY_APP_DIR/.release-source-sha"
if [[ -e "$metadata_file" || -L "$metadata_file" ]]; then
  if [[ ! -f "$metadata_file" || -L "$metadata_file" ]]; then
    echo "active release metadata is not a regular file: $metadata_file" >&2
    exit 1
  fi
  printf 'sha:%s\n' "$(cat "$metadata_file")"
elif [[ -d "$DEPLOY_APP_DIR" ]]; then
  printf 'path:%s\n' "$(cd -P -- "$DEPLOY_APP_DIR" && pwd -P)"
else
  echo "Active release directory not found: $DEPLOY_APP_DIR" >&2
  exit 1
fi
REMOTE
}

resolve_legacy_sha() {
  local active_path="$1"
  local release_name legacy_sha
  release_name="$(basename -- "$active_path")"
  if [[ ! "$release_name" =~ -([0-9a-fA-F]{7,39})$ ]]; then
    fail "legacy active release path '$active_path' does not end in a 7-39 character Git SHA"
  fi
  legacy_sha="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"

  local matches=()
  while IFS= read -r match; do
    [[ -n "$match" ]] && matches+=("$match")
  done < <(git -C "$APP_SOURCE_DIR" rev-parse --disambiguate="$legacy_sha")

  if [[ "${#matches[@]}" -eq 0 ]]; then
    fail "legacy release SHA '$legacy_sha' is not present in local Git"
  fi
  if [[ "${#matches[@]}" -ne 1 ]]; then
    fail "legacy release SHA '$legacy_sha' is ambiguous in local Git"
  fi
  if [[ "$(git -C "$APP_SOURCE_DIR" cat-file -t "${matches[0]}" 2>/dev/null || true)" != "commit" ]]; then
    fail "legacy release SHA '$legacy_sha' does not identify a commit object"
  fi
  git -C "$APP_SOURCE_DIR" rev-parse "${matches[0]}"
}

resolve_active_production_sha() {
  local identity
  if ! identity="$(read_active_release_identity)" || [[ -z "$identity" ]]; then
    fail "cannot determine active production commit"
  fi

  case "$identity" in
    sha:*)
      local sha="${identity#sha:}"
      sha="$(printf '%s' "$sha" | tr '[:upper:]' '[:lower:]')"
      if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
        fail "active release metadata does not contain one full Git SHA"
      fi
      if [[ "$(git -C "$APP_SOURCE_DIR" cat-file -t "$sha" 2>/dev/null || true)" != "commit" ]]; then
        fail "active production SHA $sha is not present as a commit object in local Git or does not identify a commit object"
      fi
      printf '%s\n' "$sha"
      ;;
    path:*)
      resolve_legacy_sha "${identity#path:}"
      ;;
    *)
      fail "cannot determine active production commit from reader output"
      ;;
  esac
}

if [[ -n "$(git -C "$APP_SOURCE_DIR" status --porcelain --untracked-files=normal)" ]]; then
  fail "working tree is not clean: $APP_SOURCE_DIR"
fi

echo "Refreshing $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH before deploy..."
git -C "$APP_SOURCE_DIR" fetch --quiet "$DEPLOY_REMOTE" "$DEPLOY_BASE_BRANCH"

if ! git -C "$APP_SOURCE_DIR" rev-parse --verify --quiet "$DEPLOY_BASE_REF^{commit}" >/dev/null; then
  fail "cannot resolve $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH after fetch"
fi

if ! git -C "$APP_SOURCE_DIR" merge-base --is-ancestor "$DEPLOY_BASE_REF" HEAD; then
  fail "HEAD does not contain current $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH. Merge the current main into the release, then run verification again."
fi

ACTIVE_PRODUCTION_SHA="$(resolve_active_production_sha)"
if ! git -C "$APP_SOURCE_DIR" merge-base --is-ancestor "$ACTIVE_PRODUCTION_SHA" HEAD; then
  fail "HEAD does not contain active production commit $ACTIVE_PRODUCTION_SHA. Merge the active production commit into the release, then run verification again."
fi

echo "Deploy source verified: HEAD contains current $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH and active production commit $ACTIVE_PRODUCTION_SHA; the working tree is clean."
