"""Task 7 approval ingestion and append-only correction contracts."""

from __future__ import annotations

from dataclasses import replace
import json
import unittest

from agents.abbott_page_classifier.batch_service import (
    CLASSIFICATION_EVENT_KINDS,
    compute_taxonomy_digest,
    ingest_accepted_batch,
)
from agents.abbott_page_classifier.domain import IngestResult, TaxonomyVersion
from agents.abbott_page_classifier.repository import (
    ContentRegistryRepository,
    RepositoryError,
)
from tests.abbott_page_classifier.test_repository import (
    RecordingConnection,
    RecordingCursor,
    accepted_batch_row,
    accepted_snapshot,
    approval_item,
)


class Task7Cursor(RecordingCursor):
    def execute(self, sql: str, params: tuple[object, ...] = ()) -> None:
        super().execute(sql, params)
        normalized = " ".join(sql.split())
        if (
            "FROM portal_content_registry_entities" in normalized
            and "FOR UPDATE" in normalized
        ):
            self.rows = (
                [(int(params[0]),)] if self.connection.abbott_entity_exists else []
            )
        if (
            normalized.startswith("SELECT id")
            and "FROM portal_content_classification_events" in normalized
        ):
            predecessor = self.connection.predecessor_event_row
            self.rows = [predecessor] if predecessor is not None else []


class Task7Connection(RecordingConnection):
    def __init__(
        self,
        *,
        items,
        status: str = "accepted",
        predecessor_event_row=None,
        evidence_by_entity=None,
        fail_on_event_insert=None,
        abbott_entity_exists=True,
    ):
        super().__init__(
            batch_row=accepted_batch_row(items=tuple(items), status=status),
            ingest_items=tuple(items),
            fail_on_event_insert=fail_on_event_insert,
        )
        self.predecessor_event_row = predecessor_event_row
        self.abbott_entity_exists = abbott_entity_exists
        evidence_by_entity = evidence_by_entity or {}
        self.ingest_rows = [
            (*row, json.dumps(evidence_by_entity.get(row[1], {})))
            for row in self.ingest_rows
        ]
        self.cursor_instance = Task7Cursor(self)


def repository_for(connection: Task7Connection) -> ContentRegistryRepository:
    return ContentRegistryRepository(lambda: connection)


def event_calls(connection: Task7Connection):
    return [
        call
        for call in connection.calls
        if call[0].startswith("INSERT INTO portal_content_classification_events")
    ]


