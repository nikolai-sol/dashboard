# Adapter Task A5 Follow-up Report

## Scope

Addressed the two findings in `adapter-task-5-review.md` only within the
advertising canonical app worktree. No collector, migration, deployment,
secret, cron, or external API changes were made.

## P1: Descriptor-Bound Cleanup

- Capture the created `uploads` directory's `dev` and `ino` from the active
  descriptor after the artifact rename and directory sync.
- During duplicate or error cleanup, reopen the configured spool path through
  the existing no-follow descriptor walk, compare the reopened `uploads`
  directory identity to the captured identity, and fail closed before unlink
  on a mismatch.
- Keep the successful unlink anchored to the verified reopened descriptor.
- Added Linux-only coverage for an ordinary replacement spool directory that
  contains the same generated filename; cleanup rejects the changed directory
  and preserves that replacement file.
- Added Linux-only insert-error coverage confirming normal cleanup still
  removes a newly created artifact. The existing duplicate test continues to
  cover normal duplicate cleanup.

## P2: Google Sheets URL Parity

- Fully anchored the raw Sheets path expression.
- Require the raw authority hostname spelling to be `docs.google.com`
  case-insensitively (retaining the previously supported empty-port form), in
  addition to the semantic URL checks.
- Extended the app parity matrix to reject the reviewed encoded-path,
  punctuation-trailing-path, and percent-encoded-authority cases.

## TDD Evidence

### RED

```sh
node --import tsx --test --test-name-pattern='Google Sheet confirmation matches the collector reviewed-reference contract' src/lib/canonical-import-request.test.ts
```

Before the parser change this failed with `Missing expected rejection` for
`https://docs.google.com/spreadsheets/d/sheet-id%2Ftrailer#gid=1`.

### GREEN

```sh
node --import tsx --test --test-name-pattern='Google Sheet confirmation matches the collector reviewed-reference contract|duplicate cleanup leaves a same-named artifact in an ordinary replacement spool directory' src/lib/canonical-import-request.test.ts
```

Result: 1 passed, 0 failed, 1 skipped. The ordinary-directory replacement
regression is Linux-only because descriptor-anchored upload writes fail closed
on Darwin; it is compiled by the full Node suite and awaits Linux CI/runtime
execution.

## Final Verification

- `npm test`: 621 Node passed, 0 failed, 9 skipped; 13 Python passed.
- `npm run typecheck`: passed.
- `npm run lint`: 0 errors; 8 pre-existing warnings outside this change.
- `git diff --check`: passed.

## Limits

The Docker daemon is unavailable on this workstation, and the active upload
implementation is intentionally Linux-only. No Linux container test was run
locally.
