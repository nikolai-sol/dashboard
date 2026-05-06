#!/usr/bin/env python3
"""VK Ads v2 -> canonical_* tables only."""

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

SOURCE_KEY = 'vk_ads_v2'
BASE_URL = 'https://ads.vk.com/api/v2'
ITEMS_LIMIT = 250
STAT_CHUNK_SIZE = 100
MAX_RETRIES = 5

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB_TECH = env_first('MYSQL_DB_STAT', 'MYSQL_DB_TECH', default='report_bd_tech')

VK_NEW_TOKEN_URL = env_first('VK_NEW_TOKEN_URL')
VK_NEW_CLIENT_ID = env_first('VK_NEW_CLIENT_ID')
VK_NEW_CLIENT_SECRET = env_first('VK_NEW_CLIENT_SECRET')

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('vk_ads_v2_canonical')


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
        try:
            conn = get_tech_db_connection(database)
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT client_id, name, refresh, access, timestamp, active
                FROM vk_data
                WHERE active = 1
                ORDER BY client_id
                """
            )
            rows = cur.fetchall()
            cur.close()
            conn.close()
            return rows
        except mysql.connector.Error as exc:
            last_error = exc
            try:
                cur.close()
                conn.close()
            except Exception:
                pass
    raise last_error


def token_is_fresh(timestamp_value: Any) -> bool:
    if not timestamp_value:
        return False
    try:
        ts = int(timestamp_value)
    except (TypeError, ValueError):
        return False
    # Stored values on the server are in ms.
    now_ms = int(time.time() * 1000)
    return ts > 10**12 and now_ms < ts + (23 * 60 * 60 * 1000)


def refresh_access_token(refresh_token: str) -> str:
    if not VK_NEW_TOKEN_URL or not VK_NEW_CLIENT_ID or not VK_NEW_CLIENT_SECRET:
        raise RuntimeError('Missing VK_NEW_* credentials for canonical VK collector')

    prepared_data = {
        'grant_type': 'refresh_token',
        'client_id': VK_NEW_CLIENT_ID,
        'client_secret': VK_NEW_CLIENT_SECRET,
        'refresh_token': refresh_token,
    }
    resp = requests.post(
        VK_NEW_TOKEN_URL,
        data=prepared_data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get('access_token')
    if not token:
        raise RuntimeError(f'VK token refresh returned no access_token: {data}')
    return token


def get_system_access_token(system_row: dict) -> str:
    access = (system_row.get('access') or '').strip()
    if access and token_is_fresh(system_row.get('timestamp')):
        return access
    refresh = (system_row.get('refresh') or '').strip()
    if not refresh:
        raise RuntimeError(f"VK system {system_row.get('client_id')} has no refresh token")
    return refresh_access_token(refresh)


def api_get(path: str, token: str, params: dict | None = None) -> dict:
    wait_seconds = 2
    for attempt in range(1, MAX_RETRIES + 1):
        resp = requests.get(
            f'{BASE_URL}{path}',
            params=params,
            headers={'Authorization': f'Bearer {token}'},
            timeout=90,
        )
        if resp.status_code != 429:
            resp.raise_for_status()
            return resp.json()
        if attempt == MAX_RETRIES:
            resp.raise_for_status()
        retry_after = resp.headers.get('Retry-After')
        sleep_for = int(retry_after) if retry_after and retry_after.isdigit() else wait_seconds
        time.sleep(sleep_for)
        wait_seconds = min(wait_seconds * 2, 60)
    raise RuntimeError(f'VK API retry loop exhausted for {path}')


def list_banners(token: str) -> list[dict]:
    offset = 0
    banners: list[dict] = []
    while True:
        data = api_get('/banners.json', token, {'offset': offset, 'limit': ITEMS_LIMIT})
        items = data.get('items') or []
        if not items:
            break
        banners.extend(items)
        if len(items) < ITEMS_LIMIT:
            break
        offset += ITEMS_LIMIT
    return banners


def chunked_ids(values: list[str], chunk_size: int = STAT_CHUNK_SIZE):
    for i in range(0, len(values), chunk_size):
        yield values[i:i + chunk_size]


def list_banner_stats(token: str, banner_ids: list[str], date_from: str, date_to: str) -> list[dict]:
    stats: list[dict] = []
    for ids in chunked_ids(banner_ids):
        data = api_get(
            '/statistics/banners/day.json',
            token,
            {
                'date_from': date_from,
                'date_to': date_to,
                'metrics': 'base,video,uniques',
                'attribution': 'default',
                'id': ','.join(ids),
            },
        )
        stats.extend(data.get('items') or [])
        time.sleep(0.3)
    return stats


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    if value in (None, ''):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def clamp_non_negative_int(value: Any) -> int:
    return max(safe_int(value), 0)


def clamp_non_negative_float(value: Any) -> float:
    return max(safe_float(value), 0.0)


def dedupe_rows(rows: list[dict], keys: tuple[str, ...]) -> list[dict]:
    deduped: OrderedDict[tuple[Any, ...], dict] = OrderedDict()
    for row in rows:
        deduped[tuple(row.get(k) for k in keys)] = row
    return list(deduped.values())


def delete_zero_activity_facts(account_id: str, date_from: str, date_to: str) -> int:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        DELETE FROM canonical_fact_ads_daily
        WHERE source_key = %s
          AND fact_scope = 'delivery_entity'
          AND platform_account_id = %s
          AND report_date BETWEEN %s AND %s
          AND COALESCE(impressions, 0) = 0
          AND COALESCE(clicks, 0) = 0
          AND COALESCE(spend, 0) = 0
          AND COALESCE(conversions, 0) = 0
          AND COALESCE(video_views_25, 0) = 0
          AND COALESCE(video_views_50, 0) = 0
          AND COALESCE(video_views_75, 0) = 0
          AND COALESCE(video_views_100, 0) = 0
        """,
        (SOURCE_KEY, account_id, date_from, date_to),
    )
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return int(deleted)


