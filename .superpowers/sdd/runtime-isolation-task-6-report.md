# Task 6 — Fixed Zaruku release lifecycle

Status: implemented and locally verified, including the three Important review fixes below; independent parent review/acceptance is pending. Real Linux service-identity execution remains a cutover prerequisite (DONE_WITH_CONCERNS).

Base: `13bbed5` (`fix(zaruku): bind artifacts to external build authority`).
Implementation commit: `feat(zaruku): add independent release lifecycle`; the exact commit ID is returned in the completion handoff and can be read with `git log -- .superpowers/sdd/runtime-isolation-task-6-report.md`.

Worktree: `/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation`.

## Outcome and scope

Zaruku has fixed deploy and predecessor rollback entrypoints. The JSON authority must be a regular, single-link file at its exact repository path and equal the compiled `RUNTIME_MANIFESTS.zaruku` contract: scope `zaruku`, name `dashboard-zaruku`, port `3002`, active directory `/var/www/dashboard-zaruku`, branch `release/zaruku`, lock `/var/www/.dashboard-zaruku-deploy.lock`, asset prefix `/_next-zaruku`. Callers cannot supply targets, release IDs, predecessor paths, SSH executables, alternate manifests, scopes, branches, locks or production environment paths through the supported entrypoints.

The independent lifecycle uses `/var/www/dashboard-zaruku-releases`, `/var/www/dashboard-zaruku-backups` and `/var/www/.dashboard-zaruku-control`. It does not call, source or modify the combined activation, lock, rollback, environment renderer or source guard. Combined commands and existing shell suites remain intact. `test:release-runtime` retains the original four suites, then builds the isolated workspace and runs the new behavioral suite. This build is necessary because the behavioral suite includes the real externally attested artifact and optional browser assets.

No deployment, production connection, production secret read/write, proxy or PM2 operation, database access/migration, collector/source API call, cron change, Telegram send, Hermes schedule or service-account provisioning was performed. OS and secret boundaries were tested with temporary local fixtures. Approved verification used temporary local IPC/loopback listeners and the combined build's font downloads only.

## Authority transport and activation

1. The local entrypoint rejects authority overrides and requires a clean named checkout. Deploy refreshes the fixed `origin/release/zaruku` reference and uses real Git ancestry checks against that reference and the active Zaruku commit. Rollback requires clean reviewed helper source, but deliberately does not require the candidate to descend from the commit it will restore.
2. The deploy build runs `npm ci` followed by the complete existing `predeploy:verify` gate. Its release suite builds Zaruku with Task 5's build → external manifest → seal workflow. The deploy then runs the real loopback boot verifier with the explicit external manifest path.
3. Packaging consumes the existing manifest from `apps/zaruku/.next-zaruku/trusted-runtime-manifest.json`, outside standalone. It checks scope/source binding and the full Task 5 policy first. Each required artifact file is copied by its authorized path, exact mode, length and SHA-256. The 12 optional browser files are selected individually from build-side paths and checked against the same pre-existing manifest. No artifact trace or manifest can add authority, and packaging never calls `--prepare`.
4. The request contains distinct `manifest`, `control` and artifact `files` fields. The control material is copied from trusted checkout/installation inputs: policy, canonical package manifests, lockfile, process config, launcher and the dotenv parser used only by the privileged environment renderer. The parser is absent from, and is not added to, the runtime artifact.
5. `/usr/bin/ssh`, host `beget`, batch mode and strict host-key checking are fixed. The reviewed worker is shell-quoted as code, while the request travels only on stdin. The complete request's SHA-256 is supplied in the independently constructed worker invocation. The worker checks that digest before any OS prerequisite or release action. The digest is not taken from artifact contents or an adjacent sidecar. No caller-controlled value becomes a remote shell command fragment.
6. Remote staging acquires the exclusive Zaruku `mkdir` lock, checks the protected active state again, and rejects a stale SHA. Active inspection also takes this same lock. Source verification immediately before dispatch contains the latest inspected SHA; any later competing activation makes the worker reject the stale request under its lock.
7. The manifest and its sidecar live in a private, root-owned control directory outside the writable packaging input. A root-owned immutable rollout record retains the manifest digest, scope, source SHA, random release ID and exact predecessor ID. The candidate's record/digest remain in worker memory through policy, boot, activation and health attestation. Replacing both manifest and sidecar cannot replace that in-memory pin or the protected predecessor record.
8. The remote worker passes the explicit external manifest path to Task 5 policy and boot. It additionally hashes the complete staged file inventory against the pinned manifest before and after boot, checks exact source/scope bytes, checks ownership/modes/ancestry, and compares the rendered environment's transient in-memory digest. It repeats these checks after the directory moves and after process health verification. No environment value hash is persisted in the manifest or release record.

