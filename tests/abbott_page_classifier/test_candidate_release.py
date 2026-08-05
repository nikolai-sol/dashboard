"""Task 8 successor content-release materialization contracts."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
import unittest
from unittest.mock import patch
import json

from agents.abbott_page_classifier.candidate_release import (
    CandidateCatalogRow,
    CandidateMaterializationError,
    GateReport,
    build_lookup_projection,
    materialize_content_candidate,
    validate_content_candidate,
)
from agents.abbott_page_classifier.batch_service import compute_accepted_decision_hash
from agents.abbott_page_classifier.domain import ApprovalItem
from agents.abbott_page_classifier.normalization import sha256_text


def strict_evidence(finals):
    return {
        "archive_attestation": None,
        "concise_evidence": [],
        "current_canonical": None,
        "deterministic": None,
        "published_decision": {
            "decision_reason": None,
            "final_access_code": finals[2],
            "final_direction_code": finals[0],
            "final_lifecycle_code": finals[3],
            "final_material_type_code": finals[1],
        },
        "registry1": None,
        "registry2": None,
        "sol": None,
        "terra": None,
    }


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
        self.snapshots = {
            11: {
                "id": 11,
                "source_kind": "abbott_workbook_json",
                "content_sha256": "a" * 64,
                "content_bytes": 100,
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
                "parser_version": "parser-v1",
                "import_status": "imported",
                "imported_row_count": 2,
                "rejected_row_count": 0,
                "manifest_json": "{}",
            },
        }
        self.candidate_imports = []
        self.approval_rows = [
            {
                "content_entity_id": 1,
                "input_hash": "a" * 64,
                "title": "Alpha",
                "url": "https://abbottpro.ru/cardio/alpha",
                "final_direction_code": "cardiology",
                "final_material_type_code": "articles",
                "final_access_code": "all",
                "final_lifecycle_code": "active",
                "readiness_state": "ready",
                "conflict_codes": "[]",
                "row_hash": "b" * 64,
                "decision_reason": None,
                "proposal_evidence": strict_evidence(
                    ("cardiology", "articles", "all", "active")
                ),
            },
            {
                "content_entity_id": 2,
                "input_hash": "c" * 64,
                "title": "Beta",
                "url": "https://abbottpro.ru/gastro/beta",
                "final_direction_code": "gastroenterology",
                "final_material_type_code": "video",
                "final_access_code": "doctors",
                "final_lifecycle_code": "active",
                "readiness_state": "no_change",
                "conflict_codes": "[]",
                "row_hash": "d" * 64,
                "decision_reason": None,
                "proposal_evidence": strict_evidence(
                    ("gastroenterology", "video", "doctors", "active")
                ),
            },
        ]
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
                row_hash=row["row_hash"],
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
                "access_label": "Все",
                "is_active": 1,
                "source_sheet": "Кардиология",
                "source_row_ordinal": 7,
                "source_row_fingerprint": "1" * 64,
                "section_key": "cardio",
                "direction_key": "Кардиология",
                "published_at": datetime(2026, 7, 1),
                "valid_from": datetime(2026, 7, 1),
                "valid_to": None,
                "content_entity_id": 1,
                "classification_event_id": 300,
                "classification_event_fingerprint": "3" * 64,
                "projection_provenance_json": json.dumps(
                    {
                        "canonical_codes": {
                            "access": "all",
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
                "source_sheet": "Гастроэнтерология",
                "source_row_ordinal": 2,
                "source_row_fingerprint": "5" * 64,
                "section_key": "gastro",
                "direction_key": "Гастроэнтерология",
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
                "accepted_at": "2026-08-05T10:00:00.000000+00:00",
                "source_snapshot_ids": "[11, 12]",
                "source_snapshot_digests": json.dumps(["a" * 64, "b" * 64]),
            }
        elif "FROM portal_content_approval_items AS item" in normalized and "item.row_hash" in normalized:
            self._many = list(self.approval_rows)
        elif "strong_collision_count" in normalized:
            self._one = {"strong_collision_count": 0}
        elif "FROM portal_content_catalog AS predecessor_catalog" in normalized:
            self._many = list(self.predecessor_catalog)
        elif "AS anti_flip_violations" in normalized:
            self._one = {"anti_flip_violations": 0}
        elif "FROM portal_content_classification_events AS event" in normalized and "event.approval_batch_id = %s" in normalized:
            self._many = [
                {
                    "content_entity_id": 1,
                    "material_id": "100",
                    "title": "Alpha",
                    "canonical_url": "https://abbottpro.ru/cardio/alpha/",
                    "source_evidence": {
                        "provenance": [
                            {
                                "source_name": "registry1",
                                "source_sheet": "Кардиология",
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
                    "direction_code": "cardiology",
                    "material_type_code": "articles",
                    "access_code": "all",
                    "lifecycle_code": "active",
                    "event_kind": "correct",
                    "event_fingerprint": "2" * 64,
                    "approval_batch_id": 71,
                    "effective_at": datetime(2026, 8, 5, 10, 0, 0),
                    "direction_label": "Кардиология",
                    "material_type_label": "Статьи",
                    "access_label": "Все",
                    "lifecycle_label": "active",
                },
            ]
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
            self._many = [
                {"taxonomy_kind": "direction", "term_code": "cardiology", "term_label": "Кардиология"},
                {"taxonomy_kind": "direction", "term_code": "gastroenterology", "term_label": "Гастроэнтерология"},
                {"taxonomy_kind": "material_type", "term_code": "articles", "term_label": "Статьи"},
                {"taxonomy_kind": "material_type", "term_code": "video", "term_label": "Видео"},
                {"taxonomy_kind": "access", "term_code": "all", "term_label": "Все"},
                {"taxonomy_kind": "access", "term_code": "doctors", "term_label": "Врачи"},
                {"taxonomy_kind": "lifecycle", "term_code": "active", "term_label": "Активный"},
            ]
        elif "AS smoke_row_count" in normalized:
            self._one = {"smoke_row_count": 1}
        elif normalized.startswith("SELECT ") and " WHERE canonical_release_id = %s ORDER BY id" in normalized:
            column_sql, table = normalized.split(" FROM ", 1)
            columns = [value.strip() for value in column_sql.removeprefix("SELECT ").split(",")]
            table = table.split(" WHERE ", 1)[0]
            release_id = int(params[0])
            self._many = [{column: f"{table}:{column}" for column in columns}]
            if self.corrupt_candidate_fact and release_id == 41:
                self._many[0][columns[0]] = "corrupted"
        elif normalized.startswith("INSERT INTO portal_dataset_snapshots"):
            self.snapshot_insert_count += 1
            self.lastrowid = 900 + self.snapshot_insert_count
            if self.snapshot_insert_count == 1:
                self.snapshots[self.lastrowid] = {
                    "id": self.lastrowid,
                    "source_kind": params[1],
                    "content_sha256": params[3],
                    "content_bytes": params[4],
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
        return list(self._many)


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
        self.assertIn("event.event_kind IN ('approve', 'correct', 'revoke')", sql)
        self.assertNotIn("UPDATE portal_active_data_releases", sql)
        self.assertNotIn("UPDATE portal_content_classification_events", sql)
        self.assertNotIn("UPDATE portal_content_catalog", sql)
        first_catalog_row = next(
            row for row in connection.catalog_rows if row[12] == "Кардиология"
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
        self.assertIn("event.event_kind IN ('approve', 'correct', 'revoke')", sql)
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
        self.assertEqual(result.status, "staging")

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
        self.assertIn("projection.resolution_status IN ('unique', 'identical_collapsed')", sql)

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
        self.assertIn("projection.resolution_status IN ('unique', 'identical_collapsed')", sql)
        self.assertIn("catalog.page_title IS NOT NULL", sql)

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


if __name__ == "__main__":
    unittest.main()
