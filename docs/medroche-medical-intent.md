# MedRoche: medical intent and noise

## Definition

For the selected ISO week, classify query facts from canonical Google Search Console and Yandex Webmaster. A category's share is its impressions divided by impressions of all available query rows. Clicks are summed over the same cohort and are not unique users, Metrika visits, or attributed patients.

No attempt is made to classify hidden queries or allocate property-summary totals. One source may be absent; the UI names the sources actually included and shows coverage. A partial source remains partial. A different-period, missing, failed or invalid source is excluded, never counted as noise. Confirmed-empty query coverage has zero counts; a zero denominator has no percentage.

The SEO tab's GSC period remains independent. The overview performs an additional **canonical MySQL** read for exact-week GSC query dimensions when necessary. Daily property totals from a monthly file cannot supply weekly query intent. Missing weekly imports must be collected/published separately; this change does not initiate collection or replace periods.

Traffic health is the existing **all-traffic** Metrika cohort, not the classified query cohort. Its actual period is displayed separately. Arrows express the desired direction, not measured week-on-week changes.

## Rule catalogue

The request path is now generic. Any registered site/dashboard can expose target intent when that exact server-resolved scope has an active, sealed canonical MySQL publication. A missing catalogue is `not_configured`; invalid import/rule integrity or unavailable selected-week query coverage is `unavailable`. Neither state enables a packaged classifier, source API read, another site's rules, or another period's facts.

The active publication supplies its own label, version, exact/phrase rules and immutable provenance. JSON/Excel/PDF exports retain the label, active version, publication/import identity, source transport and identity, content SHA-256, rule, match type, group, source, impressions and clicks. New observed variants require a reviewed successor publication, not edits to canonical facts.

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

Desktop review at 1440px: goal 640px and health 452px, same top and 322px height; no horizontal overflow. Mobile review at 390px: two intent cards and a two-column health grid; no horizontal overflow. Preview facts are explicitly synthetic.

No source API, database migration, collector refresh, production deployment, secret change, scheduler or Telegram action is included.

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
