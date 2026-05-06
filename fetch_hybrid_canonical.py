#!/usr/bin/env python3
"""Hybrid -> canonical_* tables only."""

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
    get_db_connection,
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


SOURCE_KEY = 'hybrid'
TIMEOUT = 90
MAX_RETRIES = 5
LEOVIT_OLV_VIEWS_IMPRESSIONS_START_DATE = '2026-04-15'
LEOVIT_OLV_ACCOUNT_IDS = {'69805fd070e7b248c48383aa', '698061f2810d981524e5d985'}

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB_TECH = env_first('MYSQL_DB_STAT', 'MYSQL_DB_TECH', default='report_bd_tech')

HYBRID_TOKEN_URL = env_first('HYBRID_TOKEN_URL', default='https://api.hybrid.ru/token')
HYBRID_ADVERTISERS_URL = env_first('HYBRID_ADVERTISERS_URL', default='https://api.hybrid.ru/v3.0/agency/advertisers')
HYBRID_CAMPAIGNS_URL = env_first('HYBRID_CAMPAIGNS_URL', default='https://api.hybrid.ru/v3.0/advertiser/BannerName')
HYBRID_STATS_MODE = env_first('HYBRID_STATS_MODE', default='legacy_bannername')
HYBRID_MULTISPLIT_URL = env_first('HYBRID_MULTISPLIT_URL', default='https://console.hybrid.ru/core/agencyStatistic/GetMultiSplit')
HYBRID_CONSOLE_COOKIE = env_first('HYBRID_CONSOLE_COOKIE')
HYBRID_CONSOLE_ORIGIN = env_first('HYBRID_CONSOLE_ORIGIN', default='https://console.hybrid.ru')
HYBRID_CONSOLE_REFERER = env_first('HYBRID_CONSOLE_REFERER', default='https://console.hybrid.ru/')
HYBRID_MULTISPLIT_LIMIT = int(env_first('HYBRID_MULTISPLIT_LIMIT', default='1000'))
HYBRID_MULTISPLIT_TZ_ID = int(env_first('HYBRID_MULTISPLIT_TZ_ID', default='305'))
HYBRID_ADVERTISER_FILTER_ID = env_first('HYBRID_ADVERTISER_FILTER_ID', default='5')

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('hybrid_canonical')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date-from', default='')
    parser.add_argument('--date-to', default='')
    parser.add_argument('--days-back', type=int, default=14)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
    return parser.parse_args()


def _date_range(args) -> tuple[str, str]:
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


def get_tech_db_connection(database: str | None = None):
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=database or MYSQL_DB_TECH,
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
            conn = get_tech_db_connection(database)
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT advertiser_id, name, active, account
                FROM hyb_systems
                WHERE active = 1
                ORDER BY advertiser_id
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


def build_account_clients() -> dict[int, dict[str, str]]:
    clients = {
        1: {
            'refresh': env_first('HYBRID_REFRESH'),
            'client': env_first('HYBRID_CLIENT'),
            'secret': env_first('HYBRID_SECRET'),
        },
        2: {
            'refresh': env_first('HYBRID_SECOND_REFRESH'),
            'client': env_first('HYBRID_SECOND_CLIENT'),
            'secret': env_first('HYBRID_SECOND_SECRET'),
        },
    }
    return {key: value for key, value in clients.items() if value['refresh'] and value['client'] and value['secret']}


def request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.request(method, url, timeout=TIMEOUT, **kwargs)
        if resp.status_code != 429:
            resp.raise_for_status()
            return resp
        if attempt == MAX_RETRIES:
            resp.raise_for_status()
        time.sleep(sleep_for)
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f'Retry loop exhausted for {url}')


def get_token(client: dict[str, str]) -> str:
    payload = {
        'refresh_token': client['refresh'],
        'grant_type': 'client_credentials',
        'client_id': client['client'],
        'client_secret': client['secret'],
    }
    resp = request_with_retry(
        'POST',
        HYBRID_TOKEN_URL,
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    data = resp.json()
    token = data.get('access_token')
    if not token:
        raise RuntimeError(f'Hybrid token response has no access_token: {data}')
    return token


def get_headers(token: str) -> dict[str, str]:
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': f'Bearer {token}',
        'Content-Length': '0',
    }


def fetch_advertisers(token: str) -> list[dict]:
    resp = request_with_retry('GET', HYBRID_ADVERTISERS_URL, headers=get_headers(token))
    data = resp.json()
    if isinstance(data, list):
        return data
    return []


