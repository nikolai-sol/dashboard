# Task 1 Report — Production-Shadow Authority and Read-Only Preflight

## Status

DONE

Commit: `7df2156` (`feat(zaruku): add production shadow preflight authority`)

No production mutation, external source API call, database write, Nginx change, deployment, process change, or secret read was performed.

## Implementation

- Added the exact frozen Zaruku production-shadow authority at `deploy/zaruku/production-shadow.json`.
- Added `loadShadowAuthority(filename)` with strict object-key and exact-value checks, loopback URL checks, normalized absolute-path checks, fixed reporting-period checks, deep freezing, and cross-validation against both `RUNTIME_MANIFESTS.zaruku` and `deploy/zaruku/release.json`.
- Added the Task 1 `loadMysqlTableAuthority(filename)` boundary for a strict Zaruku/report_bd/fixed-account table authority. It rejects unknown keys, invalid or duplicate table identifiers, and unsorted table lists, and deep-freezes its result. The exact table inventory remains Task 2.
- Added injected `inspectShadowPrerequisites(adapter)` and `assertShadowPrerequisites(evidence)` interfaces.
- Sanitized preflight evidence contains only booleans, fixed paths, identity/process names, numeric IDs/ports, modes, and hashes. Raw Nginx text, PM2 environment, database rows, environment values, and secret contents are not returned.
- Added a real read-only adapter limited to `id`, `getent`, fixed `command -v` lookups, `stat`, `ss`, `pm2 status`, `sha256sum`, read-only MySQL identity/schema metadata queries, and reads of selected Nginx configuration paths.
- Added fail-closed assertions for the fixed online combined runtime/listener, port 3002 vacancy, no Nginx reference to port 3002, Nginx hash presence, exact tool paths, root local-socket MySQL authority, and safe existing Zaruku identities/resources.
- Added `test:zaruku-production-shadow` and placed it in the shared predeploy gate without any `--apply` path.
- Updated the existing predeploy ordering fixture because it intentionally enumerates every required predeploy command.

## TDD evidence

### RED

Command:

```text
node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs
```

Initial result: exit 1. Both test files failed with `ERR_MODULE_NOT_FOUND` for the intentionally absent contract and preflight implementation modules.

The wiring test was also added before package/predeploy changes and failed with the expected assertion that `test:zaruku-production-shadow` was undefined.

Additional tightened preflight tests were run before extending the resource/listener checks; they failed because the new required resource inventory and combined-listener linkage were not yet implemented.

### GREEN

Final focused command:

```text
npm run test:zaruku-production-shadow
```

Result: exit 0, 10 tests passed, 0 failed.

Final source-deploy command:

```text
npm run test:deploy-source
```

Result: exit 0. Deploy source guards, dashboard deploy lock tests, dashboard deploy integration tests, release source metadata bootstrap tests, and predeploy verification contract tests all passed.

Additional verification:

```text
npm exec -- eslint scripts/zaruku-production-shadow-contract.mjs scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.mjs scripts/zaruku-production-shadow-preflight.test.mjs
git diff --check
```

Result: exit 0 with no lint errors or warnings and no whitespace errors.

## Files changed

- `deploy/zaruku/production-shadow.json`
- `scripts/zaruku-production-shadow-contract.mjs`
- `scripts/zaruku-production-shadow-contract.test.mjs`
- `scripts/zaruku-production-shadow-preflight.mjs`
- `scripts/zaruku-production-shadow-preflight.test.mjs`
- `package.json`
- `scripts/predeploy-verify.sh`
- `scripts/predeploy-verify.test.sh`

`package-lock.json` did not change because npm script-only edits do not alter lockfile content.

## Self-review

- Scope: changes are confined to the new Zaruku production-shadow authority/preflight and the source-only predeploy test wiring. Combined dashboard, Abbott, advertising, collector, schema, migration, and runtime deployment code are unchanged.
- Authority: the JSON matches the brief exactly, extra/missing/changed values fail closed, nested values are frozen, and runtime/release contracts are checked.
- Read-only behavior: the implementation contains no apply mode and no mutation command. MySQL statements are SELECT-only metadata checks. The test gate invokes fixtures only.
- Isolation: the isolated listener must be absent, the combined PID must own a loopback 3001 listener, and Nginx must reference 3001 but not 3002.
- Disclosure: raw Nginx input is reduced to booleans plus a digest; process/database environments, data rows, and secret-file contents are never included in evidence.
- Existing state: absent state is accepted for initial provisioning; existing fixed resources/identities are accepted only with exact owner/group/mode/path/identity metadata, while incomplete, unsafe, or foreign state is rejected.
- Integration: the existing predeploy order test was updated to cover the new gate, and the existing `test:deploy-source` script remained byte-for-byte unchanged.

## Concerns

None for Task 1. The real production adapter was not executed against production because this task explicitly permits source-only, read-only fixture verification and forbids production access/actions. Task 2 still owns the exact physical-table allowlist and database grant verification.

