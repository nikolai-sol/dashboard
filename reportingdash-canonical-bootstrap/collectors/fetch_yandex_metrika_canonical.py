#!/usr/bin/env python3
"""Yandex Metrika -> canonical_fact_site_analytics_daily."""

from __future__ import annotations

import argparse
import hashlib
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
    upsert_fact_site_analytics_daily,
    upsert_fact_user_behavior_daily,
    upsert_source_accounts,
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


SOURCE_KEY = 'yandex_metrika'
UTM_ADS_SCOPE_LOGICAL = 'utm_ads'
GOALS_SCOPE_LOGICAL = 'goals'
UTM_ADS_SCOPE_STORAGE = 'traffic'
GOALS_SCOPE_STORAGE = 'goal'
DEFAULT_COLLECTION_MODE = 'ads_only'
SUPPORTED_COLLECTION_MODES = {
    'ads_only',
    'ads_plus_seo',
    'ads_plus_seo_plus_user_behavior',
}
MAX_RETRIES = 5
TIMEOUT = 90

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
USER_BEHAVIOR_SCOPE_LOGICAL = 'user_behavior'

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


def fetch_configured_counters(run_type: str) -> list[dict]:
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
        'limit': '10000',
        'date1': day,
        'date2': day,
    }
    if extra_params:
        params.update(extra_params)
    sleep_for = 2
    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.get(METRIKA_STATS_URL, headers=headers, params=params, timeout=TIMEOUT)
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()
        if attempt == MAX_RETRIES:
            response.raise_for_status()
        time.sleep(sleep_for)
        sleep_for = min(sleep_for * 2, 60)
    raise RuntimeError(f'Metrika retry loop exhausted for counter {counter_id} day {day}')


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


def delete_existing_scope_rows(date_from: str, date_to: str):
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor()
    try:
        cur.execute(
            """
            DELETE FROM canonical_fact_site_analytics_daily
            WHERE source_key = %s
              AND report_date BETWEEN %s AND %s
              AND analytics_scope IN (%s, %s)
            """,
            (SOURCE_KEY, date_from, date_to, UTM_ADS_SCOPE_STORAGE, GOALS_SCOPE_STORAGE),
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


def delete_existing_user_behavior_rows(date_from: str, date_to: str):
    conn = get_db_connection(MYSQL_DB)
    cur = conn.cursor()
    try:
        cur.execute(
            """
            DELETE FROM canonical_fact_user_behavior_daily
            WHERE source_key = %s
              AND report_date BETWEEN %s AND %s
            """,
            (SOURCE_KEY, date_from, date_to),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def build_payload(counters: list[dict], date_from: str, date_to: str, run_id: int) -> dict[str, Any]:
    account_rows: dict[str, dict] = {}
    utm_ads_rows: list[dict] = []
    goals_rows: list[dict] = []
    user_behavior_rows: list[dict] = []
    rows_read = 0
    api_empty_rows = 0
    skipped_counters: list[dict[str, str]] = []
    collection_modes: dict[str, int] = {}

    for counter in counters:
        counter_id = clean_text(counter.get('counter_id'))
        counter_name = clean_text(counter.get('name')) or f'Yandex Metrika counter {counter_id}'
        collection_mode = clean_text(counter.get('collection_mode')) or DEFAULT_COLLECTION_MODE
        if collection_mode not in SUPPORTED_COLLECTION_MODES:
            collection_mode = DEFAULT_COLLECTION_MODE
        collection_modes[collection_mode] = collection_modes.get(collection_mode, 0) + 1
        collect_user_behavior = should_collect_user_behavior(counter)
        account_rows[counter_id] = {
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
            rows_read += 3 if collect_user_behavior else 2
            utm_rows_for_day = build_utm_ads_rows(counter_id, day, utm_ads_response, run_id)
            goals_rows_for_day = build_goals_rows(counter_id, day, goals_response, run_id)
            user_behavior_rows_for_day = (
                build_user_behavior_rows(counter_id, day, user_behavior_response, run_id)
                if user_behavior_response is not None
                else []
            )
            if not utm_rows_for_day and not goals_rows_for_day and not user_behavior_rows_for_day:
                api_empty_rows += 1
            utm_ads_rows.extend(utm_rows_for_day)
            goals_rows.extend(goals_rows_for_day)
            user_behavior_rows.extend(user_behavior_rows_for_day)
        if skip_counter:
            account_rows.pop(counter_id, None)

    return {
        'accounts': list(account_rows.values()),
        'utm_ads_rows': utm_ads_rows,
        'goals_rows': goals_rows,
        'user_behavior_rows': user_behavior_rows,
        'facts': utm_ads_rows + goals_rows,
        'rows_read': rows_read,
        'api_empty_rows': api_empty_rows,
        'counters': len(account_rows),
        'skipped_counters': skipped_counters,
        'collection_modes': collection_modes,
    }


def main() -> int:
    args = parse_args()
    if not METRIKA_TOKEN:
        raise RuntimeError('METRIKA_TOKEN is missing from env')

    date_from, date_to = date_range(args)
    run_id = start_collector_run(
        source_key=SOURCE_KEY,
        run_type=args.run_type,
        run_mode='canonical_only',
        job_key=f'{SOURCE_KEY}_{args.run_type}',
        correlation_id=str(uuid.uuid4()),
        date_from=date_from,
        date_to=date_to,
    )

    rows_read = rows_written = rows_updated = 0
    try:
        ensure_user_behavior_table()
        counters = fetch_configured_counters(args.run_type)
        payload = build_payload(counters, date_from, date_to, run_id)
        delete_existing_scope_rows(date_from, date_to)
        delete_existing_user_behavior_rows(date_from, date_to)
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
                'logical_scopes': [UTM_ADS_SCOPE_LOGICAL, GOALS_SCOPE_LOGICAL],
                'storage_scopes': [UTM_ADS_SCOPE_STORAGE, GOALS_SCOPE_STORAGE],
                'utm_ads_grain': 'date+counter_id+utm_source+utm_medium+utm_campaign',
                'goals_grain': 'date+counter_id+utm_source+utm_medium+utm_campaign+goal_id',
                'user_behavior_grain': 'date+counter_id+user_id+traffic_source+start_url+end_url',
                'user_behavior_storage': 'canonical_fact_user_behavior_daily',
                'utm_ads_rows': len(payload['utm_ads_rows']),
                'goals_rows': len(payload['goals_rows']),
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
