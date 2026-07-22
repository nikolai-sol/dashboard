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
    "lib/metrika_logs_api.py": "metrika_logs_api.py",
    "runtime/fetch_yandex_metrika_canonical.py": "fetch_yandex_metrika_canonical.py",
    "runtime/canonical_writer.py": "canonical_writer.py",
    "runtime/metrika_logs_api.py": "metrika_logs_api.py",
}


class AbbottRuntimeClosureTest(unittest.TestCase):
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

    def test_bootstrap_manifest_hashes_every_runtime_file_against_root_authority(self):
        bootstrap = ROOT / "dashboard-next/reportingdash-canonical-bootstrap"
        manifest = (bootstrap / "MIGRATION-MANIFEST.md").read_text()
        entries = {
            Path(path).name: (path, authority, digest)
            for path, authority, digest in re.findall(
                r"\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{64})` \|",
                manifest,
            )
            if path.startswith("runtime/")
        }
        self.assertEqual(set(entries), REQUIRED_RUNTIME)
        for name, (path, authority, digest) in entries.items():
            self.assertEqual(authority, name)
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
            {"mysql-connector-python", "python-dotenv", "requests"} <= packages
        )

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
            self.assertIn("python3 -m venv --copies", document)
            self.assertIn("importlib.metadata", document)
            self.assertIn("pip check", document)
            self.assertIn("is_symlink()", document)
            self.assertIn("resolve(strict=False)", document)
            self.assertIn("No package hashes are claimed", document)
        cron = runbook.split("Create the new crontab", 1)[1].split(
            "## Checkpoint 10", 1
        )[0]
        self.assertNotIn(" /usr/bin/python", cron)
        self.assertIn('root = "/root/reportingdash-abbott-canonical"', cron)
        self.assertIn('python = f"{root}/venv/bin/python"', cron)

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
