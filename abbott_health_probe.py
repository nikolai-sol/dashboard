#!/usr/bin/env python3
"""Deterministic, aggregate-only health probe for the Abbott Metrika release."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone


ABBOTT_COUNTER_ID = "90602537"
REQUIRED_SCOPES = ("other", "traffic", "page", "user_behavior", "returning")
DEFAULT_LOOKBACK_DAYS = 10
DEFAULT_EXPECTED_MAX_LAG_DAYS = 1
GOOD_COVERAGE_STATUSES = {"success", "success_empty"}
BAD_COVERAGE_STATUSES = {"partial", "skipped", "sampled", "failed"}

ACTIVE_RELEASE_SQL = """
SELECT
  r.id AS canonical_release_id,
  r.release_status,
  a.canonical_release_id AS pointer_release_id
FROM portal_active_data_releases a
JOIN portal_data_releases r
  ON r.dataset_key = a.dataset_key
 AND r.id = a.canonical_release_id
WHERE a.dataset_key = 'abbott'
LIMIT 1
"""

LATEST_RELEASE_RUN_SQL = """
SELECT
  r.id, r.status, r.run_type, r.date_from, r.date_to, r.finished_at
FROM canonical_collector_runs r
JOIN canonical_collector_run_events e
  ON e.run_id = r.id
 AND e.event_type IN ('summary', 'release_collection_incomplete')
WHERE r.source_key = 'yandex_metrika'
  AND r.run_mode = 'canonical_release'
  AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload, '$.canonical_release_id')) = %s
ORDER BY r.id DESC
LIMIT 1
"""

LATEST_SUMMARY_EVENT_SQL = """
SELECT event_payload
FROM canonical_collector_run_events
WHERE run_id = %s
  AND event_type IN ('summary', 'release_collection_incomplete')
ORDER BY id DESC
LIMIT 1
"""

COVERAGE_SQL = """
SELECT
  scope_key, report_date, collection_status, persisted_rows,
  pagination_complete, is_sampled, empty_reconciled
FROM canonical_source_coverage_daily
WHERE canonical_release_id = %s
  AND source_key = 'yandex_metrika'
  AND counter_id = %s
  AND report_date BETWEEN %s AND %s
