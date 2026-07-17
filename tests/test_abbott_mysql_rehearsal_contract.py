from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "ops/local/abbott_mysql_rehearsal.sh"
FILTER = ROOT / "ops/local/abbott_dump_schema_filter.py"


class AbbottMysqlRehearsalContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = HARNESS.read_text(encoding="utf-8")

    def test_harness_pins_image_and_records_resolved_digest(self):
        self.assertIn("mysql:8.4.10", self.harness)
        self.assertIn("RepoDigests", self.harness)
        self.assertIn("image_digest", self.harness)
        self.assertIn("rehearsal-summary.json", self.harness)

    def test_task_three_exposes_only_standalone_schema_mode(self):
        self.assertIn("Usage: $0 schema --inputs", self.harness)
        self.assertNotIn("schema|import|lifecycle", self.harness)
        self.assertNotRegex(self.harness, r"case \"\$MODE\" in[^\n]*import")
        result = subprocess.run(
            [str(HARNESS), "import"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertRegex(result.stderr, r"^Usage: .* schema --inputs")

    def test_harness_protects_credentials_inputs_and_cleanup(self):
        self.assertIn("umask 077", self.harness)
        self.assertRegex(self.harness, r"(openssl rand|/dev/urandom)")
        self.assertIn("set +x", self.harness)
        self.assertNotIn("echo $MYSQL", self.harness)
        self.assertIn("install -m 600", self.harness)
        self.assertIn("trap cleanup EXIT", self.harness)
        self.assertIn("docker rm", self.harness)
        self.assertIn("docker volume rm", self.harness)
        self.assertIn("ABBOTT_REHEARSAL_PRESERVE_ON_FAILURE", self.harness)

    def test_harness_uses_container_clients_and_rejects_public_inputs(self):
        self.assertIn("docker exec", self.harness)
        self.assertIn("mysqladmin ping", self.harness)
        self.assertNotRegex(self.harness, r"(?m)^\s*mysql(?:admin)?\s")
        self.assertIn("realpath", self.harness)
        self.assertRegex(self.harness, r"(^|/)public(/|$)")

    def test_harness_applies_fresh_then_only_repeats_abbott_ddl(self):
        self.assertIn("sort", self.harness)
        self.assertIn("033_abbott_canonical_release_control.sql", self.harness)
        self.assertIn("abbott_private_schema_and_grants.sql", self.harness)
        self.assertIn("schema-signature.sha256", self.harness)
        self.assertIn("grant-signature.sha256", self.harness)
        self.assertIn("dump-schema-probe.txt", self.harness)
        for role in (
            "reportingdash_abbott_collector_role",
            "reportingdash_abbott_importer_role",
            "reportingdash_abbott_release_operator_role",
            "reportingdash_abbott_runtime_reader_role",
        ):
            self.assertIn(role, self.harness)
        self.assertIn("SET DEFAULT ROLE", self.harness)

    def test_filter_emits_schema_without_rows_definer_or_source_database(self):
        dump = """\
CREATE DATABASE `private_source`;
USE `private_source`;
DROP TABLE IF EXISTS `events`;
CREATE TABLE `events` (
  `id` bigint NOT NULL,
  `label` varchar(20) DEFAULT NULL
) ENGINE=InnoDB;
LOCK TABLES `events` WRITE;
INSERT INTO `events` VALUES (1,'private row');
UNLOCK TABLES;
CREATE DEFINER=`source_user`@`source_host` VIEW `event_ids` AS SELECT `id` FROM `private_source`.`events`;
"""
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.sql"
            source.write_text(dump, encoding="utf-8")
            with source.open("r", encoding="utf-8") as handle:
                result = subprocess.run(
                    [sys.executable, str(FILTER)],
                    stdin=handle,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
        self.assertIn("CREATE TABLE", result.stdout)
        self.assertIn("CREATE VIEW", result.stdout)
        self.assertNotIn("INSERT", result.stdout.upper())
        self.assertNotIn("LOCK TABLES", result.stdout.upper())
        self.assertNotIn("private row", result.stdout)
        self.assertNotIn("DEFINER", result.stdout.upper())
        self.assertNotIn("private_source", result.stdout)


if __name__ == "__main__":
    unittest.main()
