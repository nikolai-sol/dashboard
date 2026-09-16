# Universal target intent: final review fixes

Date: 2026-09-15

Source commit: `54b9f5bfc7afd1d2597d5d6cca05e36e5a64bdd5` (`fix(site-seo): close target intent final review findings`).
The separate attestation commit containing this report pins both MedRoche profile copies to that exact source commit; its own hash is reported in the handoff because a commit cannot contain its own hash.

## Findings resolved

1. Runtime reads active/version/publication/import metadata and the validation receipt once, then ordered rules for the captured site/dashboard/version. Production acquires one connection and releases it in `finally`; sealed rules are immutable, so a concurrent publication cannot change the captured snapshot. The publication must reference the version's exact import. Left joins keep broken linkage visible as unavailable, instead of mistaking it for no active pointer. The 10,000-rule regression verifies two reads, one validation payload, exact parameters, connection cleanup and a combined serialized fixture below 5 MB. No receipt/rule Cartesian multiplication remains.
2. Imports, publication validation, runtime integrity, migration-preview normalization and observed-query classification use the shared contract normalizer. NFKC precedes lowercase and yo folding; remaining non-letter/non-number runs become boundaries. Zero-width and noncomposing combining-mark cases survive parser-to-runtime integrity/hash comparison. Canonical classification is shared too, preserving exact/phrase and deterministic precedence. Preview identity was advanced to v2 to avoid reusing a v1 validation receipt after normalization changed.
3. Preview tracks whether COMMIT has been attempted. Once it begins, unknown acknowledgement outcomes retain protected evidence. The injected lost-ack regression models a committed row, confirms the original artifact survives, and proves a retry returns the same receipt and discards only its new unreferenced artifact. Definitive connection/write failures before COMMIT retain existing cleanup behavior.
4. Preview checks rule key and normalized key at 512 Unicode characters and group at 255, returning row/column errors. Tests cover exact boundaries, overflow after normalization/lowercase expansion, supplementary Unicode and restore of an accepted 512-character supplementary key. Store text limits now use MySQL character semantics instead of UTF-16 units.
5. CSV previews expose actual UTF-8 encoding and parser-selected delimiter (comma, semicolon, tab or pipe). Admin previews separately label source-rule examples and observed-query matches. Each source samples at most 100 positive-impression canonical queries and renders at most eight actual matches, with period and sample count. GSC uses its latest published ISO-week query import in the default all-country/all-device web-search scope; Webmaster uses the exact server-registered account/host and seven canonical days ending at its latest query fact date. Read failures and empty samples are distinct. Samples are persisted in immutable validation evidence, so retries cannot change them. The API accepts no client-supplied site/account/period and the UI explicitly states independent periods and unverified weekly completeness.

## RED evidence

`src/lib/site-seo-intent-final-regressions.test.ts`, before production edits: 4/4 failed as expected (missing acquired split read; `рак\u200b` normalization mismatch; oversized key incorrectly valid; committed evidence removed after lost acknowledgement).

Additional focused REDs:

- CSV metadata: `undefined` instead of UTF-8.
- Observed-query reader: missing implementation; UI lacked delimiter and observed-match section.
- Immutable sample projection: retry omitted CSV metadata/sample receipt.
- GSC sample filter: empty-filter hash differed from the existing dashboard's all-country/all-device web-search hash; corrected before final verification.
- Supplementary Unicode restore: a preview-valid 512-character key failed the store's UTF-16 length check; corrected to Unicode character counting.

The pre-commit full SEO run had 198/198 TypeScript tests passing and four expected build-policy failures because the changed source was still dirty and the profile pinned the previous commit. After source commit and exact profile pin, all 225 tests passed.

## GREEN verification

- Focused importer/store/new regressions/observed/UI batch: 65 tests, 63 passed, 0 failed, 2 existing Linux-only protected-spool skips.
- Admin route file executed directly (avoids Node 25 treating literal `[id]` as a glob): 13/13 passed, including metadata/sample projection and rejection of client scope/period.
- `npm run test:site-seo`: 198 TypeScript + 27 build/isolation tests, all passed.
- Final `npm test`: 1,054 Node tests, 1,042 passed, 0 failed, 12 skipped; 13 Python tests passed.
- `npm run typecheck` and `npm run typecheck:site-seo`: passed.
- Focused ESLint on changed production code: passed with no output.
- Root `npm run build`: compiled/typechecked and generated all 28 pages.
- Isolated SEO webpack production build into owned `.next-final-review-check`: compiled/typechecked, generated three static pages and traced the standalone, including the intent-query endpoint.
- `node --import tsx scripts/site-seo-build.mjs --site medroche --dry-run`: passed with source `54b9f5bfc7afd1d2597d5d6cca05e36e5a64bdd5` and matching registry/profile.
- `git diff --check` and staged diff check: passed.

