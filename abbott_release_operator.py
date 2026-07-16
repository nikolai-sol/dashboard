#!/usr/bin/env python3
"""Least-privilege CLI for Abbott release lifecycle transitions."""

from __future__ import annotations

import argparse
import os
import re

import mysql.connector

import canonical_release_store as release_store


class OperatorConfigurationError(RuntimeError):
    """Raised without exposing database credentials."""


def get_operator_db_connection():
    required = (
        "ABBOTT_RELEASE_DB_HOST",
        "ABBOTT_RELEASE_DB_USER",
        "ABBOTT_RELEASE_DB_PASSWORD",
    )
    if any(not os.environ.get(key) for key in required):
        raise OperatorConfigurationError("Abbott release-operator database settings are incomplete")
    database = os.environ.get("ABBOTT_RELEASE_DB_NAME", "report_bd")
    if database != "report_bd":
        raise OperatorConfigurationError("Abbott release operator must use report_bd")
    try:
        port = int(os.environ.get("ABBOTT_RELEASE_DB_PORT", "3306"))
    except ValueError:
        raise OperatorConfigurationError("Abbott release-operator database port is invalid") from None
    return mysql.connector.connect(
        host=os.environ["ABBOTT_RELEASE_DB_HOST"],
        port=port,
        database=database,
        user=os.environ["ABBOTT_RELEASE_DB_USER"],
        password=os.environ["ABBOTT_RELEASE_DB_PASSWORD"],
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def _revision(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{7,64}", value):
        raise argparse.ArgumentTypeError("revision must be a 7-64 character lowercase git hash")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create")
    create.add_argument("--predecessor-release-id", type=int, required=True)
    create.add_argument("--baseline-snapshot-id", type=int, required=True)
    create.add_argument("--code-revision", type=_revision, required=True)

    validate = commands.add_parser("validate")
    validate.add_argument("--release-id", type=int, required=True)
    validate.add_argument("--date-from", required=True)
    validate.add_argument("--date-to", required=True)
    validate.add_argument("--code-revision", type=_revision, required=True)

    activate = commands.add_parser("activate")
    activate.add_argument("--release-id", type=int, required=True)
    activate.add_argument("--expected-active-release-id", type=int, required=True)

    rollback = commands.add_parser("rollback")
    rollback.add_argument("--from-release-id", type=int, required=True)
    rollback.add_argument("--to-release-id", type=int, required=True)
    return parser


def run(args: argparse.Namespace) -> str:
    # All store operations in this process use the dedicated release-operator role.
    release_store.get_db_connection = get_operator_db_connection
    if args.command == "create":
        release_id = release_store.create_candidate_release(
            portal_key="abbott",
            predecessor_release_id=args.predecessor_release_id,
            baseline_validation_run_id=args.baseline_snapshot_id,
            code_revision=args.code_revision,
        )
        return f"release_id={release_id} status=staging"
    if args.command == "validate":
        release_store.validate_release(
            args.release_id,
            date_from=args.date_from,
            date_to=args.date_to,
            expected_code_revision=args.code_revision,
        )
        return f"release_id={args.release_id} status=validated"
    if args.command == "activate":
        release_store.activate_release(
            args.release_id,
            expected_active_release_id=args.expected_active_release_id,
        )
        return f"release_id={args.release_id} status=active"
    release_store.rollback_release(
        from_release_id=args.from_release_id,
        to_release_id=args.to_release_id,
    )
    return f"release_id={args.to_release_id} status=active"


def main() -> int:
    try:
        print(run(build_parser().parse_args()))
        return 0
    except (release_store.ReleaseStoreError, OperatorConfigurationError) as exc:
        raise SystemExit(str(exc)) from None


if __name__ == "__main__":
    raise SystemExit(main())
