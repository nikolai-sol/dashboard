# Task 5 — Zaruku Artifact Boundary

Status: implemented, committed, and locally verified. Parent review/acceptance is pending.

- Base: `c9ec43b3c42ce4c5fc312b64ee72c1a448a98dae`
- Commit: `1c8ac36dd465998a5257e3fe3171fca5429cbfa6` — `test(zaruku): enforce isolated release artifact`
- Worktree: `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation`
- Worktree state after the task-only commit and post-commit rebuild: clean (`git status --short` produced no output).
- This report is in the existing ignored `.superpowers/sdd` evidence area and is not part of the task commit.

## Outcome

The Zaruku workspace now produces a sealed standalone artifact and exposes a scoped verification command. The scope-specific policy recursively checks every real file without traversing symlinks, validates exact authority metadata and standalone layout, requires the complete Zaruku route set, rejects any other manifested or compiled route, and fails closed on prohibited cross-domain paths/content, source API clients/tokens, combined middleware, workbooks, private source exports, unsafe environment files, malformed inspected data, and escaping/broken links.

The existing `assert-no-private-public-assets.ts` behavior remains the first gate. Its no-argument public-tree behavior and existing `--release <root>` Abbott/private-data behavior are preserved; `--release --scope zaruku <root>` adds the new policy only after the legacy release scan passes. The existing 22-test release-asset suite passes unchanged.

Fresh Next standalone builds copy the monorepo root `package.json`, including development-only scripts. One such script names `abbott-private-store.test.ts`, which correctly caused the first real artifact scan to fail even though no Abbott module was traced. Rather than exempt the file from inspection, artifact stamping now removes only `scripts`, `workspaces`, and `devDependencies` from that generated standalone-root manifest. Runtime dependencies and ordinary package fields remain. A real post-seal standalone boot returned `{"ok":true,"scope":"zaruku"}`.

## Files

- `scripts/runtime-artifact-policy.mjs` — Zaruku-only stamping, recursive artifact inspection, route/metadata enforcement, and CLI.
- `scripts/runtime-artifact-policy.test.mjs` — real filesystem allow/deny fixtures and workspace/entry-point wiring checks.
- `scripts/assert-no-private-public-assets.ts` — preserves legacy scanning and delegates an explicit Zaruku scope to the new fail-closed policy.
- `apps/zaruku/package.json` — build stamps the fresh artifact; `verify:artifact` runs legacy plus Zaruku-specific inspection.

No other tracked file changed. Generated `.next-zaruku` output remained ignored.

## RED/GREEN evidence

### Initial policy RED

Command:

`node --test scripts/runtime-artifact-policy.test.mjs`

Observed: exit 1. Node reported `ERR_MODULE_NOT_FOUND` for `scripts/runtime-artifact-policy.mjs`; 0 passed, 1 failed. This was the required failure before any policy production code existed.

### Initial policy GREEN

After the minimal recursive policy implementation, the first full fixture run reached 21/22 and exposed a macOS `/var` versus `/private/var` canonical-path issue for a contained symlink. Canonicalizing the artifact root fixed containment without following the link during traversal. The next run passed 22/22.

### Wiring RED/GREEN

Two additional tests were added before changing the existing entry point and workspace:

- scoped `assert-no-private-public-assets.ts` had to reject an injected `server/app/admin/page.js`;
- the Zaruku package had to stamp then verify `.next-zaruku/standalone`.

RED: 22/24 passed and 2 failed. The existing script incorrectly returned zero for the injected route and the package had only `next build --webpack` with no verifier. GREEN after wiring: 24/24.

The unchanged release CLI tests then caught a compatibility regression in positional argument parsing: with no `--scope`, index zero had been accidentally omitted. RED was 21/22 in `src/lib/release-asset-policy.test.ts`; the public asset CLI returned zero for a prohibited fixture. The corrected parser restored GREEN at 22/22 and the exact public-assets command passed.

