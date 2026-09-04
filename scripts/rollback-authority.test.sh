#!/bin/bash
set -euo pipefail

SOURCE_SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
TMP_DIR="$(cd -P -- "$TMP_DIR" && pwd -P)"
FIXTURE_DIR="$TMP_DIR/fixture"
FAKE_BIN="$TMP_DIR/bin"
LOCK_DIR="$TMP_DIR/dashboard-next-deploy.lock"
SSH_LOG="$TMP_DIR/ssh.log"
EVENT_LOG="$TMP_DIR/events.log"
PM2_LOG="$TMP_DIR/pm2.log"
export SSH_LOG EVENT_LOG PM2_LOG

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mkdir -p "$FIXTURE_DIR" "$FAKE_BIN"
cp "$SOURCE_SCRIPT_DIR/rollback-release.sh" "$FIXTURE_DIR/"
cp "$SOURCE_SCRIPT_DIR/rollback-release-remote.sh" "$FIXTURE_DIR/"
cp "$SOURCE_SCRIPT_DIR/dashboard-deploy-lock.sh" "$FIXTURE_DIR/"

# Production transport and lock authority remain literal; only these temporary copies are rewritten.
sed -i.bak "s|SSH_BIN=\"/usr/bin/ssh\"|SSH_BIN=\"$FAKE_BIN/ssh\"|" "$FIXTURE_DIR/rollback-release.sh"
sed -i.bak "s|DEPLOY_LOCK_DIR=\"/var/www/.dashboard-next-deploy.lock\"|DEPLOY_LOCK_DIR=\"$LOCK_DIR\"|" \
  "$FIXTURE_DIR/rollback-release.sh"
sed -i.bak "s|FIXED_DEPLOY_LOCK_DIR=\"/var/www/.dashboard-next-deploy.lock\"|FIXED_DEPLOY_LOCK_DIR=\"$LOCK_DIR\"|" \
  "$FIXTURE_DIR/rollback-release-remote.sh"
rm -f "$FIXTURE_DIR/"*.bak
grep -Fq "SSH_BIN=\"$FAKE_BIN/ssh\"" "$FIXTURE_DIR/rollback-release.sh" \
  || fail "rollback test fixture could not replace pinned production SSH"
grep -Fq "DEPLOY_LOCK_DIR=\"$LOCK_DIR\"" "$FIXTURE_DIR/rollback-release.sh" \
  || fail "rollback test fixture could not replace fixed production lock"

cat > "$FAKE_BIN/ssh" <<'SH'
#!/bin/bash
host="$1"
remote_command="$2"
script_file="$(TMPDIR=/tmp mktemp)"
cat > "$script_file"
printf '%s|%s\n' "$host" "$remote_command" >> "$SSH_LOG"
eval "set -- $remote_command"
remote_args=()
after_separator=0
for argument in "$@"; do
  if [[ "$after_separator" -eq 1 ]]; then
    remote_args+=("$argument")
  elif [[ "$argument" == -- ]]; then
    after_separator=1
  fi
done

event=remote
if grep -Fq 'acquire_lock()' "$script_file"; then
  for argument in "${remote_args[@]}"; do
    if [[ "$argument" == acquire || "$argument" == release ]]; then
      event="$argument"
      break
    fi
  done
elif [[ "${remote_args[0]:-}" == inspect-current ]]; then
  event=inspect-current
elif [[ "${remote_args[0]:-}" == rollback ]]; then
  event=rollback
fi
printf '%s\n' "$event" >> "$EVENT_LOG"

set +e
bash "$script_file" "${remote_args[@]}"
status=$?
set -e
if [[ "$event" == acquire && "${AMBIGUOUS_ROLLBACK_ACQUIRE:-0}" == 1 && "$status" -eq 0 ]]; then
  rm -f "$script_file"
  exit 255
fi
rm -f "$script_file"
exit "$status"
SH

cat > "$FAKE_BIN/pm2" <<'SH'
#!/bin/bash
label=unknown
[[ -f release-label ]] && label="$(cat release-label)"
printf '%s|%s\n' "$label" "$*" >> "$PM2_LOG"
exit 0
SH
cat > "$FAKE_BIN/curl" <<'SH'
#!/bin/bash
exit 0
SH
cat > "$FAKE_BIN/sleep" <<'SH'
#!/bin/bash
exit 0
SH
chmod +x "$FAKE_BIN/ssh" "$FAKE_BIN/pm2" "$FAKE_BIN/curl" "$FAKE_BIN/sleep"
export PATH="$FAKE_BIN:$PATH"

