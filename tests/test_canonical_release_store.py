from __future__ import annotations

import unittest
from unittest.mock import patch
import json


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


REQUIRED_WORKBOOK_KINDS = (
    "abbott_workbook_json",
    "abbott_workbook_catalog",
)
OPTIONAL_BITRIX_KINDS = (
    "abbott_bitrix_pages",
    "abbott_bitrix_journeys",
)
SOURCE_KINDS = REQUIRED_WORKBOOK_KINDS + OPTIONAL_BITRIX_KINDS


def baseline_manifest(source_kinds=SOURCE_KINDS):
    return {
        "control_values": {"site.traffic.sessions": 100},
        "file_snapshots": [
            {
                "source_kind": kind,
                "content_sha256": str(index + 1) * 64,
                "content_bytes": 100 + index,
                "parser_version": "parser-v1",
            }
            for index, kind in enumerate(source_kinds)
        ],
    }


def exact_evidence_rows(*, warning_without_reviewer=False):
    controls = ["site.traffic.sessions"] + [
        f"coverage.{scope}.reconciled_days"
        for scope in ("other", "traffic", "page", "user_behavior", "returning")
    ]
    rows = []
    for index, control in enumerate(controls):
        warning = warning_without_reviewer and index == 0
        rows.append(
            {
                "control_name": control,
                "result_status": "warn" if warning else "pass",
                "reviewed_by": None,
                "accepted_at": "2026-07-16 10:00:00" if warning else None,
                "code_revision": "abc123",
            }
        )
    return rows


def coverage_only_evidence_rows():
    return [
        {
            "control_name": f"coverage.{scope}.reconciled_days",
            "result_status": "pass",
            "reviewed_by": None,
            "accepted_at": None,
            "code_revision": "abc123",
        }
        for scope in ("other", "traffic", "page", "user_behavior", "returning")
    ]


def validation_batch(run_id, *, completed_at="2026-07-16 10:00:00", rows=None):
    return {
        "validation_run_id": run_id,
        "validation_run_completed_at": completed_at,
        "rows": rows or exact_evidence_rows(),
    }


def imported_snapshot_rows(
    source_kinds=SOURCE_KINDS, *, failed_kind=None, manifest_revision="abc123"
):
    rows = []
    for index, kind in enumerate(source_kinds):
        manifest = {
            "source_kind": kind,
            "content_sha256": str(index + 1) * 64,
            "content_bytes": 100 + index,
            "parser_version": "parser-v1",
            "code_revision": manifest_revision,
        }
        rows.append(
            {
                "id": index + 11,
                "source_kind": kind,
                "content_sha256": manifest["content_sha256"],
                "content_bytes": manifest["content_bytes"],
                "parser_version": manifest["parser_version"],
                "import_status": "failed" if kind == failed_kind else "imported",
                "imported_row_count": 1,
                "rejected_row_count": 0,
                "manifest_json": json.dumps(manifest),
            }
        )
    return rows


def import_execution_rows(
    source_kinds=SOURCE_KINDS,
    *,
    code_revision="abc123",
    failed_kind=None,
    imported_row_count=1,
):
    return [
        {
            "source_snapshot_id": index + 11,
            "source_kind": kind,
            "code_revision": code_revision,
            "import_status": "rejected" if kind == failed_kind else "imported",
            "imported_row_count": imported_row_count,
            "rejected_row_count": 0,
        }
        for index, kind in enumerate(source_kinds)
    ]


