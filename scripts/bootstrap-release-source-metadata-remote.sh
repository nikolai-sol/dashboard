#!/bin/bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Expected APP_DIR, FULL_SOURCE_SHA, and ACTIVE_BUILD_ID positional arguments" >&2
  exit 1
fi

APP_DIR="$1"
SOURCE_SHA="$2"
EXPECTED_BUILD_ID="$3"
FIXED_APP_DIR="/var/www/dashboard"
METADATA_FILE="$APP_DIR/.release-source-sha"
BUILD_ID_FILE="$APP_DIR/.next/BUILD_ID"
TEMP_FILE=""

fail() {
  echo "Release metadata bootstrap failed: $1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_FILE" && -e "$TEMP_FILE" ]]; then
    rm -f -- "$TEMP_FILE"
  fi
}
trap cleanup EXIT

[[ "$APP_DIR" == "$FIXED_APP_DIR" ]] || fail "only the fixed dashboard application path is accepted"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "source metadata must be one lowercase full Git SHA"
[[ -n "$EXPECTED_BUILD_ID" && "${#EXPECTED_BUILD_ID}" -le 256 && \
   "$EXPECTED_BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
  || fail "active build identity is invalid"
[[ -d "$APP_DIR" && ! -L "$APP_DIR" ]] || fail "fixed dashboard application directory is unavailable or unsafe"
[[ "$(cd -P -- "$APP_DIR" && pwd -P)" == "$FIXED_APP_DIR" ]] \
  || fail "fixed dashboard application directory resolves elsewhere"
[[ -f "$BUILD_ID_FILE" && ! -L "$BUILD_ID_FILE" ]] \
  || fail "active Next.js build identity is missing or unsafe"

ACTIVE_BUILD_ID="$(cat "$BUILD_ID_FILE")"
[[ -n "$ACTIVE_BUILD_ID" && "${#ACTIVE_BUILD_ID}" -le 256 && \
   "$ACTIVE_BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
  || fail "active Next.js build identity is malformed"
if [[ "$ACTIVE_BUILD_ID" != "$EXPECTED_BUILD_ID" ]]; then
  fail "active build identity does not match the independently captured value"
fi

if [[ -e "$METADATA_FILE" || -L "$METADATA_FILE" ]]; then
  if [[ -f "$METADATA_FILE" && ! -L "$METADATA_FILE" ]] && \
     [[ "$(cat "$METADATA_FILE")" == "$SOURCE_SHA" ]] && \
     cmp -s "$METADATA_FILE" <(printf '%s\n' "$SOURCE_SHA"); then
    echo "Release source metadata already matches: source_sha=$SOURCE_SHA build_id=$ACTIVE_BUILD_ID"
    exit 0
  fi
  fail "conflicting release source metadata already exists; it was preserved"
fi

umask 077
TEMP_FILE="$(mktemp "$APP_DIR/.release-source-sha.tmp.XXXXXX")"
printf '%s\n' "$SOURCE_SHA" > "$TEMP_FILE"
chmod 600 "$TEMP_FILE"
if [[ "$(cat "$TEMP_FILE")" != "$SOURCE_SHA" ]] || \
   ! cmp -s "$TEMP_FILE" <(printf '%s\n' "$SOURCE_SHA"); then
  fail "temporary source metadata did not read back exactly"
fi

# A same-directory hard link publishes the fully written inode without replacing an existing path.
if ! ln "$TEMP_FILE" "$METADATA_FILE" 2>/dev/null; then
  fail "release source metadata appeared concurrently; existing metadata was preserved"
fi
rm -f -- "$TEMP_FILE"
TEMP_FILE=""

if [[ ! -f "$METADATA_FILE" || -L "$METADATA_FILE" ]] || \
   [[ "$(cat "$METADATA_FILE")" != "$SOURCE_SHA" ]] || \
   ! cmp -s "$METADATA_FILE" <(printf '%s\n' "$SOURCE_SHA"); then
  fail "published source metadata did not read back exactly"
fi
chmod 600 "$METADATA_FILE"
echo "Release source metadata installed: source_sha=$SOURCE_SHA build_id=$ACTIVE_BUILD_ID"
