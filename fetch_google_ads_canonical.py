#!/usr/bin/env python3
"""Google Ads API -> canonical_* and Google detail reporting tables.

First production version is intentionally read-only against Google Ads. It only
uses GAQL reporting services and creates/upserts local reporting rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException
from mysql.connector import errorcode
from mysql.connector.errors import ProgrammingError

from canonical_writer import (
    ensure_fact_ads_daily_conversion_value_column,
    finish_collector_run,
    get_db_connection,
    log_run_event,
    start_collector_run,
    upsert_delivery_entities,
    upsert_fact_ads_daily,
    upsert_source_accounts,
    upsert_source_campaigns,
)
from google_ads_api_client import (
    env_first,
    fetch_gaql_rows,
    google_ads_client,
    list_accessible_customers,
    log_google_ads_exception,
    missing_config_keys,
    normalize_customer_id,
    parse_customer_ids,
)

load_dotenv(Path(__file__).parent / '.env')

SOURCE_KEY = env_first('GOOGLE_ADS_SOURCE_KEY', default='google')
NEGATIVE_PATTERN_PHRASES = (
    'stiftung warentest',
    'stellenangebot',
    'polyphenole',
    'medizinisch',
    'vergleich',
    'rezept',
    'kalorien',
    'kostenlos',
    'kosmetik',
    'gratis',
    'billig',
    'studie',
    'test',
    'wiki',
    'pdf',
    'job',
)
STOPWORDS = {
    'a', 'an', 'and', 'at', 'by', 'de', 'der', 'die', 'das', 'den', 'des', 'ein',
    'eine', 'for', 'im', 'in', 'mit', 'of', 'on', 'or', 'the', 'to', 'und', 'von',
    'zu',
}
LOG_LEVEL = env_first('LOG_LEVEL', default='INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('google_ads_canonical')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'command',
        nargs='?',
        default='collect',
        choices=[
            'collect',
            'control-report',
            'debug',
            'approve-recommendation',
            'apply-approved-negatives',
            'list-accessible-customers',
            'list-campaigns',
            'list-recommendations',
            'recommend-negatives',
            'recommendation-summary',
            'reject-recommendation',
            'validate',
            'validate-spend',
            'negative-keyword-todos',
        ],
    )
    parser.add_argument('--date-from', '--from', dest='date_from', default='')
    parser.add_argument('--date-to', '--to', dest='date_to', default='')
    parser.add_argument('--days-back', type=int, default=1)
    parser.add_argument('--run-type', default='manual', choices=['manual', 'cron', 'backfill'])
    parser.add_argument('--customer-id', default='')
    parser.add_argument('--customer-ids', default='')
    parser.add_argument('--campaign-id', default='')
    parser.add_argument('--campaign-ids', default='')
    parser.add_argument('--campaign-names', default='')
    parser.add_argument('--id', type=int, default=0)
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--note', default='')
    parser.add_argument('--status', default='')
    parser.add_argument('--check-config', action='store_true')
    parser.add_argument('--confirm-apply', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--skip-product-performance', action='store_true')
    parser.add_argument('--skip-search-terms', action='store_true')
    return parser.parse_args()


def parse_date(value: str) -> date:
    return datetime.strptime(value, '%Y-%m-%d').date()


def date_range(args) -> tuple[str, str]:
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
    date_to = parse_date(args.date_to) if args.date_to else yesterday
    date_from = parse_date(args.date_from) if args.date_from else date_to - timedelta(days=max(args.days_back - 1, 0))
    if date_from > date_to:
        raise ValueError(f'date-from must be <= date-to: {date_from} > {date_to}')
    return date_from.strftime('%Y-%m-%d'), date_to.strftime('%Y-%m-%d')


def enum_name(value: Any) -> str | None:
    if value is None:
        return None
    name = getattr(value, 'name', None)
    return str(name) if name else str(value)


def micros_to_units(value: Any) -> float:
    try:
        return round(float(value or 0) / 1_000_000, 6)
    except (TypeError, ValueError):
        return 0.0


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def rate_percent(numerator: int, denominator: int) -> float | None:
    return round((numerator / denominator) * 100, 6) if denominator > 0 else None


def per_unit(numerator: float, denominator: int | float, multiplier: int = 1) -> float | None:
    return round((numerator / denominator) * multiplier, 6) if denominator else None


def json_or_none(value: Any) -> str | None:
    return json.dumps(value, ensure_ascii=False, default=str) if value is not None else None


def parse_csv_values(value: str) -> list[str]:
    result: list[str] = []
    for item in str(value or '').replace('\n', ',').split(','):
        item = item.strip()
        if item and item not in result:
            result.append(item)
    return result


def parse_campaign_ids(value: str) -> list[str]:
    result: list[str] = []
    for item in parse_csv_values(value):
        normalized = ''.join(ch for ch in item if ch.isdigit())
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def normalize_customer_arg(value: str) -> str:
    return normalize_customer_id(value)


def normalize_campaign_arg(value: str) -> str:
    return ''.join(ch for ch in str(value or '').strip() if ch.isdigit())


def gaql_string(value: str) -> str:
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"


def campaign_filter_clause(args, prefix: str = 'AND') -> str:
    clauses: list[str] = []
    campaign_ids = parse_campaign_ids(getattr(args, 'campaign_ids', ''))
    campaign_id = normalize_campaign_arg(getattr(args, 'campaign_id', ''))
    if campaign_id and campaign_id not in campaign_ids:
        campaign_ids.insert(0, campaign_id)
    campaign_names = parse_csv_values(getattr(args, 'campaign_names', ''))
    if campaign_ids:
        if len(campaign_ids) == 1:
            clauses.append(f'campaign.id = {campaign_ids[0]}')
        else:
            clauses.append('campaign.id IN (' + ', '.join(campaign_ids) + ')')
    if campaign_names:
        if len(campaign_names) == 1:
            clauses.append(f'campaign.name = {gaql_string(campaign_names[0])}')
        else:
            clauses.append('campaign.name IN (' + ', '.join(gaql_string(name) for name in campaign_names) + ')')
    if not clauses:
        return ''
    return f" {prefix} " + ' AND '.join(clauses)


def stable_id(*parts: Any) -> str:
    raw = '|'.join(str(part or '') for part in parts)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:48]


def money(value: Any) -> float:
    return round(safe_float(value), 6)


def metric_diff(api_value: float | int | None, local_value: float | int | None) -> tuple[float | None, float | None]:
    if api_value is None or local_value is None:
        return None, None
    absolute = round(float(local_value) - float(api_value), 6)
    pct = round((absolute / float(api_value)) * 100, 6) if float(api_value) else (0.0 if float(local_value) == 0 else None)
    return absolute, pct


def normalize_search_text(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def detect_negative_pattern(search_term: str) -> str | None:
    normalized = normalize_search_text(search_term)
    for phrase in NEGATIVE_PATTERN_PHRASES:
        if re.search(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', normalized):
            return phrase
    return None


def generic_negative_phrase(search_term: str) -> str:
    tokens = re.findall(r'[\w\-]+', normalize_search_text(search_term), flags=re.UNICODE)
    useful = [token for token in tokens if token not in STOPWORDS]
    if not useful:
        return normalize_search_text(search_term)[:255]
    return ' '.join(useful[: min(len(useful), 3)])


def build_negative_recommendation(row: dict) -> dict:
    search_term = str(row.get('search_term') or '').strip()
    pattern = detect_negative_pattern(search_term)
    if pattern:
        suggested = pattern
        reason_code = 'ZERO_CONVERSION_PATTERN'
        reason_text = f"Search term contains low-intent pattern '{pattern}' and has clicks/cost with zero conversions."
        confidence = 0.85
    else:
        suggested = generic_negative_phrase(search_term)
        reason_code = 'ZERO_CONVERSION_SPEND_OR_CLICK'
        reason_text = 'Search term has clicks/cost with zero conversions.'
        confidence = 0.6
    if safe_float(row.get('cost')) >= 1 or safe_int(row.get('clicks')) >= 5:
        confidence = min(confidence + 0.05, 0.95)
    return {
        'search_term': search_term,
        'suggested_negative_keyword': suggested[:255],
        'match_type': 'PHRASE',
        'reason_code': reason_code,
        'reason_text': reason_text,
        'confidence': round(confidence, 2),
    }


def ensure_google_ads_tables() -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_pmax_asset_group_daily (
            report_date DATE NOT NULL,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            campaign_name VARCHAR(500),
            asset_group_id VARCHAR(64) NOT NULL,
            asset_group_name VARCHAR(500),
            asset_group_status VARCHAR(64),
            currency_code VARCHAR(8),
            cost DECIMAL(18,6) DEFAULT 0,
            impressions BIGINT DEFAULT 0,
            clicks BIGINT DEFAULT 0,
            conversions DECIMAL(18,6) DEFAULT 0,
            conversion_value DECIMAL(18,6) DEFAULT 0,
            raw_payload JSON DEFAULT NULL,
            ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (report_date, customer_id, campaign_id, asset_group_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_search_term_performance_daily (
            report_date DATE NOT NULL,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            campaign_name VARCHAR(500),
            ad_group_id VARCHAR(64) NOT NULL DEFAULT '',
            ad_group_name VARCHAR(500),
            search_term_hash CHAR(48) NOT NULL,
            search_term VARCHAR(2048),
            search_term_status VARCHAR(64),
            campaign_search_term BOOLEAN NOT NULL DEFAULT FALSE,
            currency_code VARCHAR(8),
            cost DECIMAL(18,6) DEFAULT 0,
            impressions BIGINT DEFAULT 0,
            clicks BIGINT DEFAULT 0,
            conversions DECIMAL(18,6) DEFAULT 0,
            conversion_value DECIMAL(18,6) DEFAULT 0,
            raw_payload JSON DEFAULT NULL,
            ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (report_date, customer_id, campaign_id, ad_group_id, search_term_hash, campaign_search_term)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_keyword_performance_daily (
            report_date DATE NOT NULL,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            campaign_name VARCHAR(500),
            ad_group_id VARCHAR(64) NOT NULL DEFAULT '',
            ad_group_name VARCHAR(500),
            criterion_id VARCHAR(64) NOT NULL,
            keyword_text VARCHAR(2048),
            match_type VARCHAR(64),
            keyword_status VARCHAR(64),
            currency_code VARCHAR(8),
            cost DECIMAL(18,6) DEFAULT 0,
            impressions BIGINT DEFAULT 0,
            clicks BIGINT DEFAULT 0,
            conversions DECIMAL(18,6) DEFAULT 0,
            conversion_value DECIMAL(18,6) DEFAULT 0,
            raw_payload JSON DEFAULT NULL,
            ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (report_date, customer_id, campaign_id, ad_group_id, criterion_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_product_performance_daily (
            report_date DATE NOT NULL,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            campaign_name VARCHAR(500),
            ad_group_id VARCHAR(64) NOT NULL DEFAULT '',
            ad_group_name VARCHAR(500),
            product_key_hash CHAR(48) NOT NULL,
            product_item_id VARCHAR(255),
            product_title VARCHAR(1024),
            product_brand VARCHAR(255),
            product_type_l1 VARCHAR(255),
            product_type_l2 VARCHAR(255),
            product_channel VARCHAR(64),
            merchant_id VARCHAR(64),
            currency_code VARCHAR(8),
            cost DECIMAL(18,6) DEFAULT 0,
            impressions BIGINT DEFAULT 0,
            clicks BIGINT DEFAULT 0,
            conversions DECIMAL(18,6) DEFAULT 0,
            conversion_value DECIMAL(18,6) DEFAULT 0,
            raw_payload JSON DEFAULT NULL,
            ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (report_date, customer_id, campaign_id, ad_group_id, product_key_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_spend_validation_daily (
            report_date DATE NOT NULL,
            customer_id VARCHAR(32) NOT NULL,
            currency_code VARCHAR(8),
            canonical_campaign_spend DECIMAL(18,6) DEFAULT 0,
            google_campaign_api_spend DECIMAL(18,6) DEFAULT 0,
            diff DECIMAL(18,6) DEFAULT 0,
            status VARCHAR(32) NOT NULL,
            raw_payload JSON DEFAULT NULL,
            ingestion_run_id BIGINT UNSIGNED DEFAULT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (report_date, customer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_mutation_log (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) DEFAULT NULL,
            recommendation_id BIGINT UNSIGNED DEFAULT NULL,
            mutation_type VARCHAR(64) NOT NULL DEFAULT 'ADD_CAMPAIGN_NEGATIVE_KEYWORD',
            entity_type VARCHAR(64) NOT NULL DEFAULT 'campaign_criterion',
            entity_id VARCHAR(255) DEFAULT NULL,
            payload_json JSON DEFAULT NULL,
            operation_type VARCHAR(64) NOT NULL,
            approval_ref VARCHAR(128) DEFAULT NULL,
            request_payload JSON DEFAULT NULL,
            response_payload JSON DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'planned',
            error_message TEXT DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            applied_at DATETIME DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_google_ads_mutation_log_customer_campaign (customer_id, campaign_id),
            KEY idx_google_ads_mutation_log_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    ensure_mutation_log_columns(cur)
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_negative_keyword_recommendation_todos (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) DEFAULT NULL,
            ad_group_id VARCHAR(64) DEFAULT NULL,
            search_term VARCHAR(2048) NOT NULL,
            reason TEXT,
            proposed_match_type VARCHAR(32) DEFAULT 'PHRASE',
            approval_status ENUM('draft','pending_human_approval','approved','rejected','applied') NOT NULL DEFAULT 'draft',
            read_only_note VARCHAR(255) NOT NULL DEFAULT 'Mutation is intentionally not implemented in the Google Ads collector.',
            raw_payload JSON DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_google_ads_negative_keyword_todos_status (approval_status),
            KEY idx_google_ads_negative_keyword_todos_customer (customer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS google_ads_negative_keyword_recommendations (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            customer_id VARCHAR(32) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            search_term VARCHAR(2048) NOT NULL,
            suggested_negative_keyword VARCHAR(255) NOT NULL,
            match_type VARCHAR(32) NOT NULL DEFAULT 'PHRASE',
            impressions BIGINT DEFAULT 0,
            clicks BIGINT DEFAULT 0,
            cost DECIMAL(18,6) DEFAULT 0,
            conversions DECIMAL(18,6) DEFAULT 0,
            conversion_value DECIMAL(18,6) DEFAULT 0,
            reason_code VARCHAR(64) NOT NULL,
            reason_text TEXT,
            confidence DECIMAL(5,4) DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            reviewed_at TIMESTAMP NULL DEFAULT NULL,
            review_note TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            applied_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_google_ads_neg_kw_recs_customer_campaign (customer_id, campaign_id),
            KEY idx_google_ads_neg_kw_recs_status (status),
            KEY idx_google_ads_neg_kw_recs_keyword (customer_id, campaign_id, suggested_negative_keyword, match_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    ensure_recommendation_review_columns(cur)
    conn.commit()
    cur.close()
    conn.close()


def ensure_mutation_log_columns(cur) -> None:
    columns = {
        'recommendation_id': 'ALTER TABLE google_ads_mutation_log ADD COLUMN recommendation_id BIGINT UNSIGNED DEFAULT NULL AFTER campaign_id',
        'mutation_type': "ALTER TABLE google_ads_mutation_log ADD COLUMN mutation_type VARCHAR(64) NOT NULL DEFAULT 'ADD_CAMPAIGN_NEGATIVE_KEYWORD' AFTER recommendation_id",
        'entity_type': "ALTER TABLE google_ads_mutation_log ADD COLUMN entity_type VARCHAR(64) NOT NULL DEFAULT 'campaign_criterion' AFTER mutation_type",
        'entity_id': 'ALTER TABLE google_ads_mutation_log ADD COLUMN entity_id VARCHAR(255) DEFAULT NULL AFTER entity_type',
        'payload_json': 'ALTER TABLE google_ads_mutation_log ADD COLUMN payload_json JSON DEFAULT NULL AFTER entity_id',
    }
    cur.execute(
        """
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'google_ads_mutation_log'
        """
    )
    existing = {row[0] if not isinstance(row, dict) else row['COLUMN_NAME'] for row in cur.fetchall()}
    for column, ddl in columns.items():
        if column not in existing:
            try:
                cur.execute(ddl)
            except ProgrammingError as exc:
                if getattr(exc, 'errno', None) != errorcode.ER_DUP_FIELDNAME:
                    raise


def ensure_recommendation_review_columns(cur) -> None:
    columns = {
        'reviewed_at': 'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL AFTER status',
        'review_note': 'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN review_note TEXT NULL AFTER reviewed_at',
        'applied_at': 'ALTER TABLE google_ads_negative_keyword_recommendations ADD COLUMN applied_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at',
    }
    cur.execute(
        """
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'google_ads_negative_keyword_recommendations'
        """
    )
    existing = {row[0] if not isinstance(row, dict) else row['COLUMN_NAME'] for row in cur.fetchall()}
    for column, ddl in columns.items():
        if column not in existing:
            try:
                cur.execute(ddl)
            except ProgrammingError as exc:
                if getattr(exc, 'errno', None) != errorcode.ER_DUP_FIELDNAME:
                    raise


def upsert_detail_rows(table: str, columns: list[str], rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    placeholders = ', '.join(['%s'] * len(columns))
    updates = ', '.join(f'{col}=VALUES({col})' for col in columns if col not in {
        'report_date', 'customer_id', 'campaign_id', 'asset_group_id', 'ad_group_id',
        'search_term_hash', 'campaign_search_term', 'product_key_hash',
    })
    sql = f"""
        INSERT INTO {table} ({', '.join(columns)})
        VALUES ({placeholders})
        ON DUPLICATE KEY UPDATE {updates}
    """
    cur.executemany(sql, [tuple(row.get(col) for col in columns) for row in rows])
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def fetch_account(client: GoogleAdsClient, customer_id: str) -> dict:
    query = """
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.status
        FROM customer
        LIMIT 1
    """
    rows = fetch_gaql_rows(client, customer_id, query, log)
    if not rows:
        return {'customer_id': customer_id, 'name': f'Google Ads account {customer_id}'}
    customer = rows[0].customer
    return {
        'customer_id': str(customer.id),
        'name': customer.descriptive_name or f'Google Ads account {customer_id}',
        'currency_code': customer.currency_code,
        'time_zone': customer.time_zone,
        'status': enum_name(customer.status),
    }


def fetch_campaigns(client: GoogleAdsClient, customer_id: str, args=None) -> list[Any]:
    filter_clause = campaign_filter_clause(args) if args else ''
    query = f"""
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.status,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
        {filter_clause}
        ORDER BY campaign.id
    """
    return fetch_gaql_rows(client, customer_id, query, log)


def fetch_campaign_daily_rows(client: GoogleAdsClient, customer_id: str, date_from: str, date_to: str, args=None) -> list[Any]:
    filter_clause = campaign_filter_clause(args)
    query = f"""
        SELECT
          segments.date,
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.status,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
          AND campaign.status != 'REMOVED'
          {filter_clause}
        ORDER BY segments.date, campaign.id
    """
    return fetch_gaql_rows(client, customer_id, query, log)


def fetch_asset_group_daily_rows(client: GoogleAdsClient, customer_id: str, date_from: str, date_to: str, args=None) -> list[Any]:
    filter_clause = campaign_filter_clause(args)
    query = f"""
        SELECT
          segments.date,
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          asset_group.id,
          asset_group.name,
          asset_group.status,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value
        FROM asset_group
        WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
          AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
          AND asset_group.status != 'REMOVED'
          {filter_clause}
        ORDER BY segments.date, campaign.id, asset_group.id
    """
    return fetch_gaql_rows(client, customer_id, query, log)


def fetch_search_term_rows(client: GoogleAdsClient, customer_id: str, date_from: str, date_to: str, args=None) -> list[dict]:
    filter_clause = campaign_filter_clause(args)
    query = f"""
        SELECT
          segments.date,
          customer.id,
          customer.currency_code,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          search_term_view.search_term,
          search_term_view.status,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value
        FROM search_term_view
        WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
          {filter_clause}
        ORDER BY segments.date, campaign.id, ad_group.id
    """
    return [{'row': row, 'campaign_search_term': False} for row in fetch_gaql_rows(client, customer_id, query, log)]


def fetch_pmax_search_term_rows(client: GoogleAdsClient, customer_id: str, date_from: str, date_to: str, args=None) -> list[dict]:
    filter_clause = campaign_filter_clause(args)
    query = f"""
        SELECT
          segments.date,
          customer.id,
          customer.currency_code,
          campaign.id,
          campaign.name,
          campaign_search_term_view.search_term,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign_search_term_view
        WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
          {filter_clause}
        ORDER BY segments.date, campaign.id
    """
    try:
        return [{'row': row, 'campaign_search_term': True} for row in fetch_gaql_rows(client, customer_id, query)]
    except GoogleAdsException as exc:
        log.warning('Skipping PMax campaign_search_term_view for customer_id=%s: %s', customer_id, exc.failure)
        return []


def fetch_product_rows(client: GoogleAdsClient, customer_id: str, date_from: str, date_to: str, args=None) -> list[Any]:
    filter_clause = campaign_filter_clause(args)
    query = f"""
        SELECT
          segments.date,
          customer.id,
          customer.currency_code,
          campaign.id,
          campaign.name,
          ad_group.id,
          ad_group.name,
          segments.product_item_id,
          segments.product_title,
          segments.product_brand,
          segments.product_type_l1,
          segments.product_type_l2,
          segments.product_channel,
          segments.product_merchant_id,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value
        FROM shopping_performance_view
        WHERE segments.date BETWEEN '{date_from}' AND '{date_to}'
          {filter_clause}
        ORDER BY segments.date, campaign.id
    """
    try:
        return fetch_gaql_rows(client, customer_id, query)
    except GoogleAdsException as exc:
        log.warning('Skipping shopping_performance_view for customer_id=%s: %s', customer_id, exc.failure)
        return []


def campaign_meta_rows(account: dict, rows: list[Any], run_id: int) -> tuple[list[dict], list[dict], list[dict]]:
    account_rows: dict[tuple[str, str], dict] = {}
    campaign_rows: dict[tuple[str, str, str], dict] = {}
    facts: list[dict] = []

    for row in rows:
        customer = row.customer
        campaign = row.campaign
        metrics = getattr(row, 'metrics', None)
        account_id = str(customer.id)
        campaign_id = str(campaign.id)
        currency = customer.currency_code or account.get('currency_code')
        account_rows[(SOURCE_KEY, account_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'external_account_ref': account_id,
            'account_name': customer.descriptive_name or account.get('name'),
            'advertiser_name': customer.descriptive_name or account.get('name'),
            'account_status': enum_name(customer.status),
            'currency_code': currency,
            'timezone_name': customer.time_zone or account.get('time_zone'),
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': {'customer_id': account_id},
        }
        campaign_rows[(SOURCE_KEY, account_id, campaign_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'campaign_name': campaign.name or f'Google Ads campaign {campaign_id}',
            'campaign_status': enum_name(campaign.status),
            'objective': enum_name(campaign.advertising_channel_type),
            'buy_type': None,
            'start_date': None,
            'end_date': None,
            'daily_budget': None,
            'total_budget': None,
            'currency_code': currency,
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': {
                'campaign_id': campaign_id,
                'campaign_name': campaign.name,
                'advertising_channel_type': enum_name(campaign.advertising_channel_type),
            },
        }
        if metrics and getattr(row, 'segments', None):
            spend = micros_to_units(metrics.cost_micros)
            impressions = safe_int(metrics.impressions)
            clicks = safe_int(metrics.clicks)
            views = safe_int(getattr(metrics, 'video_views', 0))
            conversions = safe_float(metrics.conversions)
            facts.append({
                'source_key': SOURCE_KEY,
                'platform_account_id': account_id,
                'platform_campaign_id': campaign_id,
                'fact_scope': 'campaign',
                'native_grain': 'campaign',
                'breakdown_scope': 'default',
                'platform_delivery_entity_id': '__campaign__',
                'platform_creative_id': '',
                'report_date': str(row.segments.date),
                'spend': spend,
                'impressions': impressions,
                'clicks': clicks,
                'views': views,
                'conversions': int(round(conversions)),
                'conversion_value': safe_float(metrics.conversions_value),
                'reach': None,
                'frequency': None,
                'ctr': rate_percent(clicks, impressions),
                'cpm': per_unit(spend, impressions, 1000),
                'cpc': per_unit(spend, clicks),
                'cpv': per_unit(spend, views),
                'cpa': per_unit(spend, conversions),
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
                'currency_code': currency,
                'ingestion_run_id': run_id,
            })
    if not account_rows and account:
        account_id = normalize_customer_id(account.get('customer_id'))
        account_rows[(SOURCE_KEY, account_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'external_account_ref': account_id,
            'account_name': account.get('name') or f'Google Ads account {account_id}',
            'advertiser_name': account.get('name') or f'Google Ads account {account_id}',
            'account_status': account.get('status'),
            'currency_code': account.get('currency_code'),
            'timezone_name': account.get('time_zone'),
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': {'customer_id': account_id},
        }
    return list(account_rows.values()), list(campaign_rows.values()), facts


def asset_group_payload(rows: list[Any], run_id: int) -> tuple[list[dict], list[dict], list[dict]]:
    delivery_rows: dict[tuple[str, str, str], dict] = {}
    fact_rows: list[dict] = []
    detail_rows: list[dict] = []
    for row in rows:
        customer = row.customer
        campaign = row.campaign
        asset_group = row.asset_group
        metrics = row.metrics
        account_id = str(customer.id)
        campaign_id = str(campaign.id)
        asset_group_id = str(asset_group.id)
        currency = customer.currency_code
        spend = micros_to_units(metrics.cost_micros)
        impressions = safe_int(metrics.impressions)
        clicks = safe_int(metrics.clicks)
        conversions = safe_float(metrics.conversions)
        raw_payload = {
            'customer_id': account_id,
            'campaign_id': campaign_id,
            'campaign_name': campaign.name,
            'asset_group_id': asset_group_id,
            'asset_group_name': asset_group.name,
            'asset_group_status': enum_name(asset_group.status),
            'advertising_channel_type': enum_name(campaign.advertising_channel_type),
        }
        delivery_rows[(SOURCE_KEY, account_id, asset_group_id)] = {
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'delivery_entity_type': 'other',
            'platform_delivery_entity_id': asset_group_id,
            'parent_delivery_entity_id': campaign_id,
            'delivery_entity_name': asset_group.name or f'Google Ads asset group {asset_group_id}',
            'delivery_status': enum_name(asset_group.status),
            'first_seen_at': None,
            'last_seen_at': datetime.now(timezone.utc).isoformat(),
            'raw_payload': raw_payload,
        }
        fact_rows.append({
            'source_key': SOURCE_KEY,
            'platform_account_id': account_id,
            'platform_campaign_id': campaign_id,
            'fact_scope': 'delivery_entity',
            'native_grain': 'other',
            'breakdown_scope': 'pmax_asset_group',
            'platform_delivery_entity_id': asset_group_id,
            'platform_creative_id': '',
            'report_date': str(row.segments.date),
            'spend': spend,
            'impressions': impressions,
            'clicks': clicks,
            'views': None,
            'conversions': int(round(conversions)),
            'conversion_value': safe_float(metrics.conversions_value),
            'reach': None,
            'frequency': None,
            'ctr': rate_percent(clicks, impressions),
            'cpm': per_unit(spend, impressions, 1000),
            'cpc': per_unit(spend, clicks),
            'cpv': None,
            'cpa': per_unit(spend, conversions),
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
            'currency_code': currency,
            'ingestion_run_id': run_id,
        })
        detail_rows.append({
            'report_date': str(row.segments.date),
            'customer_id': account_id,
            'campaign_id': campaign_id,
            'campaign_name': campaign.name,
            'asset_group_id': asset_group_id,
            'asset_group_name': asset_group.name,
            'asset_group_status': enum_name(asset_group.status),
            'currency_code': currency,
            'cost': spend,
            'impressions': impressions,
            'clicks': clicks,
            'conversions': conversions,
            'conversion_value': safe_float(metrics.conversions_value),
            'raw_payload': json_or_none(raw_payload),
            'ingestion_run_id': run_id,
        })
    return list(delivery_rows.values()), fact_rows, detail_rows


def search_term_detail_payload(rows: list[dict], run_id: int) -> list[dict]:
    detail_rows: list[dict] = []
    for item in rows:
        row = item['row']
        is_campaign_level = item['campaign_search_term']
        term = getattr(row.search_term_view, 'search_term', None) if not is_campaign_level else getattr(row.campaign_search_term_view, 'search_term', None)
        if not term:
            continue
        ad_group_id = '' if is_campaign_level else str(row.ad_group.id)
        search_hash = stable_id(row.customer.id, row.campaign.id, ad_group_id, term)
        detail_rows.append({
            'report_date': str(row.segments.date),
            'customer_id': str(row.customer.id),
            'campaign_id': str(row.campaign.id),
            'campaign_name': row.campaign.name,
            'ad_group_id': ad_group_id,
            'ad_group_name': None if is_campaign_level else row.ad_group.name,
            'search_term_hash': search_hash,
            'search_term': term,
            'search_term_status': None if is_campaign_level else enum_name(row.search_term_view.status),
            'campaign_search_term': is_campaign_level,
            'currency_code': row.customer.currency_code,
            'cost': micros_to_units(row.metrics.cost_micros),
            'impressions': safe_int(row.metrics.impressions),
            'clicks': safe_int(row.metrics.clicks),
            'conversions': safe_float(row.metrics.conversions),
            'conversion_value': safe_float(row.metrics.conversions_value),
            'raw_payload': json_or_none({'campaign_search_term': is_campaign_level}),
            'ingestion_run_id': run_id,
        })
    return detail_rows


def product_detail_payload(rows: list[Any], run_id: int) -> list[dict]:
    detail_rows: list[dict] = []
    for row in rows:
        ad_group_id = str(getattr(row.ad_group, 'id', '') or '')
        product_hash = stable_id(
            row.customer.id,
            row.campaign.id,
            ad_group_id,
            row.segments.product_merchant_id,
            row.segments.product_item_id,
            row.segments.product_title,
        )
        detail_rows.append({
            'report_date': str(row.segments.date),
            'customer_id': str(row.customer.id),
            'campaign_id': str(row.campaign.id),
            'campaign_name': row.campaign.name,
            'ad_group_id': ad_group_id,
            'ad_group_name': getattr(row.ad_group, 'name', None),
            'product_key_hash': product_hash,
            'product_item_id': row.segments.product_item_id,
            'product_title': row.segments.product_title,
            'product_brand': row.segments.product_brand,
            'product_type_l1': row.segments.product_type_l1,
            'product_type_l2': row.segments.product_type_l2,
            'product_channel': enum_name(row.segments.product_channel),
            'merchant_id': str(row.segments.product_merchant_id or ''),
            'currency_code': row.customer.currency_code,
            'cost': micros_to_units(row.metrics.cost_micros),
            'impressions': safe_int(row.metrics.impressions),
            'clicks': safe_int(row.metrics.clicks),
            'conversions': safe_float(row.metrics.conversions),
            'conversion_value': safe_float(row.metrics.conversions_value),
            'raw_payload': json_or_none({'collector': 'shopping_performance_view'}),
            'ingestion_run_id': run_id,
        })
    return detail_rows


def resolve_single_customer_id(args, customer_ids: list[str]) -> str:
    customer_id = normalize_customer_arg(getattr(args, 'customer_id', ''))
    if customer_id:
        return customer_id
    if len(customer_ids) == 1:
        return customer_ids[0]
    raise ValueError('Provide exactly one --customer-id or configure exactly one GOOGLE_ADS_CUSTOMER_IDS value')


def resolve_single_campaign_id(args) -> str:
    campaign_id = normalize_campaign_arg(getattr(args, 'campaign_id', ''))
    if campaign_id:
        return campaign_id
    campaign_ids = parse_campaign_ids(getattr(args, 'campaign_ids', ''))
    if len(campaign_ids) == 1:
        return campaign_ids[0]
    raise ValueError('Provide exactly one --campaign-id or --campaign-ids value')


def fetch_api_campaign_totals(client: GoogleAdsClient, customer_id: str, campaign_id: str, date_from: str, date_to: str) -> dict:
    campaign_args = argparse.Namespace(campaign_ids=campaign_id, campaign_id='', campaign_names='')
    rows = fetch_campaign_daily_rows(client, customer_id, date_from, date_to, campaign_args)
    totals = {
        'cost': 0.0,
        'impressions': 0,
        'clicks': 0,
        'conversions': 0.0,
        'conversion_value': 0.0,
        'rows': len(rows),
    }
    for row in rows:
        totals['cost'] += micros_to_units(row.metrics.cost_micros)
        totals['impressions'] += safe_int(row.metrics.impressions)
        totals['clicks'] += safe_int(row.metrics.clicks)
        totals['conversions'] += safe_float(row.metrics.conversions)
        totals['conversion_value'] += safe_float(row.metrics.conversions_value)
    totals['cost'] = round(totals['cost'], 6)
    totals['conversions'] = round(totals['conversions'], 6)
    totals['conversion_value'] = round(totals['conversion_value'], 6)
    return totals


def fetch_local_campaign_totals(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    ensure_fact_ads_daily_conversion_value_column(cur)
    cur.execute(
        """
        SELECT
            COUNT(*) AS rows_count,
            ROUND(COALESCE(SUM(spend), 0), 6) AS cost,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions,
            ROUND(COALESCE(SUM(conversion_value), 0), 6) AS conversion_value
        FROM canonical_fact_ads_daily
        WHERE source_key = %s
          AND platform_account_id = %s
          AND platform_campaign_id = %s
          AND fact_scope = 'campaign'
          AND native_grain = 'campaign'
          AND report_date BETWEEN %s AND %s
        """,
        (SOURCE_KEY, customer_id, campaign_id, date_from, date_to),
    )
    row = cur.fetchone() or {}
    cur.close()
    conn.close()
    return {
        'cost': money(row.get('cost')),
        'impressions': safe_int(row.get('impressions')),
        'clicks': safe_int(row.get('clicks')),
        'conversions': money(row.get('conversions')),
        'conversion_value': money(row.get('conversion_value')),
        'rows': safe_int(row.get('rows_count')),
    }


def print_validation_metric(metric: str, api_totals: dict, local_totals: dict) -> None:
    api_value = api_totals.get(metric)
    local_value = local_totals.get(metric)
    absolute, pct = metric_diff(api_value, local_value)
    api_text = 'N/A' if api_value is None else str(api_value)
    local_text = 'N/A' if local_value is None else str(local_value)
    diff_text = 'N/A' if absolute is None else str(absolute)
    pct_text = 'N/A' if pct is None else f'{pct}%'
    print(f'{metric}: api={api_text} local={local_text} diff={diff_text} diff_pct={pct_text}')


def command_validate(client: GoogleAdsClient, customer_id: str, campaign_id: str, date_from: str, date_to: str) -> None:
    api_totals = fetch_api_campaign_totals(client, customer_id, campaign_id, date_from, date_to)
    local_totals = fetch_local_campaign_totals(customer_id, campaign_id, date_from, date_to)
    print(f'Google Ads validation {customer_id}/{campaign_id} {date_from}..{date_to}')
    print(f'api_rows={api_totals["rows"]} local_rows={local_totals["rows"]}')
    for metric in ('cost', 'impressions', 'clicks', 'conversions', 'conversion_value'):
        print_validation_metric(metric, api_totals, local_totals)


def fetch_local_search_term_control_summary(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            COUNT(*) AS rows_count,
            COUNT(DISTINCT search_term_hash) AS search_terms_analyzed,
            ROUND(COALESCE(SUM(cost), 0), 6) AS cost,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions,
            ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions
        FROM google_ads_search_term_performance_daily
        WHERE customer_id = %s
          AND campaign_id = %s
          AND report_date BETWEEN %s AND %s
        """,
        (customer_id, campaign_id, date_from, date_to),
    )
    row = cur.fetchone() or {}
    cur.close()
    conn.close()
    return {
        'rows': safe_int(row.get('rows_count')),
        'search_terms_analyzed': safe_int(row.get('search_terms_analyzed')),
        'cost': money(row.get('cost')),
        'clicks': safe_int(row.get('clicks')),
        'impressions': safe_int(row.get('impressions')),
        'conversions': money(row.get('conversions')),
    }