class ExactValidationCursor(RecordingCursor):
    def __init__(
        self, connection, *, evidence_rows=None, snapshot_rows=None, execution_rows=None,
        validation_batches=None, source_kinds=SOURCE_KINDS, release_snapshot_ids=None,
        baseline=None,
    ):
        super().__init__()
        self.validation_batches = validation_batches or [
            validation_batch("00000000-0000-0000-0000-000000000001", rows=evidence_rows)
        ]
        self.source_kinds = source_kinds
        self.baseline = baseline or baseline_manifest(source_kinds)
        self.snapshot_rows = (
            imported_snapshot_rows(source_kinds)
            if snapshot_rows is None
            else snapshot_rows
        )
        self.execution_rows = (
            import_execution_rows(source_kinds)
            if execution_rows is None
            else execution_rows
        )
        self.release_snapshot_ids = (
            [index + 11 for index in range(len(source_kinds))]
            if release_snapshot_ids is None
            else release_snapshot_ids
        )
        self.current_one = None
        self.current_many = []

    def execute(self, sql, params=None):
        super().execute(sql, params)
        normalized = " ".join(sql.split())
        self.current_one = None
        self.current_many = []
        if normalized.startswith("SELECT id, dataset_key, release_status"):
            self.current_one = {
                "id": 41,
                "dataset_key": "abbott",
                "release_status": "staging",
                "baseline_validation_run_id": 33,
                "code_revision": "abc123",
                "source_snapshot_ids": json.dumps(self.release_snapshot_ids),
            }
        elif normalized.startswith("SELECT manifest_json"):
            self.current_one = {"manifest_json": json.dumps(self.baseline)}
        elif "FROM portal_release_source_imports" in normalized:
            self.current_many = self.execution_rows
        elif "FROM portal_dataset_snapshots" in normalized:
            self.current_many = self.snapshot_rows
        elif "FROM portal_migration_validation_runs" in normalized:
            if normalized.startswith("SELECT validation_run_id"):
                latest = self.validation_batches[-1]
                self.current_one = {
                    "validation_run_id": latest["validation_run_id"],
                    "validation_run_completed_at": latest["validation_run_completed_at"],
                }
            else:
                selected_run_id = params[-1] if params and len(params) >= 3 else None
                if selected_run_id is None:
                    self.current_many = [
                        row
                        for batch in self.validation_batches
                        for row in batch["rows"]
                    ]
                else:
                    selected_batch = next(
                        (
                            batch
                            for batch in self.validation_batches
                            if batch["validation_run_id"] == selected_run_id
                        ),
                        None,
                    )
                    if selected_batch is not None:
                        self.current_many = [
                            {
                                **row,
                                "validation_run_id": selected_batch["validation_run_id"],
                                "validation_run_completed_at": selected_batch[
                                    "validation_run_completed_at"
                                ],
                            }
                            for row in selected_batch["rows"]
                        ]
        elif normalized.startswith("WITH RECURSIVE calendar"):
            self.current_one = {"missing_date_count": 0}

    def fetchone(self):
        return self.current_one

    def fetchall(self):
        return list(self.current_many)


class ExactValidationConnection(RecordingConnection):
    def __init__(
        self, *, evidence_rows=None, snapshot_rows=None, execution_rows=None,
        validation_batches=None, source_kinds=SOURCE_KINDS, release_snapshot_ids=None,
        baseline=None,
    ):
        self.events = []
        self.cursor_instance = ExactValidationCursor(
            self,
            evidence_rows=evidence_rows,
            snapshot_rows=snapshot_rows,
            execution_rows=execution_rows,
            validation_batches=validation_batches,
            source_kinds=source_kinds,
            release_snapshot_ids=release_snapshot_ids,
            baseline=baseline,
        )


