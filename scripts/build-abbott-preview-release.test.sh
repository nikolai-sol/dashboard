#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SOURCE="$TMP_DIR/source"
TARGET="$TMP_DIR/release"
mkdir -p "$SOURCE/.next/standalone/.next" "$SOURCE/.next/static" "$SOURCE/public"
printf 'server' > "$SOURCE/.next/standalone/server.js"
printf 'static' > "$SOURCE/.next/static/a.js"
printf 'public' > "$SOURCE/public/a.txt"
printf 'secret' > "$SOURCE/.env.production"

DRY_RUN=1 APP_DIR="$SOURCE" RELEASE_DIR="$TARGET" APP_NAME='dashboard-abbott-preview-test' APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >"$TMP_DIR/output" 2>&1

[[ -f "$TARGET/server.js" ]] || { echo 'standalone server was not packaged' >&2; exit 1; }
[[ -f "$TARGET/.next/static/a.js" ]] || { echo 'static assets were not packaged' >&2; exit 1; }
[[ -f "$TARGET/public/a.txt" ]] || { echo 'public assets were not packaged' >&2; exit 1; }
[[ -f "$TARGET/manifest.sha256" ]] || { echo 'manifest missing' >&2; exit 1; }
[[ ! -e "$TARGET/.env.production" ]] || { echo 'production env was copied' >&2; exit 1; }
! grep -Eqi '(activate-release|install-reviewed-release|deploy\.sh|/var/www/dashboard|dashboard-next|3001)' "$TMP_DIR/output"

if DRY_RUN=1 APP_DIR=/var/www/dashboard RELEASE_DIR="$TMP_DIR/bad" APP_NAME='dashboard-abbott-preview-test' APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted production application directory' >&2
  exit 1
fi
if DRY_RUN=1 APP_DIR="$SOURCE" RELEASE_DIR="$TMP_DIR/bad" APP_NAME=dashboard-next APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted production PM2 name' >&2
  exit 1
fi

echo 'build abbott preview release tests passed'