### Generated manifest RED/GREEN

The first fresh real artifact verification failed with:

`forbidden content marker abbott-private-store: package.json`

Inspection showed this was only the generated monorepo development test script. A fixture was added first; RED proved stamping retained `scripts`, `workspaces`, and `devDependencies`. GREEN proved sealing removes those three monorepo-only fields while retaining runtime dependencies. The real artifact then passed without a content-scan exemption.

### Explicit dependency/middleware RED/GREEN

The additional unowned-runtime fixtures were run with their policy entries removed. RED: 0/9 passed, 9 failed for `abbott-bi-loader`, `advertising-binding-read-model`, both Yandex API host markers, the Google Ads API host marker, `METRIKA_TOKEN`, `YANDEX_DIRECT_TOKEN`, and `server/middleware.js`. Restoring the minimal deny entries produced 9/9 GREEN.

### Unmanifested route RED/GREEN

An artifact with an extra `app/dashboard/client/page.js` but an unchanged route manifest initially failed the assertion as expected (33/35 overall, with the containing and nested tests both reported failed). The policy now compares every compiled `page.js`/`route.js` under the Next server app tree with the exact allowed target set. Final fixture result: 35/35 passed, zero skips/failures.

## Fixture coverage

The final 35 tests/subtests cover:

- acceptance of exact release SHA, `zaruku` scope, root runtime `.env`, expected server, seven exact manifest entries, their compiled files, and ordinary compiled code containing broad words such as `administration`, `privateState`, and `sourceApiCalls`;
- every required marker from the brief: Abbott dashboard/API paths, `abbott-private-store`, `report_bd_private`, `ABBOTT_PRIVATE_DB_PASSWORD`, and admin route path;
- Abbott BI, advertising binding, external source API/token, and combined middleware markers;
- missing/invalid SHA, missing/wrong scope, and missing standalone server;
- missing owned routes, unexpected manifest routes, missing compiled routes, and unmanifested foreign compiled routes;
- `.xlsx`/`.xls` source workbook suffixes;
- permitted root `.env` versus rejected `.env.production` and nested `.env`;
- structural JSON, CSV, and TSV private source signatures;
- an escaping link rejected using its canonical target, while a contained link is accepted and never traversed recursively;
- immutable metadata stamping and generated package-manifest reduction;
- the shared asset entry point and exact workspace scripts.

## Real artifact evidence

Post-commit command:

`npm --workspace apps/zaruku run build && npm --workspace apps/zaruku run verify:artifact`

Result: exit 0. Webpack compilation and Next type checking passed. The emitted public route inventory was only:

- `/_not-found`
- `/api/dashboard/zaruku`
- `/api/dashboard/zaruku/excel`
- `/api/dashboard/zaruku/pdf`
- `/api/health`
- `/dashboard/zaruku`

The standalone `app-paths-manifest.json` additionally contains the framework `/_global-error/page`, for seven exact policy entries. There was no middleware route.

Direct post-commit inspection also exited zero:

`node scripts/runtime-artifact-policy.mjs zaruku apps/zaruku/.next-zaruku/standalone`

Artifact evidence:

- size: 73 MB;
- regular files: 2,860;
- symlinks: 0 in this build;
- `.release-source-sha`: `1c8ac36dd465998a5257e3fe3171fca5429cbfa6`, exactly the committed HEAD;
- `.release-runtime-scope`: `zaruku`;
- sealed root package keys: `name`, `version`, `private`, `dependencies` only;
- required standalone server: `apps/zaruku/server.js`;
- recursive policy result: zero violations.

A temporary loopback start of the sealed server on port 3122 reached Ready and `GET /api/health` returned HTTP success with `{"ok":true,"scope":"zaruku"}`. The process was then stopped. The first sandbox start was denied with loopback `EPERM`; the approved local rerun succeeded and required no code change.

## Verification

