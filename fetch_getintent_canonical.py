#!/usr/bin/env python3
"""GetIntent -> canonical_* tables only."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import uuid
from collections import OrderedDict
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


SOURCE_KEY = 'getintent'
MAX_RETRIES = 5
TIMEOUT = 90

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB_STAT = env_first('MYSQL_DB_STAT', default='report_bd')
MYSQL_DB_TECH = env_first('MYSQL_DB', 'MYSQL_DB_TECH', default='report_bd_tech')

GETINTENT_URL = env_first('GETINTENT_REPORTING_URL', default='https://reporting.getintent.com/api/v2/reports')

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('getintent_canonical')


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


def daterange(date_from: str, date_to: str):
    start = datetime.strptime(date_from, '%Y-%m-%d').date()
    end = datetime.strptime(date_to, '%Y-%m-%d').date()
    current = start
    while current <= end:
        yield current.strftime('%Y-%m-%d')
        current += timedelta(days=1)


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


def fetch_active_systems() -> list[dict]:
    last_error = None
    for database in OrderedDict.fromkeys([MYSQL_DB_TECH, 'report_bd_tech']):
        conn = cur = None
        try:
            conn = get_db_connection(database)
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT system_id, name, active
                FROM git_system
                WHERE active = 1
                ORDER BY system_id
                """
            )
            return cur.fetchall()
        except mysql.connector.Error as exc:
            last_error = exc
        finally:
            if cur:
                cur.close()
            if conn:
                conn.close()
    raise last_error


def fetch_legacy_name_maps() -> dict[str, dict[str, str]]:
    maps = {
        'campaigns': {},
        'groups': {},
        'creatives': {},
    }
    last_error = None
    for database in OrderedDict.fromkeys([MYSQL_DB_STAT, 'report_bd']):
        conn = cur = None
        try:
            conn = get_db_connection(database)
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT campaign_id, name FROM git_name")
            for row in cur.fetchall():
                maps['campaigns'][str(row['campaign_id'])] = (row.get('name') or '').strip()
            cur.execute("SELECT advertiser_id, name FROM git_group_campaign")
            for row in cur.fetchall():
                maps['groups'][str(row['advertiser_id'])] = (row.get('name') or '').strip()
            cur.execute("SELECT creative_id, name FROM git_creative")
            for row in cur.fetchall():
                maps['creatives'][str(row['creative_id'])] = (row.get('name') or '').strip()
            return maps
        except mysql.connector.Error as exc:
            last_error = exc
        finally:
            if cur:
                cur.close()
            if conn:
                conn.close()
    raise last_error


def active_tokens() -> list[str]:
    tokens = []
    for key in ('GETINTENT_TOKEN', 'GETINTENT_SECOND_TOKEN'):
        value = env_first(key)
        if value:
            tokens.append(value)
    if not tokens:
        raise RuntimeError('GetIntent tokens are missing from env')
    return tokens


def request_with_retry(url: str, payload: dict) -> dict:
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.post(url, json=payload, timeout=TIMEOUT)
        if resp.status_code != 429:
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get('error'):
                raise RuntimeError(str(data))
            return data
        if attempt == MAX_RETRIES:
            resp.raise_for_status()
        time.sleep(sleep_for)
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError('GetIntent API retry loop exhausted')


