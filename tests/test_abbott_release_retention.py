from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import unittest
from pathlib import Path

import abbott_release_retention as retention


UTC = dt.timezone.utc


class FakeExecutor:
    def __init__(self):
        self.pointer = {"canonical_release_id": 24, "previous_release_id": 14}
        self.releases = [
            {
                "id": 24,
                "release_status": "active",
                "created_at": "2026-08-10 13:09:56",
                "retired_at": None,
            },
            {
                "id": 14,
                "release_status": "retired",
                "created_at": "2026-08-08 19:53:29",
                "retired_at": "2026-08-10 13:22:02",
            },
            {
                "id": 13,
                "release_status": "retired",
                "created_at": "2026-08-08 11:53:18",
                "retired_at": "2026-08-08 19:59:56",
            },
            {
                "id": 9,
                "release_status": "failed",
                "created_at": "2026-07-29 13:03:32",
                "retired_at": None,
            },
            {
                "id": 25,
                "release_status": "staging",
                "created_at": "2026-08-01 00:00:00",
                "retired_at": None,
            },
        ]
        self.rows = {
            ("report_bd", "canonical_fact_metrika_site_analytics_daily"): {
                9: 3033,
                13: 147432,
                14: 147717,
                24: 147717,
            },
            ("report_bd_private", "canonical_fact_metrika_visits"): {
                9: 2178,
                13: 111151,
                14: 111442,
                24: 111442,
            },
        }
        self.table_bytes = {
            ("report_bd", "canonical_fact_metrika_site_analytics_daily"): 1_300_000_000,
            ("report_bd_private", "canonical_fact_metrika_visits"): 800_000_000,
        }
        self.executed = []
        self.pointer_after_execute = None

    def query(self, sql):
        if "FROM report_bd.portal_active_data_releases" in sql:
            return [dict(self.pointer)]
        if "FROM report_bd.portal_data_releases" in sql:
            return [dict(row) for row in self.releases]
        if "FROM information_schema.TABLES" in sql:
            return [
                {
                    "TABLE_SCHEMA": schema,
                    "TABLE_NAME": table,
                    "table_bytes": size,
                }
                for (schema, table), size in self.table_bytes.items()
            ]
        if "GROUP BY canonical_release_id" in sql:
            for schema, table in retention.PURGE_TABLES:
                if f"FROM `{schema}`.`{table}`" in sql:
                    return [
                        {"canonical_release_id": release_id, "row_count": count}
                        for release_id, count in self.rows.get((schema, table), {}).items()
                        if f"{release_id}" in sql
                    ]
        if "AS remaining_rows" in sql:
            return [{"remaining_rows": 0}]
        raise AssertionError(f"unexpected query: {sql}")

    def execute_delete(self, sql):
        self.executed.append(sql)
        if self.pointer_after_execute is not None:
            self.pointer = dict(self.pointer_after_execute)
        return 0


