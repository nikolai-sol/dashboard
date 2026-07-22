import unittest
import urllib.error
from unittest import mock

import send_canonical_telegram_report as report


ABBOTT_OK = {
    "counter_id": "90602537",
    "overall": "OK",
    "release": {"id": 41, "status": "active", "pointer_matches": True},
    "latest_run": {"id": 77, "status": "success", "run_type": "backfill",
                   "date_from": "2026-07-06", "date_to": "2026-07-15",
                   "finished_at": "2026-07-16T06:30:00Z", "counter_id": "90602537"},
    "scopes": [
        {"scope": scope, "max_date": "2026-07-15", "rows": 1,
         "missing_dates": [], "status_counts": {"success": 10},
         "unexpected_empty": False}
        for scope in ("other", "traffic", "page", "user_behavior", "returning")
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
    "incidents": [],
}


class TelegramReportTests(unittest.TestCase):
    def test_stable_order_appends_metrika(self):
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-2], "between")
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-1], "yandex_metrika")

    def test_summary_includes_between_email_collector(self):
        payload = {"summary": {"exit_code": 0}, "sources": []}
        runs = [{
            "source_key": "between",
            "status": "success",
            "run_type": "backfill",
            "run_mode": "email_xlsx",
            "rows_read": 16,
            "rows_written": 16,
            "rows_updated": 0,
            "error_count": 0,
            "started_at": "2026-07-20 05:40:00",
        }]

        text = report.build_summary_message(payload, runs, ABBOTT_OK)

        self.assertIn("between email: SUCCESS", text)
        self.assertIn("type=BACKFILL", text)
        self.assertIn("mode=email_xlsx", text)

    def test_abbott_critical_triggers_alert(self):
        abbott = dict(ABBOTT_OK, overall="CRITICAL", incidents=[{
            "incident_key": "abbott|90602537|scope|gap",
            "severity": "CRITICAL",
            "check_id": "gap",
            "observed": {"status": "failed"},
            "expected": {"status": "success"},
        }])
        self.assertTrue(report.should_send_alert({"summary": {"exit_code": 0}, "sources": []}, abbott))
        self.assertFalse(report.should_send_alert({"summary": {"exit_code": 0}, "sources": []}, ABBOTT_OK))

    def test_generic_non_blocking_critical_does_not_trigger_alert(self):
        payload = {"summary": {"exit_code": 1}, "sources": [{
            "source_key": "yandex_metrika",
            "status": "CRITICAL",
            "governance": {"blocking": False},
            "collector": {"run_status": "failed", "error_count": 1},
            "freshness": {"days_lag": 9},
            "parity": {"total_mismatches": 1},
            "coverage": {"legacy_only_rows": 1},
        }]}
        self.assertFalse(report.should_send_alert(payload, ABBOTT_OK))

    def test_summary_includes_metrika_then_abbott(self):
        payload = {
            "summary": {"exit_code": 0},
            "sources": [{
                "source_key": "yandex_metrika", "status": "HEALTHY",
                "governance": {"blocking": False},
                "collector": {"run_status": "success", "error_count": 0},
                "freshness": {"days_lag": 1}, "parity": {}, "coverage": {},
            }],
        }
        text = report.build_summary_message(payload, [], ABBOTT_OK)
        self.assertLess(text.index("yandex_metrika"), text.index("Abbott"))
        self.assertIn("90602537", text)
        self.assertIn("returning", text)

    def test_incident_text_is_html_escaped(self):
        abbott = dict(ABBOTT_OK, overall="CRITICAL", incidents=[{
            "incident_key": "abbott|90602537|scope|<gap>&",
            "severity": "CRITICAL", "check_id": "<b>gap</b>",
            "observed": {}, "expected": {},
        }])
        text = "\n".join(report.build_abbott_lines(abbott))
        self.assertNotIn("<b>gap</b>", text)
        self.assertIn("&lt;b&gt;gap&lt;/b&gt;", text)

    def test_abbott_lines_include_counter_scoped_run_timing(self):
        text = "\n".join(report.build_abbott_lines(ABBOTT_OK))
        self.assertIn("run: SUCCESS", text)
        self.assertIn("2026-07-16T06:30:00Z", text)

    def test_abbott_lines_put_sanitized_session_integrity_immediately_after_header(self):
        lines = report.build_abbott_lines(ABBOTT_OK)
        self.assertEqual(
            lines[1],
            "- session integrity: OK (all=100, with_id=40, without_id=60, mismatched_days=0, mismatched_sources=0)",
        )

        mismatch = dict(ABBOTT_OK, session_integrity={
            "days_checked": 10,
            "all_sessions": 101,
            "with_user_id_sessions": 40,
            "without_user_id_sessions": 60,
            "mismatched_days": 1,
            "mismatched_sources": 2,
            "status": "mismatch",
        })
        self.assertEqual(
            report.build_abbott_lines(mismatch)[1],
            "- session integrity: CRITICAL (all=101, with_id=40, without_id=60, mismatched_days=1, mismatched_sources=2)",
        )

    @mock.patch("send_canonical_telegram_report.urllib.request.urlopen")
    def test_transport_errors_do_not_expose_token_or_remote_text(self, urlopen):
        urlopen.side_effect = urllib.error.URLError(
            "https://api.telegram.org/botSECRET/sendMessage?password=LEAK"
        )
        with self.assertRaisesRegex(RuntimeError, "Telegram transport error") as caught:
            report.send_telegram_message("SECRET", "PRIVATE_CHAT", "safe")
        self.assertNotIn("SECRET", str(caught.exception))
        self.assertNotIn("LEAK", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
