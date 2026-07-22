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
ABBOTT_REQUIRED_SOURCE_KINDS = (
    "abbott_workbook_json",
    "abbott_workbook_catalog",
)
ABBOTT_OPTIONAL_SOURCE_KINDS = (
    "abbott_bitrix_pages",
    "abbott_bitrix_journeys",
)
ABBOTT_ALLOWED_SOURCE_KINDS = frozenset(
    ABBOTT_REQUIRED_SOURCE_KINDS + ABBOTT_OPTIONAL_SOURCE_KINDS
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


def _json_value(value, *, error_message: str):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise ValidationGateError(error_message) from None
    return value


def _required_control_names(manifest: dict) -> set[str]:
    control_values = manifest.get("control_values")
    if not isinstance(control_values, dict):
        raise ValidationGateError("Frozen baseline controls are invalid")
    names = {str(name) for name in control_values}
    if any(not name.strip() for name in names) or len(names) != len(control_values):
        raise ValidationGateError("Frozen baseline controls are invalid")
    names.update(
        f"coverage.{scope}.reconciled_days"
        for scope in ABBOTT_REQUIRED_METRIKA_SCOPES
    )
    return names


def _validate_imported_sources(
    *,
    release: dict,
    baseline_manifest: dict,
    snapshot_rows: list[dict],
    execution_rows: list[dict],
) -> None:
    raw_ids = _json_value(
        release.get("source_snapshot_ids"),
        error_message="Canonical release source snapshots are invalid",
    )
    if (
        not isinstance(raw_ids, list)
        or any(not isinstance(item, int) or isinstance(item, bool) or item <= 0 for item in raw_ids)
        or len(set(raw_ids)) != len(raw_ids)
    ):
        raise ValidationGateError("Canonical release source snapshots are invalid")

    frozen_files = baseline_manifest.get("file_snapshots")
    if not isinstance(frozen_files, list) or any(
        not isinstance(item, dict) for item in frozen_files
    ):
        raise ValidationGateError("Frozen baseline source manifest is invalid")
    frozen_kinds = [str(item.get("source_kind")) for item in frozen_files]
    expected_kinds = set(frozen_kinds)
    if (
        len(expected_kinds) != len(frozen_kinds)
        or not set(ABBOTT_REQUIRED_SOURCE_KINDS).issubset(expected_kinds)
        or not expected_kinds.issubset(ABBOTT_ALLOWED_SOURCE_KINDS)
    ):
        raise ValidationGateError("Frozen baseline source manifest is invalid")
    frozen_by_kind = dict(zip(frozen_kinds, frozen_files))

    if len(raw_ids) != len(expected_kinds):
        raise ValidationGateError("Canonical release source set does not match baseline")

    if any(not isinstance(row, dict) for row in snapshot_rows):
        raise ValidationGateError("Required imported source snapshots are incomplete")
    snapshot_kinds = [str(row.get("source_kind")) for row in snapshot_rows]
    snapshot_ids = [row.get("id") for row in snapshot_rows]
    if (
        len(snapshot_rows) != len(expected_kinds)
        or len(set(snapshot_kinds)) != len(snapshot_kinds)
        or set(snapshot_kinds) != expected_kinds
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in snapshot_ids
        )
        or len(set(snapshot_ids)) != len(snapshot_ids)
        or set(snapshot_ids) != set(raw_ids)
    ):
        raise ValidationGateError("Required imported source snapshots are incomplete")
    snapshots_by_kind = dict(zip(snapshot_kinds, snapshot_rows))

    if any(not isinstance(row, dict) for row in execution_rows):
        raise ValidationGateError("Required release import executions are incomplete")
    execution_kinds = [str(row.get("source_kind")) for row in execution_rows]
    execution_ids = [row.get("source_snapshot_id") for row in execution_rows]
    if (
        len(execution_rows) != len(expected_kinds)
        or len(set(execution_kinds)) != len(execution_kinds)
        or set(execution_kinds) != expected_kinds
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in execution_ids
        )
        or len(set(execution_ids)) != len(execution_ids)
        or set(execution_ids) != set(raw_ids)
    ):
        raise ValidationGateError("Required release import executions are incomplete")
    executions_by_kind = dict(zip(execution_kinds, execution_rows))

    for kind in expected_kinds:
        frozen = frozen_by_kind[kind]
        snapshot = snapshots_by_kind[kind]
        execution = executions_by_kind[kind]
        source_manifest = _json_value(
            snapshot.get("manifest_json"),
            error_message="Imported source manifest is invalid",
        )
        if not isinstance(source_manifest, dict):
            raise ValidationGateError("Imported source manifest is invalid")
        fingerprint_fields = ("content_sha256", "content_bytes", "parser_version")
        if (
            snapshot.get("import_status") != "imported"
            or int(snapshot.get("imported_row_count") or 0) <= 0
            or int(snapshot.get("rejected_row_count") or 0) != 0
            or source_manifest.get("source_kind") != kind
            or int(source_manifest.get("rejected_count") or 0) != 0
            or any(snapshot.get(field) != frozen.get(field) for field in fingerprint_fields)
            or any(source_manifest.get(field) != frozen.get(field) for field in fingerprint_fields)
        ):
            raise ValidationGateError("Imported source does not match the frozen baseline")
        if (
            execution.get("import_status") != "imported"
            or execution.get("source_snapshot_id") != snapshot.get("id")
            or execution.get("code_revision") != release.get("code_revision")
            or int(execution.get("imported_row_count") or 0)
            != int(snapshot.get("imported_row_count") or 0)
            or int(execution.get("rejected_row_count") or 0) != 0
        ):
            raise ValidationGateError("Release import execution does not match the candidate")