def fetch_report(token: str, day: str) -> dict:
    url = (
        f'{GETINTENT_URL}?total_row=1&total_row_exact=1&lang=ru&format=json'
        f'&dataset_name=browser_traffic&start={day}&end={day}'
        f'&timezone=Europe%2FMoscow&relations=1'
        f'&keys=day%2Ccampaign_id%2Ccampaign_group_id%2Ccreative_id%2Cadvertiser_id'
        f'&values=imps%2Cunique_imps%2Cclicks%2Cctr%2Cview_rate%2Cvideo_completion_25%2Cvideo_completion_50%2Cvideo_completion_75%2Cvideo_completion_100%2Ccpm%2Ccpc%2Cbudget'
        f'&token={token}'
    )
    request_payload = {
        'http': {
            'method': 'GET',
            'header': {'Content-Type': 'application/x-www-form-urlencoded'},
            'ignore_errors': False,
        },
        'ssl': {
            'verify_peer': False,
            'verify_peer_name': False,
        },
    }
    return request_with_retry(url, request_payload)


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def safe_int(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def weighted_rate(total_numerator: float, total_denominator: float) -> float | None:
    if total_denominator <= 0:
        return 0.0
    return round((total_numerator / total_denominator) * 100, 6)


def build_canonical_payload(
    systems: list[dict],
    legacy_names: dict[str, dict[str, str]],
    raw_reports: list[dict],
    run_id: int,
) -> dict:
    active_ids = {str(item['system_id']) for item in systems}
    system_map = {str(item['system_id']): item for item in systems}

    advertiser_names: dict[str, str] = {}
    campaign_names: dict[str, str] = dict(legacy_names['campaigns'])
    group_names: dict[str, str] = dict(legacy_names['groups'])
    creative_names: dict[str, str] = dict(legacy_names['creatives'])
    fact_accumulator: dict[tuple[str, str, str, str], dict] = {}

    for report in raw_reports:
        relations = report.get('relations') or {}
        for advertiser_id, item in (relations.get('advertiser_id') or {}).items():
            advertiser_names[str(advertiser_id)] = clean_text(item.get('name'))
        for campaign_id, item in (relations.get('campaign_id') or {}).items():
            campaign_names[str(campaign_id)] = clean_text(item.get('name'))
        for advertiser_group_id, item in (relations.get('campaign_group_id') or {}).items():
            advertiser_id = str(item.get('advertiser_id') or '')
            if advertiser_id:
                group_names[advertiser_id] = clean_text(item.get('name'))
        for creative_id, item in (relations.get('creative_id') or {}).items():
            creative_names[str(creative_id)] = clean_text(item.get('name'))

        for row in report.get('data') or []:
            advertiser_id = clean_text(row[4] if len(row) > 4 else '')
            if advertiser_id not in active_ids:
                continue

            report_date = clean_text(row[0] if len(row) > 0 else '')
            campaign_id = clean_text(row[1] if len(row) > 1 else '')
            campaign_group_id = clean_text(row[2] if len(row) > 2 else '')
            creative_id = clean_text(row[3] if len(row) > 3 else '')
            if not report_date or not campaign_id or not creative_id:
                continue

            impressions = max(safe_int(row[5] if len(row) > 5 else 0), 0)
            unique_imps = max(safe_int(row[6] if len(row) > 6 else 0), 0)
            clicks = max(safe_int(row[7] if len(row) > 7 else 0), 0)
            ctr = max(safe_float(row[8] if len(row) > 8 else 0), 0.0)
            view_rate = max(safe_float(row[9] if len(row) > 9 else 0), 0.0)
            video_25 = max(safe_float(row[10] if len(row) > 10 else 0), 0.0)
            video_50 = max(safe_float(row[11] if len(row) > 11 else 0), 0.0)
            video_75 = max(safe_float(row[12] if len(row) > 12 else 0), 0.0)
            video_100 = max(safe_float(row[13] if len(row) > 13 else 0), 0.0)
            cpm = max(safe_float(row[14] if len(row) > 14 else 0), 0.0)
            cpc = max(safe_float(row[15] if len(row) > 15 else 0), 0.0)
            budget = max(safe_float(row[16] if len(row) > 16 else 0), 0.0)
            spend = budget if budget > 0 else round((impressions * cpm) / 1000, 6) if impressions > 0 and cpm > 0 else 0.0

            fact_key = (report_date, advertiser_id, campaign_id, creative_id)
            existing = fact_accumulator.get(fact_key)
            if not existing:
                fact_accumulator[fact_key] = {
                    'report_date': report_date,
                    'platform_account_id': advertiser_id,
                    'platform_campaign_id': campaign_id,
                    'campaign_group_id': campaign_group_id,
                    'platform_delivery_entity_id': creative_id,
                    'platform_creative_id': creative_id,
                    'spend': spend,
                    'impressions': impressions,
                    'reach': unique_imps,
                    'clicks': clicks,
                    'video_views_25': video_25,
                    'video_views_50': video_50,
                    'video_views_75': video_75,
                    'video_views_100': video_100,
                    'ctr_source_weighted_clicks': clicks,
                    'ctr_source_weighted_impressions': impressions,
                    'view_rate_weighted_sum': view_rate * impressions,
                    'view_rate_weight': impressions,
                    'raw_rows': 1,
                }
            else:
                existing['spend'] += spend
                existing['impressions'] += impressions
                existing['reach'] += unique_imps
                existing['clicks'] += clicks
                existing['video_views_25'] += video_25
                existing['video_views_50'] += video_50
                existing['video_views_75'] += video_75
                existing['video_views_100'] += video_100
                existing['ctr_source_weighted_clicks'] += clicks
                existing['ctr_source_weighted_impressions'] += impressions
                existing['view_rate_weighted_sum'] += view_rate * impressions
                existing['view_rate_weight'] += impressions
                existing['raw_rows'] += 1

    account_rows: dict[tuple[str, str], dict] = {}
    campaign_rows: dict[tuple[str, str, str], dict] = {}
    delivery_rows: dict[tuple[str, str, str], dict] = {}
    creative_rows: dict[tuple[str, str, str], dict] = {}
    fact_rows: list[dict] = []
    fallback_campaigns = 0
    fallback_creatives = 0

    for row in sorted(
        fact_accumulator.values(),
        key=lambda item: (
            item['report_date'],
            item['platform_account_id'],
            item['platform_campaign_id'],
            item['platform_delivery_entity_id'],
        ),
    ):
        advertiser_id = row['platform_account_id']
        campaign_id = row['platform_campaign_id']
        creative_id = row['platform_delivery_entity_id']
        system_row = system_map.get(advertiser_id, {})
        weighted_video_completion_100 = (
            (row['video_views_100'] / row['impressions']) * 100
            if row['impressions'] > 0
            else 0.0
        )
        derived_views = (
            round((row['impressions'] * weighted_video_completion_100) / 100)
            if row['impressions'] > 0
            else 0
        )
        derived_reach = row['reach'] if row['reach'] > 0 else None
        derived_frequency = round(row['impressions'] / row['reach'], 6) if row['reach'] > 0 else None

        account_name = (
            advertiser_names.get(advertiser_id)
            or group_names.get(advertiser_id)
            or clean_text(system_row.get('name'))
            or f'GetIntent advertiser {advertiser_id}'
        )
        campaign_name = campaign_names.get(campaign_id) or f'GetIntent campaign {campaign_id}'
        creative_name = creative_names.get(creative_id) or f'GetIntent creative {creative_id}'

        account_rows[(SOURCE_KEY, advertiser_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': advertiser_id,
            'external_account_ref': advertiser_id,
            'account_name': account_name,
            'advertiser_name': account_name,
            'account_status': 'ACTIVE',
            'currency_code': None,
            'timezone_name': 'Europe/Moscow',
            'first_seen_at': None,
            'last_seen_at': None,
            'raw_payload': {
                'system_name': system_row.get('name'),
                'campaign_group_name': group_names.get(advertiser_id),
            },
        }

        campaign_key = (SOURCE_KEY, advertiser_id, campaign_id)
        if campaign_key not in campaign_rows:
            if campaign_id not in campaign_names:
                fallback_campaigns += 1
            campaign_rows[campaign_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': campaign_id,
                'campaign_name': campaign_name,
                'campaign_status': 'ACTIVE',
                'objective': None,
                'buy_type': None,
                'start_date': None,
                'end_date': None,
                'daily_budget': None,
                'total_budget': None,
                'currency_code': None,
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': {
                    'campaign_group_id': row['campaign_group_id'],
                    'campaign_group_name': group_names.get(advertiser_id),
                },
            }

        entity_key = (SOURCE_KEY, advertiser_id, creative_id)
        if entity_key not in delivery_rows:
            if creative_id not in creative_names:
                fallback_creatives += 1
            raw_payload = {
                'campaign_group_id': row['campaign_group_id'],
                'campaign_group_name': group_names.get(advertiser_id),
            }
            delivery_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': campaign_id,
                'delivery_entity_type': 'other',
                'platform_delivery_entity_id': creative_id,
                'parent_delivery_entity_id': None,
                'delivery_entity_name': creative_name,
                'delivery_status': 'unknown',
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': raw_payload,
            }
            creative_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': campaign_id,
                'platform_delivery_entity_id': creative_id,
                'platform_creative_id': creative_id,
                'creative_name': creative_name,
                'creative_status': 'unknown',
                'creative_type': 'creative',
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

        fact_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': advertiser_id,
            'platform_campaign_id': campaign_id,
            'fact_scope': 'delivery_entity',
            'native_grain': 'creative',
            'breakdown_scope': 'default',
            'platform_delivery_entity_id': creative_id,
            'platform_creative_id': creative_id,
            'report_date': row['report_date'],
            'spend': round(row['spend'], 6),
            'impressions': row['impressions'],
            'clicks': row['clicks'],
            'views': derived_views,
            'conversions': None,
            'reach': derived_reach,
            'frequency': derived_frequency,
            'ctr': weighted_rate(row['ctr_source_weighted_clicks'], row['ctr_source_weighted_impressions']),
            'cpm': round((row['spend'] / row['impressions']) * 1000, 6) if row['impressions'] > 0 else None,
            'cpc': round(row['spend'] / row['clicks'], 6) if row['clicks'] > 0 else None,
            'cpv': None,
            'cpa': None,
            'video_views_25': row['video_views_25'],
            'video_views_50': row['video_views_50'],
            'video_views_75': row['video_views_75'],
            'video_views_100': row['video_views_100'],
            'link_clicks': None,
            'likes': None,
            'comments': None,
            'shares': None,
            'reactions': None,
            'follows': None,
            'currency_code': None,
            'ingestion_run_id': run_id,
        })

    return {
        'account_rows': list(account_rows.values()),
        'campaign_rows': list(campaign_rows.values()),
        'delivery_rows': list(delivery_rows.values()),
        'creative_rows': list(creative_rows.values()),
        'fact_rows': fact_rows,
        'fallback_campaigns': fallback_campaigns,
        'fallback_creatives': fallback_creatives,
        'aggregated_rows': len(fact_accumulator),
    }


