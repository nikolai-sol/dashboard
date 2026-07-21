from __future__ import annotations

from dataclasses import fields
from datetime import datetime
import hashlib
from types import SimpleNamespace
import unittest
from unittest.mock import call, patch

import requests

FINGERPRINT_CONTEXT = {
    "code_revision": "test-revision",
    "parser_version": "test-parser-v1",
}


def scope_result(scope, rows=(), **overrides):
    from fetch_yandex_metrika_canonical import MetrikaScopeResult

    values = {
        "scope": scope,
        "rows": tuple(rows),
        "api_total_rows": len(rows),
        "persisted_rows": len(rows),
        "sampled": False,
        "sample_share": None,
        "pagination_complete": True,
        "status": "success" if rows else "success_empty",
        "request_fingerprint": f"fingerprint-{scope}",
    }
    values.update(overrides)
    return MetrikaScopeResult(**values)


def day_bundle(scopes=None):
    from fetch_yandex_metrika_canonical import (
        ABBOTT_COUNTER_ID,
        ABBOTT_REQUIRED_SCOPES,
        MetrikaDayBundle,
    )

    return MetrikaDayBundle(
        canonical_release_id=41,
        counter_id=ABBOTT_COUNTER_ID,
        report_date="2026-01-02",
        run_id=77,
        scopes=scopes
        or {scope: scope_result(scope) for scope in ABBOTT_REQUIRED_SCOPES},
    )