def build_canonical_payload(system_row: dict, banners: list[dict], stats: list[dict], run_id: int):
    account_id = str(system_row['client_id'])
    raw_account = {
        'client_id': system_row['client_id'],
        'name': system_row.get('name'),
        'active': system_row.get('active'),
    }
    account_rows = [{
        'source_key': SOURCE_KEY,
        'platform_account_id': account_id,
        'external_account_ref': None,
        'account_name': system_row.get('name') or f'VK account {account_id}',
        'advertiser_name': system_row.get('name') or f'VK account {account_id}',
        'account_status': 'ACTIVE' if safe_int(system_row.get('active')) == 1 else 'INACTIVE',
        'currency_code': 'RUB',
        'timezone_name': 'Europe/Moscow',
        'first_seen_at': None,
        'last_seen_at': datetime.now(timezone.utc).isoformat(),
        'raw_payload': raw_account,
    }]

    banner_map = {str(item.get('id')): item for item in banners if item.get('id')}
    campaign_rows: list[dict] = []
    delivery_rows: list[dict] = []
    creative_rows: list[dict] = []
    fact_rows: list[dict] = []
    fallback_delivery_entities = 0
    fallback_creatives = 0
    rows_skipped_zero = 0

    campaign_ids = set()
    for item in banners:
        banner_id = str(item.get('id', ''))
        campaign_id = str(item.get('campaign_id', ''))
        if not banner_id or not campaign_id:
            continue
        campaign_ids.add(campaign_id)
        moderation_status = item.get('moderation_status') or 'UNKNOWN'
        delivery_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'delivery_entity_type': 'banner',
            'platform_delivery_entity_id': banner_id,
            'parent_delivery_entity_id': str(item.get('ad_group_id') or ''),
            'delivery_entity_name': f'VK Banner {banner_id}',
            'delivery_status': moderation_status,
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': item,
        })
        creative_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'platform_delivery_entity_id': banner_id,
            'platform_creative_id': banner_id,
            'creative_name': f'VK Banner {banner_id}',
            'creative_status': moderation_status,
            'creative_type': 'banner',
            'creative_format': None,
            'destination_url': None,
            'final_url': None,
            'content_ref': None,
            'preview_url': None,
            'post_id': None,
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': item,
        })

    for campaign_id in sorted(campaign_ids):
        campaign_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'campaign_name': f'VK campaign {campaign_id}',
            'campaign_status': None,
            'objective': None,
            'buy_type': None,
            'start_date': None,
            'end_date': None,
            'daily_budget': None,
            'total_budget': None,
            'currency_code': 'RUB',
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': {'derived_from': 'banners_list', 'campaign_id': campaign_id},
        })

    ordered_stats = sorted(
        stats,
        key=lambda item: (
            min((row.get('date') or '' for row in (item.get('rows') or [])), default=''),
            str(item.get('id', '')),
        ),
    )

    for stat in ordered_stats:
        banner_id = str(stat.get('id', ''))
        if not banner_id:
            continue
        banner = banner_map.get(banner_id)
        campaign_id = str((banner or {}).get('campaign_id', ''))
        if not campaign_id:
            campaign_id = f'unknown:{banner_id}'
            campaign_rows.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'campaign_name': f'VK campaign {campaign_id}',
                'campaign_status': None,
                'objective': None,
                'buy_type': None,
                'start_date': None,
                'end_date': None,
                'daily_budget': None,
                'total_budget': None,
                'currency_code': 'RUB',
                'first_seen_at': None,
                'last_seen_at': datetime.now(timezone.utc).isoformat(),
                'raw_payload': {'fallback_from_stats': True, 'banner_id': banner_id},
            })
        if not banner:
            fallback_payload = {'fallback_from_stats': True, 'banner_id': banner_id, 'campaign_id': campaign_id}
            delivery_rows.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'delivery_entity_type': 'banner',
                'platform_delivery_entity_id': banner_id,
                'parent_delivery_entity_id': '',
                'delivery_entity_name': f'VK Banner {banner_id}',
                'delivery_status': 'unknown',
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': fallback_payload,
            })
            creative_rows.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'platform_delivery_entity_id': banner_id,
                'platform_creative_id': banner_id,
                'creative_name': f'VK Banner {banner_id}',
                'creative_status': 'unknown',
                'creative_type': 'banner',
                'creative_format': None,
                'destination_url': None,
                'final_url': None,
                'content_ref': None,
                'preview_url': None,
                'post_id': None,
                'first_seen_at': None,
                'last_seen_at': None,
                'raw_payload': fallback_payload,
            })
            fallback_delivery_entities += 1
            fallback_creatives += 1

        for row in sorted(stat.get('rows') or [], key=lambda item: ((item.get('date') or ''), banner_id)):
            base = row.get('base') or {}
            video = row.get('video') or {}
            uniques = row.get('uniques') or {}

            impressions = clamp_non_negative_int(base.get('shows'))
            clicks = clamp_non_negative_int(base.get('clicks'))
            spend = clamp_non_negative_float(base.get('spent'))
            conversions = clamp_non_negative_int(base.get('goals'))
            reach = clamp_non_negative_int(uniques.get('reach'))
            frequency = clamp_non_negative_float(uniques.get('frequency'))
            video_views_25 = clamp_non_negative_int(video.get('viewed_25_percent'))
            video_views_50 = clamp_non_negative_int(video.get('viewed_50_percent'))
            video_views_75 = clamp_non_negative_int(video.get('viewed_75_percent'))
            video_views_100 = clamp_non_negative_int(video.get('viewed_100_percent'))

            if (
                impressions == 0
                and clicks == 0
                and spend == 0
                and conversions == 0
                and video_views_25 == 0
                and video_views_50 == 0
                and video_views_75 == 0
                and video_views_100 == 0
            ):
                rows_skipped_zero += 1
                log.debug('vk_ads_v2 skipped zero row banner_id=%s date=%s', banner_id, row.get('date'))
                continue

            fact_rows.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'fact_scope': 'delivery_entity',
                'native_grain': 'banner',
                'breakdown_scope': 'default',
                'platform_delivery_entity_id': str(banner_id),
                'platform_creative_id': str(banner_id),
                'report_date': row.get('date'),
                'spend': spend,
                'impressions': impressions,
                'clicks': clicks,
                'views': None,
                'conversions': conversions,
                'reach': reach,
                'frequency': frequency,
                'ctr': clamp_non_negative_float(base.get('ctr')),
                'cpm': clamp_non_negative_float(base.get('cpm')),
                'cpc': clamp_non_negative_float(base.get('cpc')),
                'cpv': None,
                'cpa': clamp_non_negative_float(base.get('cpa')),
                'video_views_25': video_views_25,
                'video_views_50': video_views_50,
                'video_views_75': video_views_75,
                'video_views_100': video_views_100,
                'link_clicks': None,
                'likes': None,
                'comments': None,
                'shares': None,
                'reactions': None,
                'follows': None,
                'currency_code': 'RUB',
                'ingestion_run_id': run_id,
            })

    campaign_rows = dedupe_rows(campaign_rows, ('source_key', 'platform_account_id', 'platform_campaign_id'))
    delivery_rows = dedupe_rows(delivery_rows, ('source_key', 'platform_account_id', 'platform_delivery_entity_id'))
    creative_rows = dedupe_rows(creative_rows, ('source_key', 'platform_account_id', 'platform_creative_id'))
    fact_rows = dedupe_rows(
        fact_rows,
        (
            'source_key', 'platform_account_id', 'platform_campaign_id',
            'fact_scope', 'native_grain', 'breakdown_scope',
            'platform_delivery_entity_id', 'platform_creative_id', 'report_date'
        ),
    )

    return account_rows, campaign_rows, delivery_rows, creative_rows, fact_rows, {
        'fallback_delivery_entities_created': fallback_delivery_entities,
        'fallback_creatives_created': fallback_creatives,
        'rows_skipped_zero': rows_skipped_zero,
    }


