#!/usr/bin/env python3
"""Materialize a metadata-only Abbott MNN successor.

This operator deliberately treats prior content approval as immutable evidence.
It never writes an approval batch, approval item, or classification event.
"""

from __future__ import annotations

from dataclasses import dataclass
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
from typing import Mapping, Optional, Sequence


DATASET_KEY = "abbott"
MNN_SOURCE_KIND = "abbott_mnn_workbook"
MNN_CONTROL_NAMES = (
    "mnn.catalog_copy_rows",
    "mnn.lookup_copy_rows",
    "mnn.mapping_count",
    "mnn.non_content_parity",
)


class MnnSuccessorError(RuntimeError):
    """Stable, non-sensitive MNN successor failure."""


def safe_failure_code(error: BaseException, *, fallback: str = "MNN_SUCCESSOR_MATERIALIZATION_FAILED") -> str:
    """Expose only an existing stable error code from lower-level gates."""

    value = str(error)
    return value if re.fullmatch(r"[A-Z][A-Z0-9_]{2,63}", value) else fallback


def materializer_connection_kwargs(
    environment: Optional[Mapping[str, str]] = None,
) -> dict[str, object]:
    """Return the dedicated content-materializer connection contract."""

    environment = environment if environment is not None else os.environ
    names = {
        "host": "ABBOTT_CONTENT_MATERIALIZER_DB_HOST",
        "port": "ABBOTT_CONTENT_MATERIALIZER_DB_PORT",
        "database": "ABBOTT_CONTENT_MATERIALIZER_DB_NAME",
        "user": "ABBOTT_CONTENT_MATERIALIZER_DB_USER",
        "password": "ABBOTT_CONTENT_MATERIALIZER_DB_PASSWORD",
    }
    values = {key: str(environment.get(name) or "").strip() for key, name in names.items()}
    try:
        values["port"] = int(values["port"])
    except ValueError:
        raise MnnSuccessorError("MATERIALIZER_DB_CONFIG_INVALID") from None
    if (
        not values["host"]
        or not values["database"]
        or not values["user"]
        or not values["password"]
        or not 1 <= values["port"] <= 65535
    ):
        raise MnnSuccessorError("MATERIALIZER_DB_CONFIG_INVALID")
    return {**values, "charset": "utf8mb4", "collation": "utf8mb4_unicode_ci"}


def get_materializer_db_connection():
    """Open only the existing private-capable content materializer connection."""

    try:
        import mysql.connector
        return mysql.connector.connect(**materializer_connection_kwargs())
    except MnnSuccessorError:
        raise
    except Exception:
        raise MnnSuccessorError("MATERIALIZER_DB_CONNECTION_FAILED") from None


def get_release_operator_db_connection():
    """Open the separate release-operator connection for validation writes.

    The materializer role deliberately has read-only access to validation
    evidence.  The release-operator role is the only reviewed authority that
    may persist those controls or advance a release from staging to validated.
    """

    try:
        from abbott_release_operator import (
            OperatorConfigurationError,
            get_operator_db_connection,
        )
        return get_operator_db_connection()
    except OperatorConfigurationError:
        raise MnnSuccessorError("RELEASE_OPERATOR_DB_CONFIG_INVALID") from None
    except Exception:
        raise MnnSuccessorError("RELEASE_OPERATOR_DB_CONNECTION_FAILED") from None


@dataclass(frozen=True)
class MnnSuccessorReceipt:
    predecessor_release_id: int
    historical_batch_id: int
    mnn_snapshot_id: int
    candidate_release_id: int
    status: str = "staging"


def validate_backup_receipt(
    receipt: Optional[Mapping[str, object]],
    *,
    expected_predecessor_release_id: int,
) -> None:
    """Validate the sanitized pre-write backup receipt supplied by the operator."""

    if not isinstance(receipt, Mapping):
        raise MnnSuccessorError("BACKUP_RECEIPT_REQUIRED")
    digest = receipt.get("sha256")
    try:
        predecessor = int(receipt.get("expected_predecessor_release_id") or 0)
        size = int(receipt.get("bytes") or 0)
    except (TypeError, ValueError):
        raise MnnSuccessorError("BACKUP_RECEIPT_INVALID") from None
    if (
        receipt.get("database") != "report_bd"
        or predecessor != expected_predecessor_release_id
        or size <= 0
        or not isinstance(digest, str)
        or re.fullmatch(r"[0-9a-f]{64}", digest) is None
    ):
        raise MnnSuccessorError("BACKUP_RECEIPT_INVALID")


