# Final review fix wave report

Date: 2026-09-04
Base candidate: `fd5b8d0`

## Status

Complete. Every Critical and Important item, plus the requested Minor corrections, from
`final-review-fix-brief.md` is implemented. The full local predeploy gate passes after the final
independent-review fixes. No production SSH, database access/migration, deployment, source API call,
cron edit, secret operation, or external message occurred.

The pre-existing modified `.superpowers/sdd/task-1-report.md` and untracked
`docs/2026-08-22-abbott-handover.md` were preserved and excluded from the commit.

## Implemented behavior

### Fixed-path deployment bootstrap

- Added an explicit, one-time bootstrap wrapper and remote worker for the fixed
  `/var/www/dashboard` transition.
- Requires a lowercase full 40-character operator-supplied commit SHA and the independently
  captured exact active `.next/BUILD_ID`.
- Requires the SHA to directly name a local commit and be an ancestor of candidate `HEAD`; rechecks
  candidate `HEAD` under the shared deployment lock before any write.
- Pins production SSH/path/lock authority, passes remote values as escaped positional arguments,
  and exposes no force, guessing, short-SHA, legacy fallback, or generic authority override.
- Refuses conflicting, malformed, or symlink metadata. A new file is written under `umask 077`,
  checked, published with a same-directory no-replace hard link, set to mode `0600`, and read back
  exactly.
- Removed the fictitious fixed-directory basename inference from the normal deploy source guard.
  Metadata-less active releases now fail closed with the audited bootstrap recovery command.
- Added the operator/audit procedure to `OPS.md`.

### Shared deploy/rollback authority

- Manual rollback now pins the same `/var/www/.dashboard-next-deploy.lock`, acquires it with a unique
  token, treats acquisition outcome as ambiguous until token-aware cleanup, and never removes an
  unknown or other-owner lock.
- Local and remote rollback arguments are validated and sent positionally. Explicit targets are
  constrained to one direct child of the backup directory.
- Active, target, and automatic predecessor releases require an exact regular full-SHA metadata
  file. Metadata-less legacy backups fail with reviewed-rebuild guidance.
- Target/predecessor SHA is retained and re-attested through activation, health/listener checks, and
  failure restoration.
- The local rollback snapshots the trusted lock helper into a private randomized `/tmp` file before
  the remote directory swap, so a packaged rollback can release its lock even when the target
  predates the helper or inherited `TMPDIR` points inside the release. The snapshot is removed in the
  `EXIT` cleanup.
- New releases package the shared lock helper alongside both rollback scripts.

### Complete predeploy gate

- Added `npm run predeploy:verify`, backed by one fail-fast shell entrypoint.
- It runs the recursive Node and Python suites, deploy-source/lock/integration/bootstrap/gate tests,
  release runtime/activation/rollback authority tests, Abbott contract wiring and contract tests,
  public-asset validation, typecheck, lint, production build, and the existing preview-builder gate.
- `scripts/deploy.sh` invokes this single gate after `npm ci` and before packaging or upload.
  `ci:verify` uses the same gate.
- A contract test verifies every required command appears exactly once, in order, and that a failure
  stops later commands.

### Alice publication correctness

- A successful snapshot query with zero rows is now `available` empty, so the component shows the
  first-upload guidance. Snapshot read failure remains `unavailable`.
- Successful-empty canonical state keeps the Alice source pending with `data_through=null` and does
  not silently reuse the deprecated legacy aggregate.
- Summary-only imports persist the validated `--legacy-source` as canonical `source_key`; ordinary
  workbook imports retain `yandex_webmaster_alice_manual`. CLI, persistence, and read-model tests
  assert provenance.
- The README now labels the old aggregate Alice path historical/deprecated, describes July `89/155`
  definitions as unconfirmed, prohibits new imports on that path, and states unrelated legacy
  `.xls` support is unchanged.
- Same-checksum idempotency compares official SoV, capture time, account/domain/period/source,
  filename/checksum, source payload, coverage counts, and ordered featured sites. Differing metadata
  requires explicit supersession and retains the predecessor.
