# MedRoche medical intent implementation plan

**Goal:** Implement the accepted overview: impression-weighted medical intent/noise with impressions and clicks, beside traffic health.

**Architecture:** A versioned local rule catalogue classifies canonical query facts. The read model requests exact selected-week GSC queries independently of the SEO tab's month selector, and combines them with same-week Webmaster queries. No collector, source API, migration or production deployment.

**Tech stack:** TypeScript, React, canonical MySQL, node:test.

## Constraints

- Source workbook is rule seed only; historical Wordstat frequency never enters current metrics.
- Missing/failed/different-period queries are excluded and disclosed, never treated as noise or zero.
- Shares describe available query impressions, not all organic visitors. Clicks are not unique users.
- Existing generic dashboards, independent GSC/AI periods, and canonical scope boundaries remain intact.

## Execution checklist

- [x] Import all 802 queries / 89 groups with source hash using a reproducible XLS importer.
- [x] Test and implement normalized exact matches, distinctive word-boundary expansions, ambiguous-context exclusions, and auditable reasons.
- [x] Test and implement same-period impression-weighted aggregation; preserve partial, missing, failed, confirmed-empty and zero-denominator semantics.
- [x] Test and wire MedRoche-only read-model weekly query loading without altering SEO-tab GSC.
- [x] Implement accepted overview cards and scoped responsive CSS; export weekly metrics and rule provenance.
- [x] Run complete site-seo tests, typecheck, build and desktop/mobile visual review of actual updated components.
- [x] Record evidence and leave deployment status explicit.

## Files and interfaces

- `scripts/site-seo/import-medroche-intent-core.mjs`: XLS → versioned `apps/site-seo/src/lib/rules/medroche-intent-core.json`, inside the attested template source.
- `apps/site-seo/src/lib/medical-intent.ts`: `classifyMedicalQuery(query)` → category/reason/group; `buildMedicalIntent({period,gsc,webmaster})` → source coverage, two aggregate cards and query-level audit.
- `apps/site-seo/src/lib/read-model.ts`: optional `intent` field activated by profile `seoRulesVersion`.
- `apps/site-seo/src/components/MedicalIntentPanel.tsx`, `Overview.tsx`, `app/globals.css`: accepted first-page layout, without invented trends.
- `apps/site-seo/src/lib/exports.ts`: include selected-week intent and classification evidence.

Verification command: `npm run test:site-seo && npm run typecheck:site-seo`. Use existing dependencies; test before implementation for each behavioral unit. Render desktop and mobile with both available and missing sources.

Completed locally on 2026-09-15. Evidence is recorded in `docs/medroche-medical-intent.md`. No deployment performed.
