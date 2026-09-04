#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-deploy-source.sh"
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
ACTIVE_RELEASE_STATE="$TMP_DIR/active-release-state"
export ACTIVE_RELEASE_STATE
cat > "$TMP_DIR/bin/read-active-release" <<'SH'
#!/bin/bash
cat "$ACTIVE_RELEASE_STATE"
SH
chmod +x "$TMP_DIR/bin/read-active-release"
cat > "$TMP_DIR/bin/ssh" <<'SH'
#!/bin/bash
shift
exec bash -c "$1"
SH
chmod +x "$TMP_DIR/bin/ssh"

run_guard() {
  DEPLOY_ACTIVE_RELEASE_READER="$TMP_DIR/bin/read-active-release" \
    bash "$VERIFY_SCRIPT" "$TMP_DIR/release"
}

set_active_sha() {
  printf 'sha:%s\n' "$1" > "$ACTIVE_RELEASE_STATE"
}

git init --bare --quiet "$TMP_DIR/remote.git"
git clone --quiet "$TMP_DIR/remote.git" "$TMP_DIR/upstream"
git -C "$TMP_DIR/upstream" config user.email test@example.com
git -C "$TMP_DIR/upstream" config user.name "Deploy Guard Test"
printf 'base\n' > "$TMP_DIR/upstream/app.txt"
git -C "$TMP_DIR/upstream" add app.txt
git -C "$TMP_DIR/upstream" commit --quiet -m base
git -C "$TMP_DIR/upstream" branch -M main
git -C "$TMP_DIR/upstream" push --quiet -u origin main
git --git-dir="$TMP_DIR/remote.git" symbolic-ref HEAD refs/heads/main
BASE_SHA="$(git -C "$TMP_DIR/upstream" rev-parse HEAD)"

git clone --quiet "$TMP_DIR/remote.git" "$TMP_DIR/release"
git -C "$TMP_DIR/release" config user.email test@example.com
git -C "$TMP_DIR/release" config user.name "Deploy Guard Test"

set_active_sha "$BASE_SHA"
run_guard > "$TMP_DIR/current.log"
grep -Fq "Deploy source verified" "$TMP_DIR/current.log" || fail "current main was not accepted"
grep -Fq "$BASE_SHA" "$TMP_DIR/current.log" || fail "full production SHA was not reported"

printf 'release\n' >> "$TMP_DIR/release/app.txt"
git -C "$TMP_DIR/release" commit --quiet -am release
DESCENDANT_SHA="$(git -C "$TMP_DIR/release" rev-parse HEAD)"
printf 'missing-metadata:/var/www/dashboard\n' > "$ACTIVE_RELEASE_STATE"
if run_guard > "$TMP_DIR/fixed-path-missing-metadata.log" 2>&1; then
  fail "fixed APP_DIR without source metadata was accepted"
fi
grep -Fq 'run scripts/bootstrap-release-source-metadata.sh' "$TMP_DIR/fixed-path-missing-metadata.log" \
  || fail "fixed-path metadata failure did not name the audited bootstrap command"

printf 'upstream\n' >> "$TMP_DIR/upstream/app.txt"
git -C "$TMP_DIR/upstream" commit --quiet -am upstream
git -C "$TMP_DIR/upstream" push --quiet
if run_guard > "$TMP_DIR/diverged.log" 2>&1; then
  fail "branch missing current origin/main commits was accepted"
fi
grep -Fq "does not contain current origin/main" "$TMP_DIR/diverged.log" \
  || fail "divergence failure was unclear"

git -C "$TMP_DIR/release" fetch --quiet origin main
git -C "$TMP_DIR/release" reset --quiet --hard origin/main
printf 'production-only\n' > "$TMP_DIR/release/production.txt"
git -C "$TMP_DIR/release" add production.txt
git -C "$TMP_DIR/release" commit --quiet -m production-only
PRODUCTION_SHA="$(git -C "$TMP_DIR/release" rev-parse HEAD)"
git -C "$TMP_DIR/release" reset --quiet --hard origin/main
set_active_sha "$PRODUCTION_SHA"
if run_guard > "$TMP_DIR/production-ancestor.log" 2>&1; then
  fail "branch missing the active production commit was accepted"
fi
grep -Fq "does not contain active production commit $PRODUCTION_SHA" "$TMP_DIR/production-ancestor.log" \
  || fail "missing-production-ancestor failure was unclear"

set_active_sha "$(git -C "$TMP_DIR/release" rev-parse HEAD)"
printf 'dirty\n' >> "$TMP_DIR/release/app.txt"
if run_guard > "$TMP_DIR/dirty.log" 2>&1; then
  fail "dirty worktree was accepted"
