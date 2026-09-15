# Task 4 report — canonical SEO read path and MedRoche migration preview

Date: 2026-09-15

## Outcome

Task 4 is implemented locally. The dashboard request path reads one active target-intent catalogue from canonical MySQL for the exact server-resolved `siteId`/`dashboardId`, and `DashboardReadModel.targetIntent` replaces the removed MedRoche runtime classifier. The selected ISO week remains the sole classification period for both GSC and Webmaster query facts, independently of the broader GSC reporting period.

No production access, database migration/application, catalogue publication, external source/API call, deploy, cron change, secret change, or notification occurred.

## RED evidence

The work followed test-first slices:

- DB read tests initially failed because `readTargetIntentData` and the `target_intent` query did not exist (4 failures). A later integrity case failed because a changed validated-import receipt was still accepted.
- Universal read-model tests initially failed in the MedRoche-only `seoRulesVersion` branch (3 failures). A scope-first test also proved the catalogue must not be read before the viewer/profile scope matches.
- The import suite first failed with a missing module, then exposed one normalized duplicate and a missing accepted `TNM pT2N0M0` regression rule before going green.
- Generic export assertions initially found none of the target-intent label/version/provenance/rule/match-type fields.
- The overview compatibility suite initially failed after removal of the old `MedicalIntentView` shape.
- Sequential self-review added a failing test showing that `targetIntent.sources` was retaining the full Webmaster fact payload instead of dataset provenance only.

## GREEN implementation

- `apps/site-seo/src/lib/db.ts` now implements an exact-scope, single active-snapshot MySQL join over active/version/publication/import/rule rows. It returns explicit `ready`, `not_configured`, or `unavailable` states; validates scope and snapshot metadata, sealed state, source SHA shape, rule count, ordinals, normalized identities, match types, and the rule-set hash against the immutable validated import receipt; and never falls back across sites.
- `apps/site-seo/src/lib/read-model.ts` resolves the viewer/profile scope before reads, loads the target catalogue independent of source bindings, issues an extra exact-week GSC read only for a ready catalogue, combines exact-week GSC and Webmaster query facts, preserves source failure/empty/partial/period semantics, and fails the target view closed when no selected-week source is usable.
- `DashboardReadModel.targetIntent` is required and emitted on every runtime load. All isolated component fixture models explicitly carry a `not_configured` state; no old classifier or MedRoche fallback remains at runtime.
- `scripts/site-seo/import-target-intent.ts` emits a deterministic, preview-only MedRoche publication manifest from the frozen 802-row seed and reviewed explicit extensions. `--apply` requires an explicit `--intent-manifest` and deliberately refuses to write, directing application to the reviewed administrator workflow.
- The legacy runtime `apps/site-seo/src/lib/medical-intent.ts`, its test, and its packaged JSON location were removed only after parity passed. The historical rows now live only as a migration fixture.
- Generic export rows used by Excel and PDF contain target label/state/version, full publication/import/source/SHA provenance, source coverage, category, matched rule, match type, group, impressions, and clicks. The authenticated JSON response exposes the same generic `targetIntent` model and no legacy `intent` key.
- Minimum compatibility edits in `MedicalIntentPanel`, `Overview`, their test, and `auth.test.ts` consume the generic model without implementing the Task 5 visual redesign. The legacy data attribute remains only as a CSS layout hook; it does not select or run a MedRoche classifier.

## MedRoche preview manifest evidence

Command:

```sh
node --import tsx scripts/site-seo/import-target-intent.ts \
  --profile config/sites/medroche.json \
  --seed scripts/site-seo/fixtures/medroche-intent-expert-seed.json \
  --extensions scripts/site-seo/fixtures/medroche-intent-reviewed-extensions.json \
  --preview
```

Deterministic summary:

- status: `preview`
- preview only: `true`
- scope: `site-medroche` / dashboard `41`
- label: `Мед. интент`
- rule count: `829`
- match types: `phrase`, `exact`
- logical rules SHA-256: `4073254e3b1eac365829b63dbd704235e051eadcef3e31228c6e94c82d293b21`
- historical workbook SHA-256: `d117d44f24bcee104341096b5e8363ff1cb0fceee150f0af0061264d5867ce54`
- seed fixture SHA-256: `d3f360aca52adbd194c5983d9f592384e4f21a9a991838554d038f5ab1040e4d`
- reviewed extensions fixture SHA-256: `9081a760d999ef0653f2d957bfd06fc537767a7cd98794fabd159911ee3af214`
- historical expert rows/groups: `802` / `89`

