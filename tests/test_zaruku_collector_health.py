import re
import json
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import zaruku_collector_health as health_module
from zaruku_collector_health import (
    LINEAGE_DEFECTS_SQL,
    PARTIAL_FACT_DATES_SQL,
    ZARUKU_DATA_LAG_DAYS,
    ZARUKU_SOURCES,
    build_lineage_defect_scope,
    build_partial_date_scope,
    build_zaruku_incidents,
    load_zaruku_health,
    normalize_query_page_pair_health,
)


ROOT = Path(__file__).resolve().parents[1]


def health_row(**overrides):
    row = {
        "source_key": "yandex_metrika",
        "label": "Яндекс Метрика",
        "expected_frequency_hours": 24,
        "run_status": "success",
        "run_id": 101,
        "run_type": "cron",
        "run_started_at": datetime(2026, 7, 28, 6, 12, tzinfo=timezone.utc),
        "run_finished_at": datetime(2026, 7, 28, 6, 14, tzinfo=timezone.utc),
        "rows_read": 100,
        "rows_written": 100,
        "max_data_date": date(2026, 7, 25),
        "data_lag_days": 3,
        "query_max_date": None,
        "page_max_date": None,
    }
    row.update(overrides)
    return row


class ZarukuCollectorHealthPolicyTests(unittest.TestCase):
    def test_python_lag_constant_matches_dashboard_typescript(self):
        source = (ROOT / "dashboard-next/src/lib/zaruku-seo.ts").read_text(encoding="utf-8")
        match = re.search(r"export const ZARUKU_DATA_LAG_DAYS\s*=\s*(\d+)", source)
        self.assertIsNotNone(match, "TypeScript lag constant declaration is missing")
        dashboard_value = int(match.group(1))
        self.assertEqual(
            ZARUKU_DATA_LAG_DAYS,
            dashboard_value,
            "Python zaruku_collector_health.py and dashboard-next/src/lib/zaruku-seo.ts lag constants diverged",
        )
        self.assertEqual(ZARUKU_DATA_LAG_DAYS, 3)

    def test_source_catalog_has_four_daily_collectors(self):
        self.assertEqual(
            list(ZARUKU_SOURCES),
            [
                "yandex_webmaster",
                "yandex_metrika",
                "yandex_metrika_returning",
                "google_search_console",
            ],
        )
        self.assertTrue(all(item["expected_frequency_hours"] == 24 for item in ZARUKU_SOURCES.values()))

    def test_daily_source_health_selects_metrika_cron_without_abbott_backfill(self):
        self.assertIn("source_key = 'yandex_metrika'", health_module._LATEST_RUNS_SQL)
        self.assertIn("run_mode = 'canonical_only'", health_module._LATEST_RUNS_SQL)
        self.assertIn("job_key = 'yandex_metrika_cron'", health_module._LATEST_RUNS_SQL)
        self.assertIn("source_key <> 'yandex_metrika'", health_module._LATEST_RUNS_SQL)
        self.assertIn("run_mode = 'daily'", health_module._LATEST_RUNS_SQL)
        self.assertNotIn("canonical_release", health_module._LATEST_RUNS_SQL)
        self.assertIn("job_key = 'yandex_webmaster:query_pages'", health_module.QUERY_PAGE_PAIR_HEALTH_SQL)

    def test_partial_sql_has_all_fact_layers_and_failed_run_definition(self):
        expected_tables = {
            "canonical_fact_site_analytics_daily",
            "canonical_fact_metrika_returning_pages_daily",
            "canonical_fact_gsc_queries_daily",
            "canonical_fact_webmaster_queries_daily",
            "canonical_fact_webmaster_summary_daily",
            "canonical_fact_webmaster_pages_daily",
        }
        for table in expected_tables:
            self.assertIn(table, PARTIAL_FACT_DATES_SQL)
        self.assertIn("66624469", PARTIAL_FACT_DATES_SQL)
        self.assertEqual(PARTIAL_FACT_DATES_SQL.count("r.status = 'failed'"), 6)
        self.assertIn("f.ingestion_run_id REGEXP '^[0-9]+$'", PARTIAL_FACT_DATES_SQL)
        self.assertIn("CAST(f.ingestion_run_id AS UNSIGNED)", PARTIAL_FACT_DATES_SQL)
        self.assertNotIn("rows_read > rows_written", PARTIAL_FACT_DATES_SQL)

    def test_lineage_sql_keeps_bad_gsc_ids_and_orphans_separate(self):
        self.assertIn("non_castable_run_id", LINEAGE_DEFECTS_SQL)
        self.assertIn("orphan_run_id", LINEAGE_DEFECTS_SQL)
        self.assertIn("missing_run_reference", LINEAGE_DEFECTS_SQL)
        self.assertIn("canonical_fact_gsc_queries_daily", LINEAGE_DEFECTS_SQL)
        self.assertIn("REGEXP '^[0-9]+$'", LINEAGE_DEFECTS_SQL)
        self.assertIn("CAST(f.ingestion_run_id AS UNSIGNED)", LINEAGE_DEFECTS_SQL)

    def test_returning_facts_use_the_deployed_analytics_account_column(self):
        self.assertNotIn("f.counter_id", PARTIAL_FACT_DATES_SQL)
        self.assertRegex(
            PARTIAL_FACT_DATES_SQL,
            r"FROM canonical_fact_metrika_returning_pages_daily AS f[\s\S]+?WHERE f\.analytics_account_id = '66624469'",
        )


class ZarukuCollectorHealthBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 28, 12, 0, tzinfo=timezone.utc)

    def incident_types(self, rows):
        return [row["incident_type"] for row in rows]

    def test_gsc_partial_normalizes_core_success_and_optional_http_failures(self):
        self.assertTrue(
            hasattr(health_module, "normalize_collection_status"),
            "normalize_collection_status must expose core/optional state",
        )
        status = health_module.normalize_collection_status(
            "google_search_console",
            "partial",
            8,
            json.dumps(
                [
                    {"status_code": 400, "day": "2026-07-24"},
                    {"status_code": 400, "day": "2026-07-25"},
                ]
            ),
        )

        self.assertEqual(status["core_status"], "success")
        self.assertEqual(status["optional_status"], "http_error")
        self.assertEqual(status["optional_failure_count"], 8)
        self.assertEqual(status["optional_http_statuses"], [400])

    def test_gsc_partial_with_malformed_summary_stays_sanitized_unknown(self):
        self.assertTrue(
            hasattr(health_module, "normalize_collection_status"),
            "normalize_collection_status must expose core/optional state",
        )
        status = health_module.normalize_collection_status(
            "google_search_console",
            "partial",
            1,
            "raw production diagnostic must not escape",
        )

        self.assertEqual(status["core_status"], "success")
        self.assertEqual(status["optional_status"], "unknown_error")
        self.assertEqual(status["optional_http_statuses"], [])
        self.assertNotIn("raw", repr(status))

    def test_recent_complete_query_page_pair_layer_is_healthy(self):
        layer = normalize_query_page_pair_health(
            {
                "run_id": 200,
                "run_status": "success",
                "selected_pages": 15,
                "covered_pages": 15,
                "zero_row_pages": 2,
                "pair_rows": 152,
                "max_report_date": date(2026, 7, 27),
                "last_success_at": self.now - timedelta(hours=12),
            },
            self.now,
        )

        self.assertEqual(layer["expected_frequency_hours"], 168)
        self.assertEqual(layer["covered_pages"], 15)
        self.assertEqual(layer["zero_row_pages"], 2)
        self.assertEqual(layer["status"], "healthy")

    def test_incomplete_query_page_pair_coverage_is_warning(self):
        layer = normalize_query_page_pair_health(
            {
                "run_id": 201,
                "run_status": "success",
                "selected_pages": 15,
                "covered_pages": 14,
                "zero_row_pages": 1,
                "pair_rows": 120,
                "last_success_at": self.now - timedelta(hours=12),
            },
            self.now,
        )

        self.assertEqual(layer["status"], "warning")
        self.assertEqual(layer["covered_pages"], 14)

    def test_failed_query_page_pair_run_is_failed_not_empty(self):
        layer = normalize_query_page_pair_health(
            {
                "run_id": 202,
                "run_status": "failed",
                "selected_pages": 15,
                "covered_pages": 0,
                "zero_row_pages": 0,
                "pair_rows": 0,
                "last_success_at": None,
            },
            self.now,
        )

        self.assertEqual(layer["status"], "failed")
        self.assertEqual(layer["covered_pages"], 0)

    def test_age_three_is_current_and_age_four_is_delayed(self):
        healthy = build_zaruku_incidents([health_row()], build_partial_date_scope([]), self.now)
        delayed = build_zaruku_incidents(
            [health_row(max_data_date=date(2026, 7, 24), data_lag_days=4)],
            build_partial_date_scope([]),
            self.now,
        )
        self.assertNotIn("data_lag", self.incident_types(healthy))
        self.assertIn("data_lag", self.incident_types(delayed))

    def test_heartbeat_uses_expected_frequency_not_fact_lag(self):
        stale_run = health_row(
            max_data_date=date(2026, 7, 27),
            data_lag_days=1,
            run_finished_at=self.now - timedelta(hours=25),
        )
        incidents = build_zaruku_incidents([stale_run], build_partial_date_scope([]), self.now)
        self.assertIn("heartbeat", self.incident_types(incidents))
        self.assertNotIn("data_lag", self.incident_types(incidents))

    def test_current_failed_run_is_run_failure_not_heartbeat(self):
        failed = health_row(
            run_status="failed",
            run_finished_at=self.now - timedelta(hours=25),
        )
        incidents = build_zaruku_incidents([failed], build_partial_date_scope([]), self.now)
        self.assertIn("run_failed", self.incident_types(incidents))
        self.assertNotIn("heartbeat", self.incident_types(incidents))

    def test_webmaster_two_day_layer_divergence_is_integrity_incident(self):
        webmaster = health_row(
            source_key="yandex_webmaster",
            label="Яндекс Вебмастер",
            max_data_date=date(2026, 7, 24),
            data_lag_days=4,
            query_max_date=date(2026, 7, 26),
            page_max_date=date(2026, 7, 24),
        )
        incidents = build_zaruku_incidents([webmaster], build_partial_date_scope([]), self.now)
        divergence = [row for row in incidents if row["incident_type"] == "layer_divergence"]
        self.assertEqual(len(divergence), 1)
        self.assertEqual(divergence[0]["details"]["difference_days"], 2)

    def test_partial_scope_counts_distinct_dates_rows_and_layers(self):
        scope = build_partial_date_scope(
            [
                {
                    "source_key": "yandex_webmaster",
                    "layer": "webmaster_queries",
                    "report_date": date(2026, 7, 14),
                    "ingestion_run_id": 1,
                    "run_type": "cron",
                    "run_status": "failed",
                    "row_count": 400,
                },
                {
                    "source_key": "yandex_webmaster",
                    "layer": "webmaster_queries",
                    "report_date": date(2026, 7, 14),
                    "ingestion_run_id": 2,
                    "run_type": "manual",
                    "run_status": "failed",
                    "row_count": 355,
                },
                {
                    "source_key": "yandex_webmaster",
                    "layer": "webmaster_pages",
                    "report_date": date(2026, 7, 16),
                    "ingestion_run_id": 3,
                    "run_type": "cron",
                    "run_status": "failed",
                    "row_count": 942,
                },
            ]
        )
        self.assertEqual(scope["distinct_date_count"], 2)
        self.assertEqual(scope["row_count"], 1697)
        self.assertEqual(scope["layer_count"], 2)
        self.assertEqual(scope["dates"], ["2026-07-14", "2026-07-16"])
        self.assertEqual(scope["layers"]["webmaster_queries"]["distinct_date_count"], 1)
        self.assertEqual(scope["layers"]["webmaster_queries"]["row_count"], 755)

    def test_lineage_defects_remain_outside_partial_scope(self):
        partial_scope = build_partial_date_scope([])
        lineage_scope = build_lineage_defect_scope(
            [
                {
                    "source_key": "google_search_console",
                    "layer": "gsc_queries",
                    "defect_type": "non_castable_run_id",
                    "row_count": 2,
                },
                {
                    "source_key": "yandex_webmaster",
                    "layer": "webmaster_pages",
                    "defect_type": "orphan_run_id",
                    "row_count": 1,
                },
            ]
        )
        self.assertEqual(partial_scope["row_count"], 0)
        self.assertEqual(lineage_scope["row_count"], 3)
        self.assertEqual(lineage_scope["by_type"]["non_castable_run_id"], 2)
        self.assertEqual(lineage_scope["by_type"]["orphan_run_id"], 1)

    def test_incident_keys_are_stable_and_day_scoped(self):
        row = health_row(max_data_date=date(2026, 7, 24), data_lag_days=4)
        first = build_zaruku_incidents([row], build_partial_date_scope([]), self.now)
        second = build_zaruku_incidents([dict(row)], build_partial_date_scope([]), self.now)
        self.assertEqual(first, second)
        self.assertTrue(first[0]["incident_key"].startswith("zaruku|2026-07-28|yandex_metrika|"))

    def test_health_loader_uses_older_webmaster_layer_date(self):
        class Cursor:
            def __init__(self):
                self.calls = []
                self.result = None

            def execute(self, sql, params=None):
                self.calls.append((sql, params))
                if "FROM canonical_collector_runs AS r" in sql:
                    self.result = [
                        {
                            "source_key": source_key,
                            "run_id": index,
                            "run_status": "success",
                            "run_type": "cron",
                            "run_started_at": datetime(2026, 7, 28, 6, tzinfo=timezone.utc),
                            "run_finished_at": datetime(2026, 7, 28, 7, tzinfo=timezone.utc),
                            "rows_read": 10,
                            "rows_written": 10,
                        }
                        for index, source_key in enumerate(ZARUKU_SOURCES, start=1)
                    ]
                elif "canonical_fact_webmaster_queries_daily" in sql:
                    self.result = {"query_max_date": date(2026, 7, 26), "page_max_date": date(2026, 7, 24)}
                elif "canonical_webmaster_query_page_coverage_daily" in sql:
                    self.result = {
                        "run_id": 20,
                        "run_status": "success",
                        "selected_pages": 15,
                        "covered_pages": 15,
                        "zero_row_pages": 2,
                        "pair_rows": 152,
                        "max_report_date": date(2026, 7, 26),
                        "last_success_at": datetime(2026, 7, 28, 7, tzinfo=timezone.utc),
                    }
                elif "canonical_fact_site_analytics_daily" in sql:
                    self.result = {"max_data_date": date(2026, 7, 27)}
                elif "canonical_fact_metrika_returning_pages_daily" in sql:
                    self.result = {"max_data_date": date(2026, 7, 26)}
                elif "canonical_fact_gsc_queries_daily" in sql:
                    self.result = {"max_data_date": date(2026, 7, 25)}
                else:
                    raise AssertionError(sql)

            def fetchall(self):
                return self.result

            def fetchone(self):
                return self.result

        cursor = Cursor()
        health = load_zaruku_health(cursor, self.now)

        self.assertEqual([row["source_key"] for row in health], list(ZARUKU_SOURCES))
        self.assertEqual(health[0]["query_max_date"], date(2026, 7, 26))
        self.assertEqual(health[0]["page_max_date"], date(2026, 7, 24))
        self.assertEqual(health[0]["max_data_date"], date(2026, 7, 24))
        self.assertEqual(health[0]["data_lag_days"], 4)
        self.assertEqual(health[0]["layers"]["query_page_pairs"]["status"], "healthy")
        self.assertEqual(health[0]["layers"]["query_page_pairs"]["covered_pages"], 15)
        self.assertTrue(all(call[0].lstrip().upper().startswith("SELECT") for call in cursor.calls))


if __name__ == "__main__":
    unittest.main()
