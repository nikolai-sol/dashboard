# Zaruku Product Dashboard Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Zaruku SEO / GEO dashboard product-ready by ensuring every tab has clear business purpose, populated data or explicit empty-state reasons, trustworthy source freshness, and a first useful GSC enrichment layer.

**Architecture:** Keep API collectors and dashboard rendering separated. Existing canonical read models load Metrika, GSC, Yandex Webmaster, SEO OS, and AI facts. This pass extends only the Zaruku read models/types/components so the UI explains source state and derives new GSC views from already-collected `canonical_fact_gsc_queries_daily` rows.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, MySQL read models, existing production deploy scripts.

## Global Constraints

- Do not add new credentials or external API calls.
- Do not rewrite Abbott dashboard behavior.
- Do not delete legacy tables.
- Keep source freshness wording technical: use `cron`, `collector`, and `rows`.
- Treat GSC fresh-day zero rows as expected lag, not a data failure.
- Source connection status and latest collector freshness are separate signals.
- Preserve existing uncommitted user/agent changes; stage only files changed by the current task.

---

## File Structure

- Modify `src/lib/types.ts`: add GSC landing page and branded split DTOs under `ZarukuGscData`.
- Modify `src/lib/zaruku-gsc.ts`: aggregate GSC daily query facts into weekly landing pages and branded/non-branded summary.
- Modify `src/lib/zaruku-gsc.test.ts`: cover account scoping, landing page aggregation, branded split, and partial week behavior.
- Modify `src/components/ZarukuSeoDashboard.tsx`: render GSC landing pages and branded/non-branded summary with clear empty states.
- Modify `src/components/ZarukuSeoDashboard.ui.test.ts`: lock product copy and absence of misleading placeholders.
- Modify `src/lib/zaruku-seo.ts`: keep freshness notes honest by hiding stale historical errors after newer success.
- Modify `src/lib/zaruku-seo.test.ts`: lock source freshness status/notes.
- Modify `docs/superpowers/specs/2026-07-19-zaruku-product-dashboard-readiness-design.md` only if implementation reveals a spec mismatch.

---

### Task 1: Product Readiness Guardrails

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`
- Modify: `src/lib/zaruku-seo.test.ts`
- Modify: `src/lib/zaruku-seo.ts`

**Interfaces:**
- Consumes: `ZarukuSourceFreshnessRow` from `src/lib/types.ts`
- Produces: `normalizeSourceFreshnessRow(row, now)` that shows only active latest errors.

- [x] **Step 1: Write/update tests for product copy**

Add assertions:

```ts
test("pending and returning-content panels explain current state instead of showing misleading empty UI", () => {
  assert.match(source, /pending=\{data\.pending_requirements\.length > 0\}/);
  assert.doesNotMatch(source, /title="Что ещё ждём" layer="serp" pending right=/);
  assert.match(source, /Нет возвратного контента за выбранный период/);
});
```

- [x] **Step 2: Write/update source freshness stale-error test**

Add assertion:

```ts
test("normalizeSourceFreshnessRow hides older collector errors after a newer success", () => {
  const row = normalizeSourceFreshnessRow(
    {
      source_key: "yandex_metrika",
      source_label: "Яндекс Метрика",
      collector: "fetch_yandex_metrika_canonical.py",
      expected_frequency_hours: 24,
      last_status: "success",
      last_finished_at: "2026-07-19 06:12:26",
      last_success_at: "2026-07-19 06:12:26",
      success_date_from: "2026-07-17",
      success_date_to: "2026-07-18",
      success_rows_read: 30,
      success_rows_written: 3081,
      last_error_at: "2026-06-24 06:12:01",
      last_error_summary: "old frozen counter error",
    },
    new Date("2026-07-19T13:00:00Z"),
  );

  assert.equal(row.freshness_status, "healthy");
  assert.equal(row.last_error_at, null);
  assert.equal(row.last_error_summary, null);
});
```

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/components/ZarukuSeoDashboard.ui.test.ts src/lib/zaruku-seo.test.ts
```

Expected: PASS.

- [x] **Step 4: Implement/fix UI and freshness logic**

Ensure:

```tsx
<Panel data={data} title="Что ещё ждём" layer="serp" pending={data.pending_requirements.length > 0}>
```

and:

```ts
const activeErrorAt = hasNewerProblem ? lastErrorAt : null;
const activeErrorSummary = hasNewerProblem ? (row.last_error_summary ?? null) : null;
```

