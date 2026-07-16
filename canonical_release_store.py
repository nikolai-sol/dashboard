#!/usr/bin/env python3
"""Release metadata and atomic active-pointer operations for canonical datasets."""

from __future__ import annotations

import json
import uuid

from canonical_writer import get_db_connection


ABBOTT_DATASET_KEY = "abbott"
MUTABLE_RELEASE_STATUS = "staging"


class ReleaseStoreError(RuntimeError):
    """Base class for sanitized release-store failures."""


class ReleaseNotFoundError(ReleaseStoreError):
    """Raised when a release does not belong to the requested dataset."""


class ImmutableReleaseError(ReleaseStoreError):
    """Raised when a writer targets a release that is no longer staging."""


class ReleasePointerConflictError(ReleaseStoreError):
    """Raised when the active pointer changed before a compare-and-swap."""


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
        cur = conn.cursor()
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
    except Exception:
        if conn is not None:
            conn.rollback()
        raise ReleaseStoreError("Unable to create canonical release") from None
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
