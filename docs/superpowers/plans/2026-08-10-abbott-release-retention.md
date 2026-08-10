# Abbott Release Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely reclaim Abbott storage from retired and failed release data while preserving the active release, rollback target, and permanent audit evidence.

**Architecture:** A standalone Python operator builds a deterministic dry-run manifest from an explicit table allowlist and production release pointers. Apply mode accepts only the matching manifest digest, rechecks protection in every bounded delete, and emits a completion manifest. Production execution uses the existing local MySQL authority without exposing credentials.

**Tech Stack:** Python 3, `unittest`, MySQL 8, JSON/SHA-256 manifests, Playwright CLI.

## Global Constraints

- Abbott only; Zaruku and other dashboards are out of scope.
- Dry run is the default and production apply requires an exact manifest digest.
- Active, previous, staging, and validated releases are never purgeable.
- Control-plane and provenance rows are retained indefinitely.
- No source API call, OAuth-token change, cron edit, or Bitrix connector change.

---

### Task 1: Retention planner and safety contract

**Files:**
- Create: `abbott_release_retention.py`
- Create: `tests/test_abbott_release_retention.py`

**Interfaces:**
- Produces: `build_plan(executor, grace_days, now) -> dict`, `manifest_digest(manifest) -> str`, and the fixed `PURGE_TABLES` allowlist.

- [ ] **Step 1: Write failing planner tests** for protected IDs, age eligibility, allowlisted table counts, deterministic digest, and rejection of negative grace days.
- [ ] **Step 2: Run tests and confirm RED** with an import/function failure.
- [ ] **Step 3: Implement the minimal planner** with read-only SQL and no dynamic table discovery.
- [ ] **Step 4: Run tests and confirm GREEN.**

### Task 2: Manifest-bound batch deletion

**Files:**
- Modify: `abbott_release_retention.py`
- Modify: `tests/test_abbott_release_retention.py`

**Interfaces:**
- Produces: `apply_plan(executor, manifest, expected_digest, batch_size) -> dict` and CLI commands `plan` and `apply`.

- [ ] **Step 1: Write failing apply tests** proving digest mismatch, pointer drift, protected release, unknown table, and incomplete deletion all fail closed.
- [ ] **Step 2: Run tests and confirm RED.**
- [ ] **Step 3: Implement bounded deletes** whose SQL rechecks dataset, status, age, active ID, and previous ID on every batch.
- [ ] **Step 4: Add mode-0600 manifest writing** and completion evidence.
- [ ] **Step 5: Run focused and release-lifecycle tests and confirm GREEN.**

### Task 3: Operator runbook and production execution

**Files:**
- Create: `ops/runbooks/abbott_release_retention.md`
- Modify: `tests/test_abbott_operations_runbook.py`

**Interfaces:**
- Documents exact plan/apply/verify/compact commands and rollback limitations.

- [ ] **Step 1: Add a failing runbook contract test** for protection, manifest binding, batch deletion, and separate compaction.
- [ ] **Step 2: Run the test and confirm RED.**
- [ ] **Step 3: Write the runbook and confirm GREEN.**
- [ ] **Step 4: Commit the tested operator and runbook.**
- [ ] **Step 5: Deploy the operator to the private Abbott operations directory.**
- [ ] **Step 6: Capture baseline, run production plan, apply eligible cleanup, and verify protected-release counts and health.**
- [ ] **Step 7: Compact the three largest tables one at a time only after logical verification, checking free disk and health after each.**

### Task 4: Content coverage and visual dashboard verification

**Files:**
- Create runtime evidence only under `output/playwright/abbott-retention/` and the private checkpoint directory; no dashboard source changes.

**Interfaces:**
- Produces: July/August screenshots and a read-only SQL coverage report for active release 24 and latest approval batch.

- [ ] **Step 1: Query active catalog direction/type coverage and latest batch status.**
- [ ] **Step 2: Open the protected Abbott dashboard with Playwright and authenticate.**
- [ ] **Step 3: Select July 2026, capture visible totals/content and browser console/network errors.**
- [ ] **Step 4: Select August 2026, capture visible totals/content and browser console/network errors.**
- [ ] **Step 5: Compare UI observations with canonical protected-release counts and report any unmapped analytics URLs separately from catalog completeness.**

