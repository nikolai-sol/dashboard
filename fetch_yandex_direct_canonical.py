#!/usr/bin/env python3
"""Yandex Direct legacy tables -> canonical_* tables only."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import mysql.connector
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
from yandex_direct_shared import EXCLUDED_CAMPAIGN_IDS, resolve_account_bridge

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


SOURCE_KEY = 'yandex_direct'
PRIMARY_COLLECTOR = env_first('YANDEX_DIRECT_PRIMARY_COLLECTOR', default='legacy').strip().lower() or 'legacy'

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB_STAT = env_first('MYSQL_DB_STAT', default='report_bd')

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('yandex_direct_canonical')


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


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


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


def fetch_campaign_meta() -> dict[str, dict[str, str]]:
    conn = get_db_connection(MYSQL_DB_STAT)
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT campaign_id, name, brand FROM yandex_names")
        result: dict[str, dict[str, str]] = {}
        for row in cur.fetchall():
            result[str(row['campaign_id'])] = {
                'campaign_name': clean_text(row.get('name')),
                'brand': clean_text(row.get('brand')),
            }
        return result
    finally:
        cur.close()
        conn.close()


def fetch_group_meta() -> dict[str, dict[str, str]]:
    conn = get_db_connection(MYSQL_DB_STAT)
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT ad_id, ad_group_id, ad_group_name FROM yandex_group_names")
        result: dict[str, dict[str, str]] = {}
        for row in cur.fetchall():
            result[str(row['ad_id'])] = {
                'ad_group_id': clean_text(row.get('ad_group_id')),
                'ad_group_name': clean_text(row.get('ad_group_name')),
            }
        return result
    finally:
        cur.close()
        conn.close()


def fetch_stats(date_from: str, date_to: str) -> list[dict]:
    conn = get_db_connection(MYSQL_DB_STAT)
    cur = conn.cursor(dictionary=True)
    try:
        excluded_placeholders = ', '.join(['%s'] * len(EXCLUDED_CAMPAIGN_IDS))
        cur.execute(
            f"""
            SELECT
              ad_id,
              ad_group_id,
              campaign_id,
              impressions,
              impressionsReach,
              clicks,
              conversions,
              ctr,
              cost,
              avgCpc,
              avgImpr,
              date
            FROM yandex_new
            WHERE date BETWEEN %s AND %s
              AND campaign_id NOT IN ({excluded_placeholders})
            ORDER BY date, campaign_id, ad_id
            """,
            (date_from, date_to, *sorted(EXCLUDED_CAMPAIGN_IDS)),
        )
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


def build_canonical_payload(rows: list[dict], campaign_meta: dict[str, dict[str, str]], group_meta: dict[str, dict[str, str]], run_id: int) -> dict:
    fact_accumulator: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    account_rows: dict[tuple[str, str], dict] = {}
    campaign_rows: dict[tuple[str, str, str], dict] = {}
    delivery_rows: dict[tuple[str, str, str], dict] = {}
    creative_rows: dict[tuple[str, str, str], dict] = {}
    fact_rows: list[dict] = []
    fallback_accounts = 0
    fallback_campaigns = 0
    fallback_entities = 0

    for row in rows:
        campaign_id = clean_text(row.get('campaign_id'))
        ad_id = clean_text(row.get('ad_id'))
        if not campaign_id or not ad_id:
            continue

        report_date = row['date'].strftime('%Y-%m-%d') if hasattr(row.get('date'), 'strftime') else clean_text(row.get('date'))
        ad_group_id = clean_text(row.get('ad_group_id')) or clean_text(group_meta.get(ad_id, {}).get('ad_group_id'))
        ad_group_name = clean_text(group_meta.get(ad_id, {}).get('ad_group_name'))

        account_id, account_name, used_fallback_account = resolve_account_bridge(campaign_id, campaign_meta)
        campaign_name = clean_text(campaign_meta.get(campaign_id, {}).get('campaign_name')) or f'Yandex campaign {campaign_id}'
        entity_name = ad_group_name or f'Yandex ad {ad_id}'

        if used_fallback_account:
            fallback_accounts += 1
        if campaign_name == f'Yandex campaign {campaign_id}':
            fallback_campaigns += 1
        if entity_name == f'Yandex ad {ad_id}':
            fallback_entities += 1

        fact_key = (report_date, account_id, campaign_id, ad_id)
        existing = fact_accumulator.get(fact_key)
        if not existing:
            fact_accumulator[fact_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'fact_scope': 'delivery_entity',
                'native_grain': 'ad',
                'breakdown_scope': 'default',
                'platform_delivery_entity_id': ad_id,
                'platform_creative_id': ad_id,
                'report_date': report_date,
                'spend': safe_float(row.get('cost')),
                'impressions': safe_int(row.get('impressions')),
                'clicks': safe_int(row.get('clicks')),
                'views': None,
                'conversions': safe_int(row.get('conversions')),
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
                'ingestion_run_id': run_id,
            }
        else:
            existing['spend'] += safe_float(row.get('cost'))
            existing['impressions'] += safe_int(row.get('impressions'))
            existing['clicks'] += safe_int(row.get('clicks'))
            existing['conversions'] += safe_int(row.get('conversions'))

        account_key = (SOURCE_KEY, account_id)
        account_rows[account_key] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'external_account_ref': account_id if not used_fallback_account else None,
            'account_name': account_name,
            'advertiser_name': account_name,
            'account_status': 'ACTIVE',
            'currency_code': 'RUB',
            'timezone_name': 'Europe/Moscow',
            'first_seen_at': None,
            'last_seen_at': None,
            'raw_payload': {
                'bridge_mode': 'brand' if not used_fallback_account else 'campaign_fallback',
                'brand': clean_text(campaign_meta.get(campaign_id, {}).get('brand')),
            },
        }

        campaign_key = (SOURCE_KEY, account_id, campaign_id)
        if campaign_key not in campaign_rows:
            campaign_rows[campaign_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'campaign_name': campaign_name,
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
                    'brand': clean_text(campaign_meta.get(campaign_id, {}).get('brand')),
                },
            }

        entity_key = (SOURCE_KEY, account_id, ad_id)
        if entity_key not in delivery_rows:
            raw_payload = {
                'ad_group_id': ad_group_id,
                'ad_group_name': ad_group_name,
            }
            delivery_rows[entity_key] = {
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'delivery_entity_type': 'ad',
                'platform_delivery_entity_id': ad_id,
                'parent_delivery_entity_id': ad_group_id or None,
                'delivery_entity_name': entity_name,
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
                'creative_name': entity_name,
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
    fact_rows.extend(
        value
        for _, value in sorted(
            fact_accumulator.items(),
            key=lambda item: (
                item[0][0],
                item[0][1],
                item[0][2],
                item[0][3],
            ),
        )
    )

    return {
        'account_rows': list(account_rows.values()),
        'campaign_rows': list(campaign_rows.values()),
        'delivery_rows': list(delivery_rows.values()),
        'creative_rows': list(creative_rows.values()),
        'fact_rows': fact_rows,
        'aggregated_rows': len(fact_accumulator),
        'fallback_accounts': fallback_accounts,
        'fallback_campaigns': fallback_campaigns,
        'fallback_entities': fallback_entities,
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
        if PRIMARY_COLLECTOR == 'api':
            log_run_event(
                run_id,
                'WARNING',
                'collector_disabled',
                'Legacy Yandex Direct collector skipped because API collector is configured as primary',
                {'primary_collector': PRIMARY_COLLECTOR},
            )
            finish_collector_run(
                run_id,
                'partial',
                rows_read,
                rows_written,
                rows_updated,
                0,
                'Legacy collector disabled because YANDEX_DIRECT_PRIMARY_COLLECTOR=api',
            )
            return
        campaign_meta = fetch_campaign_meta()
        group_meta = fetch_group_meta()
        raw_rows = fetch_stats(date_from, date_to)
        rows_read = len(raw_rows)
        if not raw_rows:
            raise RuntimeError(f'No yandex_new rows found for {date_from}..{date_to}')

        payload = build_canonical_payload(raw_rows, campaign_meta, group_meta, run_id)

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
            'Yandex Direct canonical collector completed',
            {
                'raw_rows': len(raw_rows),
                'accounts': len(payload['account_rows']),
                'campaigns': len(payload['campaign_rows']),
                'delivery_entities': len(payload['delivery_rows']),
                'creatives': len(payload['creative_rows']),
                'facts': len(payload['fact_rows']),
                'aggregated_rows': payload['aggregated_rows'],
                'fallback_accounts': payload['fallback_accounts'],
                'fallback_campaigns': payload['fallback_campaigns'],
                'fallback_entities': payload['fallback_entities'],
                'excluded_campaign_ids_count': len(EXCLUDED_CAMPAIGN_IDS),
                'authority_source': 'yandex_new',
                'secondary_validation_source': 'yandex_market_stat',
            },
        )

        finish_collector_run(run_id, 'success', rows_read, rows_written, rows_updated, 0, None)
    except Exception as exc:
        errors += 1
        log_run_event(run_id, 'ERROR', 'collector_failed', 'Yandex Direct canonical collector failed', {'error': str(exc)})
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_updated, errors, str(exc))
        raise


if __name__ == '__main__':
    main()
