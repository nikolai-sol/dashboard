#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCK_SCRIPT="$SCRIPT_DIR/dashboard-deploy-lock.sh"
TMP_DIR="$(mktemp -d)"
LOCK_DIR="$TMP_DIR/dashboard-next-deploy.lock"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" acquire owner-one release-one aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  > "$TMP_DIR/first.log"
[[ -d "$LOCK_DIR" ]] || fail "first holder did not create the lock directory"
grep -Fqx 'owner_token=owner-one' "$LOCK_DIR/owner" || fail "owner token metadata is missing"
grep -Fqx 'release_id=release-one' "$LOCK_DIR/owner" || fail "release ID metadata is missing"
grep -Fqx 'source_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$LOCK_DIR/owner" \
  || fail "source SHA metadata is missing"

if DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" acquire owner-two release-two bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  > "$TMP_DIR/second.log" 2>&1; then
  fail "second holder acquired an existing dashboard lock"
fi
grep -Fq 'Deployment lock is already held' "$TMP_DIR/second.log" \
  || fail "second-holder failure did not explain recovery"
grep -Fqx 'owner_token=owner-one' "$LOCK_DIR/owner" || fail "second holder replaced owner metadata"

if DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" release owner-two > "$TMP_DIR/wrong-release.log" 2>&1; then
  fail "non-owner released the dashboard lock"
fi
[[ -d "$LOCK_DIR" ]] || fail "non-owner release deleted an existing lock"
grep -Fqx 'owner_token=owner-one' "$LOCK_DIR/owner" || fail "non-owner release changed owner metadata"

DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" bash "$LOCK_SCRIPT" release owner-one
[[ ! -e "$LOCK_DIR" ]] || fail "owner cleanup did not remove the dashboard lock"

DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" acquire owner-two release-two bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
printf '%s\n' 'preserve me' > "$LOCK_DIR/unexpected"
if DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" release owner-two > "$TMP_DIR/unknown-on-release.log" 2>&1; then
  fail "owner release deleted a lock containing unknown files"
fi
[[ -f "$LOCK_DIR/unexpected" ]] || fail "owner release deleted unknown lock contents"
grep -Fqx 'owner_token=owner-two' "$LOCK_DIR/owner" || fail "owner release deleted metadata before preserving unknown files"
rm "$LOCK_DIR/unexpected"
DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" bash "$LOCK_SCRIPT" release owner-two
[[ ! -e "$LOCK_DIR" ]] || fail "cleanup did not permit and release the next holder"

mkdir -p "$LOCK_DIR"
printf '%s\n' 'unrecognized lock contents' > "$LOCK_DIR/unknown"
if DASHBOARD_DEPLOY_LOCK_DIR="$LOCK_DIR" \
  bash "$LOCK_SCRIPT" acquire owner-three release-three cccccccccccccccccccccccccccccccccccccccc \
  > "$TMP_DIR/unknown.log" 2>&1; then
  fail "unknown existing lock was replaced"
fi
[[ -f "$LOCK_DIR/unknown" ]] || fail "unknown existing lock contents were deleted"
[[ ! -e "$LOCK_DIR/owner" ]] || fail "unknown existing lock was overwritten with owner metadata"

node - "$SCRIPT_DIR/deploy.sh" <<'NODE'
const fs = require("node:fs");
const source = fs.readFileSync(process.argv[2], "utf8");
const steps = [
  ['bash scripts/verify-deploy-source.sh "$APP_SOURCE_DIR"', "initial source check"],
  ["npm ci", "dependency installation"],
  ["npm test", "recursive tests"],
  ["npm run typecheck", "typecheck"],
  ["npm run lint", "lint"],
  ["npm run security:public-assets", "public-asset check"],
  ["npm run build", "production build"],
  ["acquire_deploy_lock", "lock acquisition"],
  ["verify_deploy_source_under_lock", "production recheck under lock"],
  [".release-source-sha", "release SHA packaging"],
  ["rsync -avz --delete", "release upload"],
  ["activate-release.sh", "release activation"],
  ["attest_active_release", "post-activation SHA attestation"],
];
let prior = -1;
for (const [needle, label] of steps) {
  const index = source.indexOf(needle, prior + 1);
  if (index === -1) {
    throw new Error(`deploy.sh is missing ordered ${label}: ${needle}`);
  }
  prior = index;
}
if (!source.includes("trap cleanup EXIT")) {
  throw new Error("deploy.sh does not release the lock through its EXIT cleanup trap");
}
if (!source.includes("if run_lock_command release; then")) {
  throw new Error("deploy.sh can mask a failed lock release while running its EXIT trap");
}
NODE

node - "$SCRIPT_DIR/../package.json" <<'NODE'
const pkg = require(process.argv[2]);
if (pkg.scripts["test:deploy-source"] !== "bash scripts/verify-deploy-source.test.sh && bash scripts/dashboard-deploy-lock.test.sh") {
  throw new Error("test:deploy-source does not run both deploy-isolation focused suites");
}
if (!pkg.scripts["test:release-runtime"].includes("bash scripts/release-rollback.test.sh")) {
  throw new Error("test:release-runtime does not retain release activation/rollback coverage");
}
NODE

echo "dashboard deploy lock tests passed"
