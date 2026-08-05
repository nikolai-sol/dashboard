"""Transactional repository tests for the Abbott content registry."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace
import unittest

from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    Proposal,
)
from agents.abbott_page_classifier.repository import (
    ContentRegistryRepository,
    RepositoryError,
)
from agents.abbott_page_classifier.batch_service import (
    build_batch,
    compute_batch_hash,
    compute_taxonomy_digest,
)
from agents.abbott_page_classifier.domain import TaxonomyVersion
from agents.abbott_page_classifier.reconcile import ReconciliationInput


PUBLISHED_HASH = "1" * 64
ACCEPTED_HASH = "2" * 64


def canonical_taxonomy() -> TaxonomyVersion:
    terms = {
        "direction": tuple(sorted(DIRECTION_CODES)),
        "material_type": tuple(sorted(MATERIAL_TYPE_CODES)),
        "access": tuple(sorted(ACCESS_CODES)),
        "lifecycle": tuple(sorted(LIFECYCLE_CODES)),
    }
    return TaxonomyVersion(
        version="abbott.v1",
        terms=terms,
        digest=compute_taxonomy_digest("abbott.v1", terms),
    )


def workflow_batch():
    return build_batch(
        (
            ReconciliationInput(
                content_entity_id=41,
                deterministic_proposal=Proposal(
                    direction_code="cardiology",
                    material_type_code="articles",
                    access_code="doctors",
                    lifecycle_code="active",
                    rule_code="path_rule",
                    confidence=0.9,
                    evidence=("path evidence",),
                ),
            ),
        ),
        canonical_taxonomy(),
        "prompt.v1",
        source_snapshot_ids=(101, 202),
        source_snapshot_digests=("a" * 64, "b" * 64),
        model_routing_version="routing.v1",
    )


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


def accepted_snapshot(
    *items: ApprovalItem,
    accepted_at: str = "2026-08-05T14:30:00+02:00",
) -> AcceptedBatchSnapshot:
    return AcceptedBatchSnapshot(
        batch_key="abbott-2026-08-05",
        published_input_hash=PUBLISHED_HASH,
        accepted_decision_hash=ACCEPTED_HASH,
        items=tuple(items),
        accepted_by="content-manager",
        accepted_at=accepted_at,
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


class WorkflowCursor:
    def __init__(self, connection: "WorkflowConnection"):
        self.connection = connection
        self.rows: list[tuple[object, ...]] = []
        self.lastrowid = 0
        self.rowcount = 0

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None:
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        self.rowcount = 0
        if "FROM portal_content_taxonomy_versions" in normalized:
            self.rows = [(3, self.connection.batch.taxonomy_digest)]
        elif "FROM portal_content_taxonomy_terms" in normalized:
            self.rows = [
                (kind, code)
                for kind, codes in self.connection.batch.taxonomy_terms.items()
                for code in codes
            ]
        elif "activation_status" in normalized and "FROM portal_content_approval_batches" in normalized:
            if self.connection.history_row is not None:
                self.rows = [self.connection.history_row]
        elif (
            "spreadsheet_file_id" in normalized
            and "FROM portal_content_approval_batches" in normalized
            and "FOR UPDATE" in normalized
        ):
            if self.connection.acceptance_row is not None:
                self.rows = [self.connection.acceptance_row]
        elif (
            "FROM portal_content_approval_batches" in normalized
            and "batch_key = %s" in normalized
        ):
            if self.connection.existing_batch_row is not None:
                self.rows = [self.connection.existing_batch_row]
        elif (
            "FROM portal_content_approval_batches" in normalized
            and "WHERE id = %s" in normalized
        ):
            if self.connection.existing_batch_row is not None:
                self.rows = [self.connection.existing_batch_row]
        elif "FROM portal_content_approval_items" in normalized and "ORDER BY" in normalized:
            self.rows = [
                (
                    item.content_entity_id,
                    item.input_hash,
                    item.row_hash,
                    item.readiness_state,
                )
                for item in self.connection.batch.items
            ]
        elif "FROM portal_content_approval_items" in normalized:
            matched = next(
                (
                    item
                    for item in self.connection.batch.items
                    if item.content_entity_id == params[1] and item.input_hash == params[2]
                ),
                None,
            ) if self.connection.items_exist else None
            if matched is not None:
                self.rows = [(100, matched.title, matched.url, matched.row_hash)]
        elif normalized.startswith("INSERT INTO portal_content_approval_batches"):
            self.lastrowid = 17
        elif normalized.startswith("INSERT INTO portal_content_approval_items"):
            self.connection.item_insert_count += 1
            if self.connection.fail_item_insert:
                raise RuntimeError("private database error secret")
            self.lastrowid = 100 + self.connection.item_insert_count
        elif normalized.startswith("UPDATE portal_content_approval_batches"):
            self.rowcount = 1

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self) -> None:
        pass


class WorkflowConnection:
    def __init__(
        self,
        batch,
        *,
        existing_batch_row=None,
        acceptance_row=None,
        history_row=None,
        items_exist=False,
        fail_item_insert=False,
    ):
        self.batch = batch
        self.existing_batch_row = existing_batch_row
        self.acceptance_row = acceptance_row
        self.history_row = history_row
        self.items_exist = items_exist
        self.fail_item_insert = fail_item_insert
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.item_insert_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.cursor_instance = WorkflowCursor(self)

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        pass


def accepted_batch_row(
    *,
    published_hash: str = PUBLISHED_HASH,
    accepted_hash: str | None = ACCEPTED_HASH,
    status: str = "accepted",
    accepted_by: str | None = "content-manager",
    accepted_at: str | dt.datetime | None = "2026-08-05T14:30:00+02:00",
) -> tuple[object, ...]:
    return (
        17,
        3,
        published_hash,
        accepted_hash,
        status,
        accepted_by,
        accepted_at,
    )


def draft_workflow_row(batch, *, status="draft"):
    return (
        17,
        3,
        batch.batch_key,
        batch.taxonomy_digest,
        '[101,202]',
        '["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",'
        '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]',
        batch.published_input_hash,
        status,
        batch.prompt_version,
        batch.model_routing_version,
        1,
        0,
        0,
        0,
        0,
    )


class ContentRegistryRepositoryTests(unittest.TestCase):
    def test_load_active_taxonomy_returns_exact_terms_and_verified_digest(self):
        batch = workflow_batch()
        connection = WorkflowConnection(batch)
        repository = ContentRegistryRepository(lambda: connection)

        loaded = repository.load_active_taxonomy("abbott.v1")

        self.assertEqual(loaded.version, "abbott.v1")
        self.assertEqual(loaded.terms, batch.taxonomy_terms)
        self.assertEqual(loaded.digest, batch.taxonomy_digest)

    def test_persist_draft_batch_inserts_batch_and_every_item_in_one_transaction(self):
        batch = workflow_batch()
        connection = WorkflowConnection(batch)
        repository = ContentRegistryRepository(lambda: connection)

        batch_id = repository.persist_draft_batch(batch)

        writes = [call for call in connection.calls if call[0].startswith("INSERT INTO")]
        self.assertEqual(batch_id, 17)
        self.assertEqual(len(writes), 2)
        self.assertIn("portal_content_approval_batches", writes[0][0])
        self.assertIn("portal_content_approval_items", writes[1][0])
        self.assertIn("draft", writes[0][1])
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_persist_draft_batch_rolls_back_batch_when_any_item_fails(self):
        batch = workflow_batch()
        connection = WorkflowConnection(batch, fail_item_insert=True)
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.persist_draft_batch(batch)

        self.assertEqual(raised.exception.code, "DB_TRANSACTION_FAILED")
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_persist_draft_retry_reuses_and_attests_existing_failed_row(self):
        batch = workflow_batch()
        connection = WorkflowConnection(
            batch,
            existing_batch_row=draft_workflow_row(batch, status="failed"),
        )
        repository = ContentRegistryRepository(lambda: connection)

        batch_id = repository.persist_draft_batch(batch)

        inserts = [sql for sql, _ in connection.calls if sql.startswith("INSERT INTO")]
        self.assertEqual(batch_id, 17)
        self.assertEqual(inserts, [])
        self.assertEqual(connection.commit_count, 1)

    def test_attestation_rejects_invented_taxonomy_before_publication(self):
        canonical = workflow_batch()
        invented_terms = {
            **canonical.taxonomy_terms,
            "direction": (*canonical.taxonomy_terms["direction"], "invented"),
        }
        invented = build_batch(
            canonical.items,
            TaxonomyVersion(
                version="abbott.v1",
                terms=invented_terms,
                digest=compute_taxonomy_digest("abbott.v1", invented_terms),
            ),
            "prompt.v1",
            source_snapshot_ids=(101, 202),
            source_snapshot_digests=("a" * 64, "b" * 64),
            model_routing_version="routing.v1",
        )
        connection = WorkflowConnection(
            canonical,
            existing_batch_row=draft_workflow_row(canonical),
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.attest_batch_for_publication(17, invented)

        self.assertEqual(raised.exception.code, "TAXONOMY_CONTRACT_MISMATCH")

    def test_atomic_persistence_rejects_forged_item_fields_even_with_new_batch_hash(self):
        canonical = workflow_batch()
        forged_item = replace(
            canonical.items[0],
            final_direction_code="invented_direction",
        )
        forged = replace(
            canonical,
            items=(forged_item,),
            published_input_hash=compute_batch_hash((forged_item,)),
        )
        connection = WorkflowConnection(canonical)
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.persist_draft_batch(forged)

        self.assertIn(
            raised.exception.code,
            {"BATCH_HASH_MISMATCH", "TAXONOMY_CONTRACT_MISMATCH"},
        )
        self.assertEqual(connection.calls, [])

    def test_acceptance_attestation_allows_idempotent_accepted_status(self):
        batch = workflow_batch()
        connection = WorkflowConnection(
            batch,
            existing_batch_row=draft_workflow_row(batch, status="accepted"),
        )
        repository = ContentRegistryRepository(lambda: connection)

        repository.attest_batch_for_acceptance(17, batch)

        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.rollback_count, 0)

    def test_projection_status_transitions_persist_sheet_metadata_and_retry_failure(self):
        batch = workflow_batch()
        connection = WorkflowConnection(batch)
        repository = ContentRegistryRepository(lambda: connection)

        repository.mark_batch_published(17, "sheet-123", "c" * 64)
        repository.mark_batch_projection_failed(17, "SHEET_PROJECTION_FAILED")

        updates = [call for call in connection.calls if call[0].startswith("UPDATE ")]
        self.assertEqual(len(updates), 2)
        self.assertIn("spreadsheet_file_id", updates[0][0])
        self.assertEqual(updates[0][1][:3], ("published", "sheet-123", "c" * 64))
        self.assertEqual(updates[1][1][:2], ("failed", "SHEET_PROJECTION_FAILED"))
        self.assertIn("'published'", updates[1][0])
        self.assertEqual(connection.commit_count, 2)

    def test_record_acceptance_persists_hash_actor_timestamp_and_counts(self):
        batch = workflow_batch()
        snapshot = AcceptedBatchSnapshot(
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_decision_hash="d" * 64,
            items=batch.items,
            accepted_by="manager",
            accepted_at="2026-08-05T12:00:00Z",
        )
        connection = WorkflowConnection(
            batch,
            acceptance_row=(
                batch.batch_key,
                batch.published_input_hash,
                "published",
                "sheet-123",
                None,
                None,
                None,
            ),
            items_exist=True,
        )
        repository = ContentRegistryRepository(lambda: connection)

        repository.record_batch_acceptance(17, snapshot, "sheet-123")

        update_sql, update_params = next(
            call
            for call in connection.calls
            if call[0].startswith("UPDATE portal_content_approval_batches")
        )
        self.assertIn("accepted_decision_hash", update_sql)
        self.assertEqual(update_params[:4], ("accepted", "d" * 64, "manager", "2026-08-05T12:00:00Z"))
        self.assertEqual(update_params[4:6], (1, 0))
        item_updates = [
            call
            for call in connection.calls
            if call[0].startswith("UPDATE portal_content_approval_items")
        ]
        self.assertEqual(len(item_updates), len(snapshot.items))

    def test_load_batch_history_returns_all_persisted_audit_fields(self):
        batch = workflow_batch()
        connection = WorkflowConnection(
            batch,
            history_row=(
                batch.batch_key,
                batch.published_input_hash,
                "d" * 64,
                "manager",
                "2026-08-05T12:00:00Z",
                1,
                0,
                0,
                0,
                0,
                1,
                0,
                "accepted",
                "sheet-123",
                "c" * 64,
                10,
                "candidate",
            ),
        )
        repository = ContentRegistryRepository(lambda: connection)

        history = repository.load_batch_history(17)

        self.assertEqual(history.accepted_decision_hash, "d" * 64)
        self.assertEqual(history.spreadsheet_file_id, "sheet-123")
        self.assertEqual(history.candidate_release_id, 10)
        self.assertEqual(history.activation_status, "candidate")

    def test_insert_items_persists_enriched_task6_proposal_evidence(self):
        connection = RecordingConnection()
        repository = ContentRegistryRepository(lambda: connection)
        batch = workflow_batch()

        repository.insert_items(17, batch.items)

        insert_params = next(
            params
            for sql, params in connection.calls
            if sql.startswith("INSERT INTO portal_content_approval_items")
        )
        self.assertIn('"deterministic"', insert_params[14])
        self.assertIn('"path_rule"', insert_params[14])

    def test_create_batch_uses_active_taxonomy_and_parameterized_write(self):
        batch = workflow_batch()
        connection = WorkflowConnection(batch)
        repository = ContentRegistryRepository(lambda: connection)

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
        self.assertIn("draft", insert_params)
        self.assertNotIn("published", insert_params)
        self.assertEqual(connection.item_insert_count, len(batch.items))
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
        update_sql, update_params = update_calls[0]
        set_clause = update_sql.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
        self.assertIn("batch_status = %s", set_clause)
        self.assertIn("ingested_at = CURRENT_TIMESTAMP(6)", set_clause)
        self.assertNotIn("accepted_decision_hash", set_clause)
        self.assertNotIn("accepted_by", set_clause)
        self.assertNotIn("accepted_at", set_clause)
        self.assertEqual(update_params, ("ingested", 17))
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

    def test_event_fingerprint_is_batch_specific_and_same_batch_repeatable(self):
        item = approval_item(41)
        snapshot = accepted_snapshot(item)

        def ingest_fingerprint(batch_id: int) -> str:
            row = accepted_batch_row()
            connection = RecordingConnection(batch_row=(batch_id, *row[1:]))
            repository = ContentRegistryRepository(lambda: connection)

            repository.ingest_accepted_snapshot(snapshot)

            event_call = next(
                call
                for call in connection.calls
                if call[0].startswith(
                    "INSERT INTO portal_content_classification_events"
                )
            )
            return str(event_call[1][10])

        first_batch_fingerprint = ingest_fingerprint(17)
        same_batch_retry_fingerprint = ingest_fingerprint(17)
        second_batch_fingerprint = ingest_fingerprint(18)

        self.assertEqual(first_batch_fingerprint, same_batch_retry_fingerprint)
        self.assertNotEqual(first_batch_fingerprint, second_batch_fingerprint)

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

    def test_ingest_rejects_locked_acceptance_audit_metadata_mismatch(self):
        mismatch_rows = (
            accepted_batch_row(accepted_by="different-manager"),
            accepted_batch_row(accepted_at="2026-08-05T14:31:00+02:00"),
        )
        for batch_row in mismatch_rows:
            with self.subTest(batch_row=batch_row):
                connection = RecordingConnection(batch_row=batch_row)
                repository = ContentRegistryRepository(lambda: connection)

                with self.assertRaises(RepositoryError) as raised:
                    repository.ingest_accepted_snapshot(
                        accepted_snapshot(approval_item(41))
                    )

                self.assertEqual(
                    raised.exception.code,
                    "BATCH_ACCEPTANCE_METADATA_MISMATCH",
                )
                self.assertEqual(connection.commit_count, 0)
                self.assertEqual(connection.rollback_count, 1)
                self.assertEqual(connection.item_insert_count, 0)
                self.assertEqual(connection.event_insert_count, 0)

    def test_ingest_compares_locked_datetime_and_iso_timestamp_as_utc_instants(self):
        locked_accepted_at = dt.datetime(2026, 8, 5, 12, 30, 0, 123456)
        equivalent_snapshot_times = (
            "2026-08-05T12:30:00.123456Z",
            "2026-08-05T14:30:00.123456+02:00",
        )
        for snapshot_accepted_at in equivalent_snapshot_times:
            with self.subTest(snapshot_accepted_at=snapshot_accepted_at):
                connection = RecordingConnection(
                    batch_row=accepted_batch_row(accepted_at=locked_accepted_at)
                )
                repository = ContentRegistryRepository(lambda: connection)

                result = repository.ingest_accepted_snapshot(
                    accepted_snapshot(
                        approval_item(41),
                        accepted_at=snapshot_accepted_at,
                    )
                )

                self.assertEqual(result.status, "ingested")
                self.assertEqual(connection.commit_count, 1)
                self.assertEqual(connection.rollback_count, 0)

    def test_ingest_rejects_a_different_acceptance_instant_at_microseconds(self):
        connection = RecordingConnection(
            batch_row=accepted_batch_row(
                accepted_at=dt.datetime(2026, 8, 5, 12, 30, 0, 123456)
            )
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(
                accepted_snapshot(
                    approval_item(41),
                    accepted_at="2026-08-05T12:30:00.123457Z",
                )
            )

        self.assertEqual(
            raised.exception.code,
            "BATCH_ACCEPTANCE_METADATA_MISMATCH",
        )
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_ingest_rejects_equal_malformed_acceptance_timestamps_safely(self):
        malformed_timestamp = "mysql://operator:secret@private-db/not-a-time"
        connection = RecordingConnection(
            batch_row=accepted_batch_row(accepted_at=malformed_timestamp)
        )
        repository = ContentRegistryRepository(lambda: connection)

        with self.assertRaises(RepositoryError) as raised:
            repository.ingest_accepted_snapshot(
                accepted_snapshot(
                    approval_item(41),
                    accepted_at=malformed_timestamp,
                )
            )

        self.assertEqual(
            raised.exception.code,
            "BATCH_ACCEPTANCE_METADATA_MISMATCH",
        )
        self.assertEqual(
            str(raised.exception),
            "BATCH_ACCEPTANCE_METADATA_MISMATCH",
        )
        self.assertNotIn("secret", str(raised.exception))
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
