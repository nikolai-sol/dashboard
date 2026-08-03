from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class AbbottActiveReleaseCronTest(unittest.TestCase):
    @staticmethod
    def _coverage_rows():
        import run_abbott_metrika_active_release as launcher

        return [
            {
                "scope_key": scope,
                "collection_status": "success",
                "pagination_complete": 1,
                "is_sampled": 0,
                "persisted_rows": 1,
                "api_total_rows": 1,
                "empty_reconciled": 0,
            }
            for scope in launcher.ABBOTT_REQUIRED_SCOPES
        ]

    def _coverage_result(self, rows):
        import run_abbott_metrika_active_release as launcher

        class Cursor:
            def execute(self, sql, params):
                self.sql = " ".join(sql.split())
                self.params = params

            def fetchall(self):
                return rows

            def close(self):
                pass

        class Connection:
            def __init__(self):
                self.cursor_instance = Cursor()

            def cursor(self, **unused):
                return self.cursor_instance

            def close(self):
                pass

        connection = Connection()
        with patch.object(launcher, "get_db_connection", return_value=connection):
            result = launcher.active_day_is_reconciled(41, "2026-07-21")
        return result, connection.cursor_instance

    def test_active_release_query_avoids_reserved_release_alias(self):
        import run_abbott_metrika_active_release as launcher

        class Cursor:
            def execute(self, sql, params):
                self.sql = " ".join(sql.split())

            def fetchone(self):
                return {
                    "canonical_release_id": 41,
                    "release_status": "active",
                    "code_revision": "abcdef123456",
                }

            def close(self):
                pass

        class Connection:
            def __init__(self):
                self.cursor_instance = Cursor()

            def cursor(self, **unused):
                return self.cursor_instance

            def close(self):
                pass

        connection = Connection()
        with patch.object(launcher, "get_db_connection", return_value=connection):
            self.assertEqual(launcher.resolve_active_release("abcdef123456"), 41)

        self.assertNotIn(" AS release ", connection.cursor_instance.sql)
        self.assertIn(" AS data_release ", connection.cursor_instance.sql)

    def test_command_is_exact_counter_release_and_five_scope_collector_path(self):
        import run_abbott_metrika_active_release as launcher

        command = launcher.build_collector_command(
            collector=Path("/canonical/fetch_yandex_metrika_canonical.py"),
            release_id=41,
            code_revision="abcdef123456",
            parser_version="abbott-v1",
        )
        self.assertEqual(
            command[:3],
            [sys.executable, "-B", "/canonical/fetch_yandex_metrika_canonical.py"],
        )
        self.assertEqual(command[command.index("--days-back") + 1], "1")
        self.assertEqual(command[command.index("--counter-id") + 1], "90602537")
        self.assertEqual(command[command.index("--canonical-release-id") + 1], "41")
        self.assertEqual(command[command.index("--code-revision") + 1], "abcdef123456")
        self.assertEqual(command[command.index("--parser-version") + 1], "abbott-v1")

    def test_completed_day_requires_strict_release_gate_coverage(self):
        rows = self._coverage_rows()
        result, cursor = self._coverage_result(rows)

        self.assertTrue(result)
        self.assertIn("persisted_rows", cursor.sql)
        self.assertIn("api_total_rows", cursor.sql)
        self.assertEqual(cursor.params, (41, "yandex_metrika", "90602537", "2026-07-21"))

    def test_completed_day_accepts_strictly_reconciled_empty_scope(self):
        rows = self._coverage_rows()
        rows[0].update(
            collection_status="success_empty",
            persisted_rows=0,
            api_total_rows=0,
            empty_reconciled=1,
        )

        result, unused_cursor = self._coverage_result(rows)

        self.assertTrue(result)

    def test_completed_day_rejects_malformed_or_partial_coverage(self):
        mutations = {
            "success_without_rows": lambda rows: rows[0].update(persisted_rows=0),
            "empty_with_persisted_rows": lambda rows: rows[0].update(
                collection_status="success_empty",
                persisted_rows=1,
                api_total_rows=0,
                empty_reconciled=1,
            ),
            "empty_with_api_rows": lambda rows: rows[0].update(
                collection_status="success_empty",
                persisted_rows=0,
                api_total_rows=1,
                empty_reconciled=1,
            ),
            "empty_with_null_api_rows": lambda rows: rows[0].update(
                collection_status="success_empty",
                persisted_rows=0,
                api_total_rows=None,
                empty_reconciled=1,
            ),
            "empty_without_reconciliation": lambda rows: rows[0].update(
                collection_status="success_empty",
                persisted_rows=0,
                api_total_rows=0,
                empty_reconciled=0,
            ),
            "sampled": lambda rows: rows[0].update(is_sampled=1),
            "sampled_unknown": lambda rows: rows[0].update(is_sampled=None),
            "incomplete": lambda rows: rows[0].update(pagination_complete=0),
            "invalid_pagination_flag": lambda rows: rows[0].update(
                pagination_complete=2
            ),
            "missing_scope": lambda rows: rows.pop(),
            "duplicate_scope": lambda rows: rows[0].update(
                scope_key=rows[1]["scope_key"]
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                rows = self._coverage_rows()
                mutate(rows)
                result, unused_cursor = self._coverage_result(rows)
                self.assertFalse(result)

    def test_run_resolves_active_pointer_after_runtime_attestation(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector = root / "fetch_yandex_metrika_canonical.py"
            manifest = root / "runtime.sha256"
            collector.write_text("# collector\n", encoding="utf-8")
            manifest.write_text("placeholder\n", encoding="utf-8")
            args = SimpleNamespace(
                canonical_root=root,
                manifest=manifest,
                collector=collector,
                runtime_revision="runtime987654",
                code_revision="abcdef123456",
                parser_version="abbott-v1",
            )
            order = []
            with patch.object(
                launcher,
                "attest_runtime",
                side_effect=lambda unused_root, revision, unused_manifest: order.append(
                    ("attest", revision)
                ),
            ), patch.object(
                launcher,
                "resolve_active_release",
                side_effect=lambda revision: order.append(("resolve", revision)) or 41,
            ), patch.object(
                launcher, "active_day_is_reconciled", return_value=False
            ), patch.object(launcher.subprocess, "run") as execute:
                launcher.run(args)

        self.assertEqual(
            order,
            [("attest", "runtime987654"), ("resolve", "abcdef123456")],
        )
        command = execute.call_args.args[0]
        self.assertEqual(command[command.index("--canonical-release-id") + 1], "41")
        self.assertNotIn("shell", execute.call_args.kwargs)
        self.assertTrue(execute.call_args.kwargs["check"])

    def test_run_records_successful_noop_when_completed_day_is_already_reconciled(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector = root / "fetch_yandex_metrika_canonical.py"
            manifest = root / "runtime.sha256"
            collector.write_text("# collector\n", encoding="utf-8")
            manifest.write_text("placeholder\n", encoding="utf-8")
            args = SimpleNamespace(
                canonical_root=root,
                manifest=manifest,
                collector=collector,
                runtime_revision="runtime987654",
                code_revision="abcdef123456",
                parser_version="abbott-v1",
            )
            with patch.object(launcher, "attest_runtime"), patch.object(
                launcher, "resolve_active_release", return_value=41
            ), patch.object(
                launcher, "completed_utc_day", create=True, return_value="2026-07-21"
            ), patch.object(
                launcher, "active_day_is_reconciled", create=True, return_value=True
            ), patch.object(
                launcher, "record_reconciled_noop", create=True
            ) as record_noop, patch.object(launcher.subprocess, "run") as execute:
                launcher.run(args)

        record_noop.assert_called_once_with(41, "2026-07-21")
        execute.assert_not_called()

    def test_reconciled_noop_records_expected_success_summary(self):
        import run_abbott_metrika_active_release as launcher

        with patch.object(launcher, "start_collector_run", return_value=1550), patch.object(
            launcher, "log_run_event"
        ) as log_event, patch.object(launcher, "finish_collector_run") as finish:
            launcher.record_reconciled_noop(8, "2026-07-21")

        payload = log_event.call_args.args[4]
        self.assertEqual(payload["counter_id"], "90602537")
        self.assertEqual(payload["canonical_release_id"], 8)
        self.assertEqual(payload["already_reconciled_days"], ["2026-07-21"])
        self.assertEqual(payload["published_days"], 0)
        self.assertEqual(payload["rows_written"], 0)
        finish.assert_called_once_with(
            1550,
            status="success",
            rows_read=0,
            rows_written=0,
            rows_updated=0,
            error_count=0,
            error_summary=None,
        )

    def test_reconciled_noop_marks_started_run_failed_and_sanitizes_error(self):
        import run_abbott_metrika_active_release as launcher

        with patch.object(launcher, "start_collector_run", return_value=1550), patch.object(
            launcher, "log_run_event", side_effect=RuntimeError("secret database detail")
        ), patch.object(launcher, "finish_collector_run") as finish:
            with self.assertRaisesRegex(
                launcher.ActiveReleaseLaunchError,
                "Unable to record Abbott reconciled no-op",
            ) as raised:
                launcher.record_reconciled_noop(8, "2026-07-21")

        self.assertNotIn("secret", str(raised.exception))
        finish.assert_called_once_with(
            1550,
            status="failed",
            rows_read=0,
            rows_written=0,
            rows_updated=0,
            error_count=1,
            error_summary="Abbott reconciled no-op audit failed",
        )

    def test_reconciled_noop_sanitizes_start_failure_without_finish(self):
        import run_abbott_metrika_active_release as launcher

        with patch.object(
            launcher,
            "start_collector_run",
            side_effect=RuntimeError("secret database detail"),
        ), patch.object(launcher, "finish_collector_run") as finish:
            with self.assertRaisesRegex(
                launcher.ActiveReleaseLaunchError,
                "Unable to record Abbott reconciled no-op",
            ) as raised:
                launcher.record_reconciled_noop(8, "2026-07-21")

        self.assertNotIn("secret", str(raised.exception))
        finish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
