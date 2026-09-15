# MedRoche: medical intent and noise

## Definition

For the selected ISO week, classify query facts from canonical Google Search Console and Yandex Webmaster. A category's share is its impressions divided by impressions of all available query rows. Clicks are summed over the same cohort and are not unique users, Metrika visits, or attributed patients.

No attempt is made to classify hidden queries or allocate property-summary totals. One source may be absent; the UI names the sources actually included and shows coverage. A partial source remains partial. A different-period, missing, failed or invalid source is excluded, never counted as noise. Confirmed-empty query coverage has zero counts; a zero denominator has no percentage.

The SEO tab's GSC period remains independent. The overview performs an additional **canonical MySQL** read for exact-week GSC query dimensions when necessary. Daily property totals from a monthly file cannot supply weekly query intent. Missing weekly imports must be collected/published separately; this change does not initiate collection or replace periods.

Traffic health is the existing **all-traffic** Metrika cohort, not the classified query cohort. Its actual period is displayed separately. Arrows express the desired direction, not measured week-on-week changes.

## Rule catalogue

- Version: `medroche-medical-intent-v1`, activated only by the MedRoche profile.
- Source: owner-provided `med.roche.ru ядро испр 19.09.25.xls`, sheet `Разбивка`.
- 802 queries in 89 expert groups; source SHA-256 `d117d44f24bcee104341096b5e8363ff1cb0fceee150f0af0061264d5867ce54`.
- Snapshot: `apps/site-seo/src/lib/rules/medroche-intent-core.json`. No workbook reads at request time and no historical Wordstat frequencies in current shares.
- Normalization: Unicode NFKC, case, ё/е, punctuation, whitespace, HER-2.
- Matching: exact expert queries, bounded multiword expert phrases, deliberate distinctive stems/drug variants and medical contexts/abbreviations. Generic group labels such as форум or исследование do not become blanket keywords.
- Ambiguous cancer/cooking/astrology and short technical abbreviations have explicit exclusions. Unknown queries are noise under the owner's chosen binary rule.
- The expansion is a deterministic heuristic, not a clinically validated classifier. JSON/Excel/PDF exports retain category, matching reason, group, impressions, clicks, source and rule version for review. New observed variants require a reviewed successor rule version, not edits to canonical facts.

Reproduce the seed into a **new** output file (the importer refuses overwrite):

```sh
node scripts/site-seo/import-medroche-intent-core.mjs "/path/to/med.roche.ru ядро испр 19.09.25.xls" /tmp/medroche-intent-core.json
```

## Verification

Tests cover every exact expert query, all 802 queries with additional context, representative inflections and aliases, nonmedical fragments, weighted arithmetic, source failure/partial/empty/missing, exact-week loading, source/publication scope, overview rendering and exports.

Desktop review at 1440px: goal 640px and health 452px, same top and 322px height; no horizontal overflow. Mobile review at 390px: two intent cards and a two-column health grid; no horizontal overflow. Preview facts are explicitly synthetic.

No source API, database migration, collector refresh, production deployment, secret change, scheduler or Telegram action is included.

### Completed evidence — 2026-09-15

- Source commit `b50cb39049c3ac3315a4467d5897936382d7cbf2`; MedRoche profile/registry pin in `84e31ff`.
- `npm run test:site-seo`: 161 TypeScript tests + 27 build/isolation tests, 188 passed, zero failures, rerun with worktree-local dependencies.
- `npm run typecheck:site-seo`: passed.
- `node --import tsx scripts/site-seo-build.mjs --site medroche`: standalone build and artifact-policy inspection passed.
- Standalone smoke on an ephemeral loopback port: health 200, site `site-medroche`, profile `2026.09.15-1`; dashboard 200 with login form, no unauthenticated intent data. Test process exited with code 0 and listener closure was verified.
- Initial build using the parent checkout's dependencies compiled but could not start: tracing omitted external dependencies. Installing the locked dependencies inside this worktree with `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` and rebuilding fixed the smoke without source/lockfile changes.
- Independent read-only review found and verified fixes for phrase expansion, overbroad nonmedical exclusions, and failed-source provenance.
- The self-contained HTML preview uses actual updated components and explicitly synthetic facts. Temporary preview and smoke servers were stopped and listener closure verified.
- Remaining release step: publish/deploy through the existing MedRoche release workflow. Finished implementation has not yet received owner acceptance; no accepted-work learning update performed.
