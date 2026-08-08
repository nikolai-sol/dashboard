import importlib.util
import pathlib
import sys
import unittest
from datetime import datetime, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "runtime" / "abbott_health_probe.py"
SPEC = importlib.util.spec_from_file_location("abbott_health_probe", MODULE_PATH)
assert SPEC and SPEC.loader
health_probe = importlib.util.module_from_spec(SPEC)
sys.modules["abbott_health_probe"] = health_probe
SPEC.loader.exec_module(health_probe)


class ReleaseSourceIntegrityHealthTests(unittest.TestCase):
    def test_receipt_and_active_source_id_mismatch_emits_one_sanitized_incident(self):
        integrity = health_probe.build_release_source_integrity(
            active_source_ids=[25, 22],
            receipt_source_ids=[25, 26],
        )
        incidents = health_probe.evaluate_snapshot({
            "release": {"status": "active", "pointer_matches": True},
            "latest_run": {"status": "success", "finished_at": "2026-08-08T04:23:00Z"},
            "generated_at_utc": "2026-08-08T04:30:00Z",
            "release_source_integrity": integrity,
            "skipped_counter": False,
            "session_integrity": {"status": "ok"},
            "scopes": [],
        })
        source_incidents = [
            incident for incident in incidents
            if incident["check_id"] == "release_source_integrity"
        ]
        self.assertEqual(len(source_incidents), 1)
        self.assertEqual(source_incidents[0]["incident_key"], "abbott|90602537|release_sources|mismatch")
        self.assertEqual(source_incidents[0]["observed"], {
            "active_source_count": 2,
            "receipt_source_count": 2,
        })

    def test_aggregate_match_flag_cannot_override_unequal_source_counts(self):
        integrity = health_probe._build_release_source_integrity_from_aggregate({
            "active_source_count": 2,
            "receipt_source_count": 1,
            "source_sets_match": 1,
        })
        self.assertEqual(integrity["status"], "mismatch")

    def test_run_finished_after_0700_moscow_boundary_is_fresh(self):
        incidents = health_probe.evaluate_snapshot({
            "release": {"status": "active", "pointer_matches": True},
            "latest_run": {"status": "success", "finished_at": "2026-08-08T04:23:00Z"},
            "generated_at_utc": "2026-08-08T04:30:00Z",
            "release_source_integrity": {"status": "ok", "active_source_count": 2, "receipt_source_count": 2},
            "skipped_counter": False,
            "session_integrity": {"status": "ok"},
            "scopes": [],
        })
        self.assertFalse(any(
            incident["check_id"] == "latest_release_run_freshness"
            for incident in incidents
        ))
        self.assertEqual(
            health_probe.expected_completion_at(
                datetime(2026, 8, 8, 4, 30, tzinfo=timezone.utc)
            ),
            datetime(2026, 8, 8, 4, 0, tzinfo=timezone.utc),
        )


if __name__ == "__main__":
    unittest.main()
