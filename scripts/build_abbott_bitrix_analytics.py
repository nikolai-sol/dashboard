#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


HIT_TABLE = "b_stat_hit"
SESSION_TABLE = "b_stat_session"

BOT_USER_AGENT_RE = re.compile(
    r"(bot|crawler|spider|externalagent|zabbix|preview|prefetch|backup|chatgpt-user|skypeuripreview|"
    r"petalbot|facebookexternalhit|meta-externalagent|cfnetwork/.+darwin)",
    re.IGNORECASE,
)
TECH_PATH_RE = re.compile(r"(^|/)(bitrix|local|upload|ajax|\.well-known)(/|$)", re.IGNORECASE)
TECH_EXT_RE = re.compile(
    r"\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|pdf|zip|rar|7z|mp4|xml)$",
    re.IGNORECASE,
)
SESSION_DURATION_CAP_SECONDS = 30 * 60


@dataclass
class SessionInfo:
    session_id: str
    guest_id: str
    user_id: str
    user_auth: str
    date_first: str
    date_last: str
    duration_seconds: int
    hits: int
    url_to: str
    url_last: str


@dataclass
class UrlAgg:
    report_date: str
    url: str
    pageviews: int = 0
    session_ids: set[str] = field(default_factory=set)
    user_ids: set[str] = field(default_factory=set)
    guest_ids: set[str] = field(default_factory=set)
    logged_in_hits: int = 0
    anonymous_hits: int = 0
    entry_sessions: set[str] = field(default_factory=set)
    exit_sessions: set[str] = field(default_factory=set)
    session_duration_sum: int = 0
    session_duration_ids: set[str] = field(default_factory=set)
    utm_source: Counter[str] = field(default_factory=Counter)
    utm_medium: Counter[str] = field(default_factory=Counter)
    utm_campaign: Counter[str] = field(default_factory=Counter)


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def raw_identifier(value: Any) -> str:
    return str(value if value is not None else "").strip()


def parse_dt(value: str) -> datetime | None:
    value = clean_text(value)
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def parse_duration_seconds(date_first: str, date_last: str) -> int:
    first = parse_dt(date_first)
    last = parse_dt(date_last)
    if not first or not last or last < first:
        return 0
    return int((last - first).total_seconds())


def normalize_url(raw_url: str) -> str:
    raw_url = clean_text(raw_url).replace("&amp;", "&")
    if not raw_url:
        return ""
    parsed = urlparse(raw_url if "://" in raw_url else f"https://abbottpro.ru{raw_url if raw_url.startswith('/') else '/' + raw_url}")
    host = (parsed.netloc or "abbottpro.ru").lower()
    path = re.sub(r"/+", "/", parsed.path or "/")
    path = path.rstrip("/") or "/"
    return f"https://{host}{path}"


def is_technical_url(raw_url: str) -> bool:
    normalized = normalize_url(raw_url)
    if not normalized:
        return True
    parsed = urlparse(normalized)
    path = parsed.path or "/"
    if TECH_PATH_RE.search(path):
        return True
    if TECH_EXT_RE.search(path):
        return True
    return False


def extract_utm(raw_url: str, key: str) -> str:
    parsed = urlparse(clean_text(raw_url).replace("&amp;", "&"))
    values = parse_qs(parsed.query).get(key)
    return clean_text(values[0]) if values else ""


def parse_mysql_value_tuple(statement: str):
    idx = statement.find("VALUES")
    if idx < 0:
        return
    i = idx + len("VALUES")
    n = len(statement)
    while i < n:
        while i < n and statement[i] not in "(":
            i += 1
        if i >= n:
            return
        i += 1
        row: list[Any] = []
        token: list[str] = []
        in_string = False
        was_string = False
        while i < n:
            ch = statement[i]
            if in_string:
                if ch == "\\" and i + 1 < n:
                    nxt = statement[i + 1]
                    token.append(
                        {
                            "0": "\0",
                            "n": "\n",
                            "r": "\r",
                            "t": "\t",
                            "b": "\b",
                            "Z": "\x1a",
                        }.get(nxt, nxt)
                    )
                    i += 2
                    continue
                if ch == "'":
                    in_string = False
                    i += 1
                    continue
                token.append(ch)
                i += 1
                continue
            if ch == "'":
                in_string = True
                was_string = True
                i += 1
                continue
            if ch in ",)":
                raw = "".join(token).strip()
                if was_string:
                    value: Any = raw
                elif raw.upper() == "NULL" or raw == "":
                    value = None
                else:
                    value = raw
                row.append(value)
                token = []
                was_string = False
                i += 1
                if ch == ")":
                    yield row
                    break
                continue
            token.append(ch)
            i += 1


def stream_insert_statements(dump_path: Path, target_tables: set[str]):
    current_table = ""
    chunks: list[str] = []
    with dump_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not chunks:
                match = re.match(r"INSERT INTO `([^`]+)` VALUES", line)
                if not match or match.group(1) not in target_tables:
                    continue
                current_table = match.group(1)
                chunks.append(line)
                if line.rstrip().endswith(";"):
                    yield current_table, "".join(chunks)
                    chunks = []
                    current_table = ""
                continue
            chunks.append(line)
            if line.rstrip().endswith(";"):
                yield current_table, "".join(chunks)
                chunks = []
                current_table = ""


