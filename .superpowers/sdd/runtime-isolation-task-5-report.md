# Task 5 — Zaruku Artifact Boundary

Status: implemented, committed, and locally verified. Parent review/acceptance is pending.

- Base: `c9ec43b3c42ce4c5fc312b64ee72c1a448a98dae`
- Task commit sequence:
  1. `1c8ac36dd465998a5257e3fe3171fca5429cbfa6` — `test(zaruku): enforce isolated release artifact` (initial implementation).
  2. `2581189afab9a6f8e2e850ad588a2148ae97c06f` — `fix(zaruku): close runtime artifact policy bypasses` (first review fix; first commit tracking this report).
  3. `b32ffce81ed4b058df483e9ab80a99ec367e8483` — `fix(zaruku): enforce traced artifact file closure` (second review fix).
  4. `fix(zaruku): bind artifacts to external build authority` — the final external-authority fix commit containing this report revision; its hash is supplied in the completion handoff and `git log -- .superpowers/sdd/runtime-isolation-task-5-report.md`.
- Worktree: `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation`
- Worktree state after the initial and first review-fix commits and their post-commit rebuilds: clean (`git status --short` produced no output).
- This report is tracked: it was force-added from the otherwise ignored `.superpowers/sdd` evidence area in `2581189`, and its latest evidence is included in the final external-authority fix commit.

The original Outcome through Concerns sections below preserve the evidence and claims recorded for `1c8ac36`; subsequent review found gaps in that implementation. The later review-fix sections describe corrections and supersede those historical policy descriptions. No earlier failed gate or review finding has been removed from the history.

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

## Task 5 final review fix — traced file closure

Review of `2581189` found that directory-level allowances still admitted untraced support executables. This final fix replaces directory eligibility with a complete file closure. The historical findings and evidence above remain intact; the report header now records the complete task commit sequence and accurately states that the report is tracked.

### Final policy

- Sealing preserves the generated `next-server.js.nft.json` inside `apps/zaruku/.next-zaruku/`, because Next copies its dependencies but omits that trace from standalone output. The source trace must be a bounded regular file with one link, and it is opened with `O_NOFOLLOW`.
- The inspector seeds the generated standalone server, package/config/release metadata, the exact Next authority files and all seven owned route executables and their `.nft.json` sidecars. It recursively resolves every reachable trace and executable sidecar inside the same previously captured artifact snapshot. Each trace must have version 1, the exact `files`/`version` structure, unique relative entries, at most 10,000 entries, at most 20,000 total references and at most 32 trace levels. Missing files, escapes, absolute/Windows paths, cycles, excessive traces, symlink targets and hardlink targets fail closed. The existing inode/no-follow checks supply the trace graph with regular single-link files only.
- Every regular artifact file must belong to that closure. No `node_modules/`, runtime-contract, app support or server chunk directory grants executable eligibility on its own. The only additional inert server outputs are individually enumerated framework error-page HTML/meta/RSC files and segment names. There is no public-directory exception.
- Optional browser chunks/CSS/media must be named by the owned build, client-reference, loadable or font manifests and pass the strict static-path rule. Arbitrary adjacent browser JavaScript is rejected. Client-reference manifests are parsed as the exact generated assignment plus JSON, without evaluating JavaScript. Optional static files are not required in the server-only standalone output; a later packaging step must select eligible manifested assets rather than bulk-copy unreferenced build files.
- All traced package manifests are checked against canonical manifests from the reviewed checkout, with installed package versions also compared to its lockfile. A dependency file requires its traced owning package manifest. Next is pinned to `next@16.1.6`; any traced runtime-contract package must match canonical `@reportingdash/runtime-contract@0.1.0`. Bundled/subpath manifests that intentionally omit versions must still match their exact canonical package metadata. This check consumes trusted checkout/installation authority, not a new artifact-owned dependency allow-list.

### Closure RED/GREEN evidence

