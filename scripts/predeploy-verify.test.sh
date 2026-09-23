#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -P -- "$SCRIPT_DIR/.." && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/predeploy-verify.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
COMMAND_LOG="$TMP_DIR/commands.log"
export COMMAND_LOG
FRESH_BUILD_FIXTURE="$TMP_DIR/fresh-build"
export FRESH_BUILD_FIXTURE
REAL_NODE="$(command -v node)"
REAL_BASH="$(command -v bash)"
export REAL_NODE REAL_BASH

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
if [[ "$*" == 'run test:release-runtime' ]]; then
  mkdir -p "$FRESH_BUILD_FIXTURE/server"
  printf '%s\n' '{"middleware":{},"functions":{},"sortedMiddleware":[]}' > "$FRESH_BUILD_FIXTURE/server/middleware-manifest.json"
fi
SH
chmod +x "$FAKE_BIN/npm"
cat > "$FAKE_BIN/node" <<'SH'
#!/bin/bash
if [[ "$*" == "--import tsx --test packages/runtime-contract/src/index.test.ts" || \
      "$*" == "scripts/run-node-tests.mjs apps/zaruku/src" || \
      "$*" == "--test scripts/runtime-artifact-policy.test.mjs" ]]; then
  if [[ "$*" == 'scripts/run-node-tests.mjs apps/zaruku/src' && ! -f "$FRESH_BUILD_FIXTURE/server/middleware-manifest.json" ]]; then
    echo 'Isolated tests ran before the fresh build emitted middleware-manifest.json' >&2
    exit 74
  fi
  printf 'node %s\n' "$*" >> "$COMMAND_LOG"
  [[ -z "${FAIL_COMMAND:-}" || "node $*" != "$FAIL_COMMAND" ]]
  exit
fi
exec "$REAL_NODE" "$@"
SH
cat > "$FAKE_BIN/bash" <<'SH'
#!/bin/bash
if [[ "$*" == "scripts/verify-zaruku-shadow.test.sh" ]]; then
  printf 'bash %s\n' "$*" >> "$COMMAND_LOG"
  [[ -z "${FAIL_COMMAND:-}" || "bash $*" != "$FAIL_COMMAND" ]]
  exit
fi
exec "$REAL_BASH" "$@"
SH
chmod +x "$FAKE_BIN/node" "$FAKE_BIN/bash"

: > "$COMMAND_LOG"
PATH="$FAKE_BIN:$PATH" /bin/bash "$VERIFY_SCRIPT"
cat > "$TMP_DIR/expected.log" <<'EOF'
test
node --import tsx --test packages/runtime-contract/src/index.test.ts
run test:deploy-source
run test:zaruku-production-shadow
run test:zaruku-exact-path-cutover
run test:release-runtime
node scripts/run-node-tests.mjs apps/zaruku/src
node --test scripts/runtime-artifact-policy.test.mjs
--workspace apps/zaruku run verify:artifact
--workspace apps/zaruku run verify:boot
bash scripts/verify-zaruku-shadow.test.sh
run test:abbott-contract-wiring
run test:abbott-contract
run security:public-assets
run typecheck
exec -- tsc --noEmit -p apps/zaruku/tsconfig.json
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
if FAIL_COMMAND='run test:release-runtime' PATH="$FAKE_BIN:$PATH" /bin/bash "$VERIFY_SCRIPT" \
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
  "node scripts/run-node-tests.mjs apps/zaruku/src",
  "node --import tsx --test packages/runtime-contract/src/index.test.ts",
  "npm run test:deploy-source",
  "npm run test:zaruku-production-shadow",
  "npm run test:zaruku-exact-path-cutover",
  "npm run test:release-runtime",
  "node --test scripts/runtime-artifact-policy.test.mjs",
  "npm --workspace apps/zaruku run verify:artifact",
  "npm --workspace apps/zaruku run verify:boot",
  "bash scripts/verify-zaruku-shadow.test.sh",
  "npm run test:abbott-contract-wiring",
  "npm run test:abbott-contract",
  "npm run security:public-assets",
  "npm run typecheck",
  "npm exec -- tsc --noEmit -p apps/zaruku/tsconfig.json",
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
const releaseRuntime = pkg.scripts["test:release-runtime"] || "";
const isolatedBuild = releaseRuntime.indexOf("npm --workspace apps/zaruku run build");
const deployFixtures = releaseRuntime.indexOf("bash scripts/deploy-zaruku.test.sh");
if (isolatedBuild < 0 || deployFixtures <= isolatedBuild) {
  throw new Error("release runtime gate must build Zaruku before its deploy fixtures");
}
const releaseGate = verify.indexOf("npm run test:release-runtime");
for (const command of [
  "node scripts/run-node-tests.mjs apps/zaruku/src",
  "node --test scripts/runtime-artifact-policy.test.mjs",
  "npm --workspace apps/zaruku run verify:artifact",
  "npm --workspace apps/zaruku run verify:boot",
  "bash scripts/verify-zaruku-shadow.test.sh",
]) {
  if (verify.indexOf(command) <= releaseGate) throw new Error(`build-backed policy gate is out of order: ${command}`);
}
NODE

echo "predeploy verification contract tests passed"