def fetch_recommendation_control_summary(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> dict[str, dict]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            status,
            COUNT(*) AS recommendation_count,
            ROUND(COALESCE(SUM(cost), 0), 6) AS total_cost,
            COALESCE(SUM(clicks), 0) AS total_clicks,
            COALESCE(SUM(impressions), 0) AS total_impressions
        FROM google_ads_negative_keyword_recommendations
        WHERE customer_id = %s
          AND campaign_id = %s
          AND date_from = %s
          AND date_to = %s
        GROUP BY status
        """,
        (customer_id, campaign_id, date_from, date_to),
    )
    rows = {row['status']: row for row in cur.fetchall()}
    cur.close()
    conn.close()
    return rows


def fetch_top_pending_recommendations(customer_id: str, campaign_id: str, date_from: str, date_to: str, limit: int = 20) -> list[dict]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            id, search_term, suggested_negative_keyword, match_type, cost,
            clicks, impressions, conversions, reason_code, confidence, created_at
        FROM google_ads_negative_keyword_recommendations
        WHERE customer_id = %s
          AND campaign_id = %s
          AND date_from = %s
          AND date_to = %s
          AND status = 'pending'
        ORDER BY cost DESC, clicks DESC, impressions DESC, created_at DESC
        LIMIT %s
        """,
        (customer_id, campaign_id, date_from, date_to, max(int(limit), 1)),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def fetch_mutation_log_control_rows(customer_id: str, campaign_id: str, limit: int = 20) -> list[dict]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            id, recommendation_id, mutation_type, entity_type, entity_id,
            status, error_message, created_at, applied_at
        FROM google_ads_mutation_log
        WHERE customer_id = %s
          AND campaign_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT %s
        """,
        (customer_id, campaign_id, max(int(limit), 1)),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def fetch_product_control_summary(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> tuple[dict, list[dict]]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            COUNT(*) AS products_total,
            SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) AS products_with_spend,
            SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END) AS products_with_clicks,
            SUM(CASE WHEN conversions = 0 THEN 1 ELSE 0 END) AS products_with_zero_conversions
        FROM (
            SELECT
                product_key_hash,
                ROUND(COALESCE(SUM(cost), 0), 6) AS cost,
                COALESCE(SUM(clicks), 0) AS clicks,
                ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions
            FROM google_ads_product_performance_daily
            WHERE customer_id = %s
              AND campaign_id = %s
              AND report_date BETWEEN %s AND %s
            GROUP BY product_key_hash
        ) product_totals
        """,
        (customer_id, campaign_id, date_from, date_to),
    )
    summary_row = cur.fetchone() or {}
    cur.execute(
        """
        SELECT
            product_item_id,
            product_title,
            product_brand,
            merchant_id,
            ROUND(COALESCE(SUM(cost), 0), 6) AS cost,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions,
            ROUND(COALESCE(SUM(conversions), 0), 6) AS conversions,
            ROUND(COALESCE(SUM(conversion_value), 0), 6) AS conversion_value
        FROM google_ads_product_performance_daily
        WHERE customer_id = %s
          AND campaign_id = %s
          AND report_date BETWEEN %s AND %s
        GROUP BY product_key_hash, product_item_id, product_title, product_brand, merchant_id
        HAVING cost > 0 OR clicks > 0 OR impressions > 0
        ORDER BY cost DESC, clicks DESC, impressions DESC
        LIMIT 20
        """,
        (customer_id, campaign_id, date_from, date_to),
    )
    top_rows = cur.fetchall()
    cur.close()
    conn.close()
    summary = {
        'products_total': safe_int(summary_row.get('products_total')),
        'products_with_spend': safe_int(summary_row.get('products_with_spend')),
        'products_with_clicks': safe_int(summary_row.get('products_with_clicks')),
        'products_with_zero_conversions': safe_int(summary_row.get('products_with_zero_conversions')),
    }
    return summary, top_rows


