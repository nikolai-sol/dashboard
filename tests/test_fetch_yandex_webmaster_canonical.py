import datetime as dt
import inspect
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


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
        self.pair_rows = [
            {
                **self.summary_row,
                "query_hash": "query-hash",
                "page_hash": "page-hash",
                "query_text": "рак груди",
                "page_url": "/requested/",
            }
        ]
        self.pair_coverage = {
            "source_key": "yandex_webmaster",
            "analytics_account_id": "66624469",
            "host_id": "https:zaruku.ru:443",
            "report_date": "2026-07-13",
            "device_type": "ALL",
            "page_hash": "page-hash",
            "page_url": "/requested/",
            "row_count": 1,
            "ingestion_run_id": 42,
        }

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

    def test_collection_dates_use_two_day_floor_and_three_day_recollect_span(self):
        from fetch_yandex_webmaster_canonical import collection_dates

        self.assertEqual(
            collection_dates(dt.date(2026, 7, 14), lag_days=3),
            ["2026-07-10", "2026-07-11", "2026-07-12"],
        )

    def test_default_layer_remains_core(self):
        from fetch_yandex_webmaster_canonical import parse_args

        with patch("sys.argv", ["collector"]):
            args = parse_args()

        self.assertEqual(args.layers, "core")
        self.assertEqual(args.priority_limit, 30)

    def test_query_page_default_window_uses_seven_collectable_dates(self):
        from fetch_yandex_webmaster_canonical import selected_query_page_dates

        args = SimpleNamespace(date_from="", date_to="")

        self.assertEqual(
            selected_query_page_dates(args, anchor=dt.date(2026, 7, 14)),
            [
                "2026-07-06",
                "2026-07-07",
                "2026-07-08",
                "2026-07-09",
                "2026-07-10",
                "2026-07-11",
                "2026-07-12",
            ],
        )

    def test_priority_pages_keep_sections_first_deduplicate_and_cap_at_30(self):
        from fetch_yandex_webmaster_canonical import load_priority_query_pages

        pattern_rows = [
            {"section": f"/section-{index}/", "priority": 1}
            for index in range(15)
        ] + [{"section": "/section-0/", "priority": 2}]
        fill_rows = [
            {
                "page_url": "/section-0/" if index == 0 else f"/page-{index}/",
                "impressions": 100 - index,
                "clicks": 10 - min(index, 10),
            }
            for index in range(17)
        ]
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            pattern_rows,
            [{"week_from": dt.date(2026, 7, 20), "week_to": dt.date(2026, 7, 26)}],
            fill_rows,
        ]
        connection = MagicMock()
        connection.cursor.return_value = cursor
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            pages = load_priority_query_pages("66624469", limit=30)

        self.assertEqual(
            pages[:15],
            [f"/section-{index}/" for index in range(15)],
        )
        self.assertEqual(len(pages), 30)
        self.assertEqual(len(set(pages)), 30)
        self.assertNotIn("/page-0/", pages)
        connection.close.assert_called_once()

    def test_query_pages_layer_does_not_call_core_fetchers(self):
        import fetch_yandex_webmaster_canonical as collector

        args = SimpleNamespace(
            layers="query_pages",
            run_type="manual",
            force=False,
            priority_limit=15,
            account_id="66624469",
            domain="zaruku.ru",
            host_id="host",
            date_from="",
            date_to="",
        )
        account = collector.WebmasterAccount("66624469", "zaruku.ru", "host")
        pair_row = {
            **self.pair_rows[0],
            "report_date": "2026-07-22",
            "page_url": "/article/",
        }
        with patch.object(
            collector,
            "selected_query_page_dates",
            return_value=["2026-07-22"],
        ), patch.object(collector, "start_run", return_value=84), patch.object(
            collector,
            "refresh_access_token",
            return_value="token",
        ), patch.object(collector, "get_user_id", return_value="user"), patch.object(
            collector,
            "configured_accounts",
            return_value=[account],
        ), patch.object(
            collector,
            "load_priority_query_pages",
            return_value=["/article/"],
        ), patch.object(
            collector,
            "fetch_query_page_rows",
            return_value=[{"text_indicator": {"type": "QUERY", "value": "query"}}],
        ), patch.object(
            collector,
            "normalize_query_page_rows",
            return_value=[pair_row],
        ), patch.object(
            collector,
            "replace_webmaster_query_page_snapshot",
            return_value=2,
        ) as replace, patch.object(collector, "fetch_query_rows") as fetch_queries, patch.object(
            collector,
            "fetch_page_rows",
        ) as fetch_pages, patch.object(collector, "upsert_accounts"), patch.object(
            collector,
            "log_collector_event",
        ), patch.object(collector, "finish_run"):
            result = collector.collect(args)

        self.assertEqual(result["status"], "success")
        fetch_queries.assert_not_called()
        fetch_pages.assert_not_called()
        coverage = replace.call_args.args[1]
        self.assertEqual(coverage["row_count"], 1)
        self.assertEqual(coverage["page_url"], "/article/")

    def test_selected_dates_clip_explicit_webmaster_window_to_collection_floor(self):
        from fetch_yandex_webmaster_canonical import selected_dates

        args = SimpleNamespace(
            date_from="2026-07-11",
            date_to="2026-07-13",
            lag_days=3,
        )

        self.assertEqual(
            selected_dates(args, anchor=dt.date(2026, 7, 14)),
            ["2026-07-11", "2026-07-12"],
        )

    def test_collect_does_not_create_run_for_empty_webmaster_window(self):
        import fetch_yandex_webmaster_canonical as collector

        args = SimpleNamespace(run_type="manual", force=False)
        with patch.object(collector, "selected_dates", return_value=[]), patch.object(
            collector, "start_run"
        ) as start:
            result = collector.collect(args)

        self.assertEqual(result["status"], "skipped_unavailable")
        start.assert_not_called()

    def test_collect_keeps_unknown_in_range_http_400_fatal(self):
        import fetch_yandex_webmaster_canonical as collector

        args = SimpleNamespace(run_type="manual", force=False)
        account = collector.WebmasterAccount("66624469", "zaruku.ru", "host")
        with patch.object(collector, "selected_dates", return_value=["2026-07-12"]), patch.object(
            collector, "start_run", return_value=42
        ), patch.object(collector, "refresh_access_token", return_value="token"), patch.object(
            collector, "get_user_id", return_value="user"
        ), patch.object(collector, "configured_accounts", return_value=[account]), patch.object(
            collector, "fetch_query_rows", return_value=[]
        ), patch.object(collector, "fetch_page_rows", side_effect=http_error(400)), patch.object(
            collector, "replace_webmaster_day_rows", return_value=1
        ), patch.object(collector, "upsert_webmaster_page_rows", return_value=0), patch.object(
            collector, "upsert_accounts"
        ), patch.object(collector, "log_collector_event"), patch.object(
            collector, "finish_run"
        ) as finish:
            with self.assertRaises(requests.HTTPError):
                collector.collect(args)

        self.assertEqual(finish.call_args.args[1], "failed")

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

    def test_query_page_request_uses_query_primary_and_exact_url_filter(self):
        from fetch_yandex_webmaster_canonical import build_query_page_request_body

        body = build_query_page_request_body("/article/", "2026-07-22", 0)

        self.assertEqual(body["text_indicator"], "QUERY")
        self.assertEqual(
            body["filters"]["text_filters"][0],
            {
                "text_indicator": "URL",
                "operation": "TEXT_MATCH",
                "value": "/article/",
            },
        )

    def test_fetch_query_page_rows_posts_exact_filter_and_paginates(self):
        from fetch_yandex_webmaster_canonical import fetch_query_page_rows

        first_rows = [
            {"text_indicator": {"type": "QUERY", "value": f"query {index}"}}
            for index in range(500)
        ]
        second_rows = [
            {"text_indicator": {"type": "QUERY", "value": "query 500"}}
        ]
        payloads = [
            {"count": 501, "text_indicator_to_statistics": first_rows},
            {"count": 501, "text_indicator_to_statistics": second_rows},
        ]
        with patch(
            "fetch_yandex_webmaster_canonical.request_with_retry",
            side_effect=payloads,
        ) as request:
            rows = fetch_query_page_rows(
                "token",
                "user",
                "https:zaruku.ru:443",
                "/article/",
                "2026-07-22",
                42,
            )

        self.assertEqual(len(rows), 501)
        self.assertEqual(request.call_count, 2)
        self.assertTrue(request.call_args_list[0].args[1].endswith("/query-analytics/list"))
        self.assertEqual(request.call_args_list[0].kwargs["method"], "POST")
        self.assertEqual(request.call_args_list[0].kwargs["body"]["offset"], 0)
        self.assertEqual(request.call_args_list[1].kwargs["body"]["offset"], 500)

    def test_query_page_normalizer_uses_requested_url_and_drops_zero_facts(self):
        from fetch_yandex_webmaster_canonical import normalize_query_page_rows

        rows = normalize_query_page_rows(
            {
                "text_indicator_to_statistics": [
                    {
                        "text_indicator": {"type": "QUERY", "value": " рак  груди "},
                        "popular_complementary_indicator": {
                            "type": "URL",
                            "value": "/wrong/",
                        },
                        "statistics": [
                            {
                                "date": "2026-07-22",
                                "field": "IMPRESSIONS",
                                "value": 9,
                            },
                            {
                                "date": "2026-07-22",
                                "field": "CLICKS",
                                "value": 2,
                            },
                        ],
                    },
                    {
                        "text_indicator": {"type": "QUERY", "value": "old query"},
                        "statistics": [
                            {
                                "date": "2026-07-22",
                                "field": "IMPRESSIONS",
                                "value": 0,
                            }
                        ],
                    },
                ]
            },
            page_url="/requested/",
            source_key="yandex_webmaster",
            analytics_account_id="66624469",
            host_id="https:zaruku.ru:443",
            report_date="2026-07-22",
            device_type="ALL",
            run_id=91,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["page_url"], "/requested/")
        self.assertEqual(rows[0]["query_text"], "рак груди")
        self.assertEqual(rows[0]["impressions"], 9)
        self.assertEqual(rows[0]["clicks"], 2)

    def test_empty_pair_success_replaces_stale_rows_and_writes_zero_coverage(self):
        from fetch_yandex_webmaster_canonical import (
            WEBMASTER_QUERY_PAGE_COVERAGE_UPSERT_SQL,
            WEBMASTER_QUERY_PAGE_SNAPSHOT_DELETE_SQL,
            replace_webmaster_query_page_snapshot,
        )

        connection = FakeConnection()
        coverage = {**self.pair_coverage, "row_count": 0}
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            written = replace_webmaster_query_page_snapshot([], coverage)

        self.assertEqual(written, 1)
        self.assertEqual(connection.commit_calls, 1)
        self.assertEqual(connection.rollback_calls, 0)
        self.assertEqual(
            connection.events,
            [
                ("cursor",),
                (
                    "execute",
                    WEBMASTER_QUERY_PAGE_SNAPSHOT_DELETE_SQL,
                    (
                        coverage["source_key"],
                        coverage["analytics_account_id"],
                        coverage["host_id"],
                        coverage["report_date"],
                        coverage["device_type"],
                        coverage["page_hash"],
                    ),
                ),
                ("execute", WEBMASTER_QUERY_PAGE_COVERAGE_UPSERT_SQL, coverage),
                ("commit",),
                ("cursor_close",),
                ("connection_close",),
            ],
        )

    def test_pair_snapshot_rolls_back_pair_and_coverage_on_insert_failure(self):
        from fetch_yandex_webmaster_canonical import replace_webmaster_query_page_snapshot

        connection = FakeConnection(fail_on_executemany=True)
        with patch(
            "fetch_yandex_webmaster_canonical.get_db_connection",
            return_value=connection,
        ):
            with self.assertRaisesRegex(RuntimeError, "query insert failed"):
                replace_webmaster_query_page_snapshot(
                    self.pair_rows,
                    self.pair_coverage,
                )

        self.assertEqual(connection.commit_calls, 0)
        self.assertEqual(connection.rollback_calls, 1)
        self.assertEqual(
            connection.events[-3:],
            [("rollback",), ("cursor_close",), ("connection_close",)],
        )

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
