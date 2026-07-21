#!/usr/bin/env python3
"""Yandex Metrika -> canonical_fact_site_analytics_daily."""

from __future__ import annotations

import argparse
import hashlib
import html
import logging
import os
import sys
import time
import uuid
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import mysql.connector
import requests
from dotenv import dotenv_values, load_dotenv

from abbott_canonical_controls import api_fingerprint
from canonical_writer import (
    finish_collector_run,
    log_run_event,
    publish_metrika_day_bundle,
    start_collector_run,
    upsert_fact_site_analytics_daily,
    upsert_fact_user_behavior_daily,
    upsert_source_accounts,
)
from metrika_logs_api import MetrikaLogsClient, MetrikaLogsError, VISIT_FIELDS
from metrika_pagination import PaginationResult, collect_all_pages, collect_all_rows

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


SOURCE_KEY = 'yandex_metrika'
ABBOTT_COUNTER_ID = '90602537'
ABBOTT_REQUIRED_SCOPES = ('other', 'traffic', 'page', 'user_behavior', 'returning')
ABBOTT_USER_ID_CONDITION = "ym:s:paramsLevel1=='UserID' AND ym:s:paramsLevel2!=''"
ABBOTT_OTHER_SEGMENTS = (
    ('all', ''),
    ('with_user_id', f'EXISTS({ABBOTT_USER_ID_CONDITION})'),
    ('without_user_id', f'NONE({ABBOTT_USER_ID_CONDITION})'),
)
RETURN_BUCKETS = ('next_day', 'days_2_7', 'days_8_31')
UTM_ADS_SCOPE_LOGICAL = 'utm_ads'
GOALS_SCOPE_LOGICAL = 'goals'
UTM_ADS_SCOPE_STORAGE = 'traffic'
GOALS_SCOPE_STORAGE = 'goal'
TRAFFIC_SOURCES_SCOPE_LOGICAL = 'traffic_sources'
TRAFFIC_SOURCES_SCOPE_STORAGE = 'other'
PAGES_SCOPE_LOGICAL = 'pages'
PAGES_SCOPE_STORAGE = 'page'
ENTRY_PAGES_SCOPE_LOGICAL = 'entry_pages'
ENTRY_PAGES_SCOPE_STORAGE = 'entry_page'
DEFAULT_COLLECTION_MODE = 'ads_only'
SUPPORTED_COLLECTION_MODES = {
    'ads_only',
    'ads_plus_seo',
    'ads_plus_seo_plus_user_behavior',
}
MAX_RETRIES = 5
METRIKA_API_ROW_LIMIT = 10000
TIMEOUT = 90
REQUEST_DELAY_SECONDS = float(env_first('METRIKA_REQUEST_DELAY_SECONDS', default='0.35') or 0)
METRIKA_PAGE_LIMIT = 10_000
METRIKA_TIMEZONE = 'Europe/Moscow'

MYSQL_HOST = env_first('MYSQL_HOST', default='localhost')
MYSQL_PORT = int(env_first('MYSQL_PORT', default='3306'))
MYSQL_USER = env_first('MYSQL_USER', default='report_bd')
MYSQL_PASS = env_first('MYSQL_PASSWORD')
MYSQL_DB = env_first('MYSQL_DB', default='report_bd')

METRIKA_TOKEN = env_first('METRIKA_TOKEN')
METRIKA_STATS_URL = env_first('METRIKA_STATS_URL', default='https://api-metrika.yandex.net/stat/v1/data')
METRIKA_ATTRIBUTION = env_first('METRIKA_ATTRIBUTION', default='last')
METRIKA_UTM_ADS_ATTRIBUTION = env_first('METRIKA_UTM_ADS_ATTRIBUTION', default='cross_device_last')
METRIKA_GOALS_ATTRIBUTION = env_first('METRIKA_GOALS_ATTRIBUTION', default='last')
METRIKA_UTM_ADS_DIMS = ','.join([
    'ym:s:<attribution>UTMSource',
    'ym:s:<attribution>UTMMedium',
    'ym:s:<attribution>UTMCampaign',
])
METRIKA_UTM_ADS_METRICS = ','.join([
    'ym:s:visits',
    'ym:s:users',
    'ym:s:newUsers',
    'ym:s:pageviews',
    'ym:s:bounceRate',
    'ym:s:avgVisitDurationSeconds',
    'ym:s:pageDepth',
])
METRIKA_GOALS_DIMS = ','.join([
    'ym:s:<attribution>UTMSource',
    'ym:s:<attribution>UTMMedium',
    'ym:s:<attribution>UTMCampaign',
    'ym:s:goal',
])
METRIKA_GOALS_METRICS = 'ym:s:sumGoalReachesAny'
METRIKA_TRAFFIC_SOURCES_DIMS = 'ym:s:lastsignTrafficSource'
METRIKA_TRAFFIC_SOURCES_METRICS = ','.join([
    'ym:s:visits',
    'ym:s:users',
    'ym:s:newUsers',
    'ym:s:pageviews',
    'ym:s:bounceRate',
    'ym:s:avgVisitDurationSeconds',
    'ym:s:pageDepth',
])
METRIKA_PAGES_DIMS = 'ym:pv:URL,ym:pv:title'
METRIKA_PAGES_METRICS = ','.join([
    'ym:pv:pageviews',
    'ym:pv:users',
])
METRIKA_ENTRY_PAGES_DIMS = 'ym:s:startURL'
METRIKA_ENTRY_PAGES_METRICS = ','.join([
    'ym:s:visits',
    'ym:s:users',
    'ym:s:pageviews',
    'ym:s:bounceRate',
    'ym:s:avgVisitDurationSeconds',
    'ym:s:pageDepth',
])
METRIKA_USER_BEHAVIOR_DIMS = ','.join([
    'ym:s:paramsLevel2',
    'ym:s:endURL',
    'ym:s:lastTrafficSource',
    'ym:s:startURL',
])
METRIKA_USER_BEHAVIOR_METRICS = ','.join([
    'ym:s:visits',
    'ym:s:pageDepth',
    'ym:s:avgVisitDurationSeconds',
    'ym:s:bounceRate',
    'ym:s:newUsers',
    'ym:s:users',
    'ym:s:upToDayUserRecencyPercentage',
    'ym:s:upToWeekUserRecencyPercentage',
    'ym:s:upToMonthUserRecencyPercentage',
])
METRIKA_RELEASE_USER_BEHAVIOR_METRICS = ','.join([
    METRIKA_USER_BEHAVIOR_METRICS,
    'ym:s:pageviews',
])
USER_BEHAVIOR_SCOPE_LOGICAL = 'user_behavior'
METRIKA_RETURNING_DIMENSION = 'ym:s:endURL'
METRIKA_RETURNING_METRICS = ','.join([
    'ym:s:visits',
    'ym:s:upToDayUserRecencyPercentage',
    'ym:s:upToWeekUserRecencyPercentage',
    'ym:s:upToMonthUserRecencyPercentage',
])


class MetrikaCollectionError(RuntimeError):
    """Sanitized failure raised before an Abbott day can be published."""


@dataclass(frozen=True)
class MetrikaScopeResult:
    scope: str
    rows: tuple[dict, ...]
    api_total_rows: int | None
    persisted_rows: int
    sampled: bool
    sample_share: float | None
    pagination_complete: bool
    status: str
    request_fingerprint: str


@dataclass(frozen=True)
class MetrikaDayBundle:
    canonical_release_id: int
    counter_id: str
    report_date: str
    run_id: int
    scopes: Mapping[str, MetrikaScopeResult]

LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('yandex_metrika_canonical')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date-from', default='')
    parser.add_argument('--date-to', default='')
    parser.add_argument('--days-back', type=int, default=14)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
    parser.add_argument('--counter-id', default='')
    parser.add_argument('--counter-ids', default='')
    parser.add_argument('--canonical-release-id', type=int)
    parser.add_argument('--code-revision', default='')
    parser.add_argument('--parser-version', default='')
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


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def safe_int(value: Any) -> int:
    try:
        return max(int(round(float(value or 0))), 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    try:
        return max(float(value or 0), 0.0)
    except (TypeError, ValueError):
        return 0.0


def parse_csv_values(value: str) -> list[str]:
    result: list[str] = []
    for item in str(value or '').replace('\n', ',').split(','):
        item = item.strip()
        if item and item not in result:
            result.append(item)
    return result


def selected_counter_ids(args) -> list[str]:
    result: list[str] = []
    for item in parse_csv_values(getattr(args, 'counter_ids', '')):
        counter_id = ''.join(ch for ch in item if ch.isdigit())
        if counter_id and counter_id not in result:
            result.append(counter_id)
    counter_id = ''.join(ch for ch in str(getattr(args, 'counter_id', '') or '') if ch.isdigit())
    if counter_id and counter_id not in result:
        result.insert(0, counter_id)
    return result


def metric_value(metrics: list[Any], index: int) -> float:
    if index >= len(metrics):
        return 0.0
    try:
        return float(metrics[index] or 0)
    except (TypeError, ValueError):
        return 0.0


def fetch_active_counters() -> list[dict]:
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            """
            SELECT counter_id, name, active, params
            FROM yandex_metrika_names
            WHERE active = 1
            ORDER BY counter_id
            """
        )
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


def fetch_configured_counters(run_type: str, counter_ids: list[str] | None = None) -> list[dict]:
    selected_ids = set(counter_ids or [])
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor(dictionary=True)
    try:
        try:
            cur.execute(
                """
                SELECT
                    n.counter_id,
                    n.name,
                    COALESCE(n.params, 0) AS legacy_params_enabled,
                    n.active AS legacy_active,
                    COALESCE(s.is_active, n.active, 1) AS is_active,
                    COALESCE(s.cron_enabled, 1) AS cron_enabled,
                    COALESCE(NULLIF(s.collection_mode, ''), %s) AS collection_mode,
                    CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS settings_exists
                FROM yandex_metrika_names n
                LEFT JOIN canonical_source_account_collection_settings s
                  ON s.source_key = %s
                 AND s.platform_account_id = CAST(n.counter_id AS CHAR)
                WHERE COALESCE(s.is_active, n.active, 1) = 1
                  AND (%s <> 'cron' OR COALESCE(s.cron_enabled, 1) = 1)
                ORDER BY n.counter_id
                """,
                (DEFAULT_COLLECTION_MODE, SOURCE_KEY, run_type),
            )
            rows = cur.fetchall()
            if selected_ids:
                rows = [row for row in rows if clean_text(row.get('counter_id')) in selected_ids]
            for row in rows:
                collection_mode = clean_text(row.get('collection_mode')) or DEFAULT_COLLECTION_MODE
                row['collection_mode'] = (
                    collection_mode if collection_mode in SUPPORTED_COLLECTION_MODES else DEFAULT_COLLECTION_MODE
                )
                row['legacy_params_enabled'] = safe_int(row.get('legacy_params_enabled'))
            return rows
        except mysql.connector.Error as exc:
            if exc.errno != 1146:
                raise
            log.warning(
                'Collection settings table is missing; falling back to legacy active counter list for %s',
                SOURCE_KEY,
            )
            rows = fetch_active_counters()
            if selected_ids:
                rows = [row for row in rows if clean_text(row.get('counter_id')) in selected_ids]
            for row in rows:
                row['legacy_active'] = row.get('active', 1)
                row['is_active'] = 1
                row['cron_enabled'] = 1
                row['collection_mode'] = DEFAULT_COLLECTION_MODE
                row['legacy_params_enabled'] = safe_int(row.get('params'))
                row['settings_exists'] = 0
            return rows
    finally:
        cur.close()
        conn.close()


def render_attribution(value: str) -> str:
    attribution = clean_text(value) or 'last'
    return attribution


def build_scope_hash(scope_key: str, parts: list[str]) -> str:
    payload = '|'.join([scope_key] + parts)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def clean_dimension_name(value: Any) -> str | None:
    text = clean_text(value)
    return text or None


def has_any_utm_value(*values: str | None) -> bool:
    return any(clean_text(value) for value in values)


def request_with_retry(
    counter_id: str,
    day: str,
    *,
    dimensions: str,
    metrics: str,
    attribution: str,
    extra_params: dict[str, Any] | None = None,
) -> dict:
    headers = {'Authorization': f'OAuth {METRIKA_TOKEN}'}
    params = {
        'ids': counter_id,
        'group': 'day',
        'dimensions': dimensions.replace('<attribution>', render_attribution(attribution)),
        'metrics': metrics,
        'attribution': attribution,
        'limit': str(METRIKA_PAGE_LIMIT),
        'date1': day,
        'date2': day,
    }
    if extra_params:
        params.update(extra_params)
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        if REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
        response = requests.get(METRIKA_STATS_URL, headers=headers, params=params, timeout=TIMEOUT)
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()
        if attempt == MAX_RETRIES:
            response.raise_for_status()
        retry_after = response.headers.get('Retry-After')
        try:
            retry_after_seconds = max(float(retry_after or 0), 0)
        except ValueError:
            retry_after_seconds = 0
        time.sleep(max(sleep_for, retry_after_seconds))
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f'Metrika retry loop exhausted for counter {counter_id} day {day}')


def _request_page_fetcher(
    counter_id: str,
    day: str,
    *,
    dimensions: str,
    metrics: str,
    attribution: str,
    extra_params: dict[str, Any] | None = None,
) -> Callable[[int], dict]:
    def fetch_page(offset: int) -> dict:
        page_params = dict(extra_params or {})
        page_params.update({'limit': str(METRIKA_PAGE_LIMIT), 'offset': str(offset)})
        return request_with_retry(
            counter_id,
            day,
            dimensions=dimensions,
            metrics=metrics,
            attribution=attribution,
            extra_params=page_params,
        )

    return fetch_page


def request_all_pages(
    counter_id: str,
    day: str,
    *,
    dimensions: str,
    metrics: str,
    attribution: str,
    extra_params: dict[str, Any] | None = None,
) -> PaginationResult:
    return collect_all_pages(
        _request_page_fetcher(
            counter_id,
            day,
            dimensions=dimensions,
            metrics=metrics,
            attribution=attribution,
            extra_params=extra_params,
        )
    )


def request_all_rows(
    counter_id: str,
    day: str,
    *,
    dimensions: str,
    metrics: str,
    attribution: str,
    extra_params: dict[str, Any] | None = None,
) -> dict:
    rows = collect_all_rows(
        _request_page_fetcher(
            counter_id,
            day,
            dimensions=dimensions,
            metrics=metrics,
            attribution=attribution,
            extra_params=extra_params,
        )
    )
    return {'data': rows}


def extract_rows(data: dict) -> list[dict]:
    if not isinstance(data, dict):
        return []
    rows = data.get('data')
    if isinstance(rows, list):
        return rows
    return []


