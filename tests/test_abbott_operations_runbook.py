from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AbbottOperationsRunbookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md").read_text()

    def test_cron_uses_attested_active_release_launcher(self):
        cron = self.text.split("## Checkpoint 9", 1)[1].split("## Checkpoint 10", 1)[0]
        self.assertIn("run_abbott_metrika_active_release.py", cron)
        for flag in ("--manifest", "--collector", "--code-revision", "--parser-version"):
            self.assertIn(flag, cron)
        self.assertIn("--days-back 1", cron)
        self.assertNotIn("--days-back 2", cron)

    def test_schema_and_baseline_gates_are_exact(self):
        self.assertIn('test "$ACTUAL_SCHEMA_TABLE_COUNT" = 12', self.text)
        schema_gate = self.text.split("Verify table and role names only", 1)[1].split("## Checkpoint 2", 1)[0]
        self.assertNotIn("table_schema IN", schema_gate)
        self.assertIn("table_schema='report_bd' AND table_name='portal_data_releases'", schema_gate)
        self.assertIn("table_schema='report_bd_private' AND table_name='portal_bitrix_page_facts'", schema_gate)
        self.assertIn("abbott_bitrix_pages:$PARSER_VERSION", self.text)
        self.assertIn("abbott_bitrix_journeys:$PARSER_VERSION", self.text)
        self.assertIn("abbott_prebackfill_snapshot.sql\"; } |", self.text)

    def test_validation_and_runtime_attestation_are_executable(self):
        self.assertIn("abbott_release_operator.py validate", self.text)
        self.assertIn("sha256sum -c \"$CANONICAL_RUNTIME_MANIFEST\"", self.text)
        self.assertIn("recursive calendar CTE", self.text)
        gap_gate = self.text.split("## Checkpoint 6", 1)[1].split("## Checkpoint 7", 1)[0]
        self.assertIn("WITH RECURSIVE calendar", gap_gate)
        self.assertIn("2026-03-29", gap_gate)
        self.assertIn("2026-04-07", gap_gate)

    def test_dashboard_deploy_installs_and_scans_a_full_atomic_release_tree(self):
        deploy_gate = self.text.split("Before validation", 1)[1].split("Only after every gate", 1)[0]
        self.assertIn("scripts/install-reviewed-release.sh", deploy_gate)
        self.assertIn(".next/standalone/.next/static", deploy_gate)
        self.assertIn(".next/standalone/public", deploy_gate)
        self.assertIn("security:public-assets -- --release", deploy_gate)
        self.assertIn("sha256sum -c", deploy_gate)
        self.assertNotIn("Run the owner-approved deployment procedure", deploy_gate)

    def test_secret_installation_and_counter_probe_are_operational(self):
        self.assertIn("probe_yandex_metrika_access.py", self.text)
        self.assertIn('systemctl restart "$LEGACY_SERVICE_NAME"', self.text)
        self.assertIn("legacy-auth-missing.curl", self.text)
        self.assertIn("legacy-auth-valid.curl", self.text)
        self.assertNotIn("?secret=", self.text)

    def test_current_tree_contains_no_retired_legacy_launch_literal(self):
        retired_literals = ("nikolay" + "-save-us-pls", "Terasic" + "1!")
        matches = []
        for path in ROOT.rglob("*"):
            relative = path.relative_to(ROOT)
            if (
                not path.is_file()
                or any(part in {".git", "node_modules", ".next"} for part in path.parts)
                or relative.parts[:2] == ("docs", "superpowers")
            ):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if any(literal in content for literal in retired_literals):
                matches.append(str(path.relative_to(ROOT)))
        self.assertEqual(matches, [])


if __name__ == "__main__":
    unittest.main()
