# Zaruku Isolated Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an independently buildable, testable, deployable Zaruku runtime beside the unchanged combined production runtime, with fixed ownership boundaries and no public traffic cutover.

**Architecture:** Introduce a fail-closed runtime-scope contract, move Zaruku page/API/read-model ownership into `apps/zaruku`, and keep the existing combined app working through temporary compatibility adapters. Add fixed Zaruku build, process, artifact, release, lock, and rollback contracts so a later cutover can change only Zaruku routing.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Bash, PM2, MySQL, existing standalone deployment scripts.

## Global Constraints

- Existing browser-visible URLs remain `/dashboard/zaruku` and `/api/dashboard/zaruku/**`.
- The current combined application continues serving production traffic throughout this plan.
- No production deployment, reverse-proxy edit, database migration execution, cron edit, secret change, or route cutover occurs in this plan.
- Dashboard requests, filters, exports, and read models read canonical MySQL only; source APIs remain collector-only.
- Existing Zaruku history, direct manual additions, coverage, totals, Wordstat, SEO OS, and Alice snapshots are not rewritten or reclassified.
- The Zaruku runtime must not receive Abbott private database credentials or package Abbott private assets.
- Scope, PM2 name, port, application directory, release directories, lock path, SSH authority, and release branch are fixed by reviewed code rather than caller overrides.
- Unrelated dirty files and all Abbott or advertising worktrees remain untouched.
- Every behavior change follows a failing-test-first cycle and ends with focused verification before commit.

---

## File Structure

### New runtime-owned files

- `apps/zaruku/package.json` — Zaruku workspace commands and dependency boundary.
- `apps/zaruku/next.config.js` — standalone build with `/_next-zaruku` asset prefix.
- `apps/zaruku/tsconfig.json` — Zaruku app aliases and shared-contract imports.
- `apps/zaruku/src/app/layout.tsx` — Zaruku document shell.
- `apps/zaruku/src/app/dashboard/zaruku/page.tsx` — existing Zaruku public page.
- `apps/zaruku/src/app/api/dashboard/zaruku/route.ts` — Zaruku main read endpoint.
- `apps/zaruku/src/app/api/dashboard/zaruku/excel/route.ts` — Zaruku Excel endpoint.
- `apps/zaruku/src/app/api/dashboard/zaruku/pdf/route.ts` — Zaruku PDF endpoint.
- `apps/zaruku/src/app/api/health/route.ts` — loopback health endpoint with scope metadata.
- `apps/zaruku/src/components/ZarukuDashboardPage.tsx` — Zaruku-only client page orchestration.
- `apps/zaruku/src/lib/zaruku-dashboard-loader.ts` — Zaruku-only canonical read model.
- `apps/zaruku/src/lib/zaruku-route-access.ts` — Zaruku route authorization adapter.
- `apps/zaruku/src/compat/combined.ts` — temporary exports consumed by the old combined runtime.

### New shared boundary files

- `packages/runtime-contract/package.json` — workspace package metadata.
- `packages/runtime-contract/src/index.ts` — scope, dashboard-family, path, and runtime manifest types.
- `packages/runtime-contract/src/index.test.ts` — pure ownership and manifest tests.
- `scripts/runtime-artifact-policy.mjs` — scope-specific standalone artifact inspection.
- `scripts/runtime-artifact-policy.test.mjs` — artifact allow/deny fixtures.
- `scripts/deploy-zaruku.sh` — immutable Zaruku deployment entry point.
- `scripts/deploy-runtime.sh` — internal common release mechanics consuming a sealed manifest.
- `scripts/deploy-zaruku.test.sh` — override, lock, ancestry, and path-isolation tests.
- `scripts/rollback-zaruku.sh` — Zaruku-only rollback entry point.
- `deploy/zaruku/ecosystem.config.cjs` — PM2 process `dashboard-zaruku` on port `3002`.
- `deploy/zaruku/release.json` — reviewed immutable runtime paths and branch authority.

### Existing compatibility files

