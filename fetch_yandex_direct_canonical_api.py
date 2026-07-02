#!/usr/bin/env python3
"""Yandex Direct API -> canonical_* tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import mysql.connector
import requests
from dotenv import dotenv_values, load_dotenv

from canonical_writer import (
    finish_collector_run,
    log_run_event,
    start_collector_run,
    upsert_creatives,
    upsert_delivery_entities,
    upsert_fact_ads_daily,
    upsert_source_accounts,
    upsert_source_campaigns,
)
from yandex_direct_shared import (
    DEFAULT_CHECKPOINT_ACCOUNTS,
    DEFAULT_CRITICAL_ACCOUNTS,
    EXCLUDED_CAMPAIGN_IDS,
    parse_csv_list,
    resolve_account_bridge,
)

load_dotenv(Path(__file__).parent / '.env')

LOCAL_ENV_PATH = Path(__file__).parent / '.env'
LEGACY_ENV_PATH = Path('/var/www/www-root/data/.production.env')
local_env = dotenv_values(LOCAL_ENV_PATH)
legacy_env = dotenv_values(LEGACY_ENV_PATH) if LEGACY_ENV_PATH.exists() else {}


def env_first(*keys: str, default: str = '') -> str:
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


SOURCE_KEY = env_first('YANDEX_DIRECT_API_SOURCE_KEY', default='yandex_direct_api_shadow')
MAX_RETRIES = int(env_first('YANDEX_DIRECT_MAX_RETRIES', default='90'))
PRIMARY_COLLECTOR = env_first('YANDEX_DIRECT_PRIMARY_COLLECTOR', default='legacy').strip().lower() or 'legacy'
CRITICAL_ACCOUNTS = parse_csv_list(env_first('YANDEX_DIRECT_CRITICAL_ACCOUNTS', default=''), DEFAULT_CRITICAL_ACCOUNTS)
CHECKPOINT_ACCOUNTS = parse_csv_list(
    env_first('YANDEX_DIRECT_CHECKPOINT_ACCOUNTS', default=''),
    DEFAULT_CHECKPOINT_ACCOUNTS,
)

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB_TECH = env_first('MYSQL_DB_TECH', 'MYSQL_DB_STAT', 'MYSQL_DB', default='report_bd_tech')
MYSQL_DB_STAT = env_first('MYSQL_DB_STAT', 'MYSQL_DB', default='report_bd')

DIRECT_URL = env_first('DIRECT_URL', default='https://api.direct.yandex.com/json/v5/reports')
DIRECT_API_BASE_URL = env_first('YANDEX_DIRECT_API_BASE_URL', default='https://api.direct.yandex.com/json/v5').rstrip('/')

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('yandex_direct_canonical_api')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'command',
        nargs='?',
        default='collect',
        choices=['collect', 'apply-approved-mutations'],
    )
    parser.add_argument('--date-from', default='')
    parser.add_argument('--date-to', default='')
    parser.add_argument('--days-back', type=int, default=14)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
    parser.add_argument('--skip-keyword-performance', action='store_true')
    parser.add_argument('--keywords-only', action='store_true')
    parser.add_argument('--client-login', default='')
    parser.add_argument('--campaign-id', default='')
    parser.add_argument('--campaign-ids', default='')
    parser.add_argument('--mutation-id', type=int, default=0)
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--confirm-apply', action='store_true')
    return parser.parse_args()


def date_range(args) -> tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    cron_anchor = today - timedelta(days=1)
    date_to = args.date_to or (cron_anchor if args.run_type == 'cron' else today).strftime('%Y-%m-%d')
    if args.date_from:
        date_from = args.date_from
    else:
        start_anchor = cron_anchor if args.run_type == 'cron' else today
        date_from = (start_anchor - timedelta(days=max(args.days_back - 1, 0))).strftime('%Y-%m-%d')
    return date_from, date_to


def get_db_connection(database: str):
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=database,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def safe_int(value: Any) -> int:
    try:
        return max(int(float(value or 0)), 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    try:
        return max(float(value or 0), 0.0)
    except (TypeError, ValueError):
        return 0.0


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def stable_id(*parts: Any) -> str:
    raw = '|'.join(str(part or '') for part in parts)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:48]


def parse_csv_values(value: str) -> list[str]:
    result: list[str] = []
    for item in str(value or '').replace('\n', ',').split(','):
        item = item.strip()
        if item and item not in result:
            result.append(item)
    return result


def normalize_campaign_id(value: Any) -> str:
    return ''.join(ch for ch in str(value or '').strip() if ch.isdigit())


def selected_campaign_ids(args) -> list[str]:
    result: list[str] = []
    for item in parse_csv_values(getattr(args, 'campaign_ids', '')):
        campaign_id = normalize_campaign_id(item)
        if campaign_id and campaign_id not in result:
            result.append(campaign_id)
    campaign_id = normalize_campaign_id(getattr(args, 'campaign_id', ''))
    if campaign_id and campaign_id not in result:
        result.insert(0, campaign_id)
    return result


def report_selection_criteria(day: str, campaign_ids: list[str] | None = None) -> dict:
    criteria: dict[str, Any] = {'DateFrom': day, 'DateTo': day}
    ids = [safe_int(campaign_id) for campaign_id in campaign_ids or [] if safe_int(campaign_id) > 0]
    if ids:
        criteria['Filter'] = [
            {
                'Field': 'CampaignId',
                'Operator': 'IN',
                'Values': [str(campaign_id) for campaign_id in ids],
            }
        ]
    return criteria


def json_or_none(value: Any) -> str | None:
    return json.dumps(value, ensure_ascii=False, default=str) if value is not None else None


def ensure_keyword_performance_table() -> None:
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS yandex_direct_keyword_performance_daily (
              report_date DATE NOT NULL,
              client_login VARCHAR(255) NOT NULL,
              account_id VARCHAR(255) NOT NULL DEFAULT '',
              campaign_id VARCHAR(64) NOT NULL,
              campaign_name VARCHAR(500),
              ad_group_id VARCHAR(64) NOT NULL DEFAULT '',
              ad_group_name VARCHAR(500),
              criterion_id VARCHAR(96) NOT NULL,
              criterion_text VARCHAR(2048),
              criterion_type VARCHAR(64),
              currency_code VARCHAR(8) NOT NULL DEFAULT 'RUB',
              cost DECIMAL(18,6) DEFAULT 0,
              impressions BIGINT DEFAULT 0,
              clicks BIGINT DEFAULT 0,
              conversions DECIMAL(18,6) DEFAULT 0,
              ctr DECIMAL(18,6) DEFAULT NULL,
              avg_cpc DECIMAL(18,6) DEFAULT NULL,
              conversion_rate DECIMAL(18,6) DEFAULT NULL,
              raw_payload JSON DEFAULT NULL,
              ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (report_date, client_login, campaign_id, ad_group_id, criterion_id),
              KEY idx_yd_keyword_perf_campaign_date (campaign_id, report_date),
              KEY idx_yd_keyword_perf_client_date (client_login, report_date),
              KEY idx_yd_keyword_perf_type_date (criterion_type, report_date),
              KEY idx_yd_keyword_perf_run (ingestion_run_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        conn.commit()
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def ensure_control_mutation_tables() -> None:
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS yandex_direct_control_settings (
              id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
              dashboard_id BIGINT UNSIGNED NOT NULL,
              client_login VARCHAR(255) NOT NULL,
              account_id VARCHAR(255) NOT NULL DEFAULT '',
              campaign_id VARCHAR(64) NOT NULL,
              control_enabled TINYINT(1) NOT NULL DEFAULT 0,
              campaign_mutations_enabled TINYINT(1) NOT NULL DEFAULT 0,
              bid_mutations_enabled TINYINT(1) NOT NULL DEFAULT 0,
              apply_enabled TINYINT(1) NOT NULL DEFAULT 0,
              auto_collect_enabled TINYINT(1) NOT NULL DEFAULT 1,
              lookback_days INT NOT NULL DEFAULT 14,
              max_apply_per_run INT NOT NULL DEFAULT 10,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE KEY uq_yandex_direct_control_scope (dashboard_id, client_login, campaign_id),
              KEY idx_yandex_direct_control_dashboard (dashboard_id),
              KEY idx_yandex_direct_control_login_campaign (client_login, campaign_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS yandex_direct_mutation_log (
              id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
              dashboard_id BIGINT UNSIGNED NOT NULL,
              client_login VARCHAR(255) NOT NULL,
              account_id VARCHAR(255) NOT NULL DEFAULT '',
              campaign_id VARCHAR(64) NOT NULL,
              mutation_type VARCHAR(64) NOT NULL,
              entity_type VARCHAR(64) NOT NULL,
              entity_id VARCHAR(255) NOT NULL,
              payload_json JSON DEFAULT NULL,
              operation_type VARCHAR(64) NOT NULL DEFAULT 'planned',
              approval_ref VARCHAR(128) DEFAULT NULL,
              request_payload JSON DEFAULT NULL,
              response_payload JSON DEFAULT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'planned',
              error_message TEXT DEFAULT NULL,
              review_note TEXT DEFAULT NULL,
              reviewed_by VARCHAR(255) DEFAULT NULL,
              reviewed_at TIMESTAMP NULL DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              applied_at DATETIME DEFAULT NULL,
              PRIMARY KEY (id),
              KEY idx_yandex_direct_mutation_scope (dashboard_id, client_login, campaign_id),
              KEY idx_yandex_direct_mutation_status (status),
              KEY idx_yandex_direct_mutation_type (mutation_type),
              KEY idx_yandex_direct_mutation_entity (entity_type, entity_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        conn.commit()
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def upsert_keyword_performance_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    columns = [
        'report_date',
        'client_login',
        'account_id',
        'campaign_id',
        'campaign_name',
        'ad_group_id',
        'ad_group_name',
        'criterion_id',
        'criterion_text',
        'criterion_type',
        'currency_code',
        'cost',
        'impressions',
        'clicks',
        'conversions',
        'ctr',
        'avg_cpc',
        'conversion_rate',
        'raw_payload',
        'ingestion_run_id',
    ]
    immutable = {'report_date', 'client_login', 'campaign_id', 'ad_group_id', 'criterion_id'}
    updates = ', '.join(f'{column}=VALUES({column})' for column in columns if column not in immutable)
    placeholders = ', '.join(['%s'] * len(columns))
    sql = f"""
        INSERT INTO yandex_direct_keyword_performance_daily ({', '.join(columns)})
        VALUES ({placeholders})
        ON DUPLICATE KEY UPDATE {updates}
    """
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor()
        cur.executemany(sql, [tuple(row.get(column) for column in columns) for row in rows])
        conn.commit()
        return len(rows)
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def validate_primary_collector_config() -> None:
    if SOURCE_KEY == 'yandex_direct' and PRIMARY_COLLECTOR != 'api':
        raise RuntimeError(
            'Refusing to write source_key=yandex_direct from API collector while '
            'YANDEX_DIRECT_PRIMARY_COLLECTOR is not set to api'
        )


def fetch_active_systems() -> list[dict]:
    last_error = None
    for database in dict.fromkeys([MYSQL_DB_TECH, 'report_bd_tech']):
        conn = cur = None
        try:
            conn = get_db_connection(database)
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT id, name, access, media
                FROM req_system
                WHERE active = 1
                ORDER BY id
                """
            )
            rows = cur.fetchall()
            if not rows:
                raise RuntimeError('No active rows found in req_system')
            return rows
        except Exception as exc:
            last_error = exc
        finally:
            if cur:
                cur.close()
            if conn:
                conn.close()
    raise last_error


