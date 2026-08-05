"""Static Task 9A schema and least-privilege contracts."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "dashboard-next/src/db/migrations/047_abbott_content_reconciliation_staging.sql"
GRANTS = ROOT / "ops/sql/abbott_private_schema_and_grants.sql"


class AbbottContentReconciliationSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.grants = GRANTS.read_text(encoding="utf-8")

    def test_staging_tables_are_repeat_safe_innodb_and_fk_bound(self):
        for table in (
            "portal_content_reconciliation_runs",
            "portal_content_reconciliation_items",
            "portal_content_llm_attempts",
        ):
            with self.subTest(table=table):
                self.assertRegex(
                    self.sql,
                    rf"CREATE TABLE IF NOT EXISTS {table}\b[\s\S]*?ENGINE=InnoDB",
                )
        for target in (
            "portal_dataset_snapshots",
            "portal_data_releases",
            "portal_content_taxonomy_versions",
            "portal_content_registry_entities",
            "portal_content_reconciliation_runs",
            "portal_content_reconciliation_items",
        ):
            with self.subTest(target=target):
                self.assertRegex(self.sql, rf"REFERENCES {target}\s*\(")

    def test_runs_store_exact_source_and_locked_predecessor_accounting(self):
        for fragment in (
            "registry1_source_row_count BIGINT UNSIGNED NOT NULL",
            "registry1_accepted_count BIGINT UNSIGNED NOT NULL",
            "registry1_rejected_count BIGINT UNSIGNED NOT NULL",
            "registry1_duplicate_collapsed_count BIGINT UNSIGNED NOT NULL",
            "registry2_source_row_count BIGINT UNSIGNED NOT NULL",
            "registry2_accepted_count BIGINT UNSIGNED NOT NULL",
            "registry2_rejected_count BIGINT UNSIGNED NOT NULL",
            "registry2_duplicate_collapsed_count BIGINT UNSIGNED NOT NULL",
            "registry1_parser_version VARCHAR(128) NOT NULL",
            "registry2_parser_version VARCHAR(128) NOT NULL",
            "registry1_source_kind VARCHAR(64) NOT NULL",
            "registry2_source_kind VARCHAR(64) NOT NULL",
            "predecessor_snapshot_ids JSON NOT NULL",
            "predecessor_snapshot_digests JSON NOT NULL",
            "prompt_version VARCHAR(191) NOT NULL",
            "model_routing_version VARCHAR(191) NOT NULL",
            "code_revision CHAR(40) NOT NULL",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.sql)

    def test_llm_attempts_are_append_only_and_data_minimized(self):
        for fragment in (
            "requested_fields JSON NOT NULL",
            "strict_result_json JSON DEFAULT NULL",
            "unresolved_code VARCHAR(64) DEFAULT NULL",
            "input_token_count BIGINT UNSIGNED DEFAULT NULL",
            "output_token_count BIGINT UNSIGNED DEFAULT NULL",
            "elapsed_ms BIGINT UNSIGNED DEFAULT NULL",
            "event_fingerprint CHAR(64) NOT NULL",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.sql)
        self.assertNotRegex(
            self.sql,
            re.compile(r"(?:UPDATE|DELETE\s+FROM)\s+portal_content_llm_attempts", re.I),
        )
        self.assertNotRegex(
            self.sql,
            re.compile(
                r"raw_response|chain_of_thought|raw_user_id|visit_id|client_id|oauth_value|secret_value|email_address|phone_number",
                re.I,
            ),
        )

    def test_workflow_role_is_narrow_and_separate_from_materializer(self):
        normalized = " ".join(self.grants.split())
        role = "'abbott_content_workflow_role'"
        self.assertIn(role, normalized)
        grants = [
            grant
            for grant in re.findall(r"GRANT .*?;", normalized, flags=re.I)
            if f"TO {role}" in grant
        ]
        self.assertTrue(grants)
        self.assertFalse(any(" DELETE " in f" {grant.upper()} " for grant in grants))
        self.assertFalse(any("portal_active_data_releases" in grant and "UPDATE" in grant for grant in grants))
        self.assertFalse(any("portal_content_catalog" in grant and "INSERT" in grant for grant in grants))
        self.assertFalse(any("canonical_fact_" in grant and any(word in grant for word in ("INSERT", "UPDATE", "DELETE")) for grant in grants))
        for table in (
            "portal_content_reconciliation_runs",
            "portal_content_reconciliation_items",
            "portal_content_llm_attempts",
            "portal_content_approval_batches",
            "portal_content_approval_items",
            "portal_content_registry_entities",
            "portal_content_registry_aliases",
            "portal_content_classification_events",
        ):
            with self.subTest(table=table):
                self.assertTrue(any(f"report_bd.{table}" in grant for grant in grants))


if __name__ == "__main__":
    unittest.main()
