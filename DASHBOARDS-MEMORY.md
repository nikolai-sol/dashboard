# DASHBOARDS MEMORY

Working memory for the dashboard contour.

Use this file first when the task is about:
- dashboard UI / sections
- admin wizard
- dashboard auth / viewer access
- PDF / Excel export
- embed behavior
- dashboard runtime behavior on `dashboards.adreports.ru`

If dashboard work changes materially, update this file in the same turn.

## Repos and runtime

- Main dashboard repo: `dashboard-next`
- Production app path on VPS: `/var/www/dashboard`
- Public domain: `https://dashboards.adreports.ru`
- Process manager: `PM2`
- Local bind on VPS: `127.0.0.1:3001`

Deploy:

```bash
cd dashboard-next
npm run deploy
```

Health:

```bash
curl -s https://dashboards.adreports.ru/api/health
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
```

## Current dashboard architecture

### Abbott canonical/private release boundary

- The Abbott canonical/private operator procedure is
  `../docs/ABBOTT-OPERATIONS-RUNBOOK.md`; packaging the procedure does not mean production cutover
  has occurred.
- Production reads after cutover resolve one atomic Abbott active-release pointer. Missing candidate
  coverage blocks activation; the dashboard never falls back to legacy data within a selected month.
- Manager-only source/import data and checkpoints remain outside `public`, `.next/static`, standalone
  public assets, and deployment archives. The release guard must stay enabled.
- Embed uses only the aggregate `abbott_embed_reader_role` and required `ABBOTT_EMBED_DB_*`
  credentials with `ABBOTT_EMBED_DB_NAME=report_bd`; that role has no private-schema grants.
- `report_bd_private` is accessed only by the server-side manager read model through separate
  `ABBOTT_PRIVATE_DB_*` credentials with `ABBOTT_PRIVATE_DB_NAME=report_bd_private`.
- The import CLI uses a separate `ABBOTT_IMPORT_DB_*` account/role and only explicit mode-`0600`
  source paths. A failed import leaves the previous active pointer unchanged.
- Embed projection remains aggregate-only and cannot request raw identifiers or private journeys.
- Abbott release returning facts live in
  `canonical_fact_metrika_returning_pages_release_daily`; the Zaruku collector and reader retain
  their distinct account-scoped `canonical_fact_metrika_returning_pages_daily` authority.
- The synchronized canonical bootstrap manifest records SHA-256 and runtime roles for the Metrika
  collector, canonical writer, and release store; copied files must remain byte-identical to root.

## Abbott visit-level operational truth

- Abbott source summaries use Reports API attribution `lastsign` and exact traffic segments `all`, `with_user_id`, and `without_user_id`. Per day/source, `all.sessions = with_user_id.sessions + without_user_id.sessions` is a hard publication gate.
- `user_behavior` uses Logs API `source=visits`. One private database row is one Metrica visit in `report_bd_private.canonical_fact_metrika_visits`. Raw User ID, visit ID, start URL, and end URL are manager-only. Raw client ID is never stored; only its hash is persisted.
- Logs execute evaluate → create → poll → download all parts → clean in finally. Prepared files count against the 10 GB quota until cleaned.
- `METRIKA_TOKEN` remains the only OAuth environment key. Never print it. The owner installs or revokes it; this change does not issue or rotate a token.
- Current cron remains collection `06:12`, health `07:05`, and one summary `07:10`. The summary includes session integrity; a mismatch is `CRITICAL`.
- Logs cannot return the current day. Active releases remain append-only; late changes require a reviewed successor release/backfill.
- Bitrix dump remains test-only; the live connector is deferred.
- No deployment, secret installation, API call, database migration, cron edit, Telegram send, or Hermes schedule occurred.

### Shared data loader

- Core runtime is built in:
  - `src/lib/dashboard-data-loader.ts`
- Public API route uses the shared loader:
  - `src/app/api/dashboard/[id]/route.ts`
- Excel export uses the same loader:
  - `src/app/api/dashboard/[id]/excel/route.ts`
- PDF export renders the public dashboard page in `pdf=true` mode:
  - `src/app/api/dashboard/[id]/pdf/route.ts`

### Section order rule

- Public dashboard must respect saved `section_order`
- Hidden sections must not be re-added by runtime defaults
- The authoritative section list comes from dashboard config saved in admin

## Admin behavior

### Step 6 Metrics

Two different settings exist and must stay separate:

- `kpi_cards`
  - controls KPI cards at the top
