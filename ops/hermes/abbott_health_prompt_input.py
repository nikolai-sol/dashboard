#!/usr/bin/env python3
"""Prepare strictly sanitized Abbott health JSON for a Hermes prompt."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from abbott_health_probe import ABBOTT_COUNTER_ID, REQUIRED_SCOPES, sanitize_snapshot


ROOT_KEYS = {
    "generated_at_utc", "dashboard", "counter_id", "overall", "release",
    "latest_run", "scopes", "backfill", "skipped_counter", "incidents",
}
RELEASE_KEYS = {"id", "status", "pointer_matches"}
RUN_KEYS = {"id", "status", "run_type", "date_from", "date_to", "finished_at"}
SCOPE_KEYS = {"scope", "max_date", "rows", "missing_dates", "status_counts"}
BACKFILL_KEYS = {"lookback_days", "complete_days", "missing_days"}
INCIDENT_KEYS = {"incident_key", "severity", "check_id", "observed", "expected"}
EVIDENCE_KEYS = {
    "status", "pointer_matches", "finished_date", "max_lag_days", "skipped",
    "missing_dates", "status_counts", "allowed", "rows", "minimum_rows",
}
COVERAGE_STATUSES = {"success", "success_empty", "partial", "skipped", "sampled", "failed", "unknown"}
SAFE_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
SAFE_REMOTE_COMMAND = re.compile(r"^[A-Za-z0-9_./ -]+$")


def _exact_keys(value: object, keys: set[str], location: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{location} must be an object")
    if set(value) != keys:
        raise ValueError(f"{location} schema mismatch")
    return value


def _reject_nested_objects(value: object, location: str) -> None:
    if isinstance(value, dict):
        raise ValueError(f"{location} must not contain nested objects")
    if isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_nested_objects(nested, f"{location}[{index}]")


def _validate_evidence(value: object, location: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{location} must be an object")
    unknown = set(value) - EVIDENCE_KEYS
    if unknown:
        raise ValueError(f"{location} contains unknown keys")
    status_counts = value.get("status_counts")
    if status_counts is not None:
        if not isinstance(status_counts, dict) or set(status_counts) - COVERAGE_STATUSES:
            raise ValueError(f"{location}.status_counts schema mismatch")
        if any(not isinstance(count, int) or count < 0 for count in status_counts.values()):
            raise ValueError(f"{location}.status_counts values are invalid")
    for key, nested in value.items():
        if key == "status_counts":
            continue
        _reject_nested_objects(nested, f"{location}.{key}")


def validate_payload(payload: dict) -> dict:
    root = _exact_keys(payload, ROOT_KEYS, "payload")
    if root["dashboard"] != "abbott" or str(root["counter_id"]) != ABBOTT_COUNTER_ID:
        raise ValueError("payload identity mismatch")
    if root["overall"] not in {"OK", "WARN", "CRITICAL"}:
        raise ValueError("payload overall is invalid")

    release = _exact_keys(root["release"], RELEASE_KEYS, "payload.release")
    if release["status"] not in {None, "active", "staging", "validated", "retired", "failed"}:
        raise ValueError("payload.release.status is invalid")
    _exact_keys(root["latest_run"], RUN_KEYS, "payload.latest_run")
    backfill = _exact_keys(root["backfill"], BACKFILL_KEYS, "payload.backfill")
    if not isinstance(backfill["missing_days"], list):
        raise ValueError("payload.backfill.missing_days must be a list")
    _reject_nested_objects(backfill["missing_days"], "payload.backfill.missing_days")

    if not isinstance(root["scopes"], list):
        raise ValueError("payload.scopes must be a list")
    for index, item in enumerate(root["scopes"]):
        scope = _exact_keys(item, SCOPE_KEYS, f"payload.scopes[{index}]")
        if scope["scope"] not in REQUIRED_SCOPES:
            raise ValueError("payload scope is invalid")
        _reject_nested_objects(scope["missing_dates"], f"payload.scopes[{index}].missing_dates")
        if not isinstance(scope["status_counts"], dict) or set(scope["status_counts"]) - COVERAGE_STATUSES:
            raise ValueError("payload scope status counts are invalid")

    if not isinstance(root["incidents"], list):
        raise ValueError("payload.incidents must be a list")
    for index, item in enumerate(root["incidents"]):
        incident = _exact_keys(item, INCIDENT_KEYS, f"payload.incidents[{index}]")
        if incident["severity"] not in {"WARN", "CRITICAL"}:
            raise ValueError("payload incident severity is invalid")
        _validate_evidence(incident["observed"], f"payload.incidents[{index}].observed")
        _validate_evidence(incident["expected"], f"payload.incidents[{index}].expected")

    return sanitize_snapshot(root)


def build_prompt_input(payload: dict) -> str:
    return json.dumps(
        validate_payload(payload),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )


def read_remote_payload(host: str, remote_command: str) -> dict:
    parts = remote_command.split()
    if not SAFE_HOST.fullmatch(host):
        raise ValueError("invalid SSH host")
    if (
        not SAFE_REMOTE_COMMAND.fullmatch(remote_command)
        or len(parts) != 3
        or not parts[0].startswith("/")
        or Path(parts[0]).name not in {"python", "python3"}
        or not parts[1].startswith("/")
        or Path(parts[1]).name != "abbott_health_probe.py"
        or parts[2] != "--json"
    ):
        raise ValueError("invalid remote probe command")
    proc = subprocess.run(
        ["ssh", host, remote_command],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if proc.returncode not in {0, 1, 2}:
        raise RuntimeError(
            f"remote probe failed host={host} check_id=abbott_health_probe returncode={proc.returncode}"
        )
    try:
        payload = json.loads(proc.stdout)
    except (TypeError, json.JSONDecodeError):
        raise RuntimeError(
            f"remote probe invalid_json host={host} check_id=abbott_health_probe returncode={proc.returncode}"
        ) from None
    return validate_payload(payload)


def _failure_payload(host: str, return_code: int | None = None) -> dict:
    observed = {"status": "adapter_failure"}
    if return_code is not None:
        observed["rows"] = return_code
    return {
        "generated_at_utc": "1970-01-01T00:00:00Z",
        "dashboard": "abbott",
        "counter_id": ABBOTT_COUNTER_ID,
        "overall": "CRITICAL",
        "release": {"id": None, "status": None, "pointer_matches": False},
        "latest_run": {"id": None, "status": None, "run_type": None, "date_from": None, "date_to": None, "finished_at": None},
        "scopes": [],
        "backfill": {"lookback_days": 10, "complete_days": 0, "missing_days": []},
        "skipped_counter": False,
        "incidents": [{
            "incident_key": f"abbott|{ABBOTT_COUNTER_ID}|adapter|failure",
            "severity": "CRITICAL",
            "check_id": "hermes_input_adapter",
            "observed": observed,
            "expected": {"status": "valid_sanitized_payload"},
        }],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ssh-host", default="")
    parser.add_argument("--remote-command", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.ssh_host or args.remote_command:
            if not args.ssh_host or not args.remote_command:
                raise RuntimeError("remote probe configuration is incomplete")
            payload = read_remote_payload(args.ssh_host, args.remote_command)
        else:
            payload = validate_payload(json.load(sys.stdin))
    except Exception:
        payload = validate_payload(_failure_payload(args.ssh_host or "local"))
    print(build_prompt_input(payload))
    return 0 if payload["overall"] != "CRITICAL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
