#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT_DIR="$(cd "$APP_SOURCE_DIR/.." && pwd)"
CANONICAL_SOURCE_DIRS=("$REPO_ROOT_DIR")
if [[ "$APP_SOURCE_DIR" == *"/dashboard-next/.worktrees/"* ]]; then
  WORKSPACE_ROOT_DIR="${APP_SOURCE_DIR%%/dashboard-next/.worktrees/*}"
  APP_WORKTREE_NAME="$(basename "$APP_SOURCE_DIR")"
  CANONICAL_SOURCE_DIRS+=("$WORKSPACE_ROOT_DIR/.worktrees/$APP_WORKTREE_NAME" "$WORKSPACE_ROOT_DIR")
fi

VPS="${VPS:-beget}"
SSH_BIN="${SSH_BIN:-ssh}"
APP_DIR="${APP_DIR:-/var/www/dashboard}"
APP_NAME="${APP_NAME:-dashboard-next}"
APP_PORT="${APP_PORT:-3001}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-5.35.85.218}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
GIT_REVISION_SHORT="$(git -C "$APP_SOURCE_DIR" rev-parse --short HEAD 2>/dev/null || echo local)"
RELEASE_ID="${RELEASE_ID:-${TIMESTAMP}-${GIT_REVISION_SHORT}}"
APP_PARENT_DIR="$(dirname "$APP_DIR")"
APP_BASENAME="$(basename "$APP_DIR")"
RELEASES_DIR="${RELEASES_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-releases}"
BACKUPS_DIR="${BACKUPS_DIR:-$APP_PARENT_DIR/${APP_BASENAME}-backups}"
DEPLOY_LOCK_DIR="${DEPLOY_LOCK_DIR:-$APP_PARENT_DIR/.${APP_NAME}-deploy.lock}"
REMOTE_STAGE_DIR="$RELEASES_DIR/$RELEASE_ID"
TMP_ENV="$(mktemp)"
LOCK_OWNER_TOKEN="${TIMESTAMP}-$$-${RANDOM}"
LOCK_HELD=0
DEPLOY_SUCCEEDED=0

run_lock_command() {
  local action="$1"
  local remote_command
  if [[ "$action" == "acquire" ]]; then
    printf -v remote_command 'DASHBOARD_DEPLOY_LOCK_DIR=%q bash -s -- acquire %q %q %q' \
      "$DEPLOY_LOCK_DIR" "$LOCK_OWNER_TOKEN" "$RELEASE_ID" "$BUILD_SOURCE_SHA"
  else
    printf -v remote_command 'DASHBOARD_DEPLOY_LOCK_DIR=%q bash -s -- release %q' \
      "$DEPLOY_LOCK_DIR" "$LOCK_OWNER_TOKEN"
  fi
  "$SSH_BIN" "$VPS" "$remote_command" < "$SCRIPT_DIR/dashboard-deploy-lock.sh"
}

acquire_deploy_lock() {
  echo "Acquiring dashboard-next activation lock..."
  run_lock_command acquire
  LOCK_HELD=1
}

release_deploy_lock() {
  if run_lock_command release; then
    LOCK_HELD=0
    return 0
  fi
  return 1
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  rm -f "$TMP_ENV"
  if [[ "$LOCK_HELD" -eq 1 ]]; then
    if ! release_deploy_lock; then
      echo "Failed to release deployment lock $DEPLOY_LOCK_DIR; inspect owner metadata before manual recovery." >&2
      if [[ "$status" -eq 0 ]]; then
        status=1
      fi
    fi
  fi
  if [[ "$status" -eq 0 && "$DEPLOY_SUCCEEDED" -eq 1 ]]; then
    echo "Deploy complete. Active source SHA: $BUILD_SOURCE_SHA"
  fi
  exit "$status"
}
trap cleanup EXIT

