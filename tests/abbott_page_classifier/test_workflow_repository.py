"""Executable fake-DB coverage for the production weekly workflow store."""

from __future__ import annotations

import unittest

from agents.abbott_page_classifier.approval_hashes import compute_taxonomy_digest
from agents.abbott_page_classifier.domain import TAXONOMY_LABELS
from agents.abbott_page_classifier.llm_classifier import LlmAttempt, LlmUsage
from agents.abbott_page_classifier.workflow_repository import MySqlWorkflowStore
from agents.abbott_page_classifier.workflow_service import WorkflowConfiguration


TERMS = {kind: tuple(sorted(labels)) for kind, labels in TAXONOMY_LABELS.items()}
DIGEST = compute_taxonomy_digest("abbott.v1", TERMS)
CONFIG = WorkflowConfiguration("abbott.v1", "prompt.v1", "routing.v1", "a" * 40)


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []
        self.lastrowid = 0
        self.rowcount = 0

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, params))
        self.rows = []
        self.rowcount = 0
        if "FROM portal_active_data_releases AS active" in normalized:
            self.rows = [(8, "[11,12]")]
        elif "FROM portal_dataset_snapshots" in normalized and "id IN" in normalized:
            self.rows = [(11, "1" * 64), (12, "2" * 64)]
        elif "FROM portal_content_taxonomy_versions" in normalized:
            self.rows = [(3, DIGEST)]
        elif "FROM portal_content_taxonomy_terms" in normalized:
            self.rows = [(kind, code) for kind, codes in TERMS.items() for code in codes]
        elif "FROM portal_content_registry_entities AS entity" in normalized:
            # The LEFT JOIN must retain this entity even without an event.
            self.rows = [(7, "Eventless", "https://abbottpro.ru/eventless", None, None, None, None, None)]
        elif "FROM portal_content_registry_aliases" in normalized:
            self.rows = [(7, "canonical_url", "https://abbottpro.ru/eventless", "strong")]
        elif "FROM portal_content_reconciliation_items" in normalized:
            self.rows = [(44,)]
        elif "FROM portal_content_llm_attempts" in normalized:
            self.rows = []
        elif normalized.startswith("INSERT INTO portal_content_llm_attempts"):
            self.lastrowid = 91
            self.rowcount = 1

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self):
        pass


class FakeConnection:
    def __init__(self):
        self.calls = []
        self.commit_count = 0
        self.rollback_count = 0
        self.cursor_instance = FakeCursor(self)

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        pass


class MySqlWorkflowStoreTests(unittest.TestCase):
    def test_context_locks_active_predecessor_and_keeps_eventless_entities(self):
        connection = FakeConnection()
        context = MySqlWorkflowStore(lambda: connection).load_reconciliation_context(CONFIG)

        self.assertEqual(context.predecessor_release_id, 8)
        self.assertEqual(context.predecessor_snapshot_ids, (11, 12))
        self.assertEqual(context.predecessor_snapshot_digests, ("1" * 64, "2" * 64))
        self.assertEqual(context.entities[0].content_entity_id, 7)
        self.assertEqual(context.entities[0].lifecycle_code, "unknown")
        self.assertEqual(context.entities[0].event_id, None)
        sql = "\n".join(statement for statement, _ in connection.calls)
        self.assertIn("FOR UPDATE", sql)
        self.assertIn("LEFT JOIN latest_events AS event", sql)
        self.assertEqual(connection.commit_count, 1)

    def test_append_llm_attempt_is_append_only_and_usage_bounded(self):
        connection = FakeConnection()
        attempt = LlmAttempt(
            status="unresolved",
            model="gpt-5.6-terra",
            unresolved_code="LLM_INSUFFICIENT_EVIDENCE",
            attempt_count=1,
            input_hash="f" * 64,
            requested_fields=("direction_code",),
            usage=LlmUsage(input_tokens=12, output_tokens=3, total_tokens=15),
            elapsed_ms=7,
        )
        MySqlWorkflowStore(lambda: connection).append_llm_attempt(
            4, "b" * 64, "terra_primary", attempt
        )

        sql = "\n".join(statement for statement, _ in connection.calls)
        self.assertIn("INSERT INTO portal_content_llm_attempts", sql)
        self.assertNotRegex(sql, r"UPDATE portal_content_llm_attempts|DELETE FROM portal_content_llm_attempts")
        insert_params = next(params for statement, params in connection.calls if statement.startswith("INSERT INTO portal_content_llm_attempts"))
        self.assertIn(12, insert_params)
        self.assertIn(3, insert_params)
        self.assertIn(7, insert_params)
        self.assertFalse(any("bounded source" in str(value) for value in insert_params))
        self.assertEqual(connection.commit_count, 1)


if __name__ == "__main__":
    unittest.main()
