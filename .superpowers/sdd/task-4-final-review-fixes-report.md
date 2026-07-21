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
- Initial complete dashboard suite: `npm test` — 232/232 passed.
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

## Reviewer P1 scanner follow-up

- RED: a real importer-valid neutral `users.json` with top-level
  `id: [{ id, direction }]` was accepted by the release scanner, and the CLI
  exited 0. The paired ordinary-JSON regression remained green, proving that a
  global ban on unrelated `id` fields was neither necessary nor acceptable.
- The initial JSON scanner fix recognized only a non-empty root `id` collection whose
  rows consist exactly of `id` and `direction`, matching the Abbott importer
  contract without adding either generic key to the private-key denylist.
- The CLI regression uses the same importer-shaped payload and verifies that
  only `users.json` is emitted, never the raw User ID value.
- Focused scanner/importer contracts: 34/34 passed.
- Complete dashboard suite after the regression: 234/234 passed. Typecheck,
  public-asset security scan, production build (28 static pages), built-release
  scan, and `git diff --check` all passed.
- After root commit `3c249fc690774790651eebe27869cf0303df1536`
  recorded the corrected nested gitlink, the focused runtime closure/MySQL
  rehearsal passed 29/29 and the complete root suite passed 330/330.

## Reviewer P1 scanner mixed-row follow-up

- RED: importer-valid mappings were still accepted when the consumed row had
  an ignored extra key or shared its top-level `id` array with invalid rows.
  Both new regressions returned no violating path. The ordinary control, now a
  top-level `id` array with `id` and `direction` split across different rows,
  remained allowed.
- The final predicate checks whether any object row in the root `id` array has
  the same nonblank `id` and `direction` values consumed by the importer. Extra
  keys and invalid sibling rows do not suppress detection; unrelated rows that
  do not contain both values remain allowed. Generic `id` and `direction` keys
  are still not denylisted.
- Focused scanner/importer contracts: 36/36 passed.
- Complete dashboard suite: 236/236 passed. Typecheck, public-asset scan,
  built-release scan, and `git diff --check` passed.
- After root commit `af363f9478335b2d98c9fb9de4def371874c1efb`
  recorded nested commit `3328c1dcea990cd54f6ee909dbc1648348abdfe6`,
  the focused runtime closure/MySQL rehearsal passed 29/29 and the complete
  root suite passed 330/330.

## Whole-review P1 native Logs follow-up

- RED: neutral CSV and TSV fixtures using the exact native Yandex Logs
  `VISIT_FIELDS` names (`ym:s:visitID`, `ym:s:clientID`, `ym:s:startURL`, and
  `ym:s:endURL`) were accepted. The CSV also included optional `ym:s:params`.
  Ordinary Yandex-like aggregate metrics CSV/TSV controls remained allowed.
- The scanner now strips the `ym:s:` namespace and converts native camel-case
  field names to canonical snake case. A visit export is private when the
  canonical header set contains `visit_id`, `client_id`, `start_url`, and
  `end_url`; extra fields do not affect detection.
- The CLI regression verifies that rejected native Logs exports emit only the
  two relative paths and none of the visit, client, User ID, or URL content.
- Focused scanner contracts: 16/16 passed.
- Complete dashboard suite: 237/237 passed. Typecheck, public-asset scan,
  built-release scan, and `git diff --check` passed.
- After root commit `4c67d47e1f84a9dfd4245d3fd51ad588cd046f61`
  recorded nested commit `9a9511f4099931b460dd31ff24644836f83dc69b`,
  the focused runtime closure/MySQL rehearsal passed 29/29 and the complete
  root suite passed 330/330.

## Commits

- Nested dashboard: `8cb8ea0c6f25d68595efea03d31a35f1223b5948` —
  `fix: isolate Abbott release data and embed access`.
- Nested dashboard P1 follow-up:
  `2f4fcb58a49e9caf2550f624464c792ed99931e5` —
  `fix: detect Abbott user mapping release assets`.
- Nested dashboard mixed-row follow-up:
  `3328c1dcea990cd54f6ee909dbc1648348abdfe6` —
  `fix: detect mixed Abbott user mappings`.
- Nested dashboard native Logs follow-up:
  `9a9511f4099931b460dd31ff24644836f83dc69b` —
  `fix: detect native Metrika Logs exports`.
- Root implementation/gitlink: `f669a5d879fde9cd5a2d0446c94935ce840a7d9f` —
  `fix: close Abbott release security contracts`.
- Root P1 follow-up/gitlink: `3c249fc690774790651eebe27869cf0303df1536` —
  `fix: close Abbott scanner mapping bypass`.
- Root mixed-row follow-up/gitlink:
  `af363f9478335b2d98c9fb9de4def371874c1efb` —
  `fix: close mixed Abbott mapping bypass`.
- Root native Logs follow-up/gitlink:
  `4c67d47e1f84a9dfd4245d3fd51ad588cd046f61` —
  `fix: close native Metrika Logs scanner bypass`.
- This updated report is committed as the final root handoff commit.

## Concerns

- ESLint retains three unrelated existing warnings: one unused Abbott summary
  parameter and two missing hook dependencies in the admin UTM matching
  component.
- The environment emits the existing urllib3/LibreSSL compatibility warning
  unless Python warnings are suppressed; it does not fail tests.
- Schema/grant behavior was verified through deterministic contracts and the
  fake-MySQL rehearsal suite. No live database migration was attempted.
