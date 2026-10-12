#!/usr/bin/env python3
"""Verify one immutable collector release before executing its entrypoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


_REVISION_RE = re.compile(r"^[0-9a-f]{40}$")


def _fail() -> "None":
    raise RuntimeError("COLLECTOR_RELEASE_INVALID")


def _read_regular(path: Path) -> bytes:
    if not hasattr(os, "O_NOFOLLOW"):
        _fail()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            _fail()
        chunks = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
    finally:
        os.close(descriptor)


def _verify(root: Path, source: str) -> str:
    if root.is_symlink() or not root.is_dir():
        _fail()
    metadata = json.loads(_read_regular(root / "release.json"))
    revision = str(metadata.get("revision") or "")
    closure = metadata.get("closure")
    entrypoint = str(metadata.get("entrypoint") or "")
    if (
        set(metadata) != {"version", "source", "revision", "entrypoint", "closure"}
        or
        metadata.get("version") != 1
        or metadata.get("source") != source
        or not _REVISION_RE.fullmatch(revision)
        or root.name != revision
        or not isinstance(closure, list)
        or not closure
        or len(set(closure)) != len(closure)
        or entrypoint not in closure
        or "collector_release_launcher.py" not in closure
    ):
        _fail()
    for name in closure:
        if not isinstance(name, str) or Path(name).is_absolute() or len(Path(name).parts) != 1:
            _fail()
    expected_tree = set(closure) | {"release.json", "runtime-manifest.sha256"}
    actual_tree = set()
    for path in root.iterdir():
        if path.is_symlink() or not path.is_file():
            _fail()
        actual_tree.add(path.name)
    if actual_tree != expected_tree:
        _fail()

    manifest_lines = []
    for name in sorted([*closure, "release.json"]):
        digest = hashlib.sha256(_read_regular(root / name)).hexdigest()
        manifest_lines.append(f"{digest}  {name}\n")
    if _read_regular(root / "runtime-manifest.sha256") != "".join(manifest_lines).encode("ascii"):
        _fail()
    return entrypoint


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--python", required=True)
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve(strict=True).parent
        entrypoint = _verify(root, args.source)
        python = Path(args.python)
        if not python.is_absolute() or not python.exists() or not os.access(python, os.X_OK):
            _fail()
        arguments = list(args.arguments)
        if arguments and arguments[0] == "--":
            arguments.pop(0)
        os.execv(str(python), [str(python), str(root / entrypoint), *arguments])
    except (OSError, ValueError, KeyError, json.JSONDecodeError, RuntimeError):
        print("COLLECTOR_RELEASE_INVALID", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