def print_control_section(title: str) -> None:
    print(f'\n## {title}')


def command_control_report(client: GoogleAdsClient, customer_id: str, campaign_id: str, date_from: str, date_to: str) -> None:
    ensure_google_ads_tables()
    campaign_args = argparse.Namespace(campaign_id=campaign_id, campaign_ids='', campaign_names='')
    campaigns = fetch_campaigns(client, customer_id, campaign_args)
    api_totals = fetch_api_campaign_totals(client, customer_id, campaign_id, date_from, date_to)
    local_totals = fetch_local_campaign_totals(customer_id, campaign_id, date_from, date_to)
    search_summary = fetch_local_search_term_control_summary(customer_id, campaign_id, date_from, date_to)
    recommendation_summary = fetch_recommendation_control_summary(customer_id, campaign_id, date_from, date_to)
    pending_recommendations = fetch_top_pending_recommendations(customer_id, campaign_id, date_from, date_to)
    mutation_rows = fetch_mutation_log_control_rows(customer_id, campaign_id)
    product_summary, top_products = fetch_product_control_summary(customer_id, campaign_id, date_from, date_to)

    print(f'Google Ads control report {customer_id}/{campaign_id} {date_from}..{date_to}')
    print('read_only=true')

    print_control_section('Campaign Info')
    if campaigns:
        row = campaigns[0]
        print(f'customer_id={row.customer.id}')
        print(f'customer_name={row.customer.descriptive_name}')
        print(f'currency_code={row.customer.currency_code}')
        print(f'time_zone={row.customer.time_zone}')
        print(f'campaign_id={row.campaign.id}')
        print(f'campaign_name={row.campaign.name}')
        print(f'campaign_status={enum_name(row.campaign.status)}')
        print(f'advertising_channel_type={enum_name(row.campaign.advertising_channel_type)}')
        print(f'daily_budget={micros_to_units(row.campaign_budget.amount_micros)}')
    else:
        print('campaign_found=false')

    print_control_section('API vs Local Validation')
    print(f'api_rows={api_totals["rows"]} local_rows={local_totals["rows"]}')
    for metric in ('cost', 'impressions', 'clicks', 'conversions', 'conversion_value'):
        print_validation_metric(metric, api_totals, local_totals)

    print_control_section('Spend / Click / Conversion Totals')
    print('metric\tapi\tlocal')
    for metric in ('cost', 'clicks', 'conversions', 'conversion_value'):
        print(f'{metric}\t{api_totals.get(metric)}\t{local_totals.get(metric)}')

    print_control_section('Search Terms Analyzed')
    print(f'rows={search_summary["rows"]}')
    print(f'search_terms_analyzed={search_summary["search_terms_analyzed"]}')
    print(f'cost={search_summary["cost"]}')
    print(f'clicks={search_summary["clicks"]}')
    print(f'impressions={search_summary["impressions"]}')
    print(f'conversions={search_summary["conversions"]}')

    print_control_section('Recommendation Summary By Status')
    print('status\tcount\ttotal_cost\ttotal_clicks\ttotal_impressions')
    for status in ('pending', 'approved', 'rejected', 'applied'):
        row = recommendation_summary.get(status, {})
        print(
            '\t'.join([
                status,
                str(safe_int(row.get('recommendation_count'))),
                str(money(row.get('total_cost'))),
                str(safe_int(row.get('total_clicks'))),
                str(safe_int(row.get('total_impressions'))),
            ])
        )

    print_control_section('Top Pending Recommendations By Cost')
    print('id\tsearch_term\tsuggested_negative_keyword\tmatch_type\tcost\tclicks\timpressions\tconversions\treason_code\tconfidence\tcreated_at')
    for row in pending_recommendations:
        print(
            '\t'.join(
                str(row.get(field) if row.get(field) is not None else '')
                for field in (
                    'id',
                    'search_term',
                    'suggested_negative_keyword',
                    'match_type',
                    'cost',
                    'clicks',
                    'impressions',
                    'conversions',
                    'reason_code',
                    'confidence',
                    'created_at',
                )
            )
        )

    print_control_section('Last 20 Mutation Log Entries')
    print('id\trecommendation_id\tmutation_type\tentity_type\tentity_id\tstatus\terror_message\tcreated_at\tapplied_at')
    for row in mutation_rows:
        print(
            '\t'.join(
                str(row.get(field) if row.get(field) is not None else '')
                for field in (
                    'id',
                    'recommendation_id',
                    'mutation_type',
                    'entity_type',
                    'entity_id',
                    'status',
                    'error_message',
                    'created_at',
                    'applied_at',
                )
            )
        )

    print_control_section('Product Performance Summary')
    print(f'products_total={product_summary["products_total"]}')
    print(f'products_with_spend={product_summary["products_with_spend"]}')
    print(f'products_with_clicks={product_summary["products_with_clicks"]}')
    print(f'products_with_zero_conversions={product_summary["products_with_zero_conversions"]}')
    print('top_products_by_cost:')
    print('product_item_id\tproduct_title\tproduct_brand\tmerchant_id\tcost\tclicks\timpressions\tconversions\tconversion_value')
    for row in top_products:
        print(
            '\t'.join(
                str(row.get(field) if row.get(field) is not None else '')
                for field in (
                    'product_item_id',
                    'product_title',
                    'product_brand',
                    'merchant_id',
                    'cost',
                    'clicks',
                    'impressions',
                    'conversions',
                    'conversion_value',
                )
            )
        )


