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
    / "045_abbott_content_registry_workflow.sql"
)


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
            "UNIQUE KEY uniq_registry_strong_alias (dataset_key, alias_type, alias_hash, uniqueness_scope)",
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


if __name__ == "__main__":
    unittest.main()
