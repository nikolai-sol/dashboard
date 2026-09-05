#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/deploy-zaruku.sh ]] || { echo 'FAIL: fixed Zaruku entrypoint is missing' >&2; exit 1; }
node --import tsx --test scripts/deploy-zaruku.test.mjs
