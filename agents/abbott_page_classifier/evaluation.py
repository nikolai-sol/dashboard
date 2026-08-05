#!/usr/bin/env python3
"""Offline, versioned golden-set evaluation for Abbott taxonomy proposals.

The evaluator accepts content metadata only.  It deliberately has no OpenAI,
database, Sheets, or source-network adapter; real-model evaluation is injected
by the separately authorized operator workflow.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import sys
from typing import Any, Iterable, Mapping, Protocol, Sequence

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    Proposal,
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
        "generic_academy_path", "locked_direction_code", "expected_direction_code",
        "expected_material_type_code", "expected_access_code", "expected_lifecycle_code",
        "fixture_prediction",
    }
)


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
    required = ("title", "url", "expected_direction_code", "expected_material_type_code")
    if any(not isinstance(record.get(name), str) or not str(record[name]).strip() for name in required):
        return False
    if not str(record["url"]).startswith(("https://", "http://")):
        return False
    return True


def _codes_are_valid(record: Mapping[str, object]) -> bool:
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
        if not _codes_are_valid(record):
            unresolved_count += 1
            continue
        taxonomy_valid += 1
        predicted = _prediction(classifier.classify(record))
        direction = predicted.get("direction_code")
        material_type = predicted.get("material_type_code")
        if direction is None or material_type is None:
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