def fetch_campaign_meta() -> dict[str, dict[str, str]]:
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT campaign_id, name, brand FROM yandex_names")
        result: dict[str, dict[str, str]] = {}
        for row in cur.fetchall():
            result[str(row['campaign_id'])] = {
                'campaign_name': clean_text(row.get('name')),
                'brand': clean_text(row.get('brand')),
            }
        return result
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def fields_and_report_type(media: int) -> tuple[list[str], str]:
    if media == 1:
        return (
            [
                'AdId',
                'AdGroupId',
                'AdGroupName',
                'CampaignId',
                'CampaignName',
                'Impressions',
                'ImpressionReach',
                'Clicks',
                'Conversions',
                'Ctr',
                'Cost',
            ],
            'REACH_AND_FREQUENCY_PERFORMANCE_REPORT',
        )
    if media == 2:
        return (
            [
                'CampaignId',
                'CampaignName',
                'Impressions',
                'Clicks',
                'Conversions',
                'Ctr',
                'Cost',
                'AvgCpc',
                'AvgImpressionPosition',
            ],
            'CUSTOM_REPORT',
        )
    return (
        [
            'AdId',
            'AdGroupId',
            'AdGroupName',
            'CampaignId',
            'CampaignName',
            'Impressions',
            'Clicks',
            'Conversions',
            'Ctr',
            'Cost',
            'AvgCpc',
            'AvgImpressionPosition',
        ],
        'CUSTOM_REPORT',
    )


