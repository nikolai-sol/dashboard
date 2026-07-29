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

- Main dashboard repo: `/Users/nicko/ReportingDash/dashboard-next`
- Production app path on VPS: `/var/www/dashboard`
- Public domain: `https://dashboards.adreports.ru`
- Process manager: `PM2`
- Local bind on VPS: `127.0.0.1:3001`

Deploy:

```bash
cd /Users/nicko/ReportingDash/dashboard-next
npm run deploy
```

Health:

```bash
curl -s https://dashboards.adreports.ru/api/health
ssh beget 'curl -s http://127.0.0.1:3001/api/health'
```

## Current dashboard architecture

### Shared data loader

- Core runtime is built in:
  - `/Users/nicko/ReportingDash/dashboard-next/src/lib/dashboard-data-loader.ts`
- Public API route uses the shared loader:
  - `/Users/nicko/ReportingDash/dashboard-next/src/app/api/dashboard/[id]/route.ts`
- Excel export uses the same loader:
  - `/Users/nicko/ReportingDash/dashboard-next/src/app/api/dashboard/[id]/excel/route.ts`
- PDF export renders the public dashboard page in `pdf=true` mode:
  - `/Users/nicko/ReportingDash/dashboard-next/src/app/api/dashboard/[id]/pdf/route.ts`

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
- `/Users/nicko/ReportingDash/dashboard-next/src/components/admin/DashboardWizard.tsx`

## Dashboard auth model

### Admin auth

- `/admin/*` requires admin login
- Current admin login is configured in env-backed auth flow

### Viewer auth

- Per-dashboard viewer users are supported
- If a dashboard has viewer users, public API / Excel / PDF require viewer auth
- Viewer portal root page exists at:
  - `https://dashboards.adreports.ru/`
- Root page shows:
  - login
  - list of dashboards available to the viewer
- Viewer logout must redirect to `/`

Relevant files:
- `/Users/nicko/ReportingDash/dashboard-next/src/app/page.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/ViewerPortalLogin.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/app/api/viewer-portal/login/route.ts`
- `/Users/nicko/ReportingDash/dashboard-next/src/app/api/viewer-portal/logout/route.ts`
- `/Users/nicko/ReportingDash/dashboard-next/src/app/api/dashboard-auth/login/route.ts`

### Embed auth

- Embedded dashboard auth must not rely only on first-party cookies
- Viewer login flow was extended with `access_token` handling for iframe use
- Viewer cookies were switched to iframe-compatible mode:
  - `SameSite=None`
  - `Secure`

## Embed rules

- Public dashboard pages are allowed in iframe on Bayesly domains
- Admin pages must not be embeddable
- Current embed uses:
  - `https://dashboards.adreports.ru/dashboard/<id>`

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
- `/Users/nicko/ReportingDash/dashboard-next/src/components/ComparisonToggle.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/ComparisonSection.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/app/dashboard/[id]/page.tsx`

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
- `/Users/nicko/ReportingDash/dashboard-next/src/app/dashboard/[id]/page.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/PlanVsFact.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/ChannelPerformanceTable.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/PlatformPlanVsFact.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/PlatformTable.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/TrendChart.tsx`
- `/Users/nicko/ReportingDash/dashboard-next/src/components/ComparisonSection.tsx`

## Latest dashboard changes already completed

Recent completed changes that should not be rediscovered:

