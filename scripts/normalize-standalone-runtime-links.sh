#!/bin/bash
set -euo pipefail

RELEASE_DIR="${1:?standalone release directory is required}"
LINK_DIR="$RELEASE_DIR/.next/node_modules"

if [[ ! -d "$LINK_DIR" ]]; then
  exit 0
fi

for link in "$LINK_DIR"/*; do
  [[ -L "$link" ]] || continue

  original_target="$(readlink "$link")"
  case "$original_target" in
    */node_modules/*)
      package_path="${original_target##*/node_modules/}"
      ;;
    *)
      echo "Unsupported standalone runtime dependency link: $(basename "$link")" >&2
      exit 1
      ;;
  esac

  if [[ ! "$package_path" =~ ^(@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid standalone runtime package path: $package_path" >&2
    exit 1
  fi
  if [[ ! -f "$RELEASE_DIR/node_modules/$package_path/package.json" ]]; then
    echo "Missing standalone runtime package: $package_path" >&2
    exit 1
  fi

  rm "$link"
  ln -s "../../node_modules/$package_path" "$link"

  if [[ ! -f "$link/package.json" ]]; then
    echo "Broken standalone runtime dependency link: $(basename "$link")" >&2
    exit 1
  fi
done
