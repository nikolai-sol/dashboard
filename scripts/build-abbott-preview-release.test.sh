#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d "$SCRIPT_DIR/.preview-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

SOURCE="$TMP_DIR/source"
TARGET_ROOT="$TMP_DIR/releases"
RUN_ID='20260810T220000Z-acde1234'
TARGET="$TARGET_ROOT/$RUN_ID"
mkdir -p "$SOURCE/.next/standalone/.next" "$SOURCE/.next/standalone/public" "$SOURCE/.next/static" "$SOURCE/public/empty"
mkdir -p "$SOURCE/scripts"
cp "$SCRIPT_DIR/copy-preview-tree.py" "$SOURCE/scripts/copy-preview-tree.py"
printf 'server' > "$SOURCE/.next/standalone/server.js"
printf 'static' > "$SOURCE/.next/static/a.js"
printf 'public' > "$SOURCE/public/a.txt"
printf 'globe' > "$SOURCE/.next/standalone/public/globe.svg"
printf 'globe' > "$SOURCE/public/globe.svg"
printf 'secret' > "$SOURCE/.env.production"
ln -s a.js "$SOURCE/.next/static/internal.js"

DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TARGET_ROOT" RUN_ID="$RUN_ID" APP_DIR="$SOURCE" APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >"$TMP_DIR/output" 2>&1

[[ -f "$TARGET/server.js" ]] || { echo 'standalone server was not packaged' >&2; exit 1; }
[[ -f "$TARGET/.next/static/a.js" ]] || { echo 'static assets were not packaged' >&2; exit 1; }
[[ -f "$TARGET/.next/static/internal.js" && ! -L "$TARGET/.next/static/internal.js" ]] || { echo 'internal symlink was not materialized' >&2; exit 1; }
[[ -f "$TARGET/public/a.txt" ]] || { echo 'public assets were not packaged' >&2; exit 1; }
[[ -f "$TARGET/manifest.sha256" ]] || { echo 'manifest missing' >&2; exit 1; }
[[ ! -d "$TARGET/public/empty" ]] || { echo 'empty source directory was not sealed out of release' >&2; exit 1; }
[[ ! -e "$TARGET/.env.production" ]] || { echo 'production env was copied' >&2; exit 1; }
! grep -Fq 'manifest.sha256' "$TARGET/manifest.sha256"
! grep -Fq '  ./' "$TARGET/manifest.sha256"
(cd "$TARGET" && sha256sum -c manifest.sha256 >/dev/null)
! grep -Eqi '(activate-release|install-reviewed-release|deploy\.sh|/var/www/dashboard|dashboard-next|3001)' "$TMP_DIR/output"

if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TARGET_ROOT" RUN_ID="$RUN_ID" APP_DIR='/var/www/dashboard/../dashboard/' APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted production application directory' >&2
  exit 1
fi
if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TARGET_ROOT" RUN_ID=unsafe APP_DIR="$SOURCE" APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted unsafe run id' >&2
  exit 1
fi

ROOT_LINK="$TMP_DIR/root-link"
ln -s "$TMP_DIR/missing-target" "$ROOT_LINK"
if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$ROOT_LINK/releases" RUN_ID="$RUN_ID" APP_DIR="$SOURCE" APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted a symlink ancestor before creating the release root' >&2
  exit 1
fi
if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TMP_DIR/outside" RUN_ID="$RUN_ID" APP_DIR="$SOURCE" APP_PORT=3001 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted production port' >&2
  exit 1
fi

ln -s /etc/passwd "$SOURCE/public/escaped.js"
if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TMP_DIR/symlink-releases" RUN_ID="$RUN_ID" APP_DIR="$SOURCE" APP_PORT=3301 \
  bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
  echo 'builder accepted an escaping source asset' >&2
  exit 1
fi

for kind in dangling chained cycle fifo hardlink; do
  CASE="$TMP_DIR/$kind"; cp -R "$SOURCE" "$CASE"; rm -f "$CASE/public/escaped.js"
  case "$kind" in
    dangling) ln -s missing "$CASE/public/bad" ;;
    chained) ln -s first "$CASE/public/bad"; ln -s a.txt "$CASE/public/first" ;;
    cycle) ln -s . "$CASE/public/bad" ;;
    fifo) mkfifo "$CASE/public/bad" ;;
    hardlink) ln "$CASE/public/a.txt" "$CASE/public/bad" ;;
  esac
  if DRY_RUN=1 TEST_PREVIEW_RELEASE_ROOT="$TMP_DIR/$kind-releases" RUN_ID="$RUN_ID" APP_DIR="$CASE" APP_PORT=3301 \
    bash "$SCRIPT_DIR/build-abbott-preview-release.sh" >/dev/null 2>&1; then
    echo "builder accepted $kind preview object" >&2; exit 1
  fi
done

echo 'build abbott preview release tests passed'
