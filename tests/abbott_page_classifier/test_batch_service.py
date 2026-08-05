"""Deterministic approval-batch construction and persistence tests."""

from __future__ import annotations

from dataclasses import replace
import unittest

from agents.abbott_page_classifier.batch_service import (
    ApprovalBatchItem,
    build_batch,
    compute_accepted_decision_hash,
    compute_batch_hash,
    persist_batch,
)
from agents.abbott_page_classifier.domain import (
    CanonicalClassification,
    MaterialCandidate,
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


class RecordingRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def create_batch(self, batch):
        self.calls.append(("create_batch", batch))
        return 73

    def insert_items(self, batch_id, items):
        self.calls.append(("insert_items", (batch_id, tuple(items))))


class BatchServiceTests(unittest.TestCase):
    def test_batch_hash_orders_by_entity_then_input_and_normalizes_newlines(self):
        taxonomy = TaxonomyVersion(version="abbott.v1")
        first = build_batch(
            [reconciliation(20), reconciliation(10)], taxonomy, "prompt.v1"
        )
        second = build_batch(
            [reconciliation(10), reconciliation(20)], taxonomy, "prompt.v1"
        )

        self.assertEqual([item.content_entity_id for item in first.items], [10, 20])
        self.assertEqual(first.published_input_hash, second.published_input_hash)
        self.assertEqual(first.published_input_hash, compute_batch_hash(first.items))

        crlf_item = replace(first.items[0], title="same\r\ntext")
        lf_item = replace(first.items[0], title="same\ntext")
        self.assertEqual(compute_batch_hash((crlf_item,)), compute_batch_hash((lf_item,)))

    def test_unresolved_identity_uses_null_entity_then_input_hash_order(self):
        unresolved = replace(
            build_batch(
                [reconciliation(20)], TaxonomyVersion(version="abbott.v1"), "prompt.v1"
            ).items[0],
            content_entity_id=None,
            input_hash="f" * 64,
        )
        resolved = build_batch(
            [reconciliation(10)], TaxonomyVersion(version="abbott.v1"), "prompt.v1"
        ).items[0]

        ordered = build_batch(
            (resolved, unresolved),
            TaxonomyVersion(version="abbott.v1"),
            "prompt.v1",
        ).items

        self.assertIsNone(ordered[0].content_entity_id)

    def test_build_batch_binds_every_source_model_decision_and_hash_field(self):
        taxonomy = TaxonomyVersion(version="abbott.v1")
        built = build_batch([reconciliation(41)], taxonomy, "prompt.v1")

        item = built.items[0]
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
        taxonomy = TaxonomyVersion(version="abbott.v1")
        built = build_batch([reconciliation(41)], taxonomy, "prompt.v1")
        item = built.items[0]

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
        item = build_batch(
            [reconciliation(41)], TaxonomyVersion(version="abbott.v1"), "prompt.v1"
        ).items[0]
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

    def test_persist_batch_stores_canonical_batch_before_all_items(self):
        batch = build_batch(
            [reconciliation(41)], TaxonomyVersion(version="abbott.v1"), "prompt.v1"
        )
        repository = RecordingRepository()

        persisted = persist_batch(batch, repository)

        self.assertEqual([name for name, _ in repository.calls], ["create_batch", "insert_items"])
        self.assertEqual(repository.calls[1][1][0], 73)
        self.assertEqual(repository.calls[1][1][1], batch.items)
        self.assertEqual(persisted.database_batch_id, 73)
        self.assertEqual(persisted.batch, batch)

    def test_build_batch_can_rebind_already_enriched_items_deterministically(self):
        taxonomy = TaxonomyVersion(version="abbott.v1")
        first = build_batch([reconciliation(41)], taxonomy, "prompt.v1")

        rebuilt = build_batch(first.items, taxonomy, "prompt.v1")

        self.assertEqual(rebuilt.items, first.items)
        self.assertEqual(rebuilt.published_input_hash, first.published_input_hash)


if __name__ == "__main__":
    unittest.main()
