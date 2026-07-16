#!/usr/bin/env python3
"""Deterministic, private migration controls for the Abbott canonical release."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Mapping, Sequence


ABBOTT_COUNTER_ID = "90602537"
METRIKA_SOURCE_KEY = "yandex_metrika"
CONTROL_PACK_SOURCE_KIND = "abbott_canonical_control_pack"
CONTROL_PACK_PARSER_VERSION = "abbott-controls-v1"
API_RELATIVE_DELTA_THRESHOLD = Decimal("0.01")
ABBOTT_REQUIRED_SCOPES = ("other", "traffic", "page", "user_behavior", "returning")


class AbbottControlError(RuntimeError):
    """Sanitized base error for baseline and comparison controls."""


class UnsafeDiagnosticError(AbbottControlError):
    """Raised when a diagnostic could disclose an identifier or path."""


def _json_default(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"Unsupported stable JSON value: {type(value).__name__}")


def _stable_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=_json_default,
    ).encode("utf-8")


def stable_json_hash(value: Any) -> str:
    """Return the SHA-256 of a canonical UTF-8 JSON representation."""

    return hashlib.sha256(_stable_json_bytes(value)).hexdigest()


def _file_row_count(path: Path, content: bytes) -> int:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        text = content.decode("utf-8-sig")
        rows = list(csv.reader(text.splitlines(), delimiter=delimiter))
        return max(len(rows) - 1, 0)
    if suffix == ".json":
        parsed = json.loads(content.decode("utf-8"))
        return len(parsed) if isinstance(parsed, list) else 1
    return sum(1 for line in content.splitlines() if line.strip())


def file_snapshot(path: Path, *, source_kind: str, parser_version: str) -> dict:
    """Fingerprint one caller-selected file without directory discovery."""

    explicit_path = Path(path)
    if not source_kind.strip() or not parser_version.strip():
        raise ValueError("File snapshot metadata is required")
    if not explicit_path.is_file():
        raise FileNotFoundError("Explicit baseline source file was not found")
    content = explicit_path.read_bytes()
    stat = explicit_path.stat()
    return {
        "source_kind": source_kind,
        "source_name": explicit_path.name,
        "parser_version": parser_version,
        "content_sha256": hashlib.sha256(content).hexdigest(),
        "content_bytes": len(content),
        "source_generated_at": datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat(),
        "source_row_count": _file_row_count(explicit_path, content),
    }


def api_fingerprint(
    *,
    dimensions: Sequence[str],
    metrics: Sequence[str],
    filters: str,
    attribution: str,
    accuracy: str,
    pagination_limit: int,
    timezone: str,
    code_revision: str,
    parser_version: str,
) -> str:
    """Fingerprint every setting that changes an API control's meaning."""

    if (
        pagination_limit <= 0
        or not code_revision.strip()
        or not parser_version.strip()
    ):
        raise ValueError("API fingerprint context is invalid")
    return stable_json_hash(
        {
            "dimensions": list(dimensions),
            "metrics": list(metrics),
            "filters": filters,
            "attribution": attribution,
            "accuracy": accuracy,
            "pagination_limit": pagination_limit,
            "timezone": timezone,
            "code_revision": code_revision,
            "parser_version": parser_version,
        }
    )


_UNSAFE_DIAGNOSTIC_KEY = re.compile(
    r"(^|_)(id|identifier|path|url|uri|locator|token|cookie|password|dsn)(_|$)",
    re.IGNORECASE,
)
_ABSOLUTE_WINDOWS_PATH = re.compile(r"^[A-Za-z]:[\\/]")


