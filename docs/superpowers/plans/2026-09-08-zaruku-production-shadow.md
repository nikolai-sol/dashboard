# Zaruku Production Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the independently built Zaruku runtime on production loopback port `3002`, prove live parity with the combined runtime on port `3001`, and produce a sanitized go/no-go report without changing public traffic.

**Architecture:** Add fixed, fail-closed production-shadow contracts around the already reviewed Zaruku release path. Provision a dedicated Linux service identity and a dedicated MySQL reader, install secrets through protected file/descriptor paths, deploy the sealed artifact, and compare both loopback runtimes against the same canonical database state. Nginx remains byte-for-byte unchanged and the combined runtime remains authoritative.

**Tech Stack:** Node.js ESM, TypeScript test runner, Bash, MySQL 8, PM2, Linux `setpriv`/`procfs`/`ss`, Python 3 descriptor-safe artifact stamper, SSH, Next.js 16 standalone runtime.

## Global Constraints

- Public URLs remain unchanged and continue to resolve through `127.0.0.1:3001` for the entire plan.
- Do not edit or reload Nginx; do not start a cutover.
- Do not stop, restart, reload, or redeploy `dashboard-next` or `nest-analytics`.
- External source APIs are collector-only; the shadow reads canonical MySQL only.
- Do not write, migrate, backfill, delete, reclassify, or replace canonical facts or coverage.
- Direct historical additions and all period totals must remain visible and unchanged.
- The Zaruku runtime must not receive Abbott private credentials, access `report_bd_private`, or package Abbott/private assets.
- The MySQL identity is fixed as `dashboard_zaruku_reader`@`127.0.0.1` and receives table-level `SELECT` only.
- The Linux identity, group, and PM2 app name are fixed as `dashboard-zaruku`.
- Runtime paths, port `3002`, release branch `release/zaruku`, asset prefix `/_next-zaruku`, and lock paths remain those in `deploy/zaruku/release.json`.
- Secret values never appear in argv, Git, stdout, stderr, PM2 descriptions, logs, or evidence.
- Any failed prerequisite, attestation, or stable parity comparison produces `NO-GO` and leaves public traffic untouched.
- Production mutations require exact-target preflight evidence and must be reversible without touching another runtime.

---

## File Structure

- `deploy/zaruku/production-shadow.json` — immutable loopback, identity, period, evidence, and no-cutover authority.
- `deploy/zaruku/mysql-read-tables.json` — exact physical-table allowlist for the dedicated reader.
- `scripts/zaruku-production-shadow-authority.mjs` — dependency-free strict JSON/key/path/freeze loaders and fixed control inventory, shipped byte-for-byte in the control bundle.
- `scripts/zaruku-production-shadow-contract.mjs` — re-exports the pure loaders and retains the independent runtime-manifest/release cross-check and transitive SQL scanner; never shipped with TypeScript/npm dependencies.
- `scripts/zaruku-production-shadow-contract.test.mjs` — contract and foreign-scope negative fixtures.
- `scripts/zaruku-production-shadow-preflight.mjs` — read-only host/database/Nginx/process inspection.
- `scripts/zaruku-production-shadow-preflight.test.mjs` — injected host-state and secret-redaction fixtures.
- `scripts/zaruku-shadow-host.mjs` — fixed check/apply/rollback boundary for the Linux account and directories.
- `scripts/zaruku-shadow-host.test.mjs` — disposable filesystem and command-adapter fixtures.
- `scripts/zaruku-shadow-db.mjs` — fixed check/apply/rollback boundary for the dedicated MySQL reader.
- `scripts/zaruku-shadow-db.test.mjs` — SQL-plan, exact-grant, negative-permission, and sanitized-failure fixtures.
- `scripts/install-zaruku-shadow-auth.mjs` — stdin-only protected installer for the existing manager cookie descriptor.
- `scripts/install-zaruku-shadow-auth.test.mjs` — descriptor, mode, link, size, and output-redaction fixtures.
- `scripts/stage-zaruku-shadow-control.mjs` — transports only the reviewed, hash-attested provisioning control bundle to a SHA-addressed root-owned server directory.
- `scripts/stage-zaruku-shadow-control.test.mjs` — payload, digest, path, immutability, and no-runtime-mutation fixtures.
- `deploy/zaruku/linux-fixture.Dockerfile` — minimal test-only image derived from the pinned official Node base.
- `deploy/zaruku/linux-fixture.json` — pinned base digest, Debian snapshot, package versions, build-input hashes, and final local image ID.
- `scripts/build-zaruku-linux-fixture.sh` — fixed builder and package-manifest attestation for the test-only image.
- `scripts/run-zaruku-linux-fixtures.sh` — fixed network-disabled Docker runner for the Linux-only tests.
- `scripts/run-zaruku-linux-fixtures.test.sh` — source tests for digest pinning, mounts, capabilities, and network isolation.
- `scripts/run-zaruku-production-shadow.mjs` — orchestrates fixed preflight, existing deploy, live parity, and final evidence.
- `scripts/run-zaruku-production-shadow.test.mjs` — state-machine tests proving no cutover or foreign-process action.
- `scripts/zaruku-production-shadow-remote.mjs` and `.test.mjs` — fixed source-side transport; inspect-only bundle attestation precedes every staged worker action.
- `scripts/zaruku-production-shadow-worker.mjs` and `.test.mjs` — concrete read-only host/secret/auth/DB checks, live process attestation, paired verifier, exact Zaruku stop and immutable evidence.
- `scripts/install-zaruku-shadow-inventory.mjs` and `.test.mjs` — explicit install/check of the one source-pinned combined-dashboard SHA row; never called implicitly by orchestration.
- `scripts/zaruku-shadow-coverage.mjs` and `.test.mjs` — exact 25-table schema and scoped metadata token; no business rows or unrelated global runs.
- `scripts/zaruku-shadow-mysql.py`, `.test.py`, and `.linux.test.py` — fixed MySQL CLI bridge with attested binary FD, anonymous sealed credential FD, bounded output and deadline, plus real disposable Linux descriptor tests.
- `scripts/zaruku-xlsx-semantic.py` and `.test.py` — bounded stdlib ZIP/XML semantics, stdin bytes and digest-only output; no JSZip/esbuild/runtime dependency borrowing.
- `scripts/zaruku-shadow-evidence.test.mjs` — real disposable-filesystem inode, exclusive publication and immutable permission fixtures.
- `scripts/zaruku-shadow-evidence-lock.py`, `.test.py`, and `scripts/zaruku-shadow-evidence.linux.test.mjs` — receipt-bound directory-FD flock, bounded inherited writer-lifetime supervision, sanitized CLI and real worker-death/publication-race fixtures.
- `scripts/zaruku-linux-fixture-policy.mjs` and `.test.mjs` — fixed build/verify/run image policy and negative authority/platform tests.
- `scripts/runtime-boot-environment.test.mjs` and existing Linux boot fixture — exact environment regression and independently owned `env -i` boundary.
- `scripts/predeploy-verify.sh` and `package.json` — run all new source-only fixtures; never run production apply actions.
- `OPS.md` — exact preparation, apply, verification, failure, and cleanup commands.
- `docs/superpowers/reports/2026-09-08-zaruku-production-shadow-readiness.md` — generated production evidence summary and final `GO`/`NO-GO` for a later cutover plan.

