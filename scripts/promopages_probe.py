#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from datetime import date, timedelta
from typing import Any

import requests

BASE_URL = "https://promopages.yandex.ru/api/promo/v1"


def yesterday_iso() -> str:
    return (date.today() - timedelta(days=1)).isoformat()


def auth_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def get_json(session: requests.Session, url: str, token: str) -> tuple[int, Any]:
    resp = session.get(url, headers=auth_headers(token), timeout=30)
    try:
        payload = resp.json()
    except Exception:
        payload = resp.text
    return resp.status_code, payload


def post_json(session: requests.Session, url: str, token: str, body: dict[str, Any]) -> tuple[int, Any]:
    resp = session.post(url, headers=auth_headers(token), json=body, timeout=30)
    try:
        payload = resp.json()
    except Exception:
        payload = resp.text
    return resp.status_code, payload


def pick_traffic_source(campaign: dict[str, Any]) -> str:
    placements = (
        campaign.get("targeting", {}).get("placements", [])
        if isinstance(campaign.get("targeting"), dict)
        else []
    )
    if "rsya" in placements:
        return "rsya"
    return "all"


def poll_report(
    session: requests.Session,
    token: str,
    report_id: str,
    max_attempts: int = 8,
) -> tuple[int, Any]:
    delay = 3
    url = f"{BASE_URL}/reports/{report_id}?format=json"
    for attempt in range(1, max_attempts + 1):
        status, payload = get_json(session, url, token)
        if status == 200:
            return status, payload
        if status == 429:
            time.sleep(delay * 2)
        elif status == 202:
            time.sleep(delay)
        else:
            return status, payload
        delay = min(delay * 2, 20)
    return status, payload


def summarize_report(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"kind": "unknown", "rows": None}

    for key in ("rows", "items", "data", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            return {
                "kind": key,
                "rows": len(value),
                "sample": value[:2],
            }
        if isinstance(value, dict):
            for nested_key in ("rows", "items", "data"):
                nested_value = value.get(nested_key)
                if isinstance(nested_value, list):
                    return {
                        "kind": f"{key}.{nested_key}",
                        "rows": len(nested_value),
                        "sample": nested_value[:2],
                    }

    return {"kind": "object", "rows": None, "sample_keys": list(payload.keys())[:20]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Yandex Promopages probe")
    parser.add_argument("--token", default=os.environ.get("PROMOPAGES_TOKEN", "").strip())
    parser.add_argument("--date-from", default=yesterday_iso())
    parser.add_argument("--date-to", default=yesterday_iso())
    parser.add_argument("--publisher-id", default="")
    args = parser.parse_args()

    if not args.token:
      print("PROMOPAGES_TOKEN is required", file=sys.stderr)
      return 1

    session = requests.Session()

    status, permissions = get_json(session, f"{BASE_URL}/permissions/user", args.token)
    print(json.dumps({"step": "permissions", "status": status, "payload": permissions}, ensure_ascii=False, indent=2))
    if status != 200 or not isinstance(permissions, dict):
        return 1

    publishers = permissions.get("userPermissions", [])
    if args.publisher_id:
        publishers = [item for item in publishers if item.get("publisher", {}).get("id") == args.publisher_id]

    for item in publishers:
        publisher = item.get("publisher", {})
        publisher_id = publisher.get("id")
        publisher_name = publisher.get("name")
        if not publisher_id:
            continue

        status, campaigns_payload = get_json(
            session,
            f"{BASE_URL}/campaigns?publisherId={publisher_id}&pageLimit=100",
            args.token,
        )
        print(
            json.dumps(
                {
                    "step": "campaigns",
                    "publisher_id": publisher_id,
                    "publisher_name": publisher_name,
                    "status": status,
                    "campaign_count": len(campaigns_payload.get("campaigns", []))
                    if isinstance(campaigns_payload, dict)
                    else None,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        if status != 200 or not isinstance(campaigns_payload, dict):
            continue

        campaigns = campaigns_payload.get("campaigns", [])
        if not campaigns:
            continue

        campaign_ids = [c.get("id") for c in campaigns if c.get("id")]
        traffic_source = pick_traffic_source(campaigns[0])
        body = {
            "publisherId": publisher_id,
            "campaignIds": campaign_ids,
            "mskDateFrom": args.date_from,
            "mskDateTo": args.date_to,
            "trafficSource": traffic_source,
        }
        status, report_create = post_json(
            session,
            f"{BASE_URL}/reports/campaigns-daily-stats",
            args.token,
            body,
        )
        print(
            json.dumps(
                {
                    "step": "create_report",
                    "publisher_id": publisher_id,
                    "publisher_name": publisher_name,
                    "status": status,
                    "payload": report_create,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        if status != 200 or not isinstance(report_create, dict) or not report_create.get("reportId"):
            continue

        report_id = report_create["reportId"]
        status, report_payload = poll_report(session, args.token, report_id)
        print(
            json.dumps(
                {
                    "step": "report_result",
                    "publisher_id": publisher_id,
                    "publisher_name": publisher_name,
                    "report_id": report_id,
                    "status": status,
                    "summary": summarize_report(report_payload),
                    "payload": report_payload if status != 200 else None,
                },
                ensure_ascii=False,
                indent=2,
            )
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
