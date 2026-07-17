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


def schema_candidate_lines(lines: Iterable[str]) -> Iterator[str]:
    """Drop complete line-oriented row/lock statements before character parsing."""
    prefixes = ("INSERT INTO ", "REPLACE INTO ", "LOCK TABLES ", "UNLOCK TABLES")
    skipping_statement = False
    for line in lines:
        ddl_tail = re.search(r";\s*(?=(?:CREATE|DROP|ALTER)\b)", line, flags=re.I)
        if skipping_statement:
            if line.rstrip().endswith(";"):
                skipping_statement = False
            continue
        stripped = line.lstrip()
        if stripped[:32].upper().startswith(prefixes):
            if ddl_tail is not None:
                yield line
                continue
            skipping_statement = not stripped.rstrip().endswith(";")
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
