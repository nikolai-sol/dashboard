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