1. Before changing policy, copied the existing real sealed standalone artifact four times, verified each copy was initially clean, then separately added `node_modules/google-ads-admin/index.js`, `apps/zaruku/.next-zaruku/server/app/foreign-helper.js`, `packages/runtime-contract/advertising-admin.js` and an untraced top-level server chunk. `node --test --test-name-pattern='closure:' scripts/runtime-artifact-policy.test.mjs` returned **0/5 passed, 5 failed**, including the containing test: every injected executable was falsely accepted. Evidence: `/private/tmp/task5-closure-red.log`.
2. Added missing/outside/absolute/Windows/cyclic/excessive/missing-route trace cases, incorrect Next name/version, incorrect runtime-contract identity, and an adjacent unmanifested browser chunk. Before implementation, the expanded same command returned **0/18 passed, 18 failed**. Evidence: `/private/tmp/task5-closure-expanded-red.log`.
3. The first closure implementation passed 118/125 tests. The remaining failures identified legitimate nested client chunk paths plus the two older stamp fixtures that lacked the newly required generated server trace. The path grammar was corrected for concrete nested manifest entries and the stamp fixtures now model the real build/standalone layout; no executable-directory allowance was restored.
4. Complete final policy suite: `node --test scripts/runtime-artifact-policy.test.mjs` — **125/125 passed**, no failures or skips, including all four injections into copies of the fresh real artifact. Evidence: `/private/tmp/task5-closure-final-fixtures.log`.

The real-artifact fixture group intentionally requires the isolated build output. Run `npm --workspace apps/zaruku run build` before the complete fixture suite in a clean checkout. The ordinary synthetic fixtures also model the trace/package metadata contract.

### Final verification

- Fresh `npm --workspace apps/zaruku run build` and `npm --workspace apps/zaruku run verify:artifact` — exit 0; the real server trace is preserved, all runtime files belong to the closure, and the exact isolated route inventory remains unchanged. Build log: `/private/tmp/task5-closure-zaruku-build.log`.
- `npm --workspace apps/zaruku run verify:boot` — exit 0 with the exact loopback health contract and child cleanup; the artifact remained unchanged after boot.
- `node --import tsx --test src/lib/release-asset-policy.test.ts` — **22/22 passed**; `/private/tmp/task5-closure-legacy.log`.
- `npm test` — one approved full run after this broad closure change, exit 0: **956 Node tests discovered, 946 passed, 10 existing skips, zero failures; 13 Python tests passed**; `/private/tmp/task5-closure-full-tests.log`.
- `npm run typecheck` and `npx tsc --noEmit -p apps/zaruku/tsconfig.json` — exit 0.
- `npm run build` — exit 0, preserving the combined app and its proxy middleware; `/private/tmp/task5-closure-combined-build.log`.
- `npm run lint` — zero errors, the same 12 existing unrelated warnings; focused policy/test ESLint clean. Log: `/private/tmp/task5-closure-lint.log`.
- `npm run security:public-assets` — exit 0; no change to the legacy Abbott/public policy.
- `npm ci --offline --dry-run --ignore-scripts` — exit 0, up to date, no installation or lockfile modification; `/private/tmp/task5-closure-npm.log`.
- `git diff --check` — exit 0.

The approved local runs reused the previously established requirements for tsx IPC, a temporary loopback listener and build-only Google Fonts downloads. No production operation, proxy edit, database access, schema/migration, collector/source API, cron, secret, Telegram or Hermes action occurred.

Remaining integration constraints: the policy still pins reviewed Next output and must run alongside the trusted checkout's lockfile/canonical package manifests. Release staging must remain exclusively owned through activation, and Task 6 must package only eligible assets and render the scoped environment. Neither trace metadata nor an inspection result is a cryptographic signature against an actor able to rewrite the complete artifact and all its authority files later.

Done: final Task 5 closure fix and local verification complete. Accepted: pending parent review. Reusable learning: not captured before acceptance. Skill action: review/TDD/verification instructions applied; no skill update. Evidence: commands above. Budget stop: none.

## Task 5 final re-review fix — external build authority

Re-review of `b32ffce` demonstrated that changing an artifact trace or asset manifest together with an added executable could authorize that executable. Modifying a traced dependency without changing its package identity also passed. Those claims of closure were therefore insufficient as a trust boundary. This section supersedes the preceding artifact-owned authority description while retaining the original evidence.