---

### Task 1: Freeze the Production-Shadow Authority and Read-Only Preflight

**Files:**
- Create: `deploy/zaruku/production-shadow.json`
- Create: `scripts/zaruku-production-shadow-contract.mjs`
- Create: `scripts/zaruku-production-shadow-contract.test.mjs`
- Create: `scripts/zaruku-production-shadow-preflight.mjs`
- Create: `scripts/zaruku-production-shadow-preflight.test.mjs`
- Modify: `package.json`
- Modify: `scripts/predeploy-verify.sh`

**Interfaces:**
- Produces: `loadShadowAuthority(filename): ShadowAuthority`
- Produces: `loadMysqlTableAuthority(filename): MysqlTableAuthority`
- Produces: `inspectShadowPrerequisites(adapter): Promise<SanitizedPreflightEvidence>`
- Produces: `assertShadowPrerequisites(evidence): void`
- Consumes: `RUNTIME_MANIFESTS.zaruku` and `deploy/zaruku/release.json`

- [ ] **Step 1: Write failing contract tests**

Add tests that require exact authority and reject overrides:

```js
test('production shadow authority is loopback-only and cannot authorize cutover', () => {
  const authority = loadShadowAuthority('deploy/zaruku/production-shadow.json');
  assert.equal(authority.scope, 'zaruku');
  assert.equal(authority.combinedUrl, 'http://127.0.0.1:3001');
  assert.equal(authority.isolatedUrl, 'http://127.0.0.1:3002');
  assert.equal(authority.publicCutover, false);
  assert.deepEqual(authority.period, { from: '2026-01-01', to: '2026-08-31' });
  assert.equal(authority.serviceAccount, 'dashboard-zaruku');
  assert.equal(authority.mysqlAccount, 'dashboard_zaruku_reader@127.0.0.1');
});

test('preflight fails when nginx mentions port 3002 or another process owns it', async () => {
  const evidence = await inspectShadowPrerequisites(fixtureAdapter({
    nginxText: 'proxy_pass http://127.0.0.1:3002;',
    listeners: [{ host: '127.0.0.1', port: 3002, process: 'foreign' }],
  }));
  assert.throws(() => assertShadowPrerequisites(evidence), /public routing|port 3002/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs
```

Expected: FAIL because the authority and exported functions do not exist.

- [ ] **Step 3: Implement the exact JSON authority**

Create `deploy/zaruku/production-shadow.json` with this complete shape:

```json
{
  "scope": "zaruku",
  "combinedUrl": "http://127.0.0.1:3001",
  "isolatedUrl": "http://127.0.0.1:3002",
  "serviceAccount": "dashboard-zaruku",
  "mysqlAccount": "dashboard_zaruku_reader@127.0.0.1",
  "mysqlDatabase": "report_bd",
  "secretFile": "/var/www/.dashboard-zaruku-secrets/runtime.env",
  "authDescriptor": "/var/www/.dashboard-zaruku-shadow/auth.json",
  "otherRuntimeShas": "/var/www/.dashboard-zaruku-shadow/other-runtime-shas.tsv",
  "otherRuntimeShaEntries": [{ "name": "combined-dashboard", "path": "/var/www/dashboard/.release-source-sha" }],
  "evidenceRoot": "/var/www/.dashboard-zaruku-shadow/evidence",
  "verifierTimeout": { "binary": "/usr/bin/timeout", "seconds": 180, "killAfterSeconds": 5, "lockWaitSeconds": 210 },
  "period": { "from": "2026-01-01", "to": "2026-08-31" },
  "httpTimeoutMs": 15000,
  "publicCutover": false
}
```

Implement strict object-key, value, path, loopback, period, scope, and cross-contract validation. The loader must deep-freeze its return value and reject extra keys.

- [ ] **Step 4: Implement injected read-only preflight**

The real adapter may execute only these read commands: `id`, `getent`, `command -v`, `stat`, `ss`, `pm2 status`, `sha256sum`, MySQL `CURRENT_USER()`/schema metadata, and read-only Nginx file reads. It must return booleans, names, modes, hashes, and process IDs only. It must never return environment values, PM2 environment, database rows, or secret-file contents.

The assertion requires:

```js
assert.equal(evidence.combined.port, 3001);
assert.equal(evidence.combined.status, 'online');
assert.equal(evidence.isolatedPort.free, true);
assert.equal(evidence.nginx.referencesIsolatedPort, false);
assert.equal(evidence.tools.setpriv, '/usr/bin/setpriv');
assert.equal(evidence.tools.python3, '/usr/bin/python3');
assert.equal(evidence.mysql.rootSocketAdmin, true);
```

Existing compliant Zaruku resources are allowed only when every owner, group, mode, path, and identity check passes; partial or foreign state fails closed.

- [ ] **Step 5: Verify GREEN and wire source-only fixtures**

Run:

```bash
node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs
npm run test:deploy-source
```