fi
grep -Fq "working tree is not clean" "$TMP_DIR/dirty.log" || fail "dirty-tree failure was unclear"

git -C "$TMP_DIR/release" reset --quiet --hard
printf 'untracked\n' > "$TMP_DIR/release/untracked.txt"
if run_guard > "$TMP_DIR/untracked.log" 2>&1; then
  fail "untracked dirty worktree was accepted"
fi
grep -Fq "working tree is not clean" "$TMP_DIR/untracked.log" \
  || fail "untracked dirty-tree failure was unclear"
rm "$TMP_DIR/release/untracked.txt"

git -C "$TMP_DIR/release" tag -a legacy-annotated -m legacy-annotated
ANNOTATED_TAG_FULL_SHA="$(git -C "$TMP_DIR/release" rev-parse refs/tags/legacy-annotated)"
set_active_sha "$ANNOTATED_TAG_FULL_SHA"
if run_guard > "$TMP_DIR/annotated-tag-metadata.log" 2>&1; then
  fail "annotated tag object was accepted as full release metadata"
fi
grep -Fq "does not identify a commit object" "$TMP_DIR/annotated-tag-metadata.log" \
  || fail "annotated-tag metadata failure was unclear"

: > "$ACTIVE_RELEASE_STATE"
if run_guard > "$TMP_DIR/missing-active.log" 2>&1; then
  fail "missing active production identity was accepted"
fi
grep -Fq "cannot determine active production commit" "$TMP_DIR/missing-active.log" \
  || fail "missing-active-release failure was unclear"

ACTIVE_DIR="$TMP_DIR/releases/20260904-$(git -C "$TMP_DIR/release" rev-parse --short=7 HEAD)"
mkdir -p "$ACTIVE_DIR"
printf '%s\n' "$(git -C "$TMP_DIR/release" rev-parse HEAD)" > "$ACTIVE_DIR/.release-source-sha"
DEPLOY_ACTIVE_RELEASE_READER= DEPLOY_SSH_BIN="$TMP_DIR/bin/ssh" DEPLOY_VPS=fake \
  DEPLOY_APP_DIR="$ACTIVE_DIR" bash "$VERIFY_SCRIPT" "$TMP_DIR/release" > "$TMP_DIR/ssh-reader.log"
grep -Fq "Deploy source verified" "$TMP_DIR/ssh-reader.log" \
  || fail "injected SSH reader did not accept valid full release metadata"

mv "$ACTIVE_DIR/.release-source-sha" "$TMP_DIR/external-release-source-sha"
ln -s "$TMP_DIR/external-release-source-sha" "$ACTIVE_DIR/.release-source-sha"
if DEPLOY_ACTIVE_RELEASE_READER= DEPLOY_SSH_BIN="$TMP_DIR/bin/ssh" DEPLOY_VPS=fake \
  DEPLOY_APP_DIR="$ACTIVE_DIR" bash "$VERIFY_SCRIPT" "$TMP_DIR/release" \
  > "$TMP_DIR/symlink-metadata.log" 2>&1; then
  fail "symlinked active release metadata was accepted through legacy fallback"
fi
grep -Fq "active release metadata is not a regular file" "$TMP_DIR/symlink-metadata.log" \
  || fail "unsafe active metadata failure was unclear"

rm "$ACTIVE_DIR/.release-source-sha"
printf '%s\n\n' "$(git -C "$TMP_DIR/release" rev-parse HEAD)" > "$ACTIVE_DIR/.release-source-sha"
if DEPLOY_ACTIVE_RELEASE_READER= DEPLOY_SSH_BIN="$TMP_DIR/bin/ssh" DEPLOY_VPS=fake \
  DEPLOY_APP_DIR="$ACTIVE_DIR" bash "$VERIFY_SCRIPT" "$TMP_DIR/release" \
  > "$TMP_DIR/non-exact-metadata.log" 2>&1; then
  fail "active release metadata containing more than one exact SHA line was accepted"
fi
grep -Fq "active release metadata does not contain exactly one full Git SHA" \
  "$TMP_DIR/non-exact-metadata.log" || fail "non-exact metadata failure was unclear"

if grep -Fq 'resolve_legacy_sha' "$VERIFY_SCRIPT" || grep -Fq 'path:*)' "$VERIFY_SCRIPT"; then
  fail "deploy source guard retains a legacy basename inference path"
fi

[[ "$DESCENDANT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "test fixture did not create a full SHA"
echo "deploy source guard tests passed"
