# Universal target-intent rules implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MedRoche-specific runtime classifier with an administrator-managed, site-scoped and versioned target-intent catalogue usable by every SEO dashboard.

**Architecture:** Canonical MySQL stores immutable previews, versions, rules and one active pointer per site. The existing central admin accepts protected Excel/CSV uploads and manually refreshed Google Sheets, previews them, then atomically publishes a full replacement. Standalone SEO dashboards read only the active canonical rules and selected-week query facts; review disclosures expose the target and unmatched observed queries.

**Tech Stack:** MySQL 8, TypeScript, Next.js 16 App Router, React 19, SheetJS, node:test.

## Global constraints

- Publication fully replaces a site's active rules; it never appends.
- Previous versions remain immutable and restorable as a new version.
- `Ключ` and `Тип совпадения` are required; `Группа` is optional; match type is `точное` or `фраза`.
- Normalization is NFKC, lowercase, `ё → е`, punctuation/hyphen to boundaries and collapsed whitespace.
- Exact means whole normalized query equality; phrase means a complete normalized token sequence.
- No fuzzy matching, generated synonyms, hidden stemming or source-file reads during dashboard requests.
- A missing active version is “Классификация не настроена”, never 100% other queries.
- Admin operations require a verified administrator session and server-resolved dashboard/site scope.
- Dashboard render/filter/export reads canonical MySQL only and never calls Google Sheets or source APIs.
- No production migration, import, deploy, secret, scheduler or collector action is part of implementation verification.

---

### Task 1: Canonical rule model and deterministic classifier

**Files:**
- Create: `src/db/migrations/066_site_seo_target_intent.sql`
- Create: `src/db/site-seo/target-intent-contract.test.ts`
- Create: `packages/site-seo-contract/src/target-intent.ts`
- Modify: `packages/site-seo-contract/src/index.ts`
- Create: `apps/site-seo/src/lib/target-intent.ts`
- Create: `apps/site-seo/src/lib/target-intent.test.ts`

**Interfaces:**
- Produces `TargetIntentRule { key, normalizedKey, group, matchType }`.
- Produces `TargetIntentRuleSet { siteId, dashboardId, versionId, label, state, rules, provenance }`.
- Produces `normalizeIntentKey()`, `classifyTargetIntentQuery()`, and `buildTargetIntentView()`.

- [ ] Write a migration-contract test asserting immutable preview/version/rule/publication tables, site-scoped unique keys, foreign keys, active pointer, audit fields and repeat-safe DDL.
- [ ] Run `node --import tsx --test src/db/site-seo/target-intent-contract.test.ts`; expect failure because migration 066 is absent.
- [ ] Add migration 066 with `site_seo_intent_imports`, `site_seo_intent_versions`, `site_seo_intent_rules`, `site_seo_intent_active` and `site_seo_intent_publications`. Use composite site/version identities and one active row per `site_id,dashboard_id`.
- [ ] Run the migration-contract test; expect pass.
- [ ] Write classifier tests for NFKC/case/ё/hyphen normalization, exact versus token-bounded phrase behavior, no fuzzy/stemming, deterministic ordering, missing rule set and impression-weighted totals.
- [ ] Run `node --import tsx --test apps/site-seo/src/lib/target-intent.test.ts`; expect module/export failures.
- [ ] Implement contract types and pure classifier functions. An absent active catalogue returns `state: "not_configured"`; invalid rule integrity returns `state: "unavailable"`.
- [ ] Re-run both Task 1 tests; expect pass.
- [ ] Commit: `git commit -m "feat(site-seo): add canonical target intent contract"`.

### Task 2: Preview, publish, history and restore service

**Files:**
- Create: `src/lib/site-seo-intent-import.ts`
- Create: `src/lib/site-seo-intent-import.test.ts`
- Create: `src/lib/site-seo-intent-store.ts`
- Create: `src/lib/site-seo-intent-store.test.ts`
- Create: `src/app/api/admin/dashboards/[id]/target-intent/route.ts`
- Create: `src/app/api/admin/dashboards/[id]/target-intent/preview/route.ts`
- Create: `src/app/api/admin/dashboards/[id]/target-intent/publish/route.ts`
- Create: `src/app/api/admin/dashboards/[id]/target-intent/restore/route.ts`
- Create: `src/app/api/admin/dashboards/[id]/target-intent/route.test.ts`