Add the two new test files to a `test:zaruku-production-shadow` package script and call that test script from `predeploy-verify.sh`. Do not call a production `--apply` mode from predeploy.

- [ ] **Step 6: Commit Task 1**

```bash
git add deploy/zaruku/production-shadow.json scripts/zaruku-production-shadow-contract.mjs scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.mjs scripts/zaruku-production-shadow-preflight.test.mjs package.json package-lock.json scripts/predeploy-verify.sh
git commit -m "feat(zaruku): add production shadow preflight authority"
```

---

### Task 2: Define and Verify the Exact MySQL Read Boundary

**Files:**
- Create: `deploy/zaruku/mysql-read-tables.json`
- Create: `scripts/zaruku-shadow-db.mjs`
- Create: `scripts/zaruku-shadow-db.test.mjs`
- Modify: `scripts/zaruku-production-shadow-contract.mjs`
- Modify: `scripts/zaruku-production-shadow-contract.test.mjs`

**Interfaces:**
- Consumes: `loadMysqlTableAuthority(filename)` from Task 1
- Produces: `buildReaderSql(authority, password): SqlOperation[]`
- Produces: `applyReaderBoundary(adapter, passwordFd): Promise<DbBoundaryEvidence>`
- Produces: `verifyReaderBoundary(adminAdapter, readerAdapter): Promise<DbBoundaryEvidence>`
- Fixed account: `'dashboard_zaruku_reader'@'127.0.0.1'`

- [ ] **Step 1: Write failing allowlist and SQL tests**

```js
test('grant authority contains every physical Zaruku read table and no advertising/private table', () => {
  const tables = loadMysqlTableAuthority('deploy/zaruku/mysql-read-tables.json').tables;
  assert.ok(tables.includes('canonical_fact_site_analytics_daily'));
  assert.ok(tables.includes('canonical_fact_wordstat_requests_snapshot'));
  assert.ok(tables.includes('canonical_alice_visibility_snapshots'));
  assert.ok(tables.includes('seo_positions_weekly'));
  assert.ok(tables.includes('dashboard_sources'));
  assert.ok(tables.includes('dashboard_access_users'));
  assert.ok(tables.includes('dashboard_shared_access_settings'));
  assert.ok(!tables.some(name => /abbott|advertising|ads_daily|report_bd_private/.test(name)));
  assert.deepEqual(tables, [...tables].sort());
});

test('reader SQL grants table-level SELECT only', () => {
  const operations = buildReaderSql(authority, 'fixture-secret');
  assert.ok(operations.every(op => !/INSERT|UPDATE|DELETE|CREATE VIEW|GRANT OPTION/i.test(op.sql)));
  assert.ok(operations.some(op => op.sql === 'GRANT SELECT ON `report_bd`.`dashboards` TO ?'));
});
```

Also add failures for an existing unexpected account, missing table, view substitution, wildcard grant, global grant, schema grant, private-schema visibility, write success, unknown input key, password in an error, and password in recorded evidence.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test scripts/zaruku-shadow-db.test.mjs
```

Expected: FAIL because the authority and DB boundary functions do not exist.

- [ ] **Step 3: Create the exact sorted table authority**

The JSON list must contain exactly these physical `report_bd` tables:

```text
canonical_alice_visibility_featured_sites
canonical_alice_visibility_queries
canonical_alice_visibility_snapshots
canonical_alice_visibility_sources
canonical_collector_runs
canonical_dim_wordstat_regions
canonical_fact_gsc_queries_daily
canonical_fact_gsc_search_appearance_daily
canonical_fact_gsc_search_type_daily
canonical_fact_metrika_breakdowns_daily
canonical_fact_metrika_returning_pages_daily
canonical_fact_site_analytics_daily
canonical_fact_webmaster_pages_daily
canonical_fact_webmaster_queries_daily
canonical_fact_webmaster_query_pages_daily
canonical_fact_webmaster_summary_daily
canonical_fact_wordstat_dynamics_daily
canonical_fact_wordstat_regions_snapshot
canonical_fact_wordstat_requests_snapshot
canonical_metrika_breakdown_coverage_daily
canonical_wordstat_coverage
canonical_wordstat_query_classifications
canonical_wordstat_seed_registry
dashboard_access_users
dashboard_campaign_filters
dashboard_shared_access_settings
dashboard_sources
dashboards
seo_ai_visibility
seo_opportunities
seo_positions_weekly
seo_section_patterns
seo_sov_weekly
seo_tasks
seo_weekly_runs
```

Add a static SQL-owner scan over the complete transitive Zaruku runtime dependency graph rooted at
`apps/zaruku`. Extract CTE names before comparing `FROM`/`JOIN` references so CTE aliases do not
become grants. The test must fail if a later code change introduces a physical table missing from the
authority or if the authority contains a table that the reviewed runtime no longer reads. In
particular, `source_catalog` is a CTE and is never a grant target; the unused legacy
`zaruku-google-search-console.ts` module does not add its pages, countries, or summary tables to the
runtime authority.

- [ ] **Step 4: Implement fail-closed DB apply/verify operations**

`--apply` runs only as production root through the local MySQL socket. It refuses an existing account during the first creation run, creates the exact host-qualified account with a password read from a numeric inherited FD, and grants `SELECT` on each exact table. If any statement or verification fails during first creation, it drops only `'dashboard_zaruku_reader'@'127.0.0.1'` and returns a sanitized failure.

`--verify` asserts:

```js
{
  account: 'dashboard_zaruku_reader@127.0.0.1',
  globalPrivileges: [],
  schemaPrivileges: [],
  tableSelectCount: authority.tables.length,
  unexpectedPrivileges: [],
  canSelectAllowedFamilies: true,
  canWriteCanonicalFacts: false,
  canReadPrivateSchema: false,
  canReadAdvertisingOnlyFact: false
}
```

Positive probes return `COUNT(*) >= 0` only; evidence never records row values. Negative probes must receive access-denied errors and must not mutate data. Use `START TRANSACTION; UPDATE ...; ROLLBACK` only if MySQL rejects the `UPDATE` before execution; never grant write access to make the test pass.

- [ ] **Step 5: Run focused tests**

```bash
node --test scripts/zaruku-shadow-db.test.mjs
npm run test:zaruku-production-shadow
git diff --check
```

Expected: all pass, and fixture logs contain none of the supplied secret markers.

- [ ] **Step 6: Commit Task 2**

```bash
git add deploy/zaruku/mysql-read-tables.json scripts/zaruku-shadow-db.mjs scripts/zaruku-shadow-db.test.mjs scripts/zaruku-production-shadow-contract.mjs scripts/zaruku-production-shadow-contract.test.mjs
git commit -m "feat(zaruku): define dedicated database reader boundary"
```

---

### Task 3: Add Fixed Host, Secret, and Auth-Descriptor Provisioning

**Files:**
- Create: `scripts/zaruku-shadow-host.mjs`
- Create: `scripts/zaruku-shadow-host.test.mjs`
- Create: `scripts/install-zaruku-shadow-auth.mjs`
- Create: `scripts/install-zaruku-shadow-auth.test.mjs`
- Modify: `scripts/runtime-release-remote.mjs`
- Modify: `scripts/deploy-zaruku.test.mjs`
- Modify: `OPS.md`

**Interfaces:**
- Produces: `inspectHostBoundary(adapter): HostBoundaryEvidence`
- Produces: `applyHostBoundary(adapter): HostBoundaryEvidence`
- Produces: `rollbackNewHostBoundary(adapter, creationRecord): void`
- Produces: `installRuntimeSecrets(adapter, databasePasswordFd): SecretInstallEvidence`
- Produces CLI: `node scripts/install-zaruku-shadow-auth.mjs` reading descriptor bytes only from stdin

- [ ] **Step 1: Write failing host and secret tests**

Cover exact account creation, no-login shell, one-group membership, root-owned ancestry, directory modes, idempotent compliant checks, rejection of partial/foreign state, and exact rollback targets.

```js
test('host apply creates only the fixed Zaruku service identity and roots', async () => {
  const adapter = fixtureHost();
  const evidence = await applyHostBoundary(adapter);
  assert.deepEqual(adapter.createdUsers, [{
    name: 'dashboard-zaruku', group: 'dashboard-zaruku', shell: '/usr/sbin/nologin', home: '/nonexistent'
  }]);
  assert.equal(evidence.listener.port3002Free, true);
  assert.equal(adapter.foreignMutations.length, 0);
});
```

Secret fixtures must prove that the combined source file is read stably from the fixed path
`/var/www/www-root/data/.production.env`, only `DASHBOARD_AUTH_SECRET` and the optional Chromium path
are copied, the dedicated DB password arrives through an inherited FD, and output never contains any
secret marker. Reject symlinks, hardlinks, writable ancestry, duplicate keys, malformed UTF-8,
oversized files, existing unsafe destinations, and a source file changed during the read.

Auth installer fixtures accept only `{"headers":{"cookie":"..."}}`, write a new single-link file
mode `0600` under root-owned `/var/www/.dashboard-zaruku-shadow`, and print only a success status plus
SHA-256 of the descriptor bytes. They reject `authorization`, `host`, line breaks, extra JSON keys,
oversized input, terminal echo, and an existing non-empty descriptor.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test scripts/zaruku-shadow-host.test.mjs scripts/install-zaruku-shadow-auth.test.mjs
```

