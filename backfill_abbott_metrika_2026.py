#!/usr/bin/env python3
"""Resume-safe orchestration for the Abbott 2026 candidate backfill."""

from __future__ import annotations

import argparse
import calendar
from datetime import date, datetime, timedelta, timezone
import uuid
from typing import Any, Callable, Iterable, Mapping, Sequence

from canonical_writer import finish_collector_run, get_db_connection, start_collector_run
from fetch_yandex_metrika_canonical import (
    ABBOTT_COUNTER_ID,
    ABBOTT_REQUIRED_SCOPES,
    SOURCE_KEY as METRIKA_SOURCE_KEY,
    collect_metrika_day,
    publish_metrika_day_bundle,
    validate_day_bundle,
)


BACKFILL_START = date(2026, 1, 1)
BACKFILL_END = date(2026, 12, 31)
PRIORITY_GAP_START = date(2026, 3, 29)
PRIORITY_GAP_END = date(2026, 4, 7)


class AbbottBackfillError(RuntimeError):
    """Sanitized orchestration error."""


def build_backfill_windows(today_utc: date) -> list[tuple[str, str]]:
    """Build calendar-month windows from 2026-01-01 through yesterday."""

    final_day = min(today_utc - timedelta(days=1), BACKFILL_END)
    if final_day < BACKFILL_START:
        return []
    windows = []
    month_start = BACKFILL_START
    while month_start <= final_day:
        month_end = date(
            month_start.year,
            month_start.month,
            calendar.monthrange(month_start.year, month_start.month)[1],
        )
        window_end = min(month_end, final_day)
        windows.append((month_start.isoformat(), window_end.isoformat()))
        month_start = window_end + timedelta(days=1)
    return windows


def _days_in_window(date_from: str, date_to: str) -> Iterable[str]:
    current = date.fromisoformat(date_from)
    final_day = date.fromisoformat(date_to)
    while current <= final_day:
        yield current.isoformat()
        current += timedelta(days=1)


def ordered_backfill_days(today_utc: date) -> list[str]:
    """Prioritize the known traffic gap, then cover every remaining 2026 day."""

    all_days = [
        day
        for window in build_backfill_windows(today_utc)
        for day in _days_in_window(*window)
    ]
    priority = [
        day
        for day in all_days
        if PRIORITY_GAP_START <= date.fromisoformat(day) <= PRIORITY_GAP_END
    ]
    priority_set = set(priority)
    return priority + [day for day in all_days if day not in priority_set]


def coverage_day_is_reconciled(rows: Sequence[Mapping[str, Any]]) -> bool:
    """Return true only for the exact five complete, unsampled coverage rows."""

    if len(rows) != len(ABBOTT_REQUIRED_SCOPES):
        return False
    by_scope = {str(row.get("scope_key")): row for row in rows}
    if set(by_scope) != set(ABBOTT_REQUIRED_SCOPES):
        return False
    for scope in ABBOTT_REQUIRED_SCOPES:
        row = by_scope[scope]
        if row.get("source_key") != METRIKA_SOURCE_KEY:
            return False
        status = row.get("collection_status")
        if status not in {"success", "success_empty"}:
            return False
        if not bool(row.get("pagination_complete")) or bool(row.get("is_sampled")):
            return False
        if status == "success_empty" and not bool(row.get("empty_reconciled")):
            return False
    return True


def day_is_reconciled(conn, canonical_release_id: int, day: str) -> bool:
    """Read only the candidate/Abbott/day coverage used by resume."""

    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT source_key, scope_key, collection_status, pagination_complete,
                   is_sampled, empty_reconciled
            FROM canonical_source_coverage_daily
            WHERE canonical_release_id = %s
              AND counter_id = %s
              AND source_key = %s
              AND report_date = %s
            ORDER BY scope_key
            """,
            (canonical_release_id, ABBOTT_COUNTER_ID, METRIKA_SOURCE_KEY, day),
        )
        return coverage_day_is_reconciled(cursor.fetchall())
    finally:
        cursor.close()


def require_frozen_baseline(conn, canonical_release_id: int) -> int:
    """Prove the staging release references a committed frozen snapshot."""

    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT releases.baseline_validation_run_id
            FROM portal_data_releases AS releases
            JOIN portal_dataset_snapshots AS snapshots
              ON snapshots.id = releases.baseline_validation_run_id
             AND snapshots.dataset_key = releases.dataset_key
            WHERE releases.id = %s
              AND releases.dataset_key = %s
              AND releases.release_status = 'staging'
              AND snapshots.source_kind = %s
            """,
            (canonical_release_id, "abbott", "abbott_canonical_control_pack"),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
    if not row or row.get("baseline_validation_run_id") is None:
        raise AbbottBackfillError(
            "Candidate release does not reference a frozen Abbott baseline"
        )
    return int(row["baseline_validation_run_id"])


