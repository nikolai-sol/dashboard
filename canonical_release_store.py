#!/usr/bin/env python3
"""Release metadata and atomic active-pointer operations for canonical datasets."""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

from canonical_writer import get_db_connection


ABBOTT_DATASET_KEY = "abbott"
MUTABLE_RELEASE_STATUS = "staging"
ABBOTT_COUNTER_ID = "90602537"
ABBOTT_REQUIRED_METRIKA_SCOPES = (
    "other",
    "traffic",
    "page",
    "user_behavior",
    "returning",
)


class ReleaseStoreError(RuntimeError):
    """Base class for sanitized release-store failures."""


class ReleaseNotFoundError(ReleaseStoreError):
    """Raised when a release does not belong to the requested dataset."""


class ImmutableReleaseError(ReleaseStoreError):
    """Raised when a writer targets a release that is no longer staging."""


class ReleasePointerConflictError(ReleaseStoreError):
    """Raised when the active pointer changed before a compare-and-swap."""


class ValidationGateError(ReleaseStoreError):
    """Raised when persisted validation evidence or coverage is incomplete."""


def missing_coverage_dates(
    rows: list[dict], *, date_from: str, date_to: str
) -> list[str]:
    """Return dates that do not have the exact required five-scope bundle."""
    start = date.fromisoformat(date_from)
    end = date.fromisoformat(date_to)
    if end < start:
        raise ValidationGateError("Canonical validation date range is invalid")
    scopes_by_day: dict[str, set[str]] = {}
    for row in rows:
        day = str(row.get("report_date"))
        scopes_by_day.setdefault(day, set()).add(str(row.get("scope_key")))
    expected_scopes = set(ABBOTT_REQUIRED_METRIKA_SCOPES)
    missing = []
    current = start
    while current <= end:
        day = current.isoformat()
        if scopes_by_day.get(day) != expected_scopes:
            missing.append(day)
        current += timedelta(days=1)
    return missing


def _close(cur, conn) -> None:
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