- `package.json` — add workspaces and scope commands while preserving existing commands.
- `next.config.js` — preserve combined build and add only required workspace transpilation.
- `tsconfig.json` — add package/app aliases for the temporary combined adapter.
- `src/app/dashboard/[id]/page.tsx` — delegate only the Zaruku branch to the extracted page.
- `src/app/api/dashboard/[id]/route.ts` — delegate only canonical Zaruku requests.
- `src/app/api/dashboard/[id]/excel/route.ts` — delegate only canonical Zaruku exports.
- `src/app/api/dashboard/[id]/pdf/route.ts` — delegate only canonical Zaruku exports.
- `scripts/predeploy-verify.sh` — include isolated Zaruku verification without changing production deployment.
- `OPS.md` — document shadow build/run and explicit no-cutover state.

---

### Task 1: Runtime Ownership Contract

**Files:**
- Create: `packages/runtime-contract/package.json`
- Create: `packages/runtime-contract/src/index.ts`
- Create: `packages/runtime-contract/src/index.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: runtime scope, canonical dashboard `client_id`, `dashboard_type`, and request pathname.
- Produces: `DashboardRuntimeScope`, `DashboardFamily`, `RUNTIME_MANIFESTS`, `resolveDashboardFamily`, `runtimeOwnsDashboard`, and `runtimeOwnsPath`.

- [ ] **Step 1: Write failing ownership tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { RUNTIME_MANIFESTS, resolveDashboardFamily, runtimeOwnsDashboard, runtimeOwnsPath } from "./index";

test("canonical special dashboards resolve before generic advertising", () => {
  assert.equal(resolveDashboardFamily({ clientId: "zaruku", dashboardType: "zaruku_bi" }), "zaruku");
  assert.equal(resolveDashboardFamily({ clientId: "abbott", dashboardType: "abbott_bi" }), "abbott");
  assert.equal(resolveDashboardFamily({ clientId: "gidrofuril", dashboardType: "performance" }), "advertising");
});

test("isolated runtimes fail closed for another dashboard family", () => {
  assert.equal(runtimeOwnsDashboard("zaruku", { clientId: "zaruku", dashboardType: "zaruku_bi" }), true);
  assert.equal(runtimeOwnsDashboard("zaruku", { clientId: "abbott", dashboardType: "abbott_bi" }), false);
});

test("public route ownership preserves current paths", () => {
  assert.equal(runtimeOwnsPath("zaruku", "/dashboard/zaruku"), true);
  assert.equal(runtimeOwnsPath("zaruku", "/api/dashboard/zaruku/excel"), true);
  assert.equal(runtimeOwnsPath("zaruku", "/dashboard/abbott"), false);
  assert.equal(runtimeOwnsPath("advertising", "/admin/settings"), true);
});

test("Zaruku production authority is immutable", () => {
  assert.deepEqual(RUNTIME_MANIFESTS.zaruku, {
    scope: "zaruku", releaseBranch: "release/zaruku", appName: "dashboard-zaruku", port: 3002,
    appDir: "/var/www/dashboard-zaruku", lockDir: "/var/www/.dashboard-zaruku-deploy.lock",
    assetPrefix: "/_next-zaruku",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test packages/runtime-contract/src/index.test.ts`

Expected: FAIL because `packages/runtime-contract/src/index.ts` does not exist.

- [ ] **Step 3: Implement the pure contract**

```ts
export type DashboardRuntimeScope = "combined" | "advertising" | "zaruku" | "abbott";
export type DashboardFamily = Exclude<DashboardRuntimeScope, "combined">;
export type DashboardIdentity = { clientId: string; dashboardType: string };

export const RUNTIME_MANIFESTS = {
  zaruku: {
    scope: "zaruku", releaseBranch: "release/zaruku", appName: "dashboard-zaruku", port: 3002,
    appDir: "/var/www/dashboard-zaruku", lockDir: "/var/www/.dashboard-zaruku-deploy.lock",
    assetPrefix: "/_next-zaruku",
  },
} as const;

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
  if (pathname === "/dashboard/zaruku" || pathname.startsWith("/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/api/dashboard/zaruku" || pathname.startsWith("/api/dashboard/zaruku/")) return scope === "zaruku";
  if (pathname === "/dashboard/abbott" || pathname.startsWith("/dashboard/abbott/")) return scope === "abbott";
  if (pathname === "/api/dashboard/abbott" || pathname.startsWith("/api/dashboard/abbott/")) return scope === "abbott";
  return scope === "advertising";
}
```

- [ ] **Step 4: Add workspace resolution without changing existing scripts**

