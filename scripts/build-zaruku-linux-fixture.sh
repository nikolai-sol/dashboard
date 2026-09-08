#!/bin/bash
set -euo pipefail
exec node "$(dirname -- "${BASH_SOURCE[0]}")/zaruku-linux-fixture-policy.mjs" build "$@"
