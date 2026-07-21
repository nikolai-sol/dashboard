import datetime as dt
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests


class GoogleSearchConsoleCanonicalTests(unittest.TestCase):
    def test_collection_dates_default_to_yesterday_plus_three_day_backfill(self):
        from fetch_gsc_canonical import collection_dates

        self.assertEqual(
            collection_dates(dt.date(2026, 7, 17), backfill_days=3),
            ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"],
        )

    def test_query_hash_matches_existing_canonical_gsc_rows(self):
        from fetch_gsc_canonical import query_hash

        self.assertEqual(
            query_hash(
                "с чем можно спутать рак легких на кт",
                "https://zaruku.ru/rak-lyogkogo/vsegda-li-opuhol-v-legkih-eto-rak/",
                "rus",
                "MOBILE",
            ),
            "ba9fdc14e600168df62ee06a6d3c2bd0585750e4e8b7f46c10e04935c8d01cea",
        )

    def test_normalize_search_analytics_rows_builds_new_canonical_contract(self):
        from fetch_gsc_canonical import normalize_search_analytics_rows

        rows = normalize_search_analytics_rows(
            {
                "rows": [
                    {
                        "keys": [
                            "заруку",
                            "https://zaruku.ru/",
                            "rus",
                            "MOBILE",
                        ],
                        "impressions": 100,
                        "clicks": 7,
                        "ctr": 0.07,
                        "position": 3.25,
                    }
                ]
            },
            analytics_account_id="66624469",
            report_date="2026-07-15",
            run_id=42,
        )

        self.assertEqual(
            rows,
            [
                {
                    "source_key": "google_search_console",
                    "analytics_account_id": "66624469",
                    "report_date": "2026-07-15",
                    "query": "заруку",
                    "page": "https://zaruku.ru/",
                    "country": "rus",
                    "device": "MOBILE",
                    "impressions": 100,
                    "clicks": 7,
                    "ctr": 0.07,
                    "position": 3.25,
                    "query_hash": "04d49829a618ce47f5d91496deaf8a5a38b96f5c9ab83daaa6ac0f0aa71dbf13",
                    "raw_payload": '{"keys": ["заруку", "https://zaruku.ru/", "rus", "MOBILE"], "impressions": 100, "clicks": 7, "ctr": 0.07, "position": 3.25}',
                    "ingestion_run_id": 42,
                }
            ],
        )

    def test_upsert_sql_uses_new_contract_and_only_query_hash_for_compatibility(self):
        from fetch_gsc_canonical import GSC_QUERY_UPSERT_SQL

        self.assertIn("canonical_fact_gsc_queries_daily", GSC_QUERY_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", GSC_QUERY_UPSERT_SQL)
        self.assertIn("query_hash", GSC_QUERY_UPSERT_SQL)
        self.assertNotIn("property_url", GSC_QUERY_UPSERT_SQL)
        self.assertNotIn("query_text", GSC_QUERY_UPSERT_SQL)
        self.assertNotIn("device_type", GSC_QUERY_UPSERT_SQL)
        self.assertNotIn("average_position", GSC_QUERY_UPSERT_SQL)

    def test_build_search_analytics_body_supports_optional_gsc_layers(self):
        from fetch_gsc_canonical import build_search_analytics_body

        self.assertEqual(
            build_search_analytics_body(
                "2026-07-15",
                ["searchAppearance", "page", "country", "device"],
                search_type="web",
                start_row=25000,
            ),
            {
                "startDate": "2026-07-15",
                "endDate": "2026-07-15",
                "dimensions": ["searchAppearance", "page", "country", "device"],
                "rowLimit": 25000,
                "startRow": 25000,
                "dataState": "final",
                "type": "web",
            },
        )

    def test_search_appearance_rows_use_canonical_feature_contract(self):
        from fetch_gsc_canonical import normalize_search_appearance_rows, search_appearance_hash

        rows = normalize_search_appearance_rows(
            {
                "rows": [
                    {
                        "keys": ["RICH_RESULTS", "https://zaruku.ru/", "rus", "MOBILE"],
                        "impressions": 50,
                        "clicks": 5,
                        "ctr": 0.1,
                        "position": 2.4,
                    }
                ]
            },
            analytics_account_id="66624469",
            report_date="2026-07-15",
            search_type="web",
            run_id=43,
        )

        self.assertEqual(rows[0]["search_appearance"], "RICH_RESULTS")
        self.assertEqual(rows[0]["search_type"], "web")
        self.assertEqual(rows[0]["page"], "https://zaruku.ru/")
        self.assertEqual(rows[0]["country"], "rus")
        self.assertEqual(rows[0]["device"], "MOBILE")
        self.assertEqual(
            rows[0]["feature_hash"],
            search_appearance_hash("web", "RICH_RESULTS", "https://zaruku.ru/", "rus", "MOBILE"),
        )

    def test_search_type_rows_use_canonical_type_contract(self):
        from fetch_gsc_canonical import normalize_search_type_rows, search_type_hash

        rows = normalize_search_type_rows(
            {
                "rows": [
                    {
                        "keys": ["https://zaruku.ru/rak-molochnoj-zhelezy/", "rus", "DESKTOP"],
                        "impressions": 80,
                        "clicks": 4,
                        "ctr": 0.05,
                        "position": 6.1,
                    }
                ]
            },
            analytics_account_id="66624469",
            report_date="2026-07-15",
            search_type="image",
            run_id=44,
        )

        self.assertEqual(rows[0]["search_type"], "image")
        self.assertEqual(rows[0]["page"], "https://zaruku.ru/rak-molochnoj-zhelezy/")
        self.assertEqual(rows[0]["country"], "rus")
        self.assertEqual(rows[0]["device"], "DESKTOP")
        self.assertEqual(
            rows[0]["type_hash"],
            search_type_hash("image", "https://zaruku.ru/rak-molochnoj-zhelezy/", "rus", "DESKTOP"),
        )

    def test_optional_gsc_upserts_do_not_write_legacy_columns(self):
        from fetch_gsc_canonical import GSC_SEARCH_APPEARANCE_UPSERT_SQL, GSC_SEARCH_TYPE_UPSERT_SQL

        for sql in (GSC_SEARCH_APPEARANCE_UPSERT_SQL, GSC_SEARCH_TYPE_UPSERT_SQL):
            self.assertIn("ON DUPLICATE KEY UPDATE", sql)
            self.assertNotIn("property_url", sql)
            self.assertNotIn("query_text", sql)
            self.assertNotIn("device_type", sql)

    def test_optional_layer_http_error_is_recorded_for_run_status(self):
        import fetch_gsc_canonical as gsc

        response = requests.Response()
        response.status_code = 400
        failure = requests.HTTPError("bad optional dimension", response=response)
        optional_failures = []

        with patch.object(gsc, "request_with_retry", side_effect=failure), patch.object(
            gsc, "log_collector_event"
        ):
            rows = gsc.fetch_paginated_search_analytics_rows(
                "token",
                gsc.GscAccount("66624469", "https://zaruku.ru/"),
                "2026-07-20",
                72,
                dimensions=["searchAppearance", "page", "country", "device"],
                tolerate_layer_error=True,
                optional_failures=optional_failures,
            )

        self.assertEqual(rows, [])
        self.assertEqual(len(optional_failures), 1)
        self.assertEqual(optional_failures[0]["status_code"], 400)
        self.assertEqual(optional_failures[0]["day"], "2026-07-20")
        self.assertEqual(optional_failures[0]["dimensions"][0], "searchAppearance")

    def test_collect_finishes_partial_when_optional_layer_failed(self):
        import fetch_gsc_canonical as gsc

        args = SimpleNamespace(
            run_type="manual",
            force=True,
            date_from="2026-07-20",
            date_to="2026-07-20",
            backfill_days=3,
            account_id="66624469",
            site_url="https://zaruku.ru/",
        )
        finish = Mock()

        def appearance_failure(*_args, optional_failures=None, **_kwargs):
            optional_failures.append(
                {
                    "status_code": 400,
                    "site_url": "https://zaruku.ru/",
                    "day": "2026-07-20",
                    "search_type": "web",
                    "dimensions": ["searchAppearance", "page", "country", "device"],
                }
            )
            return []

        with patch.object(gsc, "start_run", return_value=72), patch.object(
            gsc, "finish_run", finish
        ), patch.object(gsc, "refresh_access_token", return_value="token"), patch.object(
            gsc,
            "configured_accounts",
            return_value=[gsc.GscAccount("66624469", "https://zaruku.ru/")],
        ), patch.object(gsc, "fetch_search_analytics_rows", return_value=[]), patch.object(
            gsc, "fetch_search_appearance_rows", side_effect=appearance_failure
        ), patch.object(gsc, "configured_search_types", return_value=[]), patch.object(
            gsc, "upsert_accounts"
        ), patch.object(gsc, "log_collector_event"):
            result = gsc.collect(args)

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["optional_failure_count"], 1)
        self.assertEqual(finish.call_args.args[1], "partial")
        self.assertEqual(finish.call_args.args[5], 1)

    def test_partial_cron_run_counts_as_completed_daily_quota(self):
        import inspect
        import fetch_gsc_canonical as gsc

        source = inspect.getsource(gsc.cron_run_already_completed)
        self.assertIn("IN ('success', 'partial')", source)


if __name__ == "__main__":
    unittest.main()
