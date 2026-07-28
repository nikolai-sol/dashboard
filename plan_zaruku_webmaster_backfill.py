#!/usr/bin/env python3
"""Build a SELECT-only Yandex Webmaster recovery plan; never executes a backfill."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple

from zaruku_collector_health import (
    ZARUKU_ACCOUNT_ID,
    build_lineage_defect_scope,
    build_partial_date_scope,
    load_lineage_defects,
    load_partial_fact_dates,
)


WEBMASTER_COVERAGE_SQL = """
SELECT 'webmaster_queries' AS layer, report_date, COUNT(*) AS row_count
FROM canonical_fact_webmaster_queries_daily
WHERE analytics_account_id = %s AND report_date BETWEEN %s AND %s
GROUP BY report_date
UNION ALL
SELECT 'webmaster_pages' AS layer, report_date, COUNT(*) AS row_count
FROM canonical_fact_webmaster_pages_daily
WHERE analytics_account_id = %s AND report_date BETWEEN %s AND %s
GROUP BY report_date
ORDER BY report_date, layer
"""

WEBMASTER_PROVENANCE_SQL = """
SELECT facts.layer, facts.report_date, facts.ingestion_run_id,
       runs.run_type, runs.status AS run_status,
       COUNT(*) AS row_count,
       MIN(facts.created_at) AS first_created_at,
       MAX(facts.created_at) AS last_created_at
FROM (
  SELECT 'webmaster_queries' AS layer, report_date, ingestion_run_id, created_at
  FROM canonical_fact_webmaster_queries_daily
  WHERE analytics_account_id = %s AND report_date BETWEEN %s AND %s
  UNION ALL
  SELECT 'webmaster_summary' AS layer, report_date, ingestion_run_id, created_at
  FROM canonical_fact_webmaster_summary_daily
  WHERE analytics_account_id = %s AND report_date BETWEEN %s AND %s
  UNION ALL
  SELECT 'webmaster_pages' AS layer, report_date, ingestion_run_id, created_at
  FROM canonical_fact_webmaster_pages_daily
  WHERE analytics_account_id = %s AND report_date BETWEEN %s AND %s
) AS facts
LEFT JOIN canonical_collector_runs AS runs ON runs.id = facts.ingestion_run_id
GROUP BY facts.layer, facts.report_date, facts.ingestion_run_id, runs.run_type, runs.status
ORDER BY facts.report_date, facts.layer, facts.ingestion_run_id
"""

WEBMASTER_RETENTION_SQL = """
SELECT
  (SELECT MIN(id) FROM canonical_collector_runs) AS collector_min_id,
  (SELECT MAX(id) FROM canonical_collector_runs) AS collector_max_id,
  (SELECT MIN(started_at) FROM canonical_collector_runs) AS collector_min_started_at,
  (SELECT MAX(started_at) FROM canonical_collector_runs) AS collector_max_started_at,
  MIN(facts.report_date) AS fact_min_date,
  MAX(facts.report_date) AS fact_max_date,
  MIN(facts.ingestion_run_id) AS fact_min_run_id
FROM (
  SELECT report_date, ingestion_run_id
  FROM canonical_fact_webmaster_queries_daily
  WHERE analytics_account_id = %s
  UNION ALL
  SELECT report_date, ingestion_run_id
  FROM canonical_fact_webmaster_summary_daily
  WHERE analytics_account_id = %s
  UNION ALL
  SELECT report_date, ingestion_run_id
  FROM canonical_fact_webmaster_pages_daily
  WHERE analytics_account_id = %s
) AS facts
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="SELECT-only Zaruku Webmaster recovery scope and provenance snapshot",
    )
    parser.add_argument("--date-from", required=True, help="inclusive YYYY-MM-DD")
    parser.add_argument("--date-to", required=True, help="inclusive YYYY-MM-DD")
    parser.add_argument("--json", action="store_true", help="emit deterministic JSON")
    return parser


def validate_date_range(
    date_from: str,
    date_to: str,
    *,
    today: Optional[date] = None,
) -> Tuple[date, date]:
    try:
        start = datetime.strptime(date_from, "%Y-%m-%d").date()
        end = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("dates must use YYYY-MM-DD") from exc
    if start > end:
        raise ValueError("date-from must not be after date-to")
    current = today or datetime.now(timezone.utc).date()
    if end > current:
        raise ValueError("date-to must not be in the future")
    return start, end


def _date_range(start: date, end: date) -> List[str]:
    values: List[str] = []
    current = start
    while current <= end:
        values.append(current.isoformat())
        current += timedelta(days=1)
    return values