0. PostClick Analytics spend / CPM / CPC now respect `spend_source = media_plan_derived`: row totals use normalized media plan budget for the selected period, daily rows distribute that budget by actual spend share, and campaign drilldown spend is scaled consistently. PostClick rows are based on the full media plan / Plan-Fact channel set, so channels without UTM bindings still appear with zero post-click traffic and available ad/budget metrics. KPI spend for `media_plan_derived` dashboards uses the same media plan `budget_plan` total as PostClick, not derived Plan/Fact `budget_fact`. PostClick counter columns now display full integer values with separators instead of compact K/M notation, so visual checks use the same full values as calculations. Media Plan Editor recalculates `budget_plan` and derived CPM/CPC/CPV/CPA when unit price, buy type, units, or planned metric volumes change.
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
11. Zaruku dashboard (`dashboard_type = zaruku_bi`, production dashboard id `28`) now uses a dedicated SEO/GEO UI, not the Abbott BI UI. The data path is `dashboard-next/src/lib/zaruku-seo.ts` and the renderer is `dashboard-next/src/components/ZarukuSeoDashboard.tsx`; API payload is `zaruku_seo`. Connected sources include Yandex Metrika (`66624469`) with canonical traffic/page facts plus live Metrika API cuts, Yandex Webmaster canonical summary/query/page facts, Google Search Console canonical query/page/country/device facts plus optional Search appearance / result type layers, SEO OS, and Alisa AI visibility. `Cached page traffic` is technical tail, not a primary acquisition channel; User ID analytics remain Abbott/Bitrix-specific and hidden for Zaruku.
12. Zaruku SEO OS is connected as the `seo_os` source in the `serp` layer. It supplies weekly Yandex tracked positions, section coverage and position trends, opportunities, tasks, and pipeline run telemetry. The authoritative section dictionary is `seo_section_patterns`. SEO OS does not replace Google Search Console or Yandex Webmaster ingestion for impressions, clicks, CTR, and complete query / URL search-console coverage; those search-console facts are now connected through their canonical collectors. DataForSEO / extra AI visibility sources remain separate optional future sources.
13. Zaruku Geo tab now avoids duplicate country/city bar lists. It renders one product panel, `Карта спроса по России`, using `@visx/geo`, local `world-atlas` Russia geometry, real city longitude/latitude, collision-separated bubbles with leader lines to geographic anchors, five persistent top-demand labels, and accessible hover/focus tooltips. It is backed by `zaruku_seo.map_city_demand` from Metrika `regionCity × /map`; bubble size is visits and the city ranking shows visits plus share of total map demand. Unresolved/non-Russian names receive no invented map position. Important product wording: this is only visits to the `/map/` organization-map section, not all geo traffic for the site.
14. Zaruku returning content is canonical as of 2026-07-19. Legacy `yandex_metrika_returned` is no longer the product read model for Zaruku. Root collector `fetch_yandex_metrika_returning_canonical.py` writes `canonical_fact_metrika_returning_pages_daily` in `/root/reportingdash-canonical`; cron runs daily at `06:18` for counter `66624469` with `--backfill-days 3`. The Behavior tab panel `Возвратный контент` reads the canonical table and shows visits plus 1-day / 2–7-day / 8–31-day returning-user buckets. Quality/source freshness includes `yandex_metrika_returning`.
15. Abbott release returning facts are isolated in `canonical_fact_metrika_returning_pages_release_daily`. Embed uses the aggregate-only `abbott_embed_reader_role` and `ABBOTT_EMBED_DB_*=report_bd`; manager uses separate `ABBOTT_PRIVATE_DB_*=report_bd_private` credentials.
15. Zaruku GSC enrichment now includes `country_summary`, device summary, landing pages, brand/non-brand, Search appearance, and result type panels. `country_summary`, device, landing pages, and brand/non-brand are dashboard-side SQL aggregations from `canonical_fact_gsc_queries_daily`. Search appearance is collected into `canonical_fact_gsc_search_appearance_daily`; result/search type is collected into `canonical_fact_gsc_search_type_daily` by root collector `fetch_gsc_canonical.py`. Backfill run `1480` on 2026-07-19 wrote result-type rows for `web`, `image`, and `video`; Search appearance returned 0 rows for Zaruku for `2026-07-01..2026-07-17`, so the dashboard shows an empty-state there.
16. Exact Yandex Webmaster query→page facts are collected only from standard Query Analytics with an exact URL filter and stored in `canonical_fact_webmaster_query_pages_daily`; separate query/page totals and representative complementary URLs are forbidden as pair sources. Migration `045` and manual run `1715` are live, but dashboard commit `833db89` is not deployed while Abbott release `10` remains staging. The weekly `03:20 UTC` cron is also deferred until production SEO smoke passes.

## Working rule for future dashboard tasks

When returning to dashboard work:
1. read `DASHBOARDS-MEMORY.md`
2. then inspect relevant files in `dashboard-next`
3. only after that inspect old chat history if still needed
