#!/usr/bin/env python3
"""Google Search Console -> canonical_fact_gsc_queries_daily."""

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
from urllib.parse import quote

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


SOURCE_KEY = "google_search_console"
DEFAULT_ACCOUNT_ID = env_first("GSC_ACCOUNT_ID", "GSC_ANALYTICS_ACCOUNT_ID", default="66624469")
DEFAULT_SITE_URL = env_first("GSC_SITE_URL", default="https://zaruku.ru/")
DEFAULT_BACKFILL_DAYS = int(env_first("GSC_BACKFILL_DAYS", default="3") or 3)
GSC_TOKEN_URL = env_first("GSC_TOKEN_URL", default="https://oauth2.googleapis.com/token")
GSC_API_BASE = env_first("GSC_API_BASE", default="https://www.googleapis.com/webmasters/v3")
GSC_ROW_LIMIT = int(env_first("GSC_ROW_LIMIT", default="25000") or 25000)
GSC_SEARCH_TYPES_DEFAULT = env_first("GSC_SEARCH_TYPES", default="web,image,video,news,discover,googleNews")
MAX_RETRIES = 5
TIMEOUT = 90
REQUEST_DELAY_SECONDS = float(env_first("GSC_REQUEST_DELAY_SECONDS", default="0.25") or 0)

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
log = logging.getLogger("gsc_canonical")