class ApprovalIngestionTests(unittest.TestCase):
    def test_service_delegates_to_canonical_repository_and_carries_exact_counts(self):
        snapshot = accepted_snapshot(approval_item(41))

        class CanonicalRepository:
            def __init__(self):
                self.snapshot = None

            def ingest_accepted_snapshot(self, supplied):
                self.snapshot = supplied
                return IngestResult(
                    status="ingested",
                    accepted_count=12,
                    conflict_count=3,
                    unresolved_count=2,
                    rejected_count=1,
                )

        repository = CanonicalRepository()

        result = ingest_accepted_batch(snapshot, repository)

        self.assertIs(repository.snapshot, snapshot)
        self.assertEqual(result.accepted_count, 12)
        self.assertEqual(result.conflict_count, 3)
        self.assertEqual(result.unresolved_count, 2)

    def test_event_kinds_are_exactly_the_append_only_contract(self):
        self.assertEqual(
            CLASSIFICATION_EVENT_KINDS,
            ("baseline", "approve", "correct", "reject", "revoke"),
        )

    def test_new_unlocked_classification_creates_approve_event(self):
        item = approval_item(41)
        connection = Task7Connection(items=(item,), predecessor_event_row=None)

        result = ingest_accepted_batch(
            accepted_snapshot(item), repository_for(connection)
        )

        self.assertEqual(result.status, "ingested")
        self.assertEqual(result.accepted_count, 1)
        self.assertEqual(event_calls(connection)[0][1][9], "approve")

    def test_entity_row_is_locked_before_latest_predecessor_is_selected(self):
        item = approval_item(41)
        connection = Task7Connection(items=(item,), predecessor_event_row=None)

        ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        entity_lock_indexes = [
            index
            for index, (sql, _) in enumerate(connection.calls)
            if "FROM portal_content_registry_entities" in sql
            and "FOR UPDATE" in sql
        ]
        self.assertEqual(len(entity_lock_indexes), 1)
        entity_lock_index = entity_lock_indexes[0]
        predecessor_index = next(
            index
            for index, (sql, _) in enumerate(connection.calls)
            if "FROM portal_content_classification_events" in sql
        )
        self.assertLess(entity_lock_index, predecessor_index)

    def test_ingestion_rejects_item_whose_entity_is_not_in_abbott_dataset(self):
        item = approval_item(41)
        connection = Task7Connection(
            items=(item,), abbott_entity_exists=False
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        self.assertEqual(raised.exception.code, "CONTENT_ENTITY_NOT_ABBOTT")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

    def test_locked_direction_change_without_nonblank_reason_is_rejected(self):
        item = replace(
            approval_item(41),
            final_direction_code="gastroenterology",
            decision_reason=" \r\n ",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
            evidence_by_entity={
                41: {"current_canonical": {"event_id": 700}}
            },
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        self.assertEqual(raised.exception.code, "CORRECTION_REASON_REQUIRED")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)

    def test_explicit_direction_correction_appends_bound_successor_event(self):
        item = replace(
            approval_item(41),
            final_direction_code="gastroenterology",
            decision_reason=" Reviewed direction correction. ",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
            evidence_by_entity={
                41: {
                    "current_canonical": {
                        "content_entity_id": 41,
                        "event_id": 700,
                    }
                }
            },
        )

        result = ingest_accepted_batch(
            accepted_snapshot(item), repository_for(connection)
        )

        self.assertEqual(result.status, "ingested")
        params = event_calls(connection)[0][1]
        self.assertEqual(params[0], 41)
        self.assertEqual(params[2], 17)
        self.assertEqual(params[3], 101)
        self.assertEqual(params[4], 700)
        self.assertEqual(params[5], "gastroenterology")
        self.assertEqual(params[9], "correct")
        self.assertEqual(params[12], "content-manager")
        self.assertEqual(params[13], "Reviewed direction correction.")
        self.assertEqual(len(params[10]), 64)

    def test_correction_rejects_predecessor_not_matching_persisted_batch_item(self):
        item = replace(
            approval_item(41),
            final_direction_code="gastroenterology",
            decision_reason="reviewed correction",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                701,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
            evidence_by_entity={
                41: {"current_canonical": {"event_id": 700}}
            },
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        self.assertEqual(raised.exception.code, "CORRECTION_PREDECESSOR_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

    def test_unchanged_locked_classification_is_item_noop_without_duplicate_event(self):
        item = approval_item(41)
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
        )

        result = ingest_accepted_batch(
            accepted_snapshot(item), repository_for(connection)
        )

        self.assertEqual(result.status, "ingested")
        self.assertEqual(result.accepted_count, 1)
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.commit_count, 1)

    def test_same_ingested_hash_replays_as_noop_after_taxonomy_retirement(self):
        items = (
            approval_item(41),
            approval_item(42, readiness="conflict"),
            replace(
                approval_item(43, readiness="unresolved"),
                final_direction_code=None,
                final_material_type_code=None,
            ),
        )
        connection = Task7Connection(items=items, status="ingested")

        result = ingest_accepted_batch(
            accepted_snapshot(*items), repository_for(connection)
        )

        batch_lock_sql = next(
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_approval_batches AS batch" in sql
        )
        self.assertIn("batch.batch_status = 'ingested'", batch_lock_sql)
        taxonomy_terms_sql = next(
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_taxonomy_terms" in sql
        )
        self.assertNotIn("term_status", taxonomy_terms_sql)
        self.assertEqual(result.status, "noop")
        self.assertEqual(result.accepted_count, 1)
        self.assertEqual(result.conflict_count, 1)
        self.assertEqual(result.unresolved_count, 1)
        self.assertEqual(event_calls(connection), [])

    def test_changed_hash_is_rejected_for_already_ingested_batch(self):
        canonical = approval_item(41)
        changed = replace(canonical, final_direction_code="gastroenterology")
        connection = Task7Connection(items=(canonical,), status="ingested")

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(
                accepted_snapshot(changed), repository_for(connection)
            )

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(event_calls(connection), [])

    def test_partial_event_failure_rolls_back_without_batch_transition(self):
        items = (approval_item(41), approval_item(42))
        connection = Task7Connection(
            items=items,
            predecessor_event_row=None,
            fail_on_event_insert=2,
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(
                accepted_snapshot(*items), repository_for(connection)
            )

        self.assertEqual(raised.exception.code, "DB_TRANSACTION_FAILED")
        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)
        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_content_approval_batches")
                for sql, _ in connection.calls
            )
        )

    def test_archive_candidate_requires_canonical_override_or_404_410_evidence(self):
        evidence_cases = (
            (
                {"archive_attestation": {"explicit_archive_override": True}},
                "explicit override",
            ),
            ({"archive_attestation": {"evidence_code": "HTTP_404"}}, "404"),
            ({"archive_attestation": {"evidence_code": "HTTP_410"}}, "410"),
        )
        for evidence, label in evidence_cases:
            with self.subTest(label=label):
                item = replace(
                    approval_item(41), final_lifecycle_code="archive_candidate"
                )
                connection = Task7Connection(
                    items=(item,), evidence_by_entity={41: evidence}
                )

                result = ingest_accepted_batch(
                    accepted_snapshot(item), repository_for(connection)
                )

                self.assertEqual(result.status, "ingested")
                self.assertEqual(event_calls(connection)[0][1][8], "archive_candidate")

    def test_archive_candidate_rejects_http_500_or_missing_evidence(self):
        for evidence in (
            {},
            {"archive_attestation": {"evidence_code": "HTTP_500"}},
        ):
            with self.subTest(evidence=evidence):
                item = replace(
                    approval_item(41), final_lifecycle_code="archive_candidate"
                )
                connection = Task7Connection(
                    items=(item,), evidence_by_entity={41: evidence}
                )

                with self.assertRaises(RepositoryError) as raised:
                    ingest_accepted_batch(
                        accepted_snapshot(item), repository_for(connection)
                    )

                self.assertEqual(raised.exception.code, "ARCHIVE_EVIDENCE_REQUIRED")
                self.assertEqual(event_calls(connection), [])

    def test_archive_candidate_does_not_treat_arbitrary_metadata_as_evidence_code(self):
        item = replace(
            approval_item(41), final_lifecycle_code="archive_candidate"
        )
        untrusted_values = (
            {"current_canonical": {"title": "HTTP_404"}},
            {"terra": {"evidence": ["HTTP_410"]}},
            {"registry1": {"explicit_archive_override": True}},
        )
        for evidence in untrusted_values:
            with self.subTest(evidence=evidence):
                connection = Task7Connection(
                    items=(item,), evidence_by_entity={41: evidence}
                )

                with self.assertRaises(RepositoryError) as raised:
                    ingest_accepted_batch(
                        accepted_snapshot(item), repository_for(connection)
                    )

                self.assertEqual(
                    raised.exception.code, "ARCHIVE_EVIDENCE_REQUIRED"
                )
                self.assertEqual(event_calls(connection), [])

    def test_material_type_archive_and_out_of_taxonomy_codes_never_ingest(self):
        cases = (
            ("Архив", "ARCHIVE_TYPE_INVALID"),
            ("invented_type", "TAXONOMY_CONTRACT_MISMATCH"),
        )
        for material_type, error_code in cases:
            with self.subTest(material_type=material_type):
                item = replace(
                    approval_item(41), final_material_type_code=material_type
                )
                connection = Task7Connection(items=(item,))

                with self.assertRaises(RepositoryError) as raised:
                    ingest_accepted_batch(
                        accepted_snapshot(item), repository_for(connection)
                    )

                self.assertEqual(raised.exception.code, error_code)
                self.assertEqual(event_calls(connection), [])

    def test_archive_material_type_is_rejected_even_if_malformed_taxonomy_allows_it(self):
        item = replace(approval_item(41), final_material_type_code="Архив")
        connection = Task7Connection(items=(item,))
        terms = {
            kind: tuple(codes)
            for kind, codes in connection.taxonomy.terms.items()
        }
        terms["material_type"] = (*terms["material_type"], "Архив")
        digest = compute_taxonomy_digest(connection.taxonomy.version, terms)
        connection.taxonomy = TaxonomyVersion(
            version=connection.taxonomy.version,
            terms=terms,
            digest=digest,
        )
        batch_row = list(connection.batch_row)
        batch_row[3] = digest
        batch_row[5] = digest
        connection.batch_row = tuple(batch_row)

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        self.assertEqual(raised.exception.code, "ARCHIVE_TYPE_INVALID")
        self.assertEqual(event_calls(connection), [])

    def test_ingestion_never_updates_or_deletes_predecessor_events(self):
        item = replace(
            approval_item(41),
            final_direction_code="gastroenterology",
            decision_reason="reviewed correction",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
            evidence_by_entity={
                41: {"current_canonical": {"event_id": 700}}
            },
        )

        ingest_accepted_batch(accepted_snapshot(item), repository_for(connection))

        event_mutations = [
            sql
            for sql, _ in connection.calls
            if sql.startswith(("UPDATE ", "DELETE "))
            and "portal_content_classification_events" in sql
        ]
        self.assertEqual(event_mutations, [])


if __name__ == "__main__":
    unittest.main()
