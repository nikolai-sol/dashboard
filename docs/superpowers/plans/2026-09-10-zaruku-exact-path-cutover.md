# Zaruku Exact-Path Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move only Zaruku dashboard, API, exports, numeric aliases, and dedicated assets to the isolated `dashboard-zaruku` runtime on `127.0.0.1:3002`, while the unchanged combined runtime continues to own every other public route on `127.0.0.1:3001`.

**Architecture:** Extend the reviewed production-shadow control plane with a separate, fail-closed exact-path cutover operator. The operator pins the reviewed application SHA and current Nginx predecessor hash, renders and validates one deterministic Zaruku route block, installs it atomically under root ownership, reloads Nginx, verifies public/authenticated behavior and foreign-runtime stability, and restores the byte-identical predecessor on any failed post-install assertion.

**Tech Stack:** Node.js ESM and `node:test`, SSH, Nginx, PM2, Next.js 16 standalone runtime, canonical MySQL read model, authenticated HTTP/browser smoke checks.

## Global Constraints

- Application source remains the reviewed `release/zaruku` SHA `0630a94c2ea493ba76e4c5932f6b83a351fbd810`; the cutover branch may add only operator, tests, authority, documentation, and evidence.
- The expected predecessor is `/etc/nginx/conf.d/dashboard-next.conf` SHA-256 `1c0363a55ae130e0e96be984fcaafe32384f2cf3c73d21e8d319dd96e940566b`.
- Do not stop, restart, reload, redeploy, or alter the combined `dashboard-next` process on port `3001`.
- Do not call source APIs or write, migrate, backfill, delete, or reclassify canonical MySQL data.
- Do not edit cron, secrets, database grants, firewall rules, other application routes, or other PM2 applications.
- Secret values and authenticated response bodies never enter argv, Git, stdout, stderr, logs, reports, or test snapshots.
- A missing manager auth descriptor, a non-`GO` production shadow, unexpected current state, or any parity mismatch is a hard stop before Nginx mutation.
- A failure after Nginx installation triggers byte-identical rollback, syntax validation, reload, and rollback verification.

---

### Task 1: Pin the Cutover Authority and Pure Nginx Contract

**Files:**
- Create: `deploy/zaruku/nginx-cutover.json`
- Create: `scripts/zaruku-exact-path-cutover.mjs`
- Create: `scripts/zaruku-exact-path-cutover.test.mjs`
- Modify: `package.json`
- Modify: `scripts/predeploy-verify.sh`

**Interfaces:**
- Produces: `loadCutoverAuthority(filename): CutoverAuthority`
- Produces: `renderCutoverConfig(predecessor, authority): string`
- Produces: `assertPredecessorConfig(text, authority): void`
- Produces: `assertCandidateConfig(text, authority): void`
- Consumes: `deploy/zaruku/release.json`, `deploy/zaruku/production-shadow.json`

- [ ] **Step 1: Write failing authority and render tests**

Cover exact object keys and values, deep freeze, unexpected-key refusal, release/shadow cross-contract equality, exact predecessor hash, candidate determinism, and insertion before the broad `location ^~ /dashboard/` fallback.

The required authority is:

```json
{
  "scope": "zaruku",
  "reviewedAppSha": "0630a94c2ea493ba76e4c5932f6b83a351fbd810",
  "combinedPort": 3001,
  "isolatedPort": 3002,
  "targetFile": "/etc/nginx/conf.d/dashboard-next.conf",
  "expectedPredecessorSha256": "1c0363a55ae130e0e96be984fcaafe32384f2cf3c73d21e8d319dd96e940566b",
  "assetPrefix": "/_next-zaruku",
  "dashboardSlug": "zaruku",
  "numericAlias": "28"
}
```

The fixture must prove these exact mappings and no prefix ownership:

