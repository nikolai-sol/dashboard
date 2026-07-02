#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_abbott_bitrix_analytics import (  # noqa: E402
    BOT_USER_AGENT_RE,
    HIT_TABLE,
    SESSION_DURATION_CAP_SECONDS,
    SESSION_TABLE,
    SessionInfo,
    build_session_info,
    clean_text,
    is_technical_url,
    normalize_url,
    parse_mysql_value_tuple,
    safe_int,
    stream_insert_statements,
)

JOURNEY_NOISE_PATH_RE = re.compile(
    r"(^|/)(api|ajax|auth|local|bitrix|upload|\.well-known)(/|$)|"
    r"(registration_sync|loginphone|confirm-sms|getexternallinks|getquestionanswer)(\.php)?$",
    re.IGNORECASE,
)


@dataclass
class HitRow:
    at: str
    url: str
    user_id: int


@dataclass
class SessionHits:
    all_hits: list[HitRow] = field(default_factory=list)
    clean_hits: list[HitRow] = field(default_factory=list)
    content_hits: list[HitRow] = field(default_factory=list)


def is_clean_hit(raw_url: str, method: str, url_404: str, stop_list_id: int, user_agent: str) -> bool:
    if method and method.upper() != "GET":
        return False
    if url_404.upper() == "Y":
        return False
    if stop_list_id > 0:
        return False
    if BOT_USER_AGENT_RE.search(user_agent):
        return False
    if is_technical_url(raw_url):
        return False
    return bool(normalize_url(raw_url))


def is_content_hit(url: str) -> bool:
    if not url:
        return False
    path = urlparse(url).path or "/"
    if JOURNEY_NOISE_PATH_RE.search(path):
        return False
    if path in {"/", "/auth", "/auth_without_phone"}:
        return False
    return True


def dedupe_consecutive(urls: list[str]) -> list[str]:
    result: list[str] = []
    for url in urls:
        if result and result[-1] == url:
            continue
        result.append(url)
    return result


def summarize_path(urls: list[str], max_steps: int = 6) -> str:
    if not urls:
        return ""
    if len(urls) <= max_steps:
        return " -> ".join(urls)
    head = urls[:3]
    tail = urls[-2:]
    return " -> ".join([*head, "…", *tail])


def cap_duration(seconds: int) -> int:
    return min(max(0, seconds), SESSION_DURATION_CAP_SECONDS)


