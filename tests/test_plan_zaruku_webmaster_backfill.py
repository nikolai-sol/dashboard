import json
import unittest
from datetime import date, datetime

import plan_zaruku_webmaster_backfill as planner


class ZarukuBackfillPlannerTests(unittest.TestCase):
    def test_parser_has_only_read_only_range_and_output_options(self):
        parser = planner.build_parser()
        option_strings = {
            option
            for action in parser._actions
            for option in action.option_strings
        }
        self.assertIn("--date-from", option_strings)
        self.assertIn("--date-to", option_strings)
        self.assertIn("--json", option_strings)
        self.assertNotIn("--execute", option_strings)
        self.assertNotIn("--run", option_strings)
        self.assertNotIn("--backfill", option_strings)
        with self.assertRaises(SystemExit):
            parser.parse_args([])

    def test_date_range_requires_ordered_non_future_dates(self):
        self.assertEqual(
            planner.validate_date_range("2026-07-01", "2026-07-27", today=date(2026, 7, 28)),
            (date(2026, 7, 1), date(2026, 7, 27)),
        )
        with self.assertRaisesRegex(ValueError, "date-from must not be after date-to"):
            planner.validate_date_range("2026-07-27", "2026-07-01", today=date(2026, 7, 28))
        with self.assertRaisesRegex(ValueError, "future"):
            planner.validate_date_range("2026-07-01", "2026-07-29", today=date(2026, 7, 28))

    def test_missing_and_target_dates_are_oldest_first_without_duplicates(self):
        coverage = [
            {"layer": "webmaster_queries", "report_date": date(2026, 7, 1), "row_count": 10},
            {"layer": "webmaster_queries", "report_date": date(2026, 7, 3), "row_count": 10},
            {"layer": "webmaster_pages", "report_date": date(2026, 7, 1), "row_count": 10},
            {"layer": "webmaster_pages", "report_date": date(2026, 7, 2), "row_count": 10},
        ]
        partial_scope = {
            "dates": ["2026-07-03"],
            "distinct_date_count": 1,
            "layers": {},
        }
        result = planner.derive_backfill_scope(
            date(2026, 7, 1),
            date(2026, 7, 3),
            coverage,
            partial_scope,
        )
        self.assertEqual(result["missing_query_dates"], ["2026-07-02"])
        self.assertEqual(result["missing_page_dates"], ["2026-07-03"])
        self.assertEqual(result["candidate_dates"], ["2026-07-02", "2026-07-03"])

    def test_provenance_rows_are_json_safe_and_deterministically_sorted(self):
        rows = [
            {
                "layer": "webmaster_pages",
                "report_date": date(2026, 7, 16),
                "ingestion_run_id": 12,
                "run_type": "cron",
                "run_status": "failed",
                "row_count": 942,
                "first_created_at": datetime(2026, 7, 17, 6),
                "last_created_at": datetime(2026, 7, 17, 6, 2),
            },
            {
                "layer": "webmaster_queries",
                "report_date": date(2026, 7, 14),
                "ingestion_run_id": 11,
                "run_type": "cron",
                "run_status": "failed",
                "row_count": 755,
                "first_created_at": datetime(2026, 7, 15, 6),
                "last_created_at": datetime(2026, 7, 15, 6, 1),
            },
        ]
        normalized = planner.normalize_rows(rows)
        self.assertEqual(normalized[0]["report_date"], "2026-07-14")
        self.assertEqual(normalized[0]["first_created_at"], "2026-07-15T06:00:00")
        json.dumps(normalized, sort_keys=True)

    def test_build_plan_executes_only_selects_and_reuses_failed_lineage_scope(self):
        class RecordingCursor:
            def __init__(self):
                self.calls = []
                self.result = []

            def execute(self, sql, params=None):
                self.calls.append((sql, params))
                normalized = " ".join(sql.split())
                if "r.status = 'failed'" in sql and "canonical_fact_gsc_queries_daily" in sql:
                    self.result = [
                        {
                            "source_key": "yandex_webmaster",
                            "layer": "webmaster_queries",
                            "report_date": date(2026, 7, 2),
                            "ingestion_run_id": 11,
                            "run_type": "cron",
                            "run_status": "failed",
                            "row_count": 20,
                        }
                    ]
                elif "non_castable_run_id" in sql:
                    self.result = []
                elif "AS first_created_at" in sql:
                    self.result = [
                        {
                            "layer": "webmaster_queries",
                            "report_date": date(2026, 7, 2),
                            "ingestion_run_id": 11,
                            "run_type": "cron",
                            "run_status": "failed",
                            "row_count": 20,
                            "first_created_at": datetime(2026, 7, 3, 6),
                            "last_created_at": datetime(2026, 7, 3, 6, 1),
                        }
                    ]
                elif "AS collector_min_id" in sql:
                    self.result = [{
                        "collector_min_id": 1,
                        "collector_max_id": 99,
                        "collector_min_started_at": datetime(2026, 3, 15, 6),
                        "collector_max_started_at": datetime(2026, 7, 28, 6),
                        "fact_min_date": date(2026, 3, 17),
                        "fact_max_date": date(2026, 7, 27),
                        "fact_min_run_id": 2,
                    }]
                elif "'webmaster_queries' AS layer" in sql and "first_created_at" not in sql:
                    self.result = [
                        {"layer": "webmaster_queries", "report_date": date(2026, 7, 1), "row_count": 10},
                        {"layer": "webmaster_pages", "report_date": date(2026, 7, 1), "row_count": 10},
                    ]
                else:
                    raise AssertionError(normalized)

            def fetchall(self):
                return self.result

            def fetchone(self):
                return self.result[0] if self.result else None

        cursor = RecordingCursor()
        result = planner.build_plan(cursor, date(2026, 7, 1), date(2026, 7, 2))

        self.assertEqual(result["partial_scope"]["dates"], ["2026-07-02"])
        self.assertEqual(result["scope"]["candidate_dates"], ["2026-07-02"])
        self.assertEqual(result["lineage_defects"]["row_count"], 0)
        self.assertEqual(result["provenance"][0]["ingestion_run_id"], 11)
        self.assertTrue(cursor.calls)
        for sql, _params in cursor.calls:
            self.assertRegex(sql.lstrip().upper(), r"^(SELECT|WITH)\b")


if __name__ == "__main__":
    unittest.main()