GSC_QUERY_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_queries_daily (
    source_key, analytics_account_id, report_date,
    query, page, country, device, query_hash,
    impressions, clicks, ctr, position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(report_date)s,
    %(query)s, %(page)s, %(country)s, %(device)s, %(query_hash)s,
    %(impressions)s, %(clicks)s, %(ctr)s, %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    query = VALUES(query),
    page = VALUES(page),
    country = VALUES(country),
    device = VALUES(device),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    position = VALUES(position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

GSC_SEARCH_APPEARANCE_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_search_appearance_daily (
    source_key, analytics_account_id, report_date,
    search_type, search_appearance, page, country, device, feature_hash,
    impressions, clicks, ctr, position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(report_date)s,
    %(search_type)s, %(search_appearance)s, %(page)s, %(country)s, %(device)s, %(feature_hash)s,
    %(impressions)s, %(clicks)s, %(ctr)s, %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    search_type = VALUES(search_type),
    search_appearance = VALUES(search_appearance),
    page = VALUES(page),
    country = VALUES(country),
    device = VALUES(device),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    position = VALUES(position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

GSC_SEARCH_TYPE_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_search_type_daily (
    source_key, analytics_account_id, report_date,
    search_type, page, country, device, type_hash,
    impressions, clicks, ctr, position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(analytics_account_id)s, %(report_date)s,
    %(search_type)s, %(page)s, %(country)s, %(device)s, %(type_hash)s,
    %(impressions)s, %(clicks)s, %(ctr)s, %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    search_type = VALUES(search_type),
    page = VALUES(page),
    country = VALUES(country),
    device = VALUES(device),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    position = VALUES(position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""


@dataclass(frozen=True)
class GscAccount:
    analytics_account_id: str
    site_url: str


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", default="")
    parser.add_argument("--date-to", default="")
    parser.add_argument("--backfill-days", type=int, default=DEFAULT_BACKFILL_DAYS)
    parser.add_argument("--run-type", default="manual", choices=["manual", "cron", "backfill"])
    parser.add_argument("--account-id", default="")
    parser.add_argument("--site-url", default="")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


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


def query_hash(query: str, page: str, country: str, device: str) -> str:
    return hashlib.sha256("\n".join([clean_text(query), clean_text(page), clean_text(country), clean_text(device)]).encode("utf-8")).hexdigest()


def search_appearance_hash(search_type: str, search_appearance: str, page: str, country: str, device: str) -> str:
    parts = [
        clean_text(search_type),
        clean_text(search_appearance),
        clean_text(page),
        clean_text(country),
        clean_text(device),
    ]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def search_type_hash(search_type: str, page: str, country: str, device: str) -> str:
    parts = [clean_text(search_type), clean_text(page), clean_text(country), clean_text(device)]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def normalize_search_analytics_rows(
    payload: dict,
    *,
    analytics_account_id: str,
    report_date: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    for row in payload.get("rows") or []:
        keys = list(row.get("keys") or [])
        if len(keys) < 4:
            continue
        query = clean_text(keys[0])
        page = clean_text(keys[1])
        country = clean_text(keys[2])
        device = clean_text(keys[3])
        if not page:
            continue
        result.append(
            {
                "source_key": SOURCE_KEY,
                "analytics_account_id": analytics_account_id,
                "report_date": report_date,
                "query": query,
                "page": page,
                "country": country,
                "device": device,
                "impressions": safe_int(row.get("impressions")),
                "clicks": safe_int(row.get("clicks")),
                "ctr": safe_float(row.get("ctr")),
                "position": safe_float(row.get("position")),
                "query_hash": query_hash(query, page, country, device),
                "raw_payload": json.dumps(row, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def normalize_search_appearance_rows(
    payload: dict,
    *,
    analytics_account_id: str,
    report_date: str,
    search_type: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    normalized_search_type = clean_text(search_type) or "web"
    for row in payload.get("rows") or []:
        keys = list(row.get("keys") or [])
        if len(keys) < 1:
            continue
        search_appearance = clean_text(keys[0])
        page = ""
        country = ""
        device = ""
        if not search_appearance:
            continue
        result.append(
            {
                "source_key": SOURCE_KEY,
                "analytics_account_id": analytics_account_id,
                "report_date": report_date,
                "search_type": normalized_search_type,
                "search_appearance": search_appearance,
                "page": page,
                "country": country,
                "device": device,
                "impressions": safe_int(row.get("impressions")),
                "clicks": safe_int(row.get("clicks")),
                "ctr": safe_float(row.get("ctr")),
                "position": safe_float(row.get("position")),
                "feature_hash": search_appearance_hash(normalized_search_type, search_appearance, page, country, device),
                "raw_payload": json.dumps(row, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def normalize_search_type_rows(
    payload: dict,
    *,
    analytics_account_id: str,
    report_date: str,
    search_type: str,
    run_id: int,
) -> list[dict]:
    result: list[dict] = []
    normalized_search_type = clean_text(search_type) or "web"
    for row in payload.get("rows") or []:
        keys = list(row.get("keys") or [])
        required_key_count = 2 if normalized_search_type == "discover" else 3
        if len(keys) < required_key_count:
            continue
        page = clean_text(keys[0])
        country = clean_text(keys[1])
        device = "" if normalized_search_type == "discover" else clean_text(keys[2])
        if not page:
            continue
        result.append(
            {
                "source_key": SOURCE_KEY,
                "analytics_account_id": analytics_account_id,
                "report_date": report_date,
                "search_type": normalized_search_type,
                "page": page,
                "country": country,
                "device": device,
                "impressions": safe_int(row.get("impressions")),
                "clicks": safe_int(row.get("clicks")),
                "ctr": safe_float(row.get("ctr")),
                "position": safe_float(row.get("position")),
                "type_hash": search_type_hash(normalized_search_type, page, country, device),
                "raw_payload": json.dumps(row, ensure_ascii=False),
                "ingestion_run_id": run_id,
            }
        )
    return result


def parse_accounts_from_env() -> list[GscAccount]:
    raw = env_first("GSC_ACCOUNTS", default="")
    accounts: list[GscAccount] = []
    for chunk in raw.replace("\n", ",").split(","):
        parts = [part.strip() for part in chunk.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            accounts.append(GscAccount(parts[0], parts[1]))
    if accounts:
        return accounts
    return [GscAccount(DEFAULT_ACCOUNT_ID, DEFAULT_SITE_URL)]


def configured_accounts(args) -> list[GscAccount]:
    explicit_account = clean_text(getattr(args, "account_id", ""))
    explicit_site_url = clean_text(getattr(args, "site_url", ""))
    if explicit_account or explicit_site_url:
        return [GscAccount(explicit_account or DEFAULT_ACCOUNT_ID, explicit_site_url or DEFAULT_SITE_URL)]
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


def refresh_access_token() -> str:
    refresh_token = env_first("GSC_REFRESH_TOKEN")
    client_id = env_first("GSC_CLIENT_ID")
    client_secret = env_first("GSC_CLIENT_SECRET")
    if not refresh_token or not client_id or not client_secret:
        token = env_first("GSC_ACCESS_TOKEN")
        if token:
            return token
        raise RuntimeError("GSC_REFRESH_TOKEN/client credentials are not configured")
    response = requests.post(
        GSC_TOKEN_URL,
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
        raise RuntimeError("Google OAuth response did not include access_token")
    return str(token)


def request_with_retry(access_token: str, site_url: str, body: dict, *, run_id: int | None = None) -> dict:
    url = f"{GSC_API_BASE}/sites/{quote(site_url, safe='')}/searchAnalytics/query"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json", "Content-Type": "application/json"}
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        if REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        if run_id:
            log_collector_event(run_id, "info", "gsc_api_request", f"POST {site_url} searchAnalytics/query", {"attempt": attempt, "startRow": body.get("startRow")})
        response = requests.post(url, headers=headers, data=json.dumps(body), timeout=TIMEOUT)
        if response.status_code not in {429, 500, 502, 503, 504}:
            response.raise_for_status()
            return response.json() if response.text else {}
        if attempt == MAX_RETRIES:
            response.raise_for_status()
        retry_after = safe_float(response.headers.get("Retry-After")) or 0
        time.sleep(max(sleep_for, retry_after))
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f"GSC retry loop exhausted for {site_url}")


def build_search_analytics_body(
    day: str,
    dimensions: list[str],
    *,
    start_row: int = 0,
    search_type: str = "web",
    data_state: str = "final",
) -> dict:
    body = {
        "startDate": day,
        "endDate": day,
        "dimensions": dimensions,
        "rowLimit": GSC_ROW_LIMIT,
        "startRow": start_row,
        "dataState": data_state,
    }
    normalized_search_type = clean_text(search_type)
    if normalized_search_type:
        body["type"] = normalized_search_type
    return body


def fetch_paginated_search_analytics_rows(
    access_token: str,
    account: GscAccount,
    day: str,
    run_id: int,
    *,
    dimensions: list[str],
    search_type: str = "web",
    tolerate_layer_error: bool = False,
    optional_failures: list[dict[str, Any]] | None = None,
) -> list[dict]:
    all_rows: list[dict] = []
    for start_row in range(0, 1000000, GSC_ROW_LIMIT):
        body = build_search_analytics_body(day, dimensions, start_row=start_row, search_type=search_type)
        try:
            payload = request_with_retry(access_token, account.site_url, body, run_id=run_id)
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if tolerate_layer_error and status_code in {400, 403}:
                failure = {
                    "status_code": status_code,
                    "site_url": account.site_url,
                    "day": day,
                    "search_type": search_type,
                    "dimensions": dimensions,
                }
                if optional_failures is not None:
                    optional_failures.append(failure)
                log_collector_event(
                    run_id,
                    "warning",
                    "gsc_optional_layer_skipped",
                    f"Skipped optional GSC layer for {account.site_url} {day}",
                    failure,
                )
                return []
            raise
        rows = payload.get("rows") or []
        all_rows.extend(rows)
        if len(rows) < GSC_ROW_LIMIT:
            break
    return all_rows


def fetch_search_analytics_rows(access_token: str, account: GscAccount, day: str, run_id: int) -> list[dict]:
    return fetch_paginated_search_analytics_rows(
        access_token,
        account,
        day,
        run_id,
        dimensions=["query", "page", "country", "device"],
        search_type="web",
    )


def fetch_search_appearance_rows(
    access_token: str,
    account: GscAccount,
    day: str,
    run_id: int,
    *,
    search_type: str = "web",
    optional_failures: list[dict[str, Any]] | None = None,
) -> list[dict]:
    return fetch_paginated_search_analytics_rows(
        access_token,
        account,
        day,
        run_id,
        dimensions=["searchAppearance"],
        search_type=search_type,
        tolerate_layer_error=True,
        optional_failures=optional_failures,
    )


def fetch_search_type_rows(
    access_token: str,
    account: GscAccount,
    day: str,
    run_id: int,
    *,
    search_type: str,
    optional_failures: list[dict[str, Any]] | None = None,
) -> list[dict]:
    dimensions = (
        ["page", "country"]
        if clean_text(search_type) == "discover"
        else ["page", "country", "device"]
    )
    return fetch_paginated_search_analytics_rows(
        access_token,
        account,
        day,
        run_id,
        dimensions=dimensions,
        search_type=search_type,
        tolerate_layer_error=True,
        optional_failures=optional_failures,
    )


def upsert_rows(rows: list[dict], sql: str) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.executemany(sql, rows)
        conn.commit()
        return len(rows)
    finally:
        cur.close()
        conn.close()


def upsert_gsc_query_rows(rows: list[dict]) -> int:
    return upsert_rows(rows, GSC_QUERY_UPSERT_SQL)


def upsert_gsc_search_appearance_rows(rows: list[dict]) -> int:
    return upsert_rows(rows, GSC_SEARCH_APPEARANCE_UPSERT_SQL)


def upsert_gsc_search_type_rows(rows: list[dict]) -> int:
    return upsert_rows(rows, GSC_SEARCH_TYPE_UPSERT_SQL)


def configured_search_types() -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in GSC_SEARCH_TYPES_DEFAULT.replace("\n", ",").split(","):
        search_type = clean_text(item)
        if not search_type or search_type in seen:
            continue
        seen.add(search_type)
        result.append(search_type)
    return result or ["web"]


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
              AND status IN ('success', 'partial')
              AND DATE(started_at) = %s
            """,
            (SOURCE_KEY, day.strftime("%Y-%m-%d")),
        )
        return bool(cur.fetchone()[0])
    finally:
        cur.close()
        conn.close()


def build_account_registry_row(account: GscAccount) -> dict:
    now = datetime.utcnow()
    return {
        "source_key": SOURCE_KEY,
        "platform_account_id": account.analytics_account_id,
        "external_account_ref": account.site_url,
        "account_name": account.site_url,
        "advertiser_name": account.site_url,
        "account_status": "active",
        "timezone_name": "UTC",
        "first_seen_at": now,
        "last_seen_at": now,
        "raw_payload": {
            "site_url": account.site_url,
            "account_type": "gsc_property",
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
    if env_first("GSC_ENABLED", default="true").lower() == "false":
        return {"status": "skipped", "rows_read": 0, "rows_written": 0}
    dates = selected_dates(args)
    if args.run_type == "cron" and not args.force and cron_run_already_completed():
        log.info("Skipping cron run: completed daily run already exists today")
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
    optional_failures: list[dict[str, Any]] = []
    try:
        access_token = refresh_access_token()
        account_rows = []
        search_types = configured_search_types()
        for account in configured_accounts(args):
            account_rows.append(build_account_registry_row(account))
            for day in dates:
                raw_rows = fetch_search_analytics_rows(access_token, account, day, run_id)
                normalized_rows = normalize_search_analytics_rows(
                    {"rows": raw_rows},
                    analytics_account_id=account.analytics_account_id,
                    report_date=day,
                    run_id=run_id,
                )
                rows_read += len(raw_rows)
                rows_written += upsert_gsc_query_rows(normalized_rows)
                raw_search_appearance_rows = fetch_search_appearance_rows(
                    access_token,
                    account,
                    day,
                    run_id,
                    search_type="web",
                    optional_failures=optional_failures,
                )
                normalized_search_appearance_rows = normalize_search_appearance_rows(
                    {"rows": raw_search_appearance_rows},
                    analytics_account_id=account.analytics_account_id,
                    report_date=day,
                    search_type="web",
                    run_id=run_id,
                )
                rows_read += len(raw_search_appearance_rows)
                rows_written += upsert_gsc_search_appearance_rows(normalized_search_appearance_rows)
                search_type_counts: dict[str, int] = {}
                for search_type in search_types:
                    raw_type_rows = fetch_search_type_rows(
                        access_token,
                        account,
                        day,
                        run_id,
                        search_type=search_type,
                        optional_failures=optional_failures,
                    )
                    normalized_type_rows = normalize_search_type_rows(
                        {"rows": raw_type_rows},
                        analytics_account_id=account.analytics_account_id,
                        report_date=day,
                        search_type=search_type,
                        run_id=run_id,
                    )
                    search_type_counts[search_type] = len(normalized_type_rows)
                    rows_read += len(raw_type_rows)
                    rows_written += upsert_gsc_search_type_rows(normalized_type_rows)
                log_collector_event(
                    run_id,
                    "info",
                    "gsc_day_collected",
                    f"Collected GSC daily facts for {account.site_url} {day}",
                    {
                        "query_rows": len(normalized_rows),
                        "search_appearance_rows": len(normalized_search_appearance_rows),
                        "search_type_rows": search_type_counts,
                    },
                )
        upsert_accounts(account_rows)
        status = "partial" if optional_failures else "success"
        failure_summary = json.dumps(optional_failures, ensure_ascii=False)[:1000] if optional_failures else None
        if optional_failures:
            log_collector_event(
                run_id,
                "warning",
                "gsc_run_partial",
                f"GSC core facts committed with {len(optional_failures)} optional layer failure(s)",
                {"optional_failures": optional_failures},
            )
        finish_run(
            run_id,
            status,
            rows_read,
            rows_written,
            rows_written,
            len(optional_failures),
            failure_summary,
        )
        return {
            "status": status,
            "run_id": run_id,
            "rows_read": rows_read,
            "rows_written": rows_written,
            "dates": dates,
            "optional_failure_count": len(optional_failures),
            "optional_failures": optional_failures,
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
