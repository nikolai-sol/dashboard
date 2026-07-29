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

- Root collectors workspace: `/Users/nafanya/ReportingDash`
- Canonical runtime on VPS: `/root/reportingdash-canonical`
- Python venv on VPS: `/root/reportingdash-canonical/venv`
- Logs: `/root/reportingdash-canonical/logs`
- Scheduler: root `crontab`

Main production DBs:
- primary: `report_bd`
- tech: `report_bd_tech`

## Current canonical cron

Daily jobs on VPS:
- `06:12` Yandex Metrika canonical daily collector
- `06:18` Zaruku Yandex Metrika returning-content canonical daily collector
- `06:20` LinkedIn
- `06:30` Reddit
- `06:32` GetIntent
- `06:34` Yandex Direct
- `06:35` VK Ads v2
- `06:37` Hybrid
- `06:50` Yandex Webmaster canonical daily collector
- `06:55` Google Search Console canonical daily collector
- `07:05` canonical monitor
- `07:10` Telegram summary

The legacy `06:10` localhost Metrika bridge was removed under TASK-072. It was shell-broken and produced no July facts. Do not restore it.

These times record the audited operations schedule. Merging collector code in this repository does not by itself deploy, run, backfill, or edit cron.

Important runtime rule:
- cron does not collect the current day
- with `--days-back 2`, cron window is:
  - `yesterday - 1 day`
  - through `yesterday`
- Google Search Console uses a separate freshness guard: `--data-delay-days 3`, so its daily cron ends at `today - 3 days` and repaints a 4-day window with `--lag-days 3`.

This was changed intentionally to avoid partial current-day data in morning runs.

## Telegatask SEO OS on Beget

- production SEO runtime: `/opt/telegatask`
- scheduler: root `crontab`, Mondays at `09:10` with `CRON_TZ=Europe/Vienna`
- wrapper: `/opt/telegatask/scripts/runWeeklySeoRhythmCron.sh`
- MySQL account: `telegatask_seo@localhost`; its password lives only in `/opt/telegatask/.env`
- MySQL target: `localhost:3306/report_bd`
- `report_bd` credentials remain unchanged and are not used by the SEO exporter
- exporter DML is limited to the configured `seo_*` read-model tables; schema-level `CREATE` is retained because the exporter executes `010_seo_os_v1.sql`, and `ALTER/INDEX` is limited to `seo_tasks`
- root has `/root/.my.cnf`; every Telegatask MySQL CLI invocation must put `--no-defaults` first so root client defaults cannot override `MYSQL_PWD`
- as of 2026-07-20 there is no live or saved `telegatask` process in either root or `www-root` PM2 on Beget; do not start another bot instance without checking the Mac long-poll runtime
- W30 run / W29 data dashboard export was verified live on 2026-07-20: the export payload contained 26 positions, 3 opportunities, 4 tasks, 1 weekly run, and 15 section patterns; after idempotent upsert the W29 tables contain 26 position rows and 9 opportunity rows

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

- collector: `/Users/nafanya/ReportingDash/fetch_linkedin_canonical.py`
- cron enabled
- canonical-only accepted source
- monitored

### Reddit

- collector: `/Users/nafanya/ReportingDash/fetch_reddit_canonical.py`
- cron enabled
- canonical-only accepted source
- monitored

### VK Ads v2

- collector: `/Users/nafanya/ReportingDash/fetch_vk_ads_v2_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

### GetIntent

- collector: `/Users/nafanya/ReportingDash/fetch_getintent_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

### Hybrid

- collector: `/Users/nafanya/ReportingDash/fetch_hybrid_canonical.py`
- cron enabled
- bridged source
- monitored non-blocking

Important current state:
- stable production path is still the old `advertiser/BannerName` API family
- cookie-based console path exists only as a temporary research / bridge mechanism
- do not assume console-session auth is acceptable as a long-term production solution

### Yandex Direct

- collector: `/Users/nafanya/ReportingDash/fetch_yandex_direct_canonical.py`
- cron enabled
- monitored non-blocking
- working source, but account bridge is still imperfect

### Yandex Metrika

