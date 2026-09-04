# Task 1 Report: Runtime Ownership Contract

## Implementation

Implemented the pure runtime ownership contract for the isolated dashboard runtimes:

- Added `DashboardRuntimeScope`, `DashboardFamily`, and `DashboardIdentity` types.
- Added the immutable Zaruku production `RUNTIME_MANIFESTS` entry with the required release branch, app, port, directories, lock path, and asset prefix.
- Added canonical dashboard-family resolution, including Zaruku and Abbott special-dashboard precedence over generic advertising.
- Added fail-closed dashboard ownership checks for isolated scopes and preserved combined-runtime ownership.
- Added route ownership checks for current Zaruku and Abbott dashboard/API paths, with other paths remaining advertising-owned.
- Added the `@reportingdash/runtime-contract` workspace package.
- Added root `apps/*` and `packages/*` workspaces while preserving every existing package script and dependency.
- Added the `@reportingdash/runtime-contract` TypeScript path alias while preserving `@/*`.

## RED

Command:

```text
node --import tsx --test packages/runtime-contract/src/index.test.ts
```

Output (exit 1):

```text
node:internal/modules/cjs/loader:1455
  const err = new Error(message);
              ^

Error: Cannot find module './index'
Require stack:
- /Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation/packages/runtime-contract/src/index.test.ts
    at Module._resolveFilename (node:internal/modules/cjs/loader:1455:15)
    at m._resolveFilename (file:///Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
    at nextResolveSimple (/Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:1004)
    at /Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:3:2630
    at /Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:3:1542
    at resolveTsPaths (/Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:760)
    at Module._resolveFilename (file:///Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:1102)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1065:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1070:15)
    at Module._load (node:internal/modules/cjs/loader:1241:12) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [
    '/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation/packages/runtime-contract/src/index.test.ts'
  ]
}

Node.js v25.6.1
✖ packages/runtime-contract/src/index.test.ts (202.423833ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 206.882334

✖ failing tests:

test at packages/runtime-contract/src/index.test.ts:1:1
✖ packages/runtime-contract/src/index.test.ts (202.423833ms)
  'test failed'
```

The failure was expected: the test imported the not-yet-created `./index` module.

## GREEN

Command:

```text
node --import tsx --test packages/runtime-contract/src/index.test.ts && npm run typecheck && git diff --check
```

Output (exit 0):

```text
✔ canonical special dashboards resolve before generic advertising (0.407125ms)
✔ isolated runtimes fail closed for another dashboard family (0.058791ms)
✔ public route ownership preserves current paths (0.045125ms)
✔ Zaruku production authority is immutable (0.506709ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 145.171542

> dashboard-next@0.1.0 typecheck
> tsc --noEmit

```

`git diff --check` produced no output and exited 0.

## Files Changed

- `packages/runtime-contract/package.json`
- `packages/runtime-contract/src/index.ts`
- `packages/runtime-contract/src/index.test.ts`
- `package.json`
- `tsconfig.json`
- `.superpowers/sdd/runtime-isolation-task-1-report.md`

## Commit

`feat: define dashboard runtime ownership` (the task commit; its final hash is reported with delivery).

## Self-Review

- The contract is pure and has no source API, OAuth, database, deployment, cron, secret, or production-runtime side effects.
- The combined scope continues to own every dashboard and route, preserving current production behavior.
- Zaruku and Abbott special identities are checked before the advertising fallback; client IDs are trimmed and lowercased.
- Special dashboard and API route prefixes are matched only at their exact route roots or slash-delimited descendants, avoiding accidental partial matches.
- The manifest is `as const`, preserving immutable literal values and the exact requested Zaruku production authority.
- Existing scripts and dependencies were left unchanged.
- Focused tests, typecheck, and whitespace validation all pass.

## Concerns

No active concerns or blockers. The manifest intentionally contains only the requested Zaruku production authority; future runtime manifests should be added explicitly in a successor task.
