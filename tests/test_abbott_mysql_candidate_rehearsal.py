import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "ops/local/abbott_mysql_rehearsal.sh"


class FakeRehearsalTools:
    DOCKER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
log = Path(os.environ["FAKE_REHEARSAL_LOG"])
with log.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps({"tool": "docker", "args": args}) + "\n")

if args[:2] == ["image", "inspect"]:
    print("mysql@sha256:" + "b" * 64)
elif args and args[0] == "port":
    print("127.0.0.1:49153")
elif args and args[0] == "exec" and "mysql" in args:
    query = next((item.split("=", 1)[1] for item in args if item.startswith("--execute=")), "")
    if "information_schema.COLUMNS" in query:
        print("schema-stable")
    elif "information_schema.TABLE_PRIVILEGES" in query:
        print("grants-stable")
    elif "SELECT VERSION()" in query:
        print("8.4.10")
    elif "rehearsal:predecessor" in query:
        print("11")
    elif "rehearsal:import-summary" in query:
        print("4\t1769\t0\t4")
    elif "rehearsal:ambiguity-summary" in query:
        print("1769\t7\t6\t1")
    elif "rehearsal:lifecycle-summary" in query:
        print("11\tactive\t13\tretired")
sys.exit(0)
'''

    PYTHON = r'''#!/bin/sh
case "$*" in
  *capture_abbott_canonical_baseline.py*)
    printf '%s\n' '{"tool":"python","action":"baseline"}' >> "$FAKE_REHEARSAL_LOG"
    printf '%s\n' 'Frozen Abbott baseline snapshot 12'
    exit 0 ;;
  *abbott_release_operator.py*create*)
    printf '%s\n' '{"tool":"python","action":"create"}' >> "$FAKE_REHEARSAL_LOG"
    printf '%s\n' 'release_id=13 status=staging'
    exit 0 ;;
  *abbott_release_operator.py*validate*)
    count_file="$FAKE_REHEARSAL_LOG.validate"
    count=0; test ! -f "$count_file" || count=$(cat "$count_file")
    count=$((count + 1)); printf '%s' "$count" > "$count_file"
    printf '{"tool":"python","action":"validate","attempt":%s}\n' "$count" >> "$FAKE_REHEARSAL_LOG"
    test "$count" -gt 2 || exit 1
    printf '%s\n' 'release_id=13 status=validated'
    exit 0 ;;
  *abbott_release_operator.py*activate*)
    count_file="$FAKE_REHEARSAL_LOG.activate"
    count=0; test ! -f "$count_file" || count=$(cat "$count_file")
    count=$((count + 1)); printf '%s' "$count" > "$count_file"
    printf '{"tool":"python","action":"activate","attempt":%s}\n' "$count" >> "$FAKE_REHEARSAL_LOG"
    test "$count" -eq 1 || exit 1
    printf '%s\n' 'release_id=13 status=active'
    exit 0 ;;
  *abbott_release_operator.py*rollback*)
    printf '%s\n' '{"tool":"python","action":"rollback"}' >> "$FAKE_REHEARSAL_LOG"
    printf '%s\n' 'release_id=11 status=active'
    exit 0 ;;
  *compare_abbott_canonical_release.py*)
    printf '%s\n' '{"tool":"python","action":"compare"}' >> "$FAKE_REHEARSAL_LOG"
    exit 0 ;;
esac
exec "$REAL_PYTHON3" "$@"
'''

    NODE = r'''#!/bin/sh
printf '%s\n' '{"tool":"node","action":"import"}' >> "$FAKE_REHEARSAL_LOG"
printf '%s\n' 'Abbott import committed release=13 sources=4 idempotent=0'
'''

    def __init__(self, root: Path):
        self.root = root
        self.bin = root / "bin"
        self.bin.mkdir()
        self.log = root / "calls.jsonl"
        for name, body in (("docker", self.DOCKER), ("python3", self.PYTHON), ("node", self.NODE)):
            path = self.bin / name
            path.write_text(body, encoding="utf-8")
            path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.update(
            PATH=f"{self.bin}{os.pathsep}{env['PATH']}",
            FAKE_REHEARSAL_LOG=str(self.log),
            REAL_PYTHON3=subprocess.check_output(["which", "python3"], text=True).strip(),
        )
        return env

    def calls(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]


class AbbottMysqlCandidateRehearsalTest(unittest.TestCase):
    def make_inputs(self, root: Path) -> Path:
        inputs = root / "inputs"
        inputs.mkdir(mode=0o700)
        for name in (
            "abbott-workbook.json",
            "Abbott-names.xlsx",
            "bitrix-analytics.json",
            "bitrix-session-journeys.json",
        ):
            path = inputs / name
            path.write_text(f"private-fixture-{name}", encoding="utf-8")
            path.chmod(0o600)
        return inputs

    def run_mode(self, mode: str):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        fake = FakeRehearsalTools(root)
        inputs = self.make_inputs(root)
        evidence = root / "evidence"
        result = subprocess.run(
            [str(HARNESS), mode, "--inputs", str(inputs), "--evidence", str(evidence)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=fake.env(),
            check=False,
        )
        return temporary, fake, inputs, evidence, result

    def test_import_is_standalone_and_runs_baseline_candidate_and_real_importer(self):
        temporary, fake, inputs, evidence, result = self.run_mode("import")
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads((evidence / "import-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["source_kind_count"], 4)
            self.assertEqual(summary["catalog_count"], 1769)
            self.assertEqual(summary["rejected_count"], 0)
            self.assertEqual(summary["provenance_count"], 4)
            actions = [call.get("action") for call in fake.calls() if call.get("action")]
            self.assertEqual(actions, ["baseline", "create", "import"])
            docker_calls = [call["args"] for call in fake.calls() if call["tool"] == "docker"]
            self.assertTrue(any(call[:2] == ["rm", "--force"] for call in docker_calls))
            self.assertTrue(any(call[:3] == ["volume", "rm", "--force"] for call in docker_calls))
            combined = result.stdout + result.stderr
            for source in inputs.iterdir():
                self.assertNotIn(source.read_text(encoding="utf-8"), combined)
            self.assertEqual(stat.S_IMODE((evidence / "import-summary.json").stat().st_mode), 0o600)
        finally:
            temporary.cleanup()

    def test_lifecycle_rejects_two_gates_then_activates_rejects_stale_cas_and_rolls_back(self):
        temporary, fake, _inputs, evidence, result = self.run_mode("lifecycle")
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads((evidence / "lifecycle-summary.json").read_text(encoding="utf-8"))
            self.assertTrue(summary["incomplete_candidate_rejected"])
            self.assertTrue(summary["unreviewed_warning_rejected"])
            self.assertEqual(summary["warning_reviewed_by"], "local-rehearsal-reviewer")
            self.assertTrue(summary["validation_succeeded"])
            self.assertTrue(summary["activation_succeeded"])
            self.assertTrue(summary["stale_cas_rejected"])
            self.assertTrue(summary["rollback_restored_predecessor"])
            actions = [call.get("action") for call in fake.calls() if call.get("action")]
            self.assertEqual(
                actions,
                ["baseline", "create", "validate", "import", "compare", "validate", "validate", "activate", "activate", "rollback"],
            )
        finally:
            temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
