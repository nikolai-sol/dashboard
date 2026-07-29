# AGENTS

Authoritative shared memory for agents working in `/Users/nafanya/ReportingDash`.

Update this file whenever any of the following changes:
- production runtime
- deploy path
- database names / access pattern
- cron schedule
- auth / access model
- canonical collector behavior

If another doc conflicts with this file, treat this file as the current source of truth and then fix the stale doc.

## Workspace layout

- Root repository: `/Users/nafanya/ReportingDash`
  - operational docs
  - Python collectors
  - canonical monitoring scripts
- Next.js app repository: `/Users/nafanya/ReportingDash/dashboard-next`
  - dashboard application code
  - application migrations and deploy scripts
- App worktrees: `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/*`
- Legacy Nest code copy: `/Users/nafanya/ReportingDash/nest-second`

Important:
- the root and `dashboard-next/` are separate Git repositories
- the root repository owns collectors and operational documentation and tracks `dashboard-next/` as a Git link
- feature branches and worktrees belong to the `dashboard-next/` repository; commit app changes in the relevant app worktree
- run the production deploy from the primary `/Users/nafanya/ReportingDash/dashboard-next` checkout, where `scripts/deploy.sh` can package sibling collectors from the root repository

## Dashboard-specific memory

For dashboard work, use this file first:
- `DASHBOARDS-MEMORY.md`

It contains the current dashboard runtime rules, auth model, export rules, comparison behavior, and latest completed dashboard changes.

Current auth note:
- Abbott and Zaruku always use mandatory `password_only` viewer access, regardless of rows in
  `dashboard_access_users`; neither dashboard may resolve to public or `email_password` mode.
- `dashboard_shared_access_settings` is authoritative once a dashboard has a row. It stores only a
  salted `scrypt` hash and monotonically increasing `credential_version`; admin rotations write this
  table transactionally and never return password or hash material.
- Abbott alone may use `ABBOTT_DASHBOARD_PASSWORD` as credential version `0`, and only while its DB
  row is absent. Production env validation still requires this transitional fallback. The first DB
  seed/admin rotation makes the row authoritative, and later rotations never update the env value.
- Zaruku has no plaintext environment fallback. Until its DB row is seeded, authentication fails closed.
- Password-authenticated manager viewer and export sessions carry `credential_version`. Every
  protected request compares it with current authority, so any rotation revokes older manager sessions
  and derived export tokens, including a rotation to the same password.
- Abbott's `ABBOTT_DASHBOARD_EMBED_KEY` is separate, remains environment-managed, and is not rotated or
  revoked by a shared-password change. Embed sessions remain audience-scoped and unversioned.
- Signed dashboard viewer and export sessions require an explicit `manager` or `embed` audience;
  legacy dashboard tokens without an audience are rejected. Viewer portal sessions remain audience-free.
- Production migration, stdin seed, deploy, and application-only rollback are documented in
  `docs/SHARED-DASHBOARD-PASSWORD-ROLLOUT.md`. Never put a literal password in a command, Git, logs,
  checkpoints, deployment artifacts, or documentation.
- A rollback target is eligible only if it has been verified to keep Abbott and Zaruku mandatory
  `password_only` and to validate manager sessions/exports against the retained DB credential versions.
  Compatible bundles carry `.shared-password-db-auth-v1`; manual rollback rejects an unmarked target
  before moving the current app. Base `0c9e046` is not compatible. If automatic activation has no marked
  predecessor, it stops PM2 and leaves the app fail-closed until a corrected compatible release is
  deployed. Zaruku must never become public during rollback.

### Zaruku source matrix (branch target)

| Source | Collection | Branch-target dashboard role |
| --- | --- | --- |
| Yandex Metrika | Automated canonical collection at `06:12`; traffic/page facts plus Russia-filtered breakdown facts in `canonical_fact_metrika_breakdowns_daily`, with successful/empty coverage in `canonical_metrika_breakdown_coverage_daily` | Canonical MySQL-only traffic/page, search-engine, phrase, organic-landing, device, Geography, browser/OS, demographic, and interest reads |
| Yandex Webmaster | Automated daily canonical collection at `06:50` | Yandex query and host-summary facts, aggregated to reporting weeks by the dashboard |
| SEO OS | External weekly SQL load | Tracked Yandex positions, section and cluster coverage, opportunities, tasks, and pipeline telemetry |
| AI/GEO visibility | Manual | Manually supplied AI visibility snapshots; automation is not connected |
| Google Search Console | Automated daily canonical collection at `06:55` with `--data-delay-days 3`; backfilled for `2026-07-01 .. 2026-07-14` | Canonical GSC query/page/summary/country facts for Google impressions, clicks, CTR, position, and pre-click country/device split |

