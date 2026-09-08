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
