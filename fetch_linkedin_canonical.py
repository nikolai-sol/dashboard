#!/usr/bin/env python3
"""LinkedIn Ads -> canonical_* tables only."""

from __future__ import annotations

import argparse
import time
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

import requests

import fetch_linkedin_ads as legacy
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

SOURCE_KEY = 'linkedin'


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date-from', default='')
    parser.add_argument('--date-to', default='')
    parser.add_argument('--days-back', type=int, default=1)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
    return parser.parse_args()


def _date_range(args) -> tuple[datetime, datetime]:
    end_anchor = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if args.date_from:
        start_date = datetime.strptime(args.date_from, '%Y-%m-%d')
    else:
        if args.run_type == 'cron':
            start_date = end_anchor - timedelta(days=max(args.days_back, 1))
        else:
            start_date = end_anchor - timedelta(days=args.days_back)
    if args.date_to:
        end_date = datetime.strptime(args.date_to, '%Y-%m-%d')
    else:
        end_date = end_anchor - timedelta(days=1) if args.run_type == 'cron' else end_anchor
    return start_date, end_date


def fetch_account(token: str, account_id: str) -> dict:
    resp = requests.get(f'{legacy.BASE_URL}/adAccounts/{account_id}', headers=legacy.get_headers(token), timeout=60)
    resp.raise_for_status()
    return resp.json()


def fetch_campaigns_all(token: str, account_id: str) -> list[dict]:
    headers = legacy.get_headers(token)
    campaigns: list[dict] = []
    start = 0
    count = 100
    while True:
        url = f'{legacy.BASE_URL}/adAccounts/{account_id}/adCampaigns?q=search&count={count}&start={start}'
        resp = requests.get(url, headers=headers, timeout=60)
        if resp.status_code == 429:
            legacy.log.warning('Rate limited on LinkedIn campaigns, waiting 60s...')
            time.sleep(60)
            continue
        resp.raise_for_status()
        data = resp.json()
        elements = data.get('elements', [])
        if not elements:
            break
        for c in elements:
            created_ts = c.get('changeAuditStamps', {}).get('created', {}).get('time')
            last_modified_ts = c.get('changeAuditStamps', {}).get('lastModified', {}).get('time')
            campaigns.append({
                'campaign_id': str(c.get('id', '')),
                'account_id': account_id,
                'name': c.get('name', ''),
                'status': c.get('status', ''),
                'objective_type': c.get('objectiveType', ''),
                'cost_type': c.get('costType', ''),
                'daily_budget_amount': float(c.get('dailyBudget', {}).get('amount', '0') or '0'),
                'daily_budget_currency': c.get('dailyBudget', {}).get('currencyCode', ''),
                'created_at': datetime.utcfromtimestamp(created_ts / 1000).isoformat() if created_ts else None,
                'updated_at': datetime.utcfromtimestamp(last_modified_ts / 1000).isoformat() if last_modified_ts else None,
                'raw_payload': c,
            })
        if len(elements) < count:
            break
        start += count
    return campaigns


def fetch_creatives(token: str, account_id: str) -> list[dict]:
    headers = legacy.get_headers(token)
    rows: list[dict] = []
    start = 0
    count = 100
    while True:
        url = f'{legacy.BASE_URL}/adAccounts/{account_id}/creatives?q=criteria&count={count}&start={start}'
        resp = requests.get(url, headers=headers, timeout=60)
        if resp.status_code == 429:
            legacy.log.warning('Rate limited on LinkedIn creatives, waiting 60s...')
            time.sleep(60)
            continue
        resp.raise_for_status()
        data = resp.json()
        elements = data.get('elements', [])
        if not elements:
            break
        rows.extend(elements)
        if len(elements) < count:
            break
        start += count
    return rows


def fetch_creative_analytics(token: str, account_id: str, start_date: datetime, end_date: datetime) -> list[dict]:
    headers = legacy.get_headers(token)
    fields = ','.join(legacy.METRICS + ['pivotValues', 'dateRange'])
    date_range = (
        f'(start:(year:{start_date.year},month:{start_date.month},day:{start_date.day}),'
        f'end:(year:{end_date.year},month:{end_date.month},day:{end_date.day}))'
    )
    account_urn_encoded = quote(f'urn:li:sponsoredAccount:{account_id}', safe='')
    url = (
        f'{legacy.BASE_URL}/adAnalytics'
        f'?q=analytics&dateRange={date_range}&timeGranularity=DAILY'
        f'&accounts=List({account_urn_encoded})&pivot=CREATIVE'
        f'&fields={fields}'
    )
    while True:
        resp = requests.get(url, headers=headers, timeout=60)
        if resp.status_code == 429:
            legacy.log.warning('Rate limited on LinkedIn creative analytics, waiting 60s...')
            time.sleep(60)
            continue
        resp.raise_for_status()
        return resp.json().get('elements', [])


