#!/usr/bin/env bash
# Reviewed Python 3.11 entrypoint for the proposal-only weekly workflow.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

exec "$ROOT/agents/abbott_page_classifier/python311_runtime.sh" \
  "$ROOT/agents/abbott_page_classifier/weekly_proposal.py" "$@"