The authority directory is a privilege boundary, not a cryptographic signature system. The authenticated deploy account and clean reviewed local toolchain remain trusted. A fully privileged actor can replace its own deploy authority; a writable runtime artifact or the unprivileged Zaruku process cannot.

## Process and filesystem prerequisites

The parent explicitly approved defining a future fixed service account/group `dashboard-zaruku`, without asserting that this account already exists in production. The implementation checks these prerequisites and fails closed; provisioning belongs to a later reviewed cutover.

- Deployment runs as UID 0. `dashboard-zaruku` must resolve to a positive different UID and a dedicated positive GID, with exactly that supplementary-group set and no root group.
- `/var/www`, release/control directories and their authoritative ancestry must have trusted ownership and no group/other write bits. Remote ancestry must be root-owned. The existing production env source must be a private root-owned regular single-link file with safe ancestry at the reviewed existing `/var/www/www-root/data/.production.env` location.
- Runtime directories and immutable files are root-owned and readable/executable by the service account, but are not group/other writable. Explicit directory modes remain correct under umask `077`. `.env` is root-owned, mode `0640`, with the dedicated service GID. Control directories are `0700`; authority and canonical control files are `0600`.
- All path components are checked; symlinks, hardlinks, traversal, unexpected modes, foreign-owned writable ancestry and non-regular files are rejected. Only the normal macOS `/tmp` and `/var` aliases are supported in local fixture/build paths.
- PM2 is the privileged supervisor, but its process configuration requests the dedicated UID/GID. `/usr/bin/env -i` runs before Node starts, preventing inherited `NODE_OPTIONS` or other daemon variables from loading code before the launcher can clear its environment.
- The fixed external launcher loads only Node's filesystem module before the verified standalone server. It parses the exact bounded single-quoted format emitted by the scoped renderer, rejects duplicate/unapproved keys and wrong host/port/environment, and removes inherited variables before application startup.
- Health requires HTTP 200 with the exact Zaruku health body, only `127.0.0.1:3002` listeners, exactly one named PM2 process, all real/effective/saved/filesystem UID/GID values matching the dedicated account, and `/proc/<pid>/cwd` pointing to the active Zaruku app. A healthy process still running in a renamed predecessor cannot attest a new release.

These are code-enforced prerequisites, not observed production facts. Production PM2/Linux ownership and account state were not inspected in this task.

## Environment boundary and redaction evidence

The emitted keys are exactly:

`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`; `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`; `NODE_ENV`, `HOSTNAME`, `PORT`, `NEXT_PUBLIC_BASE_URL`, `DASHBOARD_AUTH_SECRET`, `INTERNAL_BASE_URL`; and optional `PUPPETEER_EXECUTABLE_PATH`.

The renderer explicitly selects these values. It never selects `MYSQL_DB_STAT`, admin, Abbott, AI summary, collector, Google or Yandex credentials. DB aliases are rendered consistently from explicit `MYSQL_*` source values. Runtime values are fixed to production, loopback, port 3002 and `http://127.0.0.1:3002`. The primary canonical database name is required; there is no fallback to `MYSQL_DB_STAT`.

The fixture uses a literal password containing `;$(touch nope)` and proves it is preserved as data, with no evaluation. Distinct fake forbidden values for `MYSQL_DB_STAT`, Metrika, Google, Abbott, admin and AI settings are all absent from rendered output. Multiline/unsupported values are rejected with key names only; the test asserts that the fake secret itself is absent from the error. The launcher fixture begins with a broad inherited environment and proves only the selected scoped values exist when `server.js` is required. No real secret was used, printed, copied to this checkout or hashed into persistent authority.

The renderer deliberately refuses control characters and quote/backslash/backtick forms that its exact serialization does not support. A production value using one of those forms will require a reviewed parser/serialization extension, not silent reinterpretation.

## Activation, rollback and failure behavior

