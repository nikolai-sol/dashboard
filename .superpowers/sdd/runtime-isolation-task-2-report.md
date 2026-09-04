# Runtime isolation Task 2 report: Zaruku application shell

## Implementation

- Added the independent `@reportingdash/zaruku` Next.js workspace at `apps/zaruku`.
- Configured the shell for standalone output in `apps/zaruku/.next-zaruku`, framework assets under `/_next-zaruku`, and repository-root tracing/Turbopack resolution.
- Added `GET /api/health`, returning HTTP 200, `{ ok: true, scope: "zaruku" }`, and `Cache-Control: private, no-store`.
- The layout imports `RUNTIME_MANIFESTS.zaruku` and the existing root visual foundations.
- Added only `@reportingdash/runtime-contract` to the combined app's `transpilePackages`; its output, asset prefix, route ownership, and scripts remain unchanged.
- Added the workspace lockfile entries and verified a clean `npm ci --ignore-scripts` install.
- Ignored the generated isolated output directory so `git add apps/zaruku` cannot stage build artifacts.

## RED evidence

1. Before the shell existed, `node --import tsx --test apps/zaruku/src/app/api/health/route.test.ts` exited 1 with `Cannot find module './route'`.
2. The initial isolated build reproducibly failed because Turbopack could not resolve `next/package.json` from the nested app. A source assertion for `turbopack.root` failed first; setting the root to `path.join(__dirname, "../..")`, then running a clean workspace install, resolved the actual workspace-boundary cause.
3. The review-added cache regression test failed as intended when the cache header was temporarily removed: actual `null`, expected `private, no-store`.

## GREEN and verification evidence

- Focused health/config test: 2 passed, 0 failed.
- `npm ci --ignore-scripts`: passed with the final lockfile.
- Full `npm test`: 944 Node tests passed, 0 failed, 10 skipped; 13 Python tests passed.
- `npm run build`: passed; the combined application's existing route set built successfully.
- `npm --workspace apps/zaruku run build`: passed; its route set contains only `/_not-found` and dynamic `/api/health`.
- Output checks passed: root `.next` and Zaruku `.next-zaruku` both exist after their builds, and no `apps/zaruku/.next` exists.
- `git diff --check` passed.

## Files changed

- `.gitignore`
- `next.config.js`
- `package-lock.json`
- `apps/zaruku/package.json`
- `apps/zaruku/next.config.js`
- `apps/zaruku/tsconfig.json`
- `apps/zaruku/next-env.d.ts`
- `apps/zaruku/src/app/layout.tsx`
- `apps/zaruku/src/app/globals.css`
- `apps/zaruku/src/app/api/health/route.ts`
- `apps/zaruku/src/app/api/health/route.test.ts`

## Commits

- `98d20932128e60484c6ce84f442fbe3a33bd7016` — `feat(zaruku): add isolated application shell`
- `4f99e3f89b8d5e533d32690292a0747d10179315` — `test(zaruku): cover health cache and ignore build output`

## Self-review

An independent read-only review found no critical defects. It identified two important readiness gaps: the generated Zaruku build output was unignored and the health test did not assert the cache directive. Both have been corrected and included in the final verification. The reviewer otherwise confirmed the required files, manifest consumption, asset/output isolation, combined-app preservation, workspace command, and clean diff.

## Concerns

- The combined build emits a Next.js workspace-root warning because this worktree has its own lockfile alongside the parent checkout's lockfile. The build succeeds and this task intentionally leaves the combined app's Turbopack configuration unchanged.
- `npm ci` reports 34 existing dependency vulnerabilities (4 low, 7 moderate, 23 high). This task adds no version upgrades or vulnerability remediation.
- No production deployment, reverse-proxy change, database operation, migration, cron edit, secret change, or source API call was performed.

## Task 2 review fix

### Cause and minimal correction

The earlier successful Turbopack build was not sufficient isolation evidence. With
`turbopack.root` set to the repository root, the isolated Zaruku build also emitted
the root combined application's middleware, including `/admin/:path*` and
`/api/admin/:path*`. This section supersedes the earlier claim that the
repository-root Turbopack setting was an acceptable boundary.

Zaruku now uses `next build --webpack` and `next dev --webpack` from its own
workspace directory. Its config removes `turbopack.root`; the repository root
remains only as `outputFileTracingRoot` for standalone tracing. The installed
Next.js 16.1.6 Webpack build path discovers middleware beside the selected app
directory and resolves hoisted dependencies normally. The approved monorepo and
shared runtime-contract source remain intact.

### RED evidence, before configuration changes

1. Ran the unchanged `npm --workspace apps/zaruku run build`. The first sandboxed
   attempt stopped during Turbopack CSS worker setup with `binding to a port` /
   `Operation not permitted (os error 1)`. Retried the identical command with
   approved local worker/port permission: exit 0, Next.js 16.1.6 (Turbopack),
   routes `/_not-found` and `/api/health`, and `Proxy (Middleware)` in the build
   summary.
