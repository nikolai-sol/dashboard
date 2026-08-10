#!/usr/bin/env python3
"""Plan and apply fail-closed retention for Abbott release data-plane rows."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import hmac
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


DATASET_KEY = "abbott"
MANIFEST_VERSION = 1
DEFAULT_GRACE_DAYS = 7
DEFAULT_BATCH_SIZE = 10_000

# Deliberately static. Control-plane/provenance tables never appear here.
PURGE_TABLES: Tuple[Tuple[str, str], ...] = (
    ("report_bd", "canonical_fact_metrika_returning_pages_release_daily"),
    ("report_bd", "canonical_fact_metrika_site_analytics_daily"),
    ("report_bd", "canonical_source_coverage_daily"),
    ("report_bd", "portal_bitrix_journey_transitions"),
    ("report_bd", "portal_bitrix_page_facts"),
    ("report_bd", "portal_content_catalog"),
    ("report_bd", "portal_content_lookup_projection"),
    ("report_bd", "portal_event_catalog"),
    ("report_bd", "portal_external_events"),
    ("report_bd", "portal_general_materials"),
    ("report_bd_private", "canonical_fact_metrika_user_behavior_daily"),
    ("report_bd_private", "canonical_fact_metrika_visits"),
    ("report_bd_private", "portal_bitrix_journeys_private"),
    ("report_bd_private", "portal_bitrix_page_facts"),
    ("report_bd_private", "portal_user_directions_private"),
)


class RetentionError(RuntimeError):
    """Raised when a retention safety invariant fails."""


class ExecutorError(RetentionError):
    """Raised when the local MySQL client returns an error."""


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def manifest_digest(manifest: Mapping[str, Any]) -> str:
    payload = dict(manifest)
    payload.pop("manifest_sha256", None)
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def write_manifest(path: str, manifest: Mapping[str, Any]) -> str:
    payload = dict(manifest)
    digest = manifest_digest(payload)
    payload["manifest_sha256"] = digest
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(
        str(target),
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write("\n")
    os.chmod(target, 0o600)
    return digest


def _parse_datetime(value: Any) -> Optional[dt.datetime]:
    if value in (None, "", "NULL", "\\N"):
        return None
    if isinstance(value, dt.datetime):
        parsed = value
    else:
        text = str(value).strip().replace(" ", "T")
        parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _integer(value: Any, *, field: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise RetentionError(f"invalid integer field: {field}") from None


def _read_pointer(executor) -> Dict[str, Optional[int]]:
    rows = executor.query(
        """
        SELECT canonical_release_id, previous_release_id
        FROM report_bd.portal_active_data_releases
        WHERE dataset_key = 'abbott'
        """
    )
    if len(rows) != 1:
        raise RetentionError("Abbott active release pointer is missing or ambiguous")
    return {
        "canonical_release_id": _integer(
            rows[0].get("canonical_release_id"), field="canonical_release_id"
        ),
        "previous_release_id": (
            None
            if rows[0].get("previous_release_id") in (None, "", "NULL", "\\N")
            else _integer(rows[0].get("previous_release_id"), field="previous_release_id")
        ),
    }


def _release_rows(executor) -> List[Dict[str, Any]]:
    return executor.query(
        """
        SELECT id, release_status, created_at, retired_at
        FROM report_bd.portal_data_releases
        WHERE dataset_key = 'abbott'
        ORDER BY id
        """
    )


def _eligible(
    release: Mapping[str, Any], *, cutoff: dt.datetime
) -> bool:
    status = str(release.get("release_status") or "")
    if status == "failed":
        timestamp = _parse_datetime(release.get("created_at"))
    elif status == "retired":
        timestamp = _parse_datetime(release.get("retired_at"))
    else:
        return False
    return timestamp is not None and timestamp <= cutoff


def _table_stats(executor) -> Dict[Tuple[str, str], Dict[str, int]]:
    clauses = " OR ".join(
        f"(TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table}')"
        for schema, table in PURGE_TABLES
    )
    rows = executor.query(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS, "
        "(DATA_LENGTH + INDEX_LENGTH) AS table_bytes "
        "FROM information_schema.TABLES WHERE " + clauses
    )
    result: Dict[Tuple[str, str], Dict[str, int]] = {}
    for row in rows:
        key = (str(row["TABLE_SCHEMA"]), str(row["TABLE_NAME"]))
        if key not in PURGE_TABLES:
            raise RetentionError("information_schema returned a table outside the allowlist")
        result[key] = {
            "table_rows": int(row.get("TABLE_ROWS") or 0),
            "table_bytes": int(row.get("table_bytes") or 0),
        }
    return result


def _release_counts(executor, schema: str, table: str, release_ids: Sequence[int]):
    if not release_ids:
        return {}
    rendered_ids = ",".join(str(int(release_id)) for release_id in release_ids)
    rows = executor.query(
        f"SELECT canonical_release_id, COUNT(*) AS row_count "
        f"FROM `{schema}`.`{table}` "
        f"WHERE canonical_release_id IN ({rendered_ids}) "
        "GROUP BY canonical_release_id ORDER BY canonical_release_id"
    )
    return {
        str(_integer(row.get("canonical_release_id"), field="canonical_release_id")):
        _integer(row.get("row_count"), field="row_count")
        for row in rows
    }


def build_plan(
    executor,
    *,
    grace_days: int = DEFAULT_GRACE_DAYS,
    now: Optional[dt.datetime] = None,
) -> Dict[str, Any]:
    if grace_days < 0:
        raise RetentionError("grace days must be non-negative")
    observed_now = now or dt.datetime.now(dt.timezone.utc)
    if observed_now.tzinfo is None:
        observed_now = observed_now.replace(tzinfo=dt.timezone.utc)
    observed_now = observed_now.astimezone(dt.timezone.utc)
    cutoff = observed_now - dt.timedelta(days=grace_days)

    pointer = _read_pointer(executor)
    releases = _release_rows(executor)
    active_id = int(pointer["canonical_release_id"])
    previous_id = pointer["previous_release_id"]
    protected = {active_id}
    if previous_id is not None:
        protected.add(int(previous_id))
    for release in releases:
        if str(release.get("release_status") or "") in {"staging", "validated"}:
            protected.add(_integer(release.get("id"), field="release.id"))

    eligible = sorted(
        _integer(release.get("id"), field="release.id")
        for release in releases
        if _integer(release.get("id"), field="release.id") not in protected
        and _eligible(release, cutoff=cutoff)
    )
    stats = _table_stats(executor)
    table_plans = []
    for schema, table in PURGE_TABLES:
        rows_by_release = _release_counts(executor, schema, table, eligible)
        total_target_rows = sum(rows_by_release.values())
        table_stat = stats.get((schema, table), {"table_rows": 0, "table_bytes": 0})
        estimated_total_rows = table_stat["table_rows"] or total_target_rows
        estimated_bytes = (
            round(table_stat["table_bytes"] * total_target_rows / estimated_total_rows)
            if estimated_total_rows
            else 0
        )
        table_plans.append(
            {
                "schema": schema,
                "table": table,
                "rows_by_release": rows_by_release,
                "target_rows": total_target_rows,
                "table_bytes": table_stat["table_bytes"],
                "estimated_purge_bytes": estimated_bytes,
            }
        )

    return {
        "manifest_version": MANIFEST_VERSION,
        "dataset_key": DATASET_KEY,
        "generated_at": observed_now.isoformat(timespec="seconds"),
        "grace_days": grace_days,
        "cutoff_at": cutoff.isoformat(timespec="seconds"),
        "active_release_id": active_id,
        "previous_release_id": previous_id,
        "protected_release_ids": sorted(protected),
        "eligible_release_ids": eligible,
        "estimated_purge_bytes": sum(
            table["estimated_purge_bytes"] for table in table_plans
        ),
        "target_rows": sum(table["target_rows"] for table in table_plans),
        "tables": table_plans,
    }


def _assert_pointer(executor, manifest: Mapping[str, Any]) -> None:
    pointer = _read_pointer(executor)
    expected = {
        "canonical_release_id": int(manifest["active_release_id"]),
        "previous_release_id": manifest.get("previous_release_id"),
    }
    if pointer != expected:
        raise RetentionError("Abbott release pointer changed; retention stopped")


def _validate_manifest(manifest: Mapping[str, Any], expected_digest: str) -> None:
    if not hmac.compare_digest(manifest_digest(manifest), expected_digest):
        raise RetentionError("retention manifest digest mismatch")
    if manifest.get("manifest_version") != MANIFEST_VERSION:
        raise RetentionError("unsupported retention manifest version")
    if manifest.get("dataset_key") != DATASET_KEY:
        raise RetentionError("retention manifest is not Abbott")
    manifest_tables = [
        (str(table.get("schema")), str(table.get("table")))
        for table in manifest.get("tables", [])
    ]
    if len(manifest_tables) != len(PURGE_TABLES) or set(manifest_tables) != set(PURGE_TABLES):
        raise RetentionError("retention manifest table allowlist mismatch")
    protected = {int(value) for value in manifest.get("protected_release_ids", [])}
    eligible = {int(value) for value in manifest.get("eligible_release_ids", [])}
    if protected & eligible:
        raise RetentionError("retention manifest includes a protected release")
    if int(manifest["active_release_id"]) not in protected:
        raise RetentionError("active release is not protected")
    previous = manifest.get("previous_release_id")
    if previous is not None and int(previous) not in protected:
        raise RetentionError("previous release is not protected")


def _eligibility_predicate(release_id: int, grace_days: int) -> str:
    return f"""
      EXISTS (
        SELECT 1 FROM report_bd.portal_data_releases AS release_row
        WHERE release_row.dataset_key = 'abbott'
          AND release_row.id = {release_id}
          AND (
            (release_row.release_status = 'failed'
             AND release_row.created_at <= UTC_TIMESTAMP() - INTERVAL {grace_days} DAY)
            OR
            (release_row.release_status = 'retired'
             AND release_row.retired_at IS NOT NULL
             AND release_row.retired_at <= UTC_TIMESTAMP() - INTERVAL {grace_days} DAY)
          )
      )
      AND {release_id} <> (
        SELECT canonical_release_id FROM report_bd.portal_active_data_releases
        WHERE dataset_key = 'abbott'
      )
      AND {release_id} <> COALESCE((
        SELECT previous_release_id FROM report_bd.portal_active_data_releases
        WHERE dataset_key = 'abbott'
      ), 0)
    """


def _remaining_rows(executor, schema: str, table: str, release_id: int) -> int:
    rows = executor.query(
        f"SELECT COUNT(*) AS remaining_rows FROM `{schema}`.`{table}` "
        f"WHERE canonical_release_id = {release_id}"
    )
    if len(rows) != 1:
        raise RetentionError("unable to verify remaining retention rows")
    return _integer(rows[0].get("remaining_rows"), field="remaining_rows")


def apply_plan(
    executor,
    manifest: Mapping[str, Any],
    expected_digest: str,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Dict[str, Any]:
    if batch_size <= 0:
        raise RetentionError("batch size must be positive")
    _validate_manifest(manifest, expected_digest)
    _assert_pointer(executor, manifest)
    grace_days = _integer(manifest.get("grace_days"), field="grace_days")
    eligible_ids = [int(value) for value in manifest.get("eligible_release_ids", [])]
    deleted_by_table: Dict[str, Dict[str, int]] = {}

    for table_plan in manifest["tables"]:
        schema = str(table_plan["schema"])
        table = str(table_plan["table"])
        planned_counts = {
            str(int(release_id)): int(row_count)
            for release_id, row_count in table_plan.get("rows_by_release", {}).items()
        }
        current_counts = _release_counts(executor, schema, table, eligible_ids)
        if current_counts != planned_counts:
            raise RetentionError(
                f"release row counts changed for {schema}.{table}; retention stopped"
            )

    for table_plan in manifest["tables"]:
        schema = str(table_plan["schema"])
        table = str(table_plan["table"])
        table_key = f"{schema}.{table}"
        deleted_by_table[table_key] = {}
        planned_rows = {
            int(release_id): int(row_count)
            for release_id, row_count in table_plan.get("rows_by_release", {}).items()
        }
        for release_id in eligible_ids:
            if planned_rows.get(release_id, 0) <= 0:
                continue
            deleted = 0
            while True:
                _assert_pointer(executor, manifest)
                sql = (
                    f"DELETE FROM `{schema}`.`{table}` "
                    f"WHERE canonical_release_id = {release_id} AND "
                    f"{_eligibility_predicate(release_id, grace_days)} "
                    f"LIMIT {batch_size}"
                )
                affected = executor.execute_delete(sql)
                deleted += affected
                _assert_pointer(executor, manifest)
                if affected == 0:
                    break
            remaining = _remaining_rows(executor, schema, table, release_id)
            if remaining:
                raise RetentionError(
                    f"retention incomplete for {table_key} release {release_id}"
                )
            deleted_by_table[table_key][str(release_id)] = deleted

    _assert_pointer(executor, manifest)
    completed_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    return {
        "manifest_version": MANIFEST_VERSION,
        "dataset_key": DATASET_KEY,
        "source_manifest_sha256": expected_digest,
        "completed_at": completed_at,
        "active_release_id": int(manifest["active_release_id"]),
        "previous_release_id": manifest.get("previous_release_id"),
        "eligible_release_ids": eligible_ids,
        "deleted_rows": sum(
            count
            for table_counts in deleted_by_table.values()
            for count in table_counts.values()
        ),
        "deleted_by_table": deleted_by_table,
    }


class MysqlCliExecutor:
    def __init__(self, mysql_bin: str = "mysql"):
        self.mysql_bin = mysql_bin

    def _run(self, sql: str) -> str:
        completed = subprocess.run(
            [
                self.mysql_bin,
                "--batch",
                "--raw",
                "--column-names",
                "--default-character-set=utf8mb4",
                "--execute",
                sql,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode:
            diagnostic = (completed.stderr or "mysql command failed").strip()[:1000]
            raise ExecutorError(diagnostic)
        return completed.stdout

    def query(self, sql: str) -> List[Dict[str, Any]]:
        output = self._run(sql)
        if not output.strip():
            return []
        reader = csv.DictReader(output.splitlines(), delimiter="\t")
        return [dict(row) for row in reader]

    def execute_delete(self, sql: str) -> int:
        rows = self.query(sql.rstrip().rstrip(";") + "; SELECT ROW_COUNT() AS affected_rows")
        if len(rows) != 1:
            raise ExecutorError("mysql did not return a delete row count")
        return _integer(rows[0].get("affected_rows"), field="affected_rows")


def _parse_now(value: Optional[str]) -> Optional[dt.datetime]:
    if value is None:
        return None
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mysql-bin", default="mysql")
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--output", required=True)
    plan.add_argument("--grace-days", type=int, default=DEFAULT_GRACE_DAYS)
    plan.add_argument("--now")
    apply = commands.add_parser("apply")
    apply.add_argument("--manifest", required=True)
    apply.add_argument("--sha256", required=True)
    apply.add_argument("--output", required=True)
    apply.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    return parser


def run(args: argparse.Namespace) -> Dict[str, Any]:
    executor = MysqlCliExecutor(args.mysql_bin)
    if args.command == "plan":
        plan = build_plan(
            executor,
            grace_days=args.grace_days,
            now=_parse_now(args.now),
        )
        digest = write_manifest(args.output, plan)
        return {
            "mode": "plan",
            "manifest": args.output,
            "sha256": digest,
            "eligible_release_ids": plan["eligible_release_ids"],
            "target_rows": plan["target_rows"],
            "estimated_purge_bytes": plan["estimated_purge_bytes"],
        }
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    completion = apply_plan(
        executor,
        manifest,
        args.sha256,
        batch_size=args.batch_size,
    )
    completion_digest = write_manifest(args.output, completion)
    return {
        "mode": "apply",
        "completion": args.output,
        "sha256": completion_digest,
        "deleted_rows": completion["deleted_rows"],
    }


def main() -> int:
    try:
        print(json.dumps(run(build_parser().parse_args()), sort_keys=True))
        return 0
    except (RetentionError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(str(exc)) from None


if __name__ == "__main__":
    raise SystemExit(main())
