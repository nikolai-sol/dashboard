#!/usr/bin/env python3
"""Attested append-only cron launcher for the current Abbott release."""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

from canonical_writer import get_db_connection


ABBOTT_COUNTER_ID = "90602537"


class ActiveReleaseLaunchError(RuntimeError):
    """Sanitized launcher failure that never includes environment values."""


def _git_revision(root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise ActiveReleaseLaunchError("Unable to attest canonical git revision") from None
    return result.stdout.strip()


def _tracked_worktree_status(root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise ActiveReleaseLaunchError("Unable to attest canonical worktree state") from None
    return result.stdout.strip()


def _head_blob(root: Path, relative_path: Path) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "show", f"HEAD:{relative_path.as_posix()}"],
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise ActiveReleaseLaunchError("Unable to read committed runtime manifest") from None
    return result.stdout


def attest_runtime(root: Path, expected_revision: str, manifest_path: Path) -> None:
    root = root.resolve(strict=True)
    if _git_revision(root) != expected_revision:
        raise ActiveReleaseLaunchError("Canonical runtime revision does not match")
    if _tracked_worktree_status(root):
        raise ActiveReleaseLaunchError("Canonical tracked worktree is not clean")
    try:
        resolved_manifest = manifest_path.resolve(strict=True)
        relative_manifest = resolved_manifest.relative_to(root)
        manifest_bytes = resolved_manifest.read_bytes()
        manifest_lines = manifest_bytes.decode("utf-8").splitlines()
    except (OSError, UnicodeDecodeError, ValueError):
        raise ActiveReleaseLaunchError("Canonical runtime manifest is unavailable") from None
    if _head_blob(root, relative_manifest) != manifest_bytes:
        raise ActiveReleaseLaunchError("Canonical runtime manifest is not the committed HEAD blob")
    if not manifest_lines:
        raise ActiveReleaseLaunchError("Canonical runtime manifest is empty")
    for line in manifest_lines:
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise ActiveReleaseLaunchError("Canonical runtime manifest is invalid")
        expected_hash, relative_name = match.groups()
        target = (root / relative_name).resolve(strict=True)
        if root not in target.parents or not target.is_file():
            raise ActiveReleaseLaunchError("Canonical runtime manifest path is invalid")
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected_hash:
            raise ActiveReleaseLaunchError("Canonical runtime file hash does not match")


def resolve_active_release(expected_revision: str) -> int:
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT active.canonical_release_id, release.release_status,
                   release.code_revision
            FROM portal_active_data_releases AS active
            JOIN portal_data_releases AS release
              ON release.dataset_key = active.dataset_key
             AND release.id = active.canonical_release_id
            WHERE active.dataset_key = %s
            """,
            ("abbott",),
        )
        row = cur.fetchone()
        if (
            not isinstance(row, dict)
            or row.get("release_status") != "active"
            or row.get("code_revision") != expected_revision
        ):
            raise ActiveReleaseLaunchError("Abbott active release attestation failed")
        return int(row["canonical_release_id"])
    except ActiveReleaseLaunchError:
        raise
    except Exception:
        raise ActiveReleaseLaunchError("Unable to resolve Abbott active release") from None
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def build_collector_command(
    *, collector: Path, release_id: int, code_revision: str, parser_version: str
) -> list[str]:
    return [
        sys.executable,
        str(collector),
        "--run-type", "cron",
        "--days-back", "1",
        "--counter-id", ABBOTT_COUNTER_ID,
        "--canonical-release-id", str(release_id),
        "--code-revision", code_revision,
        "--parser-version", parser_version,
    ]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--collector", type=Path, required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--parser-version", required=True)
    return parser


def run(args: argparse.Namespace) -> None:
    root = args.canonical_root.resolve(strict=True)
    collector = args.collector.resolve(strict=True)
    if root not in collector.parents:
        raise ActiveReleaseLaunchError("Collector is outside the canonical runtime root")
    attest_runtime(root, args.code_revision, args.manifest)
    release_id = resolve_active_release(args.code_revision)
    try:
        subprocess.run(
            build_collector_command(
                collector=collector,
                release_id=release_id,
                code_revision=args.code_revision,
                parser_version=args.parser_version,
            ),
            cwd=root,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise ActiveReleaseLaunchError("Abbott canonical collector failed") from None


def main() -> int:
    try:
        run(build_parser().parse_args())
        return 0
    except ActiveReleaseLaunchError as exc:
        raise SystemExit(str(exc)) from None


if __name__ == "__main__":
    raise SystemExit(main())