2. Ran the pre-existing uncommitted regression immediately against that fresh
   output:

   ```text
   node --import tsx --test apps/zaruku/src/app/middleware-manifest.test.ts
   tests 1; pass 0; fail 1; exit 1
   AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal
   actual middleware: { '/': { name: 'middleware', page: '/', matchers: [
     { originalSource: '/admin/:path*' },
     { originalSource: '/api/admin/:path*' }
   ], ... } }
   expected middleware: {}
   ```

3. Before implementation, strengthened the regression to check matcher sources,
   middleware keys, edge-function keys, and sorted middleware, keeping failure
   diagnostics limited to routing data. Updated the source config assertion to
   retain repository-root tracing and reject the Turbopack override. Ran:

   ```text
   node --import tsx --test apps/zaruku/src/app/api/health/route.test.ts apps/zaruku/src/app/middleware-manifest.test.ts
   tests 3; pass 1; fail 2; exit 1
   config: unexpected /turbopack\s*:/
   manifest: actual ['/admin/:path*', '/api/admin/:path*']; expected []
   ```

### GREEN and final verification

All commands below ran in the isolation worktree after the fix:

| Command | Observed result |
| --- | --- |
| `npm --workspace apps/zaruku run build` | Exit 0; invokes `next build --webpack`; compiled successfully in 1329.8 ms; only `/_not-found` and `/api/health`; no middleware entry in the build summary. |
| `node --import tsx --test apps/zaruku/src/app/api/health/route.test.ts apps/zaruku/src/app/middleware-manifest.test.ts packages/runtime-contract/src/index.test.ts` | Exit 0; 7 tests passed, 0 failed, 0 skipped. |
| `npm run build` | Exit 0; unchanged combined Turbopack command; compiled successfully in 4.0 s; all existing combined routes and expected admin middleware retained. |
| `npm run typecheck` | Exit 0; `tsc --noEmit`; no diagnostics. |
| `./node_modules/.bin/tsc --project apps/zaruku/tsconfig.json --noEmit` | Exit 0; no diagnostics. |
| `npm ci --ignore-scripts --dry-run --offline --no-audit` | Exit 0; `up to date in 544ms`; final workspace lockfile accepted without an install or dependency changes. |
| `git diff --check` | Exit 0; no whitespace errors. |

Read-only artifact assertions passed for the real emitted files:

- `apps/zaruku/.next-zaruku/server/middleware-manifest.json` is exactly
  `{"version":3,"middleware":{},"functions":{},"sortedMiddleware":[]}`. It has
  no `/admin`, `/api/admin`, `/dashboard/abbott`, or combined-app middleware.
- `required-server-files.json` records `output: "standalone"`,
  `distDir: ".next-zaruku"`, and `assetPrefix: "/_next-zaruku"`.
- The emitted `server/app/_not-found.html` includes framework URLs beginning
  `/_next-zaruku/_next/static/` and `<title>dashboard-zaruku</title>`, proving
  that the shared workspace contract is consumed by the rendered build.
- Node resolution from `apps/zaruku` locates `next/package.json` in this
  worktree's root `node_modules` and `@reportingdash/runtime-contract/package.json`
  at this worktree's canonical `packages/runtime-contract/package.json`.
  `realpathSync` confirms the latter stays within the worktree; there is no
  `apps/zaruku/node_modules` directory, copied contract, or added escaping symlink.
- After both builds, `.next/BUILD_ID` and `apps/zaruku/.next-zaruku/BUILD_ID`
  coexist, and `apps/zaruku/.next` is absent. The combined manifest retains
  exactly `/admin/:path*` and `/api/admin/:path*`; Zaruku remains empty.

### Files and commit

Fix commit: `9bff0ffe59055eb630536ddf3d46958a2b121815`
(`fix(zaruku): isolate middleware discovery with webpack`). It contains only:

- `apps/zaruku/package.json`
- `apps/zaruku/next.config.js`
- `apps/zaruku/src/app/api/health/route.test.ts`
- `apps/zaruku/src/app/middleware-manifest.test.ts`

This report update is recorded separately as documentation.

### Concerns and scope

- No blocker remains for the Task 2 middleware boundary. The manifest regression
  intentionally requires a completed isolated build; run the isolated build
  before invoking it. The root test discovery currently scans `src` and
  `scripts`, so the focused workspace command above is required.
- The unchanged combined build still emits its pre-existing multiple-lockfile
  workspace-root warning. The Zaruku Webpack build emitted no warnings or errors.
- The development command selects the same Webpack boundary; a live development
  server smoke was not part of this verification.
- The clean-install check was a dry run with audit disabled, not a dependency
  upgrade or new vulnerability assessment.
- No production/proxy/database/cron/secret operation, source API call, deployment,
  or other worktree change occurred.
