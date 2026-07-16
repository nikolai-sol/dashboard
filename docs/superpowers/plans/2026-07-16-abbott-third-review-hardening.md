# Abbott Third Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the third-review gaps in runtime/source attestation, immutable source reuse, retryable validation evidence, and first-cutover rollback packaging without performing production operations.

**Architecture:** Runtime launch will fail closed on unsafe untracked paths while allowing only explicitly protected operational artifacts. Import provenance will be split between immutable content snapshots and a per-release source-import link. Comparator evidence will be grouped into immutable completed batches, and validation will inspect only the newest batch. Dashboard installation will gain an explicit verified checkpoint mode that converts a legacy directory deployment into a rollback release before the first symlink cutover.

**Tech Stack:** Python 3/unittest, TypeScript/Node test runner, MySQL 8 DDL, Bash, Git, SHA-256 manifests.

## Global Constraints

- Follow red-green-refactor for every behavior change.
- Do not perform production, API, database, cron, deploy, restart, token, or Hermes actions.
- Preserve audit history; the release operator must not receive DELETE.
- Keep root and dashboard bootstrap runtime authorities byte-identical and re-hash their manifests.

---

### Task 1: Strict source and runtime repository attestation

**Files:**
- Modify: `tests/test_abbott_runtime_closure.py`
- Modify: `run_abbott_metrika_active_release.py`
- Modify: `tests/test_abbott_operations_runbook.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

**Interfaces:**
- Consumes: `attest_runtime(root, expected_revision, manifest_path)`.
- Produces: `_unsafe_worktree_status(root)` that rejects tracked changes and untracked code while allowing only `.env`, `venv/`, `logs/`, and named protected operational artifact directories.

- [ ] Write tests proving untracked `sitecustomize.py`, `requests.py`, `dotenv.py`, `mysql/`, and arbitrary code fail runtime attestation, while allowlisted protected artifacts do not.
- [ ] Run the focused Python tests and confirm they fail because untracked files are ignored.
- [ ] Implement porcelain-v1 `--untracked-files=all` parsing and strict allowlisting; rerun focused tests green.
- [ ] Add a runbook test requiring an entirely clean dashboard source worktree before build, including untracked files; confirm red.
- [ ] Change the build gate to require empty `git status --porcelain --untracked-files=all`; rerun green.

### Task 2: Per-release import execution provenance

**Files:**
- Modify: `dashboard-next/scripts/import-abbott-private-data.test.ts`
- Modify: `dashboard-next/scripts/import-abbott-private-data.ts`
- Modify: `tests/test_canonical_release_store.py`
- Modify: `canonical_release_store.py`
- Modify: `dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql`
- Modify: `ops/sql/abbott_private_schema_and_grants.sql`
- Modify: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Consumes: immutable `portal_dataset_snapshots` content fingerprints and `PreparedAbbottSource.codeRevision`.
- Produces: `portal_release_source_imports(canonical_release_id, source_snapshot_id, source_kind, code_revision, import_status, imported_row_count, rejected_row_count, imported_at)` with one execution record per release/source.

- [ ] Write importer tests proving a successor release can reuse the same content snapshot and records its new execution revision; confirm red.
- [ ] Insert/update the release-source execution row transactionally for every source; rerun importer tests green.
- [ ] Write validation tests proving snapshot-manifest revision may be old but all four per-release executions must match the candidate revision; confirm red.
- [ ] Remove snapshot-manifest revision coupling and validate exact release-source execution evidence; rerun green.
- [ ] Add schema/grant contract tests for the link table and importer INSERT/UPDATE grant; confirm red, then add DDL/grants and rerun green.

### Task 3: Retryable comparator validation batches

**Files:**
- Modify: `tests/test_abbott_canonical_controls.py`
- Modify: `abbott_canonical_controls.py`
- Modify: `tests/test_canonical_release_store.py`
- Modify: `canonical_release_store.py`
- Modify: `dashboard-next/src/db/migrations/033_abbott_canonical_release_control.sql`
- Modify: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Produces: `validation_run_id CHAR(36)` and `validation_run_completed_at DATETIME` on every comparison row; uniqueness includes run ID.
- Validation selects the newest run ID for the candidate/baseline and requires a completed exact control set from that run only.

- [ ] Write comparator tests requiring one UUID per comparison and a completion marker update; confirm red.
- [ ] Generate a run UUID, insert all rows under it, and mark the batch complete in the same transaction; rerun green.
- [ ] Write store tests for failed old run plus corrected latest run, incomplete latest run, and ignored old/wrong evidence; confirm red.
- [ ] Select the newest run metadata first, then lock and validate only its exact evidence set; rerun green.
- [ ] Add schema tests for batch columns, retry-safe unique key, and absence of DELETE grant; confirm red, then update DDL and rerun green.

### Task 4: Verified first-cutover predecessor checkpoint

**Files:**
- Modify: `tests/test_dashboard_atomic_release_installer.py`
- Modify: `dashboard-next/scripts/install-reviewed-release.sh`
- Modify: `tests/test_abbott_operations_runbook.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`

**Interfaces:**
- Produces: `install-reviewed-release.sh --checkpoint-current <current-dir> <releases-dir> <revision>`.
- The checkpoint copies and scans the current complete deployment, creates and verifies its deterministic manifest, then leaves the current directory untouched; normal cutover refuses a legacy directory active path.

- [ ] Write installer tests proving the explicit checkpoint packages a directory deployment with a verified rollback manifest and rejects incomplete/private predecessors; confirm red.
- [ ] Implement checkpoint mode using same-filesystem staging, full asset scan, deterministic manifest, and atomic final rename; rerun green.
- [ ] Add runbook tests requiring checkpoint and manifest verification before the first normal install; confirm red.
- [ ] Add the pre-cutover checkpoint gate and explicit first-cutover sequence; rerun green.

### Task 5: Bootstrap sync, full verification, report, and commits

**Files:**
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/runtime/*.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/lib/*.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`
- Modify: `ops/abbott-runtime-manifest.sha256`
- Modify: `.superpowers/sdd/task-10-report.md`

**Interfaces:**
- Consumes: root runtime authorities after Tasks 1-4.
- Produces: matching bootstrap copies and regenerated SHA-256 evidence.

- [ ] Copy changed authorities mechanically, regenerate both manifests, and verify every hash.
- [ ] Run the full root Python suite, dashboard suite, security scan, typecheck/build, Nest suite/typecheck/build, secret scans, and `diff --check`.
- [ ] Commit root and dashboard changes separately, rerun committed-runtime attestation against root HEAD, verify all worktrees clean, and update the ignored audit report with hashes and the no-production-actions statement.
