#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

write_valid_env() {
  local target="$1"
  cat > "$target" <<'ENV'
ABBOTT_DASHBOARD_PASSWORD=abbott-top-secret
ABBOTT_DASHBOARD_EMBED_KEY=embed-top-secret
METRIKA_TOKEN=metrika-top-secret
ABBOTT_PRIVATE_DB_HOST=private-db.example.test
ABBOTT_PRIVATE_DB_PORT=3306
ABBOTT_PRIVATE_DB_USER=abbott_private
ABBOTT_PRIVATE_DB_PASSWORD=private-db-top-secret
ABBOTT_PRIVATE_DB_NAME=report_bd_private
ENV
}

VALID_RELEASE="$TMP_DIR/valid-release"
mkdir -p "$VALID_RELEASE/public/images"
printf 'image' > "$VALID_RELEASE/public/images/abbott-logo.png"
write_valid_env "$VALID_RELEASE/.env"
bash "$SCRIPT_DIR/validate-production-release.sh" "$VALID_RELEASE" "$VALID_RELEASE/.env" >"$TMP_DIR/valid.log" 2>&1

MISSING_RELEASE="$TMP_DIR/missing-release"
mkdir -p "$MISSING_RELEASE/public"
write_valid_env "$MISSING_RELEASE/.env"
sed -i.bak '/^METRIKA_TOKEN=/d' "$MISSING_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$MISSING_RELEASE" "$MISSING_RELEASE/.env" >"$TMP_DIR/missing.log" 2>&1; then
  echo "validate-production-release.sh accepted a missing required key" >&2
  exit 1
fi
grep -Fq 'METRIKA_TOKEN' "$TMP_DIR/missing.log"
if grep -Fq 'top-secret' "$TMP_DIR/missing.log"; then
  echo "validate-production-release.sh printed a secret value" >&2
  exit 1
fi

PRIVATE_RELEASE="$TMP_DIR/private-release"
mkdir -p "$PRIVATE_RELEASE/public/AbBoTt"
printf 'image' > "$PRIVATE_RELEASE/public/AbBoTt/logo.png"
write_valid_env "$PRIVATE_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$PRIVATE_RELEASE" "$PRIVATE_RELEASE/.env" >"$TMP_DIR/private.log" 2>&1; then
  echo "validate-production-release.sh accepted a staged public/abbott directory" >&2
  exit 1
fi
grep -Fqi 'public/abbott' "$TMP_DIR/private.log"

echo "validate-production-release tests passed"
