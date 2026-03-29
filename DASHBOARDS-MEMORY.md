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
  - not implemented

Current rule:
- until phase 2 bindings exist, Promopages must stay isolated as its own section and source path
- do not silently fold Promopages facts into ordinary paid-media plan/fact sections

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

## Working rule for future dashboard tasks

When returning to dashboard work:
1. read `DASHBOARDS-MEMORY.md`
2. then inspect relevant files in `dashboard-next`
3. only after that inspect old chat history if still needed
