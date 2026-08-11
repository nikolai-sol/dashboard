"""Descriptor-safe parsing of owner-only Abbott local acceptance decisions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import stat
from typing import Any, Mapping, Optional, Sequence

from .approval_hashes import compute_batch_hash
from .batch_service import PersistedApprovalBatch


class LocalAcceptanceError(ValueError):
    """A local acceptance artifact failed a fail-closed validation gate."""


@dataclass(frozen=True)
class LocalDecision:
    input_hash: str
    row_hash: str
    final_direction_code: Optional[str]
    final_material_type_code: Optional[str]
    final_access_code: Optional[str]
    final_lifecycle_code: Optional[str]
    selected_content_entity_id: Optional[int]
    url_alias_decision: Optional[str]
    decision_reason: Optional[str]


@dataclass(frozen=True)
class LocalAcceptanceIntent:
    batch_id: int
    batch_key: str
    published_input_hash: str
    accepted_by: str
    accepted_at: datetime
    decisions: tuple[LocalDecision, ...]


_MAX_BYTES = 8 * 1024 * 1024
_TOP_LEVEL_FIELDS = frozenset((
    "schema_version", "dataset_key", "batch_id", "batch_key",
    "published_input_hash", "accepted_by", "accepted_at", "decisions",
))
_DECISION_FIELDS = frozenset((
    "input_hash", "row_hash", "final_direction_code",
    "final_material_type_code", "final_access_code", "final_lifecycle_code",
    "selected_content_entity_id", "url_alias_decision", "decision_reason",
))
_TAXONOMY_FIELDS = (
    ("final_direction_code", "direction"),
    ("final_material_type_code", "material_type"),
    ("final_access_code", "access"),
    ("final_lifecycle_code", "lifecycle"),
)


def _invalid() -> None:
    raise LocalAcceptanceError("LOCAL_DECISION_FILE_INVALID")


def _read_bounded(fd: int, maximum: int) -> str:
    chunks: list[bytes] = []
    remaining = maximum + 1
    while remaining:
        value = os.read(fd, min(65536, remaining))
        if not value:
            break
        chunks.append(value)
        remaining -= len(value)
    raw = b"".join(chunks)
    if len(raw) > maximum:
        _invalid()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        _invalid()
    raise AssertionError("unreachable")


def _under_private_root(path: Path, private_root: Path) -> bool:
    if not path.is_absolute() or not private_root.is_absolute():
        return False
    try:
        path.relative_to(private_root)
    except ValueError:
        return False
    return path != private_root


def _object(value: object) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        _invalid()
    return value


def _exact_fields(value: Mapping[str, Any], fields: frozenset[str]) -> None:
    if set(value) != fields:
        _invalid()


def _optional_text(value: object) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        _invalid()
    return value


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str) or len(value) != 20 or not value.endswith("Z"):
        _invalid()
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        _invalid()
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        _invalid()
    return parsed


def _decision(value: object, taxonomy_terms: Mapping[str, Sequence[str]]) -> LocalDecision:
    payload = _object(value)
    _exact_fields(payload, _DECISION_FIELDS)
    input_hash = payload["input_hash"]
    row_hash = payload["row_hash"]
    if not isinstance(input_hash, str) or not isinstance(row_hash, str):
        _invalid()
    mutable = {
        name: _optional_text(payload[name])
        for name, _kind in _TAXONOMY_FIELDS
    }
    for name, kind in _TAXONOMY_FIELDS:
        if mutable[name] is not None and mutable[name] not in taxonomy_terms[kind]:
            _invalid()
    selected = payload["selected_content_entity_id"]
    if selected is not None and (type(selected) is not int or selected <= 0):
        _invalid()
    return LocalDecision(
        input_hash=input_hash,
        row_hash=row_hash,
        final_direction_code=mutable["final_direction_code"],
        final_material_type_code=mutable["final_material_type_code"],
        final_access_code=mutable["final_access_code"],
        final_lifecycle_code=mutable["final_lifecycle_code"],
        selected_content_entity_id=selected,
        url_alias_decision=_optional_text(payload["url_alias_decision"]),
        decision_reason=_optional_text(payload["decision_reason"]),
    )


def _validate_intent_against_batch(
    payload: object, batch: PersistedApprovalBatch
) -> LocalAcceptanceIntent:
    document = _object(payload)
    _exact_fields(document, _TOP_LEVEL_FIELDS)
    approval_batch = batch.batch
    taxonomy_terms = getattr(approval_batch, "taxonomy_terms", None)
    required_kinds = {kind for _name, kind in _TAXONOMY_FIELDS}
    if (
        not isinstance(taxonomy_terms, Mapping)
        or set(taxonomy_terms) != required_kinds
        or any(not taxonomy_terms[kind] for kind in required_kinds)
        or compute_batch_hash(approval_batch.items) != approval_batch.published_input_hash
    ):
        _invalid()
    if (
        document["schema_version"] != 1
        or document["dataset_key"] != "abbott"
        or type(document["batch_id"]) is not int
        or document["batch_id"] != batch.database_batch_id
        or document["batch_key"] != approval_batch.batch_key
        or document["published_input_hash"] != approval_batch.published_input_hash
    ):
        _invalid()
    accepted_by = document["accepted_by"]
    if not isinstance(accepted_by, str) or not accepted_by.strip():
        _invalid()
    decisions_value = document["decisions"]
    if not isinstance(decisions_value, list):
        _invalid()
    decisions = tuple(_decision(value, taxonomy_terms) for value in decisions_value)
    expected_identity = tuple((item.input_hash, item.row_hash) for item in approval_batch.items)
    actual_identity = tuple((item.input_hash, item.row_hash) for item in decisions)
    if actual_identity != expected_identity:
        _invalid()
    return LocalAcceptanceIntent(
        batch_id=batch.database_batch_id,
        batch_key=approval_batch.batch_key,
        published_input_hash=approval_batch.published_input_hash,
        accepted_by=accepted_by,
        accepted_at=_timestamp(document["accepted_at"]),
        decisions=decisions,
    )


def read_local_acceptance_intent(
    path: Path, batch: PersistedApprovalBatch, private_root: Path
) -> LocalAcceptanceIntent:
    """Read a bounded decision file only after descriptor and batch attestation."""

    path = Path(path)
    private_root = Path(private_root)
    if not _under_private_root(path, private_root):
        _invalid()
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        _invalid()
    try:
        descriptor = os.fstat(fd)
        if (
            not stat.S_ISREG(descriptor.st_mode)
            or descriptor.st_uid != os.geteuid()
            or stat.S_IMODE(descriptor.st_mode) != 0o600
        ):
            _invalid()
        try:
            payload = json.loads(_read_bounded(fd, _MAX_BYTES))
        except (TypeError, ValueError, json.JSONDecodeError):
            _invalid()
    finally:
        os.close(fd)
    return _validate_intent_against_batch(payload, batch)
