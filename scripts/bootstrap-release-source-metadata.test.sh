#!/bin/bash
set -euo pipefail

SOURCE_SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
TMP_DIR="$(cd -P -- "$TMP_DIR" && pwd -P)"
FIXTURE_REPO="$TMP_DIR/release"
REMOTE_APP="$TMP_DIR/remote/dashboard"
LOCK_DIR="$TMP_DIR/remote/dashboard-next-deploy.lock"
FAKE_BIN="$TMP_DIR/bin"
SSH_LOG="$TMP_DIR/ssh.log"
export SSH_LOG

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mkdir -p "$FIXTURE_REPO/scripts" "$REMOTE_APP/.next" "$FAKE_BIN"
cp "$SOURCE_SCRIPT_DIR/bootstrap-release-source-metadata.sh" "$FIXTURE_REPO/scripts/"
cp "$SOURCE_SCRIPT_DIR/bootstrap-release-source-metadata-remote.sh" "$FIXTURE_REPO/scripts/"
cp "$SOURCE_SCRIPT_DIR/dashboard-deploy-lock.sh" "$FIXTURE_REPO/scripts/"

# Production authority is fixed. Only temporary copies are rewritten for the local behavioral test.
sed -i.bak "s|SSH_BIN=\"/usr/bin/ssh\"|SSH_BIN=\"$FAKE_BIN/ssh\"|" \
  "$FIXTURE_REPO/scripts/bootstrap-release-source-metadata.sh"
sed -i.bak "s|APP_DIR=\"/var/www/dashboard\"|APP_DIR=\"$REMOTE_APP\"|" \
  "$FIXTURE_REPO/scripts/bootstrap-release-source-metadata.sh"
sed -i.bak "s|DEPLOY_LOCK_DIR=\"/var/www/.dashboard-next-deploy.lock\"|DEPLOY_LOCK_DIR=\"$LOCK_DIR\"|" \
  "$FIXTURE_REPO/scripts/bootstrap-release-source-metadata.sh"
sed -i.bak "s|FIXED_APP_DIR=\"/var/www/dashboard\"|FIXED_APP_DIR=\"$REMOTE_APP\"|" \
  "$FIXTURE_REPO/scripts/bootstrap-release-source-metadata-remote.sh"
rm -f "$FIXTURE_REPO/scripts/"*.bak

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

set +e
bash "$script_file" "${remote_args[@]}"
status=$?
set -e
if grep -Fq 'acquire_lock()' "$script_file" && [[ " ${remote_args[*]} " == *' acquire '* ]] && \
   [[ "${MOVE_BOOTSTRAP_HEAD_AFTER_ACQUIRE:-0}" == 1 ]] && [[ "$status" -eq 0 ]]; then
  git -C "$MUTATE_BOOTSTRAP_REPO" reset --quiet --hard "$MUTATE_BOOTSTRAP_HEAD_SHA"
fi
if grep -Fq 'acquire_lock()' "$script_file" && [[ " ${remote_args[*]} " == *' acquire '* ]] && \
   [[ "${AMBIGUOUS_BOOTSTRAP_ACQUIRE:-0}" == 1 ]] && [[ "$status" -eq 0 ]]; then
  rm -f "$script_file"
  exit 255
fi
rm -f "$script_file"
exit "$status"
SH
chmod +x "$FAKE_BIN/ssh"

printf '%s\n' 'build-identity-20260904' > "$REMOTE_APP/.next/BUILD_ID"
git init --quiet "$FIXTURE_REPO"
git -C "$FIXTURE_REPO" config user.email test@example.com
git -C "$FIXTURE_REPO" config user.name "Bootstrap Metadata Test"
printf '%s\n' 'base' > "$FIXTURE_REPO/app.txt"
git -C "$FIXTURE_REPO" add .
git -C "$FIXTURE_REPO" commit --quiet -m base
BASE_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
printf '%s\n' 'candidate' >> "$FIXTURE_REPO/app.txt"
git -C "$FIXTURE_REPO" commit --quiet -am candidate
CANDIDATE_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"