Expected: FAIL because the provisioning functions do not exist.

- [ ] **Step 3: Implement fixed check/apply/rollback host operations**

The CLI accepts only `check`, `apply`, or `rollback-created` and the fixed authority path. `apply`
requires real and effective UID `0`; `check` is read-only. All system commands use absolute binaries
and argument arrays. Create only:

```text
dashboard-zaruku system group
dashboard-zaruku system user
/var/www/dashboard-zaruku-releases
/var/www/dashboard-zaruku-backups
/var/www/.dashboard-zaruku-control
/var/www/.dashboard-zaruku-secrets
/var/www/.dashboard-zaruku-shadow
/var/www/.dashboard-zaruku-shadow/evidence
```

Do not pre-create the deploy lock or active application path. Record device/inode/owner/group/mode
before and after each step. `rollback-created` consumes a root-owned creation record and removes only
resources proven to have been created by that exact run; it refuses non-empty foreign directories.

- [ ] **Step 4: Implement atomic runtime secret and auth installation**

`installRuntimeSecrets` writes the exact existing `KEY='value'` format expected by
`readZarukuSecrets()`, with:

```text
ZARUKU_DB_HOST='127.0.0.1'
ZARUKU_DB_PORT='3306'
ZARUKU_DB_USER='dashboard_zaruku_reader'
ZARUKU_DB_PASSWORD=singleQuote(databasePasswordBytesFromFd)
ZARUKU_DB_NAME='report_bd'
DASHBOARD_AUTH_SECRET=singleQuote(stablyReadDashboardAuthSecret)
NEXT_PUBLIC_BASE_URL='https://dashboards.adreports.ru'
```

The two expression lines describe the implementation variables: encode their bytes with the existing
single-quoted dotenv serializer and never substitute literal documentation text. Build the file in
memory, publish a new inode with mode `0600`, fsync file and directory, then re-read through a
no-follow descriptor and call `renderEnvironment()` for final validation. Return no secret values.

The auth installer disables terminal echo before reading, restores terminal state in `finally`,
validates the JSON with the same rules as `verify-zaruku-shadow.sh`, publishes atomically, and closes
all descriptors.

- [ ] **Step 5: Run focused and existing release tests**

```bash
node --test scripts/zaruku-shadow-host.test.mjs scripts/install-zaruku-shadow-auth.test.mjs
bash scripts/deploy-zaruku.test.sh
npm run test:zaruku-production-shadow
```