## Standalone smoke and cleanup

The isolated output received the current registration through the existing build helper and ran with an explicit local-only environment (no database or source credentials). Owned PID `16446`, loopback port `43161`:

- `/api/health`: HTTP 200, site `site-medroche`, profile `2026.09.15-1`.
- `/dashboard/medroche`: HTTP 200 with the scoped login form and password field.
- Process terminated with SIGTERM and was reaped; subsequent `lsof` found no listener on 43161.
- The task-owned `.next-final-review-check` output was removed and absence verified. The pre-existing `.next-medroche` directory and dirty Task 1 report were preserved, unstaged and uncommitted.

## Self-review and residual release gates

Reviewed receipt/rule identity, scope rejection, shared normalization and deterministic precedence, ambiguous transaction cleanup, CSV parser parity, sample limits, persisted examples, API projection, UI labels and clean source attestation. No source credentials or external source calls enter the sample/read paths; no query/page relationship is inferred.

No migration, import, production/API access, deployment, secret installation, collector, cron or notification action occurred. Migration 066 remains unapplied. Real MySQL constraints/concurrency and query execution plans, Linux positive protected-spool behavior, and authenticated admin preview/publish/restore against a release database remain separately authorized release verification. Samples intentionally do not attest full weekly collection coverage.

Done: all five final review findings fixed and locally verified.

Accepted: pending parent/owner review.

Reusable learning: shared normalization and commit-ambiguity evidence retention; no accepted-work learning cycle before acceptance.

Skill action: receiving-code-review, strict test-driven-development and verification-before-completion applied; no durable skill edited.

Evidence: source commit, focused RED/GREEN, full suites, builds, dry-run attestation and owned standalone smoke above.

Budget stop: none.

## Final re-review follow-up

Source commit: `35ceee51fda8ee991fc05119808cd7e6801f4010` (`fix(admin): close intent CSV and snapshot compatibility gaps`). This supersedes source `54b9f5bf` and attestation `a7e5395278048ff7c7de041b1cd7bfa444fdffb9`. The separate final attestation commit containing this update pins both profiles to `35ceee51fda8ee991fc05119808cd7e6801f4010`; its hash is reported in the handoff.

All three re-review findings were reproduced before fixes: four focused tests failed (ragged CSV remained valid, v1 snapshot lookup returned no receipt, Google lacked account/resource predicates, and the configured-binding resolver was absent).

Corrections:

- Header validation now spans the maximum parsed row width. Every populated cell beyond the header becomes an unnamed-column row/column error. Regression fixtures cover ragged widths, skipped empty extra columns, quoted delimiters inside a key/extra cell, and valid quoted values with empty trailing cells.
- The existing implementation uses plain INSERT plus `ER_DUP_ENTRY` handling, not INSERT IGNORE. If lookup by the new preview UID misses, it resolves the exact immutable snapshot unique key: site, dashboard, transport, source-identity hash and content SHA. The returned row additionally verifies all these fields and the original source identity. A v1 receipt remains unchanged and the new unreferenced artifact is discarded. Regression tests reject returned foreign site/dashboard, different source and different content identities.
- Both sample sources now resolve only the profile's current configured binding ID in the exact client/site/dashboard scope. Google SQL additionally requires that binding's analytics account and resource, so a newer retired resource cannot win the latest-week selection. Missing/ambiguous bindings are unavailable, with no query or fallback. Tests prove current-resource selection and exclusion of retired/foreign registrations. The current MedRoche registry has no GSC binding, so its Google preview samples correctly remain unavailable until a binding is configured; Yandex remains independently available when canonical data exists.

Final follow-up verification:

- Focused parser/store/regressions/samples/UI: 69 tests, 67 passed, 0 failed, 2 existing Linux-only skips.
- Admin route tests directly executed: 13/13 passed.
- Full `npm test`: 1,058 Node tests, 1,046 passed, 0 failed, 12 skipped; Python 13/13 passed.
- Full `npm run test:site-seo`: 198 TypeScript plus 27 build/isolation tests passed.
- Both root and site-seo typechecks, focused ESLint and diff checks passed.
- Root production build passed, including TypeScript and all 28 generated pages.
- Exact-source/profile/registry build dry-run passed at `35ceee51fda8ee991fc05119808cd7e6801f4010`.

The standalone runtime/template source did not change in this follow-up; the prior isolated build, health/login smoke and verified process/output cleanup remain applicable. No new server/browser was created, no production or source API action occurred, and the unrelated dirty Task 1 report and `.next-medroche` remain preserved. Existing real-MySQL/Linux/release verification gates above remain outstanding.

Done: all three follow-up findings fixed. Accepted: pending parent/owner review. Reusable learning: documented above. Skill action: review/TDD/verification instructions applied, no skill edit. Evidence: source commit and fresh checks above. Budget stop: none.