- [x] **Step 5: Re-run focused tests**

Run:

```bash
npm test -- src/components/ZarukuSeoDashboard.ui.test.ts src/lib/zaruku-seo.test.ts
```

Expected: PASS.

---

### Task 2: GSC Landing Pages And Brand Split Read Model

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/zaruku-gsc.ts`
- Modify: `src/lib/zaruku-gsc.test.ts`

**Interfaces:**
- Produces: `ZarukuGscLandingPageRow`
- Produces: `ZarukuGscBrandSplitRow`
- Produces fields under `ZarukuGscData`: `landing_pages`, `brand_split`

- [x] **Step 1: Write failing type/read-model tests**

Add tests:

```ts
test("loadGoogleSearchConsoleFacts derives landing pages from canonical query rows", async () => {
  const data = await loadGoogleSearchConsoleFacts(["66624469"], ["2026-W29"], async (query) => {
    if (query.sql.includes("GROUP BY week_key, page")) {
      return [{
        week_key: "2026-W29",
        page: "https://zaruku.ru/rak-molochnoj-zhelezy/",
        impressions: 100,
        clicks: 10,
        ctr: 10,
        average_position: 4.2,
        week_from: "2026-07-13",
        week_to: "2026-07-17",
        is_partial_week: 1,
      }];
    }
    if (query.sql.includes("brand_bucket")) {
      return [{
        week_key: "2026-W29",
        brand_bucket: "non_brand",
        impressions: 100,
        clicks: 10,
        ctr: 10,
        average_position: 4.2,
        week_from: "2026-07-13",
        week_to: "2026-07-17",
        is_partial_week: 1,
      }];
    }
    return [];
  });

  assert.equal(data.landing_pages[0].page, "https://zaruku.ru/rak-molochnoj-zhelezy/");
  assert.equal(data.brand_split[0].bucket, "non_brand");
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/lib/zaruku-gsc.test.ts
```

Expected: FAIL until new fields/functions exist.

- [x] **Step 3: Add DTOs**

Add to `src/lib/types.ts`:

```ts
export interface ZarukuGscLandingPageRow {
  week: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week: boolean;
}

export interface ZarukuGscBrandSplitRow {
  week: string;
  bucket: "brand" | "non_brand";
  impressions: number;
  clicks: number;
  ctr: number | null;
  average_position: number | null;
  week_from: string;
  week_to: string;
  is_partial_week: boolean;
}
```

- [x] **Step 4: Add read-model queries**

In `buildGscAccountQueries`, add:

```sql
SELECT
  YEARWEEK(report_date, 3) AS week_key,
  page,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks,
  CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) * 100 ELSE NULL END AS ctr,
  CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE NULL END AS average_position,
  MIN(report_date) AS week_from,
  MAX(report_date) AS week_to,
  MAX(CASE WHEN report_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS is_partial_week
FROM canonical_fact_gsc_queries_daily
WHERE analytics_account_id IN (...)
GROUP BY week_key, page
ORDER BY impressions DESC, clicks DESC
LIMIT 200
```

Add a second query with:

```sql
CASE
  WHEN LOWER(query) REGEXP 'zaruku|заруку|за руку|зараку' THEN 'brand'
  ELSE 'non_brand'
END AS brand_bucket
```

- [x] **Step 5: Normalize and return fields**

Add normalizers equivalent to query/summary rows:

```ts
export function normalizeGscLandingPageRow(row: GscLandingPageDbRow): ZarukuGscLandingPageRow {
  return {
    week: asString(row.week_key),
    page: asString(row.page),
    impressions: Math.round(asNumber(row.impressions)),
    clicks: Math.round(asNumber(row.clicks)),
    ctr: nullableNumber(row.ctr),
    average_position: nullableNumber(row.average_position),
    week_from: formatDateOnlyValue(row.week_from),
    week_to: formatDateOnlyValue(row.week_to),
    is_partial_week: Boolean(asNumber(row.is_partial_week)),
  };
}
```

- [x] **Step 6: Re-run focused tests**

Run:

```bash
npm test -- src/lib/zaruku-gsc.test.ts
```

Expected: PASS.

---

### Task 3: GSC Product Panels

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `data.gsc.landing_pages`
- Consumes: `data.gsc.brand_split`

- [x] **Step 1: Write UI tests**

Add source assertions:

```ts
test("SEO tab renders GSC product enrichment panels", () => {
  assert.match(source, /GSC landing pages/);
  assert.match(source, /GSC brand vs non-brand/);
  assert.match(source, /data\.gsc\.landing_pages/);
  assert.match(source, /data\.gsc\.brand_split/);
});
```

- [x] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: FAIL until panels exist.

- [x] **Step 3: Add small product panels**

Add:

```tsx
<Panel data={data} title="GSC landing pages" source="gsc" layer="serp">
  <GscLandingPagesTable rows={topGscLandingPages(gscLandingPages, 10)} locale={currentLocale} />
</Panel>
```

and:

```tsx
<Panel data={data} title="GSC brand vs non-brand" source="gsc" layer="serp">
  <GscBrandSplitTable rows={gscBrandSplit} locale={currentLocale} />
</Panel>
```

- [x] **Step 4: Add explicit empty states**

Tables must render:

```tsx
<td colSpan={5}>Нет GSC landing page facts для выбранной недели.</td>
```

and:

```tsx
<td colSpan={5}>Нет GSC branded/non-branded facts для выбранной недели.</td>
```

- [x] **Step 5: Re-run UI tests**

Run:

```bash
npm test -- src/components/ZarukuSeoDashboard.ui.test.ts
```

Expected: PASS.

---

### Task 4: Full Local Verification

**Files:**
- No source changes unless verification exposes a direct defect.

- [x] **Step 1: Run targeted Zaruku tests**

Run:

```bash
npm test -- src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-traffic-visibility.test.ts src/lib/zaruku-gsc.test.ts src/lib/zaruku-seo.test.ts src/lib/zaruku-yandex-webmaster.test.ts
```

Expected: all tests PASS.

- [x] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: build completes successfully.

- [x] **Step 3: Check local API shape through production domain**

Run:

```bash
curl -fsS "https://dashboards.adreports.ru/api/dashboard/zaruku?from=2026-07-01&to=2026-07-13" >/tmp/zaruku-dashboard.json
node -e 'const z=require("/tmp/zaruku-dashboard.json").zaruku_seo; console.log({gsc:z.gsc.status, landing:z.gsc.landing_pages?.length, brand:z.gsc.brand_split?.length, pending:z.pending_requirements.length})'
```

Expected: GSC status is `available`; pending is `0`; landing/brand arrays exist.

---

### Task 5: Deploy And Browser QA

**Files:**
- No source changes unless QA exposes a direct defect.

- [x] **Step 1: Deploy**

Run:

```bash
npm run deploy
```

Expected: release activated successfully. A transient `curl: (7)` immediately after PM2 restart can happen; verify health afterwards.

- [x] **Step 2: Verify health**

Run:

```bash
ssh beget 'curl -fsS http://127.0.0.1:3001/api/health'
curl -fsS https://dashboards.adreports.ru/api/health
```

Expected: both return `{"status":"ok","database":"connected"}`.

- [x] **Step 3: Browser QA**

Open:

```text
https://dashboards.adreports.ru/dashboard/zaruku?from=2026-07-01&to=2026-07-13
```

Verify:

- sidebar shows all expected sources connected;
- Overview pending panel says all sources connected when pending requirements are empty;
- SEO tab shows GSC facts, GSC queries, GSC landing pages, and GSC brand split;
- Content tab uses `A просмотры`, not `A визиты`;
- Behavior tab explains empty returning content;
- Quality tab shows Metrika, GSC, and Webmaster healthy after the 2026-07-19 collector guard for latest-day Webmaster URL lag.

## Completion Notes

- Dashboard release deployed and health-checked on 2026-07-19.
- GSC read model now exposes weekly summary, queries, landing pages, and brand/non-brand split from `canonical_fact_gsc_queries_daily`.
- Production API check for `2026-07-01..2026-07-13` returns `pending=0`, GSC `summary=3`, `queries=9113`, `landing_pages=200`, `brand_split=2`.
- Yandex Webmaster collector run `1477` completed successfully on 2026-07-19 with `rows_read=9121`, `rows_written=4705`.
- Yandex Webmaster latest-day URL analytics returns `RESTRICTIONS_VIOLATED` until Yandex opens the date window; collector now logs `webmaster_page_facts_skipped` and keeps query/summary import successful.

---

## Self-Review

- Spec coverage: all product principles and tab responsibilities map to Tasks 1–5.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation placeholders remain.
- Type consistency: new fields are named `landing_pages` and `brand_split` consistently across read model, DTO, and UI plan.
