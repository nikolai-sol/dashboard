"""Transactional repository tests for the Abbott content registry."""

from __future__ import annotations

import unittest

from agents.abbott_page_classifier.domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
)
from agents.abbott_page_classifier.repository import (
    ContentRegistryRepository,
    RepositoryError,
)


PUBLISHED_HASH = "1" * 64
ACCEPTED_HASH = "2" * 64


def approval_item(
    entity_id: int | None,
    *,
    readiness: str = "ready",
    input_hash: str | None = None,
) -> ApprovalItem:
    stable_id = entity_id if entity_id is not None else 0
    return ApprovalItem(
        content_entity_id=entity_id,
        input_hash=input_hash or f"{stable_id:064x}",
        title=f"Material {stable_id}",
        url=f"https://example.test/material/{stable_id}",
        final_direction_code="cardiology",
        final_material_type_code="articles",
        final_access_code="doctors",
        final_lifecycle_code="active",
        readiness_state=readiness,
        conflict_codes=("DIRECTION_CONFLICT",) if readiness == "conflict" else (),
        row_hash=f"{stable_id + 100:064x}",
        decision_reason="reviewed",
    )


def accepted_snapshot(*items: ApprovalItem) -> AcceptedBatchSnapshot:
    return AcceptedBatchSnapshot(
        batch_key="abbott-2026-08-05",
        published_input_hash=PUBLISHED_HASH,
        accepted_decision_hash=ACCEPTED_HASH,
        items=tuple(items),
        accepted_by="content-manager",
        accepted_at="2026-08-05T14:30:00+02:00",
    )


class RecordingCursor:
    def __init__(self, connection: "RecordingConnection"):
        self.connection = connection
        self.rows: list[tuple[object, ...]] = []
        self.lastrowid = 0
        self.closed = False

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None:
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []

        if (
            "FROM portal_content_approval_batches" in normalized
            and "FOR UPDATE" in normalized
        ):
            if self.connection.batch_row is not None:
                self.rows = [self.connection.batch_row]
            return
        if (
            "FROM portal_content_approval_items" in normalized
            and "FOR UPDATE" in normalized
        ):
            stored = self.connection.approval_items.get(params)
            if stored is not None:
                self.rows = [stored]
            return
        if "FROM portal_content_taxonomy_versions" in normalized:
            self.rows = [(self.connection.taxonomy_version_id,)]
            return
        if "FROM portal_content_registry_entities AS entity" in normalized:
            self.rows = list(self.connection.catalog_rows)
            return
        if "latest_events" in normalized:
            self.rows = list(self.connection.event_rows)
            return
        if (
            normalized.startswith("SELECT id")
            and "FROM portal_content_classification_events" in normalized
        ):
            self.rows = [(self.connection.predecessor_event_id,)]
            return
        if normalized.startswith("INSERT INTO portal_content_approval_batches"):
            self.lastrowid = 17
            return
        if normalized.startswith("INSERT INTO portal_content_approval_items"):
            self.connection.item_insert_count += 1
            if self.connection.item_insert_count == self.connection.fail_on_item_insert:
                raise RuntimeError(
                    "mysql://operator:secret@private-db/report_bd params=sheet-cell-value"
                )
            self.lastrowid = 100 + self.connection.item_insert_count
            self.connection.approval_items[params[:3]] = (
                self.lastrowid,
                params[3],
                params[4],
                params[12],
            )
            return
        if normalized.startswith(
            "INSERT INTO portal_content_classification_events"
        ):
            self.connection.event_insert_count += 1
            self.lastrowid = 700 + self.connection.event_insert_count

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self) -> None:
        self.closed = True


class RecordingConnection:
    def __init__(
        self,
        *,
        batch_row: tuple[object, ...] | None = None,
        fail_on_item_insert: int | None = None,
    ):
        self.batch_row = batch_row
        self.fail_on_item_insert = fail_on_item_insert
        self.taxonomy_version_id = 3
        self.predecessor_event_id = 700
        self.catalog_rows: list[tuple[object, ...]] = []
        self.event_rows: list[tuple[object, ...]] = []
        self.approval_items: dict[
            tuple[object, ...], tuple[object, ...]
        ] = {}
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.item_insert_count = 0
        self.event_insert_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.closed = False
        self.cursor_instance = RecordingCursor(self)

    def cursor(self) -> RecordingCursor:
        return self.cursor_instance

    def commit(self) -> None:
        self.commit_count += 1

    def rollback(self) -> None:
        self.rollback_count += 1

    def close(self) -> None:
        self.closed = True


