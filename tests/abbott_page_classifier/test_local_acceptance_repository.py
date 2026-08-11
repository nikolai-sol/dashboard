"""Local owner acceptance creates observed pages atomically."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
import unittest

from agents.abbott_page_classifier.approval_hashes import compute_accepted_decision_hash
from agents.abbott_page_classifier.domain import ConflictCode
from agents.abbott_page_classifier.local_acceptance import LocalAcceptanceIntent, LocalDecision
from agents.abbott_page_classifier.repository import ContentRegistryRepository
from tests.abbott_page_classifier.test_repository import (
    StatefulAcceptanceConnection,
    acceptance_workflow_batch,
)


def create_item():
    return replace(
        acceptance_workflow_batch().items[1],
        content_entity_id=None,
        input_hash="c" * 64,
        row_hash="d" * 64,
        title="Observed page",
        url="https://www.abbottpro.ru/articles/observed-page",
        readiness_state="conflict",
        conflict_codes=(ConflictCode.IDENTITY_COLLISION,),
    )


class LocalAcceptanceRepositoryTests(unittest.TestCase):
    def test_create_observed_page_is_one_atomic_acceptance_transaction(self):
        batch = replace(acceptance_workflow_batch(), items=(create_item(),))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8,
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=create_item().input_hash,
                row_hash=create_item().row_hash,
                final_direction_code="cardiology",
                final_material_type_code="articles",
                final_access_code="doctors",
                final_lifecycle_code="active",
                selected_content_entity_id=None,
                url_alias_decision="create",
                decision_reason="observed canonical page",
            ),),
        )

        snapshot = ContentRegistryRepository(lambda: connection).record_local_batch_acceptance(
            8, intent, "local-owner"
        )

        self.assertEqual(snapshot.accepted_decision_hash, compute_accepted_decision_hash(snapshot.items))
        self.assertEqual(connection.commit_count, 1)
