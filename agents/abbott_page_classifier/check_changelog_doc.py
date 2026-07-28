#!/usr/bin/env python3
"""Check client comments / suggestions on the Abbott Changelog Google Doc.

Usage:
  python3 check_changelog_doc.py
  python3 check_changelog_doc.py --json

When user says «проверь Changelog» — run this and summarize client notes.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

STATE_PATH = Path(__file__).resolve().parent / "out" / "google_doc_changelog_state.json"
TOKEN_PATH = Path.home() / ".hermes" / "google_token.json"


def load_creds() -> Credentials:
    if not TOKEN_PATH.exists():
        raise SystemExit(f"NOT_AUTHENTICATED: {TOKEN_PATH}")
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return creds


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    p.add_argument("--document-id", default=None)
    args = p.parse_args()

    state = {}
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    doc_id = args.document_id or state.get("document_id")
    if not doc_id:
        raise SystemExit("No document_id — create Changelog Google Doc first")

    creds = load_creds()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    meta = (
        drive.files()
        .get(fileId=doc_id, fields="id,name,modifiedTime,webViewLink,owners,lastModifyingUser")
        .execute()
    )

    # Drive comments (includes Doc comments)
    comments = []
    page_token = None
    while True:
        resp = (
            drive.comments()
            .list(
                fileId=doc_id,
                fields="nextPageToken,comments(id,content,createdTime,modifiedTime,author,resolved,quotedFileContent,replies(id,content,createdTime,author))",
                pageSize=100,
                pageToken=page_token,
                includeDeleted=False,
            )
            .execute()
        )
        comments.extend(resp.get("comments") or [])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    open_comments = [c for c in comments if not c.get("resolved")]
    resolved = [c for c in comments if c.get("resolved")]

    # Export plain text snapshot (for detecting inline edits in answer table)
    export = drive.files().export(fileId=doc_id, mimeType="text/plain").execute()
    if isinstance(export, bytes):
        plain = export.decode("utf-8", errors="replace")
    else:
        plain = str(export)

    snapshot_path = Path(__file__).resolve().parent / "out" / "changelog_doc_snapshot.txt"
    snapshot_path.write_text(plain, encoding="utf-8")

    # Heuristic: look for filled answers in §0 table (lines after questions that aren't placeholders)
    answer_hints = []
    for line in plain.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("_…") or s == "…" or "ожидается" in s.lower():
            continue
        # Russian short answers near frequency words
        low = s.lower()
        if any(
            k in low
            for k in (
                "раз в",
                "2×",
                "2x",
                "два раза",
                "еженед",
                "ежеднев",
                "google sheet",
                "excel",
                "ок defaults",
                "ok defaults",
                "удобн",
            )
        ):
            answer_hints.append(s)

    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "document_id": doc_id,
        "document_url": meta.get("webViewLink") or state.get("document_url"),
        "title": meta.get("name"),
        "modified_time": meta.get("modifiedTime"),
        "last_modifying_user": (meta.get("lastModifyingUser") or {}).get("displayName")
        or (meta.get("lastModifyingUser") or {}).get("emailAddress"),
        "comments_total": len(comments),
        "comments_open": len(open_comments),
        "comments_resolved": len(resolved),
        "open_comments": [
            {
                "id": c.get("id"),
                "author": (c.get("author") or {}).get("displayName"),
                "content": c.get("content"),
                "quoted": ((c.get("quotedFileContent") or {}).get("value") or "")[:200],
                "created": c.get("createdTime"),
                "replies": [
                    {
                        "author": (r.get("author") or {}).get("displayName"),
                        "content": r.get("content"),
                        "created": r.get("createdTime"),
                    }
                    for r in (c.get("replies") or [])
                ],
            }
            for c in open_comments
        ],
        "answer_hints_in_body": answer_hints[:30],
        "snapshot": str(snapshot_path),
    }

    state["last_check"] = result["checked_at"]
    state["last_check_summary"] = {
        "open_comments": result["comments_open"],
        "modified_time": result["modified_time"],
    }
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"Doc: {result['title']}")
    print(f"URL: {result['document_url']}")
    print(f"Modified: {result['modified_time']} by {result['last_modifying_user']}")
    print(f"Comments: open={result['comments_open']} resolved={result['comments_resolved']} total={result['comments_total']}")
    if open_comments:
        print("\n--- Open comments ---")
        for c in result["open_comments"]:
            print(f"* {c['author']}: {c['content']}")
            if c.get("quoted"):
                print(f"  quote: {c['quoted'][:120]}")
            for r in c.get("replies") or []:
                print(f"  ↳ {r['author']}: {r['content']}")
    else:
        print("\nNo open comments.")
    if answer_hints:
        print("\n--- Possible answers in body ---")
        for a in answer_hints:
            print(f"  • {a}")
    else:
        print("\nNo obvious filled answers detected in body yet (placeholders still empty).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
