#!/usr/bin/env bash
# Execute one Abbott content command with an explicitly reviewed Python 3.11.
set -euo pipefail

emit_status() {
  printf '{"status":"%s"}\n' "$1"
}

if [[ -z "${ABBOTT_CONTENT_PYTHON311_BIN+x}" || -z "$ABBOTT_CONTENT_PYTHON311_BIN" ]]; then
  emit_status "ABBOTT_CONTENT_PYTHON311_BIN_REQUIRED"
  exit 78
fi

case "$ABBOTT_CONTENT_PYTHON311_BIN" in
  /*) ;;
  *)
    emit_status "ABBOTT_CONTENT_PYTHON311_BIN_ABSOLUTE_REQUIRED"
    exit 78
    ;;
esac

if [[ ! -x "$ABBOTT_CONTENT_PYTHON311_BIN" ]]; then
  emit_status "ABBOTT_CONTENT_PYTHON311_BIN_NOT_EXECUTABLE"
  exit 78
fi

if ! "$ABBOTT_CONTENT_PYTHON311_BIN" -c \
  'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 78)' \
  >/dev/null 2>&1; then
  emit_status "ABBOTT_CONTENT_PYTHON311_VERSION_REQUIRED"
  exit 78
fi

if [[ "$#" -eq 0 ]]; then
  emit_status "ABBOTT_CONTENT_PYTHON311_COMMAND_REQUIRED"
  exit 64
fi

exec "$ABBOTT_CONTENT_PYTHON311_BIN" "$@"