def fetch_campaign_stats(token: str, advertiser_id: str, day: str) -> list[dict]:
    resp = request_with_retry(
        'GET',
        HYBRID_CAMPAIGNS_URL,
        headers=get_headers(token),
        params={
            'from': day,
            'to': day,
            'advertiserId': advertiser_id,
            'limit': '1000',
        },
    )
    data = resp.json()
    stats = data.get('Statistic') if isinstance(data, dict) else None
    return stats or []


def get_console_headers() -> dict[str, str]:
    if not HYBRID_CONSOLE_COOKIE:
        raise RuntimeError('HYBRID_CONSOLE_COOKIE is required when HYBRID_STATS_MODE=console_multisplit')
    return {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json',
        'Origin': HYBRID_CONSOLE_ORIGIN,
        'Referer': HYBRID_CONSOLE_REFERER,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': HYBRID_CONSOLE_COOKIE,
    }


def fetch_multisplit_banner_stats(advertiser_id: str, day: str) -> list[dict]:
    payload = {
        'startDate': f'{day}T00:00:00',
        'endDate': f'{day}T23:59:59',
        'sortField': 2,
        'sortByDynamicField': None,
        'sortDirection': 0,
        'page': 0,
        'limit': HYBRID_MULTISPLIT_LIMIT,
        'replaceEmptySplit': None,
        'filters': {HYBRID_ADVERTISER_FILTER_ID: [advertiser_id]},
        'fieldsComparsionFilters': {'numComparsionFilters': [], 'numRangeFilters': []},
        'timeZoneId': HYBRID_MULTISPLIT_TZ_ID,
        'conversionFields': [],
        'conversionSortField': {},
        'splits': [3],
        'limitByRowSelect': None,
        'limitBySplits': None,
        'dynamicFields': [],
        'metricIds': [],
        'sortByMetric': None,
        'fields': [2, 4, 43, 57, 59, 60, 77],
    }
    resp = request_with_retry(
        'POST',
        HYBRID_MULTISPLIT_URL,
        headers=get_console_headers(),
        json=payload,
    )
    data = resp.json()
    items = data.get('items') if isinstance(data, dict) else None
    return items or []


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def optional_int(raw_item: dict, *keys: str) -> int | None:
    for key in keys:
        if key in raw_item:
            return safe_int(raw_item.get(key))
    return None


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def safe_float(value: Any) -> float | None:
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def optional_float(raw_item: dict, *keys: str) -> float | None:
    for key in keys:
        if key in raw_item:
            return safe_float(raw_item.get(key))
    return None


def derive_campaign_name(raw_item: dict, fallback_name: str) -> str:
    split_name = clean_text(raw_item.get('SplitName'))
    if split_name:
        return split_name
    banner_name = clean_text(raw_item.get('BannerName')) or fallback_name
    if ' / ' in banner_name:
        return banner_name.split(' / ', 1)[0].strip()
    return fallback_name


def parse_banner_parts(raw_item: dict, advertiser_id: str) -> tuple[str, str, str]:
    banner_name = clean_text(raw_item.get('BannerName'))
    banner_id = clean_text(raw_item.get('BannerId'))
    split_name = clean_text(raw_item.get('SplitName'))

    parts = [part.strip() for part in banner_name.split(';')] if banner_name else []
    display_name = parts[0] if parts and parts[0] else split_name or f'Hybrid creative {banner_id}'
    folder_id = parts[1] if len(parts) > 1 and parts[1] else ''
    creative_id = parts[2] if len(parts) > 2 and parts[2] else ''

    if not folder_id:
        folder_id = f"split::{split_name}" if split_name else f"unknown_folder::{advertiser_id}::{banner_id or display_name}"
    if not creative_id:
        creative_id = banner_id or f"unknown_creative::{advertiser_id}::{display_name}"

    return display_name, folder_id, creative_id


