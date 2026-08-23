"""Fail-closed entity continuity for Abbott content successors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


class ContinuityError(RuntimeError):
    """Sanitized entity-continuity failure."""


@dataclass(frozen=True)
class EntityContinuity:
    predecessor_id: int | None
    candidate_id: int | None
    authority: str


_AUTHORITIES = frozenset(
    {
        "unchanged",
        "reviewed_attach",
        "reviewed_create",
        "reviewed_retire",
        "reviewed_reject",
        "current_batch_approve",
        "current_batch_rebind",
        "current_batch_revoke",
    }
)


def _entity_ids(values: Iterable[int]) -> set[int]:
    try:
        result = {int(value) for value in values}
    except (TypeError, ValueError):
        raise ContinuityError("ENTITY_CONTINUITY_INVALID") from None
    if any(value <= 0 for value in result):
        raise ContinuityError("ENTITY_CONTINUITY_INVALID")
    return result


def build_entity_continuity(
    predecessor_ids: Iterable[int],
    candidate_ids: Iterable[int],
    decisions: Iterable[EntityContinuity],
) -> tuple[EntityContinuity, ...]:
    """Cover every old and new entity with immutable reviewed authority."""

    predecessor = _entity_ids(predecessor_ids)
    candidate = _entity_ids(candidate_ids)
    rows = [
        EntityContinuity(entity_id, entity_id, "unchanged")
        for entity_id in sorted(predecessor & candidate)
    ]
    for raw in decisions:
        if not isinstance(raw, EntityContinuity) or raw.authority not in _AUTHORITIES:
            raise ContinuityError("ENTITY_CONTINUITY_INVALID")
        old_id = int(raw.predecessor_id) if raw.predecessor_id is not None else None
        new_id = int(raw.candidate_id) if raw.candidate_id is not None else None
        if (
            (old_id is None and new_id is None)
            or (old_id is not None and old_id <= 0)
            or (new_id is not None and new_id <= 0)
            or raw.authority == "unchanged"
            or (old_id in predecessor & candidate)
            or (new_id in predecessor & candidate)
        ):
            raise ContinuityError("ENTITY_CONTINUITY_CONFLICT")
        rows.append(EntityContinuity(old_id, new_id, raw.authority))

    predecessor_rows = [row.predecessor_id for row in rows if row.predecessor_id is not None]
    candidate_rows = [row.candidate_id for row in rows if row.candidate_id is not None]
    if (
        set(predecessor_rows) != predecessor
        or len(predecessor_rows) != len(set(predecessor_rows))
        or set(candidate_rows) != candidate
    ):
        raise ContinuityError("ENTITY_CONTINUITY_UNAUTHORIZED")
    if len(rows) != len(set(rows)):
        raise ContinuityError("ENTITY_CONTINUITY_CONFLICT")
    return tuple(
        sorted(
            rows,
            key=lambda row: (
                row.predecessor_id is None,
                row.predecessor_id or 0,
                row.candidate_id is None,
                row.candidate_id or 0,
                row.authority,
            ),
        )
    )
