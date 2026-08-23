"""Transactional Abbott content successor materialization and hard gates.

This module constructs and attests a staging successor.  Its reviewed validate
boundary may transition ``staging`` to ``validated`` through the dedicated
release-operator role; activation and active-pointer changes remain out of scope.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import uuid
from typing import Iterable, Mapping, Sequence
from urllib.parse import urlsplit

import canonical_release_store as release_store
from canonical_writer import get_db_connection

from .approval_hashes import (
    ApprovalBatchItem,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_classification_event_fingerprint,
    compute_item_hash,
    compute_taxonomy_digest,
    compute_url_alias_decision_event_fingerprint,
)
from .domain import ApprovalItem, ConflictCode
from .normalization import (
    normalize_observed_page_grouping_url,
    normalize_taxonomy_label,
    normalize_title,
    normalize_url,
    sha256_text,
)
from .workflow_repository import StrongUrlAlias, _load_active_strong_url_aliases
from .entity_continuity import (
    ContinuityError,
    EntityContinuity,
    build_entity_continuity,
)
from .mnn_projection import MnnProjectionError, project_mnn_records


DATASET_KEY = "abbott"
ABBOTT_COUNTER_ID = "90602537"
CATALOG_SOURCE_KIND = "abbott_workbook_catalog"
CATALOG_PARSER_VERSION = "abbott-content-candidate-v1"
MNN_SOURCE_KIND = "abbott_mnn_workbook"
EXACT_PERCENT = Decimal("100")
CONTENT_CONTROL_VALUES = {
    "content.source_reconciliation_pct": 100,
    "content.count_reconciliation_pct": 100,
    "content.hash_reconciliation_pct": 100,
    "content.schema_compliance_pct": 100,
    "content.anti_flip_violations": 0,
    "content.strong_identity_collisions": 0,
    "content.out_of_taxonomy_values": 0,
    "content.archive_material_types": 0,
    "content.unresolved_accepted_conflicts": 0,
    "content.active_release_mutations": 0,
    "content.dashboard_smoke_failures": 0,
    "content.fact_total_mismatches": 0,
    "content.content_unresolved": 0,
    "content.non_content_unresolved": 0,
}
SUCCESSOR_CONTROL_NAMES = (
    "content.accepted_classification_delta_count",
    "content.accepted_classification_delta_hash_match_pct",
    "content.entity_continuity_hash_match_pct",
    "content.mnn_mapping_count",
    "content.mnn_entity_count",
    "content.mnn_hash_match_pct",
    "content.mnn_snapshot_match_pct",
)
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
_CATALOG_COLUMNS = (
    "normalized_url", "normalized_url_hash", "normalized_path", "page_title",
    "material_id", "material_type", "source_slug", "source_slug_hash",
    "access_label", "is_active", "source_sheet", "source_row_ordinal",
    "source_row_fingerprint", "section_key", "direction_key", "published_at",
    "valid_from", "valid_to", "content_entity_id", "classification_event_id",
    "classification_event_fingerprint", "projection_provenance_json",
    "projection_row_hash",
)
_PREDECESSOR_CATALOG_COLUMNS = ("id", *_CATALOG_COLUMNS)
_LOOKUP_COLUMNS = (
    "lookup_kind", "lookup_key_hash", "candidate_count",
    "metadata_signature_count", "resolution_status",
    "selected_source_row_fingerprint", "group_fingerprint",
)
_SNAPSHOT_COLUMNS = (
    "id", "source_kind", "content_sha256", "content_bytes", "parser_version",
    "import_status", "imported_row_count", "rejected_row_count", "manifest_json",
    "source_row_count",
)
_IMPORT_COLUMNS = (
    "source_snapshot_id", "source_kind", "imported_row_count",
    "rejected_row_count", "import_status", "code_revision",
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
    classification_event_id: int | None
    classification_event_fingerprint: str | None
    direction_code: str | None = None
    material_type_code: str | None = None
    access_code: str | None = None
    lifecycle_code: str | None = None
    lifecycle_label: str | None = None
    provenance_mode: str = "current_batch_event"
    predecessor_catalog_row_id: int | None = None
    baseline_provenance_fingerprint: str | None = None


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
    baseline_snapshot_id: int = 0
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
    fact_total_mismatches: int = 0
    content_unresolved: int = 0
    non_content_unresolved: int = 0
    successor_controls: tuple[tuple[str, Decimal, Decimal], ...] = ()
    fact_total_controls: tuple[tuple[str, Decimal, Decimal], ...] = ()

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
            self.fact_total_mismatches,
            self.content_unresolved,
            self.non_content_unresolved,
        )
        try:
            successor_controls = _validated_successor_controls(
                self.successor_controls
            )
        except CandidateMaterializationError:
            return False
        return (
            all(value == EXACT_PERCENT for value in percentages)
            and all(value == 0 for value in failures)
            and all(expected == actual for _name, expected, actual in successor_controls)
        )


@dataclass(frozen=True)
class ClassificationDeltaReceipt:
    expected_count: int
    actual_count: int
    expected_hash: str
    actual_hash: str


def observed_page_resolution_gates(
    *,
    content_like_rows: Iterable[Mapping[str, object]],
    non_content_rows: Iterable[Mapping[str, object]],
) -> dict[str, int]:
    """Return aggregate-only unresolved observed-page counts.

    Callers must pass query results containing only classification fields and
    reviewed-exclusion counts; URLs, visitors, and visit identifiers are never
    accepted into publication evidence.
    """

    content_unresolved = sum(
        not str(row.get("direction_key") or "").strip()
        or not str(row.get("material_type") or "").strip()
        for row in content_like_rows
    )
    non_content_unresolved = sum(
        str(row.get("material_type") or "").strip() != "service_page"
        and int(row.get("reviewed_exclusion_count") or 0) <= 0
        for row in non_content_rows
    )
    return {
        "content_unresolved": content_unresolved,
        "non_content_unresolved": non_content_unresolved,
    }


_METADATA_FACT_PERIODS = (("2026-06-01", "2026-06-30"), ("2026-07-01", "2026-07-31"), ("2026-08-01", "2026-08-09"))
_METADATA_FACT_METRICS = ("sessions", "users", "pageviews", "goal_conversions")
FACT_TOTAL_CONTROL_NAMES = tuple(
    f"fact_totals.{start}.{end}.{metric}"
    for start, end in _METADATA_FACT_PERIODS
    for metric in _METADATA_FACT_METRICS
)


def _validated_fact_total_controls(
    controls: Iterable[tuple[str, Decimal, Decimal]],
) -> tuple[tuple[str, Decimal, Decimal], ...]:
    """Require the complete fixed fact-control set before evidence is written."""
    normalized = tuple(controls)
    if (
        len(normalized) != len(FACT_TOTAL_CONTROL_NAMES)
        or {str(name) for name, _expected, _actual in normalized}
        != set(FACT_TOTAL_CONTROL_NAMES)
        or any(
            not isinstance(expected, Decimal) or not isinstance(actual, Decimal)
            for _name, expected, actual in normalized
        )
    ):
        raise CandidateMaterializationError("FACT_TOTAL_EVIDENCE_INVALID")
    return normalized


def _validated_successor_controls(
    controls: Iterable[tuple[str, Decimal, Decimal]],
) -> tuple[tuple[str, Decimal, Decimal], ...]:
    """Require the complete successor authority controls before validation."""

    normalized = tuple(controls)
    if (
        len(normalized) != len(SUCCESSOR_CONTROL_NAMES)
        or tuple(str(name) for name, _expected, _actual in normalized)
        != SUCCESSOR_CONTROL_NAMES
        or any(
            not isinstance(expected, Decimal) or not isinstance(actual, Decimal)
            for _name, expected, actual in normalized
        )
    ):
        raise CandidateMaterializationError(
            "SUCCESSOR_CONTROL_EVIDENCE_INVALID"
        )
    return normalized


def _metadata_fact_controls(cursor, predecessor_id: int, candidate_id: int) -> tuple[tuple[str, Decimal, Decimal], ...]:
    controls = []
    for start, end in _METADATA_FACT_PERIODS:
        for metric in _METADATA_FACT_METRICS:
            cursor.execute(
                f"SELECT COALESCE(SUM({metric}), 0) AS total FROM canonical_fact_metrika_site_analytics_daily WHERE canonical_release_id = %s AND counter_id = %s AND report_date BETWEEN %s AND %s",
                (predecessor_id, ABBOTT_COUNTER_ID, start, end),
            )
            try:
                predecessor = Decimal(str((_row_value(cursor.fetchone(), "total", 0) or 0)))
            except (Exception):
                predecessor = Decimal("0")
            cursor.execute(
                f"SELECT COALESCE(SUM({metric}), 0) AS total FROM canonical_fact_metrika_site_analytics_daily WHERE canonical_release_id = %s AND counter_id = %s AND report_date BETWEEN %s AND %s",
                (candidate_id, ABBOTT_COUNTER_ID, start, end),
            )
            try:
                candidate = Decimal(str((_row_value(cursor.fetchone(), "total", 0) or 0)))
            except (Exception):
                candidate = Decimal("0")
            controls.append((f"fact_totals.{start}.{end}.{metric}", predecessor, candidate))
    return tuple(controls)


def _observed_page_resolution_counts(cursor, candidate_id: int) -> tuple[int, int]:
    """Count unresolved observed pages from aggregate facts only.

    A non-content exception is an immutable, accepted ``reject`` URL-decision
    event for this candidate's approval batch.  Mutable registry aliases are
    deliberately not an exception authority.  The query returns only counts;
    no URL, visit, or user identifier is selected into gate evidence.
    """
    cursor.execute(
        """
        WITH raw_facts AS (
          SELECT canonical_release_id,
                 JSON_UNQUOTE(JSON_EXTRACT(
                   scope_dimensions, '$.page_url')) AS raw_url
          FROM canonical_fact_metrika_site_analytics_daily
          WHERE canonical_release_id = %s AND counter_id = %s
            AND analytics_scope = 'page'
        ), path_facts AS (
          SELECT canonical_release_id,
                 CASE
                   WHEN raw_url REGEXP '^https?://(www\\.)?abbottpro\\.ru([/?#]|$)'
                     THEN REGEXP_REPLACE(
                       SUBSTRING_INDEX(SUBSTRING_INDEX(raw_url, '?', 1), '#', 1),
                       '^[a-z][a-z0-9+.-]*://[^/]*', ''
                     )
                   WHEN raw_url NOT REGEXP '^[a-z][a-z0-9+.-]*://'
                     THEN SUBSTRING_INDEX(SUBSTRING_INDEX(raw_url, '?', 1), '#', 1)
                   ELSE NULL
                 END AS raw_path
          FROM raw_facts
        ), collapsed_paths AS (
          SELECT canonical_release_id,
                 CASE WHEN raw_path IS NULL THEN NULL
                      ELSE REGEXP_REPLACE(
                             REGEXP_REPLACE(raw_path, '/{2,}', '/'),
                             '^(/events)/[^/].*$', '$1'
                           ) END AS path_value
          FROM path_facts
        ), normalized_rows AS (
          SELECT canonical_release_id,
                 CASE WHEN path_value IS NULL THEN NULL ELSE
                   COALESCE(NULLIF(TRIM(TRAILING '/' FROM
                     CASE WHEN LEFT(path_value, 1) = '/' THEN path_value
                          ELSE CONCAT('/', path_value) END
                   ), ''), '/')
                 END AS normalized_path
          FROM collapsed_paths
        ), normalized_facts AS (
          SELECT canonical_release_id, normalized_path,
                 COUNT(*) AS fact_count
          FROM normalized_rows
          GROUP BY canonical_release_id, normalized_path
        ), eligible_facts AS (
          SELECT facts.*
          FROM normalized_facts AS facts
          WHERE facts.normalized_path IS NULL
             OR (
               facts.normalized_path NOT REGEXP
                 '(^|/)[a-z][a-z0-9+.-]*:/{1,2}'
               AND facts.normalized_path NOT REGEXP '(^|/)blob:'
               AND facts.normalized_path NOT LIKE '%…%'
               AND UPPER(facts.normalized_path) NOT REGEXP '%E2%80%A6'
             )
        )
        SELECT COALESCE(SUM((
                 facts.normalized_path IS NOT NULL
                 AND selected.source_row_fingerprint IS NOT NULL
                 AND (selected.material_type IS NULL
                      OR selected.material_type <> 'service_page')
                 AND (selected.direction_key IS NULL
                      OR TRIM(selected.direction_key) = ''
                      OR selected.material_type IS NULL
                      OR TRIM(selected.material_type) = '')
               ) * facts.fact_count), 0) AS content_unresolved,
               COALESCE(SUM((
                 facts.normalized_path IS NOT NULL
                 AND selected.source_row_fingerprint IS NULL
                 AND exclusion.id IS NULL
               ) * facts.fact_count), 0) AS non_content_unresolved
        FROM eligible_facts AS facts
        INNER JOIN portal_content_approval_batches AS candidate_batch
          ON candidate_batch.dataset_key = %s
         AND candidate_batch.candidate_release_id = facts.canonical_release_id
         AND candidate_batch.batch_status = 'candidate_materialized'
        INNER JOIN portal_release_source_imports AS catalog_import
          ON catalog_import.canonical_release_id = facts.canonical_release_id
         AND catalog_import.source_kind = 'abbott_workbook_catalog'
         AND catalog_import.import_status = 'imported'
        LEFT JOIN portal_content_lookup_projection AS exact_url
         ON exact_url.canonical_release_id = facts.canonical_release_id
         AND exact_url.source_snapshot_id = catalog_import.source_snapshot_id
         AND exact_url.lookup_kind = 'url'
         AND exact_url.lookup_key_hash = SHA2(
               CONCAT('https://abbottpro.ru', facts.normalized_path), 256)
         AND exact_url.resolution_status IN ('unique', 'identical_collapsed')
        LEFT JOIN portal_content_lookup_projection AS path_lookup
         ON path_lookup.canonical_release_id = facts.canonical_release_id
         AND path_lookup.source_snapshot_id = catalog_import.source_snapshot_id
         AND path_lookup.lookup_kind = 'path'
         AND path_lookup.lookup_key_hash = SHA2(facts.normalized_path, 256)
         AND path_lookup.resolution_status IN ('unique', 'identical_collapsed')
        LEFT JOIN portal_content_catalog AS selected
          ON selected.canonical_release_id = facts.canonical_release_id
         AND selected.source_snapshot_id = catalog_import.source_snapshot_id
         AND selected.source_row_fingerprint = COALESCE(
               exact_url.selected_source_row_fingerprint,
               path_lookup.selected_source_row_fingerprint)
        LEFT JOIN portal_content_url_alias_decision_events AS exclusion
          ON exclusion.approval_batch_id = candidate_batch.id
         AND exclusion.accepted_decision_hash = candidate_batch.accepted_decision_hash
         AND exclusion.url_alias_decision = 'reject'
         AND CHAR_LENGTH(TRIM(exclusion.decision_reason)) > 0
         AND SHA2(exclusion.normalized_url, 256) = SHA2(
               CONCAT('https://abbottpro.ru', facts.normalized_path), 256)
        """,
        (candidate_id, ABBOTT_COUNTER_ID, DATASET_KEY),
    )
    row = cursor.fetchone()
    try:
        content = int(_row_value(row, "content_unresolved", 0) or 0)
        non_content = int(_row_value(row, "non_content_unresolved", 1) or 0)
    except (TypeError, ValueError):
        # Test/dry-run cursors without observed facts represent zero rows.
        content, non_content = 0, 0
    return content, non_content


def _validate_reviewed_url_exclusions(cursor, candidate_id: int) -> None:
    """Verify every candidate-scoped reject event before it may exclude a URL."""
    cursor.execute(
        """
        SELECT exclusion.approval_batch_id, exclusion.approval_item_id,
               exclusion.accepted_decision_hash, exclusion.actor,
               exclusion.decision_reason, exclusion.normalized_url,
               exclusion.url_alias_decision, exclusion.selected_content_entity_id,
               exclusion.selected_predecessor_event_id,
               exclusion.selected_predecessor_event_fingerprint,
               exclusion.event_fingerprint
        FROM portal_content_url_alias_decision_events AS exclusion
        INNER JOIN portal_content_approval_batches AS batch
          ON batch.id = exclusion.approval_batch_id
         AND batch.dataset_key = %s
         AND batch.candidate_release_id = %s
         AND batch.batch_status = 'candidate_materialized'
         AND batch.accepted_decision_hash = exclusion.accepted_decision_hash
        WHERE exclusion.url_alias_decision = 'reject'
        ORDER BY exclusion.id
        """,
        (DATASET_KEY, candidate_id),
    )
    for row in cursor.fetchall():
        if not isinstance(row, Mapping):
            raise CandidateMaterializationError("REVIEWED_EXCLUSION_INVALID")
        try:
            batch_id = int(row["approval_batch_id"])
            item_id = int(row["approval_item_id"])
            normalized_url = str(row["normalized_url"])
            event_fingerprint = str(row["event_fingerprint"]).lower()
            selected_entity_id = row.get("selected_content_entity_id")
            predecessor_id = row.get("selected_predecessor_event_id")
            predecessor_fingerprint = row.get("selected_predecessor_event_fingerprint")
            if (
                batch_id <= 0 or item_id <= 0
                or row.get("url_alias_decision") != "reject"
                or selected_entity_id is not None
                or not str(row.get("decision_reason") or "").strip()
                or normalize_url(normalized_url).value != normalized_url
                or not re.fullmatch(r"[0-9a-f]{64}", event_fingerprint)
                or (predecessor_id is not None and int(predecessor_id) <= 0)
                or (predecessor_fingerprint is not None and not re.fullmatch(
                    r"[0-9a-f]{64}", str(predecessor_fingerprint).lower()
                ))
            ):
                raise ValueError
            expected = compute_url_alias_decision_event_fingerprint(
                accepted_decision_hash=row["accepted_decision_hash"],
                actor=row["actor"],
                approval_batch_id=batch_id,
                approval_item_id=item_id,
                decision_reason=row["decision_reason"],
                normalized_url=normalized_url,
                selected_content_entity_id=selected_entity_id,
                selected_predecessor_event_fingerprint=predecessor_fingerprint,
                selected_predecessor_event_id=predecessor_id,
                url_alias_decision=row["url_alias_decision"],
            )
            if expected != event_fingerprint:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise CandidateMaterializationError("REVIEWED_EXCLUSION_INVALID") from None


def validate_reviewed_url_alias_decisions(
    cursor,
    batch: Mapping[str, object],
    approval_rows_by_id: Mapping[int, Mapping[str, object]],
) -> None:
    """Re-attest accepted attach/retire/reject decisions and alias end state."""

    batch_id = int(batch.get("id") or 0)
    accepted_hash = str(batch.get("accepted_decision_hash") or "")
    actor = _normalized_audit_text(batch.get("accepted_by"))
    if batch_id <= 0 or not re.fullmatch(r"[0-9a-f]{64}", accepted_hash) or not actor:
        raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
    expected = {
        int(item_id): row
        for item_id, row in approval_rows_by_id.items()
        if row.get("url_alias_decision") in {"attach", "retire", "reject"}
    }
    cursor.execute(
        """
        SELECT id, approval_batch_id, approval_item_id, accepted_decision_hash,
               actor, decision_reason, normalized_url, url_alias_decision,
               selected_content_entity_id, selected_predecessor_event_id,
               selected_predecessor_event_fingerprint, event_fingerprint
        FROM portal_content_url_alias_decision_events
        WHERE approval_batch_id = %s
          AND url_alias_decision IN ('attach', 'retire', 'reject')
        ORDER BY id
        """,
        (batch_id,),
    )
    seen: set[int] = set()
    verified: list[tuple[str, str, int | None, int | None, str | None]] = []
    for row in cursor.fetchall():
        if not isinstance(row, Mapping):
            raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
        try:
            item_id = int(row["approval_item_id"])
            item = expected[item_id]
            decision = str(row["url_alias_decision"])
            selected_value = row.get("selected_content_entity_id")
            selected = int(selected_value) if selected_value is not None else None
            predecessor_value = row.get("selected_predecessor_event_id")
            predecessor_id = int(predecessor_value) if predecessor_value is not None else None
            predecessor_fingerprint_value = row.get(
                "selected_predecessor_event_fingerprint"
            )
            predecessor_fingerprint = (
                str(predecessor_fingerprint_value)
                if predecessor_fingerprint_value is not None
                else None
            )
            normalized_url = str(row["normalized_url"])
            reason = _normalized_audit_text(row.get("decision_reason"))
            fingerprint = str(row["event_fingerprint"]).lower()
            if (
                item_id in seen
                or int(row["approval_batch_id"]) != batch_id
                or row.get("accepted_decision_hash") != accepted_hash
                or _normalized_audit_text(row.get("actor")) != actor
                or decision != item.get("url_alias_decision")
                or selected != item.get("selected_content_entity_id")
                or normalize_url(str(item.get("url") or "")).value != normalized_url
                or not reason
                or reason != _normalized_audit_text(item.get("decision_reason"))
                or normalize_url(normalized_url).value != normalized_url
                or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
                or (decision == "attach" and (selected is None or selected <= 0))
                or (decision in {"retire", "reject"} and selected is not None)
                or (predecessor_id is not None and predecessor_id <= 0)
                or (
                    predecessor_fingerprint is not None
                    and not re.fullmatch(
                        r"[0-9a-f]{64}", predecessor_fingerprint.lower()
                    )
                )
            ):
                raise ValueError
            expected_fingerprint = compute_url_alias_decision_event_fingerprint(
                accepted_decision_hash=accepted_hash,
                actor=actor,
                approval_batch_id=batch_id,
                approval_item_id=item_id,
                decision_reason=reason,
                normalized_url=normalized_url,
                selected_content_entity_id=selected,
                selected_predecessor_event_id=predecessor_id,
                selected_predecessor_event_fingerprint=predecessor_fingerprint,
                url_alias_decision=decision,
            )
            if expected_fingerprint != fingerprint:
                raise ValueError
            seen.add(item_id)
            verified.append(
                (
                    decision,
                    normalized_url,
                    selected,
                    predecessor_id,
                    predecessor_fingerprint,
                )
            )
        except (KeyError, TypeError, ValueError):
            raise CandidateMaterializationError(
                "REVIEWED_URL_DECISION_INVALID"
            ) from None
    if seen != set(expected):
        raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
    for decision, normalized_url, selected, predecessor_id, predecessor_fingerprint in verified:
        alias_hash = sha256_text(normalized_url)
        cursor.execute(
            """SELECT content_entity_id, alias_status, source_evidence
               FROM portal_content_registry_aliases
               WHERE dataset_key = %s AND alias_type = 'url'
                 AND uniqueness_scope = 'strong' AND alias_hash = %s
               ORDER BY id""",
            (DATASET_KEY, alias_hash),
        )
        aliases = tuple(cursor.fetchall())
        active = tuple(
            row
            for row in aliases
            if str(_row_value(row, "alias_status", 1) or "") == "active"
        )
        if decision == "attach":
            if (
                len(active) != 1
                or int(_row_value(active[0], "content_entity_id", 0) or 0)
                != selected
            ):
                raise CandidateMaterializationError(
                    "REVIEWED_URL_DECISION_INVALID"
                )
            evidence = _decode_json(
                _row_value(active[0], "source_evidence", 2),
                code="REVIEWED_URL_DECISION_INVALID",
            )
            if (
                not isinstance(evidence, Mapping)
                or evidence.get("accepted_decision_hash") != accepted_hash
            ):
                raise CandidateMaterializationError(
                    "REVIEWED_URL_DECISION_INVALID"
                )
        elif active:
            raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
        if (predecessor_id is None) != (predecessor_fingerprint is None):
            raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
        if predecessor_id is None:
            continue
        owner = selected if decision == "attach" else (
            int(_row_value(aliases[0], "content_entity_id", 0) or 0)
            if aliases
            else 0
        )
        cursor.execute(
            """SELECT id, content_entity_id, event_fingerprint
               FROM portal_content_classification_events
               WHERE id = %s""",
            (predecessor_id,),
        )
        captured = cursor.fetchone()
        if (
            captured is None
            or int(_row_value(captured, "id", 0) or 0) != predecessor_id
            or int(_row_value(captured, "content_entity_id", 1) or 0) != owner
            or str(_row_value(captured, "event_fingerprint", 2) or "").lower()
            != predecessor_fingerprint.lower()
        ):
            raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")
        cursor.execute(
            """SELECT id, content_entity_id, event_fingerprint, approval_batch_id,
                      predecessor_event_id
               FROM portal_content_classification_events
               WHERE content_entity_id = %s
               ORDER BY effective_at DESC, id DESC
               LIMIT 1""",
            (owner,),
        )
        predecessor = cursor.fetchone()
        is_captured = (
            predecessor is not None
            and int(_row_value(predecessor, "id", 0) or 0) == predecessor_id
            and str(_row_value(predecessor, "event_fingerprint", 2) or "").lower()
            == predecessor_fingerprint.lower()
        )
        is_same_batch_successor = (
            predecessor is not None
            and int(_row_value(predecessor, "approval_batch_id", 3) or 0)
            == batch_id
            and int(_row_value(predecessor, "predecessor_event_id", 4) or 0)
            == predecessor_id
        )
        if (
            not (is_captured or is_same_batch_successor)
            or int(_row_value(predecessor, "content_entity_id", 1) or 0) != owner
        ):
            raise CandidateMaterializationError("REVIEWED_URL_DECISION_INVALID")


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
    return parsed.replace(microsecond=0)


def _canonical_ingestion_timestamp(value: object) -> datetime:
    """Mirror repository ingestion's UTC-naive acceptance timestamp."""

    try:
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, str) and ":" in value:
            iso_value = f"{value[:-1]}+00:00" if value.endswith("Z") else value
            parsed = datetime.fromisoformat(iso_value)
        else:
            raise ValueError
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.replace(tzinfo=None)
    except (OverflowError, TypeError, ValueError):
        raise CandidateMaterializationError(
            "CURRENT_BATCH_EVENT_UNAUTHORIZED"
        ) from None


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
      AND JSON_LENGTH(JSON_KEYS(item.proposal_evidence)) IN (9, 10)
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
      AND (
        NOT JSON_CONTAINS_PATH(item.proposal_evidence, 'one', '$.mnn')
        OR JSON_TYPE(JSON_EXTRACT(item.proposal_evidence, '$.mnn')) = 'ARRAY'
      )
    )"""


def _proposal_evidence_is_strict(value: object) -> bool:
    value = _decode_json(value, code="PROPOSAL_EVIDENCE_INVALID")
    expected = {
        "archive_attestation",
        "concise_evidence",
        "current_canonical",
        "deterministic",
        "published_decision",
        "registry1",
        "registry2",
        "sol",
        "terra",
    }
    if not isinstance(value, Mapping) or set(value) not in (expected, expected | {"mnn"}):
        return False
    if "mnn" in value and (
        not isinstance(value["mnn"], (list, tuple))
        or not value["mnn"]
        or any(not isinstance(item, str) or not item.strip() for item in value["mnn"])
        or tuple(value["mnn"]) != tuple(sorted(set(value["mnn"])))
    ):
        return False
    if any(
        value[name] is not None and not isinstance(value[name], Mapping)
        for name in _EVIDENCE_OBJECT_FIELDS
    ):
        return False
    if not isinstance(value["concise_evidence"], (list, tuple)) or any(
        not isinstance(item, str) for item in value["concise_evidence"]
    ):
        return False
    decision = value["published_decision"]
    decision_fields = {
        "decision_reason",
        "final_access_code",
        "final_direction_code",
        "final_lifecycle_code",
        "final_material_type_code",
    }
    if (
        not isinstance(decision, Mapping)
        or set(decision) != decision_fields
        or any(item is not None and not isinstance(item, str) for item in decision.values())
    ):
        return False
    for name in ("terra", "sol"):
        proposal = value[name]
        if proposal is None:
            continue
        if not isinstance(proposal, Mapping) or set(proposal) != set(_PROPOSAL_FIELDS):
            return False
        if any(
            proposal[field] is not None and not isinstance(proposal[field], str)
            for field in ("access_code", "direction_code", "lifecycle_code", "material_type_code")
        ):
            return False
        confidence = proposal["confidence"]
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not 0 <= confidence <= 1
        ):
            return False
        if not isinstance(proposal["rule_code"], str):
            return False
        evidence = proposal["evidence"]
        if not isinstance(evidence, (list, tuple)) or any(
            not isinstance(item, str) for item in evidence
        ):
            return False
    return True


def _load_approval_bundle(
    cursor, batch_id: int, batch: Mapping[str, object]
) -> dict[str, object]:
    cursor.execute(
        """
        SELECT taxonomy_kind, term_code, term_label
        FROM portal_content_taxonomy_terms
        WHERE taxonomy_version_id = %s
        ORDER BY taxonomy_kind, term_code
        """,
        (batch.get("taxonomy_version_id"),),
    )
    taxonomy_rows = tuple(cursor.fetchall())
    taxonomy_terms: dict[str, list[str]] = {
        "direction": [], "material_type": [], "access": [], "lifecycle": []
    }
    for term in taxonomy_rows:
        kind = str(_row_value(term, "taxonomy_kind", 0) or "")
        code = str(_row_value(term, "term_code", 1) or "")
        if kind in taxonomy_terms and code:
            taxonomy_terms[kind].append(code)
    frozen_taxonomy_terms = {
        kind: tuple(sorted(set(codes))) for kind, codes in taxonomy_terms.items()
    }
    source_snapshot_ids = _decode_json(
        batch.get("source_snapshot_ids"), code="APPROVAL_BUNDLE_INVALID"
    )
    source_snapshot_digests = _decode_json(
        batch.get("source_snapshot_digests"), code="APPROVAL_BUNDLE_INVALID"
    )
    if (
        not isinstance(source_snapshot_ids, list)
        or not isinstance(source_snapshot_digests, list)
        or len(source_snapshot_ids) != len(source_snapshot_digests)
    ):
        raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
    cursor.execute(
        """
        SELECT item.id, item.content_entity_id, item.input_hash, item.title, item.url,
               item.final_direction_code, item.final_material_type_code,
               item.final_access_code, item.final_lifecycle_code,
               item.readiness_state, item.conflict_code, item.conflict_codes, item.row_hash,
               item.decision_reason, item.proposal_evidence,
               item.selected_content_entity_id, item.url_alias_decision
        FROM portal_content_approval_items AS item
        WHERE item.approval_batch_id = %s
        ORDER BY item.content_entity_identity, item.input_hash
        """,
        (batch_id,),
    )
    rows = tuple(cursor.fetchall())
    counts = {
        "ready": 0,
        "conflict": 0,
        "unresolved": 0,
        "rejected": 0,
        "no_change": 0,
    }
    decisions: list[dict[str, object]] = []
    schema_failures = 0
    identity_collisions = 0
    unresolved_accepted = 0
    published_items: list[ApprovalBatchItem] = []
    accepted_items: list[ApprovalItem] = []
    approval_rows_by_id: dict[int, Mapping[str, object]] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        item_id = int(row.get("id") or 0)
        if item_id <= 0 or item_id in approval_rows_by_id:
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        approval_rows_by_id[item_id] = row
        state = str(row.get("readiness_state") or "")
        if state not in counts:
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        counts[state] += 1
        conflict_codes = _decode_json(
            row.get("conflict_codes") or [], code="APPROVAL_BUNDLE_INVALID"
        )
        if not isinstance(conflict_codes, (list, tuple)):
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        try:
            conflict_values = tuple(ConflictCode(str(code)) for code in conflict_codes)
        except (TypeError, ValueError):
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID") from None
        scalar_conflict = (
            str(row.get("conflict_code"))
            if row.get("conflict_code") is not None
            else None
        )
        first_conflict = conflict_values[0].value if conflict_values else None
        if scalar_conflict != first_conflict:
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        if state == "ready":
            identity_collisions += sum(
                code is ConflictCode.IDENTITY_COLLISION for code in conflict_values
            )
        if state == "ready" and (
            conflict_values or row.get("content_entity_id") is None
        ):
            unresolved_accepted += 1
        evidence = _decode_json(
            row.get("proposal_evidence"), code="APPROVAL_BUNDLE_INVALID"
        )
        if not _proposal_evidence_is_strict(evidence):
            schema_failures += 1
            continue
        published_decision = evidence["published_decision"]
        entity_id = (
            int(row["content_entity_id"])
            if row.get("content_entity_id") is not None else None
        )
        try:
            published_item = ApprovalBatchItem(
                content_entity_id=entity_id,
                input_hash=str(row.get("input_hash") or ""),
                title=str(row.get("title") or ""),
                url=str(row.get("url") or ""),
                final_direction_code=published_decision["final_direction_code"],
                final_material_type_code=published_decision["final_material_type_code"],
                final_access_code=published_decision["final_access_code"],
                final_lifecycle_code=published_decision["final_lifecycle_code"],
                readiness_state=state,
                conflict_codes=conflict_values,
                row_hash=str(row.get("row_hash") or ""),
                decision_reason=published_decision["decision_reason"],
                current_canonical=evidence["current_canonical"],
                registry1_values=evidence["registry1"],
                registry2_values=evidence["registry2"],
                deterministic_result=evidence["deterministic"],
                terra_result=evidence["terra"],
                sol_result=evidence["sol"],
                archive_attestation=evidence["archive_attestation"],
                concise_evidence=tuple(evidence["concise_evidence"]),
                taxonomy_digest=str(batch.get("taxonomy_digest") or ""),
                taxonomy_terms=frozen_taxonomy_terms,
                source_snapshot_ids=tuple(int(value) for value in source_snapshot_ids),
                source_snapshot_digests=tuple(
                    str(value) for value in source_snapshot_digests
                ),
                model_routing_version=str(batch.get("model_routing_version") or ""),
                prompt_version=str(batch.get("prompt_version") or ""),
                mnn=tuple(evidence.get("mnn") or ()),
            )
            accepted_item = ApprovalItem(
                content_entity_id=entity_id,
                input_hash=published_item.input_hash,
                title=published_item.title,
                url=published_item.url,
                final_direction_code=row.get("final_direction_code"),
                final_material_type_code=row.get("final_material_type_code"),
                final_access_code=row.get("final_access_code"),
                final_lifecycle_code=row.get("final_lifecycle_code"),
                readiness_state=state,
                conflict_codes=conflict_values,
                row_hash=published_item.row_hash,
                decision_reason=row.get("decision_reason"),
                selected_content_entity_id=(
                    int(row["selected_content_entity_id"])
                    if row.get("selected_content_entity_id") is not None else None
                ),
                url_alias_decision=(
                    str(row["url_alias_decision"])
                    if row.get("url_alias_decision") is not None else None
                ),
            )
        except (KeyError, TypeError, ValueError):
            schema_failures += 1
            continue
        if compute_item_hash(published_item) != published_item.row_hash:
            schema_failures += 1
        published_items.append(published_item)
        accepted_items.append(accepted_item)
        decisions.append(
            {
                "content_entity_id": entity_id,
                "decision_reason": accepted_item.decision_reason,
                "final_access_code": accepted_item.final_access_code,
                "final_direction_code": accepted_item.final_direction_code,
                "final_lifecycle_code": accepted_item.final_lifecycle_code,
                "final_material_type_code": accepted_item.final_material_type_code,
                "input_hash": accepted_item.input_hash,
                "readiness_state": state,
                "row_hash": accepted_item.row_hash,
                "selected_content_entity_id": accepted_item.selected_content_entity_id,
                "url_alias_decision": accepted_item.url_alias_decision,
            }
        )
    taxonomy_version = str(batch.get("taxonomy_version") or "")
    taxonomy_digest = str(batch.get("taxonomy_digest") or "")
    if (
        len(published_items) != len(rows)
        or compute_batch_hash(published_items)
        != str(batch.get("published_input_hash") or "")
        or compute_taxonomy_digest(taxonomy_version, frozen_taxonomy_terms)
        != taxonomy_digest
    ):
        schema_failures += 1
    counts["source"] = len(decisions)
    counts["accepted"] = sum(
        item.readiness_state == "ready"
        or item.url_alias_decision == "create"
        for item in accepted_items
    )
    return {
        "accepted_hash": compute_accepted_decision_hash(accepted_items),
        "counts": counts,
        "identity_collisions": identity_collisions,
        "schema_failures": schema_failures,
        "unresolved_accepted": unresolved_accepted,
        "approval_rows_by_id": approval_rows_by_id,
    }


def _row_value(row: object, name: str, index: int | None = None):
    if isinstance(row, Mapping):
        return row.get(name)
    if index is None:
        return None
    return row[index]


def _strong_identity_collision_count(cursor: object, batch_id: int) -> int:
    """Count strong collisions not resolved by this batch's URL decision."""
    cursor.execute(
        """
        SELECT COUNT(*) AS strong_collision_count
        FROM portal_content_approval_items AS item
        INNER JOIN portal_content_registry_aliases AS alias_row
          ON alias_row.dataset_key = %s
         AND alias_row.alias_status = 'active'
         AND alias_row.uniqueness_scope = 'strong'
         AND alias_row.content_entity_id <> item.content_entity_id
         AND ((alias_row.alias_type = 'material_id'
               AND alias_row.alias_hash IN (
                 SHA2(JSON_UNQUOTE(JSON_EXTRACT(
                   item.proposal_evidence, '$.registry1.material_id')), 256),
                 SHA2(JSON_UNQUOTE(JSON_EXTRACT(
                   item.proposal_evidence, '$.registry2.material_id')), 256)
               ))
           OR (alias_row.alias_type IN ('canonical_url', 'url')
               AND alias_row.alias_hash = SHA2(item.url, 256)
               AND NOT EXISTS (
                 SELECT 1
                 FROM portal_content_approval_items AS authority
                 WHERE authority.approval_batch_id = item.approval_batch_id
                   AND authority.url_alias_decision IN ('attach', 'create')
                   AND authority.selected_content_entity_id = alias_row.content_entity_id
                   AND SHA2(authority.url, 256) = alias_row.alias_hash
               )))
        WHERE item.approval_batch_id = %s
        """,
        (DATASET_KEY, batch_id),
    )
    return int(
        _row_value(cursor.fetchone(), "strong_collision_count", 0) or 0
    )


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