- collector: `/Users/nafanya/ReportingDash/fetch_yandex_metrika_canonical.py`
- implemented
- monitored
- cron enabled on VPS at `06:12` with `fetch_yandex_metrika_canonical.py --days-back 2 --run-type cron`
- supports targeted backfills with `--counter-id` / `--counter-ids`
- writes canonical site analytics scopes:
  - `traffic`: UTM / ads-attribution grain
  - `goal`: goals by UTM / ads-attribution grain
  - `other`: general traffic-source grain from Metrika
  - `page`: page URL/title grain from `ym:pv:URL,ym:pv:title`
  - `entry_page`: session-scope start URL grain from `ym:s:startURL`, including visits, users, pageviews, bounce rate, average visit duration, and page depth
- `page` remains pageview-scope; do not merge its users with session-scope `entry_page` users as one metric
- deletion before rewrites is counter-scoped for targeted runs, so a Zaruku backfill does not wipe Abbott rows in the same date window
- `METRIKA_REQUEST_DELAY_SECONDS` can throttle API requests for long backfills and 429-sensitive counters
- Zaruku main counter is `66624469`; it must be active in `canonical_source_account_collection_settings` with `collection_mode = ads_plus_seo_plus_user_behavior`
- Zaruku inactive / hold counters `29137835`, `105559308`, and `99078698` must stay `is_active = 0` and `cron_enabled = 0`; do not collect them unless the user explicitly reactivates them.
- If `canonical_fact_user_behavior_daily` stays empty for Zaruku, do not infer a collector failure by itself: the counter may not expose `paramsLevel2` / UserID-style rows.

#### Yandex Metrika returning content

- collector: `/Users/nafanya/ReportingDash/fetch_yandex_metrika_returning_canonical.py`
- production runtime: `/root/reportingdash-canonical/fetch_yandex_metrika_returning_canonical.py`
- cron enabled on VPS at `06:18`
- cron command: `fetch_yandex_metrika_returning_canonical.py --backfill-days 3 --run-type cron --account-id 66624469`
- log file: `/root/reportingdash-canonical/logs/yandex-metrika-returning-canonical-cron.log`
- production table: `report_bd.canonical_fact_metrika_returning_pages_daily`
- collector telemetry source key: `yandex_metrika_returning`
- row source key: `yandex_metrika`
- default Zaruku account/counter: `66624469`
- dimensions: `ym:s:endURL`
- metrics: `ym:s:visits`, `ym:s:upToDayUserRecencyPercentage`, `ym:s:upToWeekUserRecencyPercentage`, `ym:s:upToMonthUserRecencyPercentage`
- canonical grain/idempotency: `(analytics_account_id, report_date, page_hash)`, where `page_hash = sha256(page_url)`
- user buckets are stored as exclusive estimates:
  - `returning_1_day_users`
  - `returning_2_7_days_users`
  - `returning_8_31_days_users`
- legacy `yandex_metrika_returned` is historical only for Zaruku dashboards and should not be used as the product read model after the canonical panel migration.

### Yandex Webmaster

- collector: `/Users/nafanya/ReportingDash/fetch_yandex_webmaster_canonical.py` deployed into `/var/www/dashboard/fetch_yandex_webmaster_canonical.py`
- implemented for Zaruku host `https:zaruku.ru:443`
- writes daily canonical facts:
  - `canonical_fact_webmaster_queries_daily`
  - `canonical_fact_webmaster_summary_daily`
  - `canonical_fact_webmaster_pages_daily`
- The separately runnable `--layers query_pages` mode writes exact standard-API URL-filter pairs to `canonical_fact_webmaster_query_pages_daily` and successful page-day coverage, including empty results, to `canonical_webmaster_query_page_coverage_daily`. It never joins the separate daily query and page tables.
- Manual weekly run `1715` succeeded for 15 priority pages and `2026-07-21..2026-07-27`: 105 coverage rows, 67 pair facts, 88 successful-empty page-days, and zero bad rows. Query-page health is `healthy` with expected frequency 168 hours.
- The proposed `20 3 * * 1` UTC cron is not installed. It remains gated by the Abbott successor release, dashboard deployment, and production SEO smoke; active query-page priority therefore remains manual limit 15.
- Enhanced Export is reserved for historical backfill and exact fallback. No paid quota is allowed without separate authorization.
- URL/page facts come from Yandex Webmaster `query-analytics/list` with `text_indicator = URL`; default `YANDEX_WEBMASTER_SEARCH_LOCATION = ALL_LOCATIONS`, matching the Webmaster UI screenshot.
- default daily window is four days: yesterday plus the preceding three days (`--lag-days 3`)
- for every account / host / date / device, query facts use transactional replacement: delete the prior snapshot, insert the complete current query set, and upsert the summary in one commit
- an empty current query set removes stale query rows; a write failure rolls back the replacement
- 2026-07-17 production backfill run `1439` collected URL/page facts for `2026-07-13..2026-07-15`; `2026-07-15` has 968 page rows for account `66624469`.
- `fetch_yandex_webmaster_canonical.py` is the only writer. The JavaScript weekly collector is a fail-closed tombstone; `seo_webmaster_queries_weekly` and `seo_webmaster_pages_weekly` are `DEPRECATED / NO WRITER / DO NOT READ`.

