#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node --test "$SCRIPT_DIR/zaruku-linux-fixture-policy.test.mjs"