def assert_historical_batch_evidence(
    batch: Optional[Mapping[str, object]],
    *,
    predecessor_release_id: int,
    historical_batch_id: int,
) -> str:
    """Return the locked accepted hash only for the already-materialized batch."""

    if not isinstance(batch, Mapping):
        raise MnnSuccessorError("HISTORICAL_BATCH_INVALID")
    accepted_hash = batch.get("accepted_decision_hash")
    try:
        batch_id = int(batch.get("id") or 0)
        candidate_release_id = int(batch.get("candidate_release_id") or 0)
    except (TypeError, ValueError):
        raise MnnSuccessorError("HISTORICAL_BATCH_INVALID") from None
    if (
        batch_id != historical_batch_id
        or batch.get("batch_status") != "candidate_materialized"
        or candidate_release_id != predecessor_release_id
        or batch.get("accepted_at") is None
        or not isinstance(accepted_hash, str)
        or re.fullmatch(r"[0-9a-f]{64}", accepted_hash) is None
    ):
        raise MnnSuccessorError("HISTORICAL_BATCH_INVALID")
    return accepted_hash


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _positive_ids(value: object, *, code: str) -> list[int]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise MnnSuccessorError(code) from None
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, int) or isinstance(item, bool) or item <= 0 for item in value)
        or len(set(value)) != len(value)
    ):
        raise MnnSuccessorError(code)
    return list(value)


