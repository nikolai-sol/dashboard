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
grep -Fq 'npm run test:abbott-contract' "$APP_DIR/scripts/deploy.sh" \
  || fail "deploy does not run the Abbott contract before build"
grep -Fq 'npm run test:abbott-contract' "$APP_DIR/package.json" \
  || fail "CI verification does not run the Abbott contract"

echo "Abbott dashboard contract wiring verified"
