import datetime as dt
import inspect
import unittest
from unittest.mock import patch


class FakeCursor:
    def __init__(self, events, *, fail_on_close=False, fail_on_executemany=False):
        self.events = events
        self.fail_on_close = fail_on_close
        self.fail_on_executemany = fail_on_executemany

    def execute(self, sql, params):
        self.events.append(("execute", sql, params))

    def executemany(self, sql, rows):
        self.events.append(("executemany", sql, rows))
        if self.fail_on_executemany:
            raise RuntimeError("query insert failed")

    def close(self):
        self.events.append(("cursor_close",))
        if self.fail_on_close:
            raise RuntimeError("cursor close failed")


class FakeConnection:
    def __init__(self, *, fail_on_close=False, fail_on_cursor=False, fail_on_executemany=False):
        self.events = []
        self.fail_on_cursor = fail_on_cursor
        self.cursor_instance = FakeCursor(
            self.events,
            fail_on_close=fail_on_close,
            fail_on_executemany=fail_on_executemany,
        )
        self.commit_calls = 0
        self.rollback_calls = 0

    def cursor(self):
        self.events.append(("cursor",))
        if self.fail_on_cursor:
            raise RuntimeError("cursor acquisition failed")
        return self.cursor_instance

    def commit(self):
        self.commit_calls += 1
        self.events.append(("commit",))

    def rollback(self):
        self.rollback_calls += 1
        self.events.append(("rollback",))

    def close(self):
        self.events.append(("connection_close",))

import requests


def http_error(status_code: int):
    response = requests.Response()
    response.status_code = status_code
    response._content = b'{"error":"bad request"}'
    return requests.HTTPError(f"{status_code} Client Error", response=response)