write_release() {
  local target="$1"
  local label="$2"
  local source_sha="$3"
  mkdir -p "$target/scripts"
  printf '%s\n' "$label" > "$target/release-label"
  printf '%s\n' 'shared-password-db-auth-v1' > "$target/.shared-password-db-auth-v1"
  printf '%s\n' "$source_sha" > "$target/.release-source-sha"
  printf '%s\n' 'module.exports = {};' > "$target/ecosystem.config.js"
  cat > "$target/scripts/verify-loopback-listener.sh" <<'SH'
#!/bin/bash
exit 0
SH
}

run_rollback() {
  local app_dir="$1"
  local backups_dir="$2"
  shift 2
  VPS=fake APP_DIR="$app_dir" BACKUPS_DIR="$backups_dir" \
    bash "$FIXTURE_DIR/rollback-release.sh" "$@"
}

SUCCESS_ROOT="$TMP_DIR/success"
write_release "$SUCCESS_ROOT/app" current aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
write_release "$SUCCESS_ROOT/backups/target" target bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
: > "$SSH_LOG"
: > "$EVENT_LOG"
run_rollback "$SUCCESS_ROOT/app" "$SUCCESS_ROOT/backups" "$SUCCESS_ROOT/backups/target" \
  > "$SUCCESS_ROOT.log" 2>&1
grep -Fqx target "$SUCCESS_ROOT/app/release-label" || fail "locked rollback did not activate its target"
[[ ! -e "$LOCK_DIR" ]] || fail "successful rollback did not release the shared deployment lock"
cat > "$TMP_DIR/expected-events" <<'EOF'
inspect-current
acquire
rollback
release
EOF
cmp -s "$TMP_DIR/expected-events" "$EVENT_LOG" || {
  cat "$EVENT_LOG" >&2
  fail "rollback did not inspect, acquire, mutate, and release in the required order"
}
grep -Fq "$LOCK_DIR" "$SSH_LOG" || fail "rollback did not use the same fixed dashboard lock"

PACKAGED_ROOT="$TMP_DIR/packaged-success"
write_release "$PACKAGED_ROOT/app" packaged-current a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1
write_release "$PACKAGED_ROOT/backups/target" packaged-target b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2
cp "$FIXTURE_DIR/rollback-release.sh" "$PACKAGED_ROOT/app/scripts/"
cp "$FIXTURE_DIR/rollback-release-remote.sh" "$PACKAGED_ROOT/app/scripts/"
cp "$FIXTURE_DIR/dashboard-deploy-lock.sh" "$PACKAGED_ROOT/app/scripts/"
mkdir -p "$PACKAGED_ROOT/app/inherited-tmp"
if ! TMPDIR="$PACKAGED_ROOT/app/inherited-tmp" \
  VPS=fake APP_DIR="$PACKAGED_ROOT/app" BACKUPS_DIR="$PACKAGED_ROOT/backups" \
  bash "$PACKAGED_ROOT/app/scripts/rollback-release.sh" "$PACKAGED_ROOT/backups/target" \
  > "$PACKAGED_ROOT.log" 2>&1; then
  cat "$PACKAGED_ROOT.log" >&2
  fail "packaged rollback could not release its lock after the active directory swap"
fi
grep -Fqx packaged-target "$PACKAGED_ROOT/app/release-label" \
  || fail "packaged rollback did not activate its attested target"
[[ ! -e "$LOCK_DIR" ]] \
  || fail "packaged rollback left the shared lock after its source directory was moved"

BLOCKED_ROOT="$TMP_DIR/deploy-vs-rollback"
write_release "$BLOCKED_ROOT/app" blocked-current cccccccccccccccccccccccccccccccccccccccc
write_release "$BLOCKED_ROOT/backups/target" blocked-target dddddddddddddddddddddddddddddddddddddddd
DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" bash "$SOURCE_SCRIPT_DIR/dashboard-deploy-lock.sh" \
  acquire deploy-owner deploy-release eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee >/dev/null
if run_rollback "$BLOCKED_ROOT/app" "$BLOCKED_ROOT/backups" "$BLOCKED_ROOT/backups/target" \
  > "$BLOCKED_ROOT.log" 2>&1; then
  fail "rollback ran concurrently with a held deployment lock"
fi
grep -Fqx blocked-current "$BLOCKED_ROOT/app/release-label" || fail "blocked rollback changed the active app"
grep -Fqx 'owner_token=deploy-owner' "$LOCK_DIR/owner" || fail "blocked rollback changed deploy lock ownership"
DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" bash "$SOURCE_SCRIPT_DIR/dashboard-deploy-lock.sh" release deploy-owner >/dev/null

