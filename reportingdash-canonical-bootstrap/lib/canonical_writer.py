#!/usr/bin/env python3
"""Shared helpers for writing canonical_* reporting tables."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

import mysql.connector
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

MYSQL_HOST = os.getenv('MYSQL_HOST', 'localhost')
MYSQL_PORT = int(os.getenv('MYSQL_PORT', '3306'))
MYSQL_DB = os.getenv('MYSQL_DB', 'report_bd')
MYSQL_USER = os.getenv('MYSQL_USER', 'report_bd')
MYSQL_PASS = os.getenv('MYSQL_PASSWORD', '')


def get_db_connection():
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=MYSQL_DB,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def _json_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _normalize_datetime(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        raw = raw.replace('Z', '+00:00')
        try:
            return datetime.fromisoformat(raw).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            return raw[:19].replace('T', ' ')
    return None


def start_collector_run(
    source_key: str,
    run_type: str,
    run_mode: str,
    job_key: str,
    correlation_id: str,
    date_from: str,
    date_to: str,
) -> int:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO canonical_collector_runs (
            source_key, run_type, run_mode, job_key, correlation_id,
            date_from, date_to, status
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'running')
        """,
        (source_key, run_type, run_mode, job_key, correlation_id, date_from, date_to),
    )
    run_id = cur.lastrowid
    conn.commit()
    cur.close()
    conn.close()
    return int(run_id)


