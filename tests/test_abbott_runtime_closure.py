from __future__ import annotations

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
        paths = {line.split("  ", 1)[1] for line in manifest.splitlines() if line}
        self.assertTrue(REQUIRED_RUNTIME <= paths, sorted(REQUIRED_RUNTIME - paths))

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
