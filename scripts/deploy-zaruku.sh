#!/bin/bash
set -euo pipefail
[[ "$#" -eq 0 ]] || { echo 'Refusing Zaruku deploy: fixed authority accepts no arguments.' >&2; exit 1; }
exec /bin/bash "$(dirname "$0")/deploy-runtime.sh" "$(dirname "$0")/../deploy/zaruku/release.json" deploy
