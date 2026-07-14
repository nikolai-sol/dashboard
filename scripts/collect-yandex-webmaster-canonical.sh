#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$APP_DIR/fetch_yandex_webmaster_canonical.py" ]; then
  COLLECTOR="$APP_DIR/fetch_yandex_webmaster_canonical.py"
elif [ -f "$APP_DIR/../fetch_yandex_webmaster_canonical.py" ]; then
  COLLECTOR="$APP_DIR/../fetch_yandex_webmaster_canonical.py"
else
  echo "fetch_yandex_webmaster_canonical.py was not found near $APP_DIR" >&2
  exit 1
fi

python3 "$COLLECTOR" "$@"
