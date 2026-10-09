#!/bin/bash
# Labels only: never serialize commands, arguments or environment values.
STAGE_TIMING_ACTIVE_NAME=""
STAGE_TIMING_STARTED_SECONDS=0
stage_timing_begin() {
  if [[ "$#" -ne 1 || ! "$1" =~ ^[a-z][a-z0-9_.-]*$ || -n "${STAGE_TIMING_ACTIVE_NAME:-}" ]]; then
    printf '%s\n' 'Invalid or overlapping deployment timing stage' >&2
    return 64
  fi
  STAGE_TIMING_ACTIVE_NAME="$1"
  STAGE_TIMING_STARTED_SECONDS=$SECONDS
  printf '[stage] %s start utc=%s\n' "$STAGE_TIMING_ACTIVE_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
}
stage_timing_end() {
  [[ -n "${STAGE_TIMING_ACTIVE_NAME:-}" ]] || return 0
  local status="$1" elapsed=$((SECONDS - STAGE_TIMING_STARTED_SECONDS))
  printf '[stage] %s end utc=%s elapsed_s=%s status=%s\n' "$STAGE_TIMING_ACTIVE_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$elapsed" "$status" >&2
  STAGE_TIMING_ACTIVE_NAME=""
}