The parity proof covers every expert row as an exact query, every expert row inside accepted additional context, and the frozen 52-case target/other regression corpus. It passed before deletion of the legacy runtime module and packaged JSON.

## Verification

- Source commit: `3eae3a2b8b3002ffdb528781de030d6e2c8843f5` (`feat(site-seo): read canonical target intent`).
- MedRoche profile and registry both pin `templateVersion` to that exact source commit; the attestation commit containing this report is reported in the final handoff because a commit cannot contain its own hash.
- Focused Task 4 suite: 59/59 passed.
- Full `npm run test:site-seo`: 178 TypeScript tests + 27 build/isolation tests = 205 passed, zero failures.
- `npm run typecheck:site-seo`: passed.
- `node --import tsx scripts/site-seo-build.mjs --site medroche --dry-run`: passed the exact source/profile/registry attestation gate.
- Isolated production compile with `SITE_SEO_BUILD_OUTPUT_DIR=.next-task4-compile-check`: Next.js compiled, typechecked, generated pages, and collected traces successfully. The task-owned output was removed and the pre-existing `.next-medroche` directory was not modified by this check.
- `git diff --check`: passed before source commit and before attestation.

## Sequential self-review

1. Scope/integrity review: confirmed the SQL predicate uses only the requested site/dashboard, includes no fallback or source credentials, preserves all ordered rules, and compares persisted rules with the validated import receipt. Corrected unavailable `versionId` to `null`.
2. Read-model review: confirmed the profile/viewer claim is rejected before the catalogue read; monthly GSC remains the SEO view; selected-week GSC and Webmaster are the only classification facts. Removed the accidental full Webmaster payload copy from source provenance.
3. Migration review: confirmed 802 historical rows, 89 groups, both match types, deterministic manifest/SHA values, explicit owner-intent requirement for apply, and no write connector.
4. Runtime-removal/export review: confirmed no runtime import of `medical-intent.ts` or the packaged JSON remains, and JSON/Excel/PDF expose generic target-intent evidence.
5. Regression/build review: ran focused, full, typecheck, attestation dry-run, and isolated compile checks after the fixes.

## Independent review correction

An independent Task 4 review identified three important defects and one minor contract gap. Each was reproduced before its fix:

- RED: a valid catalogue whose MySQL `DATETIME(6)` values arrived as `Date` objects returned `unavailable`; equal Date instances were rejected by string/reference checks. GREEN: timestamps now normalize from `Date|string` to an ISO instant, equal instants are accepted, differing instants fail closed, and the exported publication timestamp is canonical ISO text.
- RED: a monthly GSC publication pin was silently reused for the additional ISO-week read, producing no target impressions (`null` instead of `25`). GREEN: the broader SEO GSC view keeps its explicit publication while the distinct selected-week query read passes `publicationId: null`, allowing the canonical exact-period query to resolve its own weekly publication. The test asserts weekly provenance `weekly-query-publication` and no reuse of the monthly pin.
- RED: an import receipt `rule_count` mismatch still returned `ready`. GREEN: the canonical join now reads `imported.rule_count AS import_rule_count` and requires equality with both the sealed version count and persisted/validated rule rows.
- RED: making `DashboardReadModel.targetIntent` required exposed all legacy fixture constructors at compile time. GREEN: every dashboard fixture now supplies an explicit target-intent state, the component no longer has optional guards, and site-seo typecheck passes.

Focused review-fix verification passed 71/71 component/read-path tests plus site-seo typecheck. The replacement source and attestation commit hashes, and the final full-suite/build evidence, are recorded in the final handoff; they supersede the first source/attestation pair above.

## Residuals and preserved state

- The preview was not applied. Until an administrator publishes a canonical MedRoche catalogue, the MedRoche runtime correctly reports `not_configured` rather than using the historical packaged classifier.
- The profile's historical `seoRulesVersion` field and the old one-off XLS conversion script remain as inert compatibility/history; runtime target-intent selection does not read them.
- The unrelated modified `.superpowers/sdd/task-1-report.md` and pre-existing untracked `apps/site-seo/.next-medroche/` were preserved and excluded from both commits.