def build_session_info(row: list[Any]) -> SessionInfo:
    date_first = clean_text(row[15] if len(row) > 15 else "")
    date_last = clean_text(row[16] if len(row) > 16 else "")
    return SessionInfo(
        session_id=raw_identifier(row[0]),
        guest_id=raw_identifier(row[1]),
        user_id=raw_identifier(row[3]),
        user_auth=clean_text(row[4]),
        hits=safe_int(row[6]),
        url_to=normalize_url(clean_text(row[9] if len(row) > 9 else "")),
        url_last=normalize_url(clean_text(row[11] if len(row) > 11 else "")),
        date_first=date_first,
        date_last=date_last,
        duration_seconds=parse_duration_seconds(date_first, date_last),
    )


def path_from_url(url: str) -> str:
    return urlparse(url).path or "/"


def infer_material_type(url: str) -> str:
    first = next((part for part in path_from_url(url).split("/") if part), "")
    return {
        "academy": "Материалы academy",
        "articles": "Статьи",
        "video": "Видео",
        "klinicheskie-sluchai": "Клинические случаи",
        "nauchno-obrazovatelnye-broshyury": "Научно-образовательные брошюры",
        "podcasts": "Подкасты",
        "tables": "Таблицы",
        "calculators-tables": "Калькуляторы/таблицы",
        "events": "Мероприятия",
    }.get(first, "")


