"""Database-backed approval-batch construction for Abbott content decisions.

This module is deliberately independent of Google APIs.  It turns immutable
reconciliation inputs into a fully bound batch, computes the publication and
accepted-decision hashes, and persists the batch through an injected repository.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, replace
from enum import Enum
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Protocol, Sequence

from .approval_hashes import (
    ApprovalBatchItem,
    CLASSIFICATION_EVENT_KINDS,
    _canonical_json,
    _item_sort_key,
    _normalize_newlines,
    _plain,
    _sha256_json,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_classification_event_fingerprint,
    compute_item_hash,
    compute_taxonomy_digest,
)
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
    mnn: tuple[str, ...],
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
        mnn=mnn,
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
    mnn_by_entity: Mapping[int, Sequence[str]] | None = None,
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
    mnn_context = mnn_by_entity or {}
    if any(int(entity_id) <= 0 for entity_id in mnn_context):
        raise ValueError("MNN_CONTEXT_INVALID")
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
                    mnn=tuple(
                        mnn_context.get(
                            int(getattr(value, "content_entity_id", 0) or 0),
                            (),
                        )
                    ),
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
