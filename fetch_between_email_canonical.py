#!/usr/bin/env python3
"""Between email/report collector for Gidrofuril (and future clients).

Sources:
  1) Local/known xlsx attachments (between report format)
  2) Gmail inbox lifeipdesign@gmail.com (when Gmail API enabled)

Writes:
  A) report_bd.canonical_* with source_key='between'
  B) report_bd.dashboard_manual_facts_daily for bound dashboards
     (Gidrofuril id=29 uses media-plan bindings manual:between|CHANNEL)

Report grain (observed):
  date | platform=between | channel | impressions | clicks | sessions |
  spend | views | conversions | reach | ctr | cr | cpc | cpm | cpv

Usage:
  python3 fetch_between_email_canonical.py --from-xlsx path.xlsx --dashboard-id 29
  python3 fetch_between_email_canonical.py --from-gmail --days-back 60 --dashboard-id 29
  python3 fetch_between_email_canonical.py --from-gmail --days-back 60  # canonical only
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import logging
import re
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import openpyxl
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from canonical_writer import (  # noqa: E402
    finish_collector_run,
    get_db_connection,
    log_run_event,
    start_collector_run,
    upsert_fact_ads_daily,
    upsert_source_accounts,
    upsert_source_campaigns,
)

SOURCE_KEY = "between"
DEFAULT_ACCOUNT_ID = "gidrofuril"
DEFAULT_ACCOUNT_NAME = "Gidrofuril"
CURRENCY = "RUB"

# Gidrofuril dashboard currently binds Between via manual_data
DEFAULT_DASHBOARD_ID = 29
DEFAULT_MANUAL_SOURCE_KEY = "manual:between_email"

# Map report channel labels → binding suffix used in media_plan_bindings
CHANNEL_ALIASES = {
    "serials": "Serials",
    "wl": "WL",
    "smart tv": "Smart TV",
    "smart_tv": "Smart TV",
    "rewarded": "rewarded",
    "olv serials": "Serials",
    "olv wl": "WL",
    "olv smart tv": "Smart TV",
    "olv smart_tv": "Smart TV",
    "olv rewarded": "rewarded",
    "олв ревардед": "rewarded",
    "олв wl inpage": "WL",
    "олв кино и сериалы": "Serials",
}

# Only ingest reports that look like this advertiser (filename/subject/from)
DEFAULT_CLIENT_HINTS = ("gidrofuril", "гидрофурил", "гидр")
REJECT_CLIENT_HINTS = ("solgoood", "solgood", "sol goo")

HERMES_TOKEN = Path.home() / ".hermes" / "google_token.json"
STATE_PATH = ROOT / "agents" / "between_email_collector" / "out" / "collector_state.json"
SAMPLES_DIR = ROOT / "agents" / "between_email_collector" / "samples"
INGESTED_DIR = ROOT / "agents" / "between_email_collector" / "ingested"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("between_collector")


def num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    s = str(value).strip().replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return None


def as_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    # 2026-07-07 or 07.07.2026 or 07/07/2026
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def norm_channel(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s:
        return "unknown"
    key = s.lower()
    return CHANNEL_ALIASES.get(key, s)


def parse_xlsx_bytes(data: bytes, source_name: str = "") -> list[dict[str, Any]]:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    rows_out: list[dict[str, Any]] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        headers: list[str] = []
        for i, row in enumerate(ws.iter_rows(values_only=True), 1):
            if not row or not any(row):
                continue
            if i == 1 or not headers:
                headers = [str(c or "").strip().lower() for c in row]
                # require date-like header
                if "date" not in headers and "дата" not in headers:
                    headers = []
                    continue
                continue
            rec = {headers[j]: row[j] if j < len(row) else None for j in range(len(headers))}
            d = as_date(rec.get("date") or rec.get("дата") or rec.get("day"))
            if not d:
                continue
            channel = norm_channel(
                rec.get("channel")
                or rec.get("канал")
                or rec.get("placement")
                or rec.get("campaign name")
                or rec.get("campaign_name")
                or rec.get("название кампании")
            )
            platform = str(rec.get("platform") or rec.get("площадка") or "between").strip().lower() or "between"
            impressions = int(num(rec.get("impressions") or rec.get("показы")) or 0)
            clicks = int(num(rec.get("clicks") or rec.get("клики")) or 0)
            views = int(
                num(
                    rec.get("views")
                    or rec.get("video_views")
                    or rec.get("досмотры")
                    or rec.get("показы_видео")
                    or rec.get("v complete")
                    or rec.get("v_complete")
                )
                or 0
            )
            net_cpm = num(rec.get("net cpm") or rec.get("net_cpm"))
            spend = num(rec.get("spend") or rec.get("cost") or rec.get("расход") or rec.get("budget"))
            if spend is None and net_cpm is not None and impressions:
                spend = (impressions * net_cpm) / 1000
            frequency = num(rec.get("frequency"))
            reach = num(rec.get("reach") or rec.get("охват"))
            if reach is None and frequency and impressions:
                reach = impressions / frequency
            rows_out.append(
                {
                    "report_date": d,
                    "platform": platform,
                    "channel": channel,
                    "impressions": impressions,
                    "clicks": clicks,
                    "sessions": int(num(rec.get("sessions") or rec.get("сессии")) or 0),
                    "spend": float(spend or 0.0),
                    "views": views,
                    "conversions": int(num(rec.get("conversions") or rec.get("конверсии")) or 0),
                    "reach": float(reach or 0.0),
                    "ctr": num(rec.get("ctr")),
                    "cpc": num(rec.get("cpc") or rec.get("net cpc") or rec.get("net_cpc")),
                    "cpm": net_cpm or num(rec.get("cpm")),
                    "cpv": num(rec.get("cpv") or rec.get("net cpv") or rec.get("net_cpv")),
                    "video_views_25": int(num(rec.get("v firstq") or rec.get("v_firstq")) or 0),
                    "video_views_50": int(num(rec.get("v midpoint") or rec.get("v_midpoint")) or 0),
                    "video_views_75": int(num(rec.get("v thirdq") or rec.get("v_thirdq")) or 0),
                    "video_views_100": views,
                    "source_file": source_name,
                    "sheet": sheet_name,
                }
            )
    wb.close()
    return rows_out


def parse_csv_bytes(data: bytes, source_name: str = "") -> list[dict[str, Any]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows_out: list[dict[str, Any]] = []
    for rec in reader:
        lower = {str(k or "").strip().lower(): v for k, v in rec.items()}
        d = as_date(lower.get("date") or lower.get("дата") or lower.get("event_date"))
        if not d:
            continue
        channel = norm_channel(
            lower.get("channel")
            or lower.get("канал")
            or lower.get("campaign name")
            or lower.get("campaign_name")
            or lower.get("название кампании")
        )
        impressions = int(num(lower.get("impressions") or lower.get("imps")) or 0)
        clicks = int(num(lower.get("clicks")) or 0)
        views = int(
            num(
                lower.get("views")
                or lower.get("video_views")
                or lower.get("v complete")
                or lower.get("v_complete")
                or lower.get("video_complete")
            )
            or 0
        )
        net_cpm = num(lower.get("net cpm") or lower.get("net_cpm"))
        spend = num(lower.get("spend") or lower.get("cost") or lower.get("revenue"))
        if spend is None and net_cpm is not None and impressions:
            spend = (impressions * net_cpm) / 1000
        frequency = num(lower.get("frequency"))
        reach = num(lower.get("reach"))
        if reach is None and frequency and impressions:
            reach = impressions / frequency
        rows_out.append(
            {
                "report_date": d,
                "platform": str(lower.get("platform") or "between").lower(),
                "channel": channel,
                "impressions": impressions,
                "clicks": clicks,
                "sessions": int(num(lower.get("sessions")) or 0),
                "spend": float(spend or 0.0),
                "views": views,
                "conversions": int(num(lower.get("conversions")) or 0),
                "reach": float(reach or 0.0),
                "ctr": num(lower.get("ctr")),
                "cpc": num(lower.get("cpc") or lower.get("net cpc") or lower.get("net_cpc"))
                or ((spend / clicks) if spend is not None and clicks else None),
                "cpm": net_cpm or num(lower.get("cpm")) or ((spend / impressions) * 1000 if spend is not None and impressions else None),
                "cpv": num(lower.get("cpv") or lower.get("net cpv") or lower.get("net_cpv"))
                or ((spend / views) if spend is not None and views else None),
                "video_views_25": int(
                    num(lower.get("v firstq") or lower.get("v_firstq") or lower.get("video_firstquartile")) or 0
                ),
                "video_views_50": int(
                    num(lower.get("v midpoint") or lower.get("v_midpoint") or lower.get("video_midpoint")) or 0
                ),
                "video_views_75": int(
                    num(lower.get("v thirdq") or lower.get("v_thirdq") or lower.get("video_thirdquartile")) or 0
                ),
                "video_views_100": views,
                "source_file": source_name,
                "sheet": "csv",
            }
        )
    return rows_out


def client_allowed(text: str, allow: tuple[str, ...], reject: tuple[str, ...]) -> bool:
    blob = (text or "").lower()
    if any(r in blob for r in reject):
        return False
    if not allow:
        return True
    return any(a in blob for a in allow)


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"ingested_gmail_ids": [], "ingested_files": []}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def deduplicate_report_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep one complete daily-report row per date and channel."""
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["report_date"], row["channel"])
        unique.setdefault(key, row)
    return list(unique.values())


