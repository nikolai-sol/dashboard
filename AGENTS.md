# AGENTS

Authoritative shared memory for agents working in `/Users/nicko/ReportingDash`.

Update this file whenever any of the following changes:
- production runtime
- deploy path
- database names / access pattern
- cron schedule
- auth / access model
- canonical collector behavior

If another doc conflicts with this file, treat this file as the current source of truth and then fix the stale doc.

## Workspace layout

- Root folder: `/Users/nicko/ReportingDash`
  - operational docs
  - Python collectors
  - canonical monitoring scripts
- Next.js app repo: `dashboard-next`
- Legacy Nest code copy: `/Users/nicko/ReportingDash/nest-second`

Important:
- the root folder is not a git repo
- `dashboard-next/` is a git repo

## Dashboard-specific memory

For dashboard work, use this file first:
- `DASHBOARDS-MEMORY.md`

It contains the current dashboard runtime rules, auth model, export rules, comparison behavior, and latest completed dashboard changes.

Current auth note:
- Abbott dashboard supports:
  - password-only viewer access
  - permanent iframe access through `embed_key`

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

Dashboard AI summary (`/api/dashboard/[id]/ai-summary/generate`):
- Uses `AI_SUMMARY_*` env from `/var/www/dashboard/.env` (rendered from `.production.env` on deploy).
- Gemini via `generativelanguage.googleapis.com` OpenAI-compat: API rejects `temperature` other than `1` for some models; output JSON needs enough `max_tokens` (large Russian bullets truncate easily). Parser must balance `{` `}` outside strings (headlines/bullets may contain `}`).

Do not assume `systemd` or port `3002` for `dashboard-next`.
Current truth is `PM2 + 3001`.

### Canonical collectors runtime

- runtime path: `/root/reportingdash-canonical`
- scheduler: root `crontab`
- python env: `/root/reportingdash-canonical/venv`
- collector logs: `/root/reportingdash-canonical/logs`

Current Zaruku source truth:
- Yandex Metrika: collect only counter `66624469`; counters `29137835`, `105559308`, and `99078698` are on hold/inactive in `canonical_source_account_collection_settings`.
- Yandex Webmaster: Zaruku host `https:zaruku.ru:443` is connected for canonical daily summary, query, and URL/page facts. URL/page rows live in `canonical_fact_webmaster_pages_daily`; the dashboard read model should expose `zaruku_seo.webmaster.data_availability.pages = true`.
- Google Search Console: Zaruku property `https://zaruku.ru/` is connected through root collector `fetch_gsc_canonical.py`, not the old temporary / teletask path. Daily query/page/country/device rows live in `canonical_fact_gsc_queries_daily`; the dashboard read model should expose `zaruku_seo.gsc.status = available` when rows exist.

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
- `06:20` LinkedIn
- `06:30` Reddit
- `06:32` GetIntent
- `06:34` Yandex Direct
- `06:36` Yandex Promopages
- `06:35` VK Ads v2
- `06:37` Hybrid
- `06:40` canonical monitor
- `06:50` Telegram summary
- `06:55` Google Search Console canonical daily collector (`fetch_gsc_canonical.py --backfill-days 3 --run-type cron`)

Important collector rule:
- cron windows do not include the current day
- with `--days-back 2` cron now collects:
  - `yesterday - 1 day`
  - through `yesterday`

## Deploy workflow

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
- rolls back automatically if PM2 restart or local health check fails

Manual rollback:

```bash
cd dashboard-next
npm run deploy:rollback
```

After deploy always verify:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
curl -s https://dashboards.adreports.ru/api/health
```

Bootstrap assumptions:
- nginx should render `dashboards.adreports.ru`
- TLS should point at the real cert/key for that domain, not the ISPmanager fallback cert

## Yandex Direct specifics

Current canonical collector:
- file: `/Users/nicko/ReportingDash/fetch_yandex_direct_canonical.py`
- source key: `yandex_direct`
- primary authority table: `report_bd.yandex_new`
- metadata tables:
  - `report_bd.yandex_names`
  - `report_bd.yandex_group_names`

Legacy API bridge:
- code: `/Users/nicko/ReportingDash/nest-second/src/services/direct/direct.service.ts`
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
  - `/Users/nicko/ReportingDash/fetch_yandex_promopages_canonical.py`
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