### Google Search Console

- collector: `/Users/nafanya/ReportingDash/fetch_gsc_canonical.py`
- production runtime: `/root/reportingdash-canonical/fetch_gsc_canonical.py`
- cron enabled on VPS at `06:55`
- log file: `/root/reportingdash-canonical/logs/gsc-canonical-cron.log`
- source key: `google_search_console`
- Zaruku property: `https://zaruku.ru/`
- Zaruku analytics account id: `66624469`
- writes daily canonical facts:
  - `canonical_fact_gsc_queries_daily` for query/page/country/device facts
  - `canonical_fact_gsc_search_appearance_daily` for Search appearance / SERP-feature facts
  - `canonical_fact_gsc_search_type_daily` for Google result/search type facts
- cron window: yesterday plus 3-day backfill (`--backfill-days 3`) because GSC can lag by 2-3 days
- idempotency: upsert by canonical business key `(analytics_account_id, report_date, query, page, device, country)`; `query_hash` is computed from the same canonical fields only for compatibility
- optional-layer idempotency: Search appearance uses `feature_hash = sha256(search_type, search_appearance, page, country, device)`; result type uses `type_hash = sha256(search_type, page, country, device)`
- default result types requested by the collector are `web,image,video,news,discover,googleNews`; unsupported optional-layer HTTP 400/403 responses are recorded and make the run `partial`, while successful core facts remain committed
- 2026-07-19 backfill run `1480` for `2026-07-01..2026-07-18` wrote result-type rows for `web`, `image`, and `video`; Search appearance returned 0 rows for Zaruku through `2026-07-17`
- legacy columns `property_url`, `query_text`, and `device_type` are nullable compatibility columns and must not be populated by the root collector
- canonical query lineage is `source_key='google_search_console'`. Under TASK-072, 8,804 canonical-refreshed rows from `2026-07-13..15` were backed up and relabelled in place from stale `seo_os`; they were not deleted because they are the only facts for those dates.
- old temporary collector `fetch_google_search_console_canonical.py` must not be used as a writer for this table

### External SEO OS

- SEO OS is externally owned and operated; this canonical collector repository consumes its database outputs but does not own its scheduling or execution
- do not infer an SEO OS deployment or run from changes in this repository

### AI / GEO visibility

- current collection is manual
- no automated AI/GEO collector or cron is owned by this repository

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
- `/Users/nafanya/ReportingDash/nest-second/src/services/direct/direct.service.ts`

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
13. Zaruku Metrika counters `29137835`, `105559308`, and `99078698` are on hold/inactive in production collection settings; only counter `66624469` should remain active for Zaruku.
14. Yandex Webmaster URL/page facts are now canonical daily rows in `canonical_fact_webmaster_pages_daily`; dashboard payload `zaruku_seo.webmaster.data_availability.pages` is true after backfill run `1439`.
15. Google Search Console is now owned by root collector `fetch_gsc_canonical.py`, cron-enabled at `06:55`, and dashboard-connected through `canonical_fact_gsc_queries_daily`, `canonical_fact_gsc_search_appearance_daily`, and `canonical_fact_gsc_search_type_daily`; the old temporary collector is no longer the writer.
16. Telegatask SEO OS weekly runtime and cron now live on Beget under `/opt/telegatask`; dashboard export uses isolated MySQL account `telegatask_seo@localhost`, and exporter CLIs ignore `/root/.my.cnf` via `--no-defaults`.

## Working rule for future platform-access tasks

When returning to collector / cron / platform API tasks:
1. read `PLATFORMS-ACCESS-MEMORY.md`
2. then inspect the relevant collector file
3. then inspect DB state / latest runs
4. only after that reconstruct old chat context if still needed
