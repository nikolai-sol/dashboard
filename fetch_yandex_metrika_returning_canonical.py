#!/usr/bin/env python3
"""Yandex Metrika returning content -> canonical_fact_metrika_returning_pages_daily."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import requests

try:
    from dotenv import dotenv_values, load_dotenv
except ModuleNotFoundError:
    def load_dotenv(_path):
        return False

    def dotenv_values(path):
        values: dict[str, str] = {}
        try:
            for raw_line in Path(path).read_text().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("'\"")
        except FileNotFoundError:
            pass
        return values


load_dotenv(Path(__file__).parent / ".env")

LOCAL_ENV_PATH = Path(__file__).parent / ".env"
LEGACY_ENV_PATH = Path("/var/www/www-root/data/.production.env")
local_env = dotenv_values(LOCAL_ENV_PATH)
legacy_env = dotenv_values(LEGACY_ENV_PATH) if LEGACY_ENV_PATH.exists() else {}


def env_first(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.getenv(key)
        if value:
            return value.strip()
        value = local_env.get(key)
        if value:
            return str(value).strip()
        value = legacy_env.get(key)
        if value:
            return str(value).strip()
    return default


COLLECTOR_SOURCE_KEY = "yandex_metrika_returning"
ROW_SOURCE_KEY = "yandex_metrika"
DEFAULT_ACCOUNT_IDS = env_first("YANDEX_METRIKA_RETURNING_ACCOUNT_IDS", default="66624469")
DEFAULT_BACKFILL_DAYS = int(env_first("METRIKA_RETURNING_BACKFILL_DAYS", default="3") or 3)
RETURNING_METRIKA_DIMENSION = "ym:s:endURL"
RETURNING_METRIKA_METRICS = ",".join(
    [
        "ym:s:visits",
        "ym:s:upToDayUserRecencyPercentage",
        "ym:s:upToWeekUserRecencyPercentage",
        "ym:s:upToMonthUserRecencyPercentage",
    ]
)
METRIKA_STATS_URL = env_first("METRIKA_STATS_URL", default="https://api-metrika.yandex.net/stat/v1/data")
METRIKA_TOKEN = env_first("METRIKA_TOKEN", "YANDEX_METRIKA_TOKEN", "METRIKA_OAUTH_TOKEN", "YANDEX_METRIKA_OAUTH_TOKEN")
REQUEST_DELAY_SECONDS = float(env_first("METRIKA_RETURNING_REQUEST_DELAY_SECONDS", "METRIKA_REQUEST_DELAY_SECONDS", default="0.35") or 0)
MAX_RETRIES = 8
INITIAL_RETRY_DELAY_SECONDS = 5.0
MAX_RETRY_DELAY_SECONDS = 60.0
MAX_RETRY_JITTER_SECONDS = 1.0
MAX_TOTAL_RETRY_DELAY_SECONDS = 300.0
TIMEOUT = 90

MYSQL_HOST = env_first("MYSQL_HOST", "DB_HOST", default="localhost")
MYSQL_PORT = int(env_first("MYSQL_PORT", "DB_PORT", default="3306"))
MYSQL_USER = env_first("MYSQL_USER", "DB_USER", default="report_bd")
MYSQL_PASS = env_first("MYSQL_PASSWORD", "DB_PASSWORD")
MYSQL_DB = env_first("MYSQL_DB", "DB_NAME", default="report_bd")

LOG_LEVEL = env_first("LOG_LEVEL", default="INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
for third_party_logger_name in ("requests", "urllib3"):
    third_party_logger = logging.getLogger(third_party_logger_name)
    third_party_logger.handlers.clear()
    third_party_logger.addHandler(logging.NullHandler())
    third_party_logger.propagate = False
log = logging.getLogger("yandex_metrika_returning_canonical")


class MetrikaReturningRequestError(RuntimeError):
    """Sanitized API failure safe for collector telemetry."""

    def __init__(self, status_code: int | None, attempts: int, *, rate_limited: bool):
        self.status_code = status_code
        self.attempts = attempts
        self.rate_limited = rate_limited
        status = status_code if status_code is not None else "unavailable"
        super().__init__(
            f"Metrika returning request failed after {attempts} attempt(s) "
            f"(status={status}, rate_limited={str(rate_limited).lower()})"
        )


RETURNING_PAGE_UPSERT_SQL = """
INSERT INTO canonical_fact_metrika_returning_pages_daily (
    source_key, analytics_account_id, report_date, page_hash, page_url,
    visits, returning_1_day_users, returning_2_7_days_users, returning_8_31_days_users,
    raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(report_date)s, %(page_hash)s, %(page_url)s,
    %(visits)s, %(returning_1_day_users)s, %(returning_2_7_days_users)s, %(returning_8_31_days_users)s,
    %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    page_url = VALUES(page_url),
    visits = VALUES(visits),
    returning_1_day_users = VALUES(returning_1_day_users),
    returning_2_7_days_users = VALUES(returning_2_7_days_users),
    returning_8_31_days_users = VALUES(returning_8_31_days_users),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", default="")
    parser.add_argument("--date-to", default="")
    parser.add_argument("--backfill-days", type=int, default=DEFAULT_BACKFILL_DAYS)
    parser.add_argument("--run-type", default="manual", choices=["manual", "cron", "backfill"])
    parser.add_argument("--account-id", default="")
    parser.add_argument("--account-ids", default="")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def clean_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def safe_int(value: Any) -> int:
    try:
        return max(int(round(float(value or 0))), 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    try:
        return max(float(value or 0), 0.0)
    except (TypeError, ValueError):
        return 0.0


def parse_csv_values(value: str) -> list[str]:
    result: list[str] = []
    for item in clean_text(value).replace("\n", ",").split(","):
        item = "".join(ch for ch in item.strip() if ch.isdigit())
        if item and item not in result:
            result.append(item)
    return result


def selected_account_ids(args) -> list[str]:
    result = parse_csv_values(getattr(args, "account_ids", ""))
    explicit_account_id = "".join(ch for ch in clean_text(getattr(args, "account_id", "")) if ch.isdigit())
    if explicit_account_id and explicit_account_id not in result:
        result.insert(0, explicit_account_id)
    if result:
        return result
    return parse_csv_values(DEFAULT_ACCOUNT_IDS) or ["66624469"]


def collection_dates(anchor: date | None = None, backfill_days: int = DEFAULT_BACKFILL_DAYS) -> list[str]:
    effective_anchor = anchor or datetime.now(timezone.utc).date()
    end = effective_anchor - timedelta(days=1)
    start = end - timedelta(days=max(backfill_days, 0))
    days: list[str] = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def daterange(date_from: str, date_to: str) -> list[str]:
    start = datetime.strptime(date_from, "%Y-%m-%d").date()
    end = datetime.strptime(date_to, "%Y-%m-%d").date()
    days: list[str] = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def selected_dates(args) -> list[str]:
    if args.date_from or args.date_to:
        today = datetime.now(timezone.utc).date()
        date_to = args.date_to or (today - timedelta(days=1)).strftime("%Y-%m-%d")
        date_from = args.date_from or date_to
        return daterange(date_from, date_to)
    return collection_dates(backfill_days=args.backfill_days)


def get_db_connection(database: str = MYSQL_DB):
    import mysql.connector

    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=database,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def page_hash(page_url: str) -> str:
    return hashlib.sha256(clean_text(page_url).encode("utf-8")).hexdigest()


def metric_value(metrics: list[Any], index: int) -> float:
    if index >= len(metrics):
        return 0.0
    return safe_float(metrics[index])


def normalize_returning_rows(
    payload: dict,
    *,
    analytics_account_id: str,
    report_date: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    rows = payload.get("data") if isinstance(payload, dict) else []
    for item in rows if isinstance(rows, list) else []:
        dimensions = item.get("dimensions") or []
        metrics = item.get("metrics") or []
        page_url = clean_text(dimensions[0].get("name") if dimensions and isinstance(dimensions[0], dict) else "")
        visits = safe_int(metric_value(metrics, 0))
        if not page_url or visits <= 0:
            continue
        up_to_day = safe_float(metric_value(metrics, 1))
        up_to_week = safe_float(metric_value(metrics, 2))
        up_to_month = safe_float(metric_value(metrics, 3))
        one_day = safe_int(visits * up_to_day / 100)
        up_to_week_users = safe_int(visits * up_to_week / 100)
        up_to_month_users = safe_int(visits * up_to_month / 100)
        two_to_seven = max(up_to_week_users - one_day, 0)
        eight_to_thirty_one = max(up_to_month_users - one_day - two_to_seven, 0)
        result.append(
            {
                "source_key": ROW_SOURCE_KEY,
                "analytics_account_id": analytics_account_id,
                "report_date": report_date,
                "page_hash": page_hash(page_url),
                "page_url": page_url,
                "visits": visits,
                "returning_1_day_users": one_day,
                "returning_2_7_days_users": two_to_seven,
                "returning_8_31_days_users": eight_to_thirty_one,
                "raw_payload": json.dumps(item, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def retry_after_seconds(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return max(float(value), 0.0)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return 0.0
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max((retry_at - datetime.now(timezone.utc)).total_seconds(), 0.0)


def request_with_retry(counter_id: str, day: str, *, run_id: int | None = None, offset: int = 1) -> dict:
    headers = {"Authorization": f"OAuth {METRIKA_TOKEN}"}
    params = {
        "ids": counter_id,
        "group": "day",
        "dimensions": RETURNING_METRIKA_DIMENSION,
        "metrics": RETURNING_METRIKA_METRICS,
        "limit": "10000",
        "offset": str(offset),
        "date1": day,
        "date2": day,
        "accuracy": "full",
        "lang": "en",
    }
    sleep_for = INITIAL_RETRY_DELAY_SECONDS
    total_retry_delay = 0.0
    for attempt in range(1, MAX_RETRIES + 1):
        if REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        try:
            response = requests.get(METRIKA_STATS_URL, headers=headers, params=params, timeout=TIMEOUT)
        except requests.RequestException:
            raise MetrikaReturningRequestError(None, attempt, rate_limited=False) from None
        if response.status_code != 429 and not 500 <= response.status_code <= 599:
            if response.status_code >= 400:
                raise MetrikaReturningRequestError(
                    response.status_code,
                    attempt,
                    rate_limited=False,
                ) from None
            return response.json() if response.text else {}
        retry_after = response.headers.get("Retry-After")
        retry_after_delay = retry_after_seconds(retry_after)
        rate_limited = response.status_code == 429
        if attempt == MAX_RETRIES:
            if run_id:
                log_collector_event(
                    run_id,
                    "error",
                    "metrika_returning_api_retries_exhausted",
                    "Metrika returning request retries exhausted",
                    {
                        "status_code": response.status_code,
                        "attempt": attempt,
                        "max_attempts": MAX_RETRIES,
                        "retry_after_seconds": retry_after_delay,
                        "rate_limited": rate_limited,
                    },
                )
            raise MetrikaReturningRequestError(
                response.status_code,
                attempt,
                rate_limited=rate_limited,
            ) from None
        desired_delay = max(sleep_for, retry_after_delay) + random.uniform(0, MAX_RETRY_JITTER_SECONDS)
        remaining_delay_budget = max(MAX_TOTAL_RETRY_DELAY_SECONDS - total_retry_delay, 0.0)
        delay = min(desired_delay, remaining_delay_budget)
        if run_id:
            log_collector_event(
                run_id,
                "warning",
                "metrika_returning_api_retry",
                "Retrying Metrika returning request",
                {
                    "status_code": response.status_code,
                    "attempt": attempt,
                    "max_attempts": MAX_RETRIES,
                    "retry_after_seconds": retry_after_delay,
                    "sleep_seconds": delay,
                    "rate_limited": rate_limited,
                },
            )
        if delay > 0:
            time.sleep(delay)
        total_retry_delay += delay
        if desired_delay >= remaining_delay_budget:
            if run_id:
                log_collector_event(
                    run_id,
                    "error",
                    "metrika_returning_api_retries_exhausted",
                    "Metrika returning request retries exhausted",
                    {
                        "status_code": response.status_code,
                        "attempt": attempt,
                        "max_attempts": MAX_RETRIES,
                        "retry_after_seconds": retry_after_delay,
                        "rate_limited": rate_limited,
                    },
                )
            raise MetrikaReturningRequestError(
                response.status_code,
                attempt,
                rate_limited=rate_limited,
            ) from None
        sleep_for = min(sleep_for * 2, MAX_RETRY_DELAY_SECONDS)
    raise MetrikaReturningRequestError(None, MAX_RETRIES, rate_limited=False)


def request_all_rows(counter_id: str, day: str, *, run_id: int) -> dict:
    from metrika_pagination import collect_all_rows

    def fetch_page(offset: int) -> dict:
        return request_with_retry(counter_id, day, run_id=run_id, offset=offset)

    rows = collect_all_rows(fetch_page)
    return {"data": rows}


def upsert_returning_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.executemany(RETURNING_PAGE_UPSERT_SQL, rows)
        conn.commit()
        return len(rows)
    finally:
        cur.close()
        conn.close()


def cron_run_already_completed(today: date | None = None) -> bool:
    day = today or datetime.now(timezone.utc).date()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM canonical_collector_runs
            WHERE source_key = %s
              AND run_type = 'cron'
              AND run_mode = 'daily'
              AND status = 'success'
              AND DATE(started_at) = %s
            """,
            (COLLECTOR_SOURCE_KEY, day.strftime("%Y-%m-%d")),
        )
        return bool(cur.fetchone()[0])
    finally:
        cur.close()
        conn.close()


def start_run(*args, **kwargs):
    from canonical_writer import start_collector_run

    return start_collector_run(*args, **kwargs)


def finish_run(*args, **kwargs):
    from canonical_writer import finish_collector_run

    return finish_collector_run(*args, **kwargs)


def log_collector_event(*args, **kwargs):
    from canonical_writer import log_run_event

    return log_run_event(*args, **kwargs)


def collect(args) -> dict[str, Any]:
    if not METRIKA_TOKEN:
        raise RuntimeError("METRIKA_TOKEN/YANDEX_METRIKA_TOKEN is missing from env")
    dates = selected_dates(args)
    if args.run_type == "cron" and not args.force and cron_run_already_completed():
        log.info("Skipping returning-content cron run: successful daily run already exists today")
        return {"status": "skipped_quota", "rows_read": 0, "rows_written": 0, "dates": dates}
    account_ids = selected_account_ids(args)
    correlation_id = str(uuid.uuid4())
    run_id = start_run(
        COLLECTOR_SOURCE_KEY,
        args.run_type,
        "daily",
        f"{COLLECTOR_SOURCE_KEY}:daily",
        correlation_id,
        dates[0],
        dates[-1],
    )
    rows_read = 0
    rows_written = 0
    pending_rows: list[dict] = []
    errors: list[str] = []
    try:
        for account_id in account_ids:
            for day in dates:
                response = request_all_rows(account_id, day, run_id=run_id)
                raw_rows = response.get("data") or []
                normalized_rows = normalize_returning_rows(
                    response,
                    analytics_account_id=account_id,
                    report_date=day,
                    run_id=run_id,
                )
                rows_read += len(raw_rows)
                pending_rows.extend(normalized_rows)
                log_collector_event(
                    run_id,
                    "info",
                    "metrika_returning_day_collected",
                    "Collected Metrika returning-content facts",
                    {"raw_rows": len(raw_rows), "canonical_rows": len(normalized_rows)},
                )
        rows_written = upsert_returning_rows(pending_rows)
        finish_run(run_id, "success", rows_read, rows_written, rows_written)
        return {
            "status": "success",
            "run_id": run_id,
            "rows_read": rows_read,
            "rows_written": rows_written,
            "dates": dates,
        }
    except Exception as exc:
        errors.append(str(exc))
        finish_run(run_id, "failed", rows_read, rows_written, rows_written, len(errors), "; ".join(errors)[:1000])
        raise


def main():
    args = parse_args()
    result = collect(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