- Added a nullable snapshot fingerprint and replacement unique index. Existing rows intentionally
  remain `NULL`, so the published August snapshot is compared against stored metadata without being
  rewritten. Migration `063` repairs a wrong-shaped/non-unique partial index, installs the
  replacement unique guard first, and only then removes checksum uniqueness.

### URL, UI, and ZIP contracts

- Parser and pre-persistence validation accept only absolute `http:`/`https:` URLs with a hostname
  for answers, sources, portal links, and featured links.
- Portal classification and rendering share a client-safe exact-domain/subdomain helper. Safe
  `www.zaruku.ru` and nested subdomains render; foreign URLs containing `zaruku.ru` only in their
  path do not.
- The client helper has no server XLSX dependency, retaining bounded importer/release isolation.
- Official SoV always renders two decimals; delta renders as `−0,09 п. п.` without a percent sign.
  `YYYY-MM` labels are formatted from their string fields without date/timezone conversion.
- User-facing Alice copy says “опубликованные ежемесячные снимки”, not “канонические”.
- ZIP data descriptors now validate both unsigned 12-byte and signed 16-byte layouts against central
  metadata, including a valid unsigned descriptor whose CRC equals the optional signature value.

## Files

New implementation/tests:

- `scripts/bootstrap-release-source-metadata.sh`
- `scripts/bootstrap-release-source-metadata-remote.sh`
- `scripts/bootstrap-release-source-metadata.test.sh`
- `scripts/predeploy-verify.sh`
- `scripts/predeploy-verify.test.sh`
- `scripts/rollback-authority.test.sh`
- `src/db/migrations/063_zaruku_alice_snapshot_fingerprint.sql`

Modified deployment/docs:

- `OPS.md`
- `README.md`
- `package.json`
- `scripts/activate-release.sh`
- `scripts/dashboard-deploy-integration.test.sh`
- `scripts/dashboard-deploy-lock.test.sh`
- `scripts/deploy.sh`
- `scripts/release-rollback.test.sh`
- `scripts/rollback-release.sh`
- `scripts/rollback-release-remote.sh`
- `scripts/validate-production-release.sh`
- `scripts/validate-production-release.test.sh`
- `scripts/verify-abbott-dashboard-contract.test.sh`
- `scripts/verify-deploy-source.sh`
- `scripts/verify-deploy-source.test.sh`

Modified Alice/import/UI/ZIP implementation and tests:

- `scripts/import-zaruku-alice-visibility.ts`
- `scripts/import-zaruku-alice-visibility.test.ts`
- `src/components/ZarukuAliceVisibilityTab.tsx`
- `src/components/ZarukuAliceVisibilityTab.test.ts`
- `src/components/zaruku-alice-visibility-view.ts`
- `src/components/zaruku-alice-visibility-view.test.ts`
- `src/components/zaruku-seo-analytics.ts`
- `src/db/migrations/046_zaruku_alice_visibility_monthly.sql`
- `src/lib/xlsx-zip-preflight.ts`
- `src/lib/xlsx-zip-preflight.test.ts`
- `src/lib/zaruku-alice-visibility-import.ts`
- `src/lib/zaruku-alice-visibility-import.test.ts`
- `src/lib/zaruku-alice-visibility.ts`
- `src/lib/zaruku-alice-visibility.test.ts`
- `src/lib/zaruku-seo.ts`
- `src/lib/zaruku-seo.test.ts`
- `src/lib/zaruku-url.ts`
- `src/lib/zaruku-url.test.ts`

## TDD evidence

Tests were written/expanded first and observed failing against the prior behavior.

RED evidence:

- Alice fingerprint/provenance suite: missing fingerprint migration; metadata corrections returned
  `already_exists`; summary provenance was hardcoded; capture time did not affect the summary
  checksum; CLI did not expose the canonical summary source.
- URL/import/view suite: missing shared hostname/HTTP helpers; non-web schemes were accepted by the
  parser/persistence boundary; safe subdomains were suppressed; path spoofs were not covered.
- Empty-state suite: successful zero-row snapshot loads returned `unavailable`; source metadata reused
  legacy facts instead of pending/null.