Add root workspaces for `apps/*` and `packages/*`, add the alias `@reportingdash/runtime-contract`, and preserve the existing `@/*` alias.

- [ ] **Step 5: Run GREEN verification**

Run: `node --import tsx --test packages/runtime-contract/src/index.test.ts && npm run typecheck && git diff --check`

Expected: ownership tests pass, typecheck passes, and diff check is empty.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json packages/runtime-contract
git commit -m "feat: define dashboard runtime ownership"
```

### Task 2: Zaruku Application Shell and Asset Isolation

**Files:**
- Create: `apps/zaruku/package.json`
- Create: `apps/zaruku/next.config.js`
- Create: `apps/zaruku/tsconfig.json`
- Create: `apps/zaruku/next-env.d.ts`
- Create: `apps/zaruku/src/app/layout.tsx`
- Create: `apps/zaruku/src/app/globals.css`
- Create: `apps/zaruku/src/app/api/health/route.ts`
- Create: `apps/zaruku/src/app/api/health/route.test.ts`
- Modify: `next.config.js`

**Interfaces:**
- Consumes: `RUNTIME_MANIFESTS.zaruku` and existing shared visual foundations.
- Produces: an independent Next application with scope health JSON and distinct framework assets.

- [ ] **Step 1: Write the failing health test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";

test("Zaruku health identifies only its isolated runtime", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, scope: "zaruku" });
});
```

Add source assertions for `output: "standalone"`, `assetPrefix: "/_next-zaruku"`, and a Zaruku-specific output directory.

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test apps/zaruku/src/app/api/health/route.test.ts`

Expected: FAIL because the app shell does not exist.

- [ ] **Step 3: Create the minimal app shell**

```js
const path = require("node:path");
module.exports = {
  reactStrictMode: true,
  output: "standalone",
  distDir: ".next-zaruku",
  assetPrefix: "/_next-zaruku",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
};
```

```ts
import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ ok: true, scope: "zaruku" }, { headers: { "Cache-Control": "private, no-store" } });
}
```

- [ ] **Step 4: Preserve the combined app**

Configure root Next.js transpilation only for the new workspace package. Do not change the root `.next` output, asset prefix, route ownership, or production command.

- [ ] **Step 5: Run GREEN and both builds**

Run: `node --import tsx --test apps/zaruku/src/app/api/health/route.test.ts && npm run build && npm --workspace apps/zaruku run build`

Expected: root combined build and isolated Zaruku shell build both pass; their output directories differ.

- [ ] **Step 6: Commit**

```bash
git add apps/zaruku next.config.js package.json package-lock.json
git commit -m "feat(zaruku): add isolated application shell"
```

### Task 3: Extract the Zaruku Page Without Behavior Changes

**Files:**
- Create: `apps/zaruku/src/components/ZarukuDashboardPage.tsx`
- Create: `apps/zaruku/src/components/zaruku-dashboard-page.test.ts`
- Create: `apps/zaruku/src/app/dashboard/zaruku/page.tsx`
- Create: `apps/zaruku/src/compat/combined.ts`
- Modify: `src/app/dashboard/[id]/page.tsx`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: existing `ZarukuSeoDashboard`, Zaruku range helpers, access gate, and Zaruku API response.
- Produces: `ZarukuDashboardPage` used by the isolated route and temporary combined-app adapter.

- [ ] **Step 1: Add characterization tests before moving code**

Assert that the extracted page preserves these contracts:

```ts
const requiredContracts = [
  "/api/dashboard/zaruku", "/api/dashboard/zaruku/pdf", "/api/dashboard/zaruku/excel",
  "ZarukuSeoDashboard", "clampZarukuDateRange", "latestZarukuReportingDate", "DashboardAccessGate",
];
```

Also assert that its dependency trace contains no `AbbottBiDashboard`, Abbott date helper, advertising KPI component, campaign table, or multibrand component.

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts`

Expected: FAIL because the extracted component does not exist.

- [ ] **Step 3: Extract Zaruku-only orchestration**

