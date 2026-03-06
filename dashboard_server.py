#!/usr/bin/env python3
"""
Local dashboard server:
- Serves static dashboard files from ./dashboard
- Exposes /api/data (LinkedIn + Reddit daily metrics from MySQL)
"""

import json
import os
from datetime import date, datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import mysql.connector
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).parent
DASH_DIR = ROOT_DIR / "dashboard"
load_dotenv(ROOT_DIR / ".env")


MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("MYSQL_DB", "report_bd")
MYSQL_USER = os.getenv("MYSQL_USER", "report_bd")
MYSQL_PASS = os.getenv("MYSQL_PASSWORD", "")


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


def parse_iso_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def fetch_dashboard_rows(days: int = 35, from_date: date | None = None, to_date: date | None = None) -> list[dict]:
    conn = get_db_connection()
    cur = conn.cursor(dictionary=True)
    where_parts = ["d.platform IN ('linkedin', 'reddit')"]
    params: list = []

    if from_date:
        where_parts.append("d.report_date >= %s")
        params.append(from_date)
    if to_date:
        where_parts.append("d.report_date <= %s")
        params.append(to_date)
    if not from_date and not to_date:
        where_parts.append("d.report_date >= (UTC_DATE() - INTERVAL %s DAY)")
        params.append(days)

    where_sql = " AND ".join(where_parts)
    cur.execute(
        f"""
        SELECT
            d.report_date AS date,
            d.platform,
            d.account_id,
            d.campaign_id,
            COALESCE(c.name, '') AS campaign_name,
            d.impressions,
            d.clicks,
            d.cost_local AS spend,
            d.conversions,
            d.video_views
        FROM ad_analytics_daily d
        LEFT JOIN ad_campaigns c
          ON c.platform = d.platform
         AND c.account_id = d.account_id
         AND c.campaign_id = d.campaign_id
        WHERE {where_sql}
        ORDER BY d.report_date ASC, d.platform ASC, d.campaign_id ASC
        """,
        tuple(params),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    out = []
    for r in rows:
        d = r["date"]
        if isinstance(d, (date, datetime)):
            d = d.strftime("%Y-%m-%d")
        out.append(
            {
                "date": d,
                "platform": r["platform"],
                "account_id": str(r["account_id"]),
                "campaign_id": str(r["campaign_id"]),
                "campaign_name": r["campaign_name"],
                "impressions": int(r["impressions"] or 0),
                "clicks": int(r["clicks"] or 0),
                "spend": float(r["spend"] or 0),
                "conversions": int(r["conversions"] or 0),
                "video_views": int(r["video_views"] or 0),
            }
        )
    return out


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASH_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/data":
            try:
                q = parse_qs(parsed.query)
                days = 35
                if "days" in q and q["days"]:
                    try:
                        days = max(1, min(365, int(q["days"][0])))
                    except ValueError:
                        days = 35
                from_date = parse_iso_date(q.get("from", [""])[0])
                to_date = parse_iso_date(q.get("to", [""])[0])
                data = fetch_dashboard_rows(days=days, from_date=from_date, to_date=to_date)
                payload = json.dumps({"rows": data}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as exc:
                payload = json.dumps({"error": str(exc)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            return

        if path == "/":
            self.path = "/index.html"
        return super().do_GET()


def main():
    if not DASH_DIR.exists():
        raise RuntimeError(f"Dashboard directory not found: {DASH_DIR}")

    port = int(os.getenv("DASHBOARD_PORT", "8080"))
    server = HTTPServer(("0.0.0.0", port), DashboardHandler)
    print(f"Dashboard: http://localhost:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
