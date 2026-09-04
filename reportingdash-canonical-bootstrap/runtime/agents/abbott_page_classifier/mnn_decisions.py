"""Optional, immutable Abbott MNN review decisions.

MNN is a secondary classification dimension.  Exact proposals are allowed only
from reviewed workbook claims already bound to one canonical entity and one
query-free Abbott URL.  Human decisions may remain blank and never invoke an
external API or a fuzzy/LLM guess.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Literal, Mapping, Sequence

from .mnn import NormalizedMnn, normalize_mnn_label
from .normalization import normalize_observed_page_grouping_url, normalize_url


_HEX = frozenset("0123456789abcdef")


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _sha256(value: object) -> str:
    text = str(value or "").lower()
    if len(text) != 64 or any(character not in _HEX for character in text):
        raise ValueError("MNN_PROPOSAL_AUTHORITY_INVALID")
    return text


def _reviewed_value(value: object) -> NormalizedMnn | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("MNN_DECISION_INVALID")
    normalized = normalize_mnn_label(value)
    if not normalized.key or not normalized.label or len(normalized.key) > 255 or len(normalized.label) > 500:
        raise ValueError("MNN_DECISION_INVALID")
    return normalized


@dataclass(frozen=True)
class ReviewedMnnDecision:
    primary: NormalizedMnn | None
    additional: tuple[NormalizedMnn, ...] = ()

    @property
    def values(self) -> tuple[NormalizedMnn, ...]:
        return (() if self.primary is None else (self.primary,)) + self.additional


def normalize_reviewed_mnn(
    primary: object,
    additional: object,
) -> ReviewedMnnDecision:
    """Normalize optional primary/additional cells without inventing values."""

    primary_value = _reviewed_value(primary)
    if additional is None or additional == "":
        raw_additional: Sequence[object] = ()
    elif isinstance(additional, str):
        raw_additional = tuple(part.strip() for part in additional.split(";") if part.strip())
    elif isinstance(additional, (tuple, list)):
        raw_additional = additional
    else:
        raise ValueError("MNN_DECISION_INVALID")
    additional_values = tuple(_reviewed_value(value) for value in raw_additional)
    if any(value is None for value in additional_values):
        raise ValueError("MNN_DECISION_INVALID")
    if additional_values and primary_value is None:
        raise ValueError("MNN_PRIMARY_REQUIRED")
    values = (() if primary_value is None else (primary_value,)) + additional_values
    keys = [value.key for value in values]
    if len(keys) != len(set(keys)):
        raise ValueError("MNN_DECISION_DUPLICATE")
    return ReviewedMnnDecision(
        primary=primary_value,
        additional=tuple(sorted(additional_values, key=lambda value: (value.key, value.label))),
    )


@dataclass(frozen=True)
class MnnProposalValue:
    claim_id: int
    claim_fingerprint: str
    key: str
    label: str
    owner_entity_id: int
    resolution_status: Literal["mapped", "unresolved", "collision"]


@dataclass(frozen=True)
class MnnProposal:
    normalized_url: str
    owner_entity_id: int
    snapshot_id: int
    snapshot_digest: str
    authority_kind: Literal["exact_reviewed_claims"]
    values: tuple[MnnProposalValue, ...]

    @property
    def primary(self) -> MnnProposalValue:
        return self.values[0]

    @property
    def additional(self) -> tuple[MnnProposalValue, ...]:
        return self.values[1:]

    @classmethod
    def authoritative(
        cls,
        *,
        normalized_url: str,
        owner_entity_id: int,
        snapshot_id: int,
        snapshot_digest: str,
        values: Sequence[MnnProposalValue],
    ) -> "MnnProposal":
        semantic = normalize_url(normalized_url)
        grouping = normalize_observed_page_grouping_url(normalized_url)
        ordered = tuple(sorted(values, key=lambda value: (value.key, value.claim_id)))
        if (
            not semantic.value
            or semantic.value != grouping.value
            or type(owner_entity_id) is not int
            or owner_entity_id <= 0
            or type(snapshot_id) is not int
            or snapshot_id <= 0
            or not ordered
            or any(
                type(value.claim_id) is not int
                or value.claim_id <= 0
                or value.owner_entity_id != owner_entity_id
                or value.resolution_status != "mapped"
                or not value.key
                or not value.label
                or len(value.claim_fingerprint) != 64
                or any(character not in _HEX for character in value.claim_fingerprint.lower())
                for value in ordered
            )
            or len({value.key for value in ordered}) != len(ordered)
        ):
            raise ValueError("MNN_PROPOSAL_AUTHORITY_INVALID")
        return cls(
            normalized_url=grouping.value,
            owner_entity_id=owner_entity_id,
            snapshot_id=snapshot_id,
            snapshot_digest=_sha256(snapshot_digest),
            authority_kind="exact_reviewed_claims",
            values=ordered,
        )


def compute_mnn_decision_event_fingerprint(payload: Mapping[str, object]) -> str:
    """Bind accepted primary/additional roles to one immutable event."""

    required = {
        "accepted_decision_hash",
        "actor",
        "approval_batch_id",
        "approval_item_id",
        "content_entity_id",
        "decision_reason",
        "mnn_source_snapshot_id",
        "primary_mnn_key",
        "additional_mnn_keys",
    }
    if set(payload) != required:
        raise ValueError("MNN_DECISION_EVENT_INVALID")
    additional = payload.get("additional_mnn_keys")
    if not isinstance(additional, (tuple, list)):
        raise ValueError("MNN_DECISION_EVENT_INVALID")
    canonical = dict(payload)
    canonical["additional_mnn_keys"] = list(additional)
    return _digest(canonical)
