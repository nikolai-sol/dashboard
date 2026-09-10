# Site SEO Zaruku Visual Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the profile-driven apps/site-seo dashboard, including MedRoche, visually match the published Zaruku dashboard language without coupling its code, data or runtime to Zaruku.

**Architecture:** Add a server-rendered neutral shell and presentational primitives local to apps/site-seo. The selected tab is a validated display-only tab query parameter; the existing server page continues to load canonical MySQL data and renders only its selected section as a slot. Existing period/filter/export requests retain their contract unchanged.

**Tech Stack:** Next.js App Router, React server components, TypeScript, local CSS, Node test runner with tsx.

## Global Constraints

- Dashboard render, filter and export paths read canonical MySQL only; no source API/OAuth calls.
- Do not add Tailwind, Lucide or a client data-fetching layer.
- Do not import any zaruku path, selector, payload type, copy, route, asset prefix or runtime setting.
- Keep apps/site-seo/src/lib, API/export handlers, DB/schema, registry/bindings and deploy identity unchanged.
- Keep ready, partial, complete_empty, missing and failed distinct.
- tab affects presentation only and must not alter source scope, publication, period or exports.
- Use apps/site-seo local CSS and neutral names only; profile supplies brand identity and tab availability.

---

## File Structure

- apps/site-seo/src/components/DashboardPrimitives.tsx: neutral panel, KPI, status and scrollable table primitives.
- apps/site-seo/src/components/SiteSeoShell.tsx: profile-labelled rail/mobile tab navigation and one server-rendered active slot.
- apps/site-seo/src/components/Traffic.tsx: existing inline traffic body, separated so Dashboard only composes sections.
- apps/site-seo/src/components/Dashboard.tsx: tab selection, shell composition, profile-driven registration and export links.
- apps/site-seo/src/components/{Overview,Search,Wordstat,Alice,SeoOs,Sources,PeriodSelector,LoginForm}.tsx: use neutral primitives and semantic class names without changing data semantics.
- apps/site-seo/src/app/dashboard/[siteSlug]/page.tsx: forward display-only tab, render consistent neutral login/unavailable shell.
- apps/site-seo/src/app/globals.css: scoped visual tokens, responsive shell, panel/table/status styles.
- apps/site-seo/tests/{dashboard,styles,visual-shell}.test.ts: SSR and CSS contracts.

### Task 1: Neutral visual primitives and CSS contract

**Files:**
- Create: apps/site-seo/src/components/DashboardPrimitives.tsx
- Modify: apps/site-seo/src/app/globals.css
- Modify: apps/site-seo/tests/styles.test.ts
- Test: apps/site-seo/tests/visual-shell.test.ts

**Interfaces:**
- Produces Panel({ title, subtitle?, state?, children }), KpiStrip({ children }), Kpi({ label, value, detail? }), TableFrame({ label, children }) and StatusBadge({ state }).
- All components accept already-rendered ReactNode; none imports a read model, profile, fetcher or route helper.

- [ ] **Step 1: Write the failing primitive/CSS tests**

