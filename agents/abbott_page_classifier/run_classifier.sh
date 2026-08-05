#!/usr/bin/env bash
# Compatibility entrypoint for the canonical Abbott approval operator workflow.
#
# This wrapper intentionally performs no discovery, local registry mutation, or
# Sheets operation itself.  Every write-capable workflow stage is dry-run until
# an operator supplies --execute and its explicit --batch-id.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON="${PYTHON:-python3}"

exec "$PYTHON" "$ROOT/agents/abbott_page_classifier/workflow.py" "$@"
