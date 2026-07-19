# Zaruku Russia Demand Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-drawn Zaruku Russia map with a geographically projected, collision-controlled city demand map for `/map/` visits.

**Architecture:** A dedicated data module converts the locally bundled `world-atlas` Russia feature to GeoJSON and resolves normalized Metrika city names to longitude/latitude. A focused React component uses `@visx/geo` to project the country and markers, labels only the top five cities, and exposes all resolved marker values through accessible hover/focus tooltips.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@visx/geo` 4, `world-atlas` 2, `topojson-client` 3, Node test runner, Tailwind CSS.

## Global Constraints

- The map represents only visits whose start URL is under `zaruku.ru/map/`.
- No third-party runtime map request, tile service, geocoder, or API key.
- No fallback grid coordinates for unknown city names.
- At most five city labels remain permanently visible on the map.
- Keep the ranked city list beside the map with exact visits and share.

---

### Task 1: Geographic data and city resolution

**Files:**
- Create: `src/components/zaruku-russia-map-data.ts`
- Create: `src/components/zaruku-russia-map-data.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `RUSSIA_FEATURE`, `resolveRussiaCityCoordinates(city: string)`, and `selectRussiaDemandCities(rows, limit)`.
- Consumes: `ZarukuSeoMetricRow` from `src/lib/types.ts`.

- [ ] **Step 1: Write failing data tests**

Test that English and Russian city names resolve to exact `[longitude, latitude]`, non-Russian/unknown names return `null`, selected rows are sorted by visits, and only five rows receive `showLabel: true`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test src/components/zaruku-russia-map-data.test.ts`

Expected: FAIL because `zaruku-russia-map-data.ts` does not exist.

- [ ] **Step 3: Install geographic dependencies**

Run: `npm install @visx/geo@^4.0.0 world-atlas@^2.0.2 topojson-client@^3.1.0 && npm install --save-dev @types/topojson-client@^3.1.5`

- [ ] **Step 4: Implement the focused data module**

Import the local `countries-50m.json`, convert country id `643` with `topojson-client.feature`, normalize city names with lowercase/Unicode/space handling, and define coordinates for the Russian cities currently returned by Zaruku Metrika. Return no coordinates for unmatched names; never invent a display position.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --import tsx --test src/components/zaruku-russia-map-data.test.ts`

Expected: all data tests PASS.

### Task 2: Projected accessible map component

**Files:**
- Create: `src/components/ZarukuRussiaDemandMap.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `rows: ZarukuSeoMetricRow[]`, `locale: string`, `RUSSIA_FEATURE`, and `selectRussiaDemandCities`.
- Produces: default `ZarukuRussiaDemandMap` React component.

- [ ] **Step 1: Write failing UI contract tests**

Assert that the dashboard imports `ZarukuRussiaDemandMap`, the old `RussiaMapOutline`, manual percentage coordinates, and fallback grid are absent, and the new component uses `@visx/geo`, accessible marker buttons, top-five labels, a city tooltip, and the explicit `/map/` explanation.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: FAIL because the new component and import do not exist.

- [ ] **Step 3: Implement the projected map**

Render the Russia feature through a `NaturalEarth` projection fitted inside a stable SVG viewport. Render resolved markers with capped square-root radius scaling. Render text/leader lines only for the top five rows; use pointer and keyboard focus state to display city, visits, and share in an overlay tooltip for every marker.

- [ ] **Step 4: Replace the old inline implementation**

Delete `RUSSIA_CITY_COORDINATES`, `NON_RUSSIA_CITY_PATTERN`, `resolveRussiaCityPoint`, `RussiaMapOutline`, and `RussiaDemandBubbleMap` from `ZarukuSeoDashboard.tsx`. Import the focused component and preserve the existing `GeoTab` panel title/source/right label.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --import tsx --test src/components/zaruku-russia-map-data.test.ts src/components/ZarukuSeoDashboard.ui.test.ts`

Expected: all focused tests PASS.

### Task 3: Product verification and deployment

**Files:**
- Modify: `DASHBOARDS-MEMORY.md`
- Modify: `AGENTS.md` only if the source/runtime contract changes.

**Interfaces:**
- Consumes: completed map component and production Zaruku dashboard.
- Produces: verified build and deployed dashboard release.

- [ ] **Step 1: Update dashboard memory**

Record that Geo uses local Russia geometry, real city coordinates, five permanent labels, accessible tooltip details, and only `/map/` entrance visits.

- [ ] **Step 2: Run complete automated verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: zero test failures, TypeScript exit 0, Next.js build exit 0.

- [ ] **Step 3: Run local browser QA**

Open the Zaruku dashboard with Playwright, select `Гео`, and verify the country outline, city separation, five permanent labels, tooltip accessibility, ranking values, and readable layout at desktop width.

- [ ] **Step 4: Commit and deploy**

Commit the implementation, run `npm run deploy`, then verify PM2 and both local/public health endpoints.

- [ ] **Step 5: Run production browser QA**

Open the deployed dashboard with Playwright and repeat the Geo-tab checks against production data.
