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

### Embed auth

- Embedded dashboard auth must not rely only on first-party cookies
- Viewer login flow was extended with `access_token` handling for iframe use
- Viewer cookies were switched to iframe-compatible mode:
  - `SameSite=None`
  - `Secure`
- Abbott also supports a permanent embed query key:
  - `embed_key`
  - current shared key source:
    - `process.env.ABBOTT_DASHBOARD_EMBED_KEY`
    - fallback default: `Terasic1!`
  - this is intended for iframe embedding without expiring `access_token`

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
    - current connected source is Yandex Metrika: canonical traffic/page facts plus live Metrika API cuts for search engines, phrases, organic landings, devices, geo, browser/OS, inferred age/gender/interests
    - pending sources are documented in `ZARUKU-SEO-PENDING-SOURCES.md`: Google Search Console, Yandex Webmaster, DataForSEO / AI visibility
    - `Cached page traffic` is treated as technical tail, not as a primary acquisition channel
    - User ID analytics are Abbott/Bitrix-specific and stay hidden for Zaruku
12. Zaruku SEO OS is connected as the `seo_os` source in the `serp` layer:
    - it provides weekly Yandex tracked positions, section coverage and position trends, opportunities, tasks, and pipeline run telemetry
    - section assignment is read from the authoritative `seo_section_patterns` dictionary
    - SEO OS does not replace pending Google Search Console or Yandex Webmaster ingestion for impressions, clicks, CTR, and complete query / URL search-console coverage
    - DataForSEO / AI visibility remains pending

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

## Working rule for future dashboard tasks

When returning to dashboard work:
1. read `DASHBOARDS-MEMORY.md`
2. then inspect relevant files in `dashboard-next`
3. only after that inspect old chat history if still needed