def _snapshot_file_records(rows: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    records = []
    for row in rows:
        record = {
            "source_kind": str(row.get("source_kind") or ""),
            "content_sha256": str(row.get("content_sha256") or ""),
            "content_bytes": int(row.get("content_bytes") or 0),
            "parser_version": str(row.get("parser_version") or ""),
            "source_row_count": int(row.get("source_row_count") or 0),
        }
        if (
            not record["source_kind"]
            or re.fullmatch(r"[0-9a-f]{64}", record["content_sha256"]) is None
            or record["content_bytes"] <= 0
            or not record["parser_version"]
            or record["source_row_count"] <= 0
        ):
            raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
        records.append(record)
    if len({str(row["source_kind"]) for row in records}) != len(records):
        raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
    return records


def _read_catalog_hash(cursor, release_id: int, snapshot_id: int) -> tuple[int, str]:
    from agents.abbott_page_classifier.candidate_release import _CATALOG_COLUMNS, _hash_rows

    cursor.execute(
        f"SELECT {', '.join(_CATALOG_COLUMNS)} FROM portal_content_catalog "
        "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY source_sheet, source_row_ordinal",
        (release_id, snapshot_id),
    )
    rows = tuple(tuple(row.get(column) for column in _CATALOG_COLUMNS) for row in cursor.fetchall())
    return len(rows), _hash_rows(rows)


def _read_lookup_hash(cursor, release_id: int, snapshot_id: int) -> tuple[int, str]:
    from agents.abbott_page_classifier.candidate_release import _LOOKUP_COLUMNS, _hash_rows

    cursor.execute(
        f"SELECT {', '.join(_LOOKUP_COLUMNS)} FROM portal_content_lookup_projection "
        "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY lookup_kind, lookup_key_hash",
        (release_id, snapshot_id),
    )
    rows = tuple(tuple(row.get(column) for column in _LOOKUP_COLUMNS) for row in cursor.fetchall())
    return len(rows), _hash_rows(rows)


def _copy_catalog_and_lookup(cursor, *, predecessor_id: int, candidate_id: int, snapshot_id: int) -> None:
    from agents.abbott_page_classifier.candidate_release import _CATALOG_COLUMNS, _LOOKUP_COLUMNS

    catalog_columns = ", ".join(_CATALOG_COLUMNS)
    cursor.execute(
        f"INSERT INTO portal_content_catalog (canonical_release_id, source_snapshot_id, {catalog_columns}) "
        f"SELECT %s, source_snapshot_id, {catalog_columns} "
        "FROM portal_content_catalog WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY source_sheet, source_row_ordinal",
        (candidate_id, predecessor_id, snapshot_id),
    )
    lookup_columns = ", ".join(_LOOKUP_COLUMNS)
    cursor.execute(
        f"INSERT INTO portal_content_lookup_projection (canonical_release_id, source_snapshot_id, {lookup_columns}) "
        f"SELECT %s, source_snapshot_id, {lookup_columns} "
        "FROM portal_content_lookup_projection WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY lookup_kind, lookup_key_hash",
        (candidate_id, predecessor_id, snapshot_id),
    )


def materialize_mnn_successor(
    predecessor_release_id: int,
    historical_batch_id: int,
    mnn_snapshot_id: int,
    code_revision: str,
    *,
    backup_receipt: Optional[Mapping[str, object]],
    connection_factory=None,
) -> MnnSuccessorReceipt:
    """Create one staging successor by copying a release and adding MNN only."""

    if (
        not all(isinstance(value, int) and not isinstance(value, bool) and value > 0
                for value in (predecessor_release_id, historical_batch_id, mnn_snapshot_id))
        or not isinstance(code_revision, str)
        or re.fullmatch(r"[0-9a-f]{7,64}", code_revision) is None
    ):
        raise MnnSuccessorError("MNN_SUCCESSOR_INPUT_INVALID")
    validate_backup_receipt(
        backup_receipt, expected_predecessor_release_id=predecessor_release_id
    )
    import canonical_release_store as release_store
    from agents.abbott_page_classifier.candidate_release import (
        _copy_non_content_facts,
        _hash_rows,
        _mnn_semantic_rows,
        _persist_mnn_projection,
        _read_non_content_bundle,
        _snapshot_rejections_allowed,
    )
    connection = cursor = None
    stage = "connect"
    try:
        connection = (connection_factory or get_materializer_db_connection)()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        stage = "active_pointer"
        cursor.execute(
            """
            SELECT active.canonical_release_id, predecessor.release_status,
                   predecessor.source_snapshot_ids, predecessor.baseline_validation_run_id
            FROM portal_active_data_releases AS active
            INNER JOIN portal_data_releases AS predecessor
              ON predecessor.dataset_key = active.dataset_key
             AND predecessor.id = active.canonical_release_id
            WHERE active.dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        predecessor = cursor.fetchone()
        if (
            not isinstance(predecessor, Mapping)
            or int(predecessor.get("canonical_release_id") or 0) != predecessor_release_id
            or predecessor.get("release_status") != "active"
            or int(predecessor.get("baseline_validation_run_id") or 0) <= 0
        ):
            raise MnnSuccessorError("ACTIVE_PREDECESSOR_MISMATCH")
        predecessor_source_ids = _positive_ids(
            predecessor.get("source_snapshot_ids"), code="SOURCE_SNAPSHOT_INVALID"
        )
        stage = "historical_batch"
        cursor.execute(
            """
            SELECT id, batch_status, candidate_release_id, accepted_decision_hash, accepted_at
            FROM portal_content_approval_batches
            WHERE id = %s AND dataset_key = %s
            FOR SHARE
            """,
            (historical_batch_id, DATASET_KEY),
        )
        accepted_hash = assert_historical_batch_evidence(
            cursor.fetchone(),
            predecessor_release_id=predecessor_release_id,
            historical_batch_id=historical_batch_id,
        )
        stage = "snapshots"
        placeholders = ", ".join(["%s"] * (len(predecessor_source_ids) + 1))
        cursor.execute(
            f"""
            SELECT id, source_kind, content_sha256, content_bytes, parser_version,
                   import_status, imported_row_count, rejected_row_count,
                   manifest_json, source_row_count
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id IN ({placeholders})
            ORDER BY id
            FOR UPDATE
            """,
            (DATASET_KEY, *predecessor_source_ids, mnn_snapshot_id),
        )
        snapshots = tuple(cursor.fetchall())
        by_id = {int(row.get("id") or 0): row for row in snapshots if isinstance(row, Mapping)}
        if set(by_id) != set(predecessor_source_ids) | {mnn_snapshot_id}:
            raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
        mnn_snapshot = by_id[mnn_snapshot_id]
        if (
            mnn_snapshot.get("source_kind") != MNN_SOURCE_KIND
            or not _snapshot_rejections_allowed(mnn_snapshot)
        ):
            raise MnnSuccessorError("MNN_SNAPSHOT_INVALID")
        catalog_ids = [
            snapshot_id for snapshot_id in predecessor_source_ids
            if by_id[snapshot_id].get("source_kind") == "abbott_workbook_catalog"
        ]
        if len(catalog_ids) != 1 or MNN_SOURCE_KIND in {
            str(by_id[snapshot_id].get("source_kind") or "")
            for snapshot_id in predecessor_source_ids
        }:
            raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
        catalog_snapshot_id = catalog_ids[0]
        stage = "source_imports"
        cursor.execute(
            """
            SELECT source_snapshot_id, source_kind, imported_row_count,
                   rejected_row_count, import_status
            FROM portal_release_source_imports
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id
            FOR UPDATE
            """,
            (predecessor_release_id,),
        )
        predecessor_imports = tuple(cursor.fetchall())
        if {int(row.get("source_snapshot_id") or 0) for row in predecessor_imports} != set(predecessor_source_ids):
            raise MnnSuccessorError("SOURCE_IMPORT_INVALID")
        catalog_count, catalog_hash = _read_catalog_hash(
            cursor, predecessor_release_id, catalog_snapshot_id
        )
        stage = "lookup"
        lookup_count, lookup_hash = _read_lookup_hash(
            cursor, predecessor_release_id, catalog_snapshot_id
        )
        if catalog_count <= 0 or lookup_count <= 0:
            raise MnnSuccessorError("PREDECESSOR_METADATA_EMPTY")
        predecessor_non_content = _read_non_content_bundle(cursor, predecessor_release_id)
        stage = "mnn_rows"
        mnn_rows = _mnn_semantic_rows(
            cursor,
            predecessor_release_id=predecessor_release_id,
            old_mnn_snapshot_id=None,
            new_mnn_snapshot_id=mnn_snapshot_id,
        )
        if not mnn_rows:
            raise MnnSuccessorError("MNN_MAPPING_EMPTY")
        candidate_source_ids = [*predecessor_source_ids, mnn_snapshot_id]
        candidate_snapshot_rows = [by_id[item] for item in candidate_source_ids]
        bundle = {
            "historical_batch_id": historical_batch_id,
            "historical_accepted_decision_hash": accepted_hash,
            "predecessor_release_id": predecessor_release_id,
            "predecessor_source_snapshot_ids": predecessor_source_ids,
            "candidate_source_snapshot_ids": candidate_source_ids,
            "catalog_snapshot_id": catalog_snapshot_id,
            "catalog_count": catalog_count,
            "catalog_hash": catalog_hash,
            "lookup_count": lookup_count,
            "lookup_hash": lookup_hash,
            "mnn_snapshot_id": mnn_snapshot_id,
            "mnn_count": len(mnn_rows),
            "mnn_hash": _hash_rows(mnn_rows),
            "non_content": predecessor_non_content,
            "backup_sha256": str(backup_receipt["sha256"]),
        }
        control_values = {
            "mnn.catalog_copy_rows": catalog_count,
            "mnn.lookup_copy_rows": lookup_count,
            "mnn.mapping_count": len(mnn_rows),
            "mnn.non_content_parity": 1,
        }
        baseline_manifest = {
            "source_kind": "abbott_canonical_control_pack",
            "control_values": control_values,
            "file_snapshots": _snapshot_file_records(candidate_snapshot_rows),
            "mnn_successor_bundle": bundle,
        }
        baseline_json = _canonical_json(baseline_manifest)
        stage = "control_pack"
        baseline_hash = hashlib.sha256(baseline_json.encode("utf-8")).hexdigest()
        cursor.execute(
            """
            SELECT id, manifest_json FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND source_kind = 'abbott_canonical_control_pack'
              AND content_sha256 = %s AND parser_version = 'abbott-mnn-successor-v1'
            FOR UPDATE
            """,
            (DATASET_KEY, baseline_hash),
        )
        existing_control_pack = cursor.fetchone()
        if isinstance(existing_control_pack, Mapping):
            if _canonical_json(_json_mapping(existing_control_pack.get("manifest_json"), code="CONTROL_PACK_INVALID")) != baseline_json:
                raise MnnSuccessorError("CONTROL_PACK_REPLAY_MISMATCH")
            baseline_snapshot_id = int(existing_control_pack.get("id") or 0)
        else:
            cursor.execute(
                """
                INSERT INTO portal_dataset_snapshots (
                  snapshot_key, dataset_key, source_kind, source_locator,
                  content_sha256, content_bytes, source_row_count, parser_version,
                  import_status, imported_row_count, rejected_row_count,
                  private_archive_locator, manifest_json, imported_at
                ) VALUES (
                  UUID(), %s, 'abbott_canonical_control_pack', %s, %s, %s, %s,
                  'abbott-mnn-successor-v1', 'imported', %s, 0, %s, %s, NOW(6)
                )
                """,
                (
                    DATASET_KEY,
                    f"canonical://abbott/mnn-successor/{historical_batch_id}",
                    baseline_hash,
                    len(baseline_json.encode("utf-8")),
                    len(control_values),
                    len(control_values),
                    f"canonical://abbott/mnn-successor/{historical_batch_id}",
                    baseline_json,
                ),
            )
            baseline_snapshot_id = int(cursor.lastrowid)
            if baseline_snapshot_id <= 0 or int(cursor.rowcount) != 1:
                raise MnnSuccessorError("CONTROL_PACK_INSERT_FAILED")
        candidate_release_id = release_store.create_candidate_release(
            portal_key=DATASET_KEY,
            predecessor_release_id=predecessor_release_id,
            baseline_validation_run_id=baseline_snapshot_id,
            code_revision=code_revision,
            connection=connection,
        )
        stage = "candidate_source_set"
        cursor.execute(
            """
            UPDATE portal_data_releases
            SET source_snapshot_ids = %s
            WHERE dataset_key = %s AND id = %s AND release_status = 'staging'
            """,
            (_canonical_json(candidate_source_ids), DATASET_KEY, candidate_release_id),
        )
        if int(cursor.rowcount) != 1:
            raise MnnSuccessorError("CANDIDATE_NOT_MUTABLE")
        stage = "copy_imports"
        for row in predecessor_imports:
            cursor.execute(
                """
                INSERT INTO portal_release_source_imports (
                  canonical_release_id, source_snapshot_id, source_kind, code_revision,
                  import_status, imported_row_count, rejected_row_count, imported_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(6))
                """,
                (
                    candidate_release_id,
                    int(row["source_snapshot_id"]),
                    row["source_kind"],
                    code_revision,
                    row["import_status"],
                    int(row.get("imported_row_count") or 0),
                    int(row.get("rejected_row_count") or 0),
                ),
            )
            if int(cursor.rowcount) != 1:
                raise MnnSuccessorError("SOURCE_IMPORT_COPY_FAILED")
        cursor.execute(
            """
            INSERT INTO portal_release_source_imports (
              canonical_release_id, source_snapshot_id, source_kind, code_revision,
              import_status, imported_row_count, rejected_row_count, imported_at
            ) VALUES (%s, %s, %s, %s, 'imported', %s, %s, NOW(6))
            """,
            (
                candidate_release_id,
                mnn_snapshot_id,
                MNN_SOURCE_KIND,
                code_revision,
                int(mnn_snapshot.get("imported_row_count") or 0),
                int(mnn_snapshot.get("rejected_row_count") or 0),
            ),
        )
        if int(cursor.rowcount) != 1:
            raise MnnSuccessorError("MNN_IMPORT_COPY_FAILED")
        stage = "copy_facts"
        _copy_non_content_facts(
            cursor, predecessor_release_id, candidate_release_id, predecessor_non_content
        )
        stage = "copy_metadata"
        _copy_catalog_and_lookup(
            cursor,
            predecessor_id=predecessor_release_id,
            candidate_id=candidate_release_id,
            snapshot_id=catalog_snapshot_id,
        )
        candidate_catalog_count, candidate_catalog_hash = _read_catalog_hash(
            cursor, candidate_release_id, catalog_snapshot_id
        )
        candidate_lookup_count, candidate_lookup_hash = _read_lookup_hash(
            cursor, candidate_release_id, catalog_snapshot_id
        )
        if (
            (candidate_catalog_count, candidate_catalog_hash) != (catalog_count, catalog_hash)
            or (candidate_lookup_count, candidate_lookup_hash) != (lookup_count, lookup_hash)
        ):
            raise MnnSuccessorError("METADATA_COPY_MISMATCH")
        stage = "copy_mnn"
        _persist_mnn_projection(
            cursor, candidate_release_id=candidate_release_id, rows=mnn_rows
        )
        connection.commit()
        return MnnSuccessorReceipt(
            predecessor_release_id=predecessor_release_id,
            historical_batch_id=historical_batch_id,
            mnn_snapshot_id=mnn_snapshot_id,
            candidate_release_id=candidate_release_id,
        )
    except MnnSuccessorError:
        if connection is not None:
            connection.rollback()
        raise
    except Exception as error:
        if connection is not None:
            connection.rollback()
        code = safe_failure_code(error, fallback="")
        if not code:
            detail = re.sub(r"[^A-Z0-9]", "_", type(error).__name__.upper()).strip("_")
            code = f"MNN_SUCCESSOR_STAGE_{stage.upper()}_{detail}"
        raise MnnSuccessorError(code[:64]) from None
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()


def _json_mapping(value: object, *, code: str) -> Mapping[str, object]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise MnnSuccessorError(code) from None
    if not isinstance(value, Mapping):
        raise MnnSuccessorError(code)
    return value


def _coverage_date_bounds(cursor, candidate_release_id: int) -> tuple[str, str, dict[str, int]]:
    cursor.execute(
        """
        SELECT MIN(report_date) AS min_date, MAX(report_date) AS max_date
        FROM canonical_source_coverage_daily
        WHERE canonical_release_id = %s
          AND source_key = 'yandex_metrika' AND counter_id = '90602537'
        """,
        (candidate_release_id,),
    )
    bounds = cursor.fetchone()
    if not isinstance(bounds, Mapping) or bounds.get("min_date") is None or bounds.get("max_date") is None:
        raise MnnSuccessorError("COVERAGE_INVALID")
    cursor.execute(
        """
        SELECT scope_key, COUNT(DISTINCT report_date) AS day_count
        FROM canonical_source_coverage_daily
        WHERE canonical_release_id = %s
          AND source_key = 'yandex_metrika' AND counter_id = '90602537'
          AND collection_status IN ('success', 'success_empty')
          AND pagination_complete = 1 AND is_sampled = 0
          AND ((collection_status = 'success' AND persisted_rows > 0)
            OR (collection_status = 'success_empty' AND persisted_rows = 0
              AND api_total_rows = 0 AND empty_reconciled = 1))
        GROUP BY scope_key
        """,
        (candidate_release_id,),
    )
    counts = {str(row.get("scope_key") or ""): int(row.get("day_count") or 0) for row in cursor.fetchall()}
    required = {"other", "traffic", "page", "user_behavior", "returning"}
    if set(counts) != required or any(counts[scope] <= 0 for scope in required):
        raise MnnSuccessorError("COVERAGE_INVALID")
    return str(bounds["min_date"]), str(bounds["max_date"]), counts


def validate_mnn_successor(
    candidate_release_id: int,
    expected_predecessor_release_id: int,
    code_revision: str,
    *,
    connection_factory=None,
) -> None:
    """Validate an MNN-only successor and leave activation to the CAS operator."""

    if (
        not all(isinstance(value, int) and not isinstance(value, bool) and value > 0
                for value in (candidate_release_id, expected_predecessor_release_id))
        or not isinstance(code_revision, str)
        or re.fullmatch(r"[0-9a-f]{7,64}", code_revision) is None
    ):
        raise MnnSuccessorError("MNN_SUCCESSOR_INPUT_INVALID")
    import canonical_release_store as release_store
    from agents.abbott_page_classifier.candidate_release import (
        _hash_rows,
        _read_non_content_bundle,
    )

    connection = cursor = None
    stage = "connect"
    try:
        # Validation persists immutable control evidence.  Do not widen the
        # materializer role: the dedicated release operator owns this write.
        connection = (connection_factory or get_release_operator_db_connection)()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        stage = "candidate"
        cursor.execute(
            """
            SELECT candidate.release_status, candidate.rollback_from_release_id,
                   candidate.baseline_validation_run_id, candidate.source_snapshot_ids,
                   candidate.code_revision
            FROM portal_data_releases AS candidate
            WHERE candidate.dataset_key = %s AND candidate.id = %s
            FOR UPDATE
            """,
            (DATASET_KEY, candidate_release_id),
        )
        candidate = cursor.fetchone()
        if (
            not isinstance(candidate, Mapping)
            or candidate.get("release_status") != "staging"
            or int(candidate.get("rollback_from_release_id") or 0) != expected_predecessor_release_id
            or candidate.get("code_revision") != code_revision
            or int(candidate.get("baseline_validation_run_id") or 0) <= 0
        ):
            raise MnnSuccessorError("CANDIDATE_NOT_MUTABLE")
        cursor.execute(
            """
            SELECT canonical_release_id
            FROM portal_active_data_releases
            WHERE dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        active = cursor.fetchone()
        if not isinstance(active, Mapping) or int(active.get("canonical_release_id") or 0) != expected_predecessor_release_id:
            raise MnnSuccessorError("ACTIVE_PREDECESSOR_MISMATCH")
        stage = "control_pack"
        cursor.execute(
            """
            SELECT manifest_json FROM portal_dataset_snapshots
            WHERE id = %s AND dataset_key = %s
              AND source_kind = 'abbott_canonical_control_pack'
            """,
            (candidate["baseline_validation_run_id"], DATASET_KEY),
        )
        baseline = _json_mapping(
            (cursor.fetchone() or {}).get("manifest_json"), code="CONTROL_PACK_INVALID"
        )
        bundle = baseline.get("mnn_successor_bundle")
        controls = baseline.get("control_values")
        if (
            not isinstance(bundle, Mapping)
            or not isinstance(controls, Mapping)
            or set(controls) != set(MNN_CONTROL_NAMES)
            or int(bundle.get("predecessor_release_id") or 0) != expected_predecessor_release_id
        ):
            raise MnnSuccessorError("CONTROL_PACK_INVALID")
        stage = "historical_batch"
        cursor.execute(
            """
            SELECT id, batch_status, candidate_release_id, accepted_decision_hash, accepted_at
            FROM portal_content_approval_batches
            WHERE id = %s AND dataset_key = %s
            """,
            (int(bundle.get("historical_batch_id") or 0), DATASET_KEY),
        )
        accepted_hash = assert_historical_batch_evidence(
            cursor.fetchone(),
            predecessor_release_id=expected_predecessor_release_id,
            historical_batch_id=int(bundle.get("historical_batch_id") or 0),
        )
        if accepted_hash != bundle.get("historical_accepted_decision_hash"):
            raise MnnSuccessorError("HISTORICAL_BATCH_INVALID")
        stage = "snapshots"
        candidate_source_ids = _positive_ids(
            candidate.get("source_snapshot_ids"), code="SOURCE_SNAPSHOT_INVALID"
        )
        if candidate_source_ids != list(bundle.get("candidate_source_snapshot_ids") or []):
            raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
        placeholders = ", ".join(["%s"] * len(candidate_source_ids))
        cursor.execute(
            f"""
            SELECT id, source_kind, content_sha256, content_bytes, parser_version,
                   import_status, imported_row_count, rejected_row_count,
                   manifest_json, source_row_count
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id IN ({placeholders})
            ORDER BY id
            """,
            (DATASET_KEY, *candidate_source_ids),
        )
        snapshot_rows = tuple(cursor.fetchall())
        if len(snapshot_rows) != len(candidate_source_ids):
            raise MnnSuccessorError("SOURCE_SNAPSHOT_INVALID")
        cursor.execute(
            """
            SELECT source_snapshot_id, source_kind, code_revision, import_status,
                   imported_row_count, rejected_row_count
            FROM portal_release_source_imports
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id
            """,
            (candidate_release_id,),
        )
        import_rows = tuple(cursor.fetchall())
        release_stub = {
            "source_snapshot_ids": _canonical_json(candidate_source_ids),
            "code_revision": code_revision,
        }
        release_store._validate_imported_sources(
            release=release_stub,
            baseline_manifest=dict(baseline),
            snapshot_rows=list(snapshot_rows),
            execution_rows=list(import_rows),
        )
        stage = "metadata"
        catalog_snapshot_id = int(bundle.get("catalog_snapshot_id") or 0)
        catalog_count, catalog_hash = _read_catalog_hash(cursor, candidate_release_id, catalog_snapshot_id)
        lookup_count, lookup_hash = _read_lookup_hash(cursor, candidate_release_id, catalog_snapshot_id)
        candidate_non_content = _read_non_content_bundle(cursor, candidate_release_id)
        if (
            catalog_count != int(bundle.get("catalog_count") or 0)
            or catalog_hash != bundle.get("catalog_hash")
            or lookup_count != int(bundle.get("lookup_count") or 0)
            or lookup_hash != bundle.get("lookup_hash")
            or candidate_non_content != bundle.get("non_content")
        ):
            raise MnnSuccessorError("CANDIDATE_PARITY_INVALID")
        stage = "mnn"
        cursor.execute(
            """
            SELECT mapping.content_entity_id, mapping.mnn_source_snapshot_id,
                   mapping.source_claim_id, mapping.mnn_key, mapping.mnn_label,
                   claim.source_snapshot_id AS claim_snapshot_id,
                   claim.resolved_content_entity_id AS claim_entity_id,
                   claim.resolution_status
            FROM portal_content_catalog_mnn AS mapping
            INNER JOIN portal_content_mnn_source_claims AS claim
              ON claim.id = mapping.source_claim_id
            WHERE mapping.canonical_release_id = %s
            ORDER BY mapping.content_entity_id, mapping.mnn_key, mapping.source_claim_id
            """,
            (candidate_release_id,),
        )
        mnn_db_rows = tuple(cursor.fetchall())
        mnn_rows = tuple(
            (
                int(row.get("content_entity_id") or 0),
                int(row.get("mnn_source_snapshot_id") or 0),
                int(row.get("source_claim_id") or 0),
                str(row.get("mnn_key") or ""),
                str(row.get("mnn_label") or ""),
            )
            for row in mnn_db_rows
        )
        if (
            len(mnn_rows) != int(bundle.get("mnn_count") or 0)
            or _hash_rows(mnn_rows) != bundle.get("mnn_hash")
            or any(
                row[1] != int(bundle.get("mnn_snapshot_id") or 0)
                or int(db.get("claim_snapshot_id") or 0) != row[1]
                or int(db.get("claim_entity_id") or 0) != row[0]
                or db.get("resolution_status") != "mapped"
                for row, db in zip(mnn_rows, mnn_db_rows)
            )
        ):
            raise MnnSuccessorError("MNN_MAPPING_INVALID")
        stage = "coverage"
        date_from, date_to, coverage_counts = _coverage_date_bounds(cursor, candidate_release_id)
        validation_run_id = str(uuid.uuid4())
        numeric_controls = {
            "mnn.catalog_copy_rows": catalog_count,
            "mnn.lookup_copy_rows": lookup_count,
            "mnn.mapping_count": len(mnn_rows),
            "mnn.non_content_parity": 1,
            **{f"coverage.{scope}.reconciled_days": count for scope, count in coverage_counts.items()},
        }
        for name in sorted(numeric_controls):
            value = numeric_controls[name]
            expected = int(controls[name]) if name in controls else value
            if name in controls and expected != value:
                raise MnnSuccessorError("CONTROL_PACK_INVALID")
            cursor.execute(
                """
                INSERT INTO portal_migration_validation_runs (
                  canonical_release_id, baseline_snapshot_id, candidate_snapshot_id,
                  candidate_run_id, validation_run_id, validation_run_completed_at,
                  code_revision, control_name, expected_value, actual_value,
                  absolute_delta, relative_delta, threshold_value, result_status,
                  diagnostic_json, reviewed_by, accepted_at
                ) VALUES (%s, %s, NULL, NULL, %s, NOW(6), %s, %s, %s, %s,
                          0, 0, 0, 'pass', NULL, CURRENT_USER(), NOW(6))
                """,
                (
                    candidate_release_id,
                    int(candidate["baseline_validation_run_id"]),
                    validation_run_id,
                    code_revision,
                    name,
                    expected,
                    value,
                ),
            )
            if int(cursor.rowcount) != 1:
                raise MnnSuccessorError("VALIDATION_EVIDENCE_INSERT_FAILED")
        stage = "evidence_commit"
        connection.commit()
    except MnnSuccessorError:
        if connection is not None:
            connection.rollback()
        raise
    except Exception as error:
        if connection is not None:
            connection.rollback()
        code = safe_failure_code(error, fallback="")
        if not code:
            detail = re.sub(r"[^A-Z0-9]", "_", type(error).__name__.upper()).strip("_")
            code = f"MNN_SUCCESSOR_VALIDATION_{stage.upper()}_{detail}"
        raise MnnSuccessorError(code[:64]) from None
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()
    try:
        release_store.validate_release(
            candidate_release_id,
            date_from=date_from,
            date_to=date_to,
            expected_code_revision=code_revision,
        )
    except release_store.ReleaseStoreError as exc:
        raise MnnSuccessorError("MNN_SUCCESSOR_VALIDATION_FAILED") from exc


def _load_receipt(path: Path) -> Mapping[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise MnnSuccessorError("BACKUP_RECEIPT_INVALID") from None
    if not isinstance(value, Mapping):
        raise MnnSuccessorError("BACKUP_RECEIPT_INVALID")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Materialize an Abbott MNN-only successor")
    parser.add_argument("command", choices=("materialize", "validate"))
    parser.add_argument("--expected-predecessor", type=int, required=True)
    parser.add_argument("--historical-batch", type=int)
    parser.add_argument("--mnn-snapshot", type=int)
    parser.add_argument("--candidate-release", type=int)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--backup-receipt", type=Path)
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parser().parse_args(argv)
    if not args.execute:
        print(json.dumps({"status": "dry_run"}, sort_keys=True))
        return 0
    try:
        if args.command == "materialize":
            if not args.backup_receipt or not args.historical_batch or not args.mnn_snapshot:
                raise MnnSuccessorError("MNN_SUCCESSOR_INPUT_INVALID")
            receipt = materialize_mnn_successor(
                args.expected_predecessor,
                args.historical_batch,
                args.mnn_snapshot,
                args.code_revision,
                backup_receipt=_load_receipt(args.backup_receipt),
            )
            print(json.dumps({
                "status": receipt.status,
                "candidate_release_id": receipt.candidate_release_id,
                "predecessor_release_id": receipt.predecessor_release_id,
                "historical_batch_id": receipt.historical_batch_id,
                "mnn_snapshot_id": receipt.mnn_snapshot_id,
            }, sort_keys=True))
        else:
            if not args.candidate_release:
                raise MnnSuccessorError("MNN_SUCCESSOR_INPUT_INVALID")
            validate_mnn_successor(
                args.candidate_release,
                args.expected_predecessor,
                args.code_revision,
            )
            print(json.dumps({
                "status": "validated",
                "candidate_release_id": args.candidate_release,
                "predecessor_release_id": args.expected_predecessor,
            }, sort_keys=True))
    except MnnSuccessorError as exc:
        print(json.dumps({"status": str(exc)}, sort_keys=True))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