This MySQL-only Metrika breakdown path is a branch target. It is not production
state until the migration, deploy, and backfill are accepted.

`Geography` means visitor countries/cities from Metrika. It is not `GEO`: in `AI/GEO visibility`, GEO means Generative Engine Optimization.

## Platform access / cron memory

For collector, cron, and ad-platform API access work, use this file first:
- `PLATFORMS-ACCESS-MEMORY.md`

It contains the current cron model, collector runtime behavior, platform API access rules, auth caveats, and latest completed operational changes.


## Canonical entities memory

For canonical DB entities, schema, fact grain, and lineage work, use this file first:
- `CANONICAL-ENTITIES-MEMORY.md`

It contains the current production truth for canonical tables, entity relationships, source grain, and debugging order.

## Onboarding reading order

For new agents or when switching segments, use:
- `ONBOARDING-READING-ORDER.md`

## Memory maintenance rule

Memory files are mandatory working context, not passive notes.

Every time important information changes or is discovered:
1. update the relevant memory file in the same turn
2. remove or rewrite stale information immediately
3. do not leave contradictory old and new operational rules in memory unless the distinction is explicitly necessary

If the information is no longer valid because:
- the runtime changed
- the cron logic changed
- auth changed
- dashboard behavior changed
- platform access changed

then memory must be cleaned, not only appended to.

## Production access

- VPS SSH alias: `ssh beget`
- Public dashboard domain: `https://dashboards.adreports.ru`
- Bayesly embed uses the same public dashboard domain in iframe mode

## Current production runtime

### Dashboard app

- app: `dashboard-next`
- deployed path on VPS: `/var/www/dashboard`
- process manager: `PM2`
- PM2 app name: `dashboard-next`
- local bind: `127.0.0.1:3001`
- public reverse proxy: `nginx`

Files on VPS:
- app dir: `/var/www/dashboard`
- staged releases: `/var/www/dashboard-releases`
- rollback backups: `/var/www/dashboard-backups`
- PM2 config: `/var/www/dashboard/ecosystem.config.js`
- app logs:
  - `/var/log/dashboard-next-out.log`
  - `/var/log/dashboard-next-error.log`

Health checks:
- local VPS: `curl -s http://127.0.0.1:3001/api/health`
- public: `curl -s https://dashboards.adreports.ru/api/health`
- listener isolation: `PUBLIC_APP_HOST=5.35.85.218 APP_PORT=3001 bash scripts/verify-loopback-listener.sh`

Dashboard AI summary (`/api/dashboard/[id]/ai-summary/generate`):
- Uses `AI_SUMMARY_*` env from `/var/www/dashboard/.env` (rendered from `.production.env` on deploy).
- Gemini via `generativelanguage.googleapis.com` OpenAI-compat: API rejects `temperature` other than `1` for some models; output JSON needs enough `max_tokens` (large Russian bullets truncate easily). Parser must balance `{` `}` outside strings (headlines/bullets may contain `}`).

Do not assume `systemd` or port `3002` for `dashboard-next`.
Current truth is `PM2 + 3001`.

### Agent model guidance

- Agent model versions are selected in Codex configuration.
- Do not pin a Codex model version in `AGENTS.md`; update the Codex configuration instead.

### Canonical collectors runtime

- runtime path: `/root/reportingdash-canonical`
- scheduler: root `crontab`
- python env: `/root/reportingdash-canonical/venv`
- collector logs: `/root/reportingdash-canonical/logs`

### Abbott canonical/private rollout package

- Operator authority: `docs/ABBOTT-OPERATIONS-RUNBOOK.md` in the root repository.
- Abbott Yandex Metrika authority is counter `90602537`; it must be filtered in collection,
  coverage, comparison, health, and summaries.
- The closed release scope set is `other`, `traffic`, `page`, `user_behavior`, and `returning`.
- Canonical release activation and rollback use the single `portal_active_data_releases` pointer;
  they do not copy facts or restore a silent legacy fallback.
- Private runtime data lives in `report_bd_private`. Collector, importer, and server-side manager
  runtime use separate least-privilege roles and environment files; embed uses its own
  `abbott_embed_reader_role`/`ABBOTT_EMBED_DB_*` credential with zero private-schema grants.
- Abbott release returning facts use `canonical_fact_metrika_returning_pages_release_daily`;
  Zaruku retains the separate `canonical_fact_metrika_returning_pages_daily` writer/read model.
