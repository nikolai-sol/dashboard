# Lysobact Regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated authorized 85-region source/signal and campaign-status module without altering existing report tables or calculations.

**Architecture:** Dedicated page/API and additive MySQL tables. Existing dashboard authentication is reused. Parent coordinates separate data and geometry workers; UI lead owns routes/components/navigation.

**Tech Stack:** Next.js 16, React 19, TypeScript, mysql2, existing Node/tsx tests and SVG map.

## Global Constraints

No live DB/API/deployment operations. No runtime source JSON/Sheets reads. Null is unknown. User-visible Russian copy. Source periods/quality retained. Clock 11:20:13–12:20:13 UTC on 2026-10-06; parent owns checkpoint.

### Task 1: Dedicated data module (data worker)
Files: `src/lib/lyzobact-regions-types.ts`, `lyzobact-regions-store.ts`, `lyzobact-regions-import.ts`, matching tests, additive migration, offline importer and reviewed fixtures.
Interface: `loadRegionalModule(dashboardId:number,snapshotId?:string):Promise<RegionalModuleData>` and `isRegionalModuleEnabled(dashboardId:number):Promise<boolean>`.
`RegionalModuleData`: dashboardId, snapshots [{id,label,checkedAt}], selectedSnapshotId nullable, rows. `RegionalRow`: regionKey,name,period,publicationDate,checkedAt,cases,reportedWowPct,calculatedWowPct,sourceUrl,sourceQuality,geography,notes,campaignStatus(active/inactive/unknown),campaignStatusAt,wordstatWowPct,temperatureC. Missing values null.
- [ ] Test duplicate/missing region keys, invalid numeric/period values, explicit nulls and idempotency before implementing importer.
- [ ] Test SQL reader against injected executor: scoped dashboard/snapshot only, disabled-module rejection and unavailable tables explicit.
- [ ] Implement minimal additive tables/importer/reader; no shared-table ALTER.
- [ ] Run `node --import tsx --test src/lib/lyzobact-regions-*.test.ts` and report red/green evidence.

### Task 2: Authorized module and opt-in link (UI lead)
Files: `src/app/api/dashboard/[id]/regions/route.ts`, matching tests; `src/app/dashboard/[id]/regions/page.tsx`; `src/components/lyzobact/*`; one opt-in navigation addition in existing dashboard page only.
- [ ] Failing tests: no data read on 401/404; disabled feature 404; snapshot IDs validated; private no-store; valid response only after authorization.
- [ ] Implement route factory dependency injection and gate using existing access API.
- [ ] Failing helper tests: null→unknown; positive/negative/zero distinct; historical never painted current; campaign mode independent from epidemic change; safe auth navigation preserves only existing accepted parameters.
- [ ] Build Russian map/list/detail/snapshot controls, empty/error/login states and opt-in link. Reuse existing login gate; no new auth mechanism.
- [ ] Run focused tests plus existing dashboard route/canonical-only tests; typecheck/lint/build once all workers finish.

### Task 3: Geometry and review (geometry worker, parent)
Files: `public/lyzobact/regions.geojson`, geometry mapping/provenance/test (coordinate ownership with lead).
- [ ] Obtain actual polygons from primary provider, record license and region mapping.
- [ ] Assert exact 85 unique keys and valid nonempty polygon geometry; no city-marker substitution.
- [ ] Render local fixture preview with clearly dated review data, inspect both map modes and details; no live DB calls.
- [ ] Parent reviews diff, tests, boundary invariants and preview. Seal candidate, report prepared/not deployed.

Access refinement: public dashboard contexts and embed audiences are rejected; explicit opt-in is checked before facts. Data contract also retains nullable casesPrior.
