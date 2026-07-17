import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "ops/local/abbott_mysql_rehearsal.sh"
FILTER = ROOT / "ops/local/abbott_dump_schema_filter.py"
RUNBOOK = ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md"
MIGRATIONS = ROOT / "dashboard-next/src/db/migrations"
MIGRATION_033 = MIGRATIONS / "033_abbott_canonical_release_control.sql"
PRIVATE_SQL = ROOT / "ops/sql/abbott_private_schema_and_grants.sql"


def run_filter(sql: str, source_database: str = "abbottpro_db") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(FILTER), "--source-database", source_database],
        input=sql,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FakeDocker:
    SCRIPT = r'''#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
log = Path(os.environ["FAKE_DOCKER_LOG"])
entry = {"args": args}
stdin = b""
if args and args[0] == "exec" and "mysql" in args:
    stdin = sys.stdin.buffer.read()
    if stdin:
        entry["stdin_sha256"] = hashlib.sha256(stdin).hexdigest()
with log.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(entry, sort_keys=True) + "\n")

if args[:2] == ["context", "show"]:
    print("fake-local")
elif args[:2] == ["context", "inspect"]:
    print(os.environ["FAKE_DOCKER_ENDPOINT"])
elif args[:2] == ["image", "inspect"]:
    print("mysql@sha256:" + "a" * 64)
elif args and args[0] == "exec" and "mysql" in args:
    query = next((item.split("=", 1)[1] for item in args if item.startswith("--execute=")), "")
    if "information_schema.COLUMNS" in query:
        counter = log.with_suffix(".schema-count")
        count = int(counter.read_text() if counter.exists() else "0") + 1
        counter.write_text(str(count))
        changed = os.environ.get("FAKE_DOCKER_CHANGE_SCHEMA") == "1" and count > 1
        print("schema-changed" if changed else "schema-stable")
    elif "information_schema.TABLE_PRIVILEGES" in query:
        print("grants-stable")
    elif "COUNT(*) FROM information_schema.TABLES" in query:
        print("3")
    elif "SELECT VERSION()" in query:
        print("8.4.10")
sys.exit(0)
'''

    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.bin = root / "bin"
        self.bin.mkdir()
        self.log = root / "docker.jsonl"
        self.socket_path = root / "docker.sock"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(self.socket_path))
        sock.close()
        docker = self.bin / "docker"
        docker.write_text(self.SCRIPT, encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)

    def env(self, **updates: str) -> dict[str, str]:
        env = os.environ.copy()
        env.update({
            "PATH": f"{self.bin}{os.pathsep}{env['PATH']}",
            "FAKE_DOCKER_LOG": str(self.log),
            "FAKE_DOCKER_ENDPOINT": f"unix://{self.socket_path}",
        })
        env.update(updates)
        return env

    def entries(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]


