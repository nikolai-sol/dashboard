"""Deterministic approval-batch construction and persistence tests."""

from __future__ import annotations

from dataclasses import replace
import unittest

from agents.abbott_page_classifier.batch_service import (
    ApprovalBatchItem,
    build_batch,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_taxonomy_digest,
    persist_batch,
)
from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    CanonicalClassification,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MaterialCandidate,
    MATERIAL_TYPE_CODES,
    Proposal,
    TaxonomyVersion,
)
from agents.abbott_page_classifier.reconcile import ReconciliationInput


def candidate(source: str, row: str, *, direction: str) -> MaterialCandidate:
    return MaterialCandidate(
        source_name=source,
        source_row_id=row,
        title="Line one\r\nLine two",
        url=f"https://example.test/{row}",
        material_id=row,
        direction_code=direction,
        material_type_code="articles",
        access_code="doctors",
        lifecycle_code="active",
        source_fingerprint=(row * 64)[:64],
    )


def reconciliation(entity_id: int, readiness_hint: str = "ready") -> ReconciliationInput:
    active = None
    if readiness_hint == "no_change":
        active = CanonicalClassification(
            content_entity_id=entity_id,
            title="Stable",
            url=f"https://example.test/{entity_id}",
            direction_code="cardiology",
            material_type_code="articles",
            access_code="doctors",
            lifecycle_code="active",
            event_id=entity_id + 100,
        )
    deterministic = Proposal(
        direction_code="cardiology",
        material_type_code="articles",
        access_code="doctors",
        lifecycle_code="active",
        rule_code="path\r\nrule",
        confidence=0.91,
        evidence=("path\r\nmatch",),
    )
    return ReconciliationInput(
        content_entity_id=entity_id,
        active_canonical=active,
        registry1=None if active else candidate("registry1", str(entity_id), direction="cardiology"),
        registry2=None,
        deterministic_proposal=None if active else deterministic,
        llm_proposal=None if active else replace(deterministic, rule_code="terra"),
        verifier_proposal=None if active else replace(deterministic, rule_code="sol"),
    )


def taxonomy(*, extra_direction: str | None = None) -> TaxonomyVersion:
    directions = tuple(sorted(DIRECTION_CODES | ({extra_direction} if extra_direction else set())))
    terms = {
        "direction": directions,
        "material_type": tuple(sorted(MATERIAL_TYPE_CODES)),
        "access": tuple(sorted(ACCESS_CODES)),
        "lifecycle": tuple(sorted(LIFECYCLE_CODES)),
    }
    return TaxonomyVersion(
        version="abbott.v1",
        terms=terms,
        digest=compute_taxonomy_digest("abbott.v1", terms),
    )


def built(inputs, taxonomy_version: TaxonomyVersion | None = None):
    return build_batch(
        inputs,
        taxonomy_version or taxonomy(),
        "prompt.v1",
        source_snapshot_ids=(101, 202),
        source_snapshot_digests=("a" * 64, "b" * 64),
        model_routing_version="routing.v1",
    )


class RecordingRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def persist_draft_batch(self, batch):
        self.calls.append(("persist_draft_batch", batch))
        return 73


