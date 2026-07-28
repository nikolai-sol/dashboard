from contextlib import ExitStack
from datetime import date
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

import requests


class YandexMetrikaCanonicalTests(unittest.TestCase):
    def test_cron_date_range_uses_one_day_floor_and_two_day_recollect_span(self):
        from fetch_yandex_metrika_canonical import date_range

        args = SimpleNamespace(date_from="", date_to="", days_back=2, run_type="cron")

        self.assertEqual(
            date_range(args, anchor=date(2026, 7, 17)),
            ("2026-07-15", "2026-07-16"),
        )

    def test_explicit_metrika_range_is_clipped_to_collection_floor(self):
        from fetch_yandex_metrika_canonical import date_range

        args = SimpleNamespace(
            date_from="2026-07-15",
            date_to="2026-07-17",
            days_back=2,
            run_type="manual",
        )

        self.assertEqual(
            date_range(args, anchor=date(2026, 7, 17)),
            ("2026-07-15", "2026-07-16"),
        )

    def test_metrika_range_returns_empty_when_every_requested_day_is_too_new(self):
        from fetch_yandex_metrika_canonical import date_range

        args = SimpleNamespace(
            date_from="2026-07-17",
            date_to="2026-07-17",
            days_back=2,
            run_type="manual",
        )

        self.assertEqual(date_range(args, anchor=date(2026, 7, 17)), ("", ""))

    def test_main_does_not_create_run_for_empty_metrika_window(self):
        import fetch_yandex_metrika_canonical as collector

        args = SimpleNamespace(
            date_from="2026-07-17",
            date_to="2026-07-17",
            days_back=2,
            run_type="manual",
        )
        with patch.object(collector, "METRIKA_TOKEN", "configured"), patch.object(
            collector, "parse_args", return_value=args
        ), patch.object(collector, "date_range", return_value=("", "")), patch.object(
            collector, "start_collector_run"
        ) as start:
            self.assertEqual(collector.main(), 0)

        start.assert_not_called()

    def test_generic_schema_preflight_precedes_collector_run_mutation(self):
        import fetch_yandex_metrika_canonical as collector

        args = SimpleNamespace(
            date_from="2026-07-22",
            date_to="2026-07-22",
            days_back=1,
            run_type="manual",
            counter_id="",
            counter_ids="",
            exclude_counter_id=[],
            canonical_release_id=None,
            code_revision="",
            parser_version="",
        )
        with patch.object(collector, "METRIKA_TOKEN", "token"), patch.object(
            collector,
            "parse_args",
            return_value=args,
        ), patch.object(
            collector,
            "preflight_generic_metrika_schema",
            side_effect=collector.MetrikaCollectionError("schema preflight failed"),
        ), patch.object(collector, "start_collector_run") as start:
            with self.assertRaisesRegex(
                collector.MetrikaCollectionError,
                "schema preflight",
            ):
                collector.main()

        start.assert_not_called()

    def test_parse_args_accepts_repeatable_excluded_counter_ids(self):
        from fetch_yandex_metrika_canonical import parse_args

        with patch.object(
            sys,
            "argv",
            [
                "fetch_yandex_metrika_canonical.py",
                "--exclude-counter-id",
                "90602537",
                "--exclude-counter-id",
                "108701572",
            ],
        ):
            args = parse_args()

        self.assertEqual(args.exclude_counter_id, ["90602537", "108701572"])

    def test_excluded_counter_ids_are_strictly_numeric_and_deduplicated(self):
        from fetch_yandex_metrika_canonical import excluded_counter_ids

        args = SimpleNamespace(exclude_counter_id=["90602537", "90602537"])
        self.assertEqual(excluded_counter_ids(args), ["90602537"])

        with self.assertRaisesRegex(ValueError, "digits only"):
            excluded_counter_ids(SimpleNamespace(exclude_counter_id=["counter-90602537"]))

    def test_validate_counter_filters_rejects_include_exclude_overlap(self):
        from fetch_yandex_metrika_canonical import validate_counter_filters

        with self.assertRaisesRegex(ValueError, "both included and excluded.*90602537"):
            validate_counter_filters(["90602537", "66624469"], ["90602537"])

    def test_filter_configured_counters_excludes_only_requested_ids(self):
        from fetch_yandex_metrika_canonical import filter_configured_counters

        counters = [
            {"counter_id": "66624469", "name": "Other"},
            {"counter_id": "90602537", "name": "Abbott"},
            {"counter_id": "108701572", "name": "Zaruku"},
        ]

        self.assertEqual(
            [
                row["counter_id"]
                for row in filter_configured_counters(
                    counters,
                    selected_ids=[],
                    excluded_ids=["90602537"],
                )
            ],
            ["66624469", "108701572"],
        )

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

    def test_build_payload_collects_breakdowns_only_for_zaruku(self):
        import fetch_yandex_metrika_canonical as collector

        bundle = SimpleNamespace(
            status="success",
            fact_rows=({"report_key": "devices"},),
            coverage_rows=({"report_key": "devices", "status": "success"},),
        )
        counters = [
            {"counter_id": "66624469", "name": "Zaruku"},
            {"counter_id": "29137835", "name": "Inactive 1"},
            {"counter_id": "105559308", "name": "Inactive 2"},
            {"counter_id": "99078698", "name": "Inactive 3"},
            {"counter_id": "90602537", "name": "Abbott"},
        ]
        empty_response = {"data": [], "total_rows": 0}

        with ExitStack() as stack:
            stack.enter_context(
                patch.object(
                    collector,
                    "request_with_retry",
                    return_value=empty_response,
                )
            )
            stack.enter_context(
                patch.object(
                    collector,
                    "request_all_rows",
                    return_value={"data": []},
                )
            )
            breakdowns = stack.enter_context(
                patch.object(
                    collector,
                    "collect_zaruku_breakdowns",
                    return_value=bundle,
                )
            )
            payload = collector.build_payload(
                counters,
                "2026-07-22",
                "2026-07-22",
                71,
            )

        breakdowns.assert_called_once_with("66624469", "2026-07-22", 71)
        self.assertEqual(payload["breakdown_rows"], [{"report_key": "devices"}])
        self.assertEqual(
            payload["breakdown_coverage_rows"],
            [{"report_key": "devices", "status": "success"}],
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

        published_counter_ids = []
        published_facts = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(collector, "METRIKA_TOKEN", "token"))
            stack.enter_context(patch.object(collector, "parse_args", return_value=args))
            stack.enter_context(patch.object(collector, "start_collector_run", return_value=42))
            stack.enter_context(patch.object(collector, "preflight_generic_metrika_schema"))
            stack.enter_context(patch.object(collector, "ensure_user_behavior_table"))
            stack.enter_context(patch.object(collector, "fetch_configured_counters", return_value=counters))
            stack.enter_context(patch.object(collector, "request_with_retry", side_effect=fake_request))
            stack.enter_context(
                patch.object(
                    collector,
                    "publish_generic_canonical_payload",
                    side_effect=lambda payload, _run_id: (
                        published_counter_ids.extend(payload["successful_counter_ids"])
                        or published_facts.extend(payload["facts"])
                        or SimpleNamespace(
                            rows_written=len(payload["facts"]),
                            site_rows_written=len(payload["facts"]),
                            user_behavior_rows_written=0,
                            breakdown_rows_written=len(payload["breakdown_rows"]),
                            coverage_rows_written=len(payload["breakdown_coverage_rows"]),
                        )
                    ),
                )
            )
            stack.enter_context(patch.object(collector, "log_run_event"))
            stack.enter_context(patch.object(collector, "finish_collector_run"))
            result = collector.main()

        self.assertEqual(result, 0)
        self.assertEqual(published_counter_ids, ["good"])
        self.assertNotIn("bad", published_counter_ids)
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
            "breakdown_rows": [],
            "breakdown_coverage_rows": [],
            "breakdown_failed_days": [],
            "date_from": "2026-07-14",
            "date_to": "2026-07-14",
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
            stack.enter_context(patch.object(collector, "preflight_generic_metrika_schema"))
            stack.enter_context(patch.object(collector, "ensure_user_behavior_table"))
            stack.enter_context(
                patch.object(
                    collector,
                    "fetch_configured_counters",
                    return_value=[{"counter_id": "12345"}],
                )
            )
            stack.enter_context(patch.object(collector, "build_payload", return_value=payload))
            stack.enter_context(
                patch.object(
                    collector,
                    "publish_generic_canonical_payload",
                    return_value=SimpleNamespace(
                        rows_written=1,
                        site_rows_written=1,
                        user_behavior_rows_written=0,
                        breakdown_rows_written=0,
                        coverage_rows_written=0,
                    ),
                )
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

    def test_main_marks_failed_breakdown_day_partial(self):
        import fetch_yandex_metrika_canonical as collector

        payload = {
            "accounts": [],
            "utm_ads_rows": [],
            "goals_rows": [],
            "traffic_sources_rows": [],
            "page_rows": [],
            "entry_page_rows": [],
            "user_behavior_rows": [],
            "facts": [],
            "rows_read": 17,
            "api_empty_rows": 0,
            "counters": 1,
            "skipped_counters": [],
            "collection_modes": {"ads_only": 1},
            "successful_counter_ids": ["66624469"],
            "breakdown_rows": [],
            "breakdown_coverage_rows": [],
            "breakdown_failed_days": [
                {
                    "counter_id": "66624469",
                    "report_date": "2026-07-22",
                    "report_key": "devices",
                    "error_class": "MetrikaCollectionError",
                }
            ],
            "date_from": "2026-07-22",
            "date_to": "2026-07-22",
        }
        args = SimpleNamespace(
            date_from="2026-07-22",
            date_to="2026-07-22",
            days_back=1,
            run_type="manual",
            counter_id="",
            counter_ids="",
            exclude_counter_id=[],
            canonical_release_id=None,
            code_revision="",
            parser_version="",
        )
        finish_calls = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(collector, "METRIKA_TOKEN", "token"))
            stack.enter_context(patch.object(collector, "parse_args", return_value=args))
            stack.enter_context(patch.object(collector, "preflight_generic_metrika_schema"))
            stack.enter_context(patch.object(collector, "start_collector_run", return_value=71))
            stack.enter_context(patch.object(collector, "ensure_user_behavior_table"))
            stack.enter_context(
                patch.object(
                    collector,
                    "fetch_configured_counters",
                    return_value=[{"counter_id": "66624469"}],
                )
            )
            stack.enter_context(patch.object(collector, "build_payload", return_value=payload))
            stack.enter_context(
                patch.object(
                    collector,
                    "publish_generic_canonical_payload",
                    return_value=SimpleNamespace(
                        rows_written=0,
                        site_rows_written=0,
                        user_behavior_rows_written=0,
                        breakdown_rows_written=0,
                        coverage_rows_written=0,
                    ),
                )
            )
            stack.enter_context(patch.object(collector, "log_run_event"))
            stack.enter_context(
                patch.object(
                    collector,
                    "finish_collector_run",
                    side_effect=lambda *args, **kwargs: finish_calls.append(kwargs),
                )
            )
            result = collector.main()

        self.assertEqual(result, 1)
        self.assertEqual(finish_calls[-1]["status"], "partial")
        self.assertEqual(finish_calls[-1]["error_count"], 1)


if __name__ == "__main__":
    unittest.main()
