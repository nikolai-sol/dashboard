# Abbott Runtime Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing Abbott dashboard, its read API, exports, and administrator User ID exclusion control into an independently built and released Next.js runtime on port 3004 without changing its public URLs, data, access rules, or visible behavior.

**Architecture:** Add a focused `apps/abbott` application that reuses only the Abbott-specific UI/data modules and a small dashboard-ownership contract. Keep the combined application on port 3001 as the owner of login and administration, keep canonical MySQL and collectors shared, and route only exact Abbott paths plus `/_next-abbott/` to port 3004 after direct-port parity succeeds. Preserve the combined Abbott implementation as the first-rollout rollback target.

**Tech Stack:** Next.js 16.1.6, React 19.2.3, TypeScript, Node test runner, esbuild dependency-graph tests, MySQL 8, ExcelJS/XLSX, Puppeteer, PM2, Nginx, immutable release directories.

## Global Constraints

- Implement only in `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation` on branch `codex/abbott-runtime-isolation` based on production revision `8f389a28df1c4b741ec33b7538f0354b74f5a40e`.
- Do not modify the Zaruku runtime, MedRoche runtime, advertising dashboard behavior, collectors, cron, canonical schemas, active releases, facts, or historical data.
- Preserve public page aliases `/dashboard/18` and `/dashboard/abbott` and all matching Abbott API/export aliases.
- Keep `/api/dashboard-auth/login`, `/admin/**`, `/api/admin/**`, and shared-password rotation on the combined runtime at port 3001.
- Run Abbott on loopback port `3004` with static assets under `/_next-abbott/` and process name `dashboard-abbott`.
- Dashboard requests read canonical MySQL only; no source API or OAuth token is allowed in request, render, filter, or export code.
- Manager reads use `ABBOTT_PRIVATE_DB_*`; embed reads use `ABBOTT_EMBED_DB_*`; embed responses never contain manager-only User IDs, visit IDs, journeys, or private URLs.
- The first cutover retains the combined Abbott implementation for route-only rollback.
- The parity period is `2026-09-01..2026-09-13`; visual truth is `/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14`.
- The existing 13 chart-size warnings are baseline behavior; do not change or classify them as a new regression.
- No UI redesign, label change, metric change, new tab, new filter, new export column, shared-component refactor, or password rotation is part of this plan.
- Never commit `.env`, viewer cookies, access tokens, raw exports, screenshots, workbooks, logs, or private database rows.

## File Structure

### New application boundary

- `apps/abbott/package.json` — Abbott-only build, start, artifact verification, and direct smoke commands.
- `apps/abbott/next.config.js` — standalone build, `.next-abbott`, and `/_next-abbott` asset prefix.
- `apps/abbott/tsconfig.json` — root Abbott module aliases and runtime-contract alias.
- `apps/abbott/src/app/layout.tsx`, `globals.css` — isolated document shell and current shared visual tokens.
- `apps/abbott/src/app/dashboard/[id]/page.tsx` — page entry for only `18` and `abbott`.
- `apps/abbott/src/app/api/dashboard/[id]/**/route.ts` — Abbott JSON, PDF, Excel, and administrator User ID endpoints.
- `apps/abbott/src/app/api/health/route.ts` — direct-port database health response with `scope: "abbott"`.
- `apps/abbott/src/components/AbbottDashboardPage.tsx` — focused copy of the current Abbott page state machine; no advertising or SEO branches.
- `apps/abbott/src/lib/abbott-route-access.ts` — alias normalization, identity ownership, and fail-closed authorization.
- `apps/abbott/src/lib/abbott-dashboard-loader.ts` — Abbott-only dashboard metadata/source lookup followed by canonical Abbott loading.
- `apps/abbott/src/lib/abbott-json-handler.ts`, `abbott-pdf-handler.ts`, `abbott-excel-handler.ts` — focused request handlers.

### Shared deployment contract

- `packages/runtime-contract/src/index.ts`, `manifest.mjs` — immutable runtime ownership and Abbott release authority.
- `scripts/runtime-artifact-policy.mjs` — scope-bound standalone artifact inspection/stamping.
- `scripts/deploy-runtime.mjs`, `deploy-runtime.sh` — fixed-manifest immutable release installer.
- `scripts/deploy-abbott.sh`, `rollback-abbott.sh` — Abbott-only entry points with no caller-supplied authority.
- `deploy/abbott/release.json`, `repository.json`, `ecosystem.config.cjs`, `start.cjs` — port/process/repository/env authority.
- `deploy/abbott/nginx-routes.conf` — exact route fragment used for audited cutover.
- `scripts/verify-abbott-nginx-routes.mjs` — route-set and upstream isolation validator.
- `scripts/compare-abbott-runtime.mjs` — redacted JSON/Excel/tab parity report for the fixed baseline period.
- `scripts/capture-abbott-runtime.mjs` — six candidate screenshots matching the private baseline dimensions.

### Existing code touched minimally

- `package.json`, `package-lock.json`, `.gitignore` — npm workspaces, Abbott commands, and build-output exclusion.
- `src/lib/abbott-dashboard-loader.ts` — shared Abbott-only canonical loader implementation used by both runtimes during the transition.
- `src/lib/dashboard-data-loader.ts` — replace only its current inline Abbott branch with the focused loader; Zaruku and advertising branches remain byte-for-byte otherwise.
- `docs/runbooks/abbott-runtime-cutover.md` — exact shadow, cutover, rollback, and evidence commands.

---

### Task 1: Add the immutable Abbott runtime contract and workspace shell