class YandexWebmasterCanonicalTests(unittest.TestCase):
    def setUp(self):
        self.summary_row = {
            "source_key": "yandex_webmaster",
            "analytics_account_id": "66624469",
            "host_id": "https:zaruku.ru:443",
            "report_date": "2026-07-13",
            "device_type": "ALL",
            "impressions": 100,
            "clicks": 7,
            "ctr": 7.0,
            "average_position": 3.5,
            "raw_payload": "{}",
            "ingestion_run_id": 42,
        }
        self.query_rows = [
            {
                **self.summary_row,
                "query_hash": "query-hash",
                "query_id": "q1",
                "query": "за руку помощь",
                "position": 3.5,
            }
        ]

    def test_replace_webmaster_day_rows_deletes_before_inserts_and_commits_once(self):
        from fetch_yandex_webmaster_canonical import (
            WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL,
            WEBMASTER_QUERY_UPSERT_SQL,
            WEBMASTER_SUMMARY_UPSERT_SQL,
            replace_webmaster_day_rows,
        )

        connection = FakeConnection()
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            rows_written = replace_webmaster_day_rows(self.query_rows, self.summary_row)

        self.assertEqual(rows_written, 2)
        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.rollback_calls, 0)
        self.assertEqual(
            connection.events,
            [
                ("cursor",),
                (
                    "execute",
                    WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL,
                    (
                        self.summary_row["source_key"],
                        self.summary_row["analytics_account_id"],
                        self.summary_row["host_id"],
                        self.summary_row["report_date"],
                        self.summary_row["device_type"],
                    ),
                ),
                ("executemany", WEBMASTER_QUERY_UPSERT_SQL, self.query_rows),
                ("execute", WEBMASTER_SUMMARY_UPSERT_SQL, self.summary_row),
                ("commit",),
                ("cursor_close",),
                ("connection_close",),
            ],
        )

    def test_replace_webmaster_day_rows_supports_an_empty_query_list(self):
        from fetch_yandex_webmaster_canonical import (
            WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL,
            WEBMASTER_SUMMARY_UPSERT_SQL,
            replace_webmaster_day_rows,
        )

        connection = FakeConnection()
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            rows_written = replace_webmaster_day_rows([], self.summary_row)

        self.assertEqual(rows_written, 1)
        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.rollback_calls, 0)
        self.assertEqual(
            connection.events,
            [
                ("cursor",),
                (
                    "execute",
                    WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL,
                    (
                        self.summary_row["source_key"],
                        self.summary_row["analytics_account_id"],
                        self.summary_row["host_id"],
                        self.summary_row["report_date"],
                        self.summary_row["device_type"],
                    ),
                ),
                ("execute", WEBMASTER_SUMMARY_UPSERT_SQL, self.summary_row),
                ("commit",),
                ("cursor_close",),
                ("connection_close",),
            ],
        )

    def test_replace_webmaster_day_rows_rolls_back_on_insert_failure(self):
        from fetch_yandex_webmaster_canonical import replace_webmaster_day_rows

        connection = FakeConnection(fail_on_executemany=True)
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "query insert failed"):
                replace_webmaster_day_rows(self.query_rows, self.summary_row)

        self.assertEqual(connection.commit_calls, 0)
        self.assertEqual(connection.rollback_calls, 1)
        self.assertEqual(connection.events[-3:], [("rollback",), ("cursor_close",), ("connection_close",)])

    def test_replace_webmaster_day_rows_closes_connection_when_cursor_acquisition_fails(self):
        from fetch_yandex_webmaster_canonical import replace_webmaster_day_rows

        connection = FakeConnection(fail_on_cursor=True)
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "cursor acquisition failed"):
                replace_webmaster_day_rows(self.query_rows, self.summary_row)

        self.assertEqual(connection.commit_calls, 0)
        self.assertEqual(connection.rollback_calls, 1)
        self.assertEqual(connection.events, [("cursor",), ("rollback",), ("connection_close",)])

    def test_replace_webmaster_day_rows_closes_connection_when_cursor_close_fails(self):
        from fetch_yandex_webmaster_canonical import replace_webmaster_day_rows

        connection = FakeConnection(fail_on_close=True)
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "cursor close failed"):
                replace_webmaster_day_rows(self.query_rows, self.summary_row)

        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.events[-2:], [("cursor_close",), ("connection_close",)])

    def test_collection_dates_default_to_yesterday_plus_three_day_lag(self):
        from fetch_yandex_webmaster_canonical import collection_dates

        self.assertEqual(
            collection_dates(dt.date(2026, 7, 14), lag_days=3),
            ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13"],
        )

    def test_fetch_query_rows_raises_when_reported_count_exceeds_maximum(self):
        from fetch_yandex_webmaster_canonical import MAX_QUERY_ROWS, fetch_query_rows

        page = [{"query_id": f"q{index}"} for index in range(500)]
        with patch(
            "fetch_yandex_webmaster_canonical.request_with_retry",
            return_value={"queries": page, "count": MAX_QUERY_ROWS + 1},
        ) as request:
            with self.assertRaisesRegex(
                RuntimeError,
                "incomplete Yandex Webmaster query response.*100001.*100000",
            ):
                fetch_query_rows(
                    "token",
                    "user-id",
                    "https:zaruku.ru:443",
                    "2026-07-13",
                    "ALL",
                    42,
                )

        self.assertEqual(request.call_count, MAX_QUERY_ROWS // 500)

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
        self.assertIn("ingestion_run_id = VALUES(ingestion_run_id)", WEBMASTER_PAGE_UPSERT_SQL)

    def test_latest_page_facts_lag_error_soft_fails_only_for_latest_400(self):
        from fetch_yandex_webmaster_canonical import is_latest_page_facts_lag_error

        days = ["2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"]

        self.assertTrue(is_latest_page_facts_lag_error(http_error(400), "2026-07-18", days))
        self.assertFalse(is_latest_page_facts_lag_error(http_error(400), "2026-07-17", days))
        self.assertFalse(is_latest_page_facts_lag_error(http_error(403), "2026-07-18", days))

    def test_fetch_page_rows_uses_url_query_analytics_with_pagination(self):
        from fetch_yandex_webmaster_canonical import fetch_page_rows

        payload = {
            "count": 1,
            "text_indicator_to_statistics": [{"text_indicator": {"type": "URL", "value": "/help/"}}],
        }
        with patch("fetch_yandex_webmaster_canonical.request_with_retry", return_value=payload) as request_with_retry:
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

    def test_collect_writes_page_facts_alongside_query_snapshot(self):
        import fetch_yandex_webmaster_canonical as collector

        source = inspect.getsource(collector.collect)
        self.assertIn("fetch_page_rows", source)
        self.assertIn("normalize_query_analytics_url_rows", source)
        self.assertIn("replace_webmaster_day_rows", source)
        self.assertIn("upsert_webmaster_page_rows", source)
        self.assertIn("len(raw_queries) + len(raw_pages)", source)


if __name__ == "__main__":
    unittest.main()