Expected: all pass; fixture secret markers are absent from stdout, stderr, exceptions, and evidence.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/zaruku-shadow-host.mjs scripts/zaruku-shadow-host.test.mjs scripts/install-zaruku-shadow-auth.mjs scripts/install-zaruku-shadow-auth.test.mjs scripts/runtime-release-remote.mjs scripts/deploy-zaruku.test.mjs OPS.md
git commit -m "feat(zaruku): add fixed shadow provisioning boundary"
```

---

### Task 4: Orchestrate Deployment and Live Parity Without Cutover

Approved integration clarifications (Task 4 source/control implementation only):

- The production architecture is `linux/amd64`; both the immutable base child manifest and final image inspection must match it. The explicit image lock records platform as well as every pinned input and the full installed package-manifest digest. No image build occurs inside predeploy or orchestration.
- Docker runtime remains network-none/read-only with read-only `/src`, only disposable tmpfs for fixture mutations, and only `SYS_PTRACE` added. The runner additionally tests the MySQL helper's real Linux memfd seals, bounded subprocess output/deadline, and binary identity using container-only fixture tools; no MySQL server is contacted.
- A pure ESM authority module supplies all staged loaders. The source contract retains its independent TypeScript runtime-manifest cross-check and scanner. The fixed staged closure includes the verifier shell and Python helpers byte-for-byte, not opaque bundles or another runtime's `node_modules`.
- The fixed `otherRuntimeShaEntries` authority contains exactly `combined-dashboard` → `/var/www/dashboard/.release-source-sha`. Its root-owned `0600` TSV is installed only by an explicit install/check action; the orchestrator pins its bytes and inode and rejects every extra/alternate row.
- MySQL check credentials travel only through stdin and a sealed anonymous defaults FD. Preflight attests `/usr/bin/mysql`; execution pins that same binary inode/digest through an inherited executable FD. No credential reaches argv, environment, disk, diagnostics, or evidence. SQL probes are read-only except the existing zero-row denied UPDATE in one rollback-only connection.
- Coverage tokens use only counts and maxima of reviewed identity/ingestion/timestamp/source-hash metadata from all 25 selected tables, with exact live `COLUMN_TYPE` checks. Dated facts and published Alice months use January–August; Wordstat current snapshot/coverage, seed/classification, and all seven SEO OS/intelligence tables are account-only, exactly as their manager read model. Account is fixed at `66624469`. A changed scoped token permits exactly one complete pair retry; unchanged, malformed, missing, or errored coverage cannot permit a retry. Global collector runs are never a trigger.
- The owned `/usr/bin/env -i` boundary follows `setpriv`. In the pinned amd64 translation runtime, Node receives exactly `UV_USE_IO_URING=0` even after that boundary; native arm64 Node and amd64 Python do not. Official Node/libuv source only reads that variable. Immediately before application require, normalize only that exact key/value, reject any other value, and assert the exact three-key environment. Parent-only/unknown variables still fail.
- The sealed Linux fixture proves `no_new_privs` and the full capability drop. Live PM2 attestation separately proves exact PID/UID/GID/supplementary groups/cwd/SHA and loopback ownership, rejecting nonzero effective/permitted/inheritable/ambient capabilities. It does not claim a live PM2 `NoNewPrivs` or bounding-capability guarantee and does not redesign PM2.
- Task 4 review correction: after prerequisite/release-source checks and before deployment, a separate fixed worker action exclusively allocates/fsyncs the evidence directory and returns its exact source-SHA/run-ID/device/inode receipt. The source adapter must retain that receipt before deployment. Parity and final publication require/revalidate it and never allocate or recover an existing directory; a parity error or lost reply cannot erase or replace the stored receipt. Loss of the allocation reply is a pre-deploy refusal. The public 14-step sequence remains unchanged; allocation is an internal guard before `deploy-zaruku`.
- Task 4 second review correction (approved tool boundary): every evidence writer retains the same receipt-bound directory-FD Linux flock, inherited through a staged fixed Python supervisor, Bash, Node and XLSX helper. A separate inherited pipe makes EOF of all writers—not SSH exit or verifier-leader exit—the completion proof. Preflight captures the exact root-owned regular non-symlink `/usr/bin/timeout` inode/hash with safe ancestry; revalidate immediately before fixed `--kill-after=5s 180s` execution in its own group. The supervisor handles TERM until writer EOF so timeout's KILL deadline also bounds an ignoring descendant. No caller PID, process discovery, reused identity, or recovery signalling is accepted. The worker transfers its lock copy before potentially slow coverage reads. Cleanup/publication acquire the same lock within 210 seconds (transport remains 240), then recheck receipt/path/owner/mode/ancestry and terminal inventory while holding it through hashing, fsync, chmod and atomic decision rename. Finalized/replaced directories reject queued writers. Add the helper to the exact 16-file control inventory; require timeout in the existing immutable image's executable manifest. Fixture runtime adds only disposable `/var/www` tmpfs, never a host mount. Record one full 180s/5s proof; repeatable fixtures assert those production arguments then shorten only their test-local duration to 2s, retaining 5s kill-after and delayed-write checks.
- Full-gate maintenance approved during Task 4: inject `2026-09-02T12:00:00Z` through the existing optional clock in the one pre-existing Wordstat historical-availability test. Its September 1 fixture otherwise expires against wall-clock time. No runtime code, freshness threshold, or expectation changes.

**Files:**
- Create: `scripts/stage-zaruku-shadow-control.mjs`
- Create: `scripts/stage-zaruku-shadow-control.test.mjs`
- Create: `deploy/zaruku/linux-fixture.Dockerfile`
- Create: `deploy/zaruku/linux-fixture.json`
- Create: `scripts/build-zaruku-linux-fixture.sh`
- Create: `scripts/run-zaruku-linux-fixtures.sh`
- Create: `scripts/run-zaruku-linux-fixtures.test.sh`
- Create: `scripts/run-zaruku-production-shadow.mjs`
- Create: `scripts/run-zaruku-production-shadow.test.mjs`
- Create: the pure authority, fixed remote/worker, inventory installer, coverage, MySQL, XLSX, evidence and environment fixture modules listed in File Structure above.
- Modify: `scripts/runtime-release-remote.mjs`, `scripts/boot-zaruku-service.linux.test.mjs`, `scripts/zaruku-production-shadow-contract.mjs`, and prior authority/host/DB tests/imports for those approved integration boundaries.
- Modify: `src/lib/zaruku-wordstat.test.ts` only for the approved deterministic test clock.
- Modify: `scripts/verify-zaruku-shadow.sh`
- Modify: `scripts/verify-zaruku-shadow.test.sh`
- Modify: `package.json`
- Modify: `OPS.md`

**Interfaces:**
- Consumes: Tasks 1–3 authorities and evidence
- Consumes: existing `scripts/deploy-zaruku.sh`
- Consumes: existing `scripts/verify-zaruku-shadow.sh`
- Produces: `runProductionShadow(adapter): Promise<ProductionShadowResult>`
- Produces: `stageReviewedShadowControl(adapter, sourceSha): Promise<ControlStageEvidence>`
- Produces: a new immutable evidence directory below `/var/www/.dashboard-zaruku-shadow/evidence`

- [ ] **Step 1: Write failing state-machine tests**

```js
test('orchestrator cannot deploy before every prerequisite passes', async () => {
  const adapter = fixtureOrchestrator({ linuxPrivilegeFixture: 'not-run' });
  await assert.rejects(() => runProductionShadow(adapter), /Linux privilege fixture/);
  assert.equal(adapter.deployCalls, 0);
  assert.equal(adapter.nginxCalls, 0);
});