def _date_text(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def derive_backfill_scope(
    date_from: date,
    date_to: date,
    coverage_rows: List[Mapping[str, Any]],
    partial_scope: Mapping[str, Any],
) -> Dict[str, Any]:
    expected = set(_date_range(date_from, date_to))
    present: Dict[str, set] = {
        "webmaster_queries": set(),
        "webmaster_pages": set(),
    }
    for row in coverage_rows:
        layer = str(row.get("layer") or "")
        if layer in present and int(row.get("row_count") or 0) > 0:
            present[layer].add(_date_text(row.get("report_date")))
    missing_query_dates = sorted(expected - present["webmaster_queries"])
    missing_page_dates = sorted(expected - present["webmaster_pages"])
    partial_dates = {
        str(value)
        for value in partial_scope.get("dates") or []
        if date_from.isoformat() <= str(value) <= date_to.isoformat()
    }
    candidates = sorted(partial_dates | set(missing_query_dates) | set(missing_page_dates))
    return {
        "missing_query_dates": missing_query_dates,
        "missing_page_dates": missing_page_dates,
        "partial_dates": sorted(partial_dates),
        "candidate_dates": candidates,
        "candidate_date_count": len(candidates),
    }


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def normalize_rows(rows: List[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    normalized = [
        {key: _json_value(value) for key, value in dict(row).items()}
        for row in rows
    ]
    return sorted(
        normalized,
        key=lambda row: (
            str(row.get("report_date") or ""),
            str(row.get("layer") or ""),
            str(row.get("ingestion_run_id") or ""),
            str(row.get("defect_type") or ""),
        ),
    )


def _execute_select(cursor: Any, sql: str, params: Optional[Tuple[Any, ...]] = None) -> None:
    first_word = sql.lstrip().split(None, 1)[0].upper()
    if first_word not in {"SELECT", "WITH"}:
        raise RuntimeError("Planner refused a non-read-only SQL statement")
    if params is None:
        cursor.execute(sql)
    else:
        cursor.execute(sql, params)


def _filter_partial_rows(rows: List[Mapping[str, Any]], date_from: date, date_to: date) -> List[Dict[str, Any]]:
    start = date_from.isoformat()
    end = date_to.isoformat()
    return [
        dict(row)
        for row in rows
        if str(row.get("source_key") or "") == "yandex_webmaster"
        and start <= _date_text(row.get("report_date")) <= end
    ]


def build_plan(cursor: Any, date_from: date, date_to: date) -> Dict[str, Any]:
    partial_rows = _filter_partial_rows(load_partial_fact_dates(cursor), date_from, date_to)
    partial_scope = build_partial_date_scope(partial_rows)
    lineage_scope = build_lineage_defect_scope(load_lineage_defects(cursor))

    coverage_params = (
        ZARUKU_ACCOUNT_ID,
        date_from,
        date_to,
        ZARUKU_ACCOUNT_ID,
        date_from,
        date_to,
    )
    _execute_select(cursor, WEBMASTER_COVERAGE_SQL, coverage_params)
    coverage_rows = [dict(row) for row in cursor.fetchall()]

    provenance_params = (
        ZARUKU_ACCOUNT_ID,
        date_from,
        date_to,
        ZARUKU_ACCOUNT_ID,
        date_from,
        date_to,
        ZARUKU_ACCOUNT_ID,
        date_from,
        date_to,
    )
    _execute_select(cursor, WEBMASTER_PROVENANCE_SQL, provenance_params)
    provenance = normalize_rows([dict(row) for row in cursor.fetchall()])

    _execute_select(
        cursor,
        WEBMASTER_RETENTION_SQL,
        (ZARUKU_ACCOUNT_ID, ZARUKU_ACCOUNT_ID, ZARUKU_ACCOUNT_ID),
    )
    retention_row = cursor.fetchone() or {}
    retention = {key: _json_value(value) for key, value in dict(retention_row).items()}

    return {
        "range": {"date_from": date_from.isoformat(), "date_to": date_to.isoformat()},
        "partial_scope": partial_scope,
        "scope": derive_backfill_scope(date_from, date_to, coverage_rows, partial_scope),
        "coverage": normalize_rows(coverage_rows),
        "provenance": provenance,
        "lineage_defects": lineage_scope,
        "retention": retention,
        "read_only": True,
    }


def render_human(plan: Mapping[str, Any]) -> str:
    scope = plan.get("scope") or {}
    partial = plan.get("partial_scope") or {}
    lineage = plan.get("lineage_defects") or {}
    lines = [
        "Zaruku Webmaster read-only recovery plan",
        "Range: {}..{}".format(plan["range"]["date_from"], plan["range"]["date_to"]),
        "Partial dates: {} ({})".format(
            int(partial.get("distinct_date_count") or 0),
            ", ".join(partial.get("dates") or []) or "none",
        ),
        "Missing query dates: {}".format(", ".join(scope.get("missing_query_dates") or []) or "none"),
        "Missing page dates: {}".format(", ".join(scope.get("missing_page_dates") or []) or "none"),
        "Candidate dates: {}".format(", ".join(scope.get("candidate_dates") or []) or "none"),
        "Lineage defects: {} rows".format(int(lineage.get("row_count") or 0)),
        "No collector, backfill, fact write, or run write was executed.",
    ]
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        date_from, date_to = validate_date_range(args.date_from, args.date_to)
    except ValueError as exc:
        parser.error(str(exc))

    from canonical_writer import get_db_connection

    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        plan = build_plan(cur, date_from, date_to)
    finally:
        cur.close()
        conn.close()
    if args.json:
        print(json.dumps(plan, ensure_ascii=False, sort_keys=True, indent=2))
    else:
        print(render_human(plan))
    return 2 if int(plan["lineage_defects"].get("row_count") or 0) > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
