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


SAFE_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
SAFE_REMOTE_COMMAND = re.compile(r"^[A-Za-z0-9_./ -]+$")


def validate_payload(payload: dict) -> dict:
    validated = sanitize_snapshot(payload)
    scope_names = [scope["scope"] for scope in validated["scopes"]]
    if len(scope_names) != len(REQUIRED_SCOPES) or set(scope_names) != set(REQUIRED_SCOPES):
        raise ValueError("payload must contain every required scope exactly once")
    return validated


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
        "latest_run": {"id": None, "status": None, "run_type": None, "date_from": None, "date_to": None, "finished_at": None, "counter_id": None},
        "scopes": [{
            "scope": scope,
            "max_date": None,
            "rows": 0,
            "missing_dates": [],
            "status_counts": {"failed": 1},
            "unexpected_empty": False,
        } for scope in REQUIRED_SCOPES],
        "backfill": {
            "lookback_days": 10,
            "complete_days": 0,
            "missing_days": [
                "1969-12-23", "1969-12-24", "1969-12-25", "1969-12-26", "1969-12-27",
                "1969-12-28", "1969-12-29", "1969-12-30", "1969-12-31", "1970-01-01",
            ],
        },
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