- `node --test scripts/runtime-artifact-policy.test.mjs` — exit 0; 35/35 passed.
- `npm --workspace apps/zaruku run build` — exit 0 before commit and again after commit; isolated route inventory only.
- `npm --workspace apps/zaruku run verify:artifact` — exit 0 against both fresh builds.
- `node scripts/runtime-artifact-policy.mjs zaruku apps/zaruku/.next-zaruku/standalone` — exit 0 after commit.
- `node --import tsx --test src/lib/release-asset-policy.test.ts` — exit 0; 22/22 passed after the positional-parser correction.
- `npm run security:public-assets` — exit 0 with its exact unchanged command. The sandbox attempt hit the known `tsx` local IPC `EPERM`; the approved local rerun passed.
- `npm run typecheck` — exit 0 after final source edits.
- `npx tsc --noEmit -p apps/zaruku/tsconfig.json` — exit 0 after final source edits.
- `npx eslint scripts/runtime-artifact-policy.mjs scripts/runtime-artifact-policy.test.mjs scripts/assert-no-private-public-assets.ts` — exit 0.
- `npm test` — exit 0; 956 Node tests discovered, 946 passed, 10 existing skips, zero failures; all 13 Python tests passed. The standalone `.mjs` fixture suite is intentionally run by its explicit focused command because the existing root discovery pattern selects TypeScript tests.
- `npm run build` — exit 0; the unchanged combined application built all existing portal/admin/advertising/Zaruku/Abbott-compatible routes and its existing proxy middleware.
- `npm ci --dry-run` — exit 0, lockfile clean and up to date; no install was performed.
- `git diff --check` before commit and `git diff HEAD^ --check` after commit — exit 0.

## Self-review

The policy is fail closed at every authority boundary: unsupported scope, absent/non-directory/symlink artifact root, malformed/missing metadata, malformed/missing route manifest, wrong/missing/extra routes, unreadable entries, malformed structured export candidates, unsupported entry types, broken links, and escaping links all produce violations or a nonzero CLI result. Error output reports paths and marker names, not file contents or environment values.

Traversal uses directory entries and `lstat` semantics. Symlink targets are canonicalized only to establish containment and are never recursed into or read. A contained target also exists elsewhere in the real tree and is inspected through its actual directory entry. Route authority is checked twice: exact manifest key/value equality and the compiled `page.js`/`route.js` file inventory.

The permitted environment exception is deliberately narrow: only `<artifact-root>/.env` is allowed as a filename. Its contents are still scanned, so prohibited source tokens or Abbott private credential markers fail. Every `.env*` variant and every nested `.env` is rejected.

The Abbott/combined release policy was not changed or weakened. The shared entry point still runs it before the new scope policy, and its entire existing suite plus the original public command passed.

## Concerns and limits

- This policy intentionally supports only `zaruku`; advertising and Abbott isolated scopes require their own reviewed route and credential contracts later.
- Stamping derives the SHA from local `git rev-parse HEAD`. It does not itself assert a clean named branch; Task 6 owns the reviewed deploy/branch/lock authority. The post-commit artifact was rebuilt so its metadata matches committed HEAD exactly.
- The recursive content scan currently reads about 73 MB across 2,860 files. That is intentionally comprehensive and completed in under one second locally; future artifact growth may justify a streaming implementation without weakening coverage.
- This is local artifact evidence only. No production process, proxy, deployment, database, migration, cron, secret, collector, source API, Telegram, or Hermes change occurred.

## Task 5 review fix

The review findings against `1c8ac36` are addressed in one Task 5 policy/test change. This section supersedes the earlier descriptions of permitted contained symlinks, root `.env` inspection by marker scanning alone, and server validity based on presence alone. Parent acceptance remains pending.

### Changed boundary