run_bootstrap() {
  bash "$FIXTURE_REPO/scripts/bootstrap-release-source-metadata.sh" "$@"
}

: > "$SSH_LOG"
run_bootstrap "$BASE_SHA" build-identity-20260904 > "$TMP_DIR/success.log"
grep -Fqx "$BASE_SHA" "$REMOTE_APP/.release-source-sha" \
  || fail "bootstrap did not write the supplied verified full SHA"
mode="$(stat -f '%Lp' "$REMOTE_APP/.release-source-sha" 2>/dev/null || stat -c '%a' "$REMOTE_APP/.release-source-sha")"
[[ "$mode" == 600 ]] || fail "bootstrap metadata permissions are $mode instead of 600"
[[ ! -e "$LOCK_DIR" ]] || fail "successful bootstrap did not release the shared dashboard lock"
grep -Fq "source_sha=$BASE_SHA" "$TMP_DIR/success.log" \
  || fail "bootstrap audit output omitted the supplied source SHA"
grep -Fq 'build_id=build-identity-20260904' "$TMP_DIR/success.log" \
  || fail "bootstrap audit output omitted the independently captured build identity"

printf '%s\n' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' > "$REMOTE_APP/.release-source-sha"
if run_bootstrap "$BASE_SHA" build-identity-20260904 > "$TMP_DIR/conflict.log" 2>&1; then
  fail "bootstrap overwrote conflicting existing metadata"
fi
grep -Fqx 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$REMOTE_APP/.release-source-sha" \
  || fail "conflicting metadata was changed"
grep -Fq 'conflicting release source metadata' "$TMP_DIR/conflict.log" \
  || fail "conflicting metadata refusal was unclear"

rm "$REMOTE_APP/.release-source-sha"
if run_bootstrap "$BASE_SHA" wrong-build-identity > "$TMP_DIR/evidence.log" 2>&1; then
  fail "bootstrap accepted mismatched current-release evidence"
fi
[[ ! -e "$REMOTE_APP/.release-source-sha" ]] || fail "failed evidence check wrote metadata"
grep -Fq 'active build identity does not match' "$TMP_DIR/evidence.log" \
  || fail "mismatched build evidence failure was unclear"

: > "$SSH_LOG"
if run_bootstrap "${BASE_SHA:0:12}" build-identity-20260904 > "$TMP_DIR/short-sha.log" 2>&1; then
  fail "bootstrap accepted a short SHA"
fi
[[ ! -s "$SSH_LOG" ]] || fail "short SHA reached SSH before rejection"
grep -Fq 'exactly one lowercase full commit SHA' "$TMP_DIR/short-sha.log" \
  || fail "short SHA failure was unclear"

git -C "$FIXTURE_REPO" switch --quiet --detach "$BASE_SHA"
printf '%s\n' 'unrelated' > "$FIXTURE_REPO/unrelated.txt"
git -C "$FIXTURE_REPO" add unrelated.txt
git -C "$FIXTURE_REPO" commit --quiet -m unrelated
UNRELATED_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
git -C "$FIXTURE_REPO" switch --quiet --detach "$CANDIDATE_SHA"
: > "$SSH_LOG"
if run_bootstrap "$UNRELATED_SHA" build-identity-20260904 > "$TMP_DIR/non-ancestor.log" 2>&1; then
  fail "bootstrap accepted a supplied commit outside candidate history"
fi
[[ ! -s "$SSH_LOG" ]] || fail "non-ancestor SHA reached SSH before rejection"
grep -Fq 'is not an ancestor of candidate HEAD' "$TMP_DIR/non-ancestor.log" \
  || fail "non-ancestor failure was unclear"

git -C "$FIXTURE_REPO" tag -a bootstrap-tag -m bootstrap-tag "$BASE_SHA"
TAG_OBJECT_SHA="$(git -C "$FIXTURE_REPO" rev-parse refs/tags/bootstrap-tag)"
: > "$SSH_LOG"
if run_bootstrap "$TAG_OBJECT_SHA" build-identity-20260904 > "$TMP_DIR/tag.log" 2>&1; then
  fail "bootstrap accepted an annotated-tag object as a direct commit"
