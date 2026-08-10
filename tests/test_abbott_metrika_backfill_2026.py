from __future__ import annotations

import ast
from contextlib import redirect_stderr
from datetime import date
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class CoverageCursor:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((" ".join(sql.split()), params))

    def fetchall(self):
        return list(self.rows)

    def close(self):
        pass


class CoverageConnection:
    def __init__(self, rows):
        self.cursor_instance = CoverageCursor(rows)

    def cursor(self, **kwargs):
        return self.cursor_instance


def coverage_row(scope, status="success", **overrides):
    row = {
        "source_key": "yandex_metrika",
        "scope_key": scope,
        "collection_status": status,
        "pagination_complete": 1,
        "is_sampled": 0,
        "empty_reconciled": 0,
    }
    if status == "success_empty":
        row["empty_reconciled"] = 1
    row.update(overrides)
    return row


class AbbottMetrikaBackfill2026Test(unittest.TestCase):
    def test_disables_bytecode_before_importing_local_modules(self):
        source = Path(__file__).resolve().parents[1] / "backfill_abbott_metrika_2026.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        assignment_indexes = [
            index
            for index, node in enumerate(tree.body)
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "sys"
                and target.attr == "dont_write_bytecode"
                for target in node.targets
            )
            and isinstance(node.value, ast.Constant)
            and node.value.value is True
        ]
        local_import_indexes = [
            index
            for index, node in enumerate(tree.body)
            if isinstance(node, ast.ImportFrom)
            and node.module in {
                "canonical_writer",
                "fetch_yandex_metrika_canonical",
            }
        ]

        self.assertEqual(len(assignment_indexes), 1)
        self.assertEqual(len(local_import_indexes), 2)
        self.assertLess(assignment_indexes[0], min(local_import_indexes))

    def test_windows_cover_2026_from_january_first_through_yesterday(self):
        from backfill_abbott_metrika_2026 import build_backfill_windows

        windows = build_backfill_windows(date(2026, 7, 16))

        self.assertEqual(windows[0], ("2026-01-01", "2026-01-31"))
        self.assertEqual(windows[-1], ("2026-07-01", "2026-07-15"))

    def test_gap_days_are_processed_first_without_dropping_other_days(self):
        from backfill_abbott_metrika_2026 import ordered_backfill_days

        days = ordered_backfill_days(date(2026, 7, 16))

        self.assertEqual(days[0], "2026-03-29")
        self.assertEqual(days[9], "2026-04-07")
        self.assertEqual(len(days), len(set(days)))
        self.assertIn("2026-01-01", days)
        self.assertIn("2026-07-15", days)

    def test_resume_requires_exactly_all_five_reconciled_scopes(self):
        from backfill_abbott_metrika_2026 import (
            ABBOTT_REQUIRED_SCOPES,
            coverage_day_is_reconciled,
        )

        complete = [coverage_row(scope) for scope in ABBOTT_REQUIRED_SCOPES]
        complete[-1] = coverage_row("returning", "success_empty")
        self.assertTrue(coverage_day_is_reconciled(complete))

        for incomplete in (
            complete[:-1],
            [*complete[:-1], coverage_row("returning", "partial")],
            [
                *complete[:-1],
                coverage_row("returning", "success_empty", empty_reconciled=0),
            ],
            [*complete[:-1], coverage_row("returning", is_sampled=1)],
            [
                *complete[:-1],
                coverage_row("returning", pagination_complete=0),
            ],
        ):
            with self.subTest(rows=incomplete):
                self.assertFalse(coverage_day_is_reconciled(incomplete))

    def test_other_source_cannot_substitute_for_metrika_resume_coverage(self):
        from backfill_abbott_metrika_2026 import (
            ABBOTT_REQUIRED_SCOPES,
            coverage_day_is_reconciled,
        )

        foreign_rows = [
            coverage_row(scope, source_key="other_source")
            for scope in ABBOTT_REQUIRED_SCOPES
        ]

        self.assertFalse(coverage_day_is_reconciled(foreign_rows))

    def test_resume_query_is_parameterized_and_fixed_to_abbott(self):
        from backfill_abbott_metrika_2026 import day_is_reconciled

        conn = CoverageConnection([])
        self.assertFalse(day_is_reconciled(conn, canonical_release_id=41, day="2026-01-02"))

        sql, params = conn.cursor_instance.calls[0]
        self.assertIn("canonical_source_coverage_daily", sql)
        self.assertIn("canonical_release_id = %s", sql)
        self.assertIn("counter_id = %s", sql)
        self.assertIn("source_key = %s", sql)
        self.assertIn("report_date = %s", sql)
        self.assertEqual(
            params, (41, "90602537", "yandex_metrika", "2026-01-02")
        )
        self.assertNotIn("90602537", sql)

    def test_runner_skips_only_reconciled_days_and_collects_full_bundles(self):
        from backfill_abbott_metrika_2026 import run_backfill
        from fetch_yandex_metrika_canonical import ABBOTT_REQUIRED_SCOPES

        conn = Mock()
        collect_day = Mock()
        collect_day.return_value.scopes = {
            scope: object() for scope in ABBOTT_REQUIRED_SCOPES
        }
        publish_day = Mock()
        publish_day.return_value.rows_written = 7
        validate_day = Mock()
        baseline_guard = Mock()

        summary = run_backfill(
            conn,
            canonical_release_id=41,
            run_id=77,
            code_revision="revision-a",
            parser_version="metrika-parser-v1",
            days=("2026-03-29", "2026-01-01"),
            is_reconciled=lambda _conn, _release, day: day == "2026-03-29",
            collect_day=collect_day,
            validate_day=validate_day,
            publish_day=publish_day,
            baseline_guard=baseline_guard,
        )

        self.assertEqual(summary["counter_id"], "90602537")
        self.assertEqual(summary["skipped_days"], ["2026-03-29"])
        self.assertEqual(summary["published_days"], ["2026-01-01"])
        baseline_guard.assert_called_once_with(conn, 41)
        collect_day.assert_called_once_with(
            {"counter_id": "90602537"},
            "2026-01-01",
            77,
            41,
            code_revision="revision-a",
            parser_version="metrika-parser-v1",
        )
        validate_day.assert_called_once_with(
            collect_day.return_value, ABBOTT_REQUIRED_SCOPES
        )
        publish_day.assert_called_once_with(collect_day.return_value)

    def test_runner_rejects_blank_fingerprint_context_before_baseline_guard(self):
        from backfill_abbott_metrika_2026 import AbbottBackfillError, run_backfill

        for code_revision, parser_version in (
            ("", "parser-v1"),
            ("revision-a", "   "),
        ):
            with self.subTest(
                code_revision=code_revision, parser_version=parser_version
            ):
                baseline_guard = Mock()
                with self.assertRaises(AbbottBackfillError):
                    run_backfill(
                        Mock(),
                        canonical_release_id=41,
                        run_id=77,
                        code_revision=code_revision,
                        parser_version=parser_version,
                        days=(),
                        baseline_guard=baseline_guard,
                    )
                baseline_guard.assert_not_called()

    def test_runner_logs_sanitized_aggregate_for_failed_days(self):
        from backfill_abbott_metrika_2026 import run_backfill

        collect_day = Mock(side_effect=RuntimeError(
            "https://private.example/visit/123?token=SECRET"
        ))
        log_event = Mock()

        summary = run_backfill(
            Mock(),
            canonical_release_id=41,
            run_id=77,
            code_revision="revision-a",
            parser_version="metrika-parser-v1",
            days=("2026-03-29", "2026-03-30"),
            is_reconciled=lambda *_args: False,
            collect_day=collect_day,
            baseline_guard=Mock(),
            log_event=log_event,
        )

        self.assertEqual(summary["failed_days"], [
            {"report_date": "2026-03-29", "error_class": "RuntimeError"},
            {"report_date": "2026-03-30", "error_class": "RuntimeError"},
        ])
        log_event.assert_called_once_with(
            77,
            "error",
            "abbott_backfill_days_failed",
            "Abbott backfill days failed",
            {
                "failed_day_count": 2,
                "failed_days": summary["failed_days"],
            },
        )
        logged = str(log_event.call_args)
        self.assertNotIn("private.example", logged)
        self.assertNotIn("SECRET", logged)
        self.assertNotIn("123", logged)

    def test_cli_requires_canonical_release_id_and_has_no_counter_override(self):
        from backfill_abbott_metrika_2026 import build_parser

        parser = build_parser()
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parser.parse_args([])
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parser.parse_args(["--canonical-release-id", "41"])
        args = parser.parse_args(
            [
                "--canonical-release-id",
                "41",
                "--code-revision",
                "revision-a",
                "--parser-version",
                "metrika-parser-v1",
            ]
        )
        self.assertEqual(args.canonical_release_id, 41)
        self.assertEqual(args.code_revision, "revision-a")
        self.assertEqual(args.parser_version, "metrika-parser-v1")
        self.assertNotIn("counter_id", vars(args))

    def test_started_run_is_finished_failed_when_connection_setup_fails(self):
        import backfill_abbott_metrika_2026 as runner

        parser = Mock()
        parser.parse_args.return_value = SimpleNamespace(
            canonical_release_id=41,
            code_revision="revision-a",
            parser_version="metrika-parser-v1",
            today_utc=date(2026, 1, 3),
        )
        finish = Mock()
        with patch.object(runner, "build_parser", return_value=parser), patch.object(
            runner, "ordered_backfill_days", return_value=["2026-01-01"]
        ), patch.object(
            runner, "start_collector_run", return_value=77
        ), patch.object(
            runner, "get_db_connection", side_effect=ConnectionError("private DSN")
        ), patch.object(
            runner, "finish_collector_run", finish
        ):
            try:
                exit_code = runner.main()
            except ConnectionError:
                exit_code = None

        self.assertEqual(exit_code, 1)
        finish.assert_called_once_with(
            77,
            status="failed",
            rows_read=0,
            rows_written=0,
            rows_updated=0,
            error_count=1,
            error_summary="Abbott backfill orchestration failed",
        )


if __name__ == "__main__":
    unittest.main()
