#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() {
  echo "$1" >&2
  exit 1
}

grep -Fq '"test:abbott-contract"' "$APP_DIR/package.json" \
  || fail "package.json does not expose the Abbott contract"
grep -Fq '"test:deploy-source"' "$APP_DIR/package.json" \
  || fail "package.json does not expose the deploy ancestry guard"
grep -Fq 'scripts/verify-deploy-source.sh' "$APP_DIR/scripts/deploy.sh" \
  || fail "deploy does not verify current main ancestry"
grep -Fq 'npm run predeploy:verify' "$APP_DIR/scripts/deploy.sh" \
  || fail "deploy does not invoke the complete predeploy gate"
grep -Fq 'npm run test:abbott-contract-wiring' "$APP_DIR/scripts/predeploy-verify.sh" \
  || fail "predeploy verification does not retain Abbott contract wiring"
grep -Fq 'npm run test:abbott-contract' "$APP_DIR/scripts/predeploy-verify.sh" \
  || fail "predeploy verification does not run the Abbott contract"
grep -Fq '"ci:verify": "npm run predeploy:verify"' "$APP_DIR/package.json" \
  || fail "CI verification does not share the production predeploy gate"

echo "Abbott dashboard contract wiring verified"