fi
[[ ! -s "$SSH_LOG" ]] || fail "tag object reached SSH before rejection"
grep -Fq 'does not directly identify a local commit object' "$TMP_DIR/tag.log" \
  || fail "direct-commit failure was unclear"

git -C "$FIXTURE_REPO" reset --quiet --hard "$CANDIDATE_SHA"
export MUTATE_BOOTSTRAP_REPO="$FIXTURE_REPO" MUTATE_BOOTSTRAP_HEAD_SHA="$BASE_SHA"
if MOVE_BOOTSTRAP_HEAD_AFTER_ACQUIRE=1 run_bootstrap "$CANDIDATE_SHA" build-identity-20260904 \
  > "$TMP_DIR/candidate-changed.log" 2>&1; then
  fail "bootstrap wrote metadata after candidate HEAD changed under its lock"
fi
[[ ! -e "$REMOTE_APP/.release-source-sha" ]] || fail "changed-candidate bootstrap wrote metadata"
grep -Fq 'candidate HEAD changed before metadata publication' "$TMP_DIR/candidate-changed.log" \
  || fail "changed-candidate failure was unclear"
[[ ! -e "$LOCK_DIR" ]] || fail "changed-candidate failure did not release the shared lock"
git -C "$FIXTURE_REPO" reset --quiet --hard "$CANDIDATE_SHA"
unset MUTATE_BOOTSTRAP_REPO MUTATE_BOOTSTRAP_HEAD_SHA

: > "$SSH_LOG"
if AMBIGUOUS_BOOTSTRAP_ACQUIRE=1 run_bootstrap "$BASE_SHA" build-identity-20260904 \
  > "$TMP_DIR/ambiguous.log" 2>&1; then
  fail "ambiguous bootstrap lock acquisition unexpectedly succeeded"
fi
[[ ! -e "$LOCK_DIR" ]] || fail "ambiguous bootstrap acquisition left this attempt's lock behind"
[[ ! -e "$REMOTE_APP/.release-source-sha" ]] || fail "ambiguous lock acquisition wrote metadata"

mkdir -p "$LOCK_DIR"
printf '%s\n' 'unknown lock state' > "$LOCK_DIR/unknown"
if run_bootstrap "$BASE_SHA" build-identity-20260904 > "$TMP_DIR/unknown-lock.log" 2>&1; then
  fail "bootstrap replaced an unknown shared lock"
fi
[[ -f "$LOCK_DIR/unknown" ]] || fail "bootstrap deleted an unknown shared lock"
[[ ! -e "$REMOTE_APP/.release-source-sha" ]] || fail "unknown-lock refusal wrote metadata"

if grep -Eqi '(^|[^a-z])(force|guess|short.sha|legacy.fallback)([^a-z]|$)' \
  "$SOURCE_SCRIPT_DIR/bootstrap-release-source-metadata.sh" \
  "$SOURCE_SCRIPT_DIR/bootstrap-release-source-metadata-remote.sh"; then
  fail "bootstrap exposes guessing, legacy fallback, short-SHA, or force behavior"
fi

OPS_FILE="$SOURCE_SCRIPT_DIR/../OPS.md"
grep -Fq "ssh beget 'cat /var/www/dashboard/.next/BUILD_ID'" "$OPS_FILE" \
  || fail "OPS runbook does not capture the exact active build identity read-only"
grep -Fq 'bash scripts/bootstrap-release-source-metadata.sh <full-source-sha> <exact-active-build-id>' \
  "$OPS_FILE" || fail "OPS runbook does not document the audited bootstrap command"
grep -Fq 'не определяет commit из имени `/var/www/dashboard`' "$OPS_FILE" \
  || fail "OPS runbook does not prohibit fixed-path commit inference"
grep -Fq 'прямым локальным commit-объектом и предком candidate `HEAD`' "$OPS_FILE" \
  || fail "OPS runbook omits direct-commit and candidate-ancestry prerequisites"
grep -Fq 'mode `0600`' "$OPS_FILE" \
  || fail "OPS runbook omits restrictive metadata permissions"

echo "release source metadata bootstrap tests passed"
