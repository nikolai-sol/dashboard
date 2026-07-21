import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT = ROOT / "abbott_rollout_preflight.py"


class AbbottRolloutPreflightTest(unittest.TestCase):
    def write_private(self, path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")
        path.chmod(0o600)

    def local_evidence(self, root: Path, lifecycle: bool = False) -> Path:
        evidence = root / "evidence"
        evidence.mkdir(mode=0o700)
        self.write_private(
            evidence / "rehearsal-summary.json",
            json.dumps({
                "mode": "schema",
                "repeat_safe": True,
                "dump_schema_probe": {"schema_only": True, "sql_error_class": "none"},
            }),
        )
        if lifecycle:
            self.write_private(
                evidence / "lifecycle-summary.json",
                json.dumps({
                    "mode": "lifecycle",
                    "validation_succeeded": True,
                    "activation_succeeded": True,
                    "rollback_restored_predecessor": True,
                }),
            )
        return evidence

    def command(self, evidence: Path, collector: Path, importer: Path, release: Path, dashboard: Path, token: Path):
        return [
            sys.executable,
            str(PREFLIGHT),
            "--local-evidence", str(evidence),
            "--collector-env", str(collector),
            "--import-env", str(importer),
            "--release-env", str(release),
            "--dashboard-env", str(dashboard),
            "--owner-token", str(token),
        ]

    def test_missing_external_authority_is_blocked_without_failing_local_handoff(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = subprocess.run(
                self.command(
                    self.local_evidence(root),
                    root / "missing-collector",
                    root / "missing-importer",
                    root / "missing-release",
                    root / "missing-dashboard",
                    root / "missing-token",
                ),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["local_rehearsal"]["status"], "ready")
        self.assertEqual(
            report["local_rehearsal"]["reason_code"],
            "repeat_safe_schema_rehearsed",
        )
        for gate in ("owner_token", "release_db", "dashboard_db", "production_runtime", "cron", "hermes"):
            self.assertEqual(report[gate]["status"], "blocked")

    def test_repeat_safe_schema_is_ready_without_live_bitrix_lifecycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence = self.local_evidence(root, lifecycle=True)
            collector = root / "collector.env"
            importer = root / "importer.env"
            release = root / "release.env"
            dashboard = root / "dashboard.env"
            token = root / "owner.token"
            self.write_private(collector, "MYSQL_HOST=x\nMYSQL_PORT=1\nMYSQL_USER=x\nMYSQL_PASSWORD=x\nMYSQL_DB=report_bd\nMETRIKA_TOKEN=x\n")
            self.write_private(importer, "ABBOTT_IMPORT_DB_HOST=x\nABBOTT_IMPORT_DB_PORT=1\nABBOTT_IMPORT_DB_USER=x\nABBOTT_IMPORT_DB_PASSWORD=x\n")
            self.write_private(release, "ABBOTT_RELEASE_DB_HOST=x\nABBOTT_RELEASE_DB_PORT=1\nABBOTT_RELEASE_DB_USER=x\nABBOTT_RELEASE_DB_PASSWORD=x\nABBOTT_RELEASE_DB_NAME=report_bd\n")
            self.write_private(dashboard, "ABBOTT_EMBED_DB_HOST=x\nABBOTT_EMBED_DB_PORT=1\nABBOTT_EMBED_DB_USER=x\nABBOTT_EMBED_DB_PASSWORD=x\nABBOTT_EMBED_DB_NAME=report_bd\nABBOTT_PRIVATE_DB_HOST=x\nABBOTT_PRIVATE_DB_PORT=1\nABBOTT_PRIVATE_DB_USER=x\nABBOTT_PRIVATE_DB_PASSWORD=x\nABBOTT_PRIVATE_DB_NAME=report_bd_private\n")
            self.write_private(token, "owner-token-placeholder\n")
            result = subprocess.run(
                self.command(evidence, collector, importer, release, dashboard, token),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["local_rehearsal"]["status"], "ready")
        self.assertEqual(
            report["local_rehearsal"]["reason_code"],
            "repeat_safe_schema_rehearsed",
        )
        self.assertEqual(report["owner_token"]["status"], "ready")
        self.assertEqual(report["release_db"]["status"], "ready")
        self.assertEqual(report["dashboard_db"]["status"], "ready")
        self.assertEqual(report["production_runtime"]["status"], "ready")
        self.assertEqual(report["cron"]["status"], "blocked")
        self.assertEqual(report["hermes"]["status"], "blocked")

    def test_dashboard_database_names_must_match_audience_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            collector = root / "collector.env"
            importer = root / "importer.env"
            release = root / "release.env"
            dashboard = root / "dashboard.env"
            token = root / "owner.token"
            self.write_private(collector, "MYSQL_HOST=x\nMYSQL_PORT=1\nMYSQL_USER=x\nMYSQL_PASSWORD=x\nMYSQL_DB=report_bd\nMETRIKA_TOKEN=x\n")
            self.write_private(importer, "ABBOTT_IMPORT_DB_HOST=x\nABBOTT_IMPORT_DB_PORT=1\nABBOTT_IMPORT_DB_USER=x\nABBOTT_IMPORT_DB_PASSWORD=x\n")
            self.write_private(release, "ABBOTT_RELEASE_DB_HOST=x\nABBOTT_RELEASE_DB_PORT=1\nABBOTT_RELEASE_DB_USER=x\nABBOTT_RELEASE_DB_PASSWORD=x\nABBOTT_RELEASE_DB_NAME=report_bd\n")
            self.write_private(dashboard, "ABBOTT_EMBED_DB_HOST=x\nABBOTT_EMBED_DB_PORT=1\nABBOTT_EMBED_DB_USER=x\nABBOTT_EMBED_DB_PASSWORD=x\nABBOTT_EMBED_DB_NAME=report_bd_private\nABBOTT_PRIVATE_DB_HOST=x\nABBOTT_PRIVATE_DB_PORT=1\nABBOTT_PRIVATE_DB_USER=x\nABBOTT_PRIVATE_DB_PASSWORD=x\nABBOTT_PRIVATE_DB_NAME=report_bd\n")
            self.write_private(token, "owner-token-placeholder\n")
            result = subprocess.run(
                self.command(self.local_evidence(root), collector, importer, release, dashboard, token),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["dashboard_db"]["status"], "blocked")
        self.assertEqual(report["dashboard_db"]["reason_code"], "invalid_database_boundary")
        self.assertEqual(report["production_runtime"]["status"], "blocked")

    def test_dangling_symlink_is_rejected_as_unsafe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence = self.local_evidence(root)
            dangling = root / "dangling.env"
            dangling.symlink_to(root / "missing-target.env")
            result = subprocess.run(
                self.command(
                    evidence,
                    dangling,
                    root / "missing-importer",
                    root / "missing-release",
                    root / "missing-dashboard",
                    root / "missing-token",
                ),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            json.loads(result.stdout),
            {"error": {"status": "invalid", "reason_code": "unsafe_supplied_file"}},
        )

    def test_unsafe_or_multiline_supplied_file_fails_closed_with_sanitized_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence = self.local_evidence(root)
            valid = root / "valid.env"
            self.write_private(valid, "ABBOTT_IMPORT_DB_HOST=x\nABBOTT_IMPORT_DB_PORT=1\nABBOTT_IMPORT_DB_USER=x\nABBOTT_IMPORT_DB_PASSWORD=x\n")
            invalid = root / "invalid.env"
            self.write_private(invalid, 'ABBOTT_RELEASE_DB_HOST="first\nsecond"\n')
            alias = root / "alias.env"
            alias.symlink_to(valid)
            token = root / "token"
            self.write_private(token, "x\n")
            result = subprocess.run(
                self.command(evidence, root / "missing", valid, invalid, root / "missing-dashboard", alias),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 2)
        report = json.loads(result.stdout)
        serialized = json.dumps(report).lower()
        for forbidden in ("value", "host", "path", "first", "second", str(root).lower()):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
