#!/usr/bin/env python3
"""Read-only Google Ads API client helpers for ReportingDash collectors."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values, load_dotenv
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

load_dotenv(Path(__file__).parent / '.env')

LOCAL_ENV_PATH = Path(__file__).parent / '.env'
LEGACY_ENV_PATH = Path('/var/www/www-root/data/.production.env')
local_env = dotenv_values(LOCAL_ENV_PATH)
legacy_env = dotenv_values(LEGACY_ENV_PATH) if LEGACY_ENV_PATH.exists() else {}

REQUIRED_ENV_KEYS = (
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
)


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


def normalize_customer_id(value: Any) -> str:
    return ''.join(ch for ch in str(value or '').strip() if ch.isdigit())


def parse_customer_ids(value: str | None = None) -> list[str]:
    raw = value if value is not None else env_first('GOOGLE_ADS_CUSTOMER_IDS')
    result: list[str] = []
    for item in str(raw or '').replace('\n', ',').split(','):
        normalized = normalize_customer_id(item)
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def missing_config_keys(require_customer_ids: bool = False) -> list[str]:
    keys = list(REQUIRED_ENV_KEYS)
    if require_customer_ids:
        keys.append('GOOGLE_ADS_CUSTOMER_IDS')
    return [key for key in keys if not env_first(key)]


def google_ads_client() -> GoogleAdsClient:
    config: dict[str, Any] = {
        'developer_token': env_first('GOOGLE_ADS_DEVELOPER_TOKEN'),
        'client_id': env_first('GOOGLE_ADS_CLIENT_ID'),
        'client_secret': env_first('GOOGLE_ADS_CLIENT_SECRET'),
        'refresh_token': env_first('GOOGLE_ADS_REFRESH_TOKEN'),
        'use_proto_plus': True,
    }
    login_customer_id = normalize_customer_id(env_first('GOOGLE_ADS_LOGIN_CUSTOMER_ID'))
    if login_customer_id:
        config['login_customer_id'] = login_customer_id
    return GoogleAdsClient.load_from_dict(config)


def search_stream(client: GoogleAdsClient, customer_id: str, query: str):
    service = client.get_service('GoogleAdsService')
    return service.search_stream(customer_id=normalize_customer_id(customer_id), query=query)


def fetch_gaql_rows(client: GoogleAdsClient, customer_id: str, query: str, log: logging.Logger | None = None) -> list[Any]:
    rows: list[Any] = []
    try:
        for batch in search_stream(client, customer_id, query):
            rows.extend(batch.results)
    except GoogleAdsException as exc:
        if log:
            log_google_ads_exception(log, exc, customer_id)
        raise
    return rows


def list_accessible_customers(client: GoogleAdsClient) -> list[str]:
    service = client.get_service('CustomerService')
    response = service.list_accessible_customers()
    customer_ids: list[str] = []
    for resource_name in response.resource_names:
        customer_ids.append(normalize_customer_id(resource_name.rsplit('/', 1)[-1]))
    return sorted(set(customer_ids))


def log_google_ads_exception(log: logging.Logger, exc: GoogleAdsException, customer_id: str | None = None) -> None:
    request_id = getattr(exc, 'request_id', None)
    prefix = f'Google Ads API failed'
    if customer_id:
        prefix += f' customer_id={customer_id}'
    if request_id:
        prefix += f' request_id={request_id}'
    log.error('%s failure=%s', prefix, exc.failure)
    for error in getattr(exc.failure, 'errors', []) or []:
        log.error(
            'Google Ads API error code=%s message=%s location=%s',
            getattr(error, 'error_code', None),
            getattr(error, 'message', ''),
            getattr(error, 'location', None),
        )