def run_backfill(
    conn,
    *,
    canonical_release_id: int,
    run_id: int,
    code_revision: str,
    parser_version: str,
    days: Sequence[str],
    is_reconciled: Callable[[Any, int, str], bool] = day_is_reconciled,
    collect_day: Callable[..., Any] = collect_metrika_day,
    validate_day: Callable[..., Any] = validate_day_bundle,
    publish_day: Callable[..., Any] = publish_metrika_day_bundle,
    baseline_guard: Callable[[Any, int], int] = require_frozen_baseline,
) -> dict[str, Any]:
    """Collect and atomically publish missing days without activating a release."""

    if int(canonical_release_id) <= 0:
        raise AbbottBackfillError("Canonical release ID must be positive")
    if not code_revision.strip() or not parser_version.strip():
        raise AbbottBackfillError("Backfill fingerprint context is required")
    baseline_guard(conn, canonical_release_id)
    published_days: list[str] = []
    skipped_days: list[str] = []
    failed_days: list[dict[str, str]] = []
    rows_written = 0
    counter = {"counter_id": ABBOTT_COUNTER_ID}
    for day in days:
        if is_reconciled(conn, canonical_release_id, day):
            skipped_days.append(day)
            continue
        try:
            bundle = collect_day(
                counter,
                day,
                run_id,
                canonical_release_id,
                code_revision=code_revision,
                parser_version=parser_version,
            )
            if set(bundle.scopes) != set(ABBOTT_REQUIRED_SCOPES):
                raise AbbottBackfillError("Collected day does not contain all scopes")
            validate_day(bundle, ABBOTT_REQUIRED_SCOPES)
            result = publish_day(bundle)
            published_days.append(day)
            rows_written += int(getattr(result, "rows_written", 0))
        except Exception as exc:
            failed_days.append(
                {"report_date": day, "error_class": exc.__class__.__name__}
            )
    return {
        "counter_id": ABBOTT_COUNTER_ID,
        "canonical_release_id": canonical_release_id,
        "published_days": published_days,
        "skipped_days": skipped_days,
        "failed_days": failed_days,
        "rows_written": rows_written,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill the Abbott 2026 candidate release without activation"
    )
    parser.add_argument("--canonical-release-id", type=int, required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--parser-version", required=True)
    parser.add_argument(
        "--today-utc",
        type=date.fromisoformat,
        default=None,
        help="UTC date anchor for an operator-reviewed replay",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    today_utc = args.today_utc or datetime.now(timezone.utc).date()
    days = ordered_backfill_days(today_utc)
    if not days:
        raise AbbottBackfillError("No completed 2026 day is available for backfill")
    run_id = start_collector_run(
        source_key="yandex_metrika",
        run_type="backfill",
        run_mode="canonical_release",
        job_key="yandex_metrika_abbott_2026_backfill",
        correlation_id=str(uuid.uuid4()),
        date_from=min(days),
        date_to=max(days),
    )
    conn = None
    summary = None
    orchestration_failed = False
    try:
        conn = get_db_connection()
        summary = run_backfill(
            conn,
            canonical_release_id=args.canonical_release_id,
            run_id=run_id,
            code_revision=args.code_revision,
            parser_version=args.parser_version,
            days=days,
        )
    except Exception:
        orchestration_failed = True
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                orchestration_failed = True
    if orchestration_failed or summary is None:
        finish_collector_run(
            run_id,
            status="failed",
            rows_read=0,
            rows_written=0,
            rows_updated=0,
            error_count=1,
            error_summary="Abbott backfill orchestration failed",
        )
        return 1
    failed = len(summary["failed_days"])
    finish_collector_run(
        run_id,
        status="partial" if failed else "success",
        rows_read=len(summary["published_days"]) * len(ABBOTT_REQUIRED_SCOPES),
        rows_written=summary["rows_written"],
        rows_updated=summary["rows_written"],
        error_count=failed,
        error_summary=(
            "One or more Abbott backfill days failed" if failed else None
        ),
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
