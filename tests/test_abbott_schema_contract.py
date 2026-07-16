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

    @classmethod
    def _table_definition(cls, sql, table):
        normalized = cls._normalized(sql)
        marker = f"CREATE TABLE IF NOT EXISTS {table} ("
        if marker not in normalized:
            raise AssertionError(f"missing table contract: {table}")
        definition = normalized.split(marker, 1)[1]
        return definition.split(") ENGINE=InnoDB", 1)[0]

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

    def test_prebackfill_uses_only_the_fixed_abbott_dataset_key(self):
        sql = (ROOT / "ops/sql/abbott_prebackfill_snapshot.sql").read_text()
        self.assertNotIn("abbott_portal", sql)
        self.assertGreaterEqual(sql.count("'abbott'"), 4)
        self.assertNotRegex(sql, r"@abbott_dataset_key")

    def test_snapshot_checksum_idempotency_is_scoped_by_source_kind(self):
        snapshots = self._table_definition(
            self._primary_sql(), "portal_dataset_snapshots"
        )
        self.assertIn(
            "UNIQUE KEY uniq_dataset_snapshot_content "
            "(dataset_key, source_kind, content_sha256)",
            snapshots,
        )
        self.assertNotIn(
            "UNIQUE KEY uniq_dataset_snapshot_content (dataset_key, content_sha256)",
            snapshots,
        )

    def test_snapshot_status_is_import_lifecycle_not_activation(self):
        snapshots = self._table_definition(
            self._primary_sql(), "portal_dataset_snapshots"
        )
        status_match = re.search(r"import_status ENUM\(([^)]*)\)", snapshots)
        self.assertIsNotNone(status_match)
        self.assertEqual(
            re.findall(r"'([^']+)'", status_match.group(1)),
            ["registered", "importing", "imported", "rejected"],
        )
        self.assertNotRegex(snapshots, r"(?i)\b(active|retired)\b")

    def test_content_catalog_preserves_source_lookup_grains(self):
        catalog = self._table_definition(
            self._primary_sql(), "portal_content_catalog"
        )
        for column in (
            "normalized_url TEXT DEFAULT NULL",
            "normalized_url_hash CHAR(64) DEFAULT NULL",
            "normalized_path TEXT DEFAULT NULL",
            "page_title VARCHAR(1000) NOT NULL",
            "material_type VARCHAR(128) DEFAULT NULL",
            "source_slug VARCHAR(1000) DEFAULT NULL",
            "source_slug_hash CHAR(64) DEFAULT NULL",
            "source_row_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, catalog)
        for key in (
            "UNIQUE KEY uniq_content_release_source_row "
            "(canonical_release_id, source_snapshot_id, source_row_fingerprint)",
            "KEY idx_content_release_title_type "
            "(canonical_release_id, page_title(191), material_type)",
            "KEY idx_content_release_slug "
            "(canonical_release_id, source_slug_hash)",
        ):
            self.assertIn(key, catalog)

    def test_workbook_registration_events_have_a_source_faithful_catalog(self):
        catalog = self._table_definition(self._primary_sql(), "portal_event_catalog")
        for column in (
            "event_title VARCHAR(1000) NOT NULL",
            "direction_key VARCHAR(500) DEFAULT NULL",
            "registration_url TEXT DEFAULT NULL",
            "registration_url_hash CHAR(64) DEFAULT NULL",
            "access_label VARCHAR(500) DEFAULT NULL",
            "source_row_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, catalog)
        self.assertIn(
            "UNIQUE KEY uniq_event_catalog_source_row "
            "(canonical_release_id, source_snapshot_id, source_row_fingerprint)",
            catalog,
        )

    def test_general_material_catalog_preserves_url_lookup(self):
        materials = self._table_definition(
            self._primary_sql(), "portal_general_materials"
        )
        for column in (
            "normalized_url TEXT DEFAULT NULL",
            "normalized_url_hash CHAR(64) DEFAULT NULL",
            "normalized_path TEXT DEFAULT NULL",
            "normalized_path_hash CHAR(64) DEFAULT NULL",
        ):
            self.assertIn(column, materials)
        self.assertIn(
            "KEY idx_general_material_url "
            "(canonical_release_id, normalized_url_hash)",
            materials,
        )

    def test_bitrix_page_schema_preserves_builder_aggregate_fields(self):
        facts = self._table_definition(
            self._private_sql(), "report_bd_private.portal_bitrix_page_facts"
        )
        for column in (
            "material_type_hint VARCHAR(500) DEFAULT NULL",
            "guests BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "logged_in_hits BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "anonymous_hits BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "logged_in_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "anonymous_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "entry_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "exit_sessions BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "avg_session_duration_seconds DECIMAL(18,6) DEFAULT NULL",
            "top_utm_source VARCHAR(500) DEFAULT NULL",
            "top_utm_medium VARCHAR(500) DEFAULT NULL",
            "top_utm_campaign VARCHAR(500) DEFAULT NULL",
        ):
            self.assertIn(column, facts)

    def test_private_journeys_allow_anonymous_lossless_ordered_events(self):
        journeys = self._table_definition(
            self._private_sql(), "report_bd_private.portal_bitrix_journeys_private"
        )
        for column in (
            "raw_user_id TEXT DEFAULT NULL",
            "raw_user_id_hash CHAR(64) DEFAULT NULL",
            "protected_visit_id TEXT NOT NULL",
            "protected_visit_id_hash CHAR(64) NOT NULL",
            "source_event_id TEXT DEFAULT NULL",
            "source_event_id_hash CHAR(64) DEFAULT NULL",
            "event_sequence INT UNSIGNED NOT NULL",
            "event_at DATETIME NOT NULL",
            "normalized_path TEXT NOT NULL",
            "event_kind VARCHAR(128) NOT NULL",
            "source_row_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, journeys)
        self.assertIn(
            "UNIQUE KEY uniq_private_bitrix_visit_sequence "
            "(canonical_release_id, source_snapshot_id, protected_visit_id_hash, event_sequence)",
            journeys,
        )

    def test_protected_identifiers_are_text_and_private_only(self):
        primary = self._primary_sql().lower()
        private = self._private_sql()
        for identifier in (
            "raw_user_id",
            "protected_visit_id",
            "source_event_id",
        ):
            self.assertNotIn(identifier, primary)
        self.assertNotRegex(private, r"(?i)(raw_user_id|protected_visit_id|source_event_id)\s+(BIGINT|INT|VARCHAR)")
        self.assertNotRegex(private, r"(?i)CAST\s*\([^)]*AS\s+UNSIGNED")

    def test_aggregate_journey_transitions_are_primary_and_release_scoped(self):
        transitions = self._table_definition(
            self._primary_sql(), "portal_bitrix_journey_transitions"
        )
        for column in (
            "canonical_release_id BIGINT UNSIGNED NOT NULL",
            "source_snapshot_id BIGINT UNSIGNED NOT NULL",
            "report_date DATE NOT NULL",
            "from_path TEXT NOT NULL",
            "from_path_hash CHAR(64) NOT NULL",
            "to_path TEXT NOT NULL",
            "to_path_hash CHAR(64) NOT NULL",
            "transition_count BIGINT UNSIGNED NOT NULL DEFAULT 0",
        ):
            self.assertIn(column, transitions)
        self.assertNotRegex(
            transitions, r"(?i)(raw_user_id|protected_visit_id|source_event_id)"
        )
        self.assertIn(
            "UNIQUE KEY uniq_bitrix_transition_release "
            "(canonical_release_id, source_snapshot_id, analytics_account_id, "
            "report_date, from_path_hash, to_path_hash)",
            transitions,
        )

    def test_importer_and_runtime_reader_roles_are_distinct(self):
        sql = self._normalized(self._private_sql())
        for role in (
            "reportingdash_abbott_importer_role",
            "reportingdash_abbott_runtime_reader_role",
        ):
            self.assertIn(f"'{role}'", sql)

        importer = "TO 'reportingdash_abbott_importer_role';"
        runtime = "TO 'reportingdash_abbott_runtime_reader_role';"
        self.assertIn(
            "GRANT SELECT ON report_bd.portal_data_releases " + importer,
            sql,
        )
        self.assertIn(
            "GRANT UPDATE (source_snapshot_ids) ON report_bd.portal_data_releases "
            + importer,
            sql,
        )
        self.assertIn(
            "GRANT SELECT, INSERT ON report_bd.portal_dataset_snapshots " + importer,
            sql,
        )
        self.assertIn(
            "GRANT UPDATE (import_status, imported_row_count, rejected_row_count, "
            "manifest_json, imported_at) ON report_bd.portal_dataset_snapshots "
            + importer,
            sql,
        )
        for table in (
            "portal_content_catalog",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_bitrix_journey_transitions",
        ):
            self.assertIn(
                f"GRANT SELECT, INSERT ON report_bd.{table} {importer}", sql
            )
        for table in (
            "portal_user_directions_private",
            "portal_bitrix_page_facts",
            "portal_bitrix_journeys_private",
        ):
            self.assertIn(
                "GRANT SELECT, INSERT ON "
                f"report_bd_private.{table} {importer}",
                sql,
            )

        for table in (
            "portal_data_releases",
            "portal_active_data_releases",
            "portal_dataset_snapshots",
            "portal_content_catalog",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_bitrix_journey_transitions",
        ):
            self.assertIn(f"GRANT SELECT ON report_bd.{table} {runtime}", sql)
        for table in (
            "canonical_fact_metrika_user_behavior_daily",
            "portal_user_directions_private",
            "portal_bitrix_page_facts",
            "portal_bitrix_journeys_private",
        ):
            self.assertIn(
                f"GRANT SELECT ON report_bd_private.{table} {runtime}", sql
            )

    def test_runtime_reader_cannot_write_and_importer_cannot_activate(self):
        sql = self._normalized(self._private_sql())
        grant_statements = re.findall(r"GRANT .*?;", sql, flags=re.IGNORECASE)
        runtime_grants = [
            grant
            for grant in grant_statements
            if "TO 'reportingdash_abbott_runtime_reader_role'" in grant
        ]
        self.assertGreater(len(runtime_grants), 0)
        for grant in runtime_grants:
            self.assertRegex(grant, r"^GRANT SELECT ON ")

        importer_grants = [
            grant
            for grant in grant_statements
            if "TO 'reportingdash_abbott_importer_role'" in grant
        ]
        self.assertGreater(len(importer_grants), 0)
        self.assertFalse(
            any("portal_active_data_releases" in grant for grant in importer_grants)
        )

    def test_collector_role_does_not_import_workbook_or_bitrix_snapshots(self):
        sql = self._normalized(self._private_sql())
        collector_grants = [
            grant
            for grant in re.findall(r"GRANT .*?;", sql, flags=re.IGNORECASE)
            if "TO 'reportingdash_abbott_collector_role'" in grant
        ]
        for table in (
            "portal_dataset_snapshots",
            "portal_content_catalog",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_user_directions_private",
            "portal_bitrix_page_facts",
            "portal_bitrix_journeys_private",
            "portal_bitrix_journey_transitions",
        ):
            self.assertFalse(any(table in grant for grant in collector_grants))


if __name__ == "__main__":
    unittest.main()