def build_canonical_payload(account: dict, campaigns: list[dict], creatives: list[dict], analytics: list[dict], run_id: int):
    campaign_map = {c['campaign_id']: c for c in campaigns}
    account_id = str(account.get('id'))
    account_row = {
        'source_key': SOURCE_KEY,
        'platform_account_id': account_id,
        'external_account_ref': account.get('reference'),
        'account_name': account.get('name'),
        'advertiser_name': account.get('name'),
        'account_status': account.get('status'),
        'currency_code': account.get('currency'),
        'timezone_name': None,
        'first_seen_at': datetime.utcfromtimestamp(account.get('changeAuditStamps', {}).get('created', {}).get('time', 0) / 1000).isoformat() if account.get('changeAuditStamps', {}).get('created', {}).get('time') else None,
        'last_seen_at': datetime.utcfromtimestamp(account.get('changeAuditStamps', {}).get('lastModified', {}).get('time', 0) / 1000).isoformat() if account.get('changeAuditStamps', {}).get('lastModified', {}).get('time') else None,
        'raw_payload': account,
    }

    campaign_rows = []
    for c in campaigns:
        campaign_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': c['account_id'],
            'platform_campaign_id': c['campaign_id'],
            'campaign_name': c['name'],
            'campaign_status': c['status'],
            'objective': c.get('objective_type'),
            'buy_type': c.get('cost_type'),
            'start_date': None,
            'end_date': None,
            'daily_budget': c.get('daily_budget_amount') or None,
            'total_budget': None,
            'currency_code': c.get('daily_budget_currency') or account.get('currency'),
            'first_seen_at': c.get('created_at'),
            'last_seen_at': c.get('updated_at'),
            'raw_payload': c.get('raw_payload'),
        })

    creative_map: dict[str, dict] = {}
    delivery_rows = []
    creative_rows = []
    for c in creatives:
        creative_id = str(c.get('id', '')).split(':')[-1]
        campaign_id = str(c.get('campaign', '')).split(':')[-1]
        if not creative_id or not campaign_id:
            continue
        review = c.get('review') or {}
        created_at = datetime.utcfromtimestamp(c.get('createdAt', 0) / 1000).isoformat() if c.get('createdAt') else None
        updated_at = datetime.utcfromtimestamp(c.get('lastModifiedAt', 0) / 1000).isoformat() if c.get('lastModifiedAt') else None
        content_ref = (c.get('content') or {}).get('reference')
        row_base = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'platform_delivery_entity_id': creative_id,
            'first_seen_at': created_at,
            'last_seen_at': updated_at,
            'raw_payload': c,
        }
        creative_map[creative_id] = {
            'campaign_id': campaign_id,
            'name': c.get('name') or f'LinkedIn creative {creative_id}',
            'status': review.get('status') or c.get('intendedStatus') or ('ACTIVE' if c.get('isServing') else 'PAUSED'),
            'content_ref': content_ref,
        }
        delivery_rows.append({
            **row_base,
            'delivery_entity_type': 'ad',
            'parent_delivery_entity_id': None,
            'delivery_entity_name': c.get('name') or f'LinkedIn creative {creative_id}',
            'delivery_status': review.get('status') or c.get('intendedStatus') or ('ACTIVE' if c.get('isServing') else 'PAUSED'),
        })
        creative_rows.append({
            **row_base,
            'platform_creative_id': creative_id,
            'creative_name': c.get('name') or f'LinkedIn creative {creative_id}',
            'creative_status': review.get('status') or c.get('intendedStatus') or ('ACTIVE' if c.get('isServing') else 'PAUSED'),
            'creative_type': 'share',
            'creative_format': None,
            'destination_url': None,
            'final_url': None,
            'content_ref': content_ref,
            'preview_url': None,
            'post_id': content_ref.split(':')[-1] if content_ref else None,
        })
        if campaign_id not in campaign_map:
            campaign_map[campaign_id] = {
                'campaign_id': campaign_id,
                'account_id': account_id,
                'name': f'LinkedIn campaign {campaign_id}',
                'status': None,
                'objective_type': None,
                'cost_type': None,
                'daily_budget_amount': None,
                'daily_budget_currency': account.get('currency'),
                'created_at': created_at,
                'updated_at': updated_at,
                'raw_payload': None,
            }
            campaign_rows.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'campaign_name': f'LinkedIn campaign {campaign_id}',
                'campaign_status': None,
                'objective': None,
                'buy_type': None,
                'start_date': None,
                'end_date': None,
                'daily_budget': None,
                'total_budget': None,
                'currency_code': account.get('currency'),
                'first_seen_at': created_at,
                'last_seen_at': updated_at,
                'raw_payload': None,
            })

    fact_rows = []
    for el in analytics:
        pivot_values = el.get('pivotValues') or []
        creative_urn = pivot_values[0] if pivot_values else ''
        creative_id = creative_urn.split(':')[-1] if creative_urn else ''
        creative_meta = creative_map.get(creative_id)
        if not creative_id or not creative_meta:
            continue
        s = (el.get('dateRange') or {}).get('start') or {}
        report_date = f"{s.get('year', 2000)}-{s.get('month', 1):02d}-{s.get('day', 1):02d}"
        fact_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': creative_meta['campaign_id'],
            'fact_scope': 'delivery_entity',
            'native_grain': 'creative',
            'breakdown_scope': 'default',
            'platform_delivery_entity_id': creative_id,
            'platform_creative_id': creative_id,
            'report_date': report_date,
            'spend': float(el.get('costInLocalCurrency', '0') or '0'),
            'impressions': int(el.get('impressions', 0) or 0),
            'clicks': int(el.get('clicks', 0) or 0),
            'views': None,
            'conversions': int(el.get('externalWebsiteConversions', 0) or 0),
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
            'currency_code': account.get('currency'),
            'ingestion_run_id': run_id,
        })

    return [account_row], campaign_rows, delivery_rows, creative_rows, fact_rows


