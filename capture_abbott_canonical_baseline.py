#!/usr/bin/env python3
"""CLI for freezing Abbott aggregate controls and explicit source snapshots."""

from __future__ import annotations

import argparse
from pathlib import Path

from abbott_canonical_controls import (
    ABBOTT_COUNTER_ID,
    capture_current_control_pack,
    file_snapshot,
)
from abbott_release_operator import get_operator_db_connection


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Freeze the Abbott canonical baseline")
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to", required=True)
    parser.add_argument("--private-archive-dir", type=Path, required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument(
        "--source-file",
        action="append",
        default=[],
        metavar="KIND:PARSER:PATH",
        help="Snapshot only this explicit source path; may be repeated",
    )
    return parser


def _explicit_file_snapshots(specs: list[str]) -> list[dict]:
    snapshots = []
    for spec in specs:
        try:
            source_kind, parser_version, raw_path = spec.split(":", 2)
        except ValueError:
            raise ValueError("Source file must use KIND:PARSER:PATH") from None
        snapshots.append(
            file_snapshot(
                Path(raw_path),
                source_kind=source_kind,
                parser_version=parser_version,
            )
        )
    return snapshots


def main() -> int:
    args = build_parser().parse_args()
    explicit_file_snapshots = _explicit_file_snapshots(args.source_file)
    conn = get_operator_db_connection()
    try:
        snapshot_id = capture_current_control_pack(
            conn,
            counter_id=ABBOTT_COUNTER_ID,
            date_from=args.date_from,
            date_to=args.date_to,
            private_archive_dir=args.private_archive_dir,
            code_revision=args.code_revision,
            file_snapshots=explicit_file_snapshots,
        )
    finally:
        conn.close()
    print(f"Frozen Abbott baseline snapshot {snapshot_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
