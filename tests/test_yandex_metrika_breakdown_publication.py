from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class BreakdownCollectionTests(unittest.TestCase):
    def test_collects_every_zaruku_report_with_full_pagination_and_accuracy(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_dashboard_breakdowns import ZARUKU_BREAKDOWN_REPORTS

        calls = []

        def fake_request(counter_id, day, **kwargs):
            calls.append((counter_id, day, kwargs))
            offset = int(kwargs["extra_params"]["offset"])
            row = {
                "dimensions": [
                    {"id": f"id-{offset}", "name": f"value-{offset}"}
                    for _ in kwargs["dimensions"].split(",")
                ],
                "metrics": [1, 1, 1, 0, 1, 1],
            }
            if offset == 1:
                return {
                    "data": [row, row],
                    "total_rows": 3,
                    "sampled": False,
                }
            return {
                "data": [row],
                "total_rows": 3,
                "sampled": False,
            }

        with patch.object(collector, "METRIKA_PAGE_LIMIT", 2), patch.object(
            collector,
            "request_with_retry",
            side_effect=fake_request,
        ):
            bundle = collector.collect_zaruku_breakdowns(
                "66624469",
                "2026-07-22",
                71,
            )

        self.assertEqual(bundle.status, "success")
        self.assertEqual(len(bundle.coverage_rows), len(ZARUKU_BREAKDOWN_REPORTS))
        self.assertEqual(
            {row["report_key"] for row in bundle.coverage_rows},
            {report.report_key for report in ZARUKU_BREAKDOWN_REPORTS},
        )
        for report in ZARUKU_BREAKDOWN_REPORTS:
            report_calls = [
                call for call in calls
                if call[2]["dimensions"] == ",".join(report.dimensions)
            ]
            self.assertEqual(
                [call[2]["extra_params"]["offset"] for call in report_calls],
                ["1", "3"],
            )
            for counter_id, day, kwargs in report_calls:
                self.assertEqual(counter_id, "66624469")
                self.assertEqual(day, "2026-07-22")
                self.assertEqual(kwargs["metrics"], report.metrics)
                self.assertEqual(kwargs["extra_params"]["accuracy"], "full")
                self.assertEqual(kwargs["extra_params"]["filters"], report.filters)

    def test_non_zaruku_counters_never_enter_breakdown_requests(self):
        import fetch_yandex_metrika_canonical as collector

        for counter_id in ("29137835", "105559308", "99078698", "90602537"):
            with self.subTest(counter_id=counter_id), patch.object(
                collector,
                "request_with_retry",
            ) as request:
                with self.assertRaisesRegex(
                    collector.MetrikaCollectionError,
                    "Zaruku",
                ):
                    collector.collect_zaruku_breakdowns(
                        counter_id,
                        "2026-07-22",
                        71,
                    )
                request.assert_not_called()

    def test_incomplete_report_returns_failed_day_without_partial_rows(self):
        import fetch_yandex_metrika_canonical as collector

        def incomplete_request(counter_id, day, **kwargs):
            return {
                "data": [],
                "total_rows": 1,
                "sampled": False,
            }

        with patch.object(
            collector,
            "request_with_retry",
            side_effect=incomplete_request,
        ):
            bundle = collector.collect_zaruku_breakdowns(
                "66624469",
                "2026-07-22",
                71,
            )

        self.assertEqual(bundle.status, "failed")
        self.assertEqual(bundle.fact_rows, ())
        self.assertEqual(bundle.coverage_rows, ())

    def test_sampled_report_returns_failed_day(self):
        import fetch_yandex_metrika_canonical as collector

        with patch.object(
            collector,
            "request_with_retry",
            return_value={
                "data": [],
                "total_rows": 0,
                "sampled": True,
                "sample_share": 0.5,
            },
        ):
            bundle = collector.collect_zaruku_breakdowns(
                "66624469",
                "2026-07-22",
                71,
            )

        self.assertEqual(bundle.status, "failed")
        self.assertEqual(bundle.fact_rows, ())
        self.assertEqual(bundle.coverage_rows, ())

    def test_successful_empty_reports_publish_empty_coverage(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_dashboard_breakdowns import ZARUKU_BREAKDOWN_REPORTS

        with patch.object(
            collector,
            "request_with_retry",
            return_value={
                "data": [],
                "total_rows": 0,
                "sampled": False,
            },
        ):
            bundle = collector.collect_zaruku_breakdowns(
                "66624469",
                "2026-07-22",
                71,
            )

        self.assertEqual(bundle.status, "success")
        self.assertEqual(bundle.fact_rows, ())
        self.assertEqual(len(bundle.coverage_rows), len(ZARUKU_BREAKDOWN_REPORTS))
        self.assertEqual(
            {row["status"] for row in bundle.coverage_rows},
            {"empty"},
        )


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.connection.events.append(("execute", normalized, params))
        if normalized.startswith("SELECT COUNT(*)"):
            self.connection.preflight_results.append(1)
        if self.connection.fail_fragment and self.connection.fail_fragment in normalized:
            raise RuntimeError("forced write failure")

    def executemany(self, sql, params):
        normalized = " ".join(sql.split())
        values = list(params)
        self.connection.events.append(("executemany", normalized, values))
        if self.connection.fail_fragment and self.connection.fail_fragment in normalized:
            raise RuntimeError("forced write failure")

    def fetchone(self):
        return (self.connection.preflight_results.pop(0),)

    def close(self):
        self.connection.events.append(("cursor_close", "", None))


class RecordingConnection:
    def __init__(self, *, fail_fragment=None):
        self.events = []
        self.preflight_results = []
        self.fail_fragment = fail_fragment

    def cursor(self, **kwargs):
        self.events.append(("cursor", "", kwargs))
        return RecordingCursor(self)

    def start_transaction(self):
        self.events.append(("begin", "BEGIN", None))

    def commit(self):
        self.events.append(("commit", "COMMIT", None))

    def rollback(self):
        self.events.append(("rollback", "ROLLBACK", None))

    def close(self):
        self.events.append(("close", "", None))


def publication_payload():
    return {
        "accounts": [],
        "facts": [
            {
                "source_key": "yandex_metrika",
                "analytics_account_id": "66624469",
                "report_date": "2026-07-22",
                "analytics_scope": "entry_page",
                "scope_hash": "site-scope",
                "page_url": "https://zaruku.ru/",
                "ingestion_run_id": 71,
            }
        ],
        "user_behavior_rows": [],
        "successful_counter_ids": ["66624469"],
        "date_from": "2026-07-22",
        "date_to": "2026-07-22",
        "breakdown_rows": [
            {
                "source_key": "yandex_metrika",
                "analytics_account_id": "66624469",
                "report_date": "2026-07-22",
                "report_key": "devices",
                "segment_key": "russia",
                "row_kind": "detail",
                "dimension_1_key": "ym:s:deviceCategory",
                "dimension_1_id": "desktop",
                "dimension_1_value": "Desktop",
                "dimension_2_key": None,
                "dimension_2_id": None,
                "dimension_2_value": None,
                "page_url": None,
                "dimension_hash": "dimension-hash",
                "visits": 3,
                "users": 2,
                "new_users": None,
                "pageviews": 4,
                "bounce_rate": 0,
                "avg_visit_duration_seconds": 10,
                "page_depth": 2,
                "ingestion_run_id": 71,
            }
        ],
        "breakdown_coverage_rows": [
            {
                "source_key": "yandex_metrika",
                "analytics_account_id": "66624469",
                "report_date": "2026-07-22",
                "report_key": "devices",
                "segment_key": "russia",
                "status": "success",
                "api_total_rows": 1,
                "persisted_rows": 1,
                "pagination_complete": 1,
                "ingestion_run_id": 71,
            }
        ],
    }


class GenericPublicationTests(unittest.TestCase):
    def test_preflight_then_upsert_coverage_prune_and_commit(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn):
            result = writer.publish_generic_canonical_payload(
                publication_payload(),
                71,
            )

        statements = [
            (method, sql, params)
            for method, sql, params in conn.events
            if method in {"execute", "executemany", "begin", "commit", "rollback"}
        ]
        begin_index = next(i for i, event in enumerate(statements) if event[0] == "begin")
        preflight_indexes = [
            i for i, event in enumerate(statements)
            if event[0] == "execute" and "information_schema" in event[1]
        ]
        fact_index = next(
            i for i, event in enumerate(statements)
            if event[0] == "executemany"
            and "canonical_fact_metrika_breakdowns_daily" in event[1]
        )
        coverage_index = next(
            i for i, event in enumerate(statements)
            if event[0] == "executemany"
            and "canonical_metrika_breakdown_coverage_daily" in event[1]
        )
        prune_index = next(
            i for i, event in enumerate(statements)
            if event[0] == "execute"
            and event[1].startswith("DELETE FROM canonical_fact_metrika_breakdowns_daily")
        )
        commit_index = next(i for i, event in enumerate(statements) if event[0] == "commit")

        self.assertTrue(preflight_indexes)
        self.assertLess(max(preflight_indexes), begin_index)
        self.assertLess(begin_index, fact_index)
        self.assertLess(fact_index, coverage_index)
        self.assertLess(coverage_index, prune_index)
        self.assertLess(prune_index, commit_index)
        prune_sql = statements[prune_index][1]
        for predicate in (
            "source_key = %s",
            "analytics_account_id = %s",
            "report_date = %s",
            "report_key = %s",
            "segment_key = %s",
            "ingestion_run_id <> %s",
            "ingestion_run_id IS NULL",
        ):
            self.assertIn(predicate, prune_sql)
        self.assertEqual(
            statements[prune_index][2],
            ("yandex_metrika", "66624469", "2026-07-22", "devices", "russia", 71),
        )
        self.assertEqual(result.breakdown_rows_written, 1)
        self.assertEqual(result.coverage_rows_written, 1)

    def test_rejects_non_zaruku_breakdown_payload_before_connection(self):
        import canonical_writer as writer

        payload = publication_payload()
        payload["breakdown_rows"][0]["analytics_account_id"] = "90602537"
        with patch.object(writer, "get_db_connection") as get_connection:
            with self.assertRaisesRegex(
                writer.MetrikaPublishError,
                "breakdown payload",
            ):
                writer.publish_generic_canonical_payload(payload, 71)

        get_connection.assert_not_called()

    def test_rejects_mismatched_row_run_before_connection(self):
        import canonical_writer as writer

        payload = publication_payload()
        payload["breakdown_coverage_rows"][0]["ingestion_run_id"] = 70
        with patch.object(writer, "get_db_connection") as get_connection:
            with self.assertRaisesRegex(
                writer.MetrikaPublishError,
                "breakdown payload",
            ):
                writer.publish_generic_canonical_payload(payload, 71)

        get_connection.assert_not_called()

    def test_rejects_unknown_report_before_connection(self):
        import canonical_writer as writer

        payload = publication_payload()
        payload["breakdown_rows"][0]["report_key"] = "unknown_report"
        payload["breakdown_coverage_rows"][0]["report_key"] = "unknown_report"
        with patch.object(writer, "get_db_connection") as get_connection:
            with self.assertRaisesRegex(
                writer.MetrikaPublishError,
                "breakdown payload",
            ):
                writer.publish_generic_canonical_payload(payload, 71)

        get_connection.assert_not_called()

    def test_upsert_failure_rolls_back_and_never_prunes(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            fail_fragment="INSERT INTO canonical_fact_metrika_breakdowns_daily",
        )
        with patch.object(writer, "get_db_connection", return_value=conn):
            with self.assertRaisesRegex(
                writer.MetrikaPublishError,
                "Generic Metrika publication failed",
            ):
                writer.publish_generic_canonical_payload(
                    publication_payload(),
                    71,
                )

        self.assertTrue(any(event[0] == "rollback" for event in conn.events))
        self.assertFalse(
            any(
                event[0] == "execute" and event[1].startswith("DELETE")
                for event in conn.events
            )
        )

    def test_missing_schema_fails_before_begin(self):
        import canonical_writer as writer

        conn = RecordingConnection()

        class MissingCursor(RecordingCursor):
            def fetchone(self):
                return (0,)

        conn.cursor = lambda **kwargs: MissingCursor(conn)
        with patch.object(writer, "get_db_connection", return_value=conn):
            with self.assertRaisesRegex(
                writer.MetrikaPublishError,
                "schema preflight",
            ):
                writer.publish_generic_canonical_payload(
                    publication_payload(),
                    71,
                )

        self.assertFalse(any(event[0] == "begin" for event in conn.events))
        self.assertFalse(any(event[0] == "rollback" for event in conn.events))


if __name__ == "__main__":
    unittest.main()
