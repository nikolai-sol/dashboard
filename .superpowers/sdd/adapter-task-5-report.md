# Adapter Task A5 Final Lifecycle Fix Report

## Scope

Addressed the two findings in `adapter-task-5-review.md` only within the
advertising canonical app worktree. No collector, migration, deployment,
secret, cron, or external API changes were made.

## P1: Descriptor-Bound Cleanup and Ownership

- Keep the original `uploads` `FileHandle` open after the generated artifact
  has been renamed and synced. The handle is the only cleanup capability while
  the confirmation transaction is unresolved.
- `discardCreatedArtifact` unlinks by `/proc/self/fd/<uploads-fd>/<filename>`
  and closes the retained handle even when unlink fails. It cannot follow a
  replacement spool path.
- `releaseCreatedArtifact` explicitly transfers ownership after a successful
  commit and closes the retained descriptor without deleting the artifact.
- The confirmation route discards only before commit begins. A failed commit
  has an indeterminate server outcome, so it releases the descriptor without
  deleting a possibly committed artifact. Post-commit descriptor-close errors
  likewise never enter rollback or delete cleanup.
- Added Linux-only duplicate and insert-error replacement tests that prove the
  replacement sentinel remains untouched and the original artifact in the
  renamed `uploads` directory is removed.
- Added route tests for source-update failure, indeterminate commit failure,
  successful ownership release, and post-commit close failure.

## P2: Google Sheets URL Parity

- The enqueue path passes the raw `sourceUrl` to the parser after only checking
  that it is not empty. It no longer trims a leading or trailing character.
- The confirmation route also passes its raw `sheet_url` to enqueue; it no
  longer trims it before the parity parser can reject it.
- Extended the app parity matrix to reject both leading and trailing ASCII
  whitespace alongside the previously reviewed encoded and punctuation cases.

## TDD Evidence

### RED

```sh
node --import tsx --test --test-name-pattern='Google Sheet confirmation matches the collector reviewed-reference contract' src/lib/canonical-import-request.test.ts
```

Before the parser change this failed with `Missing expected rejection` for
`https://docs.google.com/spreadsheets/d/sheet-id#gid=1 `.

### GREEN

```sh
node --import tsx --test --test-name-pattern='Google Sheet confirmation matches the collector reviewed-reference contract' src/lib/canonical-import-request.test.ts

node --import tsx --test src/app/api/admin/manual-data/confirm/route.test.ts
```

Result: the URL parity test passed, and all five transaction/ownership route
tests passed. The descriptor replacement regressions are Linux-only because
descriptor-anchored upload writes fail closed on Darwin; they are compiled by
the full Node suite and await Linux CI/runtime execution.

## Final Verification

- `npm test`: 621 Node passed, 0 failed, 10 skipped; 13 Python passed.
- `npm run typecheck`: passed.
- `npm run lint`: 0 errors; 8 pre-existing warnings outside this change.
- `git diff --check`: passed.

## Limits

The Docker daemon is unavailable on this workstation, and the active upload
implementation is intentionally Linux-only. No Linux container test was run
locally.