**Files:**
- Create: `packages/runtime-contract/package.json`
- Create: `packages/runtime-contract/src/index.ts`
- Create: `packages/runtime-contract/src/index.test.ts`
- Create: `packages/runtime-contract/src/manifest.mjs`
- Create: `apps/abbott/package.json`
- Create: `apps/abbott/next.config.js`
- Create: `apps/abbott/tsconfig.json`
- Create: `apps/abbott/next-env.d.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: production constants from the approved design.
- Produces: `resolveDashboardFamily(identity)`, `runtimeOwnsDashboard(scope, identity)`, `runtimeOwnsPath(scope, pathname)`, `normalizeAbbottIdentifier(identifier)`, and `RUNTIME_MANIFESTS.abbott`.

- [ ] **Step 1: Write ownership tests that include both Abbott aliases and reject other dashboards**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_MANIFESTS,
  normalizeAbbottIdentifier,
  runtimeOwnsPath,
} from "./index";

test("Abbott aliases normalize to the canonical slug", () => {
  assert.equal(normalizeAbbottIdentifier("18"), "abbott");
  assert.equal(normalizeAbbottIdentifier("abbott"), "abbott");
  assert.equal(normalizeAbbottIdentifier("28"), null);
  assert.equal(normalizeAbbottIdentifier("zaruku"), null);
});

test("Abbott runtime owns only approved page and API paths", () => {
  for (const path of [
    "/dashboard/18", "/dashboard/18/", "/dashboard/abbott", "/dashboard/abbott/",
    "/api/dashboard/18", "/api/dashboard/18/pdf", "/api/dashboard/18/excel",
    "/api/dashboard/18/abbott-admin-users", "/api/dashboard/abbott",
    "/api/dashboard/abbott/pdf", "/api/dashboard/abbott/excel",
    "/api/dashboard/abbott/abbott-admin-users",
  ]) assert.equal(runtimeOwnsPath("abbott", path), true, path);

  for (const path of [
    "/dashboard/28", "/dashboard/zaruku", "/dashboard/17",
    "/api/dashboard/18/unknown", "/api/dashboard-auth/login", "/admin",
  ]) assert.equal(runtimeOwnsPath("abbott", path), false, path);
});

test("Abbott release authority is immutable", () => {
  assert.deepEqual(RUNTIME_MANIFESTS.abbott, {
    scope: "abbott",
    releaseBranch: "release/abbott",
    appName: "dashboard-abbott",
    port: 3004,
    appDir: "/var/www/dashboard-abbott",
    lockDir: "/var/www/.dashboard-abbott-deploy.lock",
    assetPrefix: "/_next-abbott",
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the contract does not exist yet**

Run: `node --import tsx --test packages/runtime-contract/src/index.test.ts`

Expected: FAIL because `packages/runtime-contract/src/index.ts` does not exist.

- [ ] **Step 3: Implement the exact route ownership contract**

```ts
export type DashboardRuntimeScope = "combined" | "advertising" | "zaruku" | "abbott";
export type DashboardFamily = Exclude<DashboardRuntimeScope, "combined">;
export type DashboardIdentity = { clientId: string; dashboardType: string };

export { RUNTIME_MANIFESTS } from "./manifest.mjs";

const ABBOTT_PATHS = new Set([
  "/dashboard/18", "/dashboard/18/", "/dashboard/abbott", "/dashboard/abbott/",
  "/api/dashboard/18", "/api/dashboard/18/pdf", "/api/dashboard/18/excel",
  "/api/dashboard/18/abbott-admin-users", "/api/dashboard/abbott",
  "/api/dashboard/abbott/pdf", "/api/dashboard/abbott/excel",
  "/api/dashboard/abbott/abbott-admin-users",
]);

export function normalizeAbbottIdentifier(identifier: string): "abbott" | null {
  const value = identifier.trim().toLowerCase();
  return value === "18" || value === "abbott" ? "abbott" : null;
}

export function resolveDashboardFamily(identity: DashboardIdentity): DashboardFamily {
  const clientId = identity.clientId.trim().toLowerCase();
  if (clientId === "zaruku" || identity.dashboardType === "zaruku_bi") return "zaruku";
  if (clientId === "abbott" || identity.dashboardType === "abbott_bi") return "abbott";
  return "advertising";
}

export function runtimeOwnsDashboard(scope: DashboardRuntimeScope, identity: DashboardIdentity): boolean {
  return scope === "combined" || scope === resolveDashboardFamily(identity);
}

