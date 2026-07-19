import datetime as dt
import unittest

import requests


def http_error(status_code: int):
    response = requests.Response()
    response.status_code = status_code
    response._content = b'{"error":"bad request"}'
    return requests.HTTPError(f"{status_code} Client Error", response=response)


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

    def test_normalize_query_analytics_url_rows_extracts_requested_day(self):
        from fetch_yandex_webmaster_canonical import normalize_query_analytics_url_rows

        rows = normalize_query_analytics_url_rows(
            {
                "text_indicator_to_statistics": [
                    {
                        "text_indicator": {
                            "type": "URL",
                            "value": "/rak-molochnoj-zhelezy/reabilitaciya/",
                        },
                        "popular_complementary_indicator": {
                            "type": "QUERY",
                            "value": "реабилитация после рмж",
                        },
                        "statistics": [
                            {"date": "2026-07-14", "field": "IMPRESSIONS", "value": 39},
                            {"date": "2026-07-14", "field": "CLICKS", "value": 3},
                            {"date": "2026-07-14", "field": "CTR", "value": 7.7},
                            {"date": "2026-07-14", "field": "POSITION", "value": 22.1},
                            {"date": "2026-07-15", "field": "IMPRESSIONS", "value": 54},
                            {"date": "2026-07-15", "field": "CLICKS", "value": 5},
                            {"date": "2026-07-15", "field": "POSITION", "value": 18.4},
                        ],
                    },
                    {
                        "text_indicator": {
                            "type": "QUERY",
                            "value": "ignore me",
                        },
                        "statistics": [
                            {"date": "2026-07-15", "field": "IMPRESSIONS", "value": 100},
                        ],
                    },
                ]
            },
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-15",
            device_type="ALL",
            run_id=42,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["page_url"], "/rak-molochnoj-zhelezy/reabilitaciya/")
        self.assertEqual(rows[0]["popular_query_text"], "реабилитация после рмж")
        self.assertEqual(rows[0]["impressions"], 54)
        self.assertEqual(rows[0]["clicks"], 5)
        self.assertEqual(rows[0]["ctr"], 9.259259)
        self.assertEqual(rows[0]["average_position"], 18.4)
        self.assertEqual(rows[0]["page_hash"], "a402d873f74e6301bfcaeaa42bc5b0aa15e756c6767c7b493fdcaf514c6ddfbf")

    def test_upsert_queries_is_idempotent_by_host_date_query_hash(self):
        from fetch_yandex_webmaster_canonical import WEBMASTER_QUERY_UPSERT_SQL

        self.assertIn("canonical_fact_webmaster_queries_daily", WEBMASTER_QUERY_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", WEBMASTER_QUERY_UPSERT_SQL)
        self.assertIn("query_hash", WEBMASTER_QUERY_UPSERT_SQL)

    def test_upsert_pages_is_idempotent_by_host_date_page_hash(self):
        from fetch_yandex_webmaster_canonical import WEBMASTER_PAGE_UPSERT_SQL

        self.assertIn("canonical_fact_webmaster_pages_daily", WEBMASTER_PAGE_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", WEBMASTER_PAGE_UPSERT_SQL)
        self.assertIn("page_hash", WEBMASTER_PAGE_UPSERT_SQL)

    def test_latest_page_facts_lag_error_soft_fails_only_for_latest_400(self):
        from fetch_yandex_webmaster_canonical import is_latest_page_facts_lag_error

        days = ["2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"]

        self.assertTrue(is_latest_page_facts_lag_error(http_error(400), "2026-07-18", days))
        self.assertFalse(is_latest_page_facts_lag_error(http_error(400), "2026-07-17", days))
        self.assertFalse(is_latest_page_facts_lag_error(http_error(403), "2026-07-18", days))


if __name__ == "__main__":
    unittest.main()
