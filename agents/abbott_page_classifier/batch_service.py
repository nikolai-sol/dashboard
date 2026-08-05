"""Database-backed approval-batch construction for Abbott content decisions.

This module is deliberately independent of Google APIs.  It turns immutable
reconciliation inputs into a fully bound batch, computes the publication and
accepted-decision hashes, and persists the batch through an injected repository.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass, replace
from enum import Enum
import hashlib
import json
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Protocol, Sequence

from .domain import (
    AcceptedBatchSnapshot,
    ApprovalBatch,
    ApprovalItem,
    IngestResult,
    TaxonomyVersion,
)
from .reconcile import ReconciliationInput, reconcile_entity


class BatchRepository(Protocol):
    """Small persistence surface needed before a Sheet projection may be written."""

    def persist_draft_batch(self, batch: ApprovalBatch) -> int: ...


class AcceptedBatchRepository(Protocol):
    """Canonical persistence boundary for an already accepted batch."""

    def ingest_accepted_snapshot(
        self, snapshot: AcceptedBatchSnapshot
    ) -> IngestResult: ...


CLASSIFICATION_EVENT_KINDS = (
    "baseline",
    "approve",
    "correct",
    "reject",
    "revoke",
)


def _normalize_newlines(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n")


def _plain(value: Any) -> Any:
    """Return a deterministic JSON value with normalized text and stable maps."""

    if isinstance(value, Enum):
        return _plain(value.value)
    if hasattr(value, "model_dump"):
        return _plain(value.model_dump(mode="json"))
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: _plain(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_plain(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted((_plain(item) for item in value), key=_canonical_json)
    if isinstance(value, str):
        return _normalize_newlines(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    raise TypeError("BATCH_VALUE_NOT_SERIALIZABLE")


def _canonical_json(value: Any) -> str:
    return json.dumps(
        _plain(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def compute_classification_event_fingerprint(
    payload: Mapping[str, object],
) -> str:
    """Hash one complete normalized append-only event payload."""

    if payload.get("event_kind") not in CLASSIFICATION_EVENT_KINDS:
        raise ValueError("EVENT_KIND_INVALID")
    return _sha256_json(payload)


def compute_taxonomy_digest(
    version: str, terms: Mapping[str, Sequence[str]]
) -> str:
    normalized = {
        str(kind): tuple(sorted(set(str(code) for code in codes)))
        for kind, codes in terms.items()
    }
    return _sha256_json({"version": version, "terms": normalized})


def _freeze(value: Any) -> Any:
    value = _plain(value)
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


@dataclass(frozen=True)
class ApprovalBatchItem(ApprovalItem):
    """Approval item enriched with every immutable proposal input and result."""

    current_canonical: Mapping[str, object] | None = None
    registry1_values: Mapping[str, object] | None = None
    registry2_values: Mapping[str, object] | None = None
    deterministic_result: Mapping[str, object] | None = None
    terra_result: Mapping[str, object] | None = None
    sol_result: Mapping[str, object] | None = None
    archive_attestation: Mapping[str, object] | None = None
    concise_evidence: tuple[str, ...] = ()
    taxonomy_digest: str = ""
    taxonomy_terms: Mapping[str, tuple[str, ...]] = field(
        default_factory=lambda: MappingProxyType({})
    )
    source_snapshot_ids: tuple[int, ...] = ()
    source_snapshot_digests: tuple[str, ...] = ()
    model_routing_version: str = ""
    prompt_version: str = ""

    def __post_init__(self) -> None:
        for field_name in (
            "current_canonical",
            "registry1_values",
            "registry2_values",
            "deterministic_result",
            "terra_result",
            "sol_result",
            "archive_attestation",
        ):
            value = getattr(self, field_name)
            object.__setattr__(self, field_name, None if value is None else _freeze(value))
        object.__setattr__(
            self,
            "concise_evidence",
            tuple(_normalize_newlines(str(item)) for item in self.concise_evidence),
        )
        object.__setattr__(
            self,
            "taxonomy_terms",
            MappingProxyType(
                {
                    str(kind): tuple(str(code) for code in codes)
                    for kind, codes in self.taxonomy_terms.items()
                }
            ),
        )
        object.__setattr__(self, "source_snapshot_ids", tuple(self.source_snapshot_ids))
        object.__setattr__(
            self, "source_snapshot_digests", tuple(self.source_snapshot_digests)
        )

    @property
    def proposal_evidence(self) -> Mapping[str, object]:
        """Complete JSON-safe payload for canonical approval-item persistence."""

        return MappingProxyType(
            {
                "current_canonical": self.current_canonical,
                "registry1": self.registry1_values,
                "registry2": self.registry2_values,
                "deterministic": self.deterministic_result,
                "terra": self.terra_result,
                "sol": self.sol_result,
                "archive_attestation": self.archive_attestation,
                "concise_evidence": self.concise_evidence,
            }
        )


@dataclass(frozen=True)
class BuiltApprovalBatch(ApprovalBatch):
    """Approval batch retaining the exact taxonomy terms used by its projection."""

    taxonomy_terms: Mapping[str, tuple[str, ...]] = field(
        default_factory=lambda: MappingProxyType({})
    )
    taxonomy_digest: str = ""
    source_snapshot_ids: tuple[int, ...] = ()
    source_snapshot_digests: tuple[str, ...] = ()
    model_routing_version: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "taxonomy_terms",
            MappingProxyType(
                {
                    str(kind): tuple(str(code) for code in codes)
                    for kind, codes in self.taxonomy_terms.items()
                }
            ),
        )
        object.__setattr__(self, "source_snapshot_ids", tuple(self.source_snapshot_ids))
        object.__setattr__(
            self, "source_snapshot_digests", tuple(self.source_snapshot_digests)
        )


@dataclass(frozen=True)
class PersistedApprovalBatch:
    """Receipt proving the canonical batch and all items were stored."""

    batch: ApprovalBatch
    database_batch_id: int


def _item_sort_key(item: ApprovalItem) -> tuple[int, int, str]:
    # MySQL orders NULL before positive entity IDs; mirror that canonical ordering.
    # Unresolved identities then use their immutable input hash as the tie-breaker.
    entity_id = item.content_entity_id
    return (0 if entity_id is None else 1, entity_id or 0, item.input_hash)


def _item_payload(item: ApprovalItem, *, include_row_hash: bool) -> dict[str, object]:
    payload: dict[str, object] = {
        "conflict_codes": [
            code.value if isinstance(code, Enum) else str(code)
            for code in item.conflict_codes
        ],
        "content_entity_id": item.content_entity_id,
        "decision_reason": item.decision_reason,
        "final_access_code": item.final_access_code,
        "final_direction_code": item.final_direction_code,
        "final_lifecycle_code": item.final_lifecycle_code,
        "final_material_type_code": item.final_material_type_code,
        "input_hash": item.input_hash,
        "readiness_state": item.readiness_state,
        "title": item.title,
        "url": item.url,
    }
    if isinstance(item, ApprovalBatchItem):
        payload.update(
            {
                "concise_evidence": list(item.concise_evidence),
                "current_canonical": item.current_canonical,
                "deterministic_result": item.deterministic_result,
                "registry1_values": item.registry1_values,
                "registry2_values": item.registry2_values,
                "sol_result": item.sol_result,
                "terra_result": item.terra_result,
                "archive_attestation": item.archive_attestation,
                "taxonomy_digest": item.taxonomy_digest,
                "taxonomy_terms": item.taxonomy_terms,
                "source_snapshot_ids": item.source_snapshot_ids,
                "source_snapshot_digests": item.source_snapshot_digests,
                "model_routing_version": item.model_routing_version,
                "prompt_version": item.prompt_version,
            }
        )
    if include_row_hash:
        payload["row_hash"] = item.row_hash
    return payload


def compute_batch_hash(items: Iterable[ApprovalItem]) -> str:
    """Hash every immutable and initial-decision field in deterministic row order."""

    ordered = sorted(tuple(items), key=_item_sort_key)
    return _sha256_json([_item_payload(item, include_row_hash=True) for item in ordered])


def compute_item_hash(item: ApprovalItem) -> str:
    """Hash one item's complete immutable/publication payload except its own hash."""

    return _sha256_json(_item_payload(item, include_row_hash=False))