def gmail_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not HERMES_TOKEN.exists():
        raise SystemExit(f"NOT_AUTHENTICATED: {HERMES_TOKEN} missing")
    creds = Credentials.from_authorized_user_file(str(HERMES_TOKEN))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        HERMES_TOKEN.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def fetch_gmail_attachments(
    days_back: int = 60,
    query_extra: str = "",
    client_hints: tuple[str, ...] = DEFAULT_CLIENT_HINTS,
    reject_hints: tuple[str, ...] = REJECT_CLIENT_HINTS,
) -> list[tuple[str, str, bytes]]:
    """Return list of (message_id, filename, bytes) for Between report attachments."""
    svc = gmail_service()
    # Prefer client name in subject/filename; Between daily reports are CSV
    hint_q = " OR ".join(client_hints) if client_hints else "between"
    q = (
        f"newer_than:{max(1, days_back)}d has:attachment "
        f"(filename:csv OR filename:xlsx OR filename:xls) "
        f"({hint_q} OR subject:between OR from:between OR filename:between) "
        f"{query_extra}"
    ).strip()
    log.info("Gmail query: %s", q)
    out: list[tuple[str, str, bytes]] = []
    page_token = None
    while True:
        resp = (
            svc.users()
            .messages()
            .list(userId="me", q=q, maxResults=50, pageToken=page_token)
            .execute()
        )
        for m in resp.get("messages") or []:
            mid = m["id"]
            full = (
                svc.users()
                .messages()
                .get(userId="me", id=mid, format="full")
                .execute()
            )
            headers = {h["name"].lower(): h["value"] for h in full.get("payload", {}).get("headers", [])}
            subject = headers.get("subject", "")
            sender = headers.get("from", "")
            parts = []

            def walk(p):
                if not p:
                    return
                parts.append(p)
                for c in p.get("parts") or []:
                    walk(c)

            walk(full.get("payload"))
            for p in parts:
                filename = p.get("filename") or ""
                body = p.get("body") or {}
                att_id = body.get("attachmentId")
                if not filename or not att_id:
                    continue
                low = filename.lower()
                if not (low.endswith(".xlsx") or low.endswith(".xls") or low.endswith(".csv")):
                    continue
                meta_blob = f"{subject} {sender} {filename}"
                if not client_allowed(meta_blob, client_hints, reject_hints):
                    log.info("skip non-target client attachment %s (%s)", filename, subject[:60])
                    continue
                att = (
                    svc.users()
                    .messages()
                    .attachments()
                    .get(userId="me", messageId=mid, id=att_id)
                    .execute()
                )
                data = base64.urlsafe_b64decode(att.get("data") or "")
                if not data:
                    continue
                out.append((mid, filename, data))
                log.info("attachment %s from msg %s (%s)", filename, mid, subject[:80])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


