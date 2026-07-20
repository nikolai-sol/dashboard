#!/usr/bin/env python3
"""Shared helpers for writing canonical_* reporting tables."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import mysql.connector
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

MYSQL_HOST = os.getenv('MYSQL_HOST') or os.getenv('DB_HOST') or 'localhost'
MYSQL_PORT = int(os.getenv('MYSQL_PORT') or os.getenv('DB_PORT') or '3306')
MYSQL_DB = os.getenv('MYSQL_DB') or os.getenv('DB_NAME') or 'report_bd'
MYSQL_USER = os.getenv('MYSQL_USER') or os.getenv('DB_USER') or 'report_bd'
MYSQL_PASS = os.getenv('MYSQL_PASSWORD') or os.getenv('DB_PASSWORD') or ''


def get_db_connection():
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=MYSQL_DB,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def require_mutable_candidate_release(release_id: int, *, portal_key: str = 'abbott') -> dict:
    """Preflight a release writer target before opening its write transaction.

    Staging releases remain resumable. The current active release is admitted only
    to the stricter, transactionally checked append-only path below.
    """
    from canonical_release_store import get_release

    release = get_release(release_id, portal_key=portal_key)
    if release.get('release_status') not in {'staging', 'active'}:
        raise MetrikaPublishError("Canonical release is immutable")
    return release


class MetrikaPublishError(RuntimeError):
    """Sanitized error raised when an atomic Metrika publication fails."""


@dataclass(frozen=True)
class MetrikaPublishResult:
    canonical_release_id: int
    counter_id: str
    report_date: str
    rows_written: int
    coverage_rows_written: int


_METRIKA_SCOPE_ORDER = ('other', 'traffic', 'page', 'user_behavior', 'returning')
_METRIKA_FAILURE_STATUSES = frozenset(('partial', 'skipped', 'sampled', 'failed'))
ABBOTT_COUNTER_ID = '90602537'


def _field(value: Any, name: str) -> Any:
    if isinstance(value, Mapping):
        return value[name]
    return getattr(value, name)


def _delete_release_day(cur, release_id: int, counter_id: str, report_date: str) -> None:
    params = (release_id, counter_id, report_date)
    for table in (
        'report_bd.canonical_fact_metrika_site_analytics_daily',
        'report_bd_private.canonical_fact_metrika_visits',
        'report_bd.canonical_fact_metrika_returning_pages_daily',
        'report_bd.canonical_source_coverage_daily',
    ):
        cur.execute(
            f"""
            DELETE FROM {table}
            WHERE canonical_release_id = %s
              AND counter_id = %s
              AND report_date = %s
            """,
            params,
        )


def _insert_site_fact_rows(cur, rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    values = [
        (
            row['canonical_release_id'],
            row.get('source_key', 'yandex_metrika'),
            row['analytics_account_id'],
            row['counter_id'],
            row['report_date'],
            row['analytics_scope'],
            row['scope_hash'],
            _json_or_none(row.get('scope_dimensions') or {}),
            row.get('sessions', row.get('visits', 0)),
            row.get('users', 0),
            row.get('pageviews', 0),
            row.get('bounce_rate'),
            row.get('average_session_seconds', row.get('avg_visit_duration_seconds')),
            row.get('goal_conversions', row.get('goal_reaches')),
            _json_or_none(row.get('raw_payload')),
            row['ingestion_run_id'],
        )
        for row in rows
    ]
    cur.executemany(
        """
        INSERT INTO report_bd.canonical_fact_metrika_site_analytics_daily (
            canonical_release_id, source_key, analytics_account_id, counter_id,
            report_date, analytics_scope, scope_hash, scope_dimensions,
            sessions, users, pageviews, bounce_rate, average_session_seconds,
            goal_conversions, raw_payload, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        values,
    )
    return len(values)