def _validate_diagnostic_value(value: Any, key: str | None = None) -> None:
    if key is not None:
        normalized_key = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)
        normalized_key = re.sub(r"[^A-Za-z0-9]+", "_", normalized_key).lower()
        if _UNSAFE_DIAGNOSTIC_KEY.search(normalized_key):
            raise UnsafeDiagnosticError(
                "Validation diagnostic contains a prohibited field"
            )
    if isinstance(value, Mapping):
        for nested_key, nested_value in value.items():
            _validate_diagnostic_value(nested_value, str(nested_key))
    elif isinstance(value, (list, tuple)):
        for nested_value in value:
            _validate_diagnostic_value(nested_value)
    elif isinstance(value, str):
        if (
            "://" in value
            or "/" in value
            or "\\" in value
            or _ABSOLUTE_WINDOWS_PATH.match(value)
        ):
            raise UnsafeDiagnosticError(
                "Validation diagnostic contains a prohibited value"
            )


def validate_diagnostic(diagnostic: Mapping[str, Any]) -> dict:
    """Reject rather than redact diagnostics carrying IDs or row-level paths."""

    if not isinstance(diagnostic, Mapping):
        raise UnsafeDiagnosticError("Validation diagnostic must be a mapping")
    _validate_diagnostic_value(diagnostic)
    return dict(diagnostic)


@dataclass(frozen=True)
class ControlResult:
    control_name: str
    expected_value: Decimal | int | float | None
    actual_value: Decimal | int | float | None
    absolute_delta: Decimal | int | float | None
    relative_delta: Decimal | int | float | None
    threshold_value: Decimal | int | float | None
    result_status: str
    diagnostic: Mapping[str, Any]
    reviewed_by: str | None = None
    accepted_at: str | datetime | None = None

    def __post_init__(self) -> None:
        if self.result_status not in {"pass", "warn", "fail"}:
            raise ValueError("Unknown validation result status")
        validate_diagnostic(self.diagnostic)


