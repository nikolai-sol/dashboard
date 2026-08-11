"""Task 9A corrected run-id/batch-id CLI and concrete factory contracts."""

from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from agents.abbott_page_classifier.workflow import (
    WorkflowConfigurationError,
    WorkflowDependencies,
    ProductionWorkflowGateway,
    _materializer_db_connection,
    _workflow_db_connection,
    build_production_dependencies,
    main,
)


class CorrectedRecordingGateway:
    def __init__(self):
        self.calls = []

    def reconcile(self, registry1, registry2, *, dry_run):
        self.calls.append(("reconcile", dry_run))
        return {"status": "dry_run" if dry_run else "reconciled", "run_id": 12, "run_key": "a" * 64}

    def classify(self, run_id, *, execute_llm, dry_run):
        self.calls.append(("classify", (run_id, execute_llm, dry_run)))
        return {"status": "dry_run" if dry_run else "finalized", "batch_id": 73, "batch_key": "abbott-batch"}

    def publish_projection(self, batch_id, *, dry_run):
        self.calls.append(("publish-projection", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "published", "batch_id": int(batch_id)}

    def pull_accepted(self, batch_id, *, dry_run):
        self.calls.append(("pull-accepted", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "accepted_snapshot_ready", "batch_id": int(batch_id)}

    def ingest(self, batch_id, *, dry_run):
        self.calls.append(("ingest", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "ingested", "batch_id": int(batch_id)}

    def materialize(self, batch_id, *, dry_run):
        self.calls.append(("materialize", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "candidate_materialized", "batch_id": int(batch_id)}

    def validate(self, batch_id, *, dry_run):
        self.calls.append(("validate", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "validated", "batch_id": int(batch_id)}

    def status(self, batch_id, *, dry_run):
        self.calls.append(("status", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "published", "batch_id": int(batch_id)}


class CorrectedWorkflowCliTests(unittest.TestCase):
    def run_cli(self, arguments, gateway):
        output = io.StringIO()
        with redirect_stdout(output):
            code = main(arguments, dependencies=WorkflowDependencies(gateway))
        return code, json.loads(output.getvalue())

    def test_reconcile_execute_creates_run_without_batch_id(self):
        gateway = CorrectedRecordingGateway()
        code, result = self.run_cli(
            [
                "reconcile", "--registry1", "one.xlsx", "--registry2", "two.csv",
                "--execute",
            ],
            gateway,
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["run_id"], 12)
        self.assertEqual(gateway.calls, [("reconcile", False)])

        code, result = self.run_cli(
            [
                "reconcile", "--registry1", "one.xlsx", "--registry2", "two.csv",
                "--batch-id", "9", "--execute",
            ],
            gateway,
        )
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "IDENTIFIER_INVALID")

    def test_classify_execute_requires_numeric_run_id_and_forbids_batch_id(self):
        gateway = CorrectedRecordingGateway()
        code, result = self.run_cli(["classify", "--execute"], gateway)
        self.assertEqual((code, result["status"]), (2, "RUN_ID_REQUIRED"))
        code, result = self.run_cli(["classify", "--run-id", "abc", "--execute"], gateway)
        self.assertEqual((code, result["status"]), (2, "RUN_ID_INVALID"))
        code, result = self.run_cli(["classify", "--batch-id", "9", "--execute"], gateway)
        self.assertEqual((code, result["status"]), (2, "IDENTIFIER_INVALID"))
        code, result = self.run_cli(["classify", "--run-id", "12", "--execute"], gateway)
        self.assertEqual(code, 0)
        self.assertEqual(result["batch_id"], 73)

    def test_batch_stages_require_numeric_batch_id_and_reject_run_id(self):
        gateway = CorrectedRecordingGateway()
        for command in ("publish-projection", "pull-accepted", "ingest", "materialize", "validate", "status"):
            with self.subTest(command=command):
                code, result = self.run_cli([command, "--execute"], gateway)
                self.assertEqual((code, result["status"]), (2, "BATCH_ID_REQUIRED"))
                code, result = self.run_cli([command, "--batch-id", "batch-9", "--execute"], gateway)
                self.assertEqual((code, result["status"]), (2, "BATCH_ID_INVALID"))
                code, result = self.run_cli([command, "--run-id", "12", "--execute"], gateway)
                self.assertEqual((code, result["status"]), (2, "IDENTIFIER_INVALID"))

    def test_execute_llm_without_execute_is_zero_dispatch(self):
        gateway = CorrectedRecordingGateway()
        code, result = self.run_cli(
            ["classify", "--run-id", "12", "--execute-llm"], gateway
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(gateway.calls, [])

    def test_read_only_stages_run_without_execute_but_explicit_dry_run_is_zero_dispatch(self):
        gateway = CorrectedRecordingGateway()
        dependencies = WorkflowDependencies(gateway)

        for command in ("pull-accepted", "status"):
            with self.subTest(command=command):
                self.assertEqual(main([command, "--batch-id", "7"], dependencies=dependencies), 0)
        self.assertEqual(
            [call[0] for call in gateway.calls],
            ["pull-accepted", "status"],
        )
        gateway.calls.clear()
        for command in ("pull-accepted", "validate", "status"):
            with self.subTest(command=command):
                self.assertEqual(main([command, "--dry-run"], dependencies=dependencies), 0)
        self.assertEqual(gateway.calls, [])

    def test_validate_requires_explicit_execute_because_it_transitions_release(self):
        gateway = CorrectedRecordingGateway()
        dependencies = WorkflowDependencies(gateway)

        code, result = self.run_cli(
            ["validate", "--batch-id", "7"], gateway
        )
        self.assertEqual((code, result["status"]), (0, "dry_run"))
        self.assertEqual(gateway.calls, [])

        code, result = self.run_cli(
            ["validate", "--batch-id", "7", "--execute"], gateway
        )
        self.assertEqual((code, result["status"]), (0, "validated"))
        self.assertEqual(gateway.calls, [("validate", (7, False))])

    def test_default_production_dependencies_are_lazy_and_have_no_missing_authority(self):
        calls = []
        dependencies = build_production_dependencies(
            store_factory=lambda: calls.append("store") or object(),
            sheets_gateway_factory=lambda *_args: calls.append("sheets") or object(),
        )
        self.assertNotIn("_missing_authority", dependencies.gateway.__dict__)
        code, result = self.run_cli(
            ["classify", "--run-id", "12", "--dry-run"], dependencies.gateway
        )
        self.assertEqual((code, result["status"]), (0, "dry_run"))
        self.assertEqual(calls, [])

    def test_workflow_database_authority_requires_its_dedicated_role_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                WorkflowConfigurationError, "WORKFLOW_DB_CONFIGURATION_INVALID"
            ):
                _workflow_db_connection()

    def test_materializer_database_authority_has_no_generic_db_fallback(self):
        with patch.dict(
            os.environ,
            {
                "MYSQL_HOST": "generic-host",
                "MYSQL_DATABASE": "report_bd",
                "MYSQL_USER": "generic-user",
                "MYSQL_PASSWORD": "generic-secret",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(
                WorkflowConfigurationError,
                "MATERIALIZER_DB_CONFIGURATION_INVALID",
            ):
                _materializer_db_connection()

    def test_materializer_database_uses_only_dedicated_reviewed_environment(self):
        sentinel = object()
        environment = {
            "ABBOTT_CONTENT_MATERIALIZER_DB_HOST": "materializer-db",
            "ABBOTT_CONTENT_MATERIALIZER_DB_PORT": "3307",
            "ABBOTT_CONTENT_MATERIALIZER_DB_NAME": "report_bd",
            "ABBOTT_CONTENT_MATERIALIZER_DB_USER": "materializer-role",
            "ABBOTT_CONTENT_MATERIALIZER_DB_PASSWORD": "reviewed-secret",
            "MYSQL_HOST": "must-not-be-used",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch("mysql.connector.connect", return_value=sentinel) as connect,
        ):
            result = _materializer_db_connection()

        self.assertIs(result, sentinel)
        connect.assert_called_once_with(
            host="materializer-db",
            port=3307,
            database="report_bd",
            user="materializer-role",
            password="reviewed-secret",
            charset="utf8mb4",
            collation="utf8mb4_unicode_ci",
        )

    def test_production_ingest_resumes_an_accepted_batch_from_canonical_db(self):
        snapshot = SimpleNamespace(accepted_decision_hash="c" * 64)

        class Store:
            def load_batch_history(self, batch_id):
                self.batch_id = batch_id
                return SimpleNamespace(batch_status="accepted")

            def load_accepted_snapshot(self, batch_id):
                self.snapshot_batch_id = batch_id
                return snapshot

        store = Store()
        gateway = ProductionWorkflowGateway(
            store_factory=lambda: store,
            service_factory=lambda _store: None,
            sheets_gateway_factory=lambda _spreadsheet_id: self.fail("Sheets reached"),
        )
        result = SimpleNamespace(
            status="ingested", accepted_count=2, conflict_count=1,
            unresolved_count=0, rejected_count=0,
        )
        with patch(
            "agents.abbott_page_classifier.batch_service.ingest_accepted_batch",
            return_value=result,
        ) as ingest:
            receipt = gateway.ingest(73, dry_run=False)

        ingest.assert_called_once_with(snapshot, store)
        self.assertEqual((store.batch_id, store.snapshot_batch_id), (73, 73))
        self.assertEqual(receipt["status"], "ingested")

    def test_published_projection_replay_is_noop_before_sheet_or_batch_load(self):
        class Store:
            def load_batch_history(self, batch_id):
                self.batch_id = batch_id
                return SimpleNamespace(
                    batch_status="published",
                    batch_key="abbott-batch",
                    published_input_hash="a" * 64,
                    spreadsheet_file_id="sheet-123",
                    spreadsheet_projection_hash="b" * 64,
                    ready_count=2,
                    conflict_count=1,
                    unresolved_count=3,
                    rejected_count=4,
                    no_change_count=5,
                )

            def load_persisted_batch(self, _batch_id):
                raise AssertionError("published batch must not be reloaded for overwrite")

        store = Store()
        gateway = ProductionWorkflowGateway(
            store_factory=lambda: store,
            service_factory=lambda _store: None,
            sheets_gateway_factory=lambda _spreadsheet_id: self.fail("Sheets reached"),
        )

        receipt = gateway.publish_projection(73, dry_run=False)

        self.assertEqual(store.batch_id, 73)
        self.assertEqual(receipt, {
            "status": "noop",
            "batch_id": 73,
            "batch_key": "abbott-batch",
            "ready_count": 2,
            "conflict_count": 1,
            "unresolved_count": 3,
            "rejected_count": 4,
            "no_change_count": 5,
            "published_input_hash": "a" * 64,
        })

    def test_materialize_retry_uses_stored_candidate_receipt_across_processes(self):
        shared = {
            "history": SimpleNamespace(
                batch_status="ingested", candidate_release_id=None
            ),
            "materializer_calls": 0,
        }

        class Store:
            def load_batch_history(self, batch_id):
                self.batch_id = batch_id
                return shared["history"]

            def load_predecessor_release_id_for_batch(self, batch_id):
                self.predecessor_batch_id = batch_id
                return 8

        def materializer(batch_id, predecessor_id, code_revision):
            shared["materializer_calls"] += 1
            shared["history"] = SimpleNamespace(
                batch_status="candidate_materialized", candidate_release_id=44
            )
            return SimpleNamespace(
                status="candidate_materialized", candidate_release_id=44
            )

        with patch.dict(os.environ, {
            "CODE_REVISION": "a" * 40,
            "ABBOTT_CONTENT_PROMPT_VERSION": "prompt.v1",
            "ABBOTT_CONTENT_MODEL_ROUTING_VERSION": "routing.v1",
        }, clear=True):
            first = ProductionWorkflowGateway(
                store_factory=Store, materializer=materializer
            ).materialize(73, dry_run=False)
            retry = ProductionWorkflowGateway(
                store_factory=Store, materializer=materializer
            ).materialize(73, dry_run=False)

        self.assertEqual(first["candidate_release_id"], 44)
        self.assertEqual(retry, {
            "status": "noop", "batch_id": 73, "candidate_release_id": 44,
        })
        self.assertEqual(shared["materializer_calls"], 1)

    def test_default_materialize_and_validate_receive_separate_db_factories(self):
        materializer_factory = lambda: object()
        operator_factory = lambda: object()

        class Store:
            def __init__(self):
                self.stage = "ingested"

            def load_batch_history(self, _batch_id):
                if self.stage == "ingested":
                    return SimpleNamespace(
                        batch_status="ingested", candidate_release_id=None
                    )
                return SimpleNamespace(
                    batch_status="candidate_materialized",
                    candidate_release_id=44,
                    accepted_decision_hash="a" * 64,
                    ready_count=1,
                    conflict_count=0,
                    unresolved_count=0,
                    rejected_count=0,
                    no_change_count=0,
                    accepted_count=1,
                )

            def load_predecessor_release_id_for_batch(self, _batch_id):
                return 8

        store = Store()
        gateway = ProductionWorkflowGateway(
            store_factory=lambda: store,
            materializer_connection_factory=materializer_factory,
            operator_connection_factory=operator_factory,
        )
        environment = {
            "CODE_REVISION": "a" * 40,
            "ABBOTT_CONTENT_PROMPT_VERSION": "prompt.v1",
            "ABBOTT_CONTENT_MODEL_ROUTING_VERSION": "routing.v1",
            "ABBOTT_CONTENT_VALIDATION_REVIEWED_BY": "content-manager",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch(
                "agents.abbott_page_classifier.candidate_release.materialize_content_candidate",
                return_value=SimpleNamespace(
                    status="candidate_materialized", candidate_release_id=44
                ),
            ) as materialize,
        ):
            gateway.materialize(73, dry_run=False)
        materialize.assert_called_once_with(
            73,
            8,
            "a" * 40,
            connection_factory=materializer_factory,
        )

        store.stage = "candidate_materialized"
        with (
            patch.dict(os.environ, environment, clear=True),
            patch(
                "agents.abbott_page_classifier.candidate_release.validate_and_transition_content_candidate",
                return_value=SimpleNamespace(passed=True, candidate_release_id=44),
            ) as validate,
        ):
            receipt = gateway.validate(73, dry_run=False)
        self.assertEqual(receipt["status"], "validated")
        call = validate.call_args
        self.assertIs(call.kwargs["materializer_connection_factory"], materializer_factory)
        self.assertIs(call.kwargs["operator_connection_factory"], operator_factory)
        self.assertEqual(call.kwargs["reviewed_by"], "content-manager")

    def test_materialize_fails_closed_on_inconsistent_candidate_receipt(self):
        class Store:
            def __init__(self, history):
                self.history = history

            def load_batch_history(self, _batch_id):
                return self.history

            def load_predecessor_release_id_for_batch(self, _batch_id):
                self.fail = True
                return 8

        materializer_calls = []
        for history in (
            SimpleNamespace(batch_status="candidate_materialized", candidate_release_id=None),
            SimpleNamespace(batch_status="ingested", candidate_release_id=44),
        ):
            with self.subTest(history=history):
                gateway = ProductionWorkflowGateway(
                    store_factory=lambda history=history: Store(history),
                    materializer=lambda *_args: materializer_calls.append(1),
                )
                with self.assertRaisesRegex(
                    WorkflowConfigurationError, "CANDIDATE_RECEIPT_INCONSISTENT"
                ):
                    gateway.materialize(73, dry_run=False)
        self.assertEqual(materializer_calls, [])


if __name__ == "__main__":
    unittest.main()
