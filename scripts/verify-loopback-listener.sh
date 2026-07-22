#!/bin/bash
set -euo pipefail

APP_PORT="${APP_PORT:-3001}"
PUBLIC_APP_HOST="${PUBLIC_APP_HOST:-}"

listeners="$(ss -ltnH "( sport = :$APP_PORT )")"
if [[ -z "$listeners" ]]; then
  echo "Application listener is missing on port $APP_PORT" >&2
  exit 1
fi

while IFS= read -r listener; do
  local_address="$(awk '{print $4}' <<<"$listener")"
  if [[ "$local_address" != "127.0.0.1:$APP_PORT" ]]; then
    echo "Application listener is not loopback-only on port $APP_PORT" >&2
    exit 1
  fi
done <<<"$listeners"

if [[ -n "$PUBLIC_APP_HOST" ]] && \
  curl --noproxy '*' --max-time 3 -fsS "http://$PUBLIC_APP_HOST:$APP_PORT/api/health" >/dev/null 2>&1; then
  echo "Application port is reachable publicly and can bypass nginx" >&2
  exit 1
fi

echo "Loopback-only application listener verified"
