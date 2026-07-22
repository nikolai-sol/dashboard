#!/usr/bin/env python3
"""Attested append-only cron launcher for the current Abbott release."""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from canonical_writer import (
    finish_collector_run,
    get_db_connection,
    log_run_event,
    start_collector_run,
)


ABBOTT_COUNTER_ID = "90602537"
ABBOTT_REQUIRED_SCOPES = ("other", "traffic", "page", "user_behavior", "returning")
GOOD_COVERAGE_STATUSES = {"success", "success_empty"}


class ActiveReleaseLaunchError(RuntimeError):
    """Sanitized launcher failure that never includes environment values."""


def _inside(root: Path, path: Path) -> bool:
    return path == root or root in path.parents


def _contains_symlink_escape(root: Path, candidate: Path) -> bool:
    paths = []
    current = candidate
    while current != root:
        paths.append(current)
        current = current.parent
    if candidate.is_dir() and not candidate.is_symlink():
        try:
            paths.extend(candidate.rglob("*"))
        except OSError:
            return True
    for path in paths:
        if not path.is_symlink():
            continue
        try:
            if not _inside(root, path.resolve(strict=False)):
                return True
        except OSError:
            return True
    return False


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
            [
                "git",
                "-C",
                str(root),
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--ignored=matching",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        raise ActiveReleaseLaunchError("Unable to attest canonical worktree state") from None
    unsafe_entries = []
    for entry in result.stdout.splitlines():
        if entry.startswith(("?? ", "!! ")):
            relative = entry[3:]
            if relative == ".env" or relative.startswith(
                ("venv/", "logs/", ".superpowers/")
            ):
                candidate = root / relative
                try:
                    resolved = candidate.resolve(strict=False)
                except OSError:
                    resolved = None
                has_symlink_escape = _contains_symlink_escape(root, candidate)
                if relative.startswith("venv/") and has_symlink_escape:
                    raise ActiveReleaseLaunchError(
                        "Canonical runtime venv contains an external symlink; "
                        "recreate it with python3 -m venv --copies"
                    )
                if resolved is not None and _inside(root, resolved) and not has_symlink_escape:
                    continue
        unsafe_entries.append(entry)
    return "\n".join(unsafe_entries)


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
        raise ActiveReleaseLaunchError("Canonical runtime worktree contains unsafe changes")
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
            SELECT active.canonical_release_id, data_release.release_status,
                   data_release.code_revision
            FROM portal_active_data_releases AS active
            JOIN portal_data_releases AS data_release
              ON data_release.dataset_key = active.dataset_key
             AND data_release.id = active.canonical_release_id
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


def completed_utc_day() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def active_day_is_reconciled(release_id: int, day: str) -> bool:
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT scope_key, collection_status, pagination_complete,
                   is_sampled, empty_reconciled
            FROM canonical_source_coverage_daily
            WHERE canonical_release_id = %s
              AND source_key = %s
              AND counter_id = %s
              AND report_date = %s
            ORDER BY scope_key
            """,
            (release_id, "yandex_metrika", ABBOTT_COUNTER_ID, day),
        )
        rows = cur.fetchall()
        if len(rows) != len(ABBOTT_REQUIRED_SCOPES):
            return False
        by_scope = {str(row.get("scope_key")): row for row in rows}
        if set(by_scope) != set(ABBOTT_REQUIRED_SCOPES):
            return False
        for scope in ABBOTT_REQUIRED_SCOPES:
            row = by_scope[scope]
            status = row.get("collection_status")
            if (
                status not in GOOD_COVERAGE_STATUSES
                or not bool(row.get("pagination_complete"))
                or bool(row.get("is_sampled"))
                or (status == "success_empty" and not bool(row.get("empty_reconciled")))
            ):
                return False
        return True
    except Exception:
        raise ActiveReleaseLaunchError("Unable to verify Abbott completed-day coverage") from None
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def record_reconciled_noop(release_id: int, day: str) -> None:
    run_id = start_collector_run(
        source_key="yandex_metrika",
        run_type="cron",
        run_mode="canonical_release",
        job_key="yandex_metrika_cron",
        correlation_id=str(uuid.uuid4()),
        date_from=day,
        date_to=day,
    )
    summary = {
        "counter_id": ABBOTT_COUNTER_ID,
        "canonical_release_id": release_id,
        "published_days": 0,
        "already_reconciled_days": [day],
        "failed_days": [],
        "failures": [],
        "rows_written": 0,
    }
    log_run_event(
        run_id,
        "INFO",
        "summary",
        "Abbott Metrika completed day was already reconciled",
        summary,
    )
    finish_collector_run(
        run_id,
        status="success",
        rows_read=0,
        rows_written=0,
        rows_updated=0,
        error_count=0,
        error_summary=None,
    )


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
    parser.add_argument("--runtime-revision")
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--parser-version", required=True)
    return parser


def run(args: argparse.Namespace) -> None:
    root = args.canonical_root.resolve(strict=True)
    collector = args.collector.resolve(strict=True)
    if root not in collector.parents:
        raise ActiveReleaseLaunchError("Collector is outside the canonical runtime root")
    runtime_revision = getattr(args, "runtime_revision", None) or args.code_revision
    attest_runtime(root, runtime_revision, args.manifest)
    release_id = resolve_active_release(args.code_revision)
    day = completed_utc_day()
    if active_day_is_reconciled(release_id, day):
        record_reconciled_noop(release_id, day)
        return
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
