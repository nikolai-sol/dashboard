from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AbbottSchemaContractTest(unittest.TestCase):
    @staticmethod
    def _primary_sql():
        return (
            ROOT
            / "dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql"
        ).read_text()

    @staticmethod
    def _private_sql():
        return (ROOT / "ops/sql/abbott_private_schema_and_grants.sql").read_text()

    @staticmethod
    def _normalized(sql):
        return " ".join(sql.split())

    def test_release_keys_and_private_boundary(self):
        primary = self._primary_sql()
        private = self._private_sql()
        self.assertIn("portal_active_data_releases", primary)
        self.assertIn("canonical_release_id", primary)
        self.assertNotIn("raw_user_id", primary.lower())
        self.assertIn("raw_user_id TEXT NOT NULL", private)
        self.assertIn("ENGINE=InnoDB", primary)
        self.assertIn("ENGINE=InnoDB", private)

    def test_coverage_statuses_and_scopes_are_exactly_closed(self):
        sql = self._primary_sql()
        status_match = re.search(r"collection_status\s+ENUM\(([^)]*)\)", sql)
        scope_match = re.search(r"scope_key\s+ENUM\(([^)]*)\)", sql)
        self.assertIsNotNone(status_match)
        self.assertIsNotNone(scope_match)
        self.assertEqual(
            re.findall(r"'([^']+)'", status_match.group(1)),
            [
                "success",
                "success_empty",
                "partial",
                "skipped",
                "sampled",
                "failed",
            ],
        )
        self.assertEqual(
            re.findall(r"'([^']+)'", scope_match.group(1)),
            ["other", "traffic", "page", "user_behavior", "returning"],
        )

    def test_returning_and_coverage_persist_request_fingerprints(self):
        sql = self._normalized(self._primary_sql())
        for table in (
            "canonical_fact_metrika_returning_pages_daily",
            "canonical_source_coverage_daily",
        ):
            definition = sql.split(f"CREATE TABLE IF NOT EXISTS {table} (", 1)[1]
            definition = definition.split(") ENGINE=InnoDB", 1)[0]
            self.assertIn("request_fingerprint CHAR(64) NOT NULL", definition)

    def test_candidate_fact_unique_keys_are_exact(self):
        sql = self._normalized(self._primary_sql())
        for key in (
            "UNIQUE KEY uniq_site_release_scope "
            "(canonical_release_id, source_key, analytics_account_id, report_date, "
            "analytics_scope, scope_hash)",
            "UNIQUE KEY uniq_returning_release_page_bucket "
            "(canonical_release_id, counter_id, report_date, raw_page_hash, "
            "return_bucket_code)",
            "UNIQUE KEY uniq_release_coverage "
            "(canonical_release_id, source_key, counter_id, scope_key, report_date)",
        ):
            self.assertIn(key, sql)

    def test_every_created_table_uses_innodb(self):
        for sql in (self._primary_sql(), self._private_sql()):
            statements = re.findall(
                r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b.*?;",
                sql,
                flags=re.IGNORECASE | re.DOTALL,
            )
            self.assertGreater(len(statements), 0)
            for statement in statements:
                self.assertIn("ENGINE=InnoDB", statement)

    def test_role_contract_has_no_account_or_credential_clauses(self):
        sql = self._primary_sql() + "\n" + self._private_sql()
        self.assertNotRegex(sql, r"(?i)\bCREATE\s+USER\b")
        self.assertNotRegex(sql, r"(?i)\bIDENTIFIED\s+BY\b")
        self.assertNotRegex(sql, r"(?i)\bPASSWORD\b")
        self.assertNotIn("y0_", sql)

    def test_collector_role_can_publish_all_candidate_fact_tables(self):
        sql = self._normalized(self._private_sql())
        for table in (
            "canonical_fact_metrika_site_analytics_daily",
            "canonical_fact_metrika_returning_pages_daily",
            "canonical_source_coverage_daily",
        ):
            self.assertIn(
                "GRANT SELECT, INSERT, UPDATE, DELETE "
                f"ON report_bd.{table} "
                "TO 'reportingdash_abbott_collector_role';",
                sql,
            )

    def test_collector_role_can_atomically_replace_private_behavior(self):
        sql = self._normalized(self._private_sql())
        self.assertIn(
            "GRANT SELECT, INSERT, UPDATE, DELETE "
            "ON report_bd_private.canonical_fact_metrika_user_behavior_daily "
            "TO 'reportingdash_abbott_collector_role';",
            sql,
        )

    def test_prebackfill_requires_every_declared_variable_before_insert(self):
        sql = (ROOT / "ops/sql/abbott_prebackfill_snapshot.sql").read_text()
        guard = sql.split("INSERT INTO report_bd.portal_dataset_snapshots", 1)[0]
        self.assertIn("SIGNAL SQLSTATE '45000'", guard)
        for variable in (
            "@abbott_snapshot_key",
            "@abbott_snapshot_source_locator",
            "@abbott_snapshot_sha256",
            "@abbott_snapshot_bytes",
            "@abbott_snapshot_generated_at",
            "@abbott_snapshot_period_min",
            "@abbott_snapshot_period_max",
            "@abbott_snapshot_rows",
            "@abbott_snapshot_parser_version",
            "@abbott_snapshot_archive_locator",
            "@abbott_snapshot_manifest_json",
        ):
            self.assertRegex(guard, rf"IF\s+{re.escape(variable)}\s+IS\s+NULL")

    def test_prebackfill_calls_guard_before_transaction_and_insert(self):
        sql = (ROOT / "ops/sql/abbott_prebackfill_snapshot.sql").read_text()
        call = "CALL report_bd.assert_abbott_prebackfill_variables();"
        self.assertEqual(sql.count(call), 1)
        self.assertLess(sql.index(call), sql.index("START TRANSACTION"))
        self.assertLess(
            sql.index(call),
            sql.index("INSERT INTO report_bd.portal_dataset_snapshots"),
        )

    def test_prebackfill_is_fixed_to_the_abbott_counter(self):
        sql = (ROOT / "ops/sql/abbott_prebackfill_snapshot.sql").read_text()
        counter_filters = re.findall(r"\bcounter_id\s*=\s*(\d+)", sql)
        self.assertGreater(len(counter_filters), 0)
        self.assertEqual(set(counter_filters), {"90602537"})
        self.assertEqual(set(re.findall(r"\b\d{8}\b", sql)), {"90602537"})
        self.assertNotIn("@abbott_counter_id", sql)

    def test_active_release_pointer_is_bound_to_its_dataset(self):
        sql = self._normalized(self._primary_sql())
        self.assertIn(
            "UNIQUE KEY uniq_portal_release_dataset_id (dataset_key, id)", sql
        )
        self.assertIn(
            "FOREIGN KEY (dataset_key, canonical_release_id) "
            "REFERENCES portal_data_releases(dataset_key, id)",
            sql,
        )

    def test_rollback_lineage_and_target_are_bound_to_their_dataset(self):
        sql = self._normalized(self._primary_sql())
        for contract in (
            "KEY idx_portal_release_rollback "
            "(dataset_key, rollback_from_release_id)",
            "FOREIGN KEY (dataset_key, rollback_from_release_id) "
            "REFERENCES portal_data_releases(dataset_key, id)",
            "KEY idx_active_previous_release (dataset_key, previous_release_id)",
            "FOREIGN KEY (dataset_key, previous_release_id) "
            "REFERENCES portal_data_releases(dataset_key, id)",
        ):
            self.assertIn(contract, sql)

    def test_required_coverage_status_literals_remain_present(self):
        sql = self._primary_sql()
        for status in (
            "success",
            "success_empty",
            "partial",
            "skipped",
            "sampled",
            "failed",
        ):
            self.assertIn(f"'{status}'", sql)


if __name__ == "__main__":
    unittest.main()
