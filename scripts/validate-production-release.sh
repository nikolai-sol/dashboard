#!/bin/bash
set -euo pipefail

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

required_keys=(
  ABBOTT_DASHBOARD_PASSWORD
  ABBOTT_DASHBOARD_EMBED_KEY
  METRIKA_TOKEN
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

  "$node_bin" - "$env_file" "$@" <<'JS'
const fs = require("node:fs");
const { parseEnv } = require("node:util");

const [envFile, ...requiredKeys] = process.argv.slice(2);
let parsed;
try {
  if (typeof parseEnv !== "function") throw new Error("dotenv parser unavailable");
  parsed = parseEnv(fs.readFileSync(envFile, "utf8"));
} catch {
  process.stdout.write(requiredKeys.join(" "));
  process.exit(1);
}

const missingKeys = requiredKeys.filter((key) =>
  typeof parsed[key] !== "string" || parsed[key].trim().length === 0
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

if [[ -L "$RELEASE_DIR/public" ]]; then
  echo "Production release must not contain a symlinked public directory" >&2
  exit 1
fi

if [[ -d "$RELEASE_DIR/public" ]] && find "$RELEASE_DIR/public" -mindepth 1 -maxdepth 1 -iname abbott -print -quit | grep -q .; then
  echo "Production release must not contain a public/abbott directory" >&2
  exit 1
fi

echo "Production release validation passed"