class PlannerTests(unittest.TestCase):
    def test_plan_protects_active_previous_and_in_progress_releases(self):
        plan = retention.build_plan(
            FakeExecutor(),
            grace_days=0,
            now=dt.datetime(2026, 8, 10, 18, 0, tzinfo=UTC),
        )

        self.assertEqual(plan["active_release_id"], 24)
        self.assertEqual(plan["previous_release_id"], 14)
        self.assertEqual(plan["protected_release_ids"], [14, 24, 25])
        self.assertEqual(plan["eligible_release_ids"], [9, 13])

    def test_seven_day_grace_excludes_recent_retired_release(self):
        plan = retention.build_plan(
            FakeExecutor(),
            grace_days=7,
            now=dt.datetime(2026, 8, 10, 18, 0, tzinfo=UTC),
        )

        self.assertEqual(plan["eligible_release_ids"], [9])

    def test_plan_uses_only_allowlisted_tables_and_estimates_bytes(self):
        plan = retention.build_plan(
            FakeExecutor(),
            grace_days=0,
            now=dt.datetime(2026, 8, 10, 18, 0, tzinfo=UTC),
        )

        self.assertEqual(
            {(table["schema"], table["table"]) for table in plan["tables"]},
            set(retention.PURGE_TABLES),
        )
        site = next(table for table in plan["tables"] if table["table"].startswith("canonical_fact_metrika_site"))
        self.assertEqual(site["rows_by_release"], {"9": 3033, "13": 147432})
        self.assertGreater(site["estimated_purge_bytes"], 0)

    def test_manifest_digest_is_deterministic_and_excludes_digest_field(self):
        manifest = {"dataset_key": "abbott", "eligible_release_ids": [9, 13]}
        digest = retention.manifest_digest(manifest)
        with_digest = dict(manifest, manifest_sha256=digest)

        self.assertEqual(retention.manifest_digest(with_digest), digest)
        self.assertEqual(len(digest), 64)

    def test_negative_grace_is_rejected(self):
        with self.assertRaisesRegex(retention.RetentionError, "grace"):
            retention.build_plan(
                FakeExecutor(),
                grace_days=-1,
                now=dt.datetime(2026, 8, 10, 18, 0, tzinfo=UTC),
            )


class ApplyTests(unittest.TestCase):
    def _manifest(self):
        return retention.build_plan(
            FakeExecutor(),
            grace_days=0,
            now=dt.datetime(2026, 8, 10, 18, 0, tzinfo=UTC),
        )

    def test_apply_rejects_digest_mismatch_before_delete(self):
        executor = FakeExecutor()
        with self.assertRaisesRegex(retention.RetentionError, "digest"):
            retention.apply_plan(executor, self._manifest(), "0" * 64, batch_size=1000)
        self.assertEqual(executor.executed, [])

    def test_apply_rejects_pointer_drift_before_delete(self):
        executor = FakeExecutor()
        executor.pointer = {"canonical_release_id": 26, "previous_release_id": 24}
        manifest = self._manifest()

        with self.assertRaisesRegex(retention.RetentionError, "pointer"):
            retention.apply_plan(
                executor,
                manifest,
                retention.manifest_digest(manifest),
                batch_size=1000,
            )
        self.assertEqual(executor.executed, [])

    def test_apply_rejects_unknown_table_in_manifest(self):
        executor = FakeExecutor()
        manifest = self._manifest()
        manifest["tables"].append(
            {"schema": "report_bd", "table": "portal_data_releases", "rows_by_release": {"9": 1}}
        )

        with self.assertRaisesRegex(retention.RetentionError, "allowlist"):
            retention.apply_plan(
                executor,
                manifest,
                retention.manifest_digest(manifest),
                batch_size=1000,
            )

    def test_apply_rejects_release_row_count_drift(self):
        executor = FakeExecutor()
        manifest = self._manifest()
        executor.rows[("report_bd", "canonical_fact_metrika_site_analytics_daily")][9] += 1

        with self.assertRaisesRegex(retention.RetentionError, "row counts changed"):
            retention.apply_plan(
                executor,
                manifest,
                retention.manifest_digest(manifest),
                batch_size=1000,
            )
        self.assertEqual(executor.executed, [])

    def test_apply_stops_if_pointer_changes_during_delete(self):
        executor = FakeExecutor()
        executor.pointer_after_execute = {"canonical_release_id": 26, "previous_release_id": 24}
        manifest = self._manifest()

        with self.assertRaisesRegex(retention.RetentionError, "pointer"):
            retention.apply_plan(
                executor,
                manifest,
                retention.manifest_digest(manifest),
                batch_size=1000,
            )

    def test_manifest_file_is_written_mode_0600(self):
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "manifest.json")
            retention.write_manifest(target, {"dataset_key": "abbott"})
            mode = os.stat(target).st_mode & 0o777

            self.assertEqual(mode, 0o600)
            self.assertEqual(json.loads(Path(target).read_text(encoding="utf-8"))["dataset_key"], "abbott")


if __name__ == "__main__":
    unittest.main()
