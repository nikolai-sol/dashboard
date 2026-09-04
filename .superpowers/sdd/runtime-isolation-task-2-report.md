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