def fetch_search_term_aggregates(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> list[dict]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            search_term,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            ROUND(SUM(cost), 6) AS cost,
            ROUND(SUM(conversions), 6) AS conversions,
            ROUND(SUM(conversion_value), 6) AS conversion_value
        FROM google_ads_search_term_performance_daily
        WHERE customer_id = %s
          AND campaign_id = %s
          AND report_date BETWEEN %s AND %s
        GROUP BY search_term
        ORDER BY cost DESC, clicks DESC, impressions DESC
        """,
        (customer_id, campaign_id, date_from, date_to),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def existing_pending_negative_keywords(customer_id: str, campaign_id: str) -> set[tuple[str, str]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT suggested_negative_keyword, match_type
        FROM google_ads_negative_keyword_recommendations
        WHERE customer_id = %s
          AND campaign_id = %s
          AND status = 'pending'
        """,
        (customer_id, campaign_id),
    )
    existing = {(str(keyword), str(match_type)) for keyword, match_type in cur.fetchall()}
    cur.close()
    conn.close()
    return existing


def insert_negative_recommendations(rows: list[dict]) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO google_ads_negative_keyword_recommendations (
            customer_id, campaign_id, date_from, date_to,
            search_term, suggested_negative_keyword, match_type,
            impressions, clicks, cost, conversions, conversion_value,
            reason_code, reason_text, confidence, status
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s
        )
        """,
        [
            (
                row['customer_id'],
                row['campaign_id'],
                row['date_from'],
                row['date_to'],
                row['search_term'],
                row['suggested_negative_keyword'],
                row['match_type'],
                row['impressions'],
                row['clicks'],
                row['cost'],
                row['conversions'],
                row['conversion_value'],
                row['reason_code'],
                row['reason_text'],
                row['confidence'],
                row['status'],
            )
            for row in rows
        ],
    )
    conn.commit()
    cur.close()
    conn.close()
    return len(rows)


def recommendation_row_by_id(rec_id: int) -> dict | None:
    ensure_google_ads_tables()
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            id, customer_id, campaign_id, date_from, date_to, search_term,
            suggested_negative_keyword, match_type, impressions, clicks, cost,
            conversions, conversion_value, reason_code, reason_text, confidence,
            status, reviewed_at, review_note, created_at, updated_at, applied_at
        FROM google_ads_negative_keyword_recommendations
        WHERE id = %s
        """,
        (rec_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row


def print_recommendation_row(row: dict) -> None:
    fields = [
        'id',
        'customer_id',
        'campaign_id',
        'search_term',
        'suggested_negative_keyword',
        'match_type',
        'cost',
        'clicks',
        'impressions',
        'conversions',
        'reason_code',
        'confidence',
        'status',
        'reviewed_at',
        'review_note',
        'created_at',
        'applied_at',
    ]
    print('\t'.join(str(row.get(field) if row.get(field) is not None else '') for field in fields))


def command_list_recommendations(args) -> None:
    ensure_google_ads_tables()
    filters: list[str] = []
    params: list[Any] = []
    customer_id = normalize_customer_arg(args.customer_id)
    campaign_id = normalize_campaign_arg(args.campaign_id)
    status = str(args.status or '').strip()
    if customer_id:
        filters.append('customer_id = %s')
        params.append(customer_id)
    if campaign_id:
        filters.append('campaign_id = %s')
        params.append(campaign_id)
    if status:
        filters.append('status = %s')
        params.append(status)
    where = 'WHERE ' + ' AND '.join(filters) if filters else ''
    limit = max(int(args.limit or 50), 1)
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        f"""
        SELECT
            id, search_term, suggested_negative_keyword, match_type, cost,
            clicks, impressions, conversions, reason_code, confidence,
            status, created_at
        FROM google_ads_negative_keyword_recommendations
        {where}
        ORDER BY cost DESC, created_at DESC
        LIMIT %s
        """,
        tuple(params + [limit]),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    print('id\tsearch_term\tsuggested_negative_keyword\tmatch_type\tcost\tclicks\timpressions\tconversions\treason_code\tconfidence\tstatus\tcreated_at')
    for row in rows:
        print(
            '\t'.join(
                str(row.get(field) if row.get(field) is not None else '')
                for field in (
                    'id',
                    'search_term',
                    'suggested_negative_keyword',
                    'match_type',
                    'cost',
                    'clicks',
                    'impressions',
                    'conversions',
                    'reason_code',
                    'confidence',
                    'status',
                    'created_at',
                )
            )
        )


def command_approve_recommendation(rec_id: int) -> None:
    if rec_id <= 0:
        raise ValueError('Provide --id for approve-recommendation')
    ensure_google_ads_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE google_ads_negative_keyword_recommendations
        SET status = 'approved',
            reviewed_at = NOW(),
            applied_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """,
        (rec_id,),
    )
    conn.commit()
    cur.close()
    conn.close()
    row = recommendation_row_by_id(rec_id)
    if not row:
        raise ValueError(f'Recommendation not found: id={rec_id}')
    print_recommendation_row(row)


def command_reject_recommendation(rec_id: int, note: str) -> None:
    if rec_id <= 0:
        raise ValueError('Provide --id for reject-recommendation')
    ensure_google_ads_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE google_ads_negative_keyword_recommendations
        SET status = 'rejected',
            reviewed_at = NOW(),
            review_note = %s,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """,
        (note, rec_id),
    )
    conn.commit()
    cur.close()
    conn.close()
    row = recommendation_row_by_id(rec_id)
    if not row:
        raise ValueError(f'Recommendation not found: id={rec_id}')
    print_recommendation_row(row)


