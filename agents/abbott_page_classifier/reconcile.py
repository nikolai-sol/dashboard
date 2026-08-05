"""Pure Abbott registry precedence, anti-flip, and readiness reconciliation."""

from __future__ import annotations

from dataclasses import dataclass, replace
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
    registry2: SourceCandidate | None = None
    deterministic_proposal: Proposal | None = None
    llm_proposal: Proposal | None = None
    verifier_proposal: Proposal | None = None
    identity_conflict: bool = False
    content_available: bool = True
    rejection_code: str | None = None
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
                "access_code": variant.access_code,
                "direction_code": variant.direction_code,
                "lifecycle_code": variant.lifecycle_code,
                "material_type_code": variant.material_type_code,
                "normalized_title": variant.normalized_title,
                "normalized_url": variant.normalized_url,
                "raw_material_type": variant.raw_material_type,
                "raw_status": variant.raw_status,
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
    allow_archive_lifecycle: bool = True,
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

    source_lifecycle = source.lifecycle_code
    if source_lifecycle in {"archive_candidate", "archived"} and not allow_archive_lifecycle:
        source_lifecycle = ""
    if fill_missing and source_lifecycle and (
        not final_lifecycle or final_lifecycle == "unknown"
    ):
        if final_lifecycle != source_lifecycle:
            changed = True
        final_lifecycle = source_lifecycle

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
    allow_direction_fill: bool = True,
) -> tuple[str | None, str | None, str | None, str | None, bool]:
    changed = False
    if value.direction_code:
        if locked_direction and value.direction_code != locked_direction:
            _append_conflict(conflicts, ConflictCode.ANTI_FLIP_CONFLICT)
        elif not final_direction and allow_direction_fill:
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


def _raw_key(value: str) -> str:
    return normalize_title(value or "").casefold().replace("ё", "е")


@dataclass(frozen=True)
class _ClassificationEvidence:
    directions: frozenset[str]
    material_types: frozenset[str]
    access_codes: frozenset[str]
    lifecycle_codes: frozenset[str]
    direction_missing: bool


def _classification_evidence(value: CandidateInput | None) -> _ClassificationEvidence:
    item = _candidate(value)
    if item is None:
        return _ClassificationEvidence(
            frozenset(), frozenset(), frozenset(), frozenset(), False
        )
    if isinstance(value, SourceCandidate):
        variants = value.identity_variants
        return _ClassificationEvidence(
            directions=frozenset(
                variant.direction_code
                for variant in variants
                if variant.direction_code not in {None, "", "undetermined"}
            ),
            material_types=frozenset(
                variant.material_type_code
                for variant in variants
                if variant.material_type_code
            ),
            access_codes=frozenset(
                variant.access_code for variant in variants if variant.access_code
            ),
            lifecycle_codes=frozenset(
                variant.lifecycle_code
                for variant in variants
                if variant.lifecycle_code not in {None, "", "unknown"}
            ),
            direction_missing=not variants
            or any(
                variant.direction_code in {None, "", "undetermined"}
                for variant in variants
            ),
        )
    return _ClassificationEvidence(
        directions=frozenset(
            ()
            if item.direction_code in {None, "", "undetermined"}
            else (item.direction_code,)
        ),
        material_types=frozenset(
            () if not item.material_type_code else (item.material_type_code,)
        ),
        access_codes=frozenset(() if not item.access_code else (item.access_code,)),
        lifecycle_codes=frozenset(
            () if item.lifecycle_code in {None, "", "unknown"} else (item.lifecycle_code,)
        ),
        direction_missing=item.direction_code in {None, "", "undetermined"},
    )


def _sole_value(values: frozenset[str]) -> str | None:
    return next(iter(values)) if len(values) == 1 else None


def _candidate_from_evidence(
    source: MaterialCandidate,
    evidence: _ClassificationEvidence,
    *,
    require_direction_on_every_occurrence: bool,
) -> MaterialCandidate:
    direction = _sole_value(evidence.directions)
    if require_direction_on_every_occurrence and evidence.direction_missing:
        direction = None
    return replace(
        source,
        direction_code=direction,
        material_type_code=_sole_value(evidence.material_types),
        access_code=_sole_value(evidence.access_codes),
        lifecycle_code=_sole_value(evidence.lifecycle_codes) or "unknown",
    )


def _record_occurrence_conflicts(
    evidence: _ClassificationEvidence,
    active: CanonicalClassification | None,
    conflicts: list[ConflictCode],
) -> None:
    for values, active_value, code in (
        (
            evidence.directions,
            active.direction_code if active else None,
            ConflictCode.DIRECTION_CONFLICT,
        ),
        (
            evidence.material_types,
            active.material_type_code if active else None,
            ConflictCode.MATERIAL_TYPE_CONFLICT,
        ),
        (
            evidence.access_codes,
            active.access_code if active else None,
            ConflictCode.ACCESS_CONFLICT,
        ),
    ):
        if len(values) > 1 or (
            active_value is not None and any(item != active_value for item in values)
        ):
            _append_conflict(conflicts, code)