**Interfaces:**
- `parseTargetIntentWorkbook(bytes, filename)` returns validated logical rows or row-level errors.
- `previewTargetIntent(input, deps)` accepts upload bytes or a normalized Google Sheets URL and returns an immutable preview receipt.
- `publishTargetIntent(previewId, label, actor, deps)` atomically creates a full replacement version and active pointer.
- `restoreTargetIntent(versionId, actor, deps)` copies a historical snapshot into a newly published version.

- [ ] Write parser tests using in-memory XLSX and CSV fixtures for accepted Russian columns, both match types, optional group, exact duplicate, normalized duplicate, conflict, unknown column, empty file and size limit.
- [ ] Run the parser tests; expect failure because the import module is absent.
- [ ] Implement bounded file parsing and the shared logical validation result. Macros and executable workbook content are not evaluated.
- [ ] Write service/store tests proving protected source evidence, Google Sheets manual snapshot semantics, idempotent preview, full replacement, transactional locking, failed publish rollback, immutable history and restore-as-new-version.
- [ ] Run service/store tests; expect missing implementations.
- [ ] Implement the store with injected MySQL connection and transport dependencies. Reuse established Google Sheets URL normalization and protected upload patterns without entering the advertising-fact queue.
- [ ] Write route tests proving admin cookie validation, positive dashboard ID, `site_seo` dashboard scope, safe errors and inability to supply another site/version/artifact identity.
- [ ] Run route tests; expect missing routes.
- [ ] Implement GET state/history, POST preview, publish and restore routes. Resolve actor and dashboard scope server-side.
- [ ] Re-run Task 2 tests; expect pass.
- [ ] Commit: `git commit -m "feat(admin): add target intent publication workflow"`.

### Task 3: Universal administrator UI

**Files:**
- Create: `src/app/admin/dashboards/[id]/target-intent/page.tsx`
- Create: `src/components/admin/DashboardTargetIntentScreen.tsx`
- Create: `src/components/admin/DashboardTargetIntentScreen.test.tsx`
- Modify: `src/app/admin/dashboards/[id]/edit/page.tsx`
- Modify: `src/lib/admin-ui-types.ts`

**Interfaces:**
- The page receives only `dashboardId`; the client screen loads canonical state through Task 2 APIs.
- UI state distinguishes source selection, validating, preview-ready, publishing, active, failed and restore-confirmation.

- [ ] Write rendering/source tests asserting an SEO dashboard edit link, target label control, upload and Google Sheets modes, manual **Проверить источник**, preview counts/errors, disabled publication on validation errors, history and restore.
- [ ] Run `node --import tsx --test src/components/admin/DashboardTargetIntentScreen.test.tsx`; expect failure because the screen does not exist.
- [ ] Implement the page and client screen using existing admin card/button/input patterns. Convert selected files to bounded base64 only for the protected preview endpoint.
- [ ] Add the **Целевой интент** link to dashboard edit navigation and keep it absent or disabled with a clear message for non-SEO dashboards.
- [ ] Add an explicit typed confirmation for publish/restore describing that the full active catalogue will be replaced; retain the active version on any error.
- [ ] Re-run Task 3 tests and the existing admin/auth tests; expect pass.
- [ ] Commit: `git commit -m "feat(admin): add target intent management screen"`.

### Task 4: Canonical SEO read path and MedRoche migration

**Files:**
- Modify: `apps/site-seo/src/lib/db.ts`
- Modify: `apps/site-seo/src/lib/db.test.ts`
- Modify: `apps/site-seo/src/lib/read-model.ts`
- Modify: `apps/site-seo/src/lib/read-model.test.ts`
- Modify: `apps/site-seo/src/lib/exports.ts`
- Modify: `apps/site-seo/tests/exports.test.ts`
- Create: `scripts/site-seo/import-target-intent.ts`
- Create: `scripts/site-seo/import-target-intent.test.ts`
- Modify: `config/sites/medroche.json`
- Modify: `config/sites/registry.json`
- Remove after parity: `apps/site-seo/src/lib/medical-intent.ts`
- Remove after parity: `apps/site-seo/src/lib/rules/medroche-intent-core.json`

**Interfaces:**
- `CanonicalReadQuery` gains `name: "target_intent"`.
- `readTargetIntentData()` returns the server-scoped active rule set or not-configured/unavailable state.
- `DashboardReadModel.targetIntent` replaces the MedRoche-only optional `intent`.
- Import CLI previews the MedRoche seed/extensions and emits a publication manifest; applying it requires an explicit intent manifest and is outside ordinary dashboard reads.