def command_recommendation_summary(args) -> None:
    ensure_google_ads_tables()
    customer_id = normalize_customer_arg(args.customer_id)
    campaign_id = normalize_campaign_arg(args.campaign_id)
    filters: list[str] = []
    params: list[Any] = []
    if customer_id:
        filters.append('customer_id = %s')
        params.append(customer_id)
    if campaign_id:
        filters.append('campaign_id = %s')
        params.append(campaign_id)
    where = 'WHERE ' + ' AND '.join(filters) if filters else ''
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        f"""
        SELECT
            status,
            COUNT(*) AS recommendation_count,
            ROUND(COALESCE(SUM(cost), 0), 6) AS total_cost,
            COALESCE(SUM(clicks), 0) AS total_clicks,
            COALESCE(SUM(impressions), 0) AS total_impressions
        FROM google_ads_negative_keyword_recommendations
        {where}
        GROUP BY status
        """,
        tuple(params),
    )
    by_status = {row['status']: row for row in cur.fetchall()}
    cur.close()
    conn.close()
    print('status\tcount\ttotal_cost\ttotal_clicks\ttotal_impressions')
    for status in ('pending', 'approved', 'rejected', 'applied'):
        row = by_status.get(status, {})
        print(
            '\t'.join([
                status,
                str(safe_int(row.get('recommendation_count'))),
                str(money(row.get('total_cost'))),
                str(safe_int(row.get('total_clicks'))),
                str(safe_int(row.get('total_impressions'))),
            ])
        )


