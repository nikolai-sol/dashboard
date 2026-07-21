#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/bin"
SYSTEM_PATH="$PATH"
REAL_NODE="$(command -v node)"
cat > "$TMP_DIR/no-node-util-parse-env.cjs" <<'JS'
require("node:util").parseEnv = undefined;
JS
cat > "$TMP_DIR/bin/node" <<SH
#!/bin/bash
NODE_OPTIONS='--require=$TMP_DIR/no-node-util-parse-env.cjs' exec '$REAL_NODE' "\$@"
SH
chmod +x "$TMP_DIR/bin/node"
cat > "$TMP_DIR/bin/ssh" <<'SH'
#!/bin/bash
printf '%s\n' "${FAKE_REMOTE_ENV_CONTENT:?}"
SH
chmod +x "$TMP_DIR/bin/ssh"

mkdir -p "$TMP_DIR/system-node-bin"
ln -s "$REAL_NODE" "$TMP_DIR/system-node-bin/node"
ln -s "$TMP_DIR/bin/ssh" "$TMP_DIR/system-node-bin/ssh"

read -r -d '' VALID_ENV <<'ENV' || true
MYSQL_USER=dashboard_user
MYSQL_PASSWORD=mysql-top-secret
DASHBOARD_ADMIN_EMAIL=admin@example.test
DASHBOARD_ADMIN_PASSWORD=admin-top-secret
DASHBOARD_AUTH_SECRET=auth-top-secret
ABBOTT_DASHBOARD_PASSWORD='  abbott # "quoted" \ path  '
ABBOTT_DASHBOARD_EMBED_KEY="embed key # with spaces"
METRIKA_TOKEN='metrika # token \ value'
ABBOTT_EMBED_DB_HOST=embed-db.example.test
ABBOTT_EMBED_DB_PORT=3307
ABBOTT_EMBED_DB_USER=abbott_embed
ABBOTT_EMBED_DB_PASSWORD='  embed # "quoted" \ password  '
ABBOTT_EMBED_DB_NAME=report_bd
ABBOTT_PRIVATE_DB_HOST=private-db.example.test
ABBOTT_PRIVATE_DB_PORT=3306
ABBOTT_PRIVATE_DB_USER=abbott_private
ABBOTT_PRIVATE_DB_PASSWORD='  private # "quoted" \ password  '
ABBOTT_PRIVATE_DB_NAME=report_bd_private
ENV

TARGET_FILE="$TMP_DIR/.env.production"
SUCCESS_LOG="$TMP_DIR/success.log"
(
  cd "$TMP_DIR"
  FAKE_REMOTE_ENV_CONTENT="$VALID_ENV" PATH="$TMP_DIR/bin:$PATH" \
    bash "$SCRIPT_DIR/render-production-env.sh" "$TARGET_FILE"
) >"$SUCCESS_LOG" 2>&1

NODE_OPTIONS_MARKER="$TMP_DIR/node-options-executed"
cat > "$TMP_DIR/node-options-payload.cjs" <<JS
require("node:fs").writeFileSync("$NODE_OPTIONS_MARKER", "executed");
JS
MALICIOUS_ENV="$(printf '%s\nNODE_OPTIONS=--require=%s\n' "$VALID_ENV" "$TMP_DIR/node-options-payload.cjs")"
FAKE_REMOTE_ENV_CONTENT="$MALICIOUS_ENV" PATH="$TMP_DIR/system-node-bin:$SYSTEM_PATH" \
  bash "$SCRIPT_DIR/render-production-env.sh" "$TMP_DIR/malicious.env" >"$TMP_DIR/malicious.log" 2>&1
if [[ -e "$NODE_OPTIONS_MARKER" ]]; then
  echo "render-production-env.sh executed NODE_OPTIONS from the remote environment file" >&2
  exit 1
fi

EXPECTED_ABBOTT_PASSWORD='  abbott # "quoted" \ path  ' \
EXPECTED_EMBED_KEY='embed key # with spaces' \
EXPECTED_METRIKA_TOKEN='metrika # token \ value' \
EXPECTED_EMBED_PASSWORD='  embed # "quoted" \ password  ' \
EXPECTED_PRIVATE_PASSWORD='  private # "quoted" \ password  ' \
node --env-file="$TARGET_FILE" <<'JS'
const assert = require("node:assert/strict");
assert.equal(process.env.ABBOTT_DASHBOARD_PASSWORD, process.env.EXPECTED_ABBOTT_PASSWORD);
assert.equal(process.env.ABBOTT_DASHBOARD_EMBED_KEY, process.env.EXPECTED_EMBED_KEY);
assert.equal(process.env.METRIKA_TOKEN, process.env.EXPECTED_METRIKA_TOKEN);
assert.equal(process.env.ABBOTT_EMBED_DB_PASSWORD, process.env.EXPECTED_EMBED_PASSWORD);
assert.equal(process.env.ABBOTT_EMBED_DB_NAME, "report_bd");
assert.equal(process.env.ABBOTT_PRIVATE_DB_PASSWORD, process.env.EXPECTED_PRIVATE_PASSWORD);
JS

if grep -Fq 'top-secret' "$SUCCESS_LOG"; then
  echo "render-production-env.sh printed a secret value" >&2
  exit 1
fi

MISSING_ENV="$(printf '%s\n' "$VALID_ENV" | sed "s/^ABBOTT_PRIVATE_DB_PASSWORD=.*/ABBOTT_PRIVATE_DB_PASSWORD='   ' # rotated/")"
MISSING_LOG="$TMP_DIR/missing.log"
if FAKE_REMOTE_ENV_CONTENT="$MISSING_ENV" PATH="$TMP_DIR/bin:$PATH" \
  bash "$SCRIPT_DIR/render-production-env.sh" "$TMP_DIR/missing.env" >"$MISSING_LOG" 2>&1; then
  echo "render-production-env.sh accepted a commented whitespace-only Abbott private DB password" >&2
  exit 1
fi

grep -Fq 'ABBOTT_PRIVATE_DB_PASSWORD' "$MISSING_LOG"
if grep -Fq 'private # ' "$MISSING_LOG"; then
  echo "render-production-env.sh printed a secret value on failure" >&2
  exit 1
fi

echo "render-production-env tests passed"
