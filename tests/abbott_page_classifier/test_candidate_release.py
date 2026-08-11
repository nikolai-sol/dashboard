"""Task 8 successor content-release materialization contracts."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
import unittest
from unittest.mock import patch
import json
from collections.abc import Mapping

from agents.abbott_page_classifier import candidate_release
from agents.abbott_page_classifier.candidate_release import (
    CandidateCatalogRow,
    CandidateMaterializationError,
    CONTENT_CONTROL_VALUES,
    FACT_TOTAL_CONTROL_NAMES,
    GateReport,
    StrongUrlAlias,
    _database_datetime,
    _catalog_payload,
    _catalog_schema_gates,
    _authorize_current_batch_events,
    _load_catalog,
    _load_prior_accepted_event_rows,
    _load_lookup,
    _overlay_current_batch_events,
    _authorize_prior_accepted_events,
    _authorize_created_page_identities,
    build_lookup_projection,
    acknowledge_content_candidate_activation,
    materialize_content_candidate,
    reset_failed_content_candidate,
    validate_and_transition_content_candidate,
    validate_content_candidate,
)
from agents.abbott_page_classifier.approval_hashes import (
    compute_url_alias_decision_event_fingerprint,
)
from agents.abbott_page_classifier.batch_service import (
    ApprovalBatchItem,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_classification_event_fingerprint,
    compute_item_hash,
    compute_taxonomy_digest,
)
from agents.abbott_page_classifier.domain import ApprovalItem, ConflictCode
from agents.abbott_page_classifier.normalization import sha256_text


def plain_json(value):
    if isinstance(value, Mapping):
        return {str(key): plain_json(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain_json(item) for item in value]
    return value


TEST_TAXONOMY_TERMS = {
    "direction": ("cardiology", "gastroenterology"),
    "material_type": ("articles", "video"),
    "access": ("all", "doctors"),
    "lifecycle": ("active",),
}
TEST_TAXONOMY_DIGEST = compute_taxonomy_digest("abbott.v1", TEST_TAXONOMY_TERMS)
TEST_SOURCE_IDS = (11, 12)
TEST_SOURCE_DIGESTS = ("a" * 64, "b" * 64)


def audited_approval_item(
    entity_id: int,
    *,
    input_hash: str,
    title: str,
    url: str,
    finals: tuple[str, str, str, str],
    readiness_state: str,
    current_canonical: dict[str, object],
    registry1_values: dict[str, object] | None = None,
) -> ApprovalBatchItem:
    item = ApprovalBatchItem(
        content_entity_id=entity_id,
        input_hash=input_hash,
        title=title,
        url=url,
        final_direction_code=finals[0],
        final_material_type_code=finals[1],
        final_access_code=finals[2],
        final_lifecycle_code=finals[3],
        readiness_state=readiness_state,
        row_hash="",
        decision_reason=None,
        current_canonical=current_canonical,
        registry1_values=registry1_values,
        taxonomy_digest=TEST_TAXONOMY_DIGEST,
        taxonomy_terms=TEST_TAXONOMY_TERMS,
        source_snapshot_ids=TEST_SOURCE_IDS,
        source_snapshot_digests=TEST_SOURCE_DIGESTS,
        model_routing_version="routing.v1",
        prompt_version="prompt.v1",
    )
    return replace(item, row_hash=compute_item_hash(item))


def catalog_row(
    fingerprint: str,
    *,
    title: str = "Alpha",
    url: str = "https://abbottpro.ru/cardio/alpha",
    slug: str = "alpha",
    direction: str = "cardiology",
) -> CandidateCatalogRow:
    return CandidateCatalogRow(
        content_entity_id=1,
        normalized_url=url,
        normalized_url_hash="a" * 64,
        normalized_path="/cardio/alpha",
        page_title=title,
        material_id="100",
        material_type="articles",
        source_slug=slug,
        source_slug_hash="b" * 64,
        access_label="all",
        is_active=True,
        source_sheet="Кардиология",
        source_row_ordinal=7,
        source_row_fingerprint=fingerprint,
        section_key=None,
        direction_key=direction,
        published_at=None,
        valid_from="2026-08-05T10:00:00.000000+00:00",
        valid_to=None,
        classification_event_id=501,
        classification_event_fingerprint="c" * 64,
    )


class CandidateConnection:
    """Recording fake DB with query-shaped canonical rows and no external I/O."""

    def __init__(
        self,
        *,
        mismatch_catalog_hash: bool = False,
        mismatched_manifest: bool = False,
        corrupt_candidate_fact: bool = False,
        corrupt_candidate_import: bool = False,
        legacy_predecessor: bool = False,
        ambiguous_legacy_predecessor: bool = False,
        partial_smoke: bool = False,
        realistic_smoke: bool = False,
        dangling_selected_fingerprint: bool = False,
        expected_slug_group_loss: bool = False,
        joined_filter_gap: bool = False,
        combined_filter_gap: bool = False,
        unauthorized_event: bool = False,
        missing_authorized_event: bool = False,
        manager_direction_edit: bool = False,
        manager_material_access_edit: bool = False,
        mismatched_event_final: bool = False,
        corrupt_immutable_evidence: bool = False,
        corrupt_approval_row_hash: bool = False,
        corrupt_event_fingerprint: bool = False,
        spoof_effective_at: bool = False,
        batch_accepted_at: object = "2026-08-05T10:00:00.000000+00:00",
        orphan_event: bool = False,
        duplicate_event: bool = False,
        skipped_identity_conflict: bool = False,
        baseline_missing_direction: bool = False,
        candidate_status: str = "staging",
        create_observed_page: bool = False,
        tamper_created_identity: str | None = None,
    ):
        self.events: list[str] = []
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.closed = False
        self.lastrowid = 901
        self.rowcount = 1
        self._one = None
        self._many = []
        self.catalog_rows: list[tuple[object, ...]] = []
        self.lookup_rows: list[tuple[object, ...]] = []
        self.mismatch_catalog_hash = mismatch_catalog_hash
        self.snapshot_insert_count = 0
        self.batch_materialized = False
        self.baseline_manifest = None
        self.mismatched_manifest = mismatched_manifest
        self.corrupt_candidate_fact = corrupt_candidate_fact
        self.corrupt_candidate_import = corrupt_candidate_import
        self.legacy_predecessor = legacy_predecessor
        self.ambiguous_legacy_predecessor = ambiguous_legacy_predecessor
        self.partial_smoke = partial_smoke
        self.realistic_smoke = realistic_smoke
        self.dangling_selected_fingerprint = dangling_selected_fingerprint
        self.expected_slug_group_loss = expected_slug_group_loss
        self.joined_filter_gap = joined_filter_gap
        self.combined_filter_gap = combined_filter_gap
        self.unauthorized_event = unauthorized_event
        self.missing_authorized_event = missing_authorized_event
        self.manager_direction_edit = manager_direction_edit
        self.manager_material_access_edit = manager_material_access_edit
        self.mismatched_event_final = mismatched_event_final
        self.corrupt_immutable_evidence = corrupt_immutable_evidence
        self.corrupt_approval_row_hash = corrupt_approval_row_hash
        self.corrupt_event_fingerprint = corrupt_event_fingerprint
        self.spoof_effective_at = spoof_effective_at
        self.batch_accepted_at = batch_accepted_at
        self.orphan_event = orphan_event
        self.duplicate_event = duplicate_event
        self.skipped_identity_conflict = skipped_identity_conflict
        self.candidate_status = candidate_status
        self.create_observed_page = create_observed_page
        self.tamper_created_identity = tamper_created_identity
        self.snapshots = {
            11: {
                "id": 11,
                "source_kind": "abbott_workbook_json",
                "content_sha256": "a" * 64,
                "content_bytes": 100,
                "source_row_count": 2,
                "parser_version": "parser-v1",
                "import_status": "imported",
                "imported_row_count": 2,
                "rejected_row_count": 0,
                "manifest_json": "{}",
            },
            12: {
                "id": 12,
                "source_kind": "abbott_workbook_catalog",
                "content_sha256": "b" * 64,
                "content_bytes": 200,
                "source_row_count": 2,
                "parser_version": "parser-v1",
                "import_status": "imported",
                "imported_row_count": 2,
                "rejected_row_count": 0,
                "manifest_json": "{}",
            },
        }
        self.candidate_imports = []
        published_items = (
            audited_approval_item(
                1,
                input_hash="a" * 64,
                title="Alpha",
                url="https://abbottpro.ru/cardio/alpha",
                finals=("cardiology", "articles", "all", "active"),
                readiness_state="ready",
                current_canonical={
                    "access_code": "doctors",
                    "content_entity_id": 1,
                    "direction_code": (
                        None if baseline_missing_direction else "cardiology"
                    ),
                    "event_id": 300,
                    "lifecycle_code": "active",
                    "material_type_code": "articles",
                },
            ),
            audited_approval_item(
                2,
                input_hash="c" * 64,
                title="Beta",
                url="https://abbottpro.ru/gastro/beta",
                finals=("gastroenterology", "video", "doctors", "active"),
                readiness_state=(
                    "conflict" if skipped_identity_conflict else "no_change"
                ),
                current_canonical={
                    "access_code": "doctors",
                    "content_entity_id": 2,
                    "direction_code": "gastroenterology",
                    "event_id": 400,
                    "lifecycle_code": "active",
                    "material_type_code": "video",
                },
            ),
        )
        if skipped_identity_conflict:
            second = replace(
                published_items[1],
                conflict_codes=(ConflictCode.IDENTITY_COLLISION,),
                row_hash="",
            )
            published_items = (
                published_items[0],
                replace(second, row_hash=compute_item_hash(second)),
            )
        if create_observed_page:
            created = audited_approval_item(
                None,
                input_hash="e" * 64,
                title="Observed Gamma",
                url="https://www.abbottpro.ru/cardio/gamma",
                finals=("cardiology", "articles", "all", "active"),
                readiness_state="conflict",
                current_canonical=None,
                registry1_values={
                    "source_name": "observed_page",
                    "url": "https://www.abbottpro.ru/cardio/gamma",
                },
            )
            created = replace(
                created,
                conflict_codes=(ConflictCode.IDENTITY_COLLISION,),
                row_hash="",
            )
            published_items = (
                published_items[0],
                replace(created, row_hash=compute_item_hash(created)),
            )
        self.published_input_hash = compute_batch_hash(published_items)
        self.approval_rows = []
        for item_id, item in enumerate(published_items, start=101):
            self.approval_rows.append({
                "id": item_id,
                "content_entity_id": item.content_entity_id,
                "input_hash": item.input_hash,
                "title": item.title,
                "url": item.url,
                "final_direction_code": item.final_direction_code,
                "final_material_type_code": item.final_material_type_code,
                "final_access_code": item.final_access_code,
                "final_lifecycle_code": item.final_lifecycle_code,
                "readiness_state": item.readiness_state,
                "conflict_code": (
                    item.conflict_codes[0].value if item.conflict_codes else None
                ),
                "conflict_codes": json.dumps(
                    [code.value for code in item.conflict_codes]
                ),
                "row_hash": item.row_hash,
                "decision_reason": item.decision_reason,
                "proposal_evidence": plain_json(item.proposal_evidence),
                "selected_content_entity_id": None,
                "url_alias_decision": None,
            })
        if create_observed_page:
            self.approval_rows[1].update(
                selected_content_entity_id=900,
                url_alias_decision="create",
                decision_reason="reviewed observed canonical page",
            )
        if self.manager_direction_edit:
            self.approval_rows[0].update(
                final_direction_code="gastroenterology",
                decision_reason="manager correction",
            )
        if self.manager_material_access_edit:
            self.approval_rows[0].update(
                final_material_type_code="video",
                final_access_code="doctors",
                decision_reason="manager metadata edit",
            )
        if self.corrupt_immutable_evidence:
            self.approval_rows[0]["proposal_evidence"] = {
                **self.approval_rows[0]["proposal_evidence"],
                "concise_evidence": ["tampered after publication"],
            }
        if self.corrupt_approval_row_hash:
            self.approval_rows[0]["row_hash"] = "f" * 64
        approval_items = [
            ApprovalItem(
                content_entity_id=row["content_entity_id"],
                input_hash=row["input_hash"],
                title=row["title"],
                url=row["url"],
                final_direction_code=row["final_direction_code"],
                final_material_type_code=row["final_material_type_code"],
                final_access_code=row["final_access_code"],
                final_lifecycle_code=row["final_lifecycle_code"],
                readiness_state=row["readiness_state"],
                conflict_codes=tuple(
                    ConflictCode(code)
                    for code in json.loads(row["conflict_codes"])
                ),
                row_hash=row["row_hash"],
                decision_reason=row["decision_reason"],
                selected_content_entity_id=row.get("selected_content_entity_id"),
                url_alias_decision=row.get("url_alias_decision"),
            )
            for row in self.approval_rows
        ]
        self.accepted_hash = compute_accepted_decision_hash(approval_items)
        self.predecessor_catalog = [
            {
                "id": 1001,
                "normalized_url": "https://abbottpro.ru/cardio/alpha",
                "normalized_url_hash": sha256_text("https://abbottpro.ru/cardio/alpha"),
                "normalized_path": "/cardio/alpha",
                "page_title": "Alpha",
                "material_id": "100",
                "material_type": "Статьи",
                "source_slug": "alpha",
                "source_slug_hash": sha256_text("alpha"),
                "access_label": "Врачи",
                "is_active": 1,
                "source_sheet": "Кардиология [262338]",
                "source_row_ordinal": 7,
                "source_row_fingerprint": "1" * 64,
                "section_key": "cardio",
                "direction_key": "Кардиология [262338]",
                "published_at": datetime(2026, 7, 1),
                "valid_from": datetime(2026, 7, 1),
                "valid_to": None,
                "content_entity_id": 1,
                "classification_event_id": 300,
                "classification_event_fingerprint": "3" * 64,
                "projection_provenance_json": json.dumps(
                    {
                        "canonical_codes": {
                            "access": "doctors",
                            "direction": "cardiology",
                            "lifecycle": "active",
                            "material_type": "articles",
                        }
                    }
                ),
                "projection_row_hash": "4" * 64,
            },
            {
                "id": 1002,
                "normalized_url": "https://abbottpro.ru/gastro/beta",
                "normalized_url_hash": sha256_text("https://abbottpro.ru/gastro/beta"),
                "normalized_path": "/gastro/beta",
                "page_title": "Beta",
                "material_id": "200",
                "material_type": "Видео",
                "source_slug": "beta",
                "source_slug_hash": sha256_text("beta"),
                "access_label": "Врачи",
                "is_active": 1,
                "source_sheet": "Гастроэнтерология [262340]",
                "source_row_ordinal": 2,
                "source_row_fingerprint": "5" * 64,
                "section_key": "gastro",
                "direction_key": "Гастроэнтерология [262340]",
                "published_at": None,
                "valid_from": datetime(2026, 7, 1),
                "valid_to": None,
                "content_entity_id": 2,
                "classification_event_id": 400,
                "classification_event_fingerprint": "6" * 64,
                "projection_provenance_json": json.dumps(
                    {
                        "canonical_codes": {
                            "access": "doctors",
                            "direction": "gastroenterology",
                            "lifecycle": "active",
                            "material_type": "video",
                        }
                    }
                ),
                "projection_row_hash": "7" * 64,
            },
        ]
        if baseline_missing_direction:
            self.predecessor_catalog[0]["direction_key"] = "Не определено"
            provenance = json.loads(
                self.predecessor_catalog[0]["projection_provenance_json"]
            )
            provenance["canonical_codes"]["direction"] = "undetermined"
            self.predecessor_catalog[0]["projection_provenance_json"] = json.dumps(
                provenance
            )
        if self.legacy_predecessor:
            for row in self.predecessor_catalog:
                row.update(
                    content_entity_id=None,
                    classification_event_id=None,
                    classification_event_fingerprint=None,
                    projection_provenance_json=None,
                    projection_row_hash=None,
                )

    def cursor(self, **_kwargs):
        return self

    @staticmethod
    def _created_source_evidence(item, normalized_url):
        return {
            "authority": "local_observed_page_acceptance",
            "approval_batch_id": 71,
            "approval_item_id": 102,
            "actor": "content-manager",
            "row_hash": item["row_hash"],
            "provenance": [{
                "source_sheet": "local_observed_page",
                "source_row_ordinal": 102,
                "source_row_fingerprint": item["row_hash"],
                "canonical_url": normalized_url,
                "page_title": item["title"],
            }],
        }

    def start_transaction(self):
        self.events.append("start")

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.closed = True

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        params = tuple(params or ())
        placeholder_count = sql.count("%s")
        if placeholder_count != len(params):
            raise AssertionError(
                "MYSQL_PARAMETER_ARITY_MISMATCH: "
                f"placeholders={placeholder_count} params={len(params)} sql={normalized}"
            )
        self.calls.append((normalized, params))
        self._one = None
        self._many = []
        self._stream_many = False
        self.rowcount = 1
        if "FROM portal_data_releases AS candidate" in normalized:
            self._one = {
                "id": 41,
                "release_status": self.candidate_status,
                "baseline_validation_run_id": 902,
                "rollback_from_release_id": 12,
                "source_snapshot_ids": "[11, 901]",
            }
        elif "FROM portal_active_data_releases AS active" in normalized:
            self._one = {
                "canonical_release_id": 12,
                "baseline_validation_run_id": 33,
                "source_snapshot_ids": "[11, 12]",
                "release_status": "active",
            }
        elif "FROM portal_content_approval_batches AS batch" in normalized:
            self._one = {
                "id": 71,
                "batch_status": "candidate_materialized" if self.batch_materialized else "ingested",
                "activation_status": "candidate" if self.batch_materialized else "pending",
                "candidate_release_id": 41 if self.batch_materialized else None,
                "accepted_decision_hash": self.accepted_hash,
                "accepted_count": 2 if self.create_observed_page else 1,
                "ready_count": 1,
                "conflict_count": 1 if (self.skipped_identity_conflict or self.create_observed_page) else 0,
                "unresolved_count": 0,
                "rejected_count": 0,
                "no_change_count": 0 if (self.skipped_identity_conflict or self.create_observed_page) else 1,
                "taxonomy_version_id": 5,
                "taxonomy_version": "abbott.v1",
                "taxonomy_digest": TEST_TAXONOMY_DIGEST,
                "published_input_hash": self.published_input_hash,
                "prompt_version": "prompt.v1",
                "model_routing_version": "routing.v1",
                "accepted_by": "content-manager",
                "accepted_at": self.batch_accepted_at,
                "source_snapshot_ids": "[11, 12]",
                "source_snapshot_digests": json.dumps(["a" * 64, "b" * 64]),
            }
        elif "FROM portal_content_approval_items AS item" in normalized and "item.row_hash" in normalized:
            self._many = list(self.approval_rows)
        elif "strong_collision_count" in normalized:
            self._one = {"strong_collision_count": 0}
        elif "url_event.url_alias_decision = 'create'" in normalized:
            if self.create_observed_page:
                item = self.approval_rows[1]
                normalized_url = "https://abbottpro.ru/cardio/gamma"
                alias_hash = sha256_text(normalized_url)
                source_evidence = {
                    "authority": "local_observed_page_acceptance",
                    "approval_batch_id": 71,
                    "approval_item_id": 102,
                    "actor": "content-manager",
                    "row_hash": item["row_hash"],
                    "provenance": [{
                        "source_sheet": "local_observed_page",
                        "source_row_ordinal": 102,
                        "source_row_fingerprint": item["row_hash"],
                        "canonical_url": normalized_url,
                        "page_title": item["title"],
                    }],
                }
                fingerprint = compute_url_alias_decision_event_fingerprint(
                    accepted_decision_hash=self.accepted_hash,
                    actor="content-manager", approval_batch_id=71,
                    approval_item_id=102,
                    decision_reason=item["decision_reason"],
                    normalized_url=normalized_url,
                    selected_content_entity_id=900,
                    selected_predecessor_event_fingerprint=None,
                    selected_predecessor_event_id=None,
                    url_alias_decision="create",
                )
                self.created_url_event_fingerprint = fingerprint
                rows = []
                for alias_type in ("canonical_url", "url"):
                    row = {
                        "approval_item_id": 102, "entity_id": 900,
                        "entity_title": item["title"], "entity_material_id": None,
                        "entity_canonical_url": normalized_url,
                        "entity_status": "active",
                        "entity_source_evidence": source_evidence,
                        "alias_entity_id": 900, "alias_type": alias_type,
                        "alias_value": normalized_url, "alias_hash": alias_hash,
                        "alias_uniqueness_scope": "strong", "alias_status": "active",
                        "alias_source_evidence": source_evidence,
                        "url_event_batch_id": 71, "url_event_item_id": 102,
                        "url_event_accepted_hash": self.accepted_hash,
                        "url_event_actor": "content-manager",
                        "url_event_reason": item["decision_reason"],
                        "url_event_normalized_url": normalized_url,
                        "url_event_decision": "create",
                        "url_event_selected_entity_id": 900,
                        "url_event_predecessor_id": None,
                        "url_event_predecessor_fingerprint": None,
                        "url_event_fingerprint": fingerprint,
                    }
                    if self.tamper_created_identity == "alias_hash" and alias_type == "url":
                        row["alias_hash"] = "0" * 64
                    if self.tamper_created_identity == "accepted_hash":
                        row["url_event_accepted_hash"] = "0" * 64
                    if self.tamper_created_identity == "entity_title":
                        row["entity_title"] = "Tampered title"
                    if self.tamper_created_identity == "material_id":
                        row["entity_material_id"] = "unexpected"
                    if self.tamper_created_identity in {
                        "source_sheet", "source_row_ordinal", "page_title"
                    }:
                        changed = plain_json(source_evidence)
                        key = self.tamper_created_identity
                        changed["provenance"][0][key] = (
                            "tampered" if key != "source_row_ordinal" else 999
                        )
                        row["entity_source_evidence"] = changed
                        row["alias_source_evidence"] = changed
                    if self.tamper_created_identity == "alias_evidence":
                        changed = plain_json(source_evidence)
                        changed["actor"] = "tampered"
                        row["alias_source_evidence"] = changed
                    rows.append(row)
                self._many = rows
        elif "legacy_catalog.id AS predecessor_catalog_row_id" in normalized:
            self._many = [
                {
                    "predecessor_catalog_row_id": 1001,
                    "content_entity_id": 1,
                    "direction_label": "Кардиология [262338]",
                    "material_type_label": "Статьи",
                    "access_label": "Врачи",
                    "is_active": 1,
                },
                {
                    "predecessor_catalog_row_id": 1002,
                    "content_entity_id": 2,
                    "direction_label": "Гастроэнтерология [262340]",
                    "material_type_label": "Видео",
                    "access_label": "Врачи",
                    "is_active": 1,
                },
            ]
            if self.ambiguous_legacy_predecessor:
                self._many.append(
                    {
                        **self._many[0],
                        "content_entity_id": 99,
                        "alias_type": "canonical_url",
                    }
                )
        elif "FROM portal_content_catalog AS predecessor_catalog" in normalized:
            self._many = list(self.predecessor_catalog)
        elif (
            "WITH latest_events AS" not in normalized
            and "FROM portal_content_classification_events AS event" in normalized
            and "event.approval_batch_id = %s" in normalized
        ):
            accepted_item = self.approval_rows[0]
            event_direction = accepted_item["final_direction_code"]
            if self.mismatched_event_final:
                event_direction = (
                    "cardiology"
                    if event_direction == "gastroenterology"
                    else "gastroenterology"
                )
            event_evidence = {
                "accepted_decision_hash": (
                    "0" * 64 if self.unauthorized_event else self.accepted_hash
                ),
                "approval_item_evidence": accepted_item["proposal_evidence"],
                "row_hash": accepted_item["row_hash"],
            }
            event_row = {
                    "authorized_entity_id": 1,
                    "content_entity_id": 1,
                    "approval_item_id": 999 if self.orphan_event else 101,
                    "taxonomy_version_id": 5,
                    "material_id": "100",
                    "title": "Alpha",
                    "canonical_url": "https://abbottpro.ru/cardio/alpha/",
                    "source_evidence": {
                        "provenance": [
                            {
                                "source_name": "registry1",
                                "source_sheet": "Кардиология [262338]",
                                "source_row_ordinal": 7,
                                "source_fingerprint": "1" * 64,
                                "title": "Source Alpha",
                                "url": "https://abbottpro.ru/cardio/source-alpha/",
                                "material_id": "source-100",
                                "source_slug": "source-alpha",
                                "section_key": "cardio",
                                "published_at": "2026-07-31 09:00:00",
                            }
                        ]
                    },
                    "classification_event_id": 501,
                    "direction_code": event_direction,
                    "material_type_code": accepted_item["final_material_type_code"],
                    "access_code": accepted_item["final_access_code"],
                    "lifecycle_code": accepted_item["final_lifecycle_code"],
                    "event_kind": "correct" if self.manager_direction_edit else "approve",
                    "event_fingerprint": "2" * 64,
                    "approval_batch_id": 71,
                    "predecessor_event_id": 300,
                    "actor": "content-manager",
                    "reason": accepted_item["decision_reason"],
                    "proposal_evidence": event_evidence,
                    "effective_at": datetime(
                        2026, 8, 5, 11 if self.spoof_effective_at else 10, 0, 0
                    ),
                    "direction_label": (
                        "Гастроэнтерология [262340]"
                        if event_direction == "gastroenterology"
                        else "Кардиология [262338]"
                    ),
                    "material_type_label": (
                        "Видео"
                        if accepted_item["final_material_type_code"] == "video"
                        else "Статьи"
                    ),
                    "access_label": (
                        "Врачи"
                        if accepted_item["final_access_code"] == "doctors"
                        else "Все"
                    ),
                    "lifecycle_label": "active",
                }
            event_row["event_fingerprint"] = compute_classification_event_fingerprint(
                {
                    "access_code": event_row["access_code"],
                    "actor": event_row["actor"],
                    "approval_batch_id": event_row["approval_batch_id"],
                    "approval_item_id": event_row["approval_item_id"],
                    "content_entity_id": event_row["content_entity_id"],
                    "direction_code": event_row["direction_code"],
                    "effective_at": event_row["effective_at"].isoformat(
                        timespec="microseconds"
                    ),
                    "event_kind": event_row["event_kind"],
                    "lifecycle_code": event_row["lifecycle_code"],
                    "material_type_code": event_row["material_type_code"],
                    "predecessor_event_id": event_row["predecessor_event_id"],
                    "proposal_evidence": event_row["proposal_evidence"],
                    "reason": event_row["reason"],
                    "taxonomy_version_id": event_row["taxonomy_version_id"],
                }
            )
            if self.corrupt_event_fingerprint:
                event_row["event_fingerprint"] = "0" * 64
            self._many = [] if self.missing_authorized_event else [event_row]
            if self.create_observed_page:
                item = self.approval_rows[1]
                normalized_url = "https://abbottpro.ru/cardio/gamma"
                event_evidence = {
                    "accepted_decision_hash": self.accepted_hash,
                    "approval_item_evidence": item["proposal_evidence"],
                    "canonical_classification": {
                        "access_code": item["final_access_code"],
                        "direction_code": item["final_direction_code"],
                        "lifecycle_code": item["final_lifecycle_code"],
                        "material_type_code": item["final_material_type_code"],
                    },
                    "created_identity": {
                        "alias_hash": sha256_text(normalized_url),
                        "normalized_url": normalized_url,
                        "selected_content_entity_id": 900,
                        "url_alias_decision": "create",
                        "url_decision_event_fingerprint": self.created_url_event_fingerprint,
                    },
                    "row_hash": item["row_hash"],
                }
                created_event = {
                    "authorized_entity_id": 900, "content_entity_id": 900,
                    "material_id": None, "title": item["title"],
                    "canonical_url": normalized_url,
                    "source_evidence": self._created_source_evidence(item, normalized_url),
                    "classification_event_id": 502,
                    "direction_code": item["final_direction_code"],
                    "material_type_code": item["final_material_type_code"],
                    "access_code": item["final_access_code"],
                    "lifecycle_code": item["final_lifecycle_code"],
                    "event_kind": "approve", "approval_batch_id": 71,
                    "approval_item_id": 102, "taxonomy_version_id": 5,
                    "predecessor_event_id": None, "proposal_evidence": event_evidence,
                    "actor": "content-manager", "reason": item["decision_reason"],
                    "effective_at": datetime(2026, 8, 5, 10, 0),
                    "direction_label": "Кардиология [262338]",
                    "material_type_label": "Статьи", "access_label": "Все",
                    "lifecycle_label": "active",
                }
                created_event["event_fingerprint"] = compute_classification_event_fingerprint({
                    "access_code": created_event["access_code"], "actor": created_event["actor"],
                    "approval_batch_id": 71, "approval_item_id": 102,
                    "content_entity_id": 900, "direction_code": created_event["direction_code"],
                    "effective_at": created_event["effective_at"].isoformat(timespec="microseconds"),
                    "event_kind": "approve", "lifecycle_code": created_event["lifecycle_code"],
                    "material_type_code": created_event["material_type_code"],
                    "predecessor_event_id": None, "proposal_evidence": event_evidence,
                    "reason": created_event["reason"], "taxonomy_version_id": 5,
                })
                self._many.append(created_event)
            if self.duplicate_event:
                self._many.append({**event_row, "classification_event_id": 502})
        elif "source_kind = 'abbott_canonical_control_pack'" in normalized:
            baseline_id = int(params[-1])
            if baseline_id == 902 and self.baseline_manifest is not None:
                manifest_json = self.baseline_manifest
                self._one = {
                    "id": 902,
                    "content_sha256": (
                        "0" * 64 if self.mismatched_manifest else sha256_text(manifest_json)
                    ),
                    "content_bytes": len(manifest_json.encode("utf-8")),
                    "source_row_count": 12,
                    "parser_version": "abbott-content-control-v1",
                    "import_status": "imported",
                    "imported_row_count": 12,
                    "rejected_row_count": 0,
                    "manifest_json": manifest_json,
                }
            else:
                self._one = {
                    "manifest_json": json.dumps(
                        {
                            "control_values": {"site.traffic.sessions": 100},
                            "file_snapshots": [],
                        }
                    )
                }
        elif "FROM portal_dataset_snapshots" in normalized and "id IN" in normalized:
            requested_ids = [int(value) for value in params[1:]]
            self._many = [self.snapshots[value] for value in sorted(requested_ids)]
        elif normalized.startswith("SELECT source_snapshot_id, source_kind"):
            release_id = int(params[0])
            predecessor_imports = [
                {
                    "source_snapshot_id": 11,
                    "source_kind": "abbott_workbook_json",
                    "imported_row_count": 2,
                    "rejected_row_count": 0,
                    "import_status": "imported",
                    "code_revision": "oldrev1",
                },
                {
                    "source_snapshot_id": 12,
                    "source_kind": "abbott_workbook_catalog",
                    "imported_row_count": 2,
                    "rejected_row_count": 0,
                    "import_status": "imported",
                    "code_revision": "oldrev1",
                },
            ]
            self._many = (
                list(self.candidate_imports)
                if release_id == 41
                else predecessor_imports
            )
            if self.corrupt_candidate_import and release_id == 41 and self._many:
                self._many[0] = {**self._many[0], "imported_row_count": 999}
        elif normalized.startswith("SELECT taxonomy_kind, term_code, term_label"):
            if "is_active" in normalized:
                raise AssertionError("UNKNOWN_COLUMN: portal_content_taxonomy_terms.is_active")
            self._many = [
                {"taxonomy_kind": "direction", "term_code": "cardiology", "term_label": "Кардиология [262338]"},
                {"taxonomy_kind": "direction", "term_code": "gastroenterology", "term_label": "Гастроэнтерология [262340]"},
                {"taxonomy_kind": "material_type", "term_code": "articles", "term_label": "Статьи"},
                {"taxonomy_kind": "material_type", "term_code": "video", "term_label": "Видео"},
                {"taxonomy_kind": "access", "term_code": "all", "term_label": "Все"},
                {"taxonomy_kind": "access", "term_code": "doctors", "term_label": "Врачи"},
                {"taxonomy_kind": "lifecycle", "term_code": "active", "term_label": "active"},
            ]
        elif normalized.startswith("SELECT content_entity_id, alias_type, alias_value"):
            self._many = ([
                (900, "canonical_url", "https://abbottpro.ru/cardio/gamma"),
                (900, "url", "https://abbottpro.ru/cardio/gamma"),
            ] if self.create_observed_page else [])
        elif "AS lookup_consistency_failures" in normalized:
            self._one = {
                "lookup_group_count": 4 if self.realistic_smoke else 6,
                "lookup_consistency_failures": 1 if (
                    self.partial_smoke or self.dangling_selected_fingerprint
                ) else 0,
                "dangling_selected_count": 1 if self.dangling_selected_fingerprint else 0,
                "title_group_count": 2,
                "slug_group_count": 0 if self.realistic_smoke else 2,
                "path_group_count": 2,
                "url_group_count": 2,
            }
        elif "AS expected_slug_group_count" in normalized:
            expected = 0 if self.realistic_smoke else 2
            self._one = {
                "expected_slug_group_count": expected,
                "projected_slug_group_count": (
                    max(expected - 1, 0) if self.expected_slug_group_loss else expected
                ),
            }
        elif "AS joined_projection_rows" in normalized:
            joined = 3 if self.realistic_smoke else 2
            complete = joined - 1 if self.joined_filter_gap else joined
            self._one = {
                "joined_projection_rows": joined,
                "joined_direction_rows": complete,
                "joined_material_rows": complete,
                "joined_access_rows": complete,
            }
        elif normalized.startswith(
            "SELECT selected_catalog.direction_key, selected_catalog.material_type"
        ):
            self._one = {
                "direction_key": "cardio",
                "material_type": "articles",
                "access_label": "all",
            }
        elif "AS combined_projection_rows" in normalized:
            self._one = {
                "combined_projection_rows": 1,
                "combined_catalog_rows": 0 if self.combined_filter_gap else 1,
            }
        elif "AS candidate_catalog_rows" in normalized:
            self._one = {
                "candidate_catalog_rows": 3 if self.realistic_smoke else 2,
                "direction_rows": 3 if self.realistic_smoke else 2,
                "material_rows": 3 if self.realistic_smoke else 2,
                "access_rows": 3 if self.realistic_smoke else 2,
            }
        elif normalized.startswith("SELECT ") and " WHERE canonical_release_id = %s ORDER BY " in normalized:
            column_sql, table = normalized.split(" FROM ", 1)
            columns = [value.strip() for value in column_sql.removeprefix("SELECT ").split(",")]
            table = table.split(" WHERE ", 1)[0]
            release_id = int(params[0])
            self._many = [{column: f"{table}:{column}" for column in columns}]
            if self.corrupt_candidate_fact and release_id == 41:
                self._many[0][columns[0]] = "corrupted"
            self._stream_many = True
        elif normalized.startswith("INSERT INTO portal_dataset_snapshots"):
            self.snapshot_insert_count += 1
            self.lastrowid = 900 + self.snapshot_insert_count
            if self.snapshot_insert_count == 1:
                self.snapshots[self.lastrowid] = {
                    "id": self.lastrowid,
                    "source_kind": params[1],
                    "content_sha256": params[3],
                    "content_bytes": params[4],
                    "source_row_count": params[5],
                    "parser_version": params[6],
                    "import_status": "imported",
                    "imported_row_count": params[7],
                    "rejected_row_count": 0,
                    "manifest_json": params[-1],
                }
            else:
                self.baseline_manifest = params[-1]
        elif normalized.startswith("INSERT INTO portal_release_source_imports"):
            self.candidate_imports.append(
                {
                    "source_snapshot_id": params[1],
                    "source_kind": params[2],
                    "imported_row_count": params[4],
                    "rejected_row_count": params[5] if len(params) == 6 else 0,
                    "import_status": "imported",
                    "code_revision": params[3],
                }
            )
        elif normalized.startswith("INSERT INTO portal_content_catalog"):
            self.catalog_rows.append(params)
        elif normalized.startswith("INSERT INTO portal_content_lookup_projection"):
            self.lookup_rows.append(params)
        elif normalized.startswith("SELECT id, normalized_url, normalized_url_hash"):
            self._many = list(self.predecessor_catalog)
        elif normalized.startswith("SELECT normalized_url, normalized_url_hash"):
            names = (
                "normalized_url", "normalized_url_hash", "normalized_path", "page_title", "material_id",
                "material_type", "source_slug", "source_slug_hash", "access_label",
                "is_active", "source_sheet", "source_row_ordinal",
                "source_row_fingerprint", "section_key", "direction_key",
                "published_at", "valid_from", "valid_to",
                "content_entity_id", "classification_event_id",
                "classification_event_fingerprint", "projection_provenance_json",
                "projection_row_hash",
            )
            self._many = [dict(zip(names, row[2:])) for row in self.catalog_rows]
            if self.mismatch_catalog_hash and self._many:
                self._many[0] = {**self._many[0], "normalized_path": "tampered"}
        elif normalized.startswith("SELECT lookup_kind, lookup_key_hash"):
            names = (
                "lookup_kind", "lookup_key_hash", "candidate_count",
                "metadata_signature_count", "resolution_status",
                "selected_source_row_fingerprint", "group_fingerprint",
            )
            self._many = [dict(zip(names, row[2:])) for row in self.lookup_rows]
        elif normalized.startswith("INSERT INTO") and " SELECT %s" in normalized:
            self.rowcount = 1
        elif normalized.startswith("UPDATE portal_content_approval_batches"):
            self.rowcount = 1
            self.batch_materialized = True

    def fetchone(self):
        return self._one

    def fetchall(self):
        if getattr(self, "_stream_many", False):
            raise AssertionError("non-content reads must stream with fetchmany")
        return list(self._many)

    def fetchmany(self, _size=1):
        rows, self._many = list(self._many), []
        return rows


class GateConnection(CandidateConnection):
    pass


class ValidationTransitionCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []
        self.rowcount = 0

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.connection.calls.append((normalized, tuple(params or ())))
        self.rows = []
        self.rowcount = 0
        if normalized.startswith("SELECT baseline_validation_run_id"):
            self.rows = [{
                "baseline_validation_run_id": 902,
                "code_revision": "abc1234",
                "release_status": "staging",
            }]
        elif normalized.startswith("INSERT INTO portal_migration_validation_runs"):
            self.rowcount = 1
        elif normalized.startswith("UPDATE portal_data_releases"):
            self.rowcount = 1

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def close(self):
        pass


class ValidationTransitionConnection:
    def __init__(self):
        self.calls = []
        self.events = []
        self.cursor_instance = ValidationTransitionCursor(self)

    def start_transaction(self):
        self.events.append("start")

    def cursor(self, **_kwargs):
        return self.cursor_instance

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.events.append("close")


class ProductionValidationConnection(CandidateConnection):
    """SQL-shaped canonical fixture for the real content validation boundary.

    It exposes aggregate facts only.  In particular it has no private-visit,
    raw-user, or raw-client fields to accidentally make validation depend on.
    """

    def __init__(
        self,
        *,
        candidate_pageview_delta: int = 0,
        content_unresolved: int = 0,
        non_content_unresolved: int = 0,
        reviewed_exclusion_event: dict[str, object] | None = None,
    ):
        super().__init__()
        self.candidate_pageview_delta = candidate_pageview_delta
        self.content_unresolved = content_unresolved
        self.non_content_unresolved = non_content_unresolved
        self.reviewed_exclusion_event = reviewed_exclusion_event
        self.validation_evidence = []
        self.release_status = "staging"

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        params = tuple(params or ())
        if "COALESCE(SUM(" in normalized and "AS total" in normalized:
            self.calls.append((normalized, params))
            self._many = []
            self._stream_many = False
            self.rowcount = 0
            self._one = {
                "total": 100 + self.candidate_pageview_delta if (
                    int(params[0]) == 41
                    and "SUM(pageviews)" in normalized
                    and params[-2:] == ("2026-07-01", "2026-07-31")
                ) else 100
            }
            return
        if "AS content_unresolved" in normalized:
            self.calls.append((normalized, params))
            self._many = []
            self._stream_many = False
            self.rowcount = 0
            self._one = {
                "content_unresolved": self.content_unresolved,
                "non_content_unresolved": self.non_content_unresolved,
            }
            return
        if "FROM portal_content_url_alias_decision_events AS exclusion" in normalized:
            self.calls.append((normalized, params))
            self._one = None
            self._many = (
                [self.reviewed_exclusion_event]
                if self.reviewed_exclusion_event is not None else []
            )
            self._stream_many = False
            self.rowcount = 0
            return
        if normalized.startswith("SELECT baseline_validation_run_id"):
            self.calls.append((normalized, params))
            self._many = []
            self._stream_many = False
            self.rowcount = 0
            self._one = {
                "baseline_validation_run_id": 902,
                "code_revision": "abc1234",
                "release_status": self.release_status,
            }
            return
        if normalized.startswith("INSERT INTO portal_migration_validation_runs"):
            self.calls.append((normalized, params))
            self.validation_evidence.append(params)
            self.rowcount = 1
            self._one = None
            self._many = []
            return
        if (
            normalized.startswith("UPDATE portal_data_releases")
            and "SET release_status = 'validated'" in normalized
        ):
            self.calls.append((normalized, params))
            self.release_status = "validated"
            self.rowcount = 1
            self._one = None
            self._many = []
            return
        super().execute(sql, params)


class FailedCandidateResetConnection:
    def __init__(
        self,
        *,
        active_release_id=14,
        candidate_status="failed",
        candidate_predecessor=14,
        batch_status="candidate_materialized",
        batch_candidate_release_id=23,
        activation_status="candidate",
    ):
        self.active_release_id = active_release_id
        self.candidate_status = candidate_status
        self.candidate_predecessor = candidate_predecessor
        self.batch_status = batch_status
        self.batch_candidate_release_id = batch_candidate_release_id
        self.activation_status = activation_status
        self.events = []
        self.calls = []
        self._one = None
        self.rowcount = 1

    def cursor(self, **_kwargs):
        return self

    def start_transaction(self):
        self.events.append("start")

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")

    def close(self):
        self.events.append("close")

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        params = tuple(params or ())
        self.calls.append((normalized, params))
        self._one = None
        self.rowcount = 1
        if "FROM portal_active_data_releases" in normalized:
            self._one = {"canonical_release_id": self.active_release_id}
        elif "FROM portal_data_releases" in normalized:
            self._one = {
                "id": 23,
                "release_status": self.candidate_status,
                "rollback_from_release_id": self.candidate_predecessor,
            }
        elif "FROM portal_content_approval_batches" in normalized:
            self._one = {
                "id": 2,
                "batch_status": self.batch_status,
                "candidate_release_id": self.batch_candidate_release_id,
                "activation_status": self.activation_status,
                "accepted_decision_hash": "a" * 64,
                "accepted_at": datetime(2026, 8, 8),
            }
        elif normalized.startswith("UPDATE portal_content_approval_batches"):
            self.batch_status = "ingested"
            self.batch_candidate_release_id = None
            self.activation_status = "not_started"

    def fetchone(self):
        return self._one


class CandidateReleaseTest(unittest.TestCase):
    def test_prior_event_loader_excludes_entities_superseded_by_current_batch(self):
        class Cursor:
            def execute(self, sql, params):
                self.sql = " ".join(sql.split())
                self.params = params

            def fetchall(self):
                return ()

        cursor = Cursor()

        self.assertEqual(_load_prior_accepted_event_rows(cursor, 11), ())
        self.assertIn("NOT EXISTS", cursor.sql)
        self.assertIn(
            "current_event.content_entity_id = event.content_entity_id",
            cursor.sql,
        )
        self.assertEqual(cursor.params, ("abbott", 11, 11, "abbott"))

    def test_authorizes_reviewed_baseline_attach_without_prior_event(self):
        accepted_at = datetime(2026, 8, 11, 12, 0, 0)
        accepted_hash = "a" * 64
        row_hash = "b" * 64
        item_evidence = {
            "current_canonical": {
                "content_entity_id": 41,
                "event_id": None,
                "direction_code": "undetermined",
                "material_type_code": "service_page",
                "access_code": "unspecified",
                "lifecycle_code": "active",
            }
        }
        item = {
            "content_entity_id": 41,
            "selected_content_entity_id": 41,
            "url_alias_decision": "attach",
            "readiness_state": "unresolved",
            "decision_reason": "reviewed observed URL for current entity",
            "final_direction_code": "cardiology",
            "final_material_type_code": "articles",
            "final_access_code": "all",
            "final_lifecycle_code": "active",
            "proposal_evidence": item_evidence,
            "row_hash": row_hash,
        }
        event_evidence = {
            "accepted_decision_hash": accepted_hash,
            "approval_item_evidence": item_evidence,
            "row_hash": row_hash,
        }
        event = {
            "approval_batch_id": 10,
            "approval_item_id": 101,
            "content_entity_id": 41,
            "authorized_entity_id": 41,
            "taxonomy_version_id": 5,
            "direction_code": "cardiology",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "event_kind": "approve",
            "predecessor_event_id": None,
            "proposal_evidence": event_evidence,
            "actor": "content-manager",
            "reason": "reviewed observed URL for current entity",
            "effective_at": accepted_at,
            "direction_label": "Cardiology",
            "material_type_label": "Articles",
            "access_label": "All",
            "lifecycle_label": "Active",
        }
        event["event_fingerprint"] = compute_classification_event_fingerprint({
            "access_code": "all",
            "actor": "content-manager",
            "approval_batch_id": 10,
            "approval_item_id": 101,
            "content_entity_id": 41,
            "direction_code": "cardiology",
            "effective_at": accepted_at.isoformat(timespec="microseconds"),
            "event_kind": "approve",
            "lifecycle_code": "active",
            "material_type_code": "articles",
            "predecessor_event_id": None,
            "proposal_evidence": event_evidence,
            "reason": "reviewed observed URL for current entity",
            "taxonomy_version_id": 5,
        })

        _authorize_current_batch_events(
            (event,),
            {101: item},
            {
                "id": 10,
                "taxonomy_version_id": 5,
                "accepted_decision_hash": accepted_hash,
                "accepted_by": "content-manager",
                "accepted_at": accepted_at,
                "projection_kind": "local",
            },
            (),
        )

    def test_ignores_reviewed_attach_that_already_has_classification_event(self):
        item = {
            "content_entity_id": 41,
            "selected_content_entity_id": 41,
            "url_alias_decision": "attach",
            "readiness_state": "unresolved",
            "decision_reason": "reviewed observed URL for current entity",
            "final_direction_code": "cardiology",
            "final_material_type_code": "articles",
            "final_access_code": "all",
            "final_lifecycle_code": "active",
            "proposal_evidence": {
                "current_canonical": {
                    "content_entity_id": 41,
                    "event_id": 700,
                    "direction_code": "cardiology",
                    "material_type_code": "articles",
                    "access_code": "all",
                    "lifecycle_code": "active",
                }
            },
            "row_hash": "b" * 64,
        }

        _authorize_current_batch_events(
            (),
            {101: item},
            {
                "id": 10,
                "taxonomy_version_id": 5,
                "accepted_decision_hash": "a" * 64,
                "accepted_by": "content-manager",
                "accepted_at": datetime(2026, 8, 11, 12, 0, 0),
                "projection_kind": "local",
            },
            (),
        )

    def test_authorizes_local_catalog_gap_correction_without_active_catalog_row(self):
        accepted_at = datetime(2026, 8, 11, 13, 0, 0)
        item_evidence = {
            "current_canonical": {
                "content_entity_id": 41,
                "event_id": 700,
                "direction_code": None,
                "material_type_code": None,
                "access_code": "unspecified",
                "lifecycle_code": "active",
            }
        }
        item = {
            "content_entity_id": 41,
            "selected_content_entity_id": None,
            "url_alias_decision": None,
            "readiness_state": "conflict",
            "decision_reason": "reviewed classification for catalog gap",
            "final_direction_code": "diabetes_management",
            "final_material_type_code": "articles",
            "final_access_code": "all",
            "final_lifecycle_code": "active",
            "proposal_evidence": item_evidence,
            "row_hash": "b" * 64,
        }
        event_evidence = {
            "accepted_decision_hash": "a" * 64,
            "approval_item_evidence": item_evidence,
            "row_hash": "b" * 64,
        }
        event = {
            "approval_batch_id": 11,
            "approval_item_id": 101,
            "content_entity_id": 41,
            "authorized_entity_id": 41,
            "taxonomy_version_id": 5,
            "direction_code": "diabetes_management",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "event_kind": "approve",
            "predecessor_event_id": 700,
            "proposal_evidence": event_evidence,
            "actor": "content-manager",
            "reason": "reviewed classification for catalog gap",
            "effective_at": accepted_at,
            "direction_label": "Управление сахарным диабетом",
            "material_type_label": "Статьи",
            "access_label": "Все",
            "lifecycle_label": "active",
        }
        event["event_fingerprint"] = compute_classification_event_fingerprint({
            "access_code": "all",
            "actor": "content-manager",
            "approval_batch_id": 11,
            "approval_item_id": 101,
            "content_entity_id": 41,
            "direction_code": "diabetes_management",
            "effective_at": accepted_at.isoformat(timespec="microseconds"),
            "event_kind": "approve",
            "lifecycle_code": "active",
            "material_type_code": "articles",
            "predecessor_event_id": 700,
            "proposal_evidence": event_evidence,
            "reason": "reviewed classification for catalog gap",
            "taxonomy_version_id": 5,
        })

        _authorize_current_batch_events(
            (event,),
            {101: item},
            {
                "id": 11,
                "taxonomy_version_id": 5,
                "accepted_decision_hash": "a" * 64,
                "accepted_by": "content-manager",
                "accepted_at": accepted_at,
                "projection_kind": "local",
            },
            (),
        )

    def test_lookup_preserves_distinct_semantic_query_aliases(self):
        row = replace(
            catalog_row("1" * 64),
            normalized_url="https://abbottpro.ru/cardio/alpha?view=doctor",
        )
        lookup = build_lookup_projection(
            (row,),
            strong_aliases=(
                {
                    "content_entity_id": row.content_entity_id,
                    "alias_type": "url",
                    "alias_value": "https://abbottpro.ru/cardio/alpha?view=patient",
                },
            ),
        )

        url_rows = [item for item in lookup if item.lookup_kind == "url"]
        self.assertEqual(len(url_rows), 2)
        self.assertEqual(
            {item.lookup_key_hash for item in url_rows},
            {
                sha256_text("https://abbottpro.ru/cardio/alpha?view=doctor"),
                sha256_text("https://abbottpro.ru/cardio/alpha?view=patient"),
            },
        )

    def test_materializer_create_adds_catalog_row_and_unique_url_lookup(self):
        connection = CandidateConnection(create_observed_page=True)
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        self.assertEqual(result.catalog_row_count, 3)
        created_catalog = [row for row in connection.catalog_rows if row[20] == 900]
        self.assertEqual(len(created_catalog), 1)
        self.assertEqual(created_catalog[0][2], "https://abbottpro.ru/cardio/gamma")
        created_hash = sha256_text("https://abbottpro.ru/cardio/gamma")
        created_lookup = [
            row for row in connection.lookup_rows
            if row[2] == "url" and row[3] == created_hash
        ]
        self.assertEqual(len(created_lookup), 1)
        self.assertEqual(created_lookup[0][6], "unique")
        self.assertEqual(connection.events, ["start", "commit"])

    def test_materializer_rolls_back_on_created_identity_tamper_matrix(self):
        for tamper in (
            "alias_hash", "accepted_hash", "entity_title", "material_id",
            "source_sheet", "source_row_ordinal", "page_title",
            "alias_evidence",
        ):
            with self.subTest(tamper=tamper):
                connection = CandidateConnection(
                    create_observed_page=True,
                    tamper_created_identity=tamper,
                )
                with (
                    patch(
                        "agents.abbott_page_classifier.candidate_release.get_db_connection",
                        return_value=connection,
                    ),
                    patch(
                        "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                        return_value=41,
                    ),
                ):
                    with self.assertRaisesRegex(
                        CandidateMaterializationError,
                        "CREATED_PAGE_IDENTITY_UNAUTHORIZED",
                    ):
                        materialize_content_candidate(71, 12, "abc1234")
                self.assertEqual(connection.events, ["start", "rollback"])
                self.assertEqual(connection.catalog_rows, [])
                self.assertEqual(connection.lookup_rows, [])

    def test_observed_page_resolution_gate_counts_only_aggregate_failures(self):
        from agents.abbott_page_classifier.candidate_release import observed_page_resolution_gates

        gates = observed_page_resolution_gates(
            content_like_rows=[{"direction_key": None, "material_type": "articles"}],
            non_content_rows=[{"material_type": None, "reviewed_exclusion_count": 0}],
        )

        self.assertEqual(gates, {"content_unresolved": 1, "non_content_unresolved": 1})
        self.assertNotIn("url", repr(gates).lower())
    def test_activation_acknowledgement_marks_only_the_reviewed_batch_receipt_active(self):
        connection = FailedCandidateResetConnection(
            active_release_id=23,
            candidate_status="active",
        )

        result = acknowledge_content_candidate_activation(
            2,
            23,
            14,
            connection_factory=lambda: connection,
        )

        self.assertEqual(result, "active")
        update_sql, update_params = next(
            (sql, params)
            for sql, params in connection.calls
            if sql.startswith("UPDATE portal_content_approval_batches")
        )
        self.assertIn("activation_status = 'active'", update_sql)
        self.assertNotIn("SET batch_status =", update_sql)
        self.assertNotIn("candidate_release_id = NULL", update_sql)
        self.assertEqual(update_params, (2, "abbott", 23))

    def test_activation_acknowledgement_retry_is_idempotent(self):
        connection = FailedCandidateResetConnection(
            active_release_id=23,
            candidate_status="active",
            activation_status="active",
        )

        result = acknowledge_content_candidate_activation(
            2,
            23,
            14,
            connection_factory=lambda: connection,
        )

        self.assertEqual(result, "noop")
        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_content_approval_batches")
                for sql, _ in connection.calls
            )
        )

    def test_failed_candidate_reset_preserves_batch_evidence_for_rematerialization(self):
        connection = FailedCandidateResetConnection()

        result = reset_failed_content_candidate(
            2,
            23,
            14,
            connection_factory=lambda: connection,
        )

        self.assertEqual(result, "reset")
        update_sql, update_params = next(
            (sql, params)
            for sql, params in connection.calls
            if sql.startswith("UPDATE portal_content_approval_batches")
        )
        self.assertIn("batch_status = 'ingested'", update_sql)
        self.assertIn("candidate_release_id = NULL", update_sql)
        self.assertIn("activation_status = 'not_started'", update_sql)
        self.assertEqual(update_params, (2, "abbott", 23))
        self.assertEqual(connection.events, ["start", "commit", "close", "close"])

    def test_failed_candidate_reset_retry_is_idempotent(self):
        connection = FailedCandidateResetConnection(
            batch_status="ingested",
            batch_candidate_release_id=None,
            activation_status="not_started",
        )

        result = reset_failed_content_candidate(
            2,
            23,
            14,
            connection_factory=lambda: connection,
        )

        self.assertEqual(result, "noop")
        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_content_approval_batches")
                for sql, _ in connection.calls
            )
        )
        self.assertEqual(connection.events, ["start", "commit", "close", "close"])

    def test_failed_candidate_reset_rejects_active_pointer_change(self):
        connection = FailedCandidateResetConnection(active_release_id=15)

        with self.assertRaisesRegex(
            CandidateMaterializationError, "ACTIVE_PREDECESSOR_MISMATCH"
        ):
            reset_failed_content_candidate(
                2,
                23,
                14,
                connection_factory=lambda: connection,
            )

        self.assertFalse(
            any(
                sql.startswith("UPDATE portal_content_approval_batches")
                for sql, _ in connection.calls
            )
        )
        self.assertEqual(connection.events, ["start", "rollback", "close", "close"])

    def test_lookup_projection_enriches_return_paths_before_attestation(self):
        row = catalog_row("1" * 64, title="Guide")

        projection = build_lookup_projection(
            (row,),
            page_facts=(
                {"page_url": "https://abbottpro.ru/return/?utm_source=x", "page_title": "Guide"},
                {"page_url": "/return#again", "page_title": "  Guide  "},
                {"page_url": "file:///C:/Users/user/guide.html", "page_title": "Guide"},
            ),
        )
        return_path = next(
            item
            for item in projection
            if item.lookup_kind == "path"
            and item.lookup_key_hash == sha256_text("/return")
        )
        self.assertEqual(return_path.resolution_status, "identical_collapsed")
        self.assertEqual(return_path.candidate_count, 2)
        self.assertEqual(return_path.selected_source_row_fingerprint, "1" * 64)
        self.assertNotIn(
            sha256_text("/C:/Users/user/guide.html"),
            {item.lookup_key_hash for item in projection if item.lookup_kind == "path"},
        )

    def test_validation_does_not_collide_distinct_entities_with_absent_urls(self):
        def row(entity_id: int, fingerprint: str):
            return replace(
                catalog_row(fingerprint),
                content_entity_id=entity_id,
                normalized_url="",
                normalized_url_hash=sha256_text(""),
                normalized_path="",
                material_id=None,
                direction_key="Кардиология [262338]",
                material_type="Статьи",
                access_label="Все",
                direction_code="cardiology",
                material_type_code="articles",
                access_code="all",
                lifecycle_code="active",
                lifecycle_label="active",
            )

        taxonomy = (
            {"taxonomy_kind": "direction", "term_code": "cardiology", "term_label": "Кардиология [262338]"},
            {"taxonomy_kind": "material_type", "term_code": "articles", "term_label": "Статьи"},
            {"taxonomy_kind": "access", "term_code": "all", "term_label": "Все"},
            {"taxonomy_kind": "lifecycle", "term_code": "active", "term_label": "active"},
        )

        _, _, _, collisions = _catalog_schema_gates(
            (_catalog_payload(row(1, "1" * 64)), _catalog_payload(row(2, "2" * 64))),
            taxonomy,
        )

        self.assertEqual(collisions, 0)

    def test_legacy_visible_labels_are_projected_from_canonical_taxonomy(self):
        class LegacyLabelsConnection(CandidateConnection):
            def execute(self, sql, params=()):
                result = super().execute(sql, params)
                if "legacy_catalog.id AS predecessor_catalog_row_id" in " ".join(sql.split()):
                    self._many[1] = {
                        **self._many[1],
                        "direction_label": "Гастроэнтерология",
                        "access_label": "Доступно всем",
                    }
                return result

        connection = LegacyLabelsConnection(legacy_predecessor=True)
        connection.predecessor_catalog[1].update(
            direction_key="Гастроэнтерология",
            access_label="Доступно всем",
        )
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            materialize_content_candidate(71, 12, "abc1234")

        legacy_row = next(row for row in connection.catalog_rows if row[20] == 2)
        self.assertEqual(legacy_row[16], "Гастроэнтерология [262340]")
        self.assertEqual(legacy_row[10], "Все")

    def test_catalog_datetime_is_canonicalized_to_mysql_column_precision(self):
        self.assertEqual(
            _database_datetime("2026-08-10T10:30:45.415864+00:00"),
            datetime(2026, 8, 10, 10, 30, 45),
        )

    def test_loaded_catalog_uses_canonical_json_and_python_order(self):
        class Cursor:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchall(self):
                return (
                    {
                        "source_sheet": "я",
                        "source_row_ordinal": 1,
                        "projection_provenance_json": '{"b": 2, "a": 1}',
                    },
                    {
                        "source_sheet": "A",
                        "source_row_ordinal": 2,
                        "projection_provenance_json": '{"a":1,"b":2}',
                    },
                )

        rows = _load_catalog(Cursor(), 41, 91, include_id=False)

        self.assertEqual([row[10] for row in rows], ["A", "я"])
        self.assertEqual({row[21] for row in rows}, {'{"a":1,"b":2}'})

    def test_loaded_lookup_uses_python_canonical_order(self):
        class Cursor:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchall(self):
                return (
                    {"lookup_kind": "title", "lookup_key_hash": "b" * 64},
                    {"lookup_kind": "path", "lookup_key_hash": "a" * 64},
                )

        rows = _load_lookup(Cursor(), 41, 91)

        self.assertEqual([(row[0], row[1]) for row in rows], [
            ("path", "a" * 64),
            ("title", "b" * 64),
        ])

    def _prepare_gate(self, connection):
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            materialize_content_candidate(71, 12, "abc1234")
        connection.calls.clear()
        connection.events.clear()
        connection.closed = False
        return connection

    def test_lookup_groups_are_deterministic_and_fail_closed_on_ambiguity(self):
        first = catalog_row("1" * 64)
        identical = replace(first, source_row_ordinal=8, source_row_fingerprint="2" * 64)
        conflicting = replace(
            first,
            source_row_ordinal=9,
            source_row_fingerprint="3" * 64,
            direction_key="gastroenterology",
        )

        collapsed = build_lookup_projection((identical, first))
        self.assertTrue(collapsed)
        self.assertEqual(
            {item.resolution_status for item in collapsed},
            {"identical_collapsed", "unique"},
        )
        self.assertTrue(
            all(item.selected_source_row_fingerprint == "1" * 64 for item in collapsed)
        )
        self.assertEqual(collapsed, build_lookup_projection((first, identical)))

        ambiguous = build_lookup_projection((first, conflicting))
        self.assertTrue(
            all(
                item.resolution_status == "ambiguous"
                for item in ambiguous
                if item.lookup_kind != "url"
            )
        )
        self.assertTrue(
            all(
                item.selected_source_row_fingerprint is None
                for item in ambiguous
                if item.lookup_kind != "url"
            )
        )
        self.assertTrue(
            all(
                item.resolution_status == "unique"
                and item.selected_source_row_fingerprint == "1" * 64
                for item in ambiguous
                if item.lookup_kind == "url"
            )
        )

    def test_lookup_hashes_match_dashboard_exact_title_slug_and_path_keys(self):
        rows = build_lookup_projection(
            (catalog_row("1" * 64, title="Shared", slug="Mixed-Slug"),)
        )
        hashes = {item.lookup_kind: item.lookup_key_hash for item in rows}
        self.assertEqual(hashes["title"], sha256_text("Shared"))
        self.assertEqual(hashes["slug"], sha256_text("Mixed-Slug"))
        self.assertEqual(hashes["path"], sha256_text("/cardio/alpha"))
        self.assertEqual(hashes["url"], sha256_text("https://abbottpro.ru/cardio/alpha"))

    def test_lookup_projection_materializes_canonical_and_strong_url_aliases(self):
        row = replace(
            catalog_row("1" * 64),
            content_entity_id=7,
            normalized_url="https://abbottpro.ru/cardio/alpha/",
        )
        rows = build_lookup_projection(
            (row,),
            strong_aliases=(
                StrongUrlAlias(7, "url", "https://abbottpro.ru/legacy/"),
            ),
        )

        url_rows = [item for item in rows if item.lookup_kind == "url"]
        self.assertEqual(len(url_rows), 2)
        self.assertTrue(all(item.resolution_status == "unique" for item in url_rows))
        self.assertEqual(
            {item.lookup_key_hash for item in url_rows},
            {
                sha256_text("https://abbottpro.ru/cardio/alpha"),
                sha256_text("https://abbottpro.ru/legacy"),
            },
        )

    def test_lookup_projection_rejects_normalized_strong_url_collision(self):
        first = replace(catalog_row("1" * 64), content_entity_id=7)
        second = replace(
            catalog_row("2" * 64, url="https://abbottpro.ru/cardio/beta"),
            content_entity_id=8,
        )

        with self.assertRaisesRegex(
            CandidateMaterializationError, "^STRONG_IDENTITY_COLLISION$"
        ):
            build_lookup_projection(
                (first, second),
                strong_aliases=(
                    StrongUrlAlias(7, "url", "https://abbottpro.ru/legacy"),
                    StrongUrlAlias(8, "canonical_url", "https://abbottpro.ru/legacy/"),
                ),
            )

    def test_lookup_projection_reviewed_alias_overrides_stale_catalog_url_owner(self):
        stale = replace(
            catalog_row("1" * 64),
            content_entity_id=7,
            normalized_url="https://abbottpro.ru/legacy",
        )
        reviewed_owner = replace(
            catalog_row("2" * 64, url="https://abbottpro.ru/cardio/beta"),
            content_entity_id=8,
        )

        rows = build_lookup_projection(
            (stale, reviewed_owner),
            strong_aliases=(
                StrongUrlAlias(8, "url", "https://abbottpro.ru/legacy/"),
            ),
        )

        legacy = next(
            row
            for row in rows
            if row.lookup_kind == "url"
            and row.lookup_key_hash == sha256_text("https://abbottpro.ru/legacy")
        )
        self.assertEqual(
            legacy.selected_source_row_fingerprint,
            reviewed_owner.source_row_fingerprint,
        )

    def test_lookup_projection_omits_unclassified_alias_owner(self):
        catalog = replace(catalog_row("1" * 64), content_entity_id=7)

        rows = build_lookup_projection(
            (catalog,),
            strong_aliases=(
                StrongUrlAlias(8, "url", "https://abbottpro.ru/not-classified"),
            ),
        )

        self.assertNotIn(
            sha256_text("https://abbottpro.ru/not-classified"),
            {
                row.lookup_key_hash
                for row in rows
                if row.lookup_kind == "url"
            },
        )

    def test_materialization_aborts_before_catalog_insert_on_strong_url_collision(self):
        connection = CandidateConnection()
        aliases = (
            StrongUrlAlias(1, "url", "https://abbottpro.ru/legacy"),
            StrongUrlAlias(2, "canonical_url", "https://abbottpro.ru/legacy/"),
        )
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release._load_active_strong_url_aliases",
                return_value=aliases,
            ),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "^STRONG_IDENTITY_COLLISION$"
            ):
                materialize_content_candidate(71, 12, "abc1234")

        self.assertFalse(
            any(
                sql.startswith("INSERT INTO portal_content_catalog")
                for sql, _ in connection.calls
            )
        )

    def test_materialization_collision_query_honors_accepted_url_owner(self):
        connection = CandidateConnection()

        candidate_release._strong_identity_collision_count(connection, 71)

        sql, params = next(
            (sql, params)
            for sql, params in connection.calls
            if "strong_collision_count" in sql
        )
        self.assertIn("NOT EXISTS", sql)
        self.assertIn("authority.approval_batch_id = item.approval_batch_id", sql)
        self.assertIn("authority.selected_content_entity_id = alias_row.content_entity_id", sql)
        self.assertIn("authority.url_alias_decision IN ('attach', 'create')", sql)
        self.assertIn("SHA2(authority.url, 256) = alias_row.alias_hash", sql)
        self.assertEqual(params, ("abbott", 71))

    def test_gate_report_requires_every_exact_percentage_and_zero_failure(self):
        passed = GateReport(
            candidate_release_id=41,
            source_reconciliation_pct=Decimal("100"),
            count_reconciliation_pct=Decimal("100"),
            hash_reconciliation_pct=Decimal("100"),
            schema_compliance_pct=Decimal("100"),
        )
        self.assertTrue(passed.passed)
        self.assertFalse(replace(passed, anti_flip_violations=1).passed)
        self.assertFalse(replace(passed, strong_identity_collisions=1).passed)
        self.assertFalse(replace(passed, out_of_taxonomy_values=1).passed)
        self.assertFalse(replace(passed, archive_material_types=1).passed)
        self.assertFalse(replace(passed, unresolved_accepted_conflicts=1).passed)
        self.assertFalse(replace(passed, active_release_mutations=1).passed)
        self.assertFalse(replace(passed, dashboard_smoke_failures=1).passed)
        self.assertFalse(replace(passed, hash_reconciliation_pct=Decimal("99.999")).passed)

    def test_reviewed_validation_persists_all_gate_evidence_and_transitions(self):
        materializer = ValidationTransitionConnection()
        operator = ValidationTransitionConnection()
        report = GateReport(
            candidate_release_id=41,
            fact_total_controls=tuple(
                (name, Decimal("100"), Decimal("100"))
                for name in FACT_TOTAL_CONTROL_NAMES
            ),
        )
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }
        with patch(
            "agents.abbott_page_classifier.candidate_release.validate_content_candidate",
            side_effect=(report, report),
        ) as validate:
            result = validate_and_transition_content_candidate(
                41,
                counts,
                "a" * 64,
                reviewed_by="content-manager",
                code_revision="abc1234",
                materializer_connection_factory=lambda: materializer,
                operator_connection_factory=lambda: operator,
            )

        self.assertEqual(result, report)
        self.assertEqual(validate.call_count, 2)
        self.assertEqual(materializer.events, ["start", "rollback", "close"])
        self.assertEqual(operator.events, ["start", "commit", "close"])
        inserts = [
            (sql, params) for sql, params in operator.calls
            if sql.startswith("INSERT INTO portal_migration_validation_runs")
        ]
        self.assertEqual(len(inserts), 26)
        self.assertEqual(len({params[2] for _sql, params in inserts}), 1)
        self.assertEqual(
            {params[4] for _sql, params in inserts},
            set(CONTENT_CONTROL_VALUES) | set(FACT_TOTAL_CONTROL_NAMES),
        )
        self.assertTrue(all(params[-1] == "content-manager" for _sql, params in inserts))
        transition = next(
            sql for sql, _params in operator.calls
            if sql.startswith("UPDATE portal_data_releases")
        )
        self.assertIn("release_status = 'validated'", transition)

    def test_real_validation_blocks_a_candidate_pageview_mutation_before_transition(self):
        materializer = self._prepare_gate(
            ProductionValidationConnection(candidate_pageview_delta=1)
        )
        operator = self._prepare_gate(
            ProductionValidationConnection(candidate_pageview_delta=1)
        )
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }

        report = validate_content_candidate(
            41, counts, materializer.accepted_hash,
            connection_factory=lambda: materializer,
        )

        self.assertEqual(report.fact_total_mismatches, 1)
        self.assertIn(
            ("fact_totals.2026-07-01.2026-07-31.pageviews", Decimal("100"), Decimal("101")),
            report.fact_total_controls,
        )
        with self.assertRaisesRegex(CandidateMaterializationError, "CANDIDATE_GATE_FAILED"):
            validate_and_transition_content_candidate(
                41, counts, materializer.accepted_hash,
                reviewed_by="content-manager", code_revision="abc1234",
                materializer_connection_factory=lambda: materializer,
                operator_connection_factory=lambda: operator,
            )
        self.assertFalse(any(
            sql.startswith("UPDATE portal_data_releases")
            for sql, _params in operator.calls
        ))

    def test_real_validation_blocks_observed_content_without_direction_or_type(self):
        connection = self._prepare_gate(
            ProductionValidationConnection(content_unresolved=1)
        )
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }

        report = validate_content_candidate(
            41, counts, connection.accepted_hash,
            connection_factory=lambda: connection,
        )

        self.assertEqual(report.content_unresolved, 1)
        self.assertFalse(report.passed)
        observed_sql = next(
            sql for sql, _params in connection.calls if "AS content_unresolved" in sql
        )
        self.assertIn("scope_dimensions", observed_sql)
        self.assertIn("portal_release_source_imports AS catalog_import", observed_sql)
        self.assertIn(
            "exact_url.source_snapshot_id = catalog_import.source_snapshot_id",
            observed_sql,
        )
        self.assertIn("catalog_import.source_kind = 'abbott_workbook_catalog'", observed_sql)
        self.assertIn("path_lookup.lookup_kind = 'path'", observed_sql)
        self.assertIn("exact_url.lookup_kind = 'url'", observed_sql)
        self.assertIn("SHA2(facts.normalized_path, 256)", observed_sql)
        self.assertNotIn("raw_payload", observed_sql)

    def test_real_validation_blocks_non_content_without_service_page_or_reviewed_exclusion(self):
        connection = self._prepare_gate(
            ProductionValidationConnection(non_content_unresolved=1)
        )
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }

        report = validate_content_candidate(
            41, counts, connection.accepted_hash,
            connection_factory=lambda: connection,
        )

        self.assertEqual(report.non_content_unresolved, 1)
        self.assertFalse(report.passed)
        observed_sql = next(
            sql for sql, _params in connection.calls if "AS content_unresolved" in sql
        )
        self.assertIn("portal_content_url_alias_decision_events", observed_sql)
        self.assertIn("url_alias_decision = 'reject'", observed_sql)
        self.assertIn("decision_reason", observed_sql)

    def test_real_validation_rejects_a_tampered_reviewed_exclusion_event(self):
        connection = self._prepare_gate(ProductionValidationConnection(
            reviewed_exclusion_event={"event_fingerprint": "0" * 64},
        ))
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }

        with self.assertRaisesRegex(
            CandidateMaterializationError, "REVIEWED_EXCLUSION_INVALID"
        ):
            validate_content_candidate(
                41, counts, connection.accepted_hash,
                connection_factory=lambda: connection,
            )

    def test_real_validation_accepts_only_an_intact_candidate_bound_reject_event(self):
        base_connection = self._prepare_gate(ProductionValidationConnection())
        event = {
            "approval_batch_id": 71,
            "approval_item_id": 101,
            "accepted_decision_hash": base_connection.accepted_hash,
            "actor": "content-manager",
            "decision_reason": "reviewed non-content route",
            "normalized_url": "https://abbottpro.ru/removed",
            "url_alias_decision": "reject",
            "selected_content_entity_id": None,
            "selected_predecessor_event_id": None,
            "selected_predecessor_event_fingerprint": None,
        }
        event["event_fingerprint"] = compute_url_alias_decision_event_fingerprint(**event)
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }
        clean = self._prepare_gate(ProductionValidationConnection(
            reviewed_exclusion_event=event,
        ))
        report = validate_content_candidate(
            41, counts, clean.accepted_hash, connection_factory=lambda: clean,
        )
        self.assertTrue(report.passed)

        for field, value in (
            ("normalized_url", "https://abbottpro.ru/tampered"),
            ("url_alias_decision", "attach"),
            ("decision_reason", "tampered reason"),
            ("event_fingerprint", "f" * 64),
        ):
            with self.subTest(field=field):
                connection = self._prepare_gate(ProductionValidationConnection(
                    reviewed_exclusion_event={**event, field: value},
                ))
                with self.assertRaisesRegex(
                    CandidateMaterializationError, "REVIEWED_EXCLUSION_INVALID"
                ):
                    validate_content_candidate(
                        41, counts, connection.accepted_hash,
                        connection_factory=lambda: connection,
                    )

    def test_real_validation_writes_exact_full_control_evidence_before_validating(self):
        materializer = self._prepare_gate(ProductionValidationConnection())
        operator = self._prepare_gate(ProductionValidationConnection())
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }

        report = validate_and_transition_content_candidate(
            41, counts, materializer.accepted_hash,
            reviewed_by="content-manager", code_revision="abc1234",
            materializer_connection_factory=lambda: materializer,
            operator_connection_factory=lambda: operator,
        )

        fact_names = {
            f"fact_totals.{start}.{end}.{metric}"
            for start, end in (
                ("2026-06-01", "2026-06-30"),
                ("2026-07-01", "2026-07-31"),
                ("2026-08-01", "2026-08-09"),
            )
            for metric in ("sessions", "users", "pageviews", "goal_conversions")
        }
        evidence_names = {params[4] for params in operator.validation_evidence}
        self.assertTrue(report.passed)
        self.assertEqual(evidence_names, set(CONTENT_CONTROL_VALUES) | fact_names)
        self.assertEqual(len(operator.validation_evidence), 26)
        self.assertEqual(operator.release_status, "validated")

    def test_transition_rejects_a_gate_report_that_omits_required_fact_controls(self):
        materializer = ValidationTransitionConnection()
        operator = ValidationTransitionConnection()
        counts = {
            "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
            "rejected": 0, "accepted": 1, "no_change": 1,
        }
        with patch(
            "agents.abbott_page_classifier.candidate_release.validate_content_candidate",
            side_effect=(GateReport(candidate_release_id=41), GateReport(candidate_release_id=41)),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "FACT_TOTAL_EVIDENCE_INVALID"
            ):
                validate_and_transition_content_candidate(
                    41, counts, "a" * 64,
                    reviewed_by="content-manager", code_revision="abc1234",
                    materializer_connection_factory=lambda: materializer,
                    operator_connection_factory=lambda: operator,
                )
        self.assertFalse(any(
            sql.startswith("UPDATE portal_data_releases")
            for sql, _params in operator.calls
        ))

    def test_materialization_copies_successor_without_mutating_or_activating(self):
        connection = CandidateConnection()

        def create(**kwargs):
            self.assertIs(kwargs["connection"], connection)
            self.assertEqual(kwargs["predecessor_release_id"], 12)
            return 41

        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                side_effect=create,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
            patch(
                "canonical_release_store.activate_release",
                side_effect=AssertionError("activation is forbidden"),
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        self.assertEqual(result.candidate_release_id, 41)
        self.assertEqual(result.catalog_snapshot_id, 901)
        self.assertEqual(result.catalog_row_count, 2)
        self.assertEqual(result.source_snapshot_ids, (11, 901))
        self.assertEqual(connection.events, ["start", "commit"])
        sql = "\n".join(call[0] for call in connection.calls)
        self.assertIn("FOR UPDATE", sql)
        self.assertIn("portal_release_source_imports", sql)
        self.assertIn("portal_content_catalog", sql)
        self.assertIn("portal_content_lookup_projection", sql)
        self.assertIn("event.approval_item_id", sql)
        self.assertNotIn("UPDATE portal_active_data_releases", sql)
        self.assertNotIn("UPDATE portal_content_classification_events", sql)
        self.assertNotIn("UPDATE portal_content_catalog", sql)
        first_catalog_row = next(
            row for row in connection.catalog_rows if row[12] == "Кардиология [262338]"
        )
        self.assertEqual(first_catalog_row[2], "https://abbottpro.ru/cardio/alpha")
        self.assertEqual(first_catalog_row[5], "Alpha")
        self.assertEqual(first_catalog_row[6], "100")
        self.assertEqual(first_catalog_row[8], "alpha")
        self.assertEqual(first_catalog_row[14], "1" * 64)
        self.assertEqual(first_catalog_row[15], "cardio")
        self.assertEqual(first_catalog_row[17], datetime(2026, 7, 1))
        provenance = json.loads(first_catalog_row[23])
        self.assertEqual(provenance["predecessor_catalog_row_id"], 1001)
        self.assertEqual(provenance["source_row_fingerprint"], "1" * 64)

    def test_materialization_replays_latest_prior_accepted_events(self):
        connection = CandidateConnection()
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            materialize_content_candidate(71, 12, "abc1234")

        sql = "\n".join(call[0] for call in connection.calls)
        self.assertIn("FROM portal_content_catalog AS predecessor_catalog", sql)
        self.assertIn("event.approval_batch_id = %s", sql)
        self.assertIn("event.proposal_evidence", sql)
        self.assertIn("analytics_scope = 'page'", sql)
        self.assertIn("'$.page_url'", sql)
        self.assertIn("WITH latest_events AS", sql)
        prior_sql = next(
            statement
            for statement, _params in connection.calls
            if "WITH latest_events AS" in statement
        )
        self.assertIn(
            "batch.batch_status IN ('accepted','ingested','candidate_materialized')",
            prior_sql,
        )
        self.assertIn("event.approval_batch_id <> %s", prior_sql)
        self.assertIn("event.row_rank = 1", prior_sql)
        self.assertIn(
            "direction.taxonomy_version_id = event.taxonomy_version_id",
            prior_sql,
        )
        self.assertNotIn("direction.term_status = 'active'", prior_sql)
        self.assertIn("batch.source_snapshot_ids", sql)
        self.assertIn("batch.source_snapshot_digests", sql)
        self.assertIn("'$.registry1.material_id'", sql)
        self.assertIn("'$.registry2.material_id'", sql)

    def test_accepted_overlay_preserves_every_predecessor_occurrence(self):
        connection = CandidateConnection()
        first = connection.predecessor_catalog[0]
        connection.predecessor_catalog.insert(
            1,
            {
                **first,
                "id": 1003,
                "normalized_url": "https://abbottpro.ru/cardio/alpha-print",
                "normalized_url_hash": sha256_text(
                    "https://abbottpro.ru/cardio/alpha-print"
                ),
                "normalized_path": "/cardio/alpha-print",
                "page_title": "Alpha print",
                "source_slug": "alpha-print",
                "source_slug_hash": sha256_text("alpha-print"),
                "source_row_ordinal": 8,
                "source_row_fingerprint": "6" * 64,
            },
        )
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        entity_rows = [
            row for row in connection.catalog_rows if row[20] == 1
        ]
        self.assertEqual(result.catalog_row_count, 3)
        self.assertEqual(len(entity_rows), 2)
        self.assertEqual(
            {(row[2], row[13], row[14]) for row in entity_rows},
            {
                (
                    "https://abbottpro.ru/cardio/alpha",
                    7,
                    "1" * 64,
                ),
                (
                    "https://abbottpro.ru/cardio/alpha-print",
                    8,
                    "6" * 64,
                ),
            },
        )
        self.assertEqual({row[21] for row in entity_rows}, {501})
        fingerprints = {row[22] for row in entity_rows}
        self.assertEqual(len(fingerprints), 1)
        self.assertEqual(len(next(iter(fingerprints))), 64)
        self.assertNotEqual(fingerprints, {"3" * 64})
        provenances = [json.loads(row[23]) for row in entity_rows]
        self.assertEqual(
            {item["predecessor_catalog_row_id"] for item in provenances},
            {1001, 1003},
        )

    def test_empty_urls_are_not_treated_as_strong_identity_collisions(self):
        def predecessor(entity_id: int, ordinal: int, fingerprint: str):
            row = catalog_row(fingerprint)
            return {
                **row.__dict__,
                "id": 1000 + ordinal,
                "content_entity_id": entity_id,
                "material_id": None,
                "normalized_url": "",
                "normalized_url_hash": sha256_text(""),
                "normalized_path": "",
                "source_row_ordinal": ordinal,
                "projection_provenance_json": json.dumps(
                    {
                        "canonical_codes": {
                            "direction": "cardiology",
                            "material_type": "articles",
                            "access": "all",
                            "lifecycle": "active",
                        },
                        "canonical_labels": {"lifecycle": "active"},
                        "mode": "legacy_active_catalog_baseline",
                    }
                ),
            }

        result = _overlay_current_batch_events(
            (
                predecessor(1, 7, "1" * 64),
                predecessor(2, 8, "2" * 64),
            ),
            (),
        )

        self.assertEqual({row.content_entity_id for row in result}, {1, 2})

    def test_overlay_rekeys_exact_legacy_source_row_to_current_registry_entity(self):
        predecessor = catalog_row("1" * 64).__dict__ | {
            "id": 1001,
            "content_entity_id": 7,
            "source_sheet": "Лист1",
            "source_row_ordinal": 27,
            "normalized_url_hash": sha256_text(
                "https://abbottpro.ru/cardio/alpha"
            ),
            "projection_provenance_json": json.dumps({
                "canonical_codes": {
                    "direction": "cardiology",
                    "material_type": "articles",
                    "access": "all",
                    "lifecycle": "active",
                }
            }),
        }
        event = {
            "content_entity_id": 8,
            "material_id": None,
            "canonical_url": predecessor["normalized_url"],
            "source_evidence": {
                "provenance": [{
                    "source_sheet": "Лист1",
                    "source_row_ordinal": 27,
                }]
            },
            "event_kind": "approve",
            "classification_event_id": 501,
            "event_fingerprint": "f" * 64,
            "effective_at": datetime(2026, 8, 11),
            "direction_code": "cardiology",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "direction_label": "Кардиология [262338]",
            "material_type_label": "Статьи",
            "access_label": "Все",
            "lifecycle_label": "active",
        }

        result = _overlay_current_batch_events((predecessor,), (event,))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].content_entity_id, 8)
        self.assertEqual(result[0].source_sheet, "Лист1")
        self.assertEqual(result[0].source_row_ordinal, 27)

    def test_overlay_does_not_rekey_source_row_when_url_differs(self):
        predecessor = catalog_row("1" * 64).__dict__ | {
            "id": 1001,
            "content_entity_id": 7,
            "source_sheet": "Лист1",
            "source_row_ordinal": 27,
            "normalized_url_hash": sha256_text(
                "https://abbottpro.ru/cardio/alpha"
            ),
            "projection_provenance_json": json.dumps({
                "canonical_codes": {
                    "direction": "cardiology",
                    "material_type": "articles",
                    "access": "all",
                    "lifecycle": "active",
                }
            }),
        }
        event = {
            "content_entity_id": 8,
            "material_id": None,
            "canonical_url": "https://abbottpro.ru/different",
            "source_evidence": {
                "provenance": [{
                    "source_sheet": "Лист1",
                    "source_row_ordinal": 27,
                }]
            },
            "event_kind": "approve",
            "classification_event_id": 501,
            "event_fingerprint": "f" * 64,
            "effective_at": datetime(2026, 8, 11),
            "direction_code": "cardiology",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "direction_label": "Кардиология [262338]",
            "material_type_label": "Статьи",
            "access_label": "Все",
            "lifecycle_label": "active",
        }

        with self.assertRaisesRegex(
            CandidateMaterializationError, "^SOURCE_PROVENANCE_COLLISION$"
        ):
            _overlay_current_batch_events((predecessor,), (event,))

    def test_catalog_insert_has_exact_mysql_schema_and_parameter_arity(self):
        connection = CandidateConnection()
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            materialize_content_candidate(71, 12, "abc1234")

        catalog_inserts = [
            (sql, params)
            for sql, params in connection.calls
            if sql.startswith("INSERT INTO portal_content_catalog (")
        ]
        self.assertEqual(len(catalog_inserts), 2)
        for sql, params in catalog_inserts:
            column_sql = sql.split("(", 1)[1].split(") VALUES", 1)[0]
            columns = tuple(value.strip() for value in column_sql.split(","))
            self.assertEqual(len(columns), 25)
            self.assertEqual(sql.count("%s"), len(columns))
            self.assertEqual(len(params), len(columns))

    def test_materialization_creates_successor_baseline_and_row_provenance(self):
        connection = CandidateConnection()
        baseline_ids = []

        def create(**kwargs):
            baseline_ids.append(kwargs["baseline_validation_run_id"])
            return 41

        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                side_effect=create,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        self.assertEqual(len(baseline_ids), 1)
        self.assertNotEqual(baseline_ids[0], 33)
        self.assertGreater(baseline_ids[0], 0)
        sql = "\n".join(call[0] for call in connection.calls)
        self.assertIn("'abbott_canonical_control_pack'", sql)
        catalog_insert = next(
            sql for sql, _ in connection.calls if sql.startswith("INSERT INTO portal_content_catalog")
        )
        for column in (
            "content_entity_id",
            "classification_event_id",
            "classification_event_fingerprint",
            "projection_provenance_json",
            "projection_row_hash",
        ):
            self.assertIn(column, catalog_insert)
        baseline = json.loads(connection.baseline_manifest)
        terms = baseline["content_candidate_bundle"]["referenced_taxonomy_terms"]
        self.assertIn(
            {"taxonomy_kind": "direction", "term_code": "cardiology", "term_label": "Кардиология [262338]"},
            terms,
        )
        self.assertIn(
            {"taxonomy_kind": "lifecycle", "term_code": "active", "term_label": "active"},
            terms,
        )
        self.assertEqual(result.status, "staging")

    def test_first_post_046_successor_derives_legacy_predecessor_provenance(self):
        connection = CandidateConnection(legacy_predecessor=True)
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            materialize_content_candidate(71, 12, "abc1234")

        inherited = next(row for row in connection.catalog_rows if row[12] == "Гастроэнтерология [262340]")
        provenance = json.loads(inherited[-2])
        self.assertEqual(inherited[20], 2)
        self.assertEqual(provenance["mode"], "legacy_active_catalog_baseline")
        self.assertEqual(provenance["predecessor_catalog_row_id"], 1002)
        sql = "\n".join(call[0] for call in connection.calls)
        legacy_resolution_sql = next(
            statement
            for statement, _params in connection.calls
            if "legacy_catalog.id AS predecessor_catalog_row_id" in statement
        )
        self.assertIn("active_release_baseline", legacy_resolution_sql)
        self.assertIn("JSON_CONTAINS", legacy_resolution_sql)
        self.assertNotIn(
            "portal_content_registry_aliases AS alias_row",
            legacy_resolution_sql,
        )
        self.assertIn("latest_events", sql)

    def test_prior_accepted_event_rejects_item_classification_tamper(self):
        accepted_hash = "a" * 64
        accepted_at = datetime(2026, 8, 4, 10, 0)
        item_evidence = {"source": "reviewed-batch"}
        event_evidence = {
            "accepted_decision_hash": accepted_hash,
            "approval_item_evidence": item_evidence,
            "row_hash": "b" * 64,
        }
        row = {
            "authorized_entity_id": 900,
            "content_entity_id": 900,
            "classification_event_id": 800,
            "approval_batch_id": 70,
            "approval_item_id": 700,
            "taxonomy_version_id": 5,
            "direction_code": "cardiology",
            "material_type_code": "articles",
            "access_code": "all",
            "lifecycle_code": "active",
            "event_kind": "approve",
            "predecessor_event_id": None,
            "proposal_evidence": event_evidence,
            "actor": "content-manager",
            "reason": "reviewed prior classification",
            "effective_at": accepted_at,
            "direction_label": "Кардиология [262338]",
            "material_type_label": "Статьи",
            "access_label": "Все",
            "lifecycle_label": "active",
            "authority_accepted_hash": accepted_hash,
            "authority_accepted_by": "content-manager",
            "authority_accepted_at": accepted_at,
            "authority_content_entity_id": 900,
            "authority_selected_entity_id": None,
            "authority_url_decision": None,
            "authority_row_hash": "b" * 64,
            "authority_decision_reason": "reviewed prior classification",
            "authority_item_evidence": item_evidence,
            "authority_direction_code": "cardiology",
            "authority_material_type_code": "articles",
            "authority_access_code": "all",
            "authority_lifecycle_code": "active",
        }
        row["event_fingerprint"] = compute_classification_event_fingerprint(
            {
                "access_code": row["access_code"],
                "actor": row["actor"],
                "approval_batch_id": row["approval_batch_id"],
                "approval_item_id": row["approval_item_id"],
                "content_entity_id": row["content_entity_id"],
                "direction_code": row["direction_code"],
                "effective_at": accepted_at.isoformat(timespec="microseconds"),
                "event_kind": row["event_kind"],
                "lifecycle_code": row["lifecycle_code"],
                "material_type_code": row["material_type_code"],
                "predecessor_event_id": None,
                "proposal_evidence": event_evidence,
                "reason": row["reason"],
                "taxonomy_version_id": row["taxonomy_version_id"],
            }
        )

        _authorize_prior_accepted_events((row,))
        with self.assertRaisesRegex(
            CandidateMaterializationError,
            "PRIOR_ACCEPTED_EVENT_UNAUTHORIZED",
        ):
            _authorize_prior_accepted_events(
                ({**row, "authority_material_type_code": "video"},)
            )

    def test_first_post_046_successor_rejects_ambiguous_legacy_identity(self):
        connection = CandidateConnection(
            legacy_predecessor=True,
            ambiguous_legacy_predecessor=True,
        )
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError,
                "LEGACY_PREDECESSOR_PROVENANCE_AMBIGUOUS",
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_first_post_046_successor_legacy_baseline_revalidates_identically(self):
        connection = self._prepare_gate(GateConnection(legacy_predecessor=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertTrue(report.passed)

    def test_materialization_rejects_scalar_and_json_conflict_code_mismatch(self):
        connection = CandidateConnection()
        connection.approval_rows[0]["conflict_code"] = "IDENTITY_COLLISION"
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "APPROVAL_BUNDLE_INVALID"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_ignores_identity_collision_on_skipped_conflict_row(self):
        connection = CandidateConnection(skipped_identity_conflict=True)
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        self.assertEqual(result.status, "staging")
        self.assertEqual(connection.events, ["start", "commit"])

    def test_materialization_rejects_unauthorized_current_batch_event(self):
        connection = CandidateConnection(unauthorized_event=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_accepts_legitimate_manager_direction_correction(self):
        connection = CandidateConnection(manager_direction_edit=True)
        self.assertNotEqual(
            connection.approval_rows[0]["proposal_evidence"]["published_decision"]["final_direction_code"],
            connection.approval_rows[0]["final_direction_code"],
        )
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            try:
                result = materialize_content_candidate(71, 12, "abc1234")
            except CandidateMaterializationError as exc:
                self.fail(f"legitimate manager direction correction was rejected: {exc}")
        self.assertEqual(result.catalog_row_count, 2)
        self.assertEqual(connection.events, ["start", "commit"])

    def test_materialization_accepts_missing_baseline_direction_fill(self):
        connection = CandidateConnection(baseline_missing_direction=True)
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")

        self.assertEqual(result.status, "staging")
        self.assertEqual(connection.events, ["start", "commit"])

    def test_materialization_accepts_legitimate_manager_material_access_edit(self):
        connection = CandidateConnection(manager_material_access_edit=True)
        published = connection.approval_rows[0]["proposal_evidence"]["published_decision"]
        self.assertNotEqual(
            (published["final_material_type_code"], published["final_access_code"]),
            (
                connection.approval_rows[0]["final_material_type_code"],
                connection.approval_rows[0]["final_access_code"],
            ),
        )
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            try:
                result = materialize_content_candidate(71, 12, "abc1234")
            except CandidateMaterializationError as exc:
                self.fail(f"legitimate manager metadata edit was rejected: {exc}")
        self.assertEqual(result.catalog_row_count, 2)
        self.assertEqual(connection.events, ["start", "commit"])

    def test_materialization_rejects_event_decision_different_from_accepted_final(self):
        connection = CandidateConnection(mismatched_event_final=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_corrupted_immutable_proposal_evidence(self):
        connection = CandidateConnection(corrupt_immutable_evidence=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "APPROVAL_BUNDLE_INVALID"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_corrupted_approval_row_hash(self):
        connection = CandidateConnection(corrupt_approval_row_hash=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "APPROVAL_BUNDLE_INVALID"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_corrupted_event_fingerprint(self):
        connection = CandidateConnection(corrupt_event_fingerprint=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_self_consistent_effective_at_spoof(self):
        connection = CandidateConnection(spoof_effective_at=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_accepts_timezone_batch_and_naive_db_event_timestamp(self):
        connection = CandidateConnection(
            batch_accepted_at="2026-08-05T13:00:00.000000+03:00"
        )
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            result = materialize_content_candidate(71, 12, "abc1234")
        self.assertEqual(result.catalog_row_count, 2)

    def test_materialization_rejects_missing_authorized_current_batch_event(self):
        connection = CandidateConnection(missing_authorized_event=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError,
                "CURRENT_BATCH_EVENT_AUTHORIZATION_INCOMPLETE",
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_orphan_current_batch_event(self):
        connection = CandidateConnection(orphan_event=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_materialization_rejects_duplicate_current_batch_event(self):
        connection = CandidateConnection(duplicate_event=True)
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            with self.assertRaisesRegex(
                CandidateMaterializationError, "CURRENT_BATCH_EVENT_UNAUTHORIZED"
            ):
                materialize_content_candidate(71, 12, "abc1234")

    def test_current_batch_event_query_reads_values_for_python_authorization(self):
        connection = CandidateConnection()
        with (
            patch("agents.abbott_page_classifier.candidate_release.get_db_connection", return_value=connection),
            patch("agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release", return_value=41),
            patch("agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release", return_value={"id": 41, "release_status": "staging"}),
        ):
            materialize_content_candidate(71, 12, "abc1234")
        event_sql = next(
            sql for sql, _ in connection.calls
            if "FROM portal_content_classification_events AS event" in sql
        )
        for token in (
            "event.approval_item_id", "event.taxonomy_version_id",
            "event.predecessor_event_id", "event.proposal_evidence",
            "event.actor", "event.reason", "authorized_entity_id",
        ):
            self.assertIn(token, event_sql)
        self.assertNotIn("published_decision.final_direction_code", event_sql)
        batch_sql = next(
            sql for sql, _ in connection.calls
            if "FROM portal_content_approval_batches AS batch" in sql
        )
        self.assertIn("batch.accepted_at", batch_sql)

    def test_catalog_readback_hash_mismatch_rolls_back_everything(self):
        connection = CandidateConnection(mismatch_catalog_hash=True)
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.create_candidate_release",
                return_value=41,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            with self.assertRaises(CandidateMaterializationError):
                materialize_content_candidate(71, 12, "abc1234")

        self.assertIn("rollback", connection.events)
        self.assertNotIn("commit", connection.events)

    def test_validation_reports_gates_without_calling_activation(self):
        connection = self._prepare_gate(GateConnection())
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
            patch(
                "canonical_release_store.activate_release",
                side_effect=AssertionError("activation is forbidden"),
            ),
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2,
                    "ready": 1,
                    "conflict": 0,
                    "unresolved": 0,
                    "rejected": 0,
                    "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )

        self.assertTrue(report.passed)
        self.assertNotIn("commit", connection.events)
        self.assertFalse(any(sql.startswith("UPDATE") for sql, _ in connection.calls))
        sql = "\n".join(call[0] for call in connection.calls)
        self.assertIn("FROM portal_content_taxonomy_terms", sql)
        self.assertIn("item.final_material_type_code", sql)
        self.assertIn("item.proposal_evidence", sql)
        self.assertIn("resolution_status IN ('unique', 'identical_collapsed')", sql)
        observed_sql = next(
            query
            for query, _params in connection.calls
            if "AS non_content_unresolved" in query
        )
        self.assertIn("COUNT(*) AS fact_count", observed_sql)
        self.assertIn("* facts.fact_count", observed_sql)
        self.assertIn("GROUP BY canonical_release_id, normalized_path", observed_sql)
        self.assertIn("exact_url.lookup_kind = 'url'", observed_sql)
        self.assertIn(
            "exact_url.lookup_key_hash = SHA2( CONCAT('https://abbottpro.ru', facts.normalized_path), 256)",
            observed_sql,
        )
        self.assertIn("COALESCE(", observed_sql)
        self.assertIn("exact_url.selected_source_row_fingerprint", observed_sql)
        self.assertIn("path_lookup.selected_source_row_fingerprint", observed_sql)
        self.assertIn("facts.normalized_path IS NOT NULL", observed_sql)
        validation_batch_sql = next(
            query for query, _ in connection.calls
            if "FROM portal_content_approval_batches AS batch" in query
            and "batch.candidate_release_id = %s" in query
        )
        self.assertIn("batch.accepted_at", validation_batch_sql)

    def test_read_only_validation_accepts_a_validated_candidate_for_comparison(self):
        connection = self._prepare_gate(
            GateConnection(candidate_status="validated")
        )

        report = validate_content_candidate(
            41,
            expected_counts={
                "source": 2,
                "ready": 1,
                "conflict": 0,
                "unresolved": 0,
                "rejected": 0,
                "accepted": 1,
            },
            accepted_hash=connection.accepted_hash,
            connection_factory=lambda: connection,
        )

        self.assertTrue(report.passed)
        self.assertNotIn("commit", connection.events)

    def test_read_only_validation_rejects_active_retired_and_failed_releases(self):
        for status in ("active", "retired", "failed"):
            with self.subTest(status=status):
                connection = self._prepare_gate(
                    GateConnection(candidate_status=status)
                )
                with self.assertRaisesRegex(
                    CandidateMaterializationError, "CANDIDATE_NOT_MUTABLE"
                ):
                    validate_content_candidate(
                        41,
                        expected_counts={
                            "source": 2,
                            "ready": 1,
                            "conflict": 0,
                            "unresolved": 0,
                            "rejected": 0,
                            "accepted": 1,
                        },
                        accepted_hash=connection.accepted_hash,
                        connection_factory=lambda: connection,
                    )

    def test_non_content_copy_and_attestation_use_natural_grain_streaming(self):
        connection = self._prepare_gate(GateConnection())
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertTrue(report.passed)
        non_content_sql = [
            sql for sql, _ in connection.calls
            if "canonical_release_id = %s ORDER BY" in sql
        ]
        self.assertTrue(non_content_sql)
        self.assertTrue(all("ORDER BY id" not in sql for sql in non_content_sql))

    def test_validation_uses_real_taxonomy_term_status_column(self):
        connection = self._prepare_gate(GateConnection())
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            validate_content_candidate(
                41,
                expected_counts={
                    "source": 2,
                    "ready": 1,
                    "conflict": 0,
                    "unresolved": 0,
                    "rejected": 0,
                    "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )

        taxonomy_sql = next(
            sql
            for sql, _ in connection.calls
            if "FROM portal_content_taxonomy_terms" in sql
            and "term_status = 'active'" in sql
        )
        self.assertIn("term_status = 'active'", taxonomy_sql)
        self.assertNotIn("is_active", taxonomy_sql)

    def test_anti_flip_gate_revalidates_hash_bound_correction_contract(self):
        connection = self._prepare_gate(GateConnection())
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        anti_flip_sql = next(
            sql for sql, _ in connection.calls
            if "FROM portal_content_classification_events AS event" in sql
        )
        for token in (
            "event.approval_item_id", "event.taxonomy_version_id",
            "event.predecessor_event_id", "event.proposal_evidence",
            "event.actor", "event.reason", "authorized_entity_id",
        ):
            self.assertIn(token, anti_flip_sql)

    def test_validation_accepts_legitimate_manager_direction_correction(self):
        connection = self._prepare_gate(GateConnection(manager_direction_edit=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertTrue(report.passed)

    def test_validation_accepts_legitimate_manager_material_access_edit(self):
        connection = self._prepare_gate(
            GateConnection(manager_material_access_edit=True)
        )
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertTrue(report.passed)

    def test_validation_rejects_spoofed_current_batch_event(self):
        connection = self._prepare_gate(GateConnection())
        connection.unauthorized_event = True
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.anti_flip_violations, 1)
        self.assertFalse(report.passed)

    def test_validation_rejects_event_decision_different_from_accepted_final(self):
        connection = self._prepare_gate(GateConnection())
        connection.mismatched_event_final = True
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.anti_flip_violations, 1)
        self.assertFalse(report.passed)

    def test_validation_rejects_self_consistent_effective_at_spoof(self):
        connection = self._prepare_gate(GateConnection())
        connection.spoof_effective_at = True
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.anti_flip_violations, 1)
        self.assertFalse(report.passed)

    def test_validation_rejects_missing_published_item_event(self):
        connection = self._prepare_gate(GateConnection())
        connection.missing_authorized_event = True
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.anti_flip_violations, 1)
        self.assertFalse(report.passed)

    def test_validation_locks_release_pointer_and_attests_real_bundle(self):
        connection = self._prepare_gate(GateConnection())
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            validate_content_candidate(
                41,
                expected_counts={
                    "source": 2,
                    "ready": 1,
                    "conflict": 0,
                    "unresolved": 0,
                    "rejected": 0,
                    "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )

        sql = "\n".join(call[0] for call in connection.calls)
        self.assertRegex(sql, r"FROM portal_data_releases AS candidate .* FOR UPDATE")
        self.assertRegex(sql, r"FROM portal_active_data_releases AS active .* FOR UPDATE")
        self.assertNotIn("100 AS source_reconciliation_pct", sql)
        self.assertNotIn("100 AS count_reconciliation_pct", sql)
        self.assertIn("portal_release_source_imports", sql)
        self.assertIn("report_bd_private.canonical_fact_metrika_visits", sql)
        self.assertIn("FROM portal_content_approval_items AS item", sql)
        self.assertIn("item.row_hash", sql)
        self.assertIn("resolution_status IN ('unique', 'identical_collapsed')", sql)
        self.assertIn("direction_key IS NOT NULL", sql)
        self.assertIn("material_type IS NOT NULL", sql)
        self.assertIn("access_label IS NOT NULL", sql)

    def test_validation_fails_exact_count_gate_on_one_row_difference(self):
        connection = self._prepare_gate(GateConnection())
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2,
                    "ready": 2,
                    "conflict": 0,
                    "unresolved": 0,
                    "rejected": 0,
                    "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )

        self.assertEqual(report.count_reconciliation_pct, Decimal("0"))
        self.assertFalse(report.passed)

    def test_validation_rehashes_persisted_candidate_rows(self):
        connection = self._prepare_gate(GateConnection(mismatched_manifest=True))
        with (
            patch(
                "agents.abbott_page_classifier.candidate_release.get_db_connection",
                return_value=connection,
            ),
            patch(
                "agents.abbott_page_classifier.candidate_release.release_store.require_mutable_candidate_release",
                return_value={"id": 41, "release_status": "staging"},
            ),
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2,
                    "ready": 1,
                    "conflict": 0,
                    "unresolved": 0,
                    "rejected": 0,
                    "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )

        self.assertEqual(report.hash_reconciliation_pct, Decimal("0"))
        self.assertFalse(report.passed)

    def test_validation_detects_deleted_or_corrupted_nonzero_bundle_rows(self):
        for corruption_flag in ("corrupt_candidate_fact", "corrupt_candidate_import"):
            with self.subTest(corruption_flag=corruption_flag):
                connection = self._prepare_gate(GateConnection())
                setattr(connection, corruption_flag, True)
                with patch(
                    "agents.abbott_page_classifier.candidate_release.get_db_connection",
                    return_value=connection,
                ):
                    report = validate_content_candidate(
                        41,
                        expected_counts={
                            "source": 2,
                            "ready": 1,
                            "conflict": 0,
                            "unresolved": 0,
                            "rejected": 0,
                            "accepted": 1,
                        },
                        accepted_hash=connection.accepted_hash,
                    )

                self.assertEqual(report.hash_reconciliation_pct, Decimal("0"))
                self.assertFalse(report.passed)

    def test_validation_hash_binds_snapshot_source_row_count(self):
        connection = self._prepare_gate(GateConnection())
        connection.snapshots[11]["source_row_count"] = 999
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.hash_reconciliation_pct, Decimal("0"))
        self.assertFalse(report.passed)

    def test_dashboard_smoke_rejects_partial_candidate_projection(self):
        connection = self._prepare_gate(GateConnection(partial_smoke=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 1)
        self.assertFalse(report.passed)

    def test_dashboard_smoke_accepts_valid_ambiguity_and_missing_slug(self):
        connection = self._prepare_gate(GateConnection(realistic_smoke=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 0)
        smoke_sql = "\n".join(sql for sql, _ in connection.calls)
        self.assertIn("resolution_status = 'ambiguous'", smoke_sql)
        self.assertIn("selected_source_row_fingerprint IS NULL", smoke_sql)
        self.assertIn("lookup_kind IN ('title', 'slug', 'path', 'url')", smoke_sql)
        self.assertIn("INNER JOIN portal_content_catalog AS selected_catalog", smoke_sql)

    def test_dashboard_smoke_rejects_dangling_selected_fingerprint(self):
        connection = self._prepare_gate(GateConnection(dangling_selected_fingerprint=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 1)

    def test_dashboard_smoke_rejects_expected_slug_group_loss(self):
        connection = self._prepare_gate(GateConnection(expected_slug_group_loss=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 1)

    def test_dashboard_smoke_rejects_filter_gap_on_joined_projection(self):
        connection = self._prepare_gate(GateConnection(joined_filter_gap=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 1)

    def test_dashboard_smoke_rejects_combined_direction_type_access_gap(self):
        connection = self._prepare_gate(GateConnection(combined_filter_gap=True))
        with patch(
            "agents.abbott_page_classifier.candidate_release.get_db_connection",
            return_value=connection,
        ):
            report = validate_content_candidate(
                41,
                expected_counts={
                    "source": 2, "ready": 1, "conflict": 0, "unresolved": 0,
                    "rejected": 0, "accepted": 1,
                },
                accepted_hash=connection.accepted_hash,
            )
        self.assertEqual(report.dashboard_smoke_failures, 1)


if __name__ == "__main__":
    unittest.main()