def accepted_batch_row(
    *,
    published_hash: str = PUBLISHED_HASH,
    accepted_hash: str | None = ACCEPTED_HASH,
    status: str = "accepted",
) -> tuple[object, ...]:
    return (17, 3, published_hash, accepted_hash, status)


class ContentRegistryRepositoryTests(unittest.TestCase):
    def test_create_batch_uses_active_taxonomy_and_parameterized_write(self):
        connection = RecordingConnection()
        repository = ContentRegistryRepository(lambda: connection)
        batch = ApprovalBatch(
            batch_key="abbott-2026-08-05",
            taxonomy_version="abbott.v1",
            published_input_hash=PUBLISHED_HASH,
            items=(approval_item(41),),
            prompt_version="classifier.v1",
        )

        batch_id = repository.create_batch(batch)

        self.assertEqual(batch_id, 17)
        insert_sql, insert_params = next(
            call
            for call in connection.calls
            if call[0].startswith("INSERT INTO portal_content_approval_batches")
        )
        self.assertIn("%s", insert_sql)
        self.assertNotIn(batch.batch_key, insert_sql)
        self.assertEqual(insert_params[0], "abbott")
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_insert_items_commits_all_parameterized_rows_once(self):
        connection = RecordingConnection()
        repository = ContentRegistryRepository(lambda: connection)

        repository.insert_items(17, (approval_item(41), approval_item(42)))

        item_inserts = [
            call
            for call in connection.calls
            if call[0].startswith("INSERT INTO portal_content_approval_items")
        ]
        self.assertEqual(len(item_inserts), 2)
        self.assertTrue(all("%s" in sql for sql, _ in item_inserts))
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_insert_items_reuses_the_same_unresolved_item(self):
        connection = RecordingConnection()
        repository = ContentRegistryRepository(lambda: connection)
        item = approval_item(None, readiness="unresolved")

        repository.insert_items(17, (item,))
        repository.insert_items(17, (item,))

        self.assertEqual(connection.item_insert_count, 1)
        self.assertEqual(connection.commit_count, 2)
        null_safe_selects = [
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_approval_items" in sql
        ]
        self.assertTrue(null_safe_selects)
        self.assertTrue(all("content_entity_id <=> %s" in sql for sql in null_safe_selects))

    def test_ingest_locks_checks_inserts_events_and_updates_only_batch(self):
        connection = RecordingConnection(batch_row=accepted_batch_row())
        repository = ContentRegistryRepository(lambda: connection)
        snapshot = accepted_snapshot(
            approval_item(41),
            approval_item(42, readiness="unresolved"),
        )

        result = repository.ingest_accepted_snapshot(snapshot)

        lock_index = next(
            index
            for index, (sql, _) in enumerate(connection.calls)
            if "FROM portal_content_approval_batches" in sql
            and "FOR UPDATE" in sql
        )
        first_insert_index = next(
            index
            for index, (sql, _) in enumerate(connection.calls)
            if sql.startswith("INSERT INTO")
        )
        self.assertLess(lock_index, first_insert_index)
        self.assertEqual(connection.item_insert_count, 2)
        self.assertEqual(connection.event_insert_count, 1)
        update_calls = [
            call for call in connection.calls if call[0].startswith("UPDATE ")
        ]
        self.assertEqual(len(update_calls), 1)
        self.assertTrue(
            update_calls[0][0].startswith(
                "UPDATE portal_content_approval_batches"
            )
        )
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)
        self.assertEqual(result.status, "ingested")
        self.assertEqual(result.accepted_count, 1)
        self.assertEqual(result.unresolved_count, 1)

    def test_ingest_reuses_only_a_hash_matching_published_item(self):
        connection = RecordingConnection(batch_row=accepted_batch_row())
        published_item = approval_item(41)
        connection.approval_items[(17, 41, published_item.input_hash)] = (
            101,
            published_item.title,
            published_item.url,
            published_item.row_hash,
        )
        accepted_item = ApprovalItem(
            **{
                **published_item.__dict__,
                "final_direction_code": "gastroenterology",
                "decision_reason": "manager correction",
            }
        )
        repository = ContentRegistryRepository(lambda: connection)

        result = repository.ingest_accepted_snapshot(
            accepted_snapshot(accepted_item)
        )

        self.assertEqual(result.status, "ingested")
        self.assertEqual(connection.item_insert_count, 0)
        event_call = next(
            call
            for call in connection.calls
            if call[0].startswith("INSERT INTO portal_content_classification_events")
        )
        self.assertEqual(event_call[1][3], 101)
        self.assertEqual(event_call[1][5], "gastroenterology")

    def test_ingest_rejects_changed_published_item_identity_hash(self):
        connection = RecordingConnection(batch_row=accepted_batch_row())
        item = approval_item(41)
        connection.approval_items[(17, 41, item.input_hash)] = (
            101,
            item.title,
            item.url,
            "f" * 64,
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(accepted_snapshot(item))

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(connection.event_insert_count, 0)

    def test_ingest_rejects_published_hash_mismatch_with_stable_error(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(published_hash="9" * 64)
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(accepted_snapshot(approval_item(41)))

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(str(raised.exception), "BATCH_HASH_MISMATCH")
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_ingest_requires_acceptance_metadata(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(status="published")
        )
        repository = ContentRegistryRepository(lambda: connection)
        snapshot = AcceptedBatchSnapshot(
            batch_key="abbott-2026-08-05",
            published_input_hash=PUBLISHED_HASH,
            accepted_decision_hash="",
            items=(approval_item(41),),
            accepted_by="",
            accepted_at="",
        )

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(snapshot)

        self.assertEqual(raised.exception.code, "BATCH_NOT_ACCEPTED")
        self.assertEqual(str(raised.exception), "BATCH_NOT_ACCEPTED")
        self.assertEqual(connection.rollback_count, 1)

    def test_ingest_rejects_a_batch_that_is_only_published(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(status="published")
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(accepted_snapshot(approval_item(41)))

        self.assertEqual(raised.exception.code, "BATCH_NOT_ACCEPTED")
        self.assertEqual(connection.rollback_count, 1)

    def test_ingest_rejects_a_different_stored_accepted_hash(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(
                accepted_hash="3" * 64,
                status="ingested",
            )
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(accepted_snapshot(approval_item(41)))

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_ingest_is_noop_for_same_accepted_hash(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(
                accepted_hash=ACCEPTED_HASH,
                status="ingested",
            )
        )
        repository = ContentRegistryRepository(lambda: connection)

        result = repository.ingest_accepted_snapshot(
            accepted_snapshot(approval_item(41))
        )

        writes = [
            sql
            for sql, _ in connection.calls
            if sql.startswith("INSERT ") or sql.startswith("UPDATE ")
        ]
        self.assertEqual(writes, [])
        self.assertEqual(result.status, "noop")
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_ingest_rolls_back_and_sanitizes_any_row_failure(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(),
            fail_on_item_insert=2,
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(
                accepted_snapshot(approval_item(41), approval_item(42))
            )

        self.assertEqual(raised.exception.code, "DB_TRANSACTION_FAILED")
        self.assertEqual(str(raised.exception), "DB_TRANSACTION_FAILED")
        self.assertNotIn("secret", str(raised.exception))
        self.assertNotIn("sheet-cell-value", str(raised.exception))
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)
        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_content_approval_batches")
                for sql, _ in connection.calls
            )
        )

    def test_load_active_catalog_maps_canonical_contracts(self):
        connection = RecordingConnection()
        connection.catalog_rows = [
            (
                41,
                "Heart material",
                "https://example.test/material/41",
                "cardiology",
                "articles",
                "doctors",
                "active",
                701,
            )
        ]
        repository = ContentRegistryRepository(lambda: connection)

        catalog = repository.load_active_catalog()

        self.assertEqual(len(catalog), 1)
        self.assertEqual(catalog[0].content_entity_id, 41)
        self.assertEqual(catalog[0].event_id, 701)

    def test_load_effective_classifications_returns_latest_event_per_entity(self):
        connection = RecordingConnection()
        connection.event_rows = [
            (
                41,
                "cardiology",
                "articles",
                "doctors",
                "active",
                "approve",
                "a" * 64,
                700,
                17,
                101,
                "content-manager",
                "reviewed",
                "2026-08-05T14:30:00+02:00",
            )
        ]
        repository = ContentRegistryRepository(lambda: connection)

        events = repository.load_effective_classifications()

        self.assertEqual(set(events), {41})
        self.assertEqual(events[41].event_fingerprint, "a" * 64)
        self.assertEqual(events[41].predecessor_event_id, 700)


if __name__ == "__main__":
    unittest.main()
