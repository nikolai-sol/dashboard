import json
import tempfile
import unittest
import urllib.error
from argparse import Namespace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
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

ABBOTT_STALE_INCOMPLETE = {
    "counter_id": "90602537",
    "overall": "CRITICAL",
    "release": {"id": 8, "status": "active", "pointer_matches": True},
    "latest_run": {
        "id": 81, "status": "success", "run_type": "cron",
        "date_from": "2026-07-19", "date_to": "2026-07-22",
        "finished_at": "2026-07-23T06:13:08Z", "counter_id": "90602537",
    },
    "scopes": [
        {
            "scope": scope, "max_date": "2026-07-22", "rows": persisted_rows,
            "missing_dates": [
                "2026-07-23", "2026-07-24", "2026-07-25",
                "2026-07-26", "2026-07-27", "2026-07-28",
            ],
            "status_counts": {"success": 4}, "unexpected_empty": False,
        }
        for scope, persisted_rows in (
            ("other", 40), ("traffic", 80), ("page", 120),
            ("user_behavior", 160), ("returning", 200),
        )
    ],
    "backfill": {
        "lookback_days": 10, "complete_days": 4,
        "missing_days": [
            "2026-07-23", "2026-07-24", "2026-07-25",
            "2026-07-26", "2026-07-27", "2026-07-28",
        ],
    },
    "session_integrity": {
        "days_checked": 4, "all_sessions": 100,
        "with_user_id_sessions": 40, "without_user_id_sessions": 60,
        "mismatched_days": 0, "mismatched_sources": 0, "status": "ok",
    },
    "incidents": [
        {
            "incident_key": "abbott|90602537|collector|stale",
            "severity": "CRITICAL", "check_id": "latest_release_run_freshness",
            "observed": {"finished_at": "2026-07-23T06:13:08Z"},
            "expected": {"expected_completion_at": "2026-07-29T06:00:00Z"},
        },
        *[
            {
                "incident_key": "abbott|90602537|{}|missing_dates".format(scope),
                "severity": "CRITICAL", "check_id": "scope_date_coverage",
                "observed": {"missing_dates": [
                    "2026-07-23", "2026-07-24", "2026-07-25",
                    "2026-07-26", "2026-07-27", "2026-07-28",
                ]},
                "expected": {"missing_dates": []},
            }
            for scope in ("other", "traffic", "page", "user_behavior", "returning")
        ],
    ],
}

ZARUKU_HEALTH = [
    {
        "source_key": "yandex_webmaster",
        "label": "Яндекс Вебмастер",
        "run_status": "success",
        "rows_written": 942,
        "max_data_date": date(2026, 7, 25),
        "data_lag_days": 3,
    },
    {
        "source_key": "yandex_metrika",
        "label": "Яндекс Метрика",
        "run_status": "success",
        "rows_written": 120,
        "max_data_date": date(2026, 7, 27),
        "data_lag_days": 1,
    },
    {
        "source_key": "yandex_metrika_returning",
        "label": "Яндекс Метрика · возвратный контент",
        "run_status": "success",
        "rows_written": 90,
        "max_data_date": date(2026, 7, 26),
        "data_lag_days": 2,
    },
    {
        "source_key": "google_search_console",
        "label": "Google Search Console",
        "run_status": "partial",
        "core_status": "success",
        "optional_status": "http_error",
        "optional_failure_count": 8,
        "optional_http_statuses": [400],
        "rows_written": 500,
        "max_data_date": date(2026, 7, 25),
        "data_lag_days": 3,
    },
]

EMPTY_PARTIAL_SCOPE = {
    "dates": [],
    "distinct_date_count": 0,
    "row_count": 0,
    "layer_count": 0,
    "layers": {},
    "sources": {},
    "rows": [],
}