def _insert_private_user_behavior_rows(cur, rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    values = [
        (
            row['canonical_release_id'],
            row['counter_id'],
            row['report_date'],
            row['raw_user_id'],
            row['raw_user_id_hash'],
            row['start_url'],
            row['start_url_hash'],
            row['end_url'],
            row['end_url_hash'],
            row.get('visit_id'),
            row.get('session_started_at'),
            row.get('session_ended_at'),
            row.get('pageviews', 0),
            row['request_fingerprint'],
            row['ingestion_run_id'],
        )
        for row in rows
    ]
    cur.executemany(
        """
        INSERT INTO report_bd_private.canonical_fact_metrika_user_behavior_daily (
            canonical_release_id, counter_id, report_date, raw_user_id,
            raw_user_id_hash, start_url, start_url_hash, end_url, end_url_hash,
            visit_id, session_started_at, session_ended_at, pageviews,
            request_fingerprint, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s
        )
        """,
        values,
    )
    return len(values)


def _insert_private_metrika_visit_rows(cur, rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    values = [
        (
            row['canonical_release_id'],
            row['counter_id'],
            row['report_date'],
            row['visit_id'],
            row['visit_id_hash'],
            row.get('client_id_hash'),
            row.get('raw_user_id'),
            row.get('raw_user_id_hash'),
            row['traffic_source'],
            row['start_url'],
            row['start_url_hash'],
            row['end_url'],
            row['end_url_hash'],
            row['session_started_at'],
            row['session_ended_at'],
            row['pageviews'],
            row['duration_seconds'],
            row['is_bounce'],
            row['request_fingerprint'],
            row['ingestion_run_id'],
        )
        for row in rows
    ]
    cur.executemany(
        """
        INSERT INTO report_bd_private.canonical_fact_metrika_visits (
            canonical_release_id, counter_id, report_date, visit_id,
            visit_id_hash, client_id_hash, raw_user_id, raw_user_id_hash,
            traffic_source, start_url, start_url_hash, end_url, end_url_hash,
            session_started_at, session_ended_at, pageviews, duration_seconds,
            is_bounce, request_fingerprint, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        values,
    )
    return len(values)


def _insert_returning_rows(cur, rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    values = [
        (
            row['canonical_release_id'],
            row['counter_id'],
            row['report_date'],
            row['raw_page_value'],
            row['raw_page_hash'],
            row['normalized_page'],
            row['normalized_page_hash'],
            row['return_bucket_code'],
            row.get('return_bucket_label'),
            row['source_percentage'],
            row.get('source_denominator'),
            row.get('derived_count'),
            row.get('is_derived', 0),
            row['request_fingerprint'],
            row['ingestion_run_id'],
        )
        for row in rows
    ]
    cur.executemany(
        """
        INSERT INTO report_bd.canonical_fact_metrika_returning_pages_daily (
            canonical_release_id, counter_id, report_date, raw_page_value,
            raw_page_hash, normalized_page, normalized_page_hash,
            return_bucket_code, return_bucket_label, source_percentage,
            source_denominator, derived_count, is_derived,
            request_fingerprint, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        values,
    )
    return len(values)


def _insert_success_coverage_rows(cur, rows: Sequence[dict]) -> int:
    if not rows:
        return 0
    values = [
        (
            row['canonical_release_id'],
            row.get('source_key', 'yandex_metrika'),
            row['counter_id'],
            row['scope_key'],
            row['report_date'],
            row['request_fingerprint'],
            row['collection_status'],
            row.get('api_total_rows'),
            row['persisted_rows'],
            int(bool(row['pagination_complete'])),
            int(bool(row['is_sampled'])),
            int(bool(row['empty_reconciled'])),
            row['collector_run_id'],
        )
        for row in rows
    ]
    cur.executemany(
        """
        INSERT INTO report_bd.canonical_source_coverage_daily (
            canonical_release_id, source_key, counter_id, scope_key, report_date,
            request_fingerprint, collection_status, api_total_rows, persisted_rows,
            pagination_complete, is_sampled, empty_reconciled, collector_run_id,
            failure_code, sanitized_failure_json
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, NULL, NULL
        )
        """,
        values,
    )
    return len(values)


def _bundle_row(
    original: Mapping[str, Any],
    *,
    release_id: int,
    counter_id: str,
    report_date: str,
    run_id: int,
    scope: str,
) -> dict:
    row = dict(original)
    identity = {
        'canonical_release_id': release_id,
        'counter_id': counter_id,
        'report_date': report_date,
        'ingestion_run_id': run_id,
    }
    for field_name, expected in identity.items():
        if field_name in row and row[field_name] != expected:
            raise MetrikaPublishError("Metrika fact identity conflicts with day bundle")
        row[field_name] = expected

    if scope in ('other', 'traffic', 'page'):
        if 'analytics_account_id' in row and row['analytics_account_id'] != counter_id:
            raise MetrikaPublishError("Metrika site account conflicts with day bundle")
        if 'analytics_scope' in row and row['analytics_scope'] != scope:
            raise MetrikaPublishError("Metrika site scope conflicts with day bundle")
        row['analytics_account_id'] = counter_id
        row['analytics_scope'] = scope
    return row


def _validated_day_bundle(bundle: Any) -> tuple[int, str, str, int, dict, dict]:
    try:
        release_id = int(_field(bundle, 'canonical_release_id'))
        counter_id = str(_field(bundle, 'counter_id'))
        report_date = str(_field(bundle, 'report_date'))
        run_id = int(_field(bundle, 'run_id'))
        scopes = _field(bundle, 'scopes')
    except (KeyError, AttributeError, TypeError, ValueError):
        raise MetrikaPublishError("Metrika day bundle identity is invalid") from None

    if counter_id != ABBOTT_COUNTER_ID:
        raise MetrikaPublishError("Metrika release writer accepts only the Abbott counter")
    if not isinstance(scopes, Mapping) or set(scopes) != set(_METRIKA_SCOPE_ORDER):
        raise MetrikaPublishError("Metrika day bundle scopes are invalid")

    scope_results = {}
    normalized_rows = {}
    try:
        for scope in _METRIKA_SCOPE_ORDER:
            result = scopes[scope]
            if _field(result, 'scope') != scope:
                raise MetrikaPublishError("Metrika scope label does not match its map key")
            rows = tuple(_field(result, 'rows'))
            persisted_rows = int(_field(result, 'persisted_rows'))
            api_total_rows = int(_field(result, 'api_total_rows'))
            sampled = bool(_field(result, 'sampled'))
            pagination_complete = bool(_field(result, 'pagination_complete'))
            status = _field(result, 'status')
            request_fingerprint = _field(result, 'request_fingerprint')

            if (
                not isinstance(request_fingerprint, str)
                or not request_fingerprint.strip()
            ):
                raise MetrikaPublishError("Metrika request fingerprint is missing")

            if persisted_rows < 0 or api_total_rows < 0 or persisted_rows != len(rows):
                raise MetrikaPublishError("Metrika scope row counts are inconsistent")
            if sampled or not pagination_complete:
                raise MetrikaPublishError("Metrika scope pagination is not publishable")
            if status == 'success':
                if (
                    not rows
                    or api_total_rows <= 0
                    or api_total_rows > persisted_rows
                    or (scope == 'user_behavior' and api_total_rows != persisted_rows)
                ):
                    raise MetrikaPublishError("Successful Metrika scope totals are inconsistent")
            elif status == 'success_empty':
                if rows or persisted_rows != 0 or api_total_rows != 0:
                    raise MetrikaPublishError("Empty Metrika scope totals are inconsistent")
            else:
                raise MetrikaPublishError("Metrika scope status is not publishable")

            scope_results[scope] = result
            normalized_rows[scope] = [
                _bundle_row(
                    row,
                    release_id=release_id,
                    counter_id=counter_id,
                    report_date=report_date,
                    run_id=run_id,
                    scope=scope,
                )
                for row in rows
            ]
            if scope in ('user_behavior', 'returning') and any(
                not isinstance(row.get('request_fingerprint'), str)
                or not row['request_fingerprint'].strip()
                for row in normalized_rows[scope]
            ):
                raise MetrikaPublishError("Metrika fact request fingerprint is missing")
    except MetrikaPublishError:
        raise
    except (KeyError, AttributeError, TypeError, ValueError):
        raise MetrikaPublishError("Metrika day bundle is incomplete") from None

    return release_id, counter_id, report_date, run_id, scope_results, normalized_rows


def _lock_mutable_abbott_release(
    cur,
    release_id: int,
    *,
    counter_id: str | None = None,
    report_date: str | None = None,
    allow_active_append: bool = False,
) -> str:
    cur.execute(
        """
        SELECT id, dataset_key, release_status
        FROM portal_data_releases
        WHERE dataset_key = %s AND id = %s
        FOR UPDATE
        """,
        ('abbott', release_id),
    )
    release = cur.fetchone()
    if (
        not isinstance(release, Mapping)
        or release.get('id') != release_id
        or release.get('dataset_key') != 'abbott'
    ):
        raise MetrikaPublishError("Canonical release is immutable")

    release_status = release.get('release_status')
    if release_status == 'staging':
        return release_status
    if release_status != 'active' or not allow_active_append:
        raise MetrikaPublishError("Canonical release is immutable")
    if counter_id != ABBOTT_COUNTER_ID or not report_date:
        raise MetrikaPublishError("Active canonical append identity is invalid")

    try:
        append_date = date.fromisoformat(report_date)
    except ValueError:
        raise MetrikaPublishError("Active canonical append date is invalid") from None
    if append_date >= datetime.now(timezone.utc).date():
        raise MetrikaPublishError("Active canonical append requires a completed UTC day")

    cur.execute(
        """
        SELECT canonical_release_id
        FROM portal_active_data_releases
        WHERE dataset_key = %s
        FOR UPDATE
        """,
        ('abbott',),
    )
    pointer = cur.fetchone()
    if (
        not isinstance(pointer, Mapping)
        or pointer.get('canonical_release_id') != release_id
    ):
        raise MetrikaPublishError("Canonical release is not the active pointer")

    params = (release_id, counter_id, report_date)
    for table in (
        'report_bd.canonical_source_coverage_daily',
        'report_bd.canonical_fact_metrika_site_analytics_daily',
        'report_bd_private.canonical_fact_metrika_visits',
        'report_bd.canonical_fact_metrika_returning_pages_daily',
    ):
        cur.execute(
            f"""
            SELECT COUNT(*) AS row_count
            FROM {table}
            WHERE canonical_release_id = %s
              AND counter_id = %s
              AND report_date = %s
            FOR UPDATE
            """,
            params,
        )
        row = cur.fetchone()
        if not isinstance(row, Mapping) or int(row.get('row_count', -1)) != 0:
            raise MetrikaPublishError("Active canonical release day already exists")
    return release_status


def publish_metrika_day_bundle(bundle: Any) -> MetrikaPublishResult:
    (
        release_id,
        counter_id,
        report_date,
        run_id,
        scope_results,
        normalized_rows,
    ) = _validated_day_bundle(bundle)

    require_mutable_candidate_release(release_id, portal_key='abbott')
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        release_status = _lock_mutable_abbott_release(
            cur,
            release_id,
            counter_id=counter_id,
            report_date=report_date,
            allow_active_append=True,
        )
        if release_status == 'staging':
            _delete_release_day(cur, release_id, counter_id, report_date)

        rows_written = 0
        for scope in ('other', 'traffic', 'page'):
            rows_written += _insert_site_fact_rows(cur, normalized_rows[scope])
        rows_written += _insert_private_metrika_visit_rows(
            cur, normalized_rows['user_behavior']
        )
        rows_written += _insert_returning_rows(cur, normalized_rows['returning'])

        coverage_rows = []
        for scope in _METRIKA_SCOPE_ORDER:
            result = scope_results[scope]
            status = _field(result, 'status')
            coverage_rows.append(
                {
                    'canonical_release_id': release_id,
                    'counter_id': counter_id,
                    'scope_key': scope,
                    'report_date': report_date,
                    'request_fingerprint': _field(result, 'request_fingerprint'),
                    'collection_status': status,
                    'api_total_rows': _field(result, 'api_total_rows'),
                    'persisted_rows': _field(result, 'persisted_rows'),
                    'pagination_complete': _field(result, 'pagination_complete'),
                    'is_sampled': _field(result, 'sampled'),
                    'empty_reconciled': status == 'success_empty',
                    'collector_run_id': run_id,
                }
            )
        coverage_rows_written = _insert_success_coverage_rows(cur, coverage_rows)
        conn.commit()
        return MetrikaPublishResult(
            canonical_release_id=release_id,
            counter_id=counter_id,
            report_date=report_date,
            rows_written=rows_written,
            coverage_rows_written=coverage_rows_written,
        )
    except MetrikaPublishError:
        if conn is not None:
            conn.rollback()
        raise
    except Exception:
        if conn is not None:
            conn.rollback()
        raise MetrikaPublishError("Metrika day publication failed") from None
    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _sanitized_error_class(error_class: str) -> str:
    candidate = str(error_class or '')[:128]
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,127}', candidate):
        return 'MetrikaCollectionError'
    return candidate


def record_metrika_day_failure(
    *,
    release_id: int,
    counter_id: str,
    report_date: str,
    run_id: int,
    scope: str,
    status: str,
    error_class: str,
    request_fingerprint: str,
) -> None:
    if scope not in _METRIKA_SCOPE_ORDER or status not in _METRIKA_FAILURE_STATUSES:
        raise MetrikaPublishError("Invalid Metrika failure diagnostic")
    if str(counter_id) != ABBOTT_COUNTER_ID:
        raise MetrikaPublishError("Metrika release writer accepts only the Abbott counter")
    if not isinstance(request_fingerprint, str) or not request_fingerprint.strip():
        raise MetrikaPublishError("Metrika request fingerprint is missing")
    failure_code = _sanitized_error_class(error_class)
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        _lock_mutable_abbott_release(cur, release_id)
        cur.execute(
            """
            INSERT INTO report_bd.canonical_source_coverage_daily (
                canonical_release_id, source_key, counter_id, scope_key, report_date,
                request_fingerprint, collection_status, api_total_rows, persisted_rows,
                pagination_complete, is_sampled, empty_reconciled, collector_run_id,
                failure_code, sanitized_failure_json
            ) VALUES (
                %s, 'yandex_metrika', %s, %s, %s,
                %s, %s, NULL, 0, 0, %s, 0, %s, %s, %s
            )
            ON DUPLICATE KEY UPDATE
                request_fingerprint = VALUES(request_fingerprint),
                collection_status = VALUES(collection_status),
                api_total_rows = NULL,
                persisted_rows = 0,
                pagination_complete = 0,
                is_sampled = VALUES(is_sampled),
                empty_reconciled = 0,
                collector_run_id = VALUES(collector_run_id),
                failure_code = VALUES(failure_code),
                sanitized_failure_json = VALUES(sanitized_failure_json)
            """,
            (
                release_id,
                counter_id,
                scope,
                report_date,
                request_fingerprint,
                status,
                int(status == 'sampled'),
                run_id,
                failure_code,
                json.dumps({'error_class': failure_code}),
            ),
        )
        conn.commit()
    except Exception:
        if conn is not None:
            conn.rollback()
        raise MetrikaPublishError("Unable to record Metrika failure") from None
    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _json_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _normalize_datetime(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        raw = raw.replace('Z', '+00:00')
        try:
            return datetime.fromisoformat(raw).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            return raw[:19].replace('T', ' ')
    return None


def start_collector_run(
    source_key: str,
    run_type: str,
    run_mode: str,
    job_key: str,
    correlation_id: str,
    date_from: str,
    date_to: str,
) -> int:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO canonical_collector_runs (
            source_key, run_type, run_mode, job_key, correlation_id,
            date_from, date_to, status
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'running')
        """,
        (source_key, run_type, run_mode, job_key, correlation_id, date_from, date_to),
    )
    run_id = cur.lastrowid
    conn.commit()
    cur.close()
    conn.close()
    return int(run_id)


def log_run_event(run_id: int, level: str, event_type: str, message: str, payload: Any = None):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO canonical_collector_run_events (
            run_id, level, event_type, message, event_payload
        ) VALUES (%s, %s, %s, %s, %s)
        """,
        (run_id, level, event_type, message, _json_or_none(payload)),
    )
    conn.commit()
    cur.close()
    conn.close()


def finish_collector_run(
    run_id: int,
    status: str,
    rows_read: int,
    rows_written: int,
    rows_updated: int,
    error_count: int = 0,
    error_summary: str | None = None,
):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE canonical_collector_runs
        SET status = %s,
            rows_read = %s,
            rows_written = %s,
            rows_updated = %s,
            error_count = %s,
            error_summary = %s,
            finished_at = NOW(),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) DIV 1000,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """,
        (status, rows_read, rows_written, rows_updated, error_count, error_summary, run_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def upsert_source_accounts(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_accounts (
            source_key, platform_account_id, external_account_ref,
            account_name, advertiser_name, account_status,
            currency_code, timezone_name, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            external_account_ref = VALUES(external_account_ref),
            account_name = VALUES(account_name),
            advertiser_name = VALUES(advertiser_name),
            account_status = VALUES(account_status),
            currency_code = VALUES(currency_code),
            timezone_name = VALUES(timezone_name),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row.get('external_account_ref'),
                row.get('account_name'),
                row.get('advertiser_name'),
                row.get('account_status'),
                row.get('currency_code'),
                row.get('timezone_name'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_source_campaigns(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_campaigns (
            source_key, platform_account_id, platform_campaign_id,
            campaign_name, campaign_status, objective, buy_type,
            start_date, end_date, daily_budget, total_budget,
            currency_code, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            campaign_name = VALUES(campaign_name),
            campaign_status = VALUES(campaign_status),
            objective = VALUES(objective),
            buy_type = VALUES(buy_type),
            start_date = VALUES(start_date),
            end_date = VALUES(end_date),
            daily_budget = VALUES(daily_budget),
            total_budget = VALUES(total_budget),
            currency_code = VALUES(currency_code),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row.get('campaign_name'),
                row.get('campaign_status'),
                row.get('objective'),
                row.get('buy_type'),
                row.get('start_date'),
                row.get('end_date'),
                row.get('daily_budget'),
                row.get('total_budget'),
                row.get('currency_code'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_delivery_entities(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_delivery_entities (
            source_key, platform_account_id, platform_campaign_id,
            delivery_entity_type, platform_delivery_entity_id, parent_delivery_entity_id,
            delivery_entity_name, delivery_status, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            parent_delivery_entity_id = VALUES(parent_delivery_entity_id),
            delivery_entity_name = VALUES(delivery_entity_name),
            delivery_status = VALUES(delivery_status),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row['delivery_entity_type'],
                row['platform_delivery_entity_id'],
                row.get('parent_delivery_entity_id') or '',
                row.get('delivery_entity_name'),
                row.get('delivery_status'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_creatives(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_creatives (
            source_key, platform_account_id, platform_campaign_id,
            platform_delivery_entity_id, platform_creative_id,
            creative_name, creative_status, creative_type, creative_format,
            destination_url, final_url, content_ref, preview_url, post_id,
            first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            platform_delivery_entity_id = VALUES(platform_delivery_entity_id),
            creative_name = VALUES(creative_name),
            creative_status = VALUES(creative_status),
            creative_type = VALUES(creative_type),
            creative_format = VALUES(creative_format),
            destination_url = VALUES(destination_url),
            final_url = VALUES(final_url),
            content_ref = VALUES(content_ref),
            preview_url = VALUES(preview_url),
            post_id = VALUES(post_id),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row.get('platform_delivery_entity_id') or '',
                row['platform_creative_id'],
                row.get('creative_name'),
                row.get('creative_status'),
                row.get('creative_type'),
                row.get('creative_format'),
                row.get('destination_url'),
                row.get('final_url'),
                row.get('content_ref'),
                row.get('preview_url'),
                row.get('post_id'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def ensure_fact_ads_daily_conversion_value_column(cur) -> None:
    cur.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'canonical_fact_ads_daily'
          AND COLUMN_NAME = 'conversion_value'
        """
    )
    row = cur.fetchone()
    exists = row[0] if not isinstance(row, dict) else next(iter(row.values()))
    if not exists:
        cur.execute(
            """
            ALTER TABLE canonical_fact_ads_daily
            ADD COLUMN conversion_value DECIMAL(18,6) DEFAULT NULL AFTER conversions
            """
        )


