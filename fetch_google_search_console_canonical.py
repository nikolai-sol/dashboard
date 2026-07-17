#!/usr/bin/env python3
"""Google Search Console -> canonical_fact_gsc_*_daily."""

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
READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
GSC_API_BASE = env_first("GSC_API_BASE", default="https://www.googleapis.com/webmasters/v3")
GOOGLE_OAUTH_TOKEN_URL = env_first("GOOGLE_OAUTH_TOKEN_URL", default="https://oauth2.googleapis.com/token")
DEFAULT_PROPERTY_URL = env_first("GSC_SITE_URL", "GSC_PROPERTY_URL", default="https://zaruku.ru/")
DEFAULT_LAG_DAYS = int(env_first("GSC_DAILY_LAG_DAYS", default="3") or 3)
DEFAULT_DEVICE_TYPES = [
    device.strip().upper()
    for device in env_first("GSC_DEVICE_TYPES", default="DESKTOP,MOBILE,TABLET").split(",")
    if device.strip()
]
SEARCH_ANALYTICS_ROW_LIMIT = int(env_first("GSC_SEARCH_ANALYTICS_ROW_LIMIT", default="25000") or 25000)
MAX_RETRIES = 5
TIMEOUT = 90
REQUEST_DELAY_SECONDS = float(env_first("GSC_REQUEST_DELAY_SECONDS", default="0.25") or 0)
TOKEN_STATE_PATH = env_first("GSC_TOKEN_STATE_PATH", default="")

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
log = logging.getLogger("google_search_console_canonical")


GSC_QUERY_SNAPSHOT_DELETE_SQL = """
DELETE FROM canonical_fact_gsc_queries_daily
WHERE source_key = %s
  AND property_url = %s
  AND report_date = %s
  AND device_type = %s
"""

GSC_PAGE_SNAPSHOT_DELETE_SQL = """
DELETE FROM canonical_fact_gsc_pages_daily
WHERE source_key = %s
  AND property_url = %s
  AND report_date = %s
  AND device_type = %s
"""