def write_canonical(rows: list[dict[str, Any]], account_id: str, run_id: int | None) -> dict[str, int]:
    if not rows:
        return {"accounts": 0, "campaigns": 0, "facts": 0}

    dates = sorted({r["report_date"] for r in rows})
    now = datetime.now(timezone.utc).isoformat()
    accounts = [
        {
            "source_key": SOURCE_KEY,
            "platform_account_id": account_id,
            "external_account_ref": account_id,
            "account_name": DEFAULT_ACCOUNT_NAME if account_id == DEFAULT_ACCOUNT_ID else account_id,
            "advertiser_name": DEFAULT_ACCOUNT_NAME if account_id == DEFAULT_ACCOUNT_ID else account_id,
            "account_status": "active",
            "currency_code": CURRENCY,
            "timezone_name": "Europe/Moscow",
            "first_seen_at": dates[0],
            "last_seen_at": dates[-1],
            "raw_payload": {"collector": "between_email"},
        }
    ]
    campaigns_map: dict[str, dict[str, Any]] = {}
    facts: list[dict[str, Any]] = []
    for r in rows:
        cid = r["channel"]
        campaigns_map[cid] = {
            "source_key": SOURCE_KEY,
            "platform_account_id": account_id,
            "platform_campaign_id": cid,
            "campaign_name": cid,
            "campaign_status": "active",
            "objective": "video",
            "buy_type": None,
            "start_date": None,
            "end_date": None,
            "daily_budget": None,
            "total_budget": None,
            "currency_code": CURRENCY,
            "first_seen_at": r["report_date"],
            "last_seen_at": r["report_date"],
            "raw_payload": {"channel": cid},
        }
        impressions = r["impressions"] or 0
        clicks = r["clicks"] or 0
        views = r["views"] or 0
        spend = r["spend"] or 0.0
        conversions = r["conversions"] or 0
        reach = r["reach"] or 0
        ctr = r.get("ctr")
        if ctr is None and impressions:
            ctr = clicks / impressions
        cpm = r.get("cpm")
        if cpm is None and impressions:
            cpm = (spend / impressions) * 1000
        cpc = r.get("cpc")
        if cpc is None and clicks:
            cpc = spend / clicks
        cpv = r.get("cpv")
        if cpv is None and views:
            cpv = spend / views
        cpa = (spend / conversions) if conversions else None
        frequency = (impressions / reach) if reach else None
        facts.append(
            {
                "source_key": SOURCE_KEY,
                "platform_account_id": account_id,
                "platform_campaign_id": cid,
                "fact_scope": "campaign",
                "native_grain": "placement",
                "breakdown_scope": "default",
                "platform_delivery_entity_id": "",
                "platform_creative_id": "",
                "report_date": r["report_date"],
                "spend": spend,
                "impressions": impressions,
                "clicks": clicks,
                "views": views,
                "conversions": conversions,
                "conversion_value": None,
                "reach": reach,
                "frequency": frequency,
                "ctr": ctr,
                "cpm": cpm,
                "cpc": cpc,
                "cpv": cpv,
                "cpa": cpa,
                "video_views_25": r.get("video_views_25"),
                "video_views_50": r.get("video_views_50"),
                "video_views_75": r.get("video_views_75"),
                "video_views_100": r.get("video_views_100"),
                "link_clicks": clicks,
                "likes": None,
                "comments": None,
                "shares": None,
                "reactions": None,
                "follows": None,
                "currency_code": CURRENCY,
                "ingestion_run_id": run_id,
            }
        )

    n_acc = upsert_source_accounts(accounts)
    n_camp = upsert_source_campaigns(list(campaigns_map.values()))
    n_fact = upsert_fact_ads_daily(facts)
    return {"accounts": n_acc, "campaigns": n_camp, "facts": n_fact}


