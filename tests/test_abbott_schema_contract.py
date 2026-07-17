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

    def test_collector_role_can_record_runs_and_read_configuration(self):
        sql = self._normalized(self._private_sql())
        for contract in (
            "GRANT SELECT ON report_bd.yandex_metrika_names TO 'reportingdash_abbott_collector_role';",
            "GRANT SELECT ON report_bd.canonical_source_account_collection_settings TO 'reportingdash_abbott_collector_role';",
            "GRANT SELECT, INSERT, UPDATE ON report_bd.canonical_source_accounts TO 'reportingdash_abbott_collector_role';",
            "GRANT SELECT, INSERT, UPDATE ON report_bd.canonical_collector_runs TO 'reportingdash_abbott_collector_role';",
            "GRANT INSERT ON report_bd.canonical_collector_run_events TO 'reportingdash_abbott_collector_role';",
        ):
            self.assertIn(contract, sql)

    def test_release_operator_can_transition_metadata_but_not_write_facts(self):
        sql = self._normalized(self._private_sql())
        role = "'reportingdash_abbott_release_operator_role'"
        for table in (
            "portal_data_releases",
            "portal_active_data_releases",
            "portal_dataset_snapshots",
            "portal_migration_validation_runs",
        ):
            self.assertRegex(sql, rf"GRANT [^;]+ ON report_bd\.{table} TO {role};")
        operator_grants = re.findall(
            rf"GRANT ([^;]+) ON ([^;]+) TO {role};", sql
        )
        for privileges, table in operator_grants:
            if "fact" in table or "coverage" in table:
                self.assertEqual(privileges, "SELECT")

    def test_release_operator_has_no_returning_or_raw_user_fact_access(self):
        sql = self._normalized(self._private_sql())
        role = "TO 'reportingdash_abbott_release_operator_role';"
        for table in (
            "report_bd.canonical_fact_metrika_returning_pages_daily",
            "report_bd_private.canonical_fact_metrika_user_behavior_daily",
        ):
            self.assertNotIn(f"ON {table} {role}", sql)

    def test_release_source_import_execution_is_release_scoped_and_auditable(self):
        sql = self._normalized(self._primary_sql())
        table = sql.split(
            "CREATE TABLE IF NOT EXISTS portal_release_source_imports", 1
        )[1].split(") ENGINE=InnoDB", 1)[0]
        for column in (
            "canonical_release_id BIGINT UNSIGNED NOT NULL",
            "source_snapshot_id BIGINT UNSIGNED NOT NULL",
            "source_kind VARCHAR(64) NOT NULL",
            "code_revision VARCHAR(64) NOT NULL",
            "import_status ENUM('imported', 'rejected') NOT NULL",
            "imported_row_count BIGINT UNSIGNED NOT NULL",
            "rejected_row_count BIGINT UNSIGNED NOT NULL",
            "imported_at DATETIME NOT NULL",
        ):
            self.assertIn(column, table)
        self.assertIn(
            "UNIQUE KEY uniq_release_source_import (canonical_release_id, source_snapshot_id)",
            table,
        )
        grants = self._normalized(self._private_sql())
        self.assertIn(
            "GRANT SELECT ON report_bd.portal_release_source_imports TO 'reportingdash_abbott_release_operator_role';",
            grants,
        )
        self.assertNotRegex(
            grants,
            r"GRANT [^;]*DELETE[^;]* ON report_bd\.portal_release_source_imports",
        )

    def test_validation_evidence_batches_are_retryable_and_append_only(self):
        sql = self._normalized(self._primary_sql())
        table = sql.split(
            "CREATE TABLE IF NOT EXISTS portal_migration_validation_runs", 1
        )[1].split(") ENGINE=InnoDB", 1)[0]
        self.assertIn("validation_run_id CHAR(36) NOT NULL", table)
        self.assertIn("validation_run_completed_at DATETIME DEFAULT NULL", table)
        self.assertIn(
            "UNIQUE KEY uniq_release_validation_control (canonical_release_id, baseline_snapshot_id, validation_run_id, control_name)",
            table,
        )
        grants = self._normalized(self._private_sql())
        self.assertNotRegex(
            grants,
            r"GRANT [^;]*DELETE[^;]* ON report_bd\.portal_migration_validation_runs",
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
            "access_label VARCHAR(500) DEFAULT NULL",
            "is_active TINYINT(1) NOT NULL DEFAULT 1",
            "source_sheet VARCHAR(255) NOT NULL",
            "source_row_ordinal BIGINT UNSIGNED NOT NULL",
            "source_row_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, catalog)
        for key in (
            "UNIQUE KEY uniq_content_release_source_row "
            "(canonical_release_id, source_snapshot_id, source_sheet, source_row_ordinal)",
            "KEY idx_content_release_title_type "
            "(canonical_release_id, page_title(191), material_type)",
            "KEY idx_content_release_slug "
            "(canonical_release_id, source_slug_hash)",
        ):
            self.assertIn(key, catalog)

    def test_content_lookup_projection_is_hashed_release_scoped_and_auditable(self):
        projection = self._table_definition(
            self._primary_sql(), "portal_content_lookup_projection"
        )
        for column in (
            "lookup_kind ENUM('title', 'slug', 'path') NOT NULL",
            "lookup_key_hash CHAR(64) NOT NULL",
            "candidate_count BIGINT UNSIGNED NOT NULL",
            "metadata_signature_count BIGINT UNSIGNED NOT NULL",
            "resolution_status ENUM('unique', 'identical_collapsed', 'ambiguous') NOT NULL",
            "selected_source_row_fingerprint CHAR(64) DEFAULT NULL",
            "group_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, projection)
        self.assertIn(
            "UNIQUE KEY uniq_content_lookup_release_key "
            "(canonical_release_id, source_snapshot_id, lookup_kind, lookup_key_hash)",
            projection,
        )
        for forbidden in ("page_title", "source_slug", "normalized_path"):
            self.assertNotIn(forbidden, projection)
        self.assertNotIn("title_type", projection)
        self.assertIn(
            "ALTER TABLE portal_content_lookup_projection MODIFY COLUMN "
            "lookup_kind ENUM(''title'', ''slug'', ''path'') NOT NULL",
            self._normalized(self._primary_sql()),
        )

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

    def test_primary_bitrix_page_projection_is_aggregate_safe(self):
        facts = self._table_definition(
            self._primary_sql(), "portal_bitrix_page_facts"
        )
        for column in (
            "canonical_release_id BIGINT UNSIGNED NOT NULL",
            "source_snapshot_id BIGINT UNSIGNED NOT NULL",
            "analytics_account_id VARCHAR(128) NOT NULL DEFAULT 'abbott_bitrix'",
            "report_date DATE NOT NULL",
            "normalized_path TEXT NOT NULL",
            "normalized_path_hash CHAR(64) NOT NULL",
            "material_id VARCHAR(255) DEFAULT NULL",
            "material_type_hint VARCHAR(500) DEFAULT NULL",
            "pageviews BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "sessions BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "users BIGINT UNSIGNED NOT NULL DEFAULT 0",
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
            "source_row_fingerprint CHAR(64) NOT NULL",
        ):
            self.assertIn(column, facts)
        self.assertNotRegex(
            facts, r"(?i)(raw_user_id|protected_visit_id|source_event_id)"
        )
        self.assertIn(
            "UNIQUE KEY uniq_bitrix_page_release_row "
            "(canonical_release_id, source_snapshot_id, analytics_account_id, "
            "report_date, source_row_fingerprint)",
            facts,
        )

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
            "(canonical_release_id, source_snapshot_id, analytics_account_id, "
            "report_date, protected_visit_id_hash, event_sequence)",
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
        self.assertIn(
            "GRANT SELECT, INSERT, UPDATE ON report_bd.portal_release_source_imports "
            + importer,
            sql,
        )
        for table in (
            "portal_content_catalog",
            "portal_content_lookup_projection",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_bitrix_page_facts",
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
            "portal_content_lookup_projection",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_bitrix_page_facts",
            "portal_bitrix_journey_transitions",
        ):
            self.assertIn(f"GRANT SELECT ON report_bd.{table} {runtime}", sql)
        self.assertIn(f"GRANT SELECT ON report_bd.dashboards {runtime}", sql)
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
            "portal_content_lookup_projection",
            "portal_general_materials",
            "portal_event_catalog",
            "portal_user_directions_private",
            "portal_bitrix_page_facts",
            "portal_bitrix_journeys_private",
            "portal_bitrix_journey_transitions",
        ):
            self.assertFalse(any(table in grant for grant in collector_grants))

    def test_lookup_projection_grants_preserve_least_privilege(self):
        sql = self._normalized(self._private_sql())
        projection_grants = [
            grant
            for grant in re.findall(r"GRANT .*?;", sql, flags=re.IGNORECASE)
            if "portal_content_lookup_projection" in grant
        ]
        self.assertEqual(len(projection_grants), 2)
        self.assertTrue(any(
            grant.startswith("GRANT SELECT, INSERT ON ")
            and "TO 'reportingdash_abbott_importer_role'" in grant
            for grant in projection_grants
        ))
        self.assertTrue(any(
            grant.startswith("GRANT SELECT ON ")
            and "TO 'reportingdash_abbott_runtime_reader_role'" in grant
            for grant in projection_grants
        ))
        self.assertFalse(any(
            "collector_role" in grant or "release_operator_role" in grant
            for grant in projection_grants
        ))

    def test_task7_has_idempotent_alters_for_preexisting_task1_tables(self):
        primary = self._normalized(self._primary_sql())
        private = self._normalized(self._private_sql())
        self.assertIn("information_schema.COLUMNS", primary)
        self.assertIn("information_schema.STATISTICS", primary)
        self.assertIn("information_schema.COLUMNS", private)
        self.assertIn("information_schema.STATISTICS", private)

        for contract in (
            "ALTER TABLE portal_dataset_snapshots DROP INDEX uniq_dataset_snapshot_content",
            "ALTER TABLE portal_dataset_snapshots ADD UNIQUE INDEX "
            "uniq_dataset_snapshot_content (dataset_key, source_kind, content_sha256)",
            "ALTER TABLE portal_content_catalog ADD COLUMN source_slug VARCHAR(1000) DEFAULT NULL",
            "ALTER TABLE portal_content_catalog ADD COLUMN access_label VARCHAR(500) DEFAULT NULL",
            "ALTER TABLE portal_content_catalog ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1",
            "ALTER TABLE portal_content_catalog ADD COLUMN source_sheet VARCHAR(255) DEFAULT NULL",
            "ALTER TABLE portal_content_catalog ADD COLUMN source_row_ordinal BIGINT UNSIGNED DEFAULT NULL",
            "ALTER TABLE portal_content_catalog ADD UNIQUE INDEX uniq_content_release_source_row (canonical_release_id, source_snapshot_id, source_sheet, source_row_ordinal)",
            "ALTER TABLE portal_general_materials ADD COLUMN normalized_url TEXT DEFAULT NULL",
        ):
            self.assertIn(contract, primary)

        for contract in (
            "ALTER TABLE report_bd_private.portal_bitrix_page_facts",
            "ADD COLUMN guests BIGINT UNSIGNED NOT NULL DEFAULT 0",
            "ALTER TABLE report_bd_private.portal_bitrix_journeys_private MODIFY COLUMN raw_user_id TEXT DEFAULT NULL",
            "ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD COLUMN protected_visit_id_hash CHAR(64) DEFAULT NULL",
            "ALTER TABLE report_bd_private.portal_bitrix_journeys_private ADD UNIQUE INDEX "
            "uniq_private_bitrix_visit_sequence (canonical_release_id, source_snapshot_id, "
            "analytics_account_id, report_date, protected_visit_id_hash, event_sequence)",
        ):
            self.assertIn(contract, private)

        self.assertGreaterEqual(primary.count("PREPARE stmt FROM @sql"), 6)
        self.assertGreaterEqual(private.count("PREPARE stmt FROM @sql"), 6)


if __name__ == "__main__":
    unittest.main()
