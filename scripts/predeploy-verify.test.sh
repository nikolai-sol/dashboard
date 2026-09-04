#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -P -- "$SCRIPT_DIR/.." && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/predeploy-verify.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
COMMAND_LOG="$TMP_DIR/commands.log"
export COMMAND_LOG

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/npm" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$COMMAND_LOG"
if [[ -n "${FAIL_COMMAND:-}" && "$*" == "$FAIL_COMMAND" ]]; then
  exit 73
fi
SH
chmod +x "$FAKE_BIN/npm"

: > "$COMMAND_LOG"
PATH="$FAKE_BIN:$PATH" bash "$VERIFY_SCRIPT"
cat > "$TMP_DIR/expected.log" <<'EOF'
test
run test:deploy-source
run test:release-runtime
run test:abbott-contract-wiring
run test:abbott-contract
run security:public-assets
run typecheck
run lint
run build
run preview-builder:test
EOF
cmp -s "$TMP_DIR/expected.log" "$COMMAND_LOG" || {
  echo "Expected predeploy commands:" >&2
  cat "$TMP_DIR/expected.log" >&2
  echo "Actual predeploy commands:" >&2
  cat "$COMMAND_LOG" >&2
  fail "predeploy verification omitted, duplicated, or reordered a required gate"
}

: > "$COMMAND_LOG"
if FAIL_COMMAND='run test:release-runtime' PATH="$FAKE_BIN:$PATH" bash "$VERIFY_SCRIPT" \
  > "$TMP_DIR/failure.log" 2>&1; then
  fail "predeploy verification ignored a failed required command"
fi
if grep -Fqx 'run test:abbott-contract-wiring' "$COMMAND_LOG"; then
  fail "predeploy verification continued after a failed required command"
fi

node - "$APP_DIR/scripts/deploy.sh" "$VERIFY_SCRIPT" "$APP_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const [deployPath, verifyPath, packagePath] = process.argv.slice(2);
const deploy = fs.readFileSync(deployPath, "utf8");
const verify = fs.readFileSync(verifyPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const installIndex = deploy.indexOf("npm ci");
const verifyIndex = deploy.indexOf("npm run predeploy:verify");
const packageIndex = deploy.indexOf('STANDALONE_DIR=".next/standalone"');
const uploadIndex = deploy.indexOf("rsync -avz --delete");
if (installIndex < 0 || verifyIndex <= installIndex || packageIndex <= verifyIndex || uploadIndex <= verifyIndex) {
  throw new Error("deploy.sh does not invoke the single predeploy gate after install and before packaging/upload");
}
if ((deploy.match(/npm run predeploy:verify/g) || []).length !== 1) {
  throw new Error("deploy.sh must invoke the production predeploy gate exactly once");
}

const required = [
  "npm test",
  "npm run test:deploy-source",
  "npm run test:release-runtime",
  "npm run test:abbott-contract-wiring",
  "npm run test:abbott-contract",
  "npm run security:public-assets",
  "npm run typecheck",
  "npm run lint",
  "npm run build",
  "npm run preview-builder:test",
];
for (const command of required) {
  if (verify.split(/\r?\n/).filter((line) => line.trim() === command).length !== 1) {
    throw new Error(`predeploy gate must run exactly once: ${command}`);
  }
  if (deploy.split(/\r?\n/).some((line) => line.trim() === command)) {
    throw new Error(`deploy.sh duplicates a command outside the single predeploy gate: ${command}`);
  }
}
if (pkg.scripts["predeploy:verify"] !== "bash scripts/predeploy-verify.sh") {
  throw new Error("package.json does not expose the production predeploy verification command");
}
if (pkg.scripts["ci:verify"] !== "npm run predeploy:verify") {
  throw new Error("CI and production deploy do not share the same complete gate");
}
NODE

echo "predeploy verification contract tests passed"
