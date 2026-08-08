#!/usr/bin/env python3
"""Build an audited Abbott successor release without local-file visits.

This is a DB-native release transformation.  It never calls Metrika and never
updates the active predecessor.  Output is deliberately aggregate-only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import uuid
from typing import Sequence

import mysql.connector


ABBOTT_COUNTER_ID = "90602537"
ABBOTT_DATASET_KEY = "abbott"
ALLOWED_SOURCE_KINDS = frozenset(
    (
        "abbott_workbook_json",
        "abbott_workbook_catalog",
        "abbott_bitrix_pages",
        "abbott_bitrix_journeys",
    )
)
REQUIRED_SOURCE_KINDS = frozenset(
    ("abbott_workbook_json", "abbott_workbook_catalog")
)

PRIMARY_COPY_TABLES = (
    ("report_bd", "canonical_fact_metrika_site_analytics_daily"),
    ("report_bd", "canonical_fact_metrika_returning_pages_release_daily"),
    ("report_bd", "canonical_source_coverage_daily"),
    ("report_bd", "portal_content_catalog"),
    ("report_bd", "portal_content_lookup_projection"),
    ("report_bd", "portal_general_materials"),
    ("report_bd", "portal_event_catalog"),
    ("report_bd", "portal_external_events"),
    ("report_bd", "portal_bitrix_page_facts"),
    ("report_bd", "portal_bitrix_journey_transitions"),
)
PRIVATE_COPY_TABLES = (
    ("report_bd_private", "canonical_fact_metrika_user_behavior_daily"),
    ("report_bd_private", "canonical_fact_metrika_visits"),
    ("report_bd_private", "portal_user_directions_private"),
    ("report_bd_private", "portal_bitrix_page_facts"),
    ("report_bd_private", "portal_bitrix_journeys_private"),
)
ALL_COPY_TABLES = PRIMARY_COPY_TABLES + PRIVATE_COPY_TABLES
LOCAL_FILE_TABLES = frozenset(
    (
        ("report_bd_private", "canonical_fact_metrika_user_behavior_daily"),
        ("report_bd_private", "canonical_fact_metrika_visits"),
    )
)


class SanitizationError(RuntimeError):
    """A fail-closed, PII-safe release sanitation error."""


def _quote(identifier: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier):
        raise SanitizationError("Release table inventory is invalid")
    return f"`{identifier}`"


def _local_file_predicate(alias: str = "source") -> str:
    quoted = _quote(alias)
    return (
        f"LOWER(LTRIM({quoted}.`start_url`)) LIKE 'file://%' "
        f"OR LOWER(LTRIM({quoted}.`end_url`)) LIKE 'file://%'"
    )


def build_copy_sql(
    schema: str,
    table: str,
    columns: Sequence[str],
) -> str:
    """Return allowlisted INSERT..SELECT SQL with the release key replaced."""

    key = (schema, table)
    if key not in ALL_COPY_TABLES:
        raise SanitizationError("Release table is not allowlisted")
    copy_columns = tuple(
        column for column in columns if column != "id"
    )
    if "canonical_release_id" not in copy_columns:
        raise SanitizationError("Release-scoped table is missing its release key")
    targets = ", ".join(_quote(column) for column in copy_columns)
    projections = ", ".join(
        "%s AS `canonical_release_id`"
        if column == "canonical_release_id"
        else f"source.{_quote(column)}"
        for column in copy_columns
    )
    filter_sql = ""
    if key in LOCAL_FILE_TABLES:
        filter_sql = f" AND NOT ({_local_file_predicate()})"
    return f"""
        INSERT INTO {_quote(schema)}.{_quote(table)} ({targets})
        SELECT {projections}
        FROM {_quote(schema)}.{_quote(table)} AS source
        WHERE source.`canonical_release_id` = %s{filter_sql}
    """


def validate_sanitized_counts(
    *,
    predecessor_visits: int,
    candidate_visits: int,
    predecessor_local_file_visits: int,
    candidate_local_file_visits: int,
    expected_local_file_visits: int,
) -> None:
    if (
        predecessor_local_file_visits != expected_local_file_visits
        or candidate_local_file_visits != 0
        or candidate_visits
        != predecessor_visits - predecessor_local_file_visits
    ):
        raise SanitizationError("Abbott release sanitization controls did not pass")


def _json_list(value) -> list[int]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise SanitizationError("Release source binding is invalid") from None
    if (
        not isinstance(value, list)
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in value
        )
        or len(set(value)) != len(value)
    ):
        raise SanitizationError("Release source binding is invalid")
    return value


def _scalar(cur, sql: str, params: tuple) -> int:
    cur.execute(sql, params)
    row = cur.fetchone()
    if isinstance(row, dict):
        value = next(iter(row.values()), 0)
    else:
        value = row[0] if row else 0
    return int(value or 0)


def _columns(cur, schema: str, table: str) -> tuple[str, ...]:
    cur.execute(
        """
        SELECT COLUMN_NAME, EXTRA
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
        ORDER BY ORDINAL_POSITION
        """,
        (schema, table),
    )
    rows = cur.fetchall()
    columns = []
    for row in rows:
        if isinstance(row, dict):
            name, extra = row["COLUMN_NAME"], row.get("EXTRA") or ""
        else:
            name, extra = row[0], row[1] or ""
        normalized_extra = str(extra).lower()
        if "auto_increment" in normalized_extra or "generated" in normalized_extra:
            continue
        columns.append(str(name))
    if "canonical_release_id" not in columns:
        raise SanitizationError("Release table schema preflight failed")
    return tuple(columns)


def _count_release(cur, schema: str, table: str, release_id: int) -> int:
    return _scalar(
        cur,
        f"SELECT COUNT(*) FROM {_quote(schema)}.{_quote(table)} "
        "WHERE `canonical_release_id` = %s",
        (release_id,),
    )


def _count_local_file(cur, schema: str, table: str, release_id: int) -> int:
    return _scalar(
        cur,
        f"SELECT COUNT(*) FROM {_quote(schema)}.{_quote(table)} AS source "
        "WHERE source.`canonical_release_id` = %s "
        f"AND ({_local_file_predicate()})",
        (release_id,),
    )


def _lock_release_pair(
    cur, *, predecessor_release_id: int, candidate_release_id: int,
    code_revision: str,
) -> tuple[list[int], int]:
    cur.execute(
        """
        SELECT canonical_release_id
        FROM report_bd.portal_active_data_releases
        WHERE dataset_key = %s
        FOR UPDATE
        """,
        (ABBOTT_DATASET_KEY,),
    )
    active = cur.fetchone()
    active_id = int(
        (active.get("canonical_release_id") if isinstance(active, dict) else active[0])
        if active
        else 0
    )
    if active_id != predecessor_release_id:
        raise SanitizationError("Active Abbott release pointer changed")

    cur.execute(
        """
        SELECT id, release_status, rollback_from_release_id,
               code_revision, source_snapshot_ids, baseline_validation_run_id
        FROM report_bd.portal_data_releases
        WHERE dataset_key = %s AND id IN (%s, %s)
        ORDER BY id
        FOR UPDATE
        """,
        (ABBOTT_DATASET_KEY, predecessor_release_id, candidate_release_id),
    )
    rows = cur.fetchall()
    by_id = {
        int(row["id"] if isinstance(row, dict) else row[0]): row for row in rows
    }
    predecessor = by_id.get(predecessor_release_id)
    candidate = by_id.get(candidate_release_id)
    if predecessor is None or candidate is None:
        raise SanitizationError("Abbott release pair was not found")

    def field(row, name: str, position: int):
        return row.get(name) if isinstance(row, dict) else row[position]

    if field(predecessor, "release_status", 1) != "active":
        raise SanitizationError("Abbott predecessor is no longer active")
    if (
        field(candidate, "release_status", 1) != "staging"
        or int(field(candidate, "rollback_from_release_id", 2) or 0)
        != predecessor_release_id
        or field(candidate, "code_revision", 3) != code_revision
    ):
        raise SanitizationError("Abbott candidate metadata is invalid")
    source_ids = _json_list(field(predecessor, "source_snapshot_ids", 4))
    candidate_ids = _json_list(field(candidate, "source_snapshot_ids", 4)) \
        if field(candidate, "source_snapshot_ids", 4) not in (None, "[]", []) else []
    if candidate_ids not in ([], source_ids):
        raise SanitizationError("Abbott candidate source binding is unexpected")
    baseline_snapshot_id = int(
        field(candidate, "baseline_validation_run_id", 5) or 0
    )
    if baseline_snapshot_id <= 0:
        raise SanitizationError("Abbott candidate baseline is invalid")
    return source_ids, baseline_snapshot_id


def _validate_baseline_sources(
    cur, *, baseline_snapshot_id: int, source_ids: Sequence[int]
) -> None:
    cur.execute(
        """
        SELECT manifest_json
        FROM report_bd.portal_dataset_snapshots
        WHERE id = %s AND dataset_key = %s
          AND source_kind = 'abbott_canonical_control_pack'
        """,
        (baseline_snapshot_id, ABBOTT_DATASET_KEY),
    )
    baseline_row = cur.fetchone()
    raw_manifest = (
        baseline_row.get("manifest_json")
        if isinstance(baseline_row, dict)
        else baseline_row[0] if baseline_row else None
    )
    if isinstance(raw_manifest, str):
        try:
            raw_manifest = json.loads(raw_manifest)
        except json.JSONDecodeError:
            raise SanitizationError("Abbott candidate baseline is invalid") from None
    frozen_files = raw_manifest.get("file_snapshots") if isinstance(raw_manifest, dict) else None
    if not isinstance(frozen_files, list) or not frozen_files:
        raise SanitizationError("Abbott candidate baseline source set is invalid")
    frozen_by_kind = {
        str(row.get("source_kind")): row
        for row in frozen_files
        if isinstance(row, dict)
    }
    if (
        len(frozen_by_kind) != len(frozen_files)
        or not REQUIRED_SOURCE_KINDS.issubset(frozen_by_kind)
        or not set(frozen_by_kind).issubset(ALLOWED_SOURCE_KINDS)
    ):
        raise SanitizationError("Abbott candidate baseline source set is invalid")
    placeholders = ", ".join(["%s"] * len(source_ids))
    cur.execute(
        f"""
        SELECT id, source_kind, content_sha256, content_bytes, parser_version
        FROM report_bd.portal_dataset_snapshots
        WHERE dataset_key = %s AND id IN ({placeholders})
        ORDER BY id
        """,
        (ABBOTT_DATASET_KEY, *source_ids),
    )
    actual_rows = cur.fetchall()
    if len(actual_rows) != len(source_ids):
        raise SanitizationError("Abbott candidate baseline source set is invalid")
    actual_by_kind = {}
    for row in actual_rows:
        if isinstance(row, dict):
            actual_by_kind[str(row["source_kind"])] = row
        else:
            actual_by_kind[str(row[1])] = {
                "id": row[0],
                "source_kind": row[1],
                "content_sha256": row[2],
                "content_bytes": row[3],
                "parser_version": row[4],
            }
    if set(actual_by_kind) != set(frozen_by_kind):
        raise SanitizationError("Abbott candidate baseline source set is invalid")
    for kind, frozen in frozen_by_kind.items():
        actual = actual_by_kind[kind]
        for field in ("content_sha256", "content_bytes", "parser_version"):
            if actual.get(field) != frozen.get(field):
                raise SanitizationError("Abbott candidate baseline source set is invalid")


def _require_empty_candidate(
    cur, *, candidate_release_id: int
) -> None:
    receipt_count = _scalar(
        cur,
        """
        SELECT COUNT(*)
        FROM report_bd.canonical_collector_runs AS runs
        JOIN report_bd.canonical_collector_run_events AS events
          ON events.run_id = runs.id AND events.event_type = 'summary'
        WHERE runs.source_key = 'yandex_metrika'
          AND runs.run_type = 'reconcile'
          AND runs.run_mode = 'canonical_release'
          AND runs.job_key = 'abbott_file_url_sanitization'
          AND JSON_UNQUOTE(JSON_EXTRACT(
                events.event_payload, '$.canonical_release_id'
              )) = %s
        """,
        (str(candidate_release_id),),
    )
    if receipt_count:
        raise SanitizationError("Abbott candidate was already sanitized")
    imported = _scalar(
        cur,
        "SELECT COUNT(*) FROM report_bd.portal_release_source_imports "
        "WHERE canonical_release_id = %s",
        (candidate_release_id,),
    )
    populated = imported
    for schema, table in ALL_COPY_TABLES:
        populated += _count_release(cur, schema, table, candidate_release_id)
    if populated:
        raise SanitizationError("Abbott candidate is not empty")


def _bind_sources(
    cur, *, predecessor_release_id: int, candidate_release_id: int,
    source_ids: Sequence[int], code_revision: str,
) -> None:
    placeholders = ", ".join(["%s"] * len(source_ids))
    cur.execute(
        f"""
        SELECT id, source_kind
        FROM report_bd.portal_dataset_snapshots
        WHERE dataset_key = %s AND id IN ({placeholders})
        ORDER BY id
        """,
        (ABBOTT_DATASET_KEY, *source_ids),
    )
    snapshot_rows = cur.fetchall()
    kinds = {
        str(row["source_kind"] if isinstance(row, dict) else row[1])
        for row in snapshot_rows
    }
    if (
        len(snapshot_rows) != len(source_ids)
        or not REQUIRED_SOURCE_KINDS.issubset(kinds)
        or not kinds.issubset(ALLOWED_SOURCE_KINDS)
    ):
        raise SanitizationError("Abbott predecessor source set is invalid")
    cur.execute(
        """
        SELECT source_snapshot_ids
        FROM report_bd.portal_data_releases
        WHERE id = %s AND dataset_key = %s AND release_status = 'staging'
        """,
        (candidate_release_id, ABBOTT_DATASET_KEY),
    )
    candidate_row = cur.fetchone()
    current_ids = (
        candidate_row.get("source_snapshot_ids")
        if isinstance(candidate_row, dict)
        else candidate_row[0] if candidate_row else None
    )
    if current_ids in (None, "[]", []):
        cur.execute(
            """
            UPDATE report_bd.portal_data_releases
            SET source_snapshot_ids = %s
            WHERE id = %s AND dataset_key = %s AND release_status = 'staging'
            """,
            (json.dumps(list(source_ids)), candidate_release_id, ABBOTT_DATASET_KEY),
        )
        if cur.rowcount != 1:
            raise SanitizationError("Abbott candidate source binding failed")
    elif _json_list(current_ids) != list(source_ids):
        raise SanitizationError("Abbott candidate source binding failed")

    existing = _scalar(
        cur,
        "SELECT COUNT(*) FROM report_bd.portal_release_source_imports "
        "WHERE canonical_release_id = %s",
        (candidate_release_id,),
    )
    if existing == 0:
        cur.execute(
            """
            INSERT INTO report_bd.portal_release_source_imports (
                canonical_release_id, source_snapshot_id, source_kind,
                code_revision, import_status, imported_row_count,
                rejected_row_count, imported_at
            )
            SELECT %s, source_snapshot_id, source_kind, %s,
                   import_status, imported_row_count, rejected_row_count,
                   UTC_TIMESTAMP()
            FROM report_bd.portal_release_source_imports
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id
            """,
            (candidate_release_id, code_revision, predecessor_release_id),
        )
    cur.execute(
        """
        SELECT source_snapshot_id, source_kind, code_revision,
               import_status, imported_row_count, rejected_row_count
        FROM report_bd.portal_release_source_imports
        WHERE canonical_release_id = %s
        ORDER BY source_snapshot_id
        """,
        (candidate_release_id,),
    )
    receipts = cur.fetchall()
    receipt_ids = {
        int(row["source_snapshot_id"] if isinstance(row, dict) else row[0])
        for row in receipts
    }
    if len(receipts) != len(source_ids) or receipt_ids != set(source_ids):
        raise SanitizationError("Abbott candidate import receipts are incomplete")
    for row in receipts:
        revision = row["code_revision"] if isinstance(row, dict) else row[2]
        status = row["import_status"] if isinstance(row, dict) else row[3]
        rejected = row["rejected_row_count"] if isinstance(row, dict) else row[5]
        if revision != code_revision or status != "imported" or int(rejected or 0) != 0:
            raise SanitizationError("Abbott candidate import receipt is invalid")


def _copy_release_table(
    cur, *, schema: str, table: str,
    predecessor_release_id: int, candidate_release_id: int,
) -> tuple[int, int]:
    source_count = _count_release(cur, schema, table, predecessor_release_id)
    excluded = (
        _count_local_file(cur, schema, table, predecessor_release_id)
        if (schema, table) in LOCAL_FILE_TABLES
        else 0
    )
    expected_count = source_count - excluded
    candidate_count = _count_release(cur, schema, table, candidate_release_id)
    if candidate_count == 0 and expected_count:
        sql = build_copy_sql(schema, table, _columns(cur, schema, table))
        cur.execute(sql, (candidate_release_id, predecessor_release_id))
        candidate_count = _count_release(cur, schema, table, candidate_release_id)
    if candidate_count != expected_count:
        raise SanitizationError("Abbott candidate table count is incomplete")
    return source_count, candidate_count


def _reconcile_visit_coverage(cur, *, candidate_release_id: int) -> None:
    cur.execute(
        """
        UPDATE report_bd.canonical_source_coverage_daily AS coverage
        LEFT JOIN (
            SELECT report_date, COUNT(*) AS visit_count
            FROM report_bd_private.canonical_fact_metrika_visits
            WHERE canonical_release_id = %s AND counter_id = %s
            GROUP BY report_date
        ) AS visits ON visits.report_date = coverage.report_date
        SET coverage.persisted_rows = COALESCE(visits.visit_count, 0)
        WHERE coverage.canonical_release_id = %s
          AND coverage.counter_id = %s
          AND coverage.source_key = 'yandex_metrika'
          AND coverage.scope_key = 'user_behavior'
        """,
        (
            candidate_release_id,
            ABBOTT_COUNTER_ID,
            candidate_release_id,
            ABBOTT_COUNTER_ID,
        ),
    )
    mismatches = _scalar(
        cur,
        """
        SELECT COUNT(*)
        FROM report_bd.canonical_source_coverage_daily AS coverage
        LEFT JOIN (
            SELECT report_date, COUNT(*) AS visit_count
            FROM report_bd_private.canonical_fact_metrika_visits
            WHERE canonical_release_id = %s AND counter_id = %s
            GROUP BY report_date
        ) AS visits ON visits.report_date = coverage.report_date
        WHERE coverage.canonical_release_id = %s
          AND coverage.counter_id = %s
          AND coverage.source_key = 'yandex_metrika'
          AND coverage.scope_key = 'user_behavior'
          AND coverage.persisted_rows <> COALESCE(visits.visit_count, 0)
        """,
        (
            candidate_release_id,
            ABBOTT_COUNTER_ID,
            candidate_release_id,
            ABBOTT_COUNTER_ID,
        ),
    )
    if mismatches:
        raise SanitizationError("Abbott user-behavior coverage reconciliation failed")


def _require_no_fully_excluded_day(cur, *, predecessor_release_id: int) -> None:
    empty_days = _scalar(
        cur,
        """
        SELECT COUNT(*)
        FROM report_bd.canonical_source_coverage_daily AS coverage
        LEFT JOIN (
            SELECT report_date, COUNT(*) AS kept_visits
            FROM report_bd_private.canonical_fact_metrika_visits AS source
            WHERE source.canonical_release_id = %s
              AND source.counter_id = %s
              AND NOT (
                LOWER(LTRIM(source.start_url)) LIKE 'file://%'
                OR LOWER(LTRIM(source.end_url)) LIKE 'file://%'
              )
            GROUP BY report_date
        ) AS kept ON kept.report_date = coverage.report_date
        WHERE coverage.canonical_release_id = %s
          AND coverage.counter_id = %s
          AND coverage.source_key = 'yandex_metrika'
          AND coverage.scope_key = 'user_behavior'
          AND coverage.collection_status = 'success'
          AND COALESCE(kept.kept_visits, 0) = 0
        """,
        (
            predecessor_release_id,
            ABBOTT_COUNTER_ID,
            predecessor_release_id,
            ABBOTT_COUNTER_ID,
        ),
    )
    if empty_days:
        raise SanitizationError("Abbott sanitation would empty a successful coverage day")


def _record_receipt(
    cur, *, candidate_release_id: int, excluded_visits: int,
    date_from: str, date_to: str,
    predecessor_visits: int, candidate_visits: int,
) -> int:
    correlation_id = f"abbott-file-url-{uuid.uuid4()}"
    cur.execute(
        """
        INSERT INTO report_bd.canonical_collector_runs (
            source_key, run_type, run_mode, job_key, correlation_id,
            date_from, date_to, status, rows_read, rows_written,
            rows_updated, error_count, error_summary, finished_at,
            duration_ms
        ) VALUES (
            'yandex_metrika', 'reconcile', 'canonical_release',
            'abbott_file_url_sanitization', %s, %s, %s, 'success',
            %s, %s, 0, 0, NULL, UTC_TIMESTAMP(), 0
        )
        """,
        (
            correlation_id,
            date_from,
            date_to,
            predecessor_visits,
            candidate_visits,
        ),
    )
    run_id = int(cur.lastrowid)
    summary = json.dumps(
        {
            "counter_id": ABBOTT_COUNTER_ID,
            "canonical_release_id": candidate_release_id,
            "published_days": 0,
            "already_reconciled_days": [],
            "failed_days": [],
            "failures": [],
            "rows_written": candidate_visits,
            "sanitized_local_file_visits": excluded_visits,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    cur.execute(
        """
        INSERT INTO report_bd.canonical_collector_run_events (
            run_id, level, event_type, message, event_payload
        ) VALUES (%s, 'INFO', 'summary', %s, %s)
        """,
        (
            run_id,
            "Abbott canonical release was sanitized without source API calls",
            summary,
        ),
    )
    return run_id


def materialize_successor(
    conn,
    *,
    predecessor_release_id: int,
    candidate_release_id: int,
    code_revision: str,
    expected_local_file_visits: int,
    apply: bool,
) -> dict[str, int | str]:
    cur = conn.cursor(dictionary=True)
    try:
        conn.start_transaction(
            isolation_level="REPEATABLE READ", consistent_snapshot=True
        )
        source_ids, baseline_snapshot_id = _lock_release_pair(
            cur,
            predecessor_release_id=predecessor_release_id,
            candidate_release_id=candidate_release_id,
            code_revision=code_revision,
        )
        _validate_baseline_sources(
            cur,
            baseline_snapshot_id=baseline_snapshot_id,
            source_ids=source_ids,
        )
        cur.execute(
            """
            SELECT MIN(report_date) AS date_from, MAX(report_date) AS date_to
            FROM report_bd.canonical_source_coverage_daily
            WHERE canonical_release_id = %s AND counter_id = %s
              AND source_key = 'yandex_metrika'
            """,
            (predecessor_release_id, ABBOTT_COUNTER_ID),
        )
        period = cur.fetchone()
        date_from = str(period.get("date_from") if isinstance(period, dict) else period[0])
        date_to = str(period.get("date_to") if isinstance(period, dict) else period[1])
        if date_from in ("None", "") or date_to in ("None", ""):
            raise SanitizationError("Abbott predecessor coverage period is empty")
        _require_no_fully_excluded_day(
            cur, predecessor_release_id=predecessor_release_id
        )

        if apply:
            _require_empty_candidate(cur, candidate_release_id=candidate_release_id)
            _bind_sources(
                cur,
                predecessor_release_id=predecessor_release_id,
                candidate_release_id=candidate_release_id,
                source_ids=source_ids,
                code_revision=code_revision,
            )

        table_counts: dict[tuple[str, str], tuple[int, int]] = {}
        for schema, table in ALL_COPY_TABLES:
            if apply:
                table_counts[(schema, table)] = _copy_release_table(
                    cur,
                    schema=schema,
                    table=table,
                    predecessor_release_id=predecessor_release_id,
                    candidate_release_id=candidate_release_id,
                )
            else:
                source_count = _count_release(cur, schema, table, predecessor_release_id)
                excluded = (
                    _count_local_file(cur, schema, table, predecessor_release_id)
                    if (schema, table) in LOCAL_FILE_TABLES
                    else 0
                )
                table_counts[(schema, table)] = (source_count, source_count - excluded)

        predecessor_visits, candidate_visits = table_counts[
            ("report_bd_private", "canonical_fact_metrika_visits")
        ]
        predecessor_bad = _count_local_file(
            cur,
            "report_bd_private",
            "canonical_fact_metrika_visits",
            predecessor_release_id,
        )
        candidate_bad = (
            _count_local_file(
                cur,
                "report_bd_private",
                "canonical_fact_metrika_visits",
                candidate_release_id,
            )
            if apply
            else 0
        )
        validate_sanitized_counts(
            predecessor_visits=predecessor_visits,
            candidate_visits=candidate_visits,
            predecessor_local_file_visits=predecessor_bad,
            candidate_local_file_visits=candidate_bad,
            expected_local_file_visits=expected_local_file_visits,
        )

        if apply:
            _reconcile_visit_coverage(cur, candidate_release_id=candidate_release_id)
            receipt_id = _record_receipt(
                cur,
                candidate_release_id=candidate_release_id,
                excluded_visits=predecessor_bad,
                date_from=date_from,
                date_to=date_to,
                predecessor_visits=predecessor_visits,
                candidate_visits=candidate_visits,
            )
            conn.commit()
            status = "materialized"
        else:
            receipt_id = 0
            conn.rollback()
            status = "preflight"
        return {
            "status": status,
            "predecessor_release_id": predecessor_release_id,
            "candidate_release_id": candidate_release_id,
            "source_snapshot_count": len(source_ids),
            "copied_table_count": len(ALL_COPY_TABLES),
            "predecessor_visits": predecessor_visits,
            "candidate_visits": candidate_visits,
            "excluded_visits": predecessor_bad,
            "receipt_id": receipt_id,
        }
    except SanitizationError:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise SanitizationError("Unable to sanitize Abbott canonical release") from None
    finally:
        cur.close()


def _local_root_connection():
    if os.geteuid() != 0:
        raise SanitizationError("Local database maintenance requires the server root user")
    option_file = "/root/.my.cnf"
    if not os.path.isfile(option_file) or os.stat(option_file).st_mode & 0o077:
        raise SanitizationError("Protected local database settings were not found")
    return mysql.connector.connect(
        option_files=option_file,
        database="report_bd",
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predecessor-release-id", type=int, required=True)
    parser.add_argument("--candidate-release-id", type=int, required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--expected-local-file-visits", type=int, required=True)
    parser.add_argument("--local-root-socket", action="store_true", required=True)
    parser.add_argument("--apply", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not re.fullmatch(r"[0-9a-f]{7,64}", args.code_revision):
        raise SystemExit("code revision is invalid")
    conn = None
    try:
        conn = _local_root_connection()
        result = materialize_successor(
            conn,
            predecessor_release_id=args.predecessor_release_id,
            candidate_release_id=args.candidate_release_id,
            code_revision=args.code_revision,
            expected_local_file_visits=args.expected_local_file_visits,
            apply=args.apply,
        )
    except SanitizationError as exc:
        raise SystemExit(str(exc)) from None
    finally:
        if conn is not None:
            conn.close()
    print(" ".join(f"{key}={value}" for key, value in result.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
