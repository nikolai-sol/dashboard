"""Canonical, dependency-light hashing authority for Abbott approval artifacts."""

from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from enum import Enum
import hashlib
import json
from types import MappingProxyType
from typing import Any, Iterable, Mapping

from .domain import ApprovalItem


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
        _plain(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


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
    mnn: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for field_name in (
            "current_canonical", "registry1_values", "registry2_values",
            "deterministic_result", "terra_result", "sol_result",
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
            MappingProxyType({
                str(kind): tuple(str(code) for code in codes)
                for kind, codes in self.taxonomy_terms.items()
            }),
        )
        object.__setattr__(self, "source_snapshot_ids", tuple(self.source_snapshot_ids))
        object.__setattr__(
            self, "source_snapshot_digests", tuple(self.source_snapshot_digests)
        )
        object.__setattr__(
            self,
            "mnn",
            tuple(sorted({str(value).strip() for value in self.mnn if str(value).strip()})),
        )

    @property
    def proposal_evidence(self) -> Mapping[str, object]:
        evidence = {
            "current_canonical": self.current_canonical,
            "registry1": self.registry1_values,
            "registry2": self.registry2_values,
            "deterministic": self.deterministic_result,
            "terra": self.terra_result,
            "sol": self.sol_result,
            "archive_attestation": self.archive_attestation,
            "concise_evidence": self.concise_evidence,
            "published_decision": {
                "decision_reason": self.decision_reason,
                "final_access_code": self.final_access_code,
                "final_direction_code": self.final_direction_code,
                "final_lifecycle_code": self.final_lifecycle_code,
                "final_material_type_code": self.final_material_type_code,
            },
        }
        if self.mnn:
            evidence["mnn"] = self.mnn
        return MappingProxyType(evidence)


def _item_sort_key(item: ApprovalItem) -> tuple[int, int, str]:
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
        payload.update({
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
        })
        if item.mnn:
            payload["mnn"] = item.mnn
    if include_row_hash:
        payload["row_hash"] = item.row_hash
    return payload


def compute_batch_hash(items: Iterable[ApprovalItem]) -> str:
    ordered = sorted(tuple(items), key=_item_sort_key)
    return _sha256_json([_item_payload(item, include_row_hash=True) for item in ordered])


def compute_item_hash(item: ApprovalItem) -> str:
    return _sha256_json(_item_payload(item, include_row_hash=False))


def compute_accepted_decision_hash(items: Iterable[ApprovalItem]) -> str:
    ordered = sorted(tuple(items), key=_item_sort_key)
    return _sha256_json([{
        "content_entity_id": item.content_entity_id,
        "decision_reason": item.decision_reason,
        "final_access_code": item.final_access_code,
        "final_direction_code": item.final_direction_code,
        "final_lifecycle_code": item.final_lifecycle_code,
        "final_material_type_code": item.final_material_type_code,
        "input_hash": item.input_hash,
        "readiness_state": item.readiness_state,
        "row_hash": item.row_hash,
        "selected_content_entity_id": item.selected_content_entity_id,
        "url_alias_decision": item.url_alias_decision,
    } for item in ordered])


def compute_classification_event_fingerprint(payload: Mapping[str, object]) -> str:
    if payload.get("event_kind") not in CLASSIFICATION_EVENT_KINDS:
        raise ValueError("EVENT_KIND_INVALID")
    return _sha256_json(payload)


def compute_url_alias_decision_event_fingerprint(
    *,
    accepted_decision_hash: object,
    actor: object,
    approval_batch_id: object,
    approval_item_id: object,
    decision_reason: object,
    normalized_url: object,
    selected_content_entity_id: object,
    selected_predecessor_event_fingerprint: object,
    selected_predecessor_event_id: object,
    url_alias_decision: object,
) -> str:
    """Hash the immutable URL-alias decision event payload exactly once."""
    if url_alias_decision not in {"attach", "retire", "reject", "create"}:
        raise ValueError("URL_ALIAS_DECISION_INVALID")
    if url_alias_decision in {"attach", "create"} and (
        type(selected_content_entity_id) is not int or selected_content_entity_id <= 0
    ):
        raise ValueError("URL_ALIAS_DECISION_INVALID")
    if url_alias_decision in {"retire", "reject"} and selected_content_entity_id is not None:
        raise ValueError("URL_ALIAS_DECISION_INVALID")
    return _sha256_json({
        "accepted_decision_hash": accepted_decision_hash,
        "actor": actor,
        "approval_batch_id": approval_batch_id,
        "approval_item_id": approval_item_id,
        "decision_reason": decision_reason,
        "normalized_url": normalized_url,
        "selected_content_entity_id": selected_content_entity_id,
        "selected_predecessor_event_fingerprint": selected_predecessor_event_fingerprint,
        "selected_predecessor_event_id": selected_predecessor_event_id,
        "url_alias_decision": url_alias_decision,
    })


def compute_taxonomy_digest(
    version: str, terms: Mapping[str, Iterable[str]]
) -> str:
    normalized = {
        str(kind): sorted({str(code) for code in codes})
        for kind, codes in sorted(terms.items())
    }
    return _sha256_json({"version": version, "terms": normalized})
