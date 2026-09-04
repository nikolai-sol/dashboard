#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

RELEASE_DIR="$TMP_DIR/release"
mkdir -p \
  "$RELEASE_DIR/.next/node_modules" \
  "$RELEASE_DIR/node_modules/rimraf" \
  "$RELEASE_DIR/node_modules/puppeteer"
printf '{}\n' > "$RELEASE_DIR/node_modules/rimraf/package.json"
printf '{}\n' > "$RELEASE_DIR/node_modules/puppeteer/package.json"
ln -s '../../../../.worktrees/export/node_modules/rimraf' \
  "$RELEASE_DIR/.next/node_modules/rimraf-deadbeef"
ln -s '../../../../.worktrees/export/node_modules/puppeteer' \
  "$RELEASE_DIR/.next/node_modules/puppeteer-deadbeef"

bash "$SCRIPT_DIR/normalize-standalone-runtime-links.sh" "$RELEASE_DIR"

test "$(readlink "$RELEASE_DIR/.next/node_modules/rimraf-deadbeef")" = '../../node_modules/rimraf'
test "$(readlink "$RELEASE_DIR/.next/node_modules/puppeteer-deadbeef")" = '../../node_modules/puppeteer'
test -f "$RELEASE_DIR/.next/node_modules/rimraf-deadbeef/package.json"
test -f "$RELEASE_DIR/.next/node_modules/puppeteer-deadbeef/package.json"

BROKEN_RELEASE_DIR="$TMP_DIR/broken-release"
mkdir -p "$BROKEN_RELEASE_DIR/.next/node_modules"
ln -s '../../../../.worktrees/export/node_modules/rimraf' \
  "$BROKEN_RELEASE_DIR/.next/node_modules/rimraf-cafebabe"

if bash "$SCRIPT_DIR/normalize-standalone-runtime-links.sh" "$BROKEN_RELEASE_DIR" \
  >"$TMP_DIR/broken.log" 2>&1; then
  echo "normalizer accepted a missing runtime package" >&2
  exit 1
fi
grep -Fqi 'missing standalone runtime package: rimraf' "$TMP_DIR/broken.log"

echo "normalize-standalone-runtime-links tests passed"
