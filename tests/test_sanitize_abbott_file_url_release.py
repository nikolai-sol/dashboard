import unittest


class AbbottFileUrlReleaseSqlTests(unittest.TestCase):
    def test_visit_copy_excludes_local_file_start_and_end_case_insensitively(self):
        from sanitize_abbott_file_url_release import build_copy_sql

        sql = " ".join(
            build_copy_sql(
                "report_bd_private",
                "canonical_fact_metrika_visits",
                ("id", "canonical_release_id", "start_url", "end_url"),
            ).split()
        )

        self.assertNotIn("`id`", sql)
        self.assertIn("LOWER(LTRIM(`source`.`start_url`)) LIKE 'file://%'", sql)
        self.assertIn("LOWER(LTRIM(`source`.`end_url`)) LIKE 'file://%'", sql)
        self.assertIn("AND NOT (", sql)

    def test_non_visit_copy_has_no_url_filter(self):
        from sanitize_abbott_file_url_release import build_copy_sql

        sql = build_copy_sql(
            "report_bd",
            "canonical_fact_metrika_site_analytics_daily",
            ("id", "canonical_release_id", "sessions"),
        )

        self.assertNotIn("file://", sql)
        self.assertIn("%s AS `canonical_release_id`", sql)

    def test_copy_inventory_never_contains_active_pointer(self):
        from sanitize_abbott_file_url_release import ALL_COPY_TABLES

        tables = {table for _schema, table in ALL_COPY_TABLES}
        self.assertNotIn("portal_active_data_releases", tables)
        self.assertNotIn("portal_data_releases", tables)


class AbbottFileUrlReleaseControlTests(unittest.TestCase):
    def test_exact_controls_accept_only_expected_sanitized_difference(self):
        from sanitize_abbott_file_url_release import validate_sanitized_counts

        validate_sanitized_counts(
            predecessor_visits=100,
            candidate_visits=82,
            predecessor_local_file_visits=18,
            candidate_local_file_visits=0,
            expected_local_file_visits=18,
        )

    def test_exact_controls_reject_remaining_local_file_visit(self):
        from sanitize_abbott_file_url_release import (
            SanitizationError,
            validate_sanitized_counts,
        )

        with self.assertRaisesRegex(SanitizationError, "sanitization controls"):
            validate_sanitized_counts(
                predecessor_visits=100,
                candidate_visits=83,
                predecessor_local_file_visits=18,
                candidate_local_file_visits=1,
                expected_local_file_visits=18,
            )

    def test_sanitization_receipt_includes_health_summary_event(self):
        from sanitize_abbott_file_url_release import _record_receipt

        class Cursor:
            lastrowid = 77

            def __init__(self):
                self.calls = []

            def execute(self, sql, params):
                self.calls.append((" ".join(sql.split()), params))

        cursor = Cursor()
        receipt_id = _record_receipt(
            cursor,
            candidate_release_id=14,
            excluded_visits=18,
            date_from="2026-01-01",
            date_to="2026-08-07",
            predecessor_visits=100,
            candidate_visits=82,
        )

        self.assertEqual(receipt_id, 77)
        self.assertEqual(len(cursor.calls), 2)
        self.assertIn("canonical_collector_run_events", cursor.calls[1][0])
        self.assertIn('"canonical_release_id":14', cursor.calls[1][1][-1])
        self.assertIn('"counter_id":"90602537"', cursor.calls[1][1][-1])

    def test_fully_filtered_success_day_fails_closed(self):
        from sanitize_abbott_file_url_release import (
            SanitizationError,
            _require_no_fully_excluded_day,
        )

        class Cursor:
            def execute(self, sql, params):
                self.sql = " ".join(sql.split())
                self.params = params

            def fetchone(self):
                return (1,)

        cursor = Cursor()
        with self.assertRaisesRegex(SanitizationError, "empty a successful"):
            _require_no_fully_excluded_day(cursor, predecessor_release_id=13)
        self.assertIn("collection_status = 'success'", cursor.sql)
        self.assertIn("COALESCE(kept.kept_visits, 0) = 0", cursor.sql)

    def test_exact_controls_reject_changed_predecessor_count(self):
        from sanitize_abbott_file_url_release import (
            SanitizationError,
            validate_sanitized_counts,
        )

        with self.assertRaisesRegex(SanitizationError, "sanitization controls"):
            validate_sanitized_counts(
                predecessor_visits=100,
                candidate_visits=82,
                predecessor_local_file_visits=17,
                candidate_local_file_visits=0,
                expected_local_file_visits=18,
            )


if __name__ == "__main__":
    unittest.main()