def build_session_journeys(dump_path: Path, report_date: str, limit: int) -> dict[str, Any]:
    sessions: dict[int, SessionInfo] = {}
    hits_by_session: dict[int, SessionHits] = {}

    for table, statement in stream_insert_statements(dump_path, {HIT_TABLE, SESSION_TABLE}):
        for row in parse_mysql_value_tuple(statement):
            if table == SESSION_TABLE:
                info = build_session_info(row)
                if info.session_id:
                    sessions[info.session_id] = info
                continue

            if len(row) < 18:
                continue
            at = clean_text(row[2])
            if not at.startswith(report_date):
                continue

            session_id = safe_int(row[1])
            if not session_id:
                continue

            raw_url = clean_text(row[7])
            method = clean_text(row[11])
            url_404 = clean_text(row[8])
            stop_list_id = safe_int(row[14])
            user_agent = clean_text(row[13])
            user_id = safe_int(row[5])
            normalized = normalize_url(raw_url)
            if not normalized:
                continue

            bucket = hits_by_session.setdefault(session_id, SessionHits())
            hit = HitRow(at=at, url=normalized, user_id=user_id)
            bucket.all_hits.append(hit)

            if not is_clean_hit(raw_url, method, url_404, stop_list_id, user_agent):
                continue

            bucket.clean_hits.append(hit)
            if is_content_hit(normalized):
                bucket.content_hits.append(hit)

    candidates: list[tuple[int, SessionHits, SessionInfo | None]] = []
    for session_id, bucket in hits_by_session.items():
        if not bucket.clean_hits:
            continue
        candidates.append((session_id, bucket, sessions.get(session_id)))

    def sort_key(item: tuple[int, SessionHits, SessionInfo | None]) -> tuple[int, int, int]:
        _session_id, bucket, session = item
        user_id = session.user_id if session and session.user_id > 0 else 0
        content_steps = len(dedupe_consecutive([hit.url for hit in bucket.content_hits]))
        return (1 if user_id > 0 else 0, content_steps, len(bucket.clean_hits))

    candidates.sort(key=sort_key, reverse=True)

    rows: list[dict[str, Any]] = []
    for session_id, bucket, session in candidates[:limit]:
        clean_sorted = sorted(bucket.clean_hits, key=lambda hit: hit.at)
        content_sorted = sorted(bucket.content_hits, key=lambda hit: hit.at)
        content_steps = dedupe_consecutive([hit.url for hit in content_sorted])
        all_steps = dedupe_consecutive([hit.url for hit in clean_sorted])

        day_first = clean_sorted[0]
        day_last = clean_sorted[-1]
        duration_seconds = 0
        if len(clean_sorted) > 1:
            first_dt = datetime.strptime(day_first.at, "%Y-%m-%d %H:%M:%S")
            last_dt = datetime.strptime(day_last.at, "%Y-%m-%d %H:%M:%S")
            duration_seconds = cap_duration(int((last_dt - first_dt).total_seconds()))

        user_id = session.user_id if session and session.user_id > 0 else max((hit.user_id for hit in clean_sorted), default=0)
        rows.append(
            {
                "session_id": session_id,
                "user_id": user_id if user_id > 0 else None,
                "has_user_id": user_id > 0,
                "entry_url_day": day_first.url,
                "exit_url_day": day_last.url,
                "entry_url_session": session.url_to if session else day_first.url,
                "exit_url_session": session.url_last if session else day_last.url,
                "hits_total": len(bucket.all_hits),
                "hits_clean": len(bucket.clean_hits),
                "hits_content": len(content_sorted),
                "steps_content": len(content_steps),
                "events_count": 0,
                "duration_seconds": duration_seconds,
                "content_path": content_steps,
                "content_path_summary": summarize_path(content_steps),
                "all_path_summary": summarize_path(all_steps),
                "events_available": False,
            }
        )

    summary = {
        "sessions_in_day": len(hits_by_session),
        "sessions_exported": len(rows),
        "sessions_with_user_id": sum(1 for row in rows if row["has_user_id"]),
        "sessions_with_content_path": sum(1 for row in rows if row["steps_content"] >= 2),
        "hits_total": sum(row["hits_total"] for row in rows),
        "hits_clean": sum(row["hits_clean"] for row in rows),
        "events_available": False,
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dump": dump_path.name,
        "report_date": report_date,
        "schema": {
            "grain": "session_id x report_date",
            "sources": ["b_stat_hit", "b_stat_session"],
            "entry_exit_day": "first/last clean hit on report_date",
            "entry_exit_session": "b_stat_session.URL_TO / URL_LAST",
            "content_path": "clean GET hits without api/ajax/auth noise; consecutive duplicate URLs collapsed",
            "all_path": "all clean GET hits after bot/technical filters",
            "events": "not available in dump (b_stat_event_list empty)",
            "duration": "time between first and last clean hit on report_date, capped to 30 minutes",
        },
        "summary": summary,
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", default="abbott_reader_analytics_abbottpro_db_2026-05-29_11-14-33.sql")
    parser.add_argument("--date", default="2026-05-20")
    parser.add_argument("--out", default="dashboard-next/public/abbott/bitrix-session-journeys.json")
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()

    dump_path = Path(args.dump)
    if not dump_path.is_absolute():
        dump_path = Path.cwd() / dump_path

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = build_session_journeys(dump_path, args.date, args.limit)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path} ({len(payload['rows'])} sessions for {args.date})")


if __name__ == "__main__":
    main()
