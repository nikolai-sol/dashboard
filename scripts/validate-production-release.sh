#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DOTENV_MODULE_PATH="$SCRIPT_DIR/../node_modules/dotenv"
RELEASE_DIR="${1:-.next/standalone}"
ENV_FILE="${2:-$RELEASE_DIR/.env}"

if [[ -L "$RELEASE_DIR" || ! -d "$RELEASE_DIR" ]]; then
  echo "Production release directory is missing" >&2
  exit 1
fi

if [[ -L "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "Production release environment file is missing" >&2
  exit 1
fi

COMPATIBILITY_MARKER="$RELEASE_DIR/.shared-password-db-auth-v1"
if [[ -L "$COMPATIBILITY_MARKER" || ! -f "$COMPATIBILITY_MARKER" ]] || \
  ! grep -Fxq 'shared-password-db-auth-v1' "$COMPATIBILITY_MARKER"; then
  echo "Production release is missing the shared-password compatibility marker" >&2
  exit 1
fi

PM2_CONFIG="$RELEASE_DIR/ecosystem.config.js"
if [[ -L "$PM2_CONFIG" || ! -f "$PM2_CONFIG" ]] || \
  ! grep -Eq "^[[:space:]]*HOSTNAME:[[:space:]]*['\"]127\.0\.0\.1['\"][[:space:]]*,?[[:space:]]*$" "$PM2_CONFIG"; then
  echo "Production release must bind PM2 to the 127.0.0.1 loopback address" >&2
  exit 1
fi

required_keys=(
  ABBOTT_DASHBOARD_PASSWORD
  ABBOTT_DASHBOARD_EMBED_KEY
  ABBOTT_EMBED_DB_HOST
  ABBOTT_EMBED_DB_PORT
  ABBOTT_EMBED_DB_USER
  ABBOTT_EMBED_DB_PASSWORD
  ABBOTT_EMBED_DB_NAME
  ABBOTT_PRIVATE_DB_HOST
  ABBOTT_PRIVATE_DB_PORT
  ABBOTT_PRIVATE_DB_USER
  ABBOTT_PRIVATE_DB_PASSWORD
  ABBOTT_PRIVATE_DB_NAME
)

find_missing_dotenv_keys() {
  local env_file="$1"
  shift
  local node_bin=""

  if ! node_bin="$(command -v node)"; then
    printf '%s ' "$@"
    return 1
  fi

  "$node_bin" - "$DOTENV_MODULE_PATH" "$env_file" "$@" <<'JS'
const fs = require("node:fs");

const [dotenvModulePath, envFile, ...requiredKeys] = process.argv.slice(2);
let parsed;
try {
  const { parse } = require(dotenvModulePath);
  parsed = parse(fs.readFileSync(envFile, "utf8"));
} catch {
  process.stdout.write(requiredKeys.join(" "));
  process.exit(1);
}

const missingKeys = requiredKeys.filter((key) =>
  typeof parsed[key] !== "string" || parsed[key].trim().length === 0 ||
  (key === "ABBOTT_EMBED_DB_NAME" && parsed[key] !== "report_bd") ||
  (key === "ABBOTT_PRIVATE_DB_NAME" && parsed[key] !== "report_bd_private")
);
if (missingKeys.length > 0) {
  process.stdout.write(missingKeys.join(" "));
  process.exit(1);
}
JS
}

missing_keys=""
if ! missing_keys="$(find_missing_dotenv_keys "$ENV_FILE" "${required_keys[@]}")"; then
  printf 'Production release is missing required env keys: %s\n' "$missing_keys" >&2
  exit 1
fi

ALICE_IMPORTER="$RELEASE_DIR/scripts/import-zaruku-alice-visibility.cjs"
RELEASE_PACKAGE_JSON="$RELEASE_DIR/package.json"
EXPECTED_ALICE_COMMAND="node --env-file=.env scripts/import-zaruku-alice-visibility.cjs"
if [[ -L "$RELEASE_DIR/scripts" || -L "$ALICE_IMPORTER" || ! -f "$ALICE_IMPORTER" ]]; then
  echo "Production release is missing a regular Alice importer bundle" >&2
  exit 1
fi
if [[ -L "$RELEASE_PACKAGE_JSON" || ! -f "$RELEASE_PACKAGE_JSON" ]]; then
  echo "Production release is missing the Alice importer package command" >&2
  exit 1
fi
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]] || ! "$NODE_BIN" - "$RELEASE_PACKAGE_JSON" "$EXPECTED_ALICE_COMMAND" <<'JS'
const fs = require("node:fs");
const [manifestPath, expectedCommand] = process.argv.slice(2);
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  process.exit(manifest?.scripts?.["import:zaruku-alice"] === expectedCommand ? 0 : 1);
} catch {
  process.exit(1);
}
JS
then
  echo "Production release has an invalid Alice importer package command" >&2
  exit 1
fi
if find "$RELEASE_DIR" \( -type f -o -type l \) \( -iname '*.xlsx' -o -iname '*.xls' -o -iname '*.xlsm' -o -iname '*.xlsb' \) -print -quit | grep -q .; then
  echo "Production release must not contain an Alice source workbook" >&2
  exit 1
fi
ALICE_SMOKE_OUTPUT=""
if ! ALICE_SMOKE_OUTPUT="$(NODE_OPTIONS= "$NODE_BIN" --env-file="$ENV_FILE" "$ALICE_IMPORTER" \
  --summary-only \
  --period 2026-07 \
  --official-sov 44 \
  --captured-at 2026-07-13T14:30:00.000Z \
  --legacy-source release_validation \
  --legacy-mentions 0 \
  --legacy-citations 0 \
  --dry-run 2>/dev/null)"; then
  echo "Production release Alice importer bundle is not runnable" >&2
  exit 1
fi
ALICE_SMOKE_PATTERN='^Alice visibility dry-run mode=summary_only queries=0 portal_present=null sample_presence_pct=null sources=0 featured_sites=0 validation_mismatches=0 checksum=[a-f0-9]{64}$'
if [[ ! "$ALICE_SMOKE_OUTPUT" =~ $ALICE_SMOKE_PATTERN ]]; then
  echo "Production release Alice importer bundle returned an invalid dry-run summary" >&2
  exit 1
fi

if [[ -L "$RELEASE_DIR/public" ]]; then
  echo "Production release must not contain a symlinked public directory" >&2
  exit 1
fi

if [[ -d "$RELEASE_DIR/public" ]] && find "$RELEASE_DIR/public" -mindepth 1 -maxdepth 1 -iname abbott -print -quit | grep -q .; then
  echo "Production release must not contain a public/abbott directory" >&2
  exit 1
fi

RUNTIME_LINK_DIR="$RELEASE_DIR/.next/node_modules"
if [[ -d "$RUNTIME_LINK_DIR" ]]; then
  for runtime_link in "$RUNTIME_LINK_DIR"/*; do
    [[ -L "$runtime_link" ]] || continue
    runtime_target="$(readlink "$runtime_link")"
    if [[ "$runtime_target" != ../../node_modules/* || ! -f "$runtime_link/package.json" ]]; then
      echo "Production release has a broken runtime dependency link: $(basename "$runtime_link")" >&2
      exit 1
    fi
  done
fi

echo "Production release validation passed"
