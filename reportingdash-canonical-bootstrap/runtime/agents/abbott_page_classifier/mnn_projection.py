"""Canonical MNN projection across reviewed Abbott entity continuity."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from typing import Iterable, Mapping, Sequence

from .entity_continuity import EntityContinuity


class MnnProjectionError(RuntimeError):
    """Sanitized MNN projection failure."""


@dataclass(frozen=True, order=True)
class MnnProjectionRecord:
    content_entity_id: int
    mnn_source_snapshot_id: int
    source_claim_id: int
    mnn_key: str
    mnn_label: str


@dataclass(frozen=True)
class MnnProjectionReceipt:
    mapping_count: int
    entity_count: int
    records_hash: str
    snapshot_id: int


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _fingerprint(release_id: int, record: MnnProjectionRecord) -> str:
    return hashlib.sha256(
        _canonical_json(
            {
                "canonical_release_id": release_id,
                "content_entity_id": record.content_entity_id,
                "mnn_key": record.mnn_key,
                "source_claim_id": record.source_claim_id,
            }
        ).encode("utf-8")
    ).hexdigest()


def _value(row: object, name: str, index: int) -> object:
    if isinstance(row, Mapping):
        return row.get(name)
    return row[index]


def project_mnn_records(
    predecessor_rows: Iterable[object],
    continuity: Iterable[EntityContinuity],
) -> tuple[MnnProjectionRecord, ...]:
    continuity_by_entity: dict[int, int] = {}
    for row in continuity:
        if row.predecessor_id is None:
            continue
        if row.candidate_id is None:
            continuity_by_entity[row.predecessor_id] = 0
        else:
            continuity_by_entity[row.predecessor_id] = row.candidate_id
    projected: dict[tuple[int, str], MnnProjectionRecord] = {}
    for raw in predecessor_rows:
        try:
            predecessor_id = int(_value(raw, "content_entity_id", 0))
            snapshot_id = int(_value(raw, "mnn_source_snapshot_id", 1))
            claim_id = int(_value(raw, "source_claim_id", 2))
            key = str(_value(raw, "mnn_key", 3) or "").strip()
            label = str(_value(raw, "mnn_label", 4) or "").strip()
            source_fingerprint = str(
                _value(raw, "mapping_fingerprint", 5) or ""
            ).lower()
        except (IndexError, TypeError, ValueError):
            raise MnnProjectionError("MNN_PROJECTION_INVALID") from None
        candidate_id = continuity_by_entity.get(predecessor_id)
        if candidate_id is None or candidate_id <= 0:
            raise MnnProjectionError("MNN_ENTITY_CONTINUITY_MISSING")
        if (
            predecessor_id <= 0
            or snapshot_id <= 0
            or claim_id <= 0
            or not key
            or not label
            or not re.fullmatch(r"[0-9a-f]{64}", source_fingerprint)
        ):
            raise MnnProjectionError("MNN_PROJECTION_INVALID")
        record = MnnProjectionRecord(
            candidate_id, snapshot_id, claim_id, key, label
        )
        identity = (candidate_id, key)
        prior = projected.setdefault(identity, record)
        if prior != record:
            raise MnnProjectionError("MNN_PROJECTION_CONFLICT")
    records = tuple(sorted(projected.values()))
    snapshot_ids = {record.mnn_source_snapshot_id for record in records}
    if len(snapshot_ids) > 1:
        raise MnnProjectionError("MNN_SOURCE_AUTHORITY_MISMATCH")
    return records


def _records_hash(
    release_id: int,
    records: Sequence[MnnProjectionRecord],
) -> str:
    payload = [
        {
            "canonical_release_id": release_id,
            "content_entity_id": row.content_entity_id,
            "mapping_fingerprint": _fingerprint(release_id, row),
            "mnn_key": row.mnn_key,
            "mnn_label": row.mnn_label,
            "mnn_source_snapshot_id": row.mnn_source_snapshot_id,
            "source_claim_id": row.source_claim_id,
        }
        for row in records
    ]
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def copy_mnn_projection(
    cursor,
    predecessor_release_id: int,
    candidate_release_id: int,
    continuity: Iterable[EntityContinuity],
) -> MnnProjectionReceipt:
    if predecessor_release_id <= 0 or candidate_release_id <= 0:
        raise MnnProjectionError("MNN_PROJECTION_INVALID")
    cursor.execute(
        """
        SELECT content_entity_id, mnn_source_snapshot_id, source_claim_id,
               mnn_key, mnn_label, mapping_fingerprint
        FROM portal_content_catalog_mnn
        WHERE canonical_release_id = %s
        ORDER BY content_entity_id, mnn_key, source_claim_id
        FOR UPDATE
        """,
        (predecessor_release_id,),
    )
    records = project_mnn_records(cursor.fetchall(), continuity)
    for record in records:
        cursor.execute(
            """
            INSERT INTO portal_content_catalog_mnn (
              canonical_release_id, content_entity_id, mnn_source_snapshot_id,
              source_claim_id, mnn_key, mnn_label, mapping_fingerprint
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                candidate_release_id,
                record.content_entity_id,
                record.mnn_source_snapshot_id,
                record.source_claim_id,
                record.mnn_key,
                record.mnn_label,
                _fingerprint(candidate_release_id, record),
            ),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise MnnProjectionError("MNN_MAPPING_INSERT_FAILED")
    cursor.execute(
        """
        SELECT content_entity_id, mnn_source_snapshot_id, source_claim_id,
               mnn_key, mnn_label, mapping_fingerprint
        FROM portal_content_catalog_mnn
        WHERE canonical_release_id = %s
        ORDER BY content_entity_id, mnn_key, source_claim_id
        """,
        (candidate_release_id,),
    )
    stored = tuple(cursor.fetchall())
    expected = tuple(
        (
            row.content_entity_id,
            row.mnn_source_snapshot_id,
            row.source_claim_id,
            row.mnn_key,
            row.mnn_label,
            _fingerprint(candidate_release_id, row),
        )
        for row in records
    )
    if stored != expected:
        raise MnnProjectionError("MNN_MAPPING_ATTESTATION_FAILED")
    return MnnProjectionReceipt(
        mapping_count=len(records),
        entity_count=len({row.content_entity_id for row in records}),
        records_hash=_records_hash(candidate_release_id, records),
        snapshot_id=(records[0].mnn_source_snapshot_id if records else 0),
    )
