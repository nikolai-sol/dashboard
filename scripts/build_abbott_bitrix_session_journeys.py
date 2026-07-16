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
    raw_identifier,
    stream_insert_statements,
    validate_private_output_path,
    write_private_json,
)

JOURNEY_NOISE_PATH_RE = re.compile(
    r"(^|/)(api|ajax|auth|local|bitrix|upload|\.well-known)(/|$)|"
    r"(registration_sync|loginphone|confirm-sms|getexternallinks|getquestionanswer)(\.php)?$",
    re.IGNORECASE,
)


@dataclass
class HitRow:
    source_event_id: str
    at: str
    url: str
    user_id: str


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


def build_session_journeys(dump_path: Path) -> dict[str, Any]:
    sessions: dict[str, SessionInfo] = {}
    hits_by_session: dict[tuple[str, str], SessionHits] = {}

    for table, statement in stream_insert_statements(dump_path, {HIT_TABLE, SESSION_TABLE}):
        for row in parse_mysql_value_tuple(statement):
            if table == SESSION_TABLE:
                info = build_session_info(row)
                if info.session_id:
                    sessions[info.session_id] = info
                continue

            if len(row) < 18:
                continue
            source_event_id = raw_identifier(row[0])
            at = clean_text(row[2])
            report_date = at[:10]
            if not source_event_id or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date):
                continue

            session_id = raw_identifier(row[1])
            if not session_id:
                continue

            raw_url = clean_text(row[7])
            method = clean_text(row[11])
            url_404 = clean_text(row[8])
            try:
                stop_list_id = int(row[14] or 0)
            except (TypeError, ValueError):
                stop_list_id = 0
            user_agent = clean_text(row[13])
            user_id = raw_identifier(row[5])
            normalized = normalize_url(raw_url)
            if not normalized:
                continue

            bucket = hits_by_session.setdefault((report_date, session_id), SessionHits())
            hit = HitRow(source_event_id=source_event_id, at=at, url=normalized, user_id=user_id)
            bucket.all_hits.append(hit)

            if not is_clean_hit(raw_url, method, url_404, stop_list_id, user_agent):
                continue

            bucket.clean_hits.append(hit)
            if is_content_hit(normalized):
                bucket.content_hits.append(hit)

    rows: list[dict[str, Any]] = []
    for (report_date, session_id), bucket in sorted(hits_by_session.items()):
        session = sessions.get(session_id)
        clean_sorted = sorted(bucket.clean_hits, key=lambda hit: (hit.at, hit.source_event_id))
        for event_sequence, hit in enumerate(clean_sorted):
            user_id = session.user_id if session and session.user_id and session.user_id != "0" else hit.user_id
            rows.append(
                {
                    "report_date": report_date,
                    "protected_visit_id": session_id,
                    "raw_user_id": user_id if user_id and user_id != "0" else None,
                    "source_event_id": hit.source_event_id,
                    "event_sequence": event_sequence,
                    "event_at": hit.at,
                    "normalized_path": urlparse(hit.url).path or "/",
                    "event_kind": "pageview",
                }
            )

    summary = {
        "sessions_exported": len(hits_by_session),
        "events_exported": len(rows),
        "sessions_with_user_id": len(
            {
                (row["report_date"], row["protected_visit_id"])
                for row in rows
                if row["raw_user_id"] is not None
            }
        ),
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dump": dump_path.name,
        "schema": {
            "grain": "protected_visit_id x event_sequence",
            "ordered_events": True,
            "sources": ["b_stat_hit", "b_stat_session"],
            "events": "ordered clean pageview hits; raw identifiers retained as text",
        },
        "manifest": {"complete": True, "truncated": False},
        "summary": summary,
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    dump_path = Path(args.dump).expanduser().resolve()
    out_path = validate_private_output_path(Path(args.out))
    payload = build_session_journeys(dump_path)
    write_private_json(out_path, payload)
    print(f"Wrote {out_path} events={len(payload['rows'])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bitrix journey build failed class={type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