def main():
    args = parse_args()
    date_from, date_to = date_range(args)
    correlation_id = str(uuid.uuid4())
    run_id = start_collector_run(
        source_key=SOURCE_KEY,
        run_type=args.run_type,
        run_mode='canonical_only',
        job_key=f'{SOURCE_KEY}:{date_from}:{date_to}',
        correlation_id=correlation_id,
        date_from=date_from,
        date_to=date_to,
    )

    rows_read = 0
    rows_written = 0
    rows_updated = 0
    errors = 0

    try:
        systems = fetch_active_systems()
        legacy_names = fetch_legacy_name_maps()
        tokens = active_tokens()

        raw_reports = []
        api_rows = 0
        for day in daterange(date_from, date_to):
            for token in tokens:
                report = fetch_report(token, day)
                day_rows = len(report.get('data') or [])
                api_rows += day_rows
                rows_read += day_rows
                raw_reports.append(report)
                time.sleep(0.2)

        payload = build_canonical_payload(systems, legacy_names, raw_reports, run_id)

        rows_written += upsert_source_accounts(payload['account_rows'])
        rows_written += upsert_source_campaigns(payload['campaign_rows'])
        rows_written += upsert_delivery_entities(payload['delivery_rows'])
        rows_written += upsert_creatives(payload['creative_rows'])
        rows_written += upsert_fact_ads_daily(payload['fact_rows'])
        rows_updated = rows_written

        log_run_event(
            run_id,
            'INFO',
            'collector_summary',
            'GetIntent canonical collector completed',
            {
                'systems': len(systems),
                'tokens': len(tokens),
                'api_rows': api_rows,
                'accounts': len(payload['account_rows']),
                'campaigns': len(payload['campaign_rows']),
                'delivery_entities': len(payload['delivery_rows']),
                'creatives': len(payload['creative_rows']),
                'facts': len(payload['fact_rows']),
                'fallback_campaigns': payload['fallback_campaigns'],
                'fallback_creatives': payload['fallback_creatives'],
                'aggregated_rows': payload['aggregated_rows'],
                'views_mapping': 'impressions*video_completion_100/100',
                'reach_mapping': 'unique_imps->reach',
                'frequency_mapping': 'impressions/reach',
                'view_rate_storage': 'requested from API but not materialized in canonical_fact_ads_daily v1',
            },
        )

        finish_collector_run(run_id, 'success', rows_read, rows_written, rows_updated, 0, None)
    except Exception as exc:
        errors += 1
        log_run_event(run_id, 'ERROR', 'collector_failed', 'GetIntent canonical collector failed', {'error': str(exc)})
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_updated, errors, str(exc))
        raise


if __name__ == '__main__':
    main()
