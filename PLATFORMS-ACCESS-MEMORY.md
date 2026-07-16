# PLATFORMS ACCESS MEMORY

Working memory for:
- canonical collectors
- cron behavior
- platform API access
- auth credentials flow
- source-specific operational caveats

Use this file first when the task is about:
- "что собираем по платформе"
- "какой сейчас крон"
- "какой доступ / токен / логин используется"
- "почему collector не даёт метрику"
- "какой endpoint работает сейчас"

If platform access or cron behavior changes, update this file in the same turn.

## Runtime and paths

- Root collectors workspace: `/Users/nicko/ReportingDash`
- Canonical runtime on VPS: `/root/reportingdash-canonical`
- Python venv on VPS: `/root/reportingdash-canonical/venv`
- Logs: `/root/reportingdash-canonical/logs`
- Scheduler: root `crontab`

Main production DBs:
- primary: `report_bd`
- tech: `report_bd_tech`

## Current canonical cron

Daily jobs on VPS:
- `06:20` LinkedIn
- `06:30` Reddit
- `06:32` GetIntent
- `06:34` Yandex Direct
- `06:35` VK Ads v2
- `06:37` Hybrid
- `06:40` canonical monitor
- `06:50` Telegram summary

Important runtime rule:
- cron does not collect the current day
- with `--days-back 2`, cron window is:
  - `yesterday - 1 day`
  - through `yesterday`

This was changed intentionally to avoid partial current-day data in morning runs.

## Daily operations

Check latest collector runs:

```bash
ssh beget "mysql -N -B -e \"SELECT id,source_key,status,run_type,date_from,date_to,started_at,finished_at FROM report_bd.canonical_collector_runs ORDER BY id DESC LIMIT 30\""
```

Check public / app health:

```bash
curl -s https://dashboards.adreports.ru/api/health
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
```

Check PM2:

```bash
ssh beget 'pm2 status'
```

## Source status summary

### LinkedIn

- collector: `/Users/nicko/ReportingDash/fetch_linkedin_canonical.py`
- cron enabled
- canonical-only accepted source
- monitored

### Reddit

- collector: `/Users/nicko/ReportingDash/fetch_reddit_canonical.py`
- cron enabled
- canonical-only accepted source
- monitored

### VK Ads v2

- collector: `/Users/nicko/ReportingDash/fetch_vk_ads_v2_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

### GetIntent

- collector: `/Users/nicko/ReportingDash/fetch_getintent_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

### Hybrid

- collector: `/Users/nicko/ReportingDash/fetch_hybrid_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

Important current state:
- stable production path is still the old `advertiser/BannerName` API family
- cookie-based console path exists only as a temporary research / bridge mechanism
- do not assume console-session auth is acceptable as a long-term production solution

### Yandex Direct

- collector: `/Users/nicko/ReportingDash/fetch_yandex_direct_canonical.py`
- cron enabled
- monitored non-blocking
- working source, but account bridge is still imperfect

### Yandex Metrika

- collector: `/Users/nicko/ReportingDash/fetch_yandex_metrika_canonical.py`
- implemented
- monitored
- cron currently not enabled unless explicitly changed later
- supports targeted backfills with `--counter-id` / `--counter-ids`
- writes canonical site analytics scopes:
  - `traffic`: UTM / ads-attribution grain
  - `goal`: goals by UTM / ads-attribution grain
  - `other`: general traffic-source grain from Metrika
  - `page`: page URL/title grain from `ym:pv:URL,ym:pv:title`
- deletion before rewrites is counter-scoped for targeted runs, so a Zaruku backfill does not wipe Abbott rows in the same date window
- `METRIKA_REQUEST_DELAY_SECONDS` can throttle API requests for long backfills and 429-sensitive counters
- `METRIKA_TOKEN` is the sole OAuth authority key; token issuance and revocation require the Yandex
  account owner, and installation is from a mode-`0600` file without printing the value
- Abbott authority is exact counter `90602537`; the candidate release requires complete, unsampled
  daily coverage for `other`, `traffic`, `page`, `user_behavior`, and `returning`
- Abbott 2026 backfill is resume-safe: it processes `2026-03-29..2026-04-07` first and then every
  remaining completed 2026 date; no candidate activation occurs until the comparator and access gates pass
- rollout procedure: `../docs/ABBOTT-OPERATIONS-RUNBOOK.md`
- current production cron remains unchanged until cutover is explicitly accepted; after acceptance only,
  the planned Abbott schedule is `06:12` canonical, `07:05` deterministic health, `07:10` summary,
  with the duplicate `06:10` legacy `/metrika` removed
- legacy launch calls use the `x-internal-token` header backed by `LEGACY_LAUNCH_SECRET`; never put it
  in a query string
- Zaruku main counter is `66624469`; it must be active in `canonical_source_account_collection_settings` with `collection_mode = ads_plus_seo_plus_user_behavior`
- If `canonical_fact_user_behavior_daily` stays empty for Zaruku, do not infer a collector failure by itself: the counter may not expose `paramsLevel2` / UserID-style rows.

### Yandex Promopages

- canonical collector exists:
  - `/Users/nicko/ReportingDash/fetch_yandex_promopages_canonical.py`
- source key:
  - `yandex_promopages`
- canonical fact table:
  - `report_bd.canonical_fact_promopages_daily`
- phase 1 status:
  - implemented
  - collector writes source accounts, source campaigns, and isolated promopages facts
  - dashboard section is separate from normal awareness plan/fact
- phase 2 status:
  - implemented for bound campaign rows
  - Promopages campaign ids can be attached through `media_plan_bindings`
  - bound rows participate in awareness `plan_vs_fact`, `channel_timeseries`, and KPI totals
  - unbound Promopages remains isolated in dedicated section
- daily cron status:
  - enabled on VPS at `06:36`
  - log file:
    - `/root/reportingdash-canonical/logs/yandex-promopages-canonical-cron.log`

## Platform-specific access notes

### Hybrid

Current stable request used by legacy and stable canonical mode:

```http
GET https://api.hybrid.ru/v3.0/advertiser/BannerName
Authorization: Bearer <token>
Content-Type: application/x-www-form-urlencoded

