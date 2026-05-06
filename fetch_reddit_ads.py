#!/usr/bin/env python3
from __future__ import annotations
"""
Reddit Ads -> MySQL ETL

Reads campaign metadata and daily metrics from Reddit Ads API v3 and upserts:
- ad_campaigns (metadata; platform='reddit')
- ad_analytics_daily (metrics; platform='reddit')

Default window: yesterday 00:00 UTC -> now UTC.
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import mysql.connector
import requests
from dotenv import dotenv_values


ENV_PATH = Path(__file__).parent / ".env"
env = dotenv_values(ENV_PATH)


def env_first(*keys: str, default: str = "") -> str:
    for key in keys:
        value = env.get(key)
        if value:
            return value.strip()
    return default


# Reddit credentials/supporting fields
REDDIT_APP_ID = env_first("REDDIT_APP_ID", "reddit_App_id")
REDDIT_APP_SECRET = env_first("REDDIT_APP_SECRET", "reddit_secret_key")
REDDIT_ACCESS_TOKEN = env_first("REDDIT_ACCESS_TOKEN", "reddit_auth_token")
REDDIT_REFRESH_TOKEN = env_first(
    "REDDIT_REFRESH_TOKEN",
    "reddit_refresh_token",
    "reddit_reffresh_token",
)
REDDIT_USER_AGENT = env_first(
    "REDDIT_USER_AGENT",
    default="script:reportingdash:v1.0 (by /u/nikolai_sol)",
)

# MySQL
MYSQL_HOST = env_first("MYSQL_HOST", default="localhost")
MYSQL_PORT = int(env_first("MYSQL_PORT", default="3306"))
MYSQL_DB = env_first("MYSQL_DB", default="report_bd")
MYSQL_USER = env_first("MYSQL_USER", default="report_bd")
MYSQL_PASS = env_first("MYSQL_PASSWORD")

BASE_URL = "https://ads-api.reddit.com/api/v3"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("reddit_etl")


def get_db_connection():
    return mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        database=MYSQL_DB,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
    )


def init_db():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS ad_campaigns (
        campaign_id       VARCHAR(64) NOT NULL,
        account_id        VARCHAR(64) NOT NULL,
        platform          VARCHAR(32) NOT NULL DEFAULT 'linkedin',
        name              VARCHAR(512),
        status            VARCHAR(64),
        type              VARCHAR(64),
        objective_type    VARCHAR(64),
        cost_type         VARCHAR(64),
        daily_budget_amount  DECIMAL(12,2),
        daily_budget_currency VARCHAR(8),
        created_at        DATETIME,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (platform, campaign_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """
    )

    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS ad_analytics_daily (
        report_date       DATE NOT NULL,
        platform          VARCHAR(32) NOT NULL,
        account_id        VARCHAR(64) NOT NULL,
        campaign_id       VARCHAR(64) NOT NULL,
        impressions       INT DEFAULT 0,
        clicks            INT DEFAULT 0,
        cost_local        DECIMAL(12,4) DEFAULT 0,
        cost_usd          DECIMAL(12,4) DEFAULT 0,
        conversions       INT DEFAULT 0,
        likes             INT DEFAULT 0,
        comments          INT DEFAULT 0,
        shares            INT DEFAULT 0,
        follows           INT DEFAULT 0,
        reactions         INT DEFAULT 0,
        video_views       INT DEFAULT 0,
        video_completions INT DEFAULT 0,
        leads             INT DEFAULT 0,
        sends             INT DEFAULT 0,
        opens             INT DEFAULT 0,
        link_clicks       INT DEFAULT 0,
        fetched_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (report_date, platform, account_id, campaign_id),
        INDEX idx_date_platform (report_date, platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """
    )

    conn.commit()
    cur.close()
    conn.close()


def refresh_access_token() -> str:
    if not REDDIT_APP_ID or not REDDIT_APP_SECRET:
        raise RuntimeError("Missing reddit app id/secret in .env")
    if not REDDIT_REFRESH_TOKEN:
        raise RuntimeError("Missing reddit refresh token in .env")

    resp = requests.post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(REDDIT_APP_ID, REDDIT_APP_SECRET),
        data={
            "grant_type": "refresh_token",
            "refresh_token": REDDIT_REFRESH_TOKEN,
        },
        headers={"User-Agent": REDDIT_USER_AGENT},
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Reddit token refresh failed: {resp.status_code} {resp.text}")

    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError("Reddit token refresh response has no access_token")
    return token


def get_access_token() -> str:
    if REDDIT_ACCESS_TOKEN:
        probe = requests.get(
            f"{BASE_URL}/me",
            headers={
                "Authorization": f"Bearer {REDDIT_ACCESS_TOKEN}",
                "User-Agent": REDDIT_USER_AGENT,
            },
            timeout=20,
        )
        if probe.status_code == 200:
            return REDDIT_ACCESS_TOKEN
        log.warning("Existing reddit_auth_token is invalid/expired, refreshing via refresh token.")
    return refresh_access_token()


def api_get(url: str, token: str, params: dict | None = None) -> requests.Response:
    resp = requests.get(
        url,
        params=params,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": REDDIT_USER_AGENT,
        },
        timeout=60,
    )
    return resp


def list_businesses(token: str) -> list[dict]:
    resp = api_get(f"{BASE_URL}/me/businesses", token)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch businesses: {resp.status_code} {resp.text}")
    return resp.json().get("data", [])


def list_ad_accounts(token: str, business_id: str) -> list[dict]:
    resp = api_get(f"{BASE_URL}/businesses/{business_id}/ad_accounts", token)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch ad accounts: {resp.status_code} {resp.text}")
    return resp.json().get("data", [])


def list_campaigns(token: str, ad_account_id: str) -> list[dict]:
    campaigns: list[dict] = []
    next_url = f"{BASE_URL}/ad_accounts/{ad_account_id}/campaigns"
    params = {"page.size": 100}

    while next_url:
        resp = api_get(next_url, token, params=params)
        params = None
        if resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch campaigns: {resp.status_code} {resp.text}")
        data = resp.json()
        campaigns.extend(data.get("data", []))
        next_url = (data.get("pagination") or {}).get("next_url")

    return campaigns


def fetch_report_rows(
    token: str,
    ad_account_id: str,
    starts_at: str,
    ends_at: str,
) -> list[dict]:
    url = f"{BASE_URL}/ad_accounts/{ad_account_id}/reports"
    body = {
        "data": {
            "starts_at": starts_at,
            "ends_at": ends_at,
            "fields": ["IMPRESSIONS", "CLICKS", "SPEND", "APP_INSTALL_TOTAL_CONVERSIONS"],
            "breakdowns": ["DATE", "CAMPAIGN_ID"],
        }
    }
    resp = requests.post(
        url,
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": REDDIT_USER_AGENT,
            "Content-Type": "application/json",
        },
        timeout=90,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch report: {resp.status_code} {resp.text}")

    metrics = (resp.json().get("data") or {}).get("metrics", [])
    rows: list[dict] = []
    for m in metrics:
        if not m.get("date") or not m.get("campaign_id"):
            continue
        spend_micros = int(m.get("spend", 0) or 0)
        rows.append(
            {
                "report_date": m.get("date"),
                "account_id": ad_account_id,
                "campaign_id": str(m.get("campaign_id", "")),
                "platform": "reddit",
                "impressions": int(m.get("impressions", 0) or 0),
                "clicks": int(m.get("clicks", 0) or 0),
                "cost_local": spend_micros / 1_000_000,
                "cost_usd": 0.0,
                "conversions": int(m.get("app_install_total_conversions", 0) or 0),
            }
        )
    return rows


def upsert_campaigns(campaigns: list[dict], account_id: str, currency: str):
    if not campaigns:
        return

    conn = get_db_connection()
    cur = conn.cursor()
    sql = """
    INSERT INTO ad_campaigns (
        campaign_id, account_id, platform, name, status, type,
        objective_type, cost_type, daily_budget_amount,
        daily_budget_currency, created_at
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
    )
    ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        status = VALUES(status),
        type = VALUES(type),
        objective_type = VALUES(objective_type),
        cost_type = VALUES(cost_type),
        daily_budget_amount = VALUES(daily_budget_amount),
        daily_budget_currency = VALUES(daily_budget_currency)
    """

    values = []
    for c in campaigns:
        budget_micros = c.get("daily_budget_micro")
        budget = (budget_micros / 1_000_000) if isinstance(budget_micros, (int, float)) else None
        created_at = c.get("created_at")
        if isinstance(created_at, str):
            created_at = created_at.replace("Z", "+00:00")
            try:
                created_at = datetime.fromisoformat(created_at).strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                created_at = None
        else:
            created_at = None

        values.append(
            (
                str(c.get("id", "")),
                account_id,
                "reddit",
                c.get("name", ""),
                c.get("effective_status", c.get("configured_status", "")),
                c.get("entity_type", ""),
                c.get("objective_type", c.get("optimization_goal", "")),
                "",
                budget,
                currency,
                created_at,
            )
        )

    cur.executemany(sql, values)
    conn.commit()
    cur.close()
    conn.close()


def upsert_analytics(rows: list[dict]):
    if not rows:
        return

    conn = get_db_connection()
    cur = conn.cursor()
    sql = """
    INSERT INTO ad_analytics_daily (
        report_date, platform, account_id, campaign_id,
        impressions, clicks, cost_local, cost_usd, conversions,
        likes, comments, shares, follows, reactions,
        video_views, video_completions, leads, sends, opens,
        link_clicks
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
    )
    ON DUPLICATE KEY UPDATE
        impressions = VALUES(impressions),
        clicks = VALUES(clicks),
        cost_local = VALUES(cost_local),
        cost_usd = VALUES(cost_usd),
        conversions = VALUES(conversions),
        likes = VALUES(likes),
        comments = VALUES(comments),
        shares = VALUES(shares),
        follows = VALUES(follows),
        reactions = VALUES(reactions),
        video_views = VALUES(video_views),
        video_completions = VALUES(video_completions),
        leads = VALUES(leads),
        sends = VALUES(sends),
        opens = VALUES(opens),
        link_clicks = VALUES(link_clicks),
        fetched_at = CURRENT_TIMESTAMP
    """

    values = [
        (
            r["report_date"],
            "reddit",
            r["account_id"],
            r["campaign_id"],
            r["impressions"],
            r["clicks"],
            r["cost_local"],
            r["cost_usd"],
            r["conversions"],
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        )
        for r in rows
    ]

    cur.executemany(sql, values)
    conn.commit()
    cur.close()
    conn.close()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--starts-at", default="")
    parser.add_argument("--ends-at", default="")
    return parser.parse_args()


def main():
    args = parse_args()

    now_utc = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    default_start = (now_utc - timedelta(days=1)).replace(hour=0)
    starts_at = args.starts_at or default_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    ends_at = args.ends_at or now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    log.info("Reddit ETL starting: %s -> %s", starts_at, ends_at)
    init_db()
    token = get_access_token()

    businesses = list_businesses(token)
    if not businesses:
        raise RuntimeError("No businesses returned by Reddit API")

    all_rows = 0
    all_campaigns = 0

    for business in businesses:
        business_id = business["id"]
        ad_accounts = list_ad_accounts(token, business_id)
        log.info("Business %s: %d ad accounts", business_id, len(ad_accounts))

        for ad_account in ad_accounts:
            ad_account_id = ad_account["id"]
            currency = ad_account.get("currency", "")
            log.info("Processing ad account: %s", ad_account_id)

            campaigns = list_campaigns(token, ad_account_id)
            upsert_campaigns(campaigns, ad_account_id, currency)
            all_campaigns += len(campaigns)

            rows = fetch_report_rows(token, ad_account_id, starts_at, ends_at)
            upsert_analytics(rows)
            all_rows += len(rows)
            log.info("Ad account %s: upserted %d metric rows", ad_account_id, len(rows))

            time.sleep(1)

    log.info("Done. Campaigns upserted: %d, metrics upserted: %d", all_campaigns, all_rows)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log.error("Reddit ETL failed: %s", exc)
        sys.exit(1)