Every rollout uses a newly generated unguessable ID with exclusive file/directory creation. Existing destinations are never overwritten, pruned or recursively deleted. An initial deploy is permitted only when both active app and independent state are absent. An existing app without protected state is refused; a combined or foreign artifact is not accepted as an implicit Zaruku baseline.

After all candidate checks, the active directory moves to its own ID under Zaruku backups, and the candidate moves to the fixed active path. The independent current record is published only after process, listener, source/scope and digest attestation succeeds.

Manual rollback has no caller-supplied target. It follows the exact predecessor ID in protected state, rechecks that predecessor's independent manifest digest and artifact scope/source, performs policy and boot verification, and uses the same activation/health procedure. Combined, advertising and Abbott candidates/rollback predecessors, malformed/missing scope metadata, symlink targets and replaced manifest+sidecar pairs are refused.

Caught activation/start/health/attestation failures preserve the failed candidate under the Zaruku releases directory and restore the attested predecessor. Restoration checks its authority, restarts it and verifies health again. If restoration/start fails, only `dashboard-zaruku` is stopped and the failure/evidence is retained. No predecessor is silently replaced by another backup or period.

The lock is token-owned and removed only if its exact owner and only expected contents remain. Same-scope contention is refused while another transaction is active; other runtime locks are untouched. Abrupt process termination such as SIGKILL, host failure or uncertain SSH completion can leave the protected lock/staging evidence behind. It is intentionally not stolen or automatically deleted; recovery requires inspection of the preserved scope-specific state.

## RED/GREEN evidence

All initial authority, override, ancestry, lock, rollback, environment and trusted-manifest test cases were written before the implementation files.

1. `bash scripts/deploy-zaruku.test.sh` — RED, exit 1: `FAIL: fixed Zaruku entrypoint is missing`. Log `/private/tmp/task6-red.log`.
2. First implementation run — 9/11 passed. Two failures were case-sensitive test assertions against correctly capitalized rejection messages; no boundary was weakened. Correcting those assertions produced 11/11 GREEN.
3. PM2 environment clearing, under-lock inspection, environment replacement during boot and package wiring were added before their fixes. `node --import tsx --test --test-name-pattern='PM2|inspection|replacement during|wired' scripts/deploy-zaruku.test.mjs` — RED, 0/4 passed. After the fixes, the complete suite passed 14/14. Logs `/private/tmp/task6-boundary-red.log` and `/private/tmp/task6-boundary-green.log`.
4. Live UID/GID attestation, restrictive umask and real packaging tests — RED, 0/3 passed; missing process attestation/export and a `0700` versus required `0755` staged directory were observed. GREEN after implementation: 17/17, including the real payload verified by the separately transported Task 5 policy and canonical metadata.
5. The real payload inventory showed that dotenv is not traced into standalone. The strengthened launcher test failed before removing its dependency on artifact dotenv. `--test-name-pattern='PM2 clears'` then passed with the strict built-in-only parser. Log `/private/tmp/task6-launcher-red.log`.
6. The substituted-request test initially returned zero because macOS `/var` aliasing made the remote worker's direct-file guard skip execution. Canonicalizing that guard produced GREEN; the tampered request now fails with `Transport authority mismatch` before any account/lock/activation operation. The SSH evaluation adapter already invokes `remoteMain` explicitly; it does not depend on that direct-file guard.
7. `--test-name-pattern='locked dependency'` — RED, missing exported build-gate function. GREEN proves deploy invokes `npm ci` and then `npm run predeploy:verify`, using a temporary fake npm executable; no actual install or nested full verification occurs in that fixture. Log `/private/tmp/task6-deploy-gate-red.log`.
8. `--test-name-pattern='foreign ancestor'` — RED, missing expected exception for an untrusted owner-writable ancestor. GREEN after checking ancestor ownership as well as mode. The test intercepts only filesystem stat metadata to model an otherwise impossible local chown; the real file/hash/path logic executes. Log `/private/tmp/task6-ancestor-red.log`.
9. `--test-name-pattern='healthy process'` — RED, a process still in a predecessor directory was accepted. GREEN after enforcing the active `/proc` cwd. Log `/private/tmp/task6-process-cwd-red.log`.
10. Final focused command `bash scripts/deploy-zaruku.test.sh` — exit 0, **22/22 passed**, no skips/failures. Log `/private/tmp/task6-final-deploy-suite.log`.

