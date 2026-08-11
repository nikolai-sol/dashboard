"""Static safety contract for the Abbott content-registry workflow migration."""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "dashboard-next"
    / "src"
    / "db"
    / "migrations"
    / "047_abbott_content_registry_workflow.sql"
)
URL_ALIAS_DECISIONS_MIGRATION = MIGRATION.parent / "051_abbott_content_url_alias_decisions.sql"


class AbbottContentRegistrySchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_all_workflow_tables_are_repeat_safe_innodb_tables(self):
        tables = (
            "portal_content_registry_entities",
            "portal_content_registry_aliases",
            "portal_content_taxonomy_versions",
            "portal_content_taxonomy_terms",
            "portal_content_approval_batches",
            "portal_content_approval_items",
            "portal_content_classification_events",
        )
        for table in tables:
            with self.subTest(table=table):
                self.assertRegex(
                    self.sql,
                    rf"CREATE TABLE IF NOT EXISTS {table}\b[\s\S]*?ENGINE=InnoDB",
                )

    def test_workflow_rows_are_linked_by_foreign_keys(self):
        expected_references = (
            "portal_content_registry_entities",
            "portal_content_taxonomy_versions",
            "portal_content_approval_batches",
            "portal_content_approval_items",
        )
        for table in expected_references:
            with self.subTest(table=table):
                self.assertRegex(
                    self.sql,
                    rf"FOREIGN KEY\s*\([^)]*\)\s*REFERENCES {table}\s*\(",
                )

    def test_schema_is_abbott_scoped_and_uses_exact_uniqueness_grains(self):
        self.assertIn("dataset_key = 'abbott'", self.sql)
        for unique_key in (
            "UNIQUE KEY uniq_registry_entity_dataset_id (dataset_key, id)",
            "UNIQUE KEY uniq_registry_material_id (dataset_key, material_id)",
            "UNIQUE KEY uniq_registry_strong_alias (dataset_key, alias_type, strong_alias_hash)",
            "UNIQUE KEY uniq_registry_alias_owner (dataset_key, content_entity_id, alias_type, alias_hash)",
            "UNIQUE KEY uniq_taxonomy_code (taxonomy_version_id, taxonomy_kind, term_code)",
            "UNIQUE KEY uniq_approval_batch_key (dataset_key, batch_key)",
            "UNIQUE KEY uniq_approval_batch_entity (approval_batch_id, content_entity_id, input_hash)",
            "UNIQUE KEY uniq_classification_event_fingerprint (event_fingerprint)",
        ):
            with self.subTest(unique_key=unique_key):
                self.assertIn(unique_key, self.sql)

    def test_events_are_append_only_and_fingerprinted(self):
        self.assertRegex(
            self.sql,
            r"event_fingerprint CHAR\(64\) NOT NULL",
        )
        self.assertNotRegex(
            self.sql,
            re.compile(r"UPDATE\s+portal_content_classification_events", re.I),
        )

    def test_open_approval_items_have_review_index(self):
        self.assertIn(
            "INDEX idx_approval_items_open (approval_batch_id, readiness_state, conflict_code)",
            self.sql,
        )

    def test_alias_types_have_fixed_strong_and_weak_scopes(self):
        self.assertIn(
            "alias_type ENUM('material_id', 'canonical_url', 'url', 'slug', 'title') NOT NULL",
            self.sql,
        )
        self.assertRegex(
            self.sql,
            r"CONSTRAINT chk_registry_alias_scope CHECK \(\s*"
            r"\(alias_type IN \('material_id', 'canonical_url', 'url'\) "
            r"AND uniqueness_scope = 'strong'\)\s*OR\s*"
            r"\(alias_type IN \('slug', 'title'\) "
            r"AND uniqueness_scope = 'weak'\)\s*\)",
        )
        self.assertRegex(
            self.sql,
            r"strong_alias_hash CHAR\(64\) GENERATED ALWAYS AS \(\s*"
            r"CASE WHEN uniqueness_scope = 'strong' THEN alias_hash ELSE NULL END\s*"
            r"\) STORED",
        )
        self.assertNotIn(
            "UNIQUE KEY uniq_registry_strong_alias "
            "(dataset_key, alias_type, alias_hash, uniqueness_scope)",
            self.sql,
        )

    def test_unresolved_items_have_a_null_safe_identity_key(self):
        self.assertRegex(
            self.sql,
            r"content_entity_identity BIGINT UNSIGNED GENERATED ALWAYS AS "
            r"\(COALESCE\(content_entity_id, 0\)\) STORED",
        )
        self.assertIn(
            "UNIQUE KEY uniq_approval_batch_item_identity "
            "(approval_batch_id, content_entity_identity, input_hash)",
            self.sql,
        )

    def test_taxonomy_and_batch_audit_contract_is_fully_persisted(self):
        required_fragments = (
            "taxonomy_digest CHAR(64) NOT NULL",
            "source_snapshot_ids JSON NOT NULL",
            "source_snapshot_digests JSON NOT NULL",
            "model_routing_version VARCHAR(191) NOT NULL",
            "ready_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "conflict_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "unresolved_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "rejected_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "no_change_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "accepted_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "skipped_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "spreadsheet_file_id VARCHAR(255) DEFAULT NULL",
            "spreadsheet_projection_hash CHAR(64) DEFAULT NULL",
            "published_at DATETIME(6) DEFAULT NULL",
            "failed_at DATETIME(6) DEFAULT NULL",
            "failure_code VARCHAR(64) DEFAULT NULL",
            "candidate_release_id BIGINT UNSIGNED DEFAULT NULL",
            "activation_status ENUM('not_started', 'candidate', 'active', 'rejected')",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.sql)

    def test_batch_lifecycle_starts_draft_and_includes_all_required_states(self):
        self.assertIn(
            "batch_status ENUM('draft', 'published', 'accepted', 'ingested', "
            "'candidate_materialized', 'rejected', 'failed') NOT NULL DEFAULT 'draft'",
            self.sql,
        )

    def test_url_alias_decisions_are_additive_and_replay_safe(self):
        sql = URL_ALIAS_DECISIONS_MIGRATION.read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN IF NOT EXISTS selected_content_entity_id BIGINT UNSIGNED DEFAULT NULL", sql)
        self.assertIn("ENUM('attach', 'retire', 'reject') DEFAULT NULL", sql)

    def test_url_alias_decision_events_are_append_only_and_linked_to_review_authority(self):
        sql = URL_ALIAS_DECISIONS_MIGRATION.read_text(encoding="utf-8")
        for trigger, operation in (
            ("trg_abbott_url_alias_decision_events_immutable_update", "UPDATE"),
            ("trg_abbott_url_alias_decision_events_immutable_delete", "DELETE"),
        ):
            with self.subTest(trigger=trigger):
                self.assertIn(f"DROP TRIGGER IF EXISTS {trigger}", sql)
                self.assertRegex(
                    sql,
                    rf"CREATE TRIGGER {trigger}\s+BEFORE {operation} ON "
                    r"portal_content_url_alias_decision_events[\s\S]*?"
                    r"SIGNAL SQLSTATE '45000'",
                )
        self.assertGreaterEqual(sql.count("-- @migration-statement-break"), 4)
        for constraint in (
            "fk_url_alias_decision_batch",
            "fk_url_alias_decision_item",
            "fk_url_alias_decision_entity",
            "fk_url_alias_decision_predecessor_event",
        ):
            with self.subTest(constraint=constraint):
                self.assertIn(constraint, sql)


if __name__ == "__main__":
    unittest.main()