def parse_tsv(report: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in report.split('\n'):
        line = line.strip()
        if not line:
            continue
        rows.append(line.split('\t'))
    return rows


def direct_service_url(service: str) -> str:
    return f"{DIRECT_API_BASE_URL}/{service.strip('/')}"


def request_direct_service(system: dict, service: str, method: str, params: dict) -> dict:
    token = clean_text(system.get('access'))
    client_login = clean_text(system.get('name'))
    if not token or not client_login:
        raise RuntimeError(f"Invalid req_system credentials: id={system.get('id')}")

    body = {
        'method': method,
        'params': params,
    }
    headers = {
        'Authorization': f'Bearer {token}',
        'Client-Login': client_login,
        'Accept-Language': 'ru',
        'Content-Type': 'application/json; charset=utf-8',
    }
    response = requests.post(direct_service_url(service), json=body, headers=headers, timeout=180)
    if response.status_code != 200:
        raise RuntimeError(
            f"Direct {service}.{method} failed for {client_login}: "
            f"status={response.status_code} body={response.text[:800]}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Direct {service}.{method} returned invalid JSON: {response.text[:800]}") from exc
    if payload.get('error'):
        raise RuntimeError(f"Direct {service}.{method} error: {json.dumps(payload['error'], ensure_ascii=False)}")
    return payload


def request_direct_report(system: dict, day: str, campaign_ids: list[str] | None = None) -> list[list[str]]:
    token = clean_text(system.get('access'))
    client_login = clean_text(system.get('name'))
    if not token or not client_login:
        raise RuntimeError(f"Invalid req_system credentials: id={system.get('id')}")

    media = int(system.get('media') or 0)
    fields, report_type = fields_and_report_type(media)
    body = {
        'params': {
            'SelectionCriteria': report_selection_criteria(day, campaign_ids),
            'FieldNames': fields,
            'ReportName': f"CANONICAL_{day}_{system.get('id')}_{int(time.time())}",
            'ReportType': report_type,
            'DateRangeType': 'CUSTOM_DATE',
            'Format': 'TSV',
            'IncludeVAT': 'NO',
            'IncludeDiscount': 'NO',
        }
    }
    headers = {
        'Authorization': f'Bearer {token}',
        'Client-Login': client_login,
        'Accept-Language': 'ru',
        'processingMode': 'auto',
        'skipColumnHeader': 'true',
        'skipReportHeader': 'true',
        'skipReportSummary': 'true',
        'returnMoneyInMicros': 'false',
        'Content-Type': 'application/json; charset=utf-8',
    }

    last_retry_status = None
    last_retry_body = ''
    last_retry_in = ''
    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.post(DIRECT_URL, json=body, headers=headers, timeout=180)
        if response.status_code == 200:
            return parse_tsv(response.text)

        if response.status_code in (201, 202):
            last_retry_status = response.status_code
            last_retry_body = response.text[:400]
            retry_after = response.headers.get('retryIn')
            last_retry_in = retry_after or ''
            sleep_for = int(retry_after) if retry_after and retry_after.isdigit() else 10
            time.sleep(max(sleep_for, 5))
            continue

        if response.status_code == 429:
            last_retry_status = response.status_code
            last_retry_body = response.text[:400]
            retry_after = response.headers.get('retryIn')
            last_retry_in = retry_after or ''
            sleep_for = int(retry_after) if retry_after and retry_after.isdigit() else min(7 * attempt, 60)
            time.sleep(max(sleep_for, 7))
            continue

        if response.status_code >= 500 and attempt < MAX_RETRIES:
            last_retry_status = response.status_code
            last_retry_body = response.text[:400]
            last_retry_in = response.headers.get('retryIn') or ''
            time.sleep(min(7 * attempt, 60))
            continue

        raise RuntimeError(
            f"Direct API failed for {client_login} day={day}: "
            f"status={response.status_code} body={response.text[:400]}"
        )

    detail = ''
    if last_retry_status:
        detail = f"; last_status={last_retry_status} retryIn={last_retry_in or '-'} body={last_retry_body}"
    raise RuntimeError(f"Direct API retry loop exhausted for {client_login} day={day}{detail}")


def keyword_performance_fields() -> list[str]:
    return [
        'AdGroupId',
        'AdGroupName',
        'CampaignId',
        'CampaignName',
        'CriterionId',
        'Criterion',
        'CriterionType',
        'Impressions',
        'Clicks',
        'Conversions',
        'Ctr',
        'Cost',
        'AvgCpc',
        'ConversionRate',
    ]


def request_keyword_performance_report(system: dict, day: str, campaign_ids: list[str] | None = None) -> list[list[str]]:
    token = clean_text(system.get('access'))
    client_login = clean_text(system.get('name'))
    if not token or not client_login:
        raise RuntimeError(f"Invalid req_system credentials: id={system.get('id')}")

    body = {
        'params': {
            'SelectionCriteria': report_selection_criteria(day, campaign_ids),
            'FieldNames': keyword_performance_fields(),
            'ReportName': f"KEYWORDS_{day}_{system.get('id')}_{int(time.time())}",
            'ReportType': 'CRITERIA_PERFORMANCE_REPORT',
            'DateRangeType': 'CUSTOM_DATE',
            'Format': 'TSV',
            'IncludeVAT': 'NO',
            'IncludeDiscount': 'NO',
        }
    }
    headers = {
        'Authorization': f'Bearer {token}',
        'Client-Login': client_login,
        'Accept-Language': 'ru',
        'processingMode': 'auto',
        'skipColumnHeader': 'true',
        'skipReportHeader': 'true',
        'skipReportSummary': 'true',
        'returnMoneyInMicros': 'false',
        'Content-Type': 'application/json; charset=utf-8',
    }

    last_retry_status = None
    last_retry_body = ''
    last_retry_in = ''
    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.post(DIRECT_URL, json=body, headers=headers, timeout=180)
        if response.status_code == 200:
            return parse_tsv(response.text)

        if response.status_code in (201, 202, 429):
            last_retry_status = response.status_code
            last_retry_body = response.text[:400]
            retry_after = response.headers.get('retryIn')
            last_retry_in = retry_after or ''
            default_sleep = 10 if response.status_code in (201, 202) else min(7 * attempt, 60)
            sleep_for = int(retry_after) if retry_after and retry_after.isdigit() else default_sleep
            time.sleep(max(sleep_for, 5))
            continue

        if response.status_code >= 500 and attempt < MAX_RETRIES:
            last_retry_status = response.status_code
            last_retry_body = response.text[:400]
            last_retry_in = response.headers.get('retryIn') or ''
            time.sleep(min(7 * attempt, 60))
            continue

        raise RuntimeError(
            f"Direct keyword report failed for {client_login} day={day}: "
            f"status={response.status_code} body={response.text[:400]}"
        )

    detail = ''
    if last_retry_status:
        detail = f"; last_status={last_retry_status} retryIn={last_retry_in or '-'} body={last_retry_body}"
    raise RuntimeError(f"Direct keyword retry loop exhausted for {client_login} day={day}{detail}")


def map_keyword_rows_to_details(
    rows: list[list[str]],
    system: dict,
    day: str,
    campaign_meta: dict[str, dict[str, str]],
    run_id: int,
) -> list[dict]:
    client_login = clean_text(system.get('name'))
    detail_rows: list[dict] = []

    for cols in rows:
        if len(cols) < 14:
            continue
        ad_group_id = clean_text(cols[0])
        ad_group_name = clean_text(cols[1])
        campaign_id = clean_text(cols[2])
        campaign_name = clean_text(cols[3])
        criterion_id = clean_text(cols[4])
        criterion_text = clean_text(cols[5])
        criterion_type = clean_text(cols[6])
        if not campaign_id or campaign_id in EXCLUDED_CAMPAIGN_IDS:
            continue
        if not criterion_id or criterion_id == '--':
            criterion_id = 'hash:' + stable_id(client_login, campaign_id, ad_group_id, criterion_text, criterion_type)

        account_id, account_name, used_fallback_account = resolve_account_bridge(campaign_id, campaign_meta)
        resolved_campaign_name = (
            clean_text(campaign_meta.get(campaign_id, {}).get('campaign_name'))
            or campaign_name
            or f'Yandex campaign {campaign_id}'
        )
        raw_payload = {
            'collector': 'yandex_direct_api',
            'report_type': 'CRITERIA_PERFORMANCE_REPORT',
            'client_login': client_login,
            'account_name': account_name,
            'used_fallback_account': used_fallback_account,
            'source_campaign_name': campaign_name,
            'brand': clean_text(campaign_meta.get(campaign_id, {}).get('brand')),
        }

        detail_rows.append(
            {
                'report_date': day,
                'client_login': client_login,
                'account_id': account_id,
                'campaign_id': campaign_id,
                'campaign_name': resolved_campaign_name,
                'ad_group_id': ad_group_id,
                'ad_group_name': ad_group_name,
                'criterion_id': criterion_id,
                'criterion_text': criterion_text,
                'criterion_type': criterion_type,
                'currency_code': 'RUB',
                'impressions': safe_int(cols[7]),
                'clicks': safe_int(cols[8]),
                'conversions': safe_float(cols[9]),
                'ctr': safe_float(cols[10]),
                'cost': safe_float(cols[11]),
                'avg_cpc': safe_float(cols[12]),
                'conversion_rate': safe_float(cols[13]),
                'raw_payload': json_or_none(raw_payload),
                'ingestion_run_id': run_id,
            }
        )

    return detail_rows


def parse_json_payload(value: Any) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def fetch_approved_mutations(args) -> list[dict]:
    filters = ["status = 'approved'"]
    params: list[Any] = []
    if args.mutation_id:
        filters.append('id = %s')
        params.append(args.mutation_id)
    if clean_text(args.client_login):
        filters.append('client_login = %s')
        params.append(clean_text(args.client_login))
    if clean_text(args.campaign_id):
        filters.append('campaign_id = %s')
        params.append(clean_text(args.campaign_id))
    limit = max(min(int(args.limit or 10), 100), 1)
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor(dictionary=True)
        cur.execute(
            f"""
            SELECT
              id, dashboard_id, client_login, account_id, campaign_id,
              mutation_type, entity_type, entity_id, payload_json, status
            FROM yandex_direct_mutation_log
            WHERE {' AND '.join(filters)}
            ORDER BY reviewed_at ASC, id ASC
            LIMIT {limit}
            """,
            tuple(params),
        )
        return list(cur.fetchall())
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def update_mutation_result(mutation_id: int, status: str, request_payload: dict | None, response_payload: dict | None, error_message: str | None = None) -> None:
    conn = cur = None
    try:
        conn = get_db_connection(MYSQL_DB_STAT)
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE yandex_direct_mutation_log
            SET status = %s,
                request_payload = %s,
                response_payload = %s,
                error_message = %s,
                applied_at = CASE WHEN %s = 'applied' THEN NOW() ELSE applied_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            (
                status,
                json_or_none(request_payload),
                json_or_none(response_payload),
                error_message,
                status,
                mutation_id,
            ),
        )
        conn.commit()
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def build_direct_mutation_request(mutation: dict) -> tuple[str, str, dict]:
    mutation_type = clean_text(mutation.get('mutation_type')).upper()
    campaign_id = safe_int(mutation.get('campaign_id'))
    entity_id = clean_text(mutation.get('entity_id'))
    payload = parse_json_payload(mutation.get('payload_json'))

    if mutation_type in {'SUSPEND_CAMPAIGN', 'RESUME_CAMPAIGN', 'ARCHIVE_CAMPAIGN', 'UNARCHIVE_CAMPAIGN'}:
        if campaign_id <= 0:
            raise RuntimeError(f"Invalid campaign_id for mutation {mutation.get('id')}")
        method_by_type = {
            'SUSPEND_CAMPAIGN': 'suspend',
            'RESUME_CAMPAIGN': 'resume',
            'ARCHIVE_CAMPAIGN': 'archive',
            'UNARCHIVE_CAMPAIGN': 'unarchive',
        }
        return (
            'campaigns',
            method_by_type[mutation_type],
            {'SelectionCriteria': {'Ids': [campaign_id]}},
        )

    if mutation_type == 'SET_KEYWORD_BID':
        keyword_id = safe_int(payload.get('criterion_id') or entity_id)
        bid_units = safe_float(payload.get('bid_units'))
        if keyword_id <= 0:
            raise RuntimeError(f"Invalid criterion_id for mutation {mutation.get('id')}")
        if bid_units <= 0:
            raise RuntimeError(f"Invalid bid_units for mutation {mutation.get('id')}")
        bid_item: dict[str, Any] = {
            'KeywordId': keyword_id,
            'Bid': int(round(bid_units * 1_000_000)),
        }
        if payload.get('context_bid_units') not in (None, ''):
            context_bid_units = safe_float(payload.get('context_bid_units'))
            if context_bid_units > 0:
                bid_item['ContextBid'] = int(round(context_bid_units * 1_000_000))
        return ('bids', 'set', {'Bids': [bid_item]})

    raise RuntimeError(f"Unsupported Yandex Direct mutation_type={mutation_type}")