Move the code currently selected by `dashboardId === "zaruku"` into a default
`ZarukuDashboardPage` component with the slug fixed to `"zaruku"`. Move its
`from`, `to`, selected week, active Zaruku tab, reload key, viewer token,
password-gate state, loading state, and export handlers with the same initial
values and dependency arrays. Keep the existing calls to
`clampZarukuDateRange`, `latestZarukuReportingDate`, and `zarukuTimeOwner` and
render the same `DashboardAccessGate`, `DashboardHeader`, and
`ZarukuSeoDashboard` props. The isolated page directly exports this component.
The old combined page imports it and returns it only when
`dashboardId === "zaruku"`; Abbott and advertising branches remain unchanged.

- [ ] **Step 4: Run focused UI and contract tests**

Run: `node --import tsx --test apps/zaruku/src/components/zaruku-dashboard-page.test.ts src/components/ZarukuSeoDashboard.ui.test.ts src/app/dashboard/dashboard-page-date-wiring.test.ts`

Expected: extracted ownership tests and existing Zaruku UI/date tests pass.

- [ ] **Step 5: Run both builds and typecheck**

Run: `npm run typecheck && npm run build && npm --workspace apps/zaruku run build && git diff --check`

Expected: both routes build; no Abbott or advertising import appears in the Zaruku page dependency trace.

- [ ] **Step 6: Commit**

```bash
git add apps/zaruku/src src/app/dashboard/[id]/page.tsx tsconfig.json
git commit -m "refactor(zaruku): extract isolated dashboard page"
```

### Task 4: Extract Zaruku Canonical Read and Export Endpoints

**Files:**
- Create: `apps/zaruku/src/lib/zaruku-dashboard-loader.ts`
- Create: `apps/zaruku/src/lib/zaruku-dashboard-loader.test.ts`
- Create: `apps/zaruku/src/lib/zaruku-route-access.ts`
- Create: `apps/zaruku/src/lib/zaruku-route-access.test.ts`
- Create: `apps/zaruku/src/app/api/dashboard/zaruku/route.ts`
- Create: `apps/zaruku/src/app/api/dashboard/zaruku/route.test.ts`
- Create: `apps/zaruku/src/app/api/dashboard/zaruku/excel/route.ts`
- Create: `apps/zaruku/src/app/api/dashboard/zaruku/pdf/route.ts`
- Create: `apps/zaruku/src/compat/api.ts`
- Modify: `src/app/api/dashboard/[id]/route.ts`
- Modify: `src/app/api/dashboard/[id]/excel/route.ts`
- Modify: `src/app/api/dashboard/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: canonical dashboard identity/access, Zaruku source account IDs, requested date range, canonical MySQL facts and coverage.
- Produces: Zaruku-only `loadZarukuDashboardData`, main JSON, PDF, and Excel handlers.

- [ ] **Step 1: Write failing fail-closed and parity tests**

```ts
test("isolated Zaruku route rejects a non-Zaruku identity before data load", async () => {
  const calls: string[] = [];
  const handler = createZarukuDashboardGetHandler({
    authorize: async () => ({ authorized: true, audience: "manager", context: { client_id: "abbott", dashboard_type: "abbott_bi" } }),
    load: async () => { calls.push("load"); throw new Error("must not run"); },
  });
  const response = await handler(new Request("https://dashboards.test/api/dashboard/zaruku"));
  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
});
```

Add fixture parity tests comparing old and new Zaruku responses for identical canonical rows, including source health, Wordstat, SEO OS, Alice monthly snapshots, and direct historical additions.

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test apps/zaruku/src/lib/zaruku-route-access.test.ts apps/zaruku/src/lib/zaruku-dashboard-loader.test.ts apps/zaruku/src/app/api/dashboard/zaruku/route.test.ts`

Expected: FAIL because the isolated handlers and loader do not exist.

- [ ] **Step 3: Extract the read model by ownership**

Define `loadZarukuDashboardData(request, dashboardId, audience)` with the same
return fields consumed by the current Zaruku UI. It first requires the normalized
slug `zaruku`, resolves the canonical dashboard identity, and then executes the
current Zaruku branches for Metrika, GSC, Webmaster, Wordstat, SEO OS, Alice
visibility, coverage, and source-health rows with their existing SQL text and
parameters. Move the corresponding projection helpers beside the loader rather
than leaving callbacks into the generic loader. Do not import
`abbott-private-store`, `abbott-bi-loader`, advertising binding read models, or
source API clients. Preserve canonical coverage handling and
successful-empty-versus-failed-collection semantics.