def build_bitrix_analytics(dump_path: Path) -> dict[str, Any]:
    sessions: dict[str, SessionInfo] = {}
    session_hit_bounds: dict[tuple[str, str], tuple[datetime, datetime, str, str]] = {}
    hit_rows = 0
    clean_hits = 0
    raw_date_from = ""
    raw_date_to = ""
    clean_date_from = ""
    clean_date_to = ""
    excluded = Counter()
    url_aggs: dict[tuple[str, str], UrlAgg] = {}

    for table, statement in stream_insert_statements(dump_path, {HIT_TABLE, SESSION_TABLE}):
        for row in parse_mysql_value_tuple(statement):
            if table == SESSION_TABLE:
                info = build_session_info(row)
                if info.session_id:
                    sessions[info.session_id] = info
                continue

            hit_rows += 1
            if len(row) < 18:
                excluded["short_hit_row"] += 1
                continue
            date_hit = clean_text(row[2])
            if date_hit:
                raw_date_from = date_hit if not raw_date_from or date_hit < raw_date_from else raw_date_from
                raw_date_to = date_hit if not raw_date_to or date_hit > raw_date_to else raw_date_to
            report_date = date_hit[:10]
            session_id = raw_identifier(row[1])
            user_id = raw_identifier(row[5])
            guest_id = raw_identifier(row[3])
            raw_url = clean_text(row[7])
            url_404 = clean_text(row[8]).upper()
            method = clean_text(row[11]).upper()
            user_agent = clean_text(row[13])
            stop_list_id = safe_int(row[14])
            if method and method != "GET":
                excluded["method"] += 1
                continue
            if url_404 == "Y":
                excluded["404"] += 1
                continue
            if stop_list_id > 0:
                excluded["stop_list"] += 1
                continue
            if BOT_USER_AGENT_RE.search(user_agent):
                excluded["bot_user_agent"] += 1
                continue
            if is_technical_url(raw_url):
                excluded["technical_url"] += 1
                continue

            normalized = normalize_url(raw_url)
            if not normalized:
                excluded["empty_url"] += 1
                continue
            hit_dt = parse_dt(clean_text(row[2]))
            if session_id and hit_dt:
                bound_key = (report_date, session_id)
                current_bounds = session_hit_bounds.get(bound_key)
                if not current_bounds:
                    session_hit_bounds[bound_key] = (hit_dt, hit_dt, normalized, normalized)
                else:
                    first_dt, last_dt, first_url, last_url = current_bounds
                    if hit_dt < first_dt:
                        first_dt = hit_dt
                        first_url = normalized
                    if hit_dt >= last_dt:
                        last_dt = hit_dt
                        last_url = normalized
                    session_hit_bounds[bound_key] = (first_dt, last_dt, first_url, last_url)
            clean_hits += 1
            if date_hit:
                clean_date_from = date_hit if not clean_date_from or date_hit < clean_date_from else clean_date_from
                clean_date_to = date_hit if not clean_date_to or date_hit > clean_date_to else clean_date_to
            aggregate_key = (report_date, normalized)
            agg = url_aggs.get(aggregate_key)
            if not agg:
                agg = UrlAgg(report_date=report_date, url=normalized)
                url_aggs[aggregate_key] = agg
            agg.pageviews += 1
            if session_id:
                agg.session_ids.add(session_id)
            if user_id and user_id != "0":
                agg.user_ids.add(user_id)
                agg.logged_in_hits += 1
            else:
                agg.anonymous_hits += 1
            if guest_id and guest_id != "0":
                agg.guest_ids.add(guest_id)
            for key, counter in [
                ("utm_source", agg.utm_source),
                ("utm_medium", agg.utm_medium),
                ("utm_campaign", agg.utm_campaign),
            ]:
                value = extract_utm(raw_url, key)
                if value:
                    counter[value] += 1

    for agg in url_aggs.values():
        for session_id in agg.session_ids:
            session = sessions.get(session_id)
            if not session:
                continue
            if (session.user_id and session.user_id != "0") or session.user_auth.upper() == "Y":
                # Count unique logged-in sessions below via a synthetic marker.
                pass
            if session.session_id not in agg.session_duration_ids:
                bounds = session_hit_bounds.get((agg.report_date, session.session_id))
                duration_seconds = (
                    int((bounds[1] - bounds[0]).total_seconds())
                    if bounds and bounds[1] >= bounds[0]
                    else session.duration_seconds
                )
                agg.session_duration_sum += min(max(0, duration_seconds), SESSION_DURATION_CAP_SECONDS)
                agg.session_duration_ids.add(session.session_id)
            bounds = session_hit_bounds.get((agg.report_date, session_id))
            entry_url, exit_url = (bounds[2], bounds[3]) if bounds else (session.url_to, session.url_last)
            if entry_url == agg.url:
                agg.entry_sessions.add(session_id)
            if exit_url == agg.url:
                agg.exit_sessions.add(session_id)

    rows: list[dict[str, Any]] = []
    for agg in sorted(url_aggs.values(), key=lambda item: (item.report_date, item.url)):
        session_infos = [sessions.get(session_id) for session_id in agg.session_ids]
        logged_in_sessions = {
            item.session_id
            for item in session_infos
            if item and ((item.user_id and item.user_id != "0") or item.user_auth.upper() == "Y")
        }
        rows.append(
            {
                "report_date": agg.report_date,
                "normalized_path": path_from_url(agg.url),
                "material_type_hint": infer_material_type(agg.url),
                "pageviews": agg.pageviews,
                "sessions": len(agg.session_ids),
                "users": len(agg.user_ids),
                "guests": len(agg.guest_ids),
                "logged_in_hits": agg.logged_in_hits,
                "anonymous_hits": agg.anonymous_hits,
                "logged_in_sessions": len(logged_in_sessions),
                "anonymous_sessions": max(0, len(agg.session_ids) - len(logged_in_sessions)),
                "entry_sessions": len(agg.entry_sessions),
                "exit_sessions": len(agg.exit_sessions),
                "avg_session_duration_seconds": round(agg.session_duration_sum / max(1, len(agg.session_duration_ids)), 2),
                "top_utm_source": agg.utm_source.most_common(1)[0][0] if agg.utm_source else "",
                "top_utm_medium": agg.utm_medium.most_common(1)[0][0] if agg.utm_medium else "",
                "top_utm_campaign": agg.utm_campaign.most_common(1)[0][0] if agg.utm_campaign else "",
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_dump": dump_path.name,
        "grain": "normalized_path x report_date",
        "manifest": {"complete": True, "truncated": False},
        "filters": {
            "method": "GET or empty",
            "url_404": "exclude Y",
            "stop_list_id": "exclude > 0",
            "technical_paths": ["/bitrix/", "/local/", "/upload/", "/ajax/", "/.well-known/"],
            "technical_extensions": [".js", ".css", ".map", "images", "fonts", ".pdf", ".zip", ".rar", ".7z", ".mp4", ".xml"],
            "bot_user_agent": BOT_USER_AGENT_RE.pattern,
            "session_duration_cap_seconds": SESSION_DURATION_CAP_SECONDS,
        },
        "summary": {
            "raw_hit_rows": hit_rows,
            "clean_hit_rows": clean_hits,
            "raw_date_from": raw_date_from,
            "raw_date_to": raw_date_to,
            "date_from": clean_date_from,
            "date_to": clean_date_to,
            "sessions_loaded": len(sessions),
            "unique_clean_urls": len({url for _date, url in url_aggs}),
            "excluded": dict(excluded),
        },
        "rows": rows,
    }


def validate_private_output_path(out_path: Path) -> Path:
    resolved = out_path.expanduser().resolve()
    if any(part.lower() == "public" for part in resolved.parts):
        raise ValueError("output must not be under public")
    return resolved


def write_private_json(out_path: Path, payload: dict[str, Any]) -> None:
    resolved = validate_private_output_path(out_path)
    resolved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = resolved.parent / f".{resolved.name}.{os.getpid()}.tmp"
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, resolved)
        os.chmod(resolved, 0o600)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    dump = Path(args.dump).expanduser().resolve()
    out = validate_private_output_path(Path(args.out))
    payload = build_bitrix_analytics(dump)
    write_private_json(out, payload)
    print(
        f"Wrote {out} rows={len(payload['rows'])} "
        f"clean_hits={payload['summary']['clean_hit_rows']} urls={payload['summary']['unique_clean_urls']}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bitrix analytics build failed class={type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
