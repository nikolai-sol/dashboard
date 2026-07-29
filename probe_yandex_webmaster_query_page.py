#!/usr/bin/env python3
"""Validate exact Webmaster query-to-page filtering against Enhanced Export."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
from typing import Callable
from urllib.parse import quote

from fetch_yandex_webmaster_canonical import (
    DEFAULT_SEARCH_LOCATION,
    _statistics_for_report_date,
    discover_host_id,
    get_user_id,
    request_with_retry,
    refresh_access_token,
    safe_int,
)


def normalize_query(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def build_query_page_probe_body(
    page_url: str,
    report_date: str,
    offset: int,
) -> dict:
    return {
        "offset": offset,
        "limit": 500,
        "device_type_indicator": "ALL",
        "search_location": DEFAULT_SEARCH_LOCATION,
        "text_indicator": "QUERY",
        "filters": {
            "text_filters": [
                {
                    "text_indicator": "URL",
                    "operation": "TEXT_MATCH",
                    "value": page_url,
                }
            ]
        },
        "sort_by_date": {
            "date": report_date,
            "statistic_field": "IMPRESSIONS",
            "by": "DESC",
        },
    }


def normalize_query_analytics_query_rows(
    payload: dict,
    report_date: str,
    page_url: str,
) -> list[dict]:
    rows = []
    for item in payload.get("text_indicator_to_statistics") or []:
        indicator = item.get("text_indicator") or {}
        query = (
            normalize_query(indicator.get("value"))
            if indicator.get("type") == "QUERY"
            else ""
        )
        metrics = _statistics_for_report_date(item, report_date)
        has_selected_day_fact = (
            int(metrics["clicks"]) > 0
            or int(metrics["impressions"]) > 0
            or metrics["average_position"] is not None
        )
        if query and metrics["seen"] and has_selected_day_fact:
            rows.append(
                {
                    "query": query,
                    "page": page_url,
                    "clicks": int(metrics["clicks"]),
                    "impressions": int(metrics["impressions"]),
                }
            )
    return rows


def compare_query_page_rows(
    standard_rows: list[dict],
    export_rows: list[dict],
) -> dict:
    def signature(rows: list[dict]) -> dict[tuple[str, str], tuple[int, int]]:
        result: dict[tuple[str, str], tuple[int, int]] = {}
        for row in rows:
            key = (normalize_query(row["query"]), str(row["page"]).strip())
            clicks, impressions = result.get(key, (0, 0))
            result[key] = (
                clicks + int(row["clicks"]),
                impressions + int(row["impressions"]),
            )
        return result

    standard_signature = signature(standard_rows)
    export_signature = signature(export_rows)
    return {
        "gate": "pass" if standard_signature == export_signature else "fail",
        "standard_rows": len(standard_signature),
        "export_rows": len(export_signature),
        "standard_clicks": sum(value[0] for value in standard_signature.values()),
        "export_clicks": sum(value[0] for value in export_signature.values()),
        "standard_impressions": sum(
            value[1] for value in standard_signature.values()
        ),
        "export_impressions": sum(value[1] for value in export_signature.values()),
        "mismatch_count": len(
            set(standard_signature.items()) ^ set(export_signature.items())
        ),
    }


def _open_export_text(path: Path):
    with path.open("rb") as handle:
        is_gzip = handle.read(2) == b"\x1f\x8b"
    if is_gzip:
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def _export_value(row: dict, *names: str) -> str:
    normalized = {
        str(key).strip().lower(): str(value or "").strip()
        for key, value in row.items()
    }
    for name in names:
        if normalized.get(name):
            return normalized[name]
    return ""


def load_enhanced_export_rows(
    path: Path,
    *,
    report_date: str,
    page_url: str,
) -> list[dict]:
    with _open_export_text(path) as handle:
        sample = handle.read(4096)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        rows = []
        for row in reader:
            row_date = _export_value(row, "date", "дата")
            row_page = _export_value(row, "path", "url", "путь")
            if row_date != report_date or row_page != page_url:
                continue
            query = normalize_query(_export_value(row, "query", "запрос"))
            if not query:
                continue
            rows.append(
                {
                    "query": query,
                    "page": row_page,
                    "clicks": safe_int(_export_value(row, "clicks", "клики")),
                    "impressions": safe_int(
                        _export_value(row, "impressions", "shows", "показы")
                    ),
                }
            )
    return rows


def fetch_query_analytics_rows(
    access_token: str,
    user_id: str,
    host_id: str,
    page_url: str,
    report_date: str,
    *,
    request_fn: Callable[..., dict] = request_with_retry,
) -> tuple[list[dict], str]:
    all_rows: list[dict] = []
    response_payloads: list[dict] = []
    raw_rows_fetched = 0
    offset = 0
    while True:
        payload = request_fn(
            access_token,
            f"/user/{user_id}/hosts/{quote(host_id, safe='')}/query-analytics/list",
            run_id=None,
            method="POST",
            body=build_query_page_probe_body(page_url, report_date, offset),
        )
        response_payloads.append(payload)
        raw_rows = payload.get("text_indicator_to_statistics") or []
        raw_rows_fetched += len(raw_rows)
        all_rows.extend(
            normalize_query_analytics_query_rows(payload, report_date, page_url)
        )
        count = safe_int(payload.get("count"))
        if count and raw_rows_fetched >= count:
            break
        if len(raw_rows) < 500:
            if count and raw_rows_fetched < count:
                raise RuntimeError(
                    "incomplete Yandex Webmaster query-page probe response: "
                    f"reported count={count}, fetched_rows={raw_rows_fetched}"
                )
            break
        offset += 500
    response_hash = hashlib.sha256(
        json.dumps(
            response_payloads,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return all_rows, response_hash


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_probe(args: argparse.Namespace) -> dict:
    export_path = Path(args.enhanced_export_csv)
    export_rows = load_enhanced_export_rows(
        export_path,
        report_date=args.report_date,
        page_url=args.page_url,
    )
    access_token = refresh_access_token()
    user_id = get_user_id(access_token, None)
    host_id = args.host_id or discover_host_id(
        access_token,
        user_id,
        args.domain,
        None,
    )
    standard_rows, standard_response_hash = fetch_query_analytics_rows(
        access_token,
        user_id,
        host_id,
        args.page_url,
        args.report_date,
    )
    result = compare_query_page_rows(standard_rows, export_rows)
    result["enhanced_export_sha256"] = _sha256_file(export_path)
    result["standard_response_sha256"] = standard_response_hash
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--host-id", default="")
    parser.add_argument("--page-url", required=True)
    parser.add_argument("--report-date", required=True)
    parser.add_argument("--enhanced-export-csv", required=True)
    return parser.parse_args()


def main() -> int:
    result = run_probe(parse_args())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["gate"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
