"""Fail-closed Python runtime contracts for the Abbott content workflow."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / "agents/abbott_page_classifier/python311_runtime.sh"
WORKFLOW_WRAPPER = ROOT / "agents/abbott_page_classifier/run_classifier.sh"
WEEKLY_WRAPPER = ROOT / "agents/abbott_page_classifier/run_weekly_proposal.sh"


class Python311RuntimeTests(unittest.TestCase):
    def _run(self, executable: Path, *arguments: str, python: str | None = None):
        environment = dict(os.environ)
        environment.pop("ABBOTT_CONTENT_PYTHON311_BIN", None)
        if python is not None:
            environment["ABBOTT_CONTENT_PYTHON311_BIN"] = python
        return subprocess.run(
            [str(executable), *arguments],
            cwd=ROOT,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_launcher_requires_an_explicit_reviewed_absolute_binary(self):
        missing = self._run(LAUNCHER, "-c", "raise SystemExit(99)")
        relative = self._run(
            LAUNCHER,
            "-c",
            "raise SystemExit(99)",
            python="python3.11",
        )

        self.assertEqual(missing.returncode, 78)
        self.assertEqual(
            json.loads(missing.stdout),
            {"status": "ABBOTT_CONTENT_PYTHON311_BIN_REQUIRED"},
        )
        self.assertEqual(missing.stderr, "")
        self.assertEqual(relative.returncode, 78)
        self.assertEqual(
            json.loads(relative.stdout),
            {"status": "ABBOTT_CONTENT_PYTHON311_BIN_ABSOLUTE_REQUIRED"},
        )
        self.assertEqual(relative.stderr, "")

    def test_launcher_rejects_missing_non_executable_and_wrong_version_binaries(self):
        missing = self._run(
            LAUNCHER,
            "-c",
            "raise SystemExit(99)",
            python="/definitely/missing/python3.11",
        )
        with tempfile.TemporaryDirectory() as directory:
            not_executable = Path(directory) / "python3.11"
            not_executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            denied = self._run(
                LAUNCHER,
                "-c",
                "raise SystemExit(99)",
                python=str(not_executable),
            )
        wrong_version = self._run(
            LAUNCHER,
            "-c",
            "raise SystemExit(99)",
            python="/bin/sh",
        )

        self.assertEqual(
            json.loads(missing.stdout),
            {"status": "ABBOTT_CONTENT_PYTHON311_BIN_NOT_EXECUTABLE"},
        )
        self.assertEqual(
            json.loads(denied.stdout),
            {"status": "ABBOTT_CONTENT_PYTHON311_BIN_NOT_EXECUTABLE"},
        )
        self.assertEqual(
            json.loads(wrong_version.stdout),
            {"status": "ABBOTT_CONTENT_PYTHON311_VERSION_REQUIRED"},
        )
        self.assertEqual((missing.returncode, denied.returncode, wrong_version.returncode), (78, 78, 78))

    @unittest.skipUnless(sys.version_info[:2] == (3, 11), "requires the reviewed 3.11 test runtime")
    def test_launcher_executes_only_after_the_exact_version_preflight(self):
        result = self._run(
            LAUNCHER,
            "-c",
            "import json; print(json.dumps({'status': 'EXECUTED'}))",
            python=str(Path(sys.executable)),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"status": "EXECUTED"})
        self.assertEqual(result.stderr, "")

    @unittest.skipUnless(sys.version_info[:2] == (3, 11), "requires the reviewed 3.11 test runtime")
    def test_weekly_wrapper_executes_the_zero_io_dry_run_after_preflight(self):
        result = self._run(
            WEEKLY_WRAPPER,
            "--registry1",
            "registry1.xlsx",
            "--registry2",
            "registry2.csv",
            "--taxonomy-version",
            "abbott.v1",
            "--prompt-version",
            "prompt-reviewed-v1",
            "--model-routing-version",
            "routing-reviewed-v1",
            "--code-revision",
            "a" * 40,
            python=str(Path(sys.executable)),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"status": "dry_run"})
        self.assertEqual(result.stderr, "")

    def test_operator_wrappers_are_executable_and_have_no_path_python_fallback(self):
        for wrapper in (LAUNCHER, WORKFLOW_WRAPPER, WEEKLY_WRAPPER):
            with self.subTest(wrapper=wrapper.name):
                self.assertTrue(os.access(wrapper, os.X_OK))
                text = wrapper.read_text(encoding="utf-8")
                self.assertNotIn("${PYTHON:-python3}", text)
                self.assertNotIn("exec python3", text)
        self.assertIn("python311_runtime.sh", WORKFLOW_WRAPPER.read_text(encoding="utf-8"))
        self.assertIn("python311_runtime.sh", WEEKLY_WRAPPER.read_text(encoding="utf-8"))

    def test_content_runbooks_require_the_absolute_exact_311_preflight(self):
        documents = (
            ROOT / "agents/abbott_page_classifier/README.md",
            ROOT / "ops/runbooks/abbott_content_registry.md",
            ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md",
        )
        for document in documents:
            with self.subTest(document=document):
                text = document.read_text(encoding="utf-8")
                self.assertIn("ABBOTT_CONTENT_PYTHON311_BIN", text)
                self.assertIn("sys.version_info[:2] != (3, 11)", text)
                self.assertIn("run_weekly_proposal.sh", text)

    def test_content_environment_example_separates_all_three_database_roles(self):
        example = (
            ROOT / "agents/abbott_page_classifier/content.env.example"
        ).read_text(encoding="utf-8")
        expected = (
            "ABBOTT_CONTENT_PYTHON311_BIN=/absolute/reviewed/path/to/python3.11",
            "ABBOTT_CONTENT_WORKFLOW_DB_NAME=report_bd",
            "ABBOTT_CONTENT_MATERIALIZER_DB_NAME=report_bd",
            "ABBOTT_RELEASE_DB_NAME=report_bd",
            "ABBOTT_CONTENT_VALIDATION_REVIEWED_BY=",
        )
        for setting in expected:
            self.assertIn(setting, example)
        self.assertNotIn("REPORT_DB_", example)


if __name__ == "__main__":
    unittest.main()
