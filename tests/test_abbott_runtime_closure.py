from __future__ import annotations

import ast
import importlib.metadata
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import hashlib
import re


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_RUNTIME = {
    "fetch_yandex_metrika_canonical.py",
    "canonical_writer.py",
    "metrika_dashboard_breakdowns.py",
    "metrika_logs_api.py",
    "canonical_release_store.py",
    "run_abbott_metrika_active_release.py",
    "abbott_release_operator.py",
    "probe_yandex_metrika_access.py",
    "capture_abbott_canonical_baseline.py",
    "compare_abbott_canonical_release.py",
    "abbott_canonical_controls.py",
    "metrika_pagination.py",
    "backfill_abbott_metrika_2026.py",
    "abbott_health_probe.py",
    "send_canonical_telegram_report.py",
    "sources_health_dashboard.py",
}
SYNCHRONIZED_BOOTSTRAP_COPIES = {
    "collectors/fetch_yandex_metrika_canonical.py": "fetch_yandex_metrika_canonical.py",
    "lib/canonical_writer.py": "canonical_writer.py",
    "lib/metrika_dashboard_breakdowns.py": "metrika_dashboard_breakdowns.py",
    "lib/metrika_logs_api.py": "metrika_logs_api.py",
    "lib/canonical_release_store.py": "canonical_release_store.py",
    "runtime/fetch_yandex_metrika_canonical.py": "fetch_yandex_metrika_canonical.py",
    "runtime/canonical_writer.py": "canonical_writer.py",
    "runtime/metrika_dashboard_breakdowns.py": "metrika_dashboard_breakdowns.py",
    "runtime/metrika_logs_api.py": "metrika_logs_api.py",
    "runtime/canonical_release_store.py": "canonical_release_store.py",
    "runtime/abbott_canonical_controls.py": "abbott_canonical_controls.py",
    "runtime/agents/abbott_page_classifier/candidate_release.py": "agents/abbott_page_classifier/candidate_release.py",
    "runtime/agents/abbott_page_classifier/classify.py": "agents/abbott_page_classifier/classify.py",
    "runtime/agents/abbott_page_classifier/approval_hashes.py": "agents/abbott_page_classifier/approval_hashes.py",
    "runtime/agents/__init__.py": "agents/__init__.py",
    "runtime/agents/abbott_page_classifier/domain.py": "agents/abbott_page_classifier/domain.py",
    "runtime/agents/abbott_page_classifier/normalization.py": "agents/abbott_page_classifier/normalization.py",
    "runtime/agents/abbott_page_classifier/__init__.py": "agents/abbott_page_classifier/__init__.py",
    "runtime/agents/abbott_page_classifier/weekly_proposal.py": "agents/abbott_page_classifier/weekly_proposal.py",
    "runtime/agents/abbott_page_classifier/workflow.py": "agents/abbott_page_classifier/workflow.py",
    "runtime/agents/abbott_page_classifier/workflow_service.py": "agents/abbott_page_classifier/workflow_service.py",
    "runtime/agents/abbott_page_classifier/workflow_repository.py": "agents/abbott_page_classifier/workflow_repository.py",
    "runtime/agents/abbott_page_classifier/repository.py": "agents/abbott_page_classifier/repository.py",
    "runtime/agents/abbott_page_classifier/batch_service.py": "agents/abbott_page_classifier/batch_service.py",
    "runtime/agents/abbott_page_classifier/reconcile.py": "agents/abbott_page_classifier/reconcile.py",
    "runtime/agents/abbott_page_classifier/identity.py": "agents/abbott_page_classifier/identity.py",
    "runtime/agents/abbott_page_classifier/sources.py": "agents/abbott_page_classifier/sources.py",
    "runtime/agents/abbott_page_classifier/llm_classifier.py": "agents/abbott_page_classifier/llm_classifier.py",
    "runtime/agents/abbott_page_classifier/sheets_sync.py": "agents/abbott_page_classifier/sheets_sync.py",
    "runtime/agents/abbott_page_classifier/python311_runtime.sh": "agents/abbott_page_classifier/python311_runtime.sh",
    "runtime/agents/abbott_page_classifier/run_classifier.sh": "agents/abbott_page_classifier/run_classifier.sh",
    "runtime/agents/abbott_page_classifier/run_weekly_proposal.sh": "agents/abbott_page_classifier/run_weekly_proposal.sh",
    "src/db/migrations/049_abbott_content_reconciliation_staging.sql": "dashboard-next/src/db/migrations/049_abbott_content_reconciliation_staging.sql",
    "src/db/migrations/050_abbott_content_url_identity.sql": "dashboard-next/src/db/migrations/050_abbott_content_url_identity.sql",
    "src/db/migrations/051_abbott_content_url_alias_decisions.sql": "dashboard-next/src/db/migrations/051_abbott_content_url_alias_decisions.sql",
    "src/db/migrations/052_abbott_content_taxonomy_v2.sql": "dashboard-next/src/db/migrations/052_abbott_content_taxonomy_v2.sql",
}
VENDORED_CONTENT_RUNTIME = {
    "runtime/agents/__init__.py",
    "runtime/agents/abbott_page_classifier/__init__.py",
    "runtime/agents/abbott_page_classifier/candidate_release.py",
    "runtime/agents/abbott_page_classifier/classify.py",
    "runtime/agents/abbott_page_classifier/approval_hashes.py",
    "runtime/agents/abbott_page_classifier/domain.py",
    "runtime/agents/abbott_page_classifier/normalization.py",
    "runtime/agents/abbott_page_classifier/weekly_proposal.py",
    "runtime/agents/abbott_page_classifier/workflow.py",
    "runtime/agents/abbott_page_classifier/workflow_service.py",
    "runtime/agents/abbott_page_classifier/workflow_repository.py",
    "runtime/agents/abbott_page_classifier/repository.py",
    "runtime/agents/abbott_page_classifier/batch_service.py",
    "runtime/agents/abbott_page_classifier/reconcile.py",
    "runtime/agents/abbott_page_classifier/identity.py",
    "runtime/agents/abbott_page_classifier/sources.py",
    "runtime/agents/abbott_page_classifier/llm_classifier.py",
    "runtime/agents/abbott_page_classifier/sheets_sync.py",
    "runtime/agents/abbott_page_classifier/python311_runtime.sh",
    "runtime/agents/abbott_page_classifier/run_classifier.sh",
    "runtime/agents/abbott_page_classifier/run_weekly_proposal.sh",
}
DEFAULT_SHEETS_GATEWAY_IMPORTS = {
    "google.auth.transport.requests": "google-auth",
    "google.oauth2.credentials": "google-auth",
    "googleapiclient.discovery": "google-api-python-client",
}


