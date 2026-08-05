"""Fake-gateway tests for the database-backed Sheets approval projection."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from agents.abbott_page_classifier import sheets_sync
from agents.abbott_page_classifier.batch_service import (
    PersistedApprovalBatch,
    build_batch,
    compute_accepted_decision_hash,
)
from agents.abbott_page_classifier.domain import ApprovalItem, TaxonomyVersion
from agents.abbott_page_classifier.sheets_sync import (
    APPROVAL_TAB_TITLES,
    HISTORY_HEADERS,
    ITEM_HEADERS,
    ProjectionValidationError,
    persist_and_publish_batch,
    publish_batch_projection,
    read_accepted_projection,
)


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
    taxonomy = TaxonomyVersion(
        version="abbott.v1",
        terms={
            "direction": ("cardiology", "gastroenterology", "undetermined"),
            "material_type": ("articles", "video"),
            "access": ("doctors", "all", "unspecified"),
            "lifecycle": ("active", "archive_candidate", "archived", "unknown"),
        },
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
    )


def persisted(approval_batch):
    return PersistedApprovalBatch(batch=approval_batch, database_batch_id=73)


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
        title = range_name.split("!", 1)[0]
        self.values[title] = [list(row) for row in values]

    def read_values(self, spreadsheet_id, range_name):
        self.calls.append(("read_values", (spreadsheet_id, range_name)))
        title = range_name.split("!", 1)[0]
        return [list(row) for row in self.values.get(title, [])]

    def batch_update(self, spreadsheet_id, requests):
        self.calls.append(("batch_update", spreadsheet_id))
        self.requests.extend(requests)

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
    def test_publish_rejects_an_unpersisted_batch_before_any_gateway_call(self):
        gateway = FakeSheetsGateway()

        with self.assertRaises(ProjectionValidationError) as raised:
            publish_batch_projection(batch(), gateway)

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

    def test_legacy_publish_and_pull_cli_fail_closed_before_google_access(self):
        for argv in (("publish",), ("pull-approved",)):
            with self.subTest(argv=argv), patch.object(
                sheets_sync,
                "services",
                side_effect=AssertionError("Google service must not be constructed"),
            ) as service:
                with self.assertRaises(SystemExit) as raised:
                    sheets_sync.main(list(argv))
                self.assertEqual(
                    str(raised.exception),
                    "CANONICAL_DB_BATCH_REQUIRED",
                )
                service.assert_not_called()

    def test_persist_and_publish_finishes_all_database_writes_before_sheet_write(self):
        events: list[str] = []

        class Repository:
            def create_batch(self, approval_batch):
                events.append("db:create")
                return 73

            def insert_items(self, batch_id, items):
                events.append("db:items")

        class Gateway(FakeSheetsGateway):
            def ensure_tabs(self, spreadsheet_id, titles):
                events.append("sheet:ensure")
                return super().ensure_tabs(spreadsheet_id, titles)

        gateway = Gateway()

        result = persist_and_publish_batch(batch(), Repository(), gateway)

        self.assertEqual(events[:3], ["db:create", "db:items", "sheet:ensure"])
        self.assertEqual(result.database_batch_id, 73)

    def test_publish_uses_exact_eight_tabs_and_exact_batch_totals_and_hash(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()

        result = publish_batch_projection(persisted(approval_batch), gateway)

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
            publish_batch_projection(persisted(tampered), gateway)

        self.assertEqual(raised.exception.code, "BATCH_HASH_MISMATCH")
        self.assertEqual(gateway.calls, [])

    def test_publish_protects_identity_proposals_and_hashes(self):
        gateway = FakeSheetsGateway()

        publish_batch_projection(persisted(batch()), gateway)

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

        publish_batch_projection(persisted(batch()), gateway)

        validations = [request["setDataValidation"] for request in gateway.requests if "setDataValidation" in request]
        range_formulas = [
            value["userEnteredValue"]
            for validation in validations
            for value in validation["rule"]["condition"].get("values", [])
            if value.get("userEnteredValue", "").startswith("=Справочники!")
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

        publish_batch_projection(persisted(batch()), gateway)

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

        publish_batch_projection(persisted(approval_batch), gateway)

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

        publish_batch_projection(persisted(batch()), gateway)

        title_index = list(ITEM_HEADERS).index("title")
        self.assertEqual(gateway.values["Предложения"][1][title_index], "'=unsafe title")

    def test_read_accepts_only_ready_rows_and_keeps_every_other_state_open(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_batch_projection(persisted(approval_batch), gateway)
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
        self.assertEqual(
            snapshot.accepted_decision_hash,
            compute_accepted_decision_hash(snapshot.items),
        )

    def test_read_accepts_only_the_exact_published_batch_decision(self):
        for forged in ("approve", "accepted", "принято", "Принять batch forged"):
            with self.subTest(forged=forged):
                gateway = FakeSheetsGateway()
                approval_batch = batch()
                publish_batch_projection(persisted(approval_batch), gateway)
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
        publish_batch_projection(persisted(approval_batch), gateway)
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
        publish_batch_projection(persisted(approval_batch), gateway)
        gateway.accept()
        first = read_accepted_projection(approval_batch, gateway)
        gateway.edit_item("Предложения", 1, "decision_reason", "manager reviewed")

        second = read_accepted_projection(approval_batch, gateway)

        self.assertNotEqual(first.accepted_decision_hash, second.accepted_decision_hash)

    def test_read_rejects_formula_in_an_editable_decision_cell(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_batch_projection(persisted(approval_batch), gateway)
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
                publish_batch_projection(persisted(approval_batch), gateway)
                gateway.accept()
                mutation(gateway)
                with self.assertRaises(ProjectionValidationError) as raised:
                    read_accepted_projection(approval_batch, gateway)
                self.assertEqual(raised.exception.code, expected_code)

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
                publish_batch_projection(persisted(approval_batch), gateway)
                gateway.accept()
                gateway.edit_item("Предложения", 1, column, value)
                with self.assertRaises(ProjectionValidationError) as raised:
                    read_accepted_projection(approval_batch, gateway)
                self.assertEqual(raised.exception.code, expected_code)

    def test_read_requires_reason_for_an_edited_conflict(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_batch_projection(persisted(approval_batch), gateway)
        gateway.accept()
        gateway.edit_item("Конфликты", 2, "final_direction_code", "gastroenterology")

        with self.assertRaises(ProjectionValidationError) as raised:
            read_accepted_projection(approval_batch, gateway)

        self.assertEqual(raised.exception.code, "CONFLICT_REASON_REQUIRED")

    def test_read_rejects_summary_count_mismatch(self):
        gateway = FakeSheetsGateway()
        approval_batch = batch()
        publish_batch_projection(persisted(approval_batch), gateway)
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
        publish_batch_projection(persisted(approval_batch), gateway)
        gateway.accept()

        snapshot = read_accepted_projection(approval_batch, gateway)

        unresolved = next(item for item in snapshot.items if item.content_entity_id == 3)
        self.assertIsNone(unresolved.final_direction_code)
        self.assertEqual(unresolved.readiness_state, "unresolved")


if __name__ == "__main__":
    unittest.main()