The temporary lifecycle worker copies substitute only fixed paths/deploy UID and OS effects (account lookup, chown, PM2/listener calls and fake secret input). They expose no environment/path override in the production entrypoints. Filesystem staging, locks, hashing, authority records, renames, rollback and collision checks run normally. The real-payload test uses the actual policy module, manifest, canonical metadata and build output; only privileged process operations are simulated.

## Verification

- Full `npm run predeploy:verify` invocation ran once. `npm test` passed: **956 Node tests discovered, 946 passed, 10 existing skips, zero failures; all 13 Python tests passed**. All combined source/lock/deploy/bootstrap/predeploy-contract suites passed. Log `/private/tmp/task6-predeploy.log`.
- That invocation stopped at the new release suite with the launcher and direct-worker alias failures described above. Its exit code was 1 and is not represented as a clean full-command run. After correction, verification resumed from the failed stage without repeating the 956-test base run:
  `npm run test:release-runtime && npm run test:abbott-contract-wiring && npm run test:abbott-contract && npm run security:public-assets && npm run typecheck && npm run lint && npm run build && npm run preview-builder:test`.
  This entire command returned **exit 0** (tool session `91080`). All original combined release/rollback suites passed, as did the isolated build, then-current 19-case Task 6 suite, **111/111 Abbott contract tests**, public security, root typecheck, lint, combined build and preview tests. Later bounded Task 6 hardening was rechecked by the final 22-case suite, focused lint and shell checks.
- `npm --workspace apps/zaruku run build` — exit 0, fresh isolated route inventory only. First build log `/private/tmp/task6-zaruku-build.log`; the resumed release gate also rebuilt it.
- `node --test scripts/runtime-artifact-policy.test.mjs` — **144/144 passed**, zero failures/skips. Log `/private/tmp/task6-task5-policy.log`.
- `npm --workspace apps/zaruku run verify:artifact` and `npm --workspace apps/zaruku run verify:boot` — exit 0; exact external manifest supplied, temporary loopback server started and stopped, post-boot artifact/authority checks passed.
- `npm run typecheck` and `npx tsc --noEmit -p apps/zaruku/tsconfig.json` — exit 0. Both application builds also completed type checking.
- Full `npm run lint` — exit 0, zero errors and the same 12 existing unrelated warnings. Final focused ESLint on all new JS/CJS files — exit 0, no warnings.
- `npm ci --offline --dry-run --ignore-scripts` — exit 0, up to date, no install and no lockfile change.
- `bash -n scripts/deploy-zaruku.sh scripts/deploy-runtime.sh scripts/rollback-zaruku.sh scripts/deploy-zaruku.test.sh` — exit 0.
- `git diff --check` — exit 0.

## Files

- `deploy/zaruku/release.json` — exact reviewed runtime authority.
- `deploy/zaruku/ecosystem.config.cjs` — fixed PM2 process, dedicated identity and pre-Node environment clearing.
- `deploy/zaruku/start.cjs` — strict scoped environment launcher outside artifact closure.
- `scripts/deploy-zaruku.sh`, `scripts/rollback-zaruku.sh` — no-argument sealed entrypoints.
- `scripts/deploy-runtime.sh` — fixed authority override guard and internal invocation.
- `scripts/deploy-runtime.mjs` — local manifest/checkout/ancestry/build checks, selected packaging and fixed SSH transport.
- `scripts/runtime-release-remote.mjs` — remote privilege/ownership/lock/staging/attestation/activation/rollback and scoped renderer.
- `scripts/deploy-zaruku.test.sh`, `scripts/deploy-zaruku.test.mjs` — RED-first behavioral and real packaging fixtures.
- `package.json` — independent commands and additive release-test integration.
- This report — tracked task evidence.

## Self-review and concerns

The combined code, canonical data plane, collectors, schema and runtime application source were not edited. Scope paths are constants in the worker; the only flexible paths are validated relative manifest entries under exclusively created Zaruku stage/control directories. Remote code and control authority originate from the reviewed checkout, never from the packaged runtime. Runtime account separation, private control state and independent in-memory digest pins close the complete-manifest/sidecar replacement attack addressed in Task 5.

A separate review agent was requested twice but could not be started because all thread slots were occupied. Independent parent review remains required; this is not an acceptance claim.