def _decimal(value: Decimal | int | float | str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("Control value is not numeric") from None


def compare_numeric_control(
    control_name: str,
    *,
    expected: Decimal | int | float,
    actual: Decimal | int | float,
    threshold: Decimal | int | float = API_RELATIVE_DELTA_THRESHOLD,
) -> ControlResult:
    """Compare one aggregate, failing only when the relative delta exceeds the gate."""

    expected_decimal = _decimal(expected)
    actual_decimal = _decimal(actual)
    threshold_decimal = _decimal(threshold)
    absolute_delta = abs(actual_decimal - expected_decimal)
    if expected_decimal == 0:
        relative_delta = Decimal("0") if actual_decimal == 0 else Decimal("1")
    else:
        relative_delta = absolute_delta / abs(expected_decimal)
    failed = relative_delta > threshold_decimal
    return ControlResult(
        control_name=control_name,
        expected_value=expected_decimal,
        actual_value=actual_decimal,
        absolute_delta=absolute_delta,
        relative_delta=relative_delta,
        threshold_value=threshold_decimal,
        result_status="fail" if failed else "pass",
        diagnostic={
            "reason_code": "relative_delta_exceeded" if failed else "within_threshold"
        },
    )


def cutover_allowed(results: Sequence[ControlResult]) -> bool:
    """Require every warning to be explicitly reviewed and accepted."""

    if not results:
        return False
    return all(
        result.result_status == "pass"
        or (
            result.result_status == "warn"
            and bool(result.reviewed_by)
            and result.accepted_at is not None
        )
        for result in results
    )


def _numeric(value: Any) -> int | float:
    if value is None:
        return 0
    decimal_value = _decimal(value)
    if decimal_value == decimal_value.to_integral_value():
        return int(decimal_value)
    return float(decimal_value)


def _control_values(
    site_rows: Sequence[Mapping[str, Any]],
    coverage_rows: Sequence[Mapping[str, Any]],
) -> dict[str, int | float]:
    values: dict[str, int | float] = {}
    for row in site_rows:
        scope = str(row["scope_key"])
        for metric in ("fact_rows", "sessions", "users", "pageviews"):
            values[f"site.{scope}.{metric}"] = _numeric(row.get(metric))
    for row in coverage_rows:
        scope = str(row["scope_key"])
        values[f"coverage.{scope}.days"] = _numeric(row.get("coverage_days"))
        values[f"api.{scope}.rows"] = _numeric(row.get("api_total_rows"))
        values[f"coverage.{scope}.persisted_rows"] = _numeric(
            row.get("persisted_rows")
        )
    return dict(sorted(values.items()))


def _write_private_evidence(directory: Path, filename: str, content: bytes) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    destination = directory / filename
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
    destination.chmod(0o600)
    return destination


def capture_current_control_pack(
    conn,
    *,
    counter_id: str,
    date_from: str,
    date_to: str,
    private_archive_dir: Path,
    code_revision: str,
    file_snapshots: Sequence[Mapping[str, Any]] = (),
) -> int:
    """Freeze the current active Abbott aggregates in an insert-only snapshot."""

    if str(counter_id) != ABBOTT_COUNTER_ID:
        raise AbbottControlError("Control capture accepts only the Abbott counter")
    try:
        start = date.fromisoformat(date_from)
        end = date.fromisoformat(date_to)
    except ValueError:
        raise AbbottControlError("Control capture dates are invalid") from None
    if end < start or not code_revision.strip():
        raise AbbottControlError("Control capture parameters are invalid")

    cursor = conn.cursor(dictionary=True)
    try:
        conn.start_transaction(
            isolation_level="REPEATABLE READ", consistent_snapshot=True
        )
        cursor.execute(
            """
            SELECT facts.analytics_scope AS scope_key,
                   COUNT(*) AS fact_rows,
                   COALESCE(SUM(facts.sessions), 0) AS sessions,
                   COALESCE(SUM(facts.users), 0) AS users,
                   COALESCE(SUM(facts.pageviews), 0) AS pageviews
            FROM canonical_fact_metrika_site_analytics_daily AS facts
            JOIN portal_active_data_releases AS active
              ON active.canonical_release_id = facts.canonical_release_id
             AND active.dataset_key = %s
            WHERE facts.counter_id = %s
              AND facts.report_date BETWEEN %s AND %s
            GROUP BY facts.analytics_scope
            ORDER BY facts.analytics_scope
            """,
            ("abbott", counter_id, date_from, date_to),
        )
        site_rows = cursor.fetchall()
        cursor.execute(
            """
            SELECT coverage.scope_key,
                   COUNT(DISTINCT coverage.report_date) AS coverage_days,
                   COALESCE(SUM(coverage.api_total_rows), 0) AS api_total_rows,
                   COALESCE(SUM(coverage.persisted_rows), 0) AS persisted_rows
            FROM canonical_source_coverage_daily AS coverage
            JOIN portal_active_data_releases AS active
              ON active.canonical_release_id = coverage.canonical_release_id
             AND active.dataset_key = %s
            WHERE coverage.counter_id = %s
              AND coverage.source_key = %s
              AND coverage.report_date BETWEEN %s AND %s
            GROUP BY coverage.scope_key
            ORDER BY coverage.scope_key
            """,
            ("abbott", counter_id, METRIKA_SOURCE_KEY, date_from, date_to),
        )
        coverage_rows = cursor.fetchall()
        controls = _control_values(site_rows, coverage_rows)
        captured_at = datetime.now(timezone.utc).isoformat()
        evidence = {
            "format_version": CONTROL_PACK_PARSER_VERSION,
            "counter_id": counter_id,
            "date_from": date_from,
            "date_to": date_to,
            "code_revision": code_revision,
            "captured_at": captured_at,
            "site_rows": site_rows,
            "coverage_rows": coverage_rows,
            "control_values": controls,
            "file_snapshots": [dict(snapshot) for snapshot in file_snapshots],
        }
        evidence_content = _stable_json_bytes(evidence) + b"\n"
        evidence_hash = hashlib.sha256(evidence_content).hexdigest()
        archive_path = _write_private_evidence(
            Path(private_archive_dir),
            f"abbott-control-{date_from}-{date_to}-{evidence_hash[:16]}.json",
            evidence_content,
        )
        manifest = {
            "format_version": CONTROL_PACK_PARSER_VERSION,
            "date_from": date_from,
            "date_to": date_to,
            "code_revision": code_revision,
            "evidence_sha256": evidence_hash,
            "control_values": controls,
            "file_snapshots": [dict(snapshot) for snapshot in file_snapshots],
        }
        snapshot_key = f"abbott-control-{evidence_hash}"
        cursor.execute(
            """
            INSERT INTO portal_dataset_snapshots (
                snapshot_key, dataset_key, source_kind, source_locator,
                content_sha256, content_bytes, source_generated_at,
                period_min_date, period_max_date, source_row_count,
                parser_version, import_status, imported_row_count,
                rejected_row_count, private_archive_locator, manifest_json
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, 'registered', 0, 0, %s, %s
            )
            """,
            (
                snapshot_key,
                "abbott",
                CONTROL_PACK_SOURCE_KIND,
                str(archive_path),
                evidence_hash,
                len(evidence_content),
                captured_at,
                date_from,
                date_to,
                len(site_rows) + len(coverage_rows),
                CONTROL_PACK_PARSER_VERSION,
                str(archive_path),
                json.dumps(manifest, sort_keys=True, separators=(",", ":")),
            ),
        )
        baseline_snapshot_id = int(cursor.lastrowid)
        conn.commit()
        return baseline_snapshot_id
    except AbbottControlError:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise AbbottControlError("Unable to freeze Abbott control baseline") from None
    finally:
        cursor.close()


def _manifest_from_row(row: Mapping[str, Any] | None) -> dict:
    if row is None:
        raise AbbottControlError("Frozen baseline was not found")
    manifest = row.get("manifest_json")
    if isinstance(manifest, str):
        try:
            manifest = json.loads(manifest)
        except json.JSONDecodeError:
            raise AbbottControlError("Frozen baseline manifest is invalid") from None
    if not isinstance(manifest, Mapping) or not isinstance(
        manifest.get("control_values"), Mapping
    ):
        raise AbbottControlError("Frozen baseline manifest is invalid")
    return dict(manifest)


def compare_release_control_pack(
    conn, *, baseline_run_id: int, candidate_release_id: int
) -> list[ControlResult]:
    """Compare a candidate to a committed baseline and persist sanitized results."""

    cursor = conn.cursor(dictionary=True)
    try:
        conn.start_transaction()
        cursor.execute(
            """
            SELECT manifest_json
            FROM portal_dataset_snapshots
            WHERE id = %s AND dataset_key = %s AND source_kind = %s
            """,
            (baseline_run_id, "abbott", CONTROL_PACK_SOURCE_KIND),
        )
        manifest = _manifest_from_row(cursor.fetchone())
        cursor.execute(
            """
            SELECT code_revision, baseline_validation_run_id
            FROM portal_data_releases
            WHERE id = %s AND dataset_key = %s
            """,
            (candidate_release_id, "abbott"),
        )
        release = cursor.fetchone()
        if release is None:
            raise AbbottControlError("Candidate release was not found")
        if int(release.get("baseline_validation_run_id") or 0) != int(
            baseline_run_id
        ):
            raise AbbottControlError(
                "Candidate release does not reference the selected baseline"
            )
        date_from = manifest.get("date_from")
        date_to = manifest.get("date_to")
        try:
            date.fromisoformat(str(date_from))
            date.fromisoformat(str(date_to))
        except ValueError:
            raise AbbottControlError("Frozen baseline period is invalid") from None
        cursor.execute(
            """
            SELECT analytics_scope AS scope_key, COUNT(*) AS fact_rows,
                   COALESCE(SUM(sessions), 0) AS sessions,
                   COALESCE(SUM(users), 0) AS users,
                   COALESCE(SUM(pageviews), 0) AS pageviews
            FROM canonical_fact_metrika_site_analytics_daily
            WHERE canonical_release_id = %s
              AND counter_id = %s
              AND report_date BETWEEN %s AND %s
            GROUP BY analytics_scope
            ORDER BY analytics_scope
            """,
            (candidate_release_id, ABBOTT_COUNTER_ID, date_from, date_to),
        )
        site_rows = cursor.fetchall()
        cursor.execute(
            """
            SELECT scope_key, COUNT(DISTINCT report_date) AS coverage_days,
                   COALESCE(SUM(api_total_rows), 0) AS api_total_rows,
                   COALESCE(SUM(persisted_rows), 0) AS persisted_rows,
                   COALESCE(SUM(
                       CASE
                         WHEN pagination_complete = 1
                          AND is_sampled = 0
                          AND (
                              collection_status = 'success'
                              OR (
                                  collection_status = 'success_empty'
                                  AND empty_reconciled = 1
                              )
                          )
                         THEN 1 ELSE 0
                       END
                   ), 0) AS reconciled_days
            FROM canonical_source_coverage_daily
            WHERE canonical_release_id = %s AND counter_id = %s
              AND source_key = %s
              AND report_date BETWEEN %s AND %s
            GROUP BY scope_key
            ORDER BY scope_key
            """,
            (
                candidate_release_id,
                ABBOTT_COUNTER_ID,
                METRIKA_SOURCE_KEY,
                date_from,
                date_to,
            ),
        )
        coverage_rows = cursor.fetchall()
        candidate_values = _control_values(site_rows, coverage_rows)
        results = []
        for control_name, expected in sorted(manifest["control_values"].items()):
            if control_name not in candidate_values:
                result = ControlResult(
                    control_name=control_name,
                    expected_value=_decimal(expected),
                    actual_value=None,
                    absolute_delta=None,
                    relative_delta=None,
                    threshold_value=API_RELATIVE_DELTA_THRESHOLD,
                    result_status="fail",
                    diagnostic={"reason_code": "candidate_control_missing"},
                )
            else:
                result = compare_numeric_control(
                    control_name,
                    expected=expected,
                    actual=candidate_values[control_name],
                    threshold=API_RELATIVE_DELTA_THRESHOLD,
                )
            results.append(result)
        expected_coverage_days = (
            date.fromisoformat(str(date_to)) - date.fromisoformat(str(date_from))
        ).days + 1
        coverage_by_scope = {str(row["scope_key"]): row for row in coverage_rows}
        for scope in ABBOTT_REQUIRED_SCOPES:
            row = coverage_by_scope.get(scope, {})
            results.append(
                compare_numeric_control(
                    f"coverage.{scope}.reconciled_days",
                    expected=expected_coverage_days,
                    actual=_numeric(row.get("reconciled_days")),
                    threshold=0,
                )
            )
        for result in results:
            cursor.execute(
                """
                INSERT INTO portal_migration_validation_runs (
                    canonical_release_id, baseline_snapshot_id,
                    candidate_snapshot_id, candidate_run_id, code_revision,
                    control_name, expected_value, actual_value,
                    absolute_delta, relative_delta, threshold_value,
                    result_status, diagnostic_json, reviewed_by, accepted_at
                ) VALUES (
                    %s, %s, NULL, NULL, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, NULL, NULL
                )
                """,
                (
                    candidate_release_id,
                    baseline_run_id,
                    release["code_revision"],
                    result.control_name,
                    result.expected_value,
                    result.actual_value,
                    result.absolute_delta,
                    result.relative_delta,
                    result.threshold_value,
                    result.result_status,
                    json.dumps(
                        result.diagnostic,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                ),
            )
        conn.commit()
        return results
    except AbbottControlError:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise AbbottControlError("Unable to compare Abbott canonical release") from None
    finally:
        cursor.close()