def _registry2_archive_evidence(
    value: SourceCandidate | None,
) -> tuple[bool, bool]:
    if value is None:
        return False, False
    item = _candidate(value)

    raw_material_types = {
        _raw_key(variant.raw_material_type)
        for variant in value.identity_variants
        if _raw_key(variant.raw_material_type)
    }
    raw_statuses = {
        _raw_key(variant.raw_status)
        for variant in value.identity_variants
        if _raw_key(variant.raw_status)
    }
    material_archive = "архив" in raw_material_types
    status_archive = "архив" in raw_statuses
    archive_requested = material_archive or status_archive
    ambiguous = (
        (material_archive and len(raw_material_types) > 1)
        or (status_archive and len(raw_statuses) > 1)
    )
    if (
        item is not None
        and item.lifecycle_code in {"archive_candidate", "archived"}
        and not status_archive
    ):
        archive_requested = True
        ambiguous = True
    return archive_requested, ambiguous


def _compare_registry_classification_evidence(
    active: CanonicalClassification | None,
    registry1: _ClassificationEvidence,
    registry2: _ClassificationEvidence,
    conflicts: list[ConflictCode],
) -> None:
    if active is None:
        return
    for active_value, registry1_values, registry2_values, code in (
        (
            active.direction_code,
            registry1.directions,
            registry2.directions,
            ConflictCode.DIRECTION_CONFLICT,
        ),
        (
            active.material_type_code,
            registry1.material_types,
            registry2.material_types,
            ConflictCode.MATERIAL_TYPE_CONFLICT,
        ),
        (
            active.access_code,
            registry1.access_codes,
            registry2.access_codes,
            ConflictCode.ACCESS_CONFLICT,
        ),
    ):
        if (
            not active_value
            and registry1_values
            and registry2_values
            and registry1_values != registry2_values
        ):
            _append_conflict(conflicts, code)


def reconcile_entity(value: ReconciliationInput) -> ApprovalItem:
    """Apply immutable-source precedence and return one deterministic review item."""

    active = value.active_canonical
    registry2_evidence_missing = value.registry2 is not None and not isinstance(
        value.registry2, SourceCandidate
    )
    registry1 = _candidate(value.registry1)
    registry2_source = (
        value.registry2 if isinstance(value.registry2, SourceCandidate) else None
    )
    registry2 = _candidate(registry2_source)
    registry1_evidence = _classification_evidence(value.registry1)
    registry2_evidence = _classification_evidence(registry2_source)
    if registry1 is not None:
        registry1 = _candidate_from_evidence(
            registry1,
            registry1_evidence,
            require_direction_on_every_occurrence=False,
        )
    if registry2 is not None:
        registry2 = _candidate_from_evidence(
            registry2,
            registry2_evidence,
            require_direction_on_every_occurrence=True,
        )
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
    registry2_direction_missing = (
        registry2 is not None and registry2_evidence.direction_missing
    )
    archive_requested, archive_evidence_ambiguous = _registry2_archive_evidence(
        registry2_source
    )
    has_archive_attestation = value.explicit_archive_override or value.http_status in {
        404,
        410,
    }
    archive_evidence_valid = (
        archive_requested
        and has_archive_attestation
        and not archive_evidence_ambiguous
    )

    if value.identity_conflict:
        _append_conflict(conflicts, ConflictCode.IDENTITY_COLLISION)
    if registry2_evidence_missing:
        _append_conflict(conflicts, ConflictCode.CONTENT_UNAVAILABLE)

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

    _record_occurrence_conflicts(registry1_evidence, active, conflicts)
    _record_occurrence_conflicts(registry2_evidence, active, conflicts)

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

    _compare_registry_classification_evidence(
        active,
        registry1_evidence,
        registry2_evidence,
        conflicts,
    )

    lifecycle_before_registry2 = final_lifecycle
    if registry2 is not None:
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
            allow_archive_lifecycle=archive_evidence_valid,
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
            allow_direction_fill=not registry2_direction_missing,
        )
        changed = changed or proposal_changed

    if value.llm_proposal is not None and value.verifier_proposal is not None:
        if _proposals_disagree(value.llm_proposal, value.verifier_proposal):
            _append_conflict(conflicts, ConflictCode.LLM_DISAGREEMENT)

    direct_archive_evidence = value.explicit_archive_override or value.http_status in {
        404,
        410,
    }
    if direct_archive_evidence and not archive_evidence_ambiguous:
        if final_lifecycle != "archive_candidate":
            changed = True
        final_lifecycle = "archive_candidate"
    if archive_requested:
        if not archive_evidence_valid:
            _append_conflict(conflicts, ConflictCode.ARCHIVE_TYPE_INVALID)
            final_lifecycle = lifecycle_before_registry2 or "active"

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
    elif registry2_evidence_missing or registry2_direction_missing:
        readiness_state = "unresolved"
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
