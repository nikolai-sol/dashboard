from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCOPES = ("other", "traffic", "page", "user_behavior", "returning")


def scope_result(scope, rows):
    return SimpleNamespace(
        scope=scope,
        rows=tuple(rows),
        api_total_rows=len(rows),
        persisted_rows=len(rows),
        sampled=False,
        sample_share=None,
        pagination_complete=True,
        status="success" if rows else "success_empty",
        request_fingerprint=f"fingerprint-{scope}",
    )


def day_bundle():
    return SimpleNamespace(
        canonical_release_id=41,
        counter_id="90602537",
        report_date="2026-01-02",
        run_id=77,
        scopes={
            "other": scope_result(
                "other",
                [
                    {
                        "source_key": "yandex_metrika",
                        "analytics_account_id": "90602537",
                        "analytics_scope": "other",
                        "scope_hash": "scope-other",
                        "scope_dimensions": {"traffic_source": "direct"},
                        "sessions": 3,
                        "users": 2,
                        "pageviews": 4,
                        "bounce_rate": 1.25,
                        "average_session_seconds": 30.0,
                        "goal_conversions": None,
                        "raw_payload": None,
                    }
                ],
            ),
            "traffic": scope_result("traffic", []),
            "page": scope_result("page", []),
            "user_behavior": scope_result(
                "user_behavior",
                [
                    {
                        "raw_user_id": "user-1",
                        "raw_user_id_hash": "user-hash",
                        "start_url": "/start",
                        "start_url_hash": "start-hash",
                        "end_url": "/end",
                        "end_url_hash": "end-hash",
                        "visit_id": "visit-1",
                        "session_started_at": None,
                        "session_ended_at": None,
                        "pageviews": 2,
                        "request_fingerprint": "request-hash",
                    }
                ],
            ),
            "returning": scope_result(
                "returning",
                [
                    {
                        "raw_page_value": "/end",
                        "raw_page_hash": "raw-page-hash",
                        "normalized_page": "/end",
                        "normalized_page_hash": "normalized-page-hash",
                        "return_bucket_code": "next_day",
                        "return_bucket_label": "Next day",
                        "source_percentage": 12.5,
                        "source_denominator": 8,
                        "derived_count": None,
                        "is_derived": 0,
                    }
                ],
            ),
        },
    )


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.closed = False

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.connection.sql_calls.append(("execute", normalized, params))
        self.connection.maybe_fail(normalized)

    def executemany(self, sql, params):
        normalized = " ".join(sql.split())
        materialized = list(params)
        self.connection.sql_calls.append(("executemany", normalized, materialized))
        self.connection.maybe_fail(normalized)
        self.rowcount = len(materialized)

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, fail_on=None):
        self.fail_on = fail_on
        self.events = []
        self.sql_calls = []
        self.cursor_instance = RecordingCursor(self)

    def maybe_fail(self, sql):
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("sensitive-db-detail")

    def cursor(self, **kwargs):
        self.events.append(("cursor", kwargs))
        return self.cursor_instance

    def start_transaction(self):
        self.events.append(("start_transaction", None))

    def commit(self):
        self.events.append(("commit", None))

    def rollback(self):
        self.events.append(("rollback", None))

    def close(self):
        self.events.append(("close", None))


class AtomicMetrikaWriterTest(unittest.TestCase):
    def test_publish_uses_one_transaction_and_inserts_facts_before_coverage(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ) as require_release:
            result = writer.publish_metrika_day_bundle(day_bundle())

        require_release.assert_called_once_with(41, portal_key="abbott")
        self.assertEqual(conn.events.count(("start_transaction", None)), 1)
        self.assertIn(("commit", None), conn.events)
        self.assertNotIn(("rollback", None), conn.events)
        inserts = [sql for method, sql, _ in conn.sql_calls if method == "executemany"]
        site_index = next(i for i, sql in enumerate(inserts) if "site_analytics" in sql)
        private_index = next(i for i, sql in enumerate(inserts) if "user_behavior" in sql)
        returning_index = next(i for i, sql in enumerate(inserts) if "returning_pages" in sql)
        coverage_index = next(i for i, sql in enumerate(inserts) if "source_coverage" in sql)
        self.assertLess(site_index, private_index)
        self.assertLess(private_index, returning_index)
        self.assertLess(returning_index, coverage_index)
        coverage_params = next(
            params
            for method, sql, params in conn.sql_calls
            if method == "executemany" and "source_coverage" in sql
        )
        self.assertEqual(len(coverage_params), 5)
        self.assertEqual(result.coverage_rows_written, 5)
        self.assertEqual(result.rows_written, 3)

    def test_deletes_are_scoped_to_exact_release_counter_and_day(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            writer.publish_metrika_day_bundle(day_bundle())

        deletes = [
            (sql, params)
            for method, sql, params in conn.sql_calls
            if method == "execute" and sql.startswith("DELETE")
        ]
        self.assertEqual(len(deletes), 4)
        for sql, params in deletes:
            self.assertIn("canonical_release_id = %s", sql)
            self.assertIn("counter_id = %s", sql)
            self.assertIn("report_date = %s", sql)
            self.assertEqual(params, (41, "90602537", "2026-01-02"))

    def test_any_fact_insert_failure_rolls_back_without_success_coverage(self):
        import canonical_writer as writer

        conn = RecordingConnection(fail_on="returning_pages")
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            with self.assertRaises(writer.MetrikaPublishError) as raised:
                writer.publish_metrika_day_bundle(day_bundle())

        self.assertNotIn("sensitive-db-detail", str(raised.exception))
        self.assertIn(("rollback", None), conn.events)
        self.assertNotIn(("commit", None), conn.events)
        self.assertFalse(any("source_coverage" in sql for _, sql, _ in conn.sql_calls))

    def test_mutability_is_checked_before_transaction_is_opened(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer,
            "require_mutable_candidate_release",
            side_effect=writer.MetrikaPublishError("immutable release"),
        ):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(day_bundle())

        self.assertEqual(conn.events, [])

    def test_failure_recording_executes_no_delete(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn):
            writer.record_metrika_day_failure(
                release_id=41,
                counter_id="90602537",
                report_date="2026-01-02",
                run_id=77,
                scope="page",
                status="failed",
                error_class="MetrikaPermissionError",
            )

        self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))
        insert_sql, insert_params = next(
            (sql, params)
            for method, sql, params in conn.sql_calls
            if method == "execute" and "source_coverage" in sql
        )
        self.assertIn("ON DUPLICATE KEY UPDATE", insert_sql)
        self.assertIn("MetrikaPermissionError", insert_params)
        self.assertIn(("commit", None), conn.events)


if __name__ == "__main__":
    unittest.main()
