#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

atomic_activate() {
  local release_path="$1"
  local active_link="$2"
  local temp_link
  temp_link="$(dirname "$active_link")/.$(basename "$release_path").active.$$"
  ln -s "$release_path" "$temp_link"
  python3 - "$temp_link" "$active_link" <<'PY'
import os
import sys
os.replace(sys.argv[1], sys.argv[2])
PY
}

if [[ "${1:-}" == "--activate-existing" ]]; then
  RELEASES_DIR="${2:?release directory is required}"
  ACTIVE_LINK="${3:?active symlink is required}"
  REVISION="${4:?reviewed revision is required}"
  if [[ ! "$REVISION" =~ ^[0-9a-f]{7,64}$ ]]; then
    echo "Reviewed revision is invalid" >&2
    exit 1
  fi
  FINAL_RELEASE="$RELEASES_DIR/$REVISION"
  FINAL_MANIFEST="$RELEASES_DIR/$REVISION.sha256"
  if [[ ! -d "$FINAL_RELEASE" || ! -f "$FINAL_MANIFEST" ]]; then
    echo "Existing reviewed release is incomplete" >&2
    exit 1
  fi
  if [[ -e "$ACTIVE_LINK" && ! -L "$ACTIVE_LINK" ]]; then
    echo "Active dashboard path must be an atomic symlink" >&2
    exit 1
  fi
  cd "$APP_SOURCE_DIR"
  node --import tsx scripts/assert-no-private-public-assets.ts --release "$FINAL_RELEASE"
  (cd "$FINAL_RELEASE" && sha256sum -c "$FINAL_MANIFEST" >/dev/null)
  atomic_activate "$FINAL_RELEASE" "$ACTIVE_LINK"
  exit 0
fi

SOURCE_TREE="${1:?source standalone tree is required}"
RELEASES_DIR="${2:?release directory is required}"
ACTIVE_LINK="${3:?active symlink is required}"
REVISION="${4:?reviewed revision is required}"

if [[ ! "$REVISION" =~ ^[0-9a-f]{7,64}$ ]]; then
  echo "Reviewed revision is invalid" >&2
  exit 1
fi
if [[ -L "$SOURCE_TREE" || ! -f "$SOURCE_TREE/server.js" || ! -d "$SOURCE_TREE/.next/static" || ! -d "$SOURCE_TREE/public" ]]; then
  echo "Reviewed standalone/static/public tree is incomplete" >&2
  exit 1
fi
if [[ -e "$ACTIVE_LINK" && ! -L "$ACTIVE_LINK" ]]; then
  echo "Active dashboard path must be an atomic symlink" >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR"
FINAL_RELEASE="$RELEASES_DIR/$REVISION"
FINAL_MANIFEST="$RELEASES_DIR/$REVISION.sha256"
if [[ -e "$FINAL_RELEASE" || -e "$FINAL_MANIFEST" ]]; then
  echo "Reviewed release already exists" >&2
  exit 1
fi

cd "$APP_SOURCE_DIR"
node --import tsx scripts/assert-no-private-public-assets.ts --release "$SOURCE_TREE"

STAGING="$(mktemp -d "$RELEASES_DIR/.${REVISION}.staging.XXXXXX")"
STAGING_MANIFEST="$(mktemp "$RELEASES_DIR/.${REVISION}.manifest.XXXXXX")"
cleanup() {
  rm -rf "$STAGING"
  rm -f "$STAGING_MANIFEST"
}
trap cleanup EXIT

cp -aL "$SOURCE_TREE/." "$STAGING/"
node --import tsx scripts/assert-no-private-public-assets.ts --release "$STAGING"

python3 - "$STAGING" "$STAGING_MANIFEST" <<'PY'
from pathlib import Path
import hashlib
import sys

root, manifest = map(Path, sys.argv[1:])
files = sorted(path for path in root.rglob("*") if path.is_file())
if not files:
    raise SystemExit("Reviewed release tree is empty")
with manifest.open("w", encoding="utf-8") as handle:
    for path in files:
        relative = path.relative_to(root).as_posix()
        handle.write(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}\n")
PY
chmod 600 "$STAGING_MANIFEST"
(cd "$STAGING" && sha256sum -c "$STAGING_MANIFEST" >/dev/null)

mv "$STAGING" "$FINAL_RELEASE"
node --import tsx scripts/assert-no-private-public-assets.ts --release "$FINAL_RELEASE"
(cd "$FINAL_RELEASE" && sha256sum -c "$STAGING_MANIFEST" >/dev/null)
mv "$STAGING_MANIFEST" "$FINAL_MANIFEST"

atomic_activate "$FINAL_RELEASE" "$ACTIVE_LINK"

trap - EXIT
