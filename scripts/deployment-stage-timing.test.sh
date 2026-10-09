#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/deployment-stage-timing.sh"
[[ -f "$HELPER" ]] || { echo 'stage timing helper is missing' >&2; exit 1; }
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deployment-stage-timing.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { echo "$1" >&2; exit 1; }
/bin/bash -s -- "$HELPER" > "$TMP_DIR/success.log" 2>&1 <<'SH'
set -euo pipefail
source "$1"
stage_timing_begin test.success
sleep 1
stage_timing_end 0
SH
node - "$TMP_DIR/success.log" <<'JS'
const fs = require('node:fs'), assert = require('node:assert/strict');
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
assert.equal(lines.length, 2, JSON.stringify(lines));
assert.match(lines[0], /^\[stage\] test.success start utc=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
const end = lines[1].match(/^\[stage\] test.success end utc=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ elapsed_s=(\d+) status=0$/);
assert.ok(end); assert.ok(Number(end[1]) >= 1);
JS
set +e
/bin/bash -s -- "$HELPER" "$TMP_DIR/cleanup" > "$TMP_DIR/failure.log" 2>&1 <<'SH'
set -euo pipefail
source "$1"
cleanup_file="$2"
cleanup() { local status=$?; trap - EXIT; stage_timing_end "$status"; touch "$cleanup_file"; exit "$status"; }
trap cleanup EXIT
PRIVATE_VALUE=SECRET_SENTINEL_NOT_LOGGED
stage_timing_begin test.failure
/bin/bash -c 'exit 73'
echo 'UNREACHABLE_LATER_STAGE'
SH
status=$?
set -e
[[ "$status" -eq 73 ]] || fail "failed stage did not preserve status73"
[[ -f "$TMP_DIR/cleanup" ]] || fail 'failed stage lost cleanup'
grep -Eq '^\[stage\] test.failure end utc=.* elapsed_s=[0-9]+ status=73$' "$TMP_DIR/failure.log" || fail 'failed stage has no timed end'
if grep -Eq 'SECRET_SENTINEL|UNREACHABLE' "$TMP_DIR/failure.log"; then fail 'timing leaked a value or lost fail-fast'; fi
set +e
/bin/bash -s -- "$HELPER" > "$TMP_DIR/label.log" 2>&1 <<'SH'
set -euo pipefail
source "$1"
stage_timing_begin 'bad label SECRET_SENTINEL'
SH
status=$?
set -e
[[ "$status" -ne 0 ]] || fail 'invalid stage label accepted'
if grep -Fq SECRET_SENTINEL "$TMP_DIR/label.log"; then fail 'invalid label echoed private text'; fi
echo 'stage timing tests passed'
