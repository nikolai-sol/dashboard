"""Transactional Abbott content successor materialization and hard gates.

This module only constructs and inspects a staging successor.  It deliberately
has no activation path: the generic reviewed release workflow remains the sole
owner of validation-state transitions and active-pointer changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Iterable, Mapping, Sequence

import canonical_release_store as release_store
from canonical_writer import get_db_connection

from .normalization import normalize_title, normalize_url, sha256_text


DATASET_KEY = "abbott"
CATALOG_SOURCE_KIND = "abbott_workbook_catalog"
CATALOG_PARSER_VERSION = "abbott-content-candidate-v1"
EXACT_PERCENT = Decimal("100")
_EVIDENCE_OBJECT_FIELDS = (
    "archive_attestation",
    "current_canonical",
    "deterministic",
    "registry1",
    "registry2",
)
_PROPOSAL_FIELDS = (
    "access_code",
    "confidence",
    "direction_code",
    "evidence",
    "lifecycle_code",
    "material_type_code",
    "rule_code",
)


class CandidateMaterializationError(RuntimeError):
    """Sanitized, fail-closed candidate construction error."""


@dataclass(frozen=True)
class CandidateCatalogRow:
    content_entity_id: int
    normalized_url: str
    normalized_url_hash: str
    normalized_path: str
    page_title: str
    material_id: str | None
    material_type: str | None
    source_slug: str | None
    source_slug_hash: str | None
    access_label: str | None
    is_active: bool
    source_sheet: str
    source_row_ordinal: int
    source_row_fingerprint: str
    section_key: str | None
    direction_key: str | None
    published_at: object | None
    valid_from: object
    valid_to: object | None
    classification_event_id: int
    classification_event_fingerprint: str


@dataclass(frozen=True)
class LookupProjectionRow:
    lookup_kind: str
    lookup_key_hash: str
    candidate_count: int
    metadata_signature_count: int
    resolution_status: str
    selected_source_row_fingerprint: str | None
    group_fingerprint: str


@dataclass(frozen=True)
class CandidateMaterialization:
    batch_id: int
    predecessor_release_id: int
    candidate_release_id: int
    catalog_snapshot_id: int
    catalog_row_count: int
    lookup_row_count: int
    catalog_hash: str
    lookup_hash: str
    source_snapshot_ids: tuple[int, ...]
    status: str = "staging"


@dataclass(frozen=True)
class GateReport:
    candidate_release_id: int
    source_reconciliation_pct: Decimal = EXACT_PERCENT
    count_reconciliation_pct: Decimal = EXACT_PERCENT
    hash_reconciliation_pct: Decimal = EXACT_PERCENT
    schema_compliance_pct: Decimal = EXACT_PERCENT
    anti_flip_violations: int = 0
    strong_identity_collisions: int = 0
    out_of_taxonomy_values: int = 0
    archive_material_types: int = 0
    unresolved_accepted_conflicts: int = 0
    active_release_mutations: int = 0
    dashboard_smoke_failures: int = 0

    @property
    def passed(self) -> bool:
        percentages = (
            self.source_reconciliation_pct,
            self.count_reconciliation_pct,
            self.hash_reconciliation_pct,
            self.schema_compliance_pct,
        )
        failures = (
            self.anti_flip_violations,
            self.strong_identity_collisions,
            self.out_of_taxonomy_values,
            self.archive_material_types,
            self.unresolved_accepted_conflicts,
            self.active_release_mutations,
            self.dashboard_smoke_failures,
        )
        return all(value == EXACT_PERCENT for value in percentages) and all(
            value == 0 for value in failures
        )


def _canonical_json(value: object) -> str:
    def encode(item: object):
        if isinstance(item, datetime):
            return item.isoformat(timespec="microseconds")
        if isinstance(item, date):
            return item.isoformat()
        if isinstance(item, Decimal):
            return format(item, "f")
        raise TypeError(f"unsupported canonical JSON type: {type(item).__name__}")

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=encode,
    )


def _hash_rows(rows: Iterable[Sequence[object]]) -> str:
    return sha256_text(_canonical_json([list(row) for row in rows]))


def _database_datetime(value: object | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            raise CandidateMaterializationError("SOURCE_PROVENANCE_INVALID") from None
    else:
        raise CandidateMaterializationError("SOURCE_PROVENANCE_INVALID")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _strict_proposal_object_sql(field_name: str) -> str:
    root = f"JSON_EXTRACT(item.proposal_evidence, '$.{field_name}')"
    required_paths = ", ".join(f"'$.{field_name}.{name}'" for name in _PROPOSAL_FIELDS)
    nullable_strings = " AND ".join(
        "JSON_TYPE(JSON_EXTRACT(item.proposal_evidence, "
        f"'$.{field_name}.{name}')) IN ('NULL', 'STRING')"
        for name in (
            "access_code",
            "direction_code",
            "lifecycle_code",
            "material_type_code",
        )
    )
    confidence = f"JSON_EXTRACT(item.proposal_evidence, '$.{field_name}.confidence')"
    return f"""(
      JSON_TYPE({root}) = 'NULL'
      OR (
        JSON_TYPE({root}) = 'OBJECT'
        AND JSON_LENGTH(JSON_KEYS({root})) = 7
        AND JSON_CONTAINS_PATH(item.proposal_evidence, 'all', {required_paths})
        AND {nullable_strings}
        AND JSON_TYPE({confidence}) IN ('NULL', 'INTEGER', 'DOUBLE')
        AND (
          JSON_TYPE({confidence}) = 'NULL'
          OR CAST(JSON_UNQUOTE({confidence}) AS DECIMAL(8,7)) BETWEEN 0 AND 1
        )
        AND JSON_TYPE(JSON_EXTRACT(
              item.proposal_evidence, '$.{field_name}.evidence')) = 'ARRAY'
        AND JSON_TYPE(JSON_EXTRACT(
              item.proposal_evidence, '$.{field_name}.rule_code')) = 'STRING'
      )
    )"""


def _strict_proposal_evidence_sql() -> str:
    top_level_paths = ", ".join(
        f"'$.{name}'"
        for name in (
            *_EVIDENCE_OBJECT_FIELDS,
            "concise_evidence",
            "published_decision",
            "sol",
            "terra",
        )
    )
    nullable_objects = " AND ".join(
        "JSON_TYPE(JSON_EXTRACT(item.proposal_evidence, "
        f"'$.{name}')) IN ('NULL', 'OBJECT')"
        for name in _EVIDENCE_OBJECT_FIELDS
    )
    published_fields = (
        "decision_reason",
        "final_access_code",
        "final_direction_code",
        "final_lifecycle_code",
        "final_material_type_code",
    )
    published_paths = ", ".join(
        f"'$.published_decision.{name}'" for name in published_fields
    )
    published_types = " AND ".join(
        "JSON_TYPE(JSON_EXTRACT(item.proposal_evidence, "
        f"'$.published_decision.{name}')) IN ('NULL', 'STRING')"
        for name in published_fields
    )
    return f"""(
      JSON_VALID(item.proposal_evidence)
      AND JSON_TYPE(item.proposal_evidence) = 'OBJECT'
      AND JSON_LENGTH(JSON_KEYS(item.proposal_evidence)) = 9
      AND JSON_CONTAINS_PATH(item.proposal_evidence, 'all', {top_level_paths})
      AND {nullable_objects}
      AND JSON_TYPE(JSON_EXTRACT(
            item.proposal_evidence, '$.concise_evidence')) = 'ARRAY'
      AND JSON_TYPE(JSON_EXTRACT(
            item.proposal_evidence, '$.published_decision')) = 'OBJECT'
      AND JSON_LENGTH(JSON_KEYS(JSON_EXTRACT(
            item.proposal_evidence, '$.published_decision'))) = 5
      AND JSON_CONTAINS_PATH(item.proposal_evidence, 'all', {published_paths})
      AND {published_types}
      AND {_strict_proposal_object_sql('terra')}
      AND {_strict_proposal_object_sql('sol')}
    )"""


def _row_value(row: object, name: str, index: int | None = None):
    if isinstance(row, Mapping):
        return row.get(name)
    if index is None:
        return None
    return row[index]


def _decode_json(value: object, *, code: str):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            raise CandidateMaterializationError(code) from None
    return value


def _slug(path: str) -> str:
    if not path or path == "/":
        return ""
    return path.rstrip("/").rsplit("/", 1)[-1]


def _title_key(title: str) -> str:
    return normalize_title(title)


def _metadata_signature(row: CandidateCatalogRow) -> str:
    return sha256_text(
        _canonical_json(
            {
                "access": row.access_label,
                "direction": row.direction_key,
                "is_active": row.is_active,
                "material_id": row.material_id,
                "material_type": row.material_type,
                "path": row.normalized_path,
                "title": normalize_title(row.page_title),
                "url": row.normalized_url,
            }
        )
    )


def build_lookup_projection(
    catalog_rows: Iterable[CandidateCatalogRow],
) -> tuple[LookupProjectionRow, ...]:
    """Build deterministic title/slug/path groups without resolving ambiguity."""

    groups: dict[tuple[str, str], list[CandidateCatalogRow]] = {}
    for row in catalog_rows:
        values = (
            ("title", _title_key(row.page_title)),
            ("slug", row.source_slug or ""),
            ("path", row.normalized_path),
        )
        for kind, value in values:
            if not value:
                continue
            groups.setdefault((kind, sha256_text(value)), []).append(row)

    result: list[LookupProjectionRow] = []
    for (kind, key_hash), rows in sorted(groups.items()):
        ordered = sorted(rows, key=lambda item: item.source_row_fingerprint)
        signatures = {_metadata_signature(item) for item in ordered}
        if len(ordered) == 1:
            status = "unique"
        elif len(signatures) == 1:
            status = "identical_collapsed"
        else:
            status = "ambiguous"
        selected = (
            ordered[0].source_row_fingerprint if status != "ambiguous" else None
        )
        group_fingerprint = sha256_text(
            _canonical_json(
                [
                    {
                        "metadata_signature": _metadata_signature(item),
                        "source_row_fingerprint": item.source_row_fingerprint,
                    }
                    for item in ordered
                ]
            )
        )
        result.append(
            LookupProjectionRow(
                lookup_kind=kind,
                lookup_key_hash=key_hash,
                candidate_count=len(ordered),
                metadata_signature_count=len(signatures),
                resolution_status=status,
                selected_source_row_fingerprint=selected,
                group_fingerprint=group_fingerprint,
            )
        )
    return tuple(result)


def _provenance_rows(entity_row: Mapping[str, object]) -> tuple[Mapping[str, object], ...]:
    evidence = _decode_json(
        entity_row.get("source_evidence") or {}, code="SOURCE_EVIDENCE_INVALID"
    )
    if not isinstance(evidence, Mapping):
        raise CandidateMaterializationError("SOURCE_EVIDENCE_INVALID")
    provenance = evidence.get("provenance")
    if provenance is None:
        provenance = (evidence,)
    if not isinstance(provenance, (list, tuple)) or not provenance:
        raise CandidateMaterializationError("SOURCE_PROVENANCE_MISSING")
    if any(not isinstance(item, Mapping) for item in provenance):
        raise CandidateMaterializationError("SOURCE_EVIDENCE_INVALID")
    return tuple(provenance)  # type: ignore[return-value]


def _catalog_rows(entity_rows: Iterable[Mapping[str, object]]) -> tuple[CandidateCatalogRow, ...]:
    result: list[CandidateCatalogRow] = []
    source_keys: set[tuple[str, int]] = set()
    for entity in entity_rows:
        try:
            entity_id = int(entity["content_entity_id"])
            event_id = int(entity["classification_event_id"])
            event_fingerprint = str(entity["event_fingerprint"])
            effective_at = entity["effective_at"]
        except (KeyError, TypeError, ValueError):
            raise CandidateMaterializationError("EFFECTIVE_CLASSIFICATION_INVALID") from None
        if len(event_fingerprint) != 64 or effective_at is None:
            raise CandidateMaterializationError("EFFECTIVE_CLASSIFICATION_INVALID")
        for index, provenance in enumerate(_provenance_rows(entity), start=1):
            sheet = str(
                provenance.get("source_sheet")
                or provenance.get("source_name")
                or "content_registry"
            ).strip()
            raw_ordinal = provenance.get("source_row_ordinal")
            if raw_ordinal is None:
                raw_ordinal = provenance.get("source_row_id")
            try:
                ordinal = int(raw_ordinal if raw_ordinal is not None else entity_id)
            except (TypeError, ValueError):
                ordinal = entity_id * 1000 + index
            if not sheet or ordinal <= 0 or (sheet, ordinal) in source_keys:
                raise CandidateMaterializationError("SOURCE_PROVENANCE_COLLISION")
            source_keys.add((sheet, ordinal))
            source_fingerprint = str(
                provenance.get("source_row_fingerprint")
                or provenance.get("source_fingerprint")
                or sha256_text(
                    _canonical_json(
                        {
                            "content_entity_id": entity_id,
                            "event_fingerprint": event_fingerprint,
                            "source_row_ordinal": ordinal,
                            "source_sheet": sheet,
                        }
                    )
                )
            )
            if len(source_fingerprint) != 64:
                raise CandidateMaterializationError("SOURCE_PROVENANCE_INVALID")
            source_url = (
                provenance.get("normalized_url")
                or provenance.get("url")
                or provenance.get("canonical_url")
                or entity.get("canonical_url")
                or ""
            )
            normalized = normalize_url(str(source_url))
            title = normalize_title(
                str(
                    provenance.get("page_title")
                    or provenance.get("title")
                    or entity.get("title")
                    or ""
                )
            )
            material_id = provenance.get("material_id") or entity.get("material_id")
            slug = str(provenance.get("source_slug") or _slug(normalized.path))
            result.append(
                CandidateCatalogRow(
                    content_entity_id=entity_id,
                    normalized_url=normalized.value,
                    normalized_url_hash=normalized.sha256,
                    normalized_path=normalized.path,
                    page_title=title,
                    material_id=(
                        str(material_id) if material_id is not None else None
                    ),
                    material_type=(
                        str(entity["material_type_code"])
                        if entity.get("material_type_code") is not None
                        else None
                    ),
                    source_slug=slug or None,
                    source_slug_hash=sha256_text(slug) if slug else None,
                    access_label=(
                        str(entity["access_code"])
                        if entity.get("access_code") is not None
                        else None
                    ),
                    is_active=str(entity.get("lifecycle_code") or "unknown")
                    != "archived",
                    source_sheet=sheet,
                    source_row_ordinal=ordinal,
                    source_row_fingerprint=source_fingerprint,
                    section_key=(
                        str(provenance["section_key"])
                        if provenance.get("section_key") is not None
                        else None
                    ),
                    direction_key=(
                        str(entity["direction_code"])
                        if entity.get("direction_code") is not None
                        else None
                    ),
                    published_at=provenance.get("published_at"),
                    valid_from=effective_at,
                    valid_to=None,
                    classification_event_id=event_id,
                    classification_event_fingerprint=event_fingerprint,
                )
            )
    return tuple(
        sorted(
            result,
            key=lambda item: (item.source_sheet, item.source_row_ordinal),
        )
    )


def _catalog_payload(row: CandidateCatalogRow) -> tuple[object, ...]:
    return (
        row.normalized_url,
        row.normalized_url_hash,
        row.normalized_path,
        row.page_title,
        row.material_id,
        row.material_type,
        row.source_slug,
        row.source_slug_hash,
        row.access_label,
        int(row.is_active),
        row.source_sheet,
        row.source_row_ordinal,
        row.source_row_fingerprint,
        row.section_key,
        row.direction_key,
        _database_datetime(row.published_at),
        _database_datetime(row.valid_from),
        _database_datetime(row.valid_to),
    )


def _lookup_payload(row: LookupProjectionRow) -> tuple[object, ...]:
    return (
        row.lookup_kind,
        row.lookup_key_hash,
        row.candidate_count,
        row.metadata_signature_count,
        row.resolution_status,
        row.selected_source_row_fingerprint,
        row.group_fingerprint,
    )


def _ordered_row(row: object, names: Sequence[str]) -> tuple[object, ...]:
    if isinstance(row, Mapping):
        return tuple(row.get(name) for name in names)
    return tuple(row)  # type: ignore[arg-type]


# Explicit columns keep the copy auditable and preserve Abbott UTM/visit grains.
_NON_CONTENT_RELEASE_TABLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "portal_general_materials",
        (
            "source_snapshot_id", "material_key", "material_title", "material_type",
            "normalized_url", "normalized_url_hash", "normalized_path",
            "normalized_path_hash", "direction_key", "published_at", "metadata_json",
            "created_at", "updated_at",
        ),
    ),
    (
        "portal_event_catalog",
        (
            "source_snapshot_id", "event_title", "direction_key", "registration_url",
            "registration_url_hash", "access_label", "source_row_fingerprint",
            "created_at", "updated_at",
        ),
    ),
    (
        "portal_external_events",
        (
            "source_snapshot_id", "source_key", "analytics_account_id", "report_date",
            "occurred_at", "normalized_path", "normalized_path_hash", "event_kind",
            "source_name", "campaign_name", "source_row_fingerprint", "created_at",
        ),
    ),
    (
        "portal_bitrix_page_facts",
        (
            "source_snapshot_id", "analytics_account_id", "report_date",
            "normalized_path", "normalized_path_hash", "material_id",
            "material_type_hint", "pageviews", "sessions", "users", "guests",
            "logged_in_hits", "anonymous_hits", "logged_in_sessions",
            "anonymous_sessions", "entry_sessions", "exit_sessions",
            "avg_session_duration_seconds", "top_utm_source", "top_utm_medium",
            "top_utm_campaign", "source_row_fingerprint", "created_at",
        ),
    ),
    (
        "portal_bitrix_journey_transitions",
        (
            "source_snapshot_id", "analytics_account_id", "report_date", "from_path",
            "from_path_hash", "to_path", "to_path_hash", "transition_count",
            "created_at", "updated_at",
        ),
    ),
    (
        "canonical_fact_metrika_site_analytics_daily",
        (
            "source_key", "analytics_account_id", "counter_id", "report_date",
            "analytics_scope", "scope_hash", "scope_dimensions", "sessions", "users",
            "pageviews", "bounce_rate", "average_session_seconds", "goal_conversions",
            "raw_payload", "ingestion_run_id", "created_at",
        ),
    ),
    (
        "canonical_fact_metrika_returning_pages_release_daily",
        (
            "counter_id", "report_date", "raw_page_value", "raw_page_hash",
            "normalized_page", "normalized_page_hash", "return_bucket_code",
            "return_bucket_label", "source_percentage", "source_denominator",
            "derived_count", "is_derived", "request_fingerprint", "ingestion_run_id",
            "created_at",
        ),
    ),
    (
        "canonical_source_coverage_daily",
        (
            "source_key", "counter_id", "scope_key", "report_date",
            "request_fingerprint", "collection_status", "api_total_rows",
            "persisted_rows", "pagination_complete", "is_sampled", "empty_reconciled",
            "collector_run_id", "failure_code", "sanitized_failure_json", "created_at",
            "updated_at",
        ),
    ),
    (
        "report_bd_private.canonical_fact_metrika_user_behavior_daily",
        (
            "counter_id", "report_date", "raw_user_id", "raw_user_id_hash",
            "start_url", "start_url_hash", "end_url", "end_url_hash", "visit_id",
            "visit_id_hash", "session_started_at", "session_ended_at", "pageviews",
            "request_fingerprint", "ingestion_run_id", "created_at",
        ),
    ),
    (
        "report_bd_private.canonical_fact_metrika_visits",
        (
            "counter_id", "report_date", "visit_id", "visit_id_hash",
            "client_id_hash", "raw_user_id", "raw_user_id_hash", "raw_user_ids_json",
            "traffic_source", "utm_source", "start_url", "start_url_hash", "end_url",
            "end_url_hash", "session_started_at", "session_ended_at", "pageviews",
            "duration_seconds", "is_bounce", "request_fingerprint", "ingestion_run_id",
            "created_at",
        ),
    ),
    (
        "report_bd_private.portal_user_directions_private",
        (
            "source_snapshot_id", "raw_user_id", "raw_user_id_hash",
            "normalized_direction", "normalized_specialization", "created_at",
            "updated_at",
        ),
    ),
    (
        "report_bd_private.portal_bitrix_page_facts",
        (
            "source_snapshot_id", "analytics_account_id", "report_date",
            "normalized_path", "normalized_path_hash", "material_id",
            "material_type_hint", "pageviews", "sessions", "users", "guests",
            "logged_in_hits", "anonymous_hits", "logged_in_sessions",
            "anonymous_sessions", "entry_sessions", "exit_sessions",
            "avg_session_duration_seconds", "top_utm_source", "top_utm_medium",
            "top_utm_campaign", "source_row_fingerprint", "created_at",
        ),
    ),
    (
        "report_bd_private.portal_bitrix_journeys_private",
        (
            "source_snapshot_id", "analytics_account_id", "report_date", "raw_user_id",
            "raw_user_id_hash", "protected_visit_id", "protected_visit_id_hash",
            "source_event_id", "source_event_id_hash", "event_sequence", "event_at",
            "normalized_path", "normalized_path_hash", "event_kind",
            "source_row_fingerprint", "created_at",
        ),
    ),
)


def _copy_non_content_facts(cur, predecessor_id: int, candidate_id: int) -> dict[str, int]:
    copied: dict[str, int] = {}
    for table, columns in _NON_CONTENT_RELEASE_TABLES:
        cur.execute(
            f"SELECT COUNT(*) AS source_row_count FROM {table} WHERE canonical_release_id = %s",
            (predecessor_id,),
        )
        row = cur.fetchone()
        expected = int(_row_value(row, "source_row_count", 0) or 0)
        column_sql = ", ".join(columns)
        cur.execute(
            f"INSERT INTO {table} (canonical_release_id, {column_sql}) "
            f"SELECT %s, {column_sql} FROM {table} WHERE canonical_release_id = %s",
            (candidate_id, predecessor_id),
        )
        if int(getattr(cur, "rowcount", -1)) != expected:
            raise CandidateMaterializationError("NON_CONTENT_COPY_COUNT_MISMATCH")
        copied[table] = expected
    return copied


def _close(cursor, connection) -> None:
    if cursor is not None:
        try:
            cursor.close()
        except Exception:
            pass
    if connection is not None:
        try:
            connection.close()
        except Exception:
            pass


def materialize_content_candidate(
    batch_id: int,
    predecessor_release_id: int,
    code_revision: str,
) -> CandidateMaterialization:
    """Create an all-or-nothing staging successor; never validate or activate it."""

    try:
        batch_id = int(batch_id)
        predecessor_release_id = int(predecessor_release_id)
    except (TypeError, ValueError):
        raise CandidateMaterializationError("CANDIDATE_INPUT_INVALID") from None
    if batch_id <= 0 or predecessor_release_id <= 0:
        raise CandidateMaterializationError("CANDIDATE_INPUT_INVALID")
    if not isinstance(code_revision, str) or not re.fullmatch(
        r"[0-9a-f]{7,64}", code_revision
    ):
        raise CandidateMaterializationError("CANDIDATE_INPUT_INVALID")

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT active.canonical_release_id,
                   predecessor.baseline_validation_run_id,
                   predecessor.source_snapshot_ids,
                   predecessor.release_status
            FROM portal_active_data_releases AS active
            INNER JOIN portal_data_releases AS predecessor
              ON predecessor.dataset_key = active.dataset_key
             AND predecessor.id = active.canonical_release_id
            WHERE active.dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        predecessor = cursor.fetchone()
        if (
            not isinstance(predecessor, Mapping)
            or int(predecessor.get("canonical_release_id") or 0)
            != predecessor_release_id
            or predecessor.get("release_status") != "active"
            or int(predecessor.get("baseline_validation_run_id") or 0) <= 0
        ):
            raise CandidateMaterializationError("ACTIVE_PREDECESSOR_MISMATCH")
        predecessor_source_ids = _decode_json(
            predecessor.get("source_snapshot_ids"), code="SOURCE_SNAPSHOT_SET_INVALID"
        )
        if (
            not isinstance(predecessor_source_ids, list)
            or not predecessor_source_ids
            or any(
                not isinstance(value, int)
                or isinstance(value, bool)
                or value <= 0
                for value in predecessor_source_ids
            )
            or len(set(predecessor_source_ids)) != len(predecessor_source_ids)
        ):
            raise CandidateMaterializationError("SOURCE_SNAPSHOT_SET_INVALID")

        cursor.execute(
            """
            SELECT batch.id, batch.batch_status, batch.accepted_decision_hash,
                   batch.accepted_count, batch.ready_count, batch.conflict_count,
                   batch.unresolved_count, batch.rejected_count,
                   batch.no_change_count, batch.taxonomy_version_id,
                   batch.accepted_at
            FROM portal_content_approval_batches AS batch
            WHERE batch.id = %s AND batch.dataset_key = %s
            FOR UPDATE
            """,
            (batch_id, DATASET_KEY),
        )
        batch = cursor.fetchone()
        if (
            not isinstance(batch, Mapping)
            or int(batch.get("id") or 0) != batch_id
            or batch.get("batch_status") != "ingested"
            or len(str(batch.get("accepted_decision_hash") or "")) != 64
            or batch.get("accepted_at") is None
        ):
            raise CandidateMaterializationError("BATCH_NOT_INGESTED")

        cursor.execute(
            """
            SELECT COUNT(*) AS strong_collision_count
            FROM (
              SELECT alias_type, alias_hash, uniqueness_scope
              FROM portal_content_registry_aliases
              WHERE dataset_key = %s
                AND alias_status = 'active'
                AND alias_type IN ('material_id', 'canonical_url', 'url')
              GROUP BY alias_type, alias_hash, uniqueness_scope
              HAVING COUNT(DISTINCT content_entity_id) <> 1
            ) AS collisions
            """,
            (DATASET_KEY,),
        )
        collision = cursor.fetchone()
        if int(_row_value(collision, "strong_collision_count", 0) or 0) != 0:
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")

        cursor.execute(
            """
            WITH latest_events AS (
              SELECT event.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY event.content_entity_id
                       ORDER BY event.effective_at DESC, event.id DESC
                     ) AS row_rank
              FROM portal_content_classification_events AS event
              WHERE event.effective_at <= %s
                AND event.event_kind IN ('baseline', 'approve', 'correct')
            )
            SELECT entity.id AS content_entity_id, entity.material_id,
                   entity.title, entity.canonical_url, entity.source_evidence,
                   event.id AS classification_event_id,
                   event.direction_code, event.material_type_code,
                   event.access_code, event.lifecycle_code, event.event_kind,
                   event.event_fingerprint, event.approval_batch_id,
                   event.effective_at
            FROM latest_events AS event
            INNER JOIN portal_content_registry_entities AS entity
              ON entity.id = event.content_entity_id
             AND entity.dataset_key = %s
             AND entity.registry_status = 'active'
            WHERE event.row_rank = 1
            ORDER BY entity.id
            """,
            (batch["accepted_at"], DATASET_KEY),
        )
        effective_rows = tuple(cursor.fetchall())
        if any(not isinstance(row, Mapping) for row in effective_rows):
            raise CandidateMaterializationError("EFFECTIVE_CLASSIFICATION_INVALID")
        catalog_rows = _catalog_rows(effective_rows)  # type: ignore[arg-type]
        if not catalog_rows:
            raise CandidateMaterializationError("EMPTY_CONTENT_CANDIDATE")
        lookup_rows = build_lookup_projection(catalog_rows)
        catalog_payloads = tuple(_catalog_payload(row) for row in catalog_rows)
        lookup_payloads = tuple(_lookup_payload(row) for row in lookup_rows)
        catalog_hash = _hash_rows(catalog_payloads)
        lookup_hash = _hash_rows(lookup_payloads)

        cursor.execute(
            """
            SELECT id, source_kind
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id IN ({})
            ORDER BY id
            """.format(", ".join(["%s"] * len(predecessor_source_ids))),
            (DATASET_KEY, *predecessor_source_ids),
        )
        snapshot_rows = tuple(cursor.fetchall())
        snapshot_kind_by_id = {
            int(_row_value(row, "id", 0)): str(_row_value(row, "source_kind", 1))
            for row in snapshot_rows
        }
        if set(snapshot_kind_by_id) != set(predecessor_source_ids):
            raise CandidateMaterializationError("SOURCE_SNAPSHOT_SET_INVALID")
        old_catalog_ids = [
            snapshot_id
            for snapshot_id, kind in snapshot_kind_by_id.items()
            if kind == CATALOG_SOURCE_KIND
        ]
        if len(old_catalog_ids) != 1:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_SET_INVALID")

        cursor.execute(
            """
            SELECT source_snapshot_id, source_kind, imported_row_count,
                   rejected_row_count
            FROM portal_release_source_imports
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id
            """,
            (predecessor_release_id,),
        )
        import_rows = tuple(cursor.fetchall())
        if {
            int(_row_value(row, "source_snapshot_id", 0)) for row in import_rows
        } != set(predecessor_source_ids):
            raise CandidateMaterializationError("SOURCE_IMPORT_SET_INVALID")

        candidate_id = release_store.create_candidate_release(
            portal_key=DATASET_KEY,
            predecessor_release_id=predecessor_release_id,
            baseline_validation_run_id=int(predecessor["baseline_validation_run_id"]),
            code_revision=code_revision,
            connection=connection,
        )
        mutable = release_store.require_mutable_candidate_release(
            candidate_id,
            portal_key=DATASET_KEY,
            connection=connection,
        )
        if int(mutable.get("id") or 0) != candidate_id:
            raise CandidateMaterializationError("CANDIDATE_NOT_MUTABLE")

        manifest = {
            "accepted_decision_hash": str(batch["accepted_decision_hash"]),
            "batch_id": batch_id,
            "catalog_hash": catalog_hash,
            "content_sha256": catalog_hash,
            "code_revision": code_revision,
            "content_bytes": len(_canonical_json(catalog_payloads).encode("utf-8")),
            "lookup_hash": lookup_hash,
            "lookup_row_count": len(lookup_rows),
            "parser_version": CATALOG_PARSER_VERSION,
            "predecessor_release_id": predecessor_release_id,
            "rejected_count": 0,
            "source_kind": CATALOG_SOURCE_KIND,
            "source_row_count": len(catalog_rows),
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
              'imported', %s, 0, %s, %s, NOW()
            )
            """,
            (
                DATASET_KEY,
                CATALOG_SOURCE_KIND,
                f"canonical://abbott/content-batch/{batch_id}",
                catalog_hash,
                manifest["content_bytes"],
                len(catalog_rows),
                CATALOG_PARSER_VERSION,
                len(catalog_rows),
                f"canonical://abbott/content-batch/{batch_id}",
                _canonical_json(manifest),
            ),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_INSERT_FAILED")
        catalog_snapshot_id = int(cursor.lastrowid)
        if catalog_snapshot_id <= 0:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_INSERT_FAILED")

        source_snapshot_ids = tuple(
            catalog_snapshot_id if value == old_catalog_ids[0] else value
            for value in predecessor_source_ids
        )
        if sum(value == catalog_snapshot_id for value in source_snapshot_ids) != 1:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_SET_INVALID")
        cursor.execute(
            """
            UPDATE portal_data_releases
            SET source_snapshot_ids = %s
            WHERE dataset_key = %s AND id = %s AND release_status = 'staging'
            """,
            (_canonical_json(source_snapshot_ids), DATASET_KEY, candidate_id),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("CANDIDATE_NOT_MUTABLE")

        for row in import_rows:
            source_id = int(_row_value(row, "source_snapshot_id", 0))
            if source_id == old_catalog_ids[0]:
                continue
            source_kind = str(_row_value(row, "source_kind", 1))
            imported_count = int(_row_value(row, "imported_row_count", 2) or 0)
            rejected_count = int(_row_value(row, "rejected_row_count", 3) or 0)
            cursor.execute(
                """
                INSERT INTO portal_release_source_imports (
                  canonical_release_id, source_snapshot_id, source_kind,
                  code_revision, import_status, imported_row_count,
                  rejected_row_count, imported_at
                ) VALUES (%s, %s, %s, %s, 'imported', %s, %s, NOW())
                """,
                (
                    candidate_id,
                    source_id,
                    source_kind,
                    code_revision,
                    imported_count,
                    rejected_count,
                ),
            )
            if int(getattr(cursor, "rowcount", -1)) != 1:
                raise CandidateMaterializationError("SOURCE_IMPORT_COPY_MISMATCH")
        cursor.execute(
            """
            INSERT INTO portal_release_source_imports (
              canonical_release_id, source_snapshot_id, source_kind,
              code_revision, import_status, imported_row_count,
              rejected_row_count, imported_at
            ) VALUES (%s, %s, %s, %s, 'imported', %s, 0, NOW())
            """,
            (
                candidate_id,
                catalog_snapshot_id,
                CATALOG_SOURCE_KIND,
                code_revision,
                len(catalog_rows),
            ),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("SOURCE_IMPORT_COPY_MISMATCH")

        _copy_non_content_facts(cursor, predecessor_release_id, candidate_id)

        for payload in catalog_payloads:
            cursor.execute(
                """
                INSERT INTO portal_content_catalog (
                  canonical_release_id, source_snapshot_id,
                  normalized_url, normalized_url_hash, normalized_path,
                  page_title, material_id, material_type, source_slug,
                  source_slug_hash, access_label, is_active, source_sheet,
                  source_row_ordinal, source_row_fingerprint, section_key,
                  direction_key, published_at, valid_from, valid_to
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (candidate_id, catalog_snapshot_id, *payload),
            )
            if int(getattr(cursor, "rowcount", -1)) != 1:
                raise CandidateMaterializationError("CATALOG_COUNT_MISMATCH")

        for payload in lookup_payloads:
            cursor.execute(
                """
                INSERT INTO portal_content_lookup_projection (
                  canonical_release_id, source_snapshot_id, lookup_kind,
                  lookup_key_hash, candidate_count, metadata_signature_count,
                  resolution_status, selected_source_row_fingerprint,
                  group_fingerprint
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (candidate_id, catalog_snapshot_id, *payload),
            )
            if int(getattr(cursor, "rowcount", -1)) != 1:
                raise CandidateMaterializationError("LOOKUP_COUNT_MISMATCH")

        cursor.execute(
            """
            SELECT canonical_release_id, source_snapshot_id,
                   normalized_url, normalized_url_hash, normalized_path,
                   page_title, material_id, material_type, source_slug,
                   source_slug_hash, access_label, is_active, source_sheet,
                   source_row_ordinal, source_row_fingerprint, section_key,
                   direction_key, published_at, valid_from, valid_to
            FROM portal_content_catalog
            WHERE canonical_release_id = %s AND source_snapshot_id = %s
            ORDER BY source_sheet, source_row_ordinal
            """,
            (candidate_id, catalog_snapshot_id),
        )
        catalog_names = (
            "canonical_release_id",
            "source_snapshot_id",
            "normalized_url",
            "normalized_url_hash",
            "normalized_path",
            "page_title",
            "material_id",
            "material_type",
            "source_slug",
            "source_slug_hash",
            "access_label",
            "is_active",
            "source_sheet",
            "source_row_ordinal",
            "source_row_fingerprint",
            "section_key",
            "direction_key",
            "published_at",
            "valid_from",
            "valid_to",
        )
        stored_catalog = tuple(
            _ordered_row(row, catalog_names) for row in cursor.fetchall()
        )
        if (
            len(stored_catalog) != len(catalog_payloads)
            or _hash_rows(row[2:] for row in stored_catalog) != catalog_hash
        ):
            raise CandidateMaterializationError("CATALOG_HASH_MISMATCH")

        cursor.execute(
            """
            SELECT lookup_kind, lookup_key_hash, candidate_count,
                   metadata_signature_count, resolution_status,
                   selected_source_row_fingerprint, group_fingerprint
            FROM portal_content_lookup_projection
            WHERE canonical_release_id = %s AND source_snapshot_id = %s
            ORDER BY lookup_kind, lookup_key_hash
            """,
            (candidate_id, catalog_snapshot_id),
        )
        lookup_names = (
            "lookup_kind",
            "lookup_key_hash",
            "candidate_count",
            "metadata_signature_count",
            "resolution_status",
            "selected_source_row_fingerprint",
            "group_fingerprint",
        )
        stored_lookup = tuple(
            _ordered_row(row, lookup_names) for row in cursor.fetchall()
        )
        if len(stored_lookup) != len(lookup_payloads) or _hash_rows(stored_lookup) != lookup_hash:
            raise CandidateMaterializationError("LOOKUP_HASH_MISMATCH")

        cursor.execute(
            """
            UPDATE portal_content_approval_batches
            SET batch_status = 'candidate_materialized',
                candidate_release_id = %s,
                activation_status = 'candidate'
            WHERE id = %s AND dataset_key = %s AND batch_status = 'ingested'
            """,
            (candidate_id, batch_id, DATASET_KEY),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("BATCH_STATUS_TRANSITION_INVALID")
        connection.commit()
        return CandidateMaterialization(
            batch_id=batch_id,
            predecessor_release_id=predecessor_release_id,
            candidate_release_id=candidate_id,
            catalog_snapshot_id=catalog_snapshot_id,
            catalog_row_count=len(catalog_rows),
            lookup_row_count=len(lookup_rows),
            catalog_hash=catalog_hash,
            lookup_hash=lookup_hash,
            source_snapshot_ids=source_snapshot_ids,
        )
    except CandidateMaterializationError:
        if connection is not None:
            connection.rollback()
        raise
    except release_store.ReleaseStoreError as exc:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError(str(exc)) from None
    except Exception:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError("CANDIDATE_MATERIALIZATION_FAILED") from None
    finally:
        _close(cursor, connection)


def _decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _candidate_hashes_match(
    cursor,
    *,
    candidate_release_id: int,
    accepted_hash: str,
) -> bool:
    cursor.execute(
        """
        SELECT snapshot.id AS catalog_snapshot_id,
               snapshot.content_sha256, snapshot.manifest_json,
               batch.accepted_decision_hash
        FROM portal_data_releases AS release
        INNER JOIN portal_content_approval_batches AS batch
          ON batch.candidate_release_id = release.id
         AND batch.dataset_key = release.dataset_key
        INNER JOIN portal_dataset_snapshots AS snapshot
          ON snapshot.dataset_key = release.dataset_key
         AND snapshot.source_kind = 'abbott_workbook_catalog'
         AND JSON_CONTAINS(release.source_snapshot_ids, CAST(snapshot.id AS JSON))
        WHERE release.dataset_key = %s AND release.id = %s
        """,
        (DATASET_KEY, candidate_release_id),
    )
    metadata = cursor.fetchone()
    if not isinstance(metadata, Mapping):
        return False
    try:
        snapshot_id = int(metadata["catalog_snapshot_id"])
        manifest = _decode_json(
            metadata.get("manifest_json"), code="CATALOG_MANIFEST_INVALID"
        )
    except (KeyError, TypeError, ValueError, CandidateMaterializationError):
        return False
    if not isinstance(manifest, Mapping):
        return False

    cursor.execute(
        """
        SELECT canonical_release_id, source_snapshot_id,
               normalized_url, normalized_url_hash, normalized_path,
               page_title, material_id, material_type, source_slug,
               source_slug_hash, access_label, is_active, source_sheet,
               source_row_ordinal, source_row_fingerprint, section_key,
               direction_key, published_at, valid_from, valid_to
        FROM portal_content_catalog
        WHERE canonical_release_id = %s AND source_snapshot_id = %s
        ORDER BY source_sheet, source_row_ordinal
        """,
        (candidate_release_id, snapshot_id),
    )
    catalog_names = (
        "canonical_release_id", "source_snapshot_id", "normalized_url",
        "normalized_url_hash", "normalized_path", "page_title", "material_id",
        "material_type", "source_slug", "source_slug_hash", "access_label",
        "is_active", "source_sheet", "source_row_ordinal",
        "source_row_fingerprint", "section_key", "direction_key",
        "published_at", "valid_from", "valid_to",
    )
    stored_catalog = tuple(
        _ordered_row(row, catalog_names) for row in cursor.fetchall()
    )

    cursor.execute(
        """
        SELECT lookup_kind, lookup_key_hash, candidate_count,
               metadata_signature_count, resolution_status,
               selected_source_row_fingerprint, group_fingerprint
        FROM portal_content_lookup_projection
        WHERE canonical_release_id = %s AND source_snapshot_id = %s
        ORDER BY lookup_kind, lookup_key_hash
        """,
        (candidate_release_id, snapshot_id),
    )
    lookup_names = (
        "lookup_kind", "lookup_key_hash", "candidate_count",
        "metadata_signature_count", "resolution_status",
        "selected_source_row_fingerprint", "group_fingerprint",
    )
    stored_lookup = tuple(
        _ordered_row(row, lookup_names) for row in cursor.fetchall()
    )
    catalog_hash = _hash_rows(row[2:] for row in stored_catalog)
    lookup_hash = _hash_rows(stored_lookup)
    try:
        expected_catalog_count = int(manifest["source_row_count"])
        expected_lookup_count = int(manifest["lookup_row_count"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        len(stored_catalog) == expected_catalog_count
        and len(stored_lookup) == expected_lookup_count
        and catalog_hash == str(manifest.get("catalog_hash") or "")
        and catalog_hash == str(metadata.get("content_sha256") or "")
        and lookup_hash == str(manifest.get("lookup_hash") or "")
        and accepted_hash == str(manifest.get("accepted_decision_hash") or "")
        and accepted_hash == str(metadata.get("accepted_decision_hash") or "")
    )


def validate_content_candidate(
    candidate_release_id: int,
    expected_counts: Mapping[str, int],
    accepted_hash: str,
) -> GateReport:
    """Return the ten-gate report without changing release or active status."""

    if (
        not isinstance(candidate_release_id, int)
        or isinstance(candidate_release_id, bool)
        or candidate_release_id <= 0
        or not isinstance(accepted_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", accepted_hash)
    ):
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_INPUT_INVALID")
    try:
        normalized_counts = {
            str(key): int(value) for key, value in expected_counts.items()
        }
    except (AttributeError, TypeError, ValueError):
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_INPUT_INVALID") from None
    required_counts = {
        "source",
        "ready",
        "conflict",
        "unresolved",
        "rejected",
        "accepted",
    }
    allowed_counts = required_counts | {"no_change"}
    if (
        not required_counts.issubset(normalized_counts)
        or not set(normalized_counts).issubset(allowed_counts)
        or any(value < 0 for value in normalized_counts.values())
    ):
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_INPUT_INVALID")

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        connection.start_transaction()
        release_store.require_mutable_candidate_release(
            candidate_release_id,
            portal_key=DATASET_KEY,
            connection=connection,
        )
        cursor = connection.cursor(dictionary=True)
        # The scalar result is deliberately read-only.  Percentages are
        # persisted-data reconciliations, never rounded estimates.
        strict_schema_sql = _strict_proposal_evidence_sql()
        cursor.execute(
            f"""
            SELECT
              COALESCE(gates.anti_flip_violations, 0) AS anti_flip_violations,
              COALESCE(gates.strong_identity_collisions, 0) AS strong_identity_collisions,
              COALESCE(gates.out_of_taxonomy_values, 0) AS out_of_taxonomy_values,
              COALESCE(gates.archive_material_types, 0) AS archive_material_types,
              COALESCE(gates.unresolved_accepted_conflicts, 0) AS unresolved_accepted_conflicts,
              COALESCE(gates.active_release_mutations, 0) AS active_release_mutations,
              COALESCE(gates.dashboard_smoke_failures, 0) AS dashboard_smoke_failures,
              COALESCE(gates.source_reconciliation_pct, 0) AS source_reconciliation_pct,
              COALESCE(gates.count_reconciliation_pct, 0) AS count_reconciliation_pct,
              COALESCE(gates.hash_reconciliation_pct, 0) AS hash_reconciliation_pct,
              COALESCE(gates.schema_compliance_pct, 0) AS schema_compliance_pct,
              gates.actual_source_count,
              gates.actual_ready_count,
              gates.actual_conflict_count,
              gates.actual_unresolved_count,
              gates.actual_rejected_count,
              gates.actual_no_change_count,
              gates.actual_accepted_count
            FROM (
              SELECT
                SUM(CASE WHEN event.event_kind <> 'correct'
                              AND predecessor.direction_code IS NOT NULL
                              AND predecessor.direction_code <> event.direction_code
                         THEN 1 ELSE 0 END) AS anti_flip_violations,
                (SELECT COUNT(*) FROM (
                   SELECT alias_type, alias_hash, uniqueness_scope
                   FROM portal_content_registry_aliases
                   WHERE dataset_key = 'abbott'
                     AND alias_status = 'active'
                     AND alias_type IN ('material_id', 'canonical_url', 'url')
                   GROUP BY alias_type, alias_hash, uniqueness_scope
                   HAVING COUNT(DISTINCT content_entity_id) <> 1
                 ) AS strong_collisions) AS strong_identity_collisions,
                SUM(CASE WHEN item.readiness_state = 'ready'
                              AND (direction.term_code IS NULL
                               OR material.term_code IS NULL
                               OR access.term_code IS NULL
                               OR lifecycle.term_code IS NULL)
                         THEN 1 ELSE 0 END) AS out_of_taxonomy_values,
                SUM(CASE WHEN LOWER(COALESCE(item.final_material_type_code, ''))
                                   IN ('archive', 'архив')
                         THEN 1 ELSE 0 END) AS archive_material_types,
                SUM(CASE WHEN item.readiness_state = 'ready'
                               AND (item.conflict_code IS NOT NULL
                                    OR item.content_entity_id IS NULL)
                         THEN 1 ELSE 0 END) AS unresolved_accepted_conflicts,
                CASE WHEN active.canonical_release_id <> release.rollback_from_release_id
                           OR predecessor_release.release_status <> 'active'
                           OR batch.batch_status <> 'candidate_materialized'
                           OR batch.activation_status <> 'candidate'
                     THEN 1 ELSE 0 END AS active_release_mutations,
                CASE WHEN COUNT(catalog.id) > 0
                           AND COUNT(CASE WHEN catalog.direction_key IS NOT NULL THEN 1 END) > 0
                           AND COUNT(CASE WHEN catalog.material_type IS NOT NULL THEN 1 END) > 0
                     THEN 0 ELSE 1 END AS dashboard_smoke_failures,
                100 AS source_reconciliation_pct,
                100 AS count_reconciliation_pct,
                CASE WHEN batch.accepted_decision_hash = %s
                           AND snapshot.content_sha256 = JSON_UNQUOTE(
                               JSON_EXTRACT(snapshot.manifest_json, '$.catalog_hash'))
                     THEN 100 ELSE 0 END AS hash_reconciliation_pct,
                CASE WHEN SUM(CASE WHEN {strict_schema_sql} THEN 0 ELSE 1 END) = 0
                     THEN 100 ELSE 0 END AS schema_compliance_pct,
                batch.ready_count + batch.conflict_count
                  + batch.unresolved_count + batch.rejected_count
                  + batch.no_change_count AS actual_source_count,
                batch.ready_count AS actual_ready_count,
                batch.conflict_count AS actual_conflict_count,
                batch.unresolved_count AS actual_unresolved_count,
                batch.rejected_count AS actual_rejected_count,
                batch.no_change_count AS actual_no_change_count,
                batch.accepted_count AS actual_accepted_count
              FROM portal_data_releases AS release
              INNER JOIN portal_active_data_releases AS active
                ON active.dataset_key = release.dataset_key
              INNER JOIN portal_data_releases AS predecessor_release
                ON predecessor_release.id = release.rollback_from_release_id
               AND predecessor_release.dataset_key = release.dataset_key
              INNER JOIN portal_content_approval_batches AS batch
                ON batch.candidate_release_id = release.id
               AND batch.dataset_key = release.dataset_key
              INNER JOIN portal_dataset_snapshots AS snapshot
                ON snapshot.dataset_key = release.dataset_key
               AND snapshot.source_kind = 'abbott_workbook_catalog'
               AND JSON_CONTAINS(release.source_snapshot_ids, CAST(snapshot.id AS JSON))
              LEFT JOIN portal_content_approval_items AS item
                ON item.approval_batch_id = batch.id
              LEFT JOIN portal_content_classification_events AS event
                ON event.approval_batch_id = batch.id
               AND event.approval_item_id = item.id
              LEFT JOIN portal_content_classification_events AS predecessor
                ON predecessor.id = event.predecessor_event_id
              LEFT JOIN portal_content_taxonomy_terms AS direction
               ON direction.taxonomy_version_id = batch.taxonomy_version_id
               AND direction.taxonomy_kind = 'direction'
               AND direction.term_code = item.final_direction_code
              LEFT JOIN portal_content_taxonomy_terms AS material
               ON material.taxonomy_version_id = batch.taxonomy_version_id
               AND material.taxonomy_kind = 'material_type'
               AND material.term_code = item.final_material_type_code
              LEFT JOIN portal_content_taxonomy_terms AS access
               ON access.taxonomy_version_id = batch.taxonomy_version_id
               AND access.taxonomy_kind = 'access'
               AND access.term_code = item.final_access_code
              LEFT JOIN portal_content_taxonomy_terms AS lifecycle
               ON lifecycle.taxonomy_version_id = batch.taxonomy_version_id
               AND lifecycle.taxonomy_kind = 'lifecycle'
               AND lifecycle.term_code = item.final_lifecycle_code
              LEFT JOIN portal_content_catalog AS catalog
                ON catalog.canonical_release_id = release.id
              WHERE release.dataset_key = %s AND release.id = %s
              GROUP BY release.id, release.rollback_from_release_id,
                       predecessor_release.release_status,
                       active.canonical_release_id, batch.id,
                       batch.ready_count, batch.conflict_count,
                       batch.unresolved_count, batch.rejected_count,
                       batch.no_change_count, batch.accepted_count,
                       batch.accepted_decision_hash,
                       batch.batch_status, batch.activation_status,
                       snapshot.id, snapshot.content_sha256,
                       snapshot.manifest_json
            ) AS gates
            """,
            (
                accepted_hash,
                DATASET_KEY,
                candidate_release_id,
            ),
        )
        row = cursor.fetchone()
        if not isinstance(row, Mapping):
            raise CandidateMaterializationError("CANDIDATE_GATE_EVIDENCE_MISSING")
        actual_counts = {
            name: int(row.get(f"actual_{name}_count") or 0)
            for name in (
                "source",
                "ready",
                "conflict",
                "unresolved",
                "rejected",
                "no_change",
                "accepted",
            )
        }
        source_pct = (
            EXACT_PERCENT
            if actual_counts["source"] == normalized_counts["source"]
            else Decimal("0")
        )
        compared_count_names = required_counts - {"source"}
        if "no_change" in normalized_counts:
            compared_count_names.add("no_change")
        count_pct = (
            EXACT_PERCENT
            if all(
                actual_counts[name] == normalized_counts[name]
                for name in compared_count_names
            )
            else Decimal("0")
        )
        hash_pct = (
            EXACT_PERCENT
            if _candidate_hashes_match(
                cursor,
                candidate_release_id=candidate_release_id,
                accepted_hash=accepted_hash,
            )
            else Decimal("0")
        )
        report = GateReport(
            candidate_release_id=candidate_release_id,
            source_reconciliation_pct=source_pct,
            count_reconciliation_pct=count_pct,
            hash_reconciliation_pct=hash_pct,
            schema_compliance_pct=_decimal(row.get("schema_compliance_pct")),
            anti_flip_violations=int(row.get("anti_flip_violations") or 0),
            strong_identity_collisions=int(row.get("strong_identity_collisions") or 0),
            out_of_taxonomy_values=int(row.get("out_of_taxonomy_values") or 0),
            archive_material_types=int(row.get("archive_material_types") or 0),
            unresolved_accepted_conflicts=int(row.get("unresolved_accepted_conflicts") or 0),
            active_release_mutations=int(row.get("active_release_mutations") or 0),
            dashboard_smoke_failures=int(row.get("dashboard_smoke_failures") or 0),
        )
        connection.rollback()
        return report
    except CandidateMaterializationError:
        if connection is not None:
            connection.rollback()
        raise
    except release_store.ReleaseStoreError as exc:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError(str(exc)) from None
    except Exception:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_FAILED") from None
    finally:
        _close(cursor, connection)
