#!/usr/bin/env python3
"""Deterministic, aggregate-only health probe for the Abbott Metrika release."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


ABBOTT_COUNTER_ID = "90602537"
REQUIRED_SCOPES = ("other", "traffic", "page", "user_behavior", "returning")
DEFAULT_LOOKBACK_DAYS = 10
DEFAULT_HEALTH_TIMEZONE = "Europe/Moscow"
DEFAULT_EXPECTED_COMPLETION_HOUR = 9
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
  AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload, '$.counter_id')) = %s
ORDER BY r.id DESC
LIMIT 1
"""

LATEST_SUMMARY_EVENT_SQL = """
SELECT event_payload
FROM canonical_collector_run_events
WHERE run_id = %s
  AND event_type IN ('summary', 'release_collection_incomplete')
  AND JSON_UNQUOTE(JSON_EXTRACT(event_payload, '$.counter_id')) = %s
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

RELEASE_STATUSES = {"staging", "validated", "active", "retired", "failed"}
RUN_STATUSES = {"running", "success", "partial", "failed"}
RUN_TYPES = {"manual", "cron", "backfill", "reconcile", "preview"}
CHECK_IDS = {
    "active_release",
    "latest_release_run",
    "latest_release_run_freshness",
    "exact_counter_skipped",
    "scope_date_coverage",
    "scope_collection_status",
    "scope_rows",
    "hermes_input_adapter",
}
FIXED_INCIDENT_IDENTITIES = {
    "active_release": ("release", "inactive"),
    "latest_release_run": ("collector", "run_not_success"),
    "latest_release_run_freshness": ("collector", "stale"),
    "exact_counter_skipped": ("counter", "skipped"),
    "hermes_input_adapter": ("adapter", "failure"),
}
SCOPE_INCIDENT_CONDITIONS = {
    "scope_date_coverage": "missing_dates",
    "scope_collection_status": "unpublishable_status",
    "scope_rows": "zero_rows",
}


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


def _as_aware_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def _utc_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def expected_completion_at(generated_at: datetime) -> datetime:
    timezone_name = os.getenv("ABBOTT_HEALTH_TIMEZONE", DEFAULT_HEALTH_TIMEZONE)
    try:
        business_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        raise ValueError("ABBOTT_HEALTH_TIMEZONE is invalid") from None
    try:
        completion_hour = int(os.getenv(
            "ABBOTT_EXPECTED_COMPLETION_HOUR",
            str(DEFAULT_EXPECTED_COMPLETION_HOUR),
        ))
    except ValueError:
        raise ValueError("ABBOTT_EXPECTED_COMPLETION_HOUR is invalid") from None
    if completion_hour < 0 or completion_hour > 23:
        raise ValueError("ABBOTT_EXPECTED_COMPLETION_HOUR is invalid")
    local_now = generated_at.astimezone(business_timezone)
    boundary = local_now.replace(
        hour=completion_hour,
        minute=0,
        second=0,
        microsecond=0,
    )
    if local_now < boundary:
        boundary -= timedelta(days=1)
    return boundary.astimezone(timezone.utc)


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
            "unexpected_empty": any(
                _coverage_status(row) == "success"
                and int(row.get("persisted_rows") or 0) == 0
                for row in scoped
            ),
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
    generated = _as_aware_datetime(snapshot.get("generated_at_utc"))
    finished = _as_aware_datetime(latest_run.get("finished_at"))
    expected_completion = expected_completion_at(generated) if generated else None
    if expected_completion and (not finished or finished < expected_completion):
        incidents.append(_incident(
            "collector", "stale", "latest_release_run_freshness",
            {"finished_at": _utc_timestamp(finished) if finished else None},
            {"expected_completion_at": _utc_timestamp(expected_completion)},
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
        if scope.get("unexpected_empty") is True:
            incidents.append(_incident(
                name, "zero_rows", "scope_rows",
                {"rows": int(scope.get("rows") or 0)}, {"minimum_rows": 1},
            ))

    return incidents


def _exact_object(value: object, keys: set[str], location: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{location} schema mismatch")
    return value


def _nonnegative_int(value: object, location: str, *, allow_none: bool = False) -> int | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{location} must be a non-negative integer")
    return value


def _iso_date(value: object, location: str, *, allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, str) or len(value) != 10 or _as_date(value) is None:
        raise ValueError(f"{location} must be an ISO date")
    return value


def _aware_datetime(value: object, location: str, *, allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{location} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{location} must be an ISO timestamp") from None
    if parsed.tzinfo is None:
        raise ValueError(f"{location} must include a timezone")
    return value


def _date_list(value: object, location: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{location} must be a list")
    result = [_iso_date(item, f"{location}[]") for item in value]
    if len(set(result)) != len(result):
        raise ValueError(f"{location} contains duplicates")
    return result


def _status_counts(value: object, location: str) -> dict:
    if not isinstance(value, dict) or set(value) - (GOOD_COVERAGE_STATUSES | BAD_COVERAGE_STATUSES):
        raise ValueError(f"{location} schema mismatch")
    for status, count in value.items():
        if status not in GOOD_COVERAGE_STATUSES | BAD_COVERAGE_STATUSES:
            raise ValueError(f"{location} status is invalid")
        _nonnegative_int(count, f"{location}.{status}")
    return value


def _validate_incident(incident: object, index: int) -> None:
    location = f"payload.incidents[{index}]"
    item = _exact_object(
        incident,
        {"incident_key", "severity", "check_id", "observed", "expected"},
        location,
    )
    check_id = item["check_id"]
    if check_id not in CHECK_IDS or item["severity"] not in {"WARN", "CRITICAL"}:
        raise ValueError(f"{location} classification is invalid")
    if not isinstance(item["incident_key"], str):
        raise ValueError(f"{location}.incident_key is invalid")
    parts = item["incident_key"].split("|")
    if len(parts) != 4 or parts[0:2] != ["abbott", ABBOTT_COUNTER_ID]:
        raise ValueError(f"{location}.incident_key is invalid")
    if check_id in FIXED_INCIDENT_IDENTITIES:
        if tuple(parts[2:4]) != FIXED_INCIDENT_IDENTITIES[check_id]:
            raise ValueError(f"{location}.incident_key is invalid")
    elif parts[2] not in REQUIRED_SCOPES or parts[3] != SCOPE_INCIDENT_CONDITIONS[check_id]:
        raise ValueError(f"{location}.incident_key is invalid")

    observed = item["observed"]
    expected = item["expected"]
    if check_id == "active_release":
        observed = _exact_object(observed, {"status", "pointer_matches"}, f"{location}.observed")
        expected = _exact_object(expected, {"status", "pointer_matches"}, f"{location}.expected")
        if observed["status"] not in RELEASE_STATUSES | {None} or (
            observed["pointer_matches"] is not None
            and not isinstance(observed["pointer_matches"], bool)
        ):
            raise ValueError(f"{location}.observed is invalid")
        if expected != {"status": "active", "pointer_matches": True}:
            raise ValueError(f"{location}.expected is invalid")
    elif check_id == "latest_release_run":
        observed = _exact_object(observed, {"status"}, f"{location}.observed")
        expected = _exact_object(expected, {"status"}, f"{location}.expected")
        if observed["status"] not in RUN_STATUSES | {None} or expected != {"status": "success"}:
            raise ValueError(f"{location} run evidence is invalid")
    elif check_id == "latest_release_run_freshness":
        observed = _exact_object(observed, {"finished_at"}, f"{location}.observed")
        expected = _exact_object(expected, {"expected_completion_at"}, f"{location}.expected")
        _aware_datetime(observed["finished_at"], f"{location}.observed.finished_at", allow_none=True)
        _aware_datetime(expected["expected_completion_at"], f"{location}.expected.expected_completion_at")
    elif check_id == "exact_counter_skipped":
        if observed != {"skipped": True} or expected != {"skipped": False}:
            raise ValueError(f"{location} skipped evidence is invalid")
    elif check_id == "scope_date_coverage":
        observed = _exact_object(observed, {"missing_dates"}, f"{location}.observed")
        expected = _exact_object(expected, {"missing_dates"}, f"{location}.expected")
        _date_list(observed["missing_dates"], f"{location}.observed.missing_dates")
        if expected["missing_dates"] != []:
            raise ValueError(f"{location}.expected is invalid")
    elif check_id == "scope_collection_status":
        observed = _exact_object(observed, {"status_counts"}, f"{location}.observed")
        expected = _exact_object(expected, {"allowed"}, f"{location}.expected")
        _status_counts(observed["status_counts"], f"{location}.observed.status_counts")
        if expected["allowed"] != sorted(GOOD_COVERAGE_STATUSES):
            raise ValueError(f"{location}.expected is invalid")
    elif check_id == "scope_rows":
        observed = _exact_object(observed, {"rows"}, f"{location}.observed")
        expected = _exact_object(expected, {"minimum_rows"}, f"{location}.expected")
        _nonnegative_int(observed["rows"], f"{location}.observed.rows")
        if expected["minimum_rows"] != 1:
            raise ValueError(f"{location}.expected is invalid")
    else:
        observed = _exact_object(observed, {"status"}, f"{location}.observed")
        expected = _exact_object(expected, {"status"}, f"{location}.expected")
        if observed["status"] != "adapter_failure" or expected["status"] != "valid_sanitized_payload":
            raise ValueError(f"{location} adapter evidence is invalid")


def sanitize_snapshot(snapshot: dict) -> dict:
    root = _exact_object(snapshot, {
        "generated_at_utc", "dashboard", "counter_id", "overall", "release",
        "latest_run", "scopes", "backfill", "skipped_counter", "incidents",
    }, "payload")
    _aware_datetime(root["generated_at_utc"], "payload.generated_at_utc")
    if root["dashboard"] != "abbott" or root["counter_id"] != ABBOTT_COUNTER_ID:
        raise ValueError("payload identity is invalid")
    if root["overall"] not in {"OK", "WARN", "CRITICAL"} or not isinstance(root["skipped_counter"], bool):
        raise ValueError("payload status is invalid")

    release = _exact_object(root["release"], {"id", "status", "pointer_matches"}, "payload.release")
    _nonnegative_int(release["id"], "payload.release.id", allow_none=True)
    if release["status"] not in RELEASE_STATUSES | {None} or not isinstance(release["pointer_matches"], bool):
        raise ValueError("payload.release is invalid")

    run = _exact_object(
        root["latest_run"],
        {"id", "status", "run_type", "date_from", "date_to", "finished_at", "counter_id"},
        "payload.latest_run",
    )
    _nonnegative_int(run["id"], "payload.latest_run.id", allow_none=True)
    if run["status"] not in RUN_STATUSES | {None} or run["run_type"] not in RUN_TYPES | {None}:
        raise ValueError("payload.latest_run status is invalid")
    _iso_date(run["date_from"], "payload.latest_run.date_from", allow_none=True)
    _iso_date(run["date_to"], "payload.latest_run.date_to", allow_none=True)
    _aware_datetime(run["finished_at"], "payload.latest_run.finished_at", allow_none=True)
    if run["counter_id"] not in {ABBOTT_COUNTER_ID, None} or (run["id"] is not None and run["counter_id"] != ABBOTT_COUNTER_ID):
        raise ValueError("payload.latest_run counter is invalid")

    if not isinstance(root["scopes"], list):
        raise ValueError("payload.scopes must be a list")
    scope_names = []
    for index, raw_scope in enumerate(root["scopes"]):
        scope = _exact_object(
            raw_scope,
            {"scope", "max_date", "rows", "missing_dates", "status_counts", "unexpected_empty"},
            f"payload.scopes[{index}]",
        )
        if scope["scope"] not in REQUIRED_SCOPES or not isinstance(scope["unexpected_empty"], bool):
            raise ValueError(f"payload.scopes[{index}] is invalid")
        scope_names.append(scope["scope"])
        _iso_date(scope["max_date"], f"payload.scopes[{index}].max_date", allow_none=True)
        _nonnegative_int(scope["rows"], f"payload.scopes[{index}].rows")
        _date_list(scope["missing_dates"], f"payload.scopes[{index}].missing_dates")
        _status_counts(scope["status_counts"], f"payload.scopes[{index}].status_counts")
    if len(scope_names) != len(REQUIRED_SCOPES) or set(scope_names) != set(REQUIRED_SCOPES):
        raise ValueError("payload.scopes must contain every required scope exactly once")

    backfill = _exact_object(root["backfill"], {"lookback_days", "complete_days", "missing_days"}, "payload.backfill")
    lookback = _nonnegative_int(backfill["lookback_days"], "payload.backfill.lookback_days")
    complete = _nonnegative_int(backfill["complete_days"], "payload.backfill.complete_days")
    missing_days = _date_list(backfill["missing_days"], "payload.backfill.missing_days")
    if lookback <= 0 or complete > lookback or complete + len(missing_days) != lookback:
        raise ValueError("payload.backfill counts are inconsistent")

    if not isinstance(root["incidents"], list):
        raise ValueError("payload.incidents must be a list")
    for index, incident in enumerate(root["incidents"]):
        _validate_incident(incident, index)
    return json.loads(json.dumps(root, ensure_ascii=True))


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


def collect_snapshot(
    cur,
    today: date,
    counter_id: str,
    *,
    now: datetime | None = None,
) -> dict:
    if str(counter_id) != ABBOTT_COUNTER_ID:
        raise ValueError("Abbott health probe requires counter 90602537")
    expected_date = today - timedelta(days=1)
    lookback_days = int(os.getenv("ABBOTT_COVERAGE_LOOKBACK_DAYS", str(DEFAULT_LOOKBACK_DAYS)))
    first_date = expected_date - timedelta(days=lookback_days - 1)

    release_row = _fetch_one(cur, ACTIVE_RELEASE_SQL) or {}
    release_id = release_row.get("canonical_release_id")
    run_row = _fetch_one(cur, LATEST_RELEASE_RUN_SQL, (release_id, counter_id)) if release_id is not None else {}
    event_row = _fetch_one(cur, LATEST_SUMMARY_EVENT_SQL, (run_row.get("id"), counter_id)) if run_row.get("id") else None
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
        "generated_at_utc": _utc_timestamp(
            now or datetime.combine(today, datetime.min.time(), timezone.utc)
        ),
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
            "counter_id": counter_id if run_row else None,
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
    current_time = datetime.now(timezone.utc)
    today = date.fromisoformat(args.today) if args.today else current_time.date()
    generated_at = (
        datetime.combine(today, datetime.min.time(), timezone.utc)
        if args.today else current_time
    )
    from canonical_writer import get_db_connection

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        snapshot = collect_snapshot(cur, today, str(args.counter_id), now=generated_at)
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
