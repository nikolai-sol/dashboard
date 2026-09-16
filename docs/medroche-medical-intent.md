# MedRoche: medical intent and noise

## Definition

For the selected ISO week, classify query facts from canonical Google Search Console and Yandex Webmaster. A category's share is its impressions divided by impressions of all available query rows. Clicks are summed over the same cohort and are not unique users, Metrika visits, or attributed patients.

No attempt is made to classify hidden queries or allocate property-summary totals. One source may be absent. A partial source remains partial. A different-period, missing, failed or invalid source is excluded, never counted as noise. Confirmed-empty query coverage has zero counts; a zero denominator has no percentage.

The SEO tab's GSC period remains independent. The overview performs an additional **canonical MySQL** read for exact-week GSC query dimensions when necessary. Daily property totals from a monthly file cannot supply weekly query intent. Missing weekly imports must be collected/published separately; this change does not initiate collection or replace periods.

Traffic health is the existing **all-traffic** Metrika cohort, not the classified query cohort. Its actual period is displayed separately. Arrows express the desired direction, not measured week-on-week changes.

## Rule catalogue

The request path is now generic. Any registered site/dashboard can expose target intent when that exact server-resolved scope has an active, sealed canonical MySQL publication. A missing catalogue is `not_configured`; invalid import/rule integrity or unavailable selected-week query coverage is `unavailable`. Neither state enables a packaged classifier, source API read, another site's rules, or another period's facts.

The active publication supplies its own label, version, exact/phrase rules and immutable provenance. JSON/Excel/PDF exports retain the label, active version, publication/import identity, source transport and identity, content SHA-256, rule, match type, group, source, impressions and clicks. New observed variants require a reviewed successor publication, not edits to canonical facts.

The overview uses the generic catalogue label and pairs the target-intent goal with the all-traffic health window. It shows impression-weighted target/other shares plus search impressions and clicks for the explicitly selected week. Clicks mean transitions from search and are not users. Two independent native disclosures review only observed rows with positive impressions: one for target-labelled queries and one for all remaining queries. Each disclosure reports its row count, orders rows by impressions descending, clicks descending, query and source, and contains its wide table in a local horizontal scroll frame.

Review pagination is bounded to 100 rows per response. Page and category stay attached to the authenticated, server-resolved site/dashboard scope, selected periods and filters. CSV and Excel downloads contain only the requested category and require the active target-intent publication token; a stale publication returns a conflict instead of mixing versions. CSV string cells are neutralized before spreadsheet use. A missing catalogue says that classification is not configured and does not relabel every query as other; unavailable coverage says classification is temporarily unavailable.

### Canonical migration preview

The MedRoche migration remains preview-only in this change:

- Historical source: owner-provided `med.roche.ru ядро испр 19.09.25.xls`, sheet `Разбивка`.
- Historical evidence: 802 expert rows in 89 groups; workbook SHA-256 `d117d44f24bcee104341096b5e8363ff1cb0fceee150f0af0061264d5867ce54`.
- Frozen seed fixture SHA-256: `d3f360aca52adbd194c5983d9f592384e4f21a9a991838554d038f5ab1040e4d`.
- Reviewed extensions fixture SHA-256: `9081a760d999ef0653f2d957bfd06fc537767a7cd98794fabd159911ee3af214`.
- Deterministic preview: 829 explicit rules; logical rules SHA-256 `4073254e3b1eac365829b63dbd704235e051eadcef3e31228c6e94c82d293b21`.
- Review reference: this section. No catalogue was applied or published.

Emit the deterministic publication preview manifest:

```sh
node --import tsx scripts/site-seo/import-target-intent.ts \
  --profile config/sites/medroche.json \
  --seed scripts/site-seo/fixtures/medroche-intent-expert-seed.json \
  --extensions scripts/site-seo/fixtures/medroche-intent-reviewed-extensions.json \
  --preview
```

The command's `--apply` mode requires a separate explicit `--intent-manifest` (`initial` or `correction`) and deliberately refuses to write; actual application remains the reviewed administrator publication workflow.

## Verification

Tests cover every exact expert query, all 802 queries with additional context, the frozen legacy regression corpus, explicit exact/phrase rules, weighted arithmetic, source failure/partial/empty/missing, exact-week GSC and Webmaster loading, source/publication scope, overview rendering and generic exports. The parity suite passed before the packaged runtime classifier and JSON snapshot were removed; the fixtures above retain their historical provenance.