- `visible_metrics`
  - controls metric visibility for all metric-driven sections below

Current rule:
- `visible_metrics` affects:
  - `TrendChart`
  - `PlanVsFact`
  - `ChannelPerformanceTable`
  - `PlatformPlanVsFact`
  - `PlatformTable`
  - `ComparisonSection`

### Save behavior

- Admin wizard must save only on explicit `Save`
- No auto-save on step switch
- Wizard shows:
  - `Unsaved changes`
  - `All changes saved`
- Guards are enabled for:
  - browser close / reload
  - back / forward
  - internal navigation

Main file:
- `src/components/admin/DashboardWizard.tsx`

## Dashboard auth model

### Admin auth

- `/admin/*` requires admin login
- Current admin login is configured in env-backed auth flow

### Viewer auth

- Per-dashboard viewer users are supported
- If a dashboard has viewer users, public API / Excel / PDF require viewer auth
- Abbott and Zaruku are exceptions to the access-user rule: both always use mandatory `password_only`
  mode regardless of `dashboard_access_users`; neither can become public or use `email_password`
- `dashboard_shared_access_settings` is the credential authority whenever a dashboard has a row. It
  stores a salted `scrypt` hash, a monotonically increasing `credential_version`, audit attribution,
  and timestamps; it never stores plaintext
- Abbott alone retains the transitional `ABBOTT_DASHBOARD_PASSWORD` fallback at credential version `0`,
  and only until its first DB row exists. The env value remains required by current production release
  validation for this transition, but every new seed/admin rotation writes the DB and never updates env
- Zaruku has no environment fallback and fails closed until its DB row is seeded before application cutover
- Signed per-dashboard viewer and export tokens carry a mandatory audience:
  - password/email login => `manager`
  - `embed_key` access => `embed`
  - legacy dashboard tokens without an audience are rejected and require re-login
- Shared-password manager viewer sessions and derived export tokens also carry `credential_version`.
  Every protected request compares it with current DB authority (or Abbott fallback version `0`), so a
  rotation immediately rejects all older manager sessions and exports, even if the password text is unchanged
- Abbott responses are projected server-side by that audience:
  - `manager` keeps raw User ID and row-level journey data, with URL query strings and fragments removed
  - `embed` receives aggregate-only Abbott data without User ID fields, session IDs, user actions, or journey rows
- Dashboard API, Excel, PDF, and AI-summary responses use `Cache-Control: private, no-store`; client-visible errors do not include exception details
- Viewer portal sessions keep their existing audience-free payload and behavior
- Viewer portal root page exists at:
  - `https://dashboards.adreports.ru/`
- Root page shows:
  - login
  - list of dashboards available to the viewer
- Viewer logout must redirect to `/`

Relevant files:
- `src/app/page.tsx`
- `src/components/ViewerPortalLogin.tsx`
- `src/app/api/viewer-portal/login/route.ts`
- `src/app/api/viewer-portal/logout/route.ts`
- `src/app/api/dashboard-auth/login/route.ts`

### Shared-password operations

- The authoritative operator sequence and verification boundaries are in
  `docs/SHARED-DASHBOARD-PASSWORD-ROLLOUT.md`
- First rollout order is migration `042` -> Zaruku seed through silent stdin -> application deploy;
  deploying before the seed would expose only Zaruku's intentional fail-closed state
- Capture the password with hidden `read -rsp` inside the runbook's cleanup-trapped subshell and pipe it
  to `npm --silent run access:set-shared-password -- --client-id zaruku`; never run that CLI bare from a
  TTY, pass the password as an argument, or put it in shell history, logs, documentation, checkpoints,
  or deployment artifacts
- Admin password changes for both Abbott and Zaruku use the same transactional DB rotation path
- Application rollback retains `dashboard_shared_access_settings`, all hashes, and current credential
  versions; never delete the table, decrement a version, or restore plaintext credential material
- Roll back only to a release verified to enforce mandatory Abbott and Zaruku shared-password access and
  read those retained DB versions. Base `0c9e046` is not compatible. Without a compatible predecessor,
  keep the affected dashboards/app behind an explicit fail-closed maintenance/deny control until a
  corrected compatible release is deployed; Zaruku must never become public
- This documentation change does not perform a migration, seed, deployment, secret change, or rollback

### Embed auth

- Embedded dashboard auth must not rely only on first-party cookies
- Viewer login flow was extended with `access_token` handling for iframe use
- Viewer cookies were switched to iframe-compatible mode:
  - `SameSite=None`
  - `Secure`
