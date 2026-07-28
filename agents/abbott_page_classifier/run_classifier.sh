#!/usr/bin/env bash
# Twice-weekly: discover NEW Metrika pages + optional workbook gaps → classify for batch approve.
# Does NOT flip registry locks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_DIR="$ROOT/agents/abbott_page_classifier"
WORKBOOK="${ABBOTT_NAMES_XLSX:-$ROOT/Abbott names.xlsx}"
OUT="$AGENT_DIR/out/$(date +%Y%m%d_%H%M%S)"
PYTHON="${PYTHON:-python3}"
REGISTRY="$AGENT_DIR/out/direction_registry.jsonl"

mkdir -p "$OUT"
cd "$AGENT_DIR"

echo "[$(date -Iseconds)] Abbott classifier (stable+new) start"
echo "workbook=$WORKBOOK out=$OUT"

# Ensure registry exists / seeded once
if [[ ! -s "$REGISTRY" ]]; then
  echo "Seeding registry from workbook (first run)..."
  "$PYTHON" registry.py seed-workbook --workbook "$WORKBOOK" --registry "$REGISTRY"
fi

ARGS=(
  --workbook "$WORKBOOK"
  --registry "$REGISTRY"
  --out "$OUT"
  --from-metrika-new
  --approve-queue-only
)

# Also include remaining workbook gaps if requested
if [[ "${INCLUDE_WORKBOOK_GAPS:-1}" == "1" ]]; then
  ARGS+=(--from-workbook-gaps)
fi

"$PYTHON" classify.py "${ARGS[@]}"

rm -rf "$AGENT_DIR/out/latest"
cp -R "$OUT" "$AGENT_DIR/out/latest"

# Optional auto-publish to Google Sheet
if [[ "${AUTO_PUBLISH_SHEETS:-0}" == "1" ]]; then
  SHARE="${SHEETS_SHARE_EMAIL:-nikolai.sol@gmail.com}"
  "$PYTHON" sheets_sync.py publish \
    --classifications "$OUT/classifications.jsonl" \
    --share "$SHARE" || true
fi

REVIEW_COUNT=$(python3 - <<PY
import json
print(json.load(open("$OUT/summary.json")).get("needs_review", 0))
PY
)
TOTAL=$(python3 - <<PY
import json
print(json.load(open("$OUT/summary.json")).get("total", 0))
PY
)

echo "[$(date -Iseconds)] done total=$TOTAL needs_review=$REVIEW_COUNT"
echo "classifications: $OUT/classifications.jsonl"
echo "Next: sheets_sync.py publish … then batch accept on «Апрув batch»"
