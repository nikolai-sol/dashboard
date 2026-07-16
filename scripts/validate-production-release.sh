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

missing_keys=()
for key in "${required_keys[@]}"; do
  if ! awk -F= -v required_key="$key" '
    $1 == required_key {
      value = substr($0, length($1) + 2)
      gsub(/^[[:space:]]+|[[:space:]\r]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      single_quote = sprintf("%c", 39)
      if ((first == "\"" && last == "\"") || (first == single_quote && last == single_quote)) {
        value = substr(value, 2, length(value) - 2)
      } else {
        sub(/#.*/, "", value)
      }
      gsub(/^[[:space:]]+|[[:space:]\r]+$/, "", value)
      if (length(value) > 0) found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$ENV_FILE"; then
    missing_keys+=("$key")
  fi
done

if (( ${#missing_keys[@]} > 0 )); then
  printf 'Production release is missing required env keys: %s\n' "${missing_keys[*]}" >&2
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
