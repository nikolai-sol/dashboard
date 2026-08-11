"""Task 7 approval ingestion and append-only correction contracts."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
import json
import unittest

from agents.abbott_page_classifier.batch_service import (
    ApprovalBatchItem,
    CLASSIFICATION_EVENT_KINDS,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_item_hash,
    compute_taxonomy_digest,
    ingest_accepted_batch,
)
from agents.abbott_page_classifier.domain import (
    AcceptedBatchSnapshot,
    IngestResult,
    TaxonomyVersion,
)
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
            if predecessor is not None and len(predecessor) == 5:
                predecessor = (*predecessor, datetime(2026, 8, 5, 12, 0))
            self.rows = [predecessor] if predecessor is not None else []
        if "FROM portal_content_registry_aliases" in normalized:
            self.rows = [
                (
                    alias["id"],
                    alias["content_entity_id"],
                    alias["alias_type"],
                    alias["alias_status"],
                )
                for alias in self.connection.aliases
                if alias["alias_hash"] == params[1]
                and alias["uniqueness_scope"] == "strong"
            ]
        if normalized.startswith("UPDATE portal_content_registry_aliases"):
            alias_id = int(params[1])
            for alias in self.connection.aliases:
                if alias["id"] == alias_id and alias["alias_status"] == "active":
                    alias["alias_status"] = "retired"
                    alias["source_evidence"] = json.loads(params[0])
                    self.rowcount = 1
                    break
            else:
                self.rowcount = 0
        if normalized.startswith("INSERT INTO portal_content_registry_aliases"):
            self.connection.aliases.append(
                {
                    "id": 900 + len(self.connection.aliases),
                    "content_entity_id": int(params[1]),
                    "alias_type": "url",
                    "alias_hash": str(params[3]),
                    "uniqueness_scope": "strong",
                    "alias_status": "active",
                    "source_evidence": json.loads(params[4]),
                }
            )


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
        self.aliases: list[dict[str, object]] = []
        evidence_by_entity = evidence_by_entity or {}
        audited_items: list[ApprovalBatchItem] = []
        for item in self.ingest_items:
            overrides = evidence_by_entity.get(item.content_entity_id, {})
            audited = replace(
                item,
                archive_attestation=overrides.get(
                    "archive_attestation", item.archive_attestation
                ),
                concise_evidence=tuple(
                    overrides.get("concise_evidence", item.concise_evidence)
                ),
                current_canonical=overrides.get(
                    "current_canonical", item.current_canonical
                ),
                deterministic_result=overrides.get(
                    "deterministic", item.deterministic_result
                ),
                registry1_values=overrides.get("registry1", item.registry1_values),
                registry2_values=overrides.get("registry2", item.registry2_values),
                sol_result=overrides.get("sol", item.sol_result),
                terra_result=overrides.get("terra", item.terra_result),
                row_hash="",
            )
            audited_items.append(replace(audited, row_hash=compute_item_hash(audited)))
        self.ingest_items = tuple(audited_items)
        self.ingest_rows = [
            (
                101 + index,
                item.content_entity_id,
                item.input_hash,
                item.title,
                item.url,
                item.final_direction_code,
                item.final_material_type_code,
                item.final_access_code,
                item.final_lifecycle_code,
                item.readiness_state,
                item.row_hash,
                item.decision_reason,
                ContentRegistryRepository._json(item.proposal_evidence),
                json.dumps(
                    [
                        code.value if hasattr(code, "value") else str(code)
                        for code in item.conflict_codes
                    ]
                ),
                (
                    item.conflict_codes[0].value
                    if item.conflict_codes
                    and hasattr(item.conflict_codes[0], "value")
                    else (str(item.conflict_codes[0]) if item.conflict_codes else None)
                ),
                item.selected_content_entity_id,
                item.url_alias_decision,
            )
            for index, item in enumerate(self.ingest_items)
        ]
        batch_row = list(self.batch_row)
        batch_row[6] = compute_batch_hash(self.ingest_items)
        batch_row[7] = compute_accepted_decision_hash(self.ingest_items)
        self.batch_row = tuple(batch_row)
        self.cursor_instance = Task7Cursor(self)

    def snapshot(self, *overrides, accepted_at="2026-08-05T14:30:00+02:00"):
        items = list(self.ingest_items)
        for supplied in overrides:
            index = next(
                index
                for index, item in enumerate(items)
                if item.content_entity_id == supplied.content_entity_id
                and item.input_hash == supplied.input_hash
            )
            canonical = items[index]
            items[index] = replace(
                canonical,
                final_direction_code=supplied.final_direction_code,
                final_material_type_code=supplied.final_material_type_code,
                final_access_code=supplied.final_access_code,
                final_lifecycle_code=supplied.final_lifecycle_code,
                decision_reason=supplied.decision_reason,
            )
        accepted_count = sum(
            1 for item in items if item.readiness_state == "ready"
        )
        return AcceptedBatchSnapshot(
            batch_key="abbott-2026-08-05",
            published_input_hash=str(self.batch_row[6]),
            accepted_decision_hash=compute_accepted_decision_hash(items),
            items=tuple(items),
            accepted_by="content-manager",
            accepted_at=accepted_at,
            accepted_count=accepted_count,
            skipped_count=len(items) - accepted_count,
        )

    def rebind_taxonomy(self, taxonomy):
        rebound_items = []
        for item in self.ingest_items:
            rebound = replace(
                item,
                taxonomy_digest=taxonomy.digest,
                taxonomy_terms=taxonomy.terms,
                row_hash="",
            )
            rebound_items.append(
                replace(rebound, row_hash=compute_item_hash(rebound))
            )
        self.taxonomy = taxonomy
        self.ingest_items = tuple(rebound_items)
        rows = []
        for row, item in zip(self.ingest_rows, self.ingest_items):
            rows.append(
                (
                    *row[:10],
                    item.row_hash,
                    row[11],
                    ContentRegistryRepository._json(item.proposal_evidence),
                    *row[13:],
                )
            )
        self.ingest_rows = rows
        batch_row = list(self.batch_row)
        batch_row[3] = taxonomy.digest
        batch_row[5] = taxonomy.digest
        batch_row[6] = compute_batch_hash(self.ingest_items)
        batch_row[7] = compute_accepted_decision_hash(self.ingest_items)
        self.batch_row = tuple(batch_row)


def repository_for(connection: Task7Connection) -> ContentRegistryRepository:
    return ContentRegistryRepository(lambda: connection)


def event_calls(connection: Task7Connection):
    return [
        call
        for call in connection.calls
        if call[0].startswith("INSERT INTO portal_content_classification_events")
    ]


def reviewed_canonical_evidence(
    *,
    event_id=700,
    entity_id=41,
    direction="cardiology",
    material_type="articles",
    access="doctors",
    lifecycle="active",
):
    return {
        "current_canonical": {
            "content_entity_id": entity_id,
            "direction_code": direction,
            "material_type_code": material_type,
            "access_code": access,
            "lifecycle_code": lifecycle,
            "event_id": event_id,
        }
    }


class ApprovalIngestionTests(unittest.TestCase):
    def test_ingestion_never_mutates_aliases_after_acceptance(self):
        item = replace(
            approval_item(41, readiness="conflict"),
            conflict_codes=("IDENTITY_COLLISION",),
            selected_content_entity_id=41,
            url_alias_decision="attach",
            decision_reason="reviewed URL owner",
        )
        connection = Task7Connection(items=(item,))
        result = ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(result.status, "ingested")
        self.assertFalse(connection.aliases)
        self.assertFalse(any("portal_content_registry_aliases" in sql for sql, _ in connection.calls))
        self.assertFalse(any("portal_content_url_alias_decision_events" in sql for sql, _ in connection.calls))

    def test_ingestion_does_not_recheck_or_reject_previously_accepted_aliases(self):
        item = replace(
            approval_item(41, readiness="conflict"),
            conflict_codes=("IDENTITY_COLLISION",),
            selected_content_entity_id=41,
            url_alias_decision="attach",
            decision_reason="reviewed URL owner",
        )
        connection = Task7Connection(items=(item,))
        connection.aliases.append(
            {
                "id": 801,
                "content_entity_id": 99,
                "alias_type": "url",
                "alias_hash": __import__("hashlib").sha256(item.url.casefold().encode()).hexdigest(),
                "uniqueness_scope": "strong",
                "alias_status": "active",
                "source_evidence": {},
            }
        )

        result = ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(result.status, "ingested")
        self.assertEqual(connection.aliases[0]["alias_status"], "active")

    def test_ingestion_does_not_retire_aliases(self):
        item = replace(
            approval_item(41, readiness="conflict"),
            conflict_codes=("IDENTITY_COLLISION",),
            url_alias_decision="retire",
            decision_reason="reviewed stale URL",
        )
        connection = Task7Connection(items=(item,))
        connection.aliases.append(
            {
                "id": 801,
                "content_entity_id": 41,
                "alias_type": "url",
                "alias_hash": __import__("hashlib").sha256(item.url.casefold().encode()).hexdigest(),
                "uniqueness_scope": "strong",
                "alias_status": "active",
                "source_evidence": {"authority": "old"},
            }
        )

        result = ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(result.status, "ingested")
        self.assertEqual(connection.aliases[0]["alias_status"], "active")
        self.assertEqual(connection.aliases[0]["source_evidence"], {"authority": "old"})
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
            connection.snapshot(), repository_for(connection)
        )

        self.assertEqual(result.status, "ingested")
        self.assertEqual(result.accepted_count, 1)
        self.assertEqual(event_calls(connection)[0][1][9], "approve")

    def test_entity_row_is_locked_before_latest_predecessor_is_selected(self):
        item = approval_item(41)
        connection = Task7Connection(items=(item,), predecessor_event_row=None)

        ingest_accepted_batch(connection.snapshot(), repository_for(connection))

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
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

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
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

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
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )

        result = ingest_accepted_batch(
            connection.snapshot(), repository_for(connection)
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

    def test_accepted_edit_uses_original_published_row_hash_and_appends_correction(self):
        published_item = approval_item(41)
        connection = Task7Connection(
            items=(published_item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
            ),
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )
        accepted_item = replace(
            connection.ingest_items[0],
            final_direction_code="gastroenterology",
            decision_reason="manager accepted edit",
        )
        row = connection.ingest_rows[0]
        connection.ingest_rows[0] = (
            *row[:5],
            accepted_item.final_direction_code,
            accepted_item.final_material_type_code,
            accepted_item.final_access_code,
            accepted_item.final_lifecycle_code,
            row[9],
            row[10],
            accepted_item.decision_reason,
            row[12],
            *row[13:],
        )
        batch_row = list(connection.batch_row)
        batch_row[7] = compute_accepted_decision_hash((accepted_item,))
        connection.batch_row = tuple(batch_row)
        snapshot = replace(
            connection.snapshot(),
            items=(accepted_item,),
            accepted_decision_hash=compute_accepted_decision_hash((accepted_item,)),
        )

        result = ingest_accepted_batch(snapshot, repository_for(connection))

        self.assertEqual(result.status, "ingested")
        event = event_calls(connection)[0][1]
        self.assertEqual(event[5], "gastroenterology")
        self.assertEqual(event[9], "correct")
        published_evidence = json.loads(row[12])
        self.assertEqual(
            published_evidence["published_decision"]["final_direction_code"],
            "cardiology",
        )

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
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(raised.exception.code, "CORRECTION_PREDECESSOR_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

    def test_same_direction_successor_rejects_stale_reviewed_predecessor(self):
        item = replace(
            approval_item(41),
            final_material_type_code="video",
            decision_reason="reviewed type change",
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
                41: {
                    "current_canonical": {
                        "content_entity_id": 41,
                        "direction_code": "cardiology",
                        "material_type_code": "articles",
                        "access_code": "doctors",
                        "lifecycle_code": "active",
                        "event_id": 700,
                    }
                }
            },
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(raised.exception.code, "CORRECTION_PREDECESSOR_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

    def test_successor_rejects_accepted_at_before_latest_predecessor(self):
        item = replace(
            approval_item(41),
            final_material_type_code="video",
            decision_reason="reviewed type change",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "active",
                datetime(2026, 8, 5, 12, 30),
            ),
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )
        batch_row = list(connection.batch_row)
        batch_row[10] = "2026-08-05T12:29:59Z"
        connection.batch_row = tuple(batch_row)

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(
                connection.snapshot(accepted_at="2026-08-05T12:29:59Z"),
                repository_for(connection),
            )

        self.assertEqual(raised.exception.code, "SUCCESSOR_EFFECTIVE_AT_INVALID")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.commit_count, 0)
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
            connection.snapshot(), repository_for(connection)
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
            connection.snapshot(), repository_for(connection)
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
                connection.snapshot(changed), repository_for(connection)
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
                connection.snapshot(), repository_for(connection)
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
                    connection.snapshot(), repository_for(connection)
                )

                self.assertEqual(result.status, "ingested")
                self.assertEqual(event_calls(connection)[0][1][8], "archive_candidate")

    def test_existing_archive_candidate_can_receive_metadata_without_new_archive_evidence(self):
        item = replace(
            approval_item(41),
            final_direction_code="gastroenterology",
            final_lifecycle_code="archive_candidate",
        )
        connection = Task7Connection(
            items=(item,),
            predecessor_event_row=(
                700,
                "cardiology",
                "articles",
                "doctors",
                "archive_candidate",
            ),
            evidence_by_entity={
                41: reviewed_canonical_evidence(lifecycle="archive_candidate")
            },
        )

        result = ingest_accepted_batch(
            connection.snapshot(), repository_for(connection)
        )

        self.assertEqual(result.status, "ingested")
        self.assertEqual(event_calls(connection)[0][1][8], "archive_candidate")

    def test_tampered_hash_bound_evidence_fails_before_writes(self):
        cases = (
            (
                replace(
                    approval_item(41), final_lifecycle_code="archive_candidate"
                ),
                {
                    "archive_attestation": {
                        "explicit_archive_override": True,
                        "evidence_code": None,
                    }
                },
                lambda evidence: evidence["archive_attestation"].update(
                    explicit_archive_override=False
                ),
                None,
            ),
            (
                replace(
                    approval_item(41), final_lifecycle_code="archive_candidate"
                ),
                {
                    "archive_attestation": {
                        "explicit_archive_override": False,
                        "evidence_code": "HTTP_404",
                    }
                },
                lambda evidence: evidence["archive_attestation"].update(
                    evidence_code="HTTP_410"
                ),
                None,
            ),
            (
                replace(approval_item(41), final_material_type_code="video"),
                reviewed_canonical_evidence(),
                lambda evidence: evidence["current_canonical"].update(event_id=701),
                (700, "cardiology", "articles", "doctors", "active"),
            ),
        )
        for item, bound_evidence, tamper, predecessor in cases:
            with self.subTest(bound_evidence=bound_evidence):
                connection = Task7Connection(
                    items=(item,),
                    evidence_by_entity={41: bound_evidence},
                    predecessor_event_row=predecessor,
                )
                row = connection.ingest_rows[0]
                evidence = json.loads(row[12])
                tamper(evidence)
                connection.ingest_rows[0] = (
                    *row[:12],
                    json.dumps(evidence),
                    *row[13:],
                )

                with self.assertRaises(RepositoryError) as raised:
                    ingest_accepted_batch(
                        connection.snapshot(), repository_for(connection)
                    )

                self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
                self.assertEqual(event_calls(connection), [])
                self.assertEqual(connection.commit_count, 0)
                self.assertEqual(connection.rollback_count, 1)

    def test_rehashed_tampered_item_still_fails_published_batch_hash(self):
        item = replace(
            approval_item(41), final_lifecycle_code="archive_candidate"
        )
        connection = Task7Connection(
            items=(item,),
            evidence_by_entity={
                41: {
                    "archive_attestation": {
                        "explicit_archive_override": True,
                        "evidence_code": None,
                    }
                }
            },
        )
        original = connection.ingest_items[0]
        changed = replace(
            original,
            archive_attestation={
                "explicit_archive_override": False,
                "evidence_code": "HTTP_404",
            },
            row_hash="",
        )
        changed = replace(changed, row_hash=compute_item_hash(changed))
        row = connection.ingest_rows[0]
        connection.ingest_rows[0] = (
            *row[:10],
            changed.row_hash,
            row[11],
            ContentRegistryRepository._json(changed.proposal_evidence),
            *row[13:],
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

    def test_tampered_nonready_item_evidence_also_fails_before_any_event(self):
        items = (
            approval_item(41),
            approval_item(42, readiness="conflict"),
        )
        connection = Task7Connection(items=items)
        row = connection.ingest_rows[1]
        evidence = json.loads(row[12])
        evidence["terra"] = {"direction_code": "gastroenterology"}
        connection.ingest_rows[1] = (
            *row[:12],
            json.dumps(evidence),
            *row[13:],
        )

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

        batch_lock_sql = next(
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_approval_batches AS batch" in sql
        )
        self.assertIn("batch.source_snapshot_ids", batch_lock_sql)
        self.assertIn("batch.model_routing_version", batch_lock_sql)
        item_lock_sql = next(
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_approval_items" in sql
            and "proposal_evidence" in sql
        )
        self.assertIn("conflict_codes", item_lock_sql)

    def test_tampered_derived_conflict_code_fails_complete_item_attestation(self):
        item = approval_item(42, readiness="conflict")
        connection = Task7Connection(items=(item,))
        row = connection.ingest_rows[0]
        connection.ingest_rows[0] = (*row[:14], "ACCESS_CONFLICT")

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        self.assertEqual(raised.exception.code, "BATCH_ITEMS_MISMATCH")
        self.assertEqual(event_calls(connection), [])
        self.assertEqual(connection.rollback_count, 1)

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
                        connection.snapshot(), repository_for(connection)
                    )

                self.assertEqual(raised.exception.code, "ARCHIVE_EVIDENCE_REQUIRED")
                self.assertEqual(event_calls(connection), [])

    def test_archive_candidate_does_not_treat_arbitrary_metadata_as_evidence_code(self):
        item = replace(
            approval_item(41), final_lifecycle_code="archive_candidate"
        )
        untrusted_values = (
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
                        connection.snapshot(), repository_for(connection)
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
                        connection.snapshot(), repository_for(connection)
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
        taxonomy = TaxonomyVersion(
            version=connection.taxonomy.version,
            terms=terms,
            digest=digest,
        )
        connection.rebind_taxonomy(taxonomy)

        with self.assertRaises(RepositoryError) as raised:
            ingest_accepted_batch(connection.snapshot(), repository_for(connection))

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
            evidence_by_entity={41: reviewed_canonical_evidence()},
        )

        ingest_accepted_batch(connection.snapshot(), repository_for(connection))

        event_mutations = [
            sql
            for sql, _ in connection.calls
            if sql.startswith(("UPDATE ", "DELETE "))
            and "portal_content_classification_events" in sql
        ]
        self.assertEqual(event_mutations, [])


if __name__ == "__main__":
    unittest.main()