- `METRIKA_TOKEN` is the only Metrika OAuth env key. The owner must issue/revoke tokens; token
  values are installed from mode-`0600` files and never printed.
- Legacy Nest launch routes use `x-internal-token` against `LEGACY_LAUNCH_SECRET`; query-string
  launch secrets are forbidden.
- The rollout is not active merely because this package is present. Until the candidate gate and
  smoke checks pass, the current production cron table remains authoritative.
- After approved cutover only: remove the duplicate `06:10` legacy `/metrika`, use Abbott canonical
  collection at `06:12`, deterministic health at `07:05`, and one summary at `07:10`.
- Hermes creation is a separate deferred task; no Hermes automation is part of this rollout package.
- Abbott UTM application release `20260729130916-d86cf45` was deployed on 2026-07-29 after migration `044`; local/public health, loopback isolation, manager June read, embed isolation, and public-asset 404 checks passed. Canonical release `8` remains active while successor release `10` backfills `2026-01-01..2026-07-28`; do not call the data cutover complete until `210` dates / `1050` coverage rows / `0` bad rows, comparison, validation, activation, and post-cutover smoke all pass.
- The attested Abbott canonical runtime is server commit `b2f172190e22aaa0454a858e10689d146607df44`. Three unsafe external health-script symlinks were replaced by their byte-identical tracked regular files before the UTM runtime was committed; the runtime worktree and manifest then verified clean.

### Zaruku canonical source truth

Current Zaruku source truth:
- Yandex Metrika: collect only counter `66624469`; counters `29137835`, `105559308`, and `99078698` are on hold/inactive in `canonical_source_account_collection_settings`. The generic collector's `COLLECTION_FLOOR_DAYS=1` / `RECOLLECT_SPAN_DAYS=2` change is committed but not deployed: its active file is shared with the attested Abbott runtime and must move only through a committed private-runtime revision and matching manifest.
- Yandex Webmaster: Zaruku host `https:zaruku.ru:443` is connected for canonical daily summary, query, and URL/page facts. URL/page rows live in `canonical_fact_webmaster_pages_daily`; the dashboard read model should expose `zaruku_seo.webmaster.data_availability.pages = true`. The restored page writer and `COLLECTION_FLOOR_DAYS=2` / `RECOLLECT_SPAN_DAYS=3` were deployed atomically on 2026-07-28 under tag `20260728T171112Z`; do not call RD-10 operationally complete until the scheduled 2026-07-29 run advances query and page maxima together.
- Zaruku source freshness uses one product rule for Metrika, returning content, Webmaster, and GSC: compare the latest fact date with the UTC calendar date at the start of the current day; age `0..3` days is current and age `>3` days is delayed. The threshold is based on RD-09: normal Webmaster lag was 2 days in eight of nine clean observations, plus one day of slack. Do not change it without a new measurement. A newer failed cron/API run remains `failed` even when fact age is within the three-day boundary.
- `expected_frequency_hours = 24` for all four Zaruku collectors and is heartbeat schedule metadata only. It must never be substituted for acceptable fact age; GSC's publication lag does not turn its daily cron into a 72-hour schedule.
- Root module `zaruku_collector_health.py` is the source-neutral RD-11/RD-12 completeness model. Python intentionally duplicates `ZARUKU_DATA_LAG_DAYS = 3`, guarded by a cross-language parity test against `src/lib/zaruku-seo.ts`. Partial dates are defined only through fact `ingestion_run_id -> canonical_collector_runs.status = 'failed'`; non-castable GSC IDs and orphaned references are separate lineage defects.
- The 2026-07-28 SELECT-only RD-12 snapshot found four failed-lineage Webmaster dates (`2026-07-14..17`): queries 755 rows/4 dates, pages 942/2, summary 1/1; failed cron runs `1453` and `1471`; lineage defects 0. No backfill, collector run, cron edit, schema change, or Telegram send followed. A later code-only deployment did not alter these facts.
- A second SELECT-only gap audit for `2026-07-01..21` confirmed no whole-day gaps for Zaruku Metrika and no GSC core gaps. Webmaster is absent in all three canonical layers for `2026-07-01..09`; query/summary exist but page facts are absent for `2026-07-10..12`. The failed-lineage repair scope remains `2026-07-14..17` with 1,698 rows. Treat these as three separate reviewed scopes: full missing days `01..09`, page-only `10..12`, and failed-lineage `14..17`; do not silently include healthy `2026-07-13` or `2026-07-18..21`.
- No Webmaster backfill is allowed before the deployed active cron completes successfully on 2026-07-29 at 06:50, both query/page maxima advance, and the SELECT-only gap/lineage snapshot is refreshed. GSC `--layers optional` remains separately blocked until the scheduled 06:55 cron has `status=success` and `error_count=0`.
- The JavaScript Webmaster weekly collector is a fail-closed tombstone. `fetch_yandex_webmaster_canonical.py` is the only fact writer. Tables `seo_webmaster_queries_weekly` and `seo_webmaster_pages_weekly` are deprecated, have no writer, and must not be read.
- Google Search Console: Zaruku property `https://zaruku.ru/` is connected through root collector `fetch_gsc_canonical.py`, not the old temporary / teletask path. Daily query/page/country/device rows live in `canonical_fact_gsc_queries_daily`; optional Search appearance rows live in `canonical_fact_gsc_search_appearance_daily`; result/search type rows live in `canonical_fact_gsc_search_type_daily`. Canonical lineage is `source_key=google_search_console`; legacy compatibility columns are not contract fields. Optional-layer HTTP 400/403 makes the collector run `partial` while preserving successful core facts. The dashboard read model should expose `zaruku_seo.gsc.status = available` when rows exist and surface recent partial freshness.
- On 2026-07-28, GSC `3/3`, returning-content `1/3`, Webmaster `2/3`, and the RD-11 source-specific health/Telegram renderer were deployed with dated backups. All deployed SHA-256 values, modes, and imports were verified; the read-only health snapshot returned four sources, four partial dates, and zero lineage defects. No collector, backfill, Telegram send, cron edit, schema change, or secret change occurred during deployment.
- `seo_ai_visibility_weekly` is deprecated, has no writer, and must not be read; use `seo_ai_visibility` and canonical AI-visibility facts.

