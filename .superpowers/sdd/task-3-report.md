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
