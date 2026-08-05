"""Pure Abbott registry precedence, anti-flip, and readiness reconciliation."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Union

from .domain import (
    ApprovalItem,
    CanonicalClassification,
    ConflictCode,
    MaterialCandidate,
    Proposal,
)
from .normalization import normalize_title, normalize_url, sha256_text
from .sources import SourceCandidate


CandidateInput = Union[MaterialCandidate, SourceCandidate]


@dataclass(frozen=True)
class ReconciliationInput:
    """All immutable evidence used to reconcile one resolved material entity."""

    content_entity_id: int | None = None
    active_canonical: CanonicalClassification | None = None
    reviewed_correction: Proposal | None = None
    registry1: CandidateInput | None = None
    registry2: CandidateInput | None = None
    deterministic_proposal: Proposal | None = None
    llm_proposal: Proposal | None = None
    verifier_proposal: Proposal | None = None
    identity_conflict: bool = False
    content_available: bool = True
    rejection_code: str | None = None
    registry2_material_type_raw: str | None = None
    explicit_archive_override: bool = False
    http_status: int | None = None


def _candidate(value: CandidateInput | None) -> MaterialCandidate | None:
    if value is None:
        return None
    return value.candidate if isinstance(value, SourceCandidate) else value


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _proposal_payload(value: Proposal | None) -> dict[str, object] | None:
    if value is None:
        return None
    return {
        "access_code": value.access_code,
        "confidence": value.confidence,
        "direction_code": value.direction_code,
        "evidence": list(value.evidence),
        "lifecycle_code": value.lifecycle_code,
        "material_type_code": value.material_type_code,
        "rule_code": value.rule_code,
    }


def _candidate_payload(value: CandidateInput | None) -> dict[str, object] | None:
    item = _candidate(value)
    if item is None:
        return None
    payload: dict[str, object] = {
        "access_code": item.access_code,
        "direction_code": item.direction_code,
        "lifecycle_code": item.lifecycle_code,
        "material_type_code": item.material_type_code,
        "source_fingerprint": item.source_fingerprint,
        "source_name": item.source_name,
        "source_row_id": item.source_row_id,
        "title": item.title,
        "url": item.url,
    }
    if isinstance(value, SourceCandidate):
        payload["key"] = value.key
        payload["provenance"] = [
            {
                "source_fingerprint": entry.source_fingerprint,
                "source_name": entry.source_name,
                "source_row_id": entry.source_row_id,
            }
            for entry in value.provenance
        ]
        payload["identity_variants"] = [
            {
                "material_id": variant.material_id,
                "material_type_code": variant.material_type_code,
                "normalized_title": variant.normalized_title,
                "normalized_url": variant.normalized_url,
                "source_row_id": variant.source_row_id,
            }
            for variant in value.identity_variants
        ]
    return payload


def _input_hash(value: ReconciliationInput) -> str:
    active = value.active_canonical
    payload = {
        "active_canonical": (
            {
                "access_code": active.access_code,
                "content_entity_id": active.content_entity_id,
                "direction_code": active.direction_code,
                "event_id": active.event_id,
                "lifecycle_code": active.lifecycle_code,
                "material_type_code": active.material_type_code,
                "title": active.title,
                "url": active.url,
            }
            if active is not None
            else None
        ),
        "content_available": value.content_available,
        "content_entity_id": value.content_entity_id,
        "deterministic_proposal": _proposal_payload(value.deterministic_proposal),
        "explicit_archive_override": value.explicit_archive_override,
        "http_status": value.http_status,
        "identity_conflict": value.identity_conflict,
        "llm_proposal": _proposal_payload(value.llm_proposal),
        "registry1": _candidate_payload(value.registry1),
        "registry2": _candidate_payload(value.registry2),
        "registry2_material_type_raw": normalize_title(
            value.registry2_material_type_raw or ""
        ),
        "rejection_code": value.rejection_code,
        "reviewed_correction": _proposal_payload(value.reviewed_correction),
        "verifier_proposal": _proposal_payload(value.verifier_proposal),
    }
    return sha256_text(_canonical_json(payload))


def _append_conflict(conflicts: list[ConflictCode], code: ConflictCode) -> None:
    if code not in conflicts:
        conflicts.append(code)


def _source_classification(
    source: MaterialCandidate,
    *,
    fill_missing: bool,
    final_direction: str | None,
    final_material_type: str | None,
    final_access: str | None,
    final_lifecycle: str | None,
    conflicts: list[ConflictCode],
) -> tuple[str | None, str | None, str | None, str | None, bool]:
    changed = False
    values: list[str | None] = [
        final_direction,
        final_material_type,
        final_access,
    ]
    incoming = [
        source.direction_code,
        source.material_type_code,
        source.access_code,
    ]
    codes = [
        ConflictCode.DIRECTION_CONFLICT,
        ConflictCode.MATERIAL_TYPE_CONFLICT,
        ConflictCode.ACCESS_CONFLICT,
    ]
    for index, incoming_value in enumerate(incoming):
        if not incoming_value:
            continue
        if values[index] and values[index] != incoming_value:
            _append_conflict(conflicts, codes[index])
        elif not values[index] and fill_missing:
            values[index] = incoming_value
            changed = True

    if fill_missing and source.lifecycle_code and (
        not final_lifecycle or final_lifecycle == "unknown"
    ):
        if final_lifecycle != source.lifecycle_code:
            changed = True
        final_lifecycle = source.lifecycle_code

    return values[0], values[1], values[2], final_lifecycle, changed


def _apply_proposal(
    value: Proposal,
    *,
    final_direction: str | None,
    final_material_type: str | None,
    final_access: str | None,
    final_lifecycle: str | None,
    locked_direction: str | None,
    locked_material_type: str | None,
    locked_access: str | None,
    conflicts: list[ConflictCode],
) -> tuple[str | None, str | None, str | None, str | None, bool]:
    changed = False
    if value.direction_code:
        if locked_direction and value.direction_code != locked_direction:
            _append_conflict(conflicts, ConflictCode.ANTI_FLIP_CONFLICT)
        elif not final_direction:
            final_direction = value.direction_code
            changed = True

    if value.material_type_code:
        if locked_material_type and value.material_type_code != locked_material_type:
            _append_conflict(conflicts, ConflictCode.MATERIAL_TYPE_CONFLICT)
        elif not final_material_type:
            final_material_type = value.material_type_code
            changed = True

    if value.access_code:
        if locked_access and value.access_code != locked_access:
            _append_conflict(conflicts, ConflictCode.ACCESS_CONFLICT)
        elif not final_access:
            final_access = value.access_code
            changed = True

    if value.lifecycle_code and (
        not final_lifecycle or final_lifecycle == "unknown"
    ):
        if final_lifecycle != value.lifecycle_code:
            changed = True
        final_lifecycle = value.lifecycle_code

    return (
        final_direction,
        final_material_type,
        final_access,
        final_lifecycle,
        changed,
    )


def _proposals_disagree(primary: Proposal, verifier: Proposal) -> bool:
    return any(
        primary_value
        and verifier_value
        and primary_value != verifier_value
        for primary_value, verifier_value in (
            (primary.direction_code, verifier.direction_code),
            (primary.material_type_code, verifier.material_type_code),
            (primary.access_code, verifier.access_code),
            (primary.lifecycle_code, verifier.lifecycle_code),
        )
    )


def reconcile_entity(value: ReconciliationInput) -> ApprovalItem:
    """Apply immutable-source precedence and return one deterministic review item."""

    active = value.active_canonical
    registry1 = _candidate(value.registry1)
    registry2 = _candidate(value.registry2)
    content_entity_id = (
        active.content_entity_id if active is not None else value.content_entity_id
    )
    title = normalize_title(active.title if active is not None else "")
    url = normalize_url(active.url if active is not None else "").value
    final_direction = active.direction_code if active is not None else None
    final_material_type = active.material_type_code if active is not None else None
    final_access = active.access_code if active is not None else None
    final_lifecycle = active.lifecycle_code if active is not None else None
    conflicts: list[ConflictCode] = []
    changed = False

    if value.identity_conflict:
        _append_conflict(conflicts, ConflictCode.IDENTITY_COLLISION)

    correction = value.reviewed_correction
    if correction is not None:
        for current, replacement in (
            (final_direction, correction.direction_code),
            (final_material_type, correction.material_type_code),
            (final_access, correction.access_code),
            (final_lifecycle, correction.lifecycle_code),
        ):
            if replacement and replacement != current:
                changed = True
        final_direction = correction.direction_code or final_direction
        final_material_type = correction.material_type_code or final_material_type
        final_access = correction.access_code or final_access
        final_lifecycle = correction.lifecycle_code or final_lifecycle

    locked_direction = final_direction
    locked_material_type = final_material_type
    locked_access = final_access

    if registry1 is not None:
        if not title and registry1.title:
            title = normalize_title(registry1.title)
            changed = True
        if not url and registry1.url:
            url = normalize_url(registry1.url).value
            changed = True
        (
            final_direction,
            final_material_type,
            final_access,
            final_lifecycle,
            source_changed,
        ) = _source_classification(
            registry1,
            fill_missing=active is None,
            final_direction=final_direction,
            final_material_type=final_material_type,
            final_access=final_access,
            final_lifecycle=final_lifecycle,
            conflicts=conflicts,
        )
        changed = changed or source_changed

    if registry2 is not None:
        if not title and registry2.title:
            title = normalize_title(registry2.title)
            changed = True
        if not url and registry2.url:
            url = normalize_url(registry2.url).value
            changed = True
        (
            final_direction,
            final_material_type,
            final_access,
            final_lifecycle,
            source_changed,
        ) = _source_classification(
            registry2,
            fill_missing=True,
            final_direction=final_direction,
            final_material_type=final_material_type,
            final_access=final_access,
            final_lifecycle=final_lifecycle,
            conflicts=conflicts,
        )
        changed = changed or source_changed

    for proposal_value in (
        value.deterministic_proposal,
        value.llm_proposal,
    ):
        if proposal_value is None:
            continue
        (
            final_direction,
            final_material_type,
            final_access,
            final_lifecycle,
            proposal_changed,
        ) = _apply_proposal(
            proposal_value,
            final_direction=final_direction,
            final_material_type=final_material_type,
            final_access=final_access,
            final_lifecycle=final_lifecycle,
            locked_direction=locked_direction,
            locked_material_type=locked_material_type,
            locked_access=locked_access,
            conflicts=conflicts,
        )
        changed = changed or proposal_changed

    if value.llm_proposal is not None and value.verifier_proposal is not None:
        if _proposals_disagree(value.llm_proposal, value.verifier_proposal):
            _append_conflict(conflicts, ConflictCode.LLM_DISAGREEMENT)

    archive_requested = (
        normalize_title(value.registry2_material_type_raw or "")
        .casefold()
        .replace("ё", "е")
        == "архив"
    )
    has_archive_evidence = value.explicit_archive_override or value.http_status in {
        404,
        410,
    }
    if value.explicit_archive_override or value.http_status in {404, 410}:
        if final_lifecycle != "archive_candidate":
            changed = True
        final_lifecycle = "archive_candidate"
    if archive_requested:
        if has_archive_evidence:
            if final_lifecycle != "archive_candidate":
                changed = True
            final_lifecycle = "archive_candidate"
        else:
            _append_conflict(conflicts, ConflictCode.ARCHIVE_TYPE_INVALID)

    if final_access is None:
        final_access = "unspecified"
        if active is None:
            changed = True
    if final_lifecycle is None:
        final_lifecycle = "unknown"
        if active is None:
            changed = True

    if not value.content_available:
        _append_conflict(conflicts, ConflictCode.CONTENT_UNAVAILABLE)

    hard_conflicts = tuple(
        code for code in conflicts if code is not ConflictCode.CONTENT_UNAVAILABLE
    )
    classification_incomplete = (
        final_direction in {None, "undetermined"} or not final_material_type
    )
    if value.rejection_code:
        readiness_state = "rejected"
    elif hard_conflicts:
        readiness_state = "conflict"
    elif not value.content_available or classification_incomplete:
        readiness_state = "unresolved"
    elif active is not None and not changed:
        readiness_state = "no_change"
    else:
        readiness_state = "ready"

    input_hash = _input_hash(value)
    output_payload = {
        "conflict_codes": [code.value for code in conflicts],
        "content_entity_id": content_entity_id,
        "final_access_code": final_access,
        "final_direction_code": final_direction,
        "final_lifecycle_code": final_lifecycle,
        "final_material_type_code": final_material_type,
        "input_hash": input_hash,
        "readiness_state": readiness_state,
        "title": title,
        "url": url,
    }
    return ApprovalItem(
        content_entity_id=content_entity_id,
        input_hash=input_hash,
        title=title,
        url=url,
        final_direction_code=final_direction,
        final_material_type_code=final_material_type,
        final_access_code=final_access,
        final_lifecycle_code=final_lifecycle,
        readiness_state=readiness_state,  # type: ignore[arg-type]
        conflict_codes=tuple(conflicts),
        row_hash=sha256_text(_canonical_json(output_payload)),
        decision_reason=value.rejection_code,
    )
