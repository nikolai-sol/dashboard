#!/usr/bin/env python3
"""Stream a mysqldump input to schema-only, target-neutral SQL."""

from __future__ import annotations

import argparse
import re
import sys
from typing import Iterable, Iterator, TextIO


DATABASE_DECLARATION = re.compile(
    r"^\s*(?:CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?|USE)\b", re.I
)
DEFINER = re.compile(
    r"\bDEFINER\s*=\s*(?:"
    r"CURRENT_USER(?:\s*\(\s*\))?"
    r"|(?:`[^`]*`|'[^']*'|[^\s@]+)@(?:`[^`]*`|'[^']*'|[^\s]+)"
    r")\s*",
    re.I,
)
SQL_SECURITY_DEFINER = re.compile(r"\bSQL\s+SECURITY\s+DEFINER\b", re.I)
DDL = re.compile(
    r"^\s*(?:DROP\s+(?:TEMPORARY\s+)?(?:TABLE|VIEW)|ALTER\s+TABLE|"
    r"CREATE\s+(?:TEMPORARY\s+)?TABLE|CREATE\b[\s\S]*?\bVIEW)\b",
    re.I,
)
SKIPPED_STATEMENT_SPECIAL = re.compile(r"['\"`;/#-]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-database", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_$-]+", args.source_database):
        parser.error("source database identifier is invalid")
    return args


def executable_lines(stream: TextIO) -> Iterable[str]:
    """Unwrap line-oriented MySQL version comments without retaining comments."""
    for raw in stream:
        stripped = raw.lstrip()
        if stripped.startswith("/*!"):
            line = re.sub(r"^\s*/\*![0-9]{5,6}\s?", "", raw)
            line = re.sub(r"\*/\s*;\s*$", ";", line)
            line = re.sub(r"\*/\s*$", "", line)
            yield line + ("" if line.endswith("\n") else "\n")
        else:
            yield raw


def skipped_statement_tail(
    line: str, quote: str | None, block_comment: bool
) -> tuple[str | None, str | None, bool]:
    """Find an unquoted terminator without retaining skipped statement content."""
    index = 0
    while index < len(line):
        if block_comment:
            comment_end = line.find("*/", index)
            if comment_end < 0:
                return None, quote, True
            block_comment = False
            index = comment_end + 2
            continue
        if quote is not None:
            quote_at = line.find(quote, index)
            escape_at = line.find("\\", index)
            positions = [position for position in (quote_at, escape_at) if position >= 0]
            if not positions:
                return None, quote, block_comment
            special_at = min(positions)
            if special_at == escape_at:
                index = min(special_at + 2, len(line))
                continue
            following = line[special_at + 1] if special_at + 1 < len(line) else ""
            if following == quote:
                index = special_at + 2
                continue
            quote = None
            index = special_at + 1
            continue

        match = SKIPPED_STATEMENT_SPECIAL.search(line, index)
        if match is None:
            return None, quote, block_comment
        index = match.start()
        char = line[index]
        following = line[index + 1] if index + 1 < len(line) else ""
        if char in {"'", '"', "`"}:
            quote = char
            index += 1
            continue
        if char == ";":
            return line[index + 1 :], None, block_comment
        if char == "#" or (
            char == "-"
            and following == "-"
            and (index + 2 == len(line) or line[index + 2].isspace())
        ):
            return None, quote, block_comment
        if char == "/" and following == "*":
            block_comment = True
            index += 2
            continue
        index += 1
    return None, quote, block_comment


def schema_candidate_lines(lines: Iterable[str]) -> Iterator[str]:
    """Drop row/lock statements through a streaming quote-aware boundary."""
    prefixes = ("INSERT INTO ", "REPLACE INTO ", "LOCK TABLES ", "UNLOCK TABLES")
    skipping_statement = False
    skipped_quote: str | None = None
    skipped_block_comment = False
    for line in lines:
        if skipping_statement:
            tail, skipped_quote, skipped_block_comment = skipped_statement_tail(
                line, skipped_quote, skipped_block_comment
            )
            if tail is not None:
                skipping_statement = False
                skipped_quote = None
                skipped_block_comment = False
                if tail.strip():
                    yield tail
            continue
        stripped = line.lstrip()
        if stripped[:32].upper().startswith(prefixes):
            tail, skipped_quote, skipped_block_comment = skipped_statement_tail(
                line, None, False
            )
            skipping_statement = tail is None
            if tail is not None and tail.strip():
                yield tail
            continue
        yield line


def statements(lines: Iterable[str]) -> Iterator[str]:
    """Split SQL on unquoted semicolons while discarding ordinary comments."""
    buffer: list[str] = []
    quote: str | None = None
    block_comment = False
    for line in lines:
        index = 0
        while index < len(line):
            char = line[index]
            following = line[index + 1] if index + 1 < len(line) else ""
            if block_comment:
                if char == "*" and following == "/":
                    block_comment = False
                    index += 2
                else:
                    index += 1
                continue
            if quote is not None:
                buffer.append(char)
                if char == "\\" and index + 1 < len(line):
                    buffer.append(following)
                    index += 2
                    continue
                if char == quote:
                    if following == quote:
                        buffer.append(following)
                        index += 2
                        continue
                    quote = None
                index += 1
                continue
            if char in {"'", '"', "`"}:
                quote = char
                buffer.append(char)
                index += 1
                continue
            if char == "#" or (
                char == "-" and following == "-"
                and (index + 2 == len(line) or line[index + 2].isspace())
            ):
                break
            if char == "/" and following == "*":
                if buffer and not buffer[-1].isspace():
                    buffer.append(" ")
                block_comment = True
                index += 2
                continue
            if char == ";":
                statement = "".join(buffer).strip()
                buffer.clear()
                if statement:
                    yield statement
                index += 1
                continue
            buffer.append(char)
            index += 1
        if buffer and (not buffer[-1].isspace()):
            buffer.append("\n")
    statement = "".join(buffer).strip()
    if statement:
        yield statement


def strip_source_qualifiers(statement: str, source_database: str) -> str:
    statement = re.sub(
        rf"`{re.escape(source_database)}`\s*\.", "", statement, flags=re.I
    )
    return re.sub(
        rf"(?<![\w`]){re.escape(source_database)}\s*\.", "", statement, flags=re.I
    )


def main() -> int:
    source_database = parse_args().source_database
    for statement in statements(schema_candidate_lines(executable_lines(sys.stdin))):
        if DATABASE_DECLARATION.match(statement):
            continue
        statement = DEFINER.sub("", statement)
        statement = SQL_SECURITY_DEFINER.sub("SQL SECURITY INVOKER", statement)
        statement = strip_source_qualifiers(statement, source_database)
        if not DDL.match(statement):
            continue
        if re.search(r"\bDEFINER\b", statement, flags=re.I):
            raise SystemExit("schema filter rejected residual definer authority")
        if re.search(re.escape(source_database), statement, flags=re.I):
            raise SystemExit("schema filter rejected residual source database reference")
        sys.stdout.write(statement.rstrip() + ";\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