class AbbottRuntimeClosureTest(unittest.TestCase):
    def test_url_identity_parity_fixtures_are_byte_identical(self):
        python_fixture = ROOT / "tests/fixtures/abbott_url_identity_cases.json"
        typescript_fixture = (
            ROOT / "dashboard-next/src/lib/abbott-url-identity-cases.json"
        )
        self.assertEqual(
            hashlib.sha256(python_fixture.read_bytes()).hexdigest(),
            hashlib.sha256(typescript_fixture.read_bytes()).hexdigest(),
        )

    def test_url_identity_runtime_closure_and_operator_boundary(self):
        bootstrap = ROOT / "dashboard-next/reportingdash-canonical-bootstrap"
        classifier_root = ROOT / "agents/abbott_page_classifier"
        classifier_runtime = bootstrap / "runtime/agents/abbott_page_classifier"
        changed_classifier_files = (
            "approval_hashes.py",
            "batch_service.py",
            "candidate_release.py",
            "domain.py",
            "identity.py",
            "llm_classifier.py",
            "normalization.py",
            "reconcile.py",
            "repository.py",
            "sheets_sync.py",
            "sources.py",
            "weekly_proposal.py",
            "workflow.py",
            "workflow_repository.py",
            "workflow_service.py",
        )
        for name in changed_classifier_files:
            with self.subTest(classifier_file=name):
                self.assertEqual(
                    (classifier_runtime / name).read_bytes(),
                    (classifier_root / name).read_bytes(),
                )

        migration_manifest = (bootstrap / "MIGRATION-MANIFEST.md").read_text(
            encoding="utf-8"
        )
        self.assertEqual(
            migration_manifest.count(
                "`src/db/migrations/050_abbott_content_url_identity.sql`"
            ),
            1,
        )

        boundary = (
            "Observed page identity fixes use a DB-native successor release and "
            "never trigger a Metrika backfill."
        )
        for document in (
            ROOT / "agents/abbott_page_classifier/PROCESS.md",
            ROOT / "agents/abbott_page_classifier/README.md",
            ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md",
            ROOT / "AGENTS.md",
        ):
            with self.subTest(document=str(document.relative_to(ROOT))):
                self.assertIn(boundary, document.read_text(encoding="utf-8"))

    def _committed_runtime(self, root: Path) -> tuple[str, Path]:
        target = root / "entry.py"
        target.write_text("# entry\n", encoding="utf-8")
        manifest = root / "runtime.sha256"
        manifest.write_text(
            f"{hashlib.sha256(target.read_bytes()).hexdigest()}  entry.py\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
        subprocess.run(["git", "add", "entry.py", "runtime.sha256"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-qm", "runtime"], cwd=root, check=True)
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True
        ).stdout.strip()
        return revision, manifest

    def test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure(self):
        manifest = (ROOT / "ops/abbott-runtime-manifest.sha256").read_text()
        entries = {
            path: digest
            for digest, path in (
                line.split("  ", 1) for line in manifest.splitlines() if line
            )
        }
        self.assertTrue(REQUIRED_RUNTIME <= set(entries), sorted(REQUIRED_RUNTIME - set(entries)))
        for path in REQUIRED_RUNTIME:
            self.assertEqual(
                hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
                entries[path],
            )

    def test_attested_runtime_uses_python38_compatible_syntax(self):
        manifest = (ROOT / "ops/abbott-runtime-manifest.sha256").read_text()
        for line in manifest.splitlines():
            if not line:
                continue
            _, path = line.split("  ", 1)
            if not path.endswith(".py"):
                continue
            with self.subTest(path=path):
                ast.parse(
                    (ROOT / path).read_text(encoding="utf-8"),
                    filename=path,
                    feature_version=(3, 8),
                )

    def test_health_probe_imports_zoneinfo_backport_when_stdlib_module_is_unavailable(self):
        script = r'''import importlib.abc
import sys

class MissingStdlibZoneInfo(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "zoneinfo":
            raise ModuleNotFoundError("No module named 'zoneinfo'")
        return None

sys.meta_path.insert(0, MissingStdlibZoneInfo())
import abbott_health_probe
assert abbott_health_probe.ZoneInfo.__module__ == "backports.zoneinfo"
'''
        with tempfile.TemporaryDirectory() as directory:
            backports = Path(directory) / "backports"
            backports.mkdir()
            (backports / "__init__.py").write_text("", encoding="utf-8")
            (backports / "zoneinfo.py").write_text(
                "class ZoneInfo:\n    pass\n"
                "class ZoneInfoNotFoundError(Exception):\n    pass\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                env={
                    **os.environ,
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "PYTHONPATH": os.pathsep.join((directory, str(ROOT))),
                },
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_python38_zoneinfo_backport_is_environment_marked_in_runtime_requirements(self):
        requirement_files = (
            ROOT / "requirements.txt",
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/requirements.txt",
        )
        for path in requirement_files:
            with self.subTest(path=str(path.relative_to(ROOT))):
                self.assertIn(
                    'backports.zoneinfo==0.2.1; python_version < "3.9"',
                    path.read_text().splitlines(),
                )

    def test_all_synchronized_bootstrap_copies_match_root_authorities_and_manifest(self):
        bootstrap = ROOT / "dashboard-next/reportingdash-canonical-bootstrap"
        manifest = (bootstrap / "MIGRATION-MANIFEST.md").read_text()
        entries = {
            path: (authority, digest)
            for path, authority, digest in re.findall(
                r"\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{64})` \|",
                manifest,
            )
        }
        for path, authority in SYNCHRONIZED_BOOTSTRAP_COPIES.items():
            with self.subTest(path=path):
                root_bytes = (ROOT / authority).read_bytes()
                digest = hashlib.sha256(root_bytes).hexdigest()
                self.assertEqual((bootstrap / path).read_bytes(), root_bytes)
                self.assertEqual(entries.get(path), (authority, digest))

    def test_bootstrap_runtime_imports_without_parent_repository(self):
        runtime = ROOT / "dashboard-next/reportingdash-canonical-bootstrap/runtime"
        self.assertEqual(
            {path.name for path in runtime.glob("*.py")},
            REQUIRED_RUNTIME,
        )
        command = [
            sys.executable,
            "-c",
            ";".join(f"import {name[:-3]}" for name in sorted(REQUIRED_RUNTIME)),
        ]
        result = subprocess.run(
            command,
            cwd=runtime,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_isolated_bootstrap_executes_content_control_path(self):
        runtime = ROOT / "dashboard-next/reportingdash-canonical-bootstrap/runtime"
        script = r'''
import json
from abbott_canonical_controls import compare_release_control_pack

class Cursor:
    def __init__(self): self.one = None; self.rows = []; self.calls = []
    def execute(self, sql, params=None):
        sql = " ".join(sql.split()); self.calls.append(sql); self.one = None; self.rows = []
        if sql.startswith("SELECT manifest_json"):
            self.one = {"manifest_json": json.dumps({
                "date_from":"2026-01-01", "date_to":"2026-01-01",
                "control_values":{"content.dashboard_smoke_failures":0},
                "content_candidate_bundle":{"expected_counts":{"source":1,"ready":1,"conflict":0,"unresolved":0,"rejected":0,"accepted":1},"accepted_decision_hash":"a"*64}
            })}
        elif sql.startswith("SELECT code_revision"):
            self.one = {"code_revision":"abc1234","baseline_validation_run_id":33}
        elif "canonical_fact_metrika_site_analytics_daily" in sql: self.rows = []
        elif "canonical_source_coverage_daily" in sql:
            self.rows = [{"scope_key":s,"coverage_days":1,"reconciled_days":1,"api_total_rows":0,"persisted_rows":0} for s in ("other","traffic","page","user_behavior","returning")]
    def fetchone(self): return self.one
    def fetchall(self): return list(self.rows)
    def fetchmany(self, size=1): return []
    def close(self): pass
class Conn:
    def __init__(self): self.cur=Cursor()
    def cursor(self, **kwargs): return self.cur
    def start_transaction(self, **kwargs): pass
    def commit(self): pass
    def rollback(self): pass

import agents.abbott_page_classifier.candidate_release as candidate
candidate.validate_content_candidate = lambda *args, **kwargs: candidate.GateReport(candidate_release_id=41)
results = compare_release_control_pack(Conn(), baseline_run_id=33, candidate_release_id=41)
assert any(r.control_name == "content.dashboard_smoke_failures" and r.result_status == "pass" for r in results)
'''
        result = subprocess.run(
            [sys.executable, "-c", script], cwd=runtime,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_isolated_bootstrap_executes_weekly_proposal_with_only_a_fake_gateway(self):
        runtime = ROOT / "dashboard-next/reportingdash-canonical-bootstrap/runtime"
        script = r'''
import io
import json
from contextlib import redirect_stdout
from agents.abbott_page_classifier.weekly_proposal import main
from agents.abbott_page_classifier.workflow import WorkflowDependencies

class Gateway:
    def __init__(self): self.calls = []
    def reconcile(self, first, second, *, dry_run):
        self.calls.append(("reconcile", first.name, second.name, dry_run))
        return {"run_id": 17, "run_key": "a" * 64, "source_count": 2}
    def classify(self, run_id, *, execute_llm, dry_run):
        self.calls.append(("classify", run_id, execute_llm, dry_run))
        return {"batch_id": 23, "batch_key": "b" * 64}
    def publish_projection(self, batch_id, *, dry_run):
        self.calls.append(("publish", batch_id, dry_run))
        return {"ready_count": 2, "published_input_hash": "c" * 64}

gateway = Gateway()
stream = io.StringIO()
with redirect_stdout(stream):
    result = main([
        "--registry1", "registry1.xlsx", "--registry2", "registry2.csv",
        "--taxonomy-version", "abbott.v1", "--prompt-version", "prompt.v1",
        "--model-routing-version", "routing.v1", "--code-revision", "a" * 40,
        "--execute",
    ], dependencies_factory=lambda _configuration: WorkflowDependencies(gateway))
assert result == 0
assert gateway.calls == [
    ("reconcile", "registry1.xlsx", "registry2.csv", False),
    ("classify", 17, False, False),
    ("publish", 23, False),
]
assert json.loads(stream.getvalue())["status"] == "proposal_published"
'''
        result = subprocess.run(
            [sys.executable, "-c", script], cwd=runtime,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_bootstrap_manifest_hashes_every_runtime_file_against_root_authority(self):
        bootstrap = ROOT / "dashboard-next/reportingdash-canonical-bootstrap"
        manifest = (bootstrap / "MIGRATION-MANIFEST.md").read_text()
        entries = {
            path: (authority, digest)
            for path, authority, digest in re.findall(
                r"\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{64})` \|",
                manifest,
            )
            if path.startswith("runtime/")
        }
        expected_paths = {f"runtime/{name}" for name in REQUIRED_RUNTIME} | VENDORED_CONTENT_RUNTIME
        self.assertEqual(set(entries), expected_paths)
        for path, (authority, digest) in entries.items():
            expected_authority = SYNCHRONIZED_BOOTSTRAP_COPIES.get(
                path, Path(path).name
            )
            self.assertEqual(authority, expected_authority)
            self.assertEqual(
                hashlib.sha256((bootstrap / path).read_bytes()).hexdigest(), digest
            )
            self.assertEqual(
                hashlib.sha256((ROOT / authority).read_bytes()).hexdigest(), digest
            )

    def test_bootstrap_declares_runtime_third_party_dependencies(self):
        requirements = (
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/requirements.txt"
        ).read_text().splitlines()
        packages = {line.split("==", 1)[0].lower() for line in requirements if line and not line.startswith("#")}
        self.assertTrue(
            {
                "mysql-connector-python", "python-dotenv", "requests",
                "openai", "openpyxl", "pydantic",
            } <= packages
        )

    def test_default_sheets_gateway_imports_have_declared_runtime_distributions(self):
        source = (ROOT / "agents/abbott_page_classifier/sheets_sync.py").read_text(
            encoding="utf-8"
        )
        tree = ast.parse(source)
        functions = {
            node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
        }
        imported_modules = set()
        for function_name in ("load_creds", "services"):
            for node in ast.walk(functions[function_name]):
                if isinstance(node, ast.ImportFrom) and node.module:
                    imported_modules.add(node.module)
        self.assertEqual(set(DEFAULT_SHEETS_GATEWAY_IMPORTS), imported_modules)

        bootstrap_requirements = (
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/requirements.txt"
        ).read_text(encoding="utf-8").splitlines()
        bootstrap_packages = {
            line.split("==", 1)[0].lower()
            for line in bootstrap_requirements
            if line and not line.startswith("#")
        }
        self.assertTrue(set(DEFAULT_SHEETS_GATEWAY_IMPORTS.values()) <= bootstrap_packages)

        root_requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        self.assertRegex(root_requirements, r"(?m)^google-api-python-client>=2\.0,<3$")
        self.assertRegex(root_requirements, r"(?m)^google-auth>=2\.0,<3$")

    def test_attestation_rejects_a_dirty_tracked_worktree(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "entry.py"
            target.write_text("# entry\n", encoding="utf-8")
            import hashlib
            manifest = root / "runtime.sha256"
            manifest.write_text(
                f"{hashlib.sha256(target.read_bytes()).hexdigest()}  entry.py\n",
                encoding="utf-8",
            )
            with patch.object(launcher, "_git_revision", return_value="abc123"), patch.object(
                launcher, "_tracked_worktree_status", return_value=" M entry.py", create=True
            ), patch.object(
                launcher, "_head_blob", return_value=manifest.read_bytes(), create=True
            ):
                with self.assertRaises(launcher.ActiveReleaseLaunchError):
                    launcher.attest_runtime(root, "abc123", manifest)

    def test_attestation_rejects_untracked_import_or_executable_shadow_files(self):
        import run_abbott_metrika_active_release as launcher

        for relative in ("sitecustomize.py", "requests.py", "dotenv.py", "mysql/__init__.py", "other.sh"):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                revision, manifest = self._committed_runtime(root)
                shadow = root / relative
                shadow.parent.mkdir(parents=True, exist_ok=True)
                shadow.write_text("# untracked shadow\n", encoding="utf-8")

                with self.assertRaises(launcher.ActiveReleaseLaunchError):
                    launcher.attest_runtime(root, revision, manifest)

    def test_attestation_allows_only_named_untracked_operational_paths(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            revision, manifest = self._committed_runtime(root)
            (root / ".env").write_text("PROTECTED=placeholder\n", encoding="utf-8")
            (root / "venv/lib").mkdir(parents=True)
            (root / "venv/lib/installed.txt").write_text("package\n", encoding="utf-8")
            (root / "logs").mkdir()
            (root / "logs/collector.log").write_text("ok\n", encoding="utf-8")

            launcher.attest_runtime(root, revision, manifest)

    def test_attestation_rejects_symlink_escape_from_an_allowed_untracked_path(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            revision, manifest = self._committed_runtime(root)
            (root / ".gitignore").write_text("logs/\n", encoding="utf-8")
            subprocess.run(["git", "add", ".gitignore"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "ignore logs"], cwd=root, check=True)
            revision = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=root, check=True,
                capture_output=True, text=True,
            ).stdout.strip()
            (root / "logs").mkdir()
            (root / "logs/escape").symlink_to(Path(outside) / "collector.log")

            with self.assertRaises(launcher.ActiveReleaseLaunchError):
                launcher.attest_runtime(root, revision, manifest)

    def test_attestation_rejects_ignored_files_outside_the_exact_allowlist(self):
        import run_abbott_metrika_active_release as launcher

        for relative, pattern in (("requests.pyc", "*.pyc"), (".env.local", ".env.*")):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                revision, manifest = self._committed_runtime(root)
                (root / ".gitignore").write_text(pattern + "\n", encoding="utf-8")
                subprocess.run(["git", "add", ".gitignore"], cwd=root, check=True)
                subprocess.run(["git", "commit", "-qm", "ignore local file"], cwd=root, check=True)
                revision = subprocess.run(
                    ["git", "rev-parse", "HEAD"], cwd=root, check=True,
                    capture_output=True, text=True,
                ).stdout.strip()
                (root / relative).write_bytes(b"ignored shadow\n")

                with self.assertRaises(launcher.ActiveReleaseLaunchError):
                    launcher.attest_runtime(root, revision, manifest)

    def test_standard_symlink_venv_fails_with_copies_remediation(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            revision, manifest = self._committed_runtime(root)
            (root / ".gitignore").write_text("venv/\n", encoding="utf-8")
            subprocess.run(["git", "add", ".gitignore"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "ignore venv"], cwd=root, check=True)
            revision = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=root, check=True,
                capture_output=True, text=True,
            ).stdout.strip()
            subprocess.run(
                [sys.executable, "-m", "venv", str(root / "venv")], check=True
            )

            with self.assertRaises(launcher.ActiveReleaseLaunchError) as raised:
                launcher.attest_runtime(root, revision, manifest)
            self.assertEqual(
                str(raised.exception),
                "Canonical runtime venv contains an external symlink; recreate it with python3 -m venv --copies",
            )

    def test_copies_venv_has_no_external_symlink_and_attests(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            revision, manifest = self._committed_runtime(root)
            (root / ".gitignore").write_text("venv/\n", encoding="utf-8")
            subprocess.run(["git", "add", ".gitignore"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-qm", "ignore venv"], cwd=root, check=True)
            revision = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=root, check=True,
                capture_output=True, text=True,
            ).stdout.strip()
            copy_capable_python = Path("/opt/homebrew/bin/python3")
            subprocess.run(
                [
                    str(copy_capable_python if copy_capable_python.exists() else sys.executable),
                    "-m",
                    "venv",
                    "--copies",
                    str(root / "venv"),
                ],
                check=True,
            )

            launcher.attest_runtime(root, revision, manifest)

    def test_runbook_and_bootstrap_install_and_verify_copied_pinned_venv(self):
        runbook = (ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md").read_text()
        bootstrap = (
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/README.md"
        ).read_text()
        for document in (runbook, bootstrap):
            self.assertIn("-m venv --copies", document)
            self.assertIn("importlib.metadata", document)
            self.assertIn("pip check", document)
            self.assertIn("is_symlink()", document)
            self.assertIn("resolve(strict=False)", document)
            self.assertIn("No package hashes are claimed", document)
            self.assertIn("ABBOTT_CONTENT_PYTHON311_BIN", document)
            self.assertIn("sys.version_info[:2]", document)
        cron = runbook.split("Create the new crontab", 1)[1].split(
            "## Checkpoint 10", 1
        )[0]
        self.assertNotIn(" /usr/bin/python", cron)
        self.assertIn('root = "/root/reportingdash-abbott-canonical"', cron)
        self.assertIn('python = f"{root}/venv/bin/python"', cron)

    def test_bootstrap_smoke_imports_content_materializer_eagerly(self):
        bootstrap = (
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/README.md"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "agents.abbott_page_classifier.candidate_release",
            bootstrap,
        )

    def test_documented_pin_verifiers_accept_an_inactive_python38_marker(self):
        documents = (
            ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md",
            ROOT / "dashboard-next/reportingdash-canonical-bootstrap/README.md",
        )
        pip_version = importlib.metadata.version("pip")
        for document in documents:
            snippets = re.findall(
                r"<<'PY'\n(.*?)\nPY",
                document.read_text(encoding="utf-8"),
                flags=re.DOTALL,
            )
            verifier = next(snippet for snippet in snippets if "pins = {}" in snippet)
            with self.subTest(document=str(document.relative_to(ROOT))):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    venv = root / "venv"
                    venv.mkdir()
                    requirements = root / "requirements.txt"
                    requirements.write_text(
                        f"pip=={pip_version}\n"
                        'backports.zoneinfo==0.2.1; python_version < "3.9"\n',
                        encoding="utf-8",
                    )
                    result = subprocess.run(
                        [sys.executable, "-c", verifier, str(venv), str(requirements)],
                        capture_output=True,
                        text=True,
                    )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_attestation_rejects_a_working_manifest_not_committed_at_head(self):
        import run_abbott_metrika_active_release as launcher

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "entry.py"
            target.write_text("# entry\n", encoding="utf-8")
            import hashlib
            manifest = root / "runtime.sha256"
            manifest.write_text(
                f"{hashlib.sha256(target.read_bytes()).hexdigest()}  entry.py\n",
                encoding="utf-8",
            )
            with patch.object(launcher, "_git_revision", return_value="abc123"), patch.object(
                launcher, "_tracked_worktree_status", return_value="", create=True
            ), patch.object(
                launcher, "_head_blob", return_value=b"different committed blob\n", create=True
            ):
                with self.assertRaises(launcher.ActiveReleaseLaunchError):
                    launcher.attest_runtime(root, "abc123", manifest)


if __name__ == "__main__":
    unittest.main()