def write_manual_facts(
    rows: list[dict[str, Any]],
    dashboard_id: int,
    manual_source_key: str,
    source_upload_name: str,
) -> int:
    if not rows:
        return 0
    conn = get_db_connection()
    cur = conn.cursor()
    # Upsert by unique natural key — table may not have unique index; delete overlapping dates then insert
    dates = sorted({r["report_date"] for r in rows})
    if dates:
        cur.execute(
            f"""
            DELETE FROM dashboard_manual_facts_daily
            WHERE dashboard_id = %s
              AND manual_source_key = %s
              AND report_date BETWEEN %s AND %s
            """,
            (dashboard_id, manual_source_key, dates[0], dates[-1]),
        )
    sql = """
        INSERT INTO dashboard_manual_facts_daily (
          dashboard_id, manual_source_key, report_date, platform, channel,
          impressions, clicks, spend, views, conversions, reach, sessions, source_upload_name
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    payload = []
    for r in rows:
        payload.append(
            (
                dashboard_id,
                manual_source_key,
                r["report_date"],
                r.get("platform") or "between",
                r["channel"],
                r.get("impressions") or 0,
                r.get("clicks") or 0,
                float(r.get("spend") or 0.0),
                r.get("views") or 0,
                r.get("conversions") or 0,
                float(r.get("reach") or 0.0),
                r.get("sessions") or 0,
                source_upload_name[:255] if source_upload_name else None,
            )
        )
    cur.executemany(sql, payload)
    conn.commit()
    cur.close()
    conn.close()
    return len(payload)


def ensure_media_plan_bindings(dashboard_id: int, channels: list[str]) -> int:
    """Ensure manual:between|CHANNEL bindings exist for plan-vs-fact."""
    conn = get_db_connection()
    cur = conn.cursor()
    created = 0
    for ch in channels:
        # Prefer existing between-related plan lines
        cur.execute(
            """
            SELECT line_key, channel FROM dashboard_media_plan_rows
            WHERE dashboard_id = %s
              AND (platform LIKE %s OR channel LIKE %s OR line_key LIKE %s)
            """,
            (dashboard_id, "%between%", f"%{ch}%", f"%{ch}%"),
        )
        plan_rows = cur.fetchall()
        line_keys = [r[0] for r in plan_rows] if plan_rows else []
        if not line_keys:
            # fallback synthetic line_key not in plan — skip bind creation without plan row
            continue
        for line_key in line_keys:
            platform_campaign_id = f"manual:between|{ch}"
            cur.execute(
                """
                SELECT id FROM media_plan_bindings
                WHERE dashboard_id=%s AND line_key=%s AND source_key='manual_data'
                  AND platform_campaign_id=%s
                """,
                (dashboard_id, line_key, platform_campaign_id),
            )
            if cur.fetchone():
                continue
            cur.execute(
                """
                INSERT INTO media_plan_bindings
                  (dashboard_id, line_key, channel, source_key, platform_campaign_id)
                VALUES (%s,%s,%s,'manual_data',%s)
                """,
                (dashboard_id, line_key, ch, platform_campaign_id),
            )
            created += 1
    conn.commit()
    cur.close()
    conn.close()
    return created


def ingest_rows(
    rows: list[dict[str, Any]],
    *,
    account_id: str,
    dashboard_id: int | None,
    manual_source_key: str,
    source_label: str,
    run_type: str = "manual",
) -> dict[str, Any]:
    if not rows:
        return {"rows": 0}
    dates = sorted({r["report_date"] for r in rows})
    correlation_id = str(uuid.uuid4())
    run_id = start_collector_run(
        SOURCE_KEY,
        run_type,
        "email_xlsx",
        f"between:{account_id}",
        correlation_id,
        dates[0],
        dates[-1],
    )
    try:
        log_run_event(run_id, "info", "start", f"rows={len(rows)} source={source_label}")
        canon = write_canonical(rows, account_id=account_id, run_id=run_id)
        manual_n = 0
        binds = 0
        if dashboard_id:
            manual_n = write_manual_facts(rows, dashboard_id, manual_source_key, source_label)
            channels = sorted({r["channel"] for r in rows})
            binds = ensure_media_plan_bindings(dashboard_id, channels)
        finish_collector_run(run_id, "success", rows_read=len(rows), rows_written=canon["facts"], rows_updated=0)
        log_run_event(run_id, "info", "done", json.dumps({"canonical": canon, "manual": manual_n, "binds": binds}))
        return {
            "run_id": run_id,
            "rows": len(rows),
            "date_from": dates[0],
            "date_to": dates[-1],
            "canonical": canon,
            "manual_facts": manual_n,
            "bindings_created": binds,
            "channels": sorted({r["channel"] for r in rows}),
        }
    except Exception as exc:
        finish_collector_run(run_id, "failed", rows_read=0, rows_written=0, rows_updated=0, error_count=1, error_summary=str(exc)[:500])
        log_run_event(run_id, "error", "failed", str(exc)[:500])
        raise


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Between email/xlsx → canonical + manual facts")
    p.add_argument("--from-xlsx", type=Path, action="append", default=[], help="Local xlsx/csv path(s)")
    p.add_argument("--from-gmail", action="store_true", help="Pull attachments from Gmail")
    p.add_argument("--days-back", type=int, default=60)
    p.add_argument("--gmail-query", default="", help="Extra Gmail query terms")
    p.add_argument("--account-id", default=DEFAULT_ACCOUNT_ID)
    p.add_argument("--dashboard-id", type=int, default=DEFAULT_DASHBOARD_ID)
    p.add_argument("--no-dashboard", action="store_true", help="Skip manual_facts write")
    p.add_argument("--manual-source-key", default=DEFAULT_MANUAL_SOURCE_KEY)
    p.add_argument("--import-sample", action="store_true", help="Import samples/between_rep_uploaded.xlsx")
    args = p.parse_args(argv)

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    INGESTED_DIR.mkdir(parents=True, exist_ok=True)
    state = load_state()
    all_rows: list[dict[str, Any]] = []
    sources: list[str] = []

    paths = list(args.from_xlsx)
    if args.import_sample:
        sample = SAMPLES_DIR / "between_rep_uploaded.xlsx"
        if sample.exists():
            paths.append(sample)

    for path in paths:
        data = path.read_bytes()
        if path.suffix.lower() in {".xlsx", ".xlsm", ".xls"}:
            rows = parse_xlsx_bytes(data, source_name=path.name)
        else:
            rows = parse_csv_bytes(data, source_name=path.name)
        log.info("parsed %s rows from %s", len(rows), path)
        all_rows.extend(rows)
        sources.append(path.name)
        # archive copy
        dest = INGESTED_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{path.name}"
        dest.write_bytes(data)

    if args.from_gmail:
        try:
            attachments = fetch_gmail_attachments(days_back=args.days_back, query_extra=args.gmail_query)
        except Exception as exc:
            msg = str(exc)
            if "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in msg or "has not been used" in msg or "disabled" in msg.lower() or "403" in msg:
                print(
                    "GMAIL_API_DISABLED: enable Gmail API for project hermes-reportsdash:\n"
                    "https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=626178337608\n"
                    "Then re-run with --from-gmail. OAuth scopes already include gmail.readonly.",
                    file=sys.stderr,
                )
                if not all_rows:
                    return 2
            else:
                raise
        else:
            seen_ids = set(state.get("ingested_gmail_ids") or [])
            for mid, filename, data in attachments:
                key = f"{mid}:{filename}"
                if key in seen_ids:
                    log.info("skip already ingested %s", key)
                    continue
                if filename.lower().endswith(".csv"):
                    rows = parse_csv_bytes(data, source_name=filename)
                else:
                    rows = parse_xlsx_bytes(data, source_name=filename)
                if not rows:
                    log.warning("no rows in %s", filename)
                    continue
                all_rows.extend(rows)
                sources.append(filename)
                dest = INGESTED_DIR / f"{mid}_{filename}"
                dest.write_bytes(data)
                seen_ids.add(key)
            state["ingested_gmail_ids"] = sorted(seen_ids)
            save_state(state)

    if not all_rows:
        print(json.dumps({"status": "empty", "message": "no rows to ingest"}, ensure_ascii=False, indent=2))
        return 0

    merged = deduplicate_report_rows(all_rows)
    dashboard_id = None if args.no_dashboard else args.dashboard_id
    result = ingest_rows(
        merged,
        account_id=args.account_id,
        dashboard_id=dashboard_id,
        manual_source_key=args.manual_source_key,
        source_label=",".join(sources)[:240],
        run_type="backfill" if args.days_back and args.days_back > 7 else "manual",
    )
    result["sources"] = sources
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