## Databases

### Primary reporting DB

- DB name: `report_bd`
- canonical tables live here
- dashboard tables live here
- legacy ad stats tables also live here

Examples:
- `canonical_source_accounts`
- `canonical_source_campaigns`
- `canonical_fact_ads_daily`
- `canonical_collector_runs`
- `dashboards`
- `dashboard_sources`
- `yandex_new`
- `yandex_names`
- `yandex_group_names`

### Tech DB

- DB name: `report_bd_tech`

Examples:
- `req_system`

### Connection pattern

On VPS, canonical scripts use:
- `MYSQL_HOST=localhost`
- `MYSQL_DB=report_bd`
- `MYSQL_USER=report_bd`
- secrets from `/root/reportingdash-canonical/.env`

From local machine, root `.env` currently points to:
- `MYSQL_HOST=5.35.85.218`
- `MYSQL_DB=report_bd`
- `MYSQL_USER=report_bd`

Do not rediscover DB names each time.
Use `report_bd` and `report_bd_tech` unless there is an explicit migration away from them.

## Current cron schedule

Canonical daily jobs on VPS:
- `02:12` Yandex Metrika canonical: generic collection excluding Abbott and the attested Abbott active-release launcher are serialized by the shared Metrika lock.
- `02:18` Yandex Metrika returning-content canonical for account `66624469` (`fetch_yandex_metrika_returning_canonical.py --account-id 66624469 --run-type cron`). The installed selector was repaired on 2026-07-28.
- `06:20` LinkedIn
- `06:30` Reddit
- `06:32` GetIntent
- `06:34` Yandex Direct
- `06:36` Yandex Promopages
- `06:35` VK Ads v2
- `06:37` Hybrid
- `06:50` Yandex Webmaster canonical daily collector
- `06:55` Google Search Console canonical daily collector (`fetch_gsc_canonical.py --backfill-days 3 --lag-days 3 --run-type cron`)
- `04:50` Abbott health probe
- `05:00` Telegram summary

The legacy `06:10` localhost Metrika bridge was removed under TASK-072. Do not restore it; the `06:12` canonical collector and `06:18` returning-content collector are the active owners.

Important collector rule:
- cron windows do not include the current day
- with `--days-back 2` cron now collects:
  - `yesterday - 1 day`
  - through `yesterday`
- Google Search Console uses `--data-delay-days 3` and `--lag-days 3`, so daily cron ends at `today - 3 days` and repaints a 4-day stable window.

## Deploy workflow

The first shared-password release has a mandatory pre-cutover order: apply migration `042`, seed the
Zaruku hash through silent standard input, and only then deploy the application. Follow
`docs/SHARED-DASHBOARD-PASSWORD-ROLLOUT.md`; rollback must retain
`dashboard_shared_access_settings` and its hashes and may activate only a verified compatible release.

Deploy `dashboard-next` from local machine:

```bash
cd dashboard-next
npm run deploy
```