- [ ] **Step 4: Implement main and export handlers**

All handlers use constant slug `zaruku`, apply `private, no-store`, and share existing audience checks. Temporary combined routes delegate only after canonical lookup resolves Zaruku.

- [ ] **Step 5: Verify parity and privacy boundaries**

Run: `node --import tsx --test apps/zaruku/src/**/*.test.ts src/lib/zaruku-*.test.ts src/components/Zaruku*.test.ts`

Expected: all Zaruku parity, source, UI, and export tests pass.

- [ ] **Step 6: Run full local gate**

Run: `npm test && npm run typecheck && npm run lint && npm run security:public-assets && npm run build && npm --workspace apps/zaruku run build`

Expected: zero failures or errors; existing documented lint warnings may remain unchanged but no new warning is accepted.

- [ ] **Step 7: Commit**

```bash
git add apps/zaruku/src src/app/api/dashboard/[id]
git commit -m "refactor(zaruku): isolate canonical read and exports"
```

### Task 5: Zaruku Artifact Boundary

**Files:**
- Create: `scripts/runtime-artifact-policy.mjs`
- Create: `scripts/runtime-artifact-policy.test.mjs`
- Modify: `apps/zaruku/package.json`
- Modify: `scripts/assert-no-private-public-assets.ts`

**Interfaces:**
- Consumes: isolated standalone output and scope `zaruku`.
- Produces: zero exit only when the artifact contains the Zaruku route set and no forbidden domain/private material.

- [ ] **Step 1: Write failing artifact fixtures**

Fixtures reject these markers and accept the expected Zaruku routes:

```js
const forbidden = [
  "server/app/dashboard/abbott", "server/app/api/dashboard/abbott", "abbott-private-store",
  "report_bd_private", "ABBOTT_PRIVATE_DB_PASSWORD", "server/app/admin",
];
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/runtime-artifact-policy.test.mjs`

Expected: FAIL because the policy script does not exist.

- [ ] **Step 3: Implement recursive inspection**

Reject symlinks escaping the artifact, prohibited paths/text markers, unexpected routes, source workbooks, unapproved `.env*` files, and private source exports. Require `.release-source-sha`, `.release-runtime-scope` containing `zaruku`, and the expected standalone server.

- [ ] **Step 4: Test fixtures and real build**

Run: `node --test scripts/runtime-artifact-policy.test.mjs && npm --workspace apps/zaruku run build && npm --workspace apps/zaruku run verify:artifact`

Expected: fixture suite and real artifact inspection pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/runtime-artifact-policy.mjs scripts/runtime-artifact-policy.test.mjs scripts/assert-no-private-public-assets.ts apps/zaruku/package.json
git commit -m "test(zaruku): enforce isolated release artifact"
```

### Task 6: Fixed Zaruku Process, Deploy, Lock, and Rollback

**Files:**
- Create: `deploy/zaruku/ecosystem.config.cjs`
- Create: `deploy/zaruku/release.json`
- Create: `scripts/deploy-runtime.sh`
- Create: `scripts/deploy-zaruku.sh`
- Create: `scripts/deploy-zaruku.test.sh`
- Create: `scripts/rollback-zaruku.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: clean named branch containing active Zaruku SHA and verified Zaruku standalone artifact.
- Produces: Zaruku-only stage/activate/attest/rollback targeting port `3002` and `/var/www/dashboard-zaruku`.

- [ ] **Step 1: Write failing immutable-authority tests**

Tests prove the entry point fixes this authority and rejects caller overrides:

```bash
RUNTIME_SCOPE=zaruku
APP_NAME=dashboard-zaruku
APP_PORT=3002
APP_DIR=/var/www/dashboard-zaruku
RELEASE_BRANCH=release/zaruku
DEPLOY_LOCK_DIR=/var/www/.dashboard-zaruku-deploy.lock
```

Tests also prove the scripts never target Abbott, advertising, or the combined deploy lock.

- [ ] **Step 2: Run RED**

Run: `bash scripts/deploy-zaruku.test.sh`

Expected: FAIL because the entry point does not exist.

- [ ] **Step 3: Add sealed entry point and process config**