- Abbott also supports a permanent embed query key:
  - `embed_key`
  - configured only through `process.env.ABBOTT_DASHBOARD_EMBED_KEY`; there is no fallback key
  - this is intended for iframe embedding without expiring `access_token`
  - it is independent from `dashboard_shared_access_settings`; shared-password rotation does not change
    or revoke the embed key or embed access

## Embed rules

- Public dashboard pages are allowed in iframe on Bayesly domains
- Admin pages must not be embeddable
- Current embed uses:
  - `https://dashboards.adreports.ru/dashboard/<id>`
- Protected Abbott embed can also use:
  - `https://dashboards.adreports.ru/dashboard/abbott?embed_key=...`
- Dashboard page runtime must preserve `embed_key` in:
  - API fetches
  - date range changes
  - brand changes
  - PDF / Excel export links

Known note:
- Full-width embed mode is still a separate enhancement
- Current dashboard page still has layout constraints unless explicitly refactored for embed mode

## Export rules

### Excel

Current expectations:
- Export must include only sections that are actually visible in the dashboard config
- For channel-first dashboards, export must follow channel grain, not platform grain
- `Channel Performance` sheet must include daily breakdown rows
- `Summary` sheet now uses `Channel Performance Plan / Fact` instead of KPI block

### PDF

- PDF follows public dashboard rendering
- It already respects saved `section_order`

## Multibrand overlay

- Multibrand is not a new global dashboard runtime for every board.
- It is an opt-in config layer in `dashboard.config.multibrand`.
- Admin `Basic -> Type` now also supports `multibrand` as an explicit dashboard type.
- Existing dashboards must keep their current behavior when `multibrand.enabled` is false or missing.
- The multibrand layer is intended for a dedicated dashboard such as `multibrand` only.
- Brand selection is passed through the public dashboard route via query param:
  - `brand=<brand_id>`
- Brand selection works by applying brand-specific source filters and channel patterns on top of the existing awareness loader, not by replacing the shared dashboard architecture.
- Executive totals for a `multibrand` dashboard must be calculated only as the sum of brand cards.
- Each brand card must behave like a normal awareness slice for that brand.
- `multibrand` must not introduce a separate KPI math path for awareness metrics.
- Brand setup semantics:
  - `source_filters` define which actual source campaigns belong to the brand
  - `channel_patterns` define which media-plan rows and fact channel names belong to the brand
  - exact channel names are allowed in `channel_patterns` and are treated as direct brand assignment for channel-level facts
- Admin manager setup lives in Step 1 and Step 3:
  - Step 1 enables multibrand mode and executive title/subtitle
  - Step 3 defines brands, channel patterns, and per-source brand filters

## Comparison section

Comparison is optional and uses:
- `compare_from`
- `compare_to`

Current rules:
- KPI cards themselves do not show compare delta
- Comparison appears as a separate section
- Compare detail grain follows dashboard filter scope:
  - `Channels only` => compare by channels
  - platform mode => compare by platforms
- `show_spend = false` must hide all spend-related metrics everywhere, including comparison

Main files:
- `src/components/ComparisonToggle.tsx`
- `src/components/ComparisonSection.tsx`
- `src/app/dashboard/[id]/page.tsx`

## Promopages direction

Current implementation direction:

### Phase 1

- add a new actual source:
  - `Yandex Promopages`
- add a dedicated canonical collector contour for this source
- render Promopages in a dedicated dashboard section:
  - `promopages`
- do not mix Promopages into normal awareness `plan_vs_fact`, `channel_table`, or `platform_table` in v1
- status:
  - implemented
  - section is available in Step 6 `Dashboard sections`
  - loader reads isolated Promopages data into `dashboard.promopages`
  - public dashboard renders it only through dedicated `PromopagesSection`

### Phase 2

- add optional media plan binding for Promopages
- allow Promopages spend to participate in overall awareness spend totals when explicitly connected and mapped
- status:
  - implemented for bound campaign rows
  - media plan bindings can now point to `yandex_promopages` campaign ids
  - bound Promopages facts participate in:
    - `plan_vs_fact`
    - `channel_timeseries`
    - top awareness KPI totals and trend overlays
  - Promopages still remains a separate dedicated section as well

Current rule:
- unbound Promopages stays isolated in its own section and source path
- only explicitly bound Promopages campaign ids are folded into awareness totals
- ordinary platform sections remain based on normal paid-media sources; Promopages is not force-mixed into them

## Metrics rules

### Spend-related visibility