GSC_QUERY_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_queries_daily (
    source_key, property_url, report_date, device_type,
    query_hash, query_text, impressions, clicks, ctr,
    average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(property_url)s, %(report_date)s, %(device_type)s,
    %(query_hash)s, %(query)s, %(impressions)s, %(clicks)s, %(ctr)s,
    %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    query_text = VALUES(query_text),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    average_position = VALUES(average_position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

GSC_PAGE_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_pages_daily (
    source_key, property_url, report_date, device_type,
    page_hash, page_url, impressions, clicks, ctr,
    average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(property_url)s, %(report_date)s, %(device_type)s,
    %(page_hash)s, %(page)s, %(impressions)s, %(clicks)s, %(ctr)s,
    %(position)s, %(raw_payload)s, %(ingestion_run_id)s
)
ON DUPLICATE KEY UPDATE
    page_url = VALUES(page_url),
    impressions = VALUES(impressions),
    clicks = VALUES(clicks),
    ctr = VALUES(ctr),
    average_position = VALUES(average_position),
    raw_payload = VALUES(raw_payload),
    ingestion_run_id = VALUES(ingestion_run_id),
    updated_at = CURRENT_TIMESTAMP
"""

GSC_SUMMARY_UPSERT_SQL = """
INSERT INTO canonical_fact_gsc_summary_daily (
    source_key, property_url, report_date, device_type,
    impressions, clicks, ctr, average_position, raw_payload, ingestion_run_id
) VALUES (
    %(source_key)s, %(property_url)s, %(report_date)s, %(device_type)s,
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


@dataclass(frozen=True)
class GscProperty:
    property_url: str


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-from", default="")
    parser.add_argument("--date-to", default="")
    parser.add_argument("--lag-days", type=int, default=DEFAULT_LAG_DAYS)
    parser.add_argument("--run-type", default="manual", choices=["manual", "cron", "backfill"])
    parser.add_argument("--property-url", default="")
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
    end = effective_anchor - timedelta(days=1)
    start = end - timedelta(days=max(lag_days, 0))
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


def selected_dates(args) -> list[str]:
    if args.date_from or args.date_to:
        today = datetime.now(timezone.utc).date()
        date_to = args.date_to or (today - timedelta(days=1)).strftime("%Y-%m-%d")
        date_from = args.date_from or date_to
        return daterange(date_from, date_to)
    return collection_dates(lag_days=args.lag_days)


def stable_hash(value: str) -> str:
    return hashlib.sha256(clean_text(value).lower().encode("utf-8")).hexdigest()


def _dimension_map(row: dict, dimensions: list[str]) -> dict[str, str]:
    keys = row.get("keys") or []
    mapped: dict[str, str] = {}
    for index, dimension in enumerate(dimensions):
        mapped[dimension] = clean_text(keys[index]) if index < len(keys) else ""
    return mapped


def _base_row(
    raw_row: dict,
    dimensions: list[str],
    *,
    source_key: str,
    property_url: str,
    report_date: str,
    run_id: int,
    default_device: str,
) -> dict:
    mapped = _dimension_map(raw_row, dimensions)
    impressions = safe_int(raw_row.get("impressions"))
    clicks = safe_int(raw_row.get("clicks"))
    position = safe_float(raw_row.get("position"))
    return {
        "source_key": source_key,
        "property_url": property_url,
        "report_date": report_date,
        "device_type": (mapped.get("device") or default_device).upper(),
        "impressions": impressions,
        "clicks": clicks,
        "ctr": calculate_ctr(impressions, clicks),
        "position": round(position, 6) if position is not None else None,
        "raw_payload": json.dumps(raw_row, ensure_ascii=False),
        "ingestion_run_id": run_id,
    }


def normalize_search_analytics_rows(
    payload: dict,
    dimensions: list[str],
    *,
    source_key: str,
    property_url: str,
    report_date: str,
    run_id: int,
    default_device: str = "ALL",
) -> list[dict]:
    rows: list[dict] = []
    for raw_row in payload.get("rows") or []:
        mapped = _dimension_map(raw_row, dimensions)
        base = _base_row(
            raw_row,
            dimensions,
            source_key=source_key,
            property_url=property_url,
            report_date=report_date,
            run_id=run_id,
            default_device=default_device,
        )
        if "query" in dimensions:
            query = clean_text(mapped.get("query"))
            if not query:
                continue
            rows.append({**base, "query": query, "query_hash": stable_hash(query)})
        elif "page" in dimensions:
            page = clean_text(mapped.get("page"))
            if not page:
                continue
            rows.append({**base, "page": page, "page_hash": stable_hash(page)})
    return rows


def normalize_summary_rows(
    payload: dict,
    *,
    source_key: str,
    property_url: str,
    report_date: str,
    run_id: int,
    devices: list[str] | None = None,
) -> list[dict]:
    rows_by_device: dict[str, dict] = {}
    for raw_row in payload.get("rows") or []:
        base = _base_row(
            raw_row,
            ["device"],
            source_key=source_key,
            property_url=property_url,
            report_date=report_date,
            run_id=run_id,
            default_device="ALL",
        )
        rows_by_device[base["device_type"]] = {
            "source_key": base["source_key"],
            "property_url": base["property_url"],
            "report_date": base["report_date"],
            "device_type": base["device_type"],
            "impressions": base["impressions"],
            "clicks": base["clicks"],
            "ctr": base["ctr"],
            "average_position": base["position"],
            "raw_payload": base["raw_payload"],
            "ingestion_run_id": base["ingestion_run_id"],
        }
    if not devices:
        return list(rows_by_device.values())

    result = []
    for device in devices:
        normalized_device = device.upper()
        result.append(rows_by_device.get(normalized_device) or {
            "source_key": source_key,
            "property_url": property_url,
            "report_date": report_date,
            "device_type": normalized_device,
            "impressions": 0,
            "clicks": 0,
            "ctr": None,
            "average_position": None,
            "raw_payload": json.dumps(
                {"derived_from": "empty_search_analytics_device_snapshot", "device_type": normalized_device},
                ensure_ascii=False,
            ),
            "ingestion_run_id": run_id,
        })
    return result


def request_with_retry(
    method: str,
    url: str,
    *,
    access_token: str,
    json_body: dict | None = None,
    run_id: int | None = None,
) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    if json_body is not None:
        headers["Content-Type"] = "application/json; charset=UTF-8"
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        if REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        if run_id:
            log_collector_event(
                run_id,
                "info",
                "gsc_api_request",
                f"{method} {url.split('?', 1)[0]}",
                {"attempt": attempt},
            )
        response = requests.request(method, url, headers=headers, json=json_body, timeout=TIMEOUT)
        if response.status_code not in (429, 500, 502, 503, 504):
            response.raise_for_status()
            return response.json() if response.text else {}
        if attempt == MAX_RETRIES:
            response.raise_for_status()
        retry_after = safe_float(response.headers.get("Retry-After")) or 0
        time.sleep(max(sleep_for, retry_after))
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f"GSC retry loop exhausted for {url}")


def fetch_search_analytics(
    access_token: str,
    site_url: str,
    date_value: str,
    dimensions: list[str],
    *,
    run_id: int | None = None,
) -> dict:
    body = {
        "startDate": date_value,
        "endDate": date_value,
        "dimensions": dimensions,
        "rowLimit": SEARCH_ANALYTICS_ROW_LIMIT,
        "startRow": 0,
    }
    payload = request_with_retry(
        "POST",
        f"{GSC_API_BASE}/sites/{quote(site_url, safe='')}/searchAnalytics/query",
        access_token=access_token,
        json_body=body,
        run_id=run_id,
    )
    row_count = len(payload.get("rows") or [])
    if row_count >= SEARCH_ANALYTICS_ROW_LIMIT:
        raise RuntimeError(
            "rowLimit-sized Google Search Console response refused before replacement: "
            f"site_url={site_url}, date={date_value}, dimensions={','.join(dimensions)}, "
            f"row_count={row_count}, row_limit={SEARCH_ANALYTICS_ROW_LIMIT}"
        )
    return payload


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
    refresh_token = env_first("GSC_REFRESH_TOKEN", "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN")
    client_id = env_first("GSC_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_ID")
    client_secret = env_first("GSC_CLIENT_SECRET", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET")
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
        token = env_first("GSC_ACCESS_TOKEN", "GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN")
        if token:
            return token
        raise RuntimeError("GSC_REFRESH_TOKEN/client credentials are not configured")
    response = requests.post(
        GOOGLE_OAUTH_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": READONLY_SCOPE,
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Google OAuth response did not include access_token")
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=max(safe_int(payload.get("expires_in")) - 60, 60))).isoformat()
    write_token_state(
        {
            "access_token": token,
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_at": expires_at,
            "scope": payload.get("scope") or READONLY_SCOPE,
        }
    )
    return str(token)


def replace_gsc_day_rows(query_rows: list[dict], page_rows: list[dict], summary_row: dict) -> int:
    conn = get_db_connection()
    cur = None
    identity = (
        summary_row["source_key"],
        summary_row["property_url"],
        summary_row["report_date"],
        summary_row["device_type"],
    )
    try:
        cur = conn.cursor()
        cur.execute(GSC_QUERY_SNAPSHOT_DELETE_SQL, identity)
        cur.execute(GSC_PAGE_SNAPSHOT_DELETE_SQL, identity)
        if query_rows:
            cur.executemany(GSC_QUERY_UPSERT_SQL, query_rows)
        if page_rows:
            cur.executemany(GSC_PAGE_UPSERT_SQL, page_rows)
        cur.execute(GSC_SUMMARY_UPSERT_SQL, summary_row)
        conn.commit()
        return len(query_rows) + len(page_rows) + 1
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            if cur is not None:
                cur.close()
        finally:
            conn.close()


def parse_properties_from_env() -> list[GscProperty]:
    raw = env_first("GSC_PROPERTIES", default="")
    properties = [GscProperty(clean_text(chunk)) for chunk in raw.replace("\n", ",").split(",") if clean_text(chunk)]
    return properties or [GscProperty(DEFAULT_PROPERTY_URL)]


def configured_properties(args) -> list[GscProperty]:
    explicit_property = clean_text(getattr(args, "property_url", ""))
    if explicit_property:
        return [GscProperty(explicit_property)]
    return parse_properties_from_env()


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


def build_account_registry_row(gsc_property: GscProperty) -> dict:
    now = datetime.utcnow()
    return {
        "source_key": SOURCE_KEY,
        "platform_account_id": gsc_property.property_url,
        "external_account_ref": gsc_property.property_url,
        "account_name": gsc_property.property_url,
        "advertiser_name": gsc_property.property_url,
        "account_status": "active",
        "timezone_name": "Europe/Moscow",
        "first_seen_at": now,
        "last_seen_at": now,
        "raw_payload": {
            "property_url": gsc_property.property_url,
            "scope": READONLY_SCOPE,
            "account_type": "google_search_console_property",
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


def _rows_by_device(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(clean_text(row.get("device_type")).upper() or "ALL", []).append(row)
    return grouped


def collect(args) -> dict[str, Any]:
    if env_first("GSC_ENABLED", default="true").lower() == "false":
        return {"status": "skipped", "rows_read": 0, "rows_written": 0}
    dates = selected_dates(args)
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
        account_rows = []
        for gsc_property in configured_properties(args):
            account_rows.append(build_account_registry_row(gsc_property))
            for day in dates:
                query_payload = fetch_search_analytics(access_token, gsc_property.property_url, day, ["query", "device"], run_id=run_id)
                page_payload = fetch_search_analytics(access_token, gsc_property.property_url, day, ["page", "device"], run_id=run_id)
                summary_payload = fetch_search_analytics(access_token, gsc_property.property_url, day, ["device"], run_id=run_id)
                query_rows = normalize_search_analytics_rows(
                    query_payload,
                    ["query", "device"],
                    source_key=SOURCE_KEY,
                    property_url=gsc_property.property_url,
                    report_date=day,
                    run_id=run_id,
                )
                page_rows = normalize_search_analytics_rows(
                    page_payload,
                    ["page", "device"],
                    source_key=SOURCE_KEY,
                    property_url=gsc_property.property_url,
                    report_date=day,
                    run_id=run_id,
                )
                summary_rows = normalize_summary_rows(
                    summary_payload,
                    source_key=SOURCE_KEY,
                    property_url=gsc_property.property_url,
                    report_date=day,
                    run_id=run_id,
                    devices=DEFAULT_DEVICE_TYPES,
                )
                query_by_device = _rows_by_device(query_rows)
                page_by_device = _rows_by_device(page_rows)
                rows_read += len(query_payload.get("rows") or []) + len(page_payload.get("rows") or []) + len(summary_payload.get("rows") or [])
                for summary_row in summary_rows:
                    device = summary_row["device_type"]
                    rows_written += replace_gsc_day_rows(
                        query_by_device.get(device, []),
                        page_by_device.get(device, []),
                        summary_row,
                    )
                log_collector_event(
                    run_id,
                    "info",
                    "gsc_day_collected",
                    f"Collected GSC daily facts for {gsc_property.property_url} {day}",
                    {"query_rows": len(query_rows), "page_rows": len(page_rows), "summary_rows": len(summary_rows)},
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