Remaining operational prerequisites/limits:

- Provision/verify the dedicated service account/group and root-owned control/release/secret ancestry before cutover; verify the fixed `beget` host key, privileged Node/PM2 toolchain, Linux `/proc`, `ss`, and PM2 UID/GID support. None was inferred as already installed.
- The fixed external launcher is created on first activation. Later releases must match its reviewed bytes; a changed launcher deliberately requires a separate reviewed process transition so it cannot mutate another running release's startup authority.
- Releases/backups/control records are retained without pruning. Disk retention and interruption recovery need an explicit later operational policy; this task never deletes unknown or material release data.
- SSH acknowledgement loss or an uncatchable worker termination may leave a lock/stage behind; the next operation fails closed for manual inspection. The code does not promise crash-atomic recovery across host failure.
- The protocol uses a bounded in-memory JSON/base64 request (limit 512 MiB), suitable for the current roughly 73 MiB standalone artifact. Larger future artifacts require a reviewed streaming transport change.
- No actual production deployment or account/permission/PM2 integration has been proven by these local fixtures. Proxy routing, account provisioning and live cutover remain outside Task 6.

Done: Task 6 implementation and local verification complete. Accepted: pending independent parent review. Reusable learning: none captured before acceptance. Skill action: TDD and verification-before-completion instructions applied; no durable skill edit. Evidence: exact RED/GREEN and verification results above. Budget stop: none.

## Important review fixes — 2026-09-05

This section supersedes the original remote boot, Git ancestry, and failed-manual-rollback descriptions above. The original implementation and its historical verification results remain recorded without rewriting a failed command as successful.

Implementation baseline: `3f275e1bbcfb9bc5b5828199ea9018a1447ccbdb`. Fix commit: `fix(zaruku): harden boot identity and rollback authority`; its exact ID is supplied in the completion handoff.

### 1. Fixed unprivileged preactivation and rollback boot

The root-owned verifier now calls the separately transported Task 5 policy **without** `--boot`, passing the explicit protected external manifest path. Application startup is delegated to `bootRuntimeAsService`; the policy is run again afterward with the same explicit authority. The transaction retains its existing in-memory manifest/environment pins and artifact attestation through activation. The runtime receives neither the manifest path nor private control access.

The reviewed mechanism is the literal `/usr/bin/setpriv`, with no caller override. Linux UID/EUID 0 is required for the verifier, but the fixed `dashboard-zaruku` account/group must resolve to positive non-root IDs before spawning. Ownership, link count, modes, ancestry and runtime file readability are checked. The spawn uses `--reuid`, `--regid`, `--clear-groups`, `--no-new-privs`, and clears inheritable, ambient and bounding capabilities. Its environment is exactly `NODE_ENV`, `HOSTNAME`, and the reserved ephemeral loopback `PORT`; no inherited PATH, HOME, NODE_OPTIONS, database credentials, tokens or authority path reaches the boot child.

A trusted bootstrap executes after the OS privilege drop and before `require(server)`. It attests real/effective UID/GID, empty kernel supplementary groups, zero Linux capability sets, `NoNewPrivs=1`, and exact canonical application cwd. It sends a bounded identity record over a dedicated descriptor which it closes before application code. The privileged parent independently checks `/proc/<pid>/status` and cwd before and after the exact HTTP health response. A missing mechanism, identity mismatch, unsupported platform, wrong permissions, unexpected groups/capabilities/cwd, startup failure or timeout fails closed. The child is terminated and reaped. Local build/boot entrypoints now reject UID or EUID 0, so the Task 5 local loopback path cannot accidentally execute application code as root either.

The new disposable Linux fixture `scripts/boot-zaruku-service.linux.test.mjs` executes this actual function with a synthetic HTTP server, records UID/GID/groups/cwd/env/kernel status from application code, and proves denied writes to protected control authority, a sibling directory and its own artifact. It also tests missing and impersonating `setpriv`: a root-preserving replacement must be rejected before the app writes its proof. This is not a source-regex assertion. It deliberately requires Linux root inside a disposable Docker container, creates only a container-local fixture service identity, uses temporary artifact/control/sibling files, and never accesses `/var/www` or production. The container needs SYS_PTRACE for the privileged parent to independently inspect the different-UID child's cwd; all application capability sets are still cleared.

