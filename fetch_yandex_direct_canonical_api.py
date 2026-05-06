#!/usr/bin/env python3
"""Yandex Direct API -> canonical_* tables."""

from __future__ import annotations

import argparse
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

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('yandex_direct_canonical_api')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date-from', default='')
    parser.add_argument('--date-to', default='')
    parser.add_argument('--days-back', type=int, default=14)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
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


def request_direct_report(system: dict, day: str) -> list[list[str]]:
    token = clean_text(system.get('access'))
    client_login = clean_text(system.get('name'))
    if not token or not client_login:
        raise RuntimeError(f"Invalid req_system credentials: id={system.get('id')}")

    media = int(system.get('media') or 0)
    fields, report_type = fields_and_report_type(media)
    body = {
        'params': {
            'SelectionCriteria': {'DateFrom': day, 'DateTo': day},
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
        campaign_meta = fetch_campaign_meta()
        systems = fetch_active_systems()
        all_facts: list[dict] = []
        skipped_media2 = 0
        active_client_logins = {clean_text(system.get('name')) for system in systems}
        requested_days = list(daterange(date_from, date_to))
        fact_counts_by_system_day: dict[tuple[str, str], int] = {}

        failed_system_days: list[dict[str, str]] = []
        for system in systems:
            media = int(system.get('media') or 0)
            if media == 2:
                skipped_media2 += 1
            for day in daterange(date_from, date_to):
                client_login = clean_text(system.get('name'))
                try:
                    report_rows = request_direct_report(system, day)
                    mapped = map_rows_to_facts(report_rows, system, day, campaign_meta)
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

        if not all_facts:
            raise RuntimeError(f'No ad-level Direct rows from API for {date_from}..{date_to}')

        critical_account_set = set(CRITICAL_ACCOUNTS)
        checkpoint_account_set = set(CHECKPOINT_ACCOUNTS)
        missing_critical_account_days: list[dict[str, str]] = []
        checkpoint_account_day_results: list[dict[str, Any]] = []
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
        rows_updated = rows_written
        final_status = 'success'
        if failed_system_days or missing_critical_account_days:
            final_status = 'partial'
        error_count = len(failed_system_days) + len(missing_critical_account_days)
        error_summary = (
            build_partial_error_summary(failed_system_days, missing_critical_account_days)
            if final_status != 'success'
            else None
        )

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
                'direct_url': DIRECT_URL,
                'primary_collector': PRIMARY_COLLECTOR,
                'critical_accounts': list(CRITICAL_ACCOUNTS),
                'checkpoint_accounts': list(CHECKPOINT_ACCOUNTS),
                'failed_system_days': len(failed_system_days),
                'failed_system_day_sample': failed_system_days[:10],
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
