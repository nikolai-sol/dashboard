#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mkdir -p "$TMP_DIR/bin"
export PM2_LOG="$TMP_DIR/pm2.log"
: > "$PM2_LOG"

cat > "$TMP_DIR/bin/pm2" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$PM2_LOG"
case "${1:-}" in
  describe) exit "${PM2_DESCRIBE_EXIT:-0}" ;;
  restart) exit "${PM2_RESTART_EXIT:-0}" ;;
  start) exit "${PM2_START_EXIT:-0}" ;;
  save) exit "${PM2_SAVE_EXIT:-0}" ;;
  stop) exit "${PM2_STOP_EXIT:-0}" ;;
esac
exit 0
SH

cat > "$TMP_DIR/bin/curl" <<'SH'
#!/bin/bash
result="${PUBLIC_CURL_RESULT:-failure}"
if [[ " $* " == *" http://127.0.0.1:"* ]]; then
  result="${CURL_HEALTH_RESULT:-success}"
fi
if [[ "$result" == "success" ]]; then
  exit 0
fi
exit 22
SH

cat > "$TMP_DIR/bin/sleep" <<'SH'
#!/bin/bash
exit 0
SH

cat > "$TMP_DIR/bin/ss" <<'SH'
#!/bin/bash
printf '%s\n' 'LISTEN 0 511 127.0.0.1:3001 0.0.0.0:*'
SH

cat > "$TMP_DIR/bin/ssh" <<'SH'
#!/bin/bash
shift
exec bash -c "$1"
SH

chmod +x "$TMP_DIR/bin/pm2" "$TMP_DIR/bin/curl" "$TMP_DIR/bin/sleep" "$TMP_DIR/bin/ss" "$TMP_DIR/bin/ssh"
export PATH="$TMP_DIR/bin:$PATH"

write_release() {
  local target="$1"
  local label="$2"
  local compatibility="${3:-compatible}"
  mkdir -p "$target"
  printf '%s\n' "$label" > "$target/release-label"
  printf '%s\n' 'module.exports = { apps: [] };' > "$target/ecosystem.config.js"
  mkdir -p "$target/scripts"
  cp "$SCRIPT_DIR/verify-loopback-listener.sh" "$target/scripts/"
  if [[ "$compatibility" == "compatible" ]]; then
    printf '%s\n' 'shared-password-db-auth-v1' > "$target/.shared-password-db-auth-v1"
  fi
}

run_activation() {
  APP_DIR="$1" \
  BACKUPS_DIR="$2" \
  STAGE_DIR="$3" \
  APP_NAME="dashboard-next" \
  APP_PORT="3001" \
  KEEP_BACKUPS="5" \
  RELEASE_ID="$4" \
  bash "$SCRIPT_DIR/activate-release.sh"
}

AUTO_ROOT="$TMP_DIR/auto-incompatible"
write_release "$AUTO_ROOT/app" "base-0c9e046" incompatible
write_release "$AUTO_ROOT/stage" "new-release" compatible
export CURL_HEALTH_RESULT=failure
export PUBLIC_CURL_RESULT=failure
if run_activation "$AUTO_ROOT/app" "$AUTO_ROOT/backups" "$AUTO_ROOT/stage" "auto-unmarked" >"$AUTO_ROOT.log" 2>&1; then
  fail "automatic activation unexpectedly succeeded after failed health check"
fi
[[ ! -e "$AUTO_ROOT/app" ]] || fail "automatic rollback restored an incompatible release"
grep -Fqx 'base-0c9e046' "$AUTO_ROOT/backups/auto-unmarked-previous/release-label"
grep -Fqx 'new-release' "$AUTO_ROOT/backups/auto-unmarked-failed/release-label"
[[ "$(grep -c '^restart dashboard-next' "$PM2_LOG")" -eq 1 ]] || fail "automatic rollback restarted the incompatible predecessor"
grep -Fqx 'stop dashboard-next' "$PM2_LOG" || fail "automatic rollback did not stop PM2 fail-closed"

AUTO_COMPAT_ROOT="$TMP_DIR/auto-compatible"
: > "$PM2_LOG"
write_release "$AUTO_COMPAT_ROOT/app" "compatible-previous" compatible
write_release "$AUTO_COMPAT_ROOT/stage" "new-release" compatible
if run_activation "$AUTO_COMPAT_ROOT/app" "$AUTO_COMPAT_ROOT/backups" "$AUTO_COMPAT_ROOT/stage" "auto-compatible" >"$AUTO_COMPAT_ROOT.log" 2>&1; then
  fail "automatic activation unexpectedly succeeded after failed health check"
fi
grep -Fqx 'compatible-previous' "$AUTO_COMPAT_ROOT/app/release-label"
[[ -f "$AUTO_COMPAT_ROOT/app/.shared-password-db-auth-v1" ]] || fail "compatible predecessor marker was lost"
[[ "$(grep -c '^restart dashboard-next' "$PM2_LOG")" -eq 2 ]] || fail "compatible predecessor was not restarted"
if grep -Fqx 'stop dashboard-next' "$PM2_LOG"; then
  fail "compatible automatic rollback stopped the restored service"
fi

MANUAL_ROOT="$TMP_DIR/manual-incompatible"
: > "$PM2_LOG"
write_release "$MANUAL_ROOT/app" "current-compatible" compatible
write_release "$MANUAL_ROOT/backups/unmarked-target" "base-0c9e046" incompatible
export CURL_HEALTH_RESULT=success
if VPS=fake APP_DIR="$MANUAL_ROOT/app" BACKUPS_DIR="$MANUAL_ROOT/backups" \
  bash "$SCRIPT_DIR/rollback-release.sh" "$MANUAL_ROOT/backups/unmarked-target" >"$MANUAL_ROOT.log" 2>&1; then
  fail "manual rollback accepted an incompatible target"
fi
grep -Fqx 'current-compatible' "$MANUAL_ROOT/app/release-label"
grep -Fqx 'base-0c9e046' "$MANUAL_ROOT/backups/unmarked-target/release-label"
[[ ! -s "$PM2_LOG" ]] || fail "manual rollback touched PM2 before rejecting the incompatible target"

MANUAL_COMPAT_ROOT="$TMP_DIR/manual-compatible"
: > "$PM2_LOG"
write_release "$MANUAL_COMPAT_ROOT/app" "current-compatible" compatible
write_release "$MANUAL_COMPAT_ROOT/backups/compatible-target" "compatible-target" compatible
if ! VPS=fake APP_DIR="$MANUAL_COMPAT_ROOT/app" BACKUPS_DIR="$MANUAL_COMPAT_ROOT/backups" \
  bash "$SCRIPT_DIR/rollback-release.sh" "$MANUAL_COMPAT_ROOT/backups/compatible-target" >"$MANUAL_COMPAT_ROOT.log" 2>&1; then
  cat "$MANUAL_COMPAT_ROOT.log" >&2
  fail "manual compatible rollback failed"
fi
grep -Fqx 'compatible-target' "$MANUAL_COMPAT_ROOT/app/release-label"
find "$MANUAL_COMPAT_ROOT/backups" -mindepth 1 -maxdepth 1 -type d -name '*-manual-rollback' -exec grep -Fqx 'current-compatible' '{}/release-label' \; -print | grep -q .
grep -Fqx 'restart dashboard-next' "$PM2_LOG" || fail "manual compatible rollback did not restart PM2"

grep -Fq 'activate-release.sh' "$SCRIPT_DIR/deploy.sh" || fail "deploy.sh does not use the tested activation path"

echo "release rollback tests passed"
