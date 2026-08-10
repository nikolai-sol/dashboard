"""Concrete MySQL store for Abbott reconciliation staging.

Every method accepts the same injected PEP-249 connection factory as the
canonical registry repository.  Source captures and staging rows are canonical
MySQL state; this module never reads or writes legacy local registry state.
"""

from __future__ import annotations

from dataclasses import asdict, replace
from datetime import datetime, timezone
import json
from pathlib import PurePosixPath
from typing import Mapping, Sequence
from urllib.parse import urlsplit

from .approval_hashes import _plain, compute_classification_event_fingerprint
from .batch_service import BuiltApprovalBatch, PersistedApprovalBatch
from .domain import (
    ACCESS_CODES,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    CanonicalClassification,
    MaterialCandidate,
    Proposal,
)
from .identity import IdentityAlias, IdentityResolver
from .llm_classifier import LlmAttempt, LlmClassification, LlmUsage
from .normalization import normalize_taxonomy_label, normalize_title, normalize_url, sha256_text
from .reconcile import ReconciliationInput, reconcile_entity
from .repository import ContentRegistryRepository, DATASET_KEY, RepositoryError
from .sources import (
    RejectedSourceRow,
    SourceCandidate,
    SourceIdentityVariant,
    SourceProvenance,
    SourceSnapshot,
)
from .workflow_service import (
    REGISTRY1_PARSER_VERSION,
    REGISTRY2_PARSER_VERSION,
    PersistedReconciliationItem,
    PersistedReconciliationRun,
    PersistedSourceBinding,
    ReconciliationContext,
    WorkflowConfiguration,
)