def main():
    args = parse_args()
    start_date, end_date = _date_range(args)
    token = legacy.refresh_access_token()
    correlation_id = str(uuid.uuid4())

    for account_id in legacy.ACCOUNT_IDS:
        run_id = start_collector_run(
            source_key=SOURCE_KEY,
            run_type=args.run_type,
            run_mode='canonical_only',
            job_key=f'{SOURCE_KEY}:{account_id}:{start_date:%Y-%m-%d}:{end_date:%Y-%m-%d}',
            correlation_id=correlation_id,
            date_from=start_date.strftime('%Y-%m-%d'),
            date_to=end_date.strftime('%Y-%m-%d'),
        )
        rows_read = 0
        rows_written = 0
        try:
            account = fetch_account(token, account_id)
            campaigns = fetch_campaigns_all(token, account_id)
            creatives = fetch_creatives(token, account_id)
            analytics = fetch_creative_analytics(token, account_id, start_date, end_date)
            rows_read = len(campaigns) + len(creatives) + len(analytics) + 1

            account_rows, campaign_rows, delivery_rows, creative_rows, fact_rows = build_canonical_payload(
                account, campaigns, creatives, analytics, run_id
            )

            rows_written += upsert_source_accounts(account_rows)
            rows_written += upsert_source_campaigns(campaign_rows)
            rows_written += upsert_delivery_entities(delivery_rows)
            rows_written += upsert_creatives(creative_rows)
            rows_written += upsert_fact_ads_daily(fact_rows)

            log_run_event(run_id, 'info', 'sync_summary', 'LinkedIn canonical sync complete', {
                'account_id': account_id,
                'campaigns': len(campaign_rows),
                'creatives': len(creative_rows),
                'facts': len(fact_rows),
                'date_from': start_date.strftime('%Y-%m-%d'),
                'date_to': end_date.strftime('%Y-%m-%d'),
            })
            finish_collector_run(run_id, 'success', rows_read, rows_written, rows_written)
        except Exception as exc:
            log_run_event(run_id, 'error', 'sync_failed', str(exc))
            finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_written, error_count=1, error_summary=str(exc))
            raise


if __name__ == '__main__':
    main()