def _validate_exact_evidence(
    rows: list[dict], *, expected_names: set[str], code_revision: str,
    validation_run_id: str,
) -> None:
    actual_names = {
        str(row.get("control_name")) for row in rows if isinstance(row, dict)
    }
    if len(rows) != len(expected_names) or actual_names != expected_names:
        raise ValidationGateError("Canonical validation evidence set is incomplete")
    for row in rows:
        status = row.get("result_status")
        if (
            row.get("code_revision") != code_revision
            or row.get("validation_run_id") != validation_run_id
            or row.get("validation_run_completed_at") is None
        ):
            raise ValidationGateError("Canonical validation revision does not match")
        if status == "pass":
            continue
        if (
            status == "warn"
            and row.get("accepted_at") is not None
            and isinstance(row.get("reviewed_by"), str)
            and row["reviewed_by"].strip()
        ):
            continue
        raise ValidationGateError("Canonical validation evidence did not pass review")


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
                   baseline_validation_run_id, code_revision,
                   source_snapshot_ids
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
            SELECT manifest_json
            FROM portal_dataset_snapshots
            WHERE id = %s AND dataset_key = %s
              AND source_kind = 'abbott_canonical_control_pack'
            FOR UPDATE
            """,
            (release["baseline_validation_run_id"], ABBOTT_DATASET_KEY),
        )
        baseline_row = cur.fetchone()
        baseline_manifest = _json_value(
            baseline_row.get("manifest_json") if isinstance(baseline_row, dict) else None,
            error_message="Frozen baseline manifest is invalid",
        )
        if not isinstance(baseline_manifest, dict):
            raise ValidationGateError("Frozen baseline manifest is invalid")
        expected_control_names = _required_control_names(baseline_manifest)

        source_ids = _json_value(
            release.get("source_snapshot_ids"),
            error_message="Canonical release source snapshots are invalid",
        )
        if not isinstance(source_ids, list) or not source_ids:
            raise ValidationGateError("Canonical release source snapshots are invalid")
        placeholders = ", ".join(["%s"] * len(source_ids))
        cur.execute(
            f"""
            SELECT id, source_kind, content_sha256, content_bytes,
                   parser_version, import_status, imported_row_count,
                   rejected_row_count, manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id IN ({placeholders})
            ORDER BY id
            FOR UPDATE
            """,
            (ABBOTT_DATASET_KEY, *source_ids),
        )
        snapshot_rows = cur.fetchall()
        cur.execute(
            """
            SELECT source_snapshot_id, source_kind, code_revision,
                   import_status, imported_row_count, rejected_row_count
            FROM portal_release_source_imports
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id
            FOR UPDATE
            """,
            (release_id,),
        )
        _validate_imported_sources(
            release=release,
            baseline_manifest=baseline_manifest,
            snapshot_rows=snapshot_rows,
            execution_rows=cur.fetchall(),
        )

        cur.execute(
            """
            SELECT validation_run_id, validation_run_completed_at
            FROM portal_migration_validation_runs
            WHERE canonical_release_id = %s
              AND baseline_snapshot_id = %s
            ORDER BY id DESC
            LIMIT 1
            FOR UPDATE
            """,
            (release_id, release["baseline_validation_run_id"]),
        )
        latest_validation = cur.fetchone()
        if (
            not isinstance(latest_validation, dict)
            or not isinstance(latest_validation.get("validation_run_id"), str)
            or not latest_validation["validation_run_id"].strip()
            or latest_validation.get("validation_run_completed_at") is None
        ):
            raise ValidationGateError("Latest canonical validation run is incomplete")

        cur.execute(
            """
            SELECT control_name, result_status, reviewed_by, accepted_at,
                   code_revision, validation_run_id,
                   validation_run_completed_at
            FROM portal_migration_validation_runs
            WHERE canonical_release_id = %s
              AND baseline_snapshot_id = %s
              AND validation_run_id = %s
            ORDER BY control_name
            FOR UPDATE
            """,
            (
                release_id,
                release["baseline_validation_run_id"],
                latest_validation["validation_run_id"],
            ),
        )
        _validate_exact_evidence(
            cur.fetchall(),
            expected_names=expected_control_names,
            code_revision=release["code_revision"],
            validation_run_id=latest_validation["validation_run_id"],
        )

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
                candidate_snapshot_id, candidate_run_id,
                validation_run_id, validation_run_completed_at, code_revision,
                control_name, expected_value, actual_value,
                absolute_delta, relative_delta, threshold_value,
                result_status, diagnostic_json, reviewed_by, accepted_at
            ) VALUES (
                %s, %s, NULL, NULL, UUID(), NOW(), %s,
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
