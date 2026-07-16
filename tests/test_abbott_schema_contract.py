from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AbbottSchemaContractTest(unittest.TestCase):
    def test_release_keys_and_private_boundary(self):
        primary = (
            ROOT
            / "dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql"
        ).read_text()
        private = (ROOT / "ops/sql/abbott_private_schema_and_grants.sql").read_text()
        self.assertIn("portal_active_data_releases", primary)
        self.assertIn("canonical_release_id", primary)
        self.assertNotIn(" raw_user_id ", primary.lower())
        self.assertIn("raw_user_id TEXT NOT NULL", private)
        self.assertIn("ENGINE=InnoDB", primary)
        self.assertIn("ENGINE=InnoDB", private)

    def test_coverage_statuses_are_closed(self):
        sql = (
            ROOT
            / "dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql"
        ).read_text()
        for status in (
            "success",
            "success_empty",
            "partial",
            "skipped",
            "sampled",
            "failed",
        ):
            self.assertIn(f"'{status}'", sql)


if __name__ == "__main__":
    unittest.main()