- Root `.env` is optional, but when present must be a regular single-link file containing at most 64 KiB of valid UTF-8, without BOM, NUL/control characters, malformed lines, duplicate keys, or unterminated quotes. Parsing accepts rendered `KEY=value` and single-line quoted values, comments and blank lines. Only the source-derived Zaruku keys are accepted: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `NODE_ENV`, `HOSTNAME`, `PORT`, `NEXT_PUBLIC_BASE_URL`, `DASHBOARD_AUTH_SECRET`, `INTERNAL_BASE_URL`, `PUPPETEER_EXECUTABLE_PATH`. All other namespaces fail closed, including every Abbott/private, advertising, administrator, AI-summary, source OAuth and collector token key. Diagnostics contain paths and policy markers, never values. Task 6 must supply a Zaruku renderer that emits only this contract; the combined renderer is not suitable.
- Exact ownership covers the app-paths, app-path-routes, middleware, pages, routes, functions-config, server-reference, build, prerender and required-server-files authority manifests. Middleware and edge functions must be empty. The only redirects/rewrites are the exact generated Next trailing-slash redirect and Zaruku asset rewrite. The seven Zaruku/framework routes and two framework HTML error pages are the allowed inventories. Alternate app roots, foreign route trees, edge chunks, extra page routes and arbitrary server/instrumentation entrypoints are rejected.
- Archives and container suffixes include ZIP, TAR and compressed TAR families, GZIP, BZIP2, XZ, Zstandard, 7z, RAR, JAR/WAR, ISO and DMG; source workbook families include XLS/XLSX/XLSM/XLSB, XLTX/XLTM/XLAM, ODS/OTS/FODS and Numbers. Magic-byte checks also reject renamed common archives and OLE containers. Inspected text uses fatal UTF-8 decoding, so UTF-16 CSV/TSV and invalid encodings cannot evade the structural export scan. Individual files are bounded at 32 MiB, total inspected bytes at 256 MiB, entries at 20,000 and traversal depth at 64. Current traced native dependency modules are the narrow binary decoding exception; they remain size-, path-, signature- and marker-checked.
- The standalone server must match the pinned Next 16.1.6 executable template, with its parsed JSON configuration matching required-server metadata. Whitespace inside string literals is preserved during comparison. The build ID and coherent Zaruku standalone configuration are required. `npm --workspace apps/zaruku run verify:boot` validates the artifact, starts the exact sealed server on a reserved ephemeral `127.0.0.1` port with no inherited credentials or Node preload options, requires HTTP 200 and exact `{ok:true,scope:"zaruku"}` health, stops the child in `finally`, revalidates the artifact and compares all file digests.
- No symlinks are needed by the real artifact, so all are rejected. Path/name policy runs before entry-type handling. The inspector uses fresh `lstat`, `O_NOFOLLOW`/`O_NONBLOCK`, identity-checked file descriptors and bounded reads. Authority and content checks consume the same captured bytes; the entire tree's inode/mode/size/mtime/ctime identities are rechecked before returning. Hardlinks and unsupported entries fail closed. A deterministic checked-file-to-symlink swap fixture demonstrates rejection.

The legacy Abbott/combined asset policy and `assert-no-private-public-assets.ts` were not changed in this fix. No runtime, collector, authentication, data-plane, schema or production behavior changed.

### Review RED/GREEN evidence