```js
assert.equal(owner('/dashboard/zaruku'), 3002);
assert.equal(owner('/dashboard/zaruku/'), 3002);
assert.equal(owner('/api/dashboard/zaruku'), 3002);
assert.equal(owner('/api/dashboard/zaruku/pdf'), 3002);
assert.equal(owner('/api/dashboard/zaruku/excel'), 3002);
assert.equal(owner('/_next-zaruku/chunks/app.js'), 3002);
assert.equal(rewrite('/dashboard/28?month=2026-08'), '/dashboard/zaruku?month=2026-08');
assert.equal(rewrite('/api/dashboard/28/excel?month=2026-08'), '/api/dashboard/zaruku/excel?month=2026-08');
assert.equal(owner('/dashboard/280'), 3001);
assert.equal(owner('/api/dashboard/280'), 3001);
assert.equal(owner('/dashboard/abbott'), 3001);
assert.equal(owner('/api/health'), 3001);
assert.equal(owner('/api/dashboard-auth/session'), 3001);
assert.equal(owner('/_next/static/chunk.js'), 3001);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/zaruku-exact-path-cutover.test.mjs
```

Expected: FAIL because the authority and functions do not exist.

- [ ] **Step 3: Implement strict authority loading and deterministic rendering**

Use only Node core modules. Reject an absent/non-regular/symlinked authority, extra keys, invalid paths, non-literal values, release SHA mismatch, port overlap, or shadow/release disagreement. Render exact `location =` entries for page/API/aliases and one `location ^~ /_next-zaruku/` entry. Preserve the existing forwarding headers, websocket behavior, timeouts, cache bypass, CSP, and HSTS directives from the recognized Zaruku-compatible dashboard block.

Reject a predecessor containing port `3002`, `/_next-zaruku`, a Zaruku exact location, a duplicate broad dashboard fallback, an unexpected target hash, or unrecognized broad port-`3001` ownership. Candidate validation must parse only the approved grammar and prove that the predecessor bytes outside the inserted block are unchanged.

- [ ] **Step 4: Verify GREEN and wire the source-only gate**

Run:

```bash
node --test scripts/zaruku-exact-path-cutover.test.mjs
npm run test:deploy-source
```

Add `test:zaruku-exact-path-cutover` to `package.json` and call it exactly once from `scripts/predeploy-verify.sh`. No source test may invoke SSH, `sudo`, Nginx reload, PM2 mutation, or a production apply mode.

- [ ] **Step 5: Commit Task 1**

```bash
git add deploy/zaruku/nginx-cutover.json scripts/zaruku-exact-path-cutover.mjs scripts/zaruku-exact-path-cutover.test.mjs package.json package-lock.json scripts/predeploy-verify.sh
git commit -m "feat(zaruku): define exact-path cutover authority"
```

---

### Task 2: Implement the Atomic Remote Mutation and Rollback State Machine

**Files:**
- Modify: `scripts/zaruku-exact-path-cutover.mjs`
- Modify: `scripts/zaruku-exact-path-cutover.test.mjs`

**Interfaces:**
- Produces: `runCutover(adapter): Promise<CutoverDecision>`
- Produces: `createProductionCutoverAdapter(): CutoverAdapter`
- Produces: `cutoverMain(args): Promise<void>`

- [ ] **Step 1: Write failing state-machine tests with an injected fake adapter**

Test the exact order:

```text
source -> shadow -> baseline -> read-predecessor -> render -> validate -> backup
-> stage-candidate -> install -> nginx-test -> reload -> verify -> report
```

Test refusal before mutation for a stale predecessor, changed release ref, missing shadow evidence, manager-auth failure, port/process mismatch, and changed combined-runtime baseline. Inject failures at `install`, `nginx-test`, `reload`, and every post-check; prove that every failure after installation calls `restore -> nginx-test -> reload -> verify-rollback` once, while failures before installation never call rollback.