export function runtimeOwnsPath(scope: DashboardRuntimeScope, pathname: string): boolean {
  if (scope === "combined") return true;
  if (ABBOTT_PATHS.has(pathname)) return scope === "abbott";
  if (pathname === "/dashboard/zaruku" || pathname.startsWith("/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/api/dashboard/zaruku" || pathname.startsWith("/api/dashboard/zaruku/")) return scope === "zaruku";
  return scope === "advertising";
}
```

`packages/runtime-contract/src/manifest.mjs` must export a frozen `abbott` object with the exact values asserted above. Add root workspaces `apps/*` and `packages/*`; add `apps/abbott/.next-abbott/` to `.gitignore`; pin the app to existing versions `next=16.1.6`, `react=19.2.3`, and `react-dom=19.2.3`. Configure `next.config.js` with `output: "standalone"`, `distDir: ".next-abbott"`, `assetPrefix: "/_next-abbott"`, `outputFileTracingRoot: path.join(__dirname, "../..")`, and `poweredByHeader: false`.

- [ ] **Step 4: Install lockfile metadata and run the focused test**

Run: `npm install --package-lock-only && node --import tsx --test packages/runtime-contract/src/index.test.ts`

Expected: ownership tests PASS and no dependency version changes outside workspace metadata.

- [ ] **Step 5: Commit the boundary contract**

```bash
git add .gitignore package.json package-lock.json packages/runtime-contract apps/abbott/package.json apps/abbott/next.config.js apps/abbott/tsconfig.json apps/abbott/next-env.d.ts
git commit -m "feat(abbott): define isolated runtime boundary"
```

### Task 2: Extract the Abbott-only canonical read model

**Files:**
- Create: `src/lib/abbott-dashboard-loader.ts`
- Create: `src/lib/abbott-dashboard-loader.test.ts`
- Modify: `src/lib/dashboard-data-loader.ts`
- Create: `apps/abbott/src/lib/abbott-dashboard-loader.ts`
- Create: `apps/abbott/src/lib/abbott-dashboard-loader.test.ts`

**Interfaces:**
- Consumes: `loadAbbottBiData(dashboardId, counterIds, from, to, audience)` from `src/lib/abbott-bi.ts` and canonical dashboard/source tables through `src/lib/db.ts`.
- Produces: `loadAbbottDashboardData(request: Request, identifier: string, audience: AbbottDashboardAudience): Promise<{data: DashboardData}>`.

- [ ] **Step 1: Write tests for identity, date range, counter fallback, and audience enforcement**

```ts
test("loads only an abbott_bi dashboard and preserves requested period", async () => {
  const result = await loadAbbottDashboardDataWithDependencies(
    new Request("https://example.test/api/dashboard/18?from=2026-09-01&to=2026-09-13"),
    "18",
    "manager",
    fakeDependencies({ client_id: "abbott", dashboard_type: "abbott_bi" }),
  );
  assert.equal(result.data.dashboard.type, "abbott_bi");
  assert.deepEqual(result.data.dashboard.period, { from: "2026-09-01", to: "2026-09-13" });
});

test("rejects another dashboard even when its numeric identifier exists", async () => {
  await assert.rejects(
    loadAbbottDashboardDataWithDependencies(request, "28", "manager", fakeDependencies({ client_id: "zaruku", dashboard_type: "zaruku_bi" })),
    /Dashboard not found/,
  );
});

test("requires a trusted Abbott audience", async () => {
  await assert.rejects(
    loadAbbottDashboardDataWithDependencies(request, "18", undefined as never, fakeDependencies()),
    /Abbott trusted audience is required/,
  );
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --import tsx --test src/lib/abbott-dashboard-loader.test.ts apps/abbott/src/lib/abbott-dashboard-loader.test.ts`

Expected: FAIL because the focused loader is absent.

- [ ] **Step 3: Extract only the current Abbott branch**

Implement `loadAbbottDashboardDataWithDependencies` with this fixed sequence:

```ts
export async function loadAbbottDashboardDataWithDependencies(
  request: Request,
  identifier: string,
  audience: AbbottDashboardAudience,
  dependencies: AbbottDashboardLoaderDependencies,
): Promise<{ data: DashboardData }> {
  if (audience !== "manager" && audience !== "embed") throw new Error("Abbott trusted audience is required");
  if (normalizeAbbottIdentifier(identifier) !== "abbott") throw new Error("Dashboard not found");
  const dashboard = await dependencies.findDashboard(identifier);
  if (!dashboard || dashboard.client_id.trim().toLowerCase() !== "abbott" || dashboard.dashboard_type !== "abbott_bi") {
    throw new Error("Dashboard not found");
  }
  const range = resolveAbbottDashboardRange(request);
  const configured = await dependencies.findCounterIds(dashboard.id);
  const counterIds = configured.length > 0 ? configured : getDefaultAbbottCounterIds();
  const abbottBi = await dependencies.loadBi(dashboard.id, counterIds, range.from, range.to, audience);
  return { data: buildAbbottDashboardData(dashboard, range, abbottBi) };
}
```

Lift the SQL for `dashboards` and `dashboard_sources`, JSON fields `logo_url`, `currency`, `language`, and the Abbott date-range behavior from the current `loadDashboardData` without importing advertising loaders, Zaruku loaders, source clients, media-plan code, or manual-file readers. The transitional `src/lib/dashboard-data-loader.ts` calls this focused function only when the resolved dashboard type is `abbott_bi`; all non-Abbott branches remain unchanged. `apps/abbott/src/lib/abbott-dashboard-loader.ts` re-exports the focused function so its route graph has an Abbott-named entry and no dependency on `dashboard-data-loader.ts`.

- [ ] **Step 4: Prove read-model parity and dependency isolation**

Run:

```bash
node --import tsx --test src/lib/abbott-dashboard-loader.test.ts apps/abbott/src/lib/abbott-dashboard-loader.test.ts
node --import tsx --test src/lib/abbott-bi-loader.test.ts src/lib/abbott-private-store.test.ts src/lib/abbott-data-projection.test.ts
```

Expected: all tests PASS; the existing Abbott fixtures have identical metadata, totals, rows, and `data_quality` values.

- [ ] **Step 5: Commit the read-model extraction**

```bash
git add src/lib/abbott-dashboard-loader.ts src/lib/abbott-dashboard-loader.test.ts src/lib/dashboard-data-loader.ts apps/abbott/src/lib
git commit -m "refactor(abbott): isolate canonical dashboard loader"
```

### Task 3: Add fail-closed authorization and the Abbott JSON API

**Files:**
- Create: `apps/abbott/src/lib/abbott-route-access.ts`
- Create: `apps/abbott/src/lib/abbott-route-access.test.ts`
- Create: `apps/abbott/src/lib/abbott-json-handler.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/route.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/route.test.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/runtime-boundary.test.ts`

**Interfaces:**
- Consumes: existing `isDashboardAccessAuthorized`, focused loader, and `projectAbbottDashboardData`.
- Produces: `authorizeAbbottRoute(request, identifier)` and `createAbbottJsonHandler(dependencies)`.

- [ ] **Step 1: Write authorization and response tests**

```ts
test("both aliases authorize the canonical Abbott identity", async () => {
  for (const id of ["18", "abbott"]) {
    const access = await createAbbottRouteAuthorizer({ authorize: fakeManagerAuthorize })(request, id);
    assert.equal(access.authorized, true);
    assert.equal(access.context?.client_id, "abbott");
  }
});

test("wrong identity returns 404 without leaking authorization state", async () => {
  const response = await handler(request, { params: { id: "28" } });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Dashboard not found" });
});

test("embed response is projected before serialization", async () => {
  const response = await embedHandler(request, { params: { id: "abbott" } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /raw_user_id|visit_id|session_journeys|start_url|end_url/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
```

- [ ] **Step 2: Run and observe the missing handlers**

Run: `node --import tsx --test apps/abbott/src/lib/abbott-route-access.test.ts apps/abbott/src/app/api/dashboard/'[id]'/route.test.ts`

Expected: FAIL because the route authorizer and handler are absent.

- [ ] **Step 3: Implement exact alias and identity checks before loading data**

```ts
export function isAbbottDashboardIdentity(context: unknown): boolean {
  if (!context || typeof context !== "object") return false;
  const row = context as { id?: unknown; client_id?: unknown; dashboard_type?: unknown };
  return Number(row.id) === 18
    && String(row.client_id ?? "").trim().toLowerCase() === "abbott"
    && row.dashboard_type === "abbott_bi";
}

export function createAbbottRouteAuthorizer(dependencies = { authorize: isDashboardAccessAuthorized }) {
  return async (request: Request, identifier: string) => {
    if (normalizeAbbottIdentifier(identifier) !== "abbott") {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    const access = await dependencies.authorize(request, identifier);
    if (!isAbbottDashboardIdentity(access.context)) {
      return { context: null, authorized: false as const, reason: "not_found" as const };
    }
    return access;
  };
}
```

The JSON handler returns the current 401 metadata used by `DashboardAccessGate`, loads with the authorized audience, applies `projectAbbottDashboardData` before `NextResponse.json`, returns `private, no-store`, maps invalid date ranges to 400, missing identities to 404, and all other failures to the existing generic 500 message.

- [ ] **Step 4: Add an esbuild graph gate**

```ts
test("Abbott JSON route excludes other dashboard runtimes and source APIs", async () => {
  const result = await build({
    entryPoints: ["apps/abbott/src/app/api/dashboard/[id]/route.ts"],
    bundle: true, write: false, metafile: true, packages: "external",
    platform: "node", format: "esm", logLevel: "silent",
  });
  const trace = Object.keys(result.metafile!.inputs).sort().join("\n");
  assert.match(trace, /abbott-route-access\.ts/);
  assert.match(trace, /abbott-dashboard-loader\.ts/);
  assert.doesNotMatch(trace, /dashboard-data-loader\.ts|zaruku|advertising-binding|google-ads|yandex-direct|metrika-client|bitrix.*client/);
  assert.doesNotMatch(trace, /src\/app\/api\/dashboard\/\[id\]\//);
});
```

Run: `node --import tsx --test apps/abbott/src/app/api/dashboard/'[id]'/*.test.ts apps/abbott/src/lib/abbott-route-access.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the protected JSON surface**

```bash
git add apps/abbott/src/lib/abbott-route-access.ts apps/abbott/src/lib/abbott-route-access.test.ts apps/abbott/src/lib/abbott-json-handler.ts apps/abbott/src/app/api/dashboard
git commit -m "feat(abbott): add isolated authorized data API"
```

### Task 4: Reproduce the current Abbott page without advertising branches

**Files:**
- Create: `apps/abbott/src/app/layout.tsx`
- Create: `apps/abbott/src/app/layout.test.ts`
- Create: `apps/abbott/src/app/globals.css`
- Create: `apps/abbott/src/app/dashboard/[id]/page.tsx`
- Create: `apps/abbott/src/components/AbbottDashboardPage.tsx`
- Create: `apps/abbott/src/components/abbott-dashboard-page.test.ts`
- Create: `apps/abbott/src/app/middleware-manifest.test.ts`

**Interfaces:**
- Consumes: `/api/dashboard/{18|abbott}`, `DashboardAccessGate`, `DashboardHeader`, `AbbottDatePicker`, `AbbottBiDashboard`, and current Abbott date helpers.
- Produces: a client page that renders exactly the current Abbott states and emits `data-dashboard-ready="true"` only after valid Abbott data loads.

- [ ] **Step 1: Write source-level behavior tests before extracting the page**

```ts
test("focused page calls only the matching Abbott API alias", () => {
  const source = readFileSync(new URL("./AbbottDashboardPage.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\(`\/api\/dashboard\/\$\{dashboardId\}/);
  assert.doesNotMatch(source, /ZarukuSeoDashboard|CampaignDashboard|PerformanceDashboard|MediaPlan/);
});

test("page preserves access, date, PDF, mobile, and reload behavior", () => {
  const source = readFileSync(new URL("./AbbottDashboardPage.tsx", import.meta.url), "utf8");
  for (const token of ["DashboardAccessGate", "AbbottDatePicker", "AbbottBiDashboard", "pdf", "mobile", "reloadKey"]) {
    assert.match(source, new RegExp(token));
  }
});
```

- [ ] **Step 2: Run the page tests and confirm failure**

Run: `node --import tsx --test apps/abbott/src/components/abbott-dashboard-page.test.ts apps/abbott/src/app/layout.test.ts`

Expected: FAIL because the Abbott page and layout do not exist.

- [ ] **Step 3: Extract the existing Abbott page state machine exactly**

Create `AbbottDashboardPage({ dashboardId }: { dashboardId: "18" | "abbott" })` by moving only these current behaviors from `src/app/dashboard/[id]/page.tsx`:

```tsx
export default function AbbottDashboardPage({ dashboardId }: { dashboardId: "18" | "abbott" }) {
  // Preserve: access_token, embed_key, from, to, pdf, and mobile URL parameters.
  // Preserve: resolveInitialAbbottRange, preset detection, incomplete-coverage clamp,
  // 401 AccessGate state, 404 state, technical-error state, reloadKey, and URL replacement.
  // Preserve: the exact DashboardHeader + AbbottDatePicker + AbbottBiDashboard JSX subtree.
  // Remove: advertising, Zaruku, comparison, brand, AI-summary, and demo-data branches.
}
```

The implementation must copy the existing function bodies and Abbott JSX from revision `8f389a28df1c4b741ec33b7538f0354b74f5a40e` without label, class, spacing, date, or error-message edits. The dynamic page calls `normalizeAbbottIdentifier(params.id)` and invokes `notFound()` for every other ID. Copy `src/app/globals.css` unchanged so the current chart/table/print styles remain identical; the standalone artifact policy added later excludes unrelated public files even though CSS tokens are shared.

- [ ] **Step 4: Build once and prove no inherited middleware exists**

Run:

```bash
npm --workspace apps/abbott run build
node --import tsx --test apps/abbott/src/components/abbott-dashboard-page.test.ts apps/abbott/src/app/layout.test.ts apps/abbott/src/app/middleware-manifest.test.ts
```

Expected: build succeeds; page tests PASS; `.next-abbott/server/middleware-manifest.json` contains zero middleware/functions.

- [ ] **Step 5: Commit the visual shell**

```bash
git add apps/abbott/src/app apps/abbott/src/components
git commit -m "feat(abbott): add isolated dashboard page"
```

### Task 5: Add manager control and Abbott-only exports

**Files:**
- Create: `apps/abbott/src/app/api/dashboard/[id]/abbott-admin-users/route.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/abbott-admin-users/route.test.ts`
- Create: `apps/abbott/src/lib/abbott-excel-handler.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/excel/route.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/excel/route.test.ts`
- Create: `apps/abbott/src/lib/abbott-pdf-handler.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/pdf/route.ts`
- Create: `apps/abbott/src/app/api/dashboard/[id]/pdf/route.test.ts`

**Interfaces:**
- Consumes: `authorizeAbbottRoute`, `listAbbottAdminUserIds`, `addAbbottAdminUserIds`, `removeAbbottAdminUserId`, focused loader, projection, ExcelJS, and Puppeteer.
- Produces: manager-only User ID mutations, projected Excel workbooks, and port-3004 PDF rendering.

- [ ] **Step 1: Port the existing manager-control route tests and add alias/privacy cases**

```ts
for (const id of ["18", "abbott"]) {
  test(`${id}: manager can list administrator IDs`, async () => {
    const response = await handlers.GET(request, { params: { id } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user_ids: ["manager-1"] });
  });
}

test("embed cannot read or mutate administrator IDs", async () => {
  for (const method of [handlers.GET, handlers.POST, handlers.DELETE]) {
    const response = await method(request, { params: { id: "abbott" } });
    assert.equal(response.status, 403);
  }
});
```

- [ ] **Step 2: Port the current route with only the authorizer changed**

Copy the current bounded 16 KiB JSON parsing, duplicate/invalid ID validation, 400/413 error mapping, and private cache headers unchanged. Replace the generic authorizer call with `authorizeAbbottRoute`; require `access.audience === "manager"` before list/add/remove.

Run: `node --import tsx --test apps/abbott/src/app/api/dashboard/'[id]'/abbott-admin-users/route.test.ts src/lib/abbott-admin-users.test.ts`

Expected: all tests PASS.

- [ ] **Step 3: Write PDF tests for alias preservation and port isolation**

```ts
test("PDF renders the isolated Abbott page on port 3004", () => {
  const url = buildAbbottDashboardUrl(
    new Request("https://example.test/api/dashboard/18/pdf?from=2026-09-01&to=2026-09-13"),
    "18", "signed-export-token", {},
  );
  assert.equal(url, "http://127.0.0.1:3004/dashboard/18?pdf=true&from=2026-09-01&to=2026-09-13&access_token=signed-export-token");
});
```

Implement `buildAbbottDashboardUrl` with default `http://127.0.0.1:3004`, preserve `from`, `to`, `embed_key`, `pdf=true`, and the authorized export token, and reject a non-Abbott identifier before launching Chromium. Keep the current browser close in `finally` and current PDF dimensions/headers.

- [ ] **Step 4: Preserve the current Abbott HTTP workbook output and assert privacy**

First execute the current combined Excel handler against the existing Abbott fixture and record its semantic output: workbook sheet names, row counts, cell types, formulas, and whether the current handler emits any Abbott-specific rows. Reproduce exactly that output from `projectAbbottDashboardData(await loadAbbottDashboardData(...), audience)`; do not invent Abbott sheets or columns that the combined handler does not currently return, and do not import the generic Excel route or advertising worksheet builders. Separately keep the existing client-side XLSX downloads inside `AbbottBiDashboard` unchanged. Assert that embed output contains no manager-only values.

Run:

```bash
node --import tsx --test apps/abbott/src/app/api/dashboard/'[id]'/pdf/route.test.ts apps/abbott/src/app/api/dashboard/'[id]'/excel/route.test.ts
node --import tsx --test src/lib/abbott-data-projection.test.ts src/lib/abbott-dashboard-contract.test.ts
```

Expected: all tests PASS; the embed workbook contains none of `raw_user_id`, `visit_id`, `start_url`, `end_url`, or session-journey rows.

- [ ] **Step 5: Extend the esbuild boundary test to all handlers**

For `route.ts`, `pdf/route.ts`, `excel/route.ts`, and `abbott-admin-users/route.ts`, assert no trace entry matches `dashboard-data-loader.ts`, `src/app/api/dashboard/[id]`, `zaruku`, `advertising-binding`, source API clients, or admin password code.

Run: `node --import tsx --test apps/abbott/src/app/api/dashboard/'[id]'/runtime-boundary.test.ts`

Expected: four subtests PASS.

- [ ] **Step 6: Commit the complete Abbott surface**

```bash
git add apps/abbott/src/app/api/dashboard apps/abbott/src/lib/abbott-excel-handler.ts apps/abbott/src/lib/abbott-pdf-handler.ts
git commit -m "feat(abbott): isolate exports and manager control"
```

### Task 6: Enforce private database and artifact boundaries

**Files:**
- Create: `apps/abbott/src/app/api/health/route.ts`
- Create: `apps/abbott/src/app/api/health/route.test.ts`
- Create: `apps/abbott/src/lib/abbott-runtime-boundary.test.ts`
- Create: `scripts/runtime-artifact-policy.mjs`
- Create: `scripts/runtime-artifact-policy.test.mjs`
- Create: `scripts/assert-abbott-artifact.mjs`
- Create: `scripts/assert-abbott-artifact.test.mjs`
- Modify: `apps/abbott/package.json`

**Interfaces:**
- Consumes: the standalone build and existing aggregate/private DB factories.
- Produces: health `{ok:true, scope:"abbott", database:"connected"}`, a trusted artifact manifest, and a verified build stamp.

- [ ] **Step 1: Write tests proving environment and response separation**

```ts
test("health identifies only the Abbott runtime and is never public-cacheable", async () => {
  const response = await createHealthHandler({ query: async () => undefined })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, scope: "abbott", database: "connected" });
});

test("embed and manager credentials remain distinct", () => {
  const environment = {
    ABBOTT_EMBED_DB_HOST: "embed-db", ABBOTT_EMBED_DB_PORT: "3307",
    ABBOTT_EMBED_DB_USER: "embed-user", ABBOTT_EMBED_DB_PASSWORD: "embed-password",
    ABBOTT_EMBED_DB_NAME: "report_bd",
    ABBOTT_PRIVATE_DB_HOST: "manager-db", ABBOTT_PRIVATE_DB_PORT: "3308",
    ABBOTT_PRIVATE_DB_USER: "manager-user", ABBOTT_PRIVATE_DB_PASSWORD: "manager-password",
    ABBOTT_PRIVATE_DB_NAME: "report_bd_private",
  };
  assert.equal(abbottDatabaseConfig("embed", environment).database, "report_bd");
  assert.equal(abbottDatabaseConfig("manager", environment).database, "report_bd_private");
  assert.equal(abbottDatabaseConfig("embed", environment).user, "embed-user");
  assert.equal(abbottDatabaseConfig("manager", environment).user, "manager-user");
});
```

- [ ] **Step 2: Implement health and run focused tests**

Run: `node --import tsx --test apps/abbott/src/app/api/health/route.test.ts apps/abbott/src/lib/abbott-runtime-boundary.test.ts`

Expected: PASS with a 503 private response when the injected query fails.

- [ ] **Step 3: Port the proven Zaruku artifact policy and bind it to Abbott**

Port `scripts/runtime-artifact-policy.mjs` and its test from reviewed commit `13bbed5` without weakening its trusted-manifest, fixed-scope, path, symlink, size, secret-name, or build-authority checks. Add `assert-abbott-artifact.mjs` with these forbidden patterns:

```js
export const FORBIDDEN_ABBOTT_ARTIFACT = [
  /(^|\/)\.env(?:\.|$)/, /(^|\/)\.git(?:\/|$)/, /(^|\/)uploads?(?:\/|$)/,
  /\.(?:xlsx?|csv|log|sql|dump)$/i, /zaruku/i, /medroche/i,
  /google-ads/i, /yandex-direct/i, /media-plan/i, /raw-client-id/i,
];
```

The assertion also scans text files for `METRIKA_TOKEN=`, `DASHBOARD_AUTH_SECRET=`, `DB_PASSWORD=`, `ABBOTT_PRIVATE_DB_PASSWORD=`, viewer JWT/query tokens, and the known private baseline directory name; it reports only relative filenames, never matching secret values.

- [ ] **Step 4: Bind build and start commands to the artifact policy**

Set Abbott scripts to:

```json
{
  "build": "next build --webpack && node ../../scripts/runtime-artifact-policy.mjs --prepare abbott .next-abbott/standalone --trusted-manifest .next-abbott/trusted-runtime-manifest.json && node ../../scripts/runtime-artifact-policy.mjs --stamp abbott .next-abbott/standalone --trusted-manifest .next-abbott/trusted-runtime-manifest.json",
  "verify:artifact": "node ../../scripts/assert-abbott-artifact.mjs .next-abbott/standalone && node ../../scripts/runtime-artifact-policy.mjs --verify abbott .next-abbott/standalone --trusted-manifest .next-abbott/trusted-runtime-manifest.json",
  "verify:boot": "node ../../scripts/runtime-artifact-policy.mjs --boot abbott .next-abbott/standalone --trusted-manifest .next-abbott/trusted-runtime-manifest.json",
  "start": "next start -p 3004"
}
```

- [ ] **Step 5: Build and inspect the artifact**

Run:

```bash
npm --workspace apps/abbott run build
npm --workspace apps/abbott run verify:artifact
npm --workspace apps/abbott run verify:boot
node --test scripts/runtime-artifact-policy.test.mjs scripts/assert-abbott-artifact.test.mjs
```

Expected: all commands exit 0; no forbidden file, secret marker, unrelated dashboard asset, or untrusted symlink is present.

- [ ] **Step 6: Commit the runtime safety gates**

```bash
git add apps/abbott/src/app/api/health apps/abbott/src/lib/abbott-runtime-boundary.test.ts apps/abbott/package.json scripts/runtime-artifact-policy.mjs scripts/runtime-artifact-policy.test.mjs scripts/assert-abbott-artifact.mjs scripts/assert-abbott-artifact.test.mjs
git commit -m "test(abbott): enforce runtime privacy boundary"
```

### Task 7: Add fixed-authority deployment and exact Nginx routing

**Files:**
- Create: `deploy/abbott/release.json`
- Create: `deploy/abbott/repository.json`
- Create: `deploy/abbott/ecosystem.config.cjs`
- Create: `deploy/abbott/start.cjs`
- Create: `deploy/abbott/nginx-routes.conf`
- Create: `scripts/deploy-runtime.mjs`
- Create: `scripts/deploy-runtime.sh`
- Create: `scripts/deploy-abbott.sh`
- Create: `scripts/rollback-abbott.sh`
- Create: `scripts/deploy-abbott.test.mjs`
- Create: `scripts/verify-abbott-nginx-routes.mjs`
- Create: `scripts/verify-abbott-nginx-routes.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: verified standalone artifact and immutable manifest.
- Produces: `npm run deploy:abbott`, `npm run deploy:abbott:rollback`, PM2 app `dashboard-abbott`, and a validated exact-route Nginx fragment.

- [ ] **Step 1: Write deployment authority tests**

```js
test("Abbott deploy authority cannot target another runtime", async () => {
  const manifest = JSON.parse(await readFile("deploy/abbott/release.json", "utf8"));
  assert.deepEqual(manifest, {
    scope: "abbott", releaseBranch: "release/abbott", appName: "dashboard-abbott",
    port: 3004, appDir: "/var/www/dashboard-abbott",
    lockDir: "/var/www/.dashboard-abbott-deploy.lock", assetPrefix: "/_next-abbott",
  });
  assert.doesNotMatch(await readFile("scripts/deploy-abbott.sh", "utf8"), /\$\{?(?:APP_NAME|APP_PORT|APP_DIR|RELEASE_BRANCH)/);
});
```

- [ ] **Step 2: Create the fixed deployment authority**

Port the generic immutable installer from reviewed Zaruku isolation commit `13bbed5`; change user-facing scope text to neutral `runtime` text. `deploy-abbott.sh` executes exactly:

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy-runtime.sh" "$SCRIPT_DIR/../deploy/abbott/release.json" deploy
```

`rollback-abbott.sh` is identical except its final argument is `rollback`. Neither script accepts positional arguments or environment overrides for repository, branch, port, app name, release root, lock, SSH binary, or environment path.

- [ ] **Step 3: Add the Abbott PM2 launcher with an environment allowlist**

`deploy/abbott/start.cjs` must accept only general DB, `ABBOTT_PRIVATE_DB_*`, `ABBOTT_EMBED_DB_*`, `NODE_ENV`, `HOSTNAME`, `PORT`, `NEXT_PUBLIC_BASE_URL`, `DASHBOARD_AUTH_SECRET`, `INTERNAL_BASE_URL`, `ABBOTT_DASHBOARD_EMBED_KEY`, and `PUPPETEER_EXECUTABLE_PATH`; require `HOSTNAME=127.0.0.1`, `PORT=3004`, `NODE_ENV=production`; clear inherited environment; then require `/var/www/dashboard-abbott/apps/abbott/server.js`. It must reject source OAuth keys including `METRIKA_TOKEN`, `YANDEX_*TOKEN`, and `GOOGLE_*TOKEN`.

- [ ] **Step 4: Define and validate exact Nginx locations**

`deploy/abbott/nginx-routes.conf` contains exact `location =` entries for the 12 page/API aliases from the design and one prefix `location ^~ /_next-abbott/`; every entry proxies only to `http://127.0.0.1:3004`. It contains no `/api/health`, `/api/dashboard-auth`, `/admin`, regex dashboard catch-all, Zaruku, or MedRoche locations.

Run:

```bash
node --test scripts/deploy-abbott.test.mjs scripts/verify-abbott-nginx-routes.test.mjs
node scripts/verify-abbott-nginx-routes.mjs deploy/abbott/nginx-routes.conf
```

Expected: PASS; validator reports `12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004`.

- [ ] **Step 5: Add package commands and commit**

Add `deploy:abbott`, `deploy:abbott:rollback`, `test:abbott-runtime`, and include the Abbott focused suite in `ci:verify` without removing existing tests.

```bash
git add deploy/abbott scripts/deploy-runtime.mjs scripts/deploy-runtime.sh scripts/deploy-abbott.sh scripts/rollback-abbott.sh scripts/deploy-abbott.test.mjs scripts/verify-abbott-nginx-routes.mjs scripts/verify-abbott-nginx-routes.test.mjs package.json package-lock.json
git commit -m "feat(abbott): add isolated release authority"
```

### Task 8: Build a redacted data, export, and visual parity gate

**Files:**
- Create: `scripts/compare-abbott-runtime.mjs`
- Create: `scripts/compare-abbott-runtime.test.mjs`
- Create: `scripts/capture-abbott-runtime.mjs`
- Create: `scripts/capture-abbott-runtime.test.mjs`
- Create: `docs/runbooks/abbott-runtime-cutover.md`

**Interfaces:**
- Consumes: authorized URLs for port 3001 and port 3004, fixed range `2026-09-01..2026-09-13`, and the private visual baseline.
- Produces: a redacted parity JSON file, export hashes/semantic comparisons, candidate screenshots, and an auditable cutover runbook.

- [ ] **Step 1: Write normalization tests for volatile and private fields**

```js
test("parity summary excludes secrets and volatile timestamps", () => {
  const summary = summarizeAbbottPayload(fixture);
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /access_token|cookie|raw_user_id|visit_id|start_url|end_url/);
  assert.deepEqual(summary.period, { from: "2026-09-01", to: "2026-09-13" });
  assert.deepEqual(summary.tabs.sort(), ["general_materials", "page_stats", "returning", "user_actions", "users_summary"]);
});
```

- [ ] **Step 2: Implement deterministic parity summaries**

Compare these exact fields for each authorized audience: dashboard metadata excluding volatile generation time; period; KPI totals; `data_quality`; visible tab IDs; every tab row count; stable row identifiers; numeric aggregates; current administrator-exclusion count; Excel sheet names, row counts, cell types, and formulas. Never persist cookies, access tokens, raw manager rows, or URL values. A mismatch exits 1 and names only the field path and redacted counts.

- [ ] **Step 3: Implement screenshot capture matching the preserved baseline**

Capture desktop at `1440` width for `users_summary`, `user_actions`, `page_stats`, `returning`, and `general_materials`; capture mobile at CSS `390x844` for `users_summary`. Use the exact date range, wait for `[data-dashboard-ready='true']`, fonts, and stable chart animation completion. Save candidates in a new mode-0700 directory outside Git. If one of `bitrix_pages`, `session_journeys`, `external_events`, or `time_buckets` becomes visible, capture an additional desktop image and include it in the parity index.

- [ ] **Step 4: Run unit tests and document exact operator commands**

Run: `node --test scripts/compare-abbott-runtime.test.mjs scripts/capture-abbott-runtime.test.mjs`

Expected: PASS; test fixtures contain no tokens or private values.

The runbook sequence is fixed: verify clean commit; build/test; install without Nginx; direct health; obtain ephemeral manager and embed authorization without saving it; compare 3001 vs 3004; capture candidate; verify all other PM2 PIDs remain unchanged; validate Nginx; snapshot current Nginx file; apply only Abbott locations; `nginx -t`; reload; post-cutover smoke; rollback only Abbott locations if any check fails.

- [ ] **Step 5: Commit the parity tooling and runbook**

```bash
git add scripts/compare-abbott-runtime.mjs scripts/compare-abbott-runtime.test.mjs scripts/capture-abbott-runtime.mjs scripts/capture-abbott-runtime.test.mjs docs/runbooks/abbott-runtime-cutover.md
git commit -m "test(abbott): add cutover parity gates"
```

### Task 9: Verify, release, shadow, and cut over only Abbott

**Files:**
- Modify: no application source unless a preceding gate exposes an Abbott-specific defect.
- Server-only: `/var/www/dashboard-abbott/**`, Abbott PM2 definition, and the exact Abbott Nginx location fragment.
- Evidence outside Git: private parity report and candidate screenshots.

**Interfaces:**
- Consumes: the complete reviewed branch and Task 8 runbook.
- Produces: an isolated live Abbott route owner with a route-only rollback path.

- [ ] **Step 1: Run the complete local verification gate from a clean tree**

```bash
git status --short
npm run test:abbott-runtime
npm run test:abbott-contract
npm run test:abbott-contract-wiring
npm run security:public-assets
npm run lint
npm run typecheck
npm --workspace apps/abbott run build
npm --workspace apps/abbott run verify:artifact
```

Expected: clean status before generated ignored output; 0 failed tests; lint/typecheck/build exit 0; artifact gate exits 0.

- [ ] **Step 2: Review the complete branch diff before publishing**

Run:

```bash
git diff --check 8f389a28df1c4b741ec33b7538f0354b74f5a40e..HEAD
git diff --stat 8f389a28df1c4b741ec33b7538f0354b74f5a40e..HEAD
git log --oneline --decorate 8f389a28df1c4b741ec33b7538f0354b74f5a40e..HEAD
```

Expected: no whitespace errors; changes are limited to Abbott runtime, the focused Abbott loader, runtime contract/deploy tooling, and docs.

- [ ] **Step 3: Publish the feature branch and create/update `release/abbott` only**

```bash
git push -u origin codex/abbott-runtime-isolation
git push origin HEAD:refs/heads/release/abbott
```

Expected: neither command updates `main`, `release/zaruku`, a MedRoche branch, or an advertising release branch.

- [ ] **Step 4: Install and start the shadow runtime without public routing**

Run: `npm run deploy:abbott`

Expected on server: `dashboard-abbott` online on `127.0.0.1:3004`; existing `dashboard-next`, `dashboard-zaruku`, and `dashboard-medroche` PIDs/release pointers unchanged; Abbott direct health returns 200.

- [ ] **Step 5: Execute manager/embed data and export parity**

Run the runbook's ephemeral-credential command so `compare-abbott-runtime.mjs` compares port 3001 and 3004 for `2026-09-01..2026-09-13` without printing or saving credentials.

Expected: zero metadata/KPI/tab/row/export mismatches; embed private-field scan returns zero; administrator-exclusion behavior is unchanged and any test mutation is reversed before proceeding.

- [ ] **Step 6: Compare the candidate against all six baseline images**

Run the capture command from the runbook, inspect the six images side-by-side, and compare their dimensions and perceptual-diff thresholds.

Expected: all five current desktop tabs and the mobile first tab match; no console errors; the 13 known chart warnings may recur; every newly visible conditional tab has an added passing capture.

- [ ] **Step 7: Validate and switch exact Abbott Nginx routes**

Use the runbook's audited server command to back up the current Nginx config, insert the validated Abbott fragment, run `nginx -t`, and reload only Nginx.

Expected: only exact Abbott aliases and `/_next-abbott/` resolve to 3004; login/admin remain 3001; no public Abbott health alias is added.

- [ ] **Step 8: Run post-cutover and neighbor regression smoke**

Verify both Abbott page aliases, JSON aliases, PDF, Excel, manager control, embed isolation, and assets. Then verify one advertising dashboard on 3001, Zaruku on 3002, and MedRoche on 3003. Confirm their PM2 PIDs and active release pointers did not change.

Expected: all checks pass with unchanged neighbor runtime identities.

- [ ] **Step 9: Exercise rollback authority without changing data**

Validate that the saved Nginx rollback restores only Abbott routes to 3001 and that `npm run deploy:abbott:rollback` targets only the preceding Abbott immutable release. Do not execute a live rollback when the post-cutover checks pass; record the validated command and last-known-good Abbott release ID.

- [ ] **Step 10: Record completion evidence**

Append to `docs/runbooks/abbott-runtime-cutover.md`: deployed Abbott commit/release ID, health result, parity result, baseline directory and candidate directory, exact Nginx backup path, neighbor release/PID checks, and rollback target. Store no tokens, cookies, passwords, private rows, or raw exports.

Expected: the evidence shows Abbott is independently deployable and reversible while all other dashboards remained untouched.

## Final acceptance checklist

- [ ] Abbott page and data/API/export/admin-control aliases are unchanged publicly.
- [ ] Port 3004 serves only Abbott plus direct `/api/health`.
- [ ] Login, admin UI, and password rotation still run on port 3001.
- [ ] Manager and embed projections and database roles remain separate.
- [ ] No external source API is reachable from the Abbott request graph.
- [ ] Data parity passes for `2026-09-01..2026-09-13`.
- [ ] All six preserved visual baselines pass; newly visible conditional tabs are also captured.
- [ ] Advertising, Zaruku, and MedRoche smoke checks pass before and after cutover.
- [ ] Abbott deploy/rollback cannot restart or overwrite another runtime.
- [ ] Combined Abbott code remains available for the first route-only rollback.
