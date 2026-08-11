"""Operator CLI safety contracts, using only offline recording fakes."""

from __future__ import annotations

import os
from pathlib import Path
import io
import json
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from agents.abbott_page_classifier.workflow import (
    COMMANDS,
    WorkflowDependencies,
    build_production_dependencies,
    main,
)


class RecordingGateway:
    def __init__(self, *, eligible: int = 0):
        self.eligible = eligible
        self.calls: list[tuple[str, object]] = []
        self.sheet_calls = 0
        self.openai_calls = 0
        self.activation_calls = 0

    def reconcile(self, registry1, registry2, *, dry_run):
        self.calls.append(("reconcile", dry_run))
        return {"status": "dry_run", "source_count": 2, "ready_count": 1,
                "conflict_count": 0, "unresolved_count": 0, "rejected_count": 0,
                "registry1_hash": "a" * 64, "registry2_hash": "b" * 64}

    def eligible_classification_count(self, batch_id):
        self.calls.append(("eligible", batch_id))
        return self.eligible

    def classify(self, batch_id, *, execute_llm, dry_run):
        self.calls.append(("classify", (batch_id, execute_llm, dry_run)))
        if execute_llm:
            self.openai_calls += 1
        return {"status": "dry_run" if dry_run else "classified", "eligible_count": self.eligible}

    def publish_projection(self, batch_id, *, dry_run):
        self.calls.append(("publish-projection", (batch_id, dry_run)))
        if not dry_run:
            self.sheet_calls += 1
        return {"status": "dry_run" if dry_run else "published", "ready_count": 1}

    def publish_local(self, batch_id, decision_file, *, dry_run):
        self.calls.append(("publish_local", batch_id, Path(decision_file)))
        return {"status": "dry_run" if dry_run else "published", "batch_id": batch_id}

    def accept_local(self, batch_id, decision_file, *, dry_run):
        self.calls.append(("accept_local", batch_id, Path(decision_file)))
        return {"status": "dry_run" if dry_run else "accepted", "batch_id": batch_id}

    def pull_accepted(self, batch_id, *, dry_run):
        self.calls.append(("pull-accepted", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "accepted", "accepted_count": 1}

    def ingest(self, batch_id, *, dry_run):
        self.calls.append(("ingest", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "ingested", "accepted_count": 1}

    def materialize(self, batch_id, *, dry_run):
        self.calls.append(("materialize", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "candidate_materialized", "candidate_release_id": 42}

    def validate(self, batch_id, *, dry_run):
        self.calls.append(("validate", (batch_id, dry_run)))
        return {"status": "dry_run" if dry_run else "validated", "candidate_release_id": 42}

    def status(self, batch_id, *, dry_run):
        self.calls.append(("status", (batch_id, dry_run)))
        return {"status": "draft", "candidate_release_id": 42}


class WorkflowTests(unittest.TestCase):
    def test_production_builder_is_lazy_and_offline_reconcile_never_builds_a_repository(self):
        store_calls: list[str] = []
        dependencies = build_production_dependencies(
            store_factory=lambda: store_calls.append("store") or object(),
        )
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main([
                "reconcile", "--registry1", "tests/fixtures/abbott_registry1_minimal.xlsx",
                "--registry2", "tests/fixtures/abbott_registry2_accepted_minimal.csv", "--dry-run",
            ], dependencies=dependencies), 0)
        self.assertEqual(store_calls, [])
        self.assertEqual(json.loads(output.getvalue())["status"], "dry_run")

    def test_real_fixture_reconcile_is_offline_and_reports_exact_accounting(self):
        self.assertEqual(
            main([
                "reconcile", "--registry1", "tests/fixtures/abbott_registry1_minimal.xlsx",
                "--registry2", "tests/fixtures/abbott_registry2_accepted_minimal.csv", "--execute",
            ]),
            2,
        )
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [
                    "reconcile",
                    "--registry1", "tests/fixtures/abbott_registry1_minimal.xlsx",
                    "--registry2", "tests/fixtures/abbott_registry2_accepted_minimal.csv",
                    "--dry-run",
                ]
            )

        report = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertEqual(report["status"], "dry_run")
        self.assertEqual(report["source_count"], 9)
        self.assertEqual(report["ready_count"] + report["unresolved_count"] + report["rejected_count"], 8)
        self.assertEqual(len(report["registry1_hash"]), 64)
        self.assertEqual(len(report["registry2_hash"]), 64)

    def test_legacy_shell_wrapper_delegates_to_safe_workflow_without_sheets_body(self):
        wrapper = Path("agents/abbott_page_classifier/run_classifier.sh").read_text(encoding="utf-8")

        self.assertIn('workflow.py', wrapper)
        self.assertNotIn('sheets_sync.py publish', wrapper)
        self.assertNotIn('AUTO_PUBLISH_SHEETS', wrapper)

    def test_wrapper_is_executable_and_no_args_fails_with_sanitized_compatibility_status(self):
        path = Path("agents/abbott_page_classifier/run_classifier.sh")
        result = subprocess.run([str(path)], text=True, capture_output=True, check=False)

        self.assertTrue(os.access(path, os.X_OK))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["status"], "COMPATIBILITY_WORKFLOW_ARGUMENTS_REQUIRED")
        self.assertEqual(result.stderr, "")

    def test_cli_rejects_execute_and_dry_run_together_without_dispatch(self):
        gateway = RecordingGateway()
        self.assertEqual(main(["materialize", "--batch-id", "1", "--execute", "--dry-run"], dependencies=WorkflowDependencies(gateway)), 2)
        self.assertEqual(gateway.calls, [])

    def test_production_validate_dry_run_never_constructs_repository(self):
        calls: list[str] = []
        dependencies = build_production_dependencies(
            store_factory=lambda: calls.append("store") or object(),
        )

        self.assertEqual(main(["validate", "--batch-id", "1", "--dry-run"], dependencies=dependencies), 0)
        self.assertEqual(calls, [])

    def test_production_reconcile_execute_uses_canonical_workflow_service(self):
        calls: list[tuple[str, str]] = []

        class Receipt:
            run_id = 7
            run_key = "a" * 64
            source_count = 2
            rejected_count = 0

        class Service:
            def reconcile(self, registry1, registry2):
                calls.append((registry1.name, registry2.name))
                return Receipt()

        dependencies = build_production_dependencies(
            store_factory=lambda: object(),
            service_factory=lambda _store: Service(),
        )
        self.assertEqual(main([
            "reconcile", "--registry1", "tests/fixtures/abbott_registry1_minimal.xlsx",
            "--registry2", "tests/fixtures/abbott_registry2_accepted_minimal.csv",
            "--execute",
        ], dependencies=dependencies), 0)
        self.assertEqual(calls, [("abbott_registry1_minimal.xlsx", "abbott_registry2_accepted_minimal.csv")])

    def test_command_surface_is_fixed(self):
        self.assertEqual(
            COMMANDS,
            ("reconcile", "classify", "publish-projection", "publish-local", "accept-local", "pull-accepted", "ingest", "materialize", "validate", "status"),
        )

    def test_publish_local_defaults_to_dry_run_without_opening_file(self):
        gateway = RecordingGateway()

        self.assertEqual(main([
            "publish-local", "--batch-id", "8", "--decision-file", "/private/decision.json",
        ], dependencies=WorkflowDependencies(gateway)), 0)

        self.assertEqual(gateway.calls, [])

    def test_accept_local_requires_execute_and_exact_batch(self):
        gateway = RecordingGateway()
        decision_file = "/private/decision.json"

        self.assertEqual(main([
            "accept-local", "--batch-id", "8", "--decision-file", decision_file, "--execute",
        ], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertEqual(gateway.calls, [("accept_local", 8, Path(decision_file))])

    def test_decision_file_is_rejected_for_non_local_commands(self):
        gateway = RecordingGateway()

        self.assertEqual(main([
            "status", "--batch-id", "8", "--decision-file", "/private/decision.json",
        ], dependencies=WorkflowDependencies(gateway)), 2)
        self.assertEqual(gateway.calls, [])

    def test_reconcile_is_offline_dry_run_and_reports_only_sanitized_counts_hashes(self):
        gateway = RecordingGateway()
        result = main(
            ["reconcile", "--registry1", "one.xlsx", "--registry2", "two.csv"],
            dependencies=WorkflowDependencies(gateway),
        )

        self.assertEqual(result, 0)
        self.assertEqual(gateway.calls, [("reconcile", True)])

    def test_write_stages_default_dry_while_read_stages_require_a_numeric_batch(self):
        gateway = RecordingGateway()
        for command in ("publish-projection", "ingest", "materialize", "validate"):
            with self.subTest(command=command):
                self.assertEqual(main([command], dependencies=WorkflowDependencies(gateway)), 0)
                self.assertEqual(main([command, "--execute"], dependencies=WorkflowDependencies(gateway)), 2)
                self.assertEqual(main([command, "--batch-id", "1", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        for command in ("pull-accepted", "status"):
            with self.subTest(command=command):
                self.assertEqual(main([command], dependencies=WorkflowDependencies(gateway)), 2)
                self.assertEqual(main([command, "--dry-run"], dependencies=WorkflowDependencies(gateway)), 0)
                self.assertEqual(main([command, "--batch-id", "1"], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertEqual(main(["classify", "--execute"], dependencies=WorkflowDependencies(gateway)), 2)
        self.assertEqual(main(["classify", "--run-id", "1", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertIn(("classify", (1, False, False)), gateway.calls)
        self.assertTrue(
            all(
                call[1][1] is False
                for call in gateway.calls
                if call[0] in {"publish-projection", "pull-accepted", "ingest", "materialize", "validate"}
                and call[1][0] == 1
            )
        )
        self.assertEqual(gateway.sheet_calls, 1)
        self.assertEqual(gateway.activation_calls, 0)

    def test_llm_execution_requires_explicit_execute_and_run_id(self):
        gateway = RecordingGateway(eligible=1)
        self.assertEqual(main(["classify", "--run-id", "7", "--execute-llm"], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertEqual(gateway.openai_calls, 0)
        self.assertEqual(main(["classify", "--run-id", "7", "--execute-llm", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertEqual(gateway.openai_calls, 1)

    def test_sheet_write_is_limited_to_non_dry_publish_and_materialize_never_activates(self):
        gateway = RecordingGateway()
        dependencies = WorkflowDependencies(gateway)
        self.assertEqual(main(["materialize", "--batch-id", "1", "--execute"], dependencies=dependencies), 0)
        self.assertEqual(main(["publish-projection", "--batch-id", "1", "--execute"], dependencies=dependencies), 0)

        self.assertIn(("materialize", (1, False)), gateway.calls)
        self.assertIn(("publish-projection", (1, False)), gateway.calls)
        self.assertEqual(gateway.sheet_calls, 1)
        self.assertEqual(gateway.activation_calls, 0)

    def test_full_operator_order_replays_idempotently_and_stdout_excludes_content(self):
        class OrderedGateway(RecordingGateway):
            def __init__(self):
                super().__init__()
                self.stage = 0

            def _stage(self, expected, next_stage, result):
                if self.stage != expected:
                    raise AssertionError(f"unexpected stage {self.stage}")
                self.stage = next_stage
                return {**result, "title": "must not print", "url": "https://forbidden.test/raw", "user_id": "never"}

            def publish_projection(self, batch_id, *, dry_run):
                return self._stage(0, 1, super().publish_projection(batch_id, dry_run=dry_run))

            def pull_accepted(self, batch_id, *, dry_run):
                return self._stage(1, 2, super().pull_accepted(batch_id, dry_run=dry_run))

            def ingest(self, batch_id, *, dry_run):
                return self._stage(2, 3, super().ingest(batch_id, dry_run=dry_run))

            def materialize(self, batch_id, *, dry_run):
                return self._stage(3, 4, super().materialize(batch_id, dry_run=dry_run))

            def validate(self, batch_id, *, dry_run):
                return self._stage(4, 5, super().validate(batch_id, dry_run=dry_run))

        gateway = OrderedGateway()
        output = io.StringIO()
        with redirect_stdout(output):
            for command in ("publish-projection", "pull-accepted", "ingest", "materialize", "validate"):
                self.assertEqual(main([command, "--batch-id", "9", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        rendered = output.getvalue()
        self.assertEqual(gateway.stage, 5)
        self.assertNotIn("must not print", rendered)
        self.assertNotIn("forbidden.test", rendered)
        self.assertNotIn("never", rendered)

        replay = RecordingGateway()
        first, second = io.StringIO(), io.StringIO()
        with redirect_stdout(first):
            self.assertEqual(main(["materialize", "--batch-id", "9"], dependencies=WorkflowDependencies(replay)), 0)
        with redirect_stdout(second):
            self.assertEqual(main(["materialize", "--batch-id", "9"], dependencies=WorkflowDependencies(replay)), 0)
        self.assertEqual(first.getvalue(), second.getvalue())
