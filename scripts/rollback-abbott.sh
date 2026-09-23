#!/bin/bash
set -euo pipefail
[[ "$#" -eq 0 ]] || { echo 'Runtime wrapper accepts no arguments.' >&2; exit 1; }
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/abbott-deploy-runtime.sh" "$SCRIPT_DIR/../deploy/abbott/release.json" rollback