def command_apply_approved_mutations(args) -> None:
    ensure_control_mutation_tables()
    mutations = fetch_approved_mutations(args)
    if not mutations:
        print('No approved Yandex Direct mutations found for selected filters.')
        return

    systems_by_login = {clean_text(system.get('name')): system for system in fetch_active_systems()}
    applied = 0
    failed = 0
    for mutation in mutations:
        mutation_id = int(mutation['id'])
        client_login = clean_text(mutation.get('client_login'))
        system = systems_by_login.get(client_login)
        try:
            if not system:
                raise RuntimeError(f"Direct credentials not found for client_login={client_login}")
            service, method, params = build_direct_mutation_request(mutation)
            request_payload = {'service': service, 'method': method, 'params': params}
            if args.dry_run or not args.confirm_apply:
                print(f"DRY_RUN mutation_id={mutation_id} {json.dumps(request_payload, ensure_ascii=False)}")
                continue
            response_payload = request_direct_service(system, service, method, params)
            update_mutation_result(mutation_id, 'applied', request_payload, response_payload)
            applied += 1
            print(f"APPLIED mutation_id={mutation_id} service={service} method={method}")
        except Exception as exc:
            failed += 1
            error_message = str(exc)[:2000]
            update_mutation_result(mutation_id, 'failed', None, None, error_message)
            print(f"FAILED mutation_id={mutation_id}: {error_message}", file=sys.stderr)

    if args.dry_run or not args.confirm_apply:
        print(f"Dry-run completed for {len(mutations)} approved mutation(s). Use --confirm-apply for live changes.")
    else:
        print(f"Apply completed: applied={applied} failed={failed}")
        if failed:
            raise RuntimeError(f"{failed} Yandex Direct mutation(s) failed")


