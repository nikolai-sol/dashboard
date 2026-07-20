import json
import os
import unittest
from datetime import date
from unittest import mock

from abbott_health_probe import (
    ABBOTT_COUNTER_ID,
    REQUIRED_SCOPES,
    build_session_integrity,
    build_scope_status,
    collect_snapshot,
    evaluate_snapshot,
    sanitize_snapshot,
)


class SnapshotCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))

    def fetchone(self):
        sql = self.calls[-1][0]
        if "portal_active_data_releases" in sql:
            return {"canonical_release_id": 41, "release_status": "active", "pointer_release_id": 41}
        if "canonical_collector_runs" in sql:
            return {"id": 77, "status": "success", "run_type": "backfill",
                    "date_from": date(2026, 7, 6), "date_to": date(2026, 7, 15),
                    "finished_at": "2026-07-16T06:30:00Z"}
        if "canonical_collector_run_events" in sql:
            return {"event_payload": json.dumps({"counter_id": ABBOTT_COUNTER_ID, "skipped_counters": [{"counter_id": "999"}]})}
        return None

    def fetchall(self):
        sql = self.calls[-1][0]
        if "canonical_fact_metrika_site_analytics_daily" in sql:
            return [
                {
                    "report_date": date(2026, 7, day),
                    "traffic_source": "Direct traffic",
                    "user_id_presence": marker,
                    "sessions": sessions,
                }
                for day in range(6, 16)
                for marker, sessions in (
                    ("all", "10"),
                    ("with_user_id", "4"),
                    ("without_user_id", "6"),
                )
            ]
        return [
            {"scope_key": scope, "report_date": date(2026, 7, day),
             "collection_status": "success", "persisted_rows": 1,
             "pagination_complete": 1, "is_sampled": 0, "empty_reconciled": 0}
            for day in range(6, 16)
            for scope in REQUIRED_SCOPES
        ]


def healthy_snapshot():
    return {
        "generated_at_utc": "2026-07-16T08:00:00Z",
        "dashboard": "abbott",
        "counter_id": ABBOTT_COUNTER_ID,
        "overall": "OK",
        "release": {"id": 41, "status": "active", "pointer_matches": True},
        "latest_run": {
            "id": 77,
            "status": "success",
            "run_type": "backfill",
            "date_from": "2026-07-06",
            "date_to": "2026-07-15",
                "finished_at": "2026-07-16T06:30:00Z",
            "counter_id": ABBOTT_COUNTER_ID,
        },
        "scopes": [
            {
                "scope": scope,
                "max_date": "2026-07-15",
                "rows": 10,
                "missing_dates": [],
                "status_counts": {"success": 10},
                "unexpected_empty": False,
            }
            for scope in REQUIRED_SCOPES
        ],
        "backfill": {"lookback_days": 10, "complete_days": 10, "missing_days": []},
        "session_integrity": {
            "days_checked": 10,
            "all_sessions": 100,
            "with_user_id_sessions": 40,
            "without_user_id_sessions": 60,
            "mismatched_days": 0,
            "mismatched_sources": 0,
            "status": "ok",
        },
        "skipped_counter": False,
        "incidents": [],
    }