?from=YYYY-MM-DD
&to=YYYY-MM-DD
&advertiserId=<ADVERTISER_ID>
&limit=1000
```

What stable path returns:
- impressions
- clicks
- views
- reach
- quartiles
- ctr
- viewability
- frequency
- now also confirmed:
  - `ECPM`
  - `ECPC`

What stable path does not currently return:
- native `TotalSum`
- native `Spend`

Current canonical rule for Hybrid:
- `cpm = ECPM`
- `cpc = ECPC`
- `spend` may be derived when native spend is absent:
  - prefer `impressions / 1000 * ECPM`
  - fallback `clicks * ECPC`

Important caution:
- derived spend is not native spend
- document clearly when discussing Hybrid spend quality

Console path that was probed:

```http
POST https://console.hybrid.ru/core/agencyStatistic/GetMultiSplit
```

This path can return:
- `totalSum`
- `eCPM`
- `eCPC`

But:
- it works via browser session / cookies
- it is not currently accepted as a stable production machine-auth path

Hybrid data integrity rule:
- if console spend enrichment path is used, do not overwrite missing optional metrics with zero
- especially do not wipe:
  - `views`
  - quartiles
  - related video metrics

This bug already happened once and was repaired.

### Yandex Direct

Upstream bridge uses:
- endpoint:
  - `POST https://api.direct.yandex.com/json/v5/reports`
- headers:
  - `Authorization: Bearer <token>`
  - `Client-Login: <req_system.name>`

Legacy bridge code:
- `/Users/nicko/ReportingDash/nest-second/src/services/direct/direct.service.ts`

Canonical authority tables:
- `report_bd.yandex_new`
- `report_bd.yandex_names`
- `report_bd.yandex_group_names`

API login list comes from:
- `report_bd_tech.req_system`

Check active Yandex Direct API logins:

```bash
ssh beget "mysql -N -B -e \"SELECT id,name,media,active FROM report_bd_tech.req_system WHERE active=1 ORDER BY id\""
```

Known current active logins included:
- `solgoood`
- `direct.reports`
- `tssystem.web`
- `armstrong.tire`
- `zaruku.direct`
- `kotlyakovo-samoprivoz`
- `ecobidge`
- `leovit-mtg`
- `e-20049220`
- `e-20080761`
- `porg-47e7bbnx`

#### Passport organization case

For passport organization logins such as:
- `porg-47e7bbnx`

Important rule:
- ordinary old tokens do not work
- token must be issued with:
  - `direct:api`
  - `passport:business`
- token must be issued in organization context:
  - "Войти как сотрудник"

Important current blocker already confirmed:
- even with valid org token, `Direct API` can return:
  - `error_code = 58`
  - `Незавершенная регистрация`
- this means:
  - OAuth app is not yet approved in Yandex Direct API interface

So the correct troubleshooting order for org logins is:
1. confirm exact `Client-Login`
2. issue new token with `passport:business`
3. verify token through `login.yandex.ru/info`
4. if `error 58`, complete Direct API app registration and wait for approval

### Yandex Promopages

Official access doc:
- `https://yandex.ru/dev/promopages-api/doc/ru/concepts/promo-access`