def compute_accepted_decision_hash(items: Iterable[ApprovalItem]) -> str:
    """Hash only row identities and editable decisions, independent of Sheet UI."""

    ordered = sorted(tuple(items), key=_item_sort_key)
    decisions = [
        {
            "content_entity_id": item.content_entity_id,
            "decision_reason": item.decision_reason,
            "final_access_code": item.final_access_code,
            "final_direction_code": item.final_direction_code,
            "final_lifecycle_code": item.final_lifecycle_code,
            "final_material_type_code": item.final_material_type_code,
            "input_hash": item.input_hash,
            "readiness_state": item.readiness_state,
            "row_hash": item.row_hash,
        }
        for item in ordered
    ]
    return _sha256_json(decisions)


def _proposal_payload(value: object | None) -> Mapping[str, object] | None:
    if value is None:
        return None
    plain = _plain(value)
    if not isinstance(plain, dict):
        raise TypeError("BATCH_PROPOSAL_NOT_OBJECT")
    return plain


def _source_payload(value: object | None) -> Mapping[str, object] | None:
    if value is None:
        return None
    plain = _plain(value)
    if not isinstance(plain, dict):
        raise TypeError("BATCH_SOURCE_NOT_OBJECT")
    return plain


def _concise_evidence(value: ReconciliationInput) -> tuple[str, ...]:
    evidence: list[str] = []
    for proposal in (
        value.deterministic_proposal,
        value.llm_proposal,
        value.verifier_proposal,
    ):
        if proposal is None:
            continue
        evidence.append(proposal.rule_code)
        evidence.extend(proposal.evidence)
    if value.identity_conflict:
        evidence.append("IDENTITY_COLLISION")
    if not value.content_available:
        evidence.append("CONTENT_UNAVAILABLE")
    if value.explicit_archive_override:
        evidence.append("EXPLICIT_ARCHIVE_OVERRIDE")
    if value.http_status is not None:
        evidence.append(f"HTTP_{value.http_status}")
    result: list[str] = []
    for item in evidence:
        normalized = _normalize_newlines(str(item)).strip()
        if normalized and normalized not in result:
            result.append(normalized[:500])
    return tuple(result[:20])