If `show_spend = false`, never show:
- `spend`
- `cpm`
- `cpc`
- `cpv`
- `cpa`
- `roas`

This rule applies across:
- public sections
- comparison section
- Excel export

### Views -> CPV

Current enforced rule:
- if a section shows `views` and `show_spend = true`, it should also expose `cpv`
- `cpv` is derived as:
  - `spend / views`

### CPV formatting

Current enforced rule:
- `CPV` must render with 2 fractional digits
- do not use the generic zero-decimal money formatter for CPV

Files currently patched for this:
- `src/app/dashboard/[id]/page.tsx`
- `src/components/PlanVsFact.tsx`
- `src/components/ChannelPerformanceTable.tsx`
- `src/components/PlatformPlanVsFact.tsx`
- `src/components/PlatformTable.tsx`
- `src/components/TrendChart.tsx`
- `src/components/ComparisonSection.tsx`

## Latest dashboard changes already completed

Recent completed changes that should not be rediscovered:

1. Hybrid spend / CPM / CPC support was added into canonical via API enrichment and fallback logic.
2. `Visible metrics` wiring was extended so it now affects all dashboard sections below KPI cards.
3. `Views -> CPV` auto-rule was added.
4. `CPV` formatting was fixed to 2 decimals.
5. Channel performance table supports daily expand rows.
6. Excel export was aligned with visible sections and channel-first dashboards.
7. Comparison section was added as a separate dashboard section.
8. Viewer portal and per-dashboard viewer auth were added.
9. Root `/` now shows viewer login / cabinet, not a random dashboard.
10. Logout redirects to root login page.
11. Zaruku portal BI dashboard was added as `dashboard_type = zaruku_bi`:
    - production DB row: `dashboards.id = 28`, `client_id = zaruku`
    - source binding: `dashboard_sources.platform = yandex_metrika`, `source_config.account_ids = ["66624469"]`
    - Zaruku no longer uses the Abbott BI UI; it renders `src/components/ZarukuSeoDashboard.tsx`
    - data path: `src/lib/zaruku-seo.ts` returns `zaruku_seo` with measurement layers `onsite / serp / ai`
    - current connected onsite source is Yandex Metrika: canonical traffic/page facts plus live Metrika API cuts for search engines, phrases, organic landings, devices, geo, browser/OS, inferred age/gender/interests
    - Yandex Webmaster is connected through canonical daily tables for summary, query, and URL/page facts; dashboard payload `zaruku_seo.webmaster.data_availability.pages` should be true when `canonical_fact_webmaster_pages_daily` exists
    - Google Search Console is connected through root collector `fetch_gsc_canonical.py` and canonical tables. Query/page/country/device rows live in `canonical_fact_gsc_queries_daily`; Search appearance rows live in `canonical_fact_gsc_search_appearance_daily`; result/search type rows live in `canonical_fact_gsc_search_type_daily`. Dashboard payload `zaruku_seo.gsc.status` should be `available` when canonical rows exist, and GSC must not render as a pending source.
    - Zaruku GSC read model exposes `summary`, `country_summary`, `queries`, `landing_pages`, `brand_split`, `search_appearance`, and `search_type_summary`. `landing_pages`, `brand_split`, country, and device panels are dashboard-side aggregations from the query table; Search appearance and result type panels are backed by their own daily canonical tables.
    - Zaruku SEO tab renders GSC panels for search facts, queries, landing pages, countries, devices, brand vs non-brand, Search appearances, and result types. Brand bucket currently matches `zaruku`, `заруку`, `за руку`, and `зараку`; everything else is `non_brand`.
    - Zaruku Geo tab renders one focused `Карта спроса по России` panel instead of separate country/city bar lists. It uses `@visx/geo` with local `world-atlas` Russia geometry, real city longitude/latitude, collision-separated markers with leader lines to their geographic anchors, five persistent top-demand labels, and accessible hover/focus tooltips. Data comes from `zaruku_seo.map_city_demand` / Metrika `regionCity × /map`; bubble size is visits and the city ranking shows visits plus share of total map demand. Unresolved/non-Russian names are not assigned invented coordinates. This is only visits to `/map/`, not all geo traffic for the site.
    - Zaruku Quality tab source freshness is intentionally technical (`cron`, `collector`, `rows`). It must hide stale historical errors after a newer successful cron; show errors only when the latest failed/partial run is newer than or equal to the latest success.
    - pending / connected source contracts are documented in `ZARUKU-SEO-PENDING-SOURCES.md`: Yandex Metrika, Yandex Webmaster, GSC, SEO OS, and Alisa AI visibility are connected
    - `Cached page traffic` is treated as technical tail, not as a primary acquisition channel
    - User ID analytics are Abbott/Bitrix-specific and stay hidden for Zaruku