def _return_page_path(raw: object) -> str:
    value = str(raw or "").strip().replace("&amp;", "&")
    if not value or re.match(r"^[a-z]:[\\/]", value, flags=re.IGNORECASE):
        return ""
    scheme = re.match(r"^([a-z][a-z0-9+.-]*):", value, flags=re.IGNORECASE)
    if scheme and scheme.group(1).casefold() not in {"http", "https"}:
        return ""
    if re.match(r"^[a-z][a-z0-9+.-]*://", value, flags=re.IGNORECASE):
        try:
            path = urlsplit(value).path
        except (TypeError, ValueError):
            path = re.split(r"[?#]", value, maxsplit=1)[0]
    else:
        path = re.split(r"[?#]", value, maxsplit=1)[0]
    path = re.sub(r"/{2,}", "/", path)
    if not path.startswith("/"):
        path = f"/{path}"
    return path.rstrip("/") or "/"


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
    *,
    page_facts: Iterable[Mapping[str, object]] = (),
    strong_aliases: Iterable[StrongUrlAlias | Mapping[str, object]] = (),
) -> tuple[LookupProjectionRow, ...]:
    """Build deterministic lookup groups, with fail-closed strong URL identity."""

    catalog_rows = tuple(catalog_rows)
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

    catalog_url_entities: dict[str, set[int]] = {}
    for row in catalog_rows:
        normalized = normalize_url(row.normalized_url).value
        if normalized:
            catalog_url_entities.setdefault(normalized, set()).add(
                row.content_entity_id
            )
    alias_url_entities: dict[str, set[int]] = {}
    for alias in strong_aliases:
        try:
            entity_id = int(
                alias.content_entity_id if isinstance(alias, StrongUrlAlias)
                else alias["content_entity_id"]
            )
            alias_type = (
                alias.alias_type if isinstance(alias, StrongUrlAlias)
                else str(alias["alias_type"])
            )
            alias_value = (
                alias.alias_value if isinstance(alias, StrongUrlAlias)
                else str(alias["alias_value"])
            )
        except (KeyError, TypeError, ValueError):
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION") from None
        if entity_id <= 0 or alias_type not in {"canonical_url", "url"}:
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")
        normalized = normalize_url(alias_value).value
        if normalized:
            alias_url_entities.setdefault(normalized, set()).add(entity_id)

    for entity_ids in alias_url_entities.values():
        if len(entity_ids) != 1:
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")
    url_entities = dict(catalog_url_entities)
    url_entities.update(alias_url_entities)

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

    catalog_by_entity: dict[int, list[CandidateCatalogRow]] = {}
    for row in catalog_rows:
        catalog_by_entity.setdefault(row.content_entity_id, []).append(row)
    for normalized_url, entity_ids in sorted(url_entities.items()):
        if len(entity_ids) != 1:
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")
        entity_id = next(iter(entity_ids))
        selected_rows = sorted(
            catalog_by_entity.get(entity_id, ()),
            key=lambda item: item.source_row_fingerprint,
        )
        if not selected_rows:
            # An active reviewed alias may predate a classified catalog row.
            # It cannot enter the dashboard lookup until metadata exists; an
            # observed URL remains fail-closed in the publication resolution
            # gate instead of blocking unrelated aliases globally.
            continue
        selected = selected_rows[0]
        result.append(
            LookupProjectionRow(
                lookup_kind="url",
                lookup_key_hash=sha256_text(normalized_url),
                candidate_count=len(selected_rows),
                metadata_signature_count=len(
                    {_metadata_signature(item) for item in selected_rows}
                ),
                resolution_status="unique",
                selected_source_row_fingerprint=selected.source_row_fingerprint,
                group_fingerprint=sha256_text(
                    _canonical_json(
                        {
                            "content_entity_id": entity_id,
                            "url": normalized_url,
                            "source_row_fingerprints": [
                                item.source_row_fingerprint for item in selected_rows
                            ],
                        }
                    )
                ),
            )
        )
    facts = tuple(page_facts)
    if not facts:
        return tuple(sorted(result, key=lambda row: (row.lookup_kind, row.lookup_key_hash)))

    catalog_by_fingerprint = {
        row.source_row_fingerprint: row for row in catalog_rows
    }
    title_selection = {
        row.lookup_key_hash: row.selected_source_row_fingerprint
        for row in result
        if row.lookup_kind == "title"
        and row.resolution_status in {"unique", "identical_collapsed"}
        and row.selected_source_row_fingerprint
    }
    path_candidates: dict[str, set[str]] = {}
    for row in catalog_rows:
        path = _return_page_path(row.normalized_path)
        if path:
            path_candidates.setdefault(path, set()).add(
                row.source_row_fingerprint
            )
    evidence_by_path: dict[str, list[str]] = {}
    for fact in facts:
        path = _return_page_path(fact.get("page_url"))
        title = normalize_title(str(fact.get("page_title") or ""))
        if not path or not title:
            continue
        selected = title_selection.get(sha256_text(title))
        if not selected or selected not in catalog_by_fingerprint:
            continue
        path_candidates.setdefault(path, set()).add(selected)
        evidence_by_path.setdefault(path, []).append(selected)

    path_rows = []
    for path, fingerprints in path_candidates.items():
        selected = sorted(fingerprints)
        if len(selected) == 1:
            evidence_count = evidence_by_path.get(path, []).count(selected[0])
            status = "identical_collapsed" if evidence_count > 1 else "unique"
            selected_fingerprint = selected[0]
            candidate_count = max(1, evidence_count)
        else:
            status = "ambiguous"
            selected_fingerprint = None
            candidate_count = len(selected)
        path_rows.append(
            LookupProjectionRow(
                lookup_kind="path",
                lookup_key_hash=sha256_text(path),
                candidate_count=candidate_count,
                metadata_signature_count=len(selected),
                resolution_status=status,
                selected_source_row_fingerprint=selected_fingerprint,
                group_fingerprint=sha256_text(
                    "\x1f".join(("path", path, status, *selected))
                ),
            )
        )
    return tuple(
        sorted(
            (
                *(row for row in result if row.lookup_kind != "path"),
                *path_rows,
            ),
            key=lambda row: (row.lookup_kind, row.lookup_key_hash),
        )
    )


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
            event_evidence = _decode_json(
                entity.get("proposal_evidence") or {},
                code="SOURCE_EVIDENCE_INVALID",
            )
            normalized = (
                normalize_observed_page_grouping_url(str(source_url))
                if isinstance(event_evidence, Mapping)
                and isinstance(event_evidence.get("created_identity"), Mapping)
                else normalize_url(str(source_url))
            )
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
                        str(entity["material_type_label"])
                        if entity.get("material_type_label") is not None
                        else None
                    ),
                    source_slug=slug or None,
                    source_slug_hash=sha256_text(slug) if slug else None,
                    access_label=(
                        str(entity["access_label"])
                        if entity.get("access_label") is not None
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
                        str(entity["direction_label"])
                        if entity.get("direction_label") is not None
                        else None
                    ),
                    published_at=provenance.get("published_at"),
                    valid_from=effective_at,
                    valid_to=None,
                    classification_event_id=event_id,
                    classification_event_fingerprint=event_fingerprint,
                    direction_code=(
                        str(entity["direction_code"])
                        if entity.get("direction_code") is not None
                        else None
                    ),
                    material_type_code=(
                        str(entity["material_type_code"])
                        if entity.get("material_type_code") is not None
                        else None
                    ),
                    access_code=(
                        str(entity["access_code"])
                        if entity.get("access_code") is not None
                        else None
                    ),
                    lifecycle_code=(
                        str(entity["lifecycle_code"])
                        if entity.get("lifecycle_code") is not None
                        else None
                    ),
                    lifecycle_label=(
                        str(entity["lifecycle_label"])
                        if entity.get("lifecycle_label") is not None
                        else None
                    ),
                    provenance_mode=str(
                        entity.get("_projection_mode") or "current_batch_event"
                    ),
                )
            )
    return tuple(
        sorted(
            result,
            key=lambda item: (item.source_sheet, item.source_row_ordinal),
        )
    )


def _predecessor_catalog_row(row: Mapping[str, object]) -> CandidateCatalogRow:
    provenance = _decode_json(
        row.get("projection_provenance_json") or {},
        code="PREDECESSOR_PROVENANCE_INVALID",
    )
    if not isinstance(provenance, Mapping):
        raise CandidateMaterializationError("PREDECESSOR_PROVENANCE_INVALID")
    codes = provenance.get("canonical_codes") or {}
    labels = provenance.get("canonical_labels") or {}
    required_codes = ("direction", "material_type", "access", "lifecycle")
    if (
        not isinstance(codes, Mapping)
        or int(row.get("content_entity_id") or 0) <= 0
        or any(not str(codes.get(name) or "").strip() for name in required_codes)
    ):
        raise CandidateMaterializationError("PREDECESSOR_PROVENANCE_INVALID")
    return CandidateCatalogRow(
        content_entity_id=int(row.get("content_entity_id") or 0),
        normalized_url=str(row.get("normalized_url") or ""),
        normalized_url_hash=str(row.get("normalized_url_hash") or ""),
        normalized_path=str(row.get("normalized_path") or ""),
        page_title=str(row.get("page_title") or ""),
        material_id=(str(row["material_id"]) if row.get("material_id") is not None else None),
        material_type=(str(row["material_type"]) if row.get("material_type") is not None else None),
        source_slug=(str(row["source_slug"]) if row.get("source_slug") is not None else None),
        source_slug_hash=(
            str(row["source_slug_hash"])
            if row.get("source_slug_hash") is not None
            else None
        ),
        access_label=(str(row["access_label"]) if row.get("access_label") is not None else None),
        is_active=bool(row.get("is_active")),
        source_sheet=str(row.get("source_sheet") or ""),
        source_row_ordinal=int(row.get("source_row_ordinal") or 0),
        source_row_fingerprint=str(row.get("source_row_fingerprint") or ""),
        section_key=(str(row["section_key"]) if row.get("section_key") is not None else None),
        direction_key=(str(row["direction_key"]) if row.get("direction_key") is not None else None),
        published_at=row.get("published_at"),
        valid_from=row.get("valid_from"),
        valid_to=row.get("valid_to"),
        classification_event_id=(
            int(row["classification_event_id"])
            if row.get("classification_event_id") is not None
            else None
        ),
        classification_event_fingerprint=(
            str(row["classification_event_fingerprint"])
            if row.get("classification_event_fingerprint") is not None
            else None
        ),
        direction_code=(str(codes["direction"]) if codes.get("direction") is not None else None),
        material_type_code=(
            str(codes["material_type"]) if codes.get("material_type") is not None else None
        ),
        access_code=(str(codes["access"]) if codes.get("access") is not None else None),
        lifecycle_code=(
            str(codes["lifecycle"]) if codes.get("lifecycle") is not None else None
        ),
        lifecycle_label=str(
            labels.get("lifecycle") or codes.get("lifecycle") or ""
        ),
        provenance_mode=str(provenance.get("mode") or "predecessor_catalog"),
        predecessor_catalog_row_id=int(row.get("id") or 0),
        baseline_provenance_fingerprint=(
            str(provenance["baseline_provenance_fingerprint"])
            if provenance.get("baseline_provenance_fingerprint") is not None
            else None
        ),
    )


