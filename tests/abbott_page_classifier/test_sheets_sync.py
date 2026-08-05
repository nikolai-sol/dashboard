"""Fake-gateway tests for the database-backed Sheets approval projection."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch

from agents.abbott_page_classifier import sheets_sync
from agents.abbott_page_classifier.batch_service import (
    PersistedApprovalBatch,
    build_batch,
    compute_accepted_decision_hash,
    compute_taxonomy_digest,
)
from agents.abbott_page_classifier.domain import (
    ACCESS_CODES,
    ApprovalItem,
    DIRECTION_CODES,
    LIFECYCLE_CODES,
    MATERIAL_TYPE_CODES,
    TaxonomyVersion,
)
from agents.abbott_page_classifier.sheets_sync import (
    APPROVAL_TAB_TITLES,
    HISTORY_HEADERS,
    ITEM_HEADERS,
    ProjectionValidationError,
    persist_and_publish_batch,
    persist_accepted_projection,
    publish_batch_projection,
    read_accepted_projection,
)
from agents.abbott_page_classifier.repository import RepositoryError


def item(entity_id: int, state: str, *, title: str | None = None) -> ApprovalItem:
    complete = state != "unresolved"
    return ApprovalItem(
        content_entity_id=entity_id,
        input_hash=f"{entity_id:064x}",
        title=title or f"Material {entity_id}",
        url=f"https://example.test/{entity_id}",
        final_direction_code="cardiology" if complete else None,
        final_material_type_code="articles" if complete else None,
        final_access_code="doctors",
        final_lifecycle_code="active",
        readiness_state=state,
        conflict_codes=("DIRECTION_CONFLICT",) if state == "conflict" else (),
        row_hash="ignored-by-build",
    )


def batch():
    terms = {
        "direction": tuple(sorted(DIRECTION_CODES)),
        "material_type": tuple(sorted(MATERIAL_TYPE_CODES)),
        "access": tuple(sorted(ACCESS_CODES)),
        "lifecycle": tuple(sorted(LIFECYCLE_CODES)),
    }
    taxonomy = TaxonomyVersion(
        version="abbott.v1",
        terms=terms,
        digest=compute_taxonomy_digest("abbott.v1", terms),
    )
    return build_batch(
        (
            item(1, "ready", title="=unsafe title"),
            item(2, "conflict"),
            item(3, "unresolved"),
            item(4, "rejected"),
            item(5, "no_change"),
        ),
        taxonomy,
        "prompt.v1",
        source_snapshot_ids=(101, 202),
        source_snapshot_digests=("a" * 64, "b" * 64),
        model_routing_version="routing.v1",
    )


def persisted(approval_batch):
    return PersistedApprovalBatch(batch=approval_batch, database_batch_id=73)


class FakeRepository:
    def __init__(self, canonical_batch=None, *, reject_attestation: str | None = None):
        self.canonical_batch = canonical_batch
        self.reject_attestation = reject_attestation
        self.calls: list[tuple[str, object]] = []
        self.status = "draft"
        self.accepted_snapshot = None

    def persist_draft_batch(self, approval_batch):
        self.calls.append(("persist_draft_batch", approval_batch.batch_key))
        if self.canonical_batch is None:
            self.canonical_batch = approval_batch
        return 73

    def attest_batch_for_publication(self, batch_id, approval_batch):
        self.calls.append(("attest_batch_for_publication", batch_id))
        if self.reject_attestation:
            raise RepositoryError(self.reject_attestation)
        if self.canonical_batch != approval_batch or batch_id != 73:
            raise RuntimeError("BATCH_NOT_PERSISTED")

    def attest_batch_for_acceptance(self, batch_id, approval_batch):
        self.calls.append(("attest_batch_for_acceptance", batch_id))
        if self.canonical_batch != approval_batch or batch_id != 73:
            raise RuntimeError("BATCH_NOT_PERSISTED")

    def mark_batch_published(self, batch_id, spreadsheet_id, projection_hash):
        self.calls.append(("mark_batch_published", (batch_id, spreadsheet_id, projection_hash)))
        self.status = "published"

    def mark_batch_projection_failed(self, batch_id, failure_code):
        self.calls.append(("mark_batch_projection_failed", (batch_id, failure_code)))
        self.status = "failed"

    def load_batch_history(self, batch_id):
        self.calls.append(("load_batch_history", batch_id))
        approval_batch = self.canonical_batch
        counts = {state: 0 for state in ("ready", "conflict", "unresolved", "rejected", "no_change")}
        for approval in approval_batch.items:
            counts[approval.readiness_state] += 1
        return {
            "batch_key": approval_batch.batch_key,
            "published_input_hash": approval_batch.published_input_hash,
            "accepted_decision_hash": (
                self.accepted_snapshot.accepted_decision_hash if self.accepted_snapshot else None
            ),
            "approver": self.accepted_snapshot.accepted_by if self.accepted_snapshot else None,
            "accepted_at": self.accepted_snapshot.accepted_at if self.accepted_snapshot else None,
            **{f"{state}_count": value for state, value in counts.items()},
            "accepted_count": counts["ready"] if self.accepted_snapshot else 0,
            "skipped_count": (len(approval_batch.items) - counts["ready"]) if self.accepted_snapshot else 0,
            "batch_status": self.status,
            "spreadsheet_file_id": "fake-sheet-id" if self.status != "draft" else None,
            "spreadsheet_projection_hash": approval_batch.published_input_hash if self.status != "draft" else None,
            "candidate_release_id": None,
            "activation_status": "not_started",
        }

    def record_batch_acceptance(self, batch_id, snapshot, spreadsheet_id):
        self.calls.append(("record_batch_acceptance", (batch_id, spreadsheet_id)))
        self.accepted_snapshot = snapshot
        self.status = "accepted"


def publish_projection(approval_batch, gateway, repository=None):
    repository = repository or FakeRepository(approval_batch)
    return publish_batch_projection(persisted(approval_batch), gateway, repository)


class FakeSheetsGateway:
    spreadsheet_id = "fake-sheet-id"

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.values: dict[str, list[list[object]]] = {}
        self.titles: list[str] = []
        self.requests: list[dict[str, object]] = []

    def ensure_tabs(self, spreadsheet_id, titles):
        self.calls.append(("ensure_tabs", (spreadsheet_id, tuple(titles))))
        self.titles = list(titles)
        return {title: index + 10 for index, title in enumerate(titles)}

    def replace_values(self, spreadsheet_id, range_name, values):
        self.calls.append(("replace_values", (spreadsheet_id, range_name)))
        title = self._tab(range_name)
        self.values[title] = [list(row) for row in values]

    def read_values(self, spreadsheet_id, range_name):
        self.calls.append(("read_values", (spreadsheet_id, range_name)))
        title = self._tab(range_name)
        return [list(row) for row in self.values.get(title, [])]

    def batch_update(self, spreadsheet_id, requests):
        self.calls.append(("batch_update", spreadsheet_id))
        self.requests.extend(requests)

    @staticmethod
    def _tab(range_name: str) -> str:
        matched = re.match(r"^'((?:''|[^'])+)'!", range_name)
        if matched is None:
            raise AssertionError(f"unquoted A1 tab name: {range_name}")
        return matched.group(1).replace("''", "'")

    def accept(self, *, accepted_by="manager", accepted_at="2026-08-05T12:00:00Z"):
        rows = self.values["Апрув batch"]
        updates = {
            "Решение": "Принять",
            "Принял": accepted_by,
            "Принято UTC": accepted_at,
        }
        for row in rows:
            if row and row[0] in updates:
                row[1] = updates[row[0]]

    def edit_item(self, tab: str, entity_id: int, column: str, value: object):
        rows = self.values[tab]
        column_index = rows[0].index(column)
        entity_index = rows[0].index("content_entity_id")
        target = next(row for row in rows[1:] if int(row[entity_index]) == entity_id)
        target[column_index] = value


def metadata(gateway: FakeSheetsGateway, tab: str) -> dict[str, object]:
    return {str(row[0]): row[1] for row in gateway.values[tab] if len(row) >= 2}


class SheetsProjectionTests(unittest.TestCase):
    def test_forged_persistence_receipt_is_re_attested_before_any_gateway_call(self):
        approval_batch = batch()
        gateway = FakeSheetsGateway()
        repository = FakeRepository(
            approval_batch,
            reject_attestation="BATCH_NOT_PERSISTED",
        )

        with self.assertRaises(RepositoryError) as raised:
            publish_batch_projection(persisted(approval_batch), gateway, repository)

        self.assertEqual(raised.exception.code, "BATCH_NOT_PERSISTED")
        self.assertEqual(gateway.calls, [])

    def test_invented_taxonomy_attestation_failure_makes_zero_gateway_calls(self):
        canonical = batch()
        invented_terms = {
            **canonical.taxonomy_terms,
            "direction": (*canonical.taxonomy_terms["direction"], "invented"),
        }
        invented = build_batch(
            canonical.items,
            TaxonomyVersion(
                version=canonical.taxonomy_version,
                terms=invented_terms,
                digest=compute_taxonomy_digest(canonical.taxonomy_version, invented_terms),
            ),
            canonical.prompt_version,
            source_snapshot_ids=canonical.source_snapshot_ids,
            source_snapshot_digests=canonical.source_snapshot_digests,
            model_routing_version=canonical.model_routing_version,
        )
        gateway = FakeSheetsGateway()
        repository = FakeRepository(
            canonical,
            reject_attestation="TAXONOMY_CONTRACT_MISMATCH",
        )

        with self.assertRaises(RepositoryError) as raised:
            publish_batch_projection(persisted(invented), gateway, repository)

        self.assertEqual(raised.exception.code, "TAXONOMY_CONTRACT_MISMATCH")
        self.assertEqual(gateway.calls, [])

    def test_publish_rejects_an_unpersisted_batch_before_any_gateway_call(self):
        gateway = FakeSheetsGateway()

        with self.assertRaises(ProjectionValidationError) as raised:
            publish_batch_projection(batch(), gateway, FakeRepository(batch()))

        self.assertEqual(raised.exception.code, "BATCH_NOT_PERSISTED")
        self.assertEqual(gateway.calls, [])

    def test_direct_operator_entrypoint_keeps_existing_credentials_path_loadable(self):
        script = (
            Path(__file__).resolve().parents[2]
            / "agents"
            / "abbott_page_classifier"
            / "sheets_sync.py"
        )

        result = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_sheet_cli_commands_fail_closed_before_any_legacy_authority(self):
        for argv in (
            ("publish", "--share", "operator@example.invalid"),
            ("pull-approved",),
            ("share",),
            ("share", "--email", "operator@example.invalid"),
        ):
            with self.subTest(argv=argv), patch.object(
                sheets_sync, "publish", side_effect=AssertionError("publish must not run")
            ) as publish, patch.object(
                sheets_sync, "pull_approved", side_effect=AssertionError("pull must not run")
            ) as pull, patch.object(
                sheets_sync, "share_with_user", side_effect=AssertionError("share must not run")
            ) as share:
                with self.assertRaises(SystemExit) as raised:
                    sheets_sync.main(list(argv))
                self.assertEqual(
                    str(raised.exception),
                    "LEGACY_SHEETS_CLI_DISABLED",
                )
                publish.assert_not_called()
                pull.assert_not_called()
                share.assert_not_called()

    def test_direct_legacy_sheet_cli_is_sanitized_and_disabled(self):
        script = (
            Path(__file__).resolve().parents[2]
            / "agents"
            / "abbott_page_classifier"
            / "sheets_sync.py"
        )
        for argv in (
            ("publish",),
            ("pull-approved",),
            ("share",),
            ("share", "--email", "operator@example.invalid"),
        ):
            with self.subTest(argv=argv):
                result = subprocess.run(
                    [sys.executable, str(script), *argv],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr.strip(), "LEGACY_SHEETS_CLI_DISABLED")

    def test_operator_docs_use_the_exact_runtime_approval_tab_contract(self):
        root = Path(__file__).resolve().parents[2]
        expected = "\n".join(
            f"{index}. `{title}`"
            for index, title in enumerate(APPROVAL_TAB_TITLES, start=1)
        )
        retired = ("Готово", "Отклонено", "Без изменений", "Инструкция")
        for relative in (
            "agents/abbott_page_classifier/README.md",
            "agents/abbott_page_classifier/PROCESS.md",
            "ops/runbooks/abbott_content_registry.md",
        ):
            with self.subTest(relative=relative):
                text = (root / relative).read_text(encoding="utf-8")
                self.assertIn(expected, text)
                self.assertTrue(all(title not in text for title in retired))

    def test_persist_and_publish_finishes_all_database_writes_before_sheet_write(self):
        events: list[str] = []

        class Repository(FakeRepository):
            def persist_draft_batch(self, approval_batch):
                events.append("db:persist-draft")
                return super().persist_draft_batch(approval_batch)

            def attest_batch_for_publication(self, batch_id, approval_batch):
                events.append("db:attest")
                return super().attest_batch_for_publication(batch_id, approval_batch)

        class Gateway(FakeSheetsGateway):
            def ensure_tabs(self, spreadsheet_id, titles):
                events.append("sheet:ensure")
                return super().ensure_tabs(spreadsheet_id, titles)

        gateway = Gateway()
        repository = Repository(batch())

        result = persist_and_publish_batch(repository.canonical_batch, repository, gateway)

        self.assertEqual(events[:3], ["db:persist-draft", "db:attest", "sheet:ensure"])
        self.assertEqual(result.database_batch_id, 73)

    def test_gateway_failure_marks_retryable_failure_and_retry_reuses_same_batch(self):
        approval_batch = batch()
        repository = FakeRepository(approval_batch)

        class FailingOnceGateway(FakeSheetsGateway):
            def __init__(self):
                super().__init__()
                self.failed = False

            def replace_values(self, spreadsheet_id, range_name, values):
                if not self.failed:
                    self.failed = True
                    raise RuntimeError("transient sheets failure")
                return super().replace_values(spreadsheet_id, range_name, values)

        gateway = FailingOnceGateway()
        with self.assertRaises(RuntimeError):
            persist_and_publish_batch(approval_batch, repository, gateway)

        self.assertEqual(repository.status, "failed")
        result = persist_and_publish_batch(approval_batch, repository, gateway)

        self.assertEqual(result.database_batch_id, 73)
        self.assertEqual(repository.status, "published")
        self.assertEqual(
            [call[0] for call in repository.calls].count("persist_draft_batch"),
            2,
        )

    def test_every_value_range_quotes_and_escapes_its_a1_tab_name(self):
        gateway = FakeSheetsGateway()
        publish_projection(batch(), gateway)

        ranges = [
            details[1]
            for name, details in gateway.calls
            if name == "replace_values"
        ]
        self.assertGreaterEqual(len(ranges), 8)
        self.assertTrue(all(re.match(r"^'(?:''|[^'])+'!", value) for value in ranges))
        self.assertEqual(sheets_sync.a1_range("Manager's tab", "A1"), "'Manager''s tab'!A1")

    def test_publish_uses_exact_eight_tabs_and_exact_batch_totals_and_hash(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()

        result = publish_projection(approval_batch, gateway)

        self.assertEqual(tuple(gateway.titles), APPROVAL_TAB_TITLES)
        self.assertEqual(len(gateway.titles), 8)
        batch_meta = metadata(gateway, "Апрув batch")
        summary = metadata(gateway, "Сводка")
        for values in (batch_meta, summary):
            self.assertEqual(values["ready"], 1)
            self.assertEqual(values["conflict"], 1)
            self.assertEqual(values["unresolved"], 1)
            self.assertEqual(values["rejected"], 1)
            self.assertEqual(values["no_change"], 1)
            self.assertEqual(values["Всего"], 5)
            self.assertEqual(values["Published hash"], approval_batch.published_input_hash)
        self.assertEqual(result.total_count, 5)

    def test_publish_rejects_a_batch_whose_items_no_longer_match_published_hash(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        tampered = replace(
            approval_batch,
            items=(
                replace(
                    approval_batch.items[0],
                    final_direction_code="gastroenterology",
                ),
                *approval_batch.items[1:],
            ),
        )

        with self.assertRaises(ProjectionValidationError) as raised:
            publish_projection(tampered, gateway)

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(gateway.calls, [])

    def test_publish_protects_identity_proposals_and_hashes(self):
        gateway = FakeSheetsGateway()

        publish_projection(batch(), gateway)

        protected = [request for request in gateway.requests if "addProtectedRange" in request]
        self.assertTrue(protected)
        protected_descriptions = {
            request["addProtectedRange"]["protectedRange"]["description"]
            for request in protected
        }
        self.assertIn("identity-and-proposals-read-only", protected_descriptions)
        self.assertIn("input-and-row-hashes-read-only", protected_descriptions)

    def test_publish_adds_taxonomy_backed_final_validations_and_conflict_reason_rule(self):
        gateway = FakeSheetsGateway()

        publish_projection(batch(), gateway)

        validations = [request["setDataValidation"] for request in gateway.requests if "setDataValidation" in request]
        range_formulas = [
            value["userEnteredValue"]
            for validation in validations
            for value in validation["rule"]["condition"].get("values", [])
            if value.get("userEnteredValue", "").startswith("='Справочники'!")
        ]
        self.assertEqual(len(range_formulas), 12)
        self.assertTrue(all(validation["rule"]["strict"] for validation in validations))
        self.assertTrue(
            any(
                validation["rule"]["condition"]["type"] == "CUSTOM_FORMULA"
                and "decision_reason" in validation["rule"].get("inputMessage", "")
                for validation in validations
            )
        )

    def test_publish_adds_strict_batch_decision_dropdown(self):
        gateway = FakeSheetsGateway()

        publish_projection(batch(), gateway)

        batch_sheet_id = gateway.titles.index("Апрув batch") + 10
        decisions = [
            request["setDataValidation"]
            for request in gateway.requests
            if "setDataValidation" in request
            and request["setDataValidation"]["range"]["sheetId"] == batch_sheet_id
        ]
        self.assertEqual(len(decisions), 1)
        self.assertEqual(
            decisions[0]["rule"]["condition"],
            {
                "type": "ONE_OF_LIST",
                "values": [
                    {"userEnteredValue": "Ожидает"},
                    {"userEnteredValue": "Принять"},
                    {"userEnteredValue": "Отклонить"},
                ],
            },
        )
        self.assertTrue(decisions[0]["rule"]["strict"])

    def test_history_is_batch_audit_history_and_all_open_items_remain_visible(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()

        publish_projection(approval_batch, gateway)

        history = gateway.values["История"]
        self.assertEqual(tuple(history[0]), HISTORY_HEADERS)
        self.assertEqual(history[1][0], approval_batch.batch_key)
        self.assertEqual(history[1][1], approval_batch.published_input_hash)
        unresolved_headers = gateway.values["Не определено"][0]
        state_index = unresolved_headers.index("readiness_state")
        self.assertEqual(
            [row[state_index] for row in gateway.values["Не определено"][1:]],
            ["unresolved", "rejected", "no_change"],
        )

    def test_publish_neutralizes_formula_injection_in_display_values(self):
        gateway = FakeSheetsGateway()

        publish_projection(batch(), gateway)

        title_index = list(ITEM_HEADERS).index("title")
        self.assertEqual(gateway.values["Предложения"][1][title_index], "'=unsafe title")

    def test_read_accepts_only_ready_rows_and_keeps_every_other_state_open(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        gateway.edit_item("Предложения", 1, "final_direction_code", "gastroenterology")

        snapshot = read_accepted_projection(approval_batch, gateway)

        by_id = {approval.content_entity_id: approval for approval in snapshot.items}
        self.assertEqual(by_id[1].final_direction_code, "gastroenterology")
        self.assertEqual(by_id[1].readiness_state, "ready")
        self.assertEqual(by_id[2].readiness_state, "conflict")
        self.assertEqual(by_id[3].readiness_state, "unresolved")
        self.assertEqual(by_id[4].readiness_state, "rejected")
        self.assertEqual(by_id[5].readiness_state, "no_change")
        self.assertEqual(len(snapshot.items), 5)
        self.assertEqual(snapshot.accepted_count, 1)
        self.assertEqual(snapshot.skipped_count, 4)
        self.assertEqual(
            snapshot.accepted_decision_hash,
            compute_accepted_decision_hash(snapshot.items),
        )

    def test_read_accepts_only_the_exact_published_batch_decision(self):
        for forged in ("approve", "accepted", "принято", "Принять batch forged"):
            with self.subTest(forged=forged):
                gateway = FakeSheetsGateway()
                approval_batch = batch()
                publish_projection(approval_batch, gateway)
                gateway.accept()
                for row in gateway.values["Апрув batch"]:
                    if row[0] == "Решение":
                        row[1] = forged

                with self.assertRaises(ProjectionValidationError) as raised:
                    read_accepted_projection(approval_batch, gateway)

                self.assertEqual(raised.exception.code, "BATCH_NOT_ACCEPTED")

    def test_formatting_formulas_and_tab_order_do_not_change_accepted_hash(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        original = read_accepted_projection(approval_batch, gateway)

        gateway.requests.append({"repeatCell": {"format": "red"}})
        gateway.titles.reverse()
        gateway.values["Сводка"].append(["display formula", "=SUM(B2:B6)"])
        unchanged = read_accepted_projection(approval_batch, gateway)

        self.assertEqual(original.accepted_decision_hash, unchanged.accepted_decision_hash)

    def test_editable_reason_changes_accepted_hash(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        first = read_accepted_projection(approval_batch, gateway)
        gateway.edit_item("Предложения", 1, "decision_reason", "manager reviewed")

        second = read_accepted_projection(approval_batch, gateway)

        self.assertNotEqual(first.accepted_decision_hash, second.accepted_decision_hash)

    def test_read_rejects_formula_in_an_editable_decision_cell(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        gateway.edit_item("Предложения", 1, "decision_reason", "=HYPERLINK(\"x\")")

        with self.assertRaises(ProjectionValidationError) as raised:
            read_accepted_projection(approval_batch, gateway)

        self.assertEqual(raised.exception.code, "SHEET_FORMULA_NOT_ALLOWED")

    def test_read_rejects_missing_or_duplicate_rows(self):
        for mutation, expected_code in (
            (lambda gateway: gateway.values["Предложения"].pop(), "SHEET_ROW_COUNT_MISMATCH"),
            (
                lambda gateway: gateway.values["Предложения"].append(
                    list(gateway.values["Предложения"][1])
                ),
                "DUPLICATE_ROW_HASH",
            ),
        ):
            with self.subTest(expected_code=expected_code):
                gateway = FakeSheetsGateway()
                approval_batch = batch()
                publish_projection(approval_batch, gateway)
                gateway.accept()
                mutation(gateway)
                with self.assertRaises(ProjectionValidationError) as raised:
                    read_accepted_projection(approval_batch, gateway)
                self.assertEqual(raised.exception.code, expected_code)

    def test_read_rejects_a_row_moved_to_the_wrong_state_tab(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        moved = gateway.values["Предложения"].pop(1)
        gateway.values["Конфликты"].append(moved)

        with self.assertRaises(ProjectionValidationError) as raised:
            read_accepted_projection(approval_batch, gateway)

        self.assertEqual(raised.exception.code, "SHEET_TAB_STATE_MISMATCH")

    def test_read_rejects_unknown_taxonomy_and_edited_identity_hash_cells(self):
        cases = (
            ("final_direction_code", "invented", "TAXONOMY_CODE_INVALID"),
            ("content_entity_id", "999", "SHEET_IDENTITY_MISMATCH"),
            ("input_hash", "f" * 64, "SHEET_IDENTITY_MISMATCH"),
            ("row_hash", "f" * 64, "SHEET_IDENTITY_MISMATCH"),
        )
        for column, value, expected_code in cases:
            with self.subTest(column=column):
                gateway = FakeSheetsGateway()
                approval_batch = batch()
                publish_projection(approval_batch, gateway)
                gateway.accept()
                gateway.edit_item("Предложения", 1, column, value)
                with self.assertRaises(ProjectionValidationError) as raised:
                    read_accepted_projection(approval_batch, gateway)
                self.assertEqual(raised.exception.code, expected_code)

    def test_read_requires_reason_for_an_edited_conflict(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        gateway.edit_item("Конфликты", 2, "final_direction_code", "gastroenterology")

        with self.assertRaises(ProjectionValidationError) as raised:
            read_accepted_projection(approval_batch, gateway)

        self.assertEqual(raised.exception.code, "CONFLICT_REASON_REQUIRED")

    def test_read_rejects_summary_count_mismatch(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()
        for row in gateway.values["Сводка"]:
            if row[0] == "ready":
                row[1] = 99

        with self.assertRaises(ProjectionValidationError) as raised:
            read_accepted_projection(approval_batch, gateway)

        self.assertEqual(raised.exception.code, "SHEET_COUNT_MISMATCH")

    def test_directionless_row_is_retained_as_unresolved(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_projection(approval_batch, gateway)
        gateway.accept()

        snapshot = read_accepted_projection(approval_batch, gateway)

        unresolved = next(item for item in snapshot.items if item.content_entity_id == 3)
        self.assertIsNone(unresolved.final_direction_code)
        self.assertEqual(unresolved.readiness_state, "unresolved")

    def test_reading_acceptance_never_writes_external_or_database_state(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        repository = FakeRepository(approval_batch)
        publish_projection(approval_batch, gateway, repository)
        gateway.accept()
        before_repository = list(repository.calls)
        before_sheet_writes = len(
            [name for name, _ in gateway.calls if name in ("replace_values", "batch_update")]
        )

        read_accepted_projection(approval_batch, gateway)

        self.assertEqual(repository.calls, before_repository)
        self.assertEqual(
            len([name for name, _ in gateway.calls if name in ("replace_values", "batch_update")]),
            before_sheet_writes,
        )

    def test_explicit_post_accept_api_persists_then_projects_repository_history(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        repository = FakeRepository(approval_batch)
        publish_projection(approval_batch, gateway, repository)
        gateway.accept()

        snapshot = persist_accepted_projection(
            persisted(approval_batch),
            gateway,
            repository,
        )

        self.assertEqual(repository.status, "accepted")
        record_index = next(
            index for index, call in enumerate(repository.calls) if call[0] == "record_batch_acceptance"
        )
        history_index = max(
            index for index, call in enumerate(gateway.calls) if call[0] == "replace_values"
        )
        self.assertGreaterEqual(history_index, 0)
        self.assertLess(record_index, len(repository.calls))
        history = gateway.values["История"]
        self.assertEqual(history[1][2], snapshot.accepted_decision_hash)
        self.assertEqual(history[1][3], "manager")
        self.assertEqual(history[1][-3], "accepted")
        batch_meta = metadata(gateway, "Апрув batch")
        self.assertEqual(
            batch_meta["Accepted decision hash"],
            snapshot.accepted_decision_hash,
        )
        self.assertEqual(batch_meta["Решение"], "Принять")


if __name__ == "__main__":
    unittest.main()
