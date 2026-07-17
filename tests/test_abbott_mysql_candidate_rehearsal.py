import json
import os
from pathlib import Path
import stat
import subprocess
import socket
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

if args[:2] == ["context", "show"]:
    print("fake-local")
    sys.exit(0)
if args[:2] == ["context", "inspect"]:
    print(os.environ["FAKE_DOCKER_ENDPOINT"])
    sys.exit(0)
if args and args[0] == "run" and os.environ.get("FAKE_DOCKER_REQUIRE_SHARED") == "1":
    mounts = [item for item in args if item.startswith("type=bind,source=")]
    if any("source=/var/folders/" in item for item in mounts):
        sys.exit(125)
if args[:2] == ["image", "inspect"]:
    print("mysql@sha256:" + "b" * 64)
elif args and args[0] == "port":
    print("127.0.0.1:49153")
elif args and args[0] == "exec" and "mysql" in args:
    query = next((item.split("=", 1)[1] for item in args if item.startswith("--execute=")), "")
    if "rehearsal:deny:" in query:
        print("ERROR 1142 (42000): command denied", file=sys.stderr)
        sys.exit(1)
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
    if test "$count" -le 2; then
      if test "${FAKE_RELEASE_WRONG_ERROR:-0}" = 1; then printf '%s\n' 'Unexpected failure' >&2
      elif test "$count" -eq 1; then printf '%s\n' 'Canonical release source snapshots are invalid' >&2
      else printf '%s\n' 'Canonical validation evidence did not pass review' >&2
      fi
      exit 1
    fi
    printf '%s\n' 'release_id=13 status=validated'
    exit 0 ;;
  *abbott_release_operator.py*activate*)
    count_file="$FAKE_REHEARSAL_LOG.activate"
    count=0; test ! -f "$count_file" || count=$(cat "$count_file")
    count=$((count + 1)); printf '%s' "$count" > "$count_file"
    printf '{"tool":"python","action":"activate","attempt":%s}\n' "$count" >> "$FAKE_REHEARSAL_LOG"
    if test "$count" -ne 1; then
      if test "${FAKE_RELEASE_WRONG_ERROR:-0}" = 1; then printf '%s\n' 'Unexpected failure' >&2
      else printf '%s\n' 'Active canonical release pointer changed' >&2
      fi
      exit 1
    fi
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

    GIT = r'''#!/bin/sh
if test -n "${FAKE_DASHBOARD_HEAD:-}"; then
  case " $* " in
    *dashboard-next*' rev-parse HEAD '*) printf '%s\n' "$FAKE_DASHBOARD_HEAD"; exit 0 ;;
  esac
fi
exec "$REAL_GIT" "$@"
'''

    def __init__(self, root: Path):
        self.root = root
        self.bin = root / "bin"
        self.bin.mkdir()
        self.log = root / "calls.jsonl"
        self.socket_path = root / "docker.sock"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(self.socket_path))
        sock.close()
        for name, body in (("docker", self.DOCKER), ("python3", self.PYTHON), ("node", self.NODE), ("git", self.GIT)):
            path = self.bin / name
            path.write_text(body, encoding="utf-8")
            path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def env(self, **updates: str) -> dict[str, str]:
        env = os.environ.copy()
        env.update(
            PATH=f"{self.bin}{os.pathsep}{env['PATH']}",
            FAKE_REHEARSAL_LOG=str(self.log),
            FAKE_DOCKER_ENDPOINT=f"unix://{self.socket_path}",
            REAL_PYTHON3=subprocess.check_output(["which", "python3"], text=True).strip(),
            REAL_GIT=subprocess.check_output(["which", "git"], text=True).strip(),
        )
        env.update(updates)
        return env

    def calls(self) -> list[dict]:
        if not self.log.exists():
            return []
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

    def run_mode(self, mode: str, **env_updates: str):
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
            env=fake.env(**env_updates),
            check=False,
        )
        return temporary, fake, inputs, evidence, result

    def test_macos_unshared_tmpdir_is_not_sent_to_the_daemon_as_a_bind(self):
        temporary, fake, _inputs, _evidence, result = self.run_mode(
            "import", FAKE_DOCKER_REQUIRE_SHARED="1"
        )
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            run = next(
                call["args"] for call in fake.calls()
                if call["tool"] == "docker" and call["args"][:1] == ["run"]
            )
            self.assertFalse(any(item.startswith("type=bind,") for item in run))
        finally:
            temporary.cleanup()

    def test_container_start_has_no_daemon_side_host_bind_dependency(self):
        temporary, fake, _inputs, _evidence, result = self.run_mode("import")
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            docker_calls = [call["args"] for call in fake.calls() if call["tool"] == "docker"]
            run = next(call for call in docker_calls if call[:1] == ["run"])
            self.assertFalse(any(item.startswith("type=bind,") for item in run))
            self.assertTrue(any(call[:1] == ["cp"] for call in docker_calls))
        finally:
            temporary.cleanup()

    def test_mysqladmin_reads_the_protected_option_file_before_ping(self):
        temporary, fake, _inputs, _evidence, result = self.run_mode("import")
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            ping = next(
                call["args"] for call in fake.calls()
                if call.get("tool") == "docker"
                and call.get("args", [])[:2] == ["exec", call.get("args", [None, None])[1]]
                and "mysqladmin" in call.get("args", [])
            )
            mysqladmin_index = ping.index("mysqladmin")
            option_index = next(
                index for index, value in enumerate(ping)
                if value.startswith("--defaults-extra-file=")
            )
            self.assertEqual(option_index, mysqladmin_index + 1)
            self.assertEqual(ping[option_index + 1], "ping")
        finally:
            temporary.cleanup()

    def test_ambient_or_remote_docker_authority_stops_before_mutation(self):
        for updates in (
            {"DOCKER_HOST": "unix:///tmp/ambient.sock"},
            {"DOCKER_CONTEXT": "ambient"},
            {"FAKE_DOCKER_ENDPOINT": "tcp://127.0.0.1:2375"},
            {"FAKE_DOCKER_ENDPOINT": "ssh://local-alias"},
        ):
            with self.subTest(updates=updates):
                temporary, fake, _inputs, _evidence, result = self.run_mode("import", **updates)
                try:
                    self.assertNotEqual(result.returncode, 0)
                    mutations = {"pull", "run", "create", "rm", "cp"}
                    self.assertFalse(any(
                        call.get("tool") == "docker"
                        and call.get("args")
                        and call["args"][0] in mutations
                        for call in fake.calls()
                    ))
                finally:
                    temporary.cleanup()

    def test_private_base_rejects_git_symlink_and_permissive_paths_before_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            permissive = base / "permissive"
            permissive.mkdir(mode=0o755)
            permissive.chmod(0o755)
            alias = base / "alias"
            alias.symlink_to(permissive, target_is_directory=True)
            for candidate in (ROOT, permissive, alias):
                with self.subTest(candidate=candidate):
                    run_temp, fake, _inputs, _evidence, result = self.run_mode(
                        "import", ABBOTT_REHEARSAL_PRIVATE_BASE=str(candidate)
                    )
                    try:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertFalse(any(call.get("tool") == "docker" for call in fake.calls()))
                    finally:
                        run_temp.cleanup()

    def test_dashboard_gitlink_drift_stops_before_docker(self):
        temporary, fake, _inputs, _evidence, result = self.run_mode(
            "import", FAKE_DASHBOARD_HEAD="0" * 40
        )
        try:
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(any(call.get("tool") == "docker" for call in fake.calls()))
        finally:
            temporary.cleanup()

    def test_role_allow_deny_probes_are_recorded_in_import_evidence(self):
        temporary, fake, _inputs, evidence, result = self.run_mode("import")
        try:
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads((evidence / "import-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(
                summary["role_grant_probes"],
                {"collector": True, "importer": True, "operator": True, "runtime_reader": True},
            )
            queries = [
                item for call in fake.calls() if call["tool"] == "docker"
                for item in call["args"] if "rehearsal:" in item
            ]
            self.assertEqual(sum("rehearsal:allow:" in item for item in queries), 4)
            self.assertEqual(sum("rehearsal:deny:" in item for item in queries), 4)
        finally:
            temporary.cleanup()

    def test_lifecycle_rejects_an_unexpected_failure_message(self):
        temporary, _fake, _inputs, _evidence, result = self.run_mode(
            "lifecycle", FAKE_RELEASE_WRONG_ERROR="1"
        )
        try:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected failure class", result.stderr.lower())
        finally:
            temporary.cleanup()

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