def _resolve_legacy_predecessor_rows(
    cursor,
    rows: Sequence[Mapping[str, object]],
    *,
    predecessor_release_id: int,
    predecessor_snapshot_id: int,
    taxonomy_version_id: int,
) -> tuple[Mapping[str, object], ...]:
    def needs_resolution(row: Mapping[str, object]) -> bool:
        provenance = _decode_json(
            row.get("projection_provenance_json") or {},
            code="PREDECESSOR_PROVENANCE_INVALID",
        )
        codes = provenance.get("canonical_codes") if isinstance(provenance, Mapping) else None
        return (
            int(row.get("content_entity_id") or 0) <= 0
            or not isinstance(codes, Mapping)
            or any(
                not str(codes.get(name) or "").strip()
                for name in ("direction", "material_type", "access", "lifecycle")
            )
        )

    legacy_ids = {int(row.get("id") or 0) for row in rows if needs_resolution(row)}
    if not legacy_ids:
        return tuple(rows)
    if 0 in legacy_ids:
        raise CandidateMaterializationError("PREDECESSOR_PROVENANCE_INVALID")
    cursor.execute(
        """
        SELECT legacy_catalog.id AS predecessor_catalog_row_id,
               entity.id AS content_entity_id,
               legacy_catalog.direction_key AS direction_label,
               legacy_catalog.material_type AS material_type_label,
               legacy_catalog.access_label,
               legacy_catalog.is_active
        FROM portal_content_catalog AS legacy_catalog
        INNER JOIN portal_content_registry_entities AS entity
          ON entity.dataset_key = %s
         AND entity.registry_status = 'active'
         AND JSON_UNQUOTE(JSON_EXTRACT(entity.source_evidence, '$.authority'))
               = 'active_release_baseline'
         AND CAST(JSON_UNQUOTE(JSON_EXTRACT(
               entity.source_evidence, '$.predecessor_release_id')) AS UNSIGNED) = %s
         AND JSON_CONTAINS(
               JSON_EXTRACT(entity.source_evidence, '$.source_row_fingerprints'),
               JSON_QUOTE(legacy_catalog.source_row_fingerprint)
             )
        WHERE legacy_catalog.canonical_release_id = %s
          AND legacy_catalog.source_snapshot_id = %s
          AND legacy_catalog.id IN ("""
        + ", ".join(["%s"] * len(legacy_ids))
        + ") ORDER BY legacy_catalog.id, entity.id",
        (
            DATASET_KEY,
            predecessor_release_id,
            predecessor_release_id,
            predecessor_snapshot_id,
            *sorted(legacy_ids),
        ),
    )
    legacy_resolution_rows = tuple(cursor.fetchall())
    cursor.execute(
        """
        SELECT taxonomy_kind, term_code, term_label
        FROM portal_content_taxonomy_terms
        WHERE taxonomy_version_id = %s
          AND term_status = 'active'
        ORDER BY taxonomy_kind, term_code
        """,
        (taxonomy_version_id,),
    )
    active_terms: dict[str, dict[str, str]] = {
        "direction": {}, "material_type": {}, "access": {}, "lifecycle": {}
    }
    for term in cursor.fetchall():
        if not isinstance(term, Mapping):
            raise CandidateMaterializationError(
                "LEGACY_PREDECESSOR_PROVENANCE_INVALID"
            )
        kind = str(term.get("taxonomy_kind") or "")
        code = str(term.get("term_code") or "")
        if kind in active_terms and code:
            active_terms[kind][code] = str(term.get("term_label") or code)
    resolutions: dict[int, list[Mapping[str, object]]] = {}
    for resolution in legacy_resolution_rows:
        if not isinstance(resolution, Mapping):
            raise CandidateMaterializationError(
                "LEGACY_PREDECESSOR_PROVENANCE_INVALID"
            )
        row_id = int(resolution.get("predecessor_catalog_row_id") or 0)
        raw_direction = str(resolution.get("direction_label") or "")
        direction_code = normalize_taxonomy_label("direction", raw_direction)
        if not raw_direction.strip():
            direction_code = "undetermined"
        material_type_code = normalize_taxonomy_label(
            "material_type", str(resolution.get("material_type_label") or "")
        )
        raw_access = str(resolution.get("access_label") or "")
        access_code = normalize_taxonomy_label("access", raw_access)
        if not raw_access.strip():
            access_code = "unspecified"
        lifecycle_code = "active" if bool(resolution.get("is_active")) else "archived"
        codes = (direction_code, material_type_code, access_code, lifecycle_code)
        if any(
            not code or code not in active_terms[kind]
            for kind, code in zip(
                ("direction", "material_type", "access", "lifecycle"), codes
            )
        ):
            raise CandidateMaterializationError(
                "LEGACY_PREDECESSOR_PROVENANCE_UNMAPPED"
            )
        resolutions.setdefault(row_id, []).append(
            {
                **resolution,
                "direction_code": direction_code,
                "material_type_code": material_type_code,
                "access_code": access_code,
                "lifecycle_code": lifecycle_code,
                "lifecycle_label": active_terms["lifecycle"][lifecycle_code],
            }
        )
    resolved_rows: list[Mapping[str, object]] = []
    for row in rows:
        row_id = int(row.get("id") or 0)
        if row_id not in legacy_ids:
            resolved_rows.append(row)
            continue
        candidates = resolutions.get(row_id, [])
        entity_ids = {int(item.get("content_entity_id") or 0) for item in candidates}
        code_sets = {
            tuple(str(item.get(name) or "") for name in (
                "direction_code", "material_type_code", "access_code", "lifecycle_code"
            ))
            for item in candidates
        }
        if len(entity_ids) != 1 or 0 in entity_ids or len(code_sets) != 1:
            raise CandidateMaterializationError(
                "LEGACY_PREDECESSOR_PROVENANCE_AMBIGUOUS"
            )
        codes = next(iter(code_sets))
        if any(not value for value in codes):
            raise CandidateMaterializationError(
                "LEGACY_PREDECESSOR_PROVENANCE_UNMAPPED"
            )
        entity_id = next(iter(entity_ids))
        baseline_fingerprint = sha256_text(
            _canonical_json(
                {
                    "canonical_codes": codes,
                    "content_entity_id": entity_id,
                    "predecessor_catalog_row_id": row_id,
                    "predecessor_release_id": predecessor_release_id,
                    "source_row_fingerprint": row.get("source_row_fingerprint"),
                }
            )
        )
        resolved_rows.append(
            {
                **row,
                "direction_key": active_terms["direction"][codes[0]],
                "material_type": active_terms["material_type"][codes[1]],
                "access_label": active_terms["access"][codes[2]],
                "is_active": codes[3] != "archived",
                "content_entity_id": entity_id,
                "classification_event_id": None,
                "classification_event_fingerprint": None,
                "projection_provenance_json": _canonical_json(
                    {
                        "baseline_provenance_fingerprint": baseline_fingerprint,
                        "canonical_codes": {
                            "direction": codes[0],
                            "material_type": codes[1],
                            "access": codes[2],
                            "lifecycle": codes[3],
                        },
                        "canonical_labels": {"lifecycle": str(candidates[0].get("lifecycle_label") or "")},
                        "content_entity_id": entity_id,
                        "mode": "legacy_active_catalog_baseline",
                        "predecessor_catalog_row_id": row_id,
                        "source_row_fingerprint": row.get("source_row_fingerprint"),
                    }
                ),
            }
        )
    return tuple(resolved_rows)


def _event_matches_predecessor(
    event: Mapping[str, object], row: CandidateCatalogRow
) -> bool:
    entity_id = int(event.get("content_entity_id") or 0)
    if row.content_entity_id > 0:
        if row.content_entity_id == entity_id:
            return True
        evidence = _decode_json(
            event.get("source_evidence") or {},
            code="SOURCE_EVIDENCE_INVALID",
        )
        provenance = evidence.get("provenance") if isinstance(evidence, Mapping) else None
        if not isinstance(provenance, (list, tuple)):
            return False
        source_match = False
        for source in provenance:
            if not isinstance(source, Mapping):
                continue
            sheet = str(
                source.get("source_sheet") or source.get("source_name") or ""
            ).strip()
            ordinal = source.get("source_row_ordinal")
            if ordinal is None:
                ordinal = source.get("source_row_id")
            try:
                source_match = (
                    sheet == row.source_sheet and int(ordinal) == row.source_row_ordinal
                )
            except (TypeError, ValueError):
                source_match = False
            if source_match:
                break
        normalized = normalize_url(str(event.get("canonical_url") or ""))
        return bool(
            source_match
            and normalized.sha256
            and normalized.sha256 == row.normalized_url_hash
        )
    material_id = str(event.get("material_id") or "")
    if material_id and row.material_id:
        return material_id.casefold() == row.material_id.casefold()
    normalized = normalize_url(str(event.get("canonical_url") or ""))
    return bool(normalized.sha256 and normalized.sha256 == row.normalized_url_hash)


def _normalized_audit_text(value: object) -> str | None:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None


