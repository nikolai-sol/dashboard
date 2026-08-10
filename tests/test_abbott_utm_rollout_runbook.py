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

    def test_return_page_direction_projection_is_a_staging_only_pre_comparison_gate(self):
        normalized = " ".join(self.section.split())
        self.assertIn(
            "after the candidate backfill is complete and before comparison, validation, activation, or dashboard deployment",
            normalized,
        )
        self.assertIn("staging-only Abbott counter `90602537`", normalized)
        self.assertIn("catalog_rows=1769", normalized)
        self.assertIn("catalog_rows_with_direction=1639", normalized)
        self.assertIn("catalog_rows_with_normalized_url=0", normalized)
        self.assertIn("catalog_rows_with_normalized_path=0", normalized)
        self.assertIn("path_lookup_rows=0", normalized)
        self.assertIn("distinct normalized paths seen in candidate page facts", normalized)
        self.assertIn("matched path projections with non-empty direction", normalized)
        self.assertIn("unmatched paths", normalized)
        self.assertIn("ambiguous paths", normalized)
        self.assertIn("returning-page rows and returning visitors with/without page direction", normalized)
        self.assertIn("zero path rows falsely marked resolved when their evidence conflicts", normalized)
        self.assertIn(
            "direction coverage must improve from the frozen zero-path baseline",
            normalized.lower(),
        )
        self.assertIn("no slug or substring fallback", normalized.lower())
        self.assertIn("never rewrite an active release, title projection, or slug projection", normalized.lower())

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
