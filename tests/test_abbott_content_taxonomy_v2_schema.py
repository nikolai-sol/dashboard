"""Static contract for the reviewed Abbott taxonomy v2 successor."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "dashboard-next/src/db/migrations/052_abbott_content_taxonomy_v2.sql"
)


class AbbottContentTaxonomyV2SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_v2_is_a_new_content_addressed_taxonomy(self):
        for fragment in (
            "version = 'abbott.v1'",
            "'abbott.v2'",
            "472159bf7ed72b60df97e5e1efa2bfc8b33fc4edbfcef112182a0eb843aaa34b",
            "'material_type', 'service_page', 'Служебная страница'",
            "migration-052-reviewed-taxonomy-v2",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.sql)

    def test_v1_is_attested_and_never_updated(self):
        self.assertIn(
            "d6a2bfc39d970a873e309223604f9ae7c37cd83d6c046c107eed08e73ec435d4",
            self.sql,
        )
        self.assertNotIn("UPDATE portal_content_taxonomy_versions", self.sql)
        self.assertNotIn("UPDATE portal_content_taxonomy_terms", self.sql)
        self.assertIn("@abbott_taxonomy_v2_preexisting", self.sql)
        self.assertIn("ABBOTT_M052_TAXONOMY_V1_FAIL", self.sql)
        self.assertIn("ABBOTT_M052_TAXONOMY_V2_FAIL", self.sql)


if __name__ == "__main__":
    unittest.main()
