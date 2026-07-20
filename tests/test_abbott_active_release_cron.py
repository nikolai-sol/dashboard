from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class AbbottActiveReleaseCronTest(unittest.TestCase):
    def test_command_is_exact_counter_release_and_five_scope_collector_path(self):
        import run_abbott_metrika_active_release as launcher

        command = launcher.build_collector_command(
            collector=Path("/canonical/fetch_yandex_metrika_canonical.py"),
            release_id=41,
            code_revision="abcdef123456",
            parser_version="abbott-v1",
        )
        self.assertEqual(command[command.index("--days-back") + 1], "1")
        self.assertEqual(command[command.index("--counter-id") + 1], "90602537")
        self.assertEqual(command[command.index("--canonical-release-id") + 1], "41")
        self.assertEqual(command[command.index("--code-revision") + 1], "abcdef123456")
        self.assertEqual(command[command.index("--parser-version") + 1], "abbott-v1")

    def test_run_resolves_active_pointer_after_runtime_attestation(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector = root / "fetch_yandex_metrika_canonical.py"
            manifest = root / "runtime.sha256"
            collector.write_text("# collector\n", encoding="utf-8")
            manifest.write_text("placeholder\n", encoding="utf-8")
            args = SimpleNamespace(
                canonical_root=root,
                manifest=manifest,
                collector=collector,
                code_revision="abcdef123456",
                parser_version="abbott-v1",
            )
            order = []
            with patch.object(
                launcher, "attest_runtime", side_effect=lambda *unused: order.append("attest")
            ), patch.object(
                launcher,
                "resolve_active_release",
                side_effect=lambda revision: order.append("resolve") or 41,
            ), patch.object(launcher.subprocess, "run") as execute:
                launcher.run(args)

        self.assertEqual(order, ["attest", "resolve"])
        command = execute.call_args.args[0]
        self.assertEqual(command[command.index("--canonical-release-id") + 1], "41")
        self.assertNotIn("shell", execute.call_args.kwargs)
        self.assertTrue(execute.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()