What deploy does:
- builds locally
- packages `.next/standalone`
- renders `.env` from `/var/www/www-root/data/.production.env`
- validates required runtime secrets before upload
- uploads the build into a staged release dir
- swaps the staged release into `/var/www/dashboard`
- restarts PM2 app `dashboard-next`
- verifies PM2 listens only on `127.0.0.1:3001` and that the public host cannot reach port `3001` directly
- rolls back automatically if PM2 restart, local health, or listener isolation fails; an unmarked
  predecessor is never restarted and PM2 remains stopped fail-closed

Manual rollback:

```bash
cd dashboard-next
npm run deploy:rollback
```

After deploy always verify:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
ssh beget 'cd /root/reportingdash-rollout/dashboard-next && PUBLIC_APP_HOST=5.35.85.218 APP_PORT=3001 bash scripts/verify-loopback-listener.sh'
curl -s https://dashboards.adreports.ru/api/health
```

Bootstrap assumptions:
- nginx should render `dashboards.adreports.ru`
- TLS should point at the real cert/key for that domain, not the ISPmanager fallback cert

## Yandex Direct specifics

Current canonical collector:
- file: `/Users/nafanya/ReportingDash/fetch_yandex_direct_canonical.py`
- source key: `yandex_direct`
- primary authority table: `report_bd.yandex_new`
- metadata tables:
  - `report_bd.yandex_names`
  - `report_bd.yandex_group_names`

Legacy API bridge:
- code: `/Users/nafanya/ReportingDash/nest-second/src/services/direct/direct.service.ts`
- endpoint used upstream: `POST https://api.direct.yandex.com/json/v5/reports`
- auth headers:
  - `Authorization: Bearer <token>`
  - `Client-Login: <req_system.name>`
- account tokens/logins come from:
  - `report_bd_tech.req_system`

Current note:
- active Yandex Direct API logins are stored in `report_bd_tech.req_system`
- canonical currently maps many account bridges as fallback `campaign::<campaign_id>` rows in `canonical_source_accounts`

## Yandex Promopages specifics

- production canonical collector exists
- source key:
  - `yandex_promopages`
- canonical fact table:
  - `canonical_fact_promopages_daily`
- OAuth scope required:
  - `promopages:api`
- organization-linked tokens may also require:
  - `passport:business`
- confirmed API base:
  - `https://promopages.yandex.ru/api/promo/v1`
- current validated endpoints:
  - `GET /permissions/user`
  - `GET /campaigns`
  - `POST /reports/campaigns-daily-stats`
  - `GET /reports/{report_id}?format=json`
- reports are asynchronous:
  - expect `reportId`
  - then poll report endpoint with backoff
- current canonical collector file:
  - `/Users/nafanya/ReportingDash/fetch_yandex_promopages_canonical.py`
- collector runtime on VPS:
  - `/root/reportingdash-canonical/fetch_yandex_promopages_canonical.py`
- cron slot on VPS:
  - `06:36`
- collector log on VPS:
  - `/root/reportingdash-canonical/logs/yandex-promopages-canonical-cron.log`
- current confirmed production cron run:
  - `run 146`
  - `success`
  - window `2026-03-27 .. 2026-03-28`
- current phase 1 rule:
  - Promopages stays isolated from normal awareness `plan_vs_fact`, `channel_table`, and `platform_table`
  - dashboard rendering goes through a dedicated `promopages` section
  - phase 2 binding to media plan and inclusion in awareness spend totals is not enabled yet
- current Promopages access details and latest probe results are tracked in:
  - `PLATFORMS-ACCESS-MEMORY.md`

## Operational shortcuts

Check PM2 runtime:

```bash
ssh beget 'pm2 status'
```

Check canonical latest runs:

```bash
ssh beget "mysql -N -B -e \"SELECT source_key, status, run_type, date_from, date_to, started_at FROM report_bd.canonical_collector_runs ORDER BY id DESC LIMIT 20\""
```

Check Yandex Direct active API logins:

```bash
ssh beget "mysql -N -B -e \"SELECT id, name, media, active FROM report_bd_tech.req_system WHERE active=1 ORDER BY id\""
```

Check Yandex Direct canonical accounts:

```bash
ssh beget "mysql -N -B -e \"SELECT platform_account_id, account_name, account_status FROM report_bd.canonical_source_accounts WHERE source_key='yandex_direct' ORDER BY id\""
```

## Maintenance rule

After any meaningful operational change, update:
1. `AGENTS.md` first
2. the specific detailed doc (`OPS.md`, onboarding doc, tracker, etc.)

Do not leave hidden operational knowledge only in chat history.