def normalize_metric_row(raw_item: dict) -> dict:
    impressions = max(safe_int(raw_item.get('ImpressionCount') or raw_item.get('impressionCount')), 0)
    clicks = max(safe_int(raw_item.get('ClickCount') or raw_item.get('clickCount')), 0)
    views_raw = optional_int(raw_item, 'completeEventsCount', 'ViewCount', 'viewCount')
    reach_raw = optional_int(raw_item, 'Reach', 'reach')
    video_25_raw = optional_int(raw_item, 'firstQuartileEventsCount')
    video_50_raw = optional_int(raw_item, 'midpointEventsCount')
    video_75_raw = optional_int(raw_item, 'thirdQuartileEventsCount')
    video_100_raw = optional_int(raw_item, 'completeEventsCount')
    native_spend = optional_float(raw_item, 'TotalSum', 'totalSum')
    cpm = optional_float(raw_item, 'CPM', 'ECPM', 'eCPM')
    cpc = optional_float(raw_item, 'CPC', 'ECPC', 'eCPC')
    derived_spend = None
    if native_spend is None:
        if cpm is not None and impressions > 0:
            derived_spend = (impressions / 1000.0) * cpm
        elif cpc is not None and clicks > 0:
            derived_spend = clicks * cpc
    return {
        'impressions': impressions,
        'clicks': clicks,
        'views': max(views_raw, 0) if views_raw is not None else None,
        'reach': max(reach_raw, 0) if reach_raw is not None else None,
        'spend': native_spend if native_spend is not None else derived_spend,
        'ctr': optional_float(raw_item, 'CTR', 'cTR'),
        'cpm': cpm,
        'cpc': cpc,
        'video_views_25': max(video_25_raw, 0) if video_25_raw is not None else None,
        'video_views_50': max(video_50_raw, 0) if video_50_raw is not None else None,
        'video_views_75': max(video_75_raw, 0) if video_75_raw is not None else None,
        'video_views_100': max(video_100_raw, 0) if video_100_raw is not None else None,
    }


def should_force_leovit_olv_views_equal_impressions(raw_item: dict, advertiser_id: str, report_date: str) -> bool:
    if advertiser_id not in LEOVIT_OLV_ACCOUNT_IDS:
        return False
    if not report_date or report_date < LEOVIT_OLV_VIEWS_IMPRESSIONS_START_DATE:
        return False
    olv_text = ' '.join(
        [
            clean_text(raw_item.get('BannerName')),
            clean_text(raw_item.get('SplitName')),
            clean_text(raw_item.get('CampaignName')),
            clean_text(raw_item.get('campaign_name')),
        ]
    ).lower()
    return 'olv' in olv_text or 'олв' in olv_text