class AbbottMysqlRehearsalContractTest(unittest.TestCase):
    def test_filter_splits_multiple_statements_on_one_line(self):
        result = run_filter(
            "CREATE TABLE `events` (`id` bigint); INSERT INTO `events` VALUES (1,'private; row');"
        )
        self.assertEqual(result.stdout.count("CREATE TABLE"), 1)
        self.assertEqual(result.stdout.count(";"), 1)
        self.assertNotIn("INSERT", result.stdout.upper())
        self.assertNotIn("private", result.stdout)

    def test_filter_requires_and_strips_explicit_source_database_without_use(self):
        sql = (
            "CREATE VIEW `event_ids` AS SELECT `id` "
            "FROM `abbottpro_db`.`events`;"
        )
        result = run_filter(sql)
        self.assertIn("CREATE VIEW", result.stdout)
        self.assertNotIn("abbottpro_db", result.stdout)
        missing = subprocess.run(
            [sys.executable, str(FILTER)],
            input=sql,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(missing.returncode, 0)

    def test_filter_emits_ddl_without_rows_locks_definer_or_database_declarations(self):
        dump = """\
CREATE DATABASE `abbottpro_db`;
USE `abbottpro_db`;
DROP TABLE IF EXISTS `events`;
CREATE TABLE `events` (`id` bigint NOT NULL);
LOCK TABLES `events` WRITE;
INSERT INTO `events` VALUES (1);
UNLOCK TABLES;
CREATE DEFINER=`source_user`@`source_host` VIEW `event_ids` AS SELECT `id` FROM `abbottpro_db`.`events`;
"""
        result = run_filter(dump)
        self.assertIn("CREATE TABLE", result.stdout)
        self.assertIn("CREATE VIEW", result.stdout)
        self.assertNotRegex(result.stdout.upper(), r"INSERT|LOCK TABLES|DEFINER")
        self.assertNotIn("abbottpro_db", result.stdout)

    def test_filter_strips_current_user_definer_forms(self):
        for definer in ("CURRENT_USER", "CURRENT_USER()"):
            with self.subTest(definer=definer):
                result = run_filter(
                    f"CREATE DEFINER={definer} VIEW `event_ids` AS SELECT 1;"
                )
                self.assertIn("CREATE VIEW", result.stdout)
                self.assertNotRegex(result.stdout, r"(?i)\bDEFINER\b")
        unsupported = subprocess.run(
            [sys.executable, str(FILTER), "--source-database", "abbottpro_db"],
            input="CREATE DEFINER=UNSUPPORTED_AUTHORITY VIEW v AS SELECT 1;",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(unsupported.returncode, 0)
        self.assertEqual(unsupported.stdout, "")
        self.assertIn("residual definer authority", unsupported.stderr)
        skipped_row = run_filter(
            "INSERT INTO t VALUES ('DEFINER'); CREATE TABLE safe_table (id int);"
        )
        self.assertIn("CREATE TABLE safe_table", skipped_row.stdout)

    def test_unsupported_mode_stops_before_docker_and_usage_keeps_schema_inputs_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeDocker(Path(temporary))
            result = subprocess.run(
                [str(HARNESS), "unsupported"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            docker_entries = fake.entries()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertRegex(result.stderr, r"^Usage: .* schema --dump-sql")
        self.assertIn("import|lifecycle --inputs", result.stderr)
        self.assertEqual(docker_entries, [])

    def test_dirty_migration_authority_stops_before_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake = FakeDocker(base)
            real_git = shutil.which("git")
            self.assertIsNotNone(real_git)
            git = fake.bin / "git"
            git.write_text(
                "#!/bin/sh\n"
                "case \" $* \" in\n"
                "  *\" status \"*\"src/db/migrations\"*) printf ' M src/db/migrations/001.sql\\n'; exit 0 ;;\n"
                "esac\n"
                f"exec {real_git} \"$@\"\n",
                encoding="utf-8",
            )
            git.chmod(git.stat().st_mode | stat.S_IXUSR)
            dump = base / "source.sql"
            dump.write_text("CREATE TABLE t (id int);", encoding="utf-8")
            result = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(dump), "--evidence", str(base / "evidence")],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            docker_entries = fake.entries()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("migration authority is not clean", result.stderr)
        self.assertEqual(docker_entries, [])

    def test_ignored_untracked_migration_is_never_executed(self):
        ignored = MIGRATIONS / "000_ignored_rehearsal_test.sql"
        self.assertFalse(ignored.exists())
        try:
            ignored.write_text("CREATE TABLE ignored_rehearsal_table (id int);\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as temporary:
                base = Path(temporary)
                fake = FakeDocker(base)
                real_git = shutil.which("git")
                self.assertIsNotNone(real_git)
                git = fake.bin / "git"
                git.write_text(
                    "#!/bin/sh\n"
                    "case \" $* \" in\n"
                    "  *\" status \"*\"src/db/migrations\"*) exit 0 ;;\n"
                    "esac\n"
                    f"exec {real_git} \"$@\"\n",
                    encoding="utf-8",
                )
                git.chmod(git.stat().st_mode | stat.S_IXUSR)
                dump = base / "source.sql"
                dump.write_text("CREATE TABLE source_table (id int);", encoding="utf-8")
                result = subprocess.run(
                    [str(HARNESS), "schema", "--dump-sql", str(dump), "--evidence", str(base / "evidence")],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=fake.env(),
                    check=False,
                )
                stdin_hashes = {
                    entry["stdin_sha256"]
                    for entry in fake.entries()
                    if "stdin_sha256" in entry
                }
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(sha256(ignored), stdin_hashes)
        finally:
            ignored.unlink(missing_ok=True)

    def test_schema_rejects_git_web_and_symlink_paths_before_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake = FakeDocker(base)
            safe_dump = base / "source.sql"
            safe_dump.write_text("CREATE TABLE t (id int);", encoding="utf-8")
            unsafe_paths = [
                ROOT / "forbidden-evidence",
                base / "public" / "evidence",
                base / ".next" / "evidence",
                base / "standalone" / "evidence",
                base / "static" / "evidence",
                base / "build" / "evidence",
                base / "dist" / "evidence",
                Path("/var/www/abbott-rehearsal/evidence"),
                Path("/srv/http/abbott-rehearsal/evidence"),
            ]
            for path in unsafe_paths[1:7]:
                path.parent.mkdir(exist_ok=True)
            alias = base / "git-alias"
            alias.symlink_to(ROOT, target_is_directory=True)
            unsafe_paths.append(alias / "evidence")
            for evidence in unsafe_paths:
                with self.subTest(evidence=evidence):
                    result = subprocess.run(
                        [str(HARNESS), "schema", "--dump-sql", str(safe_dump), "--evidence", str(evidence)],
                        text=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        env=fake.env(),
                        check=False,
                    )
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("unsafe", result.stderr.lower())
            dump_in_git = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(HARNESS), "--evidence", str(base / "evidence")],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            self.assertEqual(dump_in_git.returncode, 2)
            self.assertEqual(fake.entries(), [])

    def test_schema_rejects_preexisting_evidence_symlink_without_following_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake = FakeDocker(base)
            dump = base / "source.sql"
            dump.write_text("CREATE TABLE t (id int);", encoding="utf-8")
            evidence = base / "evidence"
            evidence.mkdir()
            target = base / "do-not-write"
            target.write_text("sentinel", encoding="utf-8")
            (evidence / "rehearsal-summary.json").symlink_to(target)
            result = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(dump), "--evidence", str(evidence)],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("evidence", result.stderr.lower())
            self.assertEqual(target.read_text(), "sentinel")
            self.assertEqual(fake.entries(), [])

    def test_fake_docker_proves_fresh_order_exact_repeat_scope_and_signatures(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake = FakeDocker(base)
            dump = base / "source.sql"
            dump.write_text("CREATE TABLE source_table (id int);", encoding="utf-8")
            evidence = base / "evidence"
            result = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(dump), "--evidence", str(evidence)],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            docker_args = [entry["args"] for entry in fake.entries()]
            self.assertIn(["pull", "mysql:8.4.10"], docker_args)
            self.assertTrue(any(args[:2] == ["image", "inspect"] for args in docker_args))
            self.assertTrue(any("mysqladmin" in args for args in docker_args))
            self.assertTrue(any("mysql" in args for args in docker_args))
            self.assertTrue(any(args[:2] == ["rm", "--force"] for args in docker_args))
            self.assertTrue(any(args[:3] == ["volume", "rm", "--force"] for args in docker_args))
            summary = json.loads((evidence / "rehearsal-summary.json").read_text())
            self.assertEqual(summary["image_digest"], "mysql@sha256:" + "a" * 64)
            stdin_sequence = [
                entry["stdin_sha256"] for entry in fake.entries() if "stdin_sha256" in entry
            ]
            tracked = subprocess.run(
                ["git", "-C", str(ROOT / "dashboard-next"), "ls-files", "--", "src/db/migrations"],
                text=True,
                stdout=subprocess.PIPE,
                check=True,
            ).stdout.splitlines()
            expected = []
            for relative in sorted(path for path in tracked if path.endswith(".sql")):
                migration = ROOT / "dashboard-next" / relative
                expected.append(migration)
                if migration == MIGRATION_033:
                    break
            self.assertTrue(expected and expected[-1] == MIGRATION_033)
            self.assertEqual(
                stdin_sequence[: len(expected)],
                [sha256(migration) for migration in expected],
            )
            self.assertEqual(stdin_sequence[len(expected)], sha256(PRIVATE_SQL))
            self.assertEqual(stdin_sequence[len(expected) + 2], sha256(MIGRATION_033))
            self.assertEqual(stdin_sequence[len(expected) + 3], sha256(PRIVATE_SQL))
            self.assertTrue((evidence / "schema-signature.sha256").is_file())
            self.assertTrue((evidence / "grant-signature.sha256").is_file())
            for name in (
                "rehearsal-summary.json",
                "schema-signature.sha256",
                "grant-signature.sha256",
                "dump-schema-probe.txt",
            ):
                self.assertEqual(stat.S_IMODE((evidence / name).stat().st_mode), 0o600)

            changed = FakeDocker(base / "changed")
            changed_dump = base / "changed-source.sql"
            changed_dump.write_text("CREATE TABLE source_table (id int);", encoding="utf-8")
            changed_result = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(changed_dump), "--evidence", str(base / "changed-evidence")],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=changed.env(FAKE_DOCKER_CHANGE_SCHEMA="1"),
                check=False,
            )
            self.assertNotEqual(changed_result.returncode, 0)
            self.assertIn("changed the schema signature", changed_result.stderr)

    def test_fresh_rehearsal_seeds_only_empty_legacy_migration_preconditions(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fake = FakeDocker(base)
            dump = base / "source.sql"
            dump.write_text("CREATE TABLE source_table (id int);", encoding="utf-8")
            result = subprocess.run(
                [str(HARNESS), "schema", "--dump-sql", str(dump), "--evidence", str(base / "evidence")],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=fake.env(),
                check=False,
            )
            entries = fake.entries()
        self.assertEqual(result.returncode, 0, result.stderr)
        fixture_indexes = {
            marker: [
                index for index, entry in enumerate(entries)
                if any(marker in arg for arg in entry["args"])
            ]
            for marker in (
                "rehearsal:legacy-fixture:hyb_stats",
                "rehearsal:legacy-fixture:google_ads_negative_keyword_recommendations",
            )
        }
        first_migration = next(index for index, entry in enumerate(entries) if "stdin_sha256" in entry)
        self.assertTrue(all(len(indexes) == 1 for indexes in fixture_indexes.values()))
        self.assertTrue(all(indexes[0] < first_migration for indexes in fixture_indexes.values()))

    def test_runbook_uses_standalone_schema_interface(self):
        runbook = RUNBOOK.read_text(encoding="utf-8")
        local_gate = runbook.split("## Local MySQL rehearsal checkpoint", 1)[1].split(
            "## Database accounts", 1
        )[0]
        self.assertIn("schema \\", local_gate)
        self.assertIn("--dump-sql", local_gate)
        self.assertIn("--evidence", local_gate)
        self.assertNotIn("--inputs", local_gate)


if __name__ == "__main__":
    unittest.main()
