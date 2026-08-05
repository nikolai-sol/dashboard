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
from agents.abbott_page_classifier.normalization import sha256_text


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

    def __init__(self, *, mismatch_catalog_hash: bool = False):
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
        if "FROM portal_active_data_releases AS active" in normalized:
            self._one = {
                "canonical_release_id": 12,
                "baseline_validation_run_id": 33,
                "source_snapshot_ids": "[11, 12]",
                "release_status": "active",
            }
        elif "FROM portal_content_approval_batches AS batch" in normalized:
            self._one = {
                "id": 71,
                "batch_status": "ingested",
                "accepted_decision_hash": "d" * 64,
                "accepted_count": 1,
                "ready_count": 1,
                "conflict_count": 0,
                "unresolved_count": 0,
                "rejected_count": 0,
                "no_change_count": 1,
                "taxonomy_version_id": 5,
                "accepted_at": "2026-08-05T10:00:00.000000+00:00",
            }
        elif "strong_collision_count" in normalized:
            self._one = {"strong_collision_count": 0}
        elif "FROM latest_events AS event" in normalized:
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
                },
                {
                    "content_entity_id": 2,
                    "material_id": "200",
                    "title": "Beta",
                    "canonical_url": "https://abbottpro.ru/gastro/beta/",
                    "source_evidence": {
                        "source_name": "canonical_catalog",
                        "source_sheet": "canonical_catalog",
                        "source_row_ordinal": 2,
                        "source_row_fingerprint": "3" * 64,
                    },
                    "classification_event_id": 400,
                    "direction_code": "gastroenterology",
                    "material_type_code": "video",
                    "access_code": "doctors",
                    "lifecycle_code": "active",
                    "event_kind": "baseline",
                    "event_fingerprint": "4" * 64,
                    "approval_batch_id": None,
                    "effective_at": datetime(2026, 7, 1, 0, 0, 0),
                },
            ]
        elif "FROM portal_dataset_snapshots" in normalized and "source_kind" in normalized:
            self._many = [
                {"id": 11, "source_kind": "abbott_workbook_json"},
                {"id": 12, "source_kind": "abbott_workbook_catalog"},
            ]
        elif normalized.startswith("SELECT source_snapshot_id, source_kind"):
            self._many = [
                {
                    "source_snapshot_id": 11,
                    "source_kind": "abbott_workbook_json",
                    "imported_row_count": 2,
                    "rejected_row_count": 0,
                },
                {
                    "source_snapshot_id": 12,
                    "source_kind": "abbott_workbook_catalog",
                    "imported_row_count": 2,
                    "rejected_row_count": 0,
                },
            ]
        elif normalized.startswith("SELECT COUNT(*) AS source_row_count"):
            self._one = {"source_row_count": 0}
        elif normalized.startswith("INSERT INTO portal_dataset_snapshots"):
            self.lastrowid = 901
        elif normalized.startswith("INSERT INTO portal_content_catalog"):
            self.catalog_rows.append(params)
        elif normalized.startswith("INSERT INTO portal_content_lookup_projection"):
            self.lookup_rows.append(params)
        elif normalized.startswith("SELECT canonical_release_id, source_snapshot_id"):
            names = (
                "canonical_release_id", "source_snapshot_id", "normalized_url",
                "normalized_url_hash", "normalized_path", "page_title", "material_id",
                "material_type", "source_slug", "source_slug_hash", "access_label",
                "is_active", "source_sheet", "source_row_ordinal",
                "source_row_fingerprint", "section_key", "direction_key",
                "published_at", "valid_from", "valid_to",
            )
            self._many = [dict(zip(names, row)) for row in self.catalog_rows]
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
            self.rowcount = 0
        elif normalized.startswith("UPDATE portal_content_approval_batches"):
            self.rowcount = 1

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self._many)


class GateConnection(CandidateConnection):
    def __init__(self, gate_row, *, mismatched_manifest=False):
        super().__init__()
        self.gate_row = gate_row
        empty_hash = sha256_text("[]")
        self.validation_metadata = {
            "catalog_snapshot_id": 901,
            "content_sha256": "0" * 64 if mismatched_manifest else empty_hash,
            "manifest_json": json.dumps(
                {
                    "accepted_decision_hash": "d" * 64,
                    "catalog_hash": empty_hash,
                    "lookup_hash": empty_hash,
                    "source_row_count": 0,
                    "lookup_row_count": 0,
                }
            ),
            "accepted_decision_hash": "d" * 64,
        }

    def execute(self, sql, params=()):
        super().execute(sql, params)
        normalized = " ".join(sql.split())
        if "AS anti_flip_violations" in normalized:
            self._one = dict(self.gate_row)
        elif normalized.startswith("SELECT snapshot.id AS catalog_snapshot_id"):
            self._one = dict(self.validation_metadata)


