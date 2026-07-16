from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class RecordingCursor:
    def __init__(self, *, snapshot_id=33):
        self.snapshot_id = snapshot_id
        self.lastrowid = snapshot_id
        self.calls = []
        self._rows = []

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.calls.append((normalized, params))
        if "canonical_fact_metrika_site_analytics_daily" in normalized:
            self._rows = [
                {
                    "scope_key": "traffic",
                    "fact_rows": 2,
                    "sessions": 100,
                    "users": 80,
                    "pageviews": 120,
                }
            ]
        elif "canonical_source_coverage_daily" in normalized:
            self._rows = [
                {
                    "scope_key": "traffic",
                    "coverage_days": 1,
                    "api_total_rows": 100,
                    "persisted_rows": 100,
                }
            ]

    def fetchall(self):
        return list(self._rows)

    def close(self):
        pass


class RecordingConnection:
    def __init__(self):
        self.cursor_instance = RecordingCursor()
        self.events = []

    def cursor(self, **kwargs):
        self.events.append(("cursor", kwargs))
        return self.cursor_instance

    def start_transaction(self, **kwargs):
        self.events.append(("start_transaction", kwargs))

    def commit(self):
        self.events.append(("commit", None))

    def rollback(self):
        self.events.append(("rollback", None))


class ComparatorCursor:
    def __init__(self, *, release_baseline_id=33, coverage_rows=None):
        self.release_baseline_id = release_baseline_id
        self.coverage_rows = coverage_rows or [
            {
                "scope_key": scope,
                "coverage_days": 196,
                "reconciled_days": 196,
                "api_total_rows": 0,
                "persisted_rows": 0,
            }
            for scope in ("other", "traffic", "page", "user_behavior", "returning")
        ]
        self.calls = []
        self._one = None
        self._rows = []

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.calls.append((normalized, params))
        self._one = None
        self._rows = []
        if normalized.startswith("SELECT manifest_json"):
            self._one = {
                "manifest_json": json.dumps(
                    {
                        "date_from": "2026-01-01",
                        "date_to": "2026-07-15",
                        "control_values": {"site.traffic.sessions": 100},
                    }
                )
            }
        elif normalized.startswith("SELECT code_revision"):
            self._one = {
                "code_revision": "candidate-revision",
                "baseline_validation_run_id": self.release_baseline_id,
            }
        elif "canonical_fact_metrika_site_analytics_daily" in normalized:
            self._rows = [
                {
                    "scope_key": "traffic",
                    "fact_rows": 1,
                    "sessions": 100,
                    "users": 80,
                    "pageviews": 120,
                }
            ]
        elif "canonical_source_coverage_daily" in normalized:
            self._rows = self.coverage_rows

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self._rows)

    def close(self):
        pass


class ComparatorConnection(RecordingConnection):
    def __init__(self, *, release_baseline_id=33, coverage_rows=None):
        self.cursor_instance = ComparatorCursor(
            release_baseline_id=release_baseline_id,
            coverage_rows=coverage_rows,
        )
        self.events = []


