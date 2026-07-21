import unittest

from metrika_logs_api import (
    MetrikaLogsClient,
    MetrikaLogsError,
    extract_raw_user_id,
    parse_clickhouse_string_array,
    parse_visits_tsv,
)


FIELDS = (
    "ym:s:visitID",
    "ym:s:dateTime",
    "ym:s:startURL",
    "ym:s:endURL",
    "ym:s:pageViews",
    "ym:s:visitDuration",
    "ym:s:bounce",
    "ym:s:clientID",
    "ym:s:lastsignTrafficSource",
    "ym:s:parsedParamsKey1",
    "ym:s:parsedParamsKey2",
)
HEADER = "\t".join(FIELDS)


def visit_row(visit_id="v1", day="2026-07-19", **overrides):
    values = {
        "visit_id": visit_id,
        "date_time": day + " 12:34:56",
        "start_url": "https://example.test/start?secret=yes",
        "end_url": "https://example.test/end",
        "page_views": "3",
        "duration": "42",
        "bounce": "0",
        "client_id": "client-secret",
        "source": "organic",
        "keys1": "['UserID']",
        "keys2": "['raw-user']",
    }
    values.update(overrides)
    return "\t".join(values.values())


class FakeResponse:
    def __init__(self, status_code=200, *, json_data=None, text=""):
        self.status_code = status_code
        self._json_data = json_data
        self.text = text

    def json(self):
        if isinstance(self._json_data, Exception):
            raise self._json_data
        return self._json_data


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if not self.responses:
            raise AssertionError("unexpected request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def request_routes(session):
    return [(method, url) for method, url, _ in session.calls]


class ParserTests(unittest.TestCase):
    def test_parses_clickhouse_string_array(self):
        self.assertEqual(
            parse_clickhouse_string_array("['UserID','customer\\'s id','']"),
            ("UserID", "customer's id", ""),
        )

    def test_rejects_malformed_clickhouse_string_array(self):
        with self.assertRaises(MetrikaLogsError):
            parse_clickhouse_string_array("[UserID]")

    def test_rejects_adjacent_clickhouse_string_literals(self):
        with self.assertRaisesRegex(MetrikaLogsError, "^Metrika Logs row was invalid$"):
            parse_clickhouse_string_array("['User' 'ID']")

    def test_extracts_single_non_empty_user_id(self):
        self.assertEqual(
            extract_raw_user_id(("Other", "UserID", "UserID"), ("x", "", "abc")),
            "abc",
        )

    def test_returns_none_without_non_empty_user_id(self):
        self.assertIsNone(extract_raw_user_id(("Other", "UserID"), ("x", "")))

    def test_treats_whitespace_only_user_id_as_blank(self):
        self.assertIsNone(extract_raw_user_id(("UserID",), (" \t ",)))

    def test_rejects_two_distinct_user_ids(self):
        with self.assertRaises(MetrikaLogsError):
            extract_raw_user_id(("UserID", "UserID"), ("one", "two"))

    def test_parses_valid_visits_tsv(self):
        result = parse_visits_tsv(HEADER + "\n" + visit_row() + "\n", expected_day="2026-07-19")

        self.assertEqual(
            result,
            ({
                "visit_id": "v1",
                "date_time": "2026-07-19 12:34:56",
                "start_url": "https://example.test/start?secret=yes",
                "end_url": "https://example.test/end",
                "page_views": 3,
                "visit_duration": 42,
                "bounce": 0,
                "client_id": "client-secret",
                "traffic_source": "organic",
                "raw_user_id": "raw-user",
            },),
        )

    def test_accepts_header_only_payload(self):
        self.assertEqual(parse_visits_tsv(HEADER + "\n", expected_day="2026-07-19"), ())

    def test_rejects_reordered_header(self):
        reordered = "\t".join((FIELDS[1], FIELDS[0], *FIELDS[2:]))
        with self.assertRaises(MetrikaLogsError):
            parse_visits_tsv(reordered + "\n", expected_day="2026-07-19")

    def test_rejects_malformed_row(self):
        with self.assertRaises(MetrikaLogsError):
            parse_visits_tsv(HEADER + "\n" + "\t".join(["x"] * 10), expected_day="2026-07-19")

    def test_rejects_blank_and_duplicate_visit_ids(self):
        with self.assertRaises(MetrikaLogsError):
            parse_visits_tsv(HEADER + "\n" + visit_row(visit_id=""), expected_day="2026-07-19")
        with self.assertRaises(MetrikaLogsError):
            parse_visits_tsv(
                HEADER + "\n" + visit_row() + "\n" + visit_row() + "\n",
                expected_day="2026-07-19",
            )

    def test_rejects_whitespace_only_visit_id(self):
        with self.assertRaisesRegex(MetrikaLogsError, "^Metrika Logs row was invalid$"):
            parse_visits_tsv(
                HEADER + "\n" + visit_row(visit_id="   "),
                expected_day="2026-07-19",
            )

    def test_rejects_wrong_visit_day(self):
        with self.assertRaises(MetrikaLogsError):
            parse_visits_tsv(HEADER + "\n" + visit_row(day="2026-07-18"), expected_day="2026-07-19")

    def test_rejects_invalid_integer_metrics_and_bounce(self):
        for overrides in (
            {"page_views": "-1"},
            {"duration": "not-an-int"},
            {"bounce": "2"},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(MetrikaLogsError):
                parse_visits_tsv(HEADER + "\n" + visit_row(**overrides), expected_day="2026-07-19")

    def test_rejects_unicode_digit_and_oversized_integer_metrics_safely(self):
        for page_views in ("١٢", "9" * 5000):
            with self.subTest(kind="unicode" if len(page_views) == 2 else "oversized"):
                with self.assertRaisesRegex(
                    MetrikaLogsError, "^Metrika Logs row was invalid$"
                ) as raised:
                    parse_visits_tsv(
                        HEADER + "\n" + visit_row(page_views=page_views),
                        expected_day="2026-07-19",
                    )
                self.assertNotIn(page_views, str(raised.exception))


class ClientTests(unittest.TestCase):
    def test_collects_all_parts_in_part_number_order_and_cleans(self):
        part_zero = HEADER + "\n" + visit_row("v0") + "\n"
        part_two = HEADER + "\n" + visit_row("v2", keys1="[]", keys2="[]") + "\n"
        session = FakeSession([
            FakeResponse(json_data={"log_request_evaluation": {"possible": True}}),
            FakeResponse(json_data={"log_request": {"request_id": 77}}),
            FakeResponse(json_data={"log_request": {"status": "created"}}),
            FakeResponse(json_data={"log_request": {
                "status": "processed",
                "parts": [{"part_number": 2}, {"part_number": 0}],
            }}),
            FakeResponse(text=part_zero),
            FakeResponse(text=part_two),
            FakeResponse(json_data={}),
        ])

        result = MetrikaLogsClient(
            "top-secret-token", session=session, base_url="https://api.test", poll_delay_seconds=0
        ).collect_visits("123", "2026-07-19")

        self.assertEqual([row["visit_id"] for row in result], ["v0", "v2"])
        self.assertEqual(
            request_routes(session),
            [
                ("GET", "https://api.test/management/v1/counter/123/logrequests/evaluate"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77/part/0/download"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77/part/2/download"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests/77/clean"),
            ],
        )
        params = session.calls[0][2]["params"]
        self.assertEqual(params["source"], "visits")
        self.assertEqual(params["date1"], "2026-07-19")
        self.assertEqual(params["date2"], "2026-07-19")
        self.assertEqual(params["fields"], ",".join(FIELDS))
        self.assertEqual(params["attribution"], "lastsign")
        self.assertEqual(session.calls[1][2]["params"]["attribution"], "lastsign")
        self.assertEqual(session.calls[0][2]["headers"]["Authorization"], "OAuth top-secret-token")

    def test_cleans_after_download_failure_without_replacing_original_error(self):
        session = FakeSession([
            FakeResponse(json_data={"log_request_evaluation": {"possible": True}}),
            FakeResponse(json_data={"log_request": {"request_id": 77}}),
            FakeResponse(json_data={"log_request": {
                "status": "processed", "parts": [{"part_number": 0}]
            }}),
            FakeResponse(status_code=400, text="sensitive remote download error"),
            FakeResponse(status_code=400, text="sensitive cleanup error"),
        ])

        with self.assertRaisesRegex(MetrikaLogsError, "^Metrika Logs request failed$"):
            MetrikaLogsClient("token", session=session, base_url="https://api.test").collect_visits(
                "123", "2026-07-19"
            )
        self.assertEqual(
            request_routes(session),
            [
                ("GET", "https://api.test/management/v1/counter/123/logrequests/evaluate"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/77/part/0/download"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests/77/clean"),
            ],
        )

    def test_does_not_clean_when_create_did_not_succeed(self):
        session = FakeSession([
            FakeResponse(json_data={"log_request_evaluation": {"possible": True}}),
            FakeResponse(status_code=400, text="remote secret"),
        ])

        with self.assertRaises(MetrikaLogsError):
            MetrikaLogsClient("token", session=session, base_url="https://api.test").collect_visits(
                "123", "2026-07-19"
            )
        self.assertEqual(
            request_routes(session),
            [
                ("GET", "https://api.test/management/v1/counter/123/logrequests/evaluate"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests"),
            ],
        )

    def test_retries_429_and_5xx_with_a_fixed_bound(self):
        session = FakeSession([
            FakeResponse(status_code=429),
            FakeResponse(status_code=503),
            FakeResponse(json_data={"log_request_evaluation": {"possible": True}}),
            FakeResponse(json_data={"log_request": {"request_id": 1}}),
            FakeResponse(json_data={"log_request": {"status": "processed", "parts": []}}),
            FakeResponse(json_data={}),
        ])

        result = MetrikaLogsClient("token", session=session, base_url="https://api.test").collect_visits(
            "123", "2026-07-19"
        )

        self.assertEqual(result, ())
        self.assertEqual(sum(call[1].endswith("/evaluate") for call in session.calls), 3)

    def test_invalid_success_json_is_not_retried(self):
        session = FakeSession([FakeResponse(json_data={}), FakeResponse(json_data={})])

        with self.assertRaisesRegex(MetrikaLogsError, "^Metrika Logs response was invalid$"):
            MetrikaLogsClient("token", session=session, base_url="https://api.test").collect_visits(
                "123", "2026-07-19"
            )
        self.assertEqual(len(session.calls), 1)

    def test_polling_is_bounded(self):
        session = FakeSession([
            FakeResponse(json_data={"log_request_evaluation": {"possible": True}}),
            FakeResponse(json_data={"log_request": {"request_id": 1}}),
            FakeResponse(json_data={"log_request": {"status": "created"}}),
            FakeResponse(json_data={"log_request": {"status": "created"}}),
            FakeResponse(json_data={}),
        ])

        with self.assertRaisesRegex(MetrikaLogsError, "^Metrika Logs polling timed out$"):
            MetrikaLogsClient(
                "token", session=session, base_url="https://api.test", max_poll_attempts=2
            ).collect_visits("123", "2026-07-19")
        self.assertEqual(
            request_routes(session),
            [
                ("GET", "https://api.test/management/v1/counter/123/logrequests/evaluate"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/1"),
                ("GET", "https://api.test/management/v1/counter/123/logrequests/1"),
                ("POST", "https://api.test/management/v1/counter/123/logrequests/1/clean"),
            ],
        )

    def test_rejects_invalid_inputs_before_requests(self):
        session = FakeSession([])
        client = MetrikaLogsClient("token", session=session)
        for counter, day, attribution in (
            ("12x", "2026-07-19", "lastsign"),
            ("123", "2026-7-19", "lastsign"),
            ("123", "2026-07-19", "firstsign"),
        ):
            with self.subTest(counter=counter, day=day, attribution=attribution):
                with self.assertRaisesRegex(MetrikaLogsError, "^Invalid Metrika Logs input$"):
                    client.collect_visits(counter, day, attribution)
        self.assertEqual(session.calls, [])

    def test_errors_do_not_expose_sensitive_values(self):
        secrets = (
            "super-secret-token",
            "987654321",
            "2026-07-19",
            "https://private.test/path",
            "remote diagnostic",
        )
        session = FakeSession([
            FakeResponse(status_code=400, text="remote diagnostic https://private.test/path")
        ])

        with self.assertRaises(MetrikaLogsError) as raised:
            MetrikaLogsClient(secrets[0], session=session).collect_visits(secrets[1], secrets[2])

        for secret in secrets:
            self.assertNotIn(secret, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
