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

git clone --quiet "$TMP_DIR/remote.git" "$TMP_DIR/release"
git -C "$TMP_DIR/release" config user.email test@example.com
git -C "$TMP_DIR/release" config user.name "Deploy Guard Test"

bash "$VERIFY_SCRIPT" "$TMP_DIR/release" > "$TMP_DIR/current.log"
grep -Fq "Deploy source verified" "$TMP_DIR/current.log" || fail "current main was not accepted"

printf 'release\n' >> "$TMP_DIR/release/app.txt"
git -C "$TMP_DIR/release" commit --quiet -am release
bash "$VERIFY_SCRIPT" "$TMP_DIR/release" > "$TMP_DIR/descendant.log"

printf 'upstream\n' >> "$TMP_DIR/upstream/app.txt"
git -C "$TMP_DIR/upstream" commit --quiet -am upstream
git -C "$TMP_DIR/upstream" push --quiet
if bash "$VERIFY_SCRIPT" "$TMP_DIR/release" > "$TMP_DIR/diverged.log" 2>&1; then
  fail "branch missing current origin/main commits was accepted"
fi
grep -Fq "does not contain current origin/main" "$TMP_DIR/diverged.log" \
  || fail "divergence failure was unclear"

git -C "$TMP_DIR/release" reset --quiet --hard origin/main
printf 'dirty\n' >> "$TMP_DIR/release/app.txt"
if bash "$VERIFY_SCRIPT" "$TMP_DIR/release" > "$TMP_DIR/dirty.log" 2>&1; then
  fail "dirty worktree was accepted"
fi
grep -Fq "working tree is not clean" "$TMP_DIR/dirty.log" || fail "dirty-tree failure was unclear"

echo "deploy source guard tests passed"