test('stable parity failure stops only dashboard-zaruku and records NO-GO', async () => {
  const adapter = fixtureOrchestrator({ parity: 'mismatch' });
  const result = await runProductionShadow(adapter);
  assert.equal(result.decision, 'NO-GO');
  assert.deepEqual(adapter.stoppedProcesses, ['dashboard-zaruku']);
  assert.ok(!adapter.touchedProcesses.includes('dashboard-next'));
  assert.equal(adapter.nginxCalls, 0);
});
```

Add cases for source-coverage advancement retry, stable mismatch, manager-auth failure, PDF/XLSX
difference, changed combined PID, changed Nginx hash, changed foreign runtime SHA, artifact mismatch,
port exposure beyond loopback, cleanup failure, and a secret marker in any output/evidence.

The control-staging tests must prove that the payload contains only the fixed authority files and
Tasks 1–3 provisioning scripts, every byte is covered by a SHA-256 manifest, the destination is
the fixed path `/var/www/.dashboard-zaruku-shadow/control/SOURCE_SHA`, with `SOURCE_SHA` replaced only
by the validated 40-character reviewed commit, an existing different inode is rejected,
and staging cannot touch an app directory, PM2, Nginx, MySQL, a secret file, or a release ref.

The Linux image tests require a base reference containing `@sha256:`, one fixed Debian snapshot,
exact direct package versions for Python 3, `util-linux`, and `passwd`, a committed full installed
package manifest hash, a committed Dockerfile hash, and an exact final local image ID beginning with
`sha256:`. The runtime tests require `--network none`, a read-only checkout mount at `/src`, a
read-only container root, writable disposable `tmpfs` only where the fixtures need it, only
`SYS_PTRACE` as the added capability, and automatic container removal. They reject a mutable base
tag, unpinned repository, current Debian mirrors, package upgrades, privileged mode, host networking,
a writable source mount, or a host `/var/www` mount.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test scripts/stage-zaruku-shadow-control.test.mjs scripts/run-zaruku-production-shadow.test.mjs
bash scripts/run-zaruku-linux-fixtures.test.sh
```

Expected: FAIL because the control stager, Linux runner, and orchestrator do not exist.

- [ ] **Step 3: Implement immutable pre-deploy control staging**

`stage-zaruku-shadow-control.mjs` accepts no host, path, or file-list override. From a clean reviewed
checkout it reads the fixed provisioning file inventory, rejects links and non-regular files, builds
a canonical manifest containing path, mode, size, and SHA-256, and sends the manifest plus bytes on
stdin to a reviewed remote worker. The worker runs with an empty environment, verifies the outer
payload digest before parsing, creates only the exact SHA-addressed control directory beneath the
fixed shadow root, publishes files root-owned and non-writable, fsyncs them, and re-verifies
every digest. A byte-identical existing bundle is accepted; any difference fails closed. It returns
only source SHA, manifest digest, file count, and destination metadata.

This stage does not build or deploy the application, create identities, grant database access,
install secrets, update `release/zaruku`, invoke PM2, or inspect another runtime's environment.

- [ ] **Step 4: Add an immutable Linux-fixture runner**

Create a dedicated test-only image from the official Node 22 Bookworm Slim base pinned by full
repository digest. During the explicit build step only, use one dated Debian snapshot and install
exact versions of `python3`, `util-linux`, and `passwd` without recommended packages. Do not copy the
repository, secrets, SSH material, or production data into the image. Record in
`deploy/zaruku/linux-fixture.json` the base digest, snapshot identifier, requested package versions,
Dockerfile SHA-256, complete sorted `dpkg-query` manifest SHA-256, final local Docker image ID,
and the exact required executable list including `/usr/bin/timeout` already present in that image.

`scripts/build-zaruku-linux-fixture.sh` accepts no overrides, refuses a dirty authority file or a
base without `@sha256:`, builds without secrets or host mounts, verifies the installed executable
paths and complete package-manifest hash, and records the final image ID only through an explicit
`--lock` action. Normal verification mode is read-only and fails when the local image or any recorded
input differs. The networked image build is preparation only; it is never part of predeploy or the
production-shadow orchestrator.

`scripts/run-zaruku-linux-fixtures.sh` first runs builder verification, then invokes only the recorded
local image ID with `--network none`, `--read-only`, a read-only checkout mount at `/src`, disposable
`tmpfs` mounts, and only the fixture-documented `SYS_PTRACE` capability. It runs both
`python3 -I -B /src/scripts/stamp-runtime-artifact.test.py` and
`node /src/scripts/boot-zaruku-service.linux.test.mjs`, the MySQL descriptor fixture, and
`node /src/scripts/zaruku-shadow-evidence.linux.test.mjs`; any failure stops the shadow workflow.

- [ ] **Step 5: Implement the fixed orchestration sequence**

The production CLI accepts no runtime/path/host/port arguments. It loads the two committed
authorities, verifies a clean named branch, records the exact HEAD, and executes only this state
machine:

