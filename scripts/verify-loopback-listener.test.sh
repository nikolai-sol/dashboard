#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/ss" <<'SH'
#!/bin/bash
case "${SS_MODE:-loopback}" in
  loopback) printf '%s\n' 'LISTEN 0 511 127.0.0.1:3001 0.0.0.0:*' ;;
  public) printf '%s\n' 'LISTEN 0 511 0.0.0.0:3001 0.0.0.0:*' ;;
  missing) exit 0 ;;
esac
SH
cat > "$TMP_DIR/bin/curl" <<'SH'
#!/bin/bash
if [[ "${PUBLIC_CURL_RESULT:-failure}" == "success" ]]; then
  exit 0
fi
exit 7
SH
chmod +x "$TMP_DIR/bin/ss" "$TMP_DIR/bin/curl"
export PATH="$TMP_DIR/bin:$PATH"

SS_MODE=loopback PUBLIC_CURL_RESULT=failure APP_PORT=3001 PUBLIC_APP_HOST=198.51.100.10 \
  bash "$SCRIPT_DIR/verify-loopback-listener.sh" >"$TMP_DIR/loopback.log" 2>&1

if SS_MODE=public PUBLIC_CURL_RESULT=failure APP_PORT=3001 PUBLIC_APP_HOST=198.51.100.10 \
  bash "$SCRIPT_DIR/verify-loopback-listener.sh" >"$TMP_DIR/public.log" 2>&1; then
  echo "listener verifier accepted a public bind" >&2
  exit 1
fi

if SS_MODE=missing PUBLIC_CURL_RESULT=failure APP_PORT=3001 PUBLIC_APP_HOST=198.51.100.10 \
  bash "$SCRIPT_DIR/verify-loopback-listener.sh" >"$TMP_DIR/missing.log" 2>&1; then
  echo "listener verifier accepted a missing listener" >&2
  exit 1
fi

if SS_MODE=loopback PUBLIC_CURL_RESULT=success APP_PORT=3001 PUBLIC_APP_HOST=198.51.100.10 \
  bash "$SCRIPT_DIR/verify-loopback-listener.sh" >"$TMP_DIR/bypass.log" 2>&1; then
  echo "listener verifier accepted direct public-port bypass" >&2
  exit 1
fi

grep -Fq "verify-loopback-listener.sh" "$SCRIPT_DIR/setup-vps.sh"
grep -Fq "verify-loopback-listener.sh" "$SCRIPT_DIR/deploy.sh"
grep -Eq "HOSTNAME:[[:space:]]*['\"]127\.0\.0\.1['\"]" "$SCRIPT_DIR/../ecosystem.config.js"

echo "loopback listener tests passed"