class TelegramReportTests(unittest.TestCase):
    def test_stable_order_appends_metrika(self):
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-3], "between")
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-2], "google_search_console")
        self.assertEqual(report.SUMMARY_SOURCE_ORDER[-1], "yandex_metrika")

    def test_summary_includes_google_search_console_collector(self):
        payload = {"summary": {"exit_code": 0}, "sources": []}
        runs = [{
            "source_key": "google_search_console",
            "status": "success",
            "run_type": "backfill",
            "run_mode": "daily",
            "rows_read": 40,
            "rows_written": 35,
            "rows_updated": 5,
            "error_count": 0,
            "started_at": "2026-07-20 05:40:00",
        }]

        text = report.build_summary_message(payload, runs, ABBOTT_OK)

        self.assertIn("google search console: SUCCESS", text)
        self.assertIn("type=BACKFILL", text)
        self.assertIn("mode=daily", text)

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

    def test_zaruku_summary_has_four_sources_in_stable_order(self):
        lines = report.build_zaruku_summary_lines(ZARUKU_HEALTH, EMPTY_PARTIAL_SCOPE)
        text = "\n".join(lines)
        labels = [
            "Яндекс Вебмастер",
            "Яндекс Метрика",
            "Яндекс Метрика · возвратный контент",
            "Google Search Console",
        ]
        positions = [text.index(label) for label in labels]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(sum("status=SUCCESS" in line for line in lines), 3)
        for expected in ("rows=", "max=", "lag="):
            self.assertEqual(sum(expected in line for line in lines), 4)
        self.assertIn("Google Search Console: core=SUCCESS; optional=HTTP 400 (8)", text)
        self.assertNotIn("Google Search Console: status=PARTIAL", text)
        self.assertNotIn("частичные даты", text)

    def test_zaruku_summary_shows_partial_dates_only_when_present(self):
        scope = dict(
            EMPTY_PARTIAL_SCOPE,
            dates=["2026-07-14", "2026-07-16"],
            distinct_date_count=2,
            row_count=1697,
            layer_count=2,
            sources={
                "yandex_webmaster": {
                    "dates": ["2026-07-14", "2026-07-16"],
                    "distinct_date_count": 2,
                    "row_count": 1697,
                    "layers": ["webmaster_pages", "webmaster_queries"],
                }
            },
        )
        text = "\n".join(report.build_zaruku_summary_lines(ZARUKU_HEALTH, scope))
        self.assertIn("Яндекс Вебмастер: частичные даты=2", text)
        self.assertIn("строк=1697", text)
        self.assertIn("2026-07-14, 2026-07-16", text)
        self.assertNotIn("Google Search Console: частичные даты", text)

    def test_summary_accepts_zaruku_snapshot_and_places_it_before_abbott(self):
        snapshot = {"health": ZARUKU_HEALTH, "partial_scope": EMPTY_PARTIAL_SCOPE, "lineage_scope": {"row_count": 0}}
        text = report.build_summary_message(
            {"summary": {"exit_code": 0}, "sources": []},
            [],
            ABBOTT_OK,
            zaruku_snapshot=snapshot,
        )
        self.assertLess(text.index("Сбор Zaruku"), text.index("Abbott Metrika"))

    def test_zaruku_incident_messages_cover_four_operational_types(self):
        cases = {
            "data_lag": ({"max_data_date": "2026-07-24", "lag_days": 4, "threshold_days": 3}, "задержка данных"),
            "heartbeat": ({"last_run_at": "2026-07-27T06:00:00+00:00", "age_hours": 30, "expected_frequency_hours": 24}, "нет ожидаемого запуска"),
            "partial_dates": ({"dates": ["2026-07-14"], "distinct_date_count": 1, "row_count": 755, "layers": ["webmaster_queries"]}, "частично записанные даты"),
            "layer_divergence": ({"query_max_date": "2026-07-26", "page_max_date": "2026-07-24", "difference_days": 2}, "расхождение слоёв"),
        }
        for incident_type, (details, phrase) in cases.items():
            message = report.build_zaruku_incident_message(
                {
                    "incident_key": "zaruku|2026-07-28|yandex_webmaster|{}|x".format(incident_type),
                    "source_key": "yandex_webmaster",
                    "label": "Яндекс <Вебмастер>",
                    "incident_type": incident_type,
                    "details": details,
                }
            )
            self.assertIn(phrase, message)
            self.assertIn("Яндекс &lt;Вебмастер&gt;", message)
            self.assertNotIn("Яндекс <Вебмастер>", message)

    def test_new_incident_is_sent_once_and_recorded(self):
        now = datetime(2026, 7, 28, 12, tzinfo=timezone.utc)
        incident = {
            "incident_key": "zaruku|2026-07-28|yandex_webmaster|data_lag|abc",
            "source_key": "yandex_webmaster",
            "label": "Яндекс Вебмастер",
            "incident_type": "data_lag",
            "details": {"max_data_date": "2026-07-24", "lag_days": 4, "threshold_days": 3},
        }
        sent = []
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            first = report.send_new_zaruku_incidents(
                "TOKEN", "CHAT", [incident], path, now_utc=now,
                send_fn=lambda token, chat_id, text: sent.append((token, chat_id, text)),
            )
            second = report.send_new_zaruku_incidents(
                "TOKEN", "CHAT", [incident], path, now_utc=now,
                send_fn=lambda token, chat_id, text: sent.append((token, chat_id, text)),
            )
            state = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(first, [incident["incident_key"]])
        self.assertEqual(second, [])
        self.assertEqual(len(sent), 1)
        self.assertIn(incident["incident_key"], state["sent"])

    def test_failed_incident_transport_does_not_update_state(self):
        now = datetime(2026, 7, 28, 12, tzinfo=timezone.utc)
        incident = {
            "incident_key": "zaruku|2026-07-28|yandex_webmaster|heartbeat|abc",
            "source_key": "yandex_webmaster",
            "label": "Яндекс Вебмастер",
            "incident_type": "heartbeat",
            "details": {"last_run_at": None, "age_hours": None, "expected_frequency_hours": 24},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            with self.assertRaisesRegex(RuntimeError, "transport failed"):
                report.send_new_zaruku_incidents(
                    "TOKEN", "CHAT", [incident], path, now_utc=now,
                    send_fn=lambda *_: (_ for _ in ()).throw(RuntimeError("transport failed")),
                )
            self.assertFalse(path.exists())

    def test_old_incident_keys_are_pruned(self):
        now = datetime(2026, 7, 28, 12, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            path.write_text(
                json.dumps({"sent": {"old": (now - timedelta(days=60)).isoformat(), "current": now.isoformat()}}),
                encoding="utf-8",
            )
            report.send_new_zaruku_incidents("T", "C", [], path, now_utc=now, send_fn=lambda *_: None)
            state = json.loads(path.read_text(encoding="utf-8"))
        self.assertNotIn("old", state["sent"])
        self.assertIn("current", state["sent"])

    @mock.patch("send_canonical_telegram_report.send_new_zaruku_incidents")
    @mock.patch("send_canonical_telegram_report.send_telegram_message")
    @mock.patch("send_canonical_telegram_report.resolve_telegram_credentials", return_value=("TOKEN", "CHAT"))
    @mock.patch("send_canonical_telegram_report.load_zaruku_snapshot")
    @mock.patch("send_canonical_telegram_report.get_latest_collector_runs", return_value=[])
    @mock.patch("send_canonical_telegram_report.run_abbott_health_json", return_value=ABBOTT_OK)
    @mock.patch("send_canonical_telegram_report.run_dashboard_json", return_value={"summary": {"exit_code": 0}, "sources": []})
    @mock.patch("send_canonical_telegram_report.parse_args", return_value=Namespace(mode="summary"))
    def test_main_sends_daily_summary_before_incident_messages(
        self,
        _parse_args,
        _dashboard,
        _abbott,
        _runs,
        load_snapshot,
        _credentials,
        send_message,
        send_incidents,
    ):
        load_snapshot.return_value = {
            "health": ZARUKU_HEALTH,
            "partial_scope": EMPTY_PARTIAL_SCOPE,
            "lineage_scope": {"row_count": 0},
            "incidents": [],
        }

        def assert_summary_was_sent(*_args, **_kwargs):
            self.assertEqual(send_message.call_count, 1)
            return []

        send_incidents.side_effect = assert_summary_was_sent
        self.assertEqual(report.main(), 0)
        self.assertEqual(send_message.call_count, 1)
        send_incidents.assert_called_once()

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
        self.assertIn("последний запуск релиза: SUCCESS", text)
        self.assertIn("2026-07-16T06:30:00Z", text)

    def test_abbott_lines_put_sanitized_session_integrity_immediately_after_header(self):
        lines = report.build_abbott_lines(ABBOTT_OK)
        self.assertEqual(
            lines[1],
            "- целостность сессий на доступных датах (10 дней): OK "
            "(all=100, with_id=40, without_id=60, mismatched_days=0, mismatched_sources=0)",
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
            "- целостность сессий на доступных датах (10 дней): CRITICAL "
            "(all=101, with_id=40, without_id=60, mismatched_days=1, mismatched_sources=2)",
        )

    def test_abbott_stale_incomplete_summary_is_explicit(self):
        text = "\n".join(report.build_abbott_lines(ABBOTT_STALE_INCOMPLETE))

        self.assertIn("последний запуск релиза: SUCCESS, НО УСТАРЕЛ", text)
        self.assertIn("покрытие последних 10 завершённых дней: 4/10", text)
        self.assertIn("нет дат: 2026-07-23…2026-07-28", text)
        self.assertIn("целостность сессий на доступных датах (4 дня): OK", text)
        self.assertIn("технические строки canonical", text)
        self.assertEqual(text.count("нет coverage"), 1)

    def test_compact_abbott_dates_formats_ranges_and_gaps(self):
        self.assertEqual(
            report.compact_abbott_dates(["2026-07-23", "2026-07-24", "2026-07-25"]),
            "2026-07-23…2026-07-25",
        )
        self.assertEqual(report.compact_abbott_dates(["2026-07-23"]), "2026-07-23")
        self.assertEqual(
            report.compact_abbott_dates(["2026-07-23", "2026-07-25"]),
            "2026-07-23, 2026-07-25",
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