12. Zaruku SEO OS is connected as the `seo_os` source in the `serp` layer:
    - it provides weekly Yandex tracked positions, section coverage and position trends, opportunities, tasks, and pipeline run telemetry
    - section assignment is read from the authoritative `seo_section_patterns` dictionary
    - SEO OS does not replace Google Search Console or Yandex Webmaster ingestion for impressions, clicks, CTR, and complete query / URL search-console coverage
    - SEO task status `needs_target_page` is supported end to end in MySQL types, P4 counters, and task badges; approved opportunities without `target_url` must still create a task with this status
    - AI visibility for Zaruku is now covered by the Alisa AI snapshot in `seo_ai_visibility`
13. Gidrofuril dashboard investigation on 2026-07-13:
    - production DB row: `dashboards.id = 29`, `client_id = gidrofuril`, dashboard name `лето 2026`, period `2026-07-01` to `2026-09-15`
    - Hybrid advertiser discovery found `Gidrofuril` in both Hybrid credential slots and added them to `report_bd_tech.hyb_systems`:
      - account `1`: advertiser id `6a4793ff7d258333b061e6f4`
      - account `2`: advertiser id `6a479553585ccf4ec4e5a036`
    - Hybrid backfill for `2026-07-01..2026-07-12` succeeded and wrote canonical accounts, four campaigns, and facts; dashboard source `hybrid` is now bound to both account ids in `dashboard_sources.source_config.account_ids`
    - VK advertiser id `1090736542` was onboarded via VK `agency_client_credentials` token grant and saved into `report_bd_tech.vk_data` as `Гидруфурил`; VK backfill for `2026-07-01..2026-07-12` wrote one canonical account, four campaigns (`144220998`, `144479235`, `144486866`, `144755192`), and July facts; dashboard source `vk` is now bound to account id `1090736542`
    - `/admin/collection` is backed by canonical/source account discovery plus `canonical_source_account_collection_settings`; it cannot show gidrofuril until Hybrid/VK platform accounts are added to the collector tech tables and collected at least once
    - uploaded `планплатформы.xlsx` currently sits under a `manual_data` actual source, not a `media_plan` plan source, and `dashboard_media_plan_rows` / `media_plan_bindings` are empty for dashboard `29`
14. Media plan binding source selection:
    - `platform` / `instrument` in media plan rows remains the human/imported label and may contain values like `hybrid/between`; do not force it to a canonical source key
    - binding source correction is stored per row as `source_keys`, for example `["hybrid", "vk_ads_v2"]`
    - `WizardStepBinding` uses saved `source_keys` before falling back to imported `platform`; unknown imported values show no campaigns until a source is selected on the row
15. Zaruku returning content is canonical as of 2026-07-19. Legacy `yandex_metrika_returned` is no longer the product read model for Zaruku. Root collector `fetch_yandex_metrika_returning_canonical.py` writes `canonical_fact_metrika_returning_pages_daily` in `/root/reportingdash-canonical`; cron runs daily at `06:18` for counter `66624469` with `--backfill-days 3`. The Behavior tab panel `Возвратный контент` reads the canonical table and shows visits plus 1-day / 2–7-day / 8–31-day returning-user buckets. Quality/source freshness includes `yandex_metrika_returning`.
16. Zaruku GSC optional layers were connected on 2026-07-19. Migration `src/db/migrations/038_gsc_optional_search_layers.sql` creates `canonical_fact_gsc_search_appearance_daily` and `canonical_fact_gsc_search_type_daily`; root collector `fetch_gsc_canonical.py` fills them in the same daily run as the query table. Backfill run `1480` wrote result-type rows for `web`, `image`, and `video`; Search appearance returned 0 rows for Zaruku for `2026-07-01..2026-07-17`, so the dashboard intentionally shows the Search appearance empty-state.
17. Zaruku `Что ещё ждём` is a conditional panel: it must not render on Overview or Quality when `pending_requirements` is empty. The SERP label belongs only to real pending source requirements and must not appear as an empty connected-state card.

## Working rule for future dashboard tasks

When returning to dashboard work:
1. read `DASHBOARDS-MEMORY.md`
2. then inspect relevant files in `dashboard-next`
3. only after that inspect old chat history if still needed