Also prove that an ambiguous transport response fails closed, reports only fixed labels/hashes, never retries mutation, and never stops or reloads a PM2 application.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/zaruku-exact-path-cutover.test.mjs
```

Expected: FAIL because the state machine and adapter do not exist.

- [ ] **Step 3: Implement the fixed state machine**

The production adapter accepts no host/path/port/SHA overrides. It connects only to SSH alias `beget` with batch mode and strict host-key checking. It sends candidate bytes through stdin, not argv. Remote code runs with a fixed minimal `PATH`, uses root-owned files, rejects symlinks and hard links, records device/inode/owner/mode/hash, creates a mode-`0600` backup, fsyncs file and directory, and atomically renames a same-filesystem candidate.

Run `/usr/sbin/nginx -t` after installation and before `/usr/sbin/nginx -s reload`. Rollback restores only the verified predecessor backup. It must verify the restored file SHA equals the pinned predecessor before reload and confirm public Zaruku is back on the combined asset prefix afterward. Retain the backup path in sanitized evidence until acceptance.

Before installation, re-read and re-hash the target and re-attest the combined and isolated processes. After reload, compare the exact combined PID, cwd, source SHA, listener, and foreign-route status with the baseline.

- [ ] **Step 4: Add direct-invocation and secret-redaction protections**

The CLI accepts only `check` or `apply`; `apply` performs its own complete check and cannot consume prior mutable state. Reject environment authority overrides, extra argv, alternate SSH destinations, alternate target files, or unsafe Node invocation aliases. All caught production errors collapse to a fixed message; a structured decision contains only approved booleans, status classes, PIDs, SHAs, hashes, route labels, and backup path.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test scripts/zaruku-exact-path-cutover.test.mjs
npm run test:zaruku-exact-path-cutover
npm run test:zaruku-production-shadow
```

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/zaruku-exact-path-cutover.mjs scripts/zaruku-exact-path-cutover.test.mjs
git commit -m "feat(zaruku): add atomic cutover rollback operator"
```

---

### Task 3: Complete the Production Shadow and Dry-Run the Cutover

**Files:**
- Modify only if a regression is demonstrated: existing shadow source/tests
- Create after the run: `docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md`

- [ ] **Step 1: Re-run the complete local release gates from the clean reviewed application source**

Run the repository-defined gates without weakening or skipping any check:

```bash
npm test
npm run typecheck
npm run lint
npm run build:zaruku
npm run test:zaruku-production-shadow
npm run test:zaruku-exact-path-cutover
```

Record only pass/fail counts and artifact hashes.

- [ ] **Step 2: Diagnose any exact release-authority refusal without bypasses**

Run:

```bash
node scripts/freeze-zaruku-shadow-release.mjs check
```

If it refuses, inspect the clean source identity, literal remote URL, exact live `refs/heads/release/zaruku`, known-host policy, and branch/SHA contract read-only. Fix source code only when a reproducible test demonstrates a defect; never replace the reviewed release ref or relax exact equality for this cutover.

- [ ] **Step 3: Verify the protected manager-auth descriptor**

Run the existing descriptor check through the staged control plane. If the descriptor is absent or invalid, stop before deployment and obtain a fresh authenticated manager session through the existing stdin/descriptor installer. Never print or persist the cookie outside `/var/www/.dashboard-zaruku-shadow/auth.json` mode `0600`.

- [ ] **Step 4: Run the fixed production shadow**

Run:

```bash
npm run shadow:zaruku:run
```

Require immutable `GO` evidence for the exact reviewed SHA, stable same-snapshot canonical comparison, port `3002` loopback-only process attestation, Wordstat, Alice visibility/competitors, SEO, PDF/XLSX parity, unchanged combined PID/SHA, and unchanged loaded Nginx hash. A `NO-GO` ends the production attempt with public routing untouched.

- [ ] **Step 5: Run the cutover read-only check**

Run:

```bash
node scripts/zaruku-exact-path-cutover.mjs check
```

Require the pinned predecessor hash, exact process identities, isolated asset readiness, manager authentication, public port closure, deterministic candidate hash, backup destination readiness, and no detected production drift.

- [ ] **Step 6: Start the sanitized report**

Record source SHA, branch, clean status, test counts, shadow evidence directory/hash, process PIDs/cwds/source SHAs, target and loaded Nginx hashes, candidate hash, route assertions, canonical parity assertions, and `READY` or `NO-GO`. Do not record response bodies, cookies, environment values, DB credentials, or raw database rows.

---

### Task 4: Apply the Exact-Path Production Cutover

**Files:**
- Modify: `/etc/nginx/conf.d/dashboard-next.conf` on production only through the reviewed operator
- Create: one root-owned predecessor backup on production
- Modify: `docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md`

- [ ] **Step 1: Capture the immediate pre-cutover baseline**

Record the exact `dashboard-next` PID/cwd/source SHA and `127.0.0.1:3001` listener, `dashboard-zaruku` PID/cwd/source SHA and `127.0.0.1:3002` listener, target-file SHA, loaded Nginx SHA, external closure of ports `3001/3002`, and representative route statuses/assets.

- [ ] **Step 2: Apply through the single production entrypoint**

Run:

```bash
node scripts/zaruku-exact-path-cutover.mjs apply
```

Do not manually edit Nginx, manually reload it, or run a second apply. The operator must produce either `CUTOVER` with a retained verified backup or `ROLLED-BACK` with the predecessor hash restored.

- [ ] **Step 3: Stop on automatic rollback or ambiguous state**

If the result is `ROLLED-BACK`, verify the public Zaruku route again resolves to the combined runtime and document the first fixed failure label. If the transport result is ambiguous, inspect installed and backup hashes read-only; do not re-run apply until exact state has been independently resolved.

- [ ] **Step 4: Commit the source implementation and initial report**

```bash
git add docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md
git commit -m "ops(zaruku): record exact-path production cutover"
```

---

### Task 5: Verify Public Isolation, Restored Views, and Rollback Readiness

**Files:**
- Modify: `docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md`

- [ ] **Step 1: Verify exact public route ownership**

Require `200` for `/dashboard/zaruku` and `/dashboard/28`, dedicated `/_next-zaruku/` page assets, matching authenticated slug/numeric API identities, successful PDF and XLSX endpoints, and no route leakage for `/dashboard/280` or `/api/dashboard/280`.

- [ ] **Step 2: Verify the restored manager UI**

Using the authenticated browser session, confirm the eight-tab order at desktop and narrow mobile widths. Open `ИИ-видимость и конкуренты` and verify July/August snapshots plus competitor detail. Open `Спрос Wordstat` and verify real coverage/status labels. Check browser console/network for introduced errors.

- [ ] **Step 3: Verify all foreign routes and the combined process are unchanged**

Check representative Gidrofuril, Abbott, advertising, health, login, admin, and shared `/_next/*` requests. Re-attest the exact pre-cutover combined PID, cwd, source SHA, and port `3001` listener. Confirm the combined process was neither restarted nor reloaded.

- [ ] **Step 4: Verify configuration and canonical-data invariants**

Require that the loaded Nginx configuration differs from the baseline only by the reviewed Zaruku block, the target matches the deterministic candidate hash, both application ports remain externally closed, and the shadow comparison's canonical table counts/period totals remain unchanged.

- [ ] **Step 5: Verify rollback readiness without executing rollback**

Read-only verify backup owner/mode/device/inode/hash, prove it equals the exact predecessor, and prove the operator's rollback grammar accepts only that file. Retain it pending owner acceptance.

- [ ] **Step 6: Run the final source regression suite and finalize evidence**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run test:zaruku-production-shadow
npm run test:zaruku-exact-path-cutover
git status --short
```

The report result is `DONE` only if all public, authenticated, foreign-runtime, configuration, data-parity, and rollback checks pass. Otherwise it is `ROLLED-BACK` or `NO-GO`.

- [ ] **Step 7: Commit the final verified report**

```bash
git add docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md
git commit -m "docs(zaruku): finalize cutover verification evidence"
```