verify_deploy_source_under_lock() {
  echo "Rechecking origin/main and active production under the deployment lock..."
  DEPLOY_VPS="$VPS" DEPLOY_APP_DIR="$APP_DIR" DEPLOY_SSH_BIN="$SSH_BIN" \
    bash scripts/verify-deploy-source.sh "$APP_SOURCE_DIR"
  local checked_sha
  checked_sha="$(git -C "$APP_SOURCE_DIR" rev-parse HEAD)"
  if [[ "$checked_sha" != "$BUILD_SOURCE_SHA" ]]; then
    echo "Refusing deploy: source HEAD changed after the verified build ($BUILD_SOURCE_SHA -> $checked_sha)." >&2
    exit 1
  fi
}

attest_active_release() {
  local quoted_app_dir remote_command active_sha
  printf -v quoted_app_dir '%q' "$APP_DIR"
  remote_command="APP_DIR=$quoted_app_dir bash -s"
  active_sha="$("$SSH_BIN" "$VPS" "$remote_command" <<'REMOTE'
set -euo pipefail
metadata_file="$APP_DIR/.release-source-sha"
[[ -f "$metadata_file" && ! -L "$metadata_file" ]]
cat "$metadata_file"
REMOTE
)"
  if [[ "$active_sha" != "$BUILD_SOURCE_SHA" ]]; then
    echo "Active release source SHA attestation failed: expected $BUILD_SOURCE_SHA, got ${active_sha:-missing}." >&2
    return 1
  fi
  echo "Active release source SHA attested: $active_sha"
}

copy_canonical_file() {
  local file_name="$1"
  local source_dir
  for source_dir in "${CANONICAL_SOURCE_DIRS[@]}"; do
    if [ -f "$source_dir/$file_name" ]; then
      cp "$source_dir/$file_name" "$PACKAGE_DIR/"
      return 0
    fi
  done
  echo "Required canonical runtime file is missing: $file_name" >&2
  return 1
}

cd "$APP_SOURCE_DIR"

DEPLOY_VPS="$VPS" DEPLOY_APP_DIR="$APP_DIR" DEPLOY_SSH_BIN="$SSH_BIN" \
  bash scripts/verify-deploy-source.sh "$APP_SOURCE_DIR"
BUILD_SOURCE_SHA="$(git -C "$APP_SOURCE_DIR" rev-parse HEAD)"

echo "Building standalone bundle for release $RELEASE_ID..."
npm ci
npm test
npm run test:abbott-contract
npm run typecheck
npm run lint
npm run security:public-assets
npm run build

STANDALONE_DIR=".next/standalone"
PACKAGE_DIR="$STANDALONE_DIR"
if [ ! -f "$PACKAGE_DIR/server.js" ]; then
  SERVER_CANDIDATES=()
  while IFS= read -r candidate; do
    SERVER_CANDIDATES+=("$candidate")
  done < <(find "$STANDALONE_DIR" -type d -name node_modules -prune -o -type f -name server.js -print)
  if [ "${#SERVER_CANDIDATES[@]}" -ne 1 ]; then
    echo "Unable to identify standalone server.js in $STANDALONE_DIR" >&2
    printf '%s\n' "${SERVER_CANDIDATES[@]}" >&2
    exit 1
  fi
  PACKAGE_DIR="$(dirname "${SERVER_CANDIDATES[0]}")"
fi
echo "Using standalone package root $PACKAGE_DIR..."
bash scripts/normalize-standalone-runtime-links.sh "$PACKAGE_DIR"

echo "Rendering production env from VPS secrets..."
bash scripts/render-production-env.sh "$TMP_ENV"

echo "Packaging build artifacts..."
rm -rf "$PACKAGE_DIR/.next/static" "$PACKAGE_DIR/public" "$PACKAGE_DIR/src" "$PACKAGE_DIR/ecosystem.config.js" "$PACKAGE_DIR/package.json" "$PACKAGE_DIR/.env" "$PACKAGE_DIR/scripts" "$PACKAGE_DIR/ABBOTT-UNRESOLVED-PAGE-DIRECTIONS.csv" "$PACKAGE_DIR/ABBOTT-UNRESOLVED-PAGE-DIRECTIONS-SUMMARY.json"
mkdir -p "$PACKAGE_DIR/.next" "$PACKAGE_DIR/src/schemas" "$PACKAGE_DIR/src/db" "$PACKAGE_DIR/scripts"
cp -R .next/static "$PACKAGE_DIR/.next/static"
if [ -d public ]; then
  cp -R public "$PACKAGE_DIR/public"
