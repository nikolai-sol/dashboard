#!/bin/bash
# Package only Next's standalone output into a derived Abbott preview release.
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 1; }

APP_DIR="${APP_DIR:?APP_DIR is required}"
RELEASE_DIR="${RELEASE_DIR:?RELEASE_DIR is required}"
APP_NAME="${APP_NAME:?APP_NAME is required}"
APP_PORT="${APP_PORT:?APP_PORT is required}"

[[ "$APP_DIR" != "/var/www/dashboard" ]] || fail "preview source is forbidden"
[[ "$APP_NAME" != "dashboard-next" ]] || fail "production process is forbidden"
[[ "$APP_PORT" != "3001" ]] || fail "production port is forbidden"
[[ "$APP_NAME" == dashboard-abbott-preview-* ]] || fail "derived preview process is required"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && (( APP_PORT > 1023 && APP_PORT < 65536 )) || fail "preview port is invalid"
[[ -d "$APP_DIR" && ! -L "$APP_DIR" ]] || fail "preview source is invalid"
[[ ! -e "$RELEASE_DIR" ]] || fail "preview release already exists"

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  (
    cd "$APP_DIR"
    npm ci
    npm run security:public-assets
    npm run ci:verify
    npm run build
  )
fi

for required in "$APP_DIR/.next/standalone/server.js" "$APP_DIR/.next/static" "$APP_DIR/public"; do
  [[ -e "$required" && ! -L "$required" ]] || fail "standalone output is incomplete"
done

mkdir -p "$RELEASE_DIR/.next"
cp -a "$APP_DIR/.next/standalone/." "$RELEASE_DIR/"
cp -a "$APP_DIR/.next/static" "$RELEASE_DIR/.next/static"
cp -a "$APP_DIR/public" "$RELEASE_DIR/public"
find "$RELEASE_DIR" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > "$RELEASE_DIR/manifest.sha256"
chmod -R go-rwx "$RELEASE_DIR"
printf '%s\n' "preview release packaged"