class CandidateReleaseTest(unittest.TestCase):
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
        self.assertIn("event.event_kind IN ('baseline', 'approve', 'correct')", sql)
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
        row = {
            "anti_flip_violations": 0,
            "strong_identity_collisions": 0,
            "out_of_taxonomy_values": 0,
            "archive_material_types": 0,
            "unresolved_accepted_conflicts": 0,
            "active_release_mutations": 0,
            "dashboard_smoke_failures": 0,
            "source_reconciliation_pct": 100,
            "count_reconciliation_pct": 100,
            "hash_reconciliation_pct": 100,
            "schema_compliance_pct": 100,
            "actual_source_count": 2,
            "actual_ready_count": 1,
            "actual_conflict_count": 0,
            "actual_unresolved_count": 0,
            "actual_rejected_count": 0,
            "actual_no_change_count": 1,
            "actual_accepted_count": 1,
        }
        connection = GateConnection(row)
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
                accepted_hash="d" * 64,
            )

        self.assertTrue(report.passed)
        self.assertNotIn("commit", connection.events)
        self.assertFalse(any(sql.startswith("UPDATE") for sql, _ in connection.calls))
        sql = "\n".join(call[0] for call in connection.calls)
        self.assertIn("direction.term_code = item.final_direction_code", sql)
        self.assertIn("item.final_material_type_code", sql)
        self.assertIn("JSON_LENGTH(JSON_KEYS(item.proposal_evidence)) = 9", sql)
        self.assertIn("'$.published_decision.final_lifecycle_code'", sql)
        self.assertIn("JSON_LENGTH(JSON_KEYS(JSON_EXTRACT(item.proposal_evidence, '$.terra'))) = 7", sql)
        self.assertIn("JSON_LENGTH(JSON_KEYS(JSON_EXTRACT(item.proposal_evidence, '$.sol'))) = 7", sql)
        self.assertIn("'$.terra.confidence'", sql)
        self.assertIn("'$.sol.evidence'", sql)

    def test_validation_fails_exact_count_gate_on_one_row_difference(self):
        row = {
            "anti_flip_violations": 0,
            "strong_identity_collisions": 0,
            "out_of_taxonomy_values": 0,
            "archive_material_types": 0,
            "unresolved_accepted_conflicts": 0,
            "active_release_mutations": 0,
            "dashboard_smoke_failures": 0,
            "source_reconciliation_pct": 100,
            "count_reconciliation_pct": 100,
            "hash_reconciliation_pct": 100,
            "schema_compliance_pct": 100,
            "actual_source_count": 2,
            "actual_ready_count": 1,
            "actual_conflict_count": 0,
            "actual_unresolved_count": 0,
            "actual_rejected_count": 0,
            "actual_no_change_count": 1,
            "actual_accepted_count": 1,
        }
        connection = GateConnection(row)
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
                accepted_hash="d" * 64,
            )

        self.assertEqual(report.count_reconciliation_pct, Decimal("0"))
        self.assertFalse(report.passed)

    def test_validation_rehashes_persisted_candidate_rows(self):
        row = {
            "anti_flip_violations": 0,
            "strong_identity_collisions": 0,
            "out_of_taxonomy_values": 0,
            "archive_material_types": 0,
            "unresolved_accepted_conflicts": 0,
            "active_release_mutations": 0,
            "dashboard_smoke_failures": 0,
            "source_reconciliation_pct": 100,
            "count_reconciliation_pct": 100,
            "hash_reconciliation_pct": 100,
            "schema_compliance_pct": 100,
            "actual_source_count": 2,
            "actual_ready_count": 1,
            "actual_conflict_count": 0,
            "actual_unresolved_count": 0,
            "actual_rejected_count": 0,
            "actual_no_change_count": 1,
            "actual_accepted_count": 1,
        }
        connection = GateConnection(row, mismatched_manifest=True)
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
                accepted_hash="d" * 64,
            )

        self.assertEqual(report.hash_reconciliation_pct, Decimal("0"))
        self.assertFalse(report.passed)


if __name__ == "__main__":
    unittest.main()