### External trust contract

- Fresh workspace build now runs Next, prepares `.next-zaruku/trusted-runtime-manifest.json` **outside** `.next-zaruku/standalone`, then seals and verifies standalone. Preparation reads build-side output, canonical workspace/package metadata and installed traced dependency bytes, never the packaged artifact. Generated server/release/root-package files are reconstructed from the pinned Next template, build configuration and reviewed metadata. The builder rejects any traced environment input before reading it and bounds source size, entries and recursion.
- The external manifest binds version 1, runtime scope `zaruku`, the source commit SHA, `next@16.1.6` and `@reportingdash/runtime-contract@0.1.0`. Every authorized file has a normalized relative path, regular-file type, exact permission mode, byte size and SHA-256. The current fresh output has **2,873 entries: 2,861 required server/dependency/authority files and 12 optional, explicitly manifested browser assets**. Artifact files cannot authorize additional files merely by naming them in a trace.
- Policy and boot require an explicit `--trusted-manifest <external-path>`. The manifest and its `.sha256` digest sidecar must be outside the canonical artifact root, regular single-link owner-only files, with safe directory ancestry. Symlinks, hardlinks, group/other permissions, unsupported encoding, invalid schema/paths and digest mismatch fail closed. The only accepted symlink ancestors are the exact macOS system `/var` and `/tmp` aliases to their `/private` locations. Metadata reads use no-follow, stable descriptors and bounded reads.
- Every artifact file must match the external path/mode/size/hash **before** its bytes enter trace, package, route or asset-authority parsing. Required external files must exist. Release source/scope files must match the external source/scope. Boot also rechecks the external authority digest and all artifact file digests after the loopback health probe.
- Root `.env` is represented only as `{path:".env",type:"dynamic",policy:"zaruku-env-v1",required:false}`. Its values and value hashes are absent from the trusted manifest; changes remain subject to the strict allow-list/parser. No credential values were printed in diagnostics or verification output.
- Legitimate manifested PNG/WOFF/other narrowly named font/image files are validated by external path, size and hash without fatal UTF-8 decoding. JavaScript, CSS, SVG and other text still receive the encoding/content checks. Binary paths do not bypass closure, archive checks or external hashes. Adjacent files and byte tampering fail.

Workspace commands now pass the external path automatically:

```bash
npm --workspace apps/zaruku run build
npm --workspace apps/zaruku run verify:artifact
npm --workspace apps/zaruku run verify:boot
```

The explicit low-level equivalents (from the repository root) are:

```bash
node scripts/runtime-artifact-policy.mjs --prepare zaruku apps/zaruku/.next-zaruku/standalone --trusted-manifest apps/zaruku/.next-zaruku/trusted-runtime-manifest.json
node scripts/runtime-artifact-policy.mjs --stamp zaruku apps/zaruku/.next-zaruku/standalone --trusted-manifest apps/zaruku/.next-zaruku/trusted-runtime-manifest.json
node --import tsx scripts/assert-no-private-public-assets.ts --release --scope zaruku apps/zaruku/.next-zaruku/standalone --trusted-manifest apps/zaruku/.next-zaruku/trusted-runtime-manifest.json
node scripts/runtime-artifact-policy.mjs --boot zaruku apps/zaruku/.next-zaruku/standalone --trusted-manifest apps/zaruku/.next-zaruku/trusted-runtime-manifest.json
```

Preparation uses exclusive creation of both external files; rerun the fresh workspace build before preparing again. Do not regenerate authority from a packaged or modified artifact. Task 6 must transport this authority separately from writable release contents or pin its digest in independently protected deploy authority, bind it to the reviewed clean source SHA and retain exclusive staging ownership. The adjacent digest detects a changed manifest, but is not a signature: an actor able to replace both external files has crossed the trusted build/deploy boundary. This task does not establish remote deployment trust or perform deployment.

### External-authority RED/GREEN

