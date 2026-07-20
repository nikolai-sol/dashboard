import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

from ops.hermes import abbott_health_prompt_input as adapter


VALID = {
    "generated_at_utc": "2026-07-16T08:00:00Z",
    "dashboard": "abbott",
    "counter_id": "90602537",
    "overall": "OK",
    "release": {"id": 41, "status": "active", "pointer_matches": True},
    "latest_run": {"id": 77, "status": "success", "run_type": "backfill",
                   "date_from": "2026-07-06", "date_to": "2026-07-15",
                   "finished_at": "2026-07-16T06:30:00Z", "counter_id": "90602537"},
    "scopes": [{"scope": scope, "max_date": "2026-07-15", "rows": 3,
                "missing_dates": [], "status_counts": {"success": 10},
                "unexpected_empty": False}
               for scope in ("other", "traffic", "page", "user_behavior", "returning")],
    "backfill": {"lookback_days": 10, "complete_days": 10, "missing_days": []},
    "session_integrity": {
        "days_checked": 10,
        "all_sessions": 100,
        "with_user_id_sessions": 40,
        "without_user_id_sessions": 60,
        "mismatched_days": 0,
        "mismatched_sources": 0,
        "status": "ok",
    },
    "skipped_counter": False,
    "incidents": [],
}

REMOTE_COMMAND = (
    "/root/reportingdash-canonical/venv/bin/python "
    "/root/reportingdash-canonical/abbott_health_probe.py --json"
)


class HermesAdapterTests(unittest.TestCase):
    def test_valid_payload_round_trips_as_stable_json(self):
        first = adapter.build_prompt_input(VALID)
        second = adapter.build_prompt_input(json.loads(first))
        self.assertEqual(first, second)
        self.assertEqual(json.loads(first), VALID)

    def test_unknown_keys_are_rejected_recursively(self):
        payload = json.loads(json.dumps(VALID))
        payload["scopes"][0]["nested"] = {"user_id": "123"}
        with self.assertRaises(ValueError):
            adapter.validate_payload(payload)

    def test_requires_exactly_all_five_scopes_once(self):
        missing = json.loads(json.dumps(VALID))
        missing["scopes"].pop()
        with self.assertRaises(ValueError):
            adapter.validate_payload(missing)

        duplicate = json.loads(json.dumps(VALID))
        duplicate["scopes"][-1]["scope"] = "traffic"
        with self.assertRaises(ValueError):
            adapter.validate_payload(duplicate)

        payload = json.loads(json.dumps(VALID))
        payload["backfill"]["missing_days"] = [{"extra": "2026-07-15"}]
        with self.assertRaises(ValueError):
            adapter.validate_payload(payload)

    @mock.patch("ops.hermes.abbott_health_prompt_input.subprocess.run")
    def test_ssh_uses_argument_list_without_shell(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps(VALID), stderr=""
        )
        payload = adapter.read_remote_payload("beget", REMOTE_COMMAND)
        self.assertEqual(payload["counter_id"], "90602537")
        args, kwargs = run.call_args
        self.assertEqual(args[0], ["ssh", "beget", REMOTE_COMMAND])
        self.assertNotIn("shell", kwargs)

    @mock.patch("ops.hermes.abbott_health_prompt_input.subprocess.run")
    def test_ssh_failure_is_sanitized(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=[], returncode=255, stdout="token=secret", stderr="password=secret"
        )
        with self.assertRaisesRegex(RuntimeError, r"host=beget check_id=abbott_health_probe returncode=255") as caught:
            adapter.read_remote_payload("beget", REMOTE_COMMAND)
        self.assertNotIn("secret", str(caught.exception))

    @mock.patch("ops.hermes.abbott_health_prompt_input.subprocess.run")
    def test_ssh_rejects_option_hosts_and_non_probe_commands(self, run):
        for host, command in (("-oProxyCommand=bad", REMOTE_COMMAND), ("beget", "probe; env")):
            with self.subTest(host=host, command=command):
                with self.assertRaises(ValueError):
                    adapter.read_remote_payload(host, command)
        run.assert_not_called()

    def test_adapter_runs_directly_without_importing_remote_state(self):
        script = Path(adapter.__file__).resolve()
        proc = subprocess.run(
            [sys.executable, str(script)],
            input=json.dumps(VALID),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), VALID)


if __name__ == "__main__":
    unittest.main()
