from __future__ import annotations

from dataclasses import fields
from types import SimpleNamespace
import unittest
from unittest.mock import call, patch

import requests


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
            side_effect=lambda _counter, _day, scope, _run, _release: collected[scope],
        ) as collect_scope:
            bundle = collector.collect_metrika_day(
                {"counter_id": collector.ABBOTT_COUNTER_ID},
                "2026-01-02",
                77,
                41,
            )

        self.assertEqual(tuple(bundle.scopes), collector.ABBOTT_REQUIRED_SCOPES)
        self.assertNotIn("goal", bundle.scopes)
        self.assertEqual(
            collect_scope.call_args_list,
            [
                call(collector.ABBOTT_COUNTER_ID, "2026-01-02", scope, 77, 41)
                for scope in collector.ABBOTT_REQUIRED_SCOPES
            ],
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


if __name__ == "__main__":
    unittest.main()