def _enrich(
    value: ReconciliationInput | ApprovalItem,
    *,
    taxonomy_digest: str,
    taxonomy_terms: Mapping[str, tuple[str, ...]],
    source_snapshot_ids: tuple[int, ...],
    source_snapshot_digests: tuple[str, ...],
    model_routing_version: str,
    prompt_version: str,
) -> ApprovalBatchItem:
    if isinstance(value, ReconciliationInput):
        item = reconcile_entity(value)
        current = _source_payload(value.active_canonical)
        registry1 = _source_payload(value.registry1)
        registry2 = _source_payload(value.registry2)
        deterministic = _proposal_payload(value.deterministic_proposal)
        terra = _proposal_payload(value.llm_proposal)
        sol = _proposal_payload(value.verifier_proposal)
        archive_attestation = {
            "evidence_code": (
                f"HTTP_{value.http_status}" if value.http_status is not None else None
            ),
            "explicit_archive_override": value.explicit_archive_override,
        }
        evidence = _concise_evidence(value)
    elif isinstance(value, ApprovalBatchItem):
        item = value
        current = item.current_canonical
        registry1 = item.registry1_values
        registry2 = item.registry2_values
        deterministic = item.deterministic_result
        terra = item.terra_result
        sol = item.sol_result
        archive_attestation = item.archive_attestation
        evidence = item.concise_evidence
    elif isinstance(value, ApprovalItem):
        item = value
        current = registry1 = registry2 = deterministic = terra = sol = None
        archive_attestation = None
        evidence = tuple(
            code.value if isinstance(code, Enum) else str(code)
            for code in item.conflict_codes
        )
    else:
        raise TypeError("BATCH_INPUT_NOT_SUPPORTED")

    base_values = {
        field.name: getattr(item, field.name) for field in fields(ApprovalItem)
    }
    base_values["row_hash"] = ""
    enriched = ApprovalBatchItem(
        **base_values,
        current_canonical=current,
        registry1_values=registry1,
        registry2_values=registry2,
        deterministic_result=deterministic,
        terra_result=terra,
        sol_result=sol,
        archive_attestation=archive_attestation,
        concise_evidence=evidence,
        taxonomy_digest=taxonomy_digest,
        taxonomy_terms=taxonomy_terms,
        source_snapshot_ids=source_snapshot_ids,
        source_snapshot_digests=source_snapshot_digests,
        model_routing_version=model_routing_version,
        prompt_version=prompt_version,
    )
    return replace(
        enriched,
        row_hash=compute_item_hash(enriched),
    )


def _taxonomy_contract(
    taxonomy_version: TaxonomyVersion | str,
) -> tuple[str, Mapping[str, tuple[str, ...]]]:
    if isinstance(taxonomy_version, TaxonomyVersion):
        return taxonomy_version.version, taxonomy_version.terms
    if isinstance(taxonomy_version, str) and taxonomy_version.strip():
        return taxonomy_version, MappingProxyType({})
    raise ValueError("TAXONOMY_VERSION_REQUIRED")


