#!/bin/bash
set -euo pipefail

VPS="${VPS:-beget}"
REMOTE_ENV_PATH="${REMOTE_ENV_PATH:-/var/www/www-root/data/.production.env}"
TARGET_FILE="${1:-.env.production}"

REMOTE_ENV_CONTENT="$(ssh "$VPS" "cat '$REMOTE_ENV_PATH'")"

MYSQL_PORT_VALUE="3306"
MYSQL_USER_VALUE=""
MYSQL_PASSWORD_VALUE=""
MYSQL_DB_VALUE="report_bd"
MYSQL_DB_STAT_VALUE=""
ADMIN_EMAIL_VALUE=""
ADMIN_PASSWORD_VALUE=""
AUTH_SECRET_VALUE=""

while IFS= read -r raw_line; do
  line="${raw_line%$'\r'}"
  if [[ -z "$line" || "$line" == \#* || "$line" != *=* ]]; then
    continue
  fi

  key="${line%%=*}"
  value="${line#*=}"

  if [[ "$value" == '"'*'"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == "'"*"'" ]]; then
    value="${value:1:${#value}-2}"
  fi

  case "$key" in
    MYSQL_PORT) MYSQL_PORT_VALUE="$value" ;;
    MYSQL_USER) MYSQL_USER_VALUE="$value" ;;
    MYSQL_PASSWORD) MYSQL_PASSWORD_VALUE="$value" ;;
    MYSQL_DB) MYSQL_DB_VALUE="$value" ;;
    MYSQL_DB_STAT) MYSQL_DB_STAT_VALUE="$value" ;;
    DASHBOARD_ADMIN_EMAIL) ADMIN_EMAIL_VALUE="$value" ;;
    DASHBOARD_ADMIN_PASSWORD) ADMIN_PASSWORD_VALUE="$value" ;;
    DASHBOARD_AUTH_SECRET) AUTH_SECRET_VALUE="$value" ;;
  esac
done <<< "$REMOTE_ENV_CONTENT"

if [[ -n "$MYSQL_DB_STAT_VALUE" ]]; then
  MYSQL_DB_VALUE="$MYSQL_DB_STAT_VALUE"
fi

cat > "$TARGET_FILE" <<ENV
DB_HOST=localhost
DB_PORT=${MYSQL_PORT_VALUE}
DB_USER=${MYSQL_USER_VALUE}
DB_PASSWORD=${MYSQL_PASSWORD_VALUE}
DB_NAME=${MYSQL_DB_VALUE}
NODE_ENV=production
PORT=3001
NEXT_PUBLIC_BASE_URL=http://localhost:3001
DASHBOARD_ADMIN_EMAIL=${ADMIN_EMAIL_VALUE}
DASHBOARD_ADMIN_PASSWORD=${ADMIN_PASSWORD_VALUE}
DASHBOARD_AUTH_SECRET=${AUTH_SECRET_VALUE}
ENV

echo "Wrote $TARGET_FILE"
