import datetime as dt
import hashlib
import inspect
import unittest
from unittest import mock

import requests


class YandexWebmasterCanonicalTests(unittest.TestCase):
    def test_collection_dates_default_to_yesterday_plus_three_day_lag(self):
        from fetch_yandex_webmaster_canonical import collection_dates

        self.assertEqual(
            collection_dates(dt.date(2026, 7, 14), lag_days=3),
            ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13"],
        )

    def test_normalize_popular_query_rows_builds_daily_canonical_rows(self):
        from fetch_yandex_webmaster_canonical import normalize_popular_query_rows

        rows = normalize_popular_query_rows(
            {
                "queries": [
                    {
                        "query_id": "q1",
                        "query_text": "за руку помощь",
                        "indicators": {
                            "TOTAL_SHOWS": "100",
                            "TOTAL_CLICKS": "7",
                            "AVG_SHOW_POSITION": "3.5",
                        },
                    }
                ]
            },
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-13",
            device_type="ALL",
            run_id=42,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["query"], "за руку помощь")
        self.assertEqual(rows[0]["impressions"], 100)
        self.assertEqual(rows[0]["clicks"], 7)
        self.assertEqual(rows[0]["ctr"], 7.0)
        self.assertEqual(rows[0]["position"], 3.5)
        self.assertEqual(rows[0]["query_hash"], "70c225bec59cbc5ed84ab304b43ad119302303917409cb1c2a16060892b8e741")

    def test_normalize_summary_row_calculates_ctr_and_position(self):
        from fetch_yandex_webmaster_canonical import normalize_summary_row

        row = normalize_summary_row(
            {
                "text_indicator_to_statistics": [
                    {
                        "statistics": [
                            {"field": "IMPRESSIONS", "value": 200},
                            {"field": "CLICKS", "value": 10},
                            {"field": "POSITION", "value": 4.2},
                        ]
                    }
                ]
            },
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-13",
            device_type="ALL",
            run_id=42,
        )

        self.assertEqual(row["impressions"], 200)
        self.assertEqual(row["clicks"], 10)
        self.assertEqual(row["ctr"], 5.0)
        self.assertEqual(row["average_position"], 4.2)

    def test_normalize_summary_from_query_rows_calculates_weighted_position(self):
        from fetch_yandex_webmaster_canonical import normalize_summary_from_query_rows

        row = normalize_summary_from_query_rows(
            [
                {"impressions": 100, "clicks": 10, "position": 2},
                {"impressions": 300, "clicks": 15, "position": 6},
            ],
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-13",
            device_type="ALL",
            run_id=42,
        )

        self.assertEqual(row["impressions"], 400)
        self.assertEqual(row["clicks"], 25)
        self.assertEqual(row["ctr"], 6.25)
        self.assertEqual(row["average_position"], 5)
        self.assertIn("search-queries/popular", row["raw_payload"])

    def test_upsert_queries_is_idempotent_by_host_date_query_hash(self):
        from fetch_yandex_webmaster_canonical import WEBMASTER_QUERY_UPSERT_SQL

        self.assertIn("canonical_fact_webmaster_queries_daily", WEBMASTER_QUERY_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", WEBMASTER_QUERY_UPSERT_SQL)
        self.assertIn("query_hash", WEBMASTER_QUERY_UPSERT_SQL)

    def test_page_upsert_targets_canonical_daily_page_facts(self):
        from fetch_yandex_webmaster_canonical import WEBMASTER_PAGE_UPSERT_SQL

        self.assertIn("canonical_fact_webmaster_pages_daily", WEBMASTER_PAGE_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", WEBMASTER_PAGE_UPSERT_SQL)
        self.assertIn("page_hash", WEBMASTER_PAGE_UPSERT_SQL)
        self.assertIn("ingestion_run_id = VALUES(ingestion_run_id)", WEBMASTER_PAGE_UPSERT_SQL)

    def test_normalize_query_analytics_url_rows_builds_page_facts(self):
        from fetch_yandex_webmaster_canonical import normalize_query_analytics_url_rows

        rows = normalize_query_analytics_url_rows(
            {
                "text_indicator_to_statistics": [{
                    "text_indicator": {"type": "URL", "value": "https://zaruku.ru/help/"},
                    "popular_complementary_indicator": {"type": "QUERY", "value": "за руку помощь"},
                    "statistics": [
                        {"date": "2026-07-13", "field": "IMPRESSIONS", "value": 20},
                        {"date": "2026-07-13", "field": "CLICKS", "value": 2},
                        {"date": "2026-07-13", "field": "POSITION", "value": 4.5},
                    ],
                }]
            },
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-13",
            device_type="ALL",
            run_id=42,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["page_url"], "https://zaruku.ru/help/")
        self.assertEqual(
            rows[0]["page_hash"],
            hashlib.sha256(b"https://zaruku.ru/help/").hexdigest(),
        )
        self.assertEqual(rows[0]["popular_query_text"], "за руку помощь")
        self.assertEqual(rows[0]["ctr"], 10.0)
        self.assertEqual(rows[0]["ingestion_run_id"], 42)

    @mock.patch("fetch_yandex_webmaster_canonical.request_with_retry")
    def test_fetch_page_rows_uses_url_query_analytics_with_pagination(self, request_with_retry):
        from fetch_yandex_webmaster_canonical import fetch_page_rows

        request_with_retry.return_value = {
            "count": 1,
            "text_indicator_to_statistics": [{"text_indicator": {"type": "URL", "value": "/help/"}}],
        }

        rows = fetch_page_rows("token", "user", "https:zaruku.ru:443", "2026-07-13", "ALL", 42)

        self.assertEqual(len(rows), 1)
        _, path = request_with_retry.call_args.args[:2]
        self.assertTrue(path.endswith("/query-analytics/list"))
        self.assertEqual(request_with_retry.call_args.kwargs["method"], "POST")
        body = request_with_retry.call_args.kwargs["body"]
        self.assertEqual(body["text_indicator"], "URL")
        self.assertEqual(body["sort_by_date"]["date"], "2026-07-13")
        self.assertEqual(body["offset"], 0)
        self.assertEqual(body["limit"], 500)

    def test_latest_page_http_400_is_skipped_only_for_latest_selected_day(self):
        from fetch_yandex_webmaster_canonical import is_latest_page_facts_lag_error

        response = requests.Response()
        response.status_code = 400
        latest_error = requests.HTTPError(response=response)

        self.assertTrue(
            is_latest_page_facts_lag_error(
                latest_error,
                "2026-07-13",
                ["2026-07-12", "2026-07-13"],
            )
        )
        self.assertFalse(
            is_latest_page_facts_lag_error(
                latest_error,
                "2026-07-12",
                ["2026-07-12", "2026-07-13"],
            )
        )
        self.assertFalse(
            is_latest_page_facts_lag_error(
                RuntimeError("not an HTTP error"),
                "2026-07-13",
                ["2026-07-12", "2026-07-13"],
            )
        )

    def test_collect_writes_page_facts_and_accounts_for_page_rows(self):
        import fetch_yandex_webmaster_canonical as collector

        source = inspect.getsource(collector.collect)
        self.assertIn("fetch_page_rows", source)
        self.assertIn("normalize_query_analytics_url_rows", source)
        self.assertIn("upsert_webmaster_page_rows", source)
        self.assertIn("len(raw_queries) + len(raw_pages)", source)


if __name__ == "__main__":
    unittest.main()