def map_rows_to_facts(rows: list[list[str]], system: dict, day: str, campaign_meta: dict[str, dict[str, str]]) -> list[dict]:
    client_login = clean_text(system.get('name'))
    media = int(system.get('media') or 0)

    facts: list[dict] = []
    for cols in rows:
        if media == 1:
            if len(cols) < 11 or cols[0] in ('--', '') or cols[1] in ('--', ''):
                continue
            ad_id, ad_group_id, ad_group_name = cols[0], cols[1], cols[2]
            campaign_id, campaign_name = cols[3], cols[4]
            impressions = safe_int(cols[5])
            clicks = safe_int(cols[7])
            conversions = safe_int(cols[8])
            cost = safe_float(cols[10])
        elif media == 2:
            # Market-style summaries have no ad-level grain; skip in canonical ad facts v1.
            continue
        else:
            if len(cols) < 12 or cols[0] in ('--', '') or cols[1] in ('--', ''):
                continue
            ad_id, ad_group_id, ad_group_name = cols[0], cols[1], cols[2]
            campaign_id, campaign_name = cols[3], cols[4]
            impressions = safe_int(cols[5])
            clicks = safe_int(cols[6])
            conversions = safe_int(cols[7])
            cost = safe_float(cols[9])

        campaign_id = clean_text(campaign_id)
        if not campaign_id or campaign_id in EXCLUDED_CAMPAIGN_IDS:
            continue

        account_id, account_name, used_fallback_account = resolve_account_bridge(campaign_id, campaign_meta)
        resolved_campaign_name = (
            clean_text(campaign_meta.get(campaign_id, {}).get('campaign_name'))
            or clean_text(campaign_name)
            or f'Yandex campaign {campaign_id}'
        )

        facts.append(
            {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'fact_scope': 'delivery_entity',
                'native_grain': 'ad',
                'breakdown_scope': 'default',
                'platform_delivery_entity_id': clean_text(ad_id),
                'platform_creative_id': clean_text(ad_id),
                'report_date': day,
                'spend': cost,
                'impressions': impressions,
                'clicks': clicks,
                'views': None,
                'conversions': conversions,
                'reach': None,
                'frequency': None,
                'ctr': None,
                'cpm': None,
                'cpc': None,
                'cpv': None,
                'cpa': None,
                'video_views_25': None,
                'video_views_50': None,
                'video_views_75': None,
                'video_views_100': None,
                'link_clicks': None,
                'likes': None,
                'comments': None,
                'shares': None,
                'reactions': None,
                'follows': None,
                'currency_code': 'RUB',
                'ad_group_id': clean_text(ad_group_id),
                'ad_group_name': clean_text(ad_group_name),
                'campaign_name': resolved_campaign_name,
                'account_name': account_name,
                'client_login': client_login,
                'used_fallback_account': used_fallback_account,
                'brand': clean_text(campaign_meta.get(campaign_id, {}).get('brand')),
            }
        )

    return facts


