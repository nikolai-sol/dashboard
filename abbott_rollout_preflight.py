#!/usr/bin/env python3
"""Produce a sanitized, read-only Abbott rollout authority report."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys
from typing import Iterable


class UnsafeSuppliedFile(RuntimeError):
    pass


COLLECTOR_KEYS = {
    "MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DB", "METRIKA_TOKEN",
}
IMPORT_KEYS = {
    "ABBOTT_IMPORT_DB_HOST", "ABBOTT_IMPORT_DB_PORT", "ABBOTT_IMPORT_DB_USER", "ABBOTT_IMPORT_DB_PASSWORD",
}
RELEASE_KEYS = {
    "ABBOTT_RELEASE_DB_HOST", "ABBOTT_RELEASE_DB_PORT", "ABBOTT_RELEASE_DB_USER",
    "ABBOTT_RELEASE_DB_PASSWORD", "ABBOTT_RELEASE_DB_NAME",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-evidence", required=True)
    parser.add_argument("--collector-env", required=True)
    parser.add_argument("--import-env", required=True)
    parser.add_argument("--release-env", required=True)
    parser.add_argument("--owner-token", required=True)
    return parser.parse_args()


def private_regular_file(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        metadata = path.lstat()
    except OSError as error:
        raise UnsafeSuppliedFile from error
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise UnsafeSuppliedFile
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise UnsafeSuppliedFile
    return True


def parse_dotenv_keys(path: Path) -> set[str] | None:
    if not private_regular_file(path):
        return None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise UnsafeSuppliedFile from error
    keys: set[str] = set()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line or line.startswith("export "):
            raise UnsafeSuppliedFile
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not key.replace("_", "A").isalnum() or key[0].isdigit() or key in keys:
            raise UnsafeSuppliedFile
        if not value:
            raise UnsafeSuppliedFile
        if value[0] in {'"', "'"} and (len(value) < 2 or value[-1] != value[0]):
            raise UnsafeSuppliedFile
        keys.add(key)
    return keys


def env_gate(path: Path, required: set[str]) -> dict[str, str]:
    keys = parse_dotenv_keys(path)
    if keys is None:
        return {"status": "blocked", "reason_code": "missing_explicit_file"}
    if not required.issubset(keys):
        return {"status": "blocked", "reason_code": "missing_required_keys"}
    return {"status": "ready", "reason_code": "required_keys_present"}


def token_gate(path: Path) -> dict[str, str]:
    if not private_regular_file(path):
        return {"status": "blocked", "reason_code": "missing_explicit_file"}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise UnsafeSuppliedFile from error
    if len(lines) != 1 or not lines[0].strip():
        raise UnsafeSuppliedFile
    return {"status": "ready", "reason_code": "protected_file_present"}


def read_private_json(path: Path) -> dict[str, object] | None:
    if not private_regular_file(path):
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise UnsafeSuppliedFile from error
    if not isinstance(value, dict):
        raise UnsafeSuppliedFile
    return value


def local_gate(directory: Path) -> dict[str, str]:
    try:
        metadata = directory.lstat()
    except OSError as error:
        raise UnsafeSuppliedFile from error
    if directory.is_symlink() or not stat.S_ISDIR(metadata.st_mode):
        raise UnsafeSuppliedFile
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise UnsafeSuppliedFile
    schema = read_private_json(directory / "rehearsal-summary.json")
    if not schema:
        return {"status": "blocked", "reason_code": "schema_evidence_missing"}
    probe = schema.get("dump_schema_probe")
    schema_ready = (
        schema.get("mode") == "schema"
        and schema.get("repeat_safe") is True
        and isinstance(probe, dict)
        and probe.get("schema_only") is True
        and probe.get("sql_error_class") == "none"
    )
    if not schema_ready:
        return {"status": "blocked", "reason_code": "schema_evidence_failed"}
    lifecycle = read_private_json(directory / "lifecycle-summary.json")
    if not lifecycle:
        return {"status": "partial", "reason_code": "bitrix_contract_deferred"}
    lifecycle_ready = (
        lifecycle.get("mode") == "lifecycle"
        and lifecycle.get("validation_succeeded") is True
        and lifecycle.get("activation_succeeded") is True
        and lifecycle.get("rollback_restored_predecessor") is True
    )
    if not lifecycle_ready:
        return {"status": "blocked", "reason_code": "lifecycle_evidence_failed"}
    return {"status": "ready", "reason_code": "local_lifecycle_verified"}


def render(report: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n")


def main() -> int:
    args = parse_args()
    try:
        local = local_gate(Path(args.local_evidence))
        collector = env_gate(Path(args.collector_env), COLLECTOR_KEYS)
        importer = env_gate(Path(args.import_env), IMPORT_KEYS)
        release = env_gate(Path(args.release_env), RELEASE_KEYS)
        owner = token_gate(Path(args.owner_token))
    except UnsafeSuppliedFile:
        render({"error": {"status": "invalid", "reason_code": "unsafe_supplied_file"}})
        return 2

    runtime_ready = all(gate["status"] == "ready" for gate in (collector, importer, release))
    report = {
        "local_rehearsal": local,
        "owner_token": owner,
        "release_db": release,
        "production_runtime": {
            "status": "ready" if runtime_ready else "blocked",
            "reason_code": "explicit_env_files_ready" if runtime_ready else "external_credentials_incomplete",
        },
        "cron": {"status": "blocked", "reason_code": "operator_action_required"},
        "hermes": {"status": "blocked", "reason_code": "operator_action_required"},
    }
    render(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
