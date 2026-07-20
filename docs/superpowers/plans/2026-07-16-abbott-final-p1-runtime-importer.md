# Abbott Final P1 Runtime and Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a self-contained copied-interpreter Abbott runtime and safely materialize reused immutable source content into successor staging releases.

**Architecture:** Runtime rollout creates `venv/` with `python3 -m venv --copies`, installs the pinned bootstrap requirements, checks dependency consistency, and verifies required installed versions plus the absence of external symlink targets. Import reuse remains content-addressed by the immutable snapshot ID but inserts the newly parsed, source-specific prepared rows into an empty successor release, then performs the same exact count/fingerprint verification used for first import before recording per-release execution evidence.

**Tech Stack:** Python 3 `venv`/`importlib.metadata`/unittest, Bash runbook commands, TypeScript/Node test runner, transactional MySQL statements.

## Global Constraints

- Follow red-green-refactor for every behavior change.
- Do not perform production, API, database, cron, deploy, restart, token, or Hermes actions.
- Do not claim package hashes: `requirements.txt` pins versions but contains no verified hash set.
- Cron and every operator command must use `$CANONICAL_ROOT/venv/bin/python`.
- Reused content must never be copied from another release or tenant; materialize only the current invocation's parsed `PreparedAbbottSource` batches.

---

### Task 1: Self-contained copied-interpreter runtime environment

**Files:**
- Modify: `tests/test_abbott_runtime_closure.py`
- Modify: `run_abbott_metrika_active_release.py`
- Modify: `tests/test_abbott_operations_runbook.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/README.md`

**Interfaces:**
- Consumes: bootstrap `requirements.txt` entries in exact `distribution==version` form.
- Produces: rollout commands that create `venv` using `--copies`, verify every symlink remains inside the venv, verify every required distribution version via `importlib.metadata`, and run `python -m pip check`.

- [x] Write runtime tests that build a normal symlink venv and a `--copies` venv inside committed temporary repositories; require the first to fail with a sanitized `--copies` remediation and the second to attest.
- [x] Run the focused tests and confirm the current generic/no-rollout behavior fails the new assertions.
- [x] Make runtime attestation emit the actionable sanitized copied-venv error for external venv links; rerun green.
- [x] Write runbook/bootstrap tests requiring `python3 -m venv --copies`, external-symlink traversal, exact pinned installed-distribution checks, `pip check`, explicit no-hash claim, and cron use of the copied venv; confirm red.
- [x] Add executable installation/check commands to the runbook and bootstrap README; rerun green.

### Task 2: Successor materialization for reused immutable snapshots

**Files:**
- Modify: `dashboard-next/scripts/import-abbott-private-data.test.ts`
- Modify: `dashboard-next/scripts/import-abbott-private-data.ts`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

**Interfaces:**
- Consumes: `PreparedAbbottSource.batches`, immutable reused `snapshotId`, and the locked successor `canonicalReleaseId`.
- Produces: `materializeOrVerifyBatch(connection, releaseId, snapshotId, batch)`, which inserts exact prepared rows only when the candidate count is zero, verifies a fully identical rerun, and rejects any partial or mismatched pre-existing set before per-release execution evidence is written.

- [x] Replace the old zero-row rejection expectation with a test asserting exact candidate/snapshot INSERT parameters, post-insert verification, no cross-release `INSERT ... SELECT`, and execution evidence after materialization; confirm red.
- [x] Add tests for partial pre-existing rows and equal-count fingerprint mismatch, asserting rollback and no execution evidence; confirm red where behavior is missing.
- [x] Implement a count probe followed by either `insertAndVerifyBatch`, `verifyBatch`, or fail-closed rejection; rerun importer tests green.
- [x] Add a runbook contract explaining source reparse/materialization and forbidding cross-release/raw-tenant copy; confirm red, then document it and rerun green.

### Task 3: Synchronization, full verification, and commits

**Files:**
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/runtime/run_abbott_metrika_active_release.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`
- Modify: `ops/abbott-runtime-manifest.sha256`
- Modify: `.superpowers/sdd/task-10-report.md`

**Interfaces:**
- Produces: byte-identical bootstrap/root runtime authority and updated SHA-256 evidence.

- [x] Sync the changed launcher authority and regenerate only its verified manifest entries.
- [x] Run root, dashboard/importer, and Nest test/typecheck/build suites; verify manifests, bootstrap imports, secret scans, and diff checks.
- [x] Commit dashboard and root changes separately, run post-commit attestation and clean-status checks, and append final evidence/hashes to the ignored report.
