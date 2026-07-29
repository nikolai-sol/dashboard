from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AbbottUtmRolloutRunbookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        text = (ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md").read_text(encoding="utf-8")
        cls.section = text.split("## Abbott UTM/frequency successor-release rollout", 1)[1]

    def test_requires_migration_backup_and_repeat_safe_schema_verification(self):
        normalized = " ".join(self.section.split())
        self.assertIn("migration `044_abbott_private_visit_utm_source.sql`", normalized)
        self.assertIn("database backup", normalized)
        self.assertIn("information_schema.COLUMNS", normalized)
        self.assertIn("information_schema.STATISTICS", normalized)

    def test_requires_append_only_successor_release_and_complete_backfill(self):
        normalized = " ".join(self.section.split())
        self.assertIn("new append-only Abbott successor release", normalized)
        self.assertIn("never update the active release in place", normalized.lower())
        self.assertIn("evaluate → create → poll → download all parts → clean in finally", normalized)
        self.assertIn("successful run status", normalized)
        self.assertIn("complete expected-date coverage", normalized)
        self.assertIn("zero bad coverage rows", normalized)

    def test_candidate_comparison_and_session_integrity_are_exact(self):
        normalized = " ".join(self.section.split())
        for metric in (
            "total visit rows",
            "distinct visit hashes",
            "User ID coverage",
            "null client-hash count",
            "direction mapping coverage",
            "UTM populated/null counts",
        ):
            self.assertIn(metric, normalized)
        self.assertIn("`all.sessions = with_user_id.sessions + without_user_id.sessions`", normalized)
        self.assertIn("for every date/source", normalized)

    def test_access_cutover_and_rollback_boundaries_are_explicit(self):
        normalized = " ".join(self.section.split())
        self.assertIn("manager-only UTM/frequency reads", normalized)
        self.assertIn("zero embed private queries", normalized)
        self.assertIn("authenticated manager smoke test", normalized)
        self.assertIn("embed smoke test", normalized)
        self.assertIn("rollback if either smoke test fails", normalized)
        self.assertIn("Do not restore public PII assets during rollback", normalized)

    def test_cron_times_and_critical_summary_rule_do_not_change(self):
        normalized = " ".join(self.section.split())
        self.assertIn("collection `06:12`, health `07:05`, summary `07:10`", normalized)
        self.assertIn("integrity mismatch remains `CRITICAL`", normalized)


if __name__ == "__main__":
    unittest.main()