def get_release(release_id: int, *, portal_key: str = ABBOTT_DATASET_KEY) -> dict:
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT *
            FROM portal_data_releases
            WHERE dataset_key = %s AND id = %s
            """,
            (portal_key, release_id),
        )
        release = cur.fetchone()
    except Exception:
        raise ReleaseStoreError("Unable to read canonical release") from None
    finally:
        _close(cur, conn)

    if release is None:
        raise ReleaseNotFoundError("Canonical release was not found for dataset")
    return release


def require_mutable_candidate_release(
    release_id: int, *, portal_key: str = ABBOTT_DATASET_KEY
) -> dict:
    release = get_release(release_id, portal_key=portal_key)
    if release.get("release_status") != MUTABLE_RELEASE_STATUS:
        raise ImmutableReleaseError("Canonical release is immutable")
    return release


def create_candidate_release(
    *,
    portal_key: str,
    predecessor_release_id: int,
    baseline_validation_run_id: int,
    code_revision: str,
) -> int:
    conn = None
    cur = None
    release_key = f"{portal_key}-{uuid.uuid4().hex}"
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        current_release_id = _lock_active_pointer(cur, portal_key)
        if current_release_id != predecessor_release_id:
            raise ReleasePointerConflictError("Active canonical release pointer changed")
        cur.execute(
            """
            INSERT INTO portal_data_releases (
                dataset_key, release_key, source_snapshot_ids,
                canonical_version_id, baseline_validation_run_id,
                code_revision, release_status, rollback_from_release_id
            ) VALUES (%s, %s, %s, %s, %s, %s, 'staging', %s)
            """,
            (
                portal_key,
                release_key,
                json.dumps([]),
                code_revision,
                baseline_validation_run_id,
                code_revision,
                predecessor_release_id,
            ),
        )
        release_id = int(cur.lastrowid)
        conn.commit()
        return release_id
    except ReleaseStoreError:
        if conn is not None:
            conn.rollback()
        raise
    except Exception:
        if conn is not None:
            conn.rollback()
        raise ReleaseStoreError("Unable to create canonical release") from None
    finally:
        _close(cur, conn)


def validate_release(
    release_id: int,
    *,
    date_from: str,
    date_to: str,
    expected_code_revision: str,
) -> None:
    """Atomically transition a fully evidenced Abbott candidate to validated."""
    conn = None
    cur = None
    try:
        # Parse before opening a transaction so malformed operator input is inert.
        missing_coverage_dates([], date_from=date_from, date_to=date_to)
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        cur.execute(
            """
            SELECT id, dataset_key, release_status,
                   baseline_validation_run_id, code_revision
            FROM portal_data_releases
            WHERE dataset_key = %s AND id = %s
            FOR UPDATE
            """,
            (ABBOTT_DATASET_KEY, release_id),
        )
        release = cur.fetchone()
        if (
            not isinstance(release, dict)
            or release.get("release_status") != "staging"
            or not release.get("baseline_validation_run_id")
            or not release.get("code_revision")
            or release.get("code_revision") != expected_code_revision
        ):
            raise ValidationGateError("Canonical release is not a valid staging candidate")

        cur.execute(
            """
            SELECT COUNT(*) AS evidence_count,
                   SUM(result_status = 'fail') AS fail_count,
                   SUM(result_status = 'warn' AND accepted_at IS NULL)
                     AS unaccepted_warn_count,
                   SUM(code_revision <> %s) AS revision_mismatch_count
            FROM portal_migration_validation_runs
            WHERE canonical_release_id = %s
              AND baseline_snapshot_id = %s
            """,
            (
                release["code_revision"],
                release_id,
                release["baseline_validation_run_id"],
            ),
        )
        evidence = cur.fetchone()
        if (
            not isinstance(evidence, dict)
            or int(evidence.get("evidence_count") or 0) <= 0
            or int(evidence.get("fail_count") or 0) != 0
            or int(evidence.get("unaccepted_warn_count") or 0) != 0
            or int(evidence.get("revision_mismatch_count") or 0) != 0
        ):
            raise ValidationGateError("Canonical validation evidence did not pass")

        cur.execute(
            """
            WITH RECURSIVE calendar(report_date) AS (
              SELECT CAST(%s AS DATE)
              UNION ALL
              SELECT DATE_ADD(report_date, INTERVAL 1 DAY)
              FROM calendar
              WHERE report_date < CAST(%s AS DATE)
            )
            SELECT COUNT(*) AS missing_date_count
            FROM (
              SELECT calendar.report_date
              FROM calendar
              LEFT JOIN canonical_source_coverage_daily AS coverage
                ON coverage.canonical_release_id = %s
               AND coverage.source_key = 'yandex_metrika'
               AND coverage.counter_id = %s
               AND coverage.report_date = calendar.report_date
               AND coverage.collection_status IN ('success', 'success_empty')
               AND coverage.pagination_complete = 1
               AND coverage.is_sampled = 0
               AND ((coverage.collection_status = 'success'
                     AND coverage.persisted_rows > 0)
                 OR (coverage.collection_status = 'success_empty'
                     AND coverage.persisted_rows = 0
                     AND coverage.api_total_rows = 0
                     AND coverage.empty_reconciled = 1))
              GROUP BY calendar.report_date
              HAVING COUNT(DISTINCT coverage.scope_key) <> 5
                 OR SUM(coverage.scope_key = 'other') = 0
                 OR SUM(coverage.scope_key = 'traffic') = 0
                 OR SUM(coverage.scope_key = 'page') = 0
                 OR SUM(coverage.scope_key = 'user_behavior') = 0
                 OR SUM(coverage.scope_key = 'returning') = 0
            ) AS coverage_gaps
            """,
            (date_from, date_to, release_id, ABBOTT_COUNTER_ID),
        )
        gap_summary = cur.fetchone()
        if (
            not isinstance(gap_summary, dict)
            or int(gap_summary.get("missing_date_count") or 0) != 0
        ):
            raise ValidationGateError("Canonical coverage has missing or partial dates")

        cur.execute(
            """
            INSERT INTO portal_migration_validation_runs (
                canonical_release_id, baseline_snapshot_id,
                candidate_snapshot_id, candidate_run_id, code_revision,
                control_name, expected_value, actual_value,
                absolute_delta, relative_delta, threshold_value,
                result_status, diagnostic_json, reviewed_by, accepted_at
            ) VALUES (
                %s, %s, NULL, NULL, %s,
                'release_gate.calendar_complete', 0, 0,
                0, 0, 0, 'pass', NULL, CURRENT_USER(), NOW()
            )
            """,
            (
                release_id,
                release["baseline_validation_run_id"],
                release["code_revision"],
            ),
        )

        cur.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'validated'
            WHERE dataset_key = %s AND id = %s AND release_status = 'staging'
            """,
            (ABBOTT_DATASET_KEY, release_id),
        )
        if cur.rowcount != 1:
            raise ValidationGateError("Canonical release validation transition changed")
        conn.commit()
    except ReleaseStoreError:
        if conn is not None:
            conn.rollback()
        raise
    except (TypeError, ValueError):
        if conn is not None:
            conn.rollback()
        raise ValidationGateError("Canonical validation input is invalid") from None
    except Exception:
        if conn is not None:
            conn.rollback()
        raise ReleaseStoreError("Unable to validate canonical release") from None
    finally:
        _close(cur, conn)