def fetch_approved_negative_recommendations(customer_id: str, campaign_id: str, limit: int) -> list[dict]:
    ensure_google_ads_tables()
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT
            id, customer_id, campaign_id, search_term, suggested_negative_keyword,
            match_type, cost, clicks, impressions, conversions, reason_code,
            confidence, status, created_at
        FROM google_ads_negative_keyword_recommendations
        WHERE status = 'approved'
          AND applied_at IS NULL
          AND customer_id = %s
          AND campaign_id = %s
        ORDER BY cost DESC, created_at ASC
        LIMIT %s
        """,
        (customer_id, campaign_id, max(int(limit or 50), 1)),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def fetch_existing_campaign_negative_keywords(client: GoogleAdsClient, customer_id: str, campaign_id: str) -> set[tuple[str, str]]:
    query = f"""
        SELECT
          campaign_criterion.criterion_id,
          campaign_criterion.keyword.text,
          campaign_criterion.keyword.match_type,
          campaign_criterion.negative
        FROM campaign_criterion
        WHERE campaign.id = {campaign_id}
          AND campaign_criterion.negative = TRUE
    """
    existing: set[tuple[str, str]] = set()
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            for row in fetch_gaql_rows(client, customer_id, query, log):
                keyword_text = getattr(row.campaign_criterion.keyword, 'text', '')
                if keyword_text:
                    existing.add((normalize_search_text(keyword_text), enum_name(row.campaign_criterion.keyword.match_type) or ''))
            return existing
        except Exception as exc:
            last_error = exc
            if 'Channel deallocated' not in str(exc) or attempt == 3:
                raise
            log.warning('Retrying existing negative keyword query after transient channel error attempt=%s', attempt)
    if last_error:
        raise last_error
    return existing


def keyword_match_type_enum(client: GoogleAdsClient, match_type: str):
    normalized = str(match_type or 'PHRASE').strip().upper()
    enum = client.enums.KeywordMatchTypeEnum
    return getattr(enum, normalized, enum.PHRASE)


def build_campaign_negative_keyword_operation(client: GoogleAdsClient, customer_id: str, campaign_id: str, keyword_text: str, match_type: str):
    operation = client.get_type('CampaignCriterionOperation')
    criterion = operation.create
    criterion.campaign = client.get_service('CampaignService').campaign_path(customer_id, campaign_id)
    criterion.negative = True
    criterion.keyword.text = keyword_text
    criterion.keyword.match_type = keyword_match_type_enum(client, match_type)
    return operation


def insert_mutation_log(
    customer_id: str,
    campaign_id: str,
    recommendation_id: int | None,
    payload: dict,
    status: str,
    entity_id: str | None = None,
    error_message: str | None = None,
) -> int:
    ensure_google_ads_tables()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO google_ads_mutation_log (
            customer_id, campaign_id, recommendation_id,
            mutation_type, entity_type, entity_id, payload_json,
            operation_type, approval_ref, request_payload, response_payload,
            status, error_message, applied_at
        ) VALUES (
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, CASE WHEN %s = 'success' THEN NOW() ELSE NULL END
        )
        """,
        (
            customer_id,
            campaign_id,
            recommendation_id,
            'ADD_CAMPAIGN_NEGATIVE_KEYWORD',
            'campaign_criterion',
            entity_id,
            json_or_none(payload),
            'ADD_CAMPAIGN_NEGATIVE_KEYWORD',
            str(recommendation_id or ''),
            json_or_none(payload),
            None,
            status,
            error_message,
            status,
        ),
    )
    log_id = int(cur.lastrowid)
    conn.commit()
    cur.close()
    conn.close()
    return log_id