~~~
test("neutral primitives expose a panel header and an accessible table frame", () => {
  const html = renderToStaticMarkup(createElement(Panel, { title: "Трафик" }, "body"));
  assert.match(html, /site-seo-panel/);
  assert.match(html, /<h2[^>]*>Трафик<\/h2>/);
  assert.match(renderToStaticMarkup(createElement(TableFrame, { label: "Страницы" }, "rows")), /role="region"/);
});
test("local stylesheet defines the responsive neutral shell contract", () => {
  const css = readFileSync(path.join(appRoot, "src/app/globals.css"), "utf8");
  assert.match(css, /\.site-seo-shell\s*\{/);
  assert.match(css, /\.site-seo-rail\s*\{/);
  assert.match(css, /\.site-seo-table-frame\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*767px\)/);
  assert.doesNotMatch(css, /zaruku/i);
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --import tsx --test apps/site-seo/tests/styles.test.ts apps/site-seo/tests/visual-shell.test.ts

Expected: FAIL because DashboardPrimitives.tsx, the new selectors and visual-shell.test.ts do not yet exist.

- [ ] **Step 3: Write minimal implementation**

~~~
export function Panel({ title, subtitle, children }: Readonly<{ title: string; subtitle?: string; children: ReactNode }>) {
  return <section className="site-seo-panel"><header className="site-seo-panel-header"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header><div className="site-seo-panel-body">{children}</div></section>;
}
export function TableFrame({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <div className="site-seo-table-frame" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
~~~

Implement KpiStrip, Kpi and StatusBadge with the same neutral site-seo-* convention. Replace broad main, section, nav and table styling with those class selectors. Define the 1600px shell, 240px rail, mobile horizontal tab strip, slate/teal/status tokens, panel header/body spacing, focus-visible, table overflow and reduced-motion rule in the local stylesheet.

- [ ] **Step 4: Run test to verify it passes**

Run: node --import tsx --test apps/site-seo/tests/styles.test.ts apps/site-seo/tests/visual-shell.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add apps/site-seo/src/components/DashboardPrimitives.tsx apps/site-seo/src/app/globals.css apps/site-seo/tests/styles.test.ts apps/site-seo/tests/visual-shell.test.ts
git commit -m "feat(site-seo): add neutral dashboard visual primitives"
~~~

### Task 2: Profile-driven shell and selected-tab composition

**Files:**
- Create: apps/site-seo/src/components/SiteSeoShell.tsx
- Create: apps/site-seo/src/components/Traffic.tsx
- Modify: apps/site-seo/src/components/Dashboard.tsx
- Modify: apps/site-seo/src/components/PeriodSelector.tsx
- Modify: apps/site-seo/tests/dashboard.test.ts
- Modify: apps/site-seo/tests/visual-shell.test.ts

**Interfaces:**
- Consumes DashboardTab, buildDashboardQuery, the existing read model and all existing section components.
- SiteSeoShell receives { title, domain?, logoAsset?, tabs, activeTab, tabHref, toolbar, exports, children }; it receives no DashboardReadModel or credentials.
- Dashboard accepts optional activeTab?: string; unknown/disabled values resolve to the first dashboardTabs(profile) id.

- [ ] **Step 1: Write the failing selected-tab and query-preservation tests**

~~~
test("renders one enabled active tab in the neutral shell and preserves scope query", () => {
  const html = renderToStaticMarkup(createElement(Dashboard, { ...fixtureProps, activeTab: "search" }));
  assert.match(html, /site-seo-shell/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /tab=search/);
  assert.match(html, /traffic_week=2026-W01/);
  assert.match(html, /filter_country=RU/);
  assert.doesNotMatch(html, /id="wordstat"/);
});
test("falls back from an unknown or disabled tab to overview", () => {
  assert.equal(resolveActiveTab(dashboardTabs(profile), "wordstat"), "overview");
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --import tsx --test apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts

Expected: FAIL because no shell, activeTab, resolveActiveTab or tab link contract exists.

- [ ] **Step 3: Write minimal implementation**

~~~
export function resolveActiveTab(tabs: readonly DashboardTab[], requested?: string): string {
  return tabs.some((tab) => tab.id === requested) ? requested! : tabs[0]!.id;
}
const query = buildDashboardQuery(selection, publicationId, filters);
const tabHref = (id: string) => "?" + query + "&tab=" + encodeURIComponent(id);
const activeTab = resolveActiveTab(tabs, requestedTab);
~~~

Move the existing Metrika traffic JSX exactly into Traffic.tsx, wrapping its summary and tables with Panel, KpiStrip, Kpi and TableFrame. Compose only the selected source-enabled section in Dashboard; do not change its metrics, source states, period labels or export URLs. Restyle PeriodSelector with local classes while retaining the exact input names and hidden publication/filter fields.

- [ ] **Step 4: Run dashboard and type checks**

Run: npm run test:site-seo && npm run typecheck:site-seo

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add apps/site-seo/src/components/SiteSeoShell.tsx apps/site-seo/src/components/Traffic.tsx apps/site-seo/src/components/Dashboard.tsx apps/site-seo/src/components/PeriodSelector.tsx apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts
git commit -m "feat(site-seo): add profile-driven dashboard shell"
~~~

### Task 3: Panelize remaining sections and consistent state pages

**Files:**
- Modify: apps/site-seo/src/components/{Overview,Search,Wordstat,Alice,SeoOs,Sources,LoginForm}.tsx
- Modify: apps/site-seo/src/app/dashboard/[siteSlug]/page.tsx
- Modify: apps/site-seo/tests/dashboard.test.ts
- Modify: apps/site-seo/tests/visual-shell.test.ts

**Interfaces:**
- Consumes Task 1 Panel, KpiStrip, Kpi, TableFrame, StatusBadge.
- Produces presentationally consistent sections while retaining all existing component props and source-state copy.

- [ ] **Step 1: Write the failing state and table-frame tests**

~~~
test("source sections retain each canonical state inside visual panels", () => {
  for (const state of ["missing", "failed", "partial", "complete_empty"] as const) {
    const html = renderState(state);
    assert.match(html, /site-seo-panel/);
    assert.match(html, expectedStateCopy[state]);
  }
});
test("wide factual tables use a labelled local scroll frame", () => {
  const html = renderSearchFixture();
  assert.match(html, /site-seo-table-frame/);
  assert.match(html, /aria-label="Динамика GSC"/);
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --import tsx --test apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts

Expected: FAIL until the existing raw sections use the neutral primitives.

- [ ] **Step 3: Write minimal implementation**

~~~
return <Panel title="Поиск и индексация"><KpiStrip><Kpi label="GSC" value={model.gsc.meta.state} /><Kpi label="Индексация" value={model.indexing.state} /></KpiStrip><TableFrame label="Динамика GSC"><table className="site-seo-table"><thead><tr><th>Дата</th><th>Клики</th><th>Показы</th></tr></thead><tbody>{model.gsc.daily.map((row) => <tr key={row.date}><th>{row.date}</th><td>{row.metrics.clicks}</td><td>{row.metrics.impressions}</td></tr>)}</tbody></table></TableFrame></Panel>;
~~~

Use StatusBadge for the existing state values and retain the current Russian missing/failed/partial/confirmed-empty text verbatim. Convert every factual table to a semantic thead plus tbody inside TableFrame; do not create metrics absent from the read model. Make login and canonical-read-unavailable responses use a centred site-seo-state-card but keep the existing scoped LoginForm post URL and generic unavailable copy.

- [ ] **Step 4: Run complete local verification**

Run: npm run test:site-seo && npm run typecheck:site-seo && npm --workspace apps/site-seo run build -- --site medroche

Expected: all commands exit 0; the build produces only the isolated MedRoche artifact.

- [ ] **Step 5: Commit**

~~~
git add apps/site-seo/src/components apps/site-seo/src/app/dashboard/'[siteSlug]'/page.tsx apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts
git commit -m "feat(site-seo): align sections with neutral dashboard panels"
~~~

### Task 4: Profile-isolation and artifact regression

**Files:**
- Modify: apps/site-seo/tests/dashboard.test.ts
- Modify: apps/site-seo/tests/visual-shell.test.ts
- Test: scripts/site-seo-artifact-policy.test.mjs

**Interfaces:**
- Consumes the current MedRoche profile and the existing second synthetic profile fixture.
- Produces proof that visual changes are profile-driven and artifact-safe.

- [ ] **Step 1: Write the failing two-profile and forbidden-marker tests**

~~~
test("two profiles share a shell but not identity or disabled tabs", () => {
  assert.match(renderProfile(medroche), /MedRoche/);
  assert.match(renderProfile(secondSite), /Вторая клиника/);
  assert.doesNotMatch(renderProfile(secondSite), /MedRoche/);
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --import tsx --test apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts && node --test scripts/site-seo-artifact-policy.test.mjs

Expected: FAIL until the fixtures assert profile identity and the completed source has no forbidden marker.

- [ ] **Step 3: Add only regression assertions**

Add fixture render assertions for title/domain/logo fallback, source-driven tabs and absence of zaruku in generic source. Do not change profiles, bindings, runtime manifests or artifact-policy implementation unless an assertion reveals a real pre-existing false negative.

- [ ] **Step 4: Run final candidate verification**

Run: npm run test:site-seo && npm run typecheck:site-seo && node --test scripts/site-seo-artifact-policy.test.mjs && npm --workspace apps/site-seo run build -- --site medroche

Expected: all commands exit 0; git diff --name-only contains no apps/zaruku, deploy/zaruku, collector, DB, runtime or release changes.

- [ ] **Step 5: Commit and checkpoint**

~~~
git add apps/site-seo/tests/dashboard.test.ts apps/site-seo/tests/visual-shell.test.ts docs/superpowers/specs/2026-09-10-site-seo-zaruku-visual-parity-design.md docs/superpowers/plans/2026-09-10-site-seo-zaruku-visual-parity.md
git commit -m "test(site-seo): verify visual profile isolation"
git rev-parse HEAD
~~~

Record the resulting SHA and exact command exit codes in the MedRoche implementation checkpoint. Do not publish or activate a runtime as part of this plan.

## Self-review

- Spec coverage: Tasks 1–3 implement each visual contract item; Task 4 proves profile isolation and artifact boundaries.
- No data, API, auth, collector, deployment or Zaruku file is changed by any task.
- Later tasks use only Panel, KpiStrip, Kpi, TableFrame, StatusBadge, SiteSeoShell, resolveActiveTab and Traffic defined earlier.
