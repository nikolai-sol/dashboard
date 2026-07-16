from __future__ import annotations

import unittest
from unittest.mock import patch


class RecordingCursor:
    def __init__(self, rows=None, *, lastrowid=101):
        self.rows = list(rows or [])
        self.lastrowid = lastrowid
        self.rowcount = 1
        self.calls = []
        self.closed = False

    def execute(self, sql, params=None):
        self.calls.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        if not self.rows:
            return []
        if isinstance(self.rows[0], list):
            return self.rows.pop(0)
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, rows=None, *, lastrowid=101):
        self.cursor_instance = RecordingCursor(rows, lastrowid=lastrowid)
        self.events = []

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


class CanonicalReleaseStoreTest(unittest.TestCase):
    def test_validation_requires_every_calendar_day_and_exact_scope_set(self):
        import canonical_release_store as store

        rows = [
            {"report_date": "2026-01-01", "scope_key": scope}
            for scope in store.ABBOTT_REQUIRED_METRIKA_SCOPES
        ]
        rows.extend(
            {"report_date": "2026-01-03", "scope_key": scope}
            for scope in store.ABBOTT_REQUIRED_METRIKA_SCOPES
        )

        self.assertEqual(
            store.missing_coverage_dates(rows, date_from="2026-01-01", date_to="2026-01-03"),
            ["2026-01-02"],
        )

    def test_validation_persists_staging_to_validated_cas_after_evidence_and_coverage(self):
        import canonical_release_store as store

        coverage = [
            {"report_date": day, "scope_key": scope}
            for day in ("2026-01-01", "2026-01-02")
            for scope in store.ABBOTT_REQUIRED_METRIKA_SCOPES
        ]
        conn = RecordingConnection(
            [
                {
                    "id": 41,
                    "dataset_key": "abbott",
                    "release_status": "staging",
                    "baseline_validation_run_id": 33,
                    "code_revision": "abc123",
                },
                {
                    "evidence_count": 8,
                    "fail_count": 0,
                    "unaccepted_warn_count": 0,
                    "revision_mismatch_count": 0,
                },
                {"missing_date_count": 0},
            ]
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            store.validate_release(
                41,
                date_from="2026-01-01",
                date_to="2026-01-02",
                expected_code_revision="abc123",
            )

        update_sql, params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if sql.startswith("UPDATE portal_data_releases")
        )
        self.assertIn("release_status = 'validated'", update_sql)
        self.assertIn("release_status = 'staging'", update_sql)
        self.assertEqual(params, ("abbott", 41))
        self.assertIn(("commit", None), conn.events)

    def test_validation_rejects_unaccepted_warning_without_transition(self):
        import canonical_release_store as store

        conn = RecordingConnection(
            [
                {
                    "id": 41,
                    "dataset_key": "abbott",
                    "release_status": "staging",
                    "baseline_validation_run_id": 33,
                    "code_revision": "abc123",
                },
                {
                    "evidence_count": 8,
                    "fail_count": 0,
                    "unaccepted_warn_count": 1,
                    "revision_mismatch_count": 0,
                },
            ]
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ValidationGateError):
                store.validate_release(
                    41,
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    expected_code_revision="abc123",
                )

        self.assertFalse(
            any(sql.startswith("UPDATE portal_data_releases") for sql, _ in conn.cursor_instance.calls)
        )
        self.assertIn(("rollback", None), conn.events)

    def test_candidate_creation_records_predecessor_baseline_and_revision(self):
        import canonical_release_store as store

        conn = RecordingConnection(
            [{"canonical_release_id": 12}], lastrowid=41
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            release_id = store.create_candidate_release(
                portal_key="abbott",
                predecessor_release_id=12,
                baseline_validation_run_id=33,
                code_revision="abc123",
            )

        self.assertEqual(release_id, 41)
        insert_sql, params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if sql.startswith("INSERT INTO portal_data_releases")
        )
        self.assertIn("INSERT INTO portal_data_releases", insert_sql)
        self.assertIn("rollback_from_release_id", insert_sql)
        self.assertEqual(params[0], "abbott")
        self.assertIn(12, params)
        self.assertIn(33, params)
        self.assertIn("abc123", params)
        self.assertIn(("commit", None), conn.events)

    def test_candidate_creation_rejects_a_stale_predecessor_pointer(self):
        import canonical_release_store as store

        conn = RecordingConnection([{"canonical_release_id": 13}])
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ReleasePointerConflictError):
                store.create_candidate_release(
                    portal_key="abbott",
                    predecessor_release_id=12,
                    baseline_validation_run_id=33,
                    code_revision="abc123",
                )

        self.assertFalse(
            any(sql.startswith("INSERT INTO portal_data_releases") for sql, _ in conn.cursor_instance.calls)
        )
        self.assertIn(("rollback", None), conn.events)

    def test_mutable_candidate_requires_matching_dataset_and_staging_status(self):
        import canonical_release_store as store

        release = {"id": 41, "dataset_key": "abbott", "release_status": "staging"}
        conn = RecordingConnection([release])
        with patch.object(store, "get_db_connection", return_value=conn):
            actual = store.require_mutable_candidate_release(41, portal_key="abbott")

        self.assertEqual(actual, release)
        sql, params = conn.cursor_instance.calls[0]
        self.assertIn("dataset_key = %s", sql)
        self.assertIn("id = %s", sql)
        self.assertEqual(params, ("abbott", 41))

    def test_active_release_is_immutable(self):
        import canonical_release_store as store

        conn = RecordingConnection(
            [{"id": 41, "dataset_key": "abbott", "release_status": "active"}]
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ImmutableReleaseError):
                store.require_mutable_candidate_release(41)

    def test_activation_locks_pointer_and_compare_and_swaps_expected_release(self):
        import canonical_release_store as store

        conn = RecordingConnection([{"canonical_release_id": 12}])
        with patch.object(store, "get_db_connection", return_value=conn):
            store.activate_release(41, expected_active_release_id=12)

        calls = conn.cursor_instance.calls
        lock_index = next(i for i, (sql, _) in enumerate(calls) if "FOR UPDATE" in sql)
        update_index = next(
            i for i, (sql, _) in enumerate(calls)
            if sql.startswith("UPDATE portal_active_data_releases")
        )
        self.assertLess(lock_index, update_index)
        update_sql, update_params = calls[update_index]
        self.assertIn("dataset_key = %s", update_sql)
        self.assertIn("canonical_release_id = %s", update_sql)
        self.assertEqual(update_params[-2:], ("abbott", 12))
        self.assertEqual(conn.events.count(("start_transaction", None)), 1)
        self.assertIn(("commit", None), conn.events)

    def test_activation_rejects_stale_expected_pointer_and_rolls_back(self):
        import canonical_release_store as store

        conn = RecordingConnection([{"canonical_release_id": 13}])
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ReleasePointerConflictError):
                store.activate_release(41, expected_active_release_id=12)

        self.assertIn(("rollback", None), conn.events)
        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_active_data_releases")
                for sql, _ in conn.cursor_instance.calls
            )
        )

    def test_rollback_locks_and_compare_and_swaps_from_release(self):
        import canonical_release_store as store

        conn = RecordingConnection([{"canonical_release_id": 41}])
        with patch.object(store, "get_db_connection", return_value=conn):
            store.rollback_release(from_release_id=41, to_release_id=12)

        calls = conn.cursor_instance.calls
        self.assertTrue(any("FOR UPDATE" in sql for sql, _ in calls))
        update_sql, update_params = next(
            (sql, params)
            for sql, params in calls
            if sql.startswith("UPDATE portal_active_data_releases")
        )
        self.assertIn("dataset_key = %s", update_sql)
        self.assertEqual(update_params[-2:], ("abbott", 41))
        self.assertIn(("commit", None), conn.events)


if __name__ == "__main__":
    unittest.main()