fi
cp "$TMP_ENV" "$PACKAGE_DIR/.env"
cp .shared-password-db-auth-v1 "$PACKAGE_DIR/"
cp ecosystem.config.js "$PACKAGE_DIR/"
cp package.json "$PACKAGE_DIR/"
cp scripts/rollback-release.sh "$PACKAGE_DIR/scripts/"
cp scripts/rollback-release-remote.sh "$PACKAGE_DIR/scripts/"
cp scripts/verify-loopback-listener.sh "$PACKAGE_DIR/scripts/"
cp scripts/collect-yandex-webmaster.js "$PACKAGE_DIR/scripts/"
cp scripts/collect-yandex-webmaster-canonical.sh "$PACKAGE_DIR/scripts/"
cp src/schemas/*.yaml "$PACKAGE_DIR/src/schemas/"
cp -R src/db/migrations "$PACKAGE_DIR/src/db/migrations"
node scripts/build-zaruku-alice-importer.mjs \
  --outfile "$PACKAGE_DIR/scripts/import-zaruku-alice-visibility.cjs" \
  --package-json "$PACKAGE_DIR/package.json"
for runtime_package in mysql2 aws-ssl-profiles denque generate-function is-property iconv-lite safer-buffer long lru.min named-placeholders sql-escaper; do
  if [ -d "node_modules/$runtime_package" ]; then
    mkdir -p "$PACKAGE_DIR/node_modules/$(dirname "$runtime_package")"
    cp -R "node_modules/$runtime_package" "$PACKAGE_DIR/node_modules/$runtime_package"
  fi
done
copy_canonical_file fetch_google_ads_canonical.py
copy_canonical_file google_ads_api_client.py
copy_canonical_file canonical_writer.py
copy_canonical_file fetch_yandex_metrika_canonical.py
copy_canonical_file metrika_logs_api.py
copy_canonical_file metrika_dashboard_breakdowns.py
copy_canonical_file fetch_yandex_webmaster_canonical.py
copy_canonical_file fetch_gsc_canonical.py
copy_canonical_file fetch_yandex_direct_canonical_api.py
copy_canonical_file yandex_direct_shared.py
copy_canonical_file wordstat_api.py
copy_canonical_file probe_yandex_wordstat_access.py
copy_canonical_file fetch_yandex_wordstat_canonical.py

acquire_deploy_lock
verify_deploy_source_under_lock
printf '%s\n' "$BUILD_SOURCE_SHA" > "$PACKAGE_DIR/.release-source-sha"

npm run security:public-assets -- --release "$PACKAGE_DIR"
bash scripts/validate-production-release.sh "$PACKAGE_DIR" "$PACKAGE_DIR/.env"

echo "Uploading staged release to VPS..."
"$SSH_BIN" "$VPS" "mkdir -p '$RELEASES_DIR' '$BACKUPS_DIR' /var/log"
rsync -avz --delete "$PACKAGE_DIR/" "$VPS:$REMOTE_STAGE_DIR/"

echo "Activating staged release with automatic rollback on failure..."
"$SSH_BIN" "$VPS" "APP_DIR='$APP_DIR' BACKUPS_DIR='$BACKUPS_DIR' STAGE_DIR='$REMOTE_STAGE_DIR' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' PUBLIC_APP_HOST='$PUBLIC_APP_HOST' KEEP_BACKUPS='$KEEP_BACKUPS' RELEASE_ID='$RELEASE_ID' RELEASE_SHA='$BUILD_SOURCE_SHA' bash -s" \
  < "$SCRIPT_DIR/activate-release.sh"

attest_active_release
DEPLOY_SUCCEEDED=1