def build_batch(
    inputs: Iterable[ReconciliationInput | ApprovalItem],
    taxonomy_version: TaxonomyVersion | str,
    prompt_version: str,
    *,
    source_snapshot_ids: Sequence[int],
    source_snapshot_digests: Sequence[str],
    model_routing_version: str,
) -> BuiltApprovalBatch:
    """Build one immutable, deterministic batch from canonical reconciliation data."""

    version, terms = _taxonomy_contract(taxonomy_version)
    if not isinstance(prompt_version, str) or not prompt_version.strip():
        raise ValueError("PROMPT_VERSION_REQUIRED")
    required_kinds = ("direction", "material_type", "access", "lifecycle")
    if set(terms) != set(required_kinds) or any(not terms[kind] for kind in required_kinds):
        raise ValueError("TAXONOMY_TERMS_INCOMPLETE")
    normalized_terms = MappingProxyType(
        {kind: tuple(sorted(set(terms[kind]))) for kind in required_kinds}
    )
    taxonomy_digest = compute_taxonomy_digest(version, normalized_terms)
    supplied_digest = taxonomy_version.digest if isinstance(taxonomy_version, TaxonomyVersion) else ""
    if not supplied_digest:
        raise ValueError("TAXONOMY_DIGEST_REQUIRED")
    if supplied_digest and supplied_digest != taxonomy_digest:
        raise ValueError("TAXONOMY_DIGEST_MISMATCH")
    snapshot_ids = tuple(int(value) for value in source_snapshot_ids)
    snapshot_digests = tuple(str(value).lower() for value in source_snapshot_digests)
    if (
        not snapshot_ids
        or len(snapshot_ids) != len(snapshot_digests)
        or len(set(snapshot_ids)) != len(snapshot_ids)
        or any(value <= 0 for value in snapshot_ids)
        or any(
            len(value) != 64
            or any(character not in "0123456789abcdef" for character in value.lower())
            for value in snapshot_digests
        )
    ):
        raise ValueError("SOURCE_SNAPSHOTS_REQUIRED")
    if not isinstance(model_routing_version, str) or not model_routing_version.strip():
        raise ValueError("MODEL_ROUTING_VERSION_REQUIRED")
    items = tuple(
        sorted(
            (
                _enrich(
                    value,
                    taxonomy_digest=taxonomy_digest,
                    taxonomy_terms=normalized_terms,
                    source_snapshot_ids=snapshot_ids,
                    source_snapshot_digests=snapshot_digests,
                    model_routing_version=model_routing_version,
                    prompt_version=prompt_version,
                )
                for value in inputs
            ),
            key=_item_sort_key,
        )
    )
    identities = [(item.content_entity_id, item.input_hash) for item in items]
    row_hashes = [item.row_hash for item in items]
    if len(set(identities)) != len(identities) or len(set(row_hashes)) != len(row_hashes):
        raise ValueError("DUPLICATE_BATCH_ITEM")

    published_hash = compute_batch_hash(items)
    key_hash = _sha256_json(
        {
            "prompt_version": prompt_version,
            "published_input_hash": published_hash,
            "taxonomy_version": version,
            "taxonomy_digest": taxonomy_digest,
            "source_snapshot_ids": snapshot_ids,
            "source_snapshot_digests": snapshot_digests,
            "model_routing_version": model_routing_version,
        }
    )
    return BuiltApprovalBatch(
        batch_key=f"abbott-{key_hash[:24]}",
        taxonomy_version=version,
        published_input_hash=published_hash,
        items=items,
        prompt_version=prompt_version,
        taxonomy_terms=normalized_terms,
        taxonomy_digest=taxonomy_digest,
        source_snapshot_ids=snapshot_ids,
        source_snapshot_digests=snapshot_digests,
        model_routing_version=model_routing_version,
    )


def persist_batch(
    batch: ApprovalBatch, repository: BatchRepository
) -> PersistedApprovalBatch:
    """Persist the canonical batch and all items before returning a projection receipt."""

    if compute_batch_hash(batch.items) != batch.published_input_hash:
        raise ValueError("BATCH_HASH_MISMATCH")
    batch_id = repository.persist_draft_batch(batch)
    return PersistedApprovalBatch(batch=batch, database_batch_id=int(batch_id))


def ingest_accepted_batch(
    snapshot: AcceptedBatchSnapshot,
    repository: AcceptedBatchRepository,
) -> IngestResult:
    """Ingest only through the repository's locked canonical acceptance state."""

    return repository.ingest_accepted_snapshot(snapshot)