**Execution limitation:** this host is macOS UID 501. Local sudo requires a password. Docker Desktop's server API returned HTTP 500 for the probed API versions; no container or Linux privilege-drop run was possible. At the parent's explicit direction Docker was not restarted, no production identity was inspected/provisioned, and this is a later cutover prerequisite rather than a Task 6 blocker. The fixture passed syntax/lint checks only; no executed Linux UID separation is claimed. In a disposable Linux test environment with a reviewed Node + util-linux image already available, run:

```sh
docker run --rm --network none --cap-add SYS_PTRACE \
  --mount type=bind,source=/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation,target=/src,readonly \
  --workdir /src REVIEWED_NODE_UTIL_LINUX_IMAGE \
  node --test scripts/boot-zaruku-service.linux.test.mjs
```

`REVIEWED_NODE_UTIL_LINUX_IMAGE` is intentionally a prerequisite placeholder, not a guessed image/digest or an executed command. The disposable image must supply Node, `/usr/bin/setpriv`, `/usr/bin/id`, `/usr/sbin/groupadd`, and `/usr/sbin/useradd`, and have no pre-existing fixture account/group. The future real Linux gate must pass both cases before shadow/cutover; production service-account/filesystem/PM2 prerequisites remain separate.

### 2. Authoritative ancestry ignores replacement graphs

Every authoritative Git subprocess now uses both `git --no-replace-objects` and fixed `GIT_NO_REPLACE_OBJECTS=1`. It also fixes `GIT_GRAFT_FILE=/dev/null`, so legacy `.git/info/grafts` cannot substitute parentage. Supported entrypoints and the Git helper itself reject inherited `GIT_*` variables, including replacement-ref base, object/alternate-object directories, repository/worktree/common directories, shallow/graft files, index/config injection and SSH graph transport overrides. The only harmless permitted inherited key is `GIT_PAGER`, replaced inside the subprocess by `/bin/cat`. Rejections reveal no values.

The real temporary-Git test constructs divergent commits, demonstrates that the replacement-free ancestry command rejects the divergent SHA, installs `git replace --graft`, and proves the deploy guard still rejects that SHA while accepting the actual ancestor. It repeats the rejection with legacy `info/grafts`. A separate helper test attempts all listed graph/object environment overrides and confirms rejection before repository traversal. No combined Git guard was edited.

### 3. Failed manual rollback remains retryable

Manual rollback temporarily borrows the exact predecessor from its protected BACKUPS location. If candidate activation/start/health fails, the worker now checks its original in-memory authority and environment pin and atomically returns the candidate to that same backup path before restoring the current release. The unchanged current record's `previousId` therefore remains usable, and a transient failure followed by retry succeeds.

The recovery path refuses an occupied/symlink destination and never overwrites it. In such a collision or candidate-integrity failure it retains the candidate under a unique failed-release location, restores the current active release if possible, and reports an explicit recovery-needed error rather than promising retryability. A failed second activation rename leaves the candidate at its original backup and restores the current active release. Every active recovery destination is checked before rename. No unknown backup, collision or evidence is deleted; uncatchable process/host failure remains the previously documented manual-recovery limitation.

### Review-fix RED/GREEN

