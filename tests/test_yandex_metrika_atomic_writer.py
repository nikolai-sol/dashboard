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
        return self.connection.lock_row

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, fail_on=None, lock_row=None):
        self.fail_on = fail_on
        self.lock_row = (
            {"id": 41, "dataset_key": "abbott", "release_status": "staging"}
            if lock_row is None
            else lock_row
        )
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

        lock_index = next(
            i for i, (_, sql, _) in enumerate(conn.sql_calls)
            if "FROM portal_data_releases" in sql and "FOR UPDATE" in sql
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