```text
preflight-read-only
linux-build-helper-fixture
linux-privilege-drop-fixture
host-boundary-check
db-boundary-check
runtime-secret-check
manager-auth-descriptor-check
full-predeploy
release-authority-check
deploy-zaruku
process-and-listener-attestation
same-snapshot-parity
foreign-sha-and-nginx-recheck
write-final-decision
```

Production apply steps remain separate explicit commands; the orchestration command must not create
accounts, grant privileges, install secrets, update a release branch, or edit Nginx implicitly.

- [ ] **Step 6: Add one bounded coverage-advance retry to the existing verifier**

Before paired manager reads, record only canonical coverage identifiers/timestamps for the selected
Zaruku sources. If the first pair differs, re-read coverage. Retry the pair exactly once only when
coverage advanced between the two observations. If coverage did not advance, fail immediately. If
the second pair differs, fail. Do not lock tables, pause collectors, reuse another period, or hide a
failed source behind an older success.

Evidence adds:

```json
{
  "pairedReadAttempts": 1,
  "coverageAdvancedDuringFirstPair": false,
  "stableCanonicalComparison": true
}
```

Values become `2`, `true`, and the final result only in the one permitted retry case.

- [ ] **Step 7: Verify focused suites and full local gate**

```bash
node --test scripts/stage-zaruku-shadow-control.test.mjs scripts/run-zaruku-production-shadow.test.mjs
bash scripts/run-zaruku-linux-fixtures.test.sh
bash scripts/verify-zaruku-shadow.test.sh
npm run predeploy:verify
```

Expected: exit `0`; existing combined, Abbott, artifact, deploy, shadow, typecheck, lint, and build
gates remain present. Existing lint warnings may remain, but no new error or warning is accepted.

- [ ] **Step 8: Commit Task 4**

```bash
git add scripts/stage-zaruku-shadow-control.mjs scripts/stage-zaruku-shadow-control.test.mjs deploy/zaruku/linux-fixture.Dockerfile deploy/zaruku/linux-fixture.json scripts/build-zaruku-linux-fixture.sh scripts/run-zaruku-linux-fixtures.sh scripts/run-zaruku-linux-fixtures.test.sh scripts/run-zaruku-production-shadow.mjs scripts/run-zaruku-production-shadow.test.mjs scripts/verify-zaruku-shadow.sh scripts/verify-zaruku-shadow.test.sh package.json package-lock.json OPS.md
git commit -m "feat(zaruku): orchestrate production shadow evidence"
```

---

### Task 5: Independent Review and Freeze the Exact Shadow Candidate

**Files:**
- Review: all changes from `e45457c` through current HEAD
- Update only if findings require it: files named by the reviewer

**Interfaces:**
- Produces: one reviewed full source SHA used by `release/zaruku`
- Produces: clean full `predeploy:verify` evidence

- [ ] **Step 1: Generate a review package**

```bash
git status --short
git rev-parse HEAD
/Users/nafanya/.codex/skills/subagent-driven-development/scripts/review-package e45457c HEAD
```

Expected: clean worktree and a review package covering Tasks 1–4.

- [ ] **Step 2: Request independent architecture/security review**

The reviewer checks exact-target operations, rollback identity, MySQL least privilege, secret paths,
root boundaries, shell/SQL injection, TOCTOU/link defenses, evidence redaction, paired-read semantics,
foreign-runtime isolation, and absence of cutover behavior.

- [ ] **Step 3: Fix every P0–P2 finding with failing-first tests**

For each accepted finding: add a regression, observe RED, implement the smallest fix, observe GREEN,
commit, and return the complete fix set to the same reviewer. P3 findings are either fixed or recorded
with a concrete reason they do not block shadow.

- [ ] **Step 4: Run fresh full verification**

```bash
npm run predeploy:verify
git diff --check
git status --short
```

Expected: exit `0`, clean worktree, no new warnings, and a clean re-review.

- [ ] **Step 5: Freeze the release authority without overwriting an unknown ref**

Mandatory cross-task follow-up from Task 4 review: enforce exact equality of remote
`refs/heads/release/zaruku` to the frozen candidate SHA before production provisioning/orchestration.
The current Task 4 ancestry check is insufficient to prove frozen authority: a different ancestor
must fail this Task 5 gate. Add a regression for that case and retain refusal to overwrite an
unknown/different existing ref. This is a Task 5 acceptance requirement, not a Task 4 blocker; Task 4
does not update the release ref or broaden its current source-only change scope.

```bash
git fetch origin
ZARUKU_SHADOW_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
git merge-base --is-ancestor ee950f3917d0f8616b6229d4049410a0afb7e380 "$ZARUKU_SHADOW_SHA"
git ls-remote --exit-code --heads origin release/zaruku
```

Expected for the first shadow: the final command exits `2` because the release ref is absent. If it
returns a SHA, stop and review that authority; do not overwrite it automatically. When absent, run:

```bash
git push origin "$ZARUKU_SHADOW_SHA":refs/heads/release/zaruku
git ls-remote --heads origin release/zaruku
```

Expected: the remote release SHA equals `ZARUKU_SHADOW_SHA` exactly.

---

### Task 6: Provision the Production Shadow Prerequisites

**Files:**
- Runtime evidence only: `/var/www/.dashboard-zaruku-shadow/`
- No repository source edits expected

**Interfaces:**
- Consumes: reviewed candidate SHA and Tasks 1–3 CLIs
- Produces: attested service account/directories, dedicated MySQL reader, runtime secret file, and manager auth descriptor

- [ ] **Step 1: Capture the immutable read-only baseline**

Run the fixed preflight over SSH and save its sanitized JSON below a newly created root-owned evidence
directory after the host boundary creates it. Until then, keep the sanitized baseline in a local
mode-`0600` temporary file. Record combined PID/health, Nginx SHA-256, port ownership, tool paths,
relevant path metadata, candidate SHA, and release ref. Do not record process environments or
database rows.

- [ ] **Step 2: Run Linux-only fixtures before provisioning**

Run:

```bash
bash scripts/run-zaruku-linux-fixtures.sh
```

Expected: both pass in the reviewed, digest-pinned, network-disabled disposable Linux container. The
second fixture must prove real/effective identity drop, cleared groups/capabilities, `no_new_privs`,
cwd, and loopback health. A failure is `NO-GO`; do not provision or stage production files.