def _canonical_json(value: object) -> str:
    return json.dumps(_plain(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_value(value: object) -> object:
    return json.loads(value) if isinstance(value, str) else value


def _is_duplicate_key_error(error: Exception) -> bool:
    """Return true only for the MySQL duplicate-key condition (1062)."""

    errno = getattr(error, "errno", None)
    if errno is None and getattr(error, "args", ()):
        errno = error.args[0]
    try:
        return int(errno) == 1062
    except (TypeError, ValueError):
        return False


def _candidate_payload(value: SourceCandidate | None) -> object | None:
    return asdict(value) if value is not None else None


def _candidate_from_payload(value: object | None) -> SourceCandidate | None:
    value = _json_value(value)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID")
    try:
        candidate = MaterialCandidate(**dict(value["candidate"]))
        provenance = tuple(SourceProvenance(**dict(item)) for item in value["provenance"])
        variants = tuple(SourceIdentityVariant(**dict(item)) for item in value["identity_variants"])
        return SourceCandidate(
            key=str(value["key"]),
            candidate=candidate,
            provenance=provenance,
            identity_variants=variants,
        )
    except (KeyError, TypeError, ValueError):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID") from None


def _registry1_occurrence_evidence(
    candidate: SourceCandidate,
) -> tuple[dict[str, object], ...]:
    """Bind every Registry 1 row locator to its immutable identity evidence."""

    variants_by_row: dict[str, SourceIdentityVariant] = {}
    for variant in candidate.identity_variants:
        if variant.source_row_id in variants_by_row:
            raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
        variants_by_row[variant.source_row_id] = variant
    provenance_ids = tuple(item.source_row_id for item in candidate.provenance)
    if (
        not provenance_ids
        or len(set(provenance_ids)) != len(provenance_ids)
        or set(provenance_ids) != set(variants_by_row)
    ):
        raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")

    result: list[dict[str, object]] = []
    for provenance in candidate.provenance:
        if provenance.source_name != "registry1":
            raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
        prefix = "registry1:"
        locator = provenance.source_row_id
        if not locator.startswith(prefix):
            raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
        sheet, separator, raw_ordinal = locator[len(prefix):].rpartition(":")
        try:
            ordinal = int(raw_ordinal)
        except ValueError:
            raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID") from None
        fingerprint = provenance.source_fingerprint.casefold()
        if (
            not separator
            or not sheet.strip()
            or ordinal <= 0
            or len(fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in fingerprint)
        ):
            raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
        variant = variants_by_row[locator]
        result.append(
            {
                "source_name": provenance.source_name,
                "source_row_id": locator,
                "source_sheet": sheet.strip(),
                "source_row_ordinal": ordinal,
                "source_row_fingerprint": fingerprint,
                "material_id": variant.material_id,
                "normalized_url": variant.normalized_url,
                "page_title": variant.normalized_title,
                "material_type_code": variant.material_type_code,
                "raw_material_type": variant.raw_material_type,
                "raw_status": variant.raw_status,
                "direction_code": variant.direction_code,
                "access_code": variant.access_code,
                "lifecycle_code": variant.lifecycle_code,
            }
        )
    return tuple(result)


def _registry1_alias_values(
    candidate: SourceCandidate,
) -> tuple[tuple[str, str, str], ...]:
    aliases: list[tuple[str, str, str]] = []
    for variant in candidate.identity_variants:
        if variant.material_id:
            aliases.append(("material_id", variant.material_id, "strong"))
        if variant.normalized_url:
            aliases.extend(
                (
                    ("canonical_url", variant.normalized_url, "strong"),
                    ("url", variant.normalized_url, "strong"),
                )
            )
            slug = PurePosixPath(urlsplit(variant.normalized_url).path).name
            if slug:
                aliases.append(("slug", slug, "weak"))
        if variant.normalized_title:
            aliases.append(("title", variant.normalized_title, "weak"))
    return tuple(dict.fromkeys(aliases))


def _canonical_payload(value: CanonicalClassification | None) -> object | None:
    return asdict(value) if value is not None else None


def _canonical_from_payload(value: object | None) -> CanonicalClassification | None:
    value = _json_value(value)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID")
    try:
        return CanonicalClassification(**dict(value))
    except (TypeError, ValueError):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID") from None


def _proposal_payload(value: Proposal | None) -> object | None:
    return asdict(value) if value is not None else None


def _proposal_from_payload(value: object | None) -> Proposal | None:
    value = _json_value(value)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID")
    try:
        return Proposal(**dict(value))
    except (TypeError, ValueError):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID") from None


def _rejected_source_from_payload(value: object | None) -> RejectedSourceRow | None:
    value = _json_value(value)
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID")
    try:
        return RejectedSourceRow(
            source_name=str(value["source_name"]),
            source_row_id=str(value["source_row_id"]),
            reason_code=str(value["reason_code"]),
            source_fingerprint=str(value["source_fingerprint"]),
        )
    except (KeyError, TypeError, ValueError):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID") from None


def _input_payload(value: ReconciliationInput) -> dict[str, object]:
    payload = {
        "content_entity_id": value.content_entity_id,
        "active_canonical": _canonical_payload(value.active_canonical),
        "reviewed_correction": _proposal_payload(value.reviewed_correction),
        "registry1": _candidate_payload(value.registry1 if isinstance(value.registry1, SourceCandidate) else None),
        "registry2": _candidate_payload(value.registry2),
        "deterministic_proposal": _proposal_payload(value.deterministic_proposal),
        "llm_proposal": _proposal_payload(value.llm_proposal),
        "verifier_proposal": _proposal_payload(value.verifier_proposal),
        "identity_conflict": value.identity_conflict,
        "content_available": value.content_available,
        "rejection_code": value.rejection_code,
        "explicit_archive_override": value.explicit_archive_override,
        "http_status": value.http_status,
    }
    if value.rejected_source_row is not None:
        payload["rejected_source_row"] = asdict(value.rejected_source_row)
    return payload


def _input_from_payload(value: object) -> ReconciliationInput:
    value = _json_value(value)
    if not isinstance(value, Mapping):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID")
    try:
        return ReconciliationInput(
            content_entity_id=(int(value["content_entity_id"]) if value.get("content_entity_id") is not None else None),
            active_canonical=_canonical_from_payload(value.get("active_canonical")),
            reviewed_correction=_proposal_from_payload(value.get("reviewed_correction")),
            registry1=_candidate_from_payload(value.get("registry1")),
            registry2=_candidate_from_payload(value.get("registry2")),
            deterministic_proposal=_proposal_from_payload(value.get("deterministic_proposal")),
            llm_proposal=_proposal_from_payload(value.get("llm_proposal")),
            verifier_proposal=_proposal_from_payload(value.get("verifier_proposal")),
            identity_conflict=bool(value.get("identity_conflict")),
            content_available=bool(value.get("content_available", True)),
            rejection_code=(str(value["rejection_code"]) if value.get("rejection_code") else None),
            rejected_source_row=_rejected_source_from_payload(
                value.get("rejected_source_row")
            ),
            explicit_archive_override=bool(value.get("explicit_archive_override")),
            http_status=(int(value["http_status"]) if value.get("http_status") is not None else None),
        )
    except (TypeError, ValueError):
        raise RepositoryError("RECONCILIATION_ITEM_INVALID") from None


def _run_key(
    configuration: WorkflowConfiguration,
    context: ReconciliationContext,
    registry1_hash: str,
    registry2_hash: str,
) -> str:
    return sha256_text(
        _canonical_json(
            {
                "code_revision": configuration.code_revision,
                "model_routing_version": configuration.model_routing_version,
                "predecessor_release_id": context.predecessor_release_id,
                "predecessor_snapshot_digests": context.predecessor_snapshot_digests,
                "predecessor_snapshot_ids": context.predecessor_snapshot_ids,
                "prompt_version": configuration.prompt_version,
                "registry1_hash": registry1_hash,
                "registry2_hash": registry2_hash,
                "taxonomy_digest": context.taxonomy.digest,
                "taxonomy_version": context.taxonomy.version,
            }
        )
    )


class MySqlWorkflowStore:
    def __init__(self, connection_factory):
        self._connection_factory = connection_factory
        self._registry = ContentRegistryRepository(connection_factory)

    def load_persisted_batch(self, batch_id: int) -> PersistedApprovalBatch:
        return self._registry.load_persisted_batch(int(batch_id))

    def load_finalized_batch_for_run(
        self, run_id: int
    ) -> PersistedApprovalBatch | None:
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT run.run_status, batch.id
                FROM portal_content_reconciliation_runs AS run
                LEFT JOIN portal_content_approval_batches AS batch
                  ON batch.reconciliation_run_id = run.id
                 AND batch.dataset_key = run.dataset_key
                WHERE run.id = %s
                  AND run.dataset_key = %s
                """,
                (int(run_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None:
                raise RepositoryError("RECONCILIATION_RUN_NOT_FOUND")
            if str(row[0]) != "finalized":
                return None
            if row[1] is None:
                raise RepositoryError("FINALIZED_BATCH_MISSING")
            batch_id = int(row[1])
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)
        return self.load_persisted_batch(batch_id)

    def load_llm_attempts(
        self, run_id: int, item_key: str
    ) -> Mapping[str, LlmAttempt]:
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT attempt.route_kind, attempt.attempt_ordinal,
                       attempt.model_version, attempt.request_hash,
                       attempt.requested_fields, attempt.strict_result_json,
                       attempt.unresolved_code, attempt.input_token_count,
                       attempt.output_token_count, attempt.elapsed_ms,
                       attempt.event_fingerprint
                FROM portal_content_reconciliation_items AS item
                INNER JOIN portal_content_llm_attempts AS attempt
                  ON attempt.reconciliation_item_id = item.id
                 AND attempt.reconciliation_run_id = item.reconciliation_run_id
                WHERE item.reconciliation_run_id = %s
                  AND item.item_key = %s
                ORDER BY attempt.route_kind, attempt.attempt_ordinal
                """,
                (int(run_id), item_key),
            )
            result: dict[str, LlmAttempt] = {}
            for row in cursor.fetchall():
                route_kind = str(row[0])
                if route_kind in result or route_kind not in {
                    "terra_primary", "sol_verifier"
                }:
                    raise RepositoryError("LLM_ATTEMPT_MISMATCH")
                requested = _json_value(row[4])
                strict_raw = row[5]
                strict = _json_value(strict_raw)
                if not isinstance(requested, list) or any(
                    not isinstance(value, str) for value in requested
                ):
                    raise RepositoryError("LLM_ATTEMPT_MISMATCH")
                classification = (
                    LlmClassification.model_validate_json(
                        strict_raw
                        if isinstance(strict_raw, (str, bytes, bytearray))
                        else _canonical_json(strict)
                    )
                    if strict is not None
                    else None
                )
                unresolved_code = str(row[6]) if row[6] is not None else None
                status = "success" if classification is not None else "unresolved"
                if classification is None and not unresolved_code:
                    raise RepositoryError("LLM_ATTEMPT_MISMATCH")
                usage = None
                if row[7] is not None or row[8] is not None:
                    input_tokens = int(row[7] or 0)
                    output_tokens = int(row[8] or 0)
                    usage = LlmUsage(
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        total_tokens=input_tokens + output_tokens,
                    )
                attempt = LlmAttempt(
                    status=status,
                    model=str(row[2]),
                    classification=classification,
                    unresolved_code=unresolved_code,
                    attempt_count=int(row[1]),
                    input_hash=str(row[3]),
                    requested_fields=tuple(requested),
                    usage=usage,
                    elapsed_ms=(int(row[9]) if row[9] is not None else None),
                )
                payload = {
                    "attempt_count": attempt.attempt_count,
                    "input_hash": attempt.input_hash,
                    "item_key": item_key,
                    "model": attempt.model,
                    "requested_fields": attempt.requested_fields,
                    "route_kind": route_kind,
                    "run_id": int(run_id),
                    "status": attempt.status,
                    "strict_result": (
                        attempt.classification.model_dump(mode="json")
                        if attempt.classification is not None
                        else None
                    ),
                    "unresolved_code": attempt.unresolved_code,
                }
                if str(row[10]) != sha256_text(_canonical_json(payload)):
                    raise RepositoryError("LLM_ATTEMPT_MISMATCH")
                result[route_kind] = attempt
            return result
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    def load_accepted_snapshot(self, batch_id: int):
        return self._registry.load_accepted_snapshot(int(batch_id))

    def load_batch_history(self, batch_id: int):
        return self._registry.load_batch_history(int(batch_id))

    def attest_batch_for_publication(self, batch_id: int, batch) -> None:
        self._registry.attest_batch_for_publication(int(batch_id), batch)

    def mark_batch_published(
        self, batch_id: int, spreadsheet_id: str, projection_hash: str
    ) -> None:
        self._registry.mark_batch_published(
            int(batch_id), spreadsheet_id, projection_hash
        )

    def mark_batch_projection_failed(self, batch_id: int, failure_code: str) -> None:
        self._registry.mark_batch_projection_failed(int(batch_id), failure_code)

    def record_batch_acceptance(
        self, batch_id: int, snapshot, spreadsheet_id: str
    ) -> None:
        self._registry.record_batch_acceptance(
            int(batch_id), snapshot, spreadsheet_id
        )

    def ingest_accepted_snapshot(self, snapshot):
        return self._registry.ingest_accepted_snapshot(snapshot)

    def load_predecessor_release_id_for_batch(self, batch_id: int) -> int:
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT run.predecessor_release_id
                FROM portal_content_approval_batches AS batch
                INNER JOIN portal_content_reconciliation_runs AS run
                  ON run.id = batch.reconciliation_run_id
                 AND run.dataset_key = batch.dataset_key
                WHERE batch.id = %s
                  AND batch.dataset_key = %s
                """,
                (int(batch_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None or int(row[0]) <= 0:
                raise RepositoryError("PREDECESSOR_BINDING_INVALID")
            return int(row[0])
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    def load_reconciliation_context(self, configuration: WorkflowConfiguration) -> ReconciliationContext:
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            predecessor_id, snapshot_ids = self._lock_active_release(cursor)
            snapshot_digests = self._snapshot_digests(cursor, snapshot_ids)
            taxonomy_id, taxonomy = ContentRegistryRepository._load_taxonomy(
                cursor, configuration.taxonomy_version
            )
            if taxonomy_id <= 0:
                raise RepositoryError("TAXONOMY_VERSION_NOT_ACTIVE")
            self._bootstrap_registry_cursor(cursor, predecessor_id, taxonomy_id)
            entities = self._load_entities(cursor)
            aliases = self._load_aliases(cursor)
            connection.commit()
            return ReconciliationContext(
                predecessor_release_id=predecessor_id,
                predecessor_snapshot_ids=snapshot_ids,
                predecessor_snapshot_digests=snapshot_digests,
                taxonomy=taxonomy,
                entities=entities,
                aliases=aliases,
            )
        except RepositoryError:
            ContentRegistryRepository._rollback(connection)
            raise
        except Exception:
            ContentRegistryRepository._rollback(connection)
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    @staticmethod
    def _lock_active_release(cursor):
        cursor.execute(
            """
            SELECT release_row.id, release_row.source_snapshot_ids
            FROM portal_active_data_releases AS active
            INNER JOIN portal_data_releases AS release_row
              ON release_row.id = active.canonical_release_id
             AND release_row.dataset_key = active.dataset_key
             AND release_row.release_status = 'active'
            WHERE active.dataset_key = %s
            FOR UPDATE
            """,
            (DATASET_KEY,),
        )
        row = cursor.fetchone()
        if row is None:
            raise RepositoryError("ACTIVE_PREDECESSOR_NOT_FOUND")
        values = _json_value(row[1])
        if not isinstance(values, list) or not values:
            raise RepositoryError("PREDECESSOR_BINDING_INVALID")
        snapshot_ids = tuple(int(value) for value in values)
        if len(set(snapshot_ids)) != len(snapshot_ids) or any(value <= 0 for value in snapshot_ids):
            raise RepositoryError("PREDECESSOR_BINDING_INVALID")
        return int(row[0]), snapshot_ids

    @staticmethod
    def _snapshot_digests(cursor, snapshot_ids: Sequence[int]) -> tuple[str, ...]:
        placeholders = ", ".join(["%s"] * len(snapshot_ids))
        cursor.execute(
            f"""
            SELECT id, content_sha256
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s
              AND id IN ({placeholders})
            ORDER BY FIELD(id, {placeholders})
            """,
            (DATASET_KEY, *snapshot_ids, *snapshot_ids),
        )
        rows = tuple(cursor.fetchall())
        if tuple(int(row[0]) for row in rows) != tuple(snapshot_ids):
            raise RepositoryError("PREDECESSOR_BINDING_INVALID")
        digests = tuple(str(row[1]).lower() for row in rows)
        if any(len(value) != 64 or any(character not in "0123456789abcdef" for character in value) for value in digests):
            raise RepositoryError("PREDECESSOR_BINDING_INVALID")
        return digests

    @staticmethod
    def _load_entities(cursor) -> tuple[CanonicalClassification, ...]:
        cursor.execute(
            """
            WITH latest_events AS (
              SELECT event.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY event.content_entity_id
                       ORDER BY event.effective_at DESC, event.id DESC
                     ) AS row_rank
              FROM portal_content_classification_events AS event
              WHERE event.effective_at <= CURRENT_TIMESTAMP(6)
            )
            SELECT entity.id, entity.title, entity.canonical_url,
                   event.direction_code, event.material_type_code,
                   event.access_code, event.lifecycle_code, event.id
            FROM portal_content_registry_entities AS entity
            LEFT JOIN latest_events AS event
              ON event.content_entity_id = entity.id
             AND event.row_rank = 1
            WHERE entity.dataset_key = %s
              AND entity.registry_status = 'active'
            ORDER BY entity.id
            """,
            (DATASET_KEY,),
        )
        return tuple(
            CanonicalClassification(
                content_entity_id=int(row[0]),
                title=str(row[1]),
                url=str(row[2]),
                direction_code=(str(row[3]) if row[3] is not None else None),
                material_type_code=(str(row[4]) if row[4] is not None else None),
                access_code=(str(row[5]) if row[5] is not None else None),
                lifecycle_code=(str(row[6]) if row[6] is not None else "unknown"),
                event_id=(int(row[7]) if row[7] is not None else None),
            )
            for row in cursor.fetchall()
        )

    @staticmethod
    def _load_aliases(cursor) -> tuple[IdentityAlias, ...]:
        cursor.execute(
            """
            SELECT content_entity_id, alias_type, alias_value, uniqueness_scope
            FROM portal_content_registry_aliases
            WHERE dataset_key = %s
              AND alias_status = 'active'
            ORDER BY id
            """,
            (DATASET_KEY,),
        )
        return tuple(
            IdentityAlias(
                content_entity_id=int(row[0]),
                alias_kind=str(row[1]),
                alias_value=str(row[2]),
                strength=str(row[3]),
            )
            for row in cursor.fetchall()
        )

    def _bootstrap_registry_cursor(self, cursor, predecessor_id: int, taxonomy_id: int) -> None:
        cursor.execute(
            """
            SELECT page_title, normalized_url, material_id, material_type,
                   access_label, direction_key, is_active,
                   source_snapshot_id, source_sheet, source_row_ordinal,
                   source_row_fingerprint, content_entity_id,
                   classification_event_id, classification_event_fingerprint
            FROM portal_content_catalog
            WHERE canonical_release_id = %s
            ORDER BY source_snapshot_id, source_sheet, source_row_ordinal
            FOR UPDATE
            """,
            (predecessor_id,),
        )
        rows = tuple(cursor.fetchall())
        if not rows:
            raise RepositoryError("BASELINE_CATALOG_EMPTY")
        provenance_rows = tuple(
            row for row in rows if len(row) > 11 and row[11] is not None
        )
        if provenance_rows:
            if len(provenance_rows) != len(rows):
                raise RepositoryError("BASELINE_PROVENANCE_MIXED")
            self._attest_provenance_registry_cursor(
                cursor, provenance_rows, taxonomy_id
            )
            return
        strong_owner: dict[tuple[str, str], int] = {}
        grouped: dict[str, list[object]] = {}
        for row in rows:
            material_id = str(row[2] or "").strip()
            url = normalize_url(str(row[1] or "")).value
            key = f"material:{material_id.casefold()}" if material_id else (f"url:{url}" if url else f"row:{row[10]}")
            grouped.setdefault(key, []).append(row)
        for ordinal, (group_key, group_rows) in enumerate(sorted(grouped.items()), start=1):
            representative = group_rows[0]
            title = normalize_title(str(representative[0] or ""))
            url = normalize_url(str(representative[1] or "")).value
            material_id = str(representative[2] or "").strip() or None
            urls = tuple(
                dict.fromkeys(
                    normalize_url(str(row[1] or "")).value
                    for row in group_rows
                    if normalize_url(str(row[1] or "")).value
                )
            )
            titles = tuple(
                dict.fromkeys(
                    normalize_title(str(row[0] or ""))
                    for row in group_rows
                    if normalize_title(str(row[0] or ""))
                )
            )
            classifications = {
                (
                    self._taxonomy_code("direction", row[5]),
                    self._taxonomy_code("material_type", row[3]),
                    self._taxonomy_code("access", row[4]) or "unspecified",
                    "active" if bool(row[6]) else "archive_candidate",
                )
                for row in group_rows
            }
            if len(classifications) != 1:
                raise RepositoryError("BASELINE_CLASSIFICATION_MISMATCH")
            direction, material_type, access, lifecycle = next(iter(classifications))
            for kind, value in (
                ("material_id", material_id or ""),
                *(("canonical_url", value) for value in urls),
            ):
                if not value:
                    continue
                prior = strong_owner.setdefault((kind, value.casefold()), ordinal)
                if prior != ordinal:
                    raise RepositoryError("IDENTITY_COLLISION")
            evidence = {
                "authority": "active_release_baseline",
                "predecessor_release_id": predecessor_id,
                "source_row_fingerprints": [str(row[10]) for row in group_rows],
            }
            url_placeholders = ", ".join(["%s"] * len(urls)) or "NULL"
            cursor.execute(
                f"""
                SELECT id, material_id, title, canonical_url,
                       registry_status, source_evidence
                FROM portal_content_registry_entities
                WHERE dataset_key = %s
                  AND (
                    material_id = %s
                    OR canonical_url IN ({url_placeholders})
                    OR (
                      JSON_UNQUOTE(JSON_EXTRACT(source_evidence, '$.authority'))
                        = 'active_release_baseline'
                      AND JSON_EXTRACT(source_evidence, '$.predecessor_release_id') = %s
                      AND JSON_EXTRACT(source_evidence, '$.source_row_fingerprints')
                        = CAST(%s AS JSON)
                    )
                  )
                ORDER BY id
                FOR UPDATE
                """,
                (
                    DATASET_KEY,
                    material_id,
                    *urls,
                    predecessor_id,
                    _canonical_json(evidence["source_row_fingerprints"]),
                ),
            )
            entity_rows = tuple(cursor.fetchall())
            if len(entity_rows) > 1:
                raise RepositoryError("IDENTITY_COLLISION")
            entity_id = int(entity_rows[0][0]) if entity_rows else None
            if entity_rows:
                existing = entity_rows[0]
                if (
                    (str(existing[1]) if existing[1] is not None else None) != material_id
                    or str(existing[2]) != title
                    or (
                        bool(urls)
                        and str(existing[3]) not in urls
                    )
                    or (
                        not urls
                        and str(existing[3] or "") != ""
                    )
                    or str(existing[4]) != "active"
                    or _json_value(existing[5]) != evidence
                ):
                    raise RepositoryError("BASELINE_ENTITY_MISMATCH")

            aliases = []
            if material_id:
                aliases.append(("material_id", material_id, "strong"))
            for alias_url in urls:
                aliases.extend((("canonical_url", alias_url, "strong"), ("url", alias_url, "strong")))
                slug = PurePosixPath(urlsplit(alias_url).path).name
                if slug:
                    aliases.append(("slug", slug, "weak"))
            aliases.extend(("title", alias_title, "weak") for alias_title in titles)
            aliases = list(dict.fromkeys(aliases))
            missing_aliases = []
            for alias_type, alias_value, strength in aliases:
                alias_hash = sha256_text(alias_value.casefold())
                cursor.execute(
                    """
                    SELECT content_entity_id, alias_type, alias_value, alias_hash,
                           uniqueness_scope, alias_status, source_evidence
                    FROM portal_content_registry_aliases
                    WHERE dataset_key = %s
                      AND alias_type = %s
                      AND alias_hash = %s
                      AND uniqueness_scope = %s
                    FOR UPDATE
                    """,
                    (DATASET_KEY, alias_type, alias_hash, strength),
                )
                alias_rows = tuple(cursor.fetchall())
                owned_rows = tuple(
                    row for row in alias_rows
                    if entity_id is not None and int(row[0]) == entity_id
                )
                if strength == "strong" and any(
                    entity_id is None or int(row[0]) != entity_id
                    for row in alias_rows
                ):
                    raise RepositoryError("IDENTITY_COLLISION")
                if len(owned_rows) > 1:
                    raise RepositoryError("BASELINE_ALIAS_MISMATCH")
                if not owned_rows:
                    missing_aliases.append((alias_type, alias_value, alias_hash, strength))
                    continue
                alias_row = owned_rows[0]
                if (
                    str(alias_row[1]) != alias_type
                    or str(alias_row[2]) != alias_value
                    or str(alias_row[3]) != alias_hash
                    or str(alias_row[4]) != strength
                    or str(alias_row[5]) != "active"
                    or _json_value(alias_row[6]) != evidence
                ):
                    raise RepositoryError("BASELINE_ALIAS_MISMATCH")

            if entity_id is None:
                cursor.execute(
                    """
                    INSERT INTO portal_content_registry_entities (
                      dataset_key, material_id, title, canonical_url,
                      registry_status, source_evidence
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (DATASET_KEY, material_id, title, url, "active", _canonical_json(evidence)),
                )
                entity_id = int(cursor.lastrowid)
            for alias_type, alias_value, alias_hash, strength in missing_aliases:
                cursor.execute(
                    """
                    INSERT INTO portal_content_registry_aliases (
                      dataset_key, content_entity_id, alias_type, alias_value,
                      alias_hash, uniqueness_scope, alias_status, source_evidence
                    ) VALUES (%s, %s, %s, %s, %s, %s, 'active', %s)
                    """,
                    (
                        DATASET_KEY, entity_id, alias_type, alias_value,
                        alias_hash, strength, _canonical_json(evidence),
                    ),
                )
            self._ensure_baseline_event_cursor(
                cursor,
                entity_id=entity_id,
                taxonomy_id=taxonomy_id,
                direction=direction,
                material_type=material_type,
                access=access,
                lifecycle=lifecycle,
                evidence=evidence,
            )

    def _attest_provenance_registry_cursor(
        self, cursor, rows: Sequence[Sequence[object]], taxonomy_id: int
    ) -> None:
        entity_ids = tuple(sorted({int(row[11] or 0) for row in rows}))
        if not entity_ids or any(value <= 0 for value in entity_ids):
            raise RepositoryError("BASELINE_PROVENANCE_ENTITY_MISMATCH")
        placeholders = ", ".join(["%s"] * len(entity_ids))
        cursor.execute(
            f"""
            SELECT entity.id, entity.registry_status
            FROM portal_content_registry_entities AS entity
            WHERE entity.dataset_key = %s
              AND entity.id IN ({placeholders})
            ORDER BY entity.id
            FOR UPDATE
            """,
            (DATASET_KEY, *entity_ids),
        )
        entity_rows = tuple(cursor.fetchall())
        if (
            tuple(int(row[0]) for row in entity_rows) != entity_ids
            or any(str(row[1]) != "active" for row in entity_rows)
        ):
            raise RepositoryError("BASELINE_PROVENANCE_ENTITY_MISMATCH")

        classifications: dict[int, set[tuple[str | None, str | None, str, str]]] = {}
        attached_events: dict[int, tuple[int, str, tuple[str | None, str | None, str, str]]] = {}
        for row in rows:
            entity_id = int(row[11])
            classification = (
                self._taxonomy_code("direction", row[5]),
                self._taxonomy_code("material_type", row[3]),
                self._taxonomy_code("access", row[4]) or "unspecified",
                "active" if bool(row[6]) else "archive_candidate",
            )
            classifications.setdefault(entity_id, set()).add(classification)
            event_id = int(row[12] or 0)
            event_fingerprint = str(row[13] or "").lower()
            if bool(event_id) != bool(event_fingerprint):
                raise RepositoryError("BASELINE_PROVENANCE_EVENT_MISMATCH")
            if not event_id:
                continue
            if (
                len(event_fingerprint) != 64
                or any(character not in "0123456789abcdef" for character in event_fingerprint)
            ):
                raise RepositoryError("BASELINE_PROVENANCE_EVENT_MISMATCH")
            prior = attached_events.setdefault(
                event_id, (entity_id, event_fingerprint, classification)
            )
            if prior != (entity_id, event_fingerprint, classification):
                raise RepositoryError("BASELINE_PROVENANCE_EVENT_MISMATCH")
        if any(len(values) != 1 for values in classifications.values()):
            raise RepositoryError("BASELINE_CLASSIFICATION_MISMATCH")

        if not attached_events:
            return
        event_ids = tuple(sorted(attached_events))
        event_placeholders = ", ".join(["%s"] * len(event_ids))
        cursor.execute(
            f"""
            SELECT event.id, event.content_entity_id, event.taxonomy_version_id,
                   event.direction_code, event.material_type_code,
                   event.access_code, event.lifecycle_code,
                   event.event_fingerprint
            FROM portal_content_classification_events AS event
            WHERE event.id IN ({event_placeholders})
            ORDER BY event.id
            FOR UPDATE
            """,
            event_ids,
        )
        stored_events = tuple(cursor.fetchall())
        if tuple(int(row[0]) for row in stored_events) != event_ids:
            raise RepositoryError("BASELINE_PROVENANCE_EVENT_MISMATCH")
        for event in stored_events:
            expected_entity, expected_fingerprint, expected_classification = attached_events[
                int(event[0])
            ]
            stored_classification = (
                str(event[3]) if event[3] is not None else None,
                str(event[4]) if event[4] is not None else None,
                str(event[5]) if event[5] is not None else "unspecified",
                str(event[6]),
            )
            if (
                int(event[1]) != expected_entity
                or int(event[2]) != taxonomy_id
                or stored_classification != expected_classification
                or str(event[7]).lower() != expected_fingerprint
            ):
                raise RepositoryError("BASELINE_PROVENANCE_EVENT_MISMATCH")

    @staticmethod
    def _ensure_baseline_event_cursor(
        cursor,
        *,
        entity_id: int,
        taxonomy_id: int,
        direction: str | None,
        material_type: str | None,
        access: str,
        lifecycle: str,
        evidence: dict[str, object],
    ) -> None:
        fingerprint = compute_classification_event_fingerprint(
            {
                "content_entity_id": entity_id,
                "taxonomy_version_id": taxonomy_id,
                "direction_code": direction,
                "material_type_code": material_type,
                "access_code": access,
                "lifecycle_code": lifecycle,
                "event_kind": "baseline",
                "proposal_evidence": evidence,
                "effective_at": "1970-01-01T00:00:00.000000+00:00",
            }
        )
        cursor.execute(
            """
            SELECT taxonomy_version_id, direction_code, material_type_code,
                   access_code, lifecycle_code, event_fingerprint,
                   proposal_evidence, effective_at
            FROM portal_content_classification_events
            WHERE content_entity_id = %s
              AND event_kind = 'baseline'
            ORDER BY id
            FOR UPDATE
            """,
            (entity_id,),
        )
        event_rows = tuple(cursor.fetchall())
        if len(event_rows) > 1:
            raise RepositoryError("BASELINE_EVENT_MISMATCH")
        if event_rows:
            event = event_rows[0]
            if (
                int(event[0]) != taxonomy_id
                or (str(event[1]) if event[1] is not None else None) != direction
                or (str(event[2]) if event[2] is not None else None) != material_type
                or (str(event[3]) if event[3] is not None else None) != access
                or str(event[4]) != lifecycle
                or str(event[5]) != fingerprint
                or _json_value(event[6]) != evidence
                or ContentRegistryRepository._canonical_event_timestamp(event[7])
                   != datetime(1970, 1, 1)
            ):
                raise RepositoryError("BASELINE_EVENT_MISMATCH")
        else:
            cursor.execute(
                """
                INSERT INTO portal_content_classification_events (
                  content_entity_id, taxonomy_version_id, direction_code,
                  material_type_code, access_code, lifecycle_code, event_kind,
                  event_fingerprint, proposal_evidence, effective_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'baseline', %s, %s, %s)
                """,
                (
                    entity_id, taxonomy_id, direction, material_type, access,
                    lifecycle, fingerprint, _canonical_json(evidence),
                    datetime(1970, 1, 1, tzinfo=timezone.utc),
                ),
            )

    @staticmethod
    def _taxonomy_code(kind: str, raw: object) -> str | None:
        value = str(raw or "").strip()
        allowed = {
            "direction": DIRECTION_CODES,
            "material_type": MATERIAL_TYPE_CODES,
            "access": ACCESS_CODES,
            "lifecycle": LIFECYCLE_CODES,
        }[kind]
        if value in allowed:
            return value
        normalized = normalize_taxonomy_label(kind, value)  # type: ignore[arg-type]
        if normalized is None and value:
            raise RepositoryError("BASELINE_TAXONOMY_UNMAPPED")
        return normalized

    def append_llm_attempt(
        self,
        run_id: int,
        item_key: str,
        route_kind: str,
        attempt: LlmAttempt,
    ) -> None:
        if route_kind not in ("terra_primary", "sol_verifier"):
            raise RepositoryError("LLM_ROUTE_INVALID")
        if not attempt.input_hash or len(attempt.input_hash) != 64:
            raise RepositoryError("LLM_ATTEMPT_INVALID")
        strict_result = (
            attempt.classification.model_dump(mode="json")
            if attempt.classification is not None
            else None
        )
        payload = {
            "attempt_count": attempt.attempt_count,
            "input_hash": attempt.input_hash,
            "item_key": item_key,
            "model": attempt.model,
            "requested_fields": attempt.requested_fields,
            "route_kind": route_kind,
            "run_id": int(run_id),
            "status": attempt.status,
            "strict_result": strict_result,
            "unresolved_code": attempt.unresolved_code,
        }
        fingerprint = sha256_text(_canonical_json(payload))
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT id
                FROM portal_content_reconciliation_items
                WHERE reconciliation_run_id = %s
                  AND item_key = %s
                FOR UPDATE
                """,
                (int(run_id), item_key),
            )
            item_row = cursor.fetchone()
            if item_row is None:
                raise RepositoryError("RECONCILIATION_ITEM_NOT_FOUND")
            item_id = int(item_row[0])
            cursor.execute(
                """
                SELECT id, event_fingerprint
                FROM portal_content_llm_attempts
                WHERE reconciliation_item_id = %s
                  AND route_kind = %s
                  AND attempt_ordinal = %s
                FOR UPDATE
                """,
                (item_id, route_kind, max(1, int(attempt.attempt_count))),
            )
            existing = cursor.fetchone()
            if existing is not None:
                if str(existing[1]) != fingerprint:
                    raise RepositoryError("LLM_ATTEMPT_MISMATCH")
                connection.commit()
                return
            usage = attempt.usage
            cursor.execute(
                """
                INSERT INTO portal_content_llm_attempts (
                  reconciliation_run_id, reconciliation_item_id, route_kind,
                  attempt_ordinal, model_version, prompt_version,
                  model_routing_version, request_hash, requested_fields,
                  strict_result_json, unresolved_code, input_token_count,
                  output_token_count, elapsed_ms, event_fingerprint
                )
                SELECT %s, %s, %s, %s, %s, run.prompt_version,
                       run.model_routing_version, %s, %s, %s, %s, %s, %s, %s, %s
                FROM portal_content_reconciliation_runs AS run
                WHERE run.id = %s
                  AND run.dataset_key = %s
                  AND run.run_status IN ('reconciled', 'classified')
                """,
                (
                    int(run_id), item_id, route_kind,
                    max(1, int(attempt.attempt_count)), attempt.model,
                    attempt.input_hash, _canonical_json(attempt.requested_fields),
                    (_canonical_json(strict_result) if strict_result is not None else None),
                    attempt.unresolved_code,
                    (int(usage.input_tokens) if usage is not None else None),
                    (int(usage.output_tokens) if usage is not None else None),
                    (int(attempt.elapsed_ms) if attempt.elapsed_ms is not None else None),
                    fingerprint, int(run_id), DATASET_KEY,
                ),
            )
            if getattr(cursor, "rowcount", 1) != 1:
                raise RepositoryError("RECONCILIATION_STATUS_INVALID")
            connection.commit()
        except RepositoryError:
            ContentRegistryRepository._rollback(connection)
            raise
        except Exception:
            ContentRegistryRepository._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    def persist_reconciliation_run(self, draft: PersistedReconciliationRun) -> PersistedReconciliationRun:
        connection = cursor = None
        try:
            if draft.run_id not in (0, None) or draft.run_key != _run_key(
                draft.configuration, draft.context,
                draft.registry1.source_hash, draft.registry2.source_hash,
            ):
                raise RepositoryError("RECONCILIATION_HASH_MISMATCH")
            connection = self._connection_factory()
            cursor = connection.cursor()
            predecessor_id, snapshot_ids = self._lock_active_release(cursor)
            digests = self._snapshot_digests(cursor, snapshot_ids)
            if (
                predecessor_id != draft.context.predecessor_release_id
                or snapshot_ids != draft.context.predecessor_snapshot_ids
                or digests != draft.context.predecessor_snapshot_digests
            ):
                raise RepositoryError("PREDECESSOR_CHANGED")
            taxonomy_id, taxonomy = ContentRegistryRepository._load_taxonomy(
                cursor, draft.configuration.taxonomy_version
            )
            if taxonomy != draft.context.taxonomy:
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            registry1_snapshot_id = self._register_snapshot(
                cursor, draft.registry1, REGISTRY1_PARSER_VERSION, "abbott_registry1_capture"
            )
            registry2_snapshot_id = self._register_snapshot(
                cursor, draft.registry2, REGISTRY2_PARSER_VERSION, "abbott_registry2_accepted_capture"
            )
            cursor.execute(
                """
                SELECT id
                FROM portal_content_reconciliation_runs
                WHERE dataset_key = %s AND run_key = %s
                FOR UPDATE
                """,
                (DATASET_KEY, draft.run_key),
            )
            existing = cursor.fetchone()
            if existing is not None:
                run_id = int(existing[0])
                connection.commit()
                return self.load_reconciliation_run(run_id)
            cursor.execute(
                """
                INSERT INTO portal_content_reconciliation_runs (
                  dataset_key, run_key, run_status,
                  registry1_snapshot_id, registry1_sha256,
                  registry1_source_row_count, registry1_accepted_count,
                  registry1_rejected_count, registry1_duplicate_collapsed_count,
                  registry1_parser_version, registry1_source_kind,
                  registry2_snapshot_id, registry2_sha256,
                  registry2_source_row_count, registry2_accepted_count,
                  registry2_rejected_count, registry2_duplicate_collapsed_count,
                  registry2_parser_version, registry2_source_kind,
                  predecessor_release_id, predecessor_snapshot_ids,
                  predecessor_snapshot_digests, taxonomy_version_id,
                  taxonomy_digest, prompt_version, model_routing_version,
                  code_revision
                ) VALUES (
                  %s, %s, 'reconciled', %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s
                )
                """,
                (
                    DATASET_KEY, draft.run_key,
                    registry1_snapshot_id, draft.registry1.source_hash,
                    draft.registry1.source_row_count, len(draft.registry1.candidates),
                    len(draft.registry1.rejected_rows), draft.registry1.duplicate_collapsed_count,
                    REGISTRY1_PARSER_VERSION, "abbott_registry1_capture",
                    registry2_snapshot_id, draft.registry2.source_hash,
                    draft.registry2.source_row_count, len(draft.registry2.candidates),
                    len(draft.registry2.rejected_rows), draft.registry2.duplicate_collapsed_count,
                    REGISTRY2_PARSER_VERSION, "abbott_registry2_accepted_capture",
                    predecessor_id, _canonical_json(snapshot_ids), _canonical_json(digests),
                    taxonomy_id, taxonomy.digest, draft.configuration.prompt_version,
                    draft.configuration.model_routing_version, draft.configuration.code_revision,
                ),
            )
            run_id = int(cursor.lastrowid)
            for item in draft.items:
                value = item.reconciliation_input
                cursor.execute(
                    """
                    INSERT INTO portal_content_reconciliation_items (
                      reconciliation_run_id, item_key, input_hash,
                      content_entity_id, identity_status, title, normalized_url,
                      active_canonical_json, registry1_json, registry2_json,
                      content_metadata_json, deterministic_result_json,
                      rejection_code, evidence_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id, item.item_key, item.input_hash, item.content_entity_id,
                        item.identity_status, reconcile_entity(value).title,
                        reconcile_entity(value).url,
                        (_canonical_json(_canonical_payload(value.active_canonical)) if value.active_canonical else None),
                        (_canonical_json(_candidate_payload(value.registry1)) if value.registry1 else None),
                        (_canonical_json(_candidate_payload(value.registry2)) if value.registry2 else None),
                        _canonical_json(_input_payload(value)),
                        (_canonical_json(_proposal_payload(value.deterministic_proposal)) if value.deterministic_proposal else None),
                        value.rejection_code,
                        _canonical_json({"grouping_key": item.grouping_key}),
                    ),
                )
            connection.commit()
            return replace(draft, run_id=run_id)
        except RepositoryError:
            ContentRegistryRepository._rollback(connection)
            raise
        except Exception:
            ContentRegistryRepository._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    @staticmethod
    def _register_snapshot(cursor, snapshot: SourceSnapshot, parser_version: str, source_kind: str) -> int:
        manifest = {
            "accepted_count": len(snapshot.candidates),
            "duplicate_collapsed_count": snapshot.duplicate_collapsed_count,
            "rejected_count": len(snapshot.rejected_rows),
            "source_hash": snapshot.source_hash,
        }
        cursor.execute(
            """
            SELECT id, source_row_count, imported_row_count, rejected_row_count, manifest_json
            FROM portal_dataset_snapshots
            WHERE dataset_key = %s AND source_kind = %s
              AND content_sha256 = %s AND parser_version = %s
            FOR UPDATE
            """,
            (DATASET_KEY, source_kind, snapshot.source_hash, parser_version),
        )
        row = cursor.fetchone()
        if row is not None:
            if (
                int(row[1]) != snapshot.source_row_count
                or int(row[2]) != len(snapshot.candidates)
                or int(row[3]) != len(snapshot.rejected_rows)
                or _json_value(row[4]) != manifest
            ):
                raise RepositoryError("SOURCE_SNAPSHOT_MISMATCH")
            return int(row[0])
        payload = _canonical_json(manifest)
        locator = f"canonical://abbott/content-registry/{source_kind}/{snapshot.source_hash}"
        cursor.execute(
            """
            INSERT INTO portal_dataset_snapshots (
              snapshot_key, dataset_key, source_kind, source_locator,
              content_sha256, content_bytes, source_row_count, parser_version,
              import_status, imported_row_count, rejected_row_count,
              private_archive_locator, manifest_json, imported_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                      'imported', %s, %s, %s, %s, CURRENT_TIMESTAMP(6))
            """,
            (
                f"abbott-{source_kind}-{snapshot.source_hash[:24]}", DATASET_KEY,
                source_kind, locator, snapshot.source_hash, len(payload.encode("utf-8")),
                snapshot.source_row_count, parser_version, len(snapshot.candidates),
                len(snapshot.rejected_rows), locator, payload,
            ),
        )
        return int(cursor.lastrowid)

    def load_reconciliation_run(self, run_id: int) -> PersistedReconciliationRun:
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT run_key, run_status,
                       registry1_snapshot_id, registry1_sha256,
                       registry1_source_row_count, registry1_accepted_count,
                       registry1_rejected_count, registry1_duplicate_collapsed_count,
                       registry2_snapshot_id, registry2_sha256,
                       registry2_source_row_count, registry2_accepted_count,
                       registry2_rejected_count, registry2_duplicate_collapsed_count,
                       predecessor_release_id, predecessor_snapshot_ids,
                       predecessor_snapshot_digests, run.taxonomy_version_id,
                       taxonomy.version, run.taxonomy_digest, prompt_version,
                       model_routing_version, code_revision
                FROM portal_content_reconciliation_runs AS run
                INNER JOIN portal_content_taxonomy_versions AS taxonomy
                  ON taxonomy.id = run.taxonomy_version_id
                 AND taxonomy.dataset_key = run.dataset_key
                WHERE run.id = %s AND run.dataset_key = %s
                """,
                (int(run_id), DATASET_KEY),
            )
            row = cursor.fetchone()
            if row is None:
                raise RepositoryError("RECONCILIATION_RUN_NOT_FOUND")
            taxonomy = ContentRegistryRepository._load_taxonomy_terms(
                cursor, int(row[17]), str(row[18]), str(row[19]), include_retired=True
            )
            cursor.execute(
                """
                SELECT item_key, input_hash, content_entity_id, identity_status,
                       content_metadata_json, evidence_json
                FROM portal_content_reconciliation_items
                WHERE reconciliation_run_id = %s
                ORDER BY item_key
                """,
                (int(run_id),),
            )
            items = []
            entities = {}
            for item_row in cursor.fetchall():
                value = _input_from_payload(item_row[4])
                reconciled = reconcile_entity(value)
                evidence = _json_value(item_row[5])
                if not isinstance(evidence, Mapping):
                    raise RepositoryError("RECONCILIATION_ITEM_INVALID")
                grouping_key = str(evidence.get("grouping_key") or "")
                expected_key = sha256_text(
                    _canonical_json(
                        {
                            "grouping_key": grouping_key,
                            "identity_status": str(item_row[3]),
                            "input_hash": reconciled.input_hash,
                        }
                    )
                )
                if str(item_row[0]) != expected_key or str(item_row[1]) != reconciled.input_hash:
                    raise RepositoryError("RECONCILIATION_HASH_MISMATCH")
                if value.active_canonical is not None:
                    entities[value.active_canonical.content_entity_id] = value.active_canonical
                items.append(
                    PersistedReconciliationItem(
                        grouping_key=grouping_key,
                        item_key=str(item_row[0]), input_hash=str(item_row[1]),
                        content_entity_id=(int(item_row[2]) if item_row[2] is not None else None),
                        identity_status=str(item_row[3]), reconciliation_input=value,
                    )
                )
            configuration = WorkflowConfiguration(
                taxonomy_version=taxonomy.version,
                prompt_version=str(row[20]), model_routing_version=str(row[21]),
                code_revision=str(row[22]),
            )
            context = ReconciliationContext(
                predecessor_release_id=int(row[14]),
                predecessor_snapshot_ids=tuple(int(value) for value in _json_value(row[15])),
                predecessor_snapshot_digests=tuple(str(value) for value in _json_value(row[16])),
                taxonomy=taxonomy, entities=tuple(entities.values()), aliases=(),
            )
            registry1 = PersistedSourceBinding(
                "registry1", str(row[3]), int(row[4]), int(row[5]), int(row[6]),
                int(row[7]), int(row[2]),
            )
            registry2 = PersistedSourceBinding(
                "registry2", str(row[9]), int(row[10]), int(row[11]), int(row[12]),
                int(row[13]), int(row[8]),
            )
            if str(row[0]) != _run_key(configuration, context, registry1.source_hash, registry2.source_hash):
                raise RepositoryError("RECONCILIATION_HASH_MISMATCH")
            return PersistedReconciliationRun(
                run_id=int(run_id), run_key=str(row[0]), status=str(row[1]),
                configuration=configuration, context=context,
                registry1=registry1, registry2=registry2, items=tuple(items),
            )
        except RepositoryError:
            raise
        except Exception:
            raise RepositoryError("DB_READ_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    def resolve_or_create_registry1_entities(
        self, run_id: int, item_keys: Sequence[str]
    ) -> Mapping[str, int]:
        if not item_keys:
            return {}
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            # The active-pointer row is the dataset-wide serialization mutex for
            # canonical identity creation.  It is read-only here; holding it keeps
            # different reconciliation runs from racing on the same new identity.
            cursor.execute(
                """
                SELECT canonical_release_id
                FROM portal_active_data_releases
                WHERE dataset_key = %s
                FOR UPDATE
                """,
                (DATASET_KEY,),
            )
            if cursor.fetchone() is None:
                raise RepositoryError("ACTIVE_PREDECESSOR_NOT_FOUND")
            cursor.execute(
                """
                SELECT run_status
                FROM portal_content_reconciliation_runs
                WHERE id = %s AND dataset_key = %s
                FOR UPDATE
                """,
                (int(run_id), DATASET_KEY),
            )
            run_row = cursor.fetchone()
            if run_row is None or str(run_row[0]) not in ("reconciled", "classified"):
                raise RepositoryError("RECONCILIATION_STATUS_INVALID")
            resolved: dict[str, int] = {}
            resolver = IdentityResolver()
            for item_key in sorted(set(item_keys)):
                cursor.execute(
                    """
                    SELECT identity_status, registry1_json
                    FROM portal_content_reconciliation_items
                    WHERE reconciliation_run_id = %s AND item_key = %s
                    FOR UPDATE
                    """,
                    (int(run_id), item_key),
                )
                row = cursor.fetchone()
                if row is None or str(row[0]) != "new":
                    raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
                candidate = _candidate_from_payload(row[1])
                if candidate is None:
                    raise RepositoryError("REGISTRY_ENTITY_RESOLUTION_INVALID")
                # Re-read identity state only after the item is locked.  The
                # explicit table-range locks protect both existing rows and the
                # insertion gaps used by a new material/url.
                cursor.execute(
                    """
                    SELECT id
                    FROM portal_content_registry_entities
                    WHERE dataset_key = %s
                    ORDER BY id
                    FOR UPDATE
                    """,
                    (DATASET_KEY,),
                )
                cursor.fetchall()
                cursor.execute(
                    """
                    SELECT id
                    FROM portal_content_registry_aliases
                    WHERE dataset_key = %s
                    ORDER BY id
                    FOR UPDATE
                    """,
                    (DATASET_KEY,),
                )
                cursor.fetchall()
                entities = self._load_entities(cursor)
                aliases = list(self._load_aliases(cursor))
                resolution = resolver.resolve(candidate, entities, aliases)
                if resolution.status == "collision":
                    raise RepositoryError("IDENTITY_COLLISION")
                if resolution.status == "matched" and resolution.content_entity_id is not None:
                    resolved[item_key] = resolution.content_entity_id
                    continue
                value = candidate.candidate
                occurrence_evidence = _registry1_occurrence_evidence(candidate)
                evidence = {
                    "authority": "registry1_reconciliation",
                    "candidate_key": candidate.key,
                    "run_id": int(run_id),
                    "item_key": item_key,
                    "provenance": occurrence_evidence,
                }
                try:
                    cursor.execute(
                        """
                        INSERT INTO portal_content_registry_entities (
                          dataset_key, material_id, title, canonical_url,
                          registry_status, source_evidence
                        ) VALUES (%s, %s, %s, %s, 'active', %s)
                        """,
                        (DATASET_KEY, value.material_id, value.title, value.url, _canonical_json(evidence)),
                    )
                    entity_id = int(cursor.lastrowid)
                except Exception as error:
                    if not _is_duplicate_key_error(error):
                        raise
                    # A writer outside this workflow may have won after our
                    # initial lookup.  Re-attest the canonical winner instead of
                    # surfacing a generic transaction failure.
                    entities = self._load_entities(cursor)
                    aliases = list(self._load_aliases(cursor))
                    recovered = resolver.resolve(candidate, entities, aliases)
                    if recovered.status != "matched" or recovered.content_entity_id is None:
                        raise RepositoryError("IDENTITY_COLLISION") from None
                    resolved[item_key] = int(recovered.content_entity_id)
                    continue
                for alias_type, alias_value, strength in _registry1_alias_values(candidate):
                    try:
                        cursor.execute(
                            """
                            INSERT INTO portal_content_registry_aliases (
                              dataset_key, content_entity_id, alias_type, alias_value,
                              alias_hash, uniqueness_scope, alias_status, source_evidence
                            ) VALUES (%s, %s, %s, %s, %s, %s, 'active', %s)
                            """,
                            (DATASET_KEY, entity_id, alias_type, alias_value, sha256_text(alias_value.casefold()), strength, _canonical_json(evidence)),
                        )
                    except Exception as error:
                        if not _is_duplicate_key_error(error):
                            raise
                        current_aliases = self._load_aliases(cursor)
                        matching = tuple(
                            alias for alias in current_aliases
                            if alias.alias_kind == alias_type
                            and alias.alias_value.casefold() == alias_value.casefold()
                        )
                        owned = tuple(
                            alias for alias in matching
                            if alias.content_entity_id == entity_id
                        )
                        if not owned or (
                            strength == "strong"
                            and any(alias.content_entity_id != entity_id for alias in matching)
                        ):
                            raise RepositoryError("IDENTITY_COLLISION") from None
                    aliases.append(IdentityAlias(entity_id, alias_type, alias_value, strength))
                entities = (*entities, CanonicalClassification(entity_id, value.title, value.url, None, None, None, "unknown", None))
                resolved[item_key] = entity_id
            connection.commit()
            return resolved
        except RepositoryError:
            ContentRegistryRepository._rollback(connection)
            raise
        except Exception:
            ContentRegistryRepository._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)

    def finalize_reconciliation_run(
        self, run_id: int, batch: BuiltApprovalBatch
    ) -> PersistedApprovalBatch:
        audited = ContentRegistryRepository._require_audited_batch(batch)
        if any(item.readiness_state == "ready" and item.content_entity_id is None for item in audited.items):
            raise RepositoryError("READY_ENTITY_REQUIRED")
        connection = cursor = None
        try:
            connection = self._connection_factory()
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT run_status, predecessor_snapshot_ids,
                       predecessor_snapshot_digests, taxonomy_version_id
                FROM portal_content_reconciliation_runs
                WHERE id = %s AND dataset_key = %s
                FOR UPDATE
                """,
                (int(run_id), DATASET_KEY),
            )
            run_row = cursor.fetchone()
            if run_row is None or str(run_row[0]) not in ("reconciled", "classified", "finalized"):
                raise RepositoryError("RECONCILIATION_STATUS_INVALID")
            if (
                tuple(_json_value(run_row[1])) != audited.source_snapshot_ids
                or tuple(_json_value(run_row[2])) != audited.source_snapshot_digests
            ):
                raise RepositoryError("BATCH_AUDIT_INCOMPLETE")
            taxonomy_id, taxonomy = ContentRegistryRepository._load_taxonomy(cursor, audited.taxonomy_version)
            if taxonomy_id != int(run_row[3]):
                raise RepositoryError("TAXONOMY_CONTRACT_MISMATCH")
            ContentRegistryRepository._attest_taxonomy(audited, taxonomy)
            cursor.execute(
                """
                SELECT id
                FROM portal_content_approval_batches
                WHERE reconciliation_run_id = %s
                FOR UPDATE
                """,
                (int(run_id),),
            )
            existing = cursor.fetchone()
            if existing is not None:
                batch_id = int(existing[0])
                connection.commit()
                persisted = self.load_persisted_batch(batch_id)
                if persisted.batch != batch:
                    raise RepositoryError("BATCH_HASH_MISMATCH")
                return persisted
            counts = ContentRegistryRepository._batch_counts(audited.items)
            cursor.execute(
                """
                INSERT INTO portal_content_approval_batches (
                  reconciliation_run_id, dataset_key, batch_key,
                  taxonomy_version_id, taxonomy_digest, source_snapshot_ids,
                  source_snapshot_digests, published_input_hash, batch_status,
                  prompt_version, model_routing_version, ready_count,
                  conflict_count, unresolved_count, rejected_count, no_change_count
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    int(run_id), DATASET_KEY, audited.batch_key, taxonomy_id,
                    audited.taxonomy_digest, _canonical_json(audited.source_snapshot_ids),
                    _canonical_json(audited.source_snapshot_digests),
                    audited.published_input_hash, audited.prompt_version,
                    audited.model_routing_version, counts["ready"], counts["conflict"],
                    counts["unresolved"], counts["rejected"], counts["no_change"],
                ),
            )
            batch_id = int(cursor.lastrowid)
            for item in audited.items:
                ContentRegistryRepository._ensure_item(cursor, batch_id, item)
            cursor.execute(
                """
                UPDATE portal_content_reconciliation_runs
                SET run_status = 'finalized', classified_at = COALESCE(classified_at, CURRENT_TIMESTAMP(6)),
                    finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP(6)), failure_code = NULL
                WHERE id = %s AND dataset_key = %s
                  AND run_status IN ('reconciled', 'classified')
                """,
                (int(run_id), DATASET_KEY),
            )
            if getattr(cursor, "rowcount", 1) != 1:
                raise RepositoryError("RECONCILIATION_STATUS_INVALID")
            connection.commit()
            return PersistedApprovalBatch(batch=audited, database_batch_id=batch_id)
        except RepositoryError:
            ContentRegistryRepository._rollback(connection)
            raise
        except Exception:
            ContentRegistryRepository._rollback(connection)
            raise RepositoryError("DB_TRANSACTION_FAILED") from None
        finally:
            ContentRegistryRepository._close(cursor, connection)


__all__ = ["MySqlWorkflowStore"]
