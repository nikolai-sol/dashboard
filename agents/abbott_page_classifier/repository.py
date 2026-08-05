"""Canonical MySQL repository for the Abbott content-registry workflow."""

from __future__ import annotations

from hashlib import sha256
import json
from typing import Any, Callable, Protocol, Sequence

from .domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
    CanonicalClassification,
    ClassificationEvent,
    IngestResult,
)


DATASET_KEY = "abbott"


class Cursor(Protocol):
    lastrowid: int

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

    def create_batch(self, batch: ApprovalBatch) -> int:
        connection: Connection | None = None
        cursor: Cursor | None = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT id
                FROM portal_content_taxonomy_versions
                WHERE dataset_key = %s
                  AND version = %s
                  AND taxonomy_status = %s
                """,
                (DATASET_KEY, batch.taxonomy_version, "active"),
            )
            taxonomy_row = cursor.fetchone()
            if taxonomy_row is None:
                raise RepositoryError("TAXONOMY_VERSION_NOT_ACTIVE")

            cursor.execute(
                """
                INSERT INTO portal_content_approval_batches (
                  dataset_key,
                  batch_key,
                  taxonomy_version_id,
                  published_input_hash,
                  batch_status,
                  prompt_version
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    DATASET_KEY,
                    batch.batch_key,
                    int(taxonomy_row[0]),
                    batch.published_input_hash,
                    "published",
                    batch.prompt_version,
                ),
            )
            batch_id = int(cursor.lastrowid)
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
                  batch_status
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

            if (
                not snapshot.accepted_decision_hash
                or not snapshot.accepted_by
                or not snapshot.accepted_at
            ):
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if published_input_hash != snapshot.published_input_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")
            if batch_status == "ingested":
                if stored_accepted_hash != snapshot.accepted_decision_hash:
                    raise RepositoryError("BATCH_HASH_MISMATCH")
                connection.commit()
                return IngestResult(status="noop")
            if batch_status != "accepted":
                raise RepositoryError("BATCH_NOT_ACCEPTED")
            if stored_accepted_hash != snapshot.accepted_decision_hash:
                raise RepositoryError("BATCH_HASH_MISMATCH")

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
                event_fingerprint = self._event_fingerprint(snapshot, item)
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
                SET accepted_decision_hash = %s,
                    batch_status = %s,
                    accepted_by = %s,
                    accepted_at = %s,
                    ingested_at = CURRENT_TIMESTAMP(6)
                WHERE id = %s
                """,
                (
                    snapshot.accepted_decision_hash,
                    "ingested",
                    snapshot.accepted_by,
                    snapshot.accepted_at,
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
                ContentRegistryRepository._json([]),
            ),
        )
        return int(cursor.lastrowid)

    @staticmethod
    def _event_fingerprint(
        snapshot: AcceptedBatchSnapshot,
        item: ApprovalItem,
    ) -> str:
        payload = {
            "accepted_decision_hash": snapshot.accepted_decision_hash,
            "access_code": item.final_access_code,
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
    def _json(value: object) -> str:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

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