def upsert_fact_ads_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    ensure_fact_ads_daily_conversion_value_column(cur)
    cur.executemany(
        """
        INSERT INTO canonical_fact_ads_daily (
            source_key, platform_account_id, platform_campaign_id,
            fact_scope, native_grain, breakdown_scope,
            platform_delivery_entity_id, platform_creative_id,
            report_date, spend, impressions, clicks, views, conversions, conversion_value,
            reach, frequency, ctr, cpm, cpc, cpv, cpa,
            video_views_25, video_views_50, video_views_75, video_views_100,
            link_clicks, likes, comments, shares, reactions, follows,
            currency_code, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s
        )
        ON DUPLICATE KEY UPDATE
            spend = VALUES(spend),
            impressions = VALUES(impressions),
            clicks = VALUES(clicks),
            views = VALUES(views),
            conversions = VALUES(conversions),
            conversion_value = VALUES(conversion_value),
            reach = VALUES(reach),
            frequency = VALUES(frequency),
            ctr = VALUES(ctr),
            cpm = VALUES(cpm),
            cpc = VALUES(cpc),
            cpv = VALUES(cpv),
            cpa = VALUES(cpa),
            video_views_25 = VALUES(video_views_25),
            video_views_50 = VALUES(video_views_50),
            video_views_75 = VALUES(video_views_75),
            video_views_100 = VALUES(video_views_100),
            link_clicks = VALUES(link_clicks),
            likes = VALUES(likes),
            comments = VALUES(comments),
            shares = VALUES(shares),
            reactions = VALUES(reactions),
            follows = VALUES(follows),
            currency_code = VALUES(currency_code),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row['fact_scope'],
                row['native_grain'],
                row.get('breakdown_scope', 'default'),
                row['platform_delivery_entity_id'],
                row.get('platform_creative_id', ''),
                row['report_date'],
                row.get('spend'),
                row.get('impressions'),
                row.get('clicks'),
                row.get('views'),
                row.get('conversions'),
                row.get('conversion_value'),
                row.get('reach'),
                row.get('frequency'),
                row.get('ctr'),
                row.get('cpm'),
                row.get('cpc'),
                row.get('cpv'),
                row.get('cpa'),
                row.get('video_views_25'),
                row.get('video_views_50'),
                row.get('video_views_75'),
                row.get('video_views_100'),
                row.get('link_clicks'),
                row.get('likes'),
                row.get('comments'),
                row.get('shares'),
                row.get('reactions'),
                row.get('follows'),
                row.get('currency_code'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_promopages_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_promopages_daily (
            source_key, platform_account_id, platform_campaign_id, report_date, traffic_source,
            impressions, reach, budget, cpm, clicks, ctr, views,
            clickouts, clickout_cost, clickout_percent,
            full_reads, full_read_percent, full_read_time_sec,
            metrica_visits, metrica_visit_percent, metrica_visit_cost,
            ingestion_run_id, raw_payload
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s
        )
        ON DUPLICATE KEY UPDATE
            impressions = VALUES(impressions),
            reach = VALUES(reach),
            budget = VALUES(budget),
            cpm = VALUES(cpm),
            clicks = VALUES(clicks),
            ctr = VALUES(ctr),
            views = VALUES(views),
            clickouts = VALUES(clickouts),
            clickout_cost = VALUES(clickout_cost),
            clickout_percent = VALUES(clickout_percent),
            full_reads = VALUES(full_reads),
            full_read_percent = VALUES(full_read_percent),
            full_read_time_sec = VALUES(full_read_time_sec),
            metrica_visits = VALUES(metrica_visits),
            metrica_visit_percent = VALUES(metrica_visit_percent),
            metrica_visit_cost = VALUES(metrica_visit_cost),
            ingestion_run_id = VALUES(ingestion_run_id),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row['report_date'],
                row.get('traffic_source') or 'total',
                row.get('impressions'),
                row.get('reach'),
                row.get('budget'),
                row.get('cpm'),
                row.get('clicks'),
                row.get('ctr'),
                row.get('views'),
                row.get('clickouts'),
                row.get('clickout_cost'),
                row.get('clickout_percent'),
                row.get('full_reads'),
                row.get('full_read_percent'),
                row.get('full_read_time_sec'),
                row.get('metrica_visits'),
                row.get('metrica_visit_percent'),
                row.get('metrica_visit_cost'),
                row.get('ingestion_run_id'),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_site_analytics_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_site_analytics_daily (
            source_key, analytics_account_id, report_date,
            analytics_scope, scope_hash,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            goal_id, goal_name, page_url, page_title, region_city, traffic_source,
            visits, users, new_users, pageviews, goal_reaches,
            page_depth, bounce_rate, avg_visit_duration_seconds,
            ingestion_run_id
        ) VALUES (
            %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s
        )
        ON DUPLICATE KEY UPDATE
            utm_source = VALUES(utm_source),
            utm_medium = VALUES(utm_medium),
            utm_campaign = VALUES(utm_campaign),
            utm_content = VALUES(utm_content),
            utm_term = VALUES(utm_term),
            goal_id = VALUES(goal_id),
            goal_name = VALUES(goal_name),
            page_url = VALUES(page_url),
            page_title = VALUES(page_title),
            region_city = VALUES(region_city),
            traffic_source = VALUES(traffic_source),
            visits = VALUES(visits),
            users = VALUES(users),
            new_users = VALUES(new_users),
            pageviews = VALUES(pageviews),
            goal_reaches = VALUES(goal_reaches),
            page_depth = VALUES(page_depth),
            bounce_rate = VALUES(bounce_rate),
            avg_visit_duration_seconds = VALUES(avg_visit_duration_seconds),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['analytics_account_id'],
                row['report_date'],
                row.get('analytics_scope', 'traffic'),
                row['scope_hash'],
                row.get('utm_source'),
                row.get('utm_medium'),
                row.get('utm_campaign'),
                row.get('utm_content'),
                row.get('utm_term'),
                row.get('goal_id'),
                row.get('goal_name'),
                row.get('page_url'),
                row.get('page_title'),
                row.get('region_city'),
                row.get('traffic_source'),
                row.get('visits'),
                row.get('users'),
                row.get('new_users'),
                row.get('pageviews'),
                row.get('goal_reaches'),
                row.get('page_depth'),
                row.get('bounce_rate'),
                row.get('avg_visit_duration_seconds'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_user_behavior_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_user_behavior_daily (
            source_key, analytics_account_id, report_date, scope_hash,
            user_id, traffic_source_id, traffic_source, start_url, end_url,
            visits, users, new_users,
            page_depth, bounce_rate, avg_visit_duration_seconds,
            up_to_day_user_recency_percentage,
            up_to_week_user_recency_percentage,
            up_to_month_user_recency_percentage,
            ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s
        )
        ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            traffic_source_id = VALUES(traffic_source_id),
            traffic_source = VALUES(traffic_source),
            start_url = VALUES(start_url),
            end_url = VALUES(end_url),
            visits = VALUES(visits),
            users = VALUES(users),
            new_users = VALUES(new_users),
            page_depth = VALUES(page_depth),
            bounce_rate = VALUES(bounce_rate),
            avg_visit_duration_seconds = VALUES(avg_visit_duration_seconds),
            up_to_day_user_recency_percentage = VALUES(up_to_day_user_recency_percentage),
            up_to_week_user_recency_percentage = VALUES(up_to_week_user_recency_percentage),
            up_to_month_user_recency_percentage = VALUES(up_to_month_user_recency_percentage),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['analytics_account_id'],
                row['report_date'],
                row['scope_hash'],
                row['user_id'],
                row.get('traffic_source_id'),
                row.get('traffic_source'),
                row.get('start_url'),
                row.get('end_url'),
                row.get('visits'),
                row.get('users'),
                row.get('new_users'),
                row.get('page_depth'),
                row.get('bounce_rate'),
                row.get('avg_visit_duration_seconds'),
                row.get('up_to_day_user_recency_percentage'),
                row.get('up_to_week_user_recency_percentage'),
                row.get('up_to_month_user_recency_percentage'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)