class MetrikaDayBundleTests(unittest.TestCase):
    def test_user_behavior_uses_logs_client_and_normalizes_private_visit(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_logs_api import VISIT_FIELDS

        visits = (
            {
                "visit_id": "visit-secret-1",
                "date_time": "2026-01-02 10:15:30",
                "start_url": "https://example.test/private-start?token=secret",
                "end_url": "https://example.test/private-end#secret",
                "page_views": 4,
                "visit_duration": 125,
                "bounce": 0,
                "client_id": "client-secret-1",
                "traffic_source": "Search engine traffic",
                "raw_user_id": "user-secret-1",
                "raw_user_ids": ("user-secret-1",),
            },
        )

        class FakeLogsClient:
            def __init__(self, token):
                self.token = token

            def collect_visits(self, counter_id, day, attribution):
                self.call = (counter_id, day, attribution)
                return visits

        fake = FakeLogsClient("unused")
        with patch.object(collector, "METRIKA_TOKEN", "token-value"), patch.object(
            collector,
            "request_all_pages",
            side_effect=AssertionError("Reports API must not be called"),
        ):
            result = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "user_behavior",
                77,
                41,
                logs_client_factory=lambda token: (
                    self.assertEqual(token, "token-value") or fake
                ),
                **FINGERPRINT_CONTEXT,
            )

        self.assertEqual(
            fake.call,
            (collector.ABBOTT_COUNTER_ID, "2026-01-02", "lastsign"),
        )
        self.assertEqual(result.api_total_rows, 1)
        self.assertEqual(result.persisted_rows, 1)
        self.assertFalse(result.sampled)
        self.assertTrue(result.pagination_complete)
        self.assertEqual(result.status, "success")
        expected_request_fingerprint = collector.build_scope_hash(
            "user_behavior",
            [
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "source=visits",
                ",".join(VISIT_FIELDS),
                "lastsign",
                collector.METRIKA_TIMEZONE,
                FINGERPRINT_CONTEXT["code_revision"],
                FINGERPRINT_CONTEXT["parser_version"],
            ],
        )
        self.assertEqual(result.request_fingerprint, expected_request_fingerprint)
        visit_id_hash = hashlib.sha256(b"visit-secret-1").hexdigest()
        self.assertEqual(
            result.rows,
            (
                {
                    "canonical_release_id": 41,
                    "counter_id": collector.ABBOTT_COUNTER_ID,
                    "report_date": "2026-01-02",
                    "visit_id": "visit-secret-1",
                    "visit_id_hash": visit_id_hash,
                    "client_id_hash": hashlib.sha256(
                        b"client-secret-1"
                    ).hexdigest(),
                    "raw_user_id": "user-secret-1",
                    "raw_user_id_hash": hashlib.sha256(
                        b"user-secret-1"
                    ).hexdigest(),
                    "raw_user_ids_json": '["user-secret-1"]',
                    "traffic_source": "Search engine traffic",
                    "start_url": "https://example.test/private-start?token=secret",
                    "start_url_hash": hashlib.sha256(
                        b"https://example.test/private-start?token=secret"
                    ).hexdigest(),
                    "end_url": "https://example.test/private-end#secret",
                    "end_url_hash": hashlib.sha256(
                        b"https://example.test/private-end#secret"
                    ).hexdigest(),
                    "session_started_at": datetime(2026, 1, 2, 10, 15, 30),
                    "session_ended_at": datetime(2026, 1, 2, 10, 17, 35),
                    "pageviews": 4,
                    "duration_seconds": 125,
                    "is_bounce": 0,
                    "request_fingerprint": collector.build_scope_hash(
                        "user_behavior",
                        [expected_request_fingerprint, visit_id_hash],
                    ),
                    "ingestion_run_id": 77,
                },
            ),
        )

    def test_user_behavior_preserves_null_user_and_blank_client_as_null_hashes(self):
        import fetch_yandex_metrika_canonical as collector

        visit = {
            "visit_id": "visit-2",
            "date_time": "2026-01-02 00:00:00",
            "start_url": "",
            "end_url": "",
            "page_views": 0,
            "visit_duration": 0,
            "bounce": 1,
            "client_id": "   ",
            "traffic_source": "direct",
            "raw_user_id": None,
            "raw_user_ids": (),
        }

        result = collector.collect_metrika_scope(
            collector.ABBOTT_COUNTER_ID,
            "2026-01-02",
            "user_behavior",
            77,
            41,
            logs_client_factory=lambda _token: SimpleNamespace(
                collect_visits=lambda *_args: (visit,)
            ),
            **FINGERPRINT_CONTEXT,
        )

        row = result.rows[0]
        self.assertIsNone(row["client_id_hash"])
        self.assertIsNone(row["raw_user_id"])
        self.assertIsNone(row["raw_user_id_hash"])
        self.assertEqual(row["raw_user_ids_json"], "[]")
        self.assertEqual(row["start_url"], "")
        self.assertEqual(row["end_url"], "")

    def test_user_behavior_preserves_ambiguous_ids_without_singular_attribution(self):
        import fetch_yandex_metrika_canonical as collector

        visit = {
            "visit_id": "visit-ambiguous",
            "date_time": "2026-01-02 00:00:00",
            "start_url": "/start",
            "end_url": "/end",
            "page_views": 1,
            "visit_duration": 1,
            "bounce": 0,
            "client_id": "client",
            "traffic_source": "direct",
            "raw_user_id": None,
            "raw_user_ids": ("first", "second"),
        }

        result = collector.collect_metrika_scope(
            collector.ABBOTT_COUNTER_ID,
            "2026-01-02",
            "user_behavior",
            77,
            41,
            logs_client_factory=lambda _token: SimpleNamespace(
                collect_visits=lambda *_args: (visit,)
            ),
            **FINGERPRINT_CONTEXT,
        )

        self.assertEqual(result.persisted_rows, 1)
        row = result.rows[0]
        self.assertIsNone(row["raw_user_id"])
        self.assertIsNone(row["raw_user_id_hash"])
        self.assertEqual(row["raw_user_ids_json"], '["first","second"]')

    def test_user_behavior_rejects_incomplete_or_invalid_visit_without_raw_values(self):
        import fetch_yandex_metrika_canonical as collector

        valid = {
            "visit_id": "private-visit-secret",
            "date_time": "2026-01-02 10:00:00",
            "start_url": "https://private.test/start",
            "end_url": "https://private.test/end",
            "page_views": 1,
            "visit_duration": 1,
            "bounce": 0,
            "client_id": "private-client-secret",
            "traffic_source": "direct",
            "raw_user_id": "private-user-secret",
            "raw_user_ids": ("private-user-secret",),
        }
        mutations = (
            {"missing": "traffic_source"},
            {"date_time": "2026-01-03 10:00:00"},
            {"page_views": -1},
            {"visit_duration": True},
            {"bounce": 2},
            {"traffic_source": "   "},
            {"raw_user_ids": ("private-user-secret", "private-user-secret")},
            {"raw_user_ids": ("private-user-secret", "second-user"), "raw_user_id": "private-user-secret"},
            {"raw_user_ids": ("   ",), "raw_user_id": "   "},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                visit = dict(valid)
                missing = mutation.get("missing")
                if missing:
                    del visit[missing]
                else:
                    visit.update(mutation)
                with self.assertRaises(collector.MetrikaCollectionError) as raised:
                    collector.collect_metrika_scope(
                        collector.ABBOTT_COUNTER_ID,
                        "2026-01-02",
                        "user_behavior",
                        77,
                        41,
                        logs_client_factory=lambda _token, visit=visit: SimpleNamespace(
                            collect_visits=lambda *_args: (visit,)
                        ),
                        **FINGERPRINT_CONTEXT,
                    )

                message = str(raised.exception)
                self.assertNotIn("private-visit-secret", message)
                self.assertNotIn("private-client-secret", message)
                self.assertNotIn("private-user-secret", message)
                self.assertNotIn("private.test", message)

    def test_user_behavior_sanitizes_metrika_logs_error(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_logs_api import MetrikaLogsError

        remote_detail = "remote-secret-request-id"

        def fail(*_args):
            raise MetrikaLogsError(remote_detail)

        with self.assertRaises(collector.MetrikaCollectionError) as raised:
            collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "user_behavior",
                77,
                41,
                logs_client_factory=lambda _token: SimpleNamespace(
                    collect_visits=fail
                ),
                **FINGERPRINT_CONTEXT,
            )

        self.assertEqual(
            str(raised.exception),
            "Metrika Logs user behavior collection failed",
        )
        self.assertNotIn(remote_detail, str(raised.exception))

    def test_user_behavior_zero_visits_is_complete_success_empty(self):
        import fetch_yandex_metrika_canonical as collector

        result = collector.collect_metrika_scope(
            collector.ABBOTT_COUNTER_ID,
            "2026-01-02",
            "user_behavior",
            77,
            41,
            logs_client_factory=lambda _token: SimpleNamespace(
                collect_visits=lambda *_args: ()
            ),
            **FINGERPRINT_CONTEXT,
        )

        self.assertEqual(result.rows, ())
        self.assertEqual(result.api_total_rows, 0)
        self.assertEqual(result.persisted_rows, 0)
        self.assertFalse(result.sampled)
        self.assertTrue(result.pagination_complete)
        self.assertEqual(result.status, "success_empty")

    def test_user_behavior_requires_exact_abbott_counter_before_logs_call(self):
        import fetch_yandex_metrika_canonical as collector

        fake = SimpleNamespace(collect_visits=lambda *_args: self.fail("unexpected call"))
        with self.assertRaises(collector.MetrikaCollectionError):
            collector.collect_metrika_scope(
                "12345678",
                "2026-01-02",
                "user_behavior",
                77,
                41,
                logs_client_factory=lambda _token: fake,
                **FINGERPRINT_CONTEXT,
            )

    def test_user_behavior_evidence_requires_exact_api_row_reconciliation(self):
        import fetch_yandex_metrika_canonical as collector

        scopes = {
            scope: scope_result(scope)
            for scope in collector.ABBOTT_REQUIRED_SCOPES
        }
        scopes["user_behavior"] = scope_result(
            "user_behavior",
            ({"request_fingerprint": "row-1"}, {"request_fingerprint": "row-2"}),
            api_total_rows=1,
        )
        with self.assertRaises(collector.MetrikaCollectionError):
            collector.validate_day_bundle(
                day_bundle(scopes), collector.ABBOTT_REQUIRED_SCOPES
            )

    def test_frozen_bundle_contract_matches_atomic_writer_field_names(self):
        import fetch_yandex_metrika_canonical as collector

        self.assertEqual(
            tuple(field.name for field in fields(collector.MetrikaScopeResult)),
            (
                "scope",
                "rows",
                "api_total_rows",
                "persisted_rows",
                "sampled",
                "sample_share",
                "pagination_complete",
                "status",
                "request_fingerprint",
            ),
        )
        self.assertEqual(
            tuple(field.name for field in fields(collector.MetrikaDayBundle)),
            (
                "canonical_release_id",
                "counter_id",
                "report_date",
                "run_id",
                "scopes",
            ),
        )

    def test_collects_exactly_five_abbott_scopes(self):
        import fetch_yandex_metrika_canonical as collector

        collected = {
            scope: scope_result(scope) for scope in collector.ABBOTT_REQUIRED_SCOPES
        }
        with patch.object(
            collector,
            "collect_metrika_scope",
            side_effect=lambda _counter, _day, scope, _run, _release, **_context: (
                collected[scope]
            ),
        ) as collect_scope:
            bundle = collector.collect_metrika_day(
                {"counter_id": collector.ABBOTT_COUNTER_ID},
                "2026-01-02",
                77,
                41,
                **FINGERPRINT_CONTEXT,
            )

        self.assertEqual(tuple(bundle.scopes), collector.ABBOTT_REQUIRED_SCOPES)
        self.assertNotIn("goal", bundle.scopes)
        self.assertEqual(
            collect_scope.call_args_list,
            [
                call(
                    collector.ABBOTT_COUNTER_ID,
                    "2026-01-02",
                    scope,
                    77,
                    41,
                    **FINGERPRINT_CONTEXT,
                )
                for scope in collector.ABBOTT_REQUIRED_SCOPES
            ],
        )

    def test_other_scope_collects_exact_lastsign_user_id_partitions(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        responses = tuple(
            PaginationResult(
                rows=(
                    {
                        "dimensions": [{"id": "direct", "name": "Direct"}],
                        "metrics": [sessions, 2, 1, 4, 1.25, 30.0, 1.5],
                    },
                ),
                total_rows=1,
                pages_fetched=1,
                pagination_complete=True,
                sampled=False,
                sample_share=None,
            )
            for sessions in (3, 2, 1)
        )
        with patch.object(
            collector, "request_all_pages", side_effect=responses
        ) as request_pages:
            result = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "other",
                77,
                41,
                **FINGERPRINT_CONTEXT,
            )

        self.assertEqual(
            request_pages.call_args_list,
            [
                call(
                    collector.ABBOTT_COUNTER_ID,
                    "2026-01-02",
                    dimensions="ym:s:lastsignTrafficSource",
                    metrics=collector.METRIKA_TRAFFIC_SOURCES_METRICS,
                    attribution="lastsign",
                    extra_params={"accuracy": "full", "filters": filters},
                )
                for _, filters in collector.ABBOTT_OTHER_SEGMENTS
            ],
        )
        self.assertEqual(result.api_total_rows, 3)
        self.assertEqual(result.persisted_rows, 3)
        self.assertEqual(
            [row["scope_dimensions"]["user_id_presence"] for row in result.rows],
            ["all", "with_user_id", "without_user_id"],
        )
        self.assertEqual(len({row["scope_hash"] for row in result.rows}), 3)

    def test_all_release_reports_scopes_ignore_legacy_attribution_environment(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        empty = PaginationResult(
            rows=(),
            total_rows=0,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )
        with patch.object(collector, "METRIKA_ATTRIBUTION", "first"), patch.object(
            collector, "METRIKA_UTM_ADS_ATTRIBUTION", "cross_device_first"
        ), patch.object(
            collector, "request_all_pages", return_value=empty
        ) as request_pages:
            fingerprints = {
                scope: collector.collect_metrika_scope(
                    collector.ABBOTT_COUNTER_ID,
                    "2026-01-02",
                    scope,
                    77,
                    41,
                    **FINGERPRINT_CONTEXT,
                ).request_fingerprint
                for scope in ("traffic", "page", "returning")
            }

        self.assertEqual(len(request_pages.call_args_list), 3)
        for scope, request_call in zip(("traffic", "page", "returning"), request_pages.call_args_list):
            kwargs = request_call.kwargs
            self.assertEqual(kwargs["attribution"], "lastsign", scope)
            rendered_dimensions = kwargs["dimensions"].replace("<attribution>", "lastsign")
            expected_api_fingerprint = collector.api_fingerprint(
                dimensions=collector.parse_csv_values(rendered_dimensions),
                metrics=collector.parse_csv_values(kwargs["metrics"]),
                filters=collector.clean_text(kwargs.get("extra_params", {}).get("filters")),
                attribution="lastsign",
                accuracy=collector.clean_text(kwargs.get("extra_params", {}).get("accuracy")),
                pagination_limit=collector.METRIKA_PAGE_LIMIT,
                timezone=collector.METRIKA_TIMEZONE,
                code_revision=FINGERPRINT_CONTEXT["code_revision"],
                parser_version=FINGERPRINT_CONTEXT["parser_version"],
            )
            self.assertEqual(
                fingerprints[scope],
                collector.build_scope_hash(
                    scope,
                    [collector.ABBOTT_COUNTER_ID, "2026-01-02", expected_api_fingerprint],
                ),
            )
        self.assertEqual(
            request_pages.call_args_list[0].kwargs["dimensions"],
            "ym:s:lastsignUTMSource,ym:s:lastsignUTMMedium,ym:s:lastsignUTMCampaign",
        )

    def test_other_user_id_partitions_reconcile_globally_and_per_source(self):
        import fetch_yandex_metrika_canonical as collector

        def row(presence, source, sessions):
            return {
                "scope_dimensions": {
                    "traffic_source": source,
                    "user_id_presence": presence,
                },
                "sessions": sessions,
            }

        matching = (
            row("all", "Direct", 3),
            row("all", "Search", 4),
            row("with_user_id", "Direct", 2),
            row("with_user_id", "Search", 1),
            row("without_user_id", "Direct", 1),
            row("without_user_id", "Search", 3),
        )
        collector.validate_other_user_id_partitions(matching)

        global_mismatch = matching[:-1] + (row("without_user_id", "Search", 2),)
        source_mismatch = (
            row("all", "Direct", 3),
            row("all", "Search", 4),
            row("with_user_id", "Direct", 1),
            row("with_user_id", "Search", 2),
            row("without_user_id", "Direct", 1),
            row("without_user_id", "Search", 3),
        )
        for rows in (global_mismatch, source_mismatch):
            with self.subTest(rows=rows):
                with self.assertRaises(collector.MetrikaCollectionError):
                    collector.validate_other_user_id_partitions(rows)

    def test_any_incomplete_other_partition_makes_scope_non_publishable(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        complete = PaginationResult(
            rows=(),
            total_rows=0,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )
        incomplete_segments = (
            PaginationResult((), 0, 1, False, False, None),
            PaginationResult((), None, 1, True, False, None),
            PaginationResult((), 0, 1, True, True, 0.5),
        )
        for index, incomplete in enumerate(incomplete_segments):
            with self.subTest(index=index, incomplete=incomplete):
                responses = [complete, complete, complete]
                responses[index] = incomplete
                with patch.object(
                    collector, "request_all_pages", side_effect=responses
                ):
                    result = collector.collect_other_scope(
                        collector.ABBOTT_COUNTER_ID,
                        "2026-01-02",
                        77,
                        41,
                        **FINGERPRINT_CONTEXT,
                    )

                self.assertIn(result.status, ("partial", "sampled"))
                with self.assertRaises(collector.MetrikaCollectionError):
                    collector.validate_day_bundle(
                        day_bundle({**day_bundle().scopes, "other": result}),
                        collector.ABBOTT_REQUIRED_SCOPES,
                    )

    def test_validate_day_bundle_requires_exact_scope_set(self):
        import fetch_yandex_metrika_canonical as collector

        missing = day_bundle()
        missing_scopes = dict(missing.scopes)
        del missing_scopes["returning"]
        extra = day_bundle()
        extra_scopes = dict(extra.scopes)
        extra_scopes["goal"] = scope_result("goal")

        for malformed in (
            collector.MetrikaDayBundle(
                missing.canonical_release_id,
                missing.counter_id,
                missing.report_date,
                missing.run_id,
                missing_scopes,
            ),
            collector.MetrikaDayBundle(
                extra.canonical_release_id,
                extra.counter_id,
                extra.report_date,
                extra.run_id,
                extra_scopes,
            ),
        ):
            with self.subTest(scopes=tuple(malformed.scopes)):
                with self.assertRaises(collector.MetrikaCollectionError):
                    collector.validate_day_bundle(
                        malformed, collector.ABBOTT_REQUIRED_SCOPES
                    )

    def test_sampling_and_incomplete_pagination_prevent_publication(self):
        import fetch_yandex_metrika_canonical as collector

        for mutation in (
            {"sampled": True, "sample_share": 0.5},
            {"pagination_complete": False},
        ):
            with self.subTest(mutation=mutation):
                scopes = {
                    scope: scope_result(scope)
                    for scope in collector.ABBOTT_REQUIRED_SCOPES
                }
                scopes["page"] = scope_result("page", **mutation)
                with patch.object(
                    collector, "collect_metrika_day", return_value=day_bundle(scopes)
                ), patch.object(collector, "publish_metrika_day_bundle") as publish:
                    summary = collector.run_release_backfill(
                        [{"counter_id": collector.ABBOTT_COUNTER_ID}],
                        "2026-01-02",
                        "2026-01-02",
                        77,
                        41,
                        **FINGERPRINT_CONTEXT,
                    )

                publish.assert_not_called()
                self.assertEqual(summary["published_days"], 0)
                self.assertEqual(summary["failed_days"], ["2026-01-02"])

    def test_http_403_prevents_publication(self):
        import fetch_yandex_metrika_canonical as collector

        response = requests.Response()
        response.status_code = 403
        error = requests.exceptions.HTTPError(response=response)
        with patch.object(
            collector, "collect_metrika_day", side_effect=error
        ), patch.object(collector, "publish_metrika_day_bundle") as publish:
            summary = collector.run_release_backfill(
                [{"counter_id": collector.ABBOTT_COUNTER_ID}],
                "2026-01-02",
                "2026-01-02",
                77,
                41,
                **FINGERPRINT_CONTEXT,
            )

        publish.assert_not_called()
        self.assertEqual(summary["published_days"], 0)
        self.assertEqual(summary["failed_days"], ["2026-01-02"])

    def test_success_empty_requires_api_total_zero(self):
        import fetch_yandex_metrika_canonical as collector

        scopes = {
            scope: scope_result(scope) for scope in collector.ABBOTT_REQUIRED_SCOPES
        }
        scopes["page"] = scope_result(
            "page", api_total_rows=1, persisted_rows=0, status="success_empty"
        )
        with self.assertRaises(collector.MetrikaCollectionError):
            collector.validate_day_bundle(
                day_bundle(scopes), collector.ABBOTT_REQUIRED_SCOPES
            )

    def test_missing_api_total_cannot_be_classified_as_success_empty(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        response = PaginationResult(
            rows=(),
            total_rows=None,
            pages_fetched=1,
            pagination_complete=False,
            sampled=False,
            sample_share=None,
        )
        with patch.object(collector, "request_all_pages", return_value=response):
            result = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "page",
                77,
                41,
                **FINGERPRINT_CONTEXT,
            )

        self.assertEqual(result.status, "partial")
        self.assertIsNone(result.api_total_rows)
        with self.assertRaises(collector.MetrikaCollectionError):
            collector.validate_day_bundle(
                day_bundle(
                    {
                        **day_bundle().scopes,
                        "page": result,
                    }
                ),
                collector.ABBOTT_REQUIRED_SCOPES,
            )

    def test_explicit_release_path_skips_legacy_ddl_and_range_deletes(self):
        import fetch_yandex_metrika_canonical as collector

        args = SimpleNamespace(
            date_from="2026-01-02",
            date_to="2026-01-02",
            days_back=1,
            run_type="backfill",
            counter_id=collector.ABBOTT_COUNTER_ID,
            counter_ids="",
            canonical_release_id=41,
            code_revision=FINGERPRINT_CONTEXT["code_revision"],
            parser_version=FINGERPRINT_CONTEXT["parser_version"],
        )
        summary = {
            "published_days": 1,
            "failed_days": [],
            "rows_written": 3,
        }
        with patch.object(collector, "METRIKA_TOKEN", "token"), patch.object(
            collector, "parse_args", return_value=args
        ), patch.object(collector, "start_collector_run", return_value=77), patch.object(
            collector,
            "fetch_configured_counters",
            return_value=[{"counter_id": collector.ABBOTT_COUNTER_ID}],
        ), patch.object(
            collector, "run_release_backfill", return_value=summary
        ) as release_backfill, patch.object(
            collector, "ensure_user_behavior_table"
        ) as ensure_table, patch.object(
            collector, "delete_existing_scope_rows"
        ) as delete_site, patch.object(
            collector, "delete_existing_user_behavior_rows"
        ) as delete_private, patch.object(
            collector, "finish_collector_run"
        ), patch.object(
            collector, "log_run_event"
        ):
            exit_code = collector.main()

        self.assertEqual(exit_code, 0)
        release_backfill.assert_called_once()
        ensure_table.assert_not_called()
        delete_site.assert_not_called()
        delete_private.assert_not_called()

    def test_generic_request_all_rows_uses_legacy_pagination_wrapper(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        strict_partial = PaginationResult(
            rows=({"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}),
            total_rows=4,
            pages_fetched=2,
            pagination_complete=False,
            sampled=False,
            sample_share=None,
        )
        legacy_rows = [{"id": value} for value in range(1, 6)]
        with patch.object(
            collector, "request_all_pages", return_value=strict_partial
        ), patch.object(
            collector, "collect_all_rows", create=True, return_value=legacy_rows
        ) as collect_legacy:
            response = collector.request_all_rows(
                "12345678",
                "2026-01-02",
                dimensions="dimension",
                metrics="metric",
                attribution="last",
            )

        self.assertEqual(response, {"data": legacy_rows})
        collect_legacy.assert_called_once()


if __name__ == "__main__":
    unittest.main()