AMBIGUOUS_ROOT="$TMP_DIR/ambiguous"
write_release "$AMBIGUOUS_ROOT/app" ambiguous-current 1111111111111111111111111111111111111111
write_release "$AMBIGUOUS_ROOT/backups/target" ambiguous-target 2222222222222222222222222222222222222222
if AMBIGUOUS_ROLLBACK_ACQUIRE=1 run_rollback "$AMBIGUOUS_ROOT/app" "$AMBIGUOUS_ROOT/backups" \
  "$AMBIGUOUS_ROOT/backups/target" > "$AMBIGUOUS_ROOT.log" 2>&1; then
  fail "ambiguous rollback acquisition unexpectedly succeeded"
fi
[[ ! -e "$LOCK_DIR" ]] || fail "ambiguous rollback acquisition left this attempt's lock behind"
grep -Fqx ambiguous-current "$AMBIGUOUS_ROOT/app/release-label" \
  || fail "ambiguous acquisition reached rollback mutation"

UNKNOWN_ROOT="$TMP_DIR/unknown"
write_release "$UNKNOWN_ROOT/app" unknown-current 3333333333333333333333333333333333333333
write_release "$UNKNOWN_ROOT/backups/target" unknown-target 4444444444444444444444444444444444444444
mkdir -p "$LOCK_DIR"
printf '%s\n' 'preserve unknown state' > "$LOCK_DIR/unknown"
if run_rollback "$UNKNOWN_ROOT/app" "$UNKNOWN_ROOT/backups" "$UNKNOWN_ROOT/backups/target" \
  > "$UNKNOWN_ROOT.log" 2>&1; then
  fail "rollback replaced an unknown deployment lock"
fi
[[ -f "$LOCK_DIR/unknown" ]] || fail "rollback removed unknown deployment lock contents"
grep -Fqx unknown-current "$UNKNOWN_ROOT/app/release-label" || fail "unknown-lock rollback changed the app"
rm -rf "$LOCK_DIR"

LEGACY_ROOT="$TMP_DIR/metadata-less"
write_release "$LEGACY_ROOT/app" legacy-current 5555555555555555555555555555555555555555
write_release "$LEGACY_ROOT/backups/target" legacy-target 6666666666666666666666666666666666666666
rm "$LEGACY_ROOT/backups/target/.release-source-sha"
if run_rollback "$LEGACY_ROOT/app" "$LEGACY_ROOT/backups" "$LEGACY_ROOT/backups/target" \
  > "$LEGACY_ROOT.log" 2>&1; then
  fail "rollback activated a metadata-less legacy backup"
fi
grep -Fq 'Rebuild the legacy backup as a reviewed release with trusted full-SHA metadata' "$LEGACY_ROOT.log" \
  || fail "metadata-less rollback failure omitted recovery guidance"
grep -Fqx legacy-current "$LEGACY_ROOT/app/release-label" || fail "metadata-less rollback changed the app"
[[ ! -e "$LOCK_DIR" ]] || fail "metadata-less rollback did not release its lock"

: > "$SSH_LOG"
if run_rollback "$LEGACY_ROOT/app bad" "$LEGACY_ROOT/backups" "$LEGACY_ROOT/backups/target" \
  > "$TMP_DIR/unsafe-app.log" 2>&1; then
  fail "rollback accepted an unsafe app path"
fi
[[ ! -s "$SSH_LOG" ]] || fail "unsafe app path reached SSH before rejection"

: > "$SSH_LOG"
if run_rollback "$LEGACY_ROOT/app" "$LEGACY_ROOT/backups" "$TMP_DIR/outside-target" \
  > "$TMP_DIR/outside-target.log" 2>&1; then
  fail "rollback accepted a target outside the backup authority"
fi
[[ ! -s "$SSH_LOG" ]] || fail "outside target reached SSH before rejection"

DIRECT_ROOT="$TMP_DIR/direct-remote"
write_release "$DIRECT_ROOT/app" direct-current 7777777777777777777777777777777777777777
write_release "$DIRECT_ROOT/backups/target" direct-target 8888888888888888888888888888888888888888
if bash "$FIXTURE_DIR/rollback-release-remote.sh" rollback "$DIRECT_ROOT/app" \
  "$DIRECT_ROOT/backups" "$DIRECT_ROOT/backups/target" dashboard-next 3001 '' missing-owner \
  direct-rollback \
  > "$DIRECT_ROOT.log" 2>&1; then
  fail "remote rollback entrypoint mutated without shared-lock ownership"
fi
grep -Fq 'shared dashboard deployment lock' "$DIRECT_ROOT.log" \
  || fail "direct remote rollback lock-authority failure was unclear"
grep -Fqx direct-current "$DIRECT_ROOT/app/release-label" || fail "direct remote call changed the app"

echo "rollback authority tests passed"
