from __future__ import annotations

import csv
import io
import re
import time
from datetime import datetime


DEFAULT_BASE_URL = "https://api-metrika.yandex.net"
DEFAULT_TIMEOUT = 30
DEFAULT_MAX_POLL_ATTEMPTS = 60
DEFAULT_POLL_DELAY_SECONDS = 1
_HTTP_ATTEMPTS = 3

VISIT_FIELDS = (
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


class MetrikaLogsError(RuntimeError):
    pass


def parse_clickhouse_string_array(value: str) -> tuple[str, ...]:
    if not isinstance(value, str):
        raise MetrikaLogsError("Metrika Logs row was invalid")

    length = len(value)
    position = 0

    def skip_whitespace() -> None:
        nonlocal position
        while position < length and value[position].isspace():
            position += 1

    skip_whitespace()
    if position >= length or value[position] != "[":
        raise MetrikaLogsError("Metrika Logs row was invalid")
    position += 1
    skip_whitespace()
    if position < length and value[position] == "]":
        position += 1
        skip_whitespace()
        if position != length:
            raise MetrikaLogsError("Metrika Logs row was invalid")
        return ()

    parsed = []
    escape_values = {
        "0": "\0",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "\\": "\\",
        "'": "'",
    }
    while True:
        skip_whitespace()
        if position >= length or value[position] != "'":
            raise MetrikaLogsError("Metrika Logs row was invalid")
        position += 1
        characters = []
        while position < length:
            character = value[position]
            position += 1
            if character == "'":
                break
            if character == "\\":
                if position >= length:
                    raise MetrikaLogsError("Metrika Logs row was invalid")
                escaped = value[position]
                position += 1
                characters.append(escape_values.get(escaped, escaped))
            else:
                characters.append(character)
        else:
            raise MetrikaLogsError("Metrika Logs row was invalid")
        parsed.append("".join(characters))

        skip_whitespace()
        if position >= length:
            raise MetrikaLogsError("Metrika Logs row was invalid")
        if value[position] == "]":
            position += 1
            skip_whitespace()
            if position != length:
                raise MetrikaLogsError("Metrika Logs row was invalid")
            return tuple(parsed)
        if value[position] != ",":
            raise MetrikaLogsError("Metrika Logs row was invalid")
        position += 1


def extract_raw_user_id(level1: tuple[str, ...], level2: tuple[str, ...]) -> str | None:
    if len(level1) != len(level2):
        raise MetrikaLogsError("Metrika Logs row was invalid")
    matches = {
        value
        for key, value in zip(level1, level2)
        if key == "UserID" and isinstance(value, str) and value.strip() != ""
    }
    if len(matches) > 1:
        raise MetrikaLogsError("Metrika Logs row was invalid")
    return next(iter(matches), None)


def _parse_non_negative_integer(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value) or len(value) > 19:
        raise MetrikaLogsError("Metrika Logs row was invalid")
    try:
        parsed = int(value)
    except (ValueError, OverflowError):
        raise MetrikaLogsError("Metrika Logs row was invalid") from None
    if parsed > 2**63 - 1:
        raise MetrikaLogsError("Metrika Logs row was invalid")
    return parsed


def _valid_day(value: str) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") == value
    except ValueError:
        return False


def parse_visits_tsv(payload: str, *, expected_day: str) -> tuple[dict, ...]:
    if not isinstance(payload, str) or not _valid_day(expected_day):
        raise MetrikaLogsError("Metrika Logs payload was invalid")
    try:
        rows = list(csv.reader(io.StringIO(payload, newline=""), delimiter="\t", strict=True))
    except (csv.Error, UnicodeError):
        raise MetrikaLogsError("Metrika Logs payload was invalid") from None
    if not rows or tuple(rows[0]) != VISIT_FIELDS:
        raise MetrikaLogsError("Metrika Logs payload was invalid")

    result = []
    seen_visit_ids = set()
    for row in rows[1:]:
        if len(row) != len(VISIT_FIELDS):
            raise MetrikaLogsError("Metrika Logs row was invalid")
        (
            visit_id,
            date_time,
            start_url,
            end_url,
            page_views_text,
            duration_text,
            bounce_text,
            client_id,
            traffic_source,
            level1_text,
            level2_text,
        ) = row
        if not visit_id.strip() or visit_id in seen_visit_ids:
            raise MetrikaLogsError("Metrika Logs row was invalid")
        try:
            parsed_date_time = datetime.strptime(date_time, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise MetrikaLogsError("Metrika Logs row was invalid") from None
        if parsed_date_time.strftime("%Y-%m-%d") != expected_day:
            raise MetrikaLogsError("Metrika Logs row was invalid")

        page_views = _parse_non_negative_integer(page_views_text)
        visit_duration = _parse_non_negative_integer(duration_text)
        bounce = _parse_non_negative_integer(bounce_text)
        if bounce not in (0, 1):
            raise MetrikaLogsError("Metrika Logs row was invalid")
        raw_user_id = extract_raw_user_id(
            parse_clickhouse_string_array(level1_text),
            parse_clickhouse_string_array(level2_text),
        )
        seen_visit_ids.add(visit_id)
        result.append({
            "visit_id": visit_id,
            "date_time": date_time,
            "start_url": start_url,
            "end_url": end_url,
            "page_views": page_views,
            "visit_duration": visit_duration,
            "bounce": bounce,
            "client_id": client_id,
            "traffic_source": traffic_source,
            "raw_user_id": raw_user_id,
        })
    return tuple(result)


class MetrikaLogsClient:
    def __init__(
        self,
        token: str,
        *,
        session=None,
        base_url=DEFAULT_BASE_URL,
        timeout=DEFAULT_TIMEOUT,
        max_poll_attempts=DEFAULT_MAX_POLL_ATTEMPTS,
        poll_delay_seconds=DEFAULT_POLL_DELAY_SECONDS,
    ):
        if session is None:
            import requests

            session = requests.Session()
        self._token = token
        self._session = session
        self._base_url = str(base_url).rstrip("/")
        self._timeout = timeout
        self._max_poll_attempts = max_poll_attempts
        self._poll_delay_seconds = poll_delay_seconds

    def _request(self, method: str, url: str, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = "OAuth " + str(self._token)
        for attempt in range(_HTTP_ATTEMPTS):
            try:
                response = self._session.request(
                    method,
                    url,
                    headers=headers,
                    timeout=self._timeout,
                    **kwargs,
                )
            except Exception:
                if attempt + 1 == _HTTP_ATTEMPTS:
                    raise MetrikaLogsError("Metrika Logs request failed") from None
                continue
            if response.status_code == 429 or 500 <= response.status_code <= 599:
                if attempt + 1 == _HTTP_ATTEMPTS:
                    raise MetrikaLogsError("Metrika Logs request failed")
                continue
            if not 200 <= response.status_code <= 299:
                raise MetrikaLogsError("Metrika Logs request failed")
            return response
        raise MetrikaLogsError("Metrika Logs request failed")

    def _request_json(self, method: str, url: str, **kwargs) -> dict:
        response = self._request(method, url, **kwargs)
        try:
            payload = response.json()
        except Exception:
            raise MetrikaLogsError("Metrika Logs response was invalid") from None
        if not isinstance(payload, dict):
            raise MetrikaLogsError("Metrika Logs response was invalid")
        return payload

    @staticmethod
    def _log_request(payload: dict) -> dict:
        log_request = payload.get("log_request")
        if not isinstance(log_request, dict):
            raise MetrikaLogsError("Metrika Logs response was invalid")
        return log_request

    def collect_visits(
        self, counter_id: str, day: str, attribution: str = "lastsign"
    ) -> tuple[dict, ...]:
        if (
            not isinstance(counter_id, str)
            or not counter_id.isascii()
            or not counter_id.isdigit()
            or not _valid_day(day)
            or attribution != "lastsign"
        ):
            raise MetrikaLogsError("Invalid Metrika Logs input")

        root = f"{self._base_url}/management/v1/counter/{counter_id}/logrequests"
        params = {
            "date1": day,
            "date2": day,
            "fields": ",".join(VISIT_FIELDS),
            "source": "visits",
            "attribution": attribution,
        }
        evaluation = self._request_json("POST", root + "/evaluate", params=params)
        evaluation_body = evaluation.get("log_request_evaluation")
        if not isinstance(evaluation_body, dict) or not isinstance(
            evaluation_body.get("possible"), bool
        ):
            raise MetrikaLogsError("Metrika Logs response was invalid")
        if not evaluation_body["possible"]:
            raise MetrikaLogsError("Metrika Logs request unavailable")

        request_id = None
        original_error = None
        try:
            created = self._log_request(self._request_json("POST", root, params=params))
            request_id_value = created.get("request_id")
            if isinstance(request_id_value, bool) or not re.fullmatch(r"\d+", str(request_id_value)):
                raise MetrikaLogsError("Metrika Logs response was invalid")
            request_id = str(request_id_value)
            request_url = root + "/" + request_id

            processed = None
            if (
                not isinstance(self._max_poll_attempts, int)
                or isinstance(self._max_poll_attempts, bool)
                or self._max_poll_attempts < 1
            ):
                raise MetrikaLogsError("Metrika Logs polling timed out")
            for poll_number in range(self._max_poll_attempts):
                polled = self._log_request(self._request_json("GET", request_url))
                status = polled.get("status")
                if status == "processed":
                    processed = polled
                    break
                if status not in ("created", "processing"):
                    if not isinstance(status, str):
                        raise MetrikaLogsError("Metrika Logs response was invalid")
                    raise MetrikaLogsError("Metrika Logs request failed")
                if poll_number + 1 < self._max_poll_attempts and self._poll_delay_seconds:
                    time.sleep(self._poll_delay_seconds)
            if processed is None:
                raise MetrikaLogsError("Metrika Logs polling timed out")

            parts = processed.get("parts")
            if not isinstance(parts, list):
                raise MetrikaLogsError("Metrika Logs response was invalid")
            part_numbers = []
            for part in parts:
                if not isinstance(part, dict):
                    raise MetrikaLogsError("Metrika Logs response was invalid")
                part_number = part.get("part_number")
                if (
                    not isinstance(part_number, int)
                    or isinstance(part_number, bool)
                    or part_number < 0
                    or part_number in part_numbers
                ):
                    raise MetrikaLogsError("Metrika Logs response was invalid")
                part_numbers.append(part_number)

            visits = []
            seen_visit_ids = set()
            for part_number in sorted(part_numbers):
                response = self._request(
                    "GET", request_url + f"/part/{part_number}/download"
                )
                parsed = parse_visits_tsv(response.text, expected_day=day)
                for visit in parsed:
                    if visit["visit_id"] in seen_visit_ids:
                        raise MetrikaLogsError("Metrika Logs row was invalid")
                    seen_visit_ids.add(visit["visit_id"])
                    visits.append(visit)
            return tuple(visits)
        except Exception as error:
            if isinstance(error, MetrikaLogsError):
                original_error = error
            else:
                original_error = MetrikaLogsError("Metrika Logs request failed")
            raise original_error from None
        finally:
            if request_id is not None:
                try:
                    self._request("POST", root + "/" + request_id + "/clean")
                except Exception:
                    if original_error is None:
                        raise MetrikaLogsError("Metrika Logs cleanup failed") from None
