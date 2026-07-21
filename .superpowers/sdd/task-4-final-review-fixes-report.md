# Task 4: final integrated security and schema fixes report

## Status

Completed all five review fixes on `codex/abbott-metrika-first-rollout` without
any production, API, database, migration, cron, secret, deployment, SSH,
Telegram, or Hermes action.

## RED evidence

- Returning-table/schema tests failed because migration 033, the Abbott atomic
  writer, role grants, and the Abbott reader still used Zaruku's existing
  `canonical_fact_metrika_returning_pages_daily` name. The cross-contract test
  could not find the new release table, and writer SQL targeted the legacy name.
- The release Reports API regression failed with the patched legacy attribution
  values (`cross_device_first`/`first`) instead of `lastsign`; the traffic
  dimensions were still supplied through the environment-rendered placeholder.
- Neutral `users.json`, journey CSV, Bitrix-shaped XLSX, and malformed data
  fixtures all passed the old filename-only release scanner. The release CLI
  returned success for neutral private content.
- Credential tests failed because there was no audience-specific configuration
  selector and `loadActiveAbbottReleaseBundle` always used the one private pool.
  The production-env test observed no rendered `ABBOTT_EMBED_DB_PASSWORD`.
- The returning collector accepted `YANDEX_METRIKA_TOKEN` when
  `METRIKA_TOKEN` was absent.
- The new dashboard preflight boundary test initially reported swapped embed
  and manager database names as ready.
- The first complete root run after the nested commit ran 330 tests and failed
  only the five rehearsal checks that intentionally require root `HEAD` to
  record the nested gitlink. Those checks passed after root implementation
  commit `f669a5d` recorded nested commit `8cb8ea0`.

## Implementation

- Preserved the Zaruku returning collector, reader, and legacy/account-scoped
  table unchanged. Abbott migration 033, writer, active append locks/deletes,
  reader, grants, contracts, bootstrap copies, manifests, runbook, and docs now
  use `canonical_fact_metrika_returning_pages_release_daily`.
- All Abbott release Reports API scopes (`other`, `traffic`, `page`, and
  `returning`) use literal `lastsign`; fingerprints and rendered traffic UTM
  dimensions bind the same value. Generic non-release collection retains its
  configurable attribution behavior.
- The release asset guard retains path/symlink checks and adds an 8 MiB
  fail-closed inspection bound for JSON, JSONL, CSV, TSV, XLSX, and XLS. It
  detects raw User ID, protected visit/journey, and Bitrix export structures;
  malformed/over-limit/unreadable candidates return paths only. Executable
  source and approved migrations are not content-scanned.
- Added `abbott_embed_reader_role` with SELECT grants only in `report_bd` and no
  grants in `report_bd_private`. Embed and manager now use separate cached
  pools and exact credential namespaces (`ABBOTT_EMBED_DB_*=report_bd` versus
  `ABBOTT_PRIVATE_DB_*=report_bd_private`). One audience-selected read-only
  transaction carries release resolution and all Abbott facts; embed performs
  no private-schema query.
- Production env rendering, release validation, read-only rollout preflight,
  role/schema tests, runbook, AGENTS, and dashboard memory now carry the
  credential boundary. Preflight and release validation reject swapped database
  names.
- `fetch_yandex_metrika_returning_canonical.py` now reads only
  `METRIKA_TOKEN`, while retaining the existing local and legacy dotenv file
  locations.
- Root collector/writer authorities are byte-identical to all bootstrap copies.
  Final SHA-256 values are
  `4a311f30f06b320be5851b0df56b7ba7fcb2d8a187732880a203f8657bcacbe1`
  and
  `2c932c4e4dc001288d7252b651062efdc0d6f776efb8bdd952d79baede1703ad`.

## Verification

- Focused root contracts:
  `python3 -m unittest tests.test_abbott_rollout_preflight tests.test_abbott_operations_runbook tests.test_abbott_schema_contract tests.test_abbott_runtime_closure tests.test_yandex_metrika_atomic_writer tests.test_yandex_metrika_day_bundle tests.test_fetch_yandex_metrika_returning_canonical -q`
  — 134/134 passed.
- Complete root suite:
  `PYTHONWARNINGS=ignore python3 -m unittest discover -s tests -p 'test_*.py'`
  — 330/330 passed.
- Focused dashboard loader/credential/scanner contracts — 43/43 passed before
  the final large-safe-JSON regression was added; that regression passed alone
  and is included in the complete suite.
- Complete dashboard suite: `npm test` — 232/232 passed.
- `npm run typecheck` — passed.
- `npm run lint` — exit 0, no errors, three pre-existing warnings.
- `npm run security:public-assets` — passed.
- `npm run build` — passed; 28 static pages generated.
- `npm run security:public-assets -- --release .next/standalone` — passed after
  the deploy workflow's required removal of the two generated Abbott audit
  artifacts. The scanner also admitted Next's 4.3 MB aggregate font-metrics
  JSON under the 8 MiB bound.
- `bash scripts/render-production-env.test.sh` and
  `bash scripts/validate-production-release.test.sh` — passed.
- `bash -n scripts/deploy.sh scripts/render-production-env.sh scripts/validate-production-release.sh scripts/rollback-release.sh`
  — passed.
- `git diff --check` passed in both repositories.

## Commits

- Nested dashboard: `8cb8ea0c6f25d68595efea03d31a35f1223b5948` —
  `fix: isolate Abbott release data and embed access`.
- Root implementation/gitlink: `f669a5d879fde9cd5a2d0446c94935ce840a7d9f` —
  `fix: close Abbott release security contracts`.
- This report is committed as the final root handoff commit.

## Concerns

- ESLint retains three unrelated existing warnings: one unused Abbott summary
  parameter and two missing hook dependencies in the admin UTM matching
  component.
- The environment emits the existing urllib3/LibreSSL compatibility warning
  unless Python warnings are suppressed; it does not fail tests.
- Schema/grant behavior was verified through deterministic contracts and the
  fake-MySQL rehearsal suite. No live database migration was attempted.