- [ ] **Step 3: Stage and attest the reviewed control bundle**

From the clean reviewed candidate checkout run the fixed control-staging entrypoint. Let
`ZARUKU_SHADOW_SHA` be the exact reviewed candidate SHA and require the returned destination to be:

```text
/var/www/.dashboard-zaruku-shadow/control/ZARUKU_SHADOW_SHA
```

Here `ZARUKU_SHADOW_SHA` denotes the full 40-character value, not a literal directory name. Re-read
the remote canonical manifest and require its digest, source SHA, paths, modes, sizes, and per-file
digests to match the local authority. The staging worker creates only the missing root-owned
`/var/www/.dashboard-zaruku-shadow`, its `control` child, and the SHA-addressed bundle; it refuses any
non-compliant predecessor. Save only those non-secret attestations in the evidence bundle after the
host boundary creates the evidence directory.

- [ ] **Step 4: Apply and attest the fixed host boundary**

Run the attested SHA-addressed host CLI in `check`, `apply`, and `check` order. Verify
`dashboard-zaruku` has exactly one dedicated group, no login shell, and no root/foreign group
membership. Verify every fixed directory owner and mode. Do not start PM2 yet. The CLI must compare
its own bytes with the staged canonical manifest before every apply operation.

- [ ] **Step 5: Generate and apply the dedicated DB credential privately**

On the server, generate 48 random bytes with the Node cryptographic RNG inside the privileged DB
provisioning process. Keep the value in memory and an inherited pipe only. Create
`'dashboard_zaruku_reader'@'127.0.0.1'`, grant the exact table list, run positive and negative
permission probes, then atomically install `/var/www/.dashboard-zaruku-secrets/runtime.env` using the
same in-memory password and the stably copied shared auth secret. If any verification fails, remove
only the newly created DB account and staged secret inode.

- [ ] **Step 6: Install the existing manager cookie descriptor through a hidden prompt**

Run:

```bash
ZARUKU_SHADOW_SHA="$(git rev-parse HEAD)"
ssh -t beget "/usr/bin/node /var/www/.dashboard-zaruku-shadow/control/$ZARUKU_SHADOW_SHA/scripts/install-zaruku-shadow-auth.mjs"
```

At the hidden prompt, the owner supplies one existing valid Zaruku manager cookie descriptor in the
exact JSON shape `{"headers":{"cookie":"cookie-name=session-token"}}`. The installer must not echo
the input. It validates and writes the fixed root-owned mode-`0600` file, then prints only its digest.
If the owner cannot supply a valid current session, stop before deployment.

- [ ] **Step 7: Re-run full prerequisite checks**

Expected result: host, DB, runtime secret, auth descriptor, Linux privilege, Nginx baseline, combined
health, port `3002`, release ref, and artifact prerequisites all pass. Store sanitized evidence and
commit no production-derived file to Git.

---

### Task 7: Deploy, Compare, and Produce the No-Cutover Decision

**Files:**
- Create after execution: `docs/superpowers/reports/2026-09-08-zaruku-production-shadow-readiness.md`
- Do not add: any raw file from `/var/www/.dashboard-zaruku-shadow/`

**Interfaces:**
- Consumes: reviewed release ref, provisioned prerequisites, manager auth descriptor
- Produces: loopback shadow process and sanitized readiness report

- [ ] **Step 1: Deploy the sealed Zaruku candidate**

From the clean reviewed candidate checkout:

```bash
npm run deploy:zaruku
```

Expected: the existing isolated lock, release, manifest, service-account, boot, health, and active
attestation gates pass. `dashboard-zaruku` becomes online on `127.0.0.1:3002`. `dashboard-next` keeps
the same PID and remains healthy on `127.0.0.1:3001`.

- [ ] **Step 2: Prove no public route changed before parity**

Re-hash `/etc/nginx/conf.d/dashboard-next.conf`, confirm no loaded Nginx configuration references
port `3002`, and confirm the public Zaruku URL still reaches the combined runtime SHA. Do not reload
Nginx.

- [ ] **Step 3: Run the fixed production-shadow orchestrator**

Run the orchestrator with no authority overrides. It opens the fixed auth descriptor on an inherited
FD and calls the existing verifier for `2026-01-01..2026-08-31`. Expected checks include manager JSON,
historical direct additions, January–August totals, July Wordstat, August Alice visibility and
competitors, SEO OS, medical/noise classification, source health, unauthorized metadata, PDF, Excel,
routes, artifact SHA, and foreign-runtime SHA stability.

- [ ] **Step 4: Handle the result exactly**

If every stable comparison passes, leave the loopback-only process online and record `GO for later
cutover planning`. If any check fails, record `NO-GO`, stop only `dashboard-zaruku`, save sanitized
mismatch evidence, and leave all public routing and combined processes unchanged.

- [ ] **Step 5: Write and review the readiness report**

The repository report contains only:

```text
candidate SHA
artifact and manifest digests
test counts
service/DB permission assertions
combined and isolated health assertions
period and source coverage labels
endpoint semantic hashes and pass/fail status
Nginx before/after hash equality
combined PID before/after equality
GO or NO-GO for a later cutover plan
```

It explicitly states that no Nginx edit/reload, public cutover, canonical data write, collector/API
call, cron change, Abbott action, advertising action, or secret rotation occurred.

- [ ] **Step 6: Commit only the sanitized report**

```bash
git add docs/superpowers/reports/2026-09-08-zaruku-production-shadow-readiness.md
git commit -m "docs(zaruku): record production shadow readiness"
```

- [ ] **Step 7: Final independent evidence review**

The reviewer verifies report claims against sanitized server evidence, confirms the public route and
combined PID did not change, scans the commit for secret-like values, and issues the final shadow
verdict. Even a clean `GO` ends this plan; it does not begin cutover.

---

## Completion Boundary

This plan is complete when the shadow process has either passed and remains loopback-only, or failed
and has been stopped; the sanitized report is independently reviewed; and the public combined
runtime remains unchanged. Exact-path Nginx cutover, compatibility-adapter removal, Abbott extraction,
and advertising-runtime extraction each require later approved specs and plans.