1. Before changing production code, copied the real sealed artifact and captured a fixed external fixture authority. Added `server/app/foreign-helper.js` plus a health-route trace entry; added `static/chunks/foreign-owned.js` plus a build-manifest entry; modified traced `node_modules/next/dist/shared/lib/constants.js` with its package identity unchanged. `node --test --test-name-pattern='trust root:' scripts/runtime-artifact-policy.test.mjs` returned **0/4 passed, 4 failed**, including the parent test: all three self-authorization cases remained false-clean. Evidence: `/private/tmp/task5-trust-root-red.log`.
2. Expanded fixtures for missing/tampered/stale/internal/wrong-scope/SHA/Next/runtime-contract authority, unsafe metadata and genuine PNG/WOFF2. Before implementation the focused run returned **15 tests: 1 passed, 14 failed**; inside-artifact metadata was already rejected by the earlier artifact path policy, while the other authority checks and binary acceptance were absent. Evidence: `/private/tmp/task5-trust-expanded-red.log`.
3. A separately added symlinked metadata-parent fixture returned **0/1 passed, 1 failed** before adding the ancestry check, then passed. No arbitrary parent symlink is accepted.
4. The first full run after external hashing passed **138/140**. The two failures were older oversized-file tests whose synthetic external authority itself exceeded the new descriptor limit; the test-authority helper now omits such oversized entries so the artifact size rejection remains the exercised gate. Production limits were not weakened.
5. Final complete command `node --test scripts/runtime-artifact-policy.test.mjs` returned **144/144 passed**, no skips/failures. Coverage includes the three real-copy attacks, invalid authority variants, dynamic environment changes, real PNG and WOFF2 acceptance, a same-size PNG byte change and a font-size/content change. Evidence: `/private/tmp/task5-trust-verified-fixtures.log`. One focused attempt overlapped Next rebuilding/removing standalone and encountered `ENOENT`; it was rerun after build completion with the final clean result above.

### External-authority verification

- Fresh `npm --workspace apps/zaruku run build` — exit 0 through build → external authority → seal → policy; `/private/tmp/task5-trust-build.log`.
- `npm --workspace apps/zaruku run verify:artifact` and approved local `npm --workspace apps/zaruku run verify:boot` — exit 0. Boot binds only ephemeral `127.0.0.1`, requires exact HTTP 200 `{ok:true,scope:"zaruku"}`, then stops the child and revalidates file and authority digests.
- `node --import tsx --test src/lib/release-asset-policy.test.ts` — **22/22 passed**, unchanged Abbott/legacy behavior; `/private/tmp/task5-trust-legacy.log`.
- One approved `npm test` run after the broad authority change — exit 0, **956 Node tests discovered, 946 passed, 10 existing skips, zero failures; 13 Python tests passed**; `/private/tmp/task5-trust-full-tests.log`.
- `npm run typecheck` and `npx tsc --noEmit -p apps/zaruku/tsconfig.json` — exit 0.
- `npm run build` — exit 0 with the combined app/proxy unchanged; `/private/tmp/task5-trust-combined-build.log`.
- `npm run lint` — exit 0, zero errors and the same 12 pre-existing unrelated warnings; `/private/tmp/task5-trust-lint.log`. Focused ESLint on both policy files and the shared entrypoint also passed after the final test edits.
- `npm run security:public-assets` — exit 0, unchanged legacy gate.
- `npm ci --offline --dry-run --ignore-scripts` — exit 0, up to date, no installation or lockfile change; `/private/tmp/task5-trust-npm.log`.
- `git diff --check` — exit 0.

Only Task 5 policy/tests, workspace command wiring, targeted plan guidance and this tracked report changed. No production process, proxy, database, schema, migration, collector/source API, cron, secret, Telegram or Hermes operation occurred. The existing approved local verification requirements remained tsx IPC, loopback health and build-only font downloads.

Done: external-authority and binary-static fixes locally verified. Accepted: pending independent full-range re-review. Reusable learning: none captured before acceptance. Skill action: review reception, TDD and verification instructions used; no durable skill edit. Evidence: exact commands/results above. Budget stop: none.
