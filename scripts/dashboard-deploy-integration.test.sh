#!/bin/bash
set -euo pipefail

SOURCE_SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
FIXTURE_ROOT="$TMP_DIR/workspace"
FIXTURE_APP="$FIXTURE_ROOT/dashboard-next"
REMOTE_ROOT="$TMP_DIR/remote"
FAKE_BIN="$TMP_DIR/bin"
SSH_LOG="$TMP_DIR/ssh.log"
EVENT_LOG="$TMP_DIR/events.log"
READ_COUNT_FILE="$TMP_DIR/read-count"
SIMULATED_LOCK_DIR="$TMP_DIR/simulated-dashboard-next-lock"
export SSH_LOG EVENT_LOG READ_COUNT_FILE SIMULATED_LOCK_DIR

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mkdir -p "$FIXTURE_APP/scripts" "$FIXTURE_APP/src/schemas" "$FIXTURE_APP/src/db/migrations" "$FAKE_BIN"
cp "$SOURCE_SCRIPT_DIR/deploy.sh" "$FIXTURE_APP/scripts/"
cp "$SOURCE_SCRIPT_DIR/verify-deploy-source.sh" "$FIXTURE_APP/scripts/"
cp "$SOURCE_SCRIPT_DIR/dashboard-deploy-lock.sh" "$FIXTURE_APP/scripts/"
cp "$SOURCE_SCRIPT_DIR/activate-release.sh" "$FIXTURE_APP/scripts/"
for script_name in rollback-release.sh rollback-release-remote.sh verify-loopback-listener.sh \
  collect-yandex-webmaster.js collect-yandex-webmaster-canonical.sh; do
  printf '%s\n' '#!/bin/bash' 'exit 0' > "$FIXTURE_APP/scripts/$script_name"
done
cat > "$FIXTURE_APP/scripts/normalize-standalone-runtime-links.sh" <<'SH'
#!/bin/bash
exit 0
SH
cat > "$FIXTURE_APP/scripts/render-production-env.sh" <<'SH'
#!/bin/bash
printf '%s\n' 'SAFE_ENV=value' > "$1"
SH
cat > "$FIXTURE_APP/scripts/validate-production-release.sh" <<'SH'
#!/bin/bash
exit 0
SH
printf '%s\n' 'schema fixture' > "$FIXTURE_APP/src/schemas/test.yaml"
printf '%s\n' 'migration fixture' > "$FIXTURE_APP/src/db/migrations/001.sql"
printf '%s\n' 'shared-password-db-auth-v1' > "$FIXTURE_APP/.shared-password-db-auth-v1"
printf '%s\n' 'module.exports = {};' > "$FIXTURE_APP/ecosystem.config.js"
printf '%s\n' '{"scripts":{}}' > "$FIXTURE_APP/package.json"
printf '%s\n' '.next/' > "$FIXTURE_APP/.gitignore"
printf '%s\n' 'base' > "$FIXTURE_APP/app.txt"

for runtime_file in fetch_google_ads_canonical.py google_ads_api_client.py canonical_writer.py \
  fetch_yandex_metrika_canonical.py metrika_logs_api.py metrika_dashboard_breakdowns.py \
  fetch_yandex_webmaster_canonical.py fetch_gsc_canonical.py fetch_yandex_direct_canonical_api.py \
  yandex_direct_shared.py wordstat_api.py probe_yandex_wordstat_access.py \
  fetch_yandex_wordstat_canonical.py; do
  printf '%s\n' '# fixture' > "$FIXTURE_ROOT/$runtime_file"
done

git init --quiet "$FIXTURE_APP"
git -C "$FIXTURE_APP" config user.email test@example.com
git -C "$FIXTURE_APP" config user.name "Deploy Integration Test"
git -C "$FIXTURE_APP" add .
git -C "$FIXTURE_APP" commit --quiet -m base
git -C "$FIXTURE_APP" branch -M main
git init --bare --quiet "$TMP_DIR/remote.git"
git -C "$FIXTURE_APP" remote add origin "$TMP_DIR/remote.git"
git -C "$FIXTURE_APP" push --quiet -u origin main
BASE_SHA="$(git -C "$FIXTURE_APP" rev-parse HEAD)"
printf '%s\n' 'candidate' >> "$FIXTURE_APP/app.txt"
git -C "$FIXTURE_APP" commit --quiet -am candidate
CANDIDATE_SHA="$(git -C "$FIXTURE_APP" rev-parse HEAD)"
export ACTIVE_SHA_INITIAL="$BASE_SHA" ACTIVE_SHA_AFTER_LOCK="$CANDIDATE_SHA"

cat > "$FAKE_BIN/npm" <<'SH'
#!/bin/bash
printf 'npm:%s\n' "$*" >> "$EVENT_LOG"
if [[ "$*" == "run build" ]]; then
  mkdir -p .next/standalone .next/static
  printf '%s\n' 'server fixture' > .next/standalone/server.js
