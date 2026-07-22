from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class AbbottActiveReleaseCronTest(unittest.TestCase):
    def test_active_release_query_avoids_reserved_release_alias(self):
        import run_abbott_metrika_active_release as launcher

        class Cursor:
            def execute(self, sql, params):
                self.sql = " ".join(sql.split())

            def fetchone(self):
                return {
                    "canonical_release_id": 41,
                    "release_status": "active",
                    "code_revision": "abcdef123456",
                }

            def close(self):
                pass

        class Connection:
            def __init__(self):
                self.cursor_instance = Cursor()

            def cursor(self, **unused):
                return self.cursor_instance

            def close(self):
                pass

        connection = Connection()
        with patch.object(launcher, "get_db_connection", return_value=connection):
            self.assertEqual(launcher.resolve_active_release("abcdef123456"), 41)

        self.assertNotIn(" AS release ", connection.cursor_instance.sql)
        self.assertIn(" AS data_release ", connection.cursor_instance.sql)

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
                runtime_revision="runtime987654",
                code_revision="abcdef123456",
                parser_version="abbott-v1",
            )
            order = []
            with patch.object(
                launcher,
                "attest_runtime",
                side_effect=lambda unused_root, revision, unused_manifest: order.append(
                    ("attest", revision)
                ),
            ), patch.object(
                launcher,
                "resolve_active_release",
                side_effect=lambda revision: order.append(("resolve", revision)) or 41,
            ), patch.object(launcher.subprocess, "run") as execute:
                launcher.run(args)

        self.assertEqual(
            order,
            [("attest", "runtime987654"), ("resolve", "abcdef123456")],
        )
        command = execute.call_args.args[0]
        self.assertEqual(command[command.index("--canonical-release-id") + 1], "41")
        self.assertNotIn("shell", execute.call_args.kwargs)
        self.assertTrue(execute.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()
