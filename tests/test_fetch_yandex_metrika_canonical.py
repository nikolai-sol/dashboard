from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import requests


class YandexMetrikaCanonicalTests(unittest.TestCase):
    def test_build_entry_page_rows_maps_session_metrics(self):
        from fetch_yandex_metrika_canonical import build_entry_page_rows

        rows = build_entry_page_rows(
            "12345",
            "2026-07-14",
            {
                "data": [
                    {
                        "dimensions": [{"name": "https://zaruku.ru/landing"}],
                        "metrics": [12, 9, 20, 25.5, 91.0, 2.4],
                    }
                ]
            },
            42,
        )

        self.assertEqual(
            rows,
            [
                {
                    "source_key": "yandex_metrika",
                    "analytics_account_id": "12345",
                    "report_date": "2026-07-14",
                    "analytics_scope": "entry_page",
                    "scope_hash": "61e4e2f17a6a6edf7531e81581b30dbcd1339079a975f839a034ab4d578d48ae",
                    "page_url": "https://zaruku.ru/landing",
                    "page_title": None,
                    "visits": 12,
                    "users": 9,
                    "pageviews": 20,
                    "bounce_rate": 25.5,
                    "avg_visit_duration_seconds": 91.0,
                    "page_depth": 2.4,
                    "ingestion_run_id": 42,
                }
            ],
        )

    def test_build_entry_page_rows_skips_empty_urls(self):
        from fetch_yandex_metrika_canonical import build_entry_page_rows

        rows = build_entry_page_rows(
            "12345",
            "2026-07-14",
            {
                "data": [
                    {
                        "dimensions": [{"name": "  "}],
                        "metrics": [12, 9, 20, 25.5, 91.0, 2.4],
                    }
                ]
            },
            42,
        )

        self.assertEqual(rows, [])

    def test_build_payload_fetches_and_includes_entry_page_rows(self):
        from fetch_yandex_metrika_canonical import (
            METRIKA_ENTRY_PAGES_DIMS,
            METRIKA_ENTRY_PAGES_METRICS,
            build_payload,
        )

        requests = []

        def fake_request(counter_id, day, **kwargs):
            requests.append((counter_id, day, kwargs))
            if kwargs["dimensions"] == METRIKA_ENTRY_PAGES_DIMS:
                return {
                    "data": [
                        {
                            "dimensions": [{"name": "https://zaruku.ru/landing"}],
                            "metrics": [12, 9, 20, 25.5, 91.0, 2.4],
                        }
                    ]
                }
            return {"data": []}

        with patch(
            "fetch_yandex_metrika_canonical.request_with_retry",
            side_effect=fake_request,
        ):
            payload = build_payload(
                [{"counter_id": "12345", "name": "Zaruku", "collection_mode": "ads_only"}],
                "2026-07-14",
                "2026-07-14",
                42,
            )

        entry_page_requests = [request for request in requests if request[2]["dimensions"] == METRIKA_ENTRY_PAGES_DIMS]
        self.assertEqual(len(entry_page_requests), 1)
        self.assertEqual(entry_page_requests[0][0:2], ("12345", "2026-07-14"))
        self.assertEqual(entry_page_requests[0][2]["metrics"], METRIKA_ENTRY_PAGES_METRICS)
        self.assertEqual(payload["entry_page_rows"][0]["analytics_scope"], "entry_page")
        self.assertEqual(payload["entry_page_rows"][0]["page_url"], "https://zaruku.ru/landing")
        self.assertIn(payload["entry_page_rows"][0], payload["facts"])
        self.assertEqual(payload["rows_read"], 5)
        self.assertEqual(payload["api_empty_rows"], 0)

    def test_build_payload_rejects_truncated_entry_page_response_at_limit(self):
        from fetch_yandex_metrika_canonical import (
            METRIKA_ENTRY_PAGES_DIMS,
            build_payload,
        )

        entry_page = {
            "dimensions": [{"name": "https://zaruku.ru/landing"}],
            "metrics": [12, 9, 20, 25.5, 91.0, 2.4],
        }

        def fake_request(counter_id, day, **kwargs):
            if kwargs["dimensions"] == METRIKA_ENTRY_PAGES_DIMS:
                return {"data": [entry_page] * 10000, "total_rows": 10001}
            return {"data": [], "total_rows": 0}

        with patch(
            "fetch_yandex_metrika_canonical.request_with_retry",
            side_effect=fake_request,
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "incomplete Metrika entry-page response.*10001.*10000",
            ):
                build_payload(
                    [{"counter_id": "12345", "name": "Zaruku", "collection_mode": "ads_only"}],
                    "2026-07-14",
                    "2026-07-14",
                    42,
                )

    def test_main_discards_counter_when_later_entry_page_day_is_inaccessible(self):
        import fetch_yandex_metrika_canonical as collector

        args = SimpleNamespace(
            date_from="2026-07-13",
            date_to="2026-07-14",
            days_back=2,
            run_type="manual",
            counter_id="",
            counter_ids="",
        )
        counters = [
            {"counter_id": "bad", "name": "Bad", "collection_mode": "ads_only"},
            {"counter_id": "good", "name": "Good", "collection_mode": "ads_only"},
        ]
        entry_page_row = {
            "dimensions": [{"name": "https://zaruku.ru/landing"}],
            "metrics": [12, 9, 20, 25.5, 91.0, 2.4],
        }

        def fake_request(counter_id, day, **kwargs):
            if (
                counter_id == "bad"
                and day == "2026-07-14"
                and kwargs["dimensions"] == collector.METRIKA_ENTRY_PAGES_DIMS
            ):
                response = requests.Response()
                response.status_code = 403
                raise requests.exceptions.HTTPError(response=response)
            if kwargs["dimensions"] == collector.METRIKA_ENTRY_PAGES_DIMS:
                return {"data": [entry_page_row], "total_rows": 1}
            return {"data": [], "total_rows": 0}

        deleted_counter_ids = []
        published_facts = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(collector, "METRIKA_TOKEN", "token"))
            stack.enter_context(patch.object(collector, "parse_args", return_value=args))
            stack.enter_context(patch.object(collector, "start_collector_run", return_value=42))
            stack.enter_context(patch.object(collector, "ensure_user_behavior_table"))
            stack.enter_context(patch.object(collector, "fetch_configured_counters", return_value=counters))
            stack.enter_context(patch.object(collector, "request_with_retry", side_effect=fake_request))
            stack.enter_context(
                patch.object(
                    collector,
                    "delete_existing_scope_rows",
                    side_effect=lambda _date_from, _date_to, ids: deleted_counter_ids.append(ids),
                )
            )
            stack.enter_context(patch.object(collector, "delete_existing_user_behavior_rows"))
            stack.enter_context(patch.object(collector, "upsert_source_accounts"))
            stack.enter_context(
                patch.object(
                    collector,
                    "upsert_fact_site_analytics_daily",
                    side_effect=lambda rows: published_facts.extend(rows) or len(rows),
                )
            )
            stack.enter_context(patch.object(collector, "upsert_fact_user_behavior_daily", return_value=0))
            stack.enter_context(patch.object(collector, "log_run_event"))
            stack.enter_context(patch.object(collector, "finish_collector_run"))
            result = collector.main()

        self.assertEqual(result, 0)
        self.assertEqual(deleted_counter_ids, [["good"]])
        self.assertNotIn("bad", deleted_counter_ids[0])
        self.assertTrue(published_facts)
        self.assertEqual(
            {row["analytics_account_id"] for row in published_facts},
            {"good"},
        )

    def test_delete_existing_scope_rows_replaces_entry_pages_for_selected_counter(self):
        from fetch_yandex_metrika_canonical import delete_existing_scope_rows

        events = []

        class FakeCursor:
            def execute(self, sql, params):
                events.append((sql, params))

            def close(self):
                pass

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                pass

            def close(self):
                pass

        with patch(
            "fetch_yandex_metrika_canonical.get_db_connection",
            return_value=FakeConnection(),
        ):
            delete_existing_scope_rows("2026-07-14", "2026-07-14", ["12345"])

        sql, params = events[0]
        self.assertIn("analytics_scope IN (%s, %s, %s, %s, %s)", sql)
        self.assertEqual(params[-2:], ("entry_page", "12345"))

    def test_main_records_entry_page_scope_count_and_grain(self):
        import fetch_yandex_metrika_canonical as collector

        entry_page_row = {
            "source_key": "yandex_metrika",
            "analytics_account_id": "12345",
            "report_date": "2026-07-14",
            "analytics_scope": "entry_page",
            "scope_hash": "scope-hash",
            "page_url": "https://zaruku.ru/landing",
            "page_title": None,
            "visits": 12,
            "users": 9,
            "pageviews": 20,
            "bounce_rate": 25.5,
            "avg_visit_duration_seconds": 91.0,
            "page_depth": 2.4,
            "ingestion_run_id": 42,
        }
        payload = {
            "accounts": [],
            "utm_ads_rows": [],
            "goals_rows": [],
            "traffic_sources_rows": [],
            "page_rows": [],
            "entry_page_rows": [entry_page_row],
            "user_behavior_rows": [],
            "facts": [entry_page_row],
            "rows_read": 5,
            "api_empty_rows": 0,
            "counters": 1,
            "skipped_counters": [],
            "collection_modes": {"ads_only": 1},
            "successful_counter_ids": ["12345"],
        }
        summary_events = []
        args = SimpleNamespace(
            date_from="2026-07-14",
            date_to="2026-07-14",
            days_back=1,
            run_type="manual",
            counter_id="",
            counter_ids="",
        )

        with ExitStack() as stack:
            stack.enter_context(patch.object(collector, "METRIKA_TOKEN", "token"))
            stack.enter_context(patch.object(collector, "parse_args", return_value=args))
            stack.enter_context(patch.object(collector, "start_collector_run", return_value=42))
            stack.enter_context(patch.object(collector, "ensure_user_behavior_table"))
            stack.enter_context(
                patch.object(
                    collector,
                    "fetch_configured_counters",
                    return_value=[{"counter_id": "12345"}],
                )
            )
            stack.enter_context(patch.object(collector, "build_payload", return_value=payload))
            stack.enter_context(patch.object(collector, "delete_existing_scope_rows"))
            stack.enter_context(patch.object(collector, "delete_existing_user_behavior_rows"))
            stack.enter_context(patch.object(collector, "upsert_source_accounts"))
            stack.enter_context(
                patch.object(collector, "upsert_fact_site_analytics_daily", return_value=1)
            )
            stack.enter_context(
                patch.object(collector, "upsert_fact_user_behavior_daily", return_value=0)
            )
            stack.enter_context(
                patch.object(
                    collector,
                    "log_run_event",
                    side_effect=lambda *call_args: summary_events.append(call_args),
                )
            )
            stack.enter_context(patch.object(collector, "finish_collector_run"))
            result = collector.main()

        self.assertEqual(result, 0)
        summary = summary_events[0][4]
        self.assertIn("entry_pages", summary["logical_scopes"])
        self.assertIn("entry_page", summary["storage_scopes"])
        self.assertEqual(summary["entry_pages_grain"], "date+counter_id+page_url")
        self.assertEqual(summary["entry_page_rows"], 1)


if __name__ == "__main__":
    unittest.main()