fi
if [[ "$*" == *"security:public-assets"* && "$*" == *"--release"* && "${FAIL_PACKAGE_SECURITY:-0}" == "1" ]]; then
  exit 91
fi
exit 0
SH

cat > "$FAKE_BIN/node" <<'SH'
#!/bin/bash
outfile=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--outfile" ]]; then
    outfile="$2"
    break
  fi
  shift
done
if [[ -n "$outfile" ]]; then
  mkdir -p "$(dirname "$outfile")"
  printf '%s\n' 'importer fixture' > "$outfile"
fi
exit 0
SH

cat > "$FAKE_BIN/rsync" <<'SH'
#!/bin/bash
source_dir="$3"
remote_target="${4#*:}"
mkdir -p "$remote_target"
cp -R "$source_dir"/. "$remote_target"/
printf 'rsync:%s\n' "$remote_target" >> "$EVENT_LOG"
SH

cat > "$FAKE_BIN/ssh" <<'SH'
#!/bin/bash
host="$1"
remote_command="$2"
script_file="$(mktemp)"
cat > "$script_file"
printf '%s|%s\n' "$host" "$remote_command" >> "$SSH_LOG"

eval "set -- $remote_command"
remote_args=()
after_separator=0
for argument in "$@"; do
  if [[ "$after_separator" -eq 1 ]]; then
    remote_args+=("$argument")
  elif [[ "$argument" == "--" ]]; then
    after_separator=1
  fi
done

if grep -Fq "printf 'sha:%s" "$script_file"; then
  read_count=0
  [[ -f "$READ_COUNT_FILE" ]] && read_count="$(cat "$READ_COUNT_FILE")"
  read_count=$((read_count + 1))
  printf '%s\n' "$read_count" > "$READ_COUNT_FILE"
  if [[ -d "$SIMULATED_LOCK_DIR" ]]; then
    printf 'read-after-lock\n' >> "$EVENT_LOG"
    printf 'sha:%s\n' "$ACTIVE_SHA_AFTER_LOCK"
  else
    printf 'read-before-lock\n' >> "$EVENT_LOG"
    printf 'sha:%s\n' "$ACTIVE_SHA_INITIAL"
  fi
  rm -f "$script_file"
  exit 0
fi