1. Before changing production policy, added the review cases and changed the previously accepted contained-link case to require rejection. `node --test scripts/runtime-artifact-policy.test.mjs` produced **91 tests: 35 passed, 56 failed**. The failures showed false-clean `.env` host/user namespaces, collector/source keys, malformed/duplicate/BOM/UTF-16/invalid UTF-8/oversized environments, alternate app roots, middleware/functions/pages/route authority, archives/workbooks/UTF-16 exports, comment-only/fake server files, contained forbidden-path links and the deterministic link swap. The pre-existing private-password marker case already rejected as expected. Initial RED output: `/private/tmp/task5-review-red.log`.
2. After the first coherent implementation, all **91/91** passed and the existing real standalone artifact passed direct inspection.
3. Added the post-seal boot contract/wiring and arbitrary app/instrumentation/server executable cases. Before implementing them, `node --test --test-name-pattern='review:' scripts/runtime-artifact-policy.test.mjs` produced **70 tests: 64 passed, 6 failed** (three forbidden executable cases plus their parent test, missing boot API, missing workspace boot command). The complete environment allow-list and allowed-directory size/encoding fixtures passed. After implementation the complete suite passed **105/105**.
4. Final self-review found two further false-clean cases. `node --test --test-name-pattern='server validation preserves|build manifest cannot' scripts/runtime-artifact-policy.test.mjs` produced **0/2 passed, 2 failed** for whitespace changes inside `require('next')` and a foreign build-manifest page. Exact line comparison and build-manifest page authority fixed them.
5. Final full artifact fixture command: `node --test scripts/runtime-artifact-policy.test.mjs` — **107/107 passed**, no failures or skips. Output: `/private/tmp/task5-review-final-fixtures.log`.

### Fresh verification

- `npm --workspace apps/zaruku run build` — exit 0; fresh isolated webpack build and seal. Only `/_not-found`, `/api/dashboard/zaruku`, its Excel/PDF routes, `/api/health` and `/dashboard/zaruku` in the emitted route inventory; no middleware. Output: `/private/tmp/task5-zaruku-build.log`.
- `npm --workspace apps/zaruku run verify:artifact` — exit 0 against the fresh sealed artifact, through the unchanged legacy gate plus the revised scoped policy.
- `npm --workspace apps/zaruku run verify:boot` — exit 0 in the approved local run, printing only `Zaruku standalone loopback boot/health passed`. The sandbox attempt could not complete local boot; no policy exception was added.
- `node --import tsx --test src/lib/release-asset-policy.test.ts` — **22/22 passed**.
- `npm run security:public-assets` — exit 0, exact unchanged legacy command.
- `npm run typecheck` and `npx tsc --noEmit -p apps/zaruku/tsconfig.json` — exit 0.
- `npm test` — approved local rerun exit 0: **956 Node tests discovered, 946 passed, 10 existing skips, zero failures; 13 Python tests passed**. The sandbox run had one existing `tsx` IPC socket `EPERM` failure and therefore stopped before Python; the approved rerun required no code change. Output: `/private/tmp/task5-full-tests-approved.log`.
- `npm run lint` — exit 0, zero errors and 12 pre-existing warnings in unrelated files. Focused ESLint on both policy files and the unchanged asset entrypoint is clean. Output: `/private/tmp/task5-lint.log`.
- `npm run build` — approved local retry exit 0; combined application and its existing proxy middleware remain buildable. The initial restricted run failed only to fetch Inter/JetBrains Mono from Google Fonts. Output: `/private/tmp/task5-combined-build-approved.log`.
- `npm ci --offline --dry-run --ignore-scripts` — exit 0, up to date; no dependency installation or lockfile change. Output: `/private/tmp/task5-npm-dry-run.log`.
- `git diff --check` — exit 0.

### Remaining scope limits

- The template/manifest contract deliberately pins current Next output; a Next upgrade must review and update the contract against a fresh build.
- These are local artifact and boot checks. Deployment must retain exclusive ownership of its sealed staging directory through activation; a completed inspection cannot prevent later writes by another actor. Task 6 owns that release lifecycle and the scoped environment renderer.
- No production operation, proxy edit, database access/write, migration, cron edit, source API call, secret installation/rotation, Telegram send or Hermes schedule occurred. Build-only Google Fonts downloads and local loopback health probes are the only network-related verification actions.

Done: Task 5 review fixes and requested local verification complete. Accepted: pending independent parent review. Reusable learning: none captured before acceptance. Skill action: review reception, TDD and verification instructions used; no durable skill edit. Evidence: the commands and results above. Budget stop: none.
