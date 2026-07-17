import unittest
from unittest.mock import patch


class FakeCursor:
    def __init__(self, events, *, fail_on_close=False, fail_on_page_insert=False):
        self.events = events
        self.fail_on_close = fail_on_close
        self.fail_on_page_insert = fail_on_page_insert

    def execute(self, sql, params):
        self.events.append(("execute", sql, params))

    def executemany(self, sql, rows):
        self.events.append(("executemany", sql, rows))
        if self.fail_on_page_insert and "canonical_fact_gsc_pages_daily" in sql:
            raise RuntimeError("page insert failed")

    def close(self):
        self.events.append(("cursor_close",))
        if self.fail_on_close:
            raise RuntimeError("cursor close failed")


class FakeConnection:
    def __init__(self, *, fail_on_cursor=False, fail_on_page_insert=False):
        self.events = []
        self.fail_on_cursor = fail_on_cursor
        self.cursor_instance = FakeCursor(
            self.events,
            fail_on_page_insert=fail_on_page_insert,
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


class GoogleSearchConsoleCanonicalTests(unittest.TestCase):
    def setUp(self):
        self.summary_row = {
            "source_key": "google_search_console",
            "property_url": "https://zaruku.ru/",
            "report_date": "2026-07-13",
            "device_type": "DESKTOP",
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
                "query": "за руку помощь",
                "position": 3.5,
            }
        ]
        self.page_rows = [
            {
                **self.summary_row,
                "page_hash": "page-hash",
                "page": "https://zaruku.ru/",
                "position": 3.5,
            }
        ]

    def test_normalize_query_device_rows_builds_daily_canonical_rows(self):
        from fetch_google_search_console_canonical import normalize_search_analytics_rows

        rows = normalize_search_analytics_rows(
            {
                "rows": [
                    {
                        "keys": ["За Руку Помощь", "DESKTOP"],
                        "clicks": 7,
                        "impressions": 100,
                        "ctr": 0.07,
                        "position": 3.5,
                    }
                ]
            },
            ["query", "device"],
            source_key="google_search_console",
            property_url="https://zaruku.ru/",
            report_date="2026-07-13",
            run_id=42,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_key"], "google_search_console")
        self.assertEqual(rows[0]["property_url"], "https://zaruku.ru/")
        self.assertEqual(rows[0]["report_date"], "2026-07-13")
        self.assertEqual(rows[0]["device_type"], "DESKTOP")
        self.assertEqual(rows[0]["query"], "За Руку Помощь")
        self.assertEqual(rows[0]["impressions"], 100)
        self.assertEqual(rows[0]["clicks"], 7)
        self.assertEqual(rows[0]["ctr"], 7.0)
        self.assertEqual(rows[0]["position"], 3.5)
        self.assertEqual(rows[0]["query_hash"], "70c225bec59cbc5ed84ab304b43ad119302303917409cb1c2a16060892b8e741")

    def test_normalize_page_device_rows_hashes_pages_and_calculates_ctr_percent(self):
        from fetch_google_search_console_canonical import normalize_search_analytics_rows

        rows = normalize_search_analytics_rows(
            {
                "rows": [
                    {
                        "keys": ["https://zaruku.ru/catalog/?utm_source=x", "MOBILE"],
                        "clicks": 3,
                        "impressions": 40,
                        "ctr": 0.01,
                        "position": 8.25,
                    }
                ]
            },
            ["page", "device"],
            source_key="google_search_console",
            property_url="https://zaruku.ru/",
            report_date="2026-07-13",
            run_id=42,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["device_type"], "MOBILE")
        self.assertEqual(rows[0]["page"], "https://zaruku.ru/catalog/?utm_source=x")
        self.assertEqual(rows[0]["ctr"], 7.5)
        self.assertEqual(rows[0]["position"], 8.25)
        self.assertEqual(rows[0]["page_hash"], "2c730850c8e4e79db6769114c41a40b800373cb02abcab1ec32921dadf7fbf65")

    def test_normalize_summary_rows_supports_empty_device_snapshot(self):
        from fetch_google_search_console_canonical import normalize_summary_rows

        rows = normalize_summary_rows(
            {"rows": []},
            source_key="google_search_console",
            property_url="https://zaruku.ru/",
            report_date="2026-07-13",
            run_id=42,
            devices=["DESKTOP"],
        )

        self.assertEqual(
            rows,
            [
                {
                    "source_key": "google_search_console",
                    "property_url": "https://zaruku.ru/",
                    "report_date": "2026-07-13",
                    "device_type": "DESKTOP",
                    "impressions": 0,
                    "clicks": 0,
                    "ctr": None,
                    "average_position": None,
                    "raw_payload": '{"derived_from": "empty_search_analytics_device_snapshot", "device_type": "DESKTOP"}',
                    "ingestion_run_id": 42,
                }
            ],
        )

    def test_replace_gsc_day_rows_deletes_both_snapshots_then_writes_and_commits_once(self):
        from fetch_google_search_console_canonical import (
            GSC_PAGE_SNAPSHOT_DELETE_SQL,
            GSC_PAGE_UPSERT_SQL,
            GSC_QUERY_SNAPSHOT_DELETE_SQL,
            GSC_QUERY_UPSERT_SQL,
            GSC_SUMMARY_UPSERT_SQL,
            replace_gsc_day_rows,
        )

        connection = FakeConnection()
        with patch(
            "fetch_google_search_console_canonical.get_db_connection",
            return_value=connection,
        ):
            rows_written = replace_gsc_day_rows(self.query_rows, self.page_rows, self.summary_row)

        identity = (
            self.summary_row["source_key"],
            self.summary_row["property_url"],
            self.summary_row["report_date"],
            self.summary_row["device_type"],
        )
        self.assertEqual(rows_written, 3)
        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.rollback_calls, 0)
        self.assertEqual(
            connection.events,
            [
                ("cursor",),
                ("execute", GSC_QUERY_SNAPSHOT_DELETE_SQL, identity),
                ("execute", GSC_PAGE_SNAPSHOT_DELETE_SQL, identity),
                ("executemany", GSC_QUERY_UPSERT_SQL, self.query_rows),
                ("executemany", GSC_PAGE_UPSERT_SQL, self.page_rows),
                ("execute", GSC_SUMMARY_UPSERT_SQL, self.summary_row),
                ("commit",),
                ("cursor_close",),
                ("connection_close",),
            ],
        )

    def test_replace_gsc_day_rows_supports_empty_query_and_page_lists(self):
        from fetch_google_search_console_canonical import (
            GSC_PAGE_SNAPSHOT_DELETE_SQL,
            GSC_QUERY_SNAPSHOT_DELETE_SQL,
            GSC_SUMMARY_UPSERT_SQL,
            replace_gsc_day_rows,
        )

        connection = FakeConnection()
        with patch(
            "fetch_google_search_console_canonical.get_db_connection",
            return_value=connection,
        ):
            rows_written = replace_gsc_day_rows([], [], self.summary_row)

        identity = (
            self.summary_row["source_key"],
            self.summary_row["property_url"],
            self.summary_row["report_date"],
            self.summary_row["device_type"],
        )
        self.assertEqual(rows_written, 1)
        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.rollback_calls, 0)
        self.assertEqual(
            connection.events,
            [
                ("cursor",),
                ("execute", GSC_QUERY_SNAPSHOT_DELETE_SQL, identity),
                ("execute", GSC_PAGE_SNAPSHOT_DELETE_SQL, identity),
                ("execute", GSC_SUMMARY_UPSERT_SQL, self.summary_row),
                ("commit",),
                ("cursor_close",),
                ("connection_close",),
            ],
        )

    def test_replace_gsc_day_rows_rolls_back_on_insert_failure(self):
        from fetch_google_search_console_canonical import replace_gsc_day_rows

        connection = FakeConnection(fail_on_page_insert=True)
        with patch(
            "fetch_google_search_console_canonical.get_db_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "page insert failed"):
                replace_gsc_day_rows(self.query_rows, self.page_rows, self.summary_row)

        self.assertEqual(connection.commit_calls, 0)
        self.assertEqual(connection.rollback_calls, 1)
        self.assertEqual(connection.events[-3:], [("rollback",), ("cursor_close",), ("connection_close",)])

    def test_fetch_search_analytics_uses_read_only_api_request(self):
        from fetch_google_search_console_canonical import (
            GSC_API_BASE,
            SEARCH_ANALYTICS_ROW_LIMIT,
            fetch_search_analytics,
        )

        with patch(
            "fetch_google_search_console_canonical.request_with_retry",
            return_value={"rows": [{"keys": ["q"], "clicks": 1, "impressions": 2, "ctr": 0.5, "position": 1}]},
        ) as request:
            payload = fetch_search_analytics("access-token", "https://zaruku.ru/", "2026-07-13", ["query"])

        self.assertEqual(payload["rows"][0]["keys"], ["q"])
        request.assert_called_once_with(
            "POST",
            f"{GSC_API_BASE}/sites/https%3A%2F%2Fzaruku.ru%2F/searchAnalytics/query",
            access_token="access-token",
            json_body={
                "startDate": "2026-07-13",
                "endDate": "2026-07-13",
                "dimensions": ["query"],
                "rowLimit": SEARCH_ANALYTICS_ROW_LIMIT,
                "startRow": 0,
            },
            run_id=None,
        )

    def test_fetch_search_analytics_refuses_row_limit_sized_responses_before_replacement(self):
        from fetch_google_search_console_canonical import SEARCH_ANALYTICS_ROW_LIMIT, fetch_search_analytics

        limit_rows = [
            {"keys": [f"query-{index}"], "clicks": 0, "impressions": 1, "ctr": 0, "position": 10}
            for index in range(SEARCH_ANALYTICS_ROW_LIMIT)
        ]
        with patch(
            "fetch_google_search_console_canonical.request_with_retry",
            return_value={"rows": limit_rows},
        ):
            with self.assertRaisesRegex(RuntimeError, "rowLimit-sized Google Search Console response"):
                fetch_search_analytics("access-token", "https://zaruku.ru/", "2026-07-13", ["query"])

    def test_sql_targets_daily_gsc_canonical_tables(self):
        from fetch_google_search_console_canonical import GSC_PAGE_UPSERT_SQL, GSC_QUERY_UPSERT_SQL, GSC_SUMMARY_UPSERT_SQL

        self.assertIn("canonical_fact_gsc_queries_daily", GSC_QUERY_UPSERT_SQL)
        self.assertIn("canonical_fact_gsc_pages_daily", GSC_PAGE_UPSERT_SQL)
        self.assertIn("canonical_fact_gsc_summary_daily", GSC_SUMMARY_UPSERT_SQL)


if __name__ == "__main__":
    unittest.main()
