# Task 3 report: release source integrity, health alert, and schedule alignment

## Scope completed

- Added migration `046_abbott_release_source_integrity.sql` and its Node contract test.
- Added release-store and health-probe Python unit tests, both independent of a live
  database. The release-store test injects a `canonical_writer` stub before import,
  so it never imports `mysql.connector` or reads credentials.
- Added workbook JSON semantic-count validation and activation-time receipt
  re-attestation to both synchronized release-store copies.
- Added aggregate-only release-source health integrity, its sanitized incident, and
  the 07:00 Moscow default completion boundary.
- Added `test:node` and `test:python`; `npm test` now runs both.
- Updated the real bootstrap SHA-256 entries.

No API collection path, cron, deployment, secret, database instance, or existing
release data was touched.

## RED / GREEN evidence

### Release gate

RED:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py
```

Result: expected failure: three semantic workbook cases were accepted and the
activation receipt helper was absent (3 failures, 2 errors).

GREEN:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py
cmp reportingdash-canonical-bootstrap/lib/canonical_release_store.py reportingdash-canonical-bootstrap/runtime/canonical_release_store.py
```

Result: 6 tests passed; `cmp` exited 0.

### Health probe

RED:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_abbott_health_probe.py
```

Result: expected failure: source-integrity builder absent and the old 09:00 Moscow
default made a 04:23 UTC completion stale (1 failure, 1 error).

GREEN:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_abbott_health_probe.py
```

Result: 2 tests passed.

Review regression RED/GREEN:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_abbott_health_probe.py
node --import tsx --test src/db/abbott-release-source-integrity-migration.test.ts
```

Result: the new tests failed before the fixes: an aggregate match flag could
override unequal source counts, and a source-ID/status transition had no
`NEW.release_status` guard. After requiring equal SQL counts and preventing a
changed source set whenever either status is non-staging, all 3 health tests and
the migration contract passed.

### Migration contract

RED:

```sh
node --import tsx --test src/db/abbott-release-source-integrity-migration.test.ts
```

Result: expected failure because migration 046 did not exist.

GREEN:

```sh
node --import tsx --test src/db/abbott-release-source-integrity-migration.test.ts
```

Result: 1 test passed.

## Migration design

Migration 046 creates and seeds a one-row guard table, then drops and recreates
exactly four event-specific triggers:

1. `portal_data_releases` `BEFORE UPDATE`: a changed Abbott
   `source_snapshot_ids` value is rejected if either the old or new release
   status is not `staging`.
2. `portal_release_source_imports` `BEFORE INSERT`: rejects a receipt for a
   non-staging Abbott parent.
3. `portal_release_source_imports` `BEFORE UPDATE`: rejects if either the old or
   new Abbott parent is non-staging.
4. `portal_release_source_imports` `BEFORE DELETE`: rejects a receipt belonging
   to a non-staging Abbott parent.

Each trigger uses a single `INSERT ... SELECT ... WHERE` statement. A forbidden
operation attempts to insert the already-seeded guard key and therefore fails with
a duplicate-key error; permitted operations select no row. This avoids
`DELIMITER`/compound trigger syntax and is compatible with the existing mysql2
`multipleStatements` migration runner. The migration contains no release IDs and
does not update any release data.

## Integrity behavior

- Workbook JSON manifests must contain positive integer `direction_count`,
  `event_catalog_count`, and `general_material_count`; their sum must equal the
  snapshot's `imported_row_count`.
- Activation locks the validated candidate release and its import receipts, then
  verifies exactly one successful, zero-rejection receipt for every pointer source
  ID before the release-status transition.
- Health executes one aggregate-only query: source counts and a SQL set-equality
  flag. IDs are never included in the health payload or incident. A mismatch emits
  the fixed `abbott|90602537|release_sources|mismatch` CRITICAL incident with only
  source counts.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `lib/canonical_release_store.py` | `fbe5413944aa9ea6062e43f145b04dbffe86d31bd6339a538472072568b565d1` |
| `runtime/canonical_release_store.py` | `fbe5413944aa9ea6062e43f145b04dbffe86d31bd6339a538472072568b565d1` |
| `runtime/abbott_health_probe.py` | `6ed7a6c2af250c40ac23bca702a15c2cd60dac5331a392e7e3ac45cc091011ef` |

The manifest entries exactly match these values.

## Full verification

```sh
npm test
npm run lint
npm run typecheck
npm run build
cmp reportingdash-canonical-bootstrap/lib/canonical_release_store.py reportingdash-canonical-bootstrap/runtime/canonical_release_store.py
git diff --check
```

Results: Node 558/558 and Python 9/9 tests passed; lint exited 0 with four
pre-existing warnings in unrelated files; typecheck passed; production build
passed; `cmp` exited 0; diff check passed.

## Self-review and concerns

- Scope was limited to Task 3 files plus the pre-existing package-script contract
  test that required updating because `test` now composes Node and Python suites.
- The release-store copies are byte-identical and their manifest hashes were
  recalculated from the final files.
- No live MySQL migration was run: doing so would mutate external state and is out
  of scope. The SQL contract test verifies the repeat-safe four-trigger shape;
  the migration deliberately avoids `DELIMITER` so mysql2 can execute it.
- Existing lint warnings remain unchanged:
  `src/components/abbott-summary.ts`,
  `src/components/admin/DashboardUtmSourceMatching.tsx`, and
  `src/lib/zaruku-gsc.ts`.

## Commit

`fix: attest Abbott release source integrity` (final SHA recorded in the task handoff).

## Independent review follow-up

The initial Task 3 commit (`6205fcfe4d1c969ac1c7459cced3130e62023c14`) was
independently reviewed and required correction. This follow-up supersedes the
earlier migration implementation.

### Corrected trigger semantics

- The source-pointer trigger now uses `SIGNAL SQLSTATE '45000'`; it no longer
  relies on a writable/deletable sentinel table.
- It blocks an Abbott release that is already non-staging from returning to
  `staging`, even if its source IDs are unchanged.
- It blocks source-ID mutation whenever either old or new status is
  non-staging.
- It evaluates both old and new dataset keys, so a non-staging release cannot
  escape Abbott by changing `dataset_key`, nor can another non-staging release
  enter Abbott. Non-Abbott-to-non-Abbott updates are unaffected.
- Receipt insert, update, and delete triggers use direct `SIGNAL` rejection for
  non-staging Abbott parents.

### Executable migration handling and tests

`src/db/run-migration.ts` now exports a tested statement splitter. Migrations
without break markers keep their original single query behavior; migration 046
uses `-- @migration-statement-break` markers so each `CREATE TRIGGER ... BEGIN
... END` body is submitted as one MySQL statement without `DELIMITER` parsing.

Default tests include a transition/receipt operation matrix and verify four
direct-SIGNAL trigger statements through the runner splitter. These are
environment-independent. The Python test loader now restores its prior
`sys.modules` entries after importing the release store, avoiding global
stub/module pollution. `test:python` now calls a Node launcher that honors
`PYTHON` or `PYTHON_EXECUTABLE` and uses the Windows `python` fallback; it no
longer depends on a POSIX inline environment assignment.

An opt-in real MySQL test was added and run:

```sh
npm run test:migration:abbott-integrity
```

It starts an ephemeral local Docker `mysql:8.4` container, creates the minimal
release/receipt tables, applies migration 046 twice, confirms staging source and
receipt mutations succeed, and confirms SQLSTATE `45000` rejection for
active-to-staging, non-staging source changes, non-staging receipt
insert/update/delete, Abbott dataset-key escape/entry, while preserving a
non-Abbott source update. It cleans up the container on exit. Result: passed.

### Follow-up RED / GREEN evidence

RED:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py
node --import tsx --test src/db/abbott-release-source-integrity-migration.test.ts
node --import tsx --test scripts/run-python-tests.test.ts
```

