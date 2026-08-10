"""Legacy Abbott command lines cannot bypass the canonical workflow."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class LegacyCliSafetyTests(unittest.TestCase):
    def _run(self, relative_script: str, *arguments: str):
        return subprocess.run(
            [sys.executable, relative_script, *arguments],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_legacy_classifier_operational_cli_fails_closed_before_file_or_network_io(self):
        result = self._run(
            "agents/abbott_page_classifier/classify.py",
            "--self-test",
            "--workbook",
            "/definitely/missing.xlsx",
            "--from-metrika-new",
        )

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr.strip(), "LEGACY_CLASSIFIER_CLI_DISABLED")

    def test_legacy_registry_cli_fails_closed_without_creating_local_state(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "direction_registry.jsonl"
            result = self._run(
                "agents/abbott_page_classifier/registry.py",
                "seed-workbook",
                "--workbook",
                "/definitely/missing.xlsx",
                "--registry",
                str(registry),
            )

            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertEqual(
                result.stderr.strip(),
                "LEGACY_DIRECTION_REGISTRY_CLI_DISABLED",
            )
            self.assertFalse(registry.exists())

    def test_legacy_help_surfaces_remain_available(self):
        cases = (
            ("agents/abbott_page_classifier/classify.py", "Abbott page direction classifier"),
            ("agents/abbott_page_classifier/registry.py", "Abbott direction registry"),
        )
        for script, description in cases:
            with self.subTest(script=script):
                result = self._run(script, "--help")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(description, result.stdout)


if __name__ == "__main__":
    unittest.main()
