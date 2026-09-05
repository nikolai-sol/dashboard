#!/bin/bash
set -euo pipefail
for forbidden in RUNTIME_SCOPE APP_NAME APP_PORT APP_DIR RELEASE_BRANCH DEPLOY_LOCK_DIR \
  RELEASES_DIR BACKUPS_DIR RELEASE_ID KEEP_BACKUPS VPS PUBLIC_APP_HOST TARGET_BACKUP \
  DEPLOY_REMOTE DEPLOY_BASE_BRANCH DEPLOY_ACTIVE_RELEASE_READER DASHBOARD_DEPLOY_LOCK_DIR \
  SSH_BIN DEPLOY_SSH_BIN GIT_SSH GIT_SSH_COMMAND RSYNC_RSH REMOTE_ENV_PATH \
  TRUSTED_MANIFEST TRUSTED_MANIFEST_PATH NODE_OPTIONS NODE_PATH BASH_ENV ENV; do
  if [[ -n "${!forbidden+x}" ]]; then
    echo "Refusing Zaruku operation: $forbidden is fixed by reviewed release authority." >&2
    exit 1
  fi
done
[[ "$#" -eq 2 && ( "$2" == deploy || "$2" == rollback ) ]] || { echo 'Invalid fixed release authority invocation.' >&2; exit 1; }
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node --import tsx "$SCRIPT_DIR/deploy-runtime.mjs" "$1" "$2"
