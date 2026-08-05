"""Canonical MySQL repository for the Abbott content-registry workflow."""

from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass, replace
from hashlib import sha256
import json
from enum import Enum
from typing import Any, Callable, Mapping, Protocol, Sequence

from .domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
    CanonicalClassification,
    ClassificationEvent,
    IngestResult,
    TaxonomyVersion,
)
from .batch_service import (
    ApprovalBatchItem,
    BuiltApprovalBatch,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_item_hash,
    compute_taxonomy_digest,
)


DATASET_KEY = "abbott"


class Cursor(Protocol):
    lastrowid: int
    rowcount: int

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None: ...

    def fetchone(self) -> Any: ...

    def fetchall(self) -> Sequence[Any]: ...

    def close(self) -> None: ...


class Connection(Protocol):
    def cursor(self) -> Cursor: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...

    def close(self) -> None: ...


class RepositoryError(RuntimeError):
    """Sanitized repository failure with a stable machine-readable code."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class BatchHistoryRecord:
    batch_key: str
    published_input_hash: str
    accepted_decision_hash: str | None
    approver: str | None
    accepted_at: object | None
    ready_count: int
    conflict_count: int
    unresolved_count: int
    rejected_count: int
    no_change_count: int
    accepted_count: int
    skipped_count: int
    batch_status: str
    spreadsheet_file_id: str | None
    spreadsheet_projection_hash: str | None
    candidate_release_id: int | None
    activation_status: str


class ContentRegistryRepository:
    def __init__(self, connection_factory: Callable[[], Connection]):
        self._connection_factory = connection_factory

    def load_active_catalog(self) -> tuple[CanonicalClassification, ...]:
        sql = """
            WITH latest_events AS (
              SELECT
                event.*,
                ROW_NUMBER() OVER (
                  PARTITION BY event.content_entity_id
                  ORDER BY event.effective_at DESC, event.id DESC
                ) AS row_rank
              FROM portal_content_classification_events AS event
              WHERE event.effective_at <= CURRENT_TIMESTAMP(6)
            )
            SELECT
              entity.id,
              entity.title,
              entity.canonical_url,
              event.direction_code,
              event.material_type_code,
              event.access_code,
              event.lifecycle_code,
              event.id
            FROM portal_content_registry_entities AS entity
            JOIN latest_events AS event
              ON event.content_entity_id = entity.id
             AND event.row_rank = 1
            WHERE entity.dataset_key = %s
              AND entity.registry_status = 'active'
            ORDER BY entity.id
        """
        rows = self._fetchall(sql, (DATASET_KEY,))
        return tuple(
            CanonicalClassification(
                content_entity_id=int(row[0]),
                title=str(row[1]),
                url=str(row[2]),
                direction_code=row[3],
                material_type_code=row[4],
                access_code=row[5],
                lifecycle_code=str(row[6]),
                event_id=int(row[7]),
            )
            for row in rows
        )

    def load_active_taxonomy(self, version: str) -> TaxonomyVersion:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            _taxonomy_id, taxonomy = self._load_taxonomy(cursor, version)
            return taxonomy
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            self._close(cursor, connection)

    def persist_draft_batch(self, batch: ApprovalBatch) -> int:
        """Atomically persist or attest a retryable draft and all of its items."""

        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            audited = self._require_audited_batch(batch)
            connection = self._connection_factory()
            cursor = connection.cursor()
            taxonomy_id, taxonomy = self._load_taxonomy(cursor, batch.taxonomy_version)
            self._attest_taxonomy(audited, taxonomy)
            counts = self._batch_counts(batch.items)
            cursor.execute(
                """
                SELECT
                  id,
                  taxonomy_version_id,
                  batch_key,
                  taxonomy_digest,
                  source_snapshot_ids,
                  source_snapshot_digests,
                  published_input_hash,
                  batch_status,
                  prompt_version,
                  model_routing_version,
                  ready_count,
                  conflict_count,
                  unresolved_count,
                  rejected_count,
                  no_change_count
                FROM portal_content_approval_batches
                WHERE dataset_key = %s
                  AND batch_key = %s
                FOR UPDATE
                """,
                (DATASET_KEY, batch.batch_key),
            )
            existing = cursor.fetchone()
            if existing is not None:
                batch_id = self._attest_batch_row(
                    existing,
                    audited,
                    taxonomy_id,
                    counts,
                    allowed_statuses=("draft", "failed", "published"),
                )
                self._attest_item_rows(cursor, batch_id, audited)
                connection.commit()
                return batch_id

            cursor.execute(
                """
                INSERT INTO portal_content_approval_batches (
                  dataset_key,
                  batch_key,
                  taxonomy_version_id,
                  taxonomy_digest,
                  source_snapshot_ids,
                  source_snapshot_digests,
                  published_input_hash,
                  batch_status,
                  prompt_version,
                  model_routing_version,
                  ready_count,
                  conflict_count,
                  unresolved_count,
                  rejected_count,
                  no_change_count
                ) VALUES (
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s
                )
                """,
                (
                    DATASET_KEY,
                    batch.batch_key,
                    taxonomy_id,
                    audited.taxonomy_digest,
                    self._json(audited.source_snapshot_ids),
                    self._json(audited.source_snapshot_digests),
                    batch.published_input_hash,
                    "draft",
                    batch.prompt_version,
                    audited.model_routing_version,
                    counts["ready"],
                    counts["conflict"],
                    counts["unresolved"],
                    counts["rejected"],
                    counts["no_change"],
                ),
            )
            batch_id = int(cursor.lastrowid)
            for item in batch.items:
                self._ensure_item(cursor, batch_id, item)
            connection.commit()
            return batch_id
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def attest_batch_for_publication(
        self,
        batch_id: int,
        batch: ApprovalBatch,
        *,
        _allowed_statuses: Sequence[str] = ("draft", "failed", "published"),
    ) -> None:
        """Re-read and attest the exact retryable canonical draft."""

        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            audited = self._require_audited_batch(batch)
            connection = self._connection_factory()
            cursor = connection.cursor()
            taxonomy_id, taxonomy = self._load_taxonomy(cursor, batch.taxonomy_version)
            self._attest_taxonomy(audited, taxonomy)
            cursor.execute(
                """
                SELECT
                  id,
                  taxonomy_version_id,
                  batch_key,
                  taxonomy_digest,
                  source_snapshot_ids,
                  source_snapshot_digests,
                  published_input_hash,
                  batch_status,
                  prompt_version,
                  model_routing_version,
                  ready_count,
                  conflict_count,
                  unresolved_count,
                  rejected_count,
                  no_change_count
                FROM portal_content_approval_batches
                WHERE id = %s
                  AND dataset_key = %s
                FOR UPDATE
                """,
                (int(batch_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None:
                raise RepositoryError("BATCH_NOT_PERSISTED")
            stored_id = self._attest_batch_row(
                row,
                audited,
                taxonomy_id,
                self._batch_counts(batch.items),
                allowed_statuses=_allowed_statuses,
            )
            if stored_id != int(batch_id):
                raise RepositoryError("BATCH_NOT_PERSISTED")
            self._attest_item_rows(cursor, stored_id, audited)
            connection.commit()
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def attest_batch_for_acceptance(
        self, batch_id: int, batch: ApprovalBatch
    ) -> None:
        self.attest_batch_for_publication(
            batch_id,
            batch,
            _allowed_statuses=("published", "accepted"),
        )

    def mark_batch_published(
        self,
        batch_id: int,
        spreadsheet_id: str,
        projection_hash: str,
    ) -> None:
        self._update_projection_status(
            """
            UPDATE portal_content_approval_batches
            SET batch_status = %s,
                spreadsheet_file_id = %s,
                spreadsheet_projection_hash = %s,
                published_at = CURRENT_TIMESTAMP(6),
                failed_at = NULL,
                failure_code = NULL
            WHERE id = %s
              AND dataset_key = %s
              AND batch_status IN ('draft', 'failed', 'published')
            """,
            ("published", spreadsheet_id, projection_hash, int(batch_id), DATASET_KEY),
        )

    def mark_batch_projection_failed(self, batch_id: int, failure_code: str) -> None:
        self._update_projection_status(
            """
            UPDATE portal_content_approval_batches
            SET batch_status = %s,
                failed_at = CURRENT_TIMESTAMP(6),
                failure_code = %s
            WHERE id = %s
              AND dataset_key = %s
              AND batch_status IN ('draft', 'failed', 'published')
            """,
            ("failed", failure_code[:64], int(batch_id), DATASET_KEY),
        )

    def record_batch_acceptance(
        self,
        batch_id: int,
        snapshot: AcceptedBatchSnapshot,
        spreadsheet_id: str,
    ) -> None:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT
                  batch.batch_key,
                  batch.taxonomy_version_id,
                  batch.taxonomy_digest,
                  taxonomy.version,
                  taxonomy.taxonomy_digest,
                  batch.published_input_hash,
                  batch.batch_status,
                  batch.spreadsheet_file_id,
                  batch.accepted_decision_hash,
                  batch.accepted_by,
                  batch.accepted_at,
                  batch.ready_count,
                  batch.conflict_count,
                  batch.unresolved_count,
                  batch.rejected_count,
                  batch.no_change_count,
                  batch.accepted_count,
                  batch.skipped_count
                FROM portal_content_approval_batches AS batch
                INNER JOIN portal_content_taxonomy_versions AS taxonomy
                  ON taxonomy.id = batch.taxonomy_version_id
                 AND taxonomy.dataset_key = batch.dataset_key
                 AND taxonomy.taxonomy_status = %s
                WHERE batch.id = %s
                  AND batch.dataset_key = %s
                FOR UPDATE
                """,
                ("active", int(batch_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None or str(row[0]) != snapshot.batch_key:
                raise RepositoryError("BATCH_NOT_PERSISTED")
            taxonomy_id = int(row[1])
            batch_taxonomy_digest = str(row[2])
            taxonomy_version = str(row[3])
            stored_taxonomy_digest = str(row[4])
            if batch_taxonomy_digest != stored_taxonomy_digest:
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            taxonomy = self._load_taxonomy_terms(
                cursor,
                taxonomy_id,
                taxonomy_version,
                stored_taxonomy_digest,
                lock=True,
            )
            if str(row[5]) != snapshot.published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            status = str(row[6])
            if str(row[7]) != spreadsheet_id or status not in ("published", "accepted"):
                raise RepositoryError("BATCH_NOT_PUBLISHED")

            cursor.execute(
                """
                SELECT
                  id,
                  content_entity_id,
                  input_hash,
                  title,
                  url,
                  final_direction_code,
                  final_material_type_code,
                  final_access_code,
                  final_lifecycle_code,
                  readiness_state,
                  row_hash,
                  decision_reason
                FROM portal_content_approval_items
                WHERE approval_batch_id = %s
                ORDER BY content_entity_id, input_hash
                FOR UPDATE
                """,
                (int(batch_id),),
            )
            stored_rows = tuple(cursor.fetchall())
            accepted_items, counts = self._validate_acceptance_snapshot(
                snapshot,
                stored_rows,
                taxonomy,
            )
            expected_input_counts = tuple(
                counts[state]
                for state in ("ready", "conflict", "unresolved", "rejected", "no_change")
            )
            if tuple(int(value) for value in row[11:16]) != expected_input_counts:
                raise RepositoryError("BATCH_ITEMS_MISMATCH")
            accepted_hash = compute_accepted_decision_hash(
                item for _approval_item_id, item in accepted_items
            )
            if snapshot.accepted_decision_hash != accepted_hash:
                raise RepositoryError("ACCEPTED_HASH_MISMATCH")
            accepted_count = counts["ready"]
            skipped_count = len(accepted_items) - accepted_count
            for name, expected in (
                ("accepted_count", accepted_count),
                ("skipped_count", skipped_count),
            ):
                supplied = getattr(snapshot, name, None)
                if supplied is not None and int(supplied) != expected:
                    raise RepositoryError("BATCH_COUNT_MISMATCH")
            accepted_at = self._canonical_acceptance_timestamp(snapshot.accepted_at)
            if not snapshot.accepted_by.strip():
                raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")
            if status == "accepted":
                if (
                    str(row[8]) != accepted_hash
                    or str(row[9]) != snapshot.accepted_by
                    or self._canonical_acceptance_timestamp(row[10])
                    != accepted_at
                    or int(row[16]) != accepted_count
                    or int(row[17]) != skipped_count
                ):
                    raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")
                connection.commit()
                return
            for approval_item_id, item in accepted_items:
                cursor.execute(
                    """
                    UPDATE portal_content_approval_items
                    SET final_direction_code = %s,
                        final_material_type_code = %s,
                        final_access_code = %s,
                        final_lifecycle_code = %s,
                        decision_reason = %s
                    WHERE id = %s
                      AND approval_batch_id = %s
                      AND row_hash = %s
                    """,
                    (
                        item.final_direction_code,
                        item.final_material_type_code,
                        item.final_access_code,
                        item.final_lifecycle_code,
                        item.decision_reason,
                        approval_item_id,
                        int(batch_id),
                        item.row_hash,
                    ),
                )
                if getattr(cursor, "rowcount", 1) != 1:
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
            cursor.execute(
                """
                UPDATE portal_content_approval_batches
                SET batch_status = %s,
                    accepted_decision_hash = %s,
                    accepted_by = %s,
                    accepted_at = %s,
                    accepted_count = %s,
                    skipped_count = %s
                WHERE id = %s
                  AND batch_status = %s
                """,
                (
                    "accepted",
                    accepted_hash,
                    snapshot.accepted_by,
                    snapshot.accepted_at,
                    accepted_count,
                    skipped_count,
                    int(batch_id),
                    "published",
                ),
            )
            if getattr(cursor, "rowcount", 1) != 1:
                raise RepositoryError("BATCH_STATUS_TRANSITION_INVALID")
            connection.commit()
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def load_batch_history(self, batch_id: int) -> BatchHistoryRecord:
        sql = """
            SELECT
              batch_key,
              published_input_hash,
              accepted_decision_hash,
              accepted_by,
              accepted_at,
              ready_count,
              conflict_count,
              unresolved_count,
              rejected_count,
              no_change_count,
              accepted_count,
              skipped_count,
              batch_status,
              spreadsheet_file_id,
              spreadsheet_projection_hash,
              candidate_release_id,
              activation_status
            FROM portal_content_approval_batches
            WHERE id = %s
              AND dataset_key = %s
        """
        rows = self._fetchall(sql, (int(batch_id), DATASET_KEY))
        if len(rows) != 1:
            raise RepositoryError("BATCH_NOT_PERSISTED")
        row = rows[0]
        return BatchHistoryRecord(
            batch_key=str(row[0]),
            published_input_hash=str(row[1]),
            accepted_decision_hash=(str(row[2]) if row[2] is not None else None),
            approver=(str(row[3]) if row[3] is not None else None),
            accepted_at=row[4],
            ready_count=int(row[5]),
            conflict_count=int(row[6]),
            unresolved_count=int(row[7]),
            rejected_count=int(row[8]),
            no_change_count=int(row[9]),
            accepted_count=int(row[10]),
            skipped_count=int(row[11]),
            batch_status=str(row[12]),
            spreadsheet_file_id=(str(row[13]) if row[13] is not None else None),
            spreadsheet_projection_hash=(str(row[14]) if row[14] is not None else None),
            candidate_release_id=(int(row[15]) if row[15] is not None else None),
            activation_status=str(row[16]),
        )

    def _update_projection_status(self, sql: str, params: tuple[object, ...]) -> None:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(sql, params)
            rowcount = getattr(cursor, "rowcount", 1)
            if rowcount != 1:
                raise RepositoryError("BATCH_STATUS_TRANSITION_INVALID")
            connection.commit()
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def create_batch(self, batch: ApprovalBatch) -> int:
        """Compatibility alias for the atomic draft persistence boundary."""

        return self.persist_draft_batch(batch)

    def insert_items(
        self,
        batch_id: int,
        items: Sequence[ApprovalItem],
    ) -> None:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            for item in items:
                self._ensure_item(cursor, batch_id, item)
            connection.commit()
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def ingest_accepted_snapshot(
        self,
        snapshot: AcceptedBatchSnapshot,
    ) -> IngestResult:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT
                  id,
                  taxonomy_version_id,
                  published_input_hash,
                  accepted_decision_hash,
                  batch_status,
                  accepted_by,
                  accepted_at
                FROM portal_content_approval_batches
                WHERE dataset_key = %s
                  AND batch_key = %s
                FOR UPDATE
                """,
                (DATASET_KEY, snapshot.batch_key),
            )
            batch_row = cursor.fetchone()
            if batch_row is None:
                raise RepositoryError("BATCH_NOT_ACCEPTED")

            batch_id = int(batch_row[0])
            taxonomy_version_id = int(batch_row[1])
            published_input_hash = batch_row[2]
            stored_accepted_hash = batch_row[3]
            batch_status = str(batch_row[4])
            stored_accepted_by = batch_row[5]
            stored_accepted_at = batch_row[6]

            if (
                not snapshot.accepted_decision_hash
                or not snapshot.accepted_by
                or not snapshot.accepted_at
            ):
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if published_input_hash != snapshot.published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if batch_status not in ("accepted", "ingested"):
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if stored_accepted_hash != snapshot.accepted_decision_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if stored_accepted_by != snapshot.accepted_by:
                raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")
            if self._canonical_acceptance_timestamp(
                stored_accepted_at
            ) != self._canonical_acceptance_timestamp(snapshot.accepted_at):
                raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")
            if batch_status == "ingested":
                connection.commit()
                return IngestResult(status="noop")

            counts = {
                "ready": 0,
                "conflict": 0,
                "unresolved": 0,
                "rejected": 0,
            }
            for item in snapshot.items:
                approval_item_id = self._ensure_item(cursor, batch_id, item)
                if item.readiness_state in counts:
                    counts[item.readiness_state] += 1
                if item.readiness_state != "ready":
                    continue
                if (
                    item.content_entity_id is None
                    or item.final_lifecycle_code is None
                ):
                    raise RepositoryError("BATCH_NOT_ACCEPTED")

                cursor.execute(
                    """
                    SELECT id
                    FROM portal_content_classification_events
                    WHERE content_entity_id = %s
                      AND effective_at <= %s
                    ORDER BY effective_at DESC, id DESC
                    LIMIT 1
                    """,
                    (item.content_entity_id, snapshot.accepted_at),
                )
                predecessor_row = cursor.fetchone()
                predecessor_event_id = (
                    int(predecessor_row[0]) if predecessor_row is not None else None
                )
                event_fingerprint = self._event_fingerprint(
                    snapshot,
                    item,
                    batch_id,
                )
                cursor.execute(
                    """
                    INSERT INTO portal_content_classification_events (
                      content_entity_id,
                      taxonomy_version_id,
                      approval_batch_id,
                      approval_item_id,
                      predecessor_event_id,
                      direction_code,
                      material_type_code,
                      access_code,
                      lifecycle_code,
                      event_kind,
                      event_fingerprint,
                      proposal_evidence,
                      actor,
                      reason,
                      effective_at
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        item.content_entity_id,
                        taxonomy_version_id,
                        batch_id,
                        approval_item_id,
                        predecessor_event_id,
                        item.final_direction_code,
                        item.final_material_type_code,
                        item.final_access_code,
                        item.final_lifecycle_code,
                        "approve",
                        event_fingerprint,
                        self._json(
                            {
                                "accepted_decision_hash": snapshot.accepted_decision_hash,
                                "row_hash": item.row_hash,
                            }
                        ),
                        snapshot.accepted_by,
                        item.decision_reason,
                        snapshot.accepted_at,
                    ),
                )

            cursor.execute(
                """
                UPDATE portal_content_approval_batches
                SET batch_status = %s,
                    ingested_at = CURRENT_TIMESTAMP(6)
                WHERE id = %s
                """,
                (
                    "ingested",
                    batch_id,
                ),
            )
            connection.commit()
            return IngestResult(
                status="ingested",
                accepted_count=counts["ready"],
                conflict_count=counts["conflict"],
                unresolved_count=counts["unresolved"],
                rejected_count=counts["rejected"],
            )
        except RepositoryError:
            self._rollback(connection)
            raise
        except Exception:
            self._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            self._close(cursor, connection)

    def load_effective_classifications(self) -> dict[int, ClassificationEvent]:
        sql = """
            WITH latest_events AS (
              SELECT
                event.*,
                ROW_NUMBER() OVER (
                  PARTITION BY event.content_entity_id
                  ORDER BY event.effective_at DESC, event.id DESC
                ) AS row_rank
              FROM portal_content_classification_events AS event
              WHERE event.effective_at <= CURRENT_TIMESTAMP(6)
            )
            SELECT
              content_entity_id,
              direction_code,
              material_type_code,
              access_code,
              lifecycle_code,
              event_kind,
              event_fingerprint,
              predecessor_event_id,
              approval_batch_id,
              approval_item_id,
              actor,
              reason,
              effective_at
            FROM latest_events
            WHERE row_rank = 1
            ORDER BY content_entity_id
        """
        rows = self._fetchall(sql, ())
        events = (
            ClassificationEvent(
                content_entity_id=int(row[0]),
                direction_code=row[1],
                material_type_code=row[2],
                access_code=row[3],
                lifecycle_code=str(row[4]),
                event_kind=row[5],
                event_fingerprint=str(row[6]),
                predecessor_event_id=(int(row[7]) if row[7] is not None else None),
                approval_batch_id=(int(row[8]) if row[8] is not None else None),
                approval_item_id=(int(row[9]) if row[9] is not None else None),
                actor=row[10],
                reason=row[11],
                effective_at=(str(row[12]) if row[12] is not None else None),
            )
            for row in rows
        )
        return {event.content_entity_id: event for event in events}

    @staticmethod
    def _require_audited_batch(batch: ApprovalBatch) -> BuiltApprovalBatch:
        if not isinstance(batch, BuiltApprovalBatch):
            raise RepositoryError("BATCH_AUDIT_INCOMPLETE")
        if compute_batch_hash(batch.items) != batch.published_input_hash:
            raise RepositoryError("BATCH_HASH_MISMATCH")
        if (
            compute_taxonomy_digest(batch.taxonomy_version, batch.taxonomy_terms)
            != batch.taxonomy_digest
        ):
            raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
        taxonomy_fields = {
            "direction": "final_direction_code",
            "material_type": "final_material_type_code",
            "access": "final_access_code",
            "lifecycle": "final_lifecycle_code",
        }
        for item in batch.items:
            if not isinstance(item, ApprovalBatchItem):
                raise RepositoryError("BATCH_AUDIT_INCOMPLETE")
            if item.row_hash != compute_item_hash(item):
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if (
                item.taxonomy_digest != batch.taxonomy_digest
                or dict(item.taxonomy_terms) != dict(batch.taxonomy_terms)
                or item.source_snapshot_ids != batch.source_snapshot_ids
                or item.source_snapshot_digests != batch.source_snapshot_digests
                or item.model_routing_version != batch.model_routing_version
                or item.prompt_version != batch.prompt_version
            ):
                raise RepositoryError("BATCH_AUDIT_INCOMPLETE")
            for kind, field_name in taxonomy_fields.items():
                value = getattr(item, field_name)
                if value is not None and value not in batch.taxonomy_terms[kind]:
                    raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
        return batch

    @staticmethod
    def _batch_counts(items: Sequence[ApprovalItem]) -> dict[str, int]:
        counts = {
            "ready": 0,
            "conflict": 0,
            "unresolved": 0,
            "rejected": 0,
            "no_change": 0,
        }
        for item in items:
            if item.readiness_state not in counts:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if item.readiness_state == "ready" and (
                item.content_entity_id is None
                or not item.final_direction_code
                or not item.final_material_type_code
                or not item.final_lifecycle_code
            ):
                raise RepositoryError("BATCH_ITEM_INCOMPLETE")
            if len(item.input_hash) != 64 or len(item.row_hash) != 64:
                raise RepositoryError("BATCH_ITEM_INCOMPLETE")
            counts[item.readiness_state] += 1
        return counts

    @staticmethod
    def _load_taxonomy(cursor: Cursor, version: str) -> tuple[int, TaxonomyVersion]:
        cursor.execute(
            """
            SELECT id, taxonomy_digest
            FROM portal_content_taxonomy_versions
            WHERE dataset_key = %s
              AND version = %s
              AND taxonomy_status = %s
            """,
            (DATASET_KEY, version, "active"),
        )
        row = cursor.fetchone()
        if row is None:
            raise RepositoryError("TAXONOMY_VERSION_NOT_ACTIVE")
        taxonomy_id = int(row[0])
        stored_digest = str(row[1])
        return taxonomy_id, ContentRegistryRepository._load_taxonomy_terms(
            cursor,
            taxonomy_id,
            version,
            stored_digest,
        )

    @staticmethod
    def _load_taxonomy_terms(
        cursor: Cursor,
        taxonomy_id: int,
        version: str,
        stored_digest: str,
        *,
        lock: bool = False,
    ) -> TaxonomyVersion:
        cursor.execute(
            f"""
            SELECT taxonomy_kind, term_code
            FROM portal_content_taxonomy_terms
            WHERE taxonomy_version_id = %s
              AND term_status = %s
            ORDER BY taxonomy_kind, term_code
            {"FOR UPDATE" if lock else ""}
            """,
            (taxonomy_id, "active"),
        )
        terms: dict[str, list[str]] = {
            "direction": [],
            "material_type": [],
            "access": [],
            "lifecycle": [],
        }
        for kind, code in cursor.fetchall():
            if str(kind) not in terms:
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            terms[str(kind)].append(str(code))
        if any(not values for values in terms.values()):
            raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
        frozen_terms = {kind: tuple(values) for kind, values in terms.items()}
        computed_digest = compute_taxonomy_digest(version, frozen_terms)
        if stored_digest != computed_digest:
            raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
        return TaxonomyVersion(
            version=version,
            terms=frozen_terms,
            digest=computed_digest,
        )

    @staticmethod
    def _validate_acceptance_snapshot(
        snapshot: AcceptedBatchSnapshot,
        stored_rows: Sequence[Sequence[object]],
        taxonomy: TaxonomyVersion,
    ) -> tuple[tuple[tuple[int, ApprovalItem], ...], dict[str, int]]:
        stored_by_key: dict[tuple[int | None, str, str], tuple[int, ApprovalItem]] = {}
        stored_identities: set[tuple[int | None, str]] = set()
        stored_hashes: set[str] = set()
        try:
            for row in stored_rows:
                item = ApprovalItem(
                    content_entity_id=(int(row[1]) if row[1] is not None else None),
                    input_hash=str(row[2]),
                    title=str(row[3]),
                    url=str(row[4]),
                    final_direction_code=(str(row[5]) if row[5] is not None else None),
                    final_material_type_code=(str(row[6]) if row[6] is not None else None),
                    final_access_code=(str(row[7]) if row[7] is not None else None),
                    final_lifecycle_code=(str(row[8]) if row[8] is not None else None),
                    readiness_state=str(row[9]),
                    row_hash=str(row[10]),
                    decision_reason=(str(row[11]) if row[11] is not None else None),
                )
                identity = (item.content_entity_id, item.input_hash)
                key = (*identity, item.row_hash)
                if (
                    identity in stored_identities
                    or item.row_hash in stored_hashes
                    or key in stored_by_key
                ):
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                stored_identities.add(identity)
                stored_hashes.add(item.row_hash)
                stored_by_key[key] = (int(row[0]), item)
        except RepositoryError:
            raise
        except (IndexError, TypeError, ValueError):
            raise RepositoryError("BATCH_ITEMS_MISMATCH") from None

        supplied_by_key: dict[tuple[int | None, str, str], ApprovalItem] = {}
        supplied_identities: set[tuple[int | None, str]] = set()
        supplied_hashes: set[str] = set()
        for item in snapshot.items:
            identity = (item.content_entity_id, item.input_hash)
            key = (*identity, item.row_hash)
            if (
                identity in supplied_identities
                or item.row_hash in supplied_hashes
                or key in supplied_by_key
            ):
                raise RepositoryError("BATCH_ITEMS_MISMATCH")
            supplied_identities.add(identity)
            supplied_hashes.add(item.row_hash)
            supplied_by_key[key] = item
        if set(supplied_by_key) != set(stored_by_key):
            raise RepositoryError("BATCH_ITEMS_MISMATCH")

        taxonomy_fields = (
            ("direction", "final_direction_code"),
            ("material_type", "final_material_type_code"),
            ("access", "final_access_code"),
            ("lifecycle", "final_lifecycle_code"),
        )
        accepted: list[tuple[int, ApprovalItem]] = []
        for key, (approval_item_id, canonical) in stored_by_key.items():
            supplied = supplied_by_key[key]
            if (
                supplied.title != canonical.title
                or supplied.url != canonical.url
                or supplied.readiness_state != canonical.readiness_state
            ):
                raise RepositoryError("BATCH_ITEMS_MISMATCH")
            for kind, field_name in taxonomy_fields:
                value = getattr(supplied, field_name)
                if value is not None and value not in taxonomy.terms[kind]:
                    raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            editable = replace(
                canonical,
                final_direction_code=supplied.final_direction_code,
                final_material_type_code=supplied.final_material_type_code,
                final_access_code=supplied.final_access_code,
                final_lifecycle_code=supplied.final_lifecycle_code,
                decision_reason=supplied.decision_reason,
            )
            if editable.readiness_state == "conflict":
                old_values = (
                    canonical.final_direction_code,
                    canonical.final_material_type_code,
                    canonical.final_access_code,
                    canonical.final_lifecycle_code,
                )
                new_values = (
                    editable.final_direction_code,
                    editable.final_material_type_code,
                    editable.final_access_code,
                    editable.final_lifecycle_code,
                )
                if old_values != new_values and not editable.decision_reason:
                    raise RepositoryError("CONFLICT_REASON_REQUIRED")
            accepted.append((approval_item_id, editable))
        counts = ContentRegistryRepository._batch_counts(
            tuple(item for _approval_item_id, item in accepted)
        )
        return tuple(accepted), counts

    @staticmethod
    def _attest_taxonomy(
        batch: BuiltApprovalBatch, taxonomy: TaxonomyVersion
    ) -> None:
        if (
            batch.taxonomy_digest != taxonomy.digest
            or dict(batch.taxonomy_terms) != dict(taxonomy.terms)
        ):
            raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")

    @staticmethod
    def _decoded_json_tuple(value: object) -> tuple[object, ...]:
        decoded = json.loads(value) if isinstance(value, str) else value
        if not isinstance(decoded, (tuple, list)):
            raise RepositoryError("BATCH_HASH_MISMATCH")
        return tuple(decoded)

    @staticmethod
    def _attest_batch_row(
        row: Sequence[object],
        batch: BuiltApprovalBatch,
        taxonomy_id: int,
        counts: Mapping[str, int],
        *,
        allowed_statuses: Sequence[str],
    ) -> int:
        try:
            matches = (
                int(row[1]) == taxonomy_id
                and str(row[2]) == batch.batch_key
                and str(row[3]) == batch.taxonomy_digest
                and ContentRegistryRepository._decoded_json_tuple(row[4])
                == batch.source_snapshot_ids
                and ContentRegistryRepository._decoded_json_tuple(row[5])
                == batch.source_snapshot_digests
                and str(row[6]) == batch.published_input_hash
                and str(row[7]) in allowed_statuses
                and str(row[8]) == batch.prompt_version
                and str(row[9]) == batch.model_routing_version
                and tuple(int(value) for value in row[10:15])
                == tuple(counts[state] for state in ("ready", "conflict", "unresolved", "rejected", "no_change"))
            )
        except (IndexError, TypeError, ValueError):
            matches = False
        if not matches:
            raise RepositoryError("BATCH_HASH_MISMATCH")
        return int(row[0])

    @staticmethod
    def _attest_item_rows(
        cursor: Cursor, batch_id: int, batch: BuiltApprovalBatch
    ) -> None:
        cursor.execute(
            """
            SELECT
              content_entity_id,
              input_hash,
              row_hash,
              readiness_state
            FROM portal_content_approval_items
            WHERE approval_batch_id = %s
            ORDER BY content_entity_id, input_hash
            FOR UPDATE
            """,
            (batch_id,),
        )
        stored = tuple(
            (
                int(row[0]) if row[0] is not None else None,
                str(row[1]),
                str(row[2]),
                str(row[3]),
            )
            for row in cursor.fetchall()
        )
        expected = tuple(
            (
                item.content_entity_id,
                item.input_hash,
                item.row_hash,
                item.readiness_state,
            )
            for item in batch.items
        )
        if stored != expected:
            raise RepositoryError("BATCH_ITEMS_MISMATCH")

    @staticmethod
    def _ensure_item(
        cursor: Cursor,
        batch_id: int,
        item: ApprovalItem,
    ) -> int:
        cursor.execute(
            """
            SELECT id, title, url, row_hash
            FROM portal_content_approval_items
            WHERE approval_batch_id = %s
              AND content_entity_id <=> %s
              AND input_hash = %s
            FOR UPDATE
            """,
            (batch_id, item.content_entity_id, item.input_hash),
        )
        existing = cursor.fetchone()
        if existing is not None:
            immutable_values = (item.title, item.url, item.row_hash)
            if tuple(existing[1:4]) != immutable_values:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            return int(existing[0])

        conflict_codes = [
            code.value if hasattr(code, "value") else str(code)
            for code in item.conflict_codes
        ]
        cursor.execute(
            """
            INSERT INTO portal_content_approval_items (
              approval_batch_id,
              content_entity_id,
              input_hash,
              title,
              url,
              final_direction_code,
              final_material_type_code,
              final_access_code,
              final_lifecycle_code,
              readiness_state,
              conflict_code,
              conflict_codes,
              row_hash,
              decision_reason,
              proposal_evidence
            ) VALUES (
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s
            )
            """,
            (
                batch_id,
                item.content_entity_id,
                item.input_hash,
                item.title,
                item.url,
                item.final_direction_code,
                item.final_material_type_code,
                item.final_access_code,
                item.final_lifecycle_code,
                item.readiness_state,
                conflict_codes[0] if conflict_codes else None,
                ContentRegistryRepository._json(conflict_codes),
                item.row_hash,
                item.decision_reason,
                ContentRegistryRepository._json(
                    getattr(item, "proposal_evidence", ())
                ),
            ),
        )
        return int(cursor.lastrowid)

    @staticmethod
    def _event_fingerprint(
        snapshot: AcceptedBatchSnapshot,
        item: ApprovalItem,
        approval_batch_id: int,
    ) -> str:
        payload = {
            "accepted_decision_hash": snapshot.accepted_decision_hash,
            "access_code": item.final_access_code,
            "approval_batch_id": approval_batch_id,
            "content_entity_id": item.content_entity_id,
            "direction_code": item.final_direction_code,
            "event_kind": "approve",
            "input_hash": item.input_hash,
            "lifecycle_code": item.final_lifecycle_code,
            "material_type_code": item.final_material_type_code,
            "row_hash": item.row_hash,
        }
        return sha256(ContentRegistryRepository._json(payload).encode("utf-8")).hexdigest()

    @staticmethod
    def _canonical_acceptance_timestamp(value: object) -> datetime:
        try:
            if isinstance(value, datetime):
                parsed = value
            elif isinstance(value, str) and ":" in value:
                iso_value = f"{value[:-1]}+00:00" if value.endswith("Z") else value
                parsed = datetime.fromisoformat(iso_value)
            else:
                raise ValueError

            if parsed.tzinfo is None or parsed.utcoffset() is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                parsed = parsed.astimezone(timezone.utc)
            return parsed.replace(tzinfo=None)
        except (OverflowError, TypeError, ValueError):
            raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH") from None

    @staticmethod
    def _json(value: object) -> str:
        return json.dumps(
            ContentRegistryRepository._json_value(value),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    @staticmethod
    def _json_value(value: object) -> object:
        if isinstance(value, Enum):
            return value.value
        if isinstance(value, Mapping):
            return {
                str(key): ContentRegistryRepository._json_value(item)
                for key, item in value.items()
            }
        if isinstance(value, (tuple, list)):
            return [ContentRegistryRepository._json_value(item) for item in value]
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        raise TypeError("unsupported JSON value")

    def _fetchall(
        self,
        sql: str,
        params: tuple[object, ...],
    ) -> Sequence[Any]:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(sql, params)
            return tuple(cursor.fetchall())
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            self._close(cursor, connection)

    @staticmethod
    def _rollback(connection: Connection | None) -> None:
        if connection is None:
            return
        try:
            connection.rollback()
        except Exception:
            pass

    @staticmethod
    def _close(
        cursor: Cursor | None,
        connection: Connection | None,
    ) -> None:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