class CanonicalReleaseStoreTest(unittest.TestCase):
    def validate(self, store, conn):
        with patch.object(store, "get_db_connection", return_value=conn):
            store.validate_release(
                41,
                date_from="2026-01-01",
                date_to="2026-01-02",
                expected_code_revision="abc123",
            )

    def test_two_workbook_sources_validate_without_bitrix(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(source_kinds=REQUIRED_WORKBOOK_KINDS)
        self.validate(store, conn)

        sql, params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if "FROM portal_release_source_imports" in sql
        )
        self.assertIn("WHERE canonical_release_id = %s", sql)
        self.assertNotIn("source_snapshot_id IN", sql)
        self.assertEqual(params, (41,))

    def test_metrika_first_candidate_accepts_coverage_only_baseline(self):
        import canonical_release_store as store

        baseline = baseline_manifest(REQUIRED_WORKBOOK_KINDS)
        baseline["control_values"] = {}
        conn = ExactValidationConnection(
            source_kinds=REQUIRED_WORKBOOK_KINDS,
            baseline=baseline,
            evidence_rows=coverage_only_evidence_rows(),
        )

        self.validate(store, conn)

    def test_each_declared_optional_bitrix_source_and_both_validate(self):
        import canonical_release_store as store

        for optional_kinds in (
            ("abbott_bitrix_pages",),
            ("abbott_bitrix_journeys",),
            OPTIONAL_BITRIX_KINDS,
        ):
            with self.subTest(optional_kinds=optional_kinds):
                self.validate(
                    store,
                    ExactValidationConnection(
                        source_kinds=REQUIRED_WORKBOOK_KINDS + optional_kinds
                    ),
                )

    def test_declared_optional_bitrix_source_must_be_present_and_imported(self):
        import canonical_release_store as store

        kinds = REQUIRED_WORKBOOK_KINDS + ("abbott_bitrix_pages",)
        cases = (
            ExactValidationConnection(
                source_kinds=kinds,
                snapshot_rows=imported_snapshot_rows(REQUIRED_WORKBOOK_KINDS),
            ),
            ExactValidationConnection(
                source_kinds=kinds,
                snapshot_rows=imported_snapshot_rows(
                    kinds, failed_kind="abbott_bitrix_pages"
                ),
            ),
            ExactValidationConnection(
                source_kinds=kinds,
                execution_rows=import_execution_rows(
                    kinds, failed_kind="abbott_bitrix_pages"
                ),
            ),
            ExactValidationConnection(
                source_kinds=kinds,
                execution_rows=import_execution_rows(REQUIRED_WORKBOOK_KINDS),
            ),
        )
        for conn in cases:
            with self.subTest(case=cases.index(conn)):
                with self.assertRaises(store.ValidationGateError):
                    self.validate(store, conn)

    def test_validation_rejects_execution_kind_bound_to_another_snapshot_id(self):
        import canonical_release_store as store

        kinds = REQUIRED_WORKBOOK_KINDS + ("abbott_bitrix_pages",)
        executions = import_execution_rows(kinds)
        executions[1] = {**executions[1], "source_snapshot_id": 13}
        executions[2] = {**executions[2], "source_snapshot_id": 12}
        conn = ExactValidationConnection(
            source_kinds=kinds,
            execution_rows=executions,
        )

        with self.assertRaises(store.ValidationGateError):
            self.validate(store, conn)

    def test_source_sets_reject_unknown_duplicates_missing_workbook_and_extras(self):
        import canonical_release_store as store

        workbook_rows = imported_snapshot_rows(REQUIRED_WORKBOOK_KINDS)
        workbook_executions = import_execution_rows(REQUIRED_WORKBOOK_KINDS)
        cases = (
            ExactValidationConnection(
                source_kinds=REQUIRED_WORKBOOK_KINDS + ("unknown_source",)
            ),
            ExactValidationConnection(
                source_kinds=REQUIRED_WORKBOOK_KINDS,
                release_snapshot_ids=[11, 11],
            ),
            ExactValidationConnection(
                source_kinds=("abbott_workbook_json",),
            ),
            ExactValidationConnection(
                source_kinds=REQUIRED_WORKBOOK_KINDS,
                baseline={
                    **baseline_manifest(REQUIRED_WORKBOOK_KINDS),
                    "file_snapshots": [
                        *baseline_manifest(REQUIRED_WORKBOOK_KINDS)["file_snapshots"],
                        baseline_manifest(("abbott_workbook_json",))["file_snapshots"][0],
                    ],
                },
            ),
            ExactValidationConnection(
                source_kinds=REQUIRED_WORKBOOK_KINDS,
                snapshot_rows=[workbook_rows[0], {**workbook_rows[1], "source_kind": workbook_rows[0]["source_kind"]}],
            ),
            ExactValidationConnection(
                source_kinds=REQUIRED_WORKBOOK_KINDS,
                execution_rows=[
                    *workbook_executions,
                    {
                        **import_execution_rows(("abbott_bitrix_pages",))[0],
                        "source_snapshot_id": 13,
                    },
                ],
            ),
        )
        for index, conn in enumerate(cases):
            with self.subTest(case=index):
                with self.assertRaises(store.ValidationGateError):
                    self.validate(store, conn)

    def test_validation_rejects_arbitrary_pass_evidence_not_in_frozen_control_set(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            evidence_rows=[
                {
                    "control_name": "arbitrary.pass",
                    "result_status": "pass",
                    "reviewed_by": None,
                    "accepted_at": None,
                    "code_revision": "abc123",
                }
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
        self.assertFalse(any(sql.startswith("UPDATE portal_data_releases") for sql, _ in conn.cursor_instance.calls))

    def test_validation_requires_reviewer_identity_for_an_accepted_warning(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            evidence_rows=exact_evidence_rows(warning_without_reviewer=True)
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ValidationGateError):
                store.validate_release(
                    41,
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    expected_code_revision="abc123",
                )

    def test_validation_rejects_failed_or_unimported_required_source(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            snapshot_rows=imported_snapshot_rows(failed_kind="abbott_bitrix_pages")
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ValidationGateError):
                store.validate_release(
                    41,
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    expected_code_revision="abc123",
                )

    def test_successor_revision_can_validate_reused_immutable_source_snapshots(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            snapshot_rows=imported_snapshot_rows(
                manifest_revision="predecessor-revision"
            )
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            store.validate_release(
                41,
                date_from="2026-01-01",
                date_to="2026-01-02",
                expected_code_revision="abc123",
            )

    def test_validation_rejects_wrong_per_release_import_execution_revision(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            execution_rows=import_execution_rows(code_revision="wrong-revision")
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ValidationGateError):
                store.validate_release(
                    41,
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    expected_code_revision="abc123",
                )

    def test_validation_rejects_import_execution_count_not_matching_snapshot(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            execution_rows=import_execution_rows(imported_row_count=99)
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            with self.assertRaises(store.ValidationGateError):
                store.validate_release(
                    41,
                    date_from="2026-01-01",
                    date_to="2026-01-02",
                    expected_code_revision="abc123",
                )

    def test_corrected_latest_validation_run_supersedes_failed_first_run(self):
        import canonical_release_store as store

        failed_rows = exact_evidence_rows()
        failed_rows[0] = {**failed_rows[0], "result_status": "fail"}
        conn = ExactValidationConnection(
            validation_batches=[
                validation_batch("00000000-0000-0000-0000-000000000001", rows=failed_rows),
                validation_batch("00000000-0000-0000-0000-000000000002"),
            ]
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            store.validate_release(
                41,
                date_from="2026-01-01",
                date_to="2026-01-02",
                expected_code_revision="abc123",
            )

    def test_incomplete_latest_validation_run_fails_closed(self):
        import canonical_release_store as store

        conn = ExactValidationConnection(
            validation_batches=[
                validation_batch(
                    "00000000-0000-0000-0000-000000000003",
                    completed_at=None,
                )
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

    def test_old_wrong_revision_evidence_is_ignored_when_latest_batch_is_valid(self):
        import canonical_release_store as store

        old_rows = [
            {**row, "code_revision": "old-revision"}
            for row in exact_evidence_rows()
        ]
        conn = ExactValidationConnection(
            validation_batches=[
                validation_batch("00000000-0000-0000-0000-000000000004", rows=old_rows),
                validation_batch("00000000-0000-0000-0000-000000000005"),
            ]
        )
        with patch.object(store, "get_db_connection", return_value=conn):
            store.validate_release(
                41,
                date_from="2026-01-01",
                date_to="2026-01-02",
                expected_code_revision="abc123",
            )

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

        conn = ExactValidationConnection()
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
