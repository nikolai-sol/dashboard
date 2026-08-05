"""Task 8 successor content-release materialization contracts."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
import unittest
from unittest.mock import patch
import json
from collections.abc import Mapping

from agents.abbott_page_classifier.candidate_release import (
    CandidateCatalogRow,
    CandidateMaterializationError,
    GateReport,
    build_lookup_projection,
    materialize_content_candidate,
    validate_content_candidate,
)
from agents.abbott_page_classifier.batch_service import (
    ApprovalBatchItem,
    compute_accepted_decision_hash,
    compute_batch_hash,
    compute_classification_event_fingerprint,
    compute_item_hash,
    compute_taxonomy_digest,
)
from agents.abbott_page_classifier.domain import ApprovalItem
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
                    "direction_code": "cardiology",
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
                readiness_state="no_change",
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
                "conflict_code": None,
                "conflict_codes": "[]",
                "row_hash": item.row_hash,
                "decision_reason": item.decision_reason,
                "proposal_evidence": plain_json(item.proposal_evidence),
            })
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
                conflict_codes=(),
                row_hash=row["row_hash"],
                decision_reason=row["decision_reason"],
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
        self.calls.append((normalized, params))
        self._one = None
        self._many = []
        self._stream_many = False
        self.rowcount = 1
        if "FROM portal_data_releases AS candidate" in normalized:
            self._one = {
                "id": 41,
                "release_status": "staging",
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
                "accepted_count": 1,
                "ready_count": 1,
                "conflict_count": 0,
                "unresolved_count": 0,
                "rejected_count": 0,
                "no_change_count": 1,
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
        elif "legacy_catalog.id AS predecessor_catalog_row_id" in normalized:
            self._many = [
                {
                    "predecessor_catalog_row_id": 1001,
                    "content_entity_id": 1,
                    "alias_type": "material_id",
                    "direction_code": "cardiology",
                    "material_type_code": "articles",
                    "access_code": "doctors",
                    "lifecycle_code": "active",
                    "lifecycle_label": "active",
                },
                {
                    "predecessor_catalog_row_id": 1002,
                    "content_entity_id": 2,
                    "alias_type": "canonical_url",
                    "direction_code": "gastroenterology",
                    "material_type_code": "video",
                    "access_code": "doctors",
                    "lifecycle_code": "active",
                    "lifecycle_label": "active",
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
        elif "FROM portal_content_classification_events AS event" in normalized and "event.approval_batch_id = %s" in normalized:
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


class CandidateReleaseTest(unittest.TestCase):
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
        self.assertEqual({item.resolution_status for item in collapsed}, {"identical_collapsed"})
        self.assertTrue(all(item.selected_source_row_fingerprint == "1" * 64 for item in collapsed))
        self.assertEqual(collapsed, build_lookup_projection((first, identical)))

        ambiguous = build_lookup_projection((first, conflicting))
        self.assertTrue(all(item.resolution_status == "ambiguous" for item in ambiguous))
        self.assertTrue(all(item.selected_source_row_fingerprint is None for item in ambiguous))

    def test_lookup_hashes_match_dashboard_exact_title_slug_and_path_keys(self):
        rows = build_lookup_projection(
            (catalog_row("1" * 64, title="Shared", slug="Mixed-Slug"),)
        )
        hashes = {item.lookup_kind: item.lookup_key_hash for item in rows}
        self.assertEqual(hashes["title"], sha256_text("Shared"))
        self.assertEqual(hashes["slug"], sha256_text("Mixed-Slug"))
        self.assertEqual(hashes["path"], sha256_text("/cardio/alpha"))

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
        self.assertEqual(first_catalog_row[2], "https://abbottpro.ru/cardio/source-alpha")
        self.assertEqual(first_catalog_row[5], "Source Alpha")
        self.assertEqual(first_catalog_row[6], "source-100")
        self.assertEqual(first_catalog_row[8], "source-alpha")
        self.assertEqual(first_catalog_row[14], "1" * 64)
        self.assertEqual(first_catalog_row[15], "cardio")
        self.assertEqual(first_catalog_row[17], datetime(2026, 7, 31, 9, 0, 0))

    def test_materialization_derives_only_from_predecessor_and_current_batch(self):
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
        self.assertNotIn("WITH latest_events AS", sql)
        self.assertIn("batch.source_snapshot_ids", sql)
        self.assertIn("batch.source_snapshot_digests", sql)
        self.assertIn("'$.registry1.material_id'", sql)
        self.assertIn("'$.registry2.material_id'", sql)

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
        self.assertIn("legacy_catalog.id AS predecessor_catalog_row_id", sql)
        self.assertIn("alias_row.uniqueness_scope = 'strong'", sql)
        self.assertNotIn("latest_events", sql)

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
        validation_batch_sql = next(
            query for query, _ in connection.calls
            if "FROM portal_content_approval_batches AS batch" in query
            and "batch.candidate_release_id = %s" in query
        )
        self.assertIn("batch.accepted_at", validation_batch_sql)

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
        self.assertIn("lookup_kind IN ('title', 'slug', 'path')", smoke_sql)
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


if __name__ == "__main__":
    unittest.main()
