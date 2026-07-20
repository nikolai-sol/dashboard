import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "ops/local/abbott_mysql_rehearsal.sh"


class AbbottMysqlCandidateRehearsalTest(unittest.TestCase):
    def test_import_and_lifecycle_are_deferred_before_docker_or_input_reads(self):
        for mode in ("import", "lifecycle"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                binary_dir = root / "bin"
                binary_dir.mkdir()
                docker_log = root / "docker-called"
                fake_docker = binary_dir / "docker"
                fake_docker.write_text(
                    f"#!/bin/sh\nprintf called > {docker_log!s}\nexit 99\n",
                    encoding="utf-8",
                )
                fake_docker.chmod(fake_docker.stat().st_mode | stat.S_IXUSR)
                env = os.environ.copy()
                env["PATH"] = f"{binary_dir}{os.pathsep}{env['PATH']}"

                inputs = root / "inputs-that-must-not-be-read"
                evidence = root / "evidence-that-must-not-be-created"
                result = subprocess.run(
                    [
                        str(HARNESS),
                        mode,
                        "--inputs",
                        str(inputs),
                        "--evidence",
                        str(evidence),
                    ],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    check=False,
                )

                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertIn("live Bitrix database connector", result.stderr)
                self.assertFalse(docker_log.exists())
                self.assertFalse(evidence.exists())


if __name__ == "__main__":
    unittest.main()
