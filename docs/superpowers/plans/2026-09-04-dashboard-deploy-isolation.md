# Dashboard Deploy Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a deployment for one dashboard type from replacing commits already active for another dashboard type.

**Architecture:** A local source verifier requires both current `origin/main` and the active production commit to be ancestors of the candidate. A server lock serializes activation, and the production ancestry check is repeated under that lock before upload/activation. Each release carries its full source SHA.

**Tech Stack:** Bash, Git, SSH, Node test runner, existing release scripts.

## Global Constraints

- No deploy may bypass the fresh `origin/main` and active-production ancestry checks.
- The active production commit must be read from a release metadata file; legacy release-name fallback is allowed only when it resolves unambiguously in local Git.
- The server lock is scoped to `dashboard-next`, acquired before the second ancestry check, and released on every normal or error exit.
- A dirty worktree, including untracked files, cannot deploy.
- Full tests, typecheck, lint, public-asset validation, and build run before upload.
- No emergency override or force flag is introduced.
- Existing rollback and release retention behavior remains unchanged.

---

### Task 1: Verify release ancestry and serialize activation

**Files:**
- Create: `scripts/verify-deploy-source.sh`
- Create: `scripts/verify-deploy-source.test.sh`
- Create: `scripts/dashboard-deploy-lock.sh`
- Create: `scripts/dashboard-deploy-lock.test.sh`
- Modify: `scripts/deploy.sh`
- Modify: `scripts/activate-release.sh`
- Modify: `package.json`
- Modify: `OPS.md`

**Interfaces:**
- Consumes: candidate Git `HEAD`, freshly fetched `origin/main`, active release path over SSH.
- Produces: a zero exit only when both required commits are ancestors, plus one held dashboard-specific activation lock.

- [ ] Write failing source-guard tests for current main, stale main, missing production ancestor, ambiguous legacy release SHA, and dirty worktree.
- [ ] Run `bash scripts/verify-deploy-source.test.sh`; expect the missing/insufficient guard assertions to fail.
- [ ] Implement the guard using `git fetch`, `git merge-base --is-ancestor`, full release SHA metadata, and unambiguous legacy fallback.
- [ ] Write failing lock tests proving a second holder is rejected and cleanup permits the next holder.
- [ ] Run `bash scripts/dashboard-deploy-lock.test.sh`; expect failure before the lock helper exists.
- [ ] Implement atomic server lock acquisition/release with owner metadata and trap cleanup; do not auto-delete an unknown existing lock.
- [ ] Wire deploy order: clean/main precheck → install/full verification/build → acquire lock → re-read production/recheck → package SHA metadata → upload/activate → attest SHA → release lock.
- [ ] Run both focused shell suites and `bash -n` on every modified shell script; expect all pass.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:public-assets`, `npm run build`, and existing release/deploy tests; expect zero failures/errors.
- [ ] Document normal failure/recovery messages and commit with `chore: prevent cross-dashboard release overwrite`.

### Task 2: Deploy the integrated Zaruku release and attest all dashboards

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: reviewed integrated HEAD and Task 1 deploy guard.
- Produces: active production release containing current main, Zaruku Wordstat/Alice, and the deploy safeguards.

- [ ] Create/use a clean release worktree at the reviewed integrated commit; do not copy unrelated dirty files.
- [ ] Run the complete pre-deploy gate from the clean worktree.
- [ ] Deploy through the guarded repository command; expect the active production/main ancestry checks and lock to pass.
- [ ] On Linux Node 20, run the packaged Alice importer `--help` and dynamic dry-run without DB writes.
- [ ] Read-only verify July/August canonical totals, active release SHA, importer/migration presence, and zero workbooks.
- [ ] Smoke Zaruku, Abbott, and advertising dashboard read paths; verify health and no new browser/application errors.
- [ ] If another release wins after activation, stop instead of looping and report the exact active SHA.