def load_existing_fact_metric_map(date_from: str, date_to: str) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            report_date,
            platform_account_id,
            platform_campaign_id,
            platform_delivery_entity_id,
            platform_creative_id,
            spend,
            views,
            conversions,
            reach,
            frequency,
            ctr,
            cpm,
            cpc,
            cpv,
            cpa,
            video_views_25,
            video_views_50,
            video_views_75,
            video_views_100
        FROM canonical_fact_ads_daily
        WHERE source_key = %s
          AND report_date BETWEEN %s AND %s
        """,
        (SOURCE_KEY, date_from, date_to),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    metric_map: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (
            clean_text(row.get('report_date')),
            clean_text(row.get('platform_account_id')),
            clean_text(row.get('platform_campaign_id')),
            clean_text(row.get('platform_creative_id')),
        )
        metric_map[key] = row
    return metric_map


def merge_missing_fact_metrics(fact_rows: list[dict], existing_metrics: dict[tuple[str, str, str, str], dict[str, Any]]) -> None:
    optional_fields = [
        'spend',
        'views',
        'conversions',
        'reach',
        'frequency',
        'ctr',
        'cpm',
        'cpc',
        'cpv',
        'cpa',
        'video_views_25',
        'video_views_50',
        'video_views_75',
        'video_views_100',
    ]
    for row in fact_rows:
        key = (
            clean_text(row.get('report_date')),
            clean_text(row.get('platform_account_id')),
            clean_text(row.get('platform_campaign_id')),
            clean_text(row.get('platform_creative_id')),
        )
        existing = existing_metrics.get(key)
        if not existing:
            continue
        for field in optional_fields:
            if row.get(field) is None:
                row[field] = existing.get(field)


def build_canonical_payload(
    systems: list[dict],
    advertiser_name_map: dict[str, str],
    raw_rows: list[dict],
    run_id: int,
):
    account_rows: dict[tuple[str, str], dict] = {}
    campaign_rows: dict[tuple[str, str, str], dict] = {}
    delivery_rows: dict[tuple[str, str, str], dict] = {}
    creative_rows: dict[tuple[str, str, str], dict] = {}
    fact_rows: dict[tuple[str, str, str, str], dict] = {}
    fallback_campaigns = 0
    fallback_creatives = 0

    system_map = {str(item['advertiser_id']): item for item in systems}

    for raw in sorted(
        raw_rows,
        key=lambda item: (
            clean_text(item.get('date')),
            clean_text(item.get('advertiser_id')),
            clean_text(item.get('BannerId')),
            clean_text(item.get('BannerName')),
        ),
    ):
        advertiser_id = clean_text(raw.get('advertiser_id'))
        report_date = clean_text(raw.get('date'))
        if not advertiser_id or not report_date:
            continue

        display_name, folder_id, creative_id = parse_banner_parts(raw, advertiser_id)
        metrics = normalize_metric_row(raw)
        if should_force_leovit_olv_views_equal_impressions(raw, advertiser_id, report_date):
            metrics['views'] = metrics['impressions']
        system_row = system_map.get(advertiser_id, {})
        account_name = advertiser_name_map.get(advertiser_id) or clean_text(system_row.get('name')) or f'Hybrid advertiser {advertiser_id}'
        campaign_name = derive_campaign_name(raw, f'Hybrid folder {folder_id}')

        account_rows[(SOURCE_KEY, advertiser_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': advertiser_id,
            'external_account_ref': None,
            'account_name': account_name,
            'advertiser_name': account_name,
            'account_status': 'ACTIVE',
            'currency_code': None,
            'timezone_name': None,
            'first_seen_at': None,
            'last_seen_at': None,
            'raw_payload': {'advertiser_id': advertiser_id, 'system_name': system_row.get('name')},
        }

        campaign_key = (SOURCE_KEY, advertiser_id, folder_id)
        if campaign_key not in campaign_rows:
            fallback_campaigns += 1
            campaign_rows[campaign_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': folder_id,
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
                'raw_payload': {'fallback_from_stats': True, 'split_name': raw.get('SplitName')},
            }

        entity_key = (SOURCE_KEY, advertiser_id, creative_id)
        if entity_key not in delivery_rows:
            fallback_creatives += 1
            base_payload = {
                'fallback_from_stats': True,
                'banner_id': clean_text(raw.get('BannerId')),
                'banner_name': clean_text(raw.get('BannerName')),
                'split_name': clean_text(raw.get('SplitName')),
            }
            delivery_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': folder_id,
                'delivery_entity_type': 'other',
                'platform_delivery_entity_id': creative_id,
                'parent_delivery_entity_id': None,
                'delivery_entity_name': display_name or f'Hybrid creative {creative_id}',
                'delivery_status': 'unknown',
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': base_payload,
            }
            creative_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': folder_id,
                'platform_delivery_entity_id': creative_id,
                'platform_creative_id': creative_id,
                'creative_name': display_name or f'Hybrid creative {creative_id}',
                'creative_status': 'unknown',
                'creative_type': 'creative',
                'creative_format': None,
                'destination_url': None,
                'final_url': None,
                'content_ref': clean_text(raw.get('BannerId')) or None,
                'preview_url': None,
                'post_id': None,
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': base_payload,
            }

        fact_key = (report_date, advertiser_id, folder_id, creative_id)
        existing = fact_rows.get(fact_key)
        if not existing:
            fact_rows[fact_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': advertiser_id,
                'platform_campaign_id': folder_id,
                'fact_scope': 'delivery_entity',
                'native_grain': 'creative',
                'breakdown_scope': 'default',
                'platform_delivery_entity_id': creative_id,
                'platform_creative_id': creative_id,
                'report_date': report_date,
                'spend': metrics['spend'],
                'impressions': metrics['impressions'],
                'clicks': metrics['clicks'],
                'views': metrics['views'],
                'conversions': None,
                'reach': metrics['reach'],
                'frequency': None,
                'ctr': metrics['ctr'],
                'cpm': metrics['cpm'],
                'cpc': metrics['cpc'],
                'cpv': None,
                'cpa': None,
                'video_views_25': metrics['video_views_25'],
                'video_views_50': metrics['video_views_50'],
                'video_views_75': metrics['video_views_75'],
                'video_views_100': metrics['video_views_100'],
                'link_clicks': None,
                'likes': None,
                'comments': None,
                'shares': None,
                'reactions': None,
                'follows': None,
                'currency_code': None,
                'ingestion_run_id': run_id,
            }
        else:
            if metrics['spend'] is not None:
                existing['spend'] = (existing['spend'] or 0) + metrics['spend']
            existing['impressions'] += metrics['impressions']
            existing['clicks'] += metrics['clicks']
            if metrics['views'] is not None:
                existing['views'] = (existing['views'] or 0) + metrics['views']
            if metrics['reach'] is not None:
                existing['reach'] = (existing['reach'] or 0) + metrics['reach']
            if metrics['video_views_25'] is not None:
                existing['video_views_25'] = (existing['video_views_25'] or 0) + metrics['video_views_25']
            if metrics['video_views_50'] is not None:
                existing['video_views_50'] = (existing['video_views_50'] or 0) + metrics['video_views_50']
            if metrics['video_views_75'] is not None:
                existing['video_views_75'] = (existing['video_views_75'] or 0) + metrics['video_views_75']
            if metrics['video_views_100'] is not None:
                existing['video_views_100'] = (existing['video_views_100'] or 0) + metrics['video_views_100']

    return {
        'account_rows': list(account_rows.values()),
        'campaign_rows': list(campaign_rows.values()),
        'delivery_rows': list(delivery_rows.values()),
        'creative_rows': list(creative_rows.values()),
        'fact_rows': list(fact_rows.values()),
        'fallback_campaigns': fallback_campaigns,
        'fallback_creatives': fallback_creatives,
    }


def main():
    args = parse_args()
    date_from, date_to = _date_range(args)
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
        clients = build_account_clients()
        needed_accounts = sorted({int(item.get('account') or 1) for item in systems})
        tokens: dict[int, str] = {}
        advertiser_name_map: dict[str, str] = {}

        for account in needed_accounts:
            client = clients.get(account)
            if not client:
                raise RuntimeError(f'Hybrid account config {account} is missing from env')
            tokens[account] = get_token(client)
            try:
                advertisers = fetch_advertisers(tokens[account])
                for item in advertisers:
                    advertiser_id = clean_text(item.get('Id'))
                    if advertiser_id:
                        advertiser_name_map[advertiser_id] = clean_text(item.get('Name'))
            except Exception as exc:
                log_run_event(
                    run_id,
                    'WARN',
                    'advertiser_enrichment_failed',
                    f'Hybrid advertiser enrichment failed for account {account}',
                    {'account': account, 'error': str(exc)},
                )

        raw_rows: list[dict] = []
        log_run_event(
            run_id,
            'INFO',
            'stats_mode_selected',
            'Hybrid stats mode selected',
            {'stats_mode': HYBRID_STATS_MODE},
        )
        for system in systems:
            advertiser_id = clean_text(system.get('advertiser_id'))
            account = int(system.get('account') or 1)
            token = tokens[account]
            for day in daterange(date_from, date_to):
                if HYBRID_STATS_MODE == 'console_multisplit':
                    rows = fetch_multisplit_banner_stats(advertiser_id, day)
                else:
                    rows = fetch_campaign_stats(token, advertiser_id, day)
                rows_read += len(rows)
                if len(rows) >= 1000:
                    log_run_event(
                        run_id,
                        'WARN',
                        'hybrid_limit_reached',
                        'Hybrid stats response reached limit=1000, result may be truncated',
                        {'advertiser_id': advertiser_id, 'date': day, 'rows': len(rows)},
                    )
                for row in rows:
                    row['advertiser_id'] = advertiser_id
                    row['date'] = day
                    if HYBRID_STATS_MODE == 'console_multisplit':
                        row['BannerName'] = clean_text(row.get('splitName'))
                        row['BannerId'] = clean_text(row.get('bannerId'))
                        row['SplitName'] = ''
                raw_rows.extend(rows)
                time.sleep(0.2)

        payload = build_canonical_payload(systems, advertiser_name_map, raw_rows, run_id)
        if HYBRID_STATS_MODE == 'console_multisplit':
            existing_metrics = load_existing_fact_metric_map(date_from, date_to)
            merge_missing_fact_metrics(payload['fact_rows'], existing_metrics)

        rows_written += upsert_source_accounts(payload['account_rows'])
        rows_written += upsert_source_campaigns(payload['campaign_rows'])
        rows_written += upsert_delivery_entities(payload['delivery_rows'])
        rows_written += upsert_creatives(payload['creative_rows'])
        fact_count = upsert_fact_ads_daily(payload['fact_rows'])
        rows_written += fact_count
        rows_updated = rows_written

        log_run_event(
            run_id,
            'INFO',
            'collector_summary',
            'Hybrid canonical collector completed',
            {
                'systems': len(systems),
                'raw_rows': len(raw_rows),
                'accounts': len(payload['account_rows']),
                'campaigns': len(payload['campaign_rows']),
                'delivery_entities': len(payload['delivery_rows']),
                'creatives': len(payload['creative_rows']),
                'facts': len(payload['fact_rows']),
                'fallback_campaigns': payload['fallback_campaigns'],
                'fallback_creatives': payload['fallback_creatives'],
            },
        )

        finish_collector_run(run_id, 'success', rows_read, rows_written, rows_updated, 0, None)
    except Exception as exc:
        errors += 1
        log_run_event(run_id, 'ERROR', 'collector_failed', 'Hybrid canonical collector failed', {'error': str(exc)})
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_updated, errors, str(exc))
        raise


if __name__ == '__main__':
    main()
