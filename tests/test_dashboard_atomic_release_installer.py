from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard-next"
INSTALLER = DASHBOARD / "scripts/install-reviewed-release.sh"


def create_release_tree(root: Path) -> None:
    (root / ".next/static").mkdir(parents=True)
    (root / "public").mkdir()
    (root / "server.js").write_text("// server\n", encoding="utf-8")
    (root / ".next/static/app.js").write_text("// static\n", encoding="utf-8")
    (root / "public/site.txt").write_text("public\n", encoding="utf-8")


class DashboardAtomicReleaseInstallerTest(unittest.TestCase):
    def test_installs_full_tree_manifest_and_flips_active_symlink_atomically(self):
        self.assertTrue(INSTALLER.is_file(), "reviewed release installer is missing")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            create_release_tree(source)
            releases = base / "releases"
            active = base / "dashboard"
            result = subprocess.run(
                ["bash", str(INSTALLER), str(source), str(releases), str(active), "abcdef123456"],
                cwd=DASHBOARD,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            final = releases / "abcdef123456"
            self.assertTrue(active.is_symlink())
            self.assertEqual(active.resolve(), final.resolve())
            self.assertTrue((final / "server.js").is_file())
            self.assertTrue((final / ".next/static/app.js").is_file())
            self.assertTrue((final / "public/site.txt").is_file())
            manifest = (releases / "abcdef123456.sha256").read_text()
            self.assertIn("  server.js", manifest)
            self.assertIn("  .next/static/app.js", manifest)
            self.assertIn("  public/site.txt", manifest)
            verify = subprocess.run(
                ["sha256sum", "-c", str(releases / "abcdef123456.sha256")],
                cwd=final,
                capture_output=True,
                text=True,
            )
            self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_private_abbott_asset_blocks_install_before_active_flip(self):
        self.assertTrue(INSTALLER.is_file(), "reviewed release installer is missing")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            create_release_tree(source)
            (source / "public/abbott-users.json").write_text("[]\n", encoding="utf-8")
            active = base / "dashboard"
            result = subprocess.run(
                ["bash", str(INSTALLER), str(source), str(base / "releases"), str(active), "abcdef123456"],
                cwd=DASHBOARD,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(active.exists())
            self.assertFalse(active.is_symlink())

    def test_verified_existing_release_can_be_atomically_reactivated_for_rollback(self):
        self.assertTrue(INSTALLER.is_file(), "reviewed release installer is missing")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            releases = base / "releases"
            active = base / "dashboard"
            for revision in ("abcdef123456", "abcdef654321"):
                source = base / revision
                source.mkdir()
                create_release_tree(source)
                result = subprocess.run(
                    ["bash", str(INSTALLER), str(source), str(releases), str(active), revision],
                    cwd=DASHBOARD,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
            rollback = subprocess.run(
                [
                    "bash",
                    str(INSTALLER),
                    "--activate-existing",
                    str(releases),
                    str(active),
                    "abcdef123456",
                ],
                cwd=DASHBOARD,
                capture_output=True,
                text=True,
            )
            self.assertEqual(rollback.returncode, 0, rollback.stderr)
            self.assertEqual(active.resolve(), (releases / "abcdef123456").resolve())


if __name__ == "__main__":
    unittest.main()