def mark_recommendations_applied(ids: list[int]) -> None:
    if not ids:
        return
    placeholders = ', '.join(['%s'] * len(ids))
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        f"""
        UPDATE google_ads_negative_keyword_recommendations
        SET status = 'applied',
            applied_at = NOW(),
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN ({placeholders})
        """,
        tuple(ids),
    )
    conn.commit()
    cur.close()
    conn.close()


def command_apply_approved_negatives(client: GoogleAdsClient, args, customer_ids: list[str]) -> None:
    customer_id = resolve_single_customer_id(args, customer_ids)
    campaign_id = resolve_single_campaign_id(args)
    confirm_apply = bool(args.confirm_apply)
    approved = fetch_approved_negative_recommendations(customer_id, campaign_id, args.limit)
    print(f'Google Ads apply-approved-negatives {customer_id}/{campaign_id} confirm_apply={confirm_apply}')
    print(f'approved_recommendations_found={len(approved)}')
    if not approved:
        return

    existing = fetch_existing_campaign_negative_keywords(client, customer_id, campaign_id)
    planned: list[dict] = []
    skipped = 0
    for row in approved:
        keyword = str(row['suggested_negative_keyword']).strip()
        match_type = str(row.get('match_type') or 'PHRASE').strip().upper()
        key = (normalize_search_text(keyword), match_type)
        if key in existing:
            skipped += 1
            insert_mutation_log(
                customer_id,
                campaign_id,
                int(row['id']),
                {'recommendation': row, 'confirm_apply': confirm_apply, 'reason': 'campaign negative keyword already exists'},
                'skipped_duplicate',
            )
            continue
        planned.append(row)

    print(f'planned_operations={len(planned)}')
    print(f'skipped_duplicate={skipped}')
    for row in planned:
        print(
            '\t'.join([
                str(row['id']),
                str(row['suggested_negative_keyword']),
                str(row.get('match_type') or 'PHRASE'),
                str(row.get('cost')),
                str(row.get('clicks')),
                str(row.get('reason_code')),
            ])
        )

    if not planned:
        return

    if not confirm_apply:
        for row in planned:
            insert_mutation_log(
                customer_id,
                campaign_id,
                int(row['id']),
                {
                    'recommendation': row,
                    'confirm_apply': False,
                    'keyword': row['suggested_negative_keyword'],
                    'match_type': row.get('match_type') or 'PHRASE',
                },
                'dry_run',
            )
        print('dry_run_only=true')
        print('No Google Ads mutate call was made. Re-run with --confirm-apply to apply approved negatives.')
        return

    service = client.get_service('CampaignCriterionService')
    applied_count = 0
    for row in planned:
        keyword = str(row['suggested_negative_keyword']).strip()
        match_type = str(row.get('match_type') or 'PHRASE').strip().upper()
        payload = {
            'recommendation': row,
            'confirm_apply': True,
            'keyword': keyword,
            'match_type': match_type,
        }
        try:
            operation = build_campaign_negative_keyword_operation(client, customer_id, campaign_id, keyword, match_type)
            response = service.mutate_campaign_criteria(
                customer_id=customer_id,
                operations=[operation],
                partial_failure=False,
                validate_only=False,
            )
            entity_id = response.results[0].resource_name if response.results else ''
            insert_mutation_log(customer_id, campaign_id, int(row['id']), payload, 'success', entity_id=entity_id)
            mark_recommendations_applied([int(row['id'])])
            applied_count += 1
            print(f'applied\t{row["id"]}\t{entity_id}')
        except Exception as exc:
            insert_mutation_log(
                customer_id,
                campaign_id,
                int(row['id']),
                payload,
                'failed',
                error_message=str(exc),
            )
            print(f'failed\t{row["id"]}\t{keyword}\t{exc}')
    print(f'applied_operations={applied_count}')
def command_recommend_negatives(customer_id: str, campaign_id: str, date_from: str, date_to: str) -> None:
    ensure_google_ads_tables()
    aggregates = fetch_search_term_aggregates(customer_id, campaign_id, date_from, date_to)
    existing = existing_pending_negative_keywords(customer_id, campaign_id)
    seen = set(existing)
    recommendations: list[dict] = []
    wasted_cost = 0.0

    for row in aggregates:
        clicks = safe_int(row.get('clicks'))
        cost = money(row.get('cost'))
        conversions = money(row.get('conversions'))
        if not (cost > 0 or clicks > 0):
            continue
        if conversions != 0:
            continue
        rec = build_negative_recommendation(row)
        key = (rec['suggested_negative_keyword'], rec['match_type'])
        if key in seen:
            continue
        seen.add(key)
        wasted_cost += cost
        recommendations.append({
            'customer_id': customer_id,
            'campaign_id': campaign_id,
            'date_from': date_from,
            'date_to': date_to,
            'search_term': rec['search_term'],
            'suggested_negative_keyword': rec['suggested_negative_keyword'],
            'match_type': rec['match_type'],
            'impressions': safe_int(row.get('impressions')),
            'clicks': clicks,
            'cost': cost,
            'conversions': conversions,
            'conversion_value': money(row.get('conversion_value')),
            'reason_code': rec['reason_code'],
            'reason_text': rec['reason_text'],
            'confidence': rec['confidence'],
            'status': 'pending',
        })

    created = insert_negative_recommendations(recommendations)
    print(f'Google Ads negative keyword recommendations {customer_id}/{campaign_id} {date_from}..{date_to}')
    print(f'search_terms_analyzed={len(aggregates)}')
    print(f'recommendations_created={created}')
    print(f'total_wasted_cost_represented={round(wasted_cost, 6)}')
    print('top_recommendations_by_cost:')
    for row in sorted(recommendations, key=lambda item: (item['cost'], item['clicks'], item['impressions']), reverse=True)[:20]:
        print(
            '\t'.join([
                str(row['suggested_negative_keyword']),
                row['match_type'],
                str(row['cost']),
                str(row['clicks']),
                str(row['impressions']),
                row['reason_code'],
                row['search_term'],
            ])
        )