## Review-finding remediation — 2026-09-08

Implementation commit: `a0053a5` (`fix(zaruku): harden shadow preflight inspection`)

### Changes

- Rejects UID or GID `0` for the dedicated service identity and validates the independently queried `dashboard-zaruku` group, including exact name, positive GID, user/group GID agreement, and absence of foreign members or supplementary groups.
- Adds explicit `inspected` evidence state so malformed/unknown identity, group, MySQL-account, and resource metadata cannot normalize to confirmed absence.
- Replaces catch-all nullable command results with exit-status-aware results. Only documented not-found statuses count as absence; `stat` additionally requires the fixed `No such file or directory` diagnostic. Permission, backend, signal, spawn, supplementary-group, and unexpected command failures fail closed with sanitized errors.
- Resolves the active Nginx include graph from `/etc/nginx/nginx.conf`, including relative, absolute, and glob paths outside previously hard-coded directories. Unresolved, variable, invalid, oversized, or over-large graphs fail closed. The evidence still exposes only route-reference booleans and a graph digest.

### New RED evidence

Identity and incomplete-inspection regressions were added first and run with:

```text
node --test scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 1; 6 passed and 2 failed. The two expected failures were `Missing expected exception` for root-equivalent UID/GID and for unknown/incomplete inspection state.

The Nginx include-graph regression was then added before its implementation and run with the same command.

Result: exit 1 with `SyntaxError: ... does not provide an export named 'readNginxIncludeGraph'`.

The real-adapter command-result regression was added before command-runner injection and run with the same command.

Result: exit 1; 10 passed and 1 failed. The expected failure occurred because the adapter did not yet support the injected runner and failed in the host `getent` path instead of using the fixture's confirmed-absence result.

### New GREEN evidence

Review-specific suite:

```text
node --test scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 0; 11 passed, 0 failed.

Full focused shadow suite:

```text
node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 0; 15 passed, 0 failed.

Source-deploy integration suite:

```text
npm run test:deploy-source
```

Result: exit 0. Deploy source guards, deploy lock/integration fixtures, release-source metadata fixtures, and the predeploy command contract all passed.

Static verification:

```text
npm exec -- eslint scripts/zaruku-production-shadow-preflight.mjs scripts/zaruku-production-shadow-preflight.test.mjs
git diff --check
```

Result: exit 0 with no lint errors/warnings and no whitespace errors.

### Review self-check and concerns

- The Nginx fixture places a port-3002 `proxy_pass` in `custom-routing/*.conf`, a relative glob outside the former fixed-prefix scan; the graph resolver finds it and the assertion rejects it.
- Confirmed absence and failed inspection now have distinct code paths in both the real adapter and sanitized evidence.
- All new command-runner fixtures use read-only commands and validate only metadata/status behavior.
- No production operation or later-task database/host provisioning behavior was added.
- Concerns: none remaining for the three reported Important findings.

## Symlinked Nginx glob remediation — 2026-09-08

Implementation commit: `1ac5fe2` (`fix(zaruku): inspect symlinked nginx routes`)

### Change

- Nginx glob traversal now resolves the canonical target and metadata for every symlink encountered below a glob base.
- A symlink to a directory is traversed through its logical path, so remaining glob segments match the same paths Nginx activates.
- Canonical directory ancestry is tracked for cycle detection. Cycles, broken/uninspectable symlinks, non-file symlink targets, and failed target metadata reads fail closed.
- Added the exact mixed fixture: `routes/ordinary/combined.conf` supplies port 3001 while `routes/linked` points to a separate directory whose `shadow.conf` supplies port 3002; the active directive is `include routes/*/*.conf;`.
- Added a separate symlink-cycle fixture to prove traversal terminates by rejecting the graph.

### RED evidence

Command:

```text
node --test scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 1; 11 passed and 1 failed. The exact mixed ordinary-directory/symlinked-directory regression failed at `false !== true` because the port-3002 route behind the matched directory symlink was omitted.

### GREEN evidence

Review-specific suite:

```text
node --test scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 0; 13 passed, 0 failed, including the mixed-directory regression and symlink-cycle rejection.

Full focused shadow suite:

```text
node --test scripts/zaruku-production-shadow-contract.test.mjs scripts/zaruku-production-shadow-preflight.test.mjs
```

Result: exit 0; 17 passed, 0 failed.

Source-deploy integration suite:

```text
npm run test:deploy-source
```

Result: exit 0. Deploy source guards, deploy lock/integration fixtures, release-source metadata fixtures, and the predeploy command contract all passed.

Static verification:

```text
npm exec -- eslint scripts/zaruku-production-shadow-preflight.mjs scripts/zaruku-production-shadow-preflight.test.mjs
git diff --check
```

Result: exit 0 with no lint errors/warnings and no whitespace errors.

### Concerns

None remaining for the symlinked-directory glob finding. No production operation or later-task behavior was performed.
