#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_SOURCE_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BASE_BRANCH="${DEPLOY_BASE_BRANCH:-main}"
DEPLOY_BASE_REF="refs/remotes/$DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH"

if [ -n "$(git -C "$APP_SOURCE_DIR" status --porcelain --untracked-files=normal)" ]; then
  echo "Refusing deploy: working tree is not clean: $APP_SOURCE_DIR" >&2
  exit 1
fi

echo "Refreshing $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH before deploy..."
git -C "$APP_SOURCE_DIR" fetch --quiet "$DEPLOY_REMOTE" "$DEPLOY_BASE_BRANCH"

if ! git -C "$APP_SOURCE_DIR" rev-parse --verify --quiet "$DEPLOY_BASE_REF^{commit}" >/dev/null; then
  echo "Refusing deploy: cannot resolve $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH after fetch" >&2
  exit 1
fi

if ! git -C "$APP_SOURCE_DIR" merge-base --is-ancestor "$DEPLOY_BASE_REF" HEAD; then
  echo "Refusing deploy: HEAD does not contain current $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH" >&2
  echo "Merge the current main into the release, then run verification again." >&2
  exit 1
fi

echo "Deploy source verified: HEAD contains current $DEPLOY_REMOTE/$DEPLOY_BASE_BRANCH and the working tree is clean."