- [ ] Write DB tests asserting one active site/dashboard version, ordered rules, integrity failure when rule counts/hash differ and no cross-site fallback.
- [ ] Run focused DB tests; expect no target-intent query implementation.
- [ ] Implement canonical rule reads using registration scope and MySQL only.
- [ ] Write read-model tests proving exact-week GSC/Webmaster classification remains independent of the SEO GSC period for any configured site and missing catalogue does not enable the feature.
- [ ] Run read-model tests; expect the MedRoche-specific path to fail the universal assertions.
- [ ] Replace `seoRulesVersion === medroche...` branching with canonical active-rule state. Keep existing source-period and failure semantics.
- [ ] Write/import parity fixtures from the current 802 expert rows and reviewed extensions, including current medical regression cases. Prove the preview contains explicit exact/phrase rows and matches the accepted classifier corpus.
- [ ] Run the import in preview-only fixture mode. Do not connect to production or publish.
- [ ] Extend JSON/Excel/PDF exports with generic label, active version, source provenance, rule and match type.
- [ ] Only after parity tests pass, remove runtime imports of the packaged medical classifier and JSON. Retain historical source SHA in the migration manifest/docs.
- [ ] Re-run Task 4 tests; expect pass.
- [ ] Commit source changes, then update MedRoche profile/registry `templateVersion` to that exact source commit in a second attestation commit.

### Task 5: Review disclosures, tables, downloads and release verification

**Files:**
- Replace: `apps/site-seo/src/components/MedicalIntentPanel.tsx` with `apps/site-seo/src/components/TargetIntentPanel.tsx`
- Create: `apps/site-seo/src/components/IntentQueryDisclosures.tsx`
- Modify: `apps/site-seo/src/components/Overview.tsx`
- Modify: `apps/site-seo/src/app/globals.css`
- Create: `apps/site-seo/tests/target-intent-panel.test.ts`
- Modify: `apps/site-seo/src/lib/route-handlers.ts`
- Modify: `docs/medroche-medical-intent.md`
- Modify: `docs/superpowers/plans/2026-09-15-universal-target-intent.md`

**Interfaces:**
- `IntentQueryDisclosures({ view })` renders two independent native disclosures with query count and accessible tables.
- Export handlers filter by selected period/category and preserve the active publication ID.

- [x] Write component tests asserting the status sentence is absent; both links include positive-impression row counts; each disclosure table has required columns; zero-impression rows are excluded; sorting is impressions, clicks, query, source; not-configured copy is truthful.
- [x] Run the component test; expect failures against the current MedRoche panel.
- [x] Implement the generic panel and two independent native `details/summary` link-style disclosures so server rendering and accessibility work without client state.
- [x] Add pagination/download behavior using bounded query parameters and current server-resolved period/category. Preserve dashboard authorization and source scope.
- [x] Re-run component, route and export tests; expect pass.
- [x] Run `npm run test:site-seo`, `npm run typecheck:site-seo`, root admin tests covering new routes/components and `npm run build`; expect zero failures.
- [x] Build MedRoche through `node --import tsx scripts/site-seo-build.mjs --site medroche` and run an ephemeral standalone health/login smoke. Stop and verify the owned process exits.
- [x] Visually verify desktop at 1440px and mobile at 390px: goal/health pairing, disclosures, wide-table containment and no horizontal page overflow. Use synthetic labeled facts only.
- [x] Request independent read-only code review; fix Critical and Important findings with failing tests first.
- [x] Record exact test/build/smoke evidence, final commit IDs and explicit non-deployment status in documentation.
- [x] Commit: `git commit -m "feat(site-seo): add target intent review tables"`.

Task 5 feature commit is `a46fd4bb9706b42b61ee699101b53eaae810ca75`; reviewed source head `96ab3e4f66e7899e980340fe7c7f5c256407e163` fixes the explicit enablement boundary and preserves the paginated disclosure. Full RED/GREEN, review, build, standalone-smoke and synthetic visual evidence is recorded in `.superpowers/sdd/task-5-report.md`. The documentation/profile attestation commit is reported in the final handoff because a commit cannot contain its own SHA. No production action occurred.

## Self-review

- Spec coverage: upload and Google Sheets, manual snapshot, complete replacement, version history/restore, configurable label, exact/phrase rules, admin authorization, canonical-only reads, review tables/downloads, missing-state semantics, migration/parity and verification are each assigned.
- No placeholders or deferred implementation wording remain.
- Type flow is consistent: import creates immutable `TargetIntentRuleSet`; canonical reader returns it; the read model produces `TargetIntentView`; UI and exports consume that view.
- Production migration/import/deployment remain separate owner-authorized release actions.
