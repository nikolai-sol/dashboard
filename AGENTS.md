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
- PM2 config: `/var/www/dashboard/ecosystem.config.js`
- app logs:
  - `/var/log/dashboard-next-out.log`
  - `/var/log/dashboard-next-error.log`

Health checks:
- local VPS: `curl -s http://127.0.0.1:3001/api/health`
- public: `curl -s https://dashboards.adreports.ru/api/health`

Do not assume `systemd` or port `3002` for `dashboard-next`.
Current truth is `PM2 + 3001`.

### Canonical collectors runtime

- runtime path: `/root/reportingdash-canonical`
- scheduler: root `crontab`
- python env: `/root/reportingdash-canonical/venv`
- collector logs: `/root/reportingdash-canonical/logs`

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
- `06:35` VK Ads v2
- `06:37` Hybrid
- `06:40` canonical monitor
- `06:50` Telegram summary

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
- uploads to `/var/www/dashboard`
- restarts PM2 app `dashboard-next`

After deploy always verify:

```bash
ssh beget 'pm2 status'
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
curl -s https://dashboards.adreports.ru/api/health
```

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

- no production canonical collector yet
- access currently confirmed through direct API probing only
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