def _authorize_current_batch_events(
    event_rows: Sequence[Mapping[str, object]],
    approval_rows_by_id: Mapping[int, Mapping[str, object]],
    batch: Mapping[str, object],
    predecessor_rows: Sequence[Mapping[str, object]],
    created_url_event_fingerprints: Mapping[int, str] | None = None,
) -> None:
    """Fail closed on values emitted by accepted approval-item ingestion."""

    batch_id = int(batch.get("id") or 0)
    taxonomy_version_id = int(batch.get("taxonomy_version_id") or 0)
    accepted_hash = str(batch.get("accepted_decision_hash") or "")
    accepted_by = _normalized_audit_text(batch.get("accepted_by"))
    accepted_at = _canonical_ingestion_timestamp(batch.get("accepted_at"))
    predecessor_by_entity = {
        row.content_entity_id: row
        for row in (_predecessor_catalog_row(value) for value in predecessor_rows)
    }
    current_event_item_ids = {
        int(event.get("approval_item_id") or 0) for event in event_rows
    }
    expected: dict[int, tuple[Mapping[str, object], Mapping[str, object] | None]] = {}
    for item_id, item in approval_rows_by_id.items():
        is_create = item.get("url_alias_decision") == "create"
        content_entity_id = int(item.get("content_entity_id") or 0)
        selected_entity_id = int(item.get("selected_content_entity_id") or 0)
        reviewed_selected_attach = (
            batch.get("projection_kind") == "local"
            and item.get("url_alias_decision") == "attach"
            and content_entity_id == 0
            and selected_entity_id > 0
            and selected_entity_id not in predecessor_by_entity
            and item_id in current_event_item_ids
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        reviewed_same_entity_attach = (
            batch.get("projection_kind") == "local"
            and item.get("url_alias_decision") == "attach"
            and content_entity_id > 0
            and selected_entity_id == content_entity_id
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        reviewed_local_candidate = (
            batch.get("projection_kind") == "local"
            and content_entity_id > 0
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        if (
            item.get("readiness_state") != "ready"
            and not is_create
            and not reviewed_selected_attach
            and not reviewed_same_entity_attach
            and not reviewed_local_candidate
        ):
            continue
        evidence = _decode_json(
            item.get("proposal_evidence"), code="CURRENT_BATCH_EVENT_UNAUTHORIZED"
        )
        if not isinstance(evidence, Mapping):
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
        current = evidence.get("current_canonical")
        if current is not None and not isinstance(current, Mapping):
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
        final_values = tuple(item.get(name) for name in (
            "final_direction_code", "final_material_type_code",
            "final_access_code", "final_lifecycle_code",
        ))
        current_values = None
        if isinstance(current, Mapping):
            try:
                current_values = tuple(current[name] for name in (
                    "direction_code", "material_type_code",
                    "access_code", "lifecycle_code",
                ))
            except KeyError:
                raise CandidateMaterializationError(
                    "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                ) from None
        predecessor = predecessor_by_entity.get(content_entity_id)
        predecessor_values = (
            predecessor.direction_code,
            predecessor.material_type_code,
            predecessor.access_code,
            predecessor.lifecycle_code,
        ) if predecessor is not None else None
        local_active_candidate = (
            batch.get("projection_kind") == "local"
            and item.get("readiness_state") == "ready"
            and item.get("url_alias_decision") is None
            and content_entity_id > 0
            and predecessor is not None
            and all(_normalized_audit_text(value) for value in final_values)
        )
        if local_active_candidate and predecessor_values == final_values:
            continue
        reviewed_active_catalog_correction = (
            local_active_candidate
            and predecessor_values != final_values
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        reviewed_baseline_attach = (
            reviewed_same_entity_attach
            and isinstance(current, Mapping)
            and current.get("event_id") in (None, 0)
        )
        reviewed_local_classification = (
            reviewed_local_candidate
            and isinstance(current, Mapping)
            and int(current.get("content_entity_id") or 0) == content_entity_id
            and all(_normalized_audit_text(value) for value in final_values)
            and current_values != final_values
        )
        if (
            item.get("readiness_state") != "ready"
            and not is_create
            and not reviewed_selected_attach
            and not reviewed_baseline_attach
            and not reviewed_local_classification
        ):
            continue
        if isinstance(current, Mapping):
            if (
                current_values == final_values
                and not reviewed_baseline_attach
                and not reviewed_active_catalog_correction
            ):
                continue
        if reviewed_baseline_attach:
            if (
                not isinstance(current, Mapping)
                or int(current.get("content_entity_id") or 0) != content_entity_id
                or current.get("event_id") not in (None, 0)
                or not _normalized_audit_text(item.get("decision_reason"))
            ):
                raise CandidateMaterializationError(
                    "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                )
        if is_create:
            selected = int(item.get("selected_content_entity_id") or 0)
            if (int(item.get("content_entity_id") or 0) != 0 or selected <= 0
                    or current is not None or not _normalized_audit_text(item.get("decision_reason"))):
                raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
        if reviewed_selected_attach and (
            current is not None
            or not all(_normalized_audit_text(value) for value in final_values)
        ):
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
        expected[item_id] = (item, current if isinstance(current, Mapping) else None)

    seen: set[int] = set()
    for event in event_rows:
        item_id = int(event.get("approval_item_id") or 0)
        if item_id in seen or item_id not in expected:
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
        seen.add(item_id)
        item, current = expected[item_id]
        is_create = item.get("url_alias_decision") == "create"
        content_entity_id = int(item.get("content_entity_id") or 0)
        selected_entity_id = int(item.get("selected_content_entity_id") or 0)
        final_values = tuple(item.get(name) for name in (
            "final_direction_code", "final_material_type_code",
            "final_access_code", "final_lifecycle_code",
        ))
        reviewed_selected_attach = (
            batch.get("projection_kind") == "local"
            and item.get("url_alias_decision") == "attach"
            and content_entity_id == 0
            and selected_entity_id > 0
            and selected_entity_id not in predecessor_by_entity
            and current is None
            and all(_normalized_audit_text(value) for value in final_values)
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        reviewed_baseline_attach = (
            batch.get("projection_kind") == "local"
            and item.get("url_alias_decision") == "attach"
            and content_entity_id > 0
            and int(item.get("selected_content_entity_id") or 0)
            == content_entity_id
            and isinstance(current, Mapping)
            and current.get("event_id") in (None, 0)
        )
        reviewed_local_classification = (
            batch.get("projection_kind") == "local"
            and content_entity_id > 0
            and isinstance(current, Mapping)
            and int(current.get("content_entity_id") or 0) == content_entity_id
            and all(_normalized_audit_text(value) for value in final_values)
            and tuple(current.get(name) for name in (
                "direction_code", "material_type_code",
                "access_code", "lifecycle_code",
            )) != final_values
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        predecessor = predecessor_by_entity.get(content_entity_id)
        predecessor_values = (
            predecessor.direction_code,
            predecessor.material_type_code,
            predecessor.access_code,
            predecessor.lifecycle_code,
        ) if predecessor is not None else None
        reviewed_active_catalog_correction = (
            batch.get("projection_kind") == "local"
            and item.get("readiness_state") == "ready"
            and item.get("url_alias_decision") is None
            and content_entity_id > 0
            and predecessor is not None
            and predecessor_values != final_values
            and all(_normalized_audit_text(value) for value in final_values)
            and bool(_normalized_audit_text(item.get("decision_reason")))
        )
        entity_id = int(
            item.get("selected_content_entity_id")
            if (is_create or reviewed_selected_attach)
            else content_entity_id
        )
        event_values = tuple(event.get(name) for name in (
            "direction_code", "material_type_code", "access_code", "lifecycle_code"
        ))
        predecessor_event_id = None
        expected_kind = "approve"
        if reviewed_active_catalog_correction:
            predecessor_event_id = predecessor.classification_event_id
            if predecessor_event_id is None:
                raise CandidateMaterializationError(
                    "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                )
            if (
                predecessor_values is not None
                and predecessor_values[0]
                and predecessor_values[0] != final_values[0]
            ):
                expected_kind = "correct"
        elif current is not None:
            try:
                current_entity_id = int(current["content_entity_id"])
                current_values = tuple(current[name] for name in (
                    "direction_code", "material_type_code",
                    "access_code", "lifecycle_code",
                ))
            except (KeyError, TypeError, ValueError):
                raise CandidateMaterializationError(
                    "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                ) from None
            raw_predecessor_event_id = current.get("event_id")
            if reviewed_baseline_attach:
                if raw_predecessor_event_id not in (None, 0):
                    raise CandidateMaterializationError(
                        "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                    )
                predecessor_event_id = None
            else:
                try:
                    predecessor_event_id = int(raw_predecessor_event_id)
                except (TypeError, ValueError):
                    raise CandidateMaterializationError(
                        "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                    ) from None
            predecessor = predecessor_by_entity.get(entity_id)
            predecessor_values = (
                predecessor.direction_code,
                predecessor.material_type_code,
                predecessor.access_code,
                predecessor.lifecycle_code,
            ) if predecessor is not None else None
            if (
                current_entity_id != entity_id
                or (
                    predecessor is None
                    and not reviewed_baseline_attach
                    and not reviewed_local_classification
                )
                or any(
                    (
                        current_value is not None
                        and current_value != predecessor_value
                    )
                    or (
                        current_value is None
                        and predecessor_value
                        not in (None, "undetermined", "unspecified")
                    )
                    for current_value, final_value, predecessor_value in (
                        zip(current_values, final_values, predecessor_values or ())
                        if predecessor_values is not None
                        else ()
                    )
                )
                or (
                    predecessor is not None
                    and predecessor.classification_event_id is not None
                    and predecessor.classification_event_id != predecessor_event_id
                )
            ):
                raise CandidateMaterializationError(
                    "CURRENT_BATCH_EVENT_UNAUTHORIZED"
                )
            if (
                not reviewed_baseline_attach
                and current_values[0]
                and current_values[0] != final_values[0]
            ):
                expected_kind = "correct"
        event_evidence = _decode_json(
            event.get("proposal_evidence"), code="CURRENT_BATCH_EVENT_UNAUTHORIZED"
        )
        item_evidence = _decode_json(
            item.get("proposal_evidence"), code="CURRENT_BATCH_EVENT_UNAUTHORIZED"
        )
        event_actor = _normalized_audit_text(event.get("actor"))
        event_reason = _normalized_audit_text(event.get("reason"))
        try:
            effective_at = _canonical_ingestion_timestamp(event.get("effective_at"))
        except CandidateMaterializationError:
            effective_at = None
        expected_fingerprint = (
            compute_classification_event_fingerprint(
                {
                    "access_code": event.get("access_code"),
                    "actor": event_actor,
                    "approval_batch_id": batch_id,
                    "approval_item_id": item_id,
                    "content_entity_id": entity_id,
                    "direction_code": event.get("direction_code"),
                    "effective_at": effective_at.isoformat(timespec="microseconds"),
                    "event_kind": expected_kind,
                    "lifecycle_code": event.get("lifecycle_code"),
                    "material_type_code": event.get("material_type_code"),
                    "predecessor_event_id": predecessor_event_id,
                    "proposal_evidence": event_evidence,
                    "reason": event_reason,
                    "taxonomy_version_id": taxonomy_version_id,
                }
            )
            if effective_at is not None
            else None
        )
        expected_evidence_keys = {
            "accepted_decision_hash", "approval_item_evidence", "row_hash"
        }
        if is_create:
            expected_evidence_keys.update({
                "canonical_classification", "created_identity"
            })
        created_identity = (
            event_evidence.get("created_identity")
            if isinstance(event_evidence, Mapping) else None
        )
        canonical_classification = (
            event_evidence.get("canonical_classification")
            if isinstance(event_evidence, Mapping) else None
        )
        normalized_created = (
            normalize_observed_page_grouping_url(str(item.get("url") or ""))
            if is_create else None
        )
        if (
            not accepted_by
            or int(event.get("approval_batch_id") or 0) != batch_id
            or int(event.get("content_entity_id") or 0) != entity_id
            or int(event.get("authorized_entity_id") or 0) != entity_id
            or int(event.get("taxonomy_version_id") or 0) != taxonomy_version_id
            or event_values != final_values
            or event.get("event_kind") != expected_kind
            or (
                int(event.get("predecessor_event_id"))
                if event.get("predecessor_event_id") is not None else None
            ) != predecessor_event_id
            or event_actor != accepted_by
            or event_reason
            != _normalized_audit_text(item.get("decision_reason"))
            or effective_at != accepted_at
            or event.get("event_fingerprint") != expected_fingerprint
            or not all(event.get(name) is not None for name in (
                "direction_label", "material_type_label", "access_label",
                "lifecycle_label",
            ))
            or not isinstance(event_evidence, Mapping)
            or set(event_evidence) != expected_evidence_keys
            or event_evidence.get("accepted_decision_hash") != accepted_hash
            or event_evidence.get("row_hash") != item.get("row_hash")
            or _canonical_json(event_evidence.get("approval_item_evidence"))
            != _canonical_json(item_evidence)
            or (is_create and (
                not isinstance(created_identity, Mapping)
                or created_identity != {
                    "alias_hash": normalized_created.sha256,
                    "normalized_url": normalized_created.value,
                    "selected_content_entity_id": entity_id,
                    "url_alias_decision": "create",
                    "url_decision_event_fingerprint": created_identity.get(
                        "url_decision_event_fingerprint"
                    ),
                }
                or not re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(created_identity.get("url_decision_event_fingerprint") or ""),
                )
                or (
                    created_url_event_fingerprints is not None
                    and created_identity.get("url_decision_event_fingerprint")
                    != created_url_event_fingerprints.get(item_id)
                )
                or canonical_classification != {
                    "access_code": final_values[2],
                    "direction_code": final_values[0],
                    "lifecycle_code": final_values[3],
                    "material_type_code": final_values[1],
                }
            ))
            or (expected_kind == "correct" and not _normalized_audit_text(item.get("decision_reason")))
        ):
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_UNAUTHORIZED")
    if seen != set(expected):
        raise CandidateMaterializationError(
            "CURRENT_BATCH_EVENT_AUTHORIZATION_INCOMPLETE"
        )


def _load_prior_accepted_event_rows(
    cursor, batch_id: int
) -> tuple[Mapping[str, object], ...]:
    """Load the latest immutable accepted event for every registry entity.

    A content candidate is always cloned from the active release.  Accepted
    registry events from an earlier, not-yet-active content batch therefore
    have to be replayed into each later candidate instead of disappearing.
    """

    cursor.execute(
        """
        WITH latest_events AS (
          SELECT event.*,
                 batch.accepted_decision_hash AS authority_accepted_hash,
                 batch.accepted_by AS authority_accepted_by,
                 batch.accepted_at AS authority_accepted_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY event.content_entity_id
                   ORDER BY event.effective_at DESC, event.id DESC
                 ) AS row_rank
          FROM portal_content_classification_events AS event
          INNER JOIN portal_content_approval_batches AS batch
            ON batch.id = event.approval_batch_id
           AND batch.dataset_key = %s
           AND batch.batch_status IN ('accepted','ingested','candidate_materialized')
           AND batch.accepted_decision_hash IS NOT NULL
          WHERE event.approval_batch_id <> %s
            AND event.approval_batch_id > (
              SELECT COALESCE(MAX(incorporated.approval_batch_id), 0)
              FROM portal_active_data_releases AS active_pointer
              INNER JOIN portal_content_catalog AS active_catalog
                ON active_catalog.canonical_release_id = active_pointer.canonical_release_id
              INNER JOIN portal_content_classification_events AS incorporated
                ON incorporated.id = active_catalog.classification_event_id
              WHERE active_pointer.dataset_key = %s
            )
            AND NOT EXISTS (
              SELECT 1
              FROM portal_content_classification_events AS current_event
              WHERE current_event.approval_batch_id = %s
                AND current_event.content_entity_id = event.content_entity_id
            )
        )
        SELECT entity.id AS authorized_entity_id,
               event.content_entity_id, entity.material_id,
               entity.title, entity.canonical_url, entity.source_evidence,
               event.id AS classification_event_id, event.direction_code,
               event.material_type_code, event.access_code,
               event.lifecycle_code, event.event_kind,
               event.event_fingerprint, event.approval_batch_id,
               event.approval_item_id, event.taxonomy_version_id,
               event.predecessor_event_id, event.proposal_evidence,
               event.actor, event.reason, event.effective_at,
               direction.term_label AS direction_label,
               material.term_label AS material_type_label,
               access_term.term_label AS access_label,
               lifecycle.term_label AS lifecycle_label,
               event.authority_accepted_hash,
               event.authority_accepted_by,
               event.authority_accepted_at,
               item.content_entity_id AS authority_content_entity_id,
               item.selected_content_entity_id AS authority_selected_entity_id,
               item.url_alias_decision AS authority_url_decision,
               item.row_hash AS authority_row_hash,
               item.decision_reason AS authority_decision_reason,
               item.proposal_evidence AS authority_item_evidence,
               item.final_direction_code AS authority_direction_code,
               item.final_material_type_code AS authority_material_type_code,
               item.final_access_code AS authority_access_code,
               item.final_lifecycle_code AS authority_lifecycle_code
        FROM latest_events AS event
        INNER JOIN portal_content_approval_items AS item
          ON item.id = event.approval_item_id
         AND item.approval_batch_id = event.approval_batch_id
        INNER JOIN portal_content_registry_entities AS entity
          ON entity.id = event.content_entity_id
         AND entity.dataset_key = %s
         AND entity.registry_status = 'active'
        LEFT JOIN portal_content_taxonomy_terms AS direction
          ON direction.taxonomy_version_id = event.taxonomy_version_id
         AND direction.taxonomy_kind = 'direction'
         AND direction.term_code = event.direction_code
        LEFT JOIN portal_content_taxonomy_terms AS material
          ON material.taxonomy_version_id = event.taxonomy_version_id
         AND material.taxonomy_kind = 'material_type'
         AND material.term_code = event.material_type_code
        LEFT JOIN portal_content_taxonomy_terms AS access_term
          ON access_term.taxonomy_version_id = event.taxonomy_version_id
         AND access_term.taxonomy_kind = 'access'
         AND access_term.term_code = event.access_code
        LEFT JOIN portal_content_taxonomy_terms AS lifecycle
          ON lifecycle.taxonomy_version_id = event.taxonomy_version_id
         AND lifecycle.taxonomy_kind = 'lifecycle'
         AND lifecycle.term_code = event.lifecycle_code
        WHERE event.row_rank = 1
        ORDER BY event.effective_at, event.id
        """,
        (
            DATASET_KEY,
            batch_id,
            DATASET_KEY,
            batch_id,
            DATASET_KEY,
        ),
    )
    rows = tuple(cursor.fetchall())
    if any(not isinstance(row, Mapping) for row in rows):
        raise CandidateMaterializationError("PRIOR_ACCEPTED_EVENT_UNAUTHORIZED")
    return tuple(
        {**row, "_projection_mode": "prior_accepted_event"} for row in rows
    )  # type: ignore[return-value]


def _authorize_prior_accepted_events(
    rows: Sequence[Mapping[str, object]],
) -> None:
    """Re-attest prior events before they may enter a later candidate."""

    seen_entities: set[int] = set()
    for row in rows:
        try:
            entity_id = int(row.get("content_entity_id") or 0)
            event_id = int(row.get("classification_event_id") or 0)
            batch_id = int(row.get("approval_batch_id") or 0)
            item_id = int(row.get("approval_item_id") or 0)
            taxonomy_id = int(row.get("taxonomy_version_id") or 0)
            accepted_at = _canonical_ingestion_timestamp(
                row.get("authority_accepted_at")
            )
            effective_at = _canonical_ingestion_timestamp(row.get("effective_at"))
        except (CandidateMaterializationError, TypeError, ValueError):
            raise CandidateMaterializationError(
                "PRIOR_ACCEPTED_EVENT_UNAUTHORIZED"
            ) from None
        evidence = _decode_json(
            row.get("proposal_evidence"),
            code="PRIOR_ACCEPTED_EVENT_UNAUTHORIZED",
        )
        item_evidence = _decode_json(
            row.get("authority_item_evidence"),
            code="PRIOR_ACCEPTED_EVENT_UNAUTHORIZED",
        )
        accepted_hash = str(row.get("authority_accepted_hash") or "")
        actor = _normalized_audit_text(row.get("actor"))
        reason = _normalized_audit_text(row.get("reason"))
        event_kind = str(row.get("event_kind") or "")
        selected = int(row.get("authority_selected_entity_id") or 0)
        published_entity = int(row.get("authority_content_entity_id") or 0)
        url_decision = row.get("authority_url_decision")
        # A reviewed "attach" binds the event to the selected entity exactly as
        # "create" does: the published item carries no entity of its own.  This
        # mirrors reviewed_selected_attach in _authorize_current_batch_events.
        expected_entity = (
            selected
            if url_decision == "create"
            or (url_decision == "attach" and published_entity == 0 and selected > 0)
            else published_entity
        )
        final_values = tuple(
            row.get(name)
            for name in (
                "authority_direction_code",
                "authority_material_type_code",
                "authority_access_code",
                "authority_lifecycle_code",
            )
        )
        event_values = tuple(
            row.get(name)
            for name in (
                "direction_code",
                "material_type_code",
                "access_code",
                "lifecycle_code",
            )
        )
        expected_fingerprint = (
            compute_classification_event_fingerprint(
                {
                    "access_code": row.get("access_code"),
                    "actor": actor,
                    "approval_batch_id": batch_id,
                    "approval_item_id": item_id,
                    "content_entity_id": entity_id,
                    "direction_code": row.get("direction_code"),
                    "effective_at": effective_at.isoformat(timespec="microseconds"),
                    "event_kind": event_kind,
                    "lifecycle_code": row.get("lifecycle_code"),
                    "material_type_code": row.get("material_type_code"),
                    "predecessor_event_id": (
                        int(row.get("predecessor_event_id"))
                        if row.get("predecessor_event_id") is not None
                        else None
                    ),
                    "proposal_evidence": evidence,
                    "reason": reason,
                    "taxonomy_version_id": taxonomy_id,
                }
            )
            if effective_at is not None
            else None
        )
        if (
            min(entity_id, event_id, batch_id, item_id, taxonomy_id) <= 0
            or entity_id in seen_entities
            or int(row.get("authorized_entity_id") or 0) != entity_id
            or expected_entity != entity_id
            or event_values != final_values
            or event_kind not in {"approve", "correct", "revoke"}
            or not re.fullmatch(r"[0-9a-f]{64}", accepted_hash)
            or _normalized_audit_text(row.get("authority_accepted_by")) != actor
            or accepted_at != effective_at
            or reason
            != _normalized_audit_text(row.get("authority_decision_reason"))
            or not isinstance(evidence, Mapping)
            or evidence.get("accepted_decision_hash") != accepted_hash
            or evidence.get("row_hash") != row.get("authority_row_hash")
            or _canonical_json(evidence.get("approval_item_evidence"))
            != _canonical_json(item_evidence)
            or row.get("event_fingerprint") != expected_fingerprint
            or (
                event_kind != "revoke"
                and not all(
                    row.get(name) is not None
                    for name in (
                        "direction_label",
                        "material_type_label",
                        "access_label",
                        "lifecycle_label",
                    )
                )
            )
        ):
            raise CandidateMaterializationError(
                "PRIOR_ACCEPTED_EVENT_UNAUTHORIZED"
            )
        seen_entities.add(entity_id)


def _authorize_created_page_identities(
    rows: Sequence[Mapping[str, object]],
    approval_rows_by_id: Mapping[int, Mapping[str, object]],
    batch: Mapping[str, object],
) -> dict[int, str]:
    """Verify every local ``create`` entity, aliases and immutable URL event."""

    expected_ids = {
        item_id for item_id, item in approval_rows_by_id.items()
        if item.get("url_alias_decision") == "create"
    }
    grouped: dict[int, list[Mapping[str, object]]] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            raise CandidateMaterializationError("CREATED_PAGE_IDENTITY_UNAUTHORIZED")
        try:
            item_id = int(row.get("approval_item_id") or 0)
        except (TypeError, ValueError):
            raise CandidateMaterializationError(
                "CREATED_PAGE_IDENTITY_UNAUTHORIZED"
            ) from None
        grouped.setdefault(item_id, []).append(row)
    if set(grouped) != expected_ids:
        raise CandidateMaterializationError(
            "CREATED_PAGE_IDENTITY_AUTHORIZATION_INCOMPLETE"
        )

    batch_id = int(batch.get("id") or 0)
    accepted_hash = str(batch.get("accepted_decision_hash") or "")
    accepted_by = _normalized_audit_text(batch.get("accepted_by"))
    authorized: dict[int, str] = {}
    for item_id in sorted(expected_ids):
        item = approval_rows_by_id[item_id]
        item_rows = grouped[item_id]
        normalized = normalize_observed_page_grouping_url(str(item.get("url") or ""))
        entity_id = int(item.get("selected_content_entity_id") or 0)
        item_evidence = _decode_json(
            item.get("proposal_evidence"),
            code="CREATED_PAGE_IDENTITY_UNAUTHORIZED",
        )
        registry1 = (
            item_evidence.get("registry1")
            if isinstance(item_evidence, Mapping) else None
        )
        if (
            not normalized.value or entity_id <= 0
            or item.get("content_entity_id") is not None
            or not _normalized_audit_text(item.get("decision_reason"))
            or not isinstance(registry1, Mapping)
            or registry1.get("source_name") != "observed_page"
        ):
            raise CandidateMaterializationError("CREATED_PAGE_IDENTITY_UNAUTHORIZED")
        alias_types: set[str] = set()
        entity_evidence_value = None
        decision_fingerprint = None
        for row in item_rows:
            try:
                alias_type = str(row["alias_type"])
                alias_hash = str(row["alias_hash"])
                alias_value = str(row["alias_value"])
                entity_evidence = _decode_json(
                    row["entity_source_evidence"],
                    code="CREATED_PAGE_IDENTITY_UNAUTHORIZED",
                )
                alias_evidence = _decode_json(
                    row["alias_source_evidence"],
                    code="CREATED_PAGE_IDENTITY_UNAUTHORIZED",
                )
                fingerprint = str(row["url_event_fingerprint"])
                expected_fingerprint = compute_url_alias_decision_event_fingerprint(
                    accepted_decision_hash=row["url_event_accepted_hash"],
                    actor=row["url_event_actor"],
                    approval_batch_id=int(row["url_event_batch_id"]),
                    approval_item_id=int(row["url_event_item_id"]),
                    decision_reason=row["url_event_reason"],
                    normalized_url=row["url_event_normalized_url"],
                    selected_content_entity_id=int(row["url_event_selected_entity_id"]),
                    selected_predecessor_event_fingerprint=row.get(
                        "url_event_predecessor_fingerprint"
                    ),
                    selected_predecessor_event_id=row.get("url_event_predecessor_id"),
                    url_alias_decision=row["url_event_decision"],
                )
            except (KeyError, TypeError, ValueError):
                raise CandidateMaterializationError(
                    "CREATED_PAGE_IDENTITY_UNAUTHORIZED"
                ) from None
            if (
                int(row.get("entity_id") or 0) != entity_id
                or row.get("entity_title") != item.get("title")
                or row.get("entity_material_id") is not None
                or row.get("entity_status") != "active"
                or row.get("entity_canonical_url") != normalized.value
                or alias_type not in {"canonical_url", "url"}
                or alias_type in alias_types
                or row.get("alias_status") != "active"
                or row.get("alias_uniqueness_scope") != "strong"
                or int(row.get("alias_entity_id") or 0) != entity_id
                or alias_hash != normalized.sha256
                or alias_value != normalized.value
                or alias_evidence != entity_evidence
                or int(row.get("url_event_batch_id") or 0) != batch_id
                or int(row.get("url_event_item_id") or 0) != item_id
                or row.get("url_event_accepted_hash") != accepted_hash
                or _normalized_audit_text(row.get("url_event_actor")) != accepted_by
                or row.get("url_event_decision") != "create"
                or int(row.get("url_event_selected_entity_id") or 0) != entity_id
                or row.get("url_event_normalized_url") != normalized.value
                or row.get("url_event_predecessor_id") is not None
                or row.get("url_event_predecessor_fingerprint") is not None
                or fingerprint != expected_fingerprint
            ):
                raise CandidateMaterializationError(
                    "CREATED_PAGE_IDENTITY_UNAUTHORIZED"
                )
            alias_types.add(alias_type)
            entity_evidence_value = entity_evidence
            decision_fingerprint = fingerprint
        if alias_types != {"canonical_url", "url"}:
            raise CandidateMaterializationError(
                "CREATED_PAGE_IDENTITY_AUTHORIZATION_INCOMPLETE"
            )
        if not isinstance(entity_evidence_value, Mapping):
            raise CandidateMaterializationError("CREATED_PAGE_IDENTITY_UNAUTHORIZED")
        provenance = entity_evidence_value.get("provenance")
        if (
            set(entity_evidence_value) != {
                "actor", "approval_batch_id", "approval_item_id", "authority",
                "provenance", "row_hash",
            }
            or entity_evidence_value.get("authority") != "local_observed_page_acceptance"
            or int(entity_evidence_value.get("approval_batch_id") or 0) != batch_id
            or int(entity_evidence_value.get("approval_item_id") or 0) != item_id
            or entity_evidence_value.get("actor") != accepted_by
            or entity_evidence_value.get("row_hash") != item.get("row_hash")
            or not isinstance(provenance, list) or len(provenance) != 1
            or set(provenance[0]) != {
                "canonical_url", "page_title", "source_row_fingerprint",
                "source_row_ordinal", "source_sheet",
            }
            or provenance[0].get("source_sheet") != "local_observed_page"
            or int(provenance[0].get("source_row_ordinal") or 0) != item_id
            or provenance[0].get("canonical_url") != normalized.value
            or provenance[0].get("page_title") != item.get("title")
            or provenance[0].get("source_row_fingerprint") != item.get("row_hash")
            or not re.fullmatch(r"[0-9a-f]{64}", str(decision_fingerprint or ""))
        ):
            raise CandidateMaterializationError("CREATED_PAGE_IDENTITY_UNAUTHORIZED")
        authorized[item_id] = str(decision_fingerprint)
    return authorized


def _load_created_page_identity_rows(
    cursor, batch_id: int,
) -> tuple[Mapping[str, object], ...]:
    cursor.execute(
        """
        SELECT item.id AS approval_item_id,
               entity.id AS entity_id, entity.title AS entity_title,
               entity.material_id AS entity_material_id,
               entity.canonical_url AS entity_canonical_url,
               entity.registry_status AS entity_status,
               entity.source_evidence AS entity_source_evidence,
               alias_row.content_entity_id AS alias_entity_id,
               alias_row.alias_type, alias_row.alias_value, alias_row.alias_hash,
               alias_row.uniqueness_scope AS alias_uniqueness_scope,
               alias_row.alias_status, alias_row.source_evidence AS alias_source_evidence,
               url_event.approval_batch_id AS url_event_batch_id,
               url_event.approval_item_id AS url_event_item_id,
               url_event.accepted_decision_hash AS url_event_accepted_hash,
               url_event.actor AS url_event_actor,
               url_event.decision_reason AS url_event_reason,
               url_event.normalized_url AS url_event_normalized_url,
               url_event.url_alias_decision AS url_event_decision,
               url_event.selected_content_entity_id AS url_event_selected_entity_id,
               url_event.selected_predecessor_event_id AS url_event_predecessor_id,
               url_event.selected_predecessor_event_fingerprint AS url_event_predecessor_fingerprint,
               url_event.event_fingerprint AS url_event_fingerprint
        FROM portal_content_approval_items AS item
        INNER JOIN portal_content_registry_entities AS entity
          ON entity.id = item.selected_content_entity_id
         AND entity.dataset_key = %s
        INNER JOIN portal_content_registry_aliases AS alias_row
          ON alias_row.content_entity_id = entity.id
         AND alias_row.dataset_key = %s
         AND alias_row.alias_type IN ('canonical_url', 'url')
         AND alias_row.uniqueness_scope = 'strong'
        INNER JOIN portal_content_url_alias_decision_events AS url_event
          ON url_event.approval_batch_id = item.approval_batch_id
         AND url_event.approval_item_id = item.id
         AND url_event.url_alias_decision = 'create'
        WHERE item.approval_batch_id = %s
          AND item.url_alias_decision = 'create'
        ORDER BY item.id, alias_row.alias_type, alias_row.id
        """,
        (DATASET_KEY, DATASET_KEY, batch_id),
    )
    rows = tuple(cursor.fetchall())
    if any(not isinstance(row, Mapping) for row in rows):
        raise CandidateMaterializationError("CREATED_PAGE_IDENTITY_UNAUTHORIZED")
    return rows  # type: ignore[return-value]

def _overlay_current_batch_events(
    predecessor_rows: Iterable[Mapping[str, object]],
    event_rows: Iterable[Mapping[str, object]],
) -> tuple[CandidateCatalogRow, ...]:
    result = [_predecessor_catalog_row(row) for row in predecessor_rows]
    for event in event_rows:
        event_kind = str(event.get("event_kind") or "")
        if event_kind not in {"approve", "correct", "revoke"}:
            raise CandidateMaterializationError("CURRENT_BATCH_EVENT_INVALID")
        matched = [row for row in result if _event_matches_predecessor(event, row)]
        result = [row for row in result if not _event_matches_predecessor(event, row)]
        if event_kind != "revoke" and matched:
            try:
                event_id = int(event["classification_event_id"])
                event_fingerprint = str(event["event_fingerprint"])
                effective_at = event["effective_at"]
                direction_code = str(event["direction_code"])
                material_type_code = str(event["material_type_code"])
                access_code = str(event["access_code"])
                lifecycle_code = str(event["lifecycle_code"])
                direction_label = str(event["direction_label"])
                material_type_label = str(event["material_type_label"])
                access_label = str(event["access_label"])
                lifecycle_label = str(event["lifecycle_label"])
            except (KeyError, TypeError, ValueError):
                raise CandidateMaterializationError(
                    "EFFECTIVE_CLASSIFICATION_INVALID"
                ) from None
            if (
                event_id <= 0
                or len(event_fingerprint) != 64
                or effective_at is None
                or not all(
                    (
                        direction_code,
                        material_type_code,
                        access_code,
                        lifecycle_code,
                        direction_label,
                        material_type_label,
                        access_label,
                        lifecycle_label,
                    )
                )
            ):
                raise CandidateMaterializationError(
                    "EFFECTIVE_CLASSIFICATION_INVALID"
                )
            result.extend(
                replace(
                    row,
                    content_entity_id=int(event["content_entity_id"]),
                    material_type=material_type_label,
                    access_label=access_label,
                    is_active=lifecycle_code != "archived",
                    direction_key=direction_label,
                    valid_from=effective_at,
                    valid_to=None,
                    classification_event_id=event_id,
                    classification_event_fingerprint=event_fingerprint,
                    direction_code=direction_code,
                    material_type_code=material_type_code,
                    access_code=access_code,
                    lifecycle_code=lifecycle_code,
                    lifecycle_label=lifecycle_label,
                    provenance_mode=str(
                        event.get("_projection_mode") or "current_batch_event"
                    ),
                )
                for row in matched
            )
        elif event_kind != "revoke":
            result.extend(_catalog_rows((event,)))
    strong_keys: dict[tuple[str, str], int] = {}
    source_keys: set[tuple[str, int]] = set()
    for row in result:
        source_key = (row.source_sheet, row.source_row_ordinal)
        if source_key in source_keys:
            raise CandidateMaterializationError("SOURCE_PROVENANCE_COLLISION")
        source_keys.add(source_key)
        entity_id = row.content_entity_id
        for kind, value in (
            ("material_id", (row.material_id or "").casefold()),
            (
                "normalized_url",
                row.normalized_url_hash if row.normalized_url else "",
            ),
        ):
            if not value:
                continue
            key = (kind, value)
            mapped = strong_keys.setdefault(key, entity_id)
            if mapped != entity_id:
                raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")
    return tuple(
        sorted(result, key=lambda item: (item.source_sheet, item.source_row_ordinal))
    )


def _current_batch_entity_continuity(
    predecessor_rows: Sequence[Mapping[str, object]],
    candidate_rows: Sequence[CandidateCatalogRow],
    event_rows: Sequence[Mapping[str, object]],
    approval_rows_by_id: Mapping[int, Mapping[str, object]],
    *,
    preserved_entity_ids: Iterable[int] = (),
) -> tuple[EntityContinuity, ...]:
    predecessor_ids = {
        int(row.get("content_entity_id") or 0) for row in predecessor_rows
    }
    candidate_ids = {row.content_entity_id for row in candidate_rows}
    try:
        preserved_ids = {int(value) for value in preserved_entity_ids}
    except (TypeError, ValueError):
        raise CandidateMaterializationError("ENTITY_CONTINUITY_INVALID") from None
    if any(value <= 0 for value in preserved_ids):
        raise CandidateMaterializationError("ENTITY_CONTINUITY_INVALID")
    mnn_only_ids = preserved_ids - predecessor_ids
    predecessor_ids.update(mnn_only_ids)
    candidate_ids.update(mnn_only_ids)
    if 0 in predecessor_ids or 0 in candidate_ids:
        raise CandidateMaterializationError("ENTITY_CONTINUITY_INVALID")
    decisions: list[EntityContinuity] = []
    for item in approval_rows_by_id.values():
        decision = str(item.get("url_alias_decision") or "")
        old_id = int(item.get("content_entity_id") or 0)
        selected = int(item.get("selected_content_entity_id") or 0)
        if decision == "attach" and old_id > 0 and selected > 0 and old_id != selected:
            decisions.append(EntityContinuity(old_id, selected, "reviewed_attach"))
        elif decision == "reject" and old_id in mnn_only_ids:
            # Rejecting an observed URL is not authority to delete an existing
            # MNN-only registry entity or its accepted drug-name mappings.
            continue
        elif (
            decision in {"retire", "reject"}
            and old_id > 0
            and old_id in predecessor_ids
        ):
            decisions.append(
                EntityContinuity(old_id, None, f"reviewed_{decision}")
            )
    new_ids = candidate_ids - predecessor_ids
    removed_ids = predecessor_ids - candidate_ids
    rebound_new_ids: set[int] = set()
    predecessor_catalog = tuple(
        _predecessor_catalog_row(row) for row in predecessor_rows
    )
    for entity_id in sorted(new_ids):
        matching_events = [
            row for row in event_rows
            if int(row.get("content_entity_id") or 0) == entity_id
            and str(row.get("event_kind") or "") in {"approve", "correct"}
        ]
        if len(matching_events) != 1:
            continue
        predecessor_matches = {
            row.content_entity_id
            for row in predecessor_catalog
            if row.content_entity_id in removed_ids
            and _event_matches_predecessor(matching_events[0], row)
        }
        if len(predecessor_matches) == 1:
            decisions.append(EntityContinuity(
                predecessor_matches.pop(), entity_id, "current_batch_rebind"
            ))
            rebound_new_ids.add(entity_id)
    for entity_id in sorted(new_ids):
        if entity_id in rebound_new_ids:
            continue
        matching = [
            row for row in event_rows
            if int(row.get("content_entity_id") or 0) == entity_id
            and str(row.get("event_kind") or "") == "approve"
        ]
        if len(matching) == 1:
            decisions.append(
                EntityContinuity(None, entity_id, "current_batch_approve")
            )
    for entity_id in sorted(removed_ids):
        if any(
            row.predecessor_id == entity_id
            and row.authority == "current_batch_rebind"
            for row in decisions
        ):
            continue
        matching = [
            row for row in event_rows
            if int(row.get("content_entity_id") or 0) == entity_id
            and str(row.get("event_kind") or "") == "revoke"
        ]
        if len(matching) == 1:
            decisions.append(
                EntityContinuity(entity_id, None, "current_batch_revoke")
            )
    try:
        return build_entity_continuity(
            predecessor_ids, candidate_ids, decisions
        )
    except ContinuityError as error:
        raise CandidateMaterializationError(str(error)) from None


def _mnn_only_predecessor_entity_ids(
    cursor,
    predecessor_release_id: int,
    predecessor_rows: Sequence[Mapping[str, object]],
) -> frozenset[int]:
    cursor.execute(
        """
        SELECT DISTINCT content_entity_id
        FROM portal_content_catalog_mnn
        WHERE canonical_release_id = %s
        ORDER BY content_entity_id
        """,
        (predecessor_release_id,),
    )
    try:
        mnn_entity_ids = {
            int(_row_value(row, "content_entity_id", 0))
            for row in cursor.fetchall()
        }
        catalog_entity_ids = {
            int(row.get("content_entity_id") or 0)
            for row in predecessor_rows
        }
    except (TypeError, ValueError):
        raise CandidateMaterializationError("MNN_ENTITY_CONTINUITY_INVALID") from None
    if 0 in mnn_entity_ids or 0 in catalog_entity_ids:
        raise CandidateMaterializationError("MNN_ENTITY_CONTINUITY_INVALID")
    return frozenset(mnn_entity_ids - catalog_entity_ids)


def _catalog_entity_authorities(
    rows: Sequence[CandidateCatalogRow],
) -> dict[int, CandidateCatalogRow]:
    result: dict[int, CandidateCatalogRow] = {}
    for row in rows:
        prior = result.setdefault(row.content_entity_id, row)
        if (
            prior.direction_code,
            prior.material_type_code,
            prior.access_code,
            prior.lifecycle_code,
            prior.classification_event_id,
            prior.classification_event_fingerprint,
        ) != (
            row.direction_code,
            row.material_type_code,
            row.access_code,
            row.lifecycle_code,
            row.classification_event_id,
            row.classification_event_fingerprint,
        ):
            raise CandidateMaterializationError(
                "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
            )
    return result


def _classification_delta_receipt(
    approval_rows_by_id: Mapping[int, Mapping[str, object]],
    predecessor_rows: Sequence[CandidateCatalogRow],
    candidate_rows: Sequence[CandidateCatalogRow],
    accepted_hash: str,
) -> ClassificationDeltaReceipt:
    predecessor = _catalog_entity_authorities(predecessor_rows)
    candidate = _catalog_entity_authorities(candidate_rows)
    expected_entities: set[int] = set()
    records: list[dict[str, object]] = []
    for item_id, item in sorted(approval_rows_by_id.items()):
        if str(item.get("readiness_state") or "") != "ready":
            continue
        decision = str(item.get("url_alias_decision") or "")
        selected_entity_id = int(item.get("selected_content_entity_id") or 0)
        entity_id = (
            selected_entity_id
            if decision in {"attach", "create"} and selected_entity_id > 0
            else int(item.get("content_entity_id") or 0)
        )
        final_values = tuple(
            str(item.get(name) or "")
            for name in (
                "final_direction_code",
                "final_material_type_code",
                "final_access_code",
                "final_lifecycle_code",
            )
        )
        if entity_id <= 0 or any(not value for value in final_values):
            raise CandidateMaterializationError(
                "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
            )
        old = predecessor.get(entity_id)
        old_values = (
            (
                old.direction_code,
                old.material_type_code,
                old.access_code,
                old.lifecycle_code,
            )
            if old is not None
            else None
        )
        if old_values == final_values:
            continue
        current = candidate.get(entity_id)
        current_values = (
            (
                current.direction_code,
                current.material_type_code,
                current.access_code,
                current.lifecycle_code,
            )
            if current is not None
            else None
        )
        if (
            current is None
            or current_values != final_values
            or int(current.classification_event_id or 0) <= 0
            or re.fullmatch(
                r"[0-9a-f]{64}",
                str(current.classification_event_fingerprint or ""),
            )
            is None
        ):
            raise CandidateMaterializationError(
                "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
            )
        expected_entities.add(entity_id)
        records.append(
            {
                "accepted_decision_hash": accepted_hash,
                "approval_item_id": int(item_id),
                "candidate_event_fingerprint": current.classification_event_fingerprint,
                "candidate_event_id": current.classification_event_id,
                "candidate_values": final_values,
                "content_entity_id": entity_id,
                "predecessor_event_fingerprint": (
                    old.classification_event_fingerprint if old else None
                ),
                "predecessor_event_id": (
                    old.classification_event_id if old else None
                ),
                "predecessor_values": old_values,
                "row_hash": str(item.get("row_hash") or ""),
            }
        )
    for entity_id in set(predecessor) & set(candidate):
        if entity_id in expected_entities:
            continue
        old = predecessor[entity_id]
        current = candidate[entity_id]
        if (
            old.direction_code,
            old.material_type_code,
            old.access_code,
            old.lifecycle_code,
        ) != (
            current.direction_code,
            current.material_type_code,
            current.access_code,
            current.lifecycle_code,
        ):
            raise CandidateMaterializationError(
                "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
            )
    if (set(candidate) - set(predecessor)) != (
        expected_entities - set(predecessor)
    ):
        raise CandidateMaterializationError(
            "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
        )
    digest = sha256_text(_canonical_json(records))
    return ClassificationDeltaReceipt(
        expected_count=len(records),
        actual_count=len(records),
        expected_hash=digest,
        actual_hash=digest,
    )


def _referenced_taxonomy_terms(
    rows: Iterable[CandidateCatalogRow],
) -> list[dict[str, str]]:
    referenced: set[tuple[str, str, str]] = set()
    for row in rows:
        for kind, code, label in (
            ("direction", row.direction_code, row.direction_key),
            ("material_type", row.material_type_code, row.material_type),
            ("access", row.access_code, row.access_label),
            ("lifecycle", row.lifecycle_code, row.lifecycle_label),
        ):
            if not code:
                raise CandidateMaterializationError("CANDIDATE_TAXONOMY_INVALID")
            referenced.add((kind, str(code), str(label or "")))
    return [
        {"taxonomy_kind": kind, "term_code": code, "term_label": label}
        for kind, code, label in sorted(referenced)
    ]


def _catalog_payload(row: CandidateCatalogRow) -> tuple[object, ...]:
    provenance = {
        "canonical_codes": {
            "access": row.access_code,
            "direction": row.direction_code,
            "lifecycle": row.lifecycle_code,
            "material_type": row.material_type_code,
        },
        "canonical_labels": {"lifecycle": row.lifecycle_label},
        "classification_event_fingerprint": row.classification_event_fingerprint,
        "classification_event_id": row.classification_event_id,
        "content_entity_id": row.content_entity_id,
        "mode": row.provenance_mode,
        "predecessor_catalog_row_id": row.predecessor_catalog_row_id,
        "baseline_provenance_fingerprint": row.baseline_provenance_fingerprint,
        "source_row_fingerprint": row.source_row_fingerprint,
    }
    visible = (
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
    provenance_json = _canonical_json(provenance)
    row_hash = _hash_rows(
        (
            (
                *visible,
                row.content_entity_id,
                row.classification_event_id,
                row.classification_event_fingerprint,
                provenance_json,
            ),
        )
    )
    return (
        *visible,
        row.content_entity_id,
        row.classification_event_id,
        row.classification_event_fingerprint,
        provenance_json,
        row_hash,
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


def _canonical_catalog_rows(
    rows: Iterable[object], columns: Sequence[str]
) -> tuple[tuple[object, ...], ...]:
    projection_index = columns.index("projection_provenance_json")
    sheet_index = columns.index("source_sheet")
    ordinal_index = columns.index("source_row_ordinal")
    result = []
    for row in rows:
        values = list(_ordered_row(row, columns))
        values[projection_index] = _canonical_json(
            _decode_json(
                values[projection_index] or {},
                code="CATALOG_PROVENANCE_INVALID",
            )
        )
        result.append(tuple(values))
    return tuple(
        sorted(
            result,
            key=lambda row: (
                str(row[sheet_index] or ""), int(row[ordinal_index] or 0)
            ),
        )
    )


def _canonical_lookup_rows(
    rows: Iterable[object], columns: Sequence[str] = _LOOKUP_COLUMNS
) -> tuple[tuple[object, ...], ...]:
    kind_index = columns.index("lookup_kind")
    hash_index = columns.index("lookup_key_hash")
    return tuple(
        sorted(
            (_ordered_row(row, columns) for row in rows),
            key=lambda row: (str(row[kind_index] or ""), str(row[hash_index] or "")),
        )
    )


def _snapshot_records(
    rows: Iterable[object], *, include_ids: bool
) -> list[dict[str, object]]:
    records = []
    for row in rows:
        record: dict[str, object] = {
            "source_kind": str(_row_value(row, "source_kind", 1) or ""),
            "content_sha256": str(_row_value(row, "content_sha256", 2) or ""),
            "content_bytes": int(_row_value(row, "content_bytes", 3) or 0),
            "parser_version": str(_row_value(row, "parser_version", 4) or ""),
            "source_row_count": int(_row_value(row, "source_row_count", 9) or 0),
        }
        if include_ids:
            manifest = _decode_json(
                _row_value(row, "manifest_json", 8), code="SOURCE_MANIFEST_INVALID"
            )
            record = {
                "id": int(_row_value(row, "id", 0) or 0),
                **record,
                "import_status": str(_row_value(row, "import_status", 5) or ""),
                "imported_row_count": int(
                    _row_value(row, "imported_row_count", 6) or 0
                ),
                "rejected_row_count": int(
                    _row_value(row, "rejected_row_count", 7) or 0
                ),
                "manifest_hash": sha256_text(_canonical_json(manifest)),
            }
        records.append(record)
    return records


def _require_catalog_snapshot_authority(
    row: object,
    expected_manifest: Mapping[str, object],
) -> Mapping[str, object]:
    if not isinstance(row, Mapping):
        raise CandidateMaterializationError("CATALOG_SNAPSHOT_REUSE_INVALID")
    manifest = _decode_json(
        row.get("manifest_json"), code="CATALOG_SNAPSHOT_REUSE_INVALID"
    )
    authority_fields = (
        "accepted_decision_hash",
        "batch_id",
        "catalog_hash",
        "content_bytes",
        "content_sha256",
        "lookup_hash",
        "lookup_row_count",
        "parser_version",
        "predecessor_release_id",
        "rejected_count",
        "source_kind",
        "source_row_count",
    )
    if (
        not isinstance(manifest, Mapping)
        or int(row.get("id") or 0) <= 0
        or str(row.get("source_kind") or "") != CATALOG_SOURCE_KIND
        or str(row.get("source_locator") or "")
        != f"canonical://abbott/content-batch/{expected_manifest['batch_id']}"
        or str(row.get("content_sha256") or "")
        != str(expected_manifest["content_sha256"])
        or int(row.get("content_bytes") or 0)
        != int(expected_manifest["content_bytes"])
        or int(row.get("source_row_count") or 0)
        != int(expected_manifest["source_row_count"])
        or str(row.get("parser_version") or "") != CATALOG_PARSER_VERSION
        or str(row.get("import_status") or "") != "imported"
        or int(row.get("imported_row_count") or 0)
        != int(expected_manifest["source_row_count"])
        or int(row.get("rejected_row_count") or 0) != 0
        or any(manifest.get(name) != expected_manifest.get(name) for name in authority_fields)
    ):
        raise CandidateMaterializationError("CATALOG_SNAPSHOT_REUSE_INVALID")
    return row


def _import_records(rows: Iterable[object]) -> list[dict[str, object]]:
    return [
        {
            "source_snapshot_id": int(_row_value(row, "source_snapshot_id", 0) or 0),
            "source_kind": str(_row_value(row, "source_kind", 1) or ""),
            "imported_row_count": int(_row_value(row, "imported_row_count", 2) or 0),
            "rejected_row_count": int(_row_value(row, "rejected_row_count", 3) or 0),
            "import_status": str(_row_value(row, "import_status", 4) or ""),
            "code_revision": str(_row_value(row, "code_revision", 5) or ""),
        }
        for row in rows
    ]


def _records_hash(records: object) -> str:
    return sha256_text(_canonical_json(records))


def _snapshot_rejections_allowed(row: object) -> bool:
    if str(_row_value(row, "import_status", 5) or "") != "imported":
        return False
    rejected_count = int(_row_value(row, "rejected_row_count", 7) or 0)
    if str(_row_value(row, "source_kind", 1) or "") != MNN_SOURCE_KIND:
        return rejected_count == 0
    manifest = _decode_json(
        _row_value(row, "manifest_json", 8), code="SOURCE_MANIFEST_INVALID"
    )
    return (
        isinstance(manifest, Mapping)
        and int(manifest.get("rejected_placeholder_count") or 0) == rejected_count
        and int(manifest.get("rejected_count") or 0) == rejected_count
        and int(manifest.get("unknown_malformed_count") or 0) == 0
    )


def _mnn_semantic_rows(
    cursor,
    *,
    predecessor_release_id: int,
    old_mnn_snapshot_id: int | None,
    new_mnn_snapshot_id: int | None,
    continuity: Sequence[EntityContinuity],
) -> tuple[tuple[int, int, int, str, str], ...]:
    predecessor_rows: list[tuple[int, int, int, str, str, str]] = []
    if old_mnn_snapshot_id is not None:
        cursor.execute(
            """
            SELECT content_entity_id, mnn_source_snapshot_id, source_claim_id,
                   mnn_key, mnn_label, mapping_fingerprint
            FROM portal_content_catalog_mnn
            WHERE canonical_release_id = %s
            ORDER BY content_entity_id, mnn_key, source_claim_id
            """,
            (predecessor_release_id,),
        )
        predecessor_rows = [
            (
                int(_row_value(row, "content_entity_id", 0)),
                int(_row_value(row, "mnn_source_snapshot_id", 1)),
                int(_row_value(row, "source_claim_id", 2)),
                str(_row_value(row, "mnn_key", 3) or ""),
                str(_row_value(row, "mnn_label", 4) or ""),
                str(_row_value(row, "mapping_fingerprint", 5) or ""),
            )
            for row in cursor.fetchall()
        ]
    if new_mnn_snapshot_id is None or new_mnn_snapshot_id == old_mnn_snapshot_id:
        try:
            records = project_mnn_records(predecessor_rows, continuity)
        except MnnProjectionError as error:
            raise CandidateMaterializationError(str(error)) from None
        return tuple(
            (
                row.content_entity_id,
                row.mnn_source_snapshot_id,
                row.source_claim_id,
                row.mnn_key,
                row.mnn_label,
            )
            for row in records
        )
    cursor.execute(
        """
        SELECT claim.resolved_content_entity_id AS content_entity_id,
               claim.source_snapshot_id AS mnn_source_snapshot_id,
               claim.id AS source_claim_id, claim.mnn_key, claim.mnn_label,
               entity.registry_status
        FROM portal_content_mnn_source_claims AS claim
        LEFT JOIN portal_content_registry_entities AS entity
          ON entity.id = claim.resolved_content_entity_id
         AND entity.dataset_key = %s
        WHERE claim.source_snapshot_id = %s
          AND claim.resolution_status = 'mapped'
        ORDER BY claim.resolved_content_entity_id, claim.mnn_key, claim.id
        FOR UPDATE
        """,
        (DATASET_KEY, new_mnn_snapshot_id),
    )
    new_rows: list[tuple[int, int, int, str, str]] = []
    candidate_entity_ids = {
        row.candidate_id for row in continuity if row.candidate_id is not None
    }
    for row in cursor.fetchall():
        values = (
            int(_row_value(row, "content_entity_id", 0) or 0),
            int(_row_value(row, "mnn_source_snapshot_id", 1) or 0),
            int(_row_value(row, "source_claim_id", 2) or 0),
            str(_row_value(row, "mnn_key", 3) or ""),
            str(_row_value(row, "mnn_label", 4) or ""),
        )
        if (
            values[0] <= 0
            or values[0] not in candidate_entity_ids
            or values[1] != new_mnn_snapshot_id
            or values[2] <= 0
            or not values[3]
            or not values[4]
            or str(_row_value(row, "registry_status", 5) or "") != "active"
        ):
            raise CandidateMaterializationError("MNN_MAPPING_INVALID")
        new_rows.append(values)
    # A reviewed replacement workbook is authoritative as a whole.  Keeping
    # predecessor rows here would orphan their source-claim provenance after
    # the predecessor snapshot/import receipt is removed from the successor.
    result = new_rows
    identities = [(row[0], row[3]) for row in result]
    if len(identities) != len(set(identities)):
        raise CandidateMaterializationError("MNN_MAPPING_DUPLICATE")
    return tuple(sorted(result, key=lambda row: (row[0], row[3], row[2])))


def _persist_mnn_projection(
    cursor,
    *,
    candidate_release_id: int,
    rows: Sequence[tuple[int, int, int, str, str]],
) -> None:
    for entity_id, snapshot_id, claim_id, mnn_key, mnn_label in rows:
        fingerprint = sha256_text(
            _canonical_json(
                {
                    "canonical_release_id": candidate_release_id,
                    "content_entity_id": entity_id,
                    "mnn_key": mnn_key,
                    "source_claim_id": claim_id,
                }
            )
        )
        cursor.execute(
            """
            INSERT INTO portal_content_catalog_mnn (
              canonical_release_id, content_entity_id, mnn_source_snapshot_id,
              source_claim_id, mnn_key, mnn_label, mapping_fingerprint
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                candidate_release_id,
                entity_id,
                snapshot_id,
                claim_id,
                mnn_key,
                mnn_label,
                fingerprint,
            ),
        )
        if int(getattr(cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("MNN_MAPPING_INSERT_FAILED")
    cursor.execute(
        """
        SELECT content_entity_id, mnn_source_snapshot_id, source_claim_id,
               mnn_key, mnn_label
        FROM portal_content_catalog_mnn
        WHERE canonical_release_id = %s
        ORDER BY content_entity_id, mnn_key, source_claim_id
        """,
        (candidate_release_id,),
    )
    actual = tuple(
        (
            int(_row_value(row, "content_entity_id", 0)),
            int(_row_value(row, "mnn_source_snapshot_id", 1)),
            int(_row_value(row, "source_claim_id", 2)),
            str(_row_value(row, "mnn_key", 3) or ""),
            str(_row_value(row, "mnn_label", 4) or ""),
        )
        for row in cursor.fetchall()
    )
    if actual != tuple(rows):
        raise CandidateMaterializationError("MNN_MAPPING_ATTESTATION_FAILED")


# Explicit columns keep the copy auditable and preserve Abbott UTM/visit grains.
_NON_CONTENT_RELEASE_TABLES: tuple[
    tuple[str, tuple[str, ...], tuple[str, ...]], ...
] = (
    (
        "portal_general_materials",
        (
            "source_snapshot_id", "material_key", "material_title", "material_type",
            "normalized_url", "normalized_url_hash", "normalized_path",
            "normalized_path_hash", "direction_key", "published_at", "metadata_json",
            "created_at", "updated_at",
        ),
        ("source_snapshot_id", "material_key"),
    ),
    (
        "portal_event_catalog",
        (
            "source_snapshot_id", "event_title", "direction_key", "registration_url",
            "registration_url_hash", "access_label", "source_row_fingerprint",
            "created_at", "updated_at",
        ),
        ("source_snapshot_id", "source_row_fingerprint"),
    ),
    (
        "portal_external_events",
        (
            "source_snapshot_id", "source_key", "analytics_account_id", "report_date",
            "occurred_at", "normalized_path", "normalized_path_hash", "event_kind",
            "source_name", "campaign_name", "source_row_fingerprint", "created_at",
        ),
        ("source_key", "analytics_account_id", "report_date", "source_row_fingerprint"),
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
        ("source_snapshot_id", "analytics_account_id", "report_date", "source_row_fingerprint"),
    ),
    (
        "portal_bitrix_journey_transitions",
        (
            "source_snapshot_id", "analytics_account_id", "report_date", "from_path",
            "from_path_hash", "to_path", "to_path_hash", "transition_count",
            "created_at", "updated_at",
        ),
        ("source_snapshot_id", "analytics_account_id", "report_date", "from_path_hash", "to_path_hash"),
    ),
    (
        "canonical_fact_metrika_site_analytics_daily",
        (
            "source_key", "analytics_account_id", "counter_id", "report_date",
            "analytics_scope", "scope_hash", "scope_dimensions", "sessions", "users",
            "pageviews", "bounce_rate", "average_session_seconds", "goal_conversions",
            "raw_payload", "ingestion_run_id", "created_at",
        ),
        ("source_key", "analytics_account_id", "report_date", "analytics_scope", "scope_hash"),
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
        ("counter_id", "report_date", "raw_page_hash", "return_bucket_code"),
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
        ("source_key", "counter_id", "scope_key", "report_date"),
    ),
    (
        "report_bd_private.canonical_fact_metrika_user_behavior_daily",
        (
            "counter_id", "report_date", "raw_user_id", "raw_user_id_hash",
            "start_url", "start_url_hash", "end_url", "end_url_hash", "visit_id",
            "visit_id_hash", "session_started_at", "session_ended_at", "pageviews",
            "request_fingerprint", "ingestion_run_id", "created_at",
        ),
        ("counter_id", "report_date", "request_fingerprint"),
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
        ("counter_id", "report_date", "visit_id_hash"),
    ),
    (
        "report_bd_private.portal_user_directions_private",
        (
            "source_snapshot_id", "raw_user_id", "raw_user_id_hash",
            "normalized_direction", "normalized_specialization", "created_at",
            "updated_at",
        ),
        ("source_snapshot_id", "raw_user_id_hash"),
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
        ("source_snapshot_id", "analytics_account_id", "report_date", "source_row_fingerprint"),
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
        ("source_snapshot_id", "analytics_account_id", "report_date", "protected_visit_id_hash", "event_sequence"),
    ),
)


def _read_non_content_bundle(cur, release_id: int) -> dict[str, dict[str, object]]:
    bundle: dict[str, dict[str, object]] = {}
    for table, columns, natural_grain in _NON_CONTENT_RELEASE_TABLES:
        column_sql = ", ".join(columns)
        cur.execute(
            f"SELECT {column_sql} FROM {table} "
            f"WHERE canonical_release_id = %s ORDER BY {', '.join(natural_grain)}",
            (release_id,),
        )
        digest = hashlib.sha256()
        digest.update(b"[")
        count = 0
        while True:
            chunk = cur.fetchmany(1000)
            if not chunk:
                break
            for row in chunk:
                if count:
                    digest.update(b",")
                digest.update(_canonical_json(list(_ordered_row(row, columns))).encode("utf-8"))
                count += 1
        digest.update(b"]")
        bundle[table] = {"count": count, "hash": digest.hexdigest()}
    return bundle


def _copy_non_content_facts(
    cur,
    predecessor_id: int,
    candidate_id: int,
    predecessor_bundle: Mapping[str, Mapping[str, object]],
) -> dict[str, dict[str, object]]:
    for table, columns, natural_grain in _NON_CONTENT_RELEASE_TABLES:
        expected = predecessor_bundle[table]
        column_sql = ", ".join(columns)
        cur.execute(
            f"INSERT INTO {table} (canonical_release_id, {column_sql}) "
            f"SELECT %s, {column_sql} FROM {table} WHERE canonical_release_id = %s "
            f"ORDER BY {', '.join(natural_grain)}",
            (candidate_id, predecessor_id),
        )
        if int(getattr(cur, "rowcount", -1)) != int(expected["count"]):
            raise CandidateMaterializationError("NON_CONTENT_COPY_COUNT_MISMATCH")
    candidate_bundle = _read_non_content_bundle(cur, candidate_id)
    for table, expected in predecessor_bundle.items():
        actual = candidate_bundle.get(table) or {}
        if (
            actual.get("count") != expected.get("count")
            or actual.get("hash") != expected.get("hash")
        ):
            raise CandidateMaterializationError("NON_CONTENT_COPY_HASH_MISMATCH")
    return candidate_bundle


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


def acknowledge_content_candidate_activation(
    batch_id: int,
    candidate_release_id: int,
    predecessor_release_id: int,
    *,
    connection_factory=None,
) -> str:
    """Record that the batch candidate is the current active Abbott release."""

    try:
        batch_id = int(batch_id)
        candidate_release_id = int(candidate_release_id)
        predecessor_release_id = int(predecessor_release_id)
    except (TypeError, ValueError):
        raise CandidateMaterializationError("ACTIVATION_ACK_INPUT_INVALID") from None
    if min(batch_id, candidate_release_id, predecessor_release_id) <= 0:
        raise CandidateMaterializationError("ACTIVATION_ACK_INPUT_INVALID")

    connection = None
    cursor = None
    try:
        connection = (connection_factory or get_db_connection)()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT canonical_release_id
            FROM portal_active_data_releases
            WHERE dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        active = cursor.fetchone()
        if (
            not isinstance(active, Mapping)
            or int(active.get("canonical_release_id") or 0)
            != candidate_release_id
        ):
            raise CandidateMaterializationError("ACTIVE_CANDIDATE_MISMATCH")

        cursor.execute(
            """
            SELECT id, release_status, rollback_from_release_id
            FROM portal_data_releases
            WHERE dataset_key = %s AND id = %s
            """,
            (DATASET_KEY, candidate_release_id),
        )
        candidate = cursor.fetchone()
        if (
            not isinstance(candidate, Mapping)
            or int(candidate.get("id") or 0) != candidate_release_id
            or candidate.get("release_status") != "active"
            or int(candidate.get("rollback_from_release_id") or 0)
            != predecessor_release_id
        ):
            raise CandidateMaterializationError("ACTIVE_CANDIDATE_MISMATCH")

        cursor.execute(
            """
            SELECT id, batch_status, candidate_release_id, activation_status,
                   accepted_decision_hash, accepted_at
            FROM portal_content_approval_batches
            WHERE id = %s AND dataset_key = %s
            FOR UPDATE
            """,
            (batch_id, DATASET_KEY),
        )
        batch = cursor.fetchone()
        accepted_hash = batch.get("accepted_decision_hash") if isinstance(batch, Mapping) else None
        if (
            not isinstance(batch, Mapping)
            or int(batch.get("id") or 0) != batch_id
            or batch.get("batch_status") != "candidate_materialized"
            or int(batch.get("candidate_release_id") or 0) != candidate_release_id
            or batch.get("activation_status") not in {"candidate", "active"}
            or not isinstance(accepted_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", accepted_hash)
            or batch.get("accepted_at") is None
        ):
            raise CandidateMaterializationError("ACTIVATION_ACK_BATCH_MISMATCH")
        if batch.get("activation_status") == "active":
            connection.commit()
            return "noop"

        cursor.execute(
            """
            UPDATE portal_content_approval_batches
            SET activation_status = 'active'
            WHERE id = %s AND dataset_key = %s
              AND candidate_release_id = %s
              AND batch_status = 'candidate_materialized'
              AND activation_status = 'candidate'
            """,
            (batch_id, DATASET_KEY, candidate_release_id),
        )
        if cursor.rowcount != 1:
            raise CandidateMaterializationError("ACTIVATION_ACK_BATCH_MISMATCH")
        connection.commit()
        return "active"
    except CandidateMaterializationError:
        if connection is not None:
            connection.rollback()
        raise
    except Exception:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError("ACTIVATION_ACK_FAILED") from None
    finally:
        _close(cursor, connection)


def reset_failed_content_candidate(
    batch_id: int,
    candidate_release_id: int,
    expected_active_release_id: int,
    *,
    connection_factory=None,
) -> str:
    """Resume a reviewed batch after validation failure or a proven smoke rollback."""

    try:
        batch_id = int(batch_id)
        candidate_release_id = int(candidate_release_id)
        expected_active_release_id = int(expected_active_release_id)
    except (TypeError, ValueError):
        raise CandidateMaterializationError("CANDIDATE_RESET_INPUT_INVALID") from None
    if min(batch_id, candidate_release_id, expected_active_release_id) <= 0:
        raise CandidateMaterializationError("CANDIDATE_RESET_INPUT_INVALID")

    connection = None
    cursor = None
    try:
        connection = (connection_factory or get_db_connection)()
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT canonical_release_id
            FROM portal_active_data_releases
            WHERE dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        active = cursor.fetchone()
        if (
            not isinstance(active, Mapping)
            or int(active.get("canonical_release_id") or 0)
            != expected_active_release_id
        ):
            raise CandidateMaterializationError("ACTIVE_PREDECESSOR_MISMATCH")

        cursor.execute(
            """
            SELECT id, release_status, rollback_from_release_id
            FROM portal_data_releases
            WHERE dataset_key = %s AND id = %s
            FOR UPDATE
            """,
            (DATASET_KEY, candidate_release_id),
        )
        candidate = cursor.fetchone()
        candidate_matches_predecessor = (
            isinstance(candidate, Mapping)
            and int(candidate.get("id") or 0) == candidate_release_id
            and int(candidate.get("rollback_from_release_id") or 0)
            == expected_active_release_id
        )
        if not candidate_matches_predecessor:
            raise CandidateMaterializationError("FAILED_CANDIDATE_MISMATCH")
        candidate_status = candidate.get("release_status")
        if candidate_status == "retired":
            cursor.execute(
                """
                SELECT id, release_status, rollback_from_release_id
                FROM portal_data_releases
                WHERE dataset_key = %s AND id = %s
                FOR UPDATE
                """,
                (DATASET_KEY, expected_active_release_id),
            )
            active_release = cursor.fetchone()
            if (
                not isinstance(active_release, Mapping)
                or int(active_release.get("id") or 0) != expected_active_release_id
                or active_release.get("release_status") != "active"
                or int(active_release.get("rollback_from_release_id") or 0)
                != candidate_release_id
            ):
                raise CandidateMaterializationError("FAILED_CANDIDATE_MISMATCH")
        elif candidate_status != "failed":
            raise CandidateMaterializationError("FAILED_CANDIDATE_MISMATCH")

        cursor.execute(
            """
            SELECT id, batch_status, candidate_release_id, activation_status,
                   accepted_decision_hash, accepted_at
            FROM portal_content_approval_batches
            WHERE id = %s AND dataset_key = %s
            FOR UPDATE
            """,
            (batch_id, DATASET_KEY),
        )
        batch = cursor.fetchone()
        if not isinstance(batch, Mapping) or int(batch.get("id") or 0) != batch_id:
            raise CandidateMaterializationError("FAILED_CANDIDATE_BATCH_MISMATCH")
        if (
            batch.get("batch_status") == "ingested"
            and batch.get("candidate_release_id") is None
            and batch.get("activation_status") == "not_started"
        ):
            connection.commit()
            return "noop"
        accepted_hash = batch.get("accepted_decision_hash")
        if (
            batch.get("batch_status") != "candidate_materialized"
            or int(batch.get("candidate_release_id") or 0) != candidate_release_id
            or batch.get("activation_status") != "candidate"
            or not isinstance(accepted_hash, str)
            or not re.fullmatch(r"[0-9a-f]{64}", accepted_hash)
            or batch.get("accepted_at") is None
        ):
            raise CandidateMaterializationError("FAILED_CANDIDATE_BATCH_MISMATCH")

        cursor.execute(
            """
            UPDATE portal_content_approval_batches
            SET batch_status = 'ingested',
                candidate_release_id = NULL,
                activation_status = 'not_started'
            WHERE id = %s AND dataset_key = %s
              AND candidate_release_id = %s
              AND batch_status = 'candidate_materialized'
              AND activation_status = 'candidate'
            """,
            (batch_id, DATASET_KEY, candidate_release_id),
        )
        if cursor.rowcount != 1:
            raise CandidateMaterializationError("FAILED_CANDIDATE_BATCH_MISMATCH")
        connection.commit()
        return "reset"
    except CandidateMaterializationError:
        if connection is not None:
            connection.rollback()
        raise
    except Exception:
        if connection is not None:
            connection.rollback()
        raise CandidateMaterializationError("CANDIDATE_RESET_FAILED") from None
    finally:
        _close(cursor, connection)


def materialize_content_candidate(
    batch_id: int,
    predecessor_release_id: int,
    code_revision: str,
    *,
    mnn_snapshot_id: int | None = None,
    connection_factory=None,
) -> CandidateMaterialization:
    """Transform the locked predecessor bundle into one staging successor."""

    try:
        batch_id = int(batch_id)
        predecessor_release_id = int(predecessor_release_id)
        requested_mnn_snapshot_id = (
            int(mnn_snapshot_id) if mnn_snapshot_id is not None else None
        )
    except (TypeError, ValueError):
        raise CandidateMaterializationError("CANDIDATE_INPUT_INVALID") from None
    if (
        batch_id <= 0
        or predecessor_release_id <= 0
        or not isinstance(code_revision, str)
        or not re.fullmatch(r"[0-9a-f]{7,64}", code_revision)
        or (requested_mnn_snapshot_id is not None and requested_mnn_snapshot_id <= 0)
    ):
        raise CandidateMaterializationError("CANDIDATE_INPUT_INVALID")

    connection = None
    cursor = None
    try:
        connection = (connection_factory or get_db_connection)()
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
                not isinstance(value, int) or isinstance(value, bool) or value <= 0
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
                   batch.taxonomy_digest, batch.published_input_hash,
                   batch.prompt_version, batch.model_routing_version,
                   batch.accepted_by, taxonomy.version AS taxonomy_version,
                   batch.accepted_at, batch.source_snapshot_ids,
                   batch.source_snapshot_digests, batch.projection_kind
            FROM portal_content_approval_batches AS batch
            INNER JOIN portal_content_taxonomy_versions AS taxonomy
              ON taxonomy.id = batch.taxonomy_version_id
             AND taxonomy.dataset_key = batch.dataset_key
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
            or batch.get("accepted_at") is None
        ):
            raise CandidateMaterializationError("BATCH_NOT_INGESTED")
        approval_bundle = _load_approval_bundle(cursor, batch_id, batch)
        counts = approval_bundle["counts"]
        if not isinstance(counts, Mapping):
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")
        persisted_counts = {
            "ready": int(batch.get("ready_count") or 0),
            "conflict": int(batch.get("conflict_count") or 0),
            "unresolved": int(batch.get("unresolved_count") or 0),
            "rejected": int(batch.get("rejected_count") or 0),
            "no_change": int(batch.get("no_change_count") or 0),
            "accepted": int(batch.get("accepted_count") or 0),
        }
        if (
            any(int(counts[name]) != value for name, value in persisted_counts.items())
            or approval_bundle["accepted_hash"] != batch.get("accepted_decision_hash")
            or int(approval_bundle["identity_collisions"]) != 0
            or int(approval_bundle["schema_failures"]) != 0
        ):
            raise CandidateMaterializationError("APPROVAL_BUNDLE_INVALID")

        if _strong_identity_collision_count(cursor, batch_id) != 0:
            raise CandidateMaterializationError("STRONG_IDENTITY_COLLISION")

        placeholders = ", ".join(["%s"] * len(predecessor_source_ids))
        cursor.execute(
            f"""
            SELECT id, source_kind, content_sha256, content_bytes,
                   parser_version, import_status, imported_row_count,
                   rejected_row_count, manifest_json, source_row_count
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id IN ({placeholders})
            ORDER BY id
            """,
            (DATASET_KEY, *predecessor_source_ids),
        )
        snapshot_rows = tuple(cursor.fetchall())
        if len(snapshot_rows) != len(predecessor_source_ids):
            raise CandidateMaterializationError("SOURCE_SNAPSHOT_SET_INVALID")
        snapshots_by_id = {int(row["id"]): row for row in snapshot_rows}
        old_catalog_ids = [
            snapshot_id
            for snapshot_id, row in snapshots_by_id.items()
            if row.get("source_kind") == CATALOG_SOURCE_KIND
        ]
        if len(old_catalog_ids) != 1:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_SET_INVALID")
        old_mnn_ids = [
            snapshot_id
            for snapshot_id, row in snapshots_by_id.items()
            if row.get("source_kind") == MNN_SOURCE_KIND
        ]
        if len(old_mnn_ids) > 1:
            raise CandidateMaterializationError("MNN_SNAPSHOT_SET_INVALID")
        if requested_mnn_snapshot_id is not None and requested_mnn_snapshot_id not in snapshots_by_id:
            cursor.execute(
                """
                SELECT id, source_kind, content_sha256, content_bytes,
                       parser_version, import_status, imported_row_count,
                       rejected_row_count, manifest_json, source_row_count
                FROM portal_dataset_snapshots
                WHERE dataset_key = %s AND id = %s
                FOR UPDATE
                """,
                (DATASET_KEY, requested_mnn_snapshot_id),
            )
            requested_snapshot = cursor.fetchone()
            if (
                not isinstance(requested_snapshot, Mapping)
                or int(requested_snapshot.get("id") or 0) != requested_mnn_snapshot_id
                or requested_snapshot.get("source_kind") != MNN_SOURCE_KIND
                or requested_snapshot.get("import_status") != "imported"
            ):
                raise CandidateMaterializationError("MNN_SNAPSHOT_INVALID")
            snapshots_by_id[requested_mnn_snapshot_id] = requested_snapshot
        batch_source_ids = _decode_json(
            batch.get("source_snapshot_ids"), code="BATCH_SOURCE_BINDING_INVALID"
        )
        batch_source_digests = _decode_json(
            batch.get("source_snapshot_digests"), code="BATCH_SOURCE_BINDING_INVALID"
        )
        ordered_digests = [
            str(snapshots_by_id[snapshot_id].get("content_sha256") or "")
            for snapshot_id in predecessor_source_ids
        ]
        if (
            batch_source_ids != predecessor_source_ids
            or batch_source_digests != ordered_digests
        ):
            raise CandidateMaterializationError("BATCH_SOURCE_BINDING_INVALID")

        cursor.execute(
            """
            SELECT source_snapshot_id, source_kind, imported_row_count,
                   rejected_row_count, import_status, code_revision
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

        cursor.execute(
            """
            SELECT manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id = %s
              AND source_kind = 'abbott_canonical_control_pack'
            """,
            (DATASET_KEY, predecessor["baseline_validation_run_id"]),
        )
        predecessor_baseline_row = cursor.fetchone()
        predecessor_baseline = _decode_json(
            predecessor_baseline_row.get("manifest_json")
            if isinstance(predecessor_baseline_row, Mapping)
            else None,
            code="PREDECESSOR_BASELINE_INVALID",
        )
        if not isinstance(predecessor_baseline, Mapping):
            raise CandidateMaterializationError("PREDECESSOR_BASELINE_INVALID")

        cursor.execute(
            """
            SELECT predecessor_catalog.id, predecessor_catalog.normalized_url,
                   predecessor_catalog.normalized_url_hash,
                   predecessor_catalog.normalized_path, predecessor_catalog.page_title,
                   predecessor_catalog.material_id, predecessor_catalog.material_type,
                   predecessor_catalog.source_slug, predecessor_catalog.source_slug_hash,
                   predecessor_catalog.access_label, predecessor_catalog.is_active,
                   predecessor_catalog.source_sheet,
                   predecessor_catalog.source_row_ordinal,
                   predecessor_catalog.source_row_fingerprint,
                   predecessor_catalog.section_key, predecessor_catalog.direction_key,
                   predecessor_catalog.published_at, predecessor_catalog.valid_from,
                   predecessor_catalog.valid_to, predecessor_catalog.content_entity_id,
                   predecessor_catalog.classification_event_id,
                   predecessor_catalog.classification_event_fingerprint,
                   predecessor_catalog.projection_provenance_json,
                   predecessor_catalog.projection_row_hash
            FROM portal_content_catalog AS predecessor_catalog
            WHERE predecessor_catalog.canonical_release_id = %s
              AND predecessor_catalog.source_snapshot_id = %s
            ORDER BY predecessor_catalog.source_sheet,
                     predecessor_catalog.source_row_ordinal
            """,
            (predecessor_release_id, old_catalog_ids[0]),
        )
        predecessor_catalog_rows = tuple(cursor.fetchall())
        if not predecessor_catalog_rows:
            raise CandidateMaterializationError("PREDECESSOR_CATALOG_EMPTY")
        predecessor_catalog_rows = _resolve_legacy_predecessor_rows(
            cursor,
            predecessor_catalog_rows,
            predecessor_release_id=predecessor_release_id,
            predecessor_snapshot_id=old_catalog_ids[0],
            taxonomy_version_id=int(batch["taxonomy_version_id"]),
        )

        validate_reviewed_url_alias_decisions(
            cursor,
            batch,
            approval_bundle["approval_rows_by_id"],
        )
        created_url_event_fingerprints = _authorize_created_page_identities(
            _load_created_page_identity_rows(cursor, batch_id),
            approval_bundle["approval_rows_by_id"],
            batch,
        )

        cursor.execute(
            """
            SELECT entity.id AS authorized_entity_id,
                   event.content_entity_id, entity.material_id,
                   entity.title, entity.canonical_url, entity.source_evidence,
                   event.id AS classification_event_id, event.direction_code,
                   event.material_type_code, event.access_code,
                   event.lifecycle_code, event.event_kind,
                   event.event_fingerprint, event.approval_batch_id,
                   event.approval_item_id, event.taxonomy_version_id,
                   event.predecessor_event_id, event.proposal_evidence,
                   event.actor, event.reason,
                   event.effective_at, direction.term_label AS direction_label,
                   material.term_label AS material_type_label,
                   access_term.term_label AS access_label,
                   lifecycle.term_label AS lifecycle_label
            FROM portal_content_classification_events AS event
            LEFT JOIN portal_content_registry_entities AS entity
              ON entity.id = event.content_entity_id
             AND entity.dataset_key = %s
            LEFT JOIN portal_content_taxonomy_terms AS direction
              ON direction.taxonomy_version_id = %s
             AND direction.taxonomy_kind = 'direction'
             AND direction.term_code = event.direction_code
             AND direction.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS material
              ON material.taxonomy_version_id = %s
             AND material.taxonomy_kind = 'material_type'
             AND material.term_code = event.material_type_code
             AND material.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS access_term
              ON access_term.taxonomy_version_id = %s
             AND access_term.taxonomy_kind = 'access'
             AND access_term.term_code = event.access_code
             AND access_term.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS lifecycle
              ON lifecycle.taxonomy_version_id = %s
             AND lifecycle.taxonomy_kind = 'lifecycle'
             AND lifecycle.term_code = event.lifecycle_code
             AND lifecycle.term_status = 'active'
            WHERE event.approval_batch_id = %s
            ORDER BY event.id
            """,
            (
                DATASET_KEY,
                batch["taxonomy_version_id"],
                batch["taxonomy_version_id"],
                batch["taxonomy_version_id"],
                batch["taxonomy_version_id"],
                batch_id,
            ),
        )
        event_rows = tuple(cursor.fetchall())
        _authorize_current_batch_events(
            event_rows,
            approval_bundle["approval_rows_by_id"],
            batch,
            predecessor_catalog_rows,
            created_url_event_fingerprints,
        )
        prior_event_rows = _load_prior_accepted_event_rows(
            cursor, batch_id
        )
        _authorize_prior_accepted_events(prior_event_rows)
        catalog_rows = _overlay_current_batch_events(
            predecessor_catalog_rows,
            tuple(sorted(
                (*prior_event_rows, *event_rows),
                key=lambda row: (
                    row.get("effective_at"),
                    int(row.get("classification_event_id") or 0),
                ),
            )),
        )
        if not catalog_rows:
            raise CandidateMaterializationError("EMPTY_CONTENT_CANDIDATE")
        preserved_mnn_entity_ids = (
            _mnn_only_predecessor_entity_ids(
                cursor,
                predecessor_release_id,
                predecessor_catalog_rows,
            )
            if old_mnn_ids
            else frozenset()
        )
        continuity_rows = _current_batch_entity_continuity(
            predecessor_catalog_rows,
            catalog_rows,
            event_rows,
            approval_bundle["approval_rows_by_id"],
            preserved_entity_ids=preserved_mnn_entity_ids,
        )
        continuity_records = [
            {
                "authority": row.authority,
                "candidate_id": row.candidate_id,
                "predecessor_id": row.predecessor_id,
            }
            for row in continuity_rows
        ]
        continuity_hash = sha256_text(_canonical_json(continuity_records))
        classification_delta = _classification_delta_receipt(
            approval_bundle["approval_rows_by_id"],
            tuple(
                _predecessor_catalog_row(row)
                for row in predecessor_catalog_rows
            ),
            catalog_rows,
            str(approval_bundle["accepted_hash"]),
        )
        cursor.execute(
            """
            SELECT JSON_UNQUOTE(JSON_EXTRACT(
                     scope_dimensions, '$.page_url')) AS page_url,
                   JSON_UNQUOTE(JSON_EXTRACT(
                     scope_dimensions, '$.page_title')) AS page_title
            FROM canonical_fact_metrika_site_analytics_daily
            WHERE canonical_release_id = %s
              AND counter_id = %s
              AND analytics_scope = 'page'
            ORDER BY report_date, scope_hash
            """,
            (predecessor_release_id, ABBOTT_COUNTER_ID),
        )
        page_fact_rows = tuple(cursor.fetchall())
        strong_aliases = _load_active_strong_url_aliases(cursor)
        lookup_rows = build_lookup_projection(
            catalog_rows, page_facts=page_fact_rows, strong_aliases=strong_aliases
        )
        referenced_taxonomy_terms = _referenced_taxonomy_terms(catalog_rows)
        catalog_payloads = tuple(_catalog_payload(row) for row in catalog_rows)
        lookup_payloads = tuple(_lookup_payload(row) for row in lookup_rows)
        catalog_hash = _hash_rows(catalog_payloads)
        lookup_hash = _hash_rows(lookup_payloads)
        predecessor_non_content = _read_non_content_bundle(
            cursor, predecessor_release_id
        )
        old_mnn_snapshot_id = old_mnn_ids[0] if old_mnn_ids else None
        effective_mnn_snapshot_id = (
            requested_mnn_snapshot_id
            if requested_mnn_snapshot_id is not None
            else old_mnn_snapshot_id
        )
        mnn_rows = _mnn_semantic_rows(
            cursor,
            predecessor_release_id=predecessor_release_id,
            old_mnn_snapshot_id=old_mnn_snapshot_id,
            new_mnn_snapshot_id=effective_mnn_snapshot_id,
            continuity=continuity_rows,
        )
        mnn_hash = _hash_rows(mnn_rows)
        mnn_entity_count = len({row[0] for row in mnn_rows})

        catalog_manifest = {
            "accepted_decision_hash": approval_bundle["accepted_hash"],
            "batch_id": batch_id,
            "catalog_hash": catalog_hash,
            "content_sha256": catalog_hash,
            "code_revision": code_revision,
            "content_bytes": len(_canonical_json(catalog_payloads).encode("utf-8")),
            "lookup_hash": lookup_hash,
            "lookup_row_count": len(lookup_rows),
            "entity_continuity": continuity_records,
            "entity_continuity_hash": continuity_hash,
            "classification_delta_count": classification_delta.expected_count,
            "classification_delta_hash": classification_delta.expected_hash,
            "parser_version": CATALOG_PARSER_VERSION,
            "predecessor_release_id": predecessor_release_id,
            "rejected_count": 0,
            "source_kind": CATALOG_SOURCE_KIND,
            "source_row_count": len(catalog_rows),
        }
        if effective_mnn_snapshot_id is not None:
            catalog_manifest.update(
                {
                    "mnn_mapping_count": len(mnn_rows),
                    "mnn_entity_count": mnn_entity_count,
                    "mnn_records_hash": mnn_hash,
                    "mnn_source_snapshot_id": effective_mnn_snapshot_id,
                }
            )
        catalog_snapshot_query = """
            SELECT id, source_kind, source_locator, content_sha256,
                   content_bytes, source_row_count, parser_version,
                   import_status, imported_row_count, rejected_row_count,
                   private_archive_locator, manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND source_kind = %s
              AND content_sha256 = %s AND parser_version = %s
            FOR UPDATE
        """
        cursor.execute(
            catalog_snapshot_query,
            (DATASET_KEY, CATALOG_SOURCE_KIND, catalog_hash, CATALOG_PARSER_VERSION),
        )
        catalog_snapshot_row = cursor.fetchone()
        if catalog_snapshot_row is None:
            try:
                cursor.execute(
                    """
                    INSERT INTO portal_dataset_snapshots (
                      snapshot_key, dataset_key, source_kind, source_locator,
                      content_sha256, content_bytes, source_row_count, parser_version,
                      import_status, imported_row_count, rejected_row_count,
                      private_archive_locator, manifest_json, imported_at
                    ) VALUES (
                      UUID(), %s, %s, %s, %s, %s, %s, %s,
                      'imported', %s, 0, %s, %s, NOW(6)
                    )
                    """,
                    (
                        DATASET_KEY,
                        CATALOG_SOURCE_KIND,
                        f"canonical://abbott/content-batch/{batch_id}",
                        catalog_hash,
                        catalog_manifest["content_bytes"],
                        len(catalog_rows),
                        CATALOG_PARSER_VERSION,
                        len(catalog_rows),
                        f"canonical://abbott/content-batch/{batch_id}",
                        _canonical_json(catalog_manifest),
                    ),
                )
            except Exception as exc:
                if int(getattr(exc, "errno", 0) or 0) != 1062:
                    raise
            cursor.execute(
                catalog_snapshot_query,
                (
                    DATASET_KEY,
                    CATALOG_SOURCE_KIND,
                    catalog_hash,
                    CATALOG_PARSER_VERSION,
                ),
            )
            catalog_snapshot_row = cursor.fetchone()
        catalog_snapshot_row = _require_catalog_snapshot_authority(
            catalog_snapshot_row, catalog_manifest
        )
        catalog_snapshot_id = int(catalog_snapshot_row["id"])
        source_snapshot_ids_list = [
            catalog_snapshot_id if value == old_catalog_ids[0] else value
            for value in predecessor_source_ids
        ]
        if (
            effective_mnn_snapshot_id is not None
            and effective_mnn_snapshot_id != old_mnn_snapshot_id
        ):
            if old_mnn_snapshot_id is not None:
                source_snapshot_ids_list = [
                    effective_mnn_snapshot_id if value == old_mnn_snapshot_id else value
                    for value in source_snapshot_ids_list
                ]
            else:
                source_snapshot_ids_list.append(effective_mnn_snapshot_id)
        source_snapshot_ids = tuple(source_snapshot_ids_list)

        candidate_snapshot_rows = []
        for snapshot_id in source_snapshot_ids:
            if snapshot_id == catalog_snapshot_id:
                candidate_snapshot_rows.append(catalog_snapshot_row)
            else:
                candidate_snapshot_rows.append(snapshots_by_id[snapshot_id])
        file_snapshots = _snapshot_records(
            candidate_snapshot_rows, include_ids=False
        )
        predecessor_snapshot_records = _snapshot_records(
            snapshot_rows, include_ids=True
        )
        candidate_snapshot_records = _snapshot_records(
            candidate_snapshot_rows, include_ids=True
        )
        predecessor_import_records = _import_records(import_rows)
        candidate_import_records = [
            {
                **record,
                "code_revision": code_revision,
            }
            for record in predecessor_import_records
            if record["source_snapshot_id"] != old_catalog_ids[0]
            and not (
                effective_mnn_snapshot_id is not None
                and effective_mnn_snapshot_id != old_mnn_snapshot_id
                and record["source_snapshot_id"] == old_mnn_snapshot_id
            )
        ]
        candidate_import_records.append(
            {
                "source_snapshot_id": catalog_snapshot_id,
                "source_kind": CATALOG_SOURCE_KIND,
                "imported_row_count": len(catalog_rows),
                "rejected_row_count": 0,
                "import_status": "imported",
                "code_revision": code_revision,
            }
        )
        if (
            effective_mnn_snapshot_id is not None
            and effective_mnn_snapshot_id != old_mnn_snapshot_id
        ):
            mnn_snapshot = snapshots_by_id[effective_mnn_snapshot_id]
            candidate_import_records.append(
                {
                    "source_snapshot_id": effective_mnn_snapshot_id,
                    "source_kind": MNN_SOURCE_KIND,
                    "imported_row_count": int(mnn_snapshot.get("imported_row_count") or 0),
                    "rejected_row_count": int(mnn_snapshot.get("rejected_row_count") or 0),
                    "import_status": "imported",
                    "code_revision": code_revision,
                }
            )
        candidate_import_records.sort(key=lambda row: int(row["source_snapshot_id"]))
        expected_counts = {name: int(value) for name, value in counts.items()}
        expected_non_content = {
            table: {"count": int(value["count"]), "hash": str(value["hash"])}
            for table, value in predecessor_non_content.items()
        }
        predecessor_catalog_hash = _hash_rows(
            _canonical_catalog_rows(
                predecessor_catalog_rows, _PREDECESSOR_CATALOG_COLUMNS
            )
        )
        bundle = {
            "accepted_decision_hash": approval_bundle["accepted_hash"],
            "batch_id": batch_id,
            "candidate_catalog_hash": catalog_hash,
            "candidate_lookup_hash": lookup_hash,
            "entity_continuity": continuity_records,
            "entity_continuity_hash": continuity_hash,
            "classification_delta_count": classification_delta.expected_count,
            "classification_delta_hash": classification_delta.expected_hash,
            "candidate_source_snapshot_ids": list(source_snapshot_ids),
            "candidate_import_count": len(candidate_import_records),
            "candidate_import_hash": _records_hash(candidate_import_records),
            "candidate_snapshot_hash": _records_hash(candidate_snapshot_records),
            "expected_counts": expected_counts,
            "non_content": expected_non_content,
            "predecessor_catalog_hash": predecessor_catalog_hash,
            "predecessor_import_count": len(predecessor_import_records),
            "predecessor_import_hash": _records_hash(predecessor_import_records),
            "predecessor_release_id": predecessor_release_id,
            "predecessor_source_snapshot_ids": predecessor_source_ids,
            "predecessor_snapshot_hash": _records_hash(
                predecessor_snapshot_records
            ),
            "taxonomy_version_id": int(batch["taxonomy_version_id"]),
            "referenced_taxonomy_terms": referenced_taxonomy_terms,
        }
        if effective_mnn_snapshot_id is not None:
            bundle["candidate_mnn_count"] = len(mnn_rows)
            bundle["candidate_mnn_entity_count"] = mnn_entity_count
            bundle["candidate_mnn_hash"] = mnn_hash
            bundle["candidate_mnn_snapshot_id"] = effective_mnn_snapshot_id
        control_values = dict(predecessor_baseline.get("control_values") or {})
        control_values.update(CONTENT_CONTROL_VALUES)
        control_values.update(
            {
                "content.accepted_classification_delta_count": classification_delta.expected_count,
                "content.accepted_classification_delta_hash_match_pct": 100,
                "content.entity_continuity_hash_match_pct": 100,
                "content.mnn_mapping_count": len(mnn_rows),
                "content.mnn_entity_count": mnn_entity_count,
                "content.mnn_hash_match_pct": 100,
                "content.mnn_snapshot_match_pct": 100,
            }
        )
        baseline_manifest = {
            **dict(predecessor_baseline),
            "content_candidate_bundle": bundle,
            "control_values": control_values,
            "file_snapshots": file_snapshots,
            "source_kind": "abbott_canonical_control_pack",
        }
        baseline_json = _canonical_json(baseline_manifest)
        baseline_hash = sha256_text(baseline_json)
        cursor.execute(
            """
            INSERT INTO portal_dataset_snapshots (
              snapshot_key, dataset_key, source_kind, source_locator,
              content_sha256, content_bytes, source_row_count, parser_version,
              import_status, imported_row_count, rejected_row_count,
              private_archive_locator, manifest_json, imported_at
            ) VALUES (
              UUID(), %s, 'abbott_canonical_control_pack', %s, %s, %s, %s,
              'abbott-content-control-v1', 'imported', %s, 0, %s, %s, NOW(6)
            )
            """,
            (
                DATASET_KEY,
                f"canonical://abbott/content-control/{batch_id}",
                baseline_hash,
                len(baseline_json.encode("utf-8")),
                len(control_values),
                len(control_values),
                f"canonical://abbott/content-control/{batch_id}",
                baseline_json,
            ),
        )
        baseline_snapshot_id = int(cursor.lastrowid)
        if int(getattr(cursor, "rowcount", -1)) != 1 or baseline_snapshot_id <= 0:
            raise CandidateMaterializationError("SUCCESSOR_BASELINE_INSERT_FAILED")

        candidate_id = release_store.create_candidate_release(
            portal_key=DATASET_KEY,
            predecessor_release_id=predecessor_release_id,
            baseline_validation_run_id=baseline_snapshot_id,
            code_revision=code_revision,
            connection=connection,
        )
        mutable = release_store.require_mutable_candidate_release(
            candidate_id, portal_key=DATASET_KEY, connection=connection
        )
        if int(mutable.get("id") or 0) != candidate_id:
            raise CandidateMaterializationError("CANDIDATE_NOT_MUTABLE")
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
            if (
                effective_mnn_snapshot_id is not None
                and effective_mnn_snapshot_id != old_mnn_snapshot_id
                and source_id == old_mnn_snapshot_id
            ):
                continue
            cursor.execute(
                """
                INSERT INTO portal_release_source_imports (
                  canonical_release_id, source_snapshot_id, source_kind,
                  code_revision, import_status, imported_row_count,
                  rejected_row_count, imported_at
                ) VALUES (%s, %s, %s, %s, 'imported', %s, %s, NOW(6))
                """,
                (
                    candidate_id,
                    source_id,
                    row["source_kind"],
                    code_revision,
                    int(row.get("imported_row_count") or 0),
                    int(row.get("rejected_row_count") or 0),
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
            ) VALUES (%s, %s, %s, %s, 'imported', %s, 0, NOW(6))
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
        if (
            effective_mnn_snapshot_id is not None
            and effective_mnn_snapshot_id != old_mnn_snapshot_id
        ):
            mnn_snapshot = snapshots_by_id[effective_mnn_snapshot_id]
            cursor.execute(
                """
                INSERT INTO portal_release_source_imports (
                  canonical_release_id, source_snapshot_id, source_kind,
                  code_revision, import_status, imported_row_count,
                  rejected_row_count, imported_at
                ) VALUES (%s, %s, %s, %s, 'imported', %s, %s, NOW(6))
                """,
                (
                    candidate_id,
                    effective_mnn_snapshot_id,
                    MNN_SOURCE_KIND,
                    code_revision,
                    int(mnn_snapshot.get("imported_row_count") or 0),
                    int(mnn_snapshot.get("rejected_row_count") or 0),
                ),
            )
            if int(getattr(cursor, "rowcount", -1)) != 1:
                raise CandidateMaterializationError("MNN_IMPORT_INSERT_FAILED")
        _copy_non_content_facts(
            cursor,
            predecessor_release_id,
            candidate_id,
            predecessor_non_content,
        )

        for payload in catalog_payloads:
            cursor.execute(
                """
                INSERT INTO portal_content_catalog (
                  canonical_release_id, source_snapshot_id,
                  normalized_url, normalized_url_hash, normalized_path,
                  page_title, material_id, material_type, source_slug,
                  source_slug_hash, access_label, is_active, source_sheet,
                  source_row_ordinal, source_row_fingerprint, section_key,
                  direction_key, published_at, valid_from, valid_to,
                  content_entity_id, classification_event_id,
                  classification_event_fingerprint, projection_provenance_json,
                  projection_row_hash
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s
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
        if mnn_rows:
            _persist_mnn_projection(
                cursor,
                candidate_release_id=candidate_id,
                rows=mnn_rows,
            )

        catalog_columns = (
            "normalized_url", "normalized_url_hash", "normalized_path", "page_title",
            "material_id", "material_type", "source_slug", "source_slug_hash",
            "access_label", "is_active", "source_sheet", "source_row_ordinal",
            "source_row_fingerprint", "section_key", "direction_key", "published_at",
            "valid_from", "valid_to", "content_entity_id", "classification_event_id",
            "classification_event_fingerprint", "projection_provenance_json",
            "projection_row_hash",
        )
        cursor.execute(
            f"SELECT {', '.join(catalog_columns)} FROM portal_content_catalog "
            "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
            "ORDER BY source_sheet, source_row_ordinal",
            (candidate_id, catalog_snapshot_id),
        )
        stored_catalog = _canonical_catalog_rows(cursor.fetchall(), catalog_columns)
        if len(stored_catalog) != len(catalog_payloads) or _hash_rows(stored_catalog) != catalog_hash:
            raise CandidateMaterializationError("CATALOG_HASH_MISMATCH")
        lookup_columns = (
            "lookup_kind", "lookup_key_hash", "candidate_count",
            "metadata_signature_count", "resolution_status",
            "selected_source_row_fingerprint", "group_fingerprint",
        )
        cursor.execute(
            f"SELECT {', '.join(lookup_columns)} FROM portal_content_lookup_projection "
            "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
            "ORDER BY lookup_kind, lookup_key_hash",
            (candidate_id, catalog_snapshot_id),
        )
        stored_lookup = _canonical_lookup_rows(cursor.fetchall(), lookup_columns)
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
            baseline_snapshot_id=baseline_snapshot_id,
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


def _validated_id_list(value: object, *, code: str) -> list[int]:
    decoded = _decode_json(value, code=code)
    if (
        not isinstance(decoded, list)
        or not decoded
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item <= 0
            for item in decoded
        )
        or len(set(decoded)) != len(decoded)
    ):
        raise CandidateMaterializationError(code)
    return list(decoded)


def _load_snapshots(cursor, snapshot_ids: Sequence[int]) -> tuple[object, ...]:
    placeholders = ", ".join(["%s"] * len(snapshot_ids))
    cursor.execute(
        f"SELECT {', '.join(_SNAPSHOT_COLUMNS)} FROM portal_dataset_snapshots "
        f"WHERE dataset_key = %s AND id IN ({placeholders}) ORDER BY id",
        (DATASET_KEY, *snapshot_ids),
    )
    rows = tuple(cursor.fetchall())
    by_id = {int(_row_value(row, "id", 0) or 0): row for row in rows}
    if set(by_id) != set(snapshot_ids):
        raise CandidateMaterializationError("SOURCE_SNAPSHOT_SET_INVALID")
    return tuple(by_id[snapshot_id] for snapshot_id in snapshot_ids)


def _load_imports(cursor, release_id: int) -> tuple[object, ...]:
    cursor.execute(
        f"SELECT {', '.join(_IMPORT_COLUMNS)} FROM portal_release_source_imports "
        "WHERE canonical_release_id = %s ORDER BY source_snapshot_id",
        (release_id,),
    )
    return tuple(cursor.fetchall())


def _load_catalog(
    cursor, release_id: int, snapshot_id: int, *, include_id: bool
) -> tuple[tuple[object, ...], ...]:
    columns = _PREDECESSOR_CATALOG_COLUMNS if include_id else _CATALOG_COLUMNS
    cursor.execute(
        f"SELECT {', '.join(columns)} FROM portal_content_catalog "
        "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY source_sheet, source_row_ordinal",
        (release_id, snapshot_id),
    )
    return _canonical_catalog_rows(cursor.fetchall(), columns)


def _load_lookup(
    cursor, release_id: int, snapshot_id: int
) -> tuple[tuple[object, ...], ...]:
    cursor.execute(
        f"SELECT {', '.join(_LOOKUP_COLUMNS)} "
        "FROM portal_content_lookup_projection "
        "WHERE canonical_release_id = %s AND source_snapshot_id = %s "
        "ORDER BY lookup_kind, lookup_key_hash",
        (release_id, snapshot_id),
    )
    return _canonical_lookup_rows(cursor.fetchall())


def _catalog_schema_gates(
    rows: Sequence[Sequence[object]],
    taxonomy_rows: Iterable[object],
    *,
    prior_service_page_event_ids: set[int] | frozenset[int] = frozenset(),
) -> tuple[int, int, int, int]:
    taxonomy: dict[tuple[str, str], str] = {}
    for row in taxonomy_rows:
        kind = str(_row_value(row, "taxonomy_kind", 0) or "")
        code = str(_row_value(row, "term_code", 1) or "")
        label = str(_row_value(row, "term_label", 2) or "")
        taxonomy[(kind, code)] = label
    schema_failures = 0
    out_of_taxonomy = 0
    archive_types = 0
    strong: dict[tuple[str, str], int] = {}
    collisions = 0
    for row in rows:
        try:
            provenance = _decode_json(row[21], code="CATALOG_PROVENANCE_INVALID")
            if not isinstance(provenance, Mapping):
                raise CandidateMaterializationError("CATALOG_PROVENANCE_INVALID")
            codes = provenance.get("canonical_codes")
            labels = provenance.get("canonical_labels") or {}
            if not isinstance(codes, Mapping):
                raise CandidateMaterializationError("CATALOG_PROVENANCE_INVALID")
            expected_row_hash = _hash_rows((tuple(row[:22]),))
            if str(row[22] or "") != expected_row_hash:
                schema_failures += 1
            if (
                int(provenance.get("content_entity_id") or 0) != int(row[18] or 0)
                or provenance.get("classification_event_id") != row[19]
                or provenance.get("classification_event_fingerprint") != row[20]
                or provenance.get("source_row_fingerprint") != row[12]
                or provenance.get("mode") not in {
                    "current_batch_event", "predecessor_catalog",
                    "legacy_active_catalog_baseline", "prior_accepted_event",
                }
            ):
                schema_failures += 1
            mappings = (
                ("direction", codes.get("direction"), row[14]),
                ("material_type", codes.get("material_type"), row[5]),
                ("access", codes.get("access"), row[8]),
                ("lifecycle", codes.get("lifecycle"), labels.get("lifecycle")),
            )
            for kind, code, visible in mappings:
                if (
                    kind == "material_type"
                    and str(code or "") == "service_page"
                    and provenance.get("mode") in {
                        "predecessor_catalog",
                        "legacy_active_catalog_baseline",
                        "prior_accepted_event",
                    }
                    or (
                        kind == "material_type"
                        and str(code or "") == "service_page"
                        and int(provenance.get("classification_event_id") or 0)
                        in prior_service_page_event_ids
                    )
                ):
                    # ``service_page`` is a legacy non-content sentinel used by
                    # the observed-page gate, not a selectable taxonomy term.
                    # It may only survive unchanged from the active baseline;
                    # current reviewed events remain subject to exact taxonomy.
                    continue
                label = taxonomy.get((kind, str(code or "")))
                if label is None or (visible is not None and str(visible) != label):
                    out_of_taxonomy += 1
            material_code = str(codes.get("material_type") or "").casefold()
            material_label = str(row[5] or "").casefold()
            if material_code in {"archive", "archived"} or material_label == "архив":
                archive_types += 1
            entity_id = int(row[18] or 0)
            for kind, value in (
                ("material_id", str(row[4] or "").casefold()),
                ("normalized_url", str(row[1] or "") if row[0] else ""),
            ):
                if not value:
                    continue
                existing = strong.setdefault((kind, value), entity_id)
                if existing != entity_id:
                    collisions += 1
        except (CandidateMaterializationError, TypeError, ValueError, IndexError):
            schema_failures += 1
            out_of_taxonomy += 1
    return schema_failures, out_of_taxonomy, archive_types, collisions


def _prior_service_page_event_ids(
    cursor, candidate_release_id: int, current_batch_id: int
) -> set[int]:
    cursor.execute(
        """
        SELECT DISTINCT event.id AS event_id
        FROM portal_content_catalog AS catalog
        INNER JOIN portal_content_classification_events AS event
          ON event.id = catalog.classification_event_id
        INNER JOIN portal_content_approval_batches AS authority
          ON authority.id = event.approval_batch_id
         AND authority.dataset_key = %s
         AND authority.batch_status IN (
           'accepted', 'ingested', 'candidate_materialized'
         )
        WHERE catalog.canonical_release_id = %s
          AND event.approval_batch_id <> %s
          AND event.material_type_code = 'service_page'
          AND event.event_kind IN ('approve', 'correct')
        ORDER BY event.id
        """,
        (DATASET_KEY, candidate_release_id, current_batch_id),
    )
    return {
        int(_row_value(row, "event_id", 0) or 0)
        for row in cursor.fetchall()
        if int(_row_value(row, "event_id", 0) or 0) > 0
    }


def _catalog_taxonomy_references(
    rows: Sequence[Sequence[object]],
) -> list[dict[str, str]]:
    referenced: set[tuple[str, str, str]] = set()
    for row in rows:
        provenance = _decode_json(row[21], code="CATALOG_PROVENANCE_INVALID")
        codes = provenance.get("canonical_codes") if isinstance(provenance, Mapping) else None
        labels = provenance.get("canonical_labels") if isinstance(provenance, Mapping) else None
        if not isinstance(codes, Mapping):
            raise CandidateMaterializationError("CATALOG_PROVENANCE_INVALID")
        for kind, code, label in (
            ("direction", codes.get("direction"), row[14]),
            ("material_type", codes.get("material_type"), row[5]),
            ("access", codes.get("access"), row[8]),
            (
                "lifecycle", codes.get("lifecycle"),
                labels.get("lifecycle") if isinstance(labels, Mapping) else None,
            ),
        ):
            if not str(code or "").strip():
                raise CandidateMaterializationError("CATALOG_PROVENANCE_INVALID")
            referenced.add((kind, str(code), str(label or "")))
    return [
        {"taxonomy_kind": kind, "term_code": code, "term_label": label}
        for kind, code, label in sorted(referenced)
    ]


def validate_content_candidate(
    candidate_release_id: int,
    expected_counts: Mapping[str, int],
    accepted_hash: str,
    *,
    connection=None,
    connection_factory=None,
) -> GateReport:
    """Attest the locked immutable candidate bundle without changing any state.

    When a connection is supplied, its caller owns the surrounding transaction;
    this lets the production control-pack comparator persist the evidence from the
    same locked snapshot. Standalone inspection always rolls its own transaction
    back before returning.
    """

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

    owns_connection = connection is None
    cursor = None
    try:
        if owns_connection:
            connection = (connection_factory or get_db_connection)()
            connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT candidate.id, candidate.release_status,
                   candidate.baseline_validation_run_id,
                   candidate.rollback_from_release_id,
                   candidate.source_snapshot_ids
            FROM portal_data_releases AS candidate
            WHERE candidate.dataset_key = %s AND candidate.id = %s
            FOR UPDATE
            """,
            (DATASET_KEY, candidate_release_id),
        )
        candidate = cursor.fetchone()
        if (
            not isinstance(candidate, Mapping)
            or candidate.get("release_status") not in {"staging", "validated"}
            or int(candidate.get("baseline_validation_run_id") or 0) <= 0
        ):
            raise CandidateMaterializationError("CANDIDATE_NOT_MUTABLE")
        candidate_source_ids = _validated_id_list(
            candidate.get("source_snapshot_ids"), code="SOURCE_SNAPSHOT_SET_INVALID"
        )
        predecessor_id = int(candidate.get("rollback_from_release_id") or 0)
        cursor.execute(
            """
            SELECT active.canonical_release_id, predecessor.release_status,
                   predecessor.source_snapshot_ids,
                   predecessor.baseline_validation_run_id
            FROM portal_active_data_releases AS active
            INNER JOIN portal_data_releases AS predecessor
              ON predecessor.dataset_key = active.dataset_key
             AND predecessor.id = active.canonical_release_id
            WHERE active.dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        active = cursor.fetchone()
        if not isinstance(active, Mapping):
            raise CandidateMaterializationError("ACTIVE_PREDECESSOR_MISMATCH")
        predecessor_source_ids = _validated_id_list(
            active.get("source_snapshot_ids"), code="SOURCE_SNAPSHOT_SET_INVALID"
        )

        cursor.execute(
            """
            SELECT id, content_sha256, content_bytes, parser_version,
                   import_status, imported_row_count, rejected_row_count,
                   manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND id = %s
              AND source_kind = 'abbott_canonical_control_pack'
            """,
            (DATASET_KEY, candidate["baseline_validation_run_id"]),
        )
        baseline_row = cursor.fetchone()
        if not isinstance(baseline_row, Mapping):
            raise CandidateMaterializationError("CANDIDATE_BASELINE_INVALID")
        baseline = _decode_json(
            baseline_row.get("manifest_json"), code="CANDIDATE_BASELINE_INVALID"
        )
        if not isinstance(baseline, Mapping):
            raise CandidateMaterializationError("CANDIDATE_BASELINE_INVALID")
        bundle = baseline.get("content_candidate_bundle")
        if not isinstance(bundle, Mapping):
            raise CandidateMaterializationError("CANDIDATE_BASELINE_INVALID")
        baseline_json = _canonical_json(baseline)
        baseline_intact = (
            str(baseline_row.get("content_sha256") or "") == sha256_text(baseline_json)
            and int(baseline_row.get("content_bytes") or 0)
            == len(baseline_json.encode("utf-8"))
            and baseline_row.get("import_status") == "imported"
            and int(baseline_row.get("rejected_row_count") or 0) == 0
        )
        batch_id = int(bundle.get("batch_id") or 0)
        cursor.execute(
            """
            SELECT batch.id, batch.batch_status, batch.activation_status,
                   batch.candidate_release_id, batch.accepted_decision_hash,
                   batch.accepted_count, batch.ready_count, batch.conflict_count,
                   batch.unresolved_count, batch.rejected_count,
                   batch.no_change_count, batch.taxonomy_version_id,
                   batch.taxonomy_digest, batch.published_input_hash,
                   batch.prompt_version, batch.model_routing_version,
                   batch.accepted_by, taxonomy.version AS taxonomy_version,
                   batch.accepted_at,
                   batch.source_snapshot_ids, batch.source_snapshot_digests,
                   batch.projection_kind
            FROM portal_content_approval_batches AS batch
            INNER JOIN portal_content_taxonomy_versions AS taxonomy
              ON taxonomy.id = batch.taxonomy_version_id
             AND taxonomy.dataset_key = batch.dataset_key
            WHERE batch.id = %s AND batch.dataset_key = %s
              AND batch.candidate_release_id = %s
            """,
            (batch_id, DATASET_KEY, candidate_release_id),
        )
        batch = cursor.fetchone()
        if not isinstance(batch, Mapping):
            raise CandidateMaterializationError("CANDIDATE_GATE_EVIDENCE_MISSING")
        approval = _load_approval_bundle(cursor, batch_id, batch)
        actual_counts = approval["counts"]
        expected_bundle_counts = bundle.get("expected_counts")
        if not isinstance(actual_counts, Mapping) or not isinstance(expected_bundle_counts, Mapping):
            raise CandidateMaterializationError("CANDIDATE_BASELINE_INVALID")
        persisted_counts = {
            name: int(batch.get(f"{name}_count") or 0)
            for name in ("ready", "conflict", "unresolved", "rejected", "no_change", "accepted")
        }
        caller_counts_match = all(
            int(expected_bundle_counts.get(name, -1)) == normalized_counts[name]
            for name in normalized_counts
        )
        count_match = (
            caller_counts_match
            and all(int(actual_counts.get(name, -1)) == int(expected_bundle_counts.get(name, -2)) for name in expected_bundle_counts)
            and all(int(actual_counts.get(name, -1)) == value for name, value in persisted_counts.items())
        )

        candidate_snapshots = _load_snapshots(cursor, candidate_source_ids)
        predecessor_snapshots = _load_snapshots(cursor, predecessor_source_ids)
        candidate_imports = _load_imports(cursor, candidate_release_id)
        predecessor_imports = _load_imports(cursor, predecessor_id)
        candidate_snapshot_records = _snapshot_records(candidate_snapshots, include_ids=True)
        predecessor_snapshot_records = _snapshot_records(predecessor_snapshots, include_ids=True)
        candidate_import_records = _import_records(candidate_imports)
        predecessor_import_records = _import_records(predecessor_imports)
        catalog_snapshots = [
            row for row in candidate_snapshots
            if _row_value(row, "source_kind", 1) == CATALOG_SOURCE_KIND
        ]
        predecessor_catalog_snapshots = [
            row for row in predecessor_snapshots
            if _row_value(row, "source_kind", 1) == CATALOG_SOURCE_KIND
        ]
        if len(catalog_snapshots) != 1 or len(predecessor_catalog_snapshots) != 1:
            raise CandidateMaterializationError("CATALOG_SNAPSHOT_SET_INVALID")
        catalog_snapshot = catalog_snapshots[0]
        catalog_snapshot_id = int(_row_value(catalog_snapshot, "id", 0) or 0)
        predecessor_catalog_snapshot_id = int(_row_value(predecessor_catalog_snapshots[0], "id", 0) or 0)
        catalog_rows = _load_catalog(cursor, candidate_release_id, catalog_snapshot_id, include_id=False)
        predecessor_catalog_rows = _load_catalog(
            cursor, predecessor_id, predecessor_catalog_snapshot_id, include_id=True
        )
        predecessor_catalog_rows = _canonical_catalog_rows(
            _resolve_legacy_predecessor_rows(
                cursor,
                tuple(
                    dict(zip(_PREDECESSOR_CATALOG_COLUMNS, row))
                    for row in predecessor_catalog_rows
                ),
                predecessor_release_id=predecessor_id,
                predecessor_snapshot_id=predecessor_catalog_snapshot_id,
                taxonomy_version_id=int(bundle.get("taxonomy_version_id") or 0),
            ),
            _PREDECESSOR_CATALOG_COLUMNS,
        )
        predecessor_catalog_entities = tuple(
            _predecessor_catalog_row(
                dict(zip(_PREDECESSOR_CATALOG_COLUMNS, row))
            )
            for row in predecessor_catalog_rows
        )
        candidate_catalog_entities = tuple(
            _predecessor_catalog_row(
                {"id": 0, **dict(zip(_CATALOG_COLUMNS, row))}
            )
            for row in catalog_rows
        )
        lookup_rows = _load_lookup(cursor, candidate_release_id, catalog_snapshot_id)
        candidate_catalog_hash = _hash_rows(catalog_rows)
        predecessor_catalog_hash = _hash_rows(predecessor_catalog_rows)
        lookup_hash = _hash_rows(lookup_rows)
        catalog_manifest = _decode_json(
            _row_value(catalog_snapshot, "manifest_json", 8), code="CATALOG_MANIFEST_INVALID"
        )
        if not isinstance(catalog_manifest, Mapping):
            raise CandidateMaterializationError("CATALOG_MANIFEST_INVALID")
        candidate_non_content = _read_non_content_bundle(cursor, candidate_release_id)
        predecessor_non_content = _read_non_content_bundle(cursor, predecessor_id)
        expected_non_content = bundle.get("non_content")
        if not isinstance(expected_non_content, Mapping):
            raise CandidateMaterializationError("CANDIDATE_BASELINE_INVALID")
        candidate_mnn_rows: tuple[tuple[int, int, int, str, str], ...] = ()
        if "candidate_mnn_hash" in bundle or "candidate_mnn_count" in bundle:
            cursor.execute(
                """
                SELECT mapping.content_entity_id, mapping.mnn_source_snapshot_id,
                       mapping.source_claim_id, mapping.mnn_key, mapping.mnn_label,
                       claim.source_snapshot_id AS claim_source_snapshot_id,
                       claim.resolved_content_entity_id AS claim_content_entity_id,
                       claim.resolution_status AS claim_resolution_status,
                       claim.mnn_key AS claim_mnn_key,
                       claim.mnn_label AS claim_mnn_label
                FROM portal_content_catalog_mnn AS mapping
                INNER JOIN portal_content_mnn_source_claims AS claim
                  ON claim.id = mapping.source_claim_id
                WHERE mapping.canonical_release_id = %s
                ORDER BY mapping.content_entity_id, mapping.mnn_key, mapping.source_claim_id
                """,
                (candidate_release_id,),
            )
            candidate_mnn_db_rows = tuple(cursor.fetchall())
            candidate_mnn_rows = tuple(
                (
                    int(_row_value(row, "content_entity_id", 0)),
                    int(_row_value(row, "mnn_source_snapshot_id", 1)),
                    int(_row_value(row, "source_claim_id", 2)),
                    str(_row_value(row, "mnn_key", 3) or ""),
                    str(_row_value(row, "mnn_label", 4) or ""),
                )
                for row in candidate_mnn_db_rows
            )
            mnn_claims_match = all(
                int(_row_value(row, "claim_source_snapshot_id", 5) or 0)
                == int(_row_value(row, "mnn_source_snapshot_id", 1) or 0)
                and int(_row_value(row, "claim_content_entity_id", 6) or 0)
                == int(_row_value(row, "content_entity_id", 0) or 0)
                and str(_row_value(row, "claim_resolution_status", 7) or "") == "mapped"
                and str(_row_value(row, "claim_mnn_key", 8) or "")
                == str(_row_value(row, "mnn_key", 3) or "")
                and str(_row_value(row, "claim_mnn_label", 9) or "")
                == str(_row_value(row, "mnn_label", 4) or "")
                for row in candidate_mnn_db_rows
            )
        else:
            mnn_claims_match = True
        candidate_mnn_count = len(candidate_mnn_rows)
        candidate_mnn_entity_count = len({row[0] for row in candidate_mnn_rows})
        candidate_mnn_hash = _hash_rows(candidate_mnn_rows)
        expected_mnn_snapshot_id = int(
            bundle.get("candidate_mnn_snapshot_id") or 0
        )
        mnn_hash_match = (
            candidate_mnn_hash
            == str(bundle.get("candidate_mnn_hash") or _hash_rows(()))
            and str(catalog_manifest.get("mnn_records_hash") or _hash_rows(()))
            == candidate_mnn_hash
            and mnn_claims_match
        )
        mnn_snapshot_match = (
            all(row[1] in candidate_source_ids for row in candidate_mnn_rows)
            and all(row[1] == expected_mnn_snapshot_id for row in candidate_mnn_rows)
            and (
                not candidate_mnn_rows
                or expected_mnn_snapshot_id in candidate_source_ids
            )
            and int(catalog_manifest.get("mnn_source_snapshot_id") or 0)
            == expected_mnn_snapshot_id
        )
        mnn_match = (
            candidate_mnn_count == int(bundle.get("candidate_mnn_count") or 0)
            and candidate_mnn_entity_count
            == int(bundle.get("candidate_mnn_entity_count") or 0)
            and int(catalog_manifest.get("mnn_mapping_count") or 0)
            == candidate_mnn_count
            and int(catalog_manifest.get("mnn_entity_count") or 0)
            == candidate_mnn_entity_count
            and mnn_hash_match
            and mnn_snapshot_match
        )

        source_match = (
            candidate_source_ids == list(bundle.get("candidate_source_snapshot_ids") or [])
            and predecessor_source_ids == list(bundle.get("predecessor_source_snapshot_ids") or [])
            and _decode_json(batch.get("source_snapshot_ids"), code="BATCH_SOURCE_BINDING_INVALID") == predecessor_source_ids
            and _decode_json(batch.get("source_snapshot_digests"), code="BATCH_SOURCE_BINDING_INVALID")
            == [str(_row_value(row, "content_sha256", 2) or "") for row in predecessor_snapshots]
            and [
                {key: record[key] for key in ("source_kind", "content_sha256", "content_bytes", "parser_version", "source_row_count")}
                for record in candidate_snapshot_records
            ] == list(baseline.get("file_snapshots") or [])
            and all(_snapshot_rejections_allowed(row) for row in candidate_snapshots)
            and {record["source_snapshot_id"] for record in candidate_import_records} == set(candidate_source_ids)
        )
        non_content_match = all(
            candidate_non_content.get(table, {}).get("count") == expected.get("count")
            and candidate_non_content.get(table, {}).get("hash") == expected.get("hash")
            and predecessor_non_content.get(table, {}).get("count") == expected.get("count")
            and predecessor_non_content.get(table, {}).get("hash") == expected.get("hash")
            for table, expected in expected_non_content.items()
            if isinstance(expected, Mapping)
        ) and set(expected_non_content) == set(candidate_non_content) == set(predecessor_non_content)
        accepted_bundle_hash = str(bundle.get("accepted_decision_hash") or "")
        hash_match = (
            baseline_intact
            and accepted_hash == accepted_bundle_hash == approval.get("accepted_hash") == batch.get("accepted_decision_hash")
            and _records_hash(candidate_snapshot_records) == bundle.get("candidate_snapshot_hash")
            and _records_hash(predecessor_snapshot_records) == bundle.get("predecessor_snapshot_hash")
            and len(candidate_import_records) == int(bundle.get("candidate_import_count") or -1)
            and _records_hash(candidate_import_records) == bundle.get("candidate_import_hash")
            and len(predecessor_import_records) == int(bundle.get("predecessor_import_count") or -1)
            and _records_hash(predecessor_import_records) == bundle.get("predecessor_import_hash")
            and candidate_catalog_hash == bundle.get("candidate_catalog_hash") == catalog_manifest.get("catalog_hash") == _row_value(catalog_snapshot, "content_sha256", 2)
            and predecessor_catalog_hash == bundle.get("predecessor_catalog_hash")
            and lookup_hash == bundle.get("candidate_lookup_hash") == catalog_manifest.get("lookup_hash")
            and len(catalog_rows) == int(catalog_manifest.get("source_row_count") or -1)
            and len(lookup_rows) == int(catalog_manifest.get("lookup_row_count") or -1)
            and mnn_match
            and non_content_match
        )

        cursor.execute(
            """
            SELECT taxonomy_kind, term_code, term_label
            FROM portal_content_taxonomy_terms
            WHERE taxonomy_version_id = %s AND term_status = 'active'
            ORDER BY taxonomy_kind, term_code
            """,
            (bundle.get("taxonomy_version_id"),),
        )
        taxonomy_rows = tuple(cursor.fetchall())
        (
            catalog_schema_failures,
            out_of_taxonomy,
            archive_types,
            catalog_collisions,
        ) = _catalog_schema_gates(
            catalog_rows,
            taxonomy_rows,
            prior_service_page_event_ids=_prior_service_page_event_ids(
                cursor, candidate_release_id, batch_id
            ),
        )
        if bundle.get("referenced_taxonomy_terms") != _catalog_taxonomy_references(
            catalog_rows
        ):
            catalog_schema_failures += 1
        validate_reviewed_url_alias_decisions(
            cursor,
            batch,
            approval["approval_rows_by_id"],
        )
        created_url_event_fingerprints = _authorize_created_page_identities(
            _load_created_page_identity_rows(cursor, batch_id),
            approval["approval_rows_by_id"],
            batch,
        )
        cursor.execute(
            """
            SELECT entity.id AS authorized_entity_id,
                   event.content_entity_id, entity.material_id,
                   entity.title, entity.canonical_url, entity.source_evidence,
                   event.id AS classification_event_id,
                   event.direction_code, event.material_type_code,
                   event.access_code, event.lifecycle_code, event.event_kind,
                   event.event_fingerprint, event.approval_batch_id,
                   event.approval_item_id, event.taxonomy_version_id,
                   event.predecessor_event_id, event.proposal_evidence,
                   event.actor, event.reason, event.effective_at,
                   direction.term_label AS direction_label,
                   material.term_label AS material_type_label,
                   access_term.term_label AS access_label,
                   lifecycle.term_label AS lifecycle_label
            FROM portal_content_classification_events AS event
            LEFT JOIN portal_content_registry_entities AS entity
              ON entity.id = event.content_entity_id
             AND entity.dataset_key = %s
            LEFT JOIN portal_content_taxonomy_terms AS direction
              ON direction.taxonomy_version_id = %s
             AND direction.taxonomy_kind = 'direction'
             AND direction.term_code = event.direction_code
             AND direction.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS material
              ON material.taxonomy_version_id = %s
             AND material.taxonomy_kind = 'material_type'
             AND material.term_code = event.material_type_code
             AND material.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS access_term
              ON access_term.taxonomy_version_id = %s
             AND access_term.taxonomy_kind = 'access'
             AND access_term.term_code = event.access_code
             AND access_term.term_status = 'active'
            LEFT JOIN portal_content_taxonomy_terms AS lifecycle
              ON lifecycle.taxonomy_version_id = %s
             AND lifecycle.taxonomy_kind = 'lifecycle'
             AND lifecycle.term_code = event.lifecycle_code
             AND lifecycle.term_status = 'active'
            WHERE event.approval_batch_id = %s
            ORDER BY event.id
            """,
            (
                DATASET_KEY,
                batch["taxonomy_version_id"], batch["taxonomy_version_id"],
                batch["taxonomy_version_id"], batch["taxonomy_version_id"],
                batch_id,
            ),
        )
        validation_event_rows = tuple(cursor.fetchall())
        validation_delta: ClassificationDeltaReceipt | None = None
        continuity_match = False
        classification_delta_match = False
        try:
            validation_prior_event_rows = _load_prior_accepted_event_rows(
                cursor, batch_id
            )
            _authorize_prior_accepted_events(validation_prior_event_rows)
            _authorize_current_batch_events(
                validation_event_rows,
                approval["approval_rows_by_id"],
                batch,
                tuple(
                    dict(zip(_PREDECESSOR_CATALOG_COLUMNS, row))
                    for row in predecessor_catalog_rows
                ),
                created_url_event_fingerprints,
            )
            validation_predecessor_rows = tuple(
                dict(zip(_PREDECESSOR_CATALOG_COLUMNS, row))
                for row in predecessor_catalog_rows
            )
            validation_continuity = _current_batch_entity_continuity(
                validation_predecessor_rows,
                candidate_catalog_entities,
                validation_event_rows,
                approval["approval_rows_by_id"],
                preserved_entity_ids=(
                    _mnn_only_predecessor_entity_ids(
                        cursor,
                        predecessor_id,
                        validation_predecessor_rows,
                    )
                    if expected_mnn_snapshot_id > 0
                    else ()
                ),
            )
            validation_continuity_records = [
                {
                    "authority": row.authority,
                    "candidate_id": row.candidate_id,
                    "predecessor_id": row.predecessor_id,
                }
                for row in validation_continuity
            ]
            validation_continuity_hash = sha256_text(
                _canonical_json(validation_continuity_records)
            )
            validation_delta = _classification_delta_receipt(
                approval["approval_rows_by_id"],
                predecessor_catalog_entities,
                candidate_catalog_entities,
                accepted_bundle_hash,
            )
            continuity_match = (
                validation_continuity_records == bundle.get("entity_continuity")
                and validation_continuity_records
                == catalog_manifest.get("entity_continuity")
                and validation_continuity_hash
                == bundle.get("entity_continuity_hash")
                and validation_continuity_hash
                == catalog_manifest.get("entity_continuity_hash")
            )
            classification_delta_match = (
                validation_delta.expected_count == validation_delta.actual_count
                and validation_delta.expected_hash == validation_delta.actual_hash
                and validation_delta.expected_count
                == int(bundle.get("classification_delta_count") or -1)
                and validation_delta.expected_count
                == int(catalog_manifest.get("classification_delta_count") or -1)
                and validation_delta.expected_hash
                == bundle.get("classification_delta_hash")
                and validation_delta.expected_hash
                == catalog_manifest.get("classification_delta_hash")
            )
            if not continuity_match or not classification_delta_match:
                raise CandidateMaterializationError(
                    "ACCEPTED_CLASSIFICATION_DELTA_MISMATCH"
                )
            anti_flip = 0
        except CandidateMaterializationError:
            anti_flip = 1
        strong_collisions = (
            _strong_identity_collision_count(cursor, batch_id)
            + int(approval.get("identity_collisions") or 0)
            + catalog_collisions
        )
        cursor.execute(
            """
            SELECT COUNT(*) AS lookup_group_count,
                   COALESCE(SUM(CASE WHEN
                     (lookup_row.resolution_status IN ('unique', 'identical_collapsed')
                      AND lookup_row.selected_source_row_fingerprint IS NOT NULL
                      AND selected_catalog.source_row_fingerprint IS NOT NULL
                      AND lookup_row.candidate_count >= 1)
                     OR (lookup_row.resolution_status = 'ambiguous'
                      AND lookup_row.selected_source_row_fingerprint IS NULL
                      AND lookup_row.candidate_count >= 2)
                     THEN 0 ELSE 1 END), 0) AS lookup_consistency_failures,
                   COALESCE(SUM(
                     lookup_row.selected_source_row_fingerprint IS NOT NULL
                     AND selected_catalog.source_row_fingerprint IS NULL
                   ), 0) AS dangling_selected_count,
                   COALESCE(SUM(lookup_row.lookup_kind = 'title'), 0) AS title_group_count,
                   COALESCE(SUM(lookup_row.lookup_kind = 'slug'), 0) AS slug_group_count,
                   COALESCE(SUM(lookup_row.lookup_kind = 'path'), 0) AS path_group_count,
                   COALESCE(SUM(lookup_row.lookup_kind = 'url'), 0) AS url_group_count
            FROM portal_content_lookup_projection AS lookup_row
            LEFT JOIN portal_content_catalog AS selected_catalog
              ON selected_catalog.canonical_release_id = lookup_row.canonical_release_id
             AND selected_catalog.source_snapshot_id = lookup_row.source_snapshot_id
             AND selected_catalog.source_row_fingerprint = lookup_row.selected_source_row_fingerprint
            WHERE lookup_row.canonical_release_id = %s
              AND lookup_row.source_snapshot_id = %s
              AND lookup_row.lookup_kind IN ('title', 'slug', 'path', 'url')
            """,
            (candidate_release_id, catalog_snapshot_id),
        )
        lookup_smoke = cursor.fetchone()
        cursor.execute(
            """
            SELECT COUNT(DISTINCT CASE
                     WHEN catalog.source_slug IS NOT NULL
                      AND TRIM(catalog.source_slug) <> ''
                      AND catalog.source_slug_hash IS NOT NULL
                     THEN catalog.source_slug_hash END
                   ) AS expected_slug_group_count,
                   COUNT(DISTINCT CASE
                     WHEN slug_projection.lookup_key_hash IS NOT NULL
                     THEN catalog.source_slug_hash END
                   ) AS projected_slug_group_count
            FROM portal_content_catalog AS catalog
            LEFT JOIN portal_content_lookup_projection AS slug_projection
              ON slug_projection.canonical_release_id = catalog.canonical_release_id
             AND slug_projection.source_snapshot_id = catalog.source_snapshot_id
             AND slug_projection.lookup_kind = 'slug'
             AND slug_projection.lookup_key_hash = catalog.source_slug_hash
            WHERE catalog.canonical_release_id = %s
              AND catalog.source_snapshot_id = %s
              AND catalog.is_active = 1
            """,
            (candidate_release_id, catalog_snapshot_id),
        )
        slug_smoke = cursor.fetchone()
        cursor.execute(
            """
            SELECT COUNT(*) AS joined_projection_rows,
                   COALESCE(SUM(
                     selected_catalog.direction_key IS NOT NULL
                     AND TRIM(selected_catalog.direction_key) <> ''
                   ), 0) AS joined_direction_rows,
                   COALESCE(SUM(
                     selected_catalog.material_type IS NOT NULL
                     AND TRIM(selected_catalog.material_type) <> ''
                   ), 0) AS joined_material_rows,
                   COALESCE(SUM(
                     selected_catalog.access_label IS NOT NULL
                     AND TRIM(selected_catalog.access_label) <> ''
                   ), 0) AS joined_access_rows
            FROM portal_content_lookup_projection AS lookup_row
            INNER JOIN portal_content_catalog AS selected_catalog
              ON selected_catalog.canonical_release_id = lookup_row.canonical_release_id
             AND selected_catalog.source_snapshot_id = lookup_row.source_snapshot_id
             AND selected_catalog.source_row_fingerprint = lookup_row.selected_source_row_fingerprint
            WHERE lookup_row.canonical_release_id = %s
              AND lookup_row.source_snapshot_id = %s
              AND lookup_row.lookup_kind IN ('title', 'slug', 'path', 'url')
              AND lookup_row.resolution_status IN ('unique', 'identical_collapsed')
              AND selected_catalog.is_active = 1
            """,
            (candidate_release_id, catalog_snapshot_id),
        )
        joined_smoke = cursor.fetchone()
        cursor.execute(
            """
            SELECT selected_catalog.direction_key,
                   selected_catalog.material_type,
                   selected_catalog.access_label
            FROM portal_content_lookup_projection AS lookup_row
            INNER JOIN portal_content_catalog AS selected_catalog
              ON selected_catalog.canonical_release_id = lookup_row.canonical_release_id
             AND selected_catalog.source_snapshot_id = lookup_row.source_snapshot_id
             AND selected_catalog.source_row_fingerprint = lookup_row.selected_source_row_fingerprint
            WHERE lookup_row.canonical_release_id = %s
              AND lookup_row.source_snapshot_id = %s
              AND lookup_row.lookup_kind IN ('title', 'slug', 'path', 'url')
              AND lookup_row.resolution_status IN ('unique', 'identical_collapsed')
              AND selected_catalog.is_active = 1
            ORDER BY selected_catalog.source_row_fingerprint
            LIMIT 1
            """,
            (candidate_release_id, catalog_snapshot_id),
        )
        combined_key = cursor.fetchone()
        combined_direction = _row_value(combined_key, "direction_key", 0)
        combined_material = _row_value(combined_key, "material_type", 1)
        combined_access = _row_value(combined_key, "access_label", 2)
        combined_smoke = None
        if combined_direction and combined_material and combined_access:
            cursor.execute(
                """
                SELECT
                  (SELECT COUNT(DISTINCT selected_catalog.source_row_fingerprint)
                   FROM portal_content_lookup_projection AS lookup_row
                   INNER JOIN portal_content_catalog AS selected_catalog
                     ON selected_catalog.canonical_release_id = lookup_row.canonical_release_id
                    AND selected_catalog.source_snapshot_id = lookup_row.source_snapshot_id
                    AND selected_catalog.source_row_fingerprint = lookup_row.selected_source_row_fingerprint
                   WHERE lookup_row.canonical_release_id = %s
                     AND lookup_row.source_snapshot_id = %s
                     AND lookup_row.lookup_kind IN ('title', 'slug', 'path', 'url')
                     AND lookup_row.resolution_status IN ('unique', 'identical_collapsed')
                     AND selected_catalog.is_active = 1
                     AND selected_catalog.direction_key = %s
                     AND selected_catalog.material_type = %s
                     AND selected_catalog.access_label = %s
                  ) AS combined_projection_rows,
                  (SELECT COUNT(DISTINCT catalog.source_row_fingerprint)
                   FROM portal_content_catalog AS catalog
                   WHERE catalog.canonical_release_id = %s
                     AND catalog.source_snapshot_id = %s
                     AND catalog.is_active = 1
                     AND catalog.direction_key = %s
                     AND catalog.material_type = %s
                     AND catalog.access_label = %s
                     AND EXISTS (
                       SELECT 1
                       FROM portal_content_lookup_projection AS lookup_row
                       WHERE lookup_row.canonical_release_id = catalog.canonical_release_id
                         AND lookup_row.source_snapshot_id = catalog.source_snapshot_id
                         AND lookup_row.selected_source_row_fingerprint = catalog.source_row_fingerprint
                         AND lookup_row.lookup_kind IN ('title', 'slug', 'path', 'url')
                         AND lookup_row.resolution_status IN ('unique', 'identical_collapsed')
                     )
                  ) AS combined_catalog_rows
                """,
                (
                    candidate_release_id, catalog_snapshot_id,
                    combined_direction, combined_material, combined_access,
                    candidate_release_id, catalog_snapshot_id,
                    combined_direction, combined_material, combined_access,
                ),
            )
            combined_smoke = cursor.fetchone()
        joined_total = int(_row_value(joined_smoke, "joined_projection_rows", 0) or 0)
        combined_projection = int(
            _row_value(combined_smoke, "combined_projection_rows", 0) or 0
        )
        combined_catalog = int(
            _row_value(combined_smoke, "combined_catalog_rows", 1) or 0
        )
        lookup_total = int(_row_value(lookup_smoke, "lookup_group_count", 0) or 0)
        smoke_failures = 0 if (
            lookup_total > 0
            and joined_total > 0
            and combined_projection > 0
            and combined_projection == combined_catalog
            and int(_row_value(lookup_smoke, "lookup_consistency_failures", 1) or 0) == 0
            and int(_row_value(lookup_smoke, "dangling_selected_count", 2) or 0) == 0
            and int(_row_value(lookup_smoke, "title_group_count", 3) or 0) > 0
            and int(_row_value(lookup_smoke, "path_group_count", 5) or 0) > 0
            and int(_row_value(lookup_smoke, "url_group_count", 6) or 0) > 0
            and int(_row_value(slug_smoke, "expected_slug_group_count", 0) or 0)
            == int(_row_value(slug_smoke, "projected_slug_group_count", 1) or 0)
            and all(
                int(_row_value(joined_smoke, name, index) or 0) == joined_total
                for index, name in enumerate(
                    ("joined_direction_rows", "joined_material_rows", "joined_access_rows"),
                    start=1,
                )
            )
        ) else 1
        active_mutations = 0 if (
            int(active.get("canonical_release_id") or 0) == predecessor_id
            and active.get("release_status") == "active"
            and predecessor_id == int(bundle.get("predecessor_release_id") or 0)
            and batch.get("batch_status") == "candidate_materialized"
            and batch.get("activation_status") == "candidate"
            and int(batch.get("taxonomy_version_id") or 0) == int(bundle.get("taxonomy_version_id") or -1)
            and _records_hash(predecessor_snapshot_records) == bundle.get("predecessor_snapshot_hash")
            and _records_hash(predecessor_import_records) == bundle.get("predecessor_import_hash")
            and predecessor_catalog_hash == bundle.get("predecessor_catalog_hash")
            and all(predecessor_non_content.get(table, {}).get("hash") == expected.get("hash") for table, expected in expected_non_content.items() if isinstance(expected, Mapping))
        ) else 1
        fact_total_controls = _metadata_fact_controls(
            cursor, predecessor_id, candidate_release_id
        )
        successor_controls = (
            (
                "content.accepted_classification_delta_count",
                Decimal(int(bundle.get("classification_delta_count") or 0)),
                Decimal(
                    validation_delta.actual_count
                    if validation_delta is not None
                    else -1
                ),
            ),
            (
                "content.accepted_classification_delta_hash_match_pct",
                EXACT_PERCENT,
                EXACT_PERCENT if classification_delta_match else Decimal("0"),
            ),
            (
                "content.entity_continuity_hash_match_pct",
                EXACT_PERCENT,
                EXACT_PERCENT if continuity_match else Decimal("0"),
            ),
            (
                "content.mnn_mapping_count",
                Decimal(int(bundle.get("candidate_mnn_count") or 0)),
                Decimal(candidate_mnn_count),
            ),
            (
                "content.mnn_entity_count",
                Decimal(int(bundle.get("candidate_mnn_entity_count") or 0)),
                Decimal(candidate_mnn_entity_count),
            ),
            (
                "content.mnn_hash_match_pct",
                EXACT_PERCENT,
                EXACT_PERCENT if mnn_hash_match else Decimal("0"),
            ),
            (
                "content.mnn_snapshot_match_pct",
                EXACT_PERCENT,
                EXACT_PERCENT if mnn_snapshot_match else Decimal("0"),
            ),
        )
        _validate_reviewed_url_exclusions(cursor, candidate_release_id)
        content_unresolved, non_content_unresolved = _observed_page_resolution_counts(
            cursor, candidate_release_id
        )
        report = GateReport(
            candidate_release_id=candidate_release_id,
            source_reconciliation_pct=EXACT_PERCENT if source_match else Decimal("0"),
            count_reconciliation_pct=EXACT_PERCENT if count_match else Decimal("0"),
            hash_reconciliation_pct=EXACT_PERCENT if hash_match else Decimal("0"),
            schema_compliance_pct=EXACT_PERCENT if int(approval.get("schema_failures") or 0) + catalog_schema_failures == 0 else Decimal("0"),
            anti_flip_violations=anti_flip,
            strong_identity_collisions=strong_collisions,
            out_of_taxonomy_values=out_of_taxonomy,
            archive_material_types=archive_types,
            unresolved_accepted_conflicts=int(approval.get("unresolved_accepted") or 0),
            active_release_mutations=active_mutations,
            dashboard_smoke_failures=smoke_failures,
            fact_total_mismatches=sum(expected != actual for _name, expected, actual in fact_total_controls),
            content_unresolved=content_unresolved,
            non_content_unresolved=non_content_unresolved,
            successor_controls=successor_controls,
            fact_total_controls=fact_total_controls,
        )
        if owns_connection:
            connection.rollback()
        return report
    except CandidateMaterializationError:
        if owns_connection and connection is not None:
            connection.rollback()
        raise
    except release_store.ReleaseStoreError as exc:
        if owns_connection and connection is not None:
            connection.rollback()
        raise CandidateMaterializationError(str(exc)) from None
    except Exception:
        if owns_connection and connection is not None:
            connection.rollback()
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_FAILED") from None
    finally:
        _close(cursor, connection if owns_connection else None)


def validate_and_transition_content_candidate(
    candidate_release_id: int,
    expected_counts: Mapping[str, int],
    accepted_hash: str,
    *,
    reviewed_by: str,
    code_revision: str,
    materializer_connection_factory,
    operator_connection_factory,
) -> GateReport:
    """Persist exact content-gate evidence and transition staging to validated.

    A dedicated materializer read first proves that the production read role can
    inspect the candidate.  The release-operator then repeats the complete gate
    under its own transaction and persists the evidence atomically with the
    lifecycle transition.  Neither role can mutate the active pointer here.
    """

    reviewer = str(reviewed_by or "").strip()
    if (
        not reviewer
        or len(reviewer) > 255
        or any(ord(character) < 32 for character in reviewer)
        or not re.fullmatch(r"[0-9a-f]{7,64}", str(code_revision or ""))
        or not callable(materializer_connection_factory)
        or not callable(operator_connection_factory)
    ):
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_AUTHORITY_INVALID")

    inspection_connection = None
    operator_connection = None
    operator_cursor = None
    try:
        inspection_connection = materializer_connection_factory()
        inspection_connection.start_transaction()
        inspected = validate_content_candidate(
            candidate_release_id,
            expected_counts,
            accepted_hash,
            connection=inspection_connection,
        )
        inspection_connection.rollback()
        if not inspected.passed:
            raise CandidateMaterializationError("CANDIDATE_GATE_FAILED")

        operator_connection = operator_connection_factory()
        operator_connection.start_transaction()
        authoritative = validate_content_candidate(
            candidate_release_id,
            expected_counts,
            accepted_hash,
            connection=operator_connection,
        )
        if not authoritative.passed or authoritative != inspected:
            raise CandidateMaterializationError("CANDIDATE_GATE_FAILED")

        operator_cursor = operator_connection.cursor(dictionary=True)
        operator_cursor.execute(
            """
            SELECT baseline_validation_run_id, code_revision, release_status
            FROM portal_data_releases
            WHERE dataset_key = %s AND id = %s
            FOR UPDATE
            """,
            (DATASET_KEY, int(candidate_release_id)),
        )
        release = operator_cursor.fetchone()
        if (
            not isinstance(release, Mapping)
            or release.get("release_status") != "staging"
            or str(release.get("code_revision") or "") != code_revision
            or int(release.get("baseline_validation_run_id") or 0) <= 0
        ):
            raise CandidateMaterializationError("CANDIDATE_NOT_MUTABLE")
        baseline_snapshot_id = int(release["baseline_validation_run_id"])
        validation_run_id = str(uuid.uuid4())
        diagnostic = _canonical_json(
            {
                "accepted_decision_hash": accepted_hash,
                "expected_counts": {
                    str(key): int(value)
                    for key, value in sorted(expected_counts.items())
                },
                "gate_passed": True,
            }
        )
        fact_total_controls = _validated_fact_total_controls(
            authoritative.fact_total_controls
        )
        successor_controls = _validated_successor_controls(
            authoritative.successor_controls
        )
        controls = (
            ("content.source_reconciliation_pct", EXACT_PERCENT, authoritative.source_reconciliation_pct),
            ("content.count_reconciliation_pct", EXACT_PERCENT, authoritative.count_reconciliation_pct),
            ("content.hash_reconciliation_pct", EXACT_PERCENT, authoritative.hash_reconciliation_pct),
            ("content.schema_compliance_pct", EXACT_PERCENT, authoritative.schema_compliance_pct),
            ("content.anti_flip_violations", Decimal("0"), Decimal(authoritative.anti_flip_violations)),
            ("content.strong_identity_collisions", Decimal("0"), Decimal(authoritative.strong_identity_collisions)),
            ("content.out_of_taxonomy_values", Decimal("0"), Decimal(authoritative.out_of_taxonomy_values)),
            ("content.archive_material_types", Decimal("0"), Decimal(authoritative.archive_material_types)),
            ("content.unresolved_accepted_conflicts", Decimal("0"), Decimal(authoritative.unresolved_accepted_conflicts)),
            ("content.active_release_mutations", Decimal("0"), Decimal(authoritative.active_release_mutations)),
            ("content.dashboard_smoke_failures", Decimal("0"), Decimal(authoritative.dashboard_smoke_failures)),
            ("content.fact_total_mismatches", Decimal("0"), Decimal(authoritative.fact_total_mismatches)),
            ("content.content_unresolved", Decimal("0"), Decimal(authoritative.content_unresolved)),
            ("content.non_content_unresolved", Decimal("0"), Decimal(authoritative.non_content_unresolved)),
            *successor_controls,
            *fact_total_controls,
        )
        for control_name, expected, actual in controls:
            operator_cursor.execute(
                """
                INSERT INTO portal_migration_validation_runs (
                  canonical_release_id, baseline_snapshot_id,
                  candidate_snapshot_id, candidate_run_id,
                  validation_run_id, validation_run_completed_at, code_revision,
                  control_name, expected_value, actual_value,
                  absolute_delta, relative_delta, threshold_value,
                  result_status, diagnostic_json, reviewed_by, accepted_at
                ) VALUES (
                  %s, %s, NULL, NULL, %s, NOW(6), %s,
                  %s, %s, %s, %s, 0, 0,
                  'pass', %s, %s, NOW(6)
                )
                """,
                (
                    int(candidate_release_id), baseline_snapshot_id,
                    validation_run_id, code_revision, control_name,
                    expected, actual, abs(actual - expected), diagnostic, reviewer,
                ),
            )
            if int(getattr(operator_cursor, "rowcount", -1)) != 1:
                raise CandidateMaterializationError("VALIDATION_EVIDENCE_WRITE_FAILED")
        operator_cursor.execute(
            """
            UPDATE portal_data_releases
            SET release_status = 'validated'
            WHERE dataset_key = %s AND id = %s AND release_status = 'staging'
            """,
            (DATASET_KEY, int(candidate_release_id)),
        )
        if int(getattr(operator_cursor, "rowcount", -1)) != 1:
            raise CandidateMaterializationError("CANDIDATE_STATUS_TRANSITION_FAILED")
        operator_connection.commit()
        return authoritative
    except CandidateMaterializationError:
        if operator_connection is not None:
            operator_connection.rollback()
        raise
    except Exception:
        if operator_connection is not None:
            operator_connection.rollback()
        raise CandidateMaterializationError("CANDIDATE_VALIDATION_FAILED") from None
    finally:
        _close(operator_cursor, operator_connection)
        _close(None, inspection_connection)
