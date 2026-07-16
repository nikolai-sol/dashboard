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
        self.assertIn("abbott_bitrix_pages:$PARSER_VERSION", self.text)
        self.assertIn("abbott_bitrix_journeys:$PARSER_VERSION", self.text)
        self.assertIn("abbott_prebackfill_snapshot.sql\"; } |", self.text)

    def test_validation_and_runtime_attestation_are_executable(self):
        self.assertIn("abbott_release_operator.py validate", self.text)
        self.assertIn("sha256sum -c \"$CANONICAL_RUNTIME_MANIFEST\"", self.text)
        self.assertIn('cmp "$REVIEWED_DASHBOARD_SERVER"', self.text)
        self.assertIn("recursive calendar CTE", self.text)

    def test_secret_installation_and_counter_probe_are_operational(self):
        self.assertIn("probe_yandex_metrika_access.py", self.text)
        self.assertIn('systemctl restart "$LEGACY_SERVICE_NAME"', self.text)
        self.assertIn("legacy-auth-missing.curl", self.text)
        self.assertIn("legacy-auth-valid.curl", self.text)
        self.assertNotIn("?secret=", self.text)


if __name__ == "__main__":
    unittest.main()
