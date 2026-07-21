import io
import importlib
import logging
import os
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from types import SimpleNamespace
from unittest.mock import patch

import requests


def response(status_code, *, payload=None, headers=None, url="https://api-metrika.yandex.net/stat/v1/data"):
    result = requests.Response()
    result.status_code = status_code
    result.headers.update(headers or {})
    result.url = url
    if payload is None:
        result._content = b""
    else:
        import json

        result._content = json.dumps(payload).encode("utf-8")
    return result


class YandexMetrikaReturningCanonicalTests(unittest.TestCase):
    def test_only_metrika_token_authorizes_collector_configuration(self):
        import dotenv
        import fetch_yandex_metrika_returning_canonical as collector

        legacy = {
            "YANDEX_METRIKA_TOKEN": "legacy-one",
            "METRIKA_OAUTH_TOKEN": "legacy-two",
            "YANDEX_METRIKA_OAUTH_TOKEN": "legacy-three",
        }
        with patch.dict(os.environ, legacy, clear=True), patch.object(
            dotenv, "load_dotenv", return_value=False
        ), patch.object(dotenv, "dotenv_values", return_value={}):
            collector = importlib.reload(collector)
            self.assertEqual(collector.METRIKA_TOKEN, "")

        with patch.dict(os.environ, {"METRIKA_TOKEN": "current-token", **legacy}, clear=True), patch.object(
            dotenv, "load_dotenv", return_value=False
        ), patch.object(dotenv, "dotenv_values", return_value={}):
            collector = importlib.reload(collector)
            self.assertEqual(collector.METRIKA_TOKEN, "current-token")
    def test_debug_logging_does_not_emit_http_client_urls_or_counter_ids(self):
        import fetch_yandex_metrika_returning_canonical  # noqa: F401

        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        root_logger = logging.getLogger()
        client_logger = logging.getLogger("urllib3.connectionpool")
        previous_root_level = root_logger.level
        previous_client_level = client_logger.level
        root_logger.addHandler(handler)
        root_logger.setLevel(logging.DEBUG)
        client_logger.setLevel(logging.DEBUG)
        try:
            client_logger.debug(
                "GET /stat?ids=987654321&oauth_token=top-secret Authorization=OAuth top-secret"
            )
        finally:
            root_logger.removeHandler(handler)
            root_logger.setLevel(previous_root_level)
            client_logger.setLevel(previous_client_level)

        diagnostics = stream.getvalue()
        for forbidden in ("987654321", "top-secret", "Authorization", "/stat?"):
            self.assertNotIn(forbidden, diagnostics)

    def test_request_retries_503_and_honors_retry_after_without_real_sleep(self):
        from fetch_yandex_metrika_returning_canonical import request_with_retry

        sleeps = []
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=[
                    response(503, headers={"Retry-After": "45"}),
                    response(200, payload={"data": []}),
                ],
            ) as request,
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
            patch("fetch_yandex_metrika_returning_canonical.time.sleep", side_effect=sleeps.append),
        ):
            payload = request_with_retry("66624469", "2026-07-15")

        self.assertEqual(payload, {"data": []})
        self.assertEqual(request.call_count, 2)
        self.assertEqual(len(sleeps), 1)
        self.assertGreaterEqual(sleeps[0], 45)

    def test_request_honors_retry_after_http_date(self):
        from fetch_yandex_metrika_returning_canonical import request_with_retry

        retry_at = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=60), usegmt=True)
        sleeps = []
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=[
                    response(429, headers={"Retry-After": retry_at}),
                    response(200, payload={"data": []}),
                ],
            ),
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
            patch("fetch_yandex_metrika_returning_canonical.time.sleep", side_effect=sleeps.append),
            patch("random.uniform", return_value=0),
        ):
            request_with_retry("66624469", "2026-07-15")

        self.assertEqual(len(sleeps), 1)
        self.assertGreaterEqual(sleeps[0], 50)

    def test_exhausted_429_uses_finite_long_exponential_backoff_with_jitter(self):
        from fetch_yandex_metrika_returning_canonical import request_with_retry

        sleeps = []
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=[response(429) for _ in range(12)],
            ) as request,
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
            patch("fetch_yandex_metrika_returning_canonical.time.sleep", side_effect=sleeps.append),
            patch("random.uniform", return_value=0.5),
        ):
            with self.assertRaises(Exception):
                request_with_retry("66624469", "2026-07-15")

        self.assertEqual(request.call_count, 8)
        self.assertEqual(sleeps, [5.5, 10.5, 20.5, 40.5, 60.5, 60.5, 60.5])
        self.assertGreater(sum(sleeps), 120)
        self.assertLessEqual(sum(sleeps), 300)

    def test_retry_after_beyond_remaining_budget_exhausts_without_zero_delay_requests(self):
        from fetch_yandex_metrika_returning_canonical import (
            MetrikaReturningRequestError,
            request_with_retry,
        )

        sleeps = []
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=[response(429, headers={"Retry-After": "600"}) for _ in range(8)],
            ) as request,
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
            patch("fetch_yandex_metrika_returning_canonical.time.sleep", side_effect=sleeps.append),
            patch("random.uniform", return_value=0),
        ):
            with self.assertRaises(MetrikaReturningRequestError) as caught:
                request_with_retry("66624469", "2026-07-15")

        self.assertEqual(request.call_count, 1)
        self.assertEqual(sleeps, [300.0])
        self.assertEqual(caught.exception.attempts, 1)

    def test_exhausted_retry_diagnostics_exclude_request_and_client_secrets(self):
        from fetch_yandex_metrika_returning_canonical import request_with_retry

        events = []
        secret_url = "https://api.example.test/stat?ids=987654321&oauth_token=top-secret"
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=[response(429, headers={"Retry-After": "6"}, url=secret_url) for _ in range(8)],
            ),
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
            patch("fetch_yandex_metrika_returning_canonical.METRIKA_TOKEN", "top-secret"),
            patch("fetch_yandex_metrika_returning_canonical.time.sleep"),
            patch("random.uniform", return_value=0.5),
            patch("fetch_yandex_metrika_returning_canonical.log_collector_event", side_effect=lambda *args: events.append(args)),
        ):
            with self.assertRaises(Exception) as caught:
                request_with_retry("987654321", "2026-07-15", run_id=42)

        diagnostics = f"{caught.exception!s} {events!r}"
        for forbidden in ("987654321", "2026-07-15", secret_url, "top-secret", "Authorization"):
            self.assertNotIn(forbidden, diagnostics)
        self.assertEqual(caught.exception.__class__.__name__, "MetrikaReturningRequestError")
        self.assertTrue(events)
        allowed_metadata = {
            "status_code",
            "attempt",
            "max_attempts",
            "retry_after_seconds",
            "sleep_seconds",
            "rate_limited",
        }
        for event in events:
            self.assertIn(event[2], {"metrika_returning_api_retry", "metrika_returning_api_retries_exhausted"})
            self.assertLessEqual(set(event[4]), allowed_metadata)

    def test_exhausted_retry_marks_run_failed_without_partial_writes(self):
        from fetch_yandex_metrika_returning_canonical import (
            MetrikaReturningRequestError,
            collect,
        )

        failure = MetrikaReturningRequestError(429, 8, rate_limited=True)
        first_day = {
            "data": [
                {
                    "dimensions": [{"name": "https://zaruku.ru/content/sample/"}],
                    "metrics": [100, 10, 25, 40],
                }
            ]
        }
        args = SimpleNamespace(run_type="manual", force=False)
        with (
            patch("fetch_yandex_metrika_returning_canonical.METRIKA_TOKEN", "configured"),
            patch("fetch_yandex_metrika_returning_canonical.selected_dates", return_value=["2026-07-14", "2026-07-15"]),
            patch("fetch_yandex_metrika_returning_canonical.selected_account_ids", return_value=["987654321"]),
            patch("fetch_yandex_metrika_returning_canonical.start_run", return_value=123),
            patch(
                "fetch_yandex_metrika_returning_canonical.request_all_rows",
                side_effect=[first_day, failure],
            ),
            patch("fetch_yandex_metrika_returning_canonical.upsert_returning_rows") as upsert,
            patch("fetch_yandex_metrika_returning_canonical.finish_run") as finish,
            patch("fetch_yandex_metrika_returning_canonical.log_collector_event"),
        ):
            with self.assertRaises(MetrikaReturningRequestError):
                collect(args)

        upsert.assert_not_called()
        finish.assert_called_once()
        finish_args = finish.call_args.args
        self.assertEqual(finish_args[:6], (123, "failed", 1, 0, 0, 1))
        self.assertNotIn("987654321", finish_args[6])
        self.assertNotIn("2026-07-15", finish_args[6])

    def test_transport_failure_is_sanitized_before_collector_telemetry(self):
        from fetch_yandex_metrika_returning_canonical import request_with_retry

        leaked_url = "https://api.example.test/stat?ids=987654321&oauth_token=top-secret"
        with (
            patch(
                "fetch_yandex_metrika_returning_canonical.requests.get",
                side_effect=requests.ConnectionError(f"connection failed for {leaked_url}"),
            ),
            patch("fetch_yandex_metrika_returning_canonical.REQUEST_DELAY_SECONDS", 0),
        ):
            with self.assertRaises(Exception) as caught:
                request_with_retry("987654321", "2026-07-15")

        self.assertEqual(caught.exception.__class__.__name__, "MetrikaReturningRequestError")
        diagnostics = str(caught.exception)
        for forbidden in ("987654321", "2026-07-15", leaked_url, "top-secret"):
            self.assertNotIn(forbidden, diagnostics)

    def test_success_output_and_events_do_not_log_client_counter_ids(self):
        import json

        from fetch_yandex_metrika_returning_canonical import collect

        args = SimpleNamespace(run_type="manual", force=False)
        events = []
        with (
            patch("fetch_yandex_metrika_returning_canonical.METRIKA_TOKEN", "configured"),
            patch("fetch_yandex_metrika_returning_canonical.selected_dates", return_value=["2026-07-15"]),
            patch("fetch_yandex_metrika_returning_canonical.selected_account_ids", return_value=["987654321"]),
            patch("fetch_yandex_metrika_returning_canonical.start_run", return_value=123),
            patch("fetch_yandex_metrika_returning_canonical.request_all_rows", return_value={"data": []}),
            patch("fetch_yandex_metrika_returning_canonical.upsert_returning_rows", return_value=0),
            patch("fetch_yandex_metrika_returning_canonical.finish_run"),
            patch("fetch_yandex_metrika_returning_canonical.log_collector_event", side_effect=lambda *items: events.append(items)),
        ):
            result = collect(args)

        emitted = f"{json.dumps(result, sort_keys=True)} {events!r}"
        self.assertNotIn("987654321", emitted)

    def test_returning_upsert_uses_canonical_table_and_business_key(self):
        from fetch_yandex_metrika_returning_canonical import RETURNING_PAGE_UPSERT_SQL

        self.assertIn("canonical_fact_metrika_returning_pages_daily", RETURNING_PAGE_UPSERT_SQL)
        self.assertIn("ON DUPLICATE KEY UPDATE", RETURNING_PAGE_UPSERT_SQL)
        self.assertIn("page_hash", RETURNING_PAGE_UPSERT_SQL)
        self.assertNotIn("yandex_metrika_returned", RETURNING_PAGE_UPSERT_SQL)

    def test_normalize_returning_rows_converts_cumulative_recency_to_exclusive_buckets(self):
        from fetch_yandex_metrika_returning_canonical import normalize_returning_rows

        rows = normalize_returning_rows(
            {
                "data": [
                    {
                        "dimensions": [{"name": "https://zaruku.ru/content/sample/"}],
                        "metrics": [100, 10, 25, 40],
                    }
                ]
            },
            analytics_account_id="66624469",
            report_date="2026-07-15",
            run_id=123,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["visits"], 100)
        self.assertEqual(rows[0]["returning_1_day_users"], 10)
        self.assertEqual(rows[0]["returning_2_7_days_users"], 15)
        self.assertEqual(rows[0]["returning_8_31_days_users"], 15)
        self.assertEqual(rows[0]["analytics_account_id"], "66624469")
        self.assertEqual(rows[0]["report_date"], "2026-07-15")
        self.assertEqual(rows[0]["ingestion_run_id"], 123)


if __name__ == "__main__":
    unittest.main()
