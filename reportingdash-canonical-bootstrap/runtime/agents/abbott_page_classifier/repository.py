"""Canonical MySQL repository for the Abbott content-registry workflow."""

from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass, replace
import json
from enum import Enum
from typing import Any, Callable, Mapping, Protocol, Sequence

from .domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
    CanonicalClassification,
    ClassificationEvent,
    ConflictCode,
    IngestResult,
    TaxonomyVersion,
)
from .batch_service import (
    ApprovalBatchItem,
    BuiltApprovalBatch,
    PersistedApprovalBatch,
    compute_classification_event_fingerprint,
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

    def load_persisted_batch(self, batch_id: int) -> PersistedApprovalBatch:
        """Rehydrate one canonical batch and re-attest every immutable hash."""

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
                """,
                (int(batch_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None or int(row[0]) != int(batch_id):
                raise RepositoryError("BATCH_NOT_PERSISTED")
            taxonomy_id = int(row[1])
            cursor.execute(
                """
                SELECT version, taxonomy_digest
                FROM portal_content_taxonomy_versions
                WHERE id = %s
                  AND dataset_key = %s
                """,
                (taxonomy_id, DATASET_KEY),
            )
            taxonomy_row = cursor.fetchone()
            if taxonomy_row is None or str(taxonomy_row[1]) != str(row[3]):
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            taxonomy = self._load_taxonomy_terms(
                cursor,
                taxonomy_id,
                str(taxonomy_row[0]),
                str(taxonomy_row[1]),
                include_retired=True,
            )
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
                  decision_reason,
                  proposal_evidence,
                  conflict_codes,
                  conflict_code
                FROM portal_content_approval_items
                WHERE approval_batch_id = %s
                ORDER BY content_entity_id, input_hash
                """,
                (int(batch_id),),
            )
            stored_rows = tuple(cursor.fetchall())
            _evidence, items = self._attest_published_items(
                stored_rows,
                taxonomy=taxonomy,
                taxonomy_digest=str(row[3]),
                source_snapshot_ids=self._decoded_json_tuple(row[4]),
                source_snapshot_digests=self._decoded_json_tuple(row[5]),
                prompt_version=str(row[8]),
                model_routing_version=str(row[9]),
            )
            batch = BuiltApprovalBatch(
                batch_key=str(row[2]),
                taxonomy_version=taxonomy.version,
                published_input_hash=str(row[6]),
                items=items,
                prompt_version=str(row[8]),
                taxonomy_terms=taxonomy.terms,
                taxonomy_digest=str(row[3]),
                source_snapshot_ids=tuple(int(value) for value in self._decoded_json_tuple(row[4])),
                source_snapshot_digests=tuple(str(value) for value in self._decoded_json_tuple(row[5])),
                model_routing_version=str(row[9]),
            )
            counts = self._batch_counts(batch.items)
            self._attest_batch_row(
                row,
                batch,
                taxonomy_id,
                counts,
                allowed_statuses=(
                    "draft", "published", "accepted", "ingested",
                    "candidate_materialized", "rejected", "failed",
                ),
            )
            if compute_batch_hash(batch.items) != batch.published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            return PersistedApprovalBatch(batch=batch, database_batch_id=int(batch_id))
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            self._close(cursor, connection)

    def load_accepted_snapshot(self, batch_id: int) -> AcceptedBatchSnapshot:
        """Reconstruct reviewed decisions while separately attesting publication.

        ``load_persisted_batch`` deliberately rehydrates the immutable values under
        ``proposal_evidence.published_decision``.  Those are the publication audit
        authority, not the manager's accepted decision.  The editable ``final_*``
        columns are therefore loaded independently after the published batch has
        been attested and are the only values used for the accepted hash.
        """

        persisted = self.load_persisted_batch(int(batch_id))
        history = self.load_batch_history(int(batch_id))
        if history.batch_status not in ("accepted", "ingested", "candidate_materialized"):
            raise RepositoryError("BATCH_NOT_ACCEPTED")
        if (
            not history.accepted_decision_hash
            or not history.approver
            or history.accepted_at is None
        ):
            raise RepositoryError("BATCH_NOT_ACCEPTED")
        stored_rows = self._fetchall(
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
              decision_reason,
              proposal_evidence,
              conflict_codes,
              conflict_code
            FROM portal_content_approval_items
            WHERE approval_batch_id = %s
            ORDER BY content_entity_id, input_hash
            """,
            (int(batch_id),),
        )
        taxonomy = TaxonomyVersion(
            version=persisted.batch.taxonomy_version,
            terms=persisted.batch.taxonomy_terms,
            digest=persisted.batch.taxonomy_digest,
        )
        stored_items, counts = self._stored_acceptance_items(stored_rows, taxonomy)
        items = tuple(item for _approval_item_id, item in stored_items)
        published_keys = {
            (item.content_entity_id, item.input_hash, item.row_hash)
            for item in persisted.batch.items
        }
        accepted_keys = {
            (item.content_entity_id, item.input_hash, item.row_hash)
            for item in items
        }
        if published_keys != accepted_keys:
            raise RepositoryError("BATCH_ITEMS_MISMATCH")
        accepted_hash = compute_accepted_decision_hash(items)
        accepted_count = counts["ready"]
        skipped_count = len(items) - accepted_count
        if (
            accepted_hash != history.accepted_decision_hash
            or history.accepted_count != accepted_count
            or history.skipped_count != skipped_count
        ):
            raise RepositoryError("BATCH_HASH_MISMATCH")
        return AcceptedBatchSnapshot(
            batch_key=persisted.batch.batch_key,
            published_input_hash=persisted.batch.published_input_hash,
            accepted_decision_hash=accepted_hash,
            items=items,
            accepted_by=history.approver,
            accepted_at=self._canonical_acceptance_timestamp(history.accepted_at).isoformat(
                timespec="microseconds"
            ),
            accepted_count=accepted_count,
            skipped_count=skipped_count,
        )

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
                if getattr(cursor, "rowcount", 1) not in (0, 1):
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
                    accepted_at,
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
                  batch.id,
                  batch.batch_key,
                  batch.taxonomy_version_id,
                  batch.taxonomy_digest,
                  taxonomy.version,
                  taxonomy.taxonomy_digest,
                  batch.published_input_hash,
                  batch.accepted_decision_hash,
                  batch.batch_status,
                  batch.accepted_by,
                  batch.accepted_at,
                  batch.ready_count,
                  batch.conflict_count,
                  batch.unresolved_count,
                  batch.rejected_count,
                  batch.no_change_count,
                  batch.accepted_count,
                  batch.skipped_count,
                  batch.source_snapshot_ids,
                  batch.source_snapshot_digests,
                  batch.prompt_version,
                  batch.model_routing_version
                FROM portal_content_approval_batches AS batch
                INNER JOIN portal_content_taxonomy_versions AS taxonomy
                  ON taxonomy.id = batch.taxonomy_version_id
                 AND taxonomy.dataset_key = batch.dataset_key
                 AND (
                   taxonomy.taxonomy_status = %s
                   OR batch.batch_status = 'ingested'
                 )
                WHERE batch.dataset_key = %s
                  AND batch.batch_key = %s
                FOR UPDATE
                """,
                ("active", DATASET_KEY, snapshot.batch_key),
            )
            batch_row = cursor.fetchone()
            if batch_row is None:
                raise RepositoryError("BATCH_NOT_ACCEPTED")

            batch_id = int(batch_row[0])
            if str(batch_row[1]) != snapshot.batch_key:
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            taxonomy_version_id = int(batch_row[2])
            if str(batch_row[3]) != str(batch_row[5]):
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            published_input_hash = str(batch_row[6])
            stored_accepted_hash = str(batch_row[7] or "")
            batch_status = str(batch_row[8])
            stored_accepted_by = str(batch_row[9] or "")
            stored_accepted_at = batch_row[10]
            taxonomy = self._load_taxonomy_terms(
                cursor,
                taxonomy_version_id,
                str(batch_row[4]),
                str(batch_row[5]),
                lock=True,
                include_retired=batch_status == "ingested",
            )

            if (
                not snapshot.accepted_decision_hash
                or not snapshot.accepted_by.strip()
                or not snapshot.accepted_at
                or not stored_accepted_by.strip()
            ):
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if published_input_hash != snapshot.published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if batch_status not in ("accepted", "ingested"):
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if stored_accepted_by != snapshot.accepted_by:
                raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")
            accepted_at = self._canonical_acceptance_timestamp(stored_accepted_at)
            if accepted_at != self._canonical_acceptance_timestamp(snapshot.accepted_at):
                raise RepositoryError("BATCH_ACCEPTANCE_METADATA_MISMATCH")

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
                  decision_reason,
                  proposal_evidence,
                  conflict_codes,
                  conflict_code
                FROM portal_content_approval_items
                WHERE approval_batch_id = %s
                ORDER BY content_entity_id, input_hash
                FOR UPDATE
                """,
                (batch_id,),
            )
            stored_rows = tuple(cursor.fetchall())
            evidence_by_item_id, published_items = self._attest_published_items(
                stored_rows,
                taxonomy=taxonomy,
                taxonomy_digest=str(batch_row[5]),
                source_snapshot_ids=self._decoded_json_tuple(batch_row[18]),
                source_snapshot_digests=self._decoded_json_tuple(batch_row[19]),
                prompt_version=str(batch_row[20]),
                model_routing_version=str(batch_row[21]),
            )
            if compute_batch_hash(published_items) != published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            stored_items, counts = self._stored_acceptance_items(
                stored_rows,
                taxonomy,
            )
            expected_input_counts = tuple(
                counts[state]
                for state in ("ready", "conflict", "unresolved", "rejected", "no_change")
            )
            if tuple(int(value) for value in batch_row[11:16]) != expected_input_counts:
                raise RepositoryError("BATCH_ITEMS_MISMATCH")
            accepted_count = counts["ready"]
            skipped_count = len(stored_items) - accepted_count
            if (
                int(batch_row[16]) != accepted_count
                or int(batch_row[17]) != skipped_count
            ):
                raise RepositoryError("BATCH_COUNT_MISMATCH")
            canonical_items = tuple(item for _approval_item_id, item in stored_items)
            recomputed_hash = compute_accepted_decision_hash(canonical_items)
            if stored_accepted_hash != recomputed_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            supplied_items, _supplied_counts = self._validate_acceptance_snapshot(
                snapshot,
                stored_rows,
                taxonomy,
            )
            supplied_hash = compute_accepted_decision_hash(
                item for _approval_item_id, item in supplied_items
            )
            if (
                snapshot.accepted_decision_hash != stored_accepted_hash
                or supplied_hash != stored_accepted_hash
            ):
                raise RepositoryError("BATCH_HASH_MISMATCH")
            for name, expected in (
                ("accepted_count", accepted_count),
                ("skipped_count", skipped_count),
            ):
                supplied = getattr(snapshot, name, None)
                if supplied is not None and int(supplied) != expected:
                    raise RepositoryError("BATCH_COUNT_MISMATCH")
            if batch_status == "ingested":
                connection.commit()
                return IngestResult(
                    status="noop",
                    accepted_count=accepted_count,
                    conflict_count=counts["conflict"],
                    unresolved_count=counts["unresolved"],
                    rejected_count=counts["rejected"],
                )

            for approval_item_id, item in stored_items:
                if item.readiness_state != "ready":
                    continue
                if (
                    item.content_entity_id is None
                    or item.final_lifecycle_code is None
                ):
                    raise RepositoryError("BATCH_NOT_ACCEPTED")

                # Serialize successor derivation across different approval batches.
                # The approval-item foreign key already guarantees this row exists.
                cursor.execute(
                    """
                    SELECT id
                    FROM portal_content_registry_entities
                    WHERE id = %s
                      AND dataset_key = %s
                    FOR UPDATE
                    """,
                    (item.content_entity_id, DATASET_KEY),
                )
                entity_row = cursor.fetchone()
                if (
                    entity_row is None
                    or int(entity_row[0]) != item.content_entity_id
                ):
                    raise RepositoryError("CONTENT_ENTITY_NOT_ABBOTT")
                cursor.execute(
                    """
                    SELECT
                      id,
                      direction_code,
                      material_type_code,
                      access_code,
                      lifecycle_code,
                      effective_at
                    FROM portal_content_classification_events
                    WHERE content_entity_id = %s
                    ORDER BY effective_at DESC, id DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (item.content_entity_id,),
                )
                predecessor_row = cursor.fetchone()
                predecessor_event_id = (
                    int(predecessor_row[0]) if predecessor_row is not None else None
                )
                predecessor_values = (
                    tuple(predecessor_row[1:5])
                    if predecessor_row is not None and len(predecessor_row) >= 5
                    else None
                )
                event_values = (
                    item.final_direction_code,
                    item.final_material_type_code,
                    item.final_access_code,
                    item.final_lifecycle_code,
                )
                if predecessor_values == event_values:
                    continue
                if predecessor_row is not None:
                    if len(predecessor_row) < 6:
                        raise RepositoryError("SUCCESSOR_EFFECTIVE_AT_INVALID")
                    predecessor_effective_at = self._canonical_event_timestamp(
                        predecessor_row[5]
                    )
                    if accepted_at < predecessor_effective_at:
                        raise RepositoryError("SUCCESSOR_EFFECTIVE_AT_INVALID")

                event_kind = "approve"
                reason = item.decision_reason.strip() if item.decision_reason else None
                actor = stored_accepted_by.strip()
                proposal_evidence = evidence_by_item_id[approval_item_id]
                self._attest_reviewed_predecessor(
                    proposal_evidence,
                    item.content_entity_id,
                    predecessor_event_id,
                    predecessor_values,
                )
                if (
                    predecessor_values is not None
                    and predecessor_values[0]
                    and predecessor_values[0] != item.final_direction_code
                ):
                    if not reason:
                        raise RepositoryError("CORRECTION_REASON_REQUIRED")
                    if not actor or predecessor_event_id is None:
                        raise RepositoryError("CORRECTION_AUDIT_REQUIRED")
                    event_kind = "correct"

                if (
                    item.final_lifecycle_code == "archive_candidate"
                    and (
                        predecessor_values is None
                        or predecessor_values[3] != "archive_candidate"
                    )
                    and not self._archive_evidence_authorized(proposal_evidence)
                ):
                    raise RepositoryError("ARCHIVE_EVIDENCE_REQUIRED")

                event_evidence = {
                    "accepted_decision_hash": stored_accepted_hash,
                    "approval_item_evidence": proposal_evidence,
                    "row_hash": item.row_hash,
                }
                event_fingerprint = compute_classification_event_fingerprint(
                    {
                        "access_code": item.final_access_code,
                        "actor": actor,
                        "approval_batch_id": batch_id,
                        "approval_item_id": approval_item_id,
                        "content_entity_id": item.content_entity_id,
                        "direction_code": item.final_direction_code,
                        "effective_at": accepted_at.isoformat(timespec="microseconds"),
                        "event_kind": event_kind,
                        "lifecycle_code": item.final_lifecycle_code,
                        "material_type_code": item.final_material_type_code,
                        "predecessor_event_id": predecessor_event_id,
                        "proposal_evidence": event_evidence,
                        "reason": reason,
                        "taxonomy_version_id": taxonomy_version_id,
                    }
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
                        event_kind,
                        event_fingerprint,
                        self._json(event_evidence),
                        actor,
                        reason,
                        accepted_at,
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
            if getattr(cursor, "rowcount", 1) != 1:
                raise RepositoryError("BATCH_STATUS_TRANSITION_INVALID")
            connection.commit()
            return IngestResult(
                status="ingested",
                accepted_count=accepted_count,
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
        include_retired: bool = False,
    ) -> TaxonomyVersion:
        cursor.execute(
            f"""
            SELECT taxonomy_kind, term_code
            FROM portal_content_taxonomy_terms
            WHERE taxonomy_version_id = %s
              {"" if include_retired else "AND term_status = %s"}
            ORDER BY taxonomy_kind, term_code
            {"FOR UPDATE" if lock else ""}
            """,
            (taxonomy_id,) if include_retired else (taxonomy_id, "active"),
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
    def _stored_acceptance_items(
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

        taxonomy_fields = (
            ("direction", "final_direction_code"),
            ("material_type", "final_material_type_code"),
            ("access", "final_access_code"),
            ("lifecycle", "final_lifecycle_code"),
        )
        stored_items = tuple(stored_by_key.values())
        for _approval_item_id, item in stored_items:
            if (
                item.final_material_type_code is not None
                and item.final_material_type_code.strip().casefold()
                in {"архив", "archive"}
            ):
                raise RepositoryError("ARCHIVE_TYPE_INVALID")
            for kind, field_name in taxonomy_fields:
                value = getattr(item, field_name)
                if value is not None and value not in taxonomy.terms[kind]:
                    raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
        counts = ContentRegistryRepository._batch_counts(
            tuple(item for _approval_item_id, item in stored_items)
        )
        return stored_items, counts

    @staticmethod
    def _validate_acceptance_snapshot(
        snapshot: AcceptedBatchSnapshot,
        stored_rows: Sequence[Sequence[object]],
        taxonomy: TaxonomyVersion,
    ) -> tuple[tuple[tuple[int, ApprovalItem], ...], dict[str, int]]:
        stored_items, counts = ContentRegistryRepository._stored_acceptance_items(
            stored_rows,
            taxonomy,
        )
        stored_by_key = {
            (item.content_entity_id, item.input_hash, item.row_hash): (
                approval_item_id,
                item,
            )
            for approval_item_id, item in stored_items
        }

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
        ContentRegistryRepository._batch_counts(
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
    def _attest_published_items(
        stored_rows: Sequence[Sequence[object]],
        *,
        taxonomy: TaxonomyVersion,
        taxonomy_digest: str,
        source_snapshot_ids: tuple[object, ...],
        source_snapshot_digests: tuple[object, ...],
        prompt_version: str,
        model_routing_version: str,
    ) -> tuple[dict[int, Mapping[str, object]], tuple[ApprovalBatchItem, ...]]:
        evidence_by_id: dict[int, Mapping[str, object]] = {}
        published_items: list[ApprovalBatchItem] = []
        expected_evidence_keys = {
            "archive_attestation",
            "concise_evidence",
            "current_canonical",
            "deterministic",
            "published_decision",
            "registry1",
            "registry2",
            "sol",
            "terra",
        }
        for row in stored_rows:
            try:
                approval_item_id = int(row[0])
                if approval_item_id in evidence_by_id or len(row) < 15:
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                evidence = json.loads(row[12]) if isinstance(row[12], str) else row[12]
                conflict_codes = (
                    json.loads(row[13]) if isinstance(row[13], str) else row[13]
                )
                if (
                    not isinstance(evidence, Mapping)
                    or set(evidence) != expected_evidence_keys
                    or not isinstance(conflict_codes, (tuple, list))
                    or any(not isinstance(code, str) for code in conflict_codes)
                ):
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                expected_conflict_code = conflict_codes[0] if conflict_codes else None
                stored_conflict_code = (
                    str(row[14]) if row[14] is not None else None
                )
                if stored_conflict_code != expected_conflict_code:
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                for evidence_key in (
                    "archive_attestation",
                    "current_canonical",
                    "deterministic",
                    "registry1",
                    "registry2",
                    "sol",
                    "terra",
                ):
                    value = evidence[evidence_key]
                    if value is not None and not isinstance(value, Mapping):
                        raise RepositoryError("BATCH_ITEMS_MISMATCH")
                concise_evidence = evidence["concise_evidence"]
                if not isinstance(concise_evidence, (tuple, list)) or any(
                    not isinstance(value, str) for value in concise_evidence
                ):
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                published_decision = evidence["published_decision"]
                if not isinstance(published_decision, Mapping) or set(
                    published_decision
                ) != {
                    "decision_reason",
                    "final_access_code",
                    "final_direction_code",
                    "final_lifecycle_code",
                    "final_material_type_code",
                }:
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                if any(
                    value is not None and not isinstance(value, str)
                    for value in published_decision.values()
                ):
                    raise RepositoryError("BATCH_ITEMS_MISMATCH")
                item = ApprovalBatchItem(
                    content_entity_id=(
                        int(row[1]) if row[1] is not None else None
                    ),
                    input_hash=str(row[2]),
                    title=str(row[3]),
                    url=str(row[4]),
                    final_direction_code=published_decision["final_direction_code"],
                    final_material_type_code=published_decision[
                        "final_material_type_code"
                    ],
                    final_access_code=published_decision["final_access_code"],
                    final_lifecycle_code=published_decision[
                        "final_lifecycle_code"
                    ],
                    readiness_state=str(row[9]),
                    conflict_codes=tuple(ConflictCode(str(code)) for code in conflict_codes),
                    row_hash=str(row[10]),
                    decision_reason=published_decision["decision_reason"],
                    current_canonical=evidence["current_canonical"],
                    registry1_values=evidence["registry1"],
                    registry2_values=evidence["registry2"],
                    deterministic_result=evidence["deterministic"],
                    terra_result=evidence["terra"],
                    sol_result=evidence["sol"],
                    archive_attestation=evidence["archive_attestation"],
                    concise_evidence=tuple(concise_evidence),
                    taxonomy_digest=taxonomy_digest,
                    taxonomy_terms=taxonomy.terms,
                    source_snapshot_ids=tuple(int(value) for value in source_snapshot_ids),
                    source_snapshot_digests=tuple(
                        str(value) for value in source_snapshot_digests
                    ),
                    model_routing_version=model_routing_version,
                    prompt_version=prompt_version,
                )
            except RepositoryError:
                raise
            except (IndexError, KeyError, TypeError, ValueError):
                raise RepositoryError("BATCH_ITEMS_MISMATCH") from None
            if compute_item_hash(item) != item.row_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            evidence_by_id[approval_item_id] = evidence
            published_items.append(item)
        return evidence_by_id, tuple(published_items)

    @staticmethod
    def _archive_evidence_authorized(evidence: object) -> bool:
        if not isinstance(evidence, Mapping):
            return False
        attestation = evidence.get("archive_attestation")
        if not isinstance(attestation, Mapping):
            return False
        return attestation.get("explicit_archive_override") is True or (
            attestation.get("evidence_code") in {"HTTP_404", "HTTP_410"}
        )

    @staticmethod
    def _attest_reviewed_predecessor(
        evidence: object,
        content_entity_id: int,
        predecessor_event_id: int | None,
        predecessor_values: tuple[object, ...] | None,
    ) -> None:
        if not isinstance(evidence, Mapping):
            raise RepositoryError("CORRECTION_AUDIT_REQUIRED")
        current = evidence.get("current_canonical")
        if predecessor_event_id is None:
            if current is not None:
                raise RepositoryError("CORRECTION_PREDECESSOR_MISMATCH")
            return
        if not isinstance(current, Mapping) or predecessor_values is None:
            raise RepositoryError("CORRECTION_AUDIT_REQUIRED")
        try:
            expected_event_id = int(current["event_id"])
            expected_entity_id = int(current["content_entity_id"])
            expected_values = tuple(
                current[key]
                for key in (
                    "direction_code",
                    "material_type_code",
                    "access_code",
                    "lifecycle_code",
                )
            )
        except (KeyError, TypeError, ValueError):
            raise RepositoryError("CORRECTION_AUDIT_REQUIRED") from None
        if (
            expected_event_id != predecessor_event_id
            or expected_entity_id != content_entity_id
            or expected_values != predecessor_values
        ):
            raise RepositoryError("CORRECTION_PREDECESSOR_MISMATCH")

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
    def _canonical_event_timestamp(value: object) -> datetime:
        try:
            return ContentRegistryRepository._canonical_acceptance_timestamp(value)
        except RepositoryError:
            raise RepositoryError("SUCCESSOR_EFFECTIVE_AT_INVALID") from None

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