Task 5 desktop review at 1440px: goal and health are equal 546 × 699px windows on the same row. Both disclosures were open; their table frames were 502px wide with 797px/780px scroll content contained inside the frame. Document width was exactly 1440px with no horizontal overflow. Mobile review at 390px: goal and health are stacked, equal-width 332px windows; the two intent cards remain side by side at 143px each. Table frames were 296px wide with 797px/780px scroll content contained inside the frame. Document width was exactly 390px with no horizontal overflow. Every preview query and identity is explicitly marked `[СИНТЕТИКА]` or `synthetic`.

Visual artifacts:

- `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-desktop-1440.png`
- `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-mobile-390-full.png`
- `/Users/nafanya/.codex/visualizations/2026/09/15/01a0a4b8-e246-7da0-995b-ba42f6c2e778/task-5/target-intent-synthetic.html`

No source API, database migration, collector refresh, production deployment, secret change, scheduler or Telegram action is included.

### Universal review-table evidence — 2026-09-15

- Feature commit: `a46fd4bb9706b42b61ee699101b53eaae810ca75` (`feat(site-seo): add target intent review tables`). Final reviewed source head: `236db55f88aafee975f7cd8cdf102a60fb1ae8df`; both MedRoche profile copies pin this exact clean source commit.
- `npm run test:site-seo`: 198 TypeScript tests + 27 build/isolation tests, 225 passed and zero failed.
- `npm run typecheck:site-seo` and root `npm run typecheck`: passed.
- Root administrator tests: 17 component/state tests + 12 protected route tests, 29 passed and zero failed.
- Root `npm run build`: passed with 28 generated pages and the target-intent administrator routes.
- `node --import tsx scripts/site-seo-build.mjs --site medroche`: passed; the isolated artifact includes the authenticated intent-query route.
- Final standalone artifact smoke on `127.0.0.1:43159`: `/api/health` returned 200 with `site-medroche` and version `2026.09.15-1`; `/dashboard/medroche` returned 200 with the scoped login form. PID 85615 was stopped and the listener closure was verified.
- Independent read-only review found no Critical issue. Its five Important findings (root JSX config regression, CSV formula injection, unreachable not-configured copy, stale publication pagination and loss of the unrelated-dashboard enablement boundary) were reproduced with failing tests and fixed before the evidence above. Both pagination consistency minors were also fixed, including preserving the paginated disclosure on page 1.
- Final read-only re-review of the pinned source head found no remaining Critical or Important issue and verified both TS/MJS profile validators and the exact profile/registry pin.
- Root review remediation makes calculated-share methodology conditional on `ready` and requires an exact non-empty active publication token for ready-catalogue review pagination/downloads. Omitted, empty and stale tokens fail safely; `not_configured` and `unavailable` remain renderable without a publication ID.
- The documentation/profile attestation commit is reported in the Task 5 handoff because a commit cannot embed its own SHA.

### Historical packaged-classifier evidence — 2026-09-15

- Source commit `b50cb39049c3ac3315a4467d5897936382d7cbf2`; MedRoche profile/registry pin in `84e31ff`.
- `npm run test:site-seo`: 161 TypeScript tests + 27 build/isolation tests, 188 passed, zero failures, rerun with worktree-local dependencies.
- `npm run typecheck:site-seo`: passed.
- `node --import tsx scripts/site-seo-build.mjs --site medroche`: standalone build and artifact-policy inspection passed.
- Standalone smoke on an ephemeral loopback port: health 200, site `site-medroche`, profile `2026.09.15-1`; dashboard 200 with login form, no unauthenticated intent data. Test process exited with code 0 and listener closure was verified.
- Initial build using the parent checkout's dependencies compiled but could not start: tracing omitted external dependencies. Installing the locked dependencies inside this worktree with `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` and rebuilding fixed the smoke without source/lockfile changes.
- Independent read-only review found and verified fixes for phrase expansion, overbroad nonmedical exclusions, and failed-source provenance.
- The self-contained HTML preview uses actual updated components and explicitly synthetic facts. Temporary preview and smoke servers were stopped and listener closure verified.
- This evidence belongs to the predecessor packaged classifier. The canonical migration preview above supersedes that runtime path but does not publish a canonical MedRoche catalogue or deploy anything.
