"""Local owner acceptance creates observed pages atomically."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
import unittest

from agents.abbott_page_classifier.approval_hashes import compute_accepted_decision_hash
from agents.abbott_page_classifier.domain import ConflictCode
from agents.abbott_page_classifier.local_acceptance import LocalAcceptanceIntent, LocalDecision
from agents.abbott_page_classifier.repository import ContentRegistryRepository, RepositoryError
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
        readiness_state="unresolved",
        conflict_codes=(),
        registry1_values={
            "source_name": "observed_page",
            "url": "https://www.abbottpro.ru/articles/observed-page",
        },
    )


class LocalAcceptanceRepositoryTests(unittest.TestCase):
    def test_unresolved_observed_attach_and_reject_are_local_actions(self):
        for action, selected in (("attach", 41), ("reject", None)):
            with self.subTest(action=action):
                item = replace(
                    create_item(),
                    input_hash=("a" if action == "attach" else "b") * 64,
                    row_hash=("e" if action == "attach" else "f") * 64,
                )
                batch = replace(acceptance_workflow_batch(), items=(item,))
                connection = StatefulAcceptanceConnection(
                    batch, selected_entity_id=41
                )
                intent = LocalAcceptanceIntent(
                    batch_id=8,
                    batch_key=batch.batch_key,
                    published_input_hash=batch.published_input_hash,
                    accepted_by="manager",
                    accepted_at=datetime(2026, 8, 11, 8, 0),
                    decisions=(LocalDecision(
                        input_hash=item.input_hash,
                        row_hash=item.row_hash,
                        final_direction_code=item.final_direction_code,
                        final_material_type_code=item.final_material_type_code,
                        final_access_code=item.final_access_code,
                        final_lifecycle_code=item.final_lifecycle_code,
                        selected_content_entity_id=selected,
                        url_alias_decision=action,
                        decision_reason="reviewed observed page",
                    ),),
                )

                snapshot = ContentRegistryRepository(
                    lambda: connection
                ).record_local_batch_acceptance(
                    8, intent, "sheet-123", "a" * 64
                )

                self.assertEqual(snapshot.accepted_count, 0)
                self.assertEqual(snapshot.skipped_count, 1)
                self.assertEqual(connection.commit_count, 1)
                self.assertEqual(len(connection.decision_events), 1)
                self.assertEqual(
                    connection.decision_events[0]["url_alias_decision"], action
                )

    def test_unresolved_observed_with_current_metadata_can_be_rejected_as_non_content(self):
        item = replace(
            create_item(),
            content_entity_id=41,
            current_canonical={
                "content_entity_id": 41,
                "direction_code": "undetermined",
                "material_type_code": "service_page",
                "access_code": "unspecified",
                "lifecycle_code": "active",
            },
        )
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8,
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash,
                row_hash=item.row_hash,
                final_direction_code="not_applicable",
                final_material_type_code=None,
                final_access_code="unspecified",
                final_lifecycle_code="active",
                selected_content_entity_id=None,
                url_alias_decision="reject",
                decision_reason="reviewed legacy non-content page",
            ),),
        )

        snapshot = ContentRegistryRepository(
            lambda: connection
        ).record_local_batch_acceptance(8, intent, "sheet-123", "a" * 64)

        self.assertEqual(snapshot.accepted_count, 0)
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(len(connection.decision_events), 1)
        self.assertEqual(connection.decision_events[0]["url_alias_decision"], "reject")

    def test_non_observed_unresolved_attach_is_rejected(self):
        item = replace(
            create_item(),
            registry1_values=None,
        )
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8,
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash,
                row_hash=item.row_hash,
                final_direction_code=item.final_direction_code,
                final_material_type_code=item.final_material_type_code,
                final_access_code=item.final_access_code,
                final_lifecycle_code=item.final_lifecycle_code,
                selected_content_entity_id=41,
                url_alias_decision="attach",
                decision_reason="reviewed observed page",
            ),),
        )

        with self.assertRaisesRegex(RepositoryError, "CREATE_SOURCE_NOT_OBSERVED"):
            ContentRegistryRepository(
                lambda: connection
            ).record_local_batch_acceptance(8, intent, "sheet-123", "a" * 64)

        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(connection.decision_events, [])

    def test_observed_current_entity_can_be_reviewed_for_same_entity_attach(self):
        item = replace(
            create_item(),
            content_entity_id=41,
            current_canonical={
                "content_entity_id": 41,
                "direction_code": "cardiology",
                "material_type_code": "articles",
                "access_code": "all",
                "lifecycle_code": "active",
            },
        )
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8,
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash,
                row_hash=item.row_hash,
                final_direction_code=item.final_direction_code,
                final_material_type_code=item.final_material_type_code,
                final_access_code=item.final_access_code,
                final_lifecycle_code=item.final_lifecycle_code,
                selected_content_entity_id=41,
                url_alias_decision="attach",
                decision_reason="reviewed observed URL for current entity",
            ),),
        )

        snapshot = ContentRegistryRepository(
            lambda: connection
        ).record_local_batch_acceptance(8, intent, "sheet-123", "a" * 64)

        self.assertEqual(snapshot.accepted_count, 0)
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.decision_events[0]["url_alias_decision"], "attach")

    def test_unresolved_identity_collision_without_local_action_is_skipped(self):
        item = replace(
            acceptance_workflow_batch().items[1],
            readiness_state="conflict",
            conflict_codes=(ConflictCode.IDENTITY_COLLISION,),
            selected_content_entity_id=None,
            url_alias_decision=None,
        )
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8,
            batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash,
                row_hash=item.row_hash,
                final_direction_code=item.final_direction_code,
                final_material_type_code=item.final_material_type_code,
                final_access_code=item.final_access_code,
                final_lifecycle_code=item.final_lifecycle_code,
                selected_content_entity_id=None,
                url_alias_decision=None,
                decision_reason=item.decision_reason,
            ),),
        )

        snapshot = ContentRegistryRepository(
            lambda: connection
        ).record_local_batch_acceptance(8, intent, "sheet-123", "a" * 64)

        self.assertEqual(snapshot.accepted_count, 0)
        self.assertEqual(snapshot.skipped_count, 1)
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.created_entity_count, 0)
        self.assertEqual(connection.created_classification_count, 0)
        self.assertEqual(connection.decision_events, [])
        self.assertFalse(any(
            sql.startswith("UPDATE portal_content_approval_items")
            for sql, _params in connection.calls
        ))

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
            8, intent, "sheet-123", "a" * 64
        )

        self.assertEqual(snapshot.accepted_decision_hash, compute_accepted_decision_hash(snapshot.items))
        self.assertEqual(snapshot.accepted_count, 1)
        self.assertEqual(snapshot.skipped_count, 0)
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(connection.created_entity_count, 1)
        self.assertEqual(connection.created_classification_count, 1)
        self.assertEqual({alias["alias_type"] for alias in connection.aliases}, {"canonical_url", "url"})
        self.assertEqual(len(connection.decision_events), 1)
        normalized = "https://abbottpro.ru/articles/observed-page"
        self.assertTrue(all(alias["alias_value"] == normalized for alias in connection.aliases))
        self.assertEqual(connection.created_entities[0]["canonical_url"], normalized)
        self.assertEqual(
            connection.created_classifications[0]["proposal_evidence"]["created_identity"]["normalized_url"],
            normalized,
        )
        self.assertEqual(
            connection.created_classifications[0]["proposal_evidence"]["created_identity"]["url_decision_event_fingerprint"],
            connection.decision_events[0]["event_fingerprint"],
        )

    def test_create_normalizes_www_and_path_before_every_identity_write(self):
        item = replace(create_item(), url="HTTP://WWW.ABBOTTPRO.RU/a/../articles//observed-page/")
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8, batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash, accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash, row_hash=item.row_hash,
                final_direction_code="cardiology", final_material_type_code="articles",
                final_access_code="doctors", final_lifecycle_code="active",
                selected_content_entity_id=None, url_alias_decision="create",
                decision_reason="observed canonical page",
            ),),
        )

        ContentRegistryRepository(lambda: connection).record_local_batch_acceptance(
            8, intent, "sheet-123", "a" * 64
        )

        expected = "https://abbottpro.ru/articles/observed-page"
        self.assertEqual(connection.created_entities[0]["canonical_url"], expected)
        self.assertEqual({alias["alias_value"] for alias in connection.aliases}, {expected})
        self.assertEqual(connection.decision_events[0]["normalized_url"], expected)

    def test_create_collision_rolls_back_every_write(self):
        item = create_item()
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(
            batch, selected_entity_id=41,
            aliases=[{
                "id": 1, "content_entity_id": 99, "alias_type": "url",
                "alias_value": "https://abbottpro.ru/articles/observed-page",
                "alias_hash": __import__("hashlib").sha256(
                    b"https://abbottpro.ru/articles/observed-page"
                ).hexdigest(),
                "alias_status": "active", "uniqueness_scope": "strong",
            }],
        )
        intent = LocalAcceptanceIntent(
            batch_id=8, batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash, accepted_by="manager",
            accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash, row_hash=item.row_hash,
                final_direction_code="cardiology", final_material_type_code="articles",
                final_access_code="doctors", final_lifecycle_code="active",
                selected_content_entity_id=None, url_alias_decision="create",
                decision_reason="observed canonical page",
            ),),
        )

        with self.assertRaisesRegex(RepositoryError, "IDENTITY_COLLISION"):
            ContentRegistryRepository(lambda: connection).record_local_batch_acceptance(
                8, intent, "sheet-123", "a" * 64
            )

        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(connection.created_entity_count, 0)
        self.assertEqual(connection.created_classification_count, 0)
        self.assertEqual(len(connection.aliases), 1)
        self.assertEqual(connection.decision_events, [])

    def test_create_rejection_matrix_rolls_back(self):
        invalid = {
            "query": {"url": "https://abbottpro.ru/a?x=1"},
            "fragment": {"url": "https://abbottpro.ru/a#x"},
            "external": {"url": "https://example.com/a"},
            "file": {"url": "file:///C:/a.html"},
            "missing_taxonomy": {"direction": None},
            "missing_reason": {"reason": " "},
            "selected_id": {"selected": 41},
            "published_entity": {"content_entity_id": 41},
            "non_observed": {"non_observed": True},
        }
        for name, override in invalid.items():
            with self.subTest(name=name):
                item = replace(
                    create_item(), url=override.get("url", create_item().url),
                    content_entity_id=override.get("content_entity_id"),
                    registry1_values=(
                        None if override.get("non_observed")
                        else create_item().registry1_values
                    ),
                )
                batch = replace(acceptance_workflow_batch(), items=(item,))
                connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
                intent = LocalAcceptanceIntent(
                    batch_id=8, batch_key=batch.batch_key,
                    published_input_hash=batch.published_input_hash, accepted_by="manager",
                    accepted_at=datetime(2026, 8, 11, 8, 0),
                    decisions=(LocalDecision(
                        input_hash=item.input_hash, row_hash=item.row_hash,
                        final_direction_code=override.get("direction", "cardiology"),
                        final_material_type_code="articles", final_access_code="doctors",
                        final_lifecycle_code="active",
                        selected_content_entity_id=override.get("selected"),
                        url_alias_decision="create",
                        decision_reason=override.get("reason", "observed canonical page"),
                    ),),
                )
                with self.assertRaises(RepositoryError):
                    ContentRegistryRepository(lambda: connection).record_local_batch_acceptance(
                        8, intent, "sheet-123", "a" * 64
                    )
                self.assertEqual(connection.commit_count, 0)
                self.assertEqual(connection.rollback_count, 1)

    def test_locator_or_taxonomy_binding_mismatch_fails_before_item_writes(self):
        item = create_item()
        batch = replace(acceptance_workflow_batch(), items=(item,))
        for name, connection, locator in (
            (
                "locator",
                StatefulAcceptanceConnection(batch, selected_entity_id=41),
                "another-locator",
            ),
            (
                "batch_taxonomy_digest",
                StatefulAcceptanceConnection(
                    batch, selected_entity_id=41, batch_taxonomy_digest="0" * 64
                ),
                "sheet-123",
            ),
            (
                "table_taxonomy_digest",
                StatefulAcceptanceConnection(
                    batch, selected_entity_id=41, table_taxonomy_digest="0" * 64
                ),
                "sheet-123",
            ),
        ):
            with self.subTest(name=name):
                intent = LocalAcceptanceIntent(
                    batch_id=8, batch_key=batch.batch_key,
                    published_input_hash=batch.published_input_hash,
                    accepted_by="manager", accepted_at=datetime(2026, 8, 11, 8, 0),
                    decisions=(LocalDecision(
                        input_hash=item.input_hash, row_hash=item.row_hash,
                        final_direction_code="cardiology",
                        final_material_type_code="articles",
                        final_access_code="doctors", final_lifecycle_code="active",
                        selected_content_entity_id=None, url_alias_decision="create",
                        decision_reason="observed canonical page",
                    ),),
                )
                with self.assertRaises(RepositoryError):
                    ContentRegistryRepository(
                        lambda connection=connection: connection
                    ).record_local_batch_acceptance(8, intent, locator, "a" * 64)
                self.assertEqual(connection.commit_count, 0)
                self.assertEqual(connection.rollback_count, 1)
                self.assertEqual(connection.created_entity_count, 0)
                self.assertFalse(any(
                    "portal_content_approval_items" in sql
                    for sql, _params in connection.calls
                ))

    def test_locked_local_receipt_hash_mismatch_rolls_back_before_item_writes(self):
        item = create_item()
        batch = replace(acceptance_workflow_batch(), items=(item,))
        connection = StatefulAcceptanceConnection(batch, selected_entity_id=41)
        intent = LocalAcceptanceIntent(
            batch_id=8, batch_key=batch.batch_key,
            published_input_hash=batch.published_input_hash,
            accepted_by="manager", accepted_at=datetime(2026, 8, 11, 8, 0),
            decisions=(LocalDecision(
                input_hash=item.input_hash, row_hash=item.row_hash,
                final_direction_code="cardiology", final_material_type_code="articles",
                final_access_code="doctors", final_lifecycle_code="active",
                selected_content_entity_id=None, url_alias_decision="create",
                decision_reason="observed canonical page",
            ),),
        )

        with self.assertRaisesRegex(RepositoryError, "LOCAL_PROJECTION_RECEIPT_MISMATCH"):
            ContentRegistryRepository(lambda: connection).record_local_batch_acceptance(
                8, intent, "sheet-123", "f" * 64
            )

        self.assertEqual(connection.commit_count, 0)
        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(connection.created_entity_count, 0)