class AbbottProbeTests(unittest.TestCase):
    def test_collect_snapshot_filters_active_release_and_exact_counter(self):
        cur = SnapshotCursor()
        snapshot = collect_snapshot(cur, date(2026, 7, 16), ABBOTT_COUNTER_ID)

        coverage_call = next(call for call in cur.calls if "canonical_source_coverage_daily" in call[0])
        sessions_call = next(call for call in cur.calls if "canonical_fact_metrika_site_analytics_daily" in call[0])
        run_call = next(call for call in cur.calls if "canonical_collector_runs" in call[0])
        event_call = next(call for call in cur.calls if "canonical_collector_run_events" in call[0] and "SELECT event_payload" in call[0])
        self.assertEqual(run_call[1], (41, ABBOTT_COUNTER_ID))
        self.assertEqual(event_call[1], (77, ABBOTT_COUNTER_ID))
        self.assertEqual(coverage_call[1][0:2], (41, ABBOTT_COUNTER_ID))
        self.assertEqual(
            sessions_call[1],
            (41, ABBOTT_COUNTER_ID, ABBOTT_COUNTER_ID, date(2026, 7, 6), date(2026, 7, 15)),
        )
        self.assertIn("analytics_scope = 'other'", sessions_call[0])
        self.assertIn("$.user_id_presence", sessions_call[0])
        self.assertIn("SUM(sessions)", sessions_call[0])
        self.assertIn("GROUP BY report_date, traffic_source, user_id_presence", sessions_call[0])
        self.assertNotIn("report_bd_private", "\n".join(sql for sql, _ in cur.calls))
        self.assertNotIn("canonical_fact_ads_daily", "\n".join(sql for sql, _ in cur.calls))
        self.assertFalse(snapshot["skipped_counter"])
        self.assertEqual(snapshot["overall"], "OK")
        self.assertEqual(snapshot["backfill"]["complete_days"], 10)
        self.assertEqual(snapshot["session_integrity"], {
            "days_checked": 10,
            "all_sessions": 100,
            "with_user_id_sessions": 40,
            "without_user_id_sessions": 60,
            "mismatched_days": 0,
            "mismatched_sources": 0,
            "status": "ok",
        })

    def test_session_integrity_counts_missing_markers_and_unequal_partitions(self):
        rows = [
            {"report_date": date(2026, 7, 14), "traffic_source": "Direct", "user_id_presence": "all", "sessions": "10"},
            {"report_date": date(2026, 7, 14), "traffic_source": "Direct", "user_id_presence": "with_user_id", "sessions": "4"},
            {"report_date": date(2026, 7, 14), "traffic_source": "Direct", "user_id_presence": "without_user_id", "sessions": "5"},
            {"report_date": date(2026, 7, 14), "traffic_source": "Organic", "user_id_presence": "all", "sessions": "3"},
            {"report_date": date(2026, 7, 14), "traffic_source": "Organic", "user_id_presence": "with_user_id", "sessions": "3"},
            {"report_date": date(2026, 7, 15), "traffic_source": "Direct", "user_id_presence": "all", "sessions": "8"},
            {"report_date": date(2026, 7, 15), "traffic_source": "Direct", "user_id_presence": "with_user_id", "sessions": "2"},
            {"report_date": date(2026, 7, 15), "traffic_source": "Direct", "user_id_presence": "without_user_id", "sessions": "6"},
        ]

        self.assertEqual(build_session_integrity(rows, days_checked=2), {
            "days_checked": 2,
            "all_sessions": 21,
            "with_user_id_sessions": 9,
            "without_user_id_sessions": 11,
            "mismatched_days": 1,
            "mismatched_sources": 2,
            "status": "mismatch",
        })

    def test_session_partition_mismatch_creates_one_sanitized_critical_incident(self):
        snapshot = healthy_snapshot()
        snapshot["session_integrity"] = {
            "days_checked": 10,
            "all_sessions": 101,
            "with_user_id_sessions": 40,
            "without_user_id_sessions": 60,
            "mismatched_days": 1,
            "mismatched_sources": 2,
            "status": "mismatch",
        }

        incidents = evaluate_snapshot(snapshot)

        session_incidents = [item for item in incidents if item["check_id"] == "session_partition_integrity"]
        self.assertEqual(session_incidents, [{
            "incident_key": "abbott|90602537|sessions|partition_mismatch",
            "severity": "CRITICAL",
            "check_id": "session_partition_integrity",
            "observed": {
                "all_sessions": 101,
                "with_user_id_sessions": 40,
                "without_user_id_sessions": 60,
                "mismatched_days": 1,
                "mismatched_sources": 2,
            },
            "expected": {
                "mismatched_days": 0,
                "mismatched_sources": 0,
                "all_sessions_equals_partitions": True,
            },
        }])
        sanitize_snapshot(dict(snapshot, incidents=incidents, overall="CRITICAL"))

    def test_session_integrity_sanitizer_is_exact_and_non_negative(self):
        sanitize_snapshot(healthy_snapshot())

        for field, value in (("status", "unknown"), ("all_sessions", -1)):
            with self.subTest(field=field):
                snapshot = healthy_snapshot()
                snapshot["session_integrity"][field] = value
                with self.assertRaises(ValueError):
                    sanitize_snapshot(snapshot)

        snapshot = healthy_snapshot()
        snapshot["session_integrity"]["traffic_source"] = "private source"
        with self.assertRaises(ValueError):
            sanitize_snapshot(snapshot)

    def test_five_scope_ten_day_coverage_detects_one_gap(self):
        rows = [
            {"scope_key": "traffic", "report_date": date(2026, 7, day),
             "collection_status": "success", "persisted_rows": 1}
            for day in range(6, 16) if day != 11
        ]
        status = build_scope_status(rows, date(2026, 7, 15), 10)
        traffic = next(row for row in status if row["scope"] == "traffic")

        self.assertEqual(tuple(row["scope"] for row in status), REQUIRED_SCOPES)
        self.assertEqual(traffic["missing_dates"], ["2026-07-11"])

    def test_sample_flag_cannot_hide_behind_success_status(self):
        rows = [{
            "scope_key": "traffic",
            "report_date": date(2026, 7, 15),
            "collection_status": "success",
            "persisted_rows": 1,
            "pagination_complete": 1,
            "is_sampled": 1,
            "empty_reconciled": 0,
        }]
        traffic = next(
            row for row in build_scope_status(rows, date(2026, 7, 15), 1)
            if row["scope"] == "traffic"
        )
        self.assertEqual(traffic["status_counts"], {"sampled": 1})

    def test_reconciled_success_empty_is_complete_and_not_zero_row_incident(self):
        rows = [{
            "scope_key": scope,
            "report_date": date(2026, 7, 15),
            "collection_status": "success_empty",
            "persisted_rows": 0,
            "pagination_complete": 1,
            "is_sampled": 0,
            "empty_reconciled": 1,
        } for scope in REQUIRED_SCOPES]
        snapshot = healthy_snapshot()
        snapshot["scopes"] = build_scope_status(rows, date(2026, 7, 15), 1)
        incidents = evaluate_snapshot(snapshot)
        self.assertNotIn("scope_rows", {item["check_id"] for item in incidents})

    @mock.patch.dict(os.environ, {
        "ABBOTT_HEALTH_TIMEZONE": "Europe/Moscow",
        "ABBOTT_EXPECTED_COMPLETION_HOUR": "9",
    }, clear=False)
    def test_freshness_uses_local_completion_boundary(self):
        before = healthy_snapshot()
        before["generated_at_utc"] = "2026-07-16T05:59:00Z"
        before["latest_run"]["finished_at"] = "2026-07-15T06:00:00Z"
        self.assertNotIn(
            "latest_release_run_freshness",
            {item["check_id"] for item in evaluate_snapshot(before)},
        )

        at_deadline = healthy_snapshot()
        at_deadline["generated_at_utc"] = "2026-07-16T06:00:00Z"
        at_deadline["latest_run"]["finished_at"] = "2026-07-16T05:59:59Z"
        self.assertIn(
            "latest_release_run_freshness",
            {item["check_id"] for item in evaluate_snapshot(at_deadline)},
        )

    def test_gap_partial_sampled_and_failed_are_critical(self):
        snapshot = healthy_snapshot()
        snapshot["scopes"][0]["missing_dates"] = ["2026-07-11"]
        snapshot["scopes"][1]["status_counts"] = {"partial": 1, "success": 9}
        snapshot["scopes"][2]["status_counts"] = {"sampled": 1, "success": 9}
        snapshot["latest_run"]["status"] = "failed"

        incidents = evaluate_snapshot(snapshot)
        checks = {incident["check_id"] for incident in incidents}
        self.assertIn("scope_date_coverage", checks)
        self.assertIn("scope_collection_status", checks)
        self.assertIn("latest_release_run", checks)
        self.assertTrue(all(item["severity"] == "CRITICAL" for item in incidents))

    def test_exact_skipped_counter_is_critical(self):
        snapshot = healthy_snapshot()
        snapshot["skipped_counter"] = True
        incidents = evaluate_snapshot(snapshot)
        self.assertIn("exact_counter_skipped", {item["check_id"] for item in incidents})

    def test_active_release_mismatch_is_critical(self):
        snapshot = healthy_snapshot()
        snapshot["release"]["pointer_matches"] = False
        incidents = evaluate_snapshot(snapshot)
        self.assertIn("active_release", {item["check_id"] for item in incidents})

    def test_sanitizer_recursively_rejects_private_and_secret_evidence(self):
        forbidden = [
            ("user_id", "123"),
            ("page_path", "/patient/123"),
            ("note", "page?utm_source=private"),
            ("oauth_token", "secret"),
            ("password", "secret"),
            ("dsn", "mysql://user:pass@host/db"),
        ]
        for key, value in forbidden:
            with self.subTest(key=key):
                snapshot = healthy_snapshot()
                snapshot["incidents"] = [{
                    "incident_key": "abbott|90602537|scope|unsafe",
                    "severity": "CRITICAL",
                    "check_id": "unsafe",
                    "observed": {"nested": {key: value}},
                    "expected": {},
                }]
                with self.assertRaises(ValueError):
                    sanitize_snapshot(snapshot)

    def test_sanitized_payload_contains_no_forbidden_markers(self):
        rendered = json.dumps(sanitize_snapshot(healthy_snapshot())).lower()
        for marker in (
            '"user_id":', '"start_url":', '"end_url":', '"page_url":',
            '"token":', '"password":', '"dsn":', "?",
        ):
            self.assertNotIn(marker, rendered)

    def test_sanitizer_rejects_path_or_token_like_allowed_values(self):
        for unsafe in ("/private/patient/123", "opaque-token-value"):
            with self.subTest(unsafe=unsafe):
                snapshot = healthy_snapshot()
                snapshot["incidents"] = [{
                    "incident_key": "abbott|90602537|scope|unsafe",
                    "severity": "CRITICAL",
                    "check_id": unsafe,
                    "observed": {},
                    "expected": {},
                }]
                with self.assertRaises(ValueError):
                    sanitize_snapshot(snapshot)

    def test_sanitizer_rejects_unknown_nested_fields_and_opaque_statuses(self):
        snapshot = healthy_snapshot()
        snapshot["release"]["benign_extra"] = "opaque"
        with self.assertRaises(ValueError):
            sanitize_snapshot(snapshot)

        snapshot = healthy_snapshot()
        snapshot["incidents"] = [{
            "incident_key": "abbott|90602537|raw-private-id|inactive",
            "severity": "CRITICAL",
            "check_id": "active_release",
            "observed": {"status": "failed", "pointer_matches": False},
            "expected": {"status": "active", "pointer_matches": True},
        }]
        with self.assertRaises(ValueError):
            sanitize_snapshot(snapshot)

        snapshot = healthy_snapshot()
        snapshot["latest_run"]["status"] = "opaque-status"
        with self.assertRaises(ValueError):
            sanitize_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()