Current required OAuth scopes:
- `promopages:api`
- and when organization context is needed:
  - `passport:business`

Confirmed working API base:

```http
https://promopages.yandex.ru/api/promo/v1
```

Confirmed working endpoints:
- `GET /permissions/user`
- `GET /campaigns?publisherId=...&pageLimit=...`
- `GET /publishers/balances?publisherIds=...`
- `POST /reports/campaigns-daily-stats`
- `GET /reports/{report_id}?format=json`

Confirmed behavior:
- report generation is asynchronous
- `POST /reports/campaigns-daily-stats` returns `reportId`
- `GET /reports/{report_id}?format=json` may return:
  - `202` while report is not ready
  - `429` if polled too aggressively
  - `200` with final stats payload

Current verified access with active token:
- `SolGoood`
  - `publisherId = 67483e5de9010d4549c8773a`
- `Landsail`
  - `publisherId = 6748458227933c00367b9682`
  - `clientId = 306606827`
- `Doublestar`
  - `publisherId = 6756d4464ca67f3c078e9db2`
  - `clientId = 308385627`
- `Armstrong`
  - `publisherId = 6819f94d11f2443fdd968296`
  - `clientId = 110719699`

Verified yesterday daily stats probe for `2026-03-28`:
- `SolGoood`
  - campaigns: `0`
- `Landsail`
  - campaigns: `5`
  - stats returned `200`
  - sample metric payload:
    - `impressions = 91672`
    - `reach = 81387`
    - `budget = 7126.4`
    - `cpm = 77.74`
    - `clicks = 1291`
    - `views = 1248`
    - `clickouts = 637`
    - `fullReads = 741`
- `Doublestar`
  - campaigns: `2`
  - stats returned `200`
  - `statistics = []`
- `Armstrong`
  - campaigns: `1`
  - stats returned `200`
  - `statistics = []`

Operational rule:
- Promopages `clientId` must not be assumed to map 1:1 to Yandex Direct business identity without verification
- canonical grain for phase 1 is:
  - `platform_account_id + platform_campaign_id + report_date`
- current collector behavior:
  - requests publishers and campaigns first
  - creates async `campaigns-daily-stats` reports
  - polls with backoff
  - currently uses `trafficSource=total`
  - writes only isolated Promopages facts, not `canonical_fact_ads_daily`
- current production confirmation:
  - run `145` succeeded for `2026-03-28`
  - facts written for `Landsail`
  - run `146` succeeded in `cron` mode for window `2026-03-27 .. 2026-03-28`
  - rows:
    - `rows_read = 2`
    - `rows_written = 14`
    - `rows_updated = 14`

### Yandex ID token verification

Useful endpoint:

```http
GET https://login.yandex.ru/info?format=json
Authorization: OAuth <token>
```

Use it to confirm:
- token is valid
- token belongs to expected `client_id`
- org context is present

This verifies token validity, but does not guarantee Direct API access.

## Telegram and monitoring

Daily Telegram summary is enabled.

Current cron:

```cron
50 6 * * * cd /root/reportingdash-canonical && /root/reportingdash-canonical/venv/bin/python send_canonical_telegram_report.py --mode summary >> /root/reportingdash-canonical/logs/canonical-telegram-summary.log 2>&1
```

Meaning:
- summary mode is active
- not alert-only mode

## Known completed operational changes

Already done and should not be rediscovered:

1. canonical cron no longer includes the current day
2. Telegram summary switched from alert-only to daily summary mode
3. Hybrid `views` wipe regression from console backfill was repaired
4. Hybrid collector was patched to avoid wiping optional metrics when absent
5. Hybrid stable API path now yields `ECPM` / `ECPC`
6. Hybrid canonical can derive `spend` from `ECPM` / `ECPC` when native spend is absent
7. Yandex Direct new passport-organization flow was investigated
8. Yandex org token with `passport:business` was successfully validated through Yandex ID
9. Yandex Direct org access currently blocks on `error 58` until app registration is approved
10. `porg-47e7bbnx` was added into `report_bd_tech.req_system` as an active Direct API login
11. Direct API access for `porg-47e7bbnx` is now confirmed working at HTTP level; current-day probe returns an empty report header, not an auth error
12. Yandex Metrika canonical collector now supports targeted counter backfills, counter-scoped deletes, API throttling, and page-level canonical rows; Zaruku `66624469` was enabled for canonical collection.

## Working rule for future platform-access tasks

When returning to collector / cron / platform API tasks:
1. read `PLATFORMS-ACCESS-MEMORY.md`
2. then inspect the relevant collector file
3. then inspect DB state / latest runs
4. only after that reconstruct old chat context if still needed
