#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SYSTEM_PATH="$PATH"
REAL_NODE="$(command -v node)"
mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/no-node-util-parse-env.cjs" <<'JS'
require("node:util").parseEnv = undefined;
JS
cat > "$TMP_DIR/bin/node" <<SH
#!/bin/bash
NODE_OPTIONS='--require=$TMP_DIR/no-node-util-parse-env.cjs' exec '$REAL_NODE' "\$@"
SH
chmod +x "$TMP_DIR/bin/node"
export PATH="$TMP_DIR/bin:$PATH"

write_valid_env() {
  local target="$1"
  cat > "$target" <<'ENV'
ABBOTT_DASHBOARD_PASSWORD='  abbott # "quoted" \ path  '
ABBOTT_DASHBOARD_EMBED_KEY="embed key # with spaces"
METRIKA_TOKEN='metrika # token \ value'
ABBOTT_EMBED_DB_HOST=embed-db.example.test
ABBOTT_EMBED_DB_PORT=3306
ABBOTT_EMBED_DB_USER=abbott_embed
ABBOTT_EMBED_DB_PASSWORD=embed-db-top-secret
ABBOTT_EMBED_DB_NAME=report_bd
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
(
  cd "$TMP_DIR"
  bash "$SCRIPT_DIR/validate-production-release.sh" "$VALID_RELEASE" "$VALID_RELEASE/.env"
) >"$TMP_DIR/valid.log" 2>&1

grep -q 'ABBOTT_DASHBOARD_PASSWORD' "$SCRIPT_DIR/validate-production-release.sh"
! grep -q 'ZARUKU_DASHBOARD_PASSWORD' "$SCRIPT_DIR/validate-production-release.sh"

NODE_OPTIONS_MARKER="$TMP_DIR/node-options-executed"
cat > "$TMP_DIR/node-options-payload.cjs" <<JS
require("node:fs").writeFileSync("$NODE_OPTIONS_MARKER", "executed");
JS
MALICIOUS_RELEASE="$TMP_DIR/malicious-release"
mkdir -p "$MALICIOUS_RELEASE/public"
write_valid_env "$MALICIOUS_RELEASE/.env"
printf 'NODE_OPTIONS=--require=%s\n' "$TMP_DIR/node-options-payload.cjs" >> "$MALICIOUS_RELEASE/.env"
PATH="$SYSTEM_PATH" bash "$SCRIPT_DIR/validate-production-release.sh" \
  "$MALICIOUS_RELEASE" "$MALICIOUS_RELEASE/.env" >"$TMP_DIR/malicious.log" 2>&1
if [[ -e "$NODE_OPTIONS_MARKER" ]]; then
  echo "validate-production-release.sh executed NODE_OPTIONS from the environment file" >&2
  exit 1
fi

MISSING_RELEASE="$TMP_DIR/missing-release"
mkdir -p "$MISSING_RELEASE/public"
write_valid_env "$MISSING_RELEASE/.env"
sed -i.bak '/^METRIKA_TOKEN=/d' "$MISSING_RELEASE/.env"
if METRIKA_TOKEN=ambient-value-must-not-mask-the-file \
  bash "$SCRIPT_DIR/validate-production-release.sh" "$MISSING_RELEASE" "$MISSING_RELEASE/.env" >"$TMP_DIR/missing.log" 2>&1; then
  echo "validate-production-release.sh accepted a missing required key" >&2
  exit 1
fi
grep -Fq 'METRIKA_TOKEN' "$TMP_DIR/missing.log"
if grep -Fq 'top-secret' "$TMP_DIR/missing.log"; then
  echo "validate-production-release.sh printed a secret value" >&2
  exit 1
fi

ABSENT_ABBOTT_RELEASE="$TMP_DIR/absent-abbott-release"
mkdir -p "$ABSENT_ABBOTT_RELEASE/public"
write_valid_env "$ABSENT_ABBOTT_RELEASE/.env"
sed -i.bak '/^ABBOTT_DASHBOARD_PASSWORD=/d' "$ABSENT_ABBOTT_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$ABSENT_ABBOTT_RELEASE" "$ABSENT_ABBOTT_RELEASE/.env" >"$TMP_DIR/absent-abbott.log" 2>&1; then
  echo "validate-production-release.sh accepted a missing Abbott fallback password" >&2
  exit 1
fi
grep -Fq 'ABBOTT_DASHBOARD_PASSWORD' "$TMP_DIR/absent-abbott.log"

BLANK_ABBOTT_RELEASE="$TMP_DIR/blank-abbott-release"
mkdir -p "$BLANK_ABBOTT_RELEASE/public"
write_valid_env "$BLANK_ABBOTT_RELEASE/.env"
sed -i.bak "s/^ABBOTT_DASHBOARD_PASSWORD=.*/ABBOTT_DASHBOARD_PASSWORD='   '/" "$BLANK_ABBOTT_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$BLANK_ABBOTT_RELEASE" "$BLANK_ABBOTT_RELEASE/.env" >"$TMP_DIR/blank-abbott.log" 2>&1; then
  echo "validate-production-release.sh accepted a blank Abbott fallback password" >&2
  exit 1
fi
grep -Fq 'ABBOTT_DASHBOARD_PASSWORD' "$TMP_DIR/blank-abbott.log"

PRIVATE_RELEASE="$TMP_DIR/private-release"
mkdir -p "$PRIVATE_RELEASE/public/AbBoTt"
printf 'image' > "$PRIVATE_RELEASE/public/AbBoTt/logo.png"
write_valid_env "$PRIVATE_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$PRIVATE_RELEASE" "$PRIVATE_RELEASE/.env" >"$TMP_DIR/private.log" 2>&1; then
  echo "validate-production-release.sh accepted a staged public/abbott directory" >&2
  exit 1
fi
grep -Fqi 'public/abbott' "$TMP_DIR/private.log"

SYMLINK_PUBLIC_RELEASE="$TMP_DIR/symlink-public-release"
EXTERNAL_PUBLIC="$TMP_DIR/external-public"
mkdir -p "$SYMLINK_PUBLIC_RELEASE" "$EXTERNAL_PUBLIC/abbott"
write_valid_env "$SYMLINK_PUBLIC_RELEASE/.env"
ln -s "$EXTERNAL_PUBLIC" "$SYMLINK_PUBLIC_RELEASE/public"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$SYMLINK_PUBLIC_RELEASE" "$SYMLINK_PUBLIC_RELEASE/.env" >"$TMP_DIR/symlink-public.log" 2>&1; then
  echo "validate-production-release.sh accepted a symlinked public directory" >&2
  exit 1
fi

SYMLINK_ABBOTT_RELEASE="$TMP_DIR/symlink-abbott-release"
mkdir -p "$SYMLINK_ABBOTT_RELEASE/public" "$TMP_DIR/external-abbott"
write_valid_env "$SYMLINK_ABBOTT_RELEASE/.env"
ln -s "$TMP_DIR/external-abbott" "$SYMLINK_ABBOTT_RELEASE/public/AbBoTt"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$SYMLINK_ABBOTT_RELEASE" "$SYMLINK_ABBOTT_RELEASE/.env" >"$TMP_DIR/symlink-abbott.log" 2>&1; then
  echo "validate-production-release.sh accepted a public/abbott symlink" >&2
  exit 1
fi

SYMLINK_ENV_RELEASE="$TMP_DIR/symlink-env-release"
mkdir -p "$SYMLINK_ENV_RELEASE/public"
write_valid_env "$TMP_DIR/external.env"
ln -s "$TMP_DIR/external.env" "$SYMLINK_ENV_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$SYMLINK_ENV_RELEASE" "$SYMLINK_ENV_RELEASE/.env" >"$TMP_DIR/symlink-env.log" 2>&1; then
  echo "validate-production-release.sh accepted a symlinked environment file" >&2
  exit 1
fi

WHITESPACE_RELEASE="$TMP_DIR/whitespace-release"
mkdir -p "$WHITESPACE_RELEASE/public"
write_valid_env "$WHITESPACE_RELEASE/.env"
sed -i.bak "s/^METRIKA_TOKEN=.*/METRIKA_TOKEN='   ' # rotated/" "$WHITESPACE_RELEASE/.env"
if bash "$SCRIPT_DIR/validate-production-release.sh" "$WHITESPACE_RELEASE" "$WHITESPACE_RELEASE/.env" >"$TMP_DIR/whitespace.log" 2>&1; then
  echo "validate-production-release.sh accepted a commented whitespace-only required value" >&2
  exit 1
fi
grep -Fq 'METRIKA_TOKEN' "$TMP_DIR/whitespace.log"

echo "validate-production-release tests passed"
