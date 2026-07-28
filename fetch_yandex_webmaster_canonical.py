#!/usr/bin/env python3
"""Yandex Webmaster -> canonical_fact_webmaster_*_daily."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

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


SOURCE_KEY = "yandex_webmaster"
WEBMASTER_API_BASE = env_first("YANDEX_WEBMASTER_API_BASE", default="https://api.webmaster.yandex.net/v4")
OAUTH_TOKEN_URL = env_first("YANDEX_OAUTH_TOKEN_URL", default="https://oauth.yandex.ru/token")
DEFAULT_ACCOUNT_ID = env_first("YANDEX_WEBMASTER_ACCOUNT_ID", default="66624469")
DEFAULT_DOMAIN = env_first("YANDEX_WEBMASTER_DOMAIN", default="zaruku.ru")
DEFAULT_DEVICE = env_first("YANDEX_WEBMASTER_DEVICE_TYPE", default="ALL")
DEFAULT_SEARCH_LOCATION = env_first("YANDEX_WEBMASTER_SEARCH_LOCATION", default="ALL_LOCATIONS")
COLLECTION_FLOOR_DAYS = int(
    env_first("YANDEX_WEBMASTER_COLLECTION_FLOOR_DAYS", default="2") or 2
)
RECOLLECT_SPAN_DAYS = int(
    env_first(
        "YANDEX_WEBMASTER_RECOLLECT_SPAN_DAYS",
        "YANDEX_WEBMASTER_DAILY_LAG_DAYS",
        "YANDEX_WEBMASTER_BACKFILL_DAYS",
        default="3",
    )
    or 3
)
DEFAULT_LAG_DAYS = RECOLLECT_SPAN_DAYS
TOKEN_STATE_PATH = env_first("YANDEX_WEBMASTER_TOKEN_STATE_PATH", default="")
MAX_RETRIES = 5
QUERY_PAGE_SIZE = 500
MAX_QUERY_ROWS = 100000
TIMEOUT = 90
REQUEST_DELAY_SECONDS = float(env_first("YANDEX_WEBMASTER_REQUEST_DELAY_SECONDS", default="0.35") or 0)

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
log = logging.getLogger("yandex_webmaster_canonical")

WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL = """
DELETE FROM canonical_fact_webmaster_queries_daily
WHERE source_key = %s
  AND analytics_account_id = %s
  AND host_id = %s
  AND report_date = %s
  AND device_type = %s
