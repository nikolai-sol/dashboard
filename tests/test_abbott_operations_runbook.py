from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AbbottOperationsRunbookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md").read_text()

    def test_cron_uses_attested_active_release_launcher(self):
        cron = self.text.split("## Checkpoint 9", 1)[1].split("## Checkpoint 10", 1)[0]
        self.assertIn("run_abbott_metrika_active_release.py", cron)
        for flag in (
            "--manifest",
            "--collector",
            "--runtime-revision",
            "--code-revision",
            "--parser-version",
        ):
            self.assertIn(flag, cron)
        self.assertIn("--days-back 1", cron)
        launcher_line = next(
            line for line in cron.splitlines()
            if "run_abbott_metrika_active_release.py --canonical-root" in line
        )
        self.assertNotIn("--days-back 2", launcher_line)

    def test_cron_is_metrika_first_and_serializes_all_collectors(self):
        cron = self.text.split("## Checkpoint 9", 1)[1].split("## Checkpoint 10", 1)[0]
        lock = "/usr/bin/flock -w 7200 /run/lock/reportingdash-metrika.lock"
        self.assertIn(f'lock = "{lock}"', cron)
        self.assertGreaterEqual(cron.count("{lock} /bin/bash"), 3)
        self.assertIn("--exclude-counter-id 90602537", cron)
        self.assertIn("fetch_yandex_metrika_returning_canonical.py", cron)
        self.assertIn("zero or one", cron)
        self.assertIn("/root/reportingdash-abbott-canonical", cron)
        self.assertIn("/var/www/dashboard/.env", cron)
        self.assertIn("existing shadow monitor", cron)
        self.assertNotIn("expected exactly one 06:10 legacy /metrika cron", cron)

    def test_runtime_revision_is_distinct_from_release_data_revision(self):
        self.assertIn("export RUNTIME_REVISION=<reviewed-runtime-git-revision>", self.text)
        self.assertIn(
            'test "$(git -C "$CANONICAL_ROOT" rev-parse HEAD)" = "$RUNTIME_REVISION"',
            self.text,
        )
        self.assertNotIn(
            'test "$(git -C "$CANONICAL_ROOT" rev-parse HEAD)" = "$CODE_REVISION"',
            self.text,
        )

    def test_schema_and_baseline_gates_are_exact(self):
        self.assertIn('test "$ACTUAL_SCHEMA_TABLE_COUNT" = 13', self.text)
        schema_gate = self.text.split("Verify table and role names only", 1)[1].split("## Checkpoint 2", 1)[0]
        self.assertNotIn("table_schema IN", schema_gate)
        self.assertIn("table_schema='report_bd' AND table_name='portal_data_releases'", schema_gate)
        self.assertIn("table_schema='report_bd' AND table_name='portal_release_source_imports'", schema_gate)
        self.assertIn("table_schema='report_bd_private' AND table_name='portal_bitrix_page_facts'", schema_gate)
        self.assertIn("table_schema='report_bd_private' AND table_name='canonical_fact_metrika_visits'", schema_gate)
        self.assertNotIn("canonical_fact_metrika_user_behavior_daily", schema_gate)
        self.assertIn("abbott_prebackfill_snapshot.sql\"; } |", self.text)

    def test_production_baseline_and_import_use_only_workbook_sources(self):
        baseline = self.text.split("## Checkpoint 3", 1)[1].split(
            "## Checkpoint 4", 1
        )[0]
        importer = self.text.split("## Checkpoint 5", 1)[1].split(
            "## Checkpoint 6", 1
        )[0]
        for source_kind in ("abbott_workbook_json", "abbott_workbook_catalog"):
            self.assertIn(source_kind, baseline)
        for flag in ("--workbook-json", "--workbook-xlsx"):
            self.assertIn(flag, importer)
        for forbidden in (
            "abbott_bitrix_pages",
            "abbott_bitrix_journeys",
            "--bitrix-pages",
            "--bitrix-journeys",
        ):
            self.assertNotIn(forbidden, baseline)
            self.assertNotIn(forbidden, importer)

    def test_local_bitrix_rehearsal_is_clearly_test_only_and_not_a_readiness_blocker(self):
        local = self.text.split("## Local MySQL rehearsal checkpoint", 1)[1].split(
            "## Database accounts", 1
        )[0]
        normalized = " ".join(local.split())
        self.assertIn("test-only", normalized)
        self.assertIn("local_rehearsal=ready", normalized)
        self.assertNotIn("local_rehearsal=partial", normalized)

    def test_validation_and_runtime_attestation_are_executable(self):
        self.assertIn("abbott_release_operator.py validate", self.text)
        self.assertIn("sha256sum -c \"$CANONICAL_RUNTIME_MANIFEST\"", self.text)
        self.assertIn("recursive calendar CTE", self.text)
        gap_gate = self.text.split("## Checkpoint 6", 1)[1].split("## Checkpoint 7", 1)[0]
        self.assertIn("WITH RECURSIVE calendar", gap_gate)
        self.assertIn("2026-03-29", gap_gate)
        self.assertIn("2026-04-07", gap_gate)
        validation_gate = self.text.split("Only after every gate", 1)[1].split(
            "## Checkpoint 8", 1
        )[0]
        self.assertIn("portal_release_source_imports", validation_gate)
        self.assertIn(
            "latest completed `validation_run_id`", " ".join(validation_gate.split())
        )

    def test_reused_snapshot_materializes_candidate_rows_before_evidence(self):
        import_gate = self.text.split("## Checkpoint 5", 1)[1].split(
            "## Checkpoint 6", 1
        )[0]
        normalized = " ".join(import_gate.split())
        self.assertIn("materializes the freshly parsed source-specific batches", normalized)
        self.assertIn("same immutable snapshot ID", normalized)
        self.assertIn("never copies rows from a predecessor release or another tenant", normalized)
        self.assertIn("partial candidate batch", normalized)
        self.assertIn("per-release import execution evidence", normalized)

    def test_dashboard_deploy_installs_and_scans_a_full_atomic_release_tree(self):
        deploy_gate = self.text.split("Before validation", 1)[1].split("Only after every gate", 1)[0]
        self.assertIn("scripts/install-reviewed-release.sh", deploy_gate)
        self.assertIn(".next/standalone/.next/static", deploy_gate)
        self.assertIn(".next/standalone/public", deploy_gate)
        self.assertIn("security:public-assets -- --release", deploy_gate)
        self.assertIn("validate-production-release.sh", deploy_gate)
        self.assertIn('install -m 600 "$DASHBOARD_OWNER_ENV_FILE"', deploy_gate)
        self.assertIn("sha256sum -c", deploy_gate)
        self.assertNotIn("Run the owner-approved deployment procedure", deploy_gate)

    def test_dashboard_build_rejects_every_tracked_or_untracked_source_change(self):
        deploy_gate = self.text.split("Before validation", 1)[1].split("Only after every gate", 1)[0]
        self.assertIn(
            'test -z "$(git -C "$DASHBOARD_SOURCE_ROOT" status --porcelain=v1 --untracked-files=all)"',
            deploy_gate,
        )

    def test_first_dashboard_cutover_checkpoints_and_verifies_directory_predecessor(self):
        deploy_gate = self.text.split("Before validation", 1)[1].split("Only after every gate", 1)[0]
        checkpoint = deploy_gate.index("--checkpoint-current")
        install = deploy_gate.index(
            "bash scripts/install-reviewed-release.sh \\", checkpoint + 1
        )
        self.assertLess(checkpoint, install)
        self.assertIn("DASHBOARD_PREDECESSOR_REVISION", deploy_gate)
        predecessor_verify = (
            'sha256sum -c "$DASHBOARD_RELEASES_DIR/'
            '$DASHBOARD_PREDECESSOR_REVISION.sha256"'
        )
        self.assertIn(predecessor_verify, deploy_gate)

    def test_secret_installation_and_counter_probe_are_operational(self):
        self.assertIn("probe_yandex_metrika_access.py", self.text)
        self.assertIn('systemctl restart "$LEGACY_SERVICE_NAME"', self.text)
        self.assertIn("legacy-auth-missing.curl", self.text)
        self.assertIn("legacy-auth-valid.curl", self.text)
        self.assertNotIn("?secret=", self.text)

    def test_visit_level_operational_truth_is_exact_across_operator_memories(self):
        paths = (
            ROOT / "AGENTS.md",
            ROOT / "docs/ABBOTT-OPERATIONS-RUNBOOK.md",
            ROOT / "dashboard-next/DASHBOARDS-MEMORY.md",
            ROOT / "dashboard-next/CANONICAL-ENTITIES-MEMORY.md",
        )
        documents = [path.read_text(encoding="utf-8") for path in paths]
        for path, document in zip(paths, documents):
            with self.subTest(path=str(path.relative_to(ROOT))):
                self.assertIn("## Abbott visit-level operational truth", document)

        combined = "\n".join(documents)
        required_contracts = (
            "Reports API attribution `lastsign`",
            "`all`, `with_user_id`, and `without_user_id`",
            "`all.sessions = with_user_id.sessions + without_user_id.sessions` is a hard publication gate",
            "Logs API `source=visits`",
            "One private database row is one Metrica visit.",
            "`report_bd_private.canonical_fact_metrika_visits`",
            "Raw User ID, visit ID, start URL, and end URL are manager-only.",
            "Raw client ID is never stored; only its hash is persisted.",
            "evaluate → create → poll → download all parts → clean in finally",
            "Prepared files count against the 10 GB quota until cleaned.",
            "`METRIKA_TOKEN` remains the only OAuth environment key.",
            "Never print it.",
            "The owner installs or revokes it; this change does not issue or rotate a token.",
            "collection `06:12`, health `07:05`, and one summary `07:10`",
            "The summary includes session integrity; a mismatch is `CRITICAL`.",
            "Logs cannot return the current day.",
            "Active releases remain append-only",
            "reviewed successor release/backfill",
            "Bitrix dump remains test-only; the live connector is deferred.",
            "No deployment, secret installation, API call, database migration, cron edit, Telegram send, or Hermes schedule occurred.",
        )
        for contract in required_contracts:
            with self.subTest(contract=contract):
                self.assertIn(contract, combined)

    def test_current_tree_contains_no_retired_legacy_launch_literal(self):
        retired_literals = ("nikolay" + "-save-us-pls", "Terasic" + "1!")
        matches = []
        for path in ROOT.rglob("*"):
            relative = path.relative_to(ROOT)
            if (
                not path.is_file()
                or any(part in {".git", "node_modules", ".next"} for part in path.parts)
                or relative.parts[:2] == ("docs", "superpowers")
            ):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if any(literal in content for literal in retired_literals):
                matches.append(str(path.relative_to(ROOT)))
        self.assertEqual(matches, [])


if __name__ == "__main__":
    unittest.main()