- UI suite: official SoV omitted trailing decimals, delta rendered a percent/point hybrid, and month
  labels parsed a timestamp.
- ZIP suite: the CRC/signature collision fixture failed with `data descriptor overlaps central
  directory`.
- Bootstrap suite: command absent; fixed-path missing metadata did not name audited recovery; later
  REDs covered candidate-head change, build evidence, OPS contract, short/non-commit/non-ancestor
  SHA, conflicting metadata, ambiguous acquisition, and unknown lock preservation.
- Predeploy suite: gate absent (`exit 127`).
- Rollback suites: old wrapper lacked shared-lock authority; automatic activation accepted a
  metadata-less predecessor; exact metadata with extra content was accepted.
- Independent review regression 1: migration test failed because replacement uniqueness was added
  after checksum uniqueness was dropped and did not inspect `NON_UNIQUE`/repair an existing wrong
  index.
- Independent review regression 2: packaged rollback completed the swap but then failed opening
  `app/scripts/dashboard-deploy-lock.sh`, leaving the shared lock held; a stricter RED reproduced the
  same risk when inherited `TMPDIR` was inside the swapped release.

GREEN evidence:

- Focused Alice/URL/empty/UI/ZIP suite: 132/132 passed before integration; current recursive suite
  retains all cases.
- Importer/migration review regression suite: 22/22 passed after fail-closed DDL reordering.
- Packaged rollback regression: `bash scripts/rollback-authority.test.sh` passed after private helper
  snapshotting.
- `npm run test:deploy-source`: deploy source, shared lock, full integration, bootstrap, and gate
  contract suites passed.
- `npm run test:release-runtime`: runtime links, production release validation, automatic/manual
  rollback, and rollback authority suites passed.
- Independent reviewer separately ran the deployment/release suites and 160 focused Alice/URL/ZIP/
  artifact tests before the two findings were fixed; final re-review reported no remaining blocker.

## Final verification

The final `npm run predeploy:verify` after review fixes exited `0`:

- Recursive Node: 954 total, 944 passed, 0 failed, 10 skipped.
- Recursive Python: 13 passed.
- Deploy-source/lock/integration/bootstrap/predeploy tests: passed.
- Release-runtime/activation/manual rollback authority tests: passed.
- Abbott contract wiring: passed; Abbott contract: 111/111 passed.
- Public-asset validation: passed.
- Typecheck: passed.
- Lint: 0 errors, 10 pre-existing unrelated warnings.
- Production build: passed; 28/28 static pages generated.
- Preview builder: 7 Python tests plus shell release test passed.

Additional verification:

- Real August workbook, no-write dry-run: `queries=155`, `portal_present=89`,
  `sample_presence_pct=57.42`, `sources=1313`, `validation_mismatches=0`, and normal workbook
  `source_key=yandex_webmaster_alice_manual`.
- Artifact-isolation/release-policy/ZIP focus: 40/40 passed.
- Legacy BIFF `.xls` focus: 3/3 passed.
- `bash -n` on every changed deployment/bootstrap/predeploy/activation/rollback script/test: passed.
- `git diff --check`: passed.

Initial sandboxed `tsx` child-process runs encountered a local Unix-socket `listen EPERM`; those
results were not treated as evidence. The exact local-only commands were rerun outside the filesystem
sandbox and passed. No network or production access was used.

## Independent review and concerns

Independent review found the two Important issues described in the TDD section. Both were fixed and
their regression tests pass. No remaining Critical or Important issue is known.

Operational concerns intentionally remain:

- The bootstrap was tested only against temporary local fixtures and was not run in production. The
  operator must independently establish the exact active commit SHA, capture the live build ID
  read-only, execute the documented command, and retain its audit output before the first guarded
  deployment.
- A metadata-less legacy backup is intentionally ineligible for rollback. It must be rebuilt as a
  reviewed release with trusted full-SHA metadata; the bootstrap cannot relabel backups.
- Migration `063` was verified statically/behaviorally but was not applied to any database in this
  task, as required by the no-production/no-DB constraint.
- Lint retains 10 pre-existing warnings outside this fix wave; there are no lint errors.
