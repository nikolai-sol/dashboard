"""Immutable Abbott MNN source registration and strong-identity resolution."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
from typing import Mapping, Sequence

from canonical_writer import get_db_connection

from .mnn import MnnSnapshot, normalize_mnn_label, read_mnn_workbook, resolve_mnn_claims
from .normalization import normalize_url, sha256_text


DATASET_KEY = "abbott"
MNN_SOURCE_KIND = "abbott_mnn_workbook"
MNN_PARSER_VERSION = "abbott-mnn-xlsx-v1"


class MnnImportError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


@dataclass(frozen=True)
class MnnClaimRecord:
    source_sha256: str
    source_sheet: str
    source_row_ordinal: int
    source_row_fingerprint: str
    normalized_url: str | None
    mnn_key: str
    mnn_label: str
    raw_value_sha256: str
    source_provenance: Mapping[str, object]
    resolved_content_entity_id: int | None
    resolution_status: str
    resolution_evidence: Mapping[str, object]
    claim_fingerprint: str


@dataclass(frozen=True)
class MnnImportReceipt:
    snapshot_id: int
    source_sha256: str
    claim_count: int
    mapped_count: int
    unresolved_count: int
    collision_count: int
    unlinked_count: int
    rejected_count: int
    claims_hash: str
    status: str


def build_mnn_claim_records(
    snapshot: MnnSnapshot,
    strong_url_owners: Mapping[str, Sequence[int]],
) -> tuple[MnnClaimRecord, ...]:
    owners: dict[str, tuple[int, ...]] = {}
    for raw_url, raw_ids in strong_url_owners.items():
        normalized = normalize_url(raw_url).value
        if not normalized:
            continue
        values = tuple(sorted({int(value) for value in raw_ids}))
        if any(value <= 0 for value in values):
            raise MnnImportError("MNN_STRONG_OWNER_INVALID")
        owners[normalized] = values

    resolution = resolve_mnn_claims(snapshot, owners)
    mapped = {
        (item.normalized_url, item.mnn_key): item
        for item in resolution.mappings
    }
    collisions = {(item.normalized_url, item.mnn_key) for item in resolution.collisions}
    records: list[MnnClaimRecord] = []
    for claim in snapshot.claims:
        key = (claim.normalized_url, claim.mnn_key)
        mapping = mapped.get(key)
        status = "mapped" if mapping else ("collision" if key in collisions else "unresolved")
        owner_ids = owners.get(claim.normalized_url, ())
        provenance = tuple(asdict(item) for item in claim.provenance)
        first = claim.provenance[0]
        claim_fingerprint = sha256_text(
            _canonical_json(
                {
                    "mnn_key": claim.mnn_key,
                    "normalized_url": claim.normalized_url,
                    "source_rows": [item.source_row_fingerprint for item in claim.provenance],
                    "source_sha256": snapshot.source_sha256,
                }
            )
        )
        records.append(
            MnnClaimRecord(
                source_sha256=snapshot.source_sha256,
                source_sheet=first.source_sheet,
                source_row_ordinal=first.source_row_ordinal,
                source_row_fingerprint=first.source_row_fingerprint,
                normalized_url=claim.normalized_url,
                mnn_key=claim.mnn_key,
                mnn_label=claim.mnn_label,
                raw_value_sha256=sha256_text(
                    _canonical_json([item.raw_value for item in claim.provenance])
                ),
                source_provenance={"rows": provenance},
                resolved_content_entity_id=(mapping.content_entity_id if mapping else None),
                resolution_status=status,
                resolution_evidence={
                    "owner_count": len(owner_ids),
                    "owner_ids_hash": sha256_text(_canonical_json(owner_ids)),
                    "resolution_rule": "unique_strong_url",
                },
                claim_fingerprint=claim_fingerprint,
            )
        )
    for row in snapshot.unlinked_rows:
        for label in row.mnn_labels:
            normalized = normalize_mnn_label(label)
            claim_fingerprint = sha256_text(
                _canonical_json(
                    {
                        "mnn_key": normalized.key,
                        "source_row_fingerprint": row.source_row_fingerprint,
                        "source_sha256": snapshot.source_sha256,
                        "status": "unlinked",
                    }
                )
            )
            records.append(
                MnnClaimRecord(
                    source_sha256=snapshot.source_sha256,
                    source_sheet=row.source_sheet,
                    source_row_ordinal=row.source_row_ordinal,
                    source_row_fingerprint=row.source_row_fingerprint,
                    normalized_url=None,
                    mnn_key=normalized.key,
                    mnn_label=normalized.label,
                    raw_value_sha256=sha256_text(row.raw_value),
                    source_provenance={
                        "source_sheet": row.source_sheet,
                        "source_row_ordinal": row.source_row_ordinal,
                        "source_row_fingerprint": row.source_row_fingerprint,
                    },
                    resolved_content_entity_id=None,
                    resolution_status="unlinked",
                    resolution_evidence={
                        "owner_count": 0,
                        "owner_ids_hash": sha256_text("[]"),
                        "resolution_rule": "missing_url",
                    },
                    claim_fingerprint=claim_fingerprint,
                )
            )
    return tuple(
        sorted(
            records,
            key=lambda item: (
                item.normalized_url is None,
                item.normalized_url or "",
                item.mnn_key,
                item.source_sheet,
                item.source_row_ordinal,
            ),
        )
    )


def _records_hash(records: Sequence[MnnClaimRecord]) -> str:
    return sha256_text(
        _canonical_json(
            [
                {
                    "claim_fingerprint": item.claim_fingerprint,
                    "mnn_key": item.mnn_key,
                    "mnn_label": item.mnn_label,
                    "normalized_url": item.normalized_url,
                    "resolution_status": item.resolution_status,
                    "resolved_content_entity_id": item.resolved_content_entity_id,
                }
                for item in records
            ]
        )
    )


def import_mnn_workbook(
    workbook_path: Path,
    *,
    private_archive_locator: str,
    code_revision: str,
    connection_factory=None,
) -> MnnImportReceipt:
    """Register one reviewed workbook and immutable claim-resolution evidence."""

    if (
        not isinstance(private_archive_locator, str)
        or not private_archive_locator.startswith("private://")
        or not re.fullmatch(r"[0-9a-f]{7,64}", str(code_revision or ""))
    ):
        raise MnnImportError("MNN_IMPORT_INPUT_INVALID")
    source_path = Path(workbook_path)
    snapshot = read_mnn_workbook(source_path)
    source_bytes = source_path.stat().st_size
    unknown_malformed_count = sum(
        item.reason_code != "MNN_PLACEHOLDER" for item in snapshot.rejected_values
    )
    if unknown_malformed_count:
        raise MnnImportError("MNN_SOURCE_MALFORMED")
    connection = cursor = None
    try:
        connection = (connection_factory or get_db_connection)()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT alias_value, content_entity_id
            FROM portal_content_registry_aliases
            WHERE dataset_key = %s
              AND alias_status = 'active'
              AND uniqueness_scope = 'strong'
              AND alias_type IN ('canonical_url', 'url')
            ORDER BY alias_hash, content_entity_id
            FOR SHARE
            """,
            (DATASET_KEY,),
        )
        owners: dict[str, list[int]] = {}
        for row in cursor.fetchall():
            url = str(row.get("alias_value") or "")
            owners.setdefault(url, []).append(int(row.get("content_entity_id") or 0))
        records = build_mnn_claim_records(snapshot, owners)
        claims_hash = _records_hash(records)
        cursor.execute(
            """
            SELECT id, import_status, imported_row_count, rejected_row_count,
                   manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND source_kind = %s
              AND content_sha256 = %s AND parser_version = %s
            FOR UPDATE
            """,
            (DATASET_KEY, MNN_SOURCE_KIND, snapshot.source_sha256, MNN_PARSER_VERSION),
        )
        existing = cursor.fetchone()
        counts = {
            "mapped": sum(item.resolution_status == "mapped" for item in records),
            "unresolved": sum(item.resolution_status == "unresolved" for item in records),
            "collision": sum(item.resolution_status == "collision" for item in records),
            "unlinked": sum(item.resolution_status == "unlinked" for item in records),
        }
        if existing is not None:
            manifest = existing.get("manifest_json")
            if isinstance(manifest, str):
                manifest = json.loads(manifest)
            if (
                existing.get("import_status") != "imported"
                or int(existing.get("imported_row_count") or 0) != len(records)
                or int(existing.get("rejected_row_count") or 0) != snapshot.rejected_value_count
                or not isinstance(manifest, Mapping)
                or manifest.get("claims_hash") != claims_hash
                or int(manifest.get("rejected_placeholder_count") or 0)
                != snapshot.rejected_value_count
                or int(manifest.get("unknown_malformed_count") or 0) != 0
            ):
                raise MnnImportError("MNN_SNAPSHOT_REPLAY_MISMATCH")
            connection.commit()
            return MnnImportReceipt(
                snapshot_id=int(existing["id"]),
                source_sha256=snapshot.source_sha256,
                claim_count=len(records),
                mapped_count=counts["mapped"],
                unresolved_count=counts["unresolved"],
                collision_count=counts["collision"],
                unlinked_count=counts["unlinked"],
                rejected_count=snapshot.rejected_value_count,
                claims_hash=claims_hash,
                status="noop",
            )
        manifest = {
            "claims_hash": claims_hash,
            "code_revision": code_revision,
            "content_bytes": source_bytes,
            "content_sha256": snapshot.source_sha256,
            "counts": counts,
            "parser_version": MNN_PARSER_VERSION,
            "rejected_count": snapshot.rejected_value_count,
            "rejected_placeholder_count": snapshot.rejected_value_count,
            "source_kind": MNN_SOURCE_KIND,
            "source_sha256": snapshot.source_sha256,
            "unknown_malformed_count": unknown_malformed_count,
        }
        cursor.execute(
            """
            INSERT INTO portal_dataset_snapshots (
              snapshot_key, dataset_key, source_kind, source_locator,
              content_sha256, content_bytes, source_row_count, parser_version,
              import_status, imported_row_count, rejected_row_count,
              private_archive_locator, manifest_json, imported_at
            ) VALUES (
              UUID(), %s, %s, %s, %s, %s, %s, %s,
              'imported', %s, %s, %s, %s, NOW(6)
            )
            """,
            (
                DATASET_KEY,
                MNN_SOURCE_KIND,
                private_archive_locator,
                snapshot.source_sha256,
                source_bytes,
                snapshot.mnn_row_count,
                MNN_PARSER_VERSION,
                len(records),
                snapshot.rejected_value_count,
                private_archive_locator,
                _canonical_json(manifest),
            ),
        )
        snapshot_id = int(cursor.lastrowid)
        if snapshot_id <= 0 or int(cursor.rowcount) != 1:
            raise MnnImportError("MNN_SNAPSHOT_INSERT_FAILED")
        for record in records:
            cursor.execute(
                """
                INSERT INTO portal_content_mnn_source_claims (
                  source_snapshot_id, source_sheet, source_row_ordinal,
                  source_row_fingerprint, normalized_url, normalized_url_hash,
                  mnn_key, mnn_label, raw_value_sha256, source_provenance_json,
                  resolved_content_entity_id, resolution_status,
                  resolution_evidence_json, claim_fingerprint
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    snapshot_id,
                    record.source_sheet,
                    record.source_row_ordinal,
                    record.source_row_fingerprint,
                    record.normalized_url,
                    (sha256_text(record.normalized_url) if record.normalized_url else None),
                    record.mnn_key,
                    record.mnn_label,
                    record.raw_value_sha256,
                    _canonical_json(record.source_provenance),
                    record.resolved_content_entity_id,
                    record.resolution_status,
                    _canonical_json(record.resolution_evidence),
                    record.claim_fingerprint,
                ),
            )
            if int(cursor.rowcount) != 1:
                raise MnnImportError("MNN_CLAIM_INSERT_FAILED")
        connection.commit()
        return MnnImportReceipt(
            snapshot_id=snapshot_id,
            source_sha256=snapshot.source_sha256,
            claim_count=len(records),
            mapped_count=counts["mapped"],
            unresolved_count=counts["unresolved"],
            collision_count=counts["collision"],
            unlinked_count=counts["unlinked"],
            rejected_count=snapshot.rejected_value_count,
            claims_hash=claims_hash,
            status="imported",
        )
    except MnnImportError:
        if connection is not None:
            connection.rollback()
        raise
    except Exception:
        if connection is not None:
            connection.rollback()
        raise MnnImportError("MNN_IMPORT_FAILED") from None
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()