"""

WEBMASTER_QUERY_UPSERT_SQL = """
INSERT INTO canonical_fact_webmaster_queries_daily (
    source_key, analytics_account_id, host_id, report_date, device_type,
    query_hash, query_id, query_text, impressions, clicks, ctr,
    average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(host_id)s, %(report_date)s, %(device_type)s,
    %(query_hash)s, %(query_id)s, %(query)s, %(impressions)s, %(clicks)s, %(ctr)s,
    %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    query_id = VALUES(query_id),
    query_text = VALUES(query_text),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    average_position = VALUES(average_position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

WEBMASTER_SUMMARY_UPSERT_SQL = """
INSERT INTO canonical_fact_webmaster_summary_daily (
    source_key, analytics_account_id, host_id, report_date, device_type,
    impressions, clicks, ctr, average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(host_id)s, %(report_date)s, %(device_type)s,
    %(impressions)s, %(clicks)s, %(ctr)s, %(average_position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    average_position = VALUES(average_position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

WEBMASTER_PAGE_UPSERT_SQL = """
INSERT INTO canonical_fact_webmaster_pages_daily (
    source_key, analytics_account_id, host_id, report_date, device_type,
    page_hash, page_url, popular_query_text, impressions, clicks, ctr,
    average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(host_id)s, %(report_date)s, %(device_type)s,
    %(page_hash)s, %(page_url)s, %(popular_query_text)s, %(impressions)s, %(clicks)s, %(ctr)s,
    %(average_position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    page_url = VALUES(page_url),
    popular_query_text = VALUES(popular_query_text),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    average_position = VALUES(average_position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""


@dataclass(frozen=True)
class WebmasterAccount:
    analytics_account_id: str
    domain: str
    host_id: str | None = None


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", default="")
    parser.add_argument("--date-to", default="")
    parser.add_argument("--lag-days", type=int, default=DEFAULT_LAG_DAYS)
    parser.add_argument("--run-type", default="manual", choices=["manual", "cron", "backfill"])
    parser.add_argument("--account-id", default="")
    parser.add_argument("--domain", default="")
    parser.add_argument("--host-id", default="")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


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


def clean_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def safe_int(value: Any) -> int:
    try:
        return max(int(round(float(value or 0))), 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def calculate_ctr(impressions: int, clicks: int) -> float | None:
    return round((clicks / impressions) * 100, 6) if impressions > 0 else None


def collection_dates(anchor: date | None = None, lag_days: int = DEFAULT_LAG_DAYS) -> list[str]:
    effective_anchor = anchor or datetime.now(timezone.utc).date()
    span_days = max(lag_days, 0)
    if span_days == 0:
        return []
    end = effective_anchor - timedelta(days=COLLECTION_FLOOR_DAYS)
    start = end - timedelta(days=span_days - 1)
    days: list[str] = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def daterange(date_from: str, date_to: str) -> list[str]:
    start = datetime.strptime(date_from, "%Y-%m-%d").date()
    end = datetime.strptime(date_to, "%Y-%m-%d").date()
    days = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def selected_dates(args, anchor: date | None = None) -> list[str]:
    effective_anchor = anchor or datetime.now(timezone.utc).date()
    max_collectable_date = effective_anchor - timedelta(days=COLLECTION_FLOOR_DAYS)
    if args.date_from or args.date_to:
        date_to = args.date_to or max_collectable_date.strftime("%Y-%m-%d")
        date_from = args.date_from or date_to
        return [day for day in daterange(date_from, date_to) if day <= max_collectable_date.isoformat()]
    return collection_dates(anchor=effective_anchor, lag_days=args.lag_days)


def query_hash(query: str) -> str:
    return hashlib.sha256(clean_text(query).lower().encode("utf-8")).hexdigest()


def page_hash(page_url: str) -> str:
    return hashlib.sha256(clean_text(page_url).lower().encode("utf-8")).hexdigest()


def normalize_popular_query_rows(
    payload: dict,
    *,
    source_key: str,
    analytics_account_id: str,
    host_id: str,
    report_date: str,
    device_type: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    for row in payload.get("queries") or []:
        indicators = row.get("indicators") or {}
        query = clean_text(row.get("query_text"))
        if not query:
            continue
        impressions = safe_int(indicators.get("TOTAL_SHOWS"))
        clicks = safe_int(indicators.get("TOTAL_CLICKS"))
        result.append(
            {
                "source_key": source_key,
                "analytics_account_id": analytics_account_id,
                "host_id": host_id,
                "report_date": report_date,
                "device_type": device_type,
                "query_hash": query_hash(query),
                "query_id": clean_text(row.get("query_id")) or None,
                "query": query,
                "impressions": impressions,
                "clicks": clicks,
                "ctr": calculate_ctr(impressions, clicks),
                "position": safe_float(indicators.get("AVG_SHOW_POSITION")),
                "raw_payload": json.dumps(row, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def _statistics_for_report_date(row: dict, report_date: str) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "impressions": 0,
        "clicks": 0,
        "ctr": None,
        "average_position": None,
        "seen": False,
    }
    for item in row.get("statistics") or []:
        if clean_text(item.get("date")) != report_date:
            continue
        metrics["seen"] = True
        field = item.get("field")
        value = item.get("value")
        if field == "IMPRESSIONS":
            metrics["impressions"] = safe_int(value)
        elif field == "CLICKS":
            metrics["clicks"] = safe_int(value)
        elif field == "CTR":
            metrics["ctr"] = safe_float(value)
        elif field == "POSITION":
            metrics["average_position"] = safe_float(value)
    if metrics["ctr"] is None:
        metrics["ctr"] = calculate_ctr(int(metrics["impressions"]), int(metrics["clicks"]))
    return metrics


def normalize_query_analytics_url_rows(
    payload: dict,
    *,
    source_key: str,
    analytics_account_id: str,
    host_id: str,
    report_date: str,
    device_type: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    for row in payload.get("text_indicator_to_statistics") or []:
        text_indicator = row.get("text_indicator") or {}
        if text_indicator.get("type") != "URL":
            continue
        page_url = clean_text(text_indicator.get("value"))
        if not page_url:
            continue
        metrics = _statistics_for_report_date(row, report_date)
        if not metrics["seen"]:
            continue
        if safe_int(metrics["impressions"]) <= 0 and safe_int(metrics["clicks"]) <= 0 and metrics["average_position"] is None:
            continue
        complementary = row.get("popular_complementary_indicator") or {}
        result.append(
            {
                "source_key": source_key,
                "analytics_account_id": analytics_account_id,
                "host_id": host_id,
                "report_date": report_date,
                "device_type": device_type,
                "page_hash": page_hash(page_url),
                "page_url": page_url,
                "popular_query_text": clean_text(complementary.get("value")) if complementary.get("type") == "QUERY" else None,
                "impressions": safe_int(metrics["impressions"]),
                "clicks": safe_int(metrics["clicks"]),
                "ctr": metrics["ctr"],
                "average_position": metrics["average_position"],
                "raw_payload": json.dumps(row, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def _summary_metrics(payload: dict) -> dict[str, float | int | None]:
    totals = {"impressions": 0, "clicks": 0}
    positions: list[float] = []
    ctr_values: list[float] = []
    for group in payload.get("text_indicator_to_statistics") or []:
        for item in group.get("statistics") or []:
            field = item.get("field")
            value = item.get("value")
            if field == "IMPRESSIONS":
                totals["impressions"] += safe_int(value)
            elif field == "CLICKS":
                totals["clicks"] += safe_int(value)
            elif field == "POSITION":
                parsed = safe_float(value)
                if parsed is not None:
                    positions.append(parsed)
            elif field == "CTR":
                parsed = safe_float(value)
                if parsed is not None:
                    ctr_values.append(parsed)
    impressions = int(totals["impressions"])
    clicks = int(totals["clicks"])
    return {
        "impressions": impressions,
        "clicks": clicks,
        "ctr": round(sum(ctr_values) / len(ctr_values), 6) if ctr_values else calculate_ctr(impressions, clicks),
        "average_position": round(sum(positions) / len(positions), 6) if positions else None,
    }


def normalize_summary_row(
    payload: dict,
    *,
    source_key: str,
    analytics_account_id: str,
    host_id: str,
    report_date: str,
    device_type: str,
    run_id: int,
) -> dict:
    metrics = _summary_metrics(payload)
    return {
        "source_key": source_key,
        "analytics_account_id": analytics_account_id,
        "host_id": host_id,
        "report_date": report_date,
        "device_type": device_type,
        "impressions": metrics["impressions"],
        "clicks": metrics["clicks"],
        "ctr": metrics["ctr"],
        "average_position": metrics["average_position"],
        "raw_payload": json.dumps(payload, ensure_ascii=False),
        "ingestion_run_id": run_id,
    }


def normalize_summary_from_query_rows(
    query_rows: list[dict],
    *,
    source_key: str,
    analytics_account_id: str,
    host_id: str,
    report_date: str,
    device_type: str,
    run_id: int,
) -> dict:
    impressions = sum(safe_int(row.get("impressions")) for row in query_rows)
    clicks = sum(safe_int(row.get("clicks")) for row in query_rows)
    weighted_position = 0.0
    position_weight = 0
    for row in query_rows:
        position = safe_float(row.get("position"))
        row_impressions = safe_int(row.get("impressions"))
        if position is None or row_impressions <= 0:
            continue
        weighted_position += position * row_impressions
        position_weight += row_impressions
    return {
        "source_key": source_key,
        "analytics_account_id": analytics_account_id,
        "host_id": host_id,
        "report_date": report_date,
        "device_type": device_type,
        "impressions": impressions,
        "clicks": clicks,
        "ctr": calculate_ctr(impressions, clicks),
        "average_position": round(weighted_position / position_weight, 6) if position_weight > 0 else None,
        "raw_payload": json.dumps({"derived_from": "search-queries/popular", "query_rows": len(query_rows)}, ensure_ascii=False),
        "ingestion_run_id": run_id,
    }


def parse_accounts_from_env() -> list[WebmasterAccount]:
    raw = env_first("YANDEX_WEBMASTER_ACCOUNTS", default="")
    accounts: list[WebmasterAccount] = []
    for chunk in raw.replace("\n", ",").split(","):
        parts = [part.strip() for part in chunk.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            accounts.append(WebmasterAccount(parts[0], parts[1], parts[2] if len(parts) > 2 and parts[2] else None))
    if accounts:
        return accounts
    return [
        WebmasterAccount(
            env_first("YANDEX_WEBMASTER_ACCOUNT_ID", default=DEFAULT_ACCOUNT_ID),
            env_first("YANDEX_WEBMASTER_DOMAIN", default=DEFAULT_DOMAIN),
            env_first("YANDEX_WEBMASTER_HOST_ID", default="") or None,
        )
    ]


def configured_accounts(args) -> list[WebmasterAccount]:
    explicit_account = clean_text(getattr(args, "account_id", ""))
    explicit_domain = clean_text(getattr(args, "domain", ""))
    explicit_host = clean_text(getattr(args, "host_id", ""))
    if explicit_account or explicit_domain or explicit_host:
        return [
            WebmasterAccount(
                explicit_account or DEFAULT_ACCOUNT_ID,
                explicit_domain or DEFAULT_DOMAIN,
                explicit_host or None,
            )
        ]
    accounts = parse_accounts_from_env()
    if getattr(args, "run_type", "") != "cron":
        return accounts
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    try:
        try:
            cur.execute(
                """
                SELECT platform_account_id
                FROM canonical_source_account_collection_settings
                WHERE source_key = %s
                  AND is_active = 1
                  AND cron_enabled = 1
                ORDER BY platform_account_id
                """,
                (SOURCE_KEY,),
            )
            active_ids = {clean_text(row.get("platform_account_id")) for row in cur.fetchall()}
            return [account for account in accounts if not active_ids or account.analytics_account_id in active_ids]
        except Exception as exc:
            import mysql.connector

            if not isinstance(exc, mysql.connector.Error):
                raise
            if exc.errno != 1146:
                raise
            return accounts
    finally:
        cur.close()
        conn.close()


def request_with_retry(access_token: str, path_part: str, *, run_id: int | None = None, method: str = "GET", body: dict | None = None) -> dict:
    headers = {"Authorization": f"OAuth {access_token}", "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json; charset=UTF-8"
        data = json.dumps(body, ensure_ascii=False)
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        if REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        if run_id:
            log_collector_event(run_id, "info", "webmaster_api_request", f"{method} {path_part}", {"attempt": attempt})
        response = requests.request(method, f"{WEBMASTER_API_BASE}{path_part}", headers=headers, data=data, timeout=TIMEOUT)
        if response.status_code != 429:
            response.raise_for_status()
            return response.json() if response.text else {}
        if attempt == MAX_RETRIES:
            response.raise_for_status()
        retry_after = safe_float(response.headers.get("Retry-After")) or 0
        time.sleep(max(sleep_for, retry_after))
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f"Webmaster retry loop exhausted for {path_part}")


def read_token_state() -> dict[str, Any] | None:
    if not TOKEN_STATE_PATH:
        return None
    try:
        return json.loads(Path(TOKEN_STATE_PATH).read_text())
    except FileNotFoundError:
        return None


def write_token_state(payload: dict[str, Any]) -> None:
    if not TOKEN_STATE_PATH:
        return
    target = Path(TOKEN_STATE_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    os.chmod(temp, 0o600)
    temp.replace(target)
    os.chmod(target, 0o600)


def refresh_access_token() -> str:
    refresh_token = env_first("YANDEX_WEBMASTER_REFRESH_TOKEN")
    client_id = env_first("YANDEX_WEBMASTER_CLIENT_ID")
    client_secret = env_first("YANDEX_WEBMASTER_CLIENT_SECRET")
    token_state = read_token_state()
    if token_state:
        expires_at = clean_text(token_state.get("expires_at"))
        try:
            if expires_at and datetime.fromisoformat(expires_at.replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(minutes=2):
                token = clean_text(token_state.get("access_token"))
                if token:
                    return token
        except ValueError:
            pass
        refresh_token = clean_text(token_state.get("refresh_token")) or refresh_token
    if not refresh_token or not client_id or not client_secret:
        token = env_first("YANDEX_WEBMASTER_OAUTH_TOKEN")
        if token:
            return token
        raise RuntimeError("YANDEX_WEBMASTER_REFRESH_TOKEN/client credentials are not configured")
    response = requests.post(
        OAUTH_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Yandex OAuth response did not include access_token")
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=max(safe_int(payload.get("expires_in")) - 60, 60))).isoformat()
    write_token_state({
        "access_token": token,
        "refresh_token": payload.get("refresh_token") or refresh_token,
        "expires_at": expires_at,
    })
    return str(token)


def get_user_id(access_token: str, run_id: int) -> str:
    payload = request_with_retry(access_token, "/user/", run_id=run_id)
    user_id = payload.get("user_id") or payload.get("userId") or payload.get("id")
    if not user_id:
        raise RuntimeError("Yandex Webmaster user id was not returned")
    return str(user_id)


def normalize_host_url(value: str) -> str:
    raw = clean_text(value)
    for prefix in ("https://", "http://"):
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
    return raw.replace("www.", "", 1).rstrip("/")


def discover_host_id(access_token: str, user_id: str, domain: str, run_id: int) -> str:
    payload = request_with_retry(access_token, f"/user/{user_id}/hosts/", run_id=run_id)
    matches = [
        host for host in payload.get("hosts") or []
        if normalize_host_url(host.get("ascii_host_url") or host.get("host_url") or "") == normalize_host_url(domain)
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one Yandex Webmaster host for {domain}, got {len(matches)}")
    return str(matches[0]["host_id"])


def fetch_query_rows(access_token: str, user_id: str, host_id: str, day: str, device: str, run_id: int) -> list[dict]:
    all_rows: list[dict] = []
    reported_count: int | None = None
    for offset in range(0, MAX_QUERY_ROWS, QUERY_PAGE_SIZE):
        params = {
            "order_by": "TOTAL_SHOWS",
            "device_type_indicator": device,
            "date_from": day,
            "date_to": day,
            "offset": str(offset),
            "limit": str(QUERY_PAGE_SIZE),
            "query_indicator": ["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION"],
        }
        query: list[tuple[str, str]] = []
        for key, value in params.items():
            if isinstance(value, list):
                query.extend((key, item) for item in value)
            else:
                query.append((key, value))
        payload = request_with_retry(
            access_token,
            f"/user/{user_id}/hosts/{quote(host_id, safe='')}/search-queries/popular/?{urlencode(query)}",
            run_id=run_id,
        )
        rows = payload.get("queries") or []
        all_rows.extend(rows)
        if payload.get("count") is not None:
            reported_count = max(reported_count or 0, safe_int(payload.get("count")))
        if len(rows) < QUERY_PAGE_SIZE or (reported_count is not None and len(all_rows) >= reported_count):
            break
    if reported_count is not None and reported_count > len(all_rows):
        raise RuntimeError(
            'incomplete Yandex Webmaster query response: '
            f'reported count={reported_count}, fetched_rows={len(all_rows)}, '
            f'max_query_rows={MAX_QUERY_ROWS}'
        )
    return all_rows


def fetch_page_rows(access_token: str, user_id: str, host_id: str, day: str, device: str, run_id: int) -> list[dict]:
    all_rows: list[dict] = []
    for offset in range(0, 100000, 500):
        body = {
            "offset": offset,
            "limit": 500,
            "device_type_indicator": device,
            "search_location": DEFAULT_SEARCH_LOCATION,
            "text_indicator": "URL",
            "sort_by_date": {
                "date": day,
                "statistic_field": "IMPRESSIONS",
                "by": "DESC",
            },
        }
        payload = request_with_retry(
            access_token,
            f"/user/{user_id}/hosts/{quote(host_id, safe='')}/query-analytics/list",
            run_id=run_id,
            method="POST",
            body=body,
        )
        rows = payload.get("text_indicator_to_statistics") or []
        all_rows.extend(rows)
        count = safe_int(payload.get("count"))
        if len(rows) < 500 or len(all_rows) >= count:
            break
    return all_rows


def upsert_webmaster_query_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.executemany(WEBMASTER_QUERY_UPSERT_SQL, rows)
        conn.commit()
        return len(rows)
    finally:
        cur.close()
        conn.close()


def upsert_webmaster_summary_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.executemany(WEBMASTER_SUMMARY_UPSERT_SQL, rows)
        conn.commit()
        return len(rows)
    finally:
        cur.close()
        conn.close()


def replace_webmaster_day_rows(query_rows: list[dict], summary_row: dict) -> int:
    conn = get_db_connection()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            WEBMASTER_QUERY_SNAPSHOT_DELETE_SQL,
            (
                summary_row["source_key"],
                summary_row["analytics_account_id"],
                summary_row["host_id"],
                summary_row["report_date"],
                summary_row["device_type"],
            ),
        )
        if query_rows:
            cur.executemany(WEBMASTER_QUERY_UPSERT_SQL, query_rows)
        cur.execute(WEBMASTER_SUMMARY_UPSERT_SQL, summary_row)
        conn.commit()
        return len(query_rows) + 1
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            if cur is not None:
                cur.close()
        finally:
            conn.close()
def upsert_webmaster_page_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.executemany(WEBMASTER_PAGE_UPSERT_SQL, rows)
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
            (SOURCE_KEY, day.strftime("%Y-%m-%d")),
        )
        return bool(cur.fetchone()[0])
    finally:
        cur.close()
        conn.close()


def build_account_registry_row(account: WebmasterAccount, host_id: str) -> dict:
    now = datetime.utcnow()
    return {
        "source_key": SOURCE_KEY,
        "platform_account_id": account.analytics_account_id,
        "external_account_ref": host_id,
        "account_name": account.domain,
        "advertiser_name": account.domain,
        "account_status": "active",
        "timezone_name": "Europe/Moscow",
        "first_seen_at": now,
        "last_seen_at": now,
        "raw_payload": {
            "domain": account.domain,
            "host_id": host_id,
            "account_type": "yandex_webmaster_host",
        },
    }


def start_run(*args, **kwargs):
    from canonical_writer import start_collector_run

    return start_collector_run(*args, **kwargs)


def finish_run(*args, **kwargs):
    from canonical_writer import finish_collector_run

    return finish_collector_run(*args, **kwargs)


def log_collector_event(*args, **kwargs):
    from canonical_writer import log_run_event

    return log_run_event(*args, **kwargs)


def upsert_accounts(*args, **kwargs):
    from canonical_writer import upsert_source_accounts

    return upsert_source_accounts(*args, **kwargs)


def collect(args) -> dict[str, Any]:
    if env_first("YANDEX_WEBMASTER_ENABLED", default="true").lower() == "false":
        return {"status": "skipped", "rows_read": 0, "rows_written": 0}
    dates = selected_dates(args)
    if not dates:
        log.info("Skipping Webmaster run: requested window is newer than the collection floor")
        return {"status": "skipped_unavailable", "rows_read": 0, "rows_written": 0, "dates": []}
    if args.run_type == "cron" and not args.force and cron_run_already_completed():
        log.info("Skipping cron run: successful daily run already exists today")
        return {"status": "skipped_quota", "rows_read": 0, "rows_written": 0, "dates": dates}
    correlation_id = str(uuid.uuid4())
    run_id = start_run(
        SOURCE_KEY,
        args.run_type,
        "daily",
        f"{SOURCE_KEY}:daily",
        correlation_id,
        dates[0],
        dates[-1],
    )
    rows_read = 0
    rows_written = 0
    errors: list[str] = []
    try:
        access_token = refresh_access_token()
        user_id = get_user_id(access_token, run_id)
        account_rows = []
        for account in configured_accounts(args):
            host_id = account.host_id or discover_host_id(access_token, user_id, account.domain, run_id)
            account_rows.append(build_account_registry_row(account, host_id))
            for day in dates:
                raw_queries = fetch_query_rows(access_token, user_id, host_id, day, DEFAULT_DEVICE, run_id)
                raw_pages = fetch_page_rows(access_token, user_id, host_id, day, DEFAULT_DEVICE, run_id)
                query_payload = {"queries": raw_queries}
                page_payload = {"text_indicator_to_statistics": raw_pages}
                query_rows = normalize_popular_query_rows(
                    query_payload,
                    source_key=SOURCE_KEY,
                    analytics_account_id=account.analytics_account_id,
                    host_id=host_id,
                    report_date=day,
                    device_type=DEFAULT_DEVICE,
                    run_id=run_id,
                )
                page_rows = normalize_query_analytics_url_rows(
                    page_payload,
                    source_key=SOURCE_KEY,
                    analytics_account_id=account.analytics_account_id,
                    host_id=host_id,
                    report_date=day,
                    device_type=DEFAULT_DEVICE,
                    run_id=run_id,
                )
                summary_row = normalize_summary_from_query_rows(
                    query_rows,
                    source_key=SOURCE_KEY,
                    analytics_account_id=account.analytics_account_id,
                    host_id=host_id,
                    report_date=day,
                    device_type=DEFAULT_DEVICE,
                    run_id=run_id,
                )
                rows_read += len(raw_queries) + len(raw_pages)
                rows_written += replace_webmaster_day_rows(query_rows, summary_row)
                rows_written += upsert_webmaster_page_rows(page_rows)
                log_collector_event(
                    run_id,
                    "info",
                    "webmaster_day_collected",
                    f"Collected Webmaster daily facts for {account.domain} {day}",
                    {
                        "query_rows": len(query_rows),
                        "page_rows": len(page_rows),
                        "page_facts_status": "collected",
                        "summary_rows": 1,
                    },
                )
        upsert_accounts(account_rows)
        finish_run(run_id, "success", rows_read, rows_written, rows_written)
        return {"status": "success", "run_id": run_id, "rows_read": rows_read, "rows_written": rows_written, "dates": dates}
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