def build_utm_ads_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    rows: list[dict] = []
    for item in extract_rows(response):
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        utm_source = clean_dimension_name(dimensions[0].get('name') if len(dimensions) > 0 and isinstance(dimensions[0], dict) else None)
        utm_medium = clean_dimension_name(dimensions[1].get('name') if len(dimensions) > 1 and isinstance(dimensions[1], dict) else None)
        utm_campaign = clean_dimension_name(dimensions[2].get('name') if len(dimensions) > 2 and isinstance(dimensions[2], dict) else None)
        if not has_any_utm_value(utm_source, utm_medium, utm_campaign):
            continue
        scope_hash = build_scope_hash(
            UTM_ADS_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                utm_source or '',
                utm_medium or '',
                utm_campaign or '',
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'analytics_scope': UTM_ADS_SCOPE_STORAGE,
                'scope_hash': scope_hash,
                'utm_source': utm_source,
                'utm_medium': utm_medium,
                'utm_campaign': utm_campaign,
                'visits': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'new_users': safe_int(metric_value(metrics, 2)),
                'pageviews': safe_int(metric_value(metrics, 3)),
                'bounce_rate': safe_float(metric_value(metrics, 4)),
                'avg_visit_duration_seconds': safe_float(metric_value(metrics, 5)),
                'page_depth': safe_float(metric_value(metrics, 6)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def build_goals_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    rows: list[dict] = []
    for item in extract_rows(response):
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        utm_source = clean_dimension_name(dimensions[0].get('name') if len(dimensions) > 0 and isinstance(dimensions[0], dict) else None)
        utm_medium = clean_dimension_name(dimensions[1].get('name') if len(dimensions) > 1 and isinstance(dimensions[1], dict) else None)
        utm_campaign = clean_dimension_name(dimensions[2].get('name') if len(dimensions) > 2 and isinstance(dimensions[2], dict) else None)
        if not has_any_utm_value(utm_source, utm_medium, utm_campaign):
            continue
        goal_dim = dimensions[3] if len(dimensions) > 3 and isinstance(dimensions[3], dict) else {}
        goal_id = clean_text(goal_dim.get('id'))
        goal_name = clean_dimension_name(goal_dim.get('name'))
        if not goal_id:
            continue
        scope_hash = build_scope_hash(
            GOALS_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                utm_source or '',
                utm_medium or '',
                utm_campaign or '',
                goal_id,
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'analytics_scope': GOALS_SCOPE_STORAGE,
                'scope_hash': scope_hash,
                'utm_source': utm_source,
                'utm_medium': utm_medium,
                'utm_campaign': utm_campaign,
                'goal_id': goal_id,
                'goal_name': goal_name,
                'goal_reaches': safe_int(metric_value(metrics, 0)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def build_traffic_sources_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    rows: list[dict] = []
    for item in extract_rows(response):
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        traffic_dim = dimensions[0] if len(dimensions) > 0 and isinstance(dimensions[0], dict) else {}
        traffic_source = clean_dimension_name(traffic_dim.get('name'))
        if not traffic_source:
            continue
        scope_hash = build_scope_hash(
            TRAFFIC_SOURCES_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                traffic_source,
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'analytics_scope': TRAFFIC_SOURCES_SCOPE_STORAGE,
                'scope_hash': scope_hash,
                'traffic_source': traffic_source,
                'visits': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'new_users': safe_int(metric_value(metrics, 2)),
                'pageviews': safe_int(metric_value(metrics, 3)),
                'bounce_rate': safe_float(metric_value(metrics, 4)),
                'avg_visit_duration_seconds': safe_float(metric_value(metrics, 5)),
                'page_depth': safe_float(metric_value(metrics, 6)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def build_page_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    rows: list[dict] = []
    for item in extract_rows(response):
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        url_dim = dimensions[0] if len(dimensions) > 0 and isinstance(dimensions[0], dict) else {}
        title_dim = dimensions[1] if len(dimensions) > 1 and isinstance(dimensions[1], dict) else {}
        page_url = clean_dimension_name(url_dim.get('name'))
        page_title = clean_dimension_name(title_dim.get('name'))
        if not page_url and not page_title:
            continue
        scope_hash = build_scope_hash(
            PAGES_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                page_url or '',
                page_title or '',
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'analytics_scope': PAGES_SCOPE_STORAGE,
                'scope_hash': scope_hash,
                'page_url': page_url,
                'page_title': page_title,
                'pageviews': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def build_entry_page_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    response_rows = extract_rows(response)
    total_rows = safe_int(response.get('total_rows'))
    if total_rows > len(response_rows):
        raise RuntimeError(
            'incomplete Metrika entry-page response '
            f'for counter {counter_id} day {day}: reported total_rows={total_rows}, '
            f'returned_rows={len(response_rows)}, limit={METRIKA_API_ROW_LIMIT}'
        )
    rows: list[dict] = []
    for item in response_rows:
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        url_dim = dimensions[0] if len(dimensions) > 0 and isinstance(dimensions[0], dict) else {}
        page_url = clean_dimension_name(url_dim.get('name'))
        if not page_url:
            continue
        scope_hash = build_scope_hash(
            ENTRY_PAGES_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                page_url,
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'analytics_scope': ENTRY_PAGES_SCOPE_STORAGE,
                'scope_hash': scope_hash,
                'page_url': page_url,
                'page_title': None,
                'visits': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'pageviews': safe_int(metric_value(metrics, 2)),
                'bounce_rate': safe_float(metric_value(metrics, 3)),
                'avg_visit_duration_seconds': safe_float(metric_value(metrics, 4)),
                'page_depth': safe_float(metric_value(metrics, 5)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def should_collect_user_behavior(counter: dict) -> bool:
    collection_mode = clean_text(counter.get('collection_mode')) or DEFAULT_COLLECTION_MODE
    return collection_mode == 'ads_plus_seo_plus_user_behavior' or safe_int(counter.get('legacy_params_enabled')) == 1


def build_user_behavior_rows(counter_id: str, day: str, response: dict, run_id: int) -> list[dict]:
    rows: list[dict] = []
    for item in extract_rows(response):
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        user_id = clean_dimension_name(dimensions[0].get('name') if len(dimensions) > 0 and isinstance(dimensions[0], dict) else None)
        end_url = clean_dimension_name(dimensions[1].get('name') if len(dimensions) > 1 and isinstance(dimensions[1], dict) else None)
        traffic_dim = dimensions[2] if len(dimensions) > 2 and isinstance(dimensions[2], dict) else {}
        traffic_source_id = clean_dimension_name(traffic_dim.get('icon_id'))
        traffic_source = clean_dimension_name(traffic_dim.get('name'))
        start_url = clean_dimension_name(dimensions[3].get('name') if len(dimensions) > 3 and isinstance(dimensions[3], dict) else None)
        if not user_id:
            continue
        scope_hash = build_scope_hash(
            USER_BEHAVIOR_SCOPE_LOGICAL,
            [
                counter_id,
                day,
                user_id,
                traffic_source_id or '',
                traffic_source or '',
                start_url or '',
                end_url or '',
            ],
        )
        rows.append(
            {
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'report_date': day,
                'scope_hash': scope_hash,
                'user_id': user_id,
                'traffic_source_id': traffic_source_id,
                'traffic_source': traffic_source,
                'start_url': start_url,
                'end_url': end_url,
                'visits': safe_int(metric_value(metrics, 0)),
                'page_depth': safe_float(metric_value(metrics, 1)),
                'avg_visit_duration_seconds': safe_float(metric_value(metrics, 2)),
                'bounce_rate': safe_float(metric_value(metrics, 3)),
                'new_users': safe_int(metric_value(metrics, 4)),
                'users': safe_int(metric_value(metrics, 5)),
                'up_to_day_user_recency_percentage': safe_float(metric_value(metrics, 6)),
                'up_to_week_user_recency_percentage': safe_float(metric_value(metrics, 7)),
                'up_to_month_user_recency_percentage': safe_float(metric_value(metrics, 8)),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _raw_dimension_value(value: Any) -> str:
    return '' if value is None else str(value)


def normalize_metrika_page(raw_url: str) -> str:
    value = html.unescape(clean_text(raw_url))
    if not value:
        return ''
    try:
        parsed = urlsplit(value)
        if parsed.scheme and parsed.netloc:
            path = parsed.path.rstrip('/') or '/'
            return f'{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}'
    except ValueError:
        pass
    without_fragment = value.split('#', 1)[0]
    without_query = without_fragment.split('?', 1)[0]
    return without_query.rstrip('/') or value


def _required_returning_metrics(metrics: Any) -> tuple[int, Decimal, Decimal, Decimal]:
    if not isinstance(metrics, (list, tuple)):
        raise MetrikaCollectionError('Returning metrics are invalid')
    if len(metrics) < 4:
        raise MetrikaCollectionError('Returning metrics are incomplete')
    values: list[Decimal] = []
    for raw_value in metrics[:4]:
        if raw_value is None or isinstance(raw_value, bool):
            raise MetrikaCollectionError('Returning metric is invalid')
        try:
            value = Decimal(str(raw_value))
        except (InvalidOperation, ValueError):
            raise MetrikaCollectionError('Returning metric is invalid') from None
        if not value.is_finite() or value < 0:
            raise MetrikaCollectionError('Returning metric is invalid')
        values.append(value)
    visits = values[0]
    if visits != visits.to_integral_value():
        raise MetrikaCollectionError('Returning visits metric is invalid')
    return int(visits), values[1], values[2], values[3]


def _release_site_rows(
    counter_id: str,
    day: str,
    scope: str,
    response: PaginationResult,
    run_id: int,
    release_id: int,
    *,
    user_id_presence: str | None = None,
) -> list[dict]:
    rows: list[dict] = []
    for item in response.rows:
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        if scope == 'other':
            if user_id_presence not in dict(ABBOTT_OTHER_SEGMENTS):
                raise MetrikaCollectionError('Other scope User ID presence is invalid')
            traffic = dimensions[0] if dimensions and isinstance(dimensions[0], dict) else {}
            traffic_source = clean_dimension_name(traffic.get('name'))
            if not traffic_source:
                continue
            scope_dimensions = {
                'traffic_source': traffic_source,
                'traffic_source_id': clean_dimension_name(traffic.get('id')),
                'user_id_presence': user_id_presence,
            }
            values = {
                'sessions': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'pageviews': safe_int(metric_value(metrics, 3)),
                'bounce_rate': safe_float(metric_value(metrics, 4)),
                'average_session_seconds': safe_float(metric_value(metrics, 5)),
                'goal_conversions': None,
            }
        elif scope == 'traffic':
            dimension_values = [
                clean_dimension_name(value.get('name')) if isinstance(value, dict) else None
                for value in dimensions[:3]
            ]
            while len(dimension_values) < 3:
                dimension_values.append(None)
            if not has_any_utm_value(*dimension_values):
                continue
            scope_dimensions = dict(
                zip(('utm_source', 'utm_medium', 'utm_campaign'), dimension_values)
            )
            values = {
                'sessions': safe_int(metric_value(metrics, 0)),
                'users': safe_int(metric_value(metrics, 1)),
                'pageviews': safe_int(metric_value(metrics, 3)),
                'bounce_rate': safe_float(metric_value(metrics, 4)),
                'average_session_seconds': safe_float(metric_value(metrics, 5)),
                'goal_conversions': None,
            }
        elif scope == 'page':
            raw_url = clean_dimension_name(
                dimensions[0].get('name')
                if len(dimensions) > 0 and isinstance(dimensions[0], dict)
                else None
            )
            page_title = clean_dimension_name(
                dimensions[1].get('name')
                if len(dimensions) > 1 and isinstance(dimensions[1], dict)
                else None
            )
            if not raw_url and not page_title:
                continue
            scope_dimensions = {'page_url': raw_url, 'page_title': page_title}
            values = {
                'sessions': 0,
                'users': safe_int(metric_value(metrics, 1)),
                'pageviews': safe_int(metric_value(metrics, 0)),
                'bounce_rate': None,
                'average_session_seconds': None,
                'goal_conversions': None,
            }
        else:
            raise MetrikaCollectionError('Unsupported Metrika site scope')

        scope_hash = build_scope_hash(
            scope,
            [counter_id, day] + [clean_text(value) for value in scope_dimensions.values()],
        )
        rows.append(
            {
                'canonical_release_id': release_id,
                'source_key': SOURCE_KEY,
                'analytics_account_id': counter_id,
                'counter_id': counter_id,
                'report_date': day,
                'analytics_scope': scope,
                'scope_hash': scope_hash,
                'scope_dimensions': scope_dimensions,
                **values,
                'raw_payload': item,
                'ingestion_run_id': run_id,
            }
        )
    return rows


def _release_user_behavior_rows(
    counter_id: str,
    day: str,
    response: PaginationResult,
    run_id: int,
    release_id: int,
) -> list[dict]:
    rows: list[dict] = []
    for item in response.rows:
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        raw_user_id = _raw_dimension_value(
            dimensions[0].get('name')
            if len(dimensions) > 0 and isinstance(dimensions[0], dict)
            else None
        )
        if not raw_user_id:
            continue
        end_url = _raw_dimension_value(
            dimensions[1].get('name')
            if len(dimensions) > 1 and isinstance(dimensions[1], dict)
            else None
        )
        start_url = _raw_dimension_value(
            dimensions[3].get('name')
            if len(dimensions) > 3 and isinstance(dimensions[3], dict)
            else None
        )
        traffic = dimensions[2] if len(dimensions) > 2 and isinstance(dimensions[2], dict) else {}
        request_fingerprint = build_scope_hash(
            'user_behavior',
            [
                counter_id,
                day,
                raw_user_id,
                start_url,
                end_url,
                clean_text(traffic.get('id') or traffic.get('icon_id')),
            ],
        )
        rows.append(
            {
                'canonical_release_id': release_id,
                'counter_id': counter_id,
                'report_date': day,
                'raw_user_id': raw_user_id,
                'raw_user_id_hash': _sha256(raw_user_id),
                'start_url': start_url,
                'start_url_hash': _sha256(start_url),
                'end_url': end_url,
                'end_url_hash': _sha256(end_url),
                'visit_id': None,
                'session_started_at': None,
                'session_ended_at': None,
                'pageviews': safe_int(metric_value(metrics, 9)),
                'request_fingerprint': request_fingerprint,
                'ingestion_run_id': run_id,
            }
        )
    return rows


_METRIKA_VISIT_KEYS = frozenset(
    (
        'visit_id',
        'date_time',
        'start_url',
        'end_url',
        'page_views',
        'visit_duration',
        'bounce',
        'client_id',
        'traffic_source',
        'raw_user_id',
    )
)


def _collect_metrika_visits(
    counter_id: str,
    day: str,
    client_factory: Callable[[str], Any] | None = None,
) -> tuple[dict, ...]:
    if counter_id != ABBOTT_COUNTER_ID:
        raise MetrikaCollectionError('Abbott release collection requires the Abbott counter')
    try:
        parsed_day = datetime.strptime(day, '%Y-%m-%d')
    except (TypeError, ValueError):
        raise MetrikaCollectionError('Metrika Logs collection day is invalid') from None
    if parsed_day.strftime('%Y-%m-%d') != day:
        raise MetrikaCollectionError('Metrika Logs collection day is invalid')

    try:
        client = (client_factory or MetrikaLogsClient)(METRIKA_TOKEN)
        visits = client.collect_visits(counter_id, day, 'lastsign')
    except MetrikaLogsError:
        raise MetrikaCollectionError(
            'Metrika Logs user behavior collection failed'
        ) from None
    if not isinstance(visits, (list, tuple)):
        raise MetrikaCollectionError('Metrika Logs visit collection is invalid')
    return tuple(visits)


def _release_metrika_visit_rows(
    counter_id: str,
    day: str,
    visits: Collection[Mapping[str, Any]],
    run_id: int,
    release_id: int,
    request_fingerprint: str,
) -> list[dict]:
    rows: list[dict] = []
    for visit in visits:
        if not isinstance(visit, Mapping) or not _METRIKA_VISIT_KEYS.issubset(visit):
            raise MetrikaCollectionError('Metrika Logs visit row is incomplete')

        visit_id = visit['visit_id']
        date_time = visit['date_time']
        start_url = visit['start_url']
        end_url = visit['end_url']
        page_views = visit['page_views']
        visit_duration = visit['visit_duration']
        bounce = visit['bounce']
        client_id = visit['client_id']
        traffic_source = visit['traffic_source']
        raw_user_id = visit['raw_user_id']
        if (
            not isinstance(visit_id, str)
            or not visit_id.strip()
            or not isinstance(date_time, str)
            or not isinstance(start_url, str)
            or not isinstance(end_url, str)
            or not isinstance(client_id, str)
            or not isinstance(traffic_source, str)
            or not traffic_source.strip()
            or (raw_user_id is not None and not isinstance(raw_user_id, str))
            or isinstance(page_views, bool)
            or not isinstance(page_views, int)
            or page_views < 0
            or isinstance(visit_duration, bool)
            or not isinstance(visit_duration, int)
            or visit_duration < 0
            or isinstance(bounce, bool)
            or not isinstance(bounce, int)
            or bounce not in (0, 1)
        ):
            raise MetrikaCollectionError('Metrika Logs visit row is invalid')
        try:
            session_started_at = datetime.strptime(date_time, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            raise MetrikaCollectionError('Metrika Logs visit row is invalid') from None
        if session_started_at.strftime('%Y-%m-%d') != day:
            raise MetrikaCollectionError('Metrika Logs visit row is invalid')

        visit_id_hash = _sha256(visit_id)
        rows.append(
            {
                'canonical_release_id': release_id,
                'counter_id': counter_id,
                'report_date': day,
                'visit_id': visit_id,
                'visit_id_hash': visit_id_hash,
                'client_id_hash': _sha256(client_id) if client_id.strip() else None,
                'raw_user_id': raw_user_id,
                'raw_user_id_hash': (
                    _sha256(raw_user_id) if raw_user_id is not None else None
                ),
                'traffic_source': traffic_source,
                'start_url': start_url,
                'start_url_hash': _sha256(start_url),
                'end_url': end_url,
                'end_url_hash': _sha256(end_url),
                'session_started_at': session_started_at,
                'session_ended_at': session_started_at + timedelta(seconds=visit_duration),
                'pageviews': page_views,
                'duration_seconds': visit_duration,
                'is_bounce': bounce,
                'request_fingerprint': build_scope_hash(
                    'user_behavior', [request_fingerprint, visit_id_hash]
                ),
                'ingestion_run_id': run_id,
            }
        )
    return rows


def collect_user_behavior_scope(
    counter_id: str,
    day: str,
    run_id: int,
    release_id: int,
    *,
    code_revision: str,
    parser_version: str,
    logs_client_factory: Callable[[str], Any] | None = None,
) -> MetrikaScopeResult:
    request_fingerprint = build_scope_hash(
        'user_behavior',
        [
            counter_id,
            day,
            'source=visits',
            ','.join(VISIT_FIELDS),
            'lastsign',
            METRIKA_TIMEZONE,
            code_revision,
            parser_version,
        ],
    )
    visits = _collect_metrika_visits(counter_id, day, logs_client_factory)
    rows = _release_metrika_visit_rows(
        counter_id,
        day,
        visits,
        run_id,
        release_id,
        request_fingerprint,
    )
    row_count = len(rows)
    return MetrikaScopeResult(
        scope='user_behavior',
        rows=tuple(rows),
        api_total_rows=row_count,
        persisted_rows=row_count,
        sampled=False,
        sample_share=None,
        pagination_complete=True,
        status='success' if rows else 'success_empty',
        request_fingerprint=request_fingerprint,
    )


def build_returning_rows(
    counter_id: str,
    day: str,
    response: PaginationResult,
    run_id: int,
    release_id: int,
) -> list[dict]:
    labels = ('Next day', 'Days 2-7', 'Days 8-31')
    rows: list[dict] = []
    for item in response.rows:
        dimensions = item.get('dimensions') or []
        metrics = item.get('metrics') or []
        if not isinstance(dimensions, (list, tuple)) or not dimensions:
            raise MetrikaCollectionError('Returning page dimension is missing')
        page_dimension = dimensions[0]
        if not isinstance(page_dimension, dict):
            raise MetrikaCollectionError('Returning page dimension is invalid')
        raw_value = page_dimension.get('name')
        if not isinstance(raw_value, str) or not raw_value.strip():
            raise MetrikaCollectionError('Returning page value is invalid')
        raw_page = raw_value
        normalized_page = normalize_metrika_page(raw_page)
        if not normalized_page:
            raise MetrikaCollectionError('Returning page value is not representable')
        denominator, *percentages = _required_returning_metrics(metrics)
        request_fingerprint = build_scope_hash(
            'returning', [counter_id, day, raw_page]
        )
        for bucket, label, percentage in zip(RETURN_BUCKETS, labels, percentages):
            rows.append(
                {
                    'canonical_release_id': release_id,
                    'counter_id': counter_id,
                    'report_date': day,
                    'raw_page_value': raw_page,
                    'raw_page_hash': _sha256(raw_page),
                    'normalized_page': normalized_page,
                    'normalized_page_hash': _sha256(normalized_page),
                    'return_bucket_code': bucket,
                    'return_bucket_label': label,
                    'source_percentage': percentage,
                    'source_denominator': denominator,
                    'derived_count': None,
                    'is_derived': 0,
                    'request_fingerprint': request_fingerprint,
                    'ingestion_run_id': run_id,
                }
            )
    return rows


def _scope_request(scope: str) -> tuple[str, str, str, dict[str, Any]]:
    requests_by_scope = {
        'other': (
            METRIKA_TRAFFIC_SOURCES_DIMS,
            METRIKA_TRAFFIC_SOURCES_METRICS,
            'lastsign',
            {'accuracy': 'full'},
        ),
        'traffic': (
            METRIKA_UTM_ADS_DIMS,
            METRIKA_UTM_ADS_METRICS,
            METRIKA_UTM_ADS_ATTRIBUTION,
            {'accuracy': 'full'},
        ),
        'page': (
            METRIKA_PAGES_DIMS,
            METRIKA_PAGES_METRICS,
            METRIKA_ATTRIBUTION,
            {'accuracy': 'full'},
        ),
        'user_behavior': (
            METRIKA_USER_BEHAVIOR_DIMS,
            METRIKA_RELEASE_USER_BEHAVIOR_METRICS,
            METRIKA_ATTRIBUTION,
            {'accuracy': 'full'},
        ),
        'returning': (
            METRIKA_RETURNING_DIMENSION,
            METRIKA_RETURNING_METRICS,
            METRIKA_ATTRIBUTION,
            {'accuracy': 'full', 'lang': 'en'},
        ),
    }
    try:
        return requests_by_scope[scope]
    except KeyError:
        raise MetrikaCollectionError('Unsupported Metrika scope') from None


def validate_other_user_id_partitions(rows: Collection[Mapping[str, Any]]) -> None:
    presences = tuple(presence for presence, _ in ABBOTT_OTHER_SEGMENTS)
    totals = {presence: 0 for presence in presences}
    totals_by_source: dict[str, dict[str, int]] = {}
    for row in rows:
        scope_dimensions = row.get('scope_dimensions')
        if not isinstance(scope_dimensions, Mapping):
            raise MetrikaCollectionError('Other scope dimensions are invalid')
        presence = scope_dimensions.get('user_id_presence')
        source = scope_dimensions.get('traffic_source')
        sessions = row.get('sessions')
        if (
            presence not in totals
            or not isinstance(source, str)
            or not source
            or isinstance(sessions, bool)
            or not isinstance(sessions, int)
            or sessions < 0
        ):
            raise MetrikaCollectionError('Other scope partition row is invalid')
        totals[presence] += sessions
        source_totals = totals_by_source.setdefault(
            source, {segment: 0 for segment in presences}
        )
        source_totals[presence] += sessions

    if totals['all'] != totals['with_user_id'] + totals['without_user_id']:
        raise MetrikaCollectionError('Other scope User ID partitions do not reconcile')
    for source_totals in totals_by_source.values():
        if (
            source_totals['all']
            != source_totals['with_user_id'] + source_totals['without_user_id']
        ):
            raise MetrikaCollectionError(
                'Other scope User ID partitions do not reconcile by traffic source'
            )


def collect_other_scope(
    counter_id: str,
    day: str,
    run_id: int,
    release_id: int,
    *,
    code_revision: str,
    parser_version: str,
) -> MetrikaScopeResult:
    rows: list[dict] = []
    responses: list[PaginationResult] = []
    segment_fingerprints: list[str] = []
    for user_id_presence, filters in ABBOTT_OTHER_SEGMENTS:
        extra_params = {'accuracy': 'full', 'filters': filters}
        api_contract_fingerprint = api_fingerprint(
            dimensions=(METRIKA_TRAFFIC_SOURCES_DIMS,),
            metrics=parse_csv_values(METRIKA_TRAFFIC_SOURCES_METRICS),
            filters=filters,
            attribution='lastsign',
            accuracy='full',
            pagination_limit=METRIKA_PAGE_LIMIT,
            timezone=METRIKA_TIMEZONE,
            code_revision=code_revision,
            parser_version=parser_version,
        )
        segment_fingerprint = build_scope_hash(
            'other',
            [counter_id, day, user_id_presence, api_contract_fingerprint],
        )
        response = request_all_pages(
            counter_id,
            day,
            dimensions=METRIKA_TRAFFIC_SOURCES_DIMS,
            metrics=METRIKA_TRAFFIC_SOURCES_METRICS,
            attribution='lastsign',
            extra_params=extra_params,
        )
        segment_rows = _release_site_rows(
            counter_id,
            day,
            'other',
            response,
            run_id,
            release_id,
            user_id_presence=user_id_presence,
        )
        for row in segment_rows:
            row['scope_hash'] = build_scope_hash(
                'other', [segment_fingerprint, row['scope_hash']]
            )
        rows.extend(segment_rows)
        responses.append(response)
        segment_fingerprints.append(segment_fingerprint)

    sampled = any(response.sampled for response in responses)
    sample_shares = [
        response.sample_share
        for response in responses
        if response.sample_share is not None
    ]
    pagination_complete = all(
        response.pagination_complete and response.total_rows is not None
        for response in responses
    )
    api_total_rows = (
        sum(response.total_rows for response in responses if response.total_rows is not None)
        if all(response.total_rows is not None for response in responses)
        else None
    )
    if sampled:
        status = 'sampled'
    elif not pagination_complete or api_total_rows is None:
        status = 'partial'
    elif api_total_rows == 0 and not rows:
        status = 'success_empty'
    elif api_total_rows > 0 and rows:
        status = 'success'
    else:
        status = 'partial'
    if status in ('success', 'success_empty'):
        validate_other_user_id_partitions(rows)
    return MetrikaScopeResult(
        scope='other',
        rows=tuple(rows),
        api_total_rows=api_total_rows,
        persisted_rows=len(rows),
        sampled=sampled,
        sample_share=min(sample_shares) if sample_shares else None,
        pagination_complete=pagination_complete,
        status=status,
        request_fingerprint=build_scope_hash(
            'other', [counter_id, day] + segment_fingerprints
        ),
    )


def collect_metrika_scope(
    counter_id: str,
    day: str,
    scope: str,
    run_id: int,
    release_id: int,
    *,
    code_revision: str,
    parser_version: str,
    logs_client_factory: Callable[[str], Any] | None = None,
) -> MetrikaScopeResult:
    if scope == 'other':
        return collect_other_scope(
            counter_id,
            day,
            run_id,
            release_id,
            code_revision=code_revision,
            parser_version=parser_version,
        )
    if scope == 'user_behavior':
        return collect_user_behavior_scope(
            counter_id,
            day,
            run_id,
            release_id,
            code_revision=code_revision,
            parser_version=parser_version,
            logs_client_factory=logs_client_factory,
        )
    dimensions, metrics, attribution, extra_params = _scope_request(scope)
    rendered_dimensions = dimensions.replace(
        '<attribution>', render_attribution(attribution)
    )
    api_contract_fingerprint = api_fingerprint(
        dimensions=parse_csv_values(rendered_dimensions),
        metrics=parse_csv_values(metrics),
        filters=clean_text(extra_params.get('filters')),
        attribution=attribution,
        accuracy=clean_text(extra_params.get('accuracy')),
        pagination_limit=METRIKA_PAGE_LIMIT,
        timezone=METRIKA_TIMEZONE,
        code_revision=code_revision,
        parser_version=parser_version,
    )
    request_fingerprint = build_scope_hash(
        scope,
        [counter_id, day, api_contract_fingerprint],
    )
    response = request_all_pages(
        counter_id,
        day,
        dimensions=dimensions,
        metrics=metrics,
        attribution=attribution,
        extra_params=extra_params,
    )
    if scope in ('other', 'traffic', 'page'):
        rows = _release_site_rows(counter_id, day, scope, response, run_id, release_id)
    else:
        rows = build_returning_rows(counter_id, day, response, run_id, release_id)

    for row in rows:
        if scope in ('other', 'traffic', 'page'):
            row['scope_hash'] = build_scope_hash(
                scope, [request_fingerprint, row['scope_hash']]
            )
        elif scope in ('user_behavior', 'returning'):
            row['request_fingerprint'] = build_scope_hash(
                scope, [request_fingerprint, row['request_fingerprint']]
            )

    if response.sampled:
        status = 'sampled'
    elif not response.pagination_complete:
        status = 'partial'
    elif response.total_rows is None:
        status = 'partial'
    elif response.total_rows == 0 and not rows:
        status = 'success_empty'
    elif response.total_rows > 0 and rows:
        status = 'success'
    else:
        status = 'partial'
    return MetrikaScopeResult(
        scope=scope,
        rows=tuple(rows),
        api_total_rows=response.total_rows,
        persisted_rows=len(rows),
        sampled=response.sampled,
        sample_share=response.sample_share,
        pagination_complete=response.pagination_complete,
        status=status,
        request_fingerprint=request_fingerprint,
    )


def validate_day_bundle(
    bundle: MetrikaDayBundle,
    required_scopes: Collection[str],
) -> None:
    required = tuple(required_scopes)
    if bundle.counter_id != ABBOTT_COUNTER_ID:
        raise MetrikaCollectionError('Abbott release collection requires the Abbott counter')
    if (
        len(required) != len(ABBOTT_REQUIRED_SCOPES)
        or set(bundle.scopes) != set(required)
        or set(required) != set(ABBOTT_REQUIRED_SCOPES)
    ):
        raise MetrikaCollectionError('Abbott Metrika day requires exactly five scopes')
    for scope in required:
        result = bundle.scopes[scope]
        if result.scope != scope or result.persisted_rows != len(result.rows):
            raise MetrikaCollectionError('Metrika scope evidence is inconsistent')
        if result.sampled or not result.pagination_complete:
            raise MetrikaCollectionError('Metrika scope is not complete and unsampled')
        if result.status == 'success_empty':
            if result.api_total_rows != 0 or result.persisted_rows != 0 or result.rows:
                raise MetrikaCollectionError('Empty Metrika scope is not reconciled')
        elif result.status == 'success':
            if (
                result.api_total_rows is None
                or result.api_total_rows <= 0
                or not result.rows
                or result.api_total_rows > result.persisted_rows
                or (
                    scope == 'user_behavior'
                    and result.api_total_rows != result.persisted_rows
                )
            ):
                raise MetrikaCollectionError('Successful Metrika scope is not reconciled')
        else:
            raise MetrikaCollectionError('Metrika scope is not publishable')
        if not result.request_fingerprint:
            raise MetrikaCollectionError('Metrika request fingerprint is missing')


def collect_metrika_day(
    counter: dict,
    day: str,
    run_id: int,
    release_id: int,
    *,
    code_revision: str,
    parser_version: str,
) -> MetrikaDayBundle:
    counter_id = clean_text(counter.get('counter_id'))
    if counter_id != ABBOTT_COUNTER_ID:
        raise MetrikaCollectionError('Abbott release collection requires the Abbott counter')
    scopes = {
        scope: collect_metrika_scope(
            counter_id,
            day,
            scope,
            run_id,
            release_id,
            code_revision=code_revision,
            parser_version=parser_version,
        )
        for scope in ABBOTT_REQUIRED_SCOPES
    }
    bundle = MetrikaDayBundle(
        canonical_release_id=release_id,
        counter_id=counter_id,
        report_date=day,
        run_id=run_id,
        scopes=scopes,
    )
    validate_day_bundle(bundle, ABBOTT_REQUIRED_SCOPES)
    return bundle


def run_release_backfill(
    counters: list[dict],
    date_from: str,
    date_to: str,
    run_id: int,
    release_id: int,
    *,
    code_revision: str,
    parser_version: str,
) -> dict[str, Any]:
    counter_ids = [clean_text(counter.get('counter_id')) for counter in counters]
    if counter_ids != [ABBOTT_COUNTER_ID] or int(release_id) <= 0:
        raise MetrikaCollectionError(
            'Release collection requires one explicit Abbott counter and release ID'
        )
    published_days = 0
    rows_written = 0
    failed_days: list[str] = []
    failures: list[dict[str, str]] = []
    counter = counters[0]
    for day in daterange(date_from, date_to):
        try:
            bundle = collect_metrika_day(
                counter,
                day,
                run_id,
                release_id,
                code_revision=code_revision,
                parser_version=parser_version,
            )
            validate_day_bundle(bundle, ABBOTT_REQUIRED_SCOPES)
            result = publish_metrika_day_bundle(bundle)
            published_days += 1
            rows_written += int(getattr(result, 'rows_written', 0))
        except Exception as exc:
            failed_days.append(day)
            status_code = (
                exc.response.status_code
                if isinstance(exc, requests.exceptions.HTTPError)
                and exc.response is not None
                else None
            )
            failures.append(
                {
                    'report_date': day,
                    'error_class': exc.__class__.__name__,
                    'status': f'http_{status_code}' if status_code else 'failed',
                }
            )
    return {
        'counter_id': ABBOTT_COUNTER_ID,
        'canonical_release_id': release_id,
        'published_days': published_days,
        'failed_days': failed_days,
        'failures': failures,
        'rows_written': rows_written,
    }


def counter_filter_sql(counter_ids: list[str]) -> tuple[str, list[str]]:
    if not counter_ids:
        return '', []
    return f" AND analytics_account_id IN ({','.join(['%s'] * len(counter_ids))})", counter_ids


def delete_existing_scope_rows(date_from: str, date_to: str, counter_ids: list[str]):
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor()
    try:
        counter_clause, counter_params = counter_filter_sql(counter_ids)
        cur.execute(
            f"""
            DELETE FROM canonical_fact_site_analytics_daily
            WHERE source_key = %s
              AND report_date BETWEEN %s AND %s
              AND analytics_scope IN (%s, %s, %s, %s, %s)
              {counter_clause}
            """,
            (
                SOURCE_KEY,
                date_from,
                date_to,
                UTM_ADS_SCOPE_STORAGE,
                GOALS_SCOPE_STORAGE,
                TRAFFIC_SOURCES_SCOPE_STORAGE,
                PAGES_SCOPE_STORAGE,
                ENTRY_PAGES_SCOPE_STORAGE,
                *counter_params,
            ),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def ensure_user_behavior_table():
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS canonical_fact_user_behavior_daily (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                source_key VARCHAR(64) NOT NULL,
                analytics_account_id VARCHAR(128) NOT NULL DEFAULT '',
                report_date DATE NOT NULL,
                scope_hash CHAR(64) NOT NULL,
                user_id TEXT NOT NULL,
                traffic_source_id VARCHAR(64) DEFAULT NULL,
                traffic_source VARCHAR(255) DEFAULT NULL,
                start_url TEXT DEFAULT NULL,
                end_url TEXT DEFAULT NULL,
                visits BIGINT DEFAULT NULL,
                users BIGINT DEFAULT NULL,
                new_users BIGINT DEFAULT NULL,
                page_depth DECIMAL(18,6) DEFAULT NULL,
                bounce_rate DECIMAL(18,6) DEFAULT NULL,
                avg_visit_duration_seconds DECIMAL(18,6) DEFAULT NULL,
                up_to_day_user_recency_percentage DECIMAL(18,6) DEFAULT NULL,
                up_to_week_user_recency_percentage DECIMAL(18,6) DEFAULT NULL,
                up_to_month_user_recency_percentage DECIMAL(18,6) DEFAULT NULL,
                ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_canonical_fact_user_behavior_daily (
                    source_key,
                    analytics_account_id,
                    report_date,
                    scope_hash
                ),
                KEY idx_canonical_fact_user_behavior_daily_source_date (source_key, report_date),
                KEY idx_canonical_fact_user_behavior_daily_account_date (analytics_account_id, report_date),
                KEY idx_canonical_fact_user_behavior_daily_user_date (user_id(128), report_date),
                KEY idx_canonical_fact_user_behavior_daily_run (ingestion_run_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def delete_existing_user_behavior_rows(date_from: str, date_to: str, counter_ids: list[str]):
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor()
    try:
        counter_clause, counter_params = counter_filter_sql(counter_ids)
        cur.execute(
            f"""
            DELETE FROM canonical_fact_user_behavior_daily
            WHERE source_key = %s
              AND report_date BETWEEN %s AND %s
              {counter_clause}
            """,
            (SOURCE_KEY, date_from, date_to, *counter_params),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def build_payload(counters: list[dict], date_from: str, date_to: str, run_id: int) -> dict[str, Any]:
    account_rows: dict[str, dict] = {}
    utm_ads_rows: list[dict] = []
    goals_rows: list[dict] = []
    traffic_sources_rows: list[dict] = []
    page_rows: list[dict] = []
    entry_page_rows: list[dict] = []
    user_behavior_rows: list[dict] = []
    rows_read = 0
    api_empty_rows = 0
    skipped_counters: list[dict[str, str]] = []
    successful_counter_ids: list[str] = []
    collection_modes: dict[str, int] = {}

    for counter in counters:
        counter_id = clean_text(counter.get('counter_id'))
        counter_name = clean_text(counter.get('name')) or f'Yandex Metrika counter {counter_id}'
        collection_mode = clean_text(counter.get('collection_mode')) or DEFAULT_COLLECTION_MODE
        if collection_mode not in SUPPORTED_COLLECTION_MODES:
            collection_mode = DEFAULT_COLLECTION_MODE
        collection_modes[collection_mode] = collection_modes.get(collection_mode, 0) + 1
        collect_user_behavior = should_collect_user_behavior(counter)
        account_row = {
            'source_key': SOURCE_KEY,
            'platform_account_id': counter_id,
            'external_account_ref': counter_id,
            'account_name': counter_name,
            'advertiser_name': counter_name,
            'account_status': 'active',
            'timezone_name': 'Europe/Moscow',
            'first_seen_at': datetime.utcnow(),
            'last_seen_at': datetime.utcnow(),
            'raw_payload': {
                'counter_id': counter_id,
                'counter_name': counter_name,
                'account_type': 'metrika_counter',
                'collection_mode': collection_mode,
                'legacy_params_enabled': bool(safe_int(counter.get('legacy_params_enabled'))),
                'user_behavior_enabled': collect_user_behavior,
                'settings_exists': bool(counter.get('settings_exists')),
            },
        }

        counter_utm_ads_rows: list[dict] = []
        counter_goals_rows: list[dict] = []
        counter_traffic_sources_rows: list[dict] = []
        counter_page_rows: list[dict] = []
        counter_entry_page_rows: list[dict] = []
        counter_user_behavior_rows: list[dict] = []
        skip_counter = False
        for day in daterange(date_from, date_to):
            try:
                utm_ads_response = request_with_retry(
                    counter_id,
                    day,
                    dimensions=METRIKA_UTM_ADS_DIMS,
                    metrics=METRIKA_UTM_ADS_METRICS,
                    attribution=METRIKA_UTM_ADS_ATTRIBUTION,
                )
                goals_response = request_with_retry(
                    counter_id,
                    day,
                    dimensions=METRIKA_GOALS_DIMS,
                    metrics=METRIKA_GOALS_METRICS,
                    attribution=METRIKA_GOALS_ATTRIBUTION,
                    extra_params={'accuracy': 'full', 'pretty': 'true'},
                )
                traffic_sources_response = request_with_retry(
                    counter_id,
                    day,
                    dimensions=METRIKA_TRAFFIC_SOURCES_DIMS,
                    metrics=METRIKA_TRAFFIC_SOURCES_METRICS,
                    attribution=METRIKA_ATTRIBUTION,
                )
                pages_response = request_all_rows(
                    counter_id,
                    day,
                    dimensions=METRIKA_PAGES_DIMS,
                    metrics=METRIKA_PAGES_METRICS,
                    attribution=METRIKA_ATTRIBUTION,
                    extra_params={'accuracy': 'full'},
                )
                entry_pages_response = request_with_retry(
                    counter_id,
                    day,
                    dimensions=METRIKA_ENTRY_PAGES_DIMS,
                    metrics=METRIKA_ENTRY_PAGES_METRICS,
                    attribution=METRIKA_ATTRIBUTION,
                )
                user_behavior_response = None
                if collect_user_behavior:
                    user_behavior_response = request_with_retry(
                        counter_id,
                        day,
                        dimensions=METRIKA_USER_BEHAVIOR_DIMS,
                        metrics=METRIKA_USER_BEHAVIOR_METRICS,
                        attribution=METRIKA_ATTRIBUTION,
                    )
            except requests.exceptions.HTTPError as exc:
                status_code = exc.response.status_code if exc.response is not None else None
                if status_code in {403, 404}:
                    skipped_counters.append(
                        {
                            'counter_id': counter_id,
                            'counter_name': counter_name,
                            'reason': f'http_{status_code}',
                            'failed_day': day,
                            'collection_mode': collection_mode,
                        }
                    )
                    skip_counter = True
                    log.warning('Skip inaccessible Metrika counter %s (%s): http_%s on %s', counter_id, counter_name, status_code, day)
                    break
                raise
            rows_read += 6 if collect_user_behavior else 5
            utm_rows_for_day = build_utm_ads_rows(counter_id, day, utm_ads_response, run_id)
            goals_rows_for_day = build_goals_rows(counter_id, day, goals_response, run_id)
            traffic_sources_rows_for_day = build_traffic_sources_rows(counter_id, day, traffic_sources_response, run_id)
            page_rows_for_day = build_page_rows(counter_id, day, pages_response, run_id)
            entry_page_rows_for_day = build_entry_page_rows(counter_id, day, entry_pages_response, run_id)
            user_behavior_rows_for_day = (
                build_user_behavior_rows(counter_id, day, user_behavior_response, run_id)
                if user_behavior_response is not None
                else []
            )
            if not utm_rows_for_day and not goals_rows_for_day and not traffic_sources_rows_for_day and not page_rows_for_day and not entry_page_rows_for_day and not user_behavior_rows_for_day:
                api_empty_rows += 1
            counter_utm_ads_rows.extend(utm_rows_for_day)
            counter_goals_rows.extend(goals_rows_for_day)
            counter_traffic_sources_rows.extend(traffic_sources_rows_for_day)
            counter_page_rows.extend(page_rows_for_day)
            counter_entry_page_rows.extend(entry_page_rows_for_day)
            counter_user_behavior_rows.extend(user_behavior_rows_for_day)
        if not skip_counter:
            account_rows[counter_id] = account_row
            successful_counter_ids.append(counter_id)
            utm_ads_rows.extend(counter_utm_ads_rows)
            goals_rows.extend(counter_goals_rows)
            traffic_sources_rows.extend(counter_traffic_sources_rows)
            page_rows.extend(counter_page_rows)
            entry_page_rows.extend(counter_entry_page_rows)
            user_behavior_rows.extend(counter_user_behavior_rows)

    return {
        'accounts': list(account_rows.values()),
        'utm_ads_rows': utm_ads_rows,
        'goals_rows': goals_rows,
        'traffic_sources_rows': traffic_sources_rows,
        'page_rows': page_rows,
        'entry_page_rows': entry_page_rows,
        'user_behavior_rows': user_behavior_rows,
        'facts': utm_ads_rows + goals_rows + traffic_sources_rows + page_rows + entry_page_rows,
        'rows_read': rows_read,
        'api_empty_rows': api_empty_rows,
        'counters': len(account_rows),
        'skipped_counters': skipped_counters,
        'successful_counter_ids': successful_counter_ids,
        'collection_modes': collection_modes,
    }


def main() -> int:
    args = parse_args()
    if not METRIKA_TOKEN:
        raise RuntimeError('METRIKA_TOKEN is missing from env')

    date_from, date_to = date_range(args)
    target_counter_ids = selected_counter_ids(args)
    release_id = getattr(args, 'canonical_release_id', None)
    if release_id is not None and target_counter_ids != [ABBOTT_COUNTER_ID]:
        raise MetrikaCollectionError(
            '--canonical-release-id requires explicit --counter-id 90602537'
        )
    if release_id is not None and (
        not clean_text(args.code_revision) or not clean_text(args.parser_version)
    ):
        raise MetrikaCollectionError(
            '--canonical-release-id requires code and parser versions'
        )
    run_id = start_collector_run(
        source_key=SOURCE_KEY,
        run_type=args.run_type,
        run_mode='canonical_release' if release_id is not None else 'canonical_only',
        job_key=f'{SOURCE_KEY}_{args.run_type}',
        correlation_id=str(uuid.uuid4()),
        date_from=date_from,
        date_to=date_to,
    )

    rows_read = rows_written = rows_updated = 0
    try:
        if release_id is not None:
            counters = fetch_configured_counters(args.run_type, target_counter_ids)
            if [clean_text(counter.get('counter_id')) for counter in counters] != [ABBOTT_COUNTER_ID]:
                raise MetrikaCollectionError('The configured Abbott counter is unavailable')
            summary = run_release_backfill(
                counters,
                date_from,
                date_to,
                run_id,
                release_id,
                code_revision=clean_text(args.code_revision),
                parser_version=clean_text(args.parser_version),
            )
            rows_read = (summary['published_days'] + len(summary['failed_days'])) * len(
                ABBOTT_REQUIRED_SCOPES
            )
            rows_written = summary['rows_written']
            rows_updated = rows_written
            if summary['failed_days']:
                status = 'partial' if summary['published_days'] else 'failed'
                finish_collector_run(
                    run_id,
                    status=status,
                    rows_read=rows_read,
                    rows_written=rows_written,
                    rows_updated=rows_updated,
                    error_count=len(summary['failed_days']),
                    error_summary='One or more Abbott Metrika days were not published',
                )
                log_run_event(
                    run_id,
                    'ERROR',
                    'release_collection_incomplete',
                    'Abbott Metrika release collection did not publish every day',
                    summary,
                )
                return 1
            log_run_event(
                run_id,
                'INFO',
                'summary',
                'Abbott Metrika release collection completed',
                summary,
            )
            finish_collector_run(
                run_id,
                status='success',
                rows_read=rows_read,
                rows_written=rows_written,
                rows_updated=rows_updated,
                error_count=0,
                error_summary=None,
            )
            return 0

        ensure_user_behavior_table()
        counters = fetch_configured_counters(args.run_type, target_counter_ids)
        if target_counter_ids and not counters:
            raise RuntimeError(f'No active configured Metrika counters matched --counter-ids={",".join(target_counter_ids)}')
        payload = build_payload(counters, date_from, date_to, run_id)
        collected_counter_ids = payload['successful_counter_ids']
        if collected_counter_ids:
            delete_existing_scope_rows(date_from, date_to, collected_counter_ids)
            delete_existing_user_behavior_rows(date_from, date_to, collected_counter_ids)
        upsert_source_accounts(payload['accounts'])
        site_rows_written = upsert_fact_site_analytics_daily(payload['facts'])
        user_behavior_rows_written = upsert_fact_user_behavior_daily(payload['user_behavior_rows'])
        rows_written = site_rows_written + user_behavior_rows_written
        rows_updated = rows_written
        rows_read = payload['rows_read']
        log_run_event(
            run_id,
            'INFO',
            'summary',
            'Yandex Metrika canonical analytics sync completed',
            {
                'source_key': SOURCE_KEY,
                'date_from': date_from,
                'date_to': date_to,
                'counters': payload['counters'],
                'rows_read': rows_read,
                'rows_written': rows_written,
                'rows_updated': rows_updated,
                'api_empty_rows': payload['api_empty_rows'],
                'skipped_counters': payload['skipped_counters'],
                'target_counter_ids': target_counter_ids,
                'collected_counter_ids': collected_counter_ids,
                'logical_scopes': [UTM_ADS_SCOPE_LOGICAL, GOALS_SCOPE_LOGICAL, TRAFFIC_SOURCES_SCOPE_LOGICAL, PAGES_SCOPE_LOGICAL, ENTRY_PAGES_SCOPE_LOGICAL],
                'storage_scopes': [UTM_ADS_SCOPE_STORAGE, GOALS_SCOPE_STORAGE, TRAFFIC_SOURCES_SCOPE_STORAGE, PAGES_SCOPE_STORAGE, ENTRY_PAGES_SCOPE_STORAGE],
                'utm_ads_grain': 'date+counter_id+utm_source+utm_medium+utm_campaign',
                'goals_grain': 'date+counter_id+utm_source+utm_medium+utm_campaign+goal_id',
                'traffic_sources_grain': 'date+counter_id+traffic_source',
                'pages_grain': 'date+counter_id+page_url+page_title',
                'entry_pages_grain': 'date+counter_id+page_url',
                'user_behavior_grain': 'date+counter_id+user_id+traffic_source+start_url+end_url',
                'user_behavior_storage': 'canonical_fact_user_behavior_daily',
                'utm_ads_rows': len(payload['utm_ads_rows']),
                'goals_rows': len(payload['goals_rows']),
                'traffic_sources_rows': len(payload['traffic_sources_rows']),
                'page_rows': len(payload['page_rows']),
                'entry_page_rows': len(payload['entry_page_rows']),
                'user_behavior_rows': len(payload['user_behavior_rows']),
                'site_rows_written': site_rows_written,
                'user_behavior_rows_written': user_behavior_rows_written,
                'collection_modes': payload['collection_modes'],
            },
        )
        finish_collector_run(
            run_id,
            status='success',
            rows_read=rows_read,
            rows_written=rows_written,
            rows_updated=rows_updated,
            error_count=0,
            error_summary=None,
        )
        log.info(
            'Yandex Metrika canonical sync complete: counters=%s rows_read=%s rows_written=%s window=%s..%s',
            payload['counters'],
            rows_read,
            rows_written,
            date_from,
            date_to,
        )
        return 0
    except Exception as exc:
        log.exception('Yandex Metrika canonical sync failed')
        log_run_event(
            run_id,
            'ERROR',
            'collector_failure',
            'Yandex Metrika canonical analytics sync failed',
            {'error': str(exc), 'date_from': date_from, 'date_to': date_to},
        )
        finish_collector_run(
            run_id,
            status='failed',
            rows_read=rows_read,
            rows_written=rows_written,
            rows_updated=rows_updated,
            error_count=1,
            error_summary=str(exc)[:1000],
        )
        return 1


if __name__ == '__main__':
    sys.exit(main())
