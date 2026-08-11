#!/bin/bash
set -euo pipefail
fail(){ printf '%s\n' "$1" >&2; exit 1; }
RUN_ID="${RUN_ID:?RUN_ID is required}"; APP_DIR="${APP_DIR:?APP_DIR is required}"; APP_PORT="${APP_PORT:?APP_PORT is required}"
[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || fail 'preview run id is invalid'
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT>1023 && APP_PORT<65536 && APP_PORT!=3001)) || fail 'preview port is invalid'
if [[ "${DRY_RUN:-0}" == 1 ]]; then ROOT="${TEST_PREVIEW_RELEASE_ROOT:?test release root is required}"; else ROOT=/srv/reportingdash/abbott-preview; fi
physical(){ cd -P -- "$1" && pwd -P; }
reject_symlink_ancestors(){ local p="$1"; while [[ "$p" != / ]]; do [[ ! -L "$p" ]] || fail 'preview path has symlink ancestor'; p="${p%/*}"; [[ -n "$p" ]] || p=/; done; }
reject_nonregular_tree(){
  local root="$1" path
  [[ -e "$root" && ! -L "$root" ]] || fail 'preview tree is incomplete'
  while IFS= read -r -d '' path; do
    if [[ -L "$path" || ( ! -f "$path" && ! -d "$path" ) ]]; then
      fail 'preview tree contains a symlink or nonregular object'
    fi
  done < <(find -P "$root" -print0)
}
reject_symlink_ancestors "$APP_DIR"
APP_DIR="$(physical "$APP_DIR")"
[[ "$APP_DIR" != /var/www/dashboard && "$APP_DIR" != /var/www/dashboard/* ]] || fail 'preview source is forbidden'
reject_symlink_ancestors "$ROOT"
mkdir -p "$ROOT"
reject_symlink_ancestors "$ROOT"
ROOT="$(physical "$ROOT")"
if [[ "${DRY_RUN:-0}" != 1 ]]; then [[ "$ROOT" == /srv/reportingdash/abbott-preview ]] || fail 'preview root is invalid'; fi
RELEASE_DIR="$ROOT/$RUN_ID"; [[ ! -e "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || fail 'preview release already exists'
if [[ "${DRY_RUN:-0}" != 1 ]]; then (cd "$APP_DIR"; npm ci; npm run ci:verify); fi
for p in "$APP_DIR/.next/standalone" "$APP_DIR/.next/static" "$APP_DIR/public"; do
  [[ -d "$p" && ! -L "$p" ]] || fail 'preview tree is incomplete'
done
[[ -f "$APP_DIR/.next/standalone/server.js" ]] || fail 'standalone output is incomplete'
mkdir "$RELEASE_DIR"
python3 "$APP_DIR/scripts/copy-preview-tree.py" "$APP_DIR/.next/standalone" "$RELEASE_DIR" .
python3 "$APP_DIR/scripts/copy-preview-tree.py" "$APP_DIR/.next/static" "$RELEASE_DIR" .next/static
python3 "$APP_DIR/scripts/copy-preview-tree.py" "$APP_DIR/public" "$RELEASE_DIR" public merge-identical
find -P "$RELEASE_DIR" -depth -type d -empty -delete
reject_nonregular_tree "$RELEASE_DIR"
(cd "$RELEASE_DIR"; find . -type f ! -name manifest.sha256 ! -name '.manifest.*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > .manifest.$$; mv .manifest.$$ manifest.sha256; sha256sum -c manifest.sha256 >/dev/null)
reject_nonregular_tree "$RELEASE_DIR"
chmod -R go-rwx "$RELEASE_DIR"; printf '%s\n' 'preview release packaged'