1. `node /private/tmp/task6-review-repro.mjs` reproduced the original findings: a replaced divergent graph was accepted even though true ancestry exited 1; transient manual rollback moved its predecessor out of BACKUPS and retry failed with ENOENT.
2. `node --import tsx --test --test-name-pattern='clean named|graph substitution|transient manual|enforceable fixed' scripts/deploy-zaruku.test.mjs` — **RED, 0/4 passed**, before the fixes: accepted substituted ancestry, missing graph-env rejection, missing original rollback backup, and missing enforceable boot function. Log `/private/tmp/task6-review-red.log`. The first implementation exposed this host's harmless inherited GIT_PAGER; permitting only that key while fixing its subprocess value produced **GREEN, 4/4**. Log `/private/tmp/task6-review-first-green.log`.
3. `node --import tsx --test --test-name-pattern='real remote verification' scripts/deploy-zaruku.test.mjs` — **RED**, missing the actual exported remote verification call chain, before adding it. Log `/private/tmp/task6-review-callchain-red.log`. **GREEN** uses real packaged bytes and separately transported policy/authority: inspection succeeds, then the real boot path refuses this non-Linux/nonprivileged environment before activation. It does not replace the verifier with a source-regex check.
4. `node --import tsx --test --test-name-pattern='locked dependency' scripts/deploy-zaruku.test.mjs` — **RED**, the local build gate accepted simulated UID 0 and ran the fake npm executable. Log `/private/tmp/task6-review-local-root-red.log`. **GREEN** rejects before any build command while preserving ordinary unprivileged `npm ci` → full predeploy ordering.
5. Added behavioral regressions cover transient rollback failure followed by successful retry, exact unchanged current/predecessor metadata, reoccupied directory and symlink backup slots, preserved recovery evidence, and failure of the second directory rename followed by successful retry. Existing authority, cross-scope, lock, stale SHA, env-redaction, manifest-replacement and foreign-artifact cases remain present.
6. `bash scripts/deploy-zaruku.test.sh` and the full release gate — **GREEN, 28/28**, no failures/skips. Focused log `/private/tmp/task6-review-focused.log`; the full gate additionally includes the final legacy-graft assertions. There is no claimed Linux-fixture RED/GREEN execution; only its local syntax/lint validation and the executed fail-closed/real-policy-call-chain tests are evidence here.

### Complete verification after review fixes

- `npm run predeploy:verify` ran **once, uninterrupted, exit 0**. Log `/private/tmp/task6-review-predeploy.log`. It passed all 956 Node tests discovered (946 pass, 10 existing skips, zero failures), 13 Python tests, all existing combined deploy/source/lock/bootstrap/predeploy-contract suites, all original combined release/rollback suites, the isolated Zaruku build and 28 Task 6 tests, Abbott contract wiring and 111 Abbott tests, public-assets security, root typecheck, full lint, the combined build, and preview-builder Python 7 + shell tests. Unlike the original implementation's historical run, no resume or failed stage was necessary.
- `node --test scripts/runtime-artifact-policy.test.mjs` — **144/144**, zero failures/skips; `/private/tmp/task6-review-policy.log`.
- `npm --workspace apps/zaruku run verify:artifact && npm --workspace apps/zaruku run verify:boot && npm run typecheck && npx tsc --noEmit -p apps/zaruku/tsconfig.json && git diff --check` — exit 0. The executed Task 5 loopback boot ran under this host's unprivileged local user, with the explicit external authority path; it is distinct from the unexecuted Linux service-account fixture.
- Focused ESLint on `scripts/deploy-runtime.mjs`, `scripts/runtime-release-remote.mjs`, `scripts/deploy-zaruku.test.mjs`, and `scripts/boot-zaruku-service.linux.test.mjs` — exit 0. Full lint retained the same 12 unrelated warnings, zero errors.
- `node --check scripts/boot-zaruku-service.linux.test.mjs`, `npm ci --offline --dry-run --ignore-scripts`, `bash -n scripts/deploy-zaruku.sh scripts/deploy-runtime.sh scripts/rollback-zaruku.sh scripts/deploy-zaruku.test.sh`, and `git diff --check` — exit 0. No dependency or lockfile change.

Review-fix files are limited to `scripts/deploy-runtime.mjs`, `scripts/deploy-runtime.sh`, `scripts/runtime-release-remote.mjs`, `scripts/deploy-zaruku.test.mjs`, the new `scripts/boot-zaruku-service.linux.test.mjs`, and this report. No combined guard, application, collector, data-plane, schema, dependency or operational state was changed. The scoped renderer/launcher redaction evidence above remains covered by the green 28-case suite; the new boot env has exactly three non-secret fixed keys.

Self-review rechecked the real policy → fixed setpriv/bootstrap → kernel attestation → policy call chain, the Git helper used by every authoritative command, and both rollback rename failure positions. Privileged inspection never loads packaged application code, and candidate code cannot replace control authority before activation. No environment override was introduced for testability. Independent parent review remains pending; Linux account/permission/mechanism execution is the explicit outstanding integration concern, not a performed deployment.

Done: all three Important review fixes and locally executable gates. Accepted: pending independent parent review. Reusable learning: none captured before acceptance. Skill action: receiving-code-review, strict TDD and verification-before-completion informed reproduction, separate evidence and fail-closed checks; no durable skill edit. Evidence: RED/GREEN and exact commands above. Budget stop: none.