Result: import-isolation test failed because the test permanently installed
stub modules; importing `run-migration.ts` attempted a real run; the portable
launcher was missing. Additional transition and aggregate-count regressions
also failed before their respective fixes.

GREEN focused:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest reportingdash-canonical-bootstrap/tests/test_canonical_release_store.py
node --import tsx --test src/db/abbott-release-source-integrity-migration.test.ts scripts/run-python-tests.test.ts scripts/set-dashboard-shared-password.test.ts
npm run test:python
npm run test:migration:abbott-integrity
```

Result: Python 7/7 for the release-store file; Node 17/17 focused; Python
suite 10/10; Docker MySQL verification passed.

Final verification:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:migration:abbott-integrity
cmp reportingdash-canonical-bootstrap/lib/canonical_release_store.py reportingdash-canonical-bootstrap/runtime/canonical_release_store.py
git diff --check
```

Result: Node 560/560 and Python 10/10 passed; lint exited 0 with the same four
unrelated warnings noted above; typecheck and build passed; Docker MySQL test,
byte comparison, and diff check passed.

The canonical release-store files were not changed in this follow-up; their
existing identical hashes and manifest entries remain valid. No production
database, deployment, cron, external API, token, or existing release data was
modified.

### Final adversarial boundary correction

The follow-up review identified one final combined-field escape: a non-Abbott
active release could enter Abbott while setting its new status to `staging`.
The source trigger now treats either crossing direction as a protected Abbott
boundary and allows it only if **both** the old and new statuses are `staging`.
The transition matrix verifies both allowed staging-to-staging crossings and
blocked active-to-staging entry / staging-to-active exit. The Docker verifier
executes both blocked SQL updates in addition to the other replay and receipt
checks.
