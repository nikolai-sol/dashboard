# Abbott native source options implementation plan

The owner approved the concrete correction on 2026-10-14: retain only native Metrica values from the displayed dataset and remove our source translations/aliases. This follows the read-only diagnosis and requires no new design approval.

**Goal:** source dropdowns and labels match the actual canonical table population without changing facts or totals.
**Architecture:** reuse the existing summary population selector; build source options from its output. The shared source-label helper returns native values. Keep exact raw filter identities, including `undefined` and custom sources. Clear a stale source selection only when its loaded active report no longer contains it; pending/inactive lazy views must not reset filters.
**Stack:** existing React/TypeScript and node:test/tsx. No dependencies, schema, API, collector or reader changes.

## Scoped steps

- [x] RED: change source display regressions to native values; test selected-population options, duplicate removal, unknown values, exact stale-selection reset and unchanged totals. Update existing UI wiring test to require selected rows and loaded-view reset guards.
- [x] GREEN: remove only traffic-source custom translations; add small pure option/selection helpers; move summary selection before option derivation; wire effective source filters and loaded-view reset.
- [ ] Verify focused tests, existing manager/embed/privacy contract tests, type/build gate supplied by operations; clean diff and commit.
- [ ] Independent review exact candidate, then operations handles isolated Abbott build/deployment and smoke. No deployment by implementer.

Files: `src/components/abbott-localization.ts` and its tests; `AbbottBiDashboard.tsx` and UI tests; source-option tests reuse existing `abbott-summary.ts` selector. No underlying aggregation changes. Provider-native English/code values are deliberately exempt from translated general UI copy.
