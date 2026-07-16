import unittest
import urllib.error
from unittest import mock

import send_canonical_telegram_report as report


ABBOTT_OK = {
    "counter_id": "90602537",
    "overall": "OK",
    "release": {"id": 41, "status": "active", "pointer_matches": True},
    "scopes": [
        {"scope": scope, "max_date": "2026-07-15", "rows": 1,
         "missing_dates": [], "status_counts": {"success": 10}}
        for scope in ("other", "traffic", "page", "user_behavior", "returning")
    ],
    "backfill": {"lookback_days": 10, "complete_days": 10, "missing_days": []},
    "incidents": [],
}


class TelegramReportTests(unittest.TestCase):
    def test_stable_order_appends_metrika(self):
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-1], "yandex_metrika")

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
