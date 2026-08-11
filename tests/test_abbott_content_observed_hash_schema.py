from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "dashboard-next/src/db/migrations/053_abbott_observed_pages_hash.sql"
BOOTSTRAP = (
    ROOT
    / "dashboard-next/reportingdash-canonical-bootstrap/src/db/migrations/053_abbott_observed_pages_hash.sql"
)


class AbbottObservedPagesHashSchemaTest(unittest.TestCase):
    def test_migration_persists_the_observed_evidence_digest(self):
        sql = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("portal_content_reconciliation_runs", sql)
        self.assertIn("observed_pages_hash", sql)
        self.assertIn("CHAR(64)", sql.upper())

    def test_bootstrap_migration_is_byte_identical(self):
        self.assertEqual(MIGRATION.read_bytes(), BOOTSTRAP.read_bytes())


if __name__ == "__main__":
    unittest.main()