def main():
    args = parse_args()
    date_from, date_to = _date_range(args)
    systems = fetch_active_systems()
    correlation_id = str(uuid.uuid4())

    if not systems:
        raise RuntimeError('No active vk_data systems found in report_bd_tech')

    for system_row in systems:
        account_id = str(system_row['client_id'])
        run_id = start_collector_run(
            source_key=SOURCE_KEY,
            run_type=args.run_type,
            run_mode='canonical_only',
            job_key=f'{SOURCE_KEY}:{account_id}:{date_from}:{date_to}',
            correlation_id=correlation_id,
            date_from=date_from,
            date_to=date_to,
        )
        rows_read = 0
        rows_written = 0
        try:
            token = get_system_access_token(system_row)
            zero_rows_deleted = delete_zero_activity_facts(account_id, date_from, date_to)
            banners = list_banners(token)
            banner_ids = [str(item['id']) for item in banners if item.get('id')]
            stats = list_banner_stats(token, banner_ids, date_from, date_to) if banner_ids else []
            rows_read = 1 + len(banners) + sum(len(item.get('rows') or []) for item in stats)

            account_rows, campaign_rows, delivery_rows, creative_rows, fact_rows, summary = build_canonical_payload(
                system_row, banners, stats, run_id
            )

            rows_written += upsert_source_accounts(account_rows)
            rows_written += upsert_source_campaigns(campaign_rows)
            rows_written += upsert_delivery_entities(delivery_rows)
            rows_written += upsert_creatives(creative_rows)
            rows_written += upsert_fact_ads_daily(fact_rows)

            log_run_event(run_id, 'info', 'sync_summary', 'VK Ads v2 canonical sync complete', {
                'account_id': account_id,
                'date_from': date_from,
                'date_to': date_to,
                'banners': len(banners),
                'campaigns': len(campaign_rows),
                'delivery_entities': len(delivery_rows),
                'creatives': len(creative_rows),
                'facts': len(fact_rows),
                'zero_rows_deleted': zero_rows_deleted,
                **summary,
            })
            finish_collector_run(run_id, 'success', rows_read, rows_written, rows_written)
        except Exception as exc:
            log_run_event(run_id, 'error', 'sync_failed', str(exc))
            finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_written, error_count=1, error_summary=str(exc))
            raise


if __name__ == '__main__':
    main()
