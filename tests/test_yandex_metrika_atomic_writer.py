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
                        "visit_id": "visit-1",
                        "visit_id_hash": "visit-hash",
                        "client_id_hash": "client-hash",
                        "raw_user_id": "user-1",
                        "raw_user_id_hash": "user-hash",
                        "raw_user_ids_json": '["user-1"]',
                        "traffic_source": "direct",
                        "start_url": "/start",
                        "start_url_hash": "start-hash",
                        "end_url": "/end",
                        "end_url_hash": "end-hash",
                        "session_started_at": "2026-01-02 10:00:00",
                        "session_ended_at": "2026-01-02 10:02:03",
                        "pageviews": 2,
                        "duration_seconds": 123,
                        "is_bounce": 0,
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
                        "request_fingerprint": "returning-row-fingerprint",
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

    def fetchone(self):
        if self.connection.fetch_rows is not None:
            return self.connection.fetch_rows.pop(0) if self.connection.fetch_rows else None
        return self.connection.lock_row

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, fail_on=None, lock_row=None, fetch_rows=None):
        self.fail_on = fail_on
        self.lock_row = (
            {"id": 41, "dataset_key": "abbott", "release_status": "staging"}
            if lock_row is None
            else lock_row
        )
        self.events = []
        self.sql_calls = []
        self.fetch_rows = list(fetch_rows) if fetch_rows is not None else None
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
    def test_private_visit_primitive_uses_exact_columns_and_preserves_nulls(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        row = {
            "canonical_release_id": 41,
            "counter_id": "90602537",
            "report_date": "2026-01-02",
            "visit_id": "visit-1",
            "visit_id_hash": "visit-hash",
            "client_id_hash": None,
            "raw_user_id": None,
            "raw_user_id_hash": None,
            "raw_user_ids_json": '["first","second"]',
            "traffic_source": "direct",
            "start_url": "/start",
            "start_url_hash": "start-hash",
            "end_url": "/end",
            "end_url_hash": "end-hash",
            "session_started_at": "2026-01-02 10:00:00",
            "session_ended_at": "2026-01-02 10:02:03",
            "pageviews": 2,
            "duration_seconds": 123,
            "is_bounce": 0,
            "request_fingerprint": "request-hash",
            "ingestion_run_id": 77,
        }

        written = writer._insert_private_metrika_visit_rows(
            conn.cursor_instance, [row]
        )

        self.assertEqual(written, 1)
        method, sql, values = conn.sql_calls[0]
        self.assertEqual(method, "executemany")
        self.assertIn(
            "INSERT INTO report_bd_private.canonical_fact_metrika_visits "
            "( canonical_release_id, counter_id, report_date, visit_id, "
            "visit_id_hash, client_id_hash, raw_user_id, raw_user_id_hash, "
            "raw_user_ids_json, "
            "traffic_source, start_url, start_url_hash, end_url, end_url_hash, "
            "session_started_at, session_ended_at, pageviews, duration_seconds, "
            "is_bounce, request_fingerprint, ingestion_run_id )",
            sql,
        )
        self.assertEqual(
            values,
            [
                (
                    41,
                    "90602537",
                    "2026-01-02",
                    "visit-1",
                    "visit-hash",
                    None,
                    None,
                    None,
                    '["first","second"]',
                    "direct",
                    "/start",
                    "start-hash",
                    "/end",
                    "end-hash",
                    "2026-01-02 10:00:00",
                    "2026-01-02 10:02:03",
                    2,
                    123,
                    0,
                    "request-hash",
                    77,
                )
            ],
        )

    def test_private_visit_primitive_is_inert_for_empty_input(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        self.assertEqual(
            writer._insert_private_metrika_visit_rows(conn.cursor_instance, []), 0
        )
        self.assertEqual(conn.sql_calls, [])

    def test_release_publish_uses_visit_primitive_and_never_legacy_behavior_primitive(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ), patch.object(
            writer,
            "_insert_private_metrika_visit_rows",
            wraps=writer._insert_private_metrika_visit_rows,
        ) as insert_visits, patch.object(
            writer, "_insert_private_user_behavior_rows"
        ) as insert_legacy:
            writer.publish_metrika_day_bundle(day_bundle())

        insert_visits.assert_called_once()
        insert_legacy.assert_not_called()
        self.assertTrue(
            any(
                "INSERT INTO report_bd_private.canonical_fact_metrika_visits" in sql
                for method, sql, _ in conn.sql_calls
                if method == "executemany"
            )
        )

    def test_release_day_delete_and_active_lock_use_visit_table_not_legacy_table(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        writer._delete_release_day(conn.cursor_instance, 41, "90602537", "2026-01-02")
        delete_sql = [sql for method, sql, _ in conn.sql_calls if method == "execute"]
        self.assertTrue(
            any("canonical_fact_metrika_visits" in sql for sql in delete_sql)
        )
        self.assertFalse(
            any("canonical_fact_metrika_user_behavior_daily" in sql for sql in delete_sql)
        )

        active_conn = RecordingConnection(
            fetch_rows=[
                {"id": 41, "dataset_key": "abbott", "release_status": "active"},
                {"canonical_release_id": 41},
                {"row_count": 0},
                {"row_count": 0},
                {"row_count": 0},
                {"row_count": 0},
            ]
        )
        writer._lock_mutable_abbott_release(
            active_conn.cursor_instance,
            41,
            counter_id="90602537",
            report_date="2026-01-02",
            allow_active_append=True,
        )
        lock_sql = [sql for method, sql, _ in active_conn.sql_calls if method == "execute"]
        self.assertTrue(
            any("canonical_fact_metrika_visits" in sql for sql in lock_sql)
        )
        self.assertFalse(
            any("canonical_fact_metrika_user_behavior_daily" in sql for sql in lock_sql)
        )
        self.assertTrue(
            any("canonical_fact_metrika_returning_pages_release_daily" in sql for sql in delete_sql)
        )
        self.assertTrue(
            any("canonical_fact_metrika_returning_pages_release_daily" in sql for sql in lock_sql)
        )
        self.assertFalse(
            any("canonical_fact_metrika_returning_pages_daily" in sql for sql in delete_sql)
        )
        self.assertFalse(
            any("canonical_fact_metrika_returning_pages_daily" in sql for sql in lock_sql)
        )
        metadata_locks = [
            sql
            for sql in lock_sql
            if "FROM portal_data_releases" in sql
            or "FROM portal_active_data_releases" in sql
        ]
        day_locks = [sql for sql in lock_sql if "SELECT COUNT(*) AS row_count" in sql]
        self.assertEqual(len(metadata_locks), 2)
        self.assertTrue(all("FOR SHARE" in sql for sql in metadata_locks))
        self.assertEqual(len(day_locks), 4)
        self.assertTrue(all("FOR UPDATE" in sql for sql in day_locks))

    def test_release_returning_insert_targets_release_scoped_authority(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        row = {
            **day_bundle().scopes["returning"].rows[0],
            "canonical_release_id": 41,
            "counter_id": "90602537",
            "report_date": "2026-01-02",
            "ingestion_run_id": 77,
        }
        written = writer._insert_returning_rows(
            conn.cursor_instance,
            [row],
        )

        self.assertEqual(written, 1)
        sql = conn.sql_calls[0][1]
        self.assertIn("canonical_fact_metrika_returning_pages_release_daily", sql)
        self.assertNotIn("canonical_fact_metrika_returning_pages_daily", sql)

    def test_other_partition_mismatch_prevents_fact_and_success_coverage_writes(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        def response(sessions):
            return PaginationResult(
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

        def collect_scope(counter_id, day, scope, run_id, release_id, **context):
            if scope == "other":
                return collector.collect_other_scope(
                    counter_id,
                    day,
                    run_id,
                    release_id,
                    **context,
                )
            return scope_result(scope, [])

        with patch.object(
            collector,
            "request_all_pages",
            side_effect=(response(5), response(2), response(1)),
        ), patch.object(
            collector, "collect_metrika_scope", side_effect=collect_scope
        ), patch.object(collector, "publish_metrika_day_bundle") as publish:
            summary = collector.run_release_backfill(
                [{"counter_id": collector.ABBOTT_COUNTER_ID}],
                "2026-01-02",
                "2026-01-02",
                77,
                41,
                code_revision="test-revision",
                parser_version="test-parser-v1",
            )

        publish.assert_not_called()
        self.assertEqual(summary["published_days"], 0)
        self.assertEqual(summary["failed_days"], ["2026-01-02"])

    def test_current_active_release_appends_a_fully_absent_completed_day_without_delete(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            fetch_rows=[
                {"id": 41, "dataset_key": "abbott", "release_status": "active"},
                {"canonical_release_id": 41},
                {"row_count": 0},
                {"row_count": 0},
                {"row_count": 0},
                {"row_count": 0},
            ]
        )
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41, "release_status": "active"}
        ):
            result = writer.publish_metrika_day_bundle(day_bundle())

        self.assertEqual(result.canonical_release_id, 41)
        self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))
        self.assertTrue(any("portal_active_data_releases" in sql for _, sql, _ in conn.sql_calls))
        self.assertIn(("commit", None), conn.events)

    def test_active_release_rejects_a_stale_pointer_before_fact_mutation(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            fetch_rows=[
                {"id": 41, "dataset_key": "abbott", "release_status": "active"},
                {"canonical_release_id": 42},
            ]
        )
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41, "release_status": "active"}
        ):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(day_bundle())

        self.assertFalse(any(method == "executemany" for method, _, _ in conn.sql_calls))
        self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))
        self.assertIn(("rollback", None), conn.events)

    def test_active_release_rejects_any_existing_release_day_row_without_overwrite(self):
        import canonical_writer as writer

        for existing_index in range(4):
            with self.subTest(existing_index=existing_index):
                row_counts = [{"row_count": int(index == existing_index)} for index in range(4)]
                conn = RecordingConnection(
                    fetch_rows=[
                        {"id": 41, "dataset_key": "abbott", "release_status": "active"},
                        {"canonical_release_id": 41},
                        *row_counts,
                    ]
                )
                with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
                    writer,
                    "require_mutable_candidate_release",
                    return_value={"id": 41, "release_status": "active"},
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(day_bundle())

                self.assertFalse(any(method == "executemany" for method, _, _ in conn.sql_calls))
                self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))

    def test_active_release_rejects_current_or_future_day_before_insert(self):
        import canonical_writer as writer
        from datetime import date, timedelta

        for report_date in (date.today(), date.today() + timedelta(days=1)):
            with self.subTest(report_date=report_date):
                bundle = day_bundle()
                bundle.report_date = report_date.isoformat()
                conn = RecordingConnection(
                    fetch_rows=[
                        {"id": 41, "dataset_key": "abbott", "release_status": "active"},
                        {"canonical_release_id": 41},
                    ]
                )
                with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
                    writer,
                    "require_mutable_candidate_release",
                    return_value={"id": 41, "release_status": "active"},
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                self.assertFalse(any(method == "executemany" for method, _, _ in conn.sql_calls))

    def test_failure_diagnostics_remain_staging_only(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            fetch_rows=[{"id": 41, "dataset_key": "abbott", "release_status": "active"}]
        )
        with patch.object(writer, "get_db_connection", return_value=conn):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.record_metrika_day_failure(
                    release_id=41,
                    counter_id="90602537",
                    report_date="2026-01-02",
                    run_id=77,
                    scope="page",
                    status="failed",
                    error_class="MetrikaPermissionError",
                    request_fingerprint="failure-request-fingerprint",
                )

        self.assertFalse(any("INSERT INTO report_bd.canonical_source_coverage_daily" in sql for _, sql, _ in conn.sql_calls))

    def test_coverage_rows_persist_all_scope_request_fingerprints(self):
        import canonical_writer as writer

        bundle = day_bundle()
        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            writer.publish_metrika_day_bundle(bundle)

        coverage_sql, coverage_values = next(
            (sql, params)
            for method, sql, params in conn.sql_calls
            if method == "executemany" and "source_coverage" in sql
        )
        self.assertIn("request_fingerprint", coverage_sql)
        self.assertEqual(
            [row[5] for row in coverage_values],
            [f"fingerprint-{scope}" for scope in SCOPES],
        )
        self.assertEqual(len({row[5] for row in coverage_values}), 5)
        success_empty_rows = [row for row in coverage_values if row[6] == "success_empty"]
        self.assertGreater(len(success_empty_rows), 0)
        self.assertTrue(all(row[5] for row in success_empty_rows))

    def test_returning_insert_persists_request_fingerprint(self):
        import canonical_writer as writer

        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            writer.publish_metrika_day_bundle(day_bundle())

        returning_sql, returning_values = next(
            (sql, params)
            for method, sql, params in conn.sql_calls
            if method == "executemany" and "returning_pages" in sql
        )
        self.assertIn("request_fingerprint", returning_sql)
        self.assertEqual(returning_values[0][-2], "returning-row-fingerprint")

    def test_missing_scope_request_fingerprint_rejects_before_connection(self):
        import canonical_writer as writer

        mutations = (None, "", "   ")
        for fingerprint in mutations:
            with self.subTest(fingerprint=fingerprint):
                bundle = day_bundle()
                if fingerprint is None:
                    delattr(bundle.scopes["page"], "request_fingerprint")
                else:
                    bundle.scopes["page"].request_fingerprint = fingerprint
                with patch.object(writer, "get_db_connection") as connect, patch.object(
                    writer, "require_mutable_candidate_release"
                ) as require_release:
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                connect.assert_not_called()
                require_release.assert_not_called()

    def test_publish_rejects_non_abbott_counter_before_any_connection(self):
        import canonical_writer as writer

        bundle = day_bundle()
        bundle.counter_id = "12345678"
        with patch.object(writer, "get_db_connection") as connect, patch.object(
            writer, "require_mutable_candidate_release"
        ) as require_release:
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(bundle)

        connect.assert_not_called()
        require_release.assert_not_called()

    def test_failure_record_rejects_non_abbott_counter_before_any_connection(self):
        import canonical_writer as writer

        with patch.object(writer, "get_db_connection") as connect:
            with self.assertRaises(writer.MetrikaPublishError):
                writer.record_metrika_day_failure(
                    release_id=41,
                    counter_id="12345678",
                    report_date="2026-01-02",
                    run_id=77,
                    scope="page",
                    status="failed",
                    error_class="MetrikaPermissionError",
                    request_fingerprint="failure-request-fingerprint",
                )

        connect.assert_not_called()

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
        private_index = next(i for i, sql in enumerate(inserts) if "metrika_visits" in sql)
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

        lock_index = next(
            i for i, (_, sql, _) in enumerate(conn.sql_calls)
            if "FROM portal_data_releases" in sql and "FOR SHARE" in sql
        )
        delete_index = next(
            i for i, (_, sql, _) in enumerate(conn.sql_calls) if sql.startswith("DELETE")
        )
        self.assertLess(lock_index, delete_index)
        self.assertEqual(conn.sql_calls[lock_index][2], ("abbott", 41))

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

    def test_release_is_rechecked_under_lock_before_any_delete(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            lock_row={"id": 41, "dataset_key": "abbott", "release_status": "active"}
        )
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(day_bundle())

        self.assertIn(("rollback", None), conn.events)
        self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))
        self.assertFalse(any(method == "executemany" for method, _, _ in conn.sql_calls))

    def test_conflicting_fact_row_identity_is_rejected_before_transaction(self):
        import canonical_writer as writer

        conflicts = (
            ("canonical_release_id", 999),
            ("counter_id", "12345678"),
            ("report_date", "2025-12-31"),
            ("ingestion_run_id", 999),
        )
        for field, value in conflicts:
            with self.subTest(field=field):
                bundle = day_bundle()
                bundle.scopes["other"].rows[0][field] = value
                conn = RecordingConnection()
                with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
                    writer, "require_mutable_candidate_release", return_value={"id": 41}
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                self.assertEqual(conn.events, [])

    def test_site_account_and_scope_must_match_bundle_container(self):
        import canonical_writer as writer

        for field, value in (
            ("analytics_account_id", "12345678"),
            ("analytics_scope", "traffic"),
        ):
            with self.subTest(field=field):
                bundle = day_bundle()
                bundle.scopes["other"].rows[0][field] = value
                with patch.object(writer, "get_db_connection") as connect, patch.object(
                    writer, "require_mutable_candidate_release"
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                connect.assert_not_called()

    def test_missing_site_account_and_scope_are_forced_from_bundle(self):
        import canonical_writer as writer

        bundle = day_bundle()
        del bundle.scopes["other"].rows[0]["analytics_account_id"]
        del bundle.scopes["other"].rows[0]["analytics_scope"]
        conn = RecordingConnection()
        with patch.object(writer, "get_db_connection", return_value=conn), patch.object(
            writer, "require_mutable_candidate_release", return_value={"id": 41}
        ):
            writer.publish_metrika_day_bundle(bundle)

        site_values = next(
            params
            for method, sql, params in conn.sql_calls
            if method == "executemany" and "site_analytics" in sql
        )
        self.assertEqual(site_values[0][2], "90602537")
        self.assertEqual(site_values[0][5], "other")

    def test_scope_map_requires_exact_keys_and_matching_result_labels(self):
        import canonical_writer as writer

        malformed = []
        missing = day_bundle()
        del missing.scopes["returning"]
        malformed.append(missing)
        extra = day_bundle()
        extra.scopes["goal"] = scope_result("goal", [])
        malformed.append(extra)
        mislabeled = day_bundle()
        mislabeled.scopes["page"] = scope_result("traffic", [])
        malformed.append(mislabeled)

        for bundle in malformed:
            with self.subTest(scopes=tuple(bundle.scopes)):
                with patch.object(writer, "get_db_connection") as connect, patch.object(
                    writer, "require_mutable_candidate_release"
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                connect.assert_not_called()

    def test_malformed_success_empty_scope_is_rejected(self):
        import canonical_writer as writer

        base = scope_result("page", [])
        mutations = (
            {"rows": ({"unexpected": "row"},), "persisted_rows": 1},
            {"persisted_rows": 1},
            {"api_total_rows": 1},
            {"pagination_complete": False},
            {"sampled": True},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                bundle = day_bundle()
                values = vars(base).copy()
                values.update(mutation)
                bundle.scopes["page"] = SimpleNamespace(**values)
                with patch.object(writer, "get_db_connection") as connect, patch.object(
                    writer, "require_mutable_candidate_release"
                ):
                    with self.assertRaises(writer.MetrikaPublishError):
                        writer.publish_metrika_day_bundle(bundle)
                connect.assert_not_called()

    def test_success_scope_requires_persisted_row_reconciliation(self):
        import canonical_writer as writer

        bundle = day_bundle()
        values = vars(bundle.scopes["other"]).copy()
        values["persisted_rows"] = 9
        bundle.scopes["other"] = SimpleNamespace(**values)
        with patch.object(writer, "get_db_connection") as connect, patch.object(
            writer, "require_mutable_candidate_release"
        ):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(bundle)
        connect.assert_not_called()

    def test_user_behavior_scope_requires_exact_api_row_reconciliation(self):
        import canonical_writer as writer

        bundle = day_bundle()
        values = vars(bundle.scopes["user_behavior"]).copy()
        values["api_total_rows"] = 0
        bundle.scopes["user_behavior"] = SimpleNamespace(**values)
        with patch.object(writer, "get_db_connection") as connect, patch.object(
            writer, "require_mutable_candidate_release"
        ):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.publish_metrika_day_bundle(bundle)
        connect.assert_not_called()

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
                request_fingerprint="failure-request-fingerprint",
            )

        self.assertFalse(any(sql.startswith("DELETE") for _, sql, _ in conn.sql_calls))
        insert_sql, insert_params = next(
            (sql, params)
            for method, sql, params in conn.sql_calls
            if method == "execute" and "source_coverage" in sql
        )
        self.assertIn("ON DUPLICATE KEY UPDATE", insert_sql)
        self.assertIn("request_fingerprint", insert_sql)
        self.assertIn("failure-request-fingerprint", insert_params)
        self.assertIn("MetrikaPermissionError", insert_params)
        self.assertEqual(conn.events.count(("start_transaction", None)), 1)
        self.assertIn(("commit", None), conn.events)

    def test_failure_record_rejects_release_that_became_immutable(self):
        import canonical_writer as writer

        conn = RecordingConnection(
            lock_row={"id": 41, "dataset_key": "abbott", "release_status": "active"}
        )
        with patch.object(writer, "get_db_connection", return_value=conn):
            with self.assertRaises(writer.MetrikaPublishError):
                writer.record_metrika_day_failure(
                    release_id=41,
                    counter_id="90602537",
                    report_date="2026-01-02",
                    run_id=77,
                    scope="page",
                    status="failed",
                    error_class="MetrikaPermissionError",
                    request_fingerprint="failure-request-fingerprint",
                )

        self.assertIn(("rollback", None), conn.events)
        self.assertFalse(any("INSERT INTO" in sql for _, sql, _ in conn.sql_calls))


if __name__ == "__main__":
    unittest.main()