def build_payload(facts: list[dict], run_id: int) -> dict:
    account_rows: dict[tuple[str, str], dict] = {}
    campaign_rows: dict[tuple[str, str, str], dict] = {}
    delivery_rows: dict[tuple[str, str, str], dict] = {}
    creative_rows: dict[tuple[str, str, str], dict] = {}
    fact_rows: dict[tuple[str, str, str, str], dict] = {}

    for item in facts:
        account_id = item['platform_account_id']
        campaign_id = item['platform_campaign_id']
        ad_id = item['platform_delivery_entity_id']

        account_key = (SOURCE_KEY, account_id)
        account_rows[account_key] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'external_account_ref': account_id if not item.get('used_fallback_account') else None,
            'account_name': item['account_name'],
            'advertiser_name': item['account_name'],
            'account_status': 'ACTIVE',
            'currency_code': 'RUB',
            'timezone_name': 'Europe/Moscow',
            'first_seen_at': None,
            'last_seen_at': None,
            'raw_payload': {
                'collector': 'yandex_direct_api',
                'client_login': item['client_login'],
                'bridge_mode': 'brand' if not item.get('used_fallback_account') else 'campaign_fallback',
                'brand': item.get('brand'),
            },
        }

        campaign_key = (SOURCE_KEY, account_id, campaign_id)
        if campaign_key not in campaign_rows:
            campaign_rows[campaign_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'campaign_name': item['campaign_name'],
                'campaign_status': 'ACTIVE',
                'objective': None,
                'buy_type': None,
                'start_date': None,
                'end_date': None,
                'daily_budget': None,
                'total_budget': None,
                'currency_code': 'RUB',
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': {
                    'collector': 'yandex_direct_api',
                    'client_login': item['client_login'],
                    'brand': item.get('brand'),
                },
            }

        entity_key = (SOURCE_KEY, account_id, ad_id)
        if entity_key not in delivery_rows:
            raw_payload = {
                'ad_group_id': item['ad_group_id'],
                'ad_group_name': item['ad_group_name'],
                'collector': 'yandex_direct_api',
                'client_login': item['client_login'],
            }
            delivery_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'delivery_entity_type': 'ad',
                'platform_delivery_entity_id': ad_id,
                'parent_delivery_entity_id': item['ad_group_id'] or None,
                'delivery_entity_name': item['ad_group_name'] or f'Yandex ad {ad_id}',
                'delivery_status': 'unknown',
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': raw_payload,
            }
            creative_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'platform_delivery_entity_id': ad_id,
                'platform_creative_id': ad_id,
                'creative_name': item['ad_group_name'] or f'Yandex ad {ad_id}',
                'creative_status': 'unknown',
                'creative_type': 'ad',
                'creative_format': None,
                'destination_url': None,
                'final_url': None,
                'content_ref': None,
                'preview_url': None,
                'post_id': None,
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': raw_payload,
            }

        fact_key = (item['report_date'], account_id, campaign_id, ad_id)
        existing = fact_rows.get(fact_key)
        if not existing:
            row = dict(item)
            row['ingestion_run_id'] = run_id
            for transient in (
                'ad_group_id',
                'ad_group_name',
                'campaign_name',
                'account_name',
                'client_login',
                'used_fallback_account',
                'brand',
            ):
                row.pop(transient, None)
            fact_rows[fact_key] = row
        else:
            existing['spend'] += item['spend']
            existing['impressions'] += item['impressions']
            existing['clicks'] += item['clicks']
            existing['conversions'] += item['conversions']

    return {
        'account_rows': list(account_rows.values()),
        'campaign_rows': list(campaign_rows.values()),
        'delivery_rows': list(delivery_rows.values()),
        'creative_rows': list(creative_rows.values()),
        'fact_rows': list(fact_rows.values()),
    }


