# Abbott Release Retention Design

## Decision

Purge release-scoped data-plane rows for Abbott releases that are no longer
needed for serving, rollback, validation, or an in-progress candidate. Keep the
release control-plane and provenance indefinitely.

## Protected releases

The operator must derive the protected set from production at execution time:

- `portal_active_data_releases.canonical_release_id`;
- `portal_active_data_releases.previous_release_id`;
- every Abbott release whose status is `staging` or `validated`.

The operator must refuse an explicit target that belongs to this set and must
recheck the protection predicate in every delete statement.

## Eligibility

The normal policy is a seven-day grace period:

- `failed`: seven days after `created_at`;
- `retired`: seven days after `retired_at`;
- only dataset `abbott` is in scope.

An initial cleanup may use an explicit `--grace-days 0` only when invoked by an
operator after a successful dry run. The dry-run manifest must record this
override. No automatic schedule is introduced in this change.

## Retained control-plane

Never delete rows from `portal_data_releases`, active pointers, dataset
snapshots, source-import receipts, migration validation results, collector or
request logs, content classification events, approval batches, or registry
entities. These rows remain the permanent audit record.

## Purged data-plane

The allowlist contains only release-scoped fact and materialized projection
tables in `report_bd` and `report_bd_private`. Unknown tables are never selected
dynamically. Deletes run in bounded batches and commit between batches.

## Audit and safety

Dry run is the default. It writes a mode-0600 JSON manifest containing the
active pointer, protected and eligible releases, per-table row counts, table
sizes, grace period, and a SHA-256 digest. Apply requires the exact manifest
path and digest. Before each batch, SQL rechecks dataset, status, age, and the
active/previous pointers. The operator stops if the pointer changes.

After deletion it records actual deleted rows, verifies zero remaining eligible
rows in the allowlist, confirms the active and previous releases are unchanged,
and runs the Abbott health probe. Physical file compaction is a separate
maintenance action, one table at a time, after the logical purge succeeds.

## Dashboard verification

Before and after retention, canonical controls and the protected-release row
counts must match. A real-browser check covers July 2026 and August 2026 on the
Abbott dashboard and confirms non-zero data plus populated direction and
material-type UI where the canonical catalog supplies those values.