ORDER BY report_date, scope_key
"""

FORBIDDEN_KEY_PARTS = (
    "user_id", "start_url", "end_url", "page_url", "token", "password",
    "dsn", "secret", "query", "path", "locator", "sql",
)


def parse_event_payload(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", errors="strict")
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _json_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value.tzinfo else value.isoformat() + "Z"
    if isinstance(value, date):
        return value.isoformat()
    return value


def _coverage_status(row: dict) -> str:
    status = str(row.get("collection_status") or "unknown")
    if bool(row.get("is_sampled")):
        return "sampled"
    if not bool(row.get("pagination_complete")):
        return "partial"
    if status == "success_empty" and not bool(row.get("empty_reconciled")):
        return "partial"
    return status


def build_scope_status(rows: list[dict], expected_date: date, lookback_days: int) -> list[dict]:
    if lookback_days <= 0:
        raise ValueError("lookback_days must be positive")
    first_date = expected_date - timedelta(days=lookback_days - 1)
    expected_dates = [first_date + timedelta(days=offset) for offset in range(lookback_days)]
    result = []
    for scope in REQUIRED_SCOPES:
        scoped = [row for row in rows if str(row.get("scope_key")) == scope]
        by_date = {_as_date(row.get("report_date")): row for row in scoped}
        present_dates = [day for day in by_date if day is not None]
        counts = Counter(_coverage_status(row) for row in scoped)
        result.append({
            "scope": scope,
            "max_date": max(present_dates).isoformat() if present_dates else None,
            "rows": sum(int(row.get("persisted_rows") or 0) for row in scoped),
            "missing_dates": [day.isoformat() for day in expected_dates if day not in by_date],
            "status_counts": dict(sorted(counts.items())),
        })
    return result


def _incident(scope: str, condition: str, check_id: str, observed: dict, expected: dict) -> dict:
    return {
        "incident_key": f"abbott|{ABBOTT_COUNTER_ID}|{scope}|{condition}",
        "severity": "CRITICAL",
        "check_id": check_id,
        "observed": observed,
        "expected": expected,
    }


def evaluate_snapshot(snapshot: dict) -> list[dict]:
    incidents = []
    release = snapshot.get("release") or {}
    if release.get("status") != "active" or release.get("pointer_matches") is not True:
        incidents.append(_incident(
            "release", "inactive", "active_release",
            {"status": release.get("status"), "pointer_matches": release.get("pointer_matches")},
            {"status": "active", "pointer_matches": True},
        ))

    latest_run = snapshot.get("latest_run") or {}
    if latest_run.get("status") != "success":
        incidents.append(_incident(
            "collector", "run_not_success", "latest_release_run",
            {"status": latest_run.get("status")}, {"status": "success"},
        ))
    generated = _as_date(snapshot.get("generated_at_utc"))
    finished = _as_date(latest_run.get("finished_at"))
    max_lag_days = int(os.getenv("ABBOTT_EXPECTED_MAX_LAG_DAYS", str(DEFAULT_EXPECTED_MAX_LAG_DAYS)))
    if generated and (not finished or (generated - finished).days > max_lag_days):
        incidents.append(_incident(
            "collector", "stale", "latest_release_run_freshness",
            {"finished_date": finished.isoformat() if finished else None},
            {"max_lag_days": max_lag_days},
        ))

    if snapshot.get("skipped_counter") is True:
        incidents.append(_incident(
            "counter", "skipped", "exact_counter_skipped",
            {"skipped": True}, {"skipped": False},
        ))

    for scope in snapshot.get("scopes") or []:
        name = str(scope.get("scope") or "unknown")
        missing = list(scope.get("missing_dates") or [])
        if missing:
            incidents.append(_incident(
                name, "missing_dates", "scope_date_coverage",
                {"missing_dates": missing}, {"missing_dates": []},
            ))
        status_counts = scope.get("status_counts") or {}
        bad = {key: int(value or 0) for key, value in status_counts.items() if key in BAD_COVERAGE_STATUSES and int(value or 0) > 0}
        if bad:
            incidents.append(_incident(
                name, "unpublishable_status", "scope_collection_status",
                {"status_counts": bad}, {"allowed": sorted(GOOD_COVERAGE_STATUSES)},
            ))
        if int(scope.get("rows") or 0) == 0:
            incidents.append(_incident(
                name, "zero_rows", "scope_rows",
                {"rows": 0}, {"minimum_rows": 1},
            ))

    return incidents


def _reject_forbidden(value: object, location: str = "payload") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            lowered = str(key).lower()
            if any(marker in lowered for marker in FORBIDDEN_KEY_PARTS):
                raise ValueError(f"forbidden payload key at {location}")
            _reject_forbidden(nested, f"{location}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_forbidden(nested, f"{location}[{index}]")
    elif isinstance(value, str):
        lowered = value.lower()
        if value.startswith(("/", "\\")) or "\\" in value or "?" in value or "://" in lowered or any(
            marker in lowered for marker in ("bearer ", "oauth", "password", "token", "dsn")
        ):
            raise ValueError(f"forbidden payload value at {location}")


def sanitize_snapshot(snapshot: dict) -> dict:
    if not isinstance(snapshot, dict):
        raise ValueError("snapshot must be an object")
    allowed = {
        "generated_at_utc", "dashboard", "counter_id", "overall", "release",
        "latest_run", "scopes", "backfill", "skipped_counter", "incidents",
    }
    unknown = set(snapshot) - allowed
    if unknown:
        raise ValueError("unknown snapshot keys")
    sanitized = json.loads(json.dumps(snapshot, default=_json_value))
    _reject_forbidden(sanitized)
    return sanitized


def _fetch_one(cur, sql: str, params=()) -> dict | None:
    cur.execute(sql, params)
    return cur.fetchone()


def _fetch_all(cur, sql: str, params=()) -> list[dict]:
    cur.execute(sql, params)
    return list(cur.fetchall())


def _counter_is_skipped(payload: dict, counter_id: str) -> bool:
    for entry in payload.get("skipped_counters") or []:
        value = entry.get("counter_id") if isinstance(entry, dict) else entry
        if str(value) == counter_id:
            return True
    return False


def collect_snapshot(cur, today: date, counter_id: str) -> dict:
    if str(counter_id) != ABBOTT_COUNTER_ID:
        raise ValueError("Abbott health probe requires counter 90602537")
    expected_date = today - timedelta(days=1)
    lookback_days = int(os.getenv("ABBOTT_COVERAGE_LOOKBACK_DAYS", str(DEFAULT_LOOKBACK_DAYS)))
    first_date = expected_date - timedelta(days=lookback_days - 1)

    release_row = _fetch_one(cur, ACTIVE_RELEASE_SQL) or {}
    release_id = release_row.get("canonical_release_id")
    run_row = _fetch_one(cur, LATEST_RELEASE_RUN_SQL, (release_id,)) if release_id is not None else {}
    event_row = _fetch_one(cur, LATEST_SUMMARY_EVENT_SQL, (run_row.get("id"),)) if run_row.get("id") else None
    event_payload = parse_event_payload((event_row or {}).get("event_payload"))
    coverage_rows = (
        _fetch_all(cur, COVERAGE_SQL, (release_id, counter_id, first_date, expected_date))
        if release_id is not None else []
    )
    scopes = build_scope_status(coverage_rows, expected_date, lookback_days)
    complete_dates = set.intersection(*(
        {(_as_date(row.get("report_date"))) for row in coverage_rows if row.get("scope_key") == scope and _coverage_status(row) in GOOD_COVERAGE_STATUSES}
        for scope in REQUIRED_SCOPES
    )) if coverage_rows else set()
    expected_dates = {first_date + timedelta(days=offset) for offset in range(lookback_days)}
    missing_days = sorted(day.isoformat() for day in expected_dates - complete_dates)

    snapshot = {
        "generated_at_utc": datetime.combine(today, datetime.min.time(), timezone.utc).isoformat().replace("+00:00", "Z"),
        "dashboard": "abbott",
        "counter_id": counter_id,
        "overall": "OK",
        "release": {
            "id": int(release_id) if release_id is not None else None,
            "status": release_row.get("release_status"),
            "pointer_matches": release_id is not None and release_row.get("pointer_release_id") == release_id,
        },
        "latest_run": {
            "id": run_row.get("id"),
            "status": run_row.get("status"),
            "run_type": run_row.get("run_type"),
            "date_from": _json_value(run_row.get("date_from")),
            "date_to": _json_value(run_row.get("date_to")),
            "finished_at": _json_value(run_row.get("finished_at")),
        },
        "scopes": scopes,
        "backfill": {
            "lookback_days": lookback_days,
            "complete_days": len(expected_dates & complete_dates),
            "missing_days": missing_days,
        },
        "skipped_counter": _counter_is_skipped(event_payload, counter_id) or any(
            row.get("collection_status") == "skipped" for row in coverage_rows
        ),
        "incidents": [],
    }
    snapshot["incidents"] = evaluate_snapshot(snapshot)
    snapshot["overall"] = "CRITICAL" if snapshot["incidents"] else "OK"
    return sanitize_snapshot(snapshot)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--counter-id", default=os.getenv("ABBOTT_METRIKA_COUNTER_ID", ABBOTT_COUNTER_ID))
    parser.add_argument("--today", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    from canonical_writer import get_db_connection

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        snapshot = collect_snapshot(cur, today, str(args.counter_id))
    finally:
        cur.close()
        conn.close()
    if args.as_json:
        print(json.dumps(snapshot, ensure_ascii=True, sort_keys=True))
    else:
        print(f"Abbott Metrika {snapshot['overall']}")
    return 2 if snapshot["overall"] == "CRITICAL" else 1 if snapshot["overall"] == "WARN" else 0


if __name__ == "__main__":
    raise SystemExit(main())