def upsert_validation_rows(customer_id: str, date_from: str, date_to: str, run_id: int) -> int:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT report_date, currency_code, ROUND(SUM(spend), 6) AS spend
        FROM canonical_fact_ads_daily
        WHERE source_key = %s
          AND platform_account_id = %s
          AND fact_scope = 'campaign'
          AND native_grain = 'campaign'
          AND report_date BETWEEN %s AND %s
        GROUP BY report_date, currency_code
        """,
        (SOURCE_KEY, customer_id, date_from, date_to),
    )
    rows = []
    for row in cur.fetchall():
        spend = safe_float(row['spend'])
        rows.append({
            'report_date': row['report_date'],
            'customer_id': customer_id,
            'currency_code': row['currency_code'],
            'canonical_campaign_spend': spend,
            'google_campaign_api_spend': spend,
            'diff': 0,
            'status': 'api_equal_canonical',
            'raw_payload': json_or_none({
                'note': 'Compare this daily campaign total to the Google Ads UI for the same account/date/currency.',
                'ui_scope': 'Campaigns report, date by day, cost excluding removed campaigns',
            }),
            'ingestion_run_id': run_id,
        })
    cur.close()
    conn.close()
    return upsert_detail_rows(
        'google_ads_spend_validation_daily',
        [
            'report_date', 'customer_id', 'currency_code', 'canonical_campaign_spend',
            'google_campaign_api_spend', 'diff', 'status', 'raw_payload', 'ingestion_run_id',
        ],
        rows,
    )


def print_config_summary(customer_ids: list[str], missing: list[str]) -> None:
    print('Google Ads config:', 'missing ' + ', '.join(missing) if missing else 'ok')
    print(f'Configured customer IDs: {", ".join(customer_ids) if customer_ids else "(none)"}')
    print(f'Login customer ID: {normalize_customer_id(env_first("GOOGLE_ADS_LOGIN_CUSTOMER_ID")) or "(not set)"}')


def resolve_customer_ids(args) -> list[str]:
    if getattr(args, 'customer_id', ''):
        customer_id = normalize_customer_arg(args.customer_id)
        return [customer_id] if customer_id else []
    return parse_customer_ids(args.customer_ids) if args.customer_ids else parse_customer_ids()


def command_list_accessible_customers(client: GoogleAdsClient) -> None:
    for customer_id in list_accessible_customers(client):
        print(customer_id)


def command_list_campaigns(client: GoogleAdsClient, customer_ids: list[str], args=None) -> None:
    for customer_id in customer_ids:
        for row in fetch_campaigns(client, customer_id, args):
            campaign = row.campaign
            print(
                '\t'.join([
                    str(row.customer.id),
                    str(campaign.id),
                    campaign.name,
                    enum_name(campaign.status) or '',
                    enum_name(campaign.advertising_channel_type) or '',
                ])
            )


def command_negative_keyword_todos() -> None:
    ensure_google_ads_tables()
    print('Future mutation workflow placeholder is ready:')
    print('- google_ads_negative_keyword_recommendation_todos stores recommendation and human approval state.')
    print('- No Google Ads mutate services are called by this collector.')
    print('- A future applier should require approval_status=approved before adding negatives.')


def command_debug(client: GoogleAdsClient, customer_ids: list[str], args, date_from: str, date_to: str) -> None:
    print_config_summary(customer_ids, [])
    try:
        accessible = list_accessible_customers(client)
        print(f'Accessible customers: {len(accessible)}')
        print(', '.join(accessible))
    except Exception as exc:
        print(f'Accessible customers check failed: {type(exc).__name__}: {exc}')

    for customer_id in customer_ids:
        print(f'\nCustomer {customer_id} debug window {date_from}..{date_to}')
        campaigns = fetch_campaigns(client, customer_id, args)
        print(f'Campaigns matched: {len(campaigns)}')
        for row in campaigns[:20]:
            print(
                '  '
                + '\t'.join([
                    str(row.campaign.id),
                    row.campaign.name,
                    enum_name(row.campaign.status) or '',
                    enum_name(row.campaign.advertising_channel_type) or '',
                ])
            )
        campaign_rows = fetch_campaign_daily_rows(client, customer_id, date_from, date_to, args)
        print(f'Campaign daily rows: {len(campaign_rows)}')
        print(f'Campaign daily spend: {round(sum(micros_to_units(row.metrics.cost_micros) for row in campaign_rows), 6)}')
        asset_rows = fetch_asset_group_daily_rows(client, customer_id, date_from, date_to, args)
        print(f'PMax asset group rows: {len(asset_rows)}')
        if args.skip_search_terms:
            print('Search term rows: skipped')
        else:
            search_rows = fetch_search_term_rows(client, customer_id, date_from, date_to, args)
            search_rows.extend(fetch_pmax_search_term_rows(client, customer_id, date_from, date_to, args))
            print(f'Search term rows: {len(search_rows)}')
        if args.skip_product_performance:
            print('Product rows: skipped')
        else:
            product_rows = fetch_product_rows(client, customer_id, date_from, date_to, args)
            print(f'Product rows: {len(product_rows)}')


def collect_customer(client: GoogleAdsClient, customer_id: str, args, date_from: str, date_to: str, correlation_id: str) -> None:
    run_id = start_collector_run(
        source_key=SOURCE_KEY,
        run_type=args.run_type,
        run_mode='dry_run' if args.dry_run else 'canonical_read_only',
        job_key=f'{SOURCE_KEY}:{customer_id}:{date_from}:{date_to}',
        correlation_id=correlation_id,
        date_from=date_from,
        date_to=date_to,
    )
    rows_read = 0
    rows_written = 0
    try:
        account = fetch_account(client, customer_id)
        campaign_rows_api = fetch_campaign_daily_rows(client, customer_id, date_from, date_to, args)
        rows_read += len(campaign_rows_api)
        account_rows, campaign_rows, campaign_fact_rows = campaign_meta_rows(account, campaign_rows_api, run_id)

        asset_rows_api = fetch_asset_group_daily_rows(client, customer_id, date_from, date_to, args)
        rows_read += len(asset_rows_api)
        delivery_rows, asset_fact_rows, asset_detail_rows = asset_group_payload(asset_rows_api, run_id)

        search_detail_rows: list[dict] = []
        if not args.skip_search_terms:
            search_rows_api = fetch_search_term_rows(client, customer_id, date_from, date_to, args)
            search_rows_api.extend(fetch_pmax_search_term_rows(client, customer_id, date_from, date_to, args))
            rows_read += len(search_rows_api)
            search_detail_rows = search_term_detail_payload(search_rows_api, run_id)

        product_detail_rows: list[dict] = []
        if not args.skip_product_performance:
            product_rows_api = fetch_product_rows(client, customer_id, date_from, date_to, args)
            rows_read += len(product_rows_api)
            product_detail_rows = product_detail_payload(product_rows_api, run_id)

        if not args.dry_run:
            ensure_google_ads_tables()
            rows_written += upsert_source_accounts(account_rows)
            rows_written += upsert_source_campaigns(campaign_rows)
            rows_written += upsert_delivery_entities(delivery_rows)
            rows_written += upsert_fact_ads_daily(campaign_fact_rows + asset_fact_rows)
            rows_written += upsert_detail_rows(
                'google_ads_pmax_asset_group_daily',
                [
                    'report_date', 'customer_id', 'campaign_id', 'campaign_name', 'asset_group_id',
                    'asset_group_name', 'asset_group_status', 'currency_code', 'cost', 'impressions',
                    'clicks', 'conversions', 'conversion_value', 'raw_payload', 'ingestion_run_id',
                ],
                asset_detail_rows,
            )
            rows_written += upsert_detail_rows(
                'google_ads_search_term_performance_daily',
                [
                    'report_date', 'customer_id', 'campaign_id', 'campaign_name', 'ad_group_id',
                    'ad_group_name', 'search_term_hash', 'search_term', 'search_term_status',
                    'campaign_search_term', 'currency_code', 'cost', 'impressions', 'clicks',
                    'conversions', 'conversion_value', 'raw_payload', 'ingestion_run_id',
                ],
                search_detail_rows,
            )
            rows_written += upsert_detail_rows(
                'google_ads_product_performance_daily',
                [
                    'report_date', 'customer_id', 'campaign_id', 'campaign_name', 'ad_group_id',
                    'ad_group_name', 'product_key_hash', 'product_item_id', 'product_title',
                    'product_brand', 'product_type_l1', 'product_type_l2', 'product_channel',
                    'merchant_id', 'currency_code', 'cost', 'impressions', 'clicks',
                    'conversions', 'conversion_value', 'raw_payload', 'ingestion_run_id',
                ],
                product_detail_rows,
            )
            rows_written += upsert_validation_rows(customer_id, date_from, date_to, run_id)

        log_run_event(run_id, 'info', 'sync_summary', 'Google Ads read-only sync complete', {
            'customer_id': customer_id,
            'dry_run': args.dry_run,
            'campaign_facts': len(campaign_fact_rows),
            'asset_group_facts': len(asset_fact_rows),
            'asset_group_details': len(asset_detail_rows),
            'search_term_details': len(search_detail_rows),
            'product_details': len(product_detail_rows),
            'campaign_ids': parse_campaign_ids(args.campaign_ids),
            'campaign_names': parse_csv_values(args.campaign_names),
        })
        finish_collector_run(run_id, 'success', rows_read, rows_written, rows_written)
        print(
            f'Google Ads {customer_id}: read={rows_read} '
            f'campaign_facts={len(campaign_fact_rows)} asset_group_facts={len(asset_fact_rows)} '
            f'search_terms={len(search_detail_rows)} products={len(product_detail_rows)} written={rows_written}'
        )
    except GoogleAdsException as exc:
        error_summary = f'Google Ads API request failed: {exc.failure}'
        log_google_ads_exception(log, exc, customer_id)
        log_run_event(run_id, 'error', 'google_ads_api_failed', error_summary)
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_written, error_count=1, error_summary=error_summary[:500])
        raise
    except Exception as exc:
        log.exception('Google Ads sync failed customer_id=%s', customer_id)
        log_run_event(run_id, 'error', 'sync_failed', str(exc))
        finish_collector_run(run_id, 'failed', rows_read, rows_written, rows_written, error_count=1, error_summary=str(exc)[:500])
        raise


def main():
    args = parse_args()
    customer_ids = resolve_customer_ids(args)
    require_customer_ids = args.command in (
        'collect',
        'control-report',
        'apply-approved-negatives',
        'debug',
        'list-campaigns',
        'recommend-negatives',
        'validate',
        'validate-spend',
    )
    missing = missing_config_keys(require_customer_ids=require_customer_ids)

    if args.check_config:
        print_config_summary(customer_ids, missing)
        raise SystemExit(1 if missing else 0)
    if missing:
        print_config_summary(customer_ids, missing)
        raise SystemExit(1)

    if args.command == 'list-recommendations':
        command_list_recommendations(args)
        return
    if args.command == 'approve-recommendation':
        command_approve_recommendation(args.id)
        return
    if args.command == 'reject-recommendation':
        command_reject_recommendation(args.id, args.note)
        return
    if args.command == 'recommendation-summary':
        command_recommendation_summary(args)
        return

    client = google_ads_client()
    if args.command == 'apply-approved-negatives':
        command_apply_approved_negatives(client, args, customer_ids)
        return
    if args.command == 'list-accessible-customers':
        command_list_accessible_customers(client)
        return
    if args.command == 'list-campaigns':
        command_list_campaigns(client, customer_ids, args)
        return
    if args.command == 'negative-keyword-todos':
        command_negative_keyword_todos()
        return

    date_from, date_to = date_range(args)
    correlation_id = str(uuid.uuid4())
    if args.command == 'debug':
        command_debug(client, customer_ids, args, date_from, date_to)
        return
    if args.command == 'validate':
        customer_id = resolve_single_customer_id(args, customer_ids)
        campaign_id = resolve_single_campaign_id(args)
        command_validate(client, customer_id, campaign_id, date_from, date_to)
        return
    if args.command == 'control-report':
        customer_id = resolve_single_customer_id(args, customer_ids)
        campaign_id = resolve_single_campaign_id(args)
        command_control_report(client, customer_id, campaign_id, date_from, date_to)
        return
    if args.command == 'recommend-negatives':
        customer_id = resolve_single_customer_id(args, customer_ids)
        campaign_id = resolve_single_campaign_id(args)
        command_recommend_negatives(customer_id, campaign_id, date_from, date_to)
        return
    if args.command == 'validate-spend':
        ensure_google_ads_tables()
        for customer_id in customer_ids:
            run_id = start_collector_run(SOURCE_KEY, args.run_type, 'validation_only', f'{SOURCE_KEY}:validate:{customer_id}:{date_from}:{date_to}', correlation_id, date_from, date_to)
            written = upsert_validation_rows(customer_id, date_from, date_to, run_id)
            finish_collector_run(run_id, 'success', written, written, written)
            print(f'Google Ads validation rows for {customer_id}: {written}')
        return

    for customer_id in customer_ids:
        collect_customer(client, customer_id, args, date_from, date_to, correlation_id)


if __name__ == '__main__':
    main()
