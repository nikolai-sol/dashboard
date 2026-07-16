#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/ssh" <<'SH'
#!/bin/bash
printf '%s\n' "${FAKE_REMOTE_ENV_CONTENT:?}"
SH
chmod +x "$TMP_DIR/bin/ssh"

VALID_ENV='MYSQL_USER=dashboard_user
MYSQL_PASSWORD=mysql-top-secret
DASHBOARD_ADMIN_EMAIL=admin@example.test
DASHBOARD_ADMIN_PASSWORD=admin-top-secret
DASHBOARD_AUTH_SECRET=auth-top-secret
ABBOTT_DASHBOARD_PASSWORD=abbott-top-secret
ABBOTT_DASHBOARD_EMBED_KEY=embed-top-secret
METRIKA_TOKEN=metrika-top-secret
ABBOTT_PRIVATE_DB_HOST=private-db.example.test
ABBOTT_PRIVATE_DB_PORT=3306
ABBOTT_PRIVATE_DB_USER=abbott_private
ABBOTT_PRIVATE_DB_PASSWORD=private-db-top-secret
ABBOTT_PRIVATE_DB_NAME=report_bd_private'

TARGET_FILE="$TMP_DIR/.env.production"
SUCCESS_LOG="$TMP_DIR/success.log"
FAKE_REMOTE_ENV_CONTENT="$VALID_ENV" PATH="$TMP_DIR/bin:$PATH" \
  bash "$SCRIPT_DIR/render-production-env.sh" "$TARGET_FILE" >"$SUCCESS_LOG" 2>&1

for required_line in \
  'ABBOTT_DASHBOARD_PASSWORD=abbott-top-secret' \
  'ABBOTT_DASHBOARD_EMBED_KEY=embed-top-secret' \
  'METRIKA_TOKEN=metrika-top-secret' \
  'ABBOTT_PRIVATE_DB_HOST=private-db.example.test' \
  'ABBOTT_PRIVATE_DB_PORT=3306' \
  'ABBOTT_PRIVATE_DB_USER=abbott_private' \
  'ABBOTT_PRIVATE_DB_PASSWORD=private-db-top-secret' \
  'ABBOTT_PRIVATE_DB_NAME=report_bd_private'; do
  grep -Fqx "$required_line" "$TARGET_FILE"
done

if grep -Fq 'top-secret' "$SUCCESS_LOG"; then
  echo "render-production-env.sh printed a secret value" >&2
  exit 1
fi

MISSING_ENV="${VALID_ENV/ABBOTT_PRIVATE_DB_PASSWORD=private-db-top-secret/}"
MISSING_LOG="$TMP_DIR/missing.log"
if FAKE_REMOTE_ENV_CONTENT="$MISSING_ENV" PATH="$TMP_DIR/bin:$PATH" \
  bash "$SCRIPT_DIR/render-production-env.sh" "$TMP_DIR/missing.env" >"$MISSING_LOG" 2>&1; then
  echo "render-production-env.sh accepted a missing Abbott private DB password" >&2
  exit 1
fi

grep -Fq 'ABBOTT_PRIVATE_DB_PASSWORD' "$MISSING_LOG"
if grep -Fq 'top-secret' "$MISSING_LOG"; then
  echo "render-production-env.sh printed a secret value on failure" >&2
  exit 1
fi

echo "render-production-env tests passed"
