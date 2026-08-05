#!/usr/bin/env python3
"""Offline, versioned golden-set evaluation for Abbott taxonomy proposals.

The evaluator accepts content metadata only.  It deliberately has no OpenAI,
database, Sheets, or source-network adapter; real-model evaluation is injected
by the separately authorized operator workflow.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Iterable, Mapping, Protocol, Sequence
from openpyxl import load_workbook

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    Proposal,
)
from agents.abbott_page_classifier.normalization import (
    normalize_taxonomy_label,
    normalize_title,
    normalize_url,
    sha256_text,
)


_PRIVATE_KEYS = frozenset(
    {
        "userid", "rawuserid", "visitid", "clientid", "email", "emailaddress",
        "phone", "phonenumber", "token", "oauth", "oauthtoken", "authorization",
        "accesstoken", "refreshtoken", "apikey", "metrikatoken", "userbehavior",
    }
)
_ALLOWED_RECORD_KEYS = frozenset(
    {
        "record_type", "fixture_version", "selection", "source_provenance",
        "title", "url", "slug", "access_code", "lifecycle_code", "restricted",
        "archive_candidate", "insufficient_evidence", "duplicate_group",
        "generic_academy_path", "url_derivation", "locked_direction_code", "expected_direction_code",
        "expected_material_type_code", "expected_access_code", "expected_lifecycle_code",
        "fixture_prediction",
    }
)
_OUTPUT_KEYS = frozenset(
    {"direction_code", "material_type_code", "access_code", "lifecycle_code"}
)


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _header_index(headers: Sequence[object], labels: Sequence[str]) -> int | None:
    normalized = {normalize_title(str(value or "")).casefold(): index for index, value in enumerate(headers)}
    return next((normalized[label] for label in labels if label in normalized), None)


def attest_workbook_rows(
    workbook_path: Path, rows: Iterable[tuple[str, int]]
) -> dict[str, object]:
    """Return a deterministic, nonprivate attestation for exact workbook rows.

    The payload deliberately preserves empty source fields as ``None`` rather
    than manufacturing a URL, slug, or display title for review convenience.
    """

    selections = tuple(sorted((str(sheet), int(ordinal)) for sheet, ordinal in rows))
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    entries: list[dict[str, object]] = []
    try:
        for sheet_name, ordinal in selections:
            if sheet_name not in workbook.sheetnames or ordinal < 2:
                raise ValueError("SOURCE_ROW_NOT_FOUND")
            sheet = workbook[sheet_name]
            iterator = sheet.iter_rows(values_only=True)
            headers = next(iterator, None)
            if not headers:
                raise ValueError("SOURCE_ROW_NOT_FOUND")
            row = next((value for index, value in enumerate(iterator, start=2) if index == ordinal), None)
            if row is None:
                raise ValueError("SOURCE_ROW_NOT_FOUND")
            def cell(*labels: str) -> str:
                position = _header_index(headers, labels)
                return normalize_title(str(row[position] or "")) if position is not None and position < len(row) else ""
            title = cell("название", "наименование материала")
            slug = cell("символьный код")
            raw_url = cell("ссылка", "url", "ссылка на регистрацию", "файл pdf")
            payload = {
                "sheet": sheet_name,
                "row_ordinal": ordinal,
                "title": title or None,
                "slug": slug or None,
                "url": normalize_url(raw_url).value or None,
                "direction_code": normalize_taxonomy_label("direction", cell("направление", "направления")),
                "material_type_code": normalize_taxonomy_label("material_type", cell("тип материала", "тип контента")),
                "access_code": normalize_taxonomy_label("access", cell("доступ")),
                "activity": cell("активность") or None,
            }
            entries.append({
                "payload": payload,
                "source_fingerprint": sha256_text(_canonical_json(payload)),
            })
    finally:
        workbook.close()
    return {
        "workbook_sha256": hashlib.sha256(workbook_path.read_bytes()).hexdigest(),
        "row_count": len(entries),
        "rows": entries,
    }


def source_attest_records(
    workbook_path: Path, records: Iterable[Mapping[str, object]]
) -> tuple[dict[str, object], tuple[dict[str, object], ...]]:
    """Build fixture records from exact source values and attach their evidence.

    This is the deterministic generator path used for the committed golden
    fixture. It copies only title/slug/url values observed in the workbook; an
    absent locator remains absent and is explicitly tagged insufficient.
    """

    copied = [dict(record) for record in records]
    selections: list[tuple[str, int]] = []
    for record in copied:
        provenance = record.get("source_provenance")
        if not isinstance(provenance, Mapping):
            raise ValueError("SOURCE_PROVENANCE_REQUIRED")
        selections.append((str(provenance.get("sheet", "")), int(provenance.get("row_ordinal", 0))))
    attestation = attest_workbook_rows(workbook_path, selections)
    evidence = {
        (entry["payload"]["sheet"], entry["payload"]["row_ordinal"]): entry
        for entry in attestation["rows"]
    }
    for record in copied:
        provenance = record["source_provenance"]
        entry = evidence[(str(provenance["sheet"]), int(provenance["row_ordinal"]))]
        payload = entry["payload"]
        for name in ("title", "slug"):
            if payload[name] is None:
                record.pop(name, None)
            else:
                record[name] = payload[name]
        derived_rule = record.get("url_derivation")
        if payload["url"] is not None:
            record["url"] = payload["url"]
            record.pop("url_derivation", None)
            record.pop("generic_academy_path", None)
        elif payload["slug"] is not None:
            if derived_rule not in {None, "portal_from_source_slug", "academy_from_source_slug"}:
                raise ValueError("SOURCE_URL_DERIVATION_INVALID")
            rule = derived_rule or "portal_from_source_slug"
            prefix = "/academy/" if rule == "academy_from_source_slug" else "/"
            record["url"] = f"https://abbottpro.ru{prefix}{payload['slug']}"
            record["url_derivation"] = rule
            if rule == "academy_from_source_slug":
                record["generic_academy_path"] = True
            else:
                record.pop("generic_academy_path", None)
        else:
            record.pop("url", None)
            record.pop("url_derivation", None)
            record.pop("generic_academy_path", None)
        if payload["title"] is None or (payload["url"] is None and payload["slug"] is None):
            record["insufficient_evidence"] = True
        else:
            record.pop("insufficient_evidence", None)
        record["source_provenance"] = {
            "sheet": payload["sheet"],
            "row_ordinal": payload["row_ordinal"],
            "source_fingerprint": entry["source_fingerprint"],
        }
    return attestation, tuple(copied)


class GoldenClassifier(Protocol):
    def classify(self, record: Mapping[str, object]) -> object: ...


@dataclass(frozen=True)
class EvaluationReport:
    record_count: int
    direction_total: int
    material_type_total: int
    direction_correct: int
    material_type_correct: int
    anti_flip_total: int
    anti_flip_detected: int
    taxonomy_valid: int
    schema_compliant: int
    disagreement_count: int
    unresolved_count: int

    @property
    def direction_accuracy(self) -> float:
        return self.direction_correct / self.direction_total if self.direction_total else 0.0

    @property
    def material_type_accuracy(self) -> float:
        return self.material_type_correct / self.material_type_total if self.material_type_total else 0.0

    @property
    def anti_flip_accuracy(self) -> float:
        return self.anti_flip_detected / self.anti_flip_total if self.anti_flip_total else 1.0

    @property
    def taxonomy_validity(self) -> float:
        return self.taxonomy_valid / self.record_count if self.record_count else 0.0

    @property
    def schema_compliance(self) -> float:
        return self.schema_compliant / self.record_count if self.record_count else 0.0

    @property
    def gate_passed(self) -> bool:
        return (
            self.record_count > 0
            and self.direction_accuracy >= 0.95
            and self.material_type_accuracy >= 0.95
            and self.anti_flip_accuracy == 1.0
            and self.taxonomy_validity == 1.0
            and self.schema_compliance == 1.0
        )

    def sanitized_dict(self) -> dict[str, object]:
        result = asdict(self)
        result.update(
            direction_accuracy=round(self.direction_accuracy, 6),
            material_type_accuracy=round(self.material_type_accuracy, 6),
            anti_flip_accuracy=round(self.anti_flip_accuracy, 6),
            taxonomy_validity=round(self.taxonomy_validity, 6),
            schema_compliance=round(self.schema_compliance, 6),
            gate_passed=self.gate_passed,
        )
        return result


def _contains_private_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(
            "".join(character for character in str(key).casefold() if character.isalnum()) in _PRIVATE_KEYS
            or _contains_private_key(item)
            for key, item in value.items()
        )
    if isinstance(value, (tuple, list)):
        return any(_contains_private_key(item) for item in value)
    return False


def _is_record_schema_valid(record: object) -> bool:
    if not isinstance(record, Mapping):
        return False
    if set(record) - _ALLOWED_RECORD_KEYS or _contains_private_key(record):
        return False
    required = ("expected_direction_code", "expected_material_type_code", "expected_access_code", "expected_lifecycle_code")
    if any(not isinstance(record.get(name), str) or not str(record[name]).strip() for name in required):
        return False
    insufficient = record.get("insufficient_evidence") is True
    title, url = record.get("title"), record.get("url")
    if not insufficient and (not isinstance(title, str) or not title.strip() or not isinstance(url, str) or not url.startswith(("https://", "http://"))):
        return False
    if insufficient:
        if title is not None and (not isinstance(title, str) or not title.strip()):
            return False
        if url is not None and (not isinstance(url, str) or not url.startswith(("https://", "http://"))):
            return False
    return True


def _expected_codes_are_valid(record: Mapping[str, object]) -> bool:
    checks = (
        ("expected_direction_code", DIRECTION_CODES),
        ("expected_material_type_code", MATERIAL_TYPE_CODES),
        ("expected_access_code", ACCESS_CODES),
        ("expected_lifecycle_code", LIFECYCLE_CODES),
        ("locked_direction_code", DIRECTION_CODES),
    )
    return all(record.get(name) is None or record.get(name) in allowed for name, allowed in checks)


def _prediction(value: object) -> Mapping[str, object]:
    if isinstance(value, Proposal):
        return {
            "direction_code": value.direction_code,
            "material_type_code": value.material_type_code,
            "access_code": value.access_code,
            "lifecycle_code": value.lifecycle_code,
        }
    return value if isinstance(value, Mapping) else {}


def _output_schema_valid(predicted: Mapping[str, object]) -> bool:
    return set(predicted) == _OUTPUT_KEYS and not _contains_private_key(predicted) and all(
        isinstance(predicted.get(name), str) and bool(str(predicted[name]).strip())
        for name in _OUTPUT_KEYS
    )


def _output_taxonomy_valid(predicted: Mapping[str, object]) -> bool:
    return (
        predicted.get("direction_code") in DIRECTION_CODES
        and predicted.get("material_type_code") in MATERIAL_TYPE_CODES
        and predicted.get("access_code") in ACCESS_CODES
        and predicted.get("lifecycle_code") in LIFECYCLE_CODES
    )


def evaluate_golden_set(
    records: Iterable[Mapping[str, object]], classifier: GoldenClassifier
) -> EvaluationReport:
    """Evaluate one classifier with exact, nonprivate taxonomy metrics."""

    values = tuple(records)
    direction_correct = material_type_correct = anti_flip_total = anti_flip_detected = 0
    taxonomy_valid = schema_compliant = disagreement_count = unresolved_count = 0
    direction_total = material_type_total = 0
    for record in values:
        if not _is_record_schema_valid(record):
            unresolved_count += 1
            continue
        schema_compliant += 1
        if not _expected_codes_are_valid(record):
            unresolved_count += 1
            continue
        predicted = _prediction(classifier.classify(record))
        output_schema_valid = _output_schema_valid(predicted)
        output_taxonomy_valid = _output_taxonomy_valid(predicted)
        schema_compliant += int(output_schema_valid) - 1
        taxonomy_valid += int(output_taxonomy_valid)
        direction = predicted.get("direction_code")
        material_type = predicted.get("material_type_code")
        if not output_schema_valid or not output_taxonomy_valid or direction is None or material_type is None:
            unresolved_count += 1
        expected_direction = record["expected_direction_code"]
        expected_material_type = record["expected_material_type_code"]
        direction_total += 1
        material_type_total += 1
        direction_matches = direction == expected_direction
        material_matches = material_type == expected_material_type
        direction_correct += int(direction_matches)
        material_type_correct += int(material_matches)
        disagreement_count += int(not direction_matches) + int(not material_matches)
        locked = record.get("locked_direction_code")
        if locked is not None:
            anti_flip_total += 1
            anti_flip_detected += int(direction == locked)
    return EvaluationReport(
        record_count=len(values),
        direction_total=direction_total,
        material_type_total=material_type_total,
        direction_correct=direction_correct,
        material_type_correct=material_type_correct,
        anti_flip_total=anti_flip_total,
        anti_flip_detected=anti_flip_detected,
        taxonomy_valid=taxonomy_valid,
        schema_compliant=schema_compliant,
        disagreement_count=disagreement_count,
        unresolved_count=unresolved_count,
    )


class _FixtureClassifier:
    def classify(self, record: Mapping[str, object]) -> object:
        return record.get("fixture_prediction", {
            "direction_code": record.get("expected_direction_code"),
            "material_type_code": record.get("expected_material_type_code"),
            "access_code": record.get("expected_access_code"),
            "lifecycle_code": record.get("expected_lifecycle_code"),
        })


def load_fixture(path: Path) -> tuple[Mapping[str, object], ...]:
    """Load JSONL records, retaining only reviewed evaluation entries."""

    records: list[Mapping[str, object]] = []
    metadata: Mapping[str, object] | None = None
    with path.open(encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            value = json.loads(line)
            if isinstance(value, Mapping) and value.get("record_type") == "metadata":
                if metadata is not None or records or _contains_private_key(value):
                    raise ValueError("FIXTURE_METADATA_INVALID")
                if value.get("fixture_version") != "golden.v1" or not isinstance(value.get("selection"), str):
                    raise ValueError("FIXTURE_METADATA_INVALID")
                metadata = value
                continue
            if not isinstance(value, Mapping):
                raise ValueError("FIXTURE_RECORD_INVALID")
            records.append(value)
    if metadata is None:
        raise ValueError("FIXTURE_METADATA_MISSING")
    return tuple(records)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run an offline Abbott golden evaluation")
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--classifier", choices=("fixture",), required=True)
    args = parser.parse_args(argv)
    try:
        report = evaluate_golden_set(load_fixture(Path(args.fixture)), _FixtureClassifier())
    except (OSError, ValueError, json.JSONDecodeError):
        print(json.dumps({"status": "fixture_error"}, sort_keys=True))
        return 2
    print(json.dumps(report.sanitized_dict(), sort_keys=True))
    return 0 if report.gate_passed else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