if grep -Fq 'acquire_lock()' "$script_file"; then
  action=""
  owner_token=""
  for ((index = 0; index < ${#remote_args[@]}; index += 1)); do
    if [[ "${remote_args[$index]}" == "acquire" || "${remote_args[$index]}" == "release" ]]; then
      action="${remote_args[$index]}"
      owner_token="${remote_args[$((index + 1))]}"
      break
    fi
  done
  if [[ "$action" == "acquire" ]]; then
    mkdir -p "$SIMULATED_LOCK_DIR"
    printf 'owner_token=%s\n' "$owner_token" > "$SIMULATED_LOCK_DIR/owner"
    printf 'acquire:%s\n' "$owner_token" >> "$EVENT_LOG"
    rm -f "$script_file"
    if [[ "${AMBIGUOUS_ACQUIRE:-0}" == "1" ]]; then
      exit 255
    fi
    exit 0
  fi
  if [[ "$action" == "release" ]]; then
    printf 'release:%s\n' "$owner_token" >> "$EVENT_LOG"
    if [[ -f "$SIMULATED_LOCK_DIR/owner" ]] && \
      grep -Fqx "owner_token=$owner_token" "$SIMULATED_LOCK_DIR/owner"; then
      rm -rf "$SIMULATED_LOCK_DIR"
      rm -f "$script_file"
      exit 0
    fi
    rm -f "$script_file"
    exit 1
  fi
fi

if grep -Fq 'rollback()' "$script_file"; then
  app_dir="${remote_args[0]}"
  stage_dir="${remote_args[2]}"
  rm -rf "$app_dir"
  mkdir -p "$(dirname "$app_dir")"
  mv "$stage_dir" "$app_dir"
  printf 'activate\n' >> "$EVENT_LOG"
  rm -f "$script_file"
  exit 0
fi

if grep -Fq 'metadata_file="$APP_DIR/.release-source-sha"' "$script_file"; then
  cat "${remote_args[0]}/.release-source-sha"
  printf 'attest\n' >> "$EVENT_LOG"
  rm -f "$script_file"
  exit 0
fi

printf 'prepare\n' >> "$EVENT_LOG"
rm -f "$script_file"
exit 0
SH

chmod +x "$FAKE_BIN/npm" "$FAKE_BIN/node" "$FAKE_BIN/rsync" "$FAKE_BIN/ssh"

run_deploy() {
  PATH="$FAKE_BIN:$PATH" \
    VPS=fake \
    SSH_BIN="$FAKE_BIN/ssh" \
    APP_DIR="$REMOTE_ROOT/app" \
    RELEASES_DIR="$REMOTE_ROOT/releases" \
    BACKUPS_DIR="$REMOTE_ROOT/backups" \
    RELEASE_ID="$1" \
    FAIL_PACKAGE_SECURITY="${FAIL_PACKAGE_SECURITY:-0}" \
    AMBIGUOUS_ACQUIRE="${AMBIGUOUS_ACQUIRE:-0}" \
    bash "$FIXTURE_APP/scripts/deploy.sh"
}

: > "$SSH_LOG"
: > "$EVENT_LOG"
if ! run_deploy 20260904010101-integration > "$TMP_DIR/success.log" 2>&1; then
  cat "$TMP_DIR/success.log" >&2
  fail "baseline simulated deploy failed"
fi
[[ "$(cat "$READ_COUNT_FILE")" -eq 2 ]] || fail "deploy did not re-read production after lock acquisition"
grep -nE 'acquire:|read-after-lock' "$EVENT_LOG" > "$TMP_DIR/order.log"
[[ "$(sed -n '1p' "$TMP_DIR/order.log")" == *'acquire:'* ]] \
  || fail "production was re-read before lock acquisition"
[[ "$(sed -n '2p' "$TMP_DIR/order.log")" == *'read-after-lock'* ]] \
  || fail "production was not re-read while the lock was held"
grep -Fq '/var/www/.dashboard-next-deploy.lock' "$SSH_LOG" \
  || fail "production deploy did not use the fixed dashboard-next lock path"
[[ ! -e "$SIMULATED_LOCK_DIR" ]] || fail "successful deploy did not release its lock"
grep -Fqx "$CANDIDATE_SHA" "$REMOTE_ROOT/app/.release-source-sha" \
  || fail "successful deploy did not activate the rechecked candidate SHA"

rm -f "$READ_COUNT_FILE"
: > "$EVENT_LOG"
export FAIL_PACKAGE_SECURITY=1
if run_deploy 20260904010102-command-failure > "$TMP_DIR/command-failure.log" 2>&1; then
  fail "injected post-lock command failure did not stop deploy"
fi
unset FAIL_PACKAGE_SECURITY
[[ ! -e "$SIMULATED_LOCK_DIR" ]] || fail "EXIT cleanup did not release lock after command failure"
grep -Fq 'release:' "$EVENT_LOG" || fail "command failure did not trigger token-aware release"

rm -f "$READ_COUNT_FILE"
: > "$EVENT_LOG"
export AMBIGUOUS_ACQUIRE=1
if run_deploy 20260904010103-ambiguous-acquire > "$TMP_DIR/ambiguous-acquire.log" 2>&1; then
  fail "ambiguous SSH acquisition unexpectedly succeeded"
fi
unset AMBIGUOUS_ACQUIRE
[[ ! -e "$SIMULATED_LOCK_DIR" ]] || fail "ambiguous acquisition cleanup left this attempt's lock behind"
grep -Fq 'release:' "$EVENT_LOG" || fail "ambiguous acquisition did not attempt token-aware cleanup"

assert_rejected_before_ssh() {
  local label="$1"
  shift
  : > "$SSH_LOG"
  if env PATH="$FAKE_BIN:$PATH" VPS=fake SSH_BIN="$FAKE_BIN/ssh" \
    APP_DIR="$REMOTE_ROOT/app" RELEASES_DIR="$REMOTE_ROOT/releases" \
    BACKUPS_DIR="$REMOTE_ROOT/backups" RELEASE_ID=20260904010104-validation \
    "$@" bash "$FIXTURE_APP/scripts/deploy.sh" > "$TMP_DIR/$label.log" 2>&1; then
    fail "$label was accepted"
  fi
  [[ ! -s "$SSH_LOG" ]] || fail "$label reached SSH before rejection"
}

assert_rejected_before_ssh authority-overrides \
  DEPLOY_REMOTE=evil DEPLOY_BASE_BRANCH=evil DEPLOY_ACTIVE_RELEASE_READER="$TMP_DIR/evil-reader" \
  DEPLOY_LOCK_DIR="$TMP_DIR/evil-lock" DASHBOARD_DEPLOY_LOCK_DIR="$TMP_DIR/evil-helper-lock"
grep -Fq 'mandatory deploy authority override' "$TMP_DIR/authority-overrides.log" \
  || fail "authority override rejection was unclear"

assert_rejected_before_ssh malicious-release-id RELEASE_ID='../escape'
grep -Fq 'Invalid RELEASE_ID' "$TMP_DIR/malicious-release-id.log" \
  || fail "malicious release ID rejection was unclear"

assert_rejected_before_ssh malicious-app-path APP_DIR="$REMOTE_ROOT/app bad"
grep -Fq 'Invalid APP_DIR' "$TMP_DIR/malicious-app-path.log" \
  || fail "malicious app path rejection was unclear"

assert_rejected_before_ssh shell-release-id RELEASE_ID="bad';touch-pwned"
grep -Fq 'Invalid RELEASE_ID' "$TMP_DIR/shell-release-id.log" \
  || fail "shell metacharacter release ID rejection was unclear"

echo "dashboard deploy integration tests passed"