def daterange(date_from: str, date_to: str):
    start = datetime.strptime(date_from, '%Y-%m-%d').date()
    end = datetime.strptime(date_to, '%Y-%m-%d').date()
    current = start
    while current <= end:
        yield current.strftime('%Y-%m-%d')
        current += timedelta(days=1)


def build_partial_error_summary(failed_system_days: list[dict[str, str]], missing_critical_account_days: list[dict[str, str]]) -> str:
    parts: list[str] = []
    if failed_system_days:
        parts.append(f'failed_system_days={len(failed_system_days)}')
    if missing_critical_account_days:
        parts.append(f'missing_critical_account_days={len(missing_critical_account_days)}')
    sample_bits: list[str] = []
    for item in failed_system_days[:2]:
        sample_bits.append(f"{item['client_login']}:{item['day']}:failed")
    for item in missing_critical_account_days[:2]:
        sample_bits.append(f"{item['client_login']}:{item['day']}:no_facts")
    if sample_bits:
        parts.append('sample=' + ','.join(sample_bits))
    return '; '.join(parts)[:500]


def main():
    args = parse_args()
    if args.command == 'apply-approved-mutations':
        command_apply_approved_mutations(args)
        return

    date_from, date_to = date_range(args)
    correlation_id = str(uuid.uuid4())
    validate_primary_collector_config()
    run_id = start_collector_run(
        source_key=SOURCE_KEY,
        run_type=args.run_type,
        run_mode='canonical_api_first',
        job_key=f'{SOURCE_KEY}:api:{date_from}:{date_to}',
        correlation_id=correlation_id,
        date_from=date_from,
        date_to=date_to,
    )

    rows_read = 0
    rows_written = 0
    rows_updated = 0

    try:
        collect_campaign_ids = selected_campaign_ids(args)
        collect_campaign_id_set = set(collect_campaign_ids)
        collect_client_login = clean_text(getattr(args, 'client_login', ''))
        collect_keyword_performance = not args.skip_keyword_performance and bool(collect_campaign_ids)
        if args.keywords_only and not collect_keyword_performance:
            raise RuntimeError('--keywords-only requires --campaign-id or --campaign-ids')
        if collect_keyword_performance:
            ensure_keyword_performance_table()
        campaign_meta = fetch_campaign_meta()
        systems = fetch_active_systems()
        if collect_client_login:
            systems = [system for system in systems if clean_text(system.get('name')) == collect_client_login]
        if not systems:
            raise RuntimeError(f'No active Direct systems matched client_login={collect_client_login or "*"}')
        all_facts: list[dict] = []
        all_keyword_rows: list[dict] = []
        skipped_media2 = 0
        active_client_logins = {clean_text(system.get('name')) for system in systems}
        requested_days = list(daterange(date_from, date_to))
        fact_counts_by_system_day: dict[tuple[str, str], int] = {}

        failed_system_days: list[dict[str, str]] = []
        failed_keyword_system_days: list[dict[str, str]] = []
        for system in systems:
            media = int(system.get('media') or 0)
            if media == 2:
                skipped_media2 += 1
            for day in daterange(date_from, date_to):
                client_login = clean_text(system.get('name'))
                if not args.keywords_only:
                    try:
                        report_rows = request_direct_report(system, day, collect_campaign_ids)
                        mapped = map_rows_to_facts(report_rows, system, day, campaign_meta)
                        if collect_campaign_id_set:
                            mapped = [row for row in mapped if clean_text(row.get('platform_campaign_id')) in collect_campaign_id_set]
                        rows_read += len(report_rows)
                        all_facts.extend(mapped)
                        fact_counts_by_system_day[(client_login, day)] = len(mapped)
                    except Exception as exc:
                        failed_system_days.append(
                            {
                                'system_id': str(system.get('id')),
                                'client_login': client_login,
                                'day': day,
                                'error': str(exc)[:500],
                            }
                        )
                        log_run_event(
                            run_id,
                            'ERROR',
                            'system_day_failed',
                            'Direct API request failed for system/day',
                            failed_system_days[-1],
                        )
                        continue
                if collect_keyword_performance:
                    try:
                        keyword_report_rows = request_keyword_performance_report(system, day, collect_campaign_ids)
                        keyword_rows = map_keyword_rows_to_details(keyword_report_rows, system, day, campaign_meta, run_id)
                        if collect_campaign_id_set:
                            keyword_rows = [row for row in keyword_rows if clean_text(row.get('campaign_id')) in collect_campaign_id_set]
                        rows_read += len(keyword_report_rows)
                        all_keyword_rows.extend(keyword_rows)
                    except Exception as exc:
                        failed_keyword_system_days.append(
                            {
                                'system_id': str(system.get('id')),
                                'client_login': client_login,
                                'day': day,
                                'error': str(exc)[:500],
                            }
                        )
                        log_run_event(
                            run_id,
                            'WARNING',
                            'keyword_system_day_failed',
                            'Direct API keyword report failed for system/day',
                            failed_keyword_system_days[-1],
                        )

        if not args.keywords_only and not all_facts:
            raise RuntimeError(f'No ad-level Direct rows from API for {date_from}..{date_to}')
        if args.keywords_only and collect_keyword_performance and not all_keyword_rows:
            raise RuntimeError(f'No keyword Direct rows from API for {date_from}..{date_to}')

        critical_account_set = set(CRITICAL_ACCOUNTS)
        checkpoint_account_set = set(CHECKPOINT_ACCOUNTS)
        missing_critical_account_days: list[dict[str, str]] = []
        checkpoint_account_day_results: list[dict[str, Any]] = []
        if not args.keywords_only:
            for client_login in sorted(critical_account_set - active_client_logins):
                missing_critical_account_days.append(
                    {
                        'client_login': client_login,
                        'day': '*',
                        'reason': 'critical account is not active in req_system',
                        'failed_request': False,
                    }
                )
            for client_login in sorted(active_client_logins & checkpoint_account_set):
                for day in requested_days:
                    fact_count = fact_counts_by_system_day.get((client_login, day), 0)
                    failed = any(item['client_login'] == client_login and item['day'] == day for item in failed_system_days)
                    checkpoint_account_day_results.append(
                        {
                            'client_login': client_login,
                            'day': day,
                            'fact_count': fact_count,
                            'failed': failed,
                            'is_critical': client_login in critical_account_set,
                        }
                    )
                    if client_login in critical_account_set and fact_count == 0:
                        missing_critical_account_days.append(
                            {
                                'client_login': client_login,
                                'day': day,
                                'reason': 'api collector produced zero filtered facts for critical account/day',
                                'failed_request': failed,
                            }
                        )

        if missing_critical_account_days:
            log_run_event(
                run_id,
                'ERROR',
                'critical_account_day_missing',
                'Critical Yandex Direct account/day is missing in API collector output',
                {
                    'critical_accounts': list(CRITICAL_ACCOUNTS),
                    'missing_critical_account_days': missing_critical_account_days[:20],
                },
            )

        payload = build_payload(all_facts, run_id)

        rows_written += upsert_source_accounts(payload['account_rows'])
        rows_written += upsert_source_campaigns(payload['campaign_rows'])
        rows_written += upsert_delivery_entities(payload['delivery_rows'])
        rows_written += upsert_creatives(payload['creative_rows'])
        rows_written += upsert_fact_ads_daily(payload['fact_rows'])
        keyword_rows_written = upsert_keyword_performance_rows(all_keyword_rows) if collect_keyword_performance else 0
        rows_written += keyword_rows_written
        rows_updated = rows_written
        final_status = 'success'
        if failed_system_days or missing_critical_account_days or failed_keyword_system_days:
            final_status = 'partial'
        error_count = len(failed_system_days) + len(missing_critical_account_days) + len(failed_keyword_system_days)
        error_summary = (
            build_partial_error_summary(failed_system_days, missing_critical_account_days)
            if final_status != 'success'
            else None
        )
        if final_status != 'success' and failed_keyword_system_days:
            keyword_summary = f"keyword_failed_system_days={len(failed_keyword_system_days)}"
            error_summary = '; '.join(part for part in [error_summary, keyword_summary] if part)[:500]

        log_run_event(
            run_id,
            'INFO',
            'collector_summary',
            'Yandex Direct canonical API collector completed',
            {
                'systems': len(systems),
                'skipped_media2_systems': skipped_media2,
                'raw_rows': rows_read,
                'facts': len(payload['fact_rows']),
                'accounts': len(payload['account_rows']),
                'campaigns': len(payload['campaign_rows']),
                'delivery_entities': len(payload['delivery_rows']),
                'creatives': len(payload['creative_rows']),
                'keyword_performance_rows': len(all_keyword_rows),
                'keyword_rows_written': keyword_rows_written,
                'keyword_performance_skipped': not collect_keyword_performance,
                'keywords_only': args.keywords_only,
                'direct_url': DIRECT_URL,
                'primary_collector': PRIMARY_COLLECTOR,
                'client_login_filter': collect_client_login,
                'campaign_ids_filter': collect_campaign_ids,
                'critical_accounts': list(CRITICAL_ACCOUNTS),
                'checkpoint_accounts': list(CHECKPOINT_ACCOUNTS),
                'failed_system_days': len(failed_system_days),
                'failed_system_day_sample': failed_system_days[:10],
                'failed_keyword_system_days': len(failed_keyword_system_days),
                'failed_keyword_system_day_sample': failed_keyword_system_days[:10],
                'missing_critical_account_days': len(missing_critical_account_days),
                'missing_critical_account_day_sample': missing_critical_account_days[:10],
                'checkpoint_account_day_results': checkpoint_account_day_results[:30],
                'final_status': final_status,
            },
        )
        finish_collector_run(run_id, final_status, rows_read, rows_written, rows_updated, error_count, error_summary)
    except Exception as exc:
        log_run_event(
            run_id,
            'ERROR',
            'collector_failed',
            'Yandex Direct canonical API collector failed',
            {'error': str(exc)},
        )
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_updated, 1, str(exc))
        raise


if __name__ == '__main__':
    main()
