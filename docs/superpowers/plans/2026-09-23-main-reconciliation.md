# Main reconciliation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make main a complete integration baseline for published dashboard work and reusable campaign-date planning, preserving separate runtime ownership.

**Architecture:** Keep root media, isolated Zaruku, and isolated site-SEO code and deployment paths. Abbott extraction remains a separate unfinished integration/cutover; public Abbott still uses the combined root runtime. No production deployment belongs to this cleanup.

**Tech Stack:** Git, TypeScript, Next.js workspaces, Node test runner.

## Global constraints

- Preserve every existing uncommitted change and every active branch/worktree.
- Preserve canonical facts and existing publication/read paths; no DB changes.
- No deploy, Nginx/process change, source API call, or collector operation.
- Keep current deployment/ancestry guards unchanged.
- Owner renewed the main-cleanup scope at 07:15 UTC after the preceding checkpoint. Prior active work was approximately 36 minutes; next checkpoint for this authorized stage is 08:15 UTC. Agents do not reset this clock.

### Task 1: Reconcile already-present production lineage

**Files:** No application tree changes.

- [x] Freshly compare all nine files changed by the four production-only feature commits with main. All nine Git blob IDs match exactly.
- [x] Confirm the production layer merge `8f389a28` has an empty first-parent tree diff. Its older runtime/deploy tree is not an authoritative replacement for main.
- [x] Install this worktree's own locked dependencies and run `npm run test:node`: 1,065 pass, 12 skipped, zero failed.
- [x] Record a normal two-parent merge of production with main's existing tree as the resolution (`git merge -s ours --no-ff 8f389a28`). This is justified by exact feature-file parity, not merely by a desire to pass the ancestry gate; preserve current runtime files and guards.
- [x] Verify the merge's first-parent tree diff is empty and both original lineages are ancestors.

### Task 2: Bring published Zaruku and reusable media dates into main

**Files:** The 24 files changed on `origin/release/zaruku` since its merge base, plus the seven files in media patch `772f3673`.

- [x] Merge the verified production Zaruku release `af1948c8` (11 commits absent from main). Do not merge dirty local release worktrees or their extra unpublished changes.
- [x] Merge `772f3673` after production ancestry reconciliation, preserving only its bounded seven-file change.
- [x] Preserve app/runtime boundaries and existing deploy guards. After audit, also retain completed Zaruku cutover source `7059e7fb`; resolve package.json by retaining both test scripts. No operator was executed.
- [x] Correct the pre-existing site-SEO JSX-in-try lint error without changing page behavior, allow Node built-ins in app CommonJS Next configs, and re-attest template source through the existing three-file mechanism. No production release.
- [x] Run full `npm run predeploy:verify` (exit 0), site-SEO tests (226+27 passed), and site-SEO typecheck. Abbott runtime-specific code and site-SEO contract remain unchanged.
- [x] Build the isolated MedRoche artifact and validate it. Fix CI checkout depth so exact template source commits are available, with a reproduced shallow-clone failure and full-history success.

### Task 3: Record runtime status and integrate reviewed result

**Files:** `AGENTS.md`, `DASHBOARDS-MEMORY.md`, `PLATFORMS-ACCESS-MEMORY.md`, `docs/operations/2026-09-23-main-reconciliation.md`, this plan.

- [x] Document actual live identities and scope: root media+Abbott3001, Zaruku3002, MedRoche/site-SEO3003, Abbott candidate3004 not serving public traffic.
- [x] Document published/integrated Zaruku and site-SEO work separately from pending Abbott extraction/cutover.
- [x] Correct stale broad claims that all 189 main commits are missing media functionality: production feature content already matches main.
- [x] Obtain independent final review of merge resolution, plan patch placement, and runtime preservation (no must-fix findings; 93 targeted tests passed).
- [x] Refresh origin; fast-forward clean local main and push normally only if no concurrent change invalidates review. No force-push, reset, branch deletion, or deployment.
- [ ] Report source cleanup separately from production status and the outstanding Abbott boundary.
