"""Weekly proposal composition contracts with recording-only authorities."""

from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import unittest

from agents.abbott_page_classifier.workflow import WorkflowDependencies
from agents.abbott_page_classifier.weekly_proposal import main


REVIEWED = (
    "--taxonomy-version", "abbott.v1",
    "--prompt-version", "prompt-reviewed-v1",
    "--model-routing-version", "routing-reviewed-v1",
    "--code-revision", "a" * 40,
)
SOURCES = ("--registry1", "registry1.xlsx", "--registry2", "registry2.csv")


class RecordingGateway:
    def __init__(self):
        self.calls = []

    def reconcile(self, registry1, registry2, *, dry_run):
        self.calls.append(("reconcile", registry1.name, registry2.name, dry_run))
        return {"status": "reconciled", "run_id": 17, "run_key": "a" * 64,
                "source_count": 5, "title": "must not print"}

    def classify(self, run_id, *, execute_llm, dry_run):
        self.calls.append(("classify", run_id, execute_llm, dry_run))
        return {"status": "finalized", "batch_id": 23, "batch_key": "b" * 64}

    def publish_projection(self, batch_id, *, dry_run):
        self.calls.append(("publish-projection", batch_id, dry_run))
        return {"status": "published", "batch_id": 23, "batch_key": "b" * 64,
                "ready_count": 3, "conflict_count": 1, "url": "forbidden"}


class WeeklyProposalTests(unittest.TestCase):
    def test_dry_run_requires_inputs_but_constructs_no_gateway_and_makes_no_call(self):
        calls = []
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [*SOURCES, *REVIEWED],
                dependencies_factory=lambda _configuration: calls.append("factory"),
            )

        self.assertEqual(result, 0)
        self.assertEqual(calls, [])
        self.assertEqual(json.loads(output.getvalue()), {"status": "dry_run"})

    def test_execute_composes_exactly_reconcile_classify_publish_and_stops(self):
        gateway = RecordingGateway()
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [*SOURCES, *REVIEWED, "--execute", "--execute-llm"],
                dependencies_factory=lambda _configuration: WorkflowDependencies(gateway),
            )

        self.assertEqual(result, 0)
        self.assertEqual(
            gateway.calls,
            [
                ("reconcile", "registry1.xlsx", "registry2.csv", False),
                ("classify", 17, True, False),
                ("publish-projection", 23, False),
            ],
        )
        rendered = output.getvalue()
        self.assertNotIn("must not print", rendered)
        self.assertNotIn("forbidden", rendered)
        self.assertEqual(json.loads(rendered)["status"], "proposal_published")

    def test_missing_or_unreviewed_configuration_fails_before_factory(self):
        calls = []
        for argv in (
            [*SOURCES],
            [*SOURCES, *REVIEWED[:-2], "--code-revision", "not-reviewed"],
        ):
            with self.subTest(argv=argv):
                self.assertEqual(
                    main(argv, dependencies_factory=lambda _configuration: calls.append("factory")),
                    2,
                )
        self.assertEqual(calls, [])

    def test_execute_llm_without_execute_is_zero_call_dry_run(self):
        calls = []
        self.assertEqual(
            main(
                [*SOURCES, *REVIEWED, "--execute-llm"],
                dependencies_factory=lambda _configuration: calls.append("factory"),
            ),
            0,
        )
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