def _lock_active_pointer(cur, dataset_key: str) -> int:
    cur.execute(
        """
        SELECT canonical_release_id
        FROM portal_active_data_releases
        WHERE dataset_key = %s
        FOR UPDATE
        """,
        (dataset_key,),
    )
    row = cur.fetchone()
    if row is None:
        raise ReleasePointerConflictError("Active canonical release pointer is missing")
    return int(row["canonical_release_id"])


def _compare_and_swap_pointer(
    cur,
    *,
    dataset_key: str,
    expected_release_id: int,
    new_release_id: int,
    reason: str,
) -> None:
    cur.execute(
        """
        UPDATE portal_active_data_releases
        SET canonical_release_id = %s,
            previous_release_id = %s,
            switched_at = NOW(),
            switched_by = CURRENT_USER(),
            switch_reason = %s
        WHERE dataset_key = %s AND canonical_release_id = %s
        """,
        (
            new_release_id,
            expected_release_id,
            reason,
            dataset_key,
            expected_release_id,
        ),
    )
    if cur.rowcount != 1:
        raise ReleasePointerConflictError("Active canonical release pointer changed")


def activate_release(release_id: int, *, expected_active_release_id: int) -> None:
    dataset_key = ABBOTT_DATASET_KEY
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        current_release_id = _lock_active_pointer(cur, dataset_key)
        if current_release_id != expected_active_release_id:
            raise ReleasePointerConflictError("Active canonical release pointer changed")

        cur.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'active', activated_at = NOW(),
                activated_by = CURRENT_USER()
            WHERE dataset_key = %s AND id = %s AND release_status = 'validated'
            """,
            (dataset_key, release_id),
        )
        if cur.rowcount != 1:
            raise ImmutableReleaseError("Canonical release is not validated for activation")
        cur.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'retired', retired_at = NOW()
            WHERE dataset_key = %s AND id = %s AND release_status = 'active'
            """,
            (dataset_key, expected_active_release_id),
        )
        if cur.rowcount != 1:
            raise ReleasePointerConflictError("Expected active release is not active")
        _compare_and_swap_pointer(
            cur,
            dataset_key=dataset_key,
            expected_release_id=expected_active_release_id,
            new_release_id=release_id,
            reason="validated release activation",
        )
        conn.commit()
    except ReleaseStoreError:
        if conn is not None:
            conn.rollback()
        raise
    except Exception:
        if conn is not None:
            conn.rollback()
        raise ReleaseStoreError("Unable to activate canonical release") from None
    finally:
        _close(cur, conn)


def rollback_release(*, from_release_id: int, to_release_id: int) -> None:
    dataset_key = ABBOTT_DATASET_KEY
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(dictionary=True)
        conn.start_transaction()
        current_release_id = _lock_active_pointer(cur, dataset_key)
        if current_release_id != from_release_id:
            raise ReleasePointerConflictError("Active canonical release pointer changed")

        cur.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'retired', retired_at = NOW()
            WHERE dataset_key = %s AND id = %s AND release_status = 'active'
            """,
            (dataset_key, from_release_id),
        )
        if cur.rowcount != 1:
            raise ReleasePointerConflictError("Expected active release is not active")
        cur.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'active', activated_at = NOW(),
                activated_by = CURRENT_USER(), retired_at = NULL,
                rollback_from_release_id = %s,
                rollback_reason = %s
            WHERE dataset_key = %s AND id = %s AND release_status = 'retired'
            """,
            (from_release_id, "active pointer rollback", dataset_key, to_release_id),
        )
        if cur.rowcount != 1:
            raise ImmutableReleaseError("Rollback target is not a retired release")
        _compare_and_swap_pointer(
            cur,
            dataset_key=dataset_key,
            expected_release_id=from_release_id,
            new_release_id=to_release_id,
            reason="canonical release rollback",
        )
        conn.commit()
    except ReleaseStoreError:
        if conn is not None:
            conn.rollback()
        raise
    except Exception:
        if conn is not None:
            conn.rollback()
        raise ReleaseStoreError("Unable to roll back canonical release") from None
    finally:
        _close(cur, conn)
