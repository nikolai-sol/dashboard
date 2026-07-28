# RD-01 pre-deploy audit and correction plan

**Goal:** Close the five documented mismatches between the RD-01 Design Specification, Implementation Report, and the current Zaruku dashboard implementation before deployment.

**Scope guard:** Work only in the Zaruku dashboard UI, its tests, and RD-01 documentation. Do not change APIs, collectors, cron, database migrations, deployment configuration, Abbott/RD-05, drag-and-drop/RD-04, or start RD-03. Treat `hidden` as frontend-only until RD-02.

## Task 1: Collapse all-empty sections once

**Files:**
- Create: `src/components/ZarukuSectionState.tsx`
- Create: `src/components/ZarukuSectionState.test.ts`
- Modify: `src/components/ZarukuContentTab.tsx`

1. Add a failing test proving that a section with only `empty`/`hidden` panels renders one quiet message, not one message per panel.
2. Add a mixed-state test proving that a section with one renderable panel keeps its normal children.
3. Implement the smallest section-level state boundary and wrap the content-panel group.
4. Run the focused tests, then the Zaruku test subset.

## Task 2: Audit and simplify client-facing copy

**Files:**
- Create: `src/components/zaruku-client-copy.ts`
- Create: `src/components/zaruku-client-copy.test.ts`
- Modify: `src/components/ZarukuPanelState.tsx`
- Modify: `src/components/ZarukuContentTab.tsx`
- Modify: `src/components/ZarukuQualityTab.tsx`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: relevant Zaruku table/panel files identified by the audit

1. Add a failing contract test for the required copy inventory and the prohibited client terms: `grain`, `canonical`, `collector`, `dataset_meta`, `fallback`, `partial`.
2. Centralize the audited empty-state, disabled-calendar, technical-tail, and completeness strings with a `client` verdict.
3. Replace technical wording in visible Quality, Content, GSC, AI, and semantic empty states with plain Russian.
4. Ensure partial-state UI formats its own plain-language completeness message instead of exposing backend metadata text.
5. Run the copy contract and affected component tests.

## Task 3: Enforce the RD-01 typography contract

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: Zaruku KPI components that render primary numeric values
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

1. Add failing assertions for a Zaruku-scoped typography root, serif headings, serif tabular KPI values, and sans `13px/1.4` uppercase muted table headers.
2. Add scoped typography tokens/selectors without changing non-Zaruku surfaces.
3. Mark all primary numeric KPI values with the shared class.
4. Run focused UI/source tests and verify computed styles in the browser matrix.

## Task 4: Make A/B week-selection types explicit

**Files:**
- Modify: `src/lib/zaruku-seo-week-selection.ts`
- Modify: `src/lib/zaruku-seo-week-selection.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`

1. Add failing tests for the explicit A/B slot-to-field mapping.
2. Export explicit slot, mode, and selection types instead of relying on `keyof` and an untyped boolean-only concept.
3. Use the explicit comparison mode in dashboard state while preserving the existing toolbar API.
4. Run the focused selection tests and TypeScript check.

## Task 5: Close the literal-color criterion deliberately

**Files:**
- Create: `src/components/zaruku-color-contract.test.ts`
- Modify: `docs/zaruku-dashboard-design-spec.md`
- Modify: `docs/zaruku-dashboard-implementation-report.md`
- Update: Notion Design Specification and Implementation Report

1. Inventory every remaining raw hex/rgb literal under `src/components`.
2. Add a guard that rejects literals in Zaruku runtime components.
3. Keep justified non-Zaruku product/admin/platform-brand literals out of RD-01 scope and list them explicitly.
4. Narrow the Design Specification criterion to Zaruku runtime components and record the rationale.
5. Run the full suite, typecheck, lint, build, and responsive browser verification.
6. Update Notion with the verified implementation status, copy audit, typography decision, A/B typing, color inventory, and exact validation evidence.

## Completion gate

Deployment remains blocked until Tasks 1–3 pass. Completion requires clean focused tests, the full test suite, typecheck, build, lint with no new errors, and a final working-tree diff review. No deployment is part of this plan.