```bash
#!/bin/bash
set -euo pipefail
for forbidden in RUNTIME_SCOPE APP_NAME APP_PORT APP_DIR RELEASE_BRANCH DEPLOY_LOCK_DIR; do
  if [[ -n "${!forbidden+x}" ]]; then
    echo "Refusing Zaruku deploy: $forbidden is fixed by reviewed release authority." >&2
    exit 1
  fi
done
exec bash "$(dirname "$0")/deploy-runtime.sh" "$(dirname "$0")/../deploy/zaruku/release.json"
```

The internal script validates that the manifest is a regular repository file, matches the compiled runtime contract, and reuses current guarded release mechanics with scope-specific paths and lock.

- [ ] **Step 4: Add ancestry and cross-runtime tests**

Prove Zaruku accepts only a clean named branch containing active Zaruku SHA and `release/zaruku`, serializes only another Zaruku deploy, and never reads advertising or Abbott active metadata.

- [ ] **Step 5: Add Zaruku-only rollback**

Rollback verifies `.release-runtime-scope=zaruku`, restores only the Zaruku predecessor, and refuses combined, advertising, or Abbott artifacts.

- [ ] **Step 6: Run deploy/release tests**

Run: `bash scripts/deploy-zaruku.test.sh && bash scripts/release-rollback.test.sh && bash scripts/rollback-authority.test.sh && bash -n scripts/deploy-zaruku.sh scripts/deploy-runtime.sh scripts/rollback-zaruku.sh`

Expected: all pass; existing combined deployment and rollback suites remain green.

- [ ] **Step 7: Commit**

```bash
git add deploy/zaruku scripts/deploy-runtime.sh scripts/deploy-zaruku.sh scripts/deploy-zaruku.test.sh scripts/rollback-zaruku.sh package.json
git commit -m "feat(zaruku): add independent release lifecycle"
```

### Task 7: Shadow Runtime Verification and Handoff

**Files:**
- Create: `scripts/verify-zaruku-shadow.sh`
- Create: `scripts/verify-zaruku-shadow.test.sh`
- Create: `docs/superpowers/reports/2026-09-04-zaruku-shadow-readiness.md`
- Modify: `scripts/predeploy-verify.sh`
- Modify: `OPS.md`

**Interfaces:**
- Consumes: combined and isolated Zaruku loopback fixtures for the same canonical snapshot.
- Produces: parity evidence and an explicit go/no-go report for later production shadow start and route cutover.

- [ ] **Step 1: Write failing shadow verifier tests**

Test matching health, unauthorized metadata, manager response, PDF, and Excel. Add negative fixtures for a historical total mismatch, missing direct addition, missing Alice month, Wordstat coverage mismatch, cross-runtime SHA mutation, and Abbott marker in the Zaruku artifact.

- [ ] **Step 2: Run RED**

Run: `bash scripts/verify-zaruku-shadow.test.sh`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement read-only comparison**

The verifier accepts two loopback base URLs and an evidence directory, normalizes volatile timing/header fields only, compares manager-visible totals for agreed historical dates, records SHA/scope/route evidence, and exits nonzero on every mismatch. It never writes the database.

- [ ] **Step 4: Extend the predeploy gate**

Add runtime-contract, isolated app, artifact, deploy, Zaruku build, and shadow fixture suites to `scripts/predeploy-verify.sh`. Keep the existing full combined test/build gate intact.

- [ ] **Step 5: Run final verification**

Run: `npm ci && npm run predeploy:verify`

Expected: complete combined and Zaruku gates pass with zero test failures, type errors, lint errors, asset-policy failures, build failures, or release-contract failures.

- [ ] **Step 6: Document exact readiness state**

Record commit SHA, test counts, artifact paths, forbidden-file scan, route inventory, and that no production process, proxy, database, cron, or secret changed. `OPS.md` documents local shadow commands and says public cutover requires a separate reviewed production plan.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-zaruku-shadow.sh scripts/verify-zaruku-shadow.test.sh scripts/predeploy-verify.sh OPS.md docs/superpowers/reports/2026-09-04-zaruku-shadow-readiness.md
git commit -m "docs(zaruku): attest isolated runtime readiness"
```

---

## Completion Boundary

This plan ends with an independently buildable and releasable Zaruku runtime and fresh local/shadow evidence. The existing public domain still points to the combined runtime. The next reviewed plan performs the Zaruku production shadow start and exact-path proxy cutover; only after that evidence will the Abbott extraction plan begin.
