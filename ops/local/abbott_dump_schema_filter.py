#!/usr/bin/env python3
"""Stream a mysqldump-compatible input to schema-only, target-neutral SQL."""

from __future__ import annotations

import re
import sys


DATABASE = re.compile(r"^\s*(?:CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?|USE)\s+`?([^`;\s]+)`?", re.I)
DEFINER = re.compile(r"\bDEFINER\s*=\s*(?:`[^`]*`|'[^']*'|[^\s]+)@(?:`[^`]*`|'[^']*'|[^\s]+)\s*", re.I)
SQL_SECURITY_DEFINER = re.compile(r"\bSQL\s+SECURITY\s+DEFINER\b", re.I)
DDL = re.compile(
    r"^\s*(?:DROP\s+(?:TEMPORARY\s+)?(?:TABLE|VIEW)|ALTER\s+TABLE|"
    r"CREATE\s+(?:TEMPORARY\s+)?TABLE|CREATE\b[\s\S]*?\bVIEW)\b",
    re.I,
)


def unwrap_version_comment(line: str) -> str:
    line = re.sub(r"^\s*/\*![0-9]{5}\s?", "", line)
    line = re.sub(r"\*/\s*;\s*$", ";", line)
    return re.sub(r"\*/\s*$", "", line)


def strip_source_qualifiers(statement: str, databases: set[str]) -> str:
    for database in sorted(databases, key=len, reverse=True):
        statement = re.sub(rf"`{re.escape(database)}`\s*\.", "", statement, flags=re.I)
        statement = re.sub(rf"(?<![\w`]){re.escape(database)}\s*\.", "", statement, flags=re.I)
    return statement


def main() -> int:
    source_databases: set[str] = set()
    statement: list[str] = []

    def emit() -> None:
        if not statement:
            return
        sql = "".join(statement).strip()
        statement.clear()
        database = DATABASE.match(sql)
        if database:
            source_databases.add(database.group(1))
            return
        sql = DEFINER.sub("", sql)
        sql = SQL_SECURITY_DEFINER.sub("SQL SECURITY INVOKER", sql)
        sql = strip_source_qualifiers(sql, source_databases)
        if DDL.match(sql):
            sys.stdout.write(sql.rstrip(";\n") + ";\n")

    for raw in sys.stdin:
        stripped = raw.lstrip()
        if stripped.startswith("--") or stripped.startswith("#"):
            continue
        line = unwrap_version_comment(raw) if stripped.startswith("/*!") else raw
        if not line.strip() or line.lstrip().startswith("/*"):
            continue
        statement.append(line)
        if ";" in line:
            emit()
    emit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
