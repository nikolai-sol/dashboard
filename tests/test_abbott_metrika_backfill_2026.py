from __future__ import annotations

from contextlib import redirect_stderr
from datetime import date
import io
import unittest
from unittest.mock import Mock


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

    def test_resume_query_is_parameterized_and_fixed_to_abbott(self):
        from backfill_abbott_metrika_2026 import day_is_reconciled

        conn = CoverageConnection([])
        self.assertFalse(day_is_reconciled(conn, canonical_release_id=41, day="2026-01-02"))

        sql, params = conn.cursor_instance.calls[0]
        self.assertIn("canonical_source_coverage_daily", sql)
        self.assertIn("canonical_release_id = %s", sql)
        self.assertIn("counter_id = %s", sql)
        self.assertIn("report_date = %s", sql)
        self.assertEqual(params, (41, "90602537", "2026-01-02"))
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
            {"counter_id": "90602537"}, "2026-01-01", 77, 41
        )
        validate_day.assert_called_once_with(
            collect_day.return_value, ABBOTT_REQUIRED_SCOPES
        )
        publish_day.assert_called_once_with(collect_day.return_value)

    def test_cli_requires_canonical_release_id_and_has_no_counter_override(self):
        from backfill_abbott_metrika_2026 import build_parser

        parser = build_parser()
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parser.parse_args([])
        args = parser.parse_args(["--canonical-release-id", "41"])
        self.assertEqual(args.canonical_release_id, 41)
        self.assertNotIn("counter_id", vars(args))


if __name__ == "__main__":
    unittest.main()