class AbbottCanonicalControlsTest(unittest.TestCase):
    def test_stable_hash_is_independent_of_mapping_key_order(self):
        from abbott_canonical_controls import stable_json_hash

        self.assertEqual(
            stable_json_hash({"b": [2, 1], "a": 1}),
            stable_json_hash({"a": 1, "b": [2, 1]}),
        )

    def test_api_fingerprint_covers_every_reproducibility_setting(self):
        from abbott_canonical_controls import api_fingerprint

        base = {
            "dimensions": ("ym:s:date", "ym:s:lastTrafficSource"),
            "metrics": ("ym:s:visits", "ym:s:users"),
            "filters": "ym:s:isRobot=='No'",
            "attribution": "lastsign",
            "accuracy": "full",
            "pagination_limit": 100000,
            "timezone": "Europe/Moscow",
            "code_revision": "revision-a",
            "parser_version": "metrika-parser-v1",
        }
        original = api_fingerprint(**base)
        mutations = {
            "metrics": ("ym:s:visits", "ym:s:pageviews"),
            "filters": "ym:s:isRobot=='Yes'",
            "attribution": "first",
            "accuracy": "medium",
            "pagination_limit": 1000,
            "timezone": "UTC",
            "code_revision": "revision-b",
            "parser_version": "metrika-parser-v2",
        }
        for field, changed in mutations.items():
            with self.subTest(field=field):
                self.assertNotEqual(
                    original,
                    api_fingerprint(**{**base, field: changed}),
                )

    def test_collector_persisted_scope_fingerprint_binds_code_and_parser(self):
        import fetch_yandex_metrika_canonical as collector
        from metrika_pagination import PaginationResult

        response = PaginationResult(
            rows=(
                {
                    "dimensions": [
                        {"name": "https://example.test/material"},
                        {"name": "Material"},
                    ],
                    "metrics": [10, 5],
                },
            ),
            total_rows=1,
            pages_fetched=1,
            pagination_complete=True,
            sampled=False,
            sample_share=None,
        )
        with patch.object(collector, "request_all_pages", return_value=response):
            first = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "page",
                77,
                41,
                code_revision="revision-a",
                parser_version="parser-v1",
            )
            changed_code = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "page",
                77,
                41,
                code_revision="revision-b",
                parser_version="parser-v1",
            )
            changed_parser = collector.collect_metrika_scope(
                collector.ABBOTT_COUNTER_ID,
                "2026-01-02",
                "page",
                77,
                41,
                code_revision="revision-a",
                parser_version="parser-v2",
            )

        self.assertNotEqual(
            first.request_fingerprint, changed_code.request_fingerprint
        )
        self.assertNotEqual(
            first.request_fingerprint, changed_parser.request_fingerprint
        )
        self.assertNotEqual(
            first.rows[0]["scope_hash"], changed_code.rows[0]["scope_hash"]
        )
        self.assertNotEqual(
            first.rows[0]["scope_hash"], changed_parser.rows[0]["scope_hash"]
        )

    def test_file_snapshot_reads_only_the_explicit_file(self):
        from abbott_canonical_controls import file_snapshot, stable_json_hash

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            selected = root / "selected.csv"
            ignored = root / "ignored.csv"
            selected.write_text("key,value\na,1\n", encoding="utf-8")
            ignored.write_text("private,identifier\n", encoding="utf-8")

            snapshot = file_snapshot(
                selected, source_kind="portal_csv", parser_version="csv-v1"
            )

        self.assertEqual(snapshot["source_name"], "selected.csv")
        self.assertEqual(snapshot["source_row_count"], 1)
        self.assertEqual(snapshot["content_bytes"], len(b"key,value\na,1\n"))
        self.assertNotEqual(snapshot["content_sha256"], stable_json_hash({}))
        self.assertNotIn("ignored", json.dumps(snapshot))
        self.assertNotIn(str(root), json.dumps(snapshot))

    def test_baseline_is_insert_only_and_committed_before_return(self):
        from abbott_canonical_controls import capture_current_control_pack

        conn = RecordingConnection()
        with tempfile.TemporaryDirectory() as tmp:
            private_dir = Path(tmp) / "private-controls"
            baseline_id = capture_current_control_pack(
                conn,
                counter_id="90602537",
                date_from="2026-01-01",
                date_to="2026-07-15",
                private_archive_dir=private_dir,
                code_revision="f69b645",
            )
            archived = list(private_dir.iterdir())
            directory_mode = os.stat(private_dir).st_mode & 0o777
            file_mode = os.stat(archived[0]).st_mode & 0o777

        self.assertEqual(baseline_id, 33)
        self.assertEqual(directory_mode, 0o700)
        self.assertEqual(file_mode, 0o600)
        self.assertEqual(len(archived), 1)
        self.assertIn(("commit", None), conn.events)
        mutation_sql = " ".join(sql for sql, _ in conn.cursor_instance.calls)
        self.assertIn("INSERT INTO portal_dataset_snapshots", mutation_sql)
        self.assertNotIn("ON DUPLICATE KEY", mutation_sql)
        self.assertNotIn("UPDATE portal_dataset_snapshots", mutation_sql)
        self.assertNotIn("DELETE FROM portal_dataset_snapshots", mutation_sql)
        insert_params = next(
            params
            for sql, params in conn.cursor_instance.calls
            if "INSERT INTO portal_dataset_snapshots" in sql
        )
        self.assertTrue(all("%s" not in str(value) for value in insert_params))

    def test_explicit_file_snapshots_are_frozen_into_baseline_evidence(self):
        from abbott_canonical_controls import (
            capture_current_control_pack,
            file_snapshot,
        )

        conn = RecordingConnection()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "portal.csv"
            source.write_text("key,value\na,1\n", encoding="utf-8")
            source_snapshot = file_snapshot(
                source, source_kind="portal_csv", parser_version="csv-v1"
            )
            private_dir = root / "private-controls"

            capture_current_control_pack(
                conn,
                counter_id="90602537",
                date_from="2026-01-01",
                date_to="2026-07-15",
                private_archive_dir=private_dir,
                code_revision="f69b645",
                file_snapshots=(source_snapshot,),
            )

            evidence = json.loads(next(private_dir.iterdir()).read_text())

        self.assertEqual(evidence["file_snapshots"], [source_snapshot])

    def test_api_delta_over_one_percent_fails(self):
        from abbott_canonical_controls import compare_numeric_control

        result = compare_numeric_control(
            "api.traffic.sessions",
            expected=100,
            actual=101.01,
            threshold=0.01,
        )

        self.assertEqual(result.result_status, "fail")
        self.assertGreater(result.relative_delta, 0.01)

    def test_unapproved_warning_blocks_cutover(self):
        from abbott_canonical_controls import ControlResult, cutover_allowed

        warning = ControlResult(
            control_name="known_baseline_anomaly",
            expected_value=1,
            actual_value=1,
            absolute_delta=0,
            relative_delta=0,
            threshold_value=0,
            result_status="warn",
            diagnostic={"reason_code": "known_anomaly"},
        )
        approved = ControlResult(
            **{
                **warning.__dict__,
                "reviewed_by": "reviewer",
                "accepted_at": "2026-07-16T10:00:00Z",
            }
        )

        self.assertFalse(cutover_allowed([warning]))
        self.assertTrue(cutover_allowed([approved]))

    def test_diagnostics_reject_identifiers_and_paths(self):
        from abbott_canonical_controls import UnsafeDiagnosticError, validate_diagnostic

        unsafe = (
            {"raw_user_id": "123"},
            {"rawUserId": "123"},
            {"page_path": "/private/journey"},
            {"detail": {"journey": "private/doctor/record"}},
            {"detail": "https://portal.example/private?id=123"},
            {"archive": "/var/private/evidence.json"},
        )
        for diagnostic in unsafe:
            with self.subTest(diagnostic=diagnostic):
                with self.assertRaises(UnsafeDiagnosticError):
                    validate_diagnostic(diagnostic)

        self.assertEqual(
            validate_diagnostic(
                {"reason_code": "relative_delta_exceeded", "scope": "traffic"}
            ),
            {"reason_code": "relative_delta_exceeded", "scope": "traffic"},
        )

    def test_comparator_requires_candidate_to_reference_selected_baseline(self):
        from abbott_canonical_controls import AbbottControlError, compare_release_control_pack

        conn = ComparatorConnection(release_baseline_id=34)

        with self.assertRaises(AbbottControlError):
            compare_release_control_pack(
                conn, baseline_run_id=33, candidate_release_id=41
            )

        self.assertIn(("rollback", None), conn.events)
        self.assertFalse(
            any(
                sql.startswith("INSERT INTO portal_migration_validation_runs")
                for sql, _ in conn.cursor_instance.calls
            )
        )

    def test_comparator_candidate_queries_are_counter_and_period_scoped(self):
        from abbott_canonical_controls import compare_release_control_pack

        conn = ComparatorConnection()
        results = compare_release_control_pack(
            conn, baseline_run_id=33, candidate_release_id=41
        )

        self.assertTrue(all(result.result_status == "pass" for result in results))
        fact_sql, fact_params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if "canonical_fact_metrika_site_analytics_daily" in sql
        )
        self.assertIn("counter_id = %s", fact_sql)
        self.assertIn("report_date BETWEEN %s AND %s", fact_sql)
        self.assertEqual(
            fact_params,
            (41, "90602537", "2026-01-01", "2026-07-15"),
        )
        coverage_sql, coverage_params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if "canonical_source_coverage_daily" in sql
        )
        self.assertIn("source_key = %s", coverage_sql)
        self.assertEqual(
            coverage_params,
            (41, "90602537", "yandex_metrika", "2026-01-01", "2026-07-15"),
        )

    def test_comparator_persists_one_completed_validation_batch_per_comparison(self):
        from abbott_canonical_controls import compare_release_control_pack

        conn = ComparatorConnection()
        compare_release_control_pack(
            conn, baseline_run_id=33, candidate_release_id=41
        )

        inserts = [
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if sql.startswith("INSERT INTO portal_migration_validation_runs")
        ]
        self.assertGreater(len(inserts), 1)
        run_ids = {params[2] for _, params in inserts}
        self.assertEqual(len(run_ids), 1)
        validation_run_id = run_ids.pop()
        self.assertRegex(validation_run_id, r"^[0-9a-f-]{36}$")
        for sql, _ in inserts:
            self.assertIn("validation_run_id", sql)
            self.assertIn("validation_run_completed_at", sql)
        completion_sql, completion_params = next(
            (sql, params)
            for sql, params in conn.cursor_instance.calls
            if sql.startswith("UPDATE portal_migration_validation_runs")
        )
        self.assertIn("validation_run_completed_at = UTC_TIMESTAMP()", completion_sql)
        self.assertEqual(completion_params, (41, 33, validation_run_id))

    def test_comparator_fails_when_any_daily_scope_is_not_reconciled(self):
        from abbott_canonical_controls import compare_release_control_pack

        coverage_rows = [
            {
                "scope_key": scope,
                "coverage_days": 196,
                "reconciled_days": 196,
                "api_total_rows": 0,
                "persisted_rows": 0,
            }
            for scope in ("other", "traffic", "page", "user_behavior")
        ]
        conn = ComparatorConnection(coverage_rows=coverage_rows)

        results = compare_release_control_pack(
            conn, baseline_run_id=33, candidate_release_id=41
        )

        returning = next(
            result
            for result in results
            if result.control_name == "coverage.returning.reconciled_days"
        )
        self.assertEqual(returning.result_status, "fail")


if __name__ == "__main__":
    unittest.main()
