#!/usr/bin/env python3
"""CLI for persisting Abbott candidate comparison controls."""

from __future__ import annotations

import argparse

from abbott_canonical_controls import compare_release_control_pack, cutover_allowed
from abbott_release_operator import get_operator_db_connection


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compare an Abbott candidate release")
    parser.add_argument("--baseline-run-id", type=int, required=True)
    parser.add_argument("--candidate-release-id", type=int, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    conn = get_operator_db_connection()
    try:
        results = compare_release_control_pack(
            conn,
            baseline_run_id=args.baseline_run_id,
            candidate_release_id=args.candidate_release_id,
        )
    finally:
        conn.close()
    for result in results:
        print(f"{result.control_name}: {result.result_status}")
    return 0 if cutover_allowed(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