def log_run_event(run_id: int, level: str, event_type: str, message: str, payload: Any = None):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO canonical_collector_run_events (
            run_id, level, event_type, message, event_payload
        ) VALUES (%s, %s, %s, %s, %s)
        """,
        (run_id, level, event_type, message, _json_or_none(payload)),
    )
    conn.commit()
    cur.close()
    conn.close()


def finish_collector_run(
    run_id: int,
    status: str,
    rows_read: int,
    rows_written: int,
    rows_updated: int,
    error_count: int = 0,
    error_summary: str | None = None,
):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE canonical_collector_runs
        SET status = %s,
            rows_read = %s,
            rows_written = %s,
            rows_updated = %s,
            error_count = %s,
            error_summary = %s,
            finished_at = NOW(),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) DIV 1000,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """,
        (status, rows_read, rows_written, rows_updated, error_count, error_summary, run_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def upsert_source_accounts(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_accounts (
            source_key, platform_account_id, external_account_ref,
            account_name, advertiser_name, account_status,
            currency_code, timezone_name, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            external_account_ref = VALUES(external_account_ref),
            account_name = VALUES(account_name),
            advertiser_name = VALUES(advertiser_name),
            account_status = VALUES(account_status),
            currency_code = VALUES(currency_code),
            timezone_name = VALUES(timezone_name),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row.get('external_account_ref'),
                row.get('account_name'),
                row.get('advertiser_name'),
                row.get('account_status'),
                row.get('currency_code'),
                row.get('timezone_name'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_source_campaigns(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_campaigns (
            source_key, platform_account_id, platform_campaign_id,
            campaign_name, campaign_status, objective, buy_type,
            start_date, end_date, daily_budget, total_budget,
            currency_code, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            campaign_name = VALUES(campaign_name),
            campaign_status = VALUES(campaign_status),
            objective = VALUES(objective),
            buy_type = VALUES(buy_type),
            start_date = VALUES(start_date),
            end_date = VALUES(end_date),
            daily_budget = VALUES(daily_budget),
            total_budget = VALUES(total_budget),
            currency_code = VALUES(currency_code),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row.get('campaign_name'),
                row.get('campaign_status'),
                row.get('objective'),
                row.get('buy_type'),
                row.get('start_date'),
                row.get('end_date'),
                row.get('daily_budget'),
                row.get('total_budget'),
                row.get('currency_code'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_delivery_entities(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_delivery_entities (
            source_key, platform_account_id, platform_campaign_id,
            delivery_entity_type, platform_delivery_entity_id, parent_delivery_entity_id,
            delivery_entity_name, delivery_status, first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            parent_delivery_entity_id = VALUES(parent_delivery_entity_id),
            delivery_entity_name = VALUES(delivery_entity_name),
            delivery_status = VALUES(delivery_status),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row['delivery_entity_type'],
                row['platform_delivery_entity_id'],
                row.get('parent_delivery_entity_id') or '',
                row.get('delivery_entity_name'),
                row.get('delivery_status'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_creatives(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_source_creatives (
            source_key, platform_account_id, platform_campaign_id,
            platform_delivery_entity_id, platform_creative_id,
            creative_name, creative_status, creative_type, creative_format,
            destination_url, final_url, content_ref, preview_url, post_id,
            first_seen_at, last_seen_at, raw_payload
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            platform_delivery_entity_id = VALUES(platform_delivery_entity_id),
            creative_name = VALUES(creative_name),
            creative_status = VALUES(creative_status),
            creative_type = VALUES(creative_type),
            creative_format = VALUES(creative_format),
            destination_url = VALUES(destination_url),
            final_url = VALUES(final_url),
            content_ref = VALUES(content_ref),
            preview_url = VALUES(preview_url),
            post_id = VALUES(post_id),
            first_seen_at = COALESCE(LEAST(first_seen_at, VALUES(first_seen_at)), VALUES(first_seen_at), first_seen_at),
            last_seen_at = COALESCE(GREATEST(last_seen_at, VALUES(last_seen_at)), VALUES(last_seen_at), last_seen_at),
            raw_payload = VALUES(raw_payload),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row.get('platform_delivery_entity_id') or '',
                row['platform_creative_id'],
                row.get('creative_name'),
                row.get('creative_status'),
                row.get('creative_type'),
                row.get('creative_format'),
                row.get('destination_url'),
                row.get('final_url'),
                row.get('content_ref'),
                row.get('preview_url'),
                row.get('post_id'),
                _normalize_datetime(row.get('first_seen_at')),
                _normalize_datetime(row.get('last_seen_at')),
                _json_or_none(row.get('raw_payload')),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_ads_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_ads_daily (
            source_key, platform_account_id, platform_campaign_id,
            fact_scope, native_grain, breakdown_scope,
            platform_delivery_entity_id, platform_creative_id,
            report_date, spend, impressions, clicks, views, conversions,
            reach, frequency, ctr, cpm, cpc, cpv, cpa,
            video_views_25, video_views_50, video_views_75, video_views_100,
            link_clicks, likes, comments, shares, reactions, follows,
            currency_code, ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s
        )
        ON DUPLICATE KEY UPDATE
            spend = VALUES(spend),
            impressions = VALUES(impressions),
            clicks = VALUES(clicks),
            views = VALUES(views),
            conversions = VALUES(conversions),
            reach = VALUES(reach),
            frequency = VALUES(frequency),
            ctr = VALUES(ctr),
            cpm = VALUES(cpm),
            cpc = VALUES(cpc),
            cpv = VALUES(cpv),
            cpa = VALUES(cpa),
            video_views_25 = VALUES(video_views_25),
            video_views_50 = VALUES(video_views_50),
            video_views_75 = VALUES(video_views_75),
            video_views_100 = VALUES(video_views_100),
            link_clicks = VALUES(link_clicks),
            likes = VALUES(likes),
            comments = VALUES(comments),
            shares = VALUES(shares),
            reactions = VALUES(reactions),
            follows = VALUES(follows),
            currency_code = VALUES(currency_code),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['platform_account_id'],
                row['platform_campaign_id'],
                row['fact_scope'],
                row['native_grain'],
                row.get('breakdown_scope', 'default'),
                row['platform_delivery_entity_id'],
                row.get('platform_creative_id', ''),
                row['report_date'],
                row.get('spend'),
                row.get('impressions'),
                row.get('clicks'),
                row.get('views'),
                row.get('conversions'),
                row.get('reach'),
                row.get('frequency'),
                row.get('ctr'),
                row.get('cpm'),
                row.get('cpc'),
                row.get('cpv'),
                row.get('cpa'),
                row.get('video_views_25'),
                row.get('video_views_50'),
                row.get('video_views_75'),
                row.get('video_views_100'),
                row.get('link_clicks'),
                row.get('likes'),
                row.get('comments'),
                row.get('shares'),
                row.get('reactions'),
                row.get('follows'),
                row.get('currency_code'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_site_analytics_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_site_analytics_daily (
            source_key, analytics_account_id, report_date,
            analytics_scope, scope_hash,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            goal_id, goal_name, page_url, page_title, region_city, traffic_source,
            visits, users, new_users, pageviews, goal_reaches,
            page_depth, bounce_rate, avg_visit_duration_seconds,
            ingestion_run_id
        ) VALUES (
            %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s
        )
        ON DUPLICATE KEY UPDATE
            utm_source = VALUES(utm_source),
            utm_medium = VALUES(utm_medium),
            utm_campaign = VALUES(utm_campaign),
            utm_content = VALUES(utm_content),
            utm_term = VALUES(utm_term),
            goal_id = VALUES(goal_id),
            goal_name = VALUES(goal_name),
            page_url = VALUES(page_url),
            page_title = VALUES(page_title),
            region_city = VALUES(region_city),
            traffic_source = VALUES(traffic_source),
            visits = VALUES(visits),
            users = VALUES(users),
            new_users = VALUES(new_users),
            pageviews = VALUES(pageviews),
            goal_reaches = VALUES(goal_reaches),
            page_depth = VALUES(page_depth),
            bounce_rate = VALUES(bounce_rate),
            avg_visit_duration_seconds = VALUES(avg_visit_duration_seconds),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['analytics_account_id'],
                row['report_date'],
                row.get('analytics_scope', 'traffic'),
                row['scope_hash'],
                row.get('utm_source'),
                row.get('utm_medium'),
                row.get('utm_campaign'),
                row.get('utm_content'),
                row.get('utm_term'),
                row.get('goal_id'),
                row.get('goal_name'),
                row.get('page_url'),
                row.get('page_title'),
                row.get('region_city'),
                row.get('traffic_source'),
                row.get('visits'),
                row.get('users'),
                row.get('new_users'),
                row.get('pageviews'),
                row.get('goal_reaches'),
                row.get('page_depth'),
                row.get('bounce_rate'),
                row.get('avg_visit_duration_seconds'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def upsert_fact_user_behavior_daily(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO canonical_fact_user_behavior_daily (
            source_key, analytics_account_id, report_date, scope_hash,
            user_id, traffic_source_id, traffic_source, start_url, end_url,
            visits, users, new_users,
            page_depth, bounce_rate, avg_visit_duration_seconds,
            up_to_day_user_recency_percentage,
            up_to_week_user_recency_percentage,
            up_to_month_user_recency_percentage,
            ingestion_run_id
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s
        )
        ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            traffic_source_id = VALUES(traffic_source_id),
            traffic_source = VALUES(traffic_source),
            start_url = VALUES(start_url),
            end_url = VALUES(end_url),
            visits = VALUES(visits),
            users = VALUES(users),
            new_users = VALUES(new_users),
            page_depth = VALUES(page_depth),
            bounce_rate = VALUES(bounce_rate),
            avg_visit_duration_seconds = VALUES(avg_visit_duration_seconds),
            up_to_day_user_recency_percentage = VALUES(up_to_day_user_recency_percentage),
            up_to_week_user_recency_percentage = VALUES(up_to_week_user_recency_percentage),
            up_to_month_user_recency_percentage = VALUES(up_to_month_user_recency_percentage),
            ingestion_run_id = VALUES(ingestion_run_id),
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                row['source_key'],
                row['analytics_account_id'],
                row['report_date'],
                row['scope_hash'],
                row['user_id'],
                row.get('traffic_source_id'),
                row.get('traffic_source'),
                row.get('start_url'),
                row.get('end_url'),
                row.get('visits'),
                row.get('users'),
                row.get('new_users'),
                row.get('page_depth'),
                row.get('bounce_rate'),
                row.get('avg_visit_duration_seconds'),
                row.get('up_to_day_user_recency_percentage'),
                row.get('up_to_week_user_recency_percentage'),
                row.get('up_to_month_user_recency_percentage'),
                row.get('ingestion_run_id'),
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)
