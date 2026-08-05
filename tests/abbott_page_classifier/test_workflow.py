"""Operator CLI safety contracts, using only offline recording fakes."""

from __future__ import annotations

import os
from pathlib import Path
import io
import json
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

    def status(self, batch_id):
        self.calls.append(("status", batch_id))
        return {"status": "draft", "candidate_release_id": 42}


class WorkflowTests(unittest.TestCase):
    def test_production_builder_is_lazy_and_offline_reconcile_never_builds_a_repository(self):
        repository_calls: list[str] = []
        dependencies = build_production_dependencies(
            repository_factory=lambda: repository_calls.append("repository") or object(),
        )
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main([
                "reconcile", "--registry1", "tests/fixtures/abbott_registry1_minimal.xlsx",
                "--registry2", "tests/fixtures/abbott_registry2_accepted_minimal.csv", "--dry-run",
            ], dependencies=dependencies), 0)
        self.assertEqual(repository_calls, [])
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

    def test_command_surface_is_fixed(self):
        self.assertEqual(
            COMMANDS,
            ("reconcile", "classify", "publish-projection", "pull-accepted", "ingest", "materialize", "validate", "status"),
        )

    def test_reconcile_is_offline_dry_run_and_reports_only_sanitized_counts_hashes(self):
        gateway = RecordingGateway()
        result = main(
            ["reconcile", "--registry1", "one.xlsx", "--registry2", "two.csv"],
            dependencies=WorkflowDependencies(gateway),
        )

        self.assertEqual(result, 0)
        self.assertEqual(gateway.calls, [("reconcile", True)])

    def test_execute_stages_require_batch_id_while_default_dry_run_is_batchless(self):
        gateway = RecordingGateway()
        for command in ("classify", "publish-projection", "pull-accepted", "ingest", "materialize", "validate"):
            with self.subTest(command=command):
                self.assertEqual(main([command], dependencies=WorkflowDependencies(gateway)), 0)
                self.assertEqual(main([command, "--execute"], dependencies=WorkflowDependencies(gateway)), 2)
                self.assertEqual(main([command, "--batch-id", "batch-1", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        self.assertIn(("classify", ("batch-1", False, False)), gateway.calls)
        self.assertTrue(
            all(
                call[1][1] is False
                for call in gateway.calls
                if call[0] in {"publish-projection", "pull-accepted", "ingest", "materialize", "validate"}
                and call[1][0] == "batch-1"
            )
        )
        self.assertEqual(gateway.sheet_calls, 1)
        self.assertEqual(gateway.activation_calls, 0)

    def test_llm_requires_key_only_for_eligible_execute_rows_and_never_for_locked_rows(self):
        locked = RecordingGateway(eligible=0)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(main(["classify", "--batch-id", "locked", "--execute-llm"], dependencies=WorkflowDependencies(locked)), 0)
        self.assertEqual(locked.openai_calls, 0)

        eligible = RecordingGateway(eligible=1)
        self.assertEqual(main(["classify", "--batch-id", "open"], dependencies=WorkflowDependencies(eligible)), 0)
        self.assertEqual(eligible.openai_calls, 0)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(main(["classify", "--batch-id", "open", "--execute-llm"], dependencies=WorkflowDependencies(eligible)), 2)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"}, clear=True):
            self.assertEqual(main(["classify", "--batch-id", "open", "--execute-llm"], dependencies=WorkflowDependencies(eligible)), 0)
        self.assertEqual(eligible.openai_calls, 1)

    def test_sheet_write_is_limited_to_non_dry_publish_and_materialize_never_activates(self):
        gateway = RecordingGateway()
        dependencies = WorkflowDependencies(gateway)
        self.assertEqual(main(["materialize", "--batch-id", "batch-1", "--execute"], dependencies=dependencies), 0)
        self.assertEqual(main(["publish-projection", "--batch-id", "batch-1", "--execute"], dependencies=dependencies), 0)

        self.assertIn(("materialize", ("batch-1", False)), gateway.calls)
        self.assertIn(("publish-projection", ("batch-1", False)), gateway.calls)
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
                self.assertEqual(main([command, "--batch-id", "batch-9", "--execute"], dependencies=WorkflowDependencies(gateway)), 0)
        rendered = output.getvalue()
        self.assertEqual(gateway.stage, 5)
        self.assertNotIn("must not print", rendered)
        self.assertNotIn("forbidden.test", rendered)
        self.assertNotIn("never", rendered)

        replay = RecordingGateway()
        first, second = io.StringIO(), io.StringIO()
        with redirect_stdout(first):
            self.assertEqual(main(["materialize", "--batch-id", "batch-9"], dependencies=WorkflowDependencies(replay)), 0)
        with redirect_stdout(second):
            self.assertEqual(main(["materialize", "--batch-id", "batch-9"], dependencies=WorkflowDependencies(replay)), 0)
        self.assertEqual(first.getvalue(), second.getvalue())