class BatchServiceTests(unittest.TestCase):
    def test_batch_hash_orders_by_entity_then_input_and_normalizes_newlines(self):
        first = built([reconciliation(20), reconciliation(10)])
        second = built([reconciliation(10), reconciliation(20)])

        self.assertEqual([item.content_entity_id for item in first.items], [10, 20])
        self.assertEqual(first.published_input_hash, second.published_input_hash)
        self.assertEqual(first.published_input_hash, compute_batch_hash(first.items))

        crlf_item = replace(first.items[0], title="same\r\ntext")
        lf_item = replace(first.items[0], title="same\ntext")
        self.assertEqual(compute_batch_hash((crlf_item,)), compute_batch_hash((lf_item,)))

    def test_unresolved_identity_uses_null_entity_then_input_hash_order(self):
        unresolved = replace(
            built([reconciliation(20)]).items[0],
            content_entity_id=None,
            input_hash="f" * 64,
        )
        resolved = built([reconciliation(10)]).items[0]

        ordered = built((resolved, unresolved)).items

        self.assertIsNone(ordered[0].content_entity_id)

    def test_build_batch_binds_every_source_model_decision_and_hash_field(self):
        approval_batch = built([reconciliation(41)])

        item = approval_batch.items[0]
        self.assertIsInstance(item, ApprovalBatchItem)
        self.assertIsNotNone(item.registry1_values)
        self.assertIsNone(item.registry2_values)
        self.assertEqual(item.deterministic_result["rule_code"], "path\nrule")
        self.assertEqual(item.terra_result["rule_code"], "terra")
        self.assertEqual(item.sol_result["rule_code"], "sol")
        self.assertTrue(item.concise_evidence)
        self.assertEqual(len(item.input_hash), 64)
        self.assertEqual(len(item.row_hash), 64)

    def test_batch_hash_covers_all_readiness_states_and_row_hash(self):
        approval_batch = built([reconciliation(41)])
        item = approval_batch.items[0]

        state_hashes = {
            compute_batch_hash((replace(item, readiness_state=state),))
            for state in ("ready", "conflict", "unresolved", "rejected", "no_change")
        }
        self.assertEqual(len(state_hashes), 5)
        self.assertNotEqual(
            compute_batch_hash((item,)),
            compute_batch_hash((replace(item, row_hash="f" * 64),)),
        )

    def test_accepted_hash_changes_only_for_editable_decision_content(self):
        item = built([reconciliation(41)]).items[0]
        changed = replace(item, final_direction_code="gastroenterology")
        changed_reason = replace(item, decision_reason="Reviewed\r\nreason")
        normalized_reason = replace(item, decision_reason="Reviewed\nreason")

        self.assertNotEqual(
            compute_accepted_decision_hash((item,)),
            compute_accepted_decision_hash((changed,)),
        )
        self.assertEqual(
            compute_accepted_decision_hash((changed_reason,)),
            compute_accepted_decision_hash((normalized_reason,)),
        )

    def test_persist_batch_delegates_one_atomic_draft_transaction(self):
        batch = built([reconciliation(41)])
        repository = RecordingRepository()

        persisted = persist_batch(batch, repository)

        self.assertEqual(repository.calls, [("persist_draft_batch", batch)])
        self.assertEqual(persisted.database_batch_id, 73)
        self.assertEqual(persisted.batch, batch)

    def test_build_batch_can_rebind_already_enriched_items_deterministically(self):
        first = built([reconciliation(41)])

        rebuilt = built(first.items)

        self.assertEqual(rebuilt.items, first.items)
        self.assertEqual(rebuilt.published_input_hash, first.published_input_hash)

    def test_taxonomy_terms_digest_and_workflow_provenance_are_bound_into_hashes(self):
        canonical = built([reconciliation(41)])
        invented = built(
            [reconciliation(41)],
            taxonomy(extra_direction="invented_direction"),
        )

        self.assertEqual(len(canonical.taxonomy_digest), 64)
        self.assertEqual(canonical.source_snapshot_ids, (101, 202))
        self.assertEqual(canonical.source_snapshot_digests, ("a" * 64, "b" * 64))
        self.assertEqual(canonical.model_routing_version, "routing.v1")
        self.assertNotEqual(canonical.taxonomy_digest, invented.taxonomy_digest)
        self.assertNotEqual(canonical.items[0].row_hash, invented.items[0].row_hash)
        self.assertNotEqual(canonical.published_input_hash, invented.published_input_hash)

    def test_build_rejects_incomplete_taxonomy_and_missing_audit_provenance(self):
        with self.assertRaisesRegex(ValueError, "TAXONOMY_TERMS_INCOMPLETE"):
            build_batch(
                [reconciliation(41)],
                TaxonomyVersion(version="abbott.v1", terms={"direction": ("cardiology",)}),
                "prompt.v1",
                source_snapshot_ids=(101,),
                source_snapshot_digests=("a" * 64,),
                model_routing_version="routing.v1",
            )

        complete_terms = taxonomy().terms
        with self.assertRaisesRegex(ValueError, "TAXONOMY_DIGEST_REQUIRED"):
            build_batch(
                [reconciliation(41)],
                TaxonomyVersion(version="abbott.v1", terms=complete_terms),
                "prompt.v1",
                source_snapshot_ids=(101,),
                source_snapshot_digests=("a" * 64,),
                model_routing_version="routing.v1",
            )

        with self.assertRaisesRegex(ValueError, "SOURCE_SNAPSHOTS_REQUIRED"):
            build_batch(
                [reconciliation(41)],
                taxonomy(),
                "prompt.v1",
                source_snapshot_ids=(),
                source_snapshot_digests=(),
                model_routing_version="routing.v1",
            )

        with self.assertRaisesRegex(ValueError, "SOURCE_SNAPSHOTS_REQUIRED"):
            build_batch(
                [reconciliation(41)],
                taxonomy(),
                "prompt.v1",
                source_snapshot_ids=(101,),
                source_snapshot_digests=("not-a-sha256".ljust(64, "z"),),
                model_routing_version="routing.v1",
            )


if __name__ == "__main__":
    unittest.main()
