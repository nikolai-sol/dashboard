#!/bin/bash
set -euo pipefail
[[ "$#" -eq 0 ]] || { echo 'Refusing Zaruku Linux fixture arguments' >&2; exit 1; }
exec node "$(dirname -- "${BASH_SOURCE[0]}")/zaruku-linux-fixture-policy.mjs" run
