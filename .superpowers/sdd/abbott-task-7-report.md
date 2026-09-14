# Abbott Task 7: fixed deployment authority and exact routing

Status: implemented, committed and locally verified; no production operation performed.

Implementation commit: `48fd737` (`feat(abbott): add isolated release authority`).
Starting HEAD: `bdbca99`. Working branch remains `codex/abbott-runtime-isolation`.

## Reference correction and scope

The brief initially named `13bbed5` as the installer reference. Read-only Git inspection proved that revision contains the artifact-policy work and no installer. The parent approved the corrected release lineage: `3f275e1`, `db576a2`, `0c987dc`, `620bc68`, `fe70b12`, `9fe34d8`, `66515b1`, ending at exact reference `af1948c`. The latter's installer/launcher/worker were read as the implementation reference. The Zaruku shadow-freeze and staged-dispatcher subsystem was deliberately not imported, as explicitly approved by the parent.

The generic mechanics now receive their runtime profile from the sole registered compiled authority, Abbott. The fixed wrappers reject all positional arguments and neither forward authority nor accept environment substitutions. Exact values are `release/abbott`, `dashboard-abbott`, `127.0.0.1:3004`, `/var/www/dashboard-abbott`, `/var/www/.dashboard-abbott-deploy.lock`, and `/_next-abbott`.

The local release gate requires a clean checkout on the exact release branch, an exact match to the literal repository's remote release ref, and ancestry from the approved baseline and active runtime. Git hooks/config injection and caller authority overrides are rejected or isolated. Build subprocess environments are freshly constructed. The transport snapshots its reviewed worker/profile before the clean-source recheck; artifact files and control files are separately snapshotted, digest-bound and rechecked before activation.

The worker retains exclusive owned locking, protected control records and manifests, root-owned immutable files, a dedicated unprivileged service account, capability/group-cleared isolated boot, PID/start-time/listener ownership checks, attested predecessor rollback, and bounded boot cleanup. It only starts/reloads `dashboard-abbott`; it does not run global `pm2 save`, manipulate another runtime, edit Nginx, or perform proxy cutover. Failed staging/recovery material is preserved for operator review rather than deleting potentially useful evidence.

The `.env` overlay is generated solely from the fixed dedicated host credential file. During staged artifact verification it is parked under protected control storage and restored in `finally` after its digest is checked. Thus the unchanged Task 6 sealed-artifact policy never sees runtime credentials, and isolated boot receives no database credentials. After activation, direct health must attest Abbott and a connected canonical database.

The launcher allows explicit general DB/MySQL aliases, five private DB keys, five embed DB keys, auth/base URL/Puppeteer keys, and the corrected `ABBOTT_DASHBOARD_EMBED_KEY`. Unknown keys and source OAuth tokens in the runtime file are rejected. Inherited values are cleared before requiring only `/var/www/dashboard-abbott/apps/abbott/server.js`.

The Nginx fragment has twelve exact page/API aliases and one `^~ /_next-abbott/` prefix. All point to 3004. There is no public Abbott health route, broad dashboard matcher, auth/admin route, or other-dashboard route. The validator also rejects extra directives, includes, rewrites, duplicate blocks and extra proxy directives.

Approved supporting additions beyond the brief's initial file list: the generic remote worker, fixed `environment.json`, the narrow ESLint generated/scratch ignores and their regression test, and one stale middleware build-command assertion. No application runtime/UI, collector, data, schema, or other-dashboard implementation changed. `package-lock.json` required no change because no dependency changed.

## RED/GREEN evidence

1. Initial deployment/route tests: **0/8 passed**, expected assertions for missing authority, wrappers, launcher, config, installer and validator. An additional remote-worker test failed for the missing worker. After implementation the focused tests passed.
2. The integrated app suite initially had **66/67 passed**: the older middleware test expected only `next build --webpack`, although Task 6 already added the prepare/stamp commands. Parent-approved correction now asserts all three exact commands separately; **67/67 passed**.
3. Credential-overlay regression: two transaction tests failed with `sealed artifact verification must never include runtime secrets` (`true !== false`). The protected parking/restoration boundary fixed them; immutable install and rollback recovery passed. A subsequent real 2,883-file Abbott payload test passed the actual unchanged artifact policy during fixture installation.
4. ESLint config regression failed because generated Abbott output was not ignored. The only added patterns are `apps/*/.next-*/**` and `.superpowers/**`. The test now passes and also proves deliberately invalid Abbott source still receives the expected error, while app tests, deploy scripts and launcher remain linted.

## Final verification

- `npm run test:abbott-runtime`: **PASS**, rebuilt the isolated workspace, **67 app/contract tests + 222 authority/artifact/lint/route tests**, zero failures. Validator output: `12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004`.
- Final focused rerun after the transport snapshot/rollback recheck self-review: **15/15 PASS**, including real artifact materialization and recovery fixtures.
- `npm run verify:boot --workspace dashboard-abbott`: **PASS**, standalone loopback boot/health; owned child was terminated and reaped by the verifier.
- Local `preparePayload` smoke: **PASS**, scope Abbott, 2,883 files and 247 protected control/package-authority files; no transport was invoked.
- `npm run typecheck` and `npx tsc --noEmit -p apps/abbott/tsconfig.json`: **PASS**.
- Full `npm run lint`: **PASS**, zero errors, ten existing source warnings. Initial pre-fix lint scanned generated output/scratch and produced 865 errors and 16,286 warnings; those source warnings were not suppressed or edited. Final scoped lint on changed controls/tests: **PASS**, no diagnostics.
- `bash -n` for all three new shell scripts: **PASS**.
- `node --check` for local/remote installer and both CommonJS launch configs: **PASS**. JSON profiles and PM2 exports parsed in authority tests. `git diff --check` and staged diff check: **PASS**.
- No local Nginx executable is installed. The exact-fragment parser and negative routing suite passed; a real server-level `nginx -t` remains a later authorized host check.
- Full unrelated `ci:verify` was not run. Its existing gates were preserved, and the Abbott suite was added rather than replacing any gate.

## Exact local-only operation boundary

The tool execution record contains local Git reads/diffs/status/add/commit, local file reads and `apply_patch`, executable-mode setting on the three new local wrappers, Node/npm tests/build/typechecks/lint, shell/Node syntax checks, and a read-only lookup for a local Nginx binary.

**No `ssh`, `scp`, `rsync`, remote Git fetch/ls-remote/push, PM2 command, Nginx command/reload, system service command, production HTTP request, credential installation, database query/migration, collector command, cron change, Telegram send, or Hermes schedule was executed.** Those names exist only as reviewed future code, not tool invocations in this task. The only wrapper executions supplied an invalid argument and were rejected before the installer. Valid deploy/rollback commands were never run. The deploy module was imported through its non-CLI interface for pure validation and local payload preparation only.

Transaction tests execute the actual worker in a VM whose filesystem maps every absolute path to a task-owned temporary directory. Real subprocess, network and server operations are unavailable there and throw if attempted. PM2/health/account operations are explicit fixtures. The real artifact fixture validates bytes with the existing policy but never starts an actual privileged process. All fixture directories are removed in `finally`; no temporary browser or background service was created. Local boot's owned child completed cleanup.

The release branch was not created, pushed or checked out. Nginx was not modified on any host. No production state or another runtime's directory, lock, listener or PM2 process was inspected or changed. Actual Linux UID/GID/capability and PM2 execution remains to be verified during a later authorized rollout, with a dedicated service account and credential file installed by the owner.

## Self-review and closure

Reviewed exact profile values, argument/environment boundaries, import-only test safety, artifact/control separation, source/ref checks, privileged verification path, credential overlay restoration, process ownership, failed rollback recovery, Nginx routes, CI preservation and the staged diff. No tracked prior report was overwritten.

- Done: Task 7 local code/config/tests complete and committed.
- Accepted: implementation acceptance by the parent/reviewer remains pending; design and the narrowly expanded test/config scope were approved.
- Reusable learning: a host runtime `.env` is not part of the sealed artifact and must be absent during artifact verification and isolated boot.
- Skill action: TDD and verification-before-completion used; no accepted-work skill update because independent acceptance is not yet present.
- Evidence: implementation commit, RED/GREEN results and exact commands above.
- Budget stop: none.

## Review revision: Git configuration authority and pre-listener ownership

The parent review identified two Important blockers in the initial implementation. Both were reproduced and fixed locally, without replacing any earlier report evidence.

### Fixed Git authority

The previous `ls-remote` ran with `-C` pointing at the caller checkout, which allowed its repository-local `url.*.insteadOf` rules to replace the otherwise literal repository URL. Remote approval now creates a private task-owned temporary directory under the canonical OS temporary root, verifies its ownership/mode/canonical path, and confirms Git cannot discover any repository from that cwd before running the literal URL/ref lookup. Both commands use a constructed environment with system/global configuration disabled; no caller Git directory, worktree, ceiling, prefix, SSH or config-injection variables are passed. The temporary cwd is removed in `finally`. Errors reveal neither remote URLs nor config values.

Local source checks use a separate runner limited to status/branch/rev-parse/merge-base. It validates the canonical checkout, `.git` directory or linked-worktree marker and backlink, and Git's reported worktree/git-dir. It then supplies those verified exact paths explicitly. This runner rejects URL operations. The actual linked worktree was also checked: its identity passed, and the dirty source was rejected before any approval or network operation.

RED: `node --test --test-name-pattern='remote Git approval' scripts/deploy-abbott.test.mjs` failed with `Missing expected exception`: the old approval code returned the fixture bare repository's SHA through a real local `insteadOf` rule. GREEN: the same test passed after isolation; it verifies the fixture redirect remains effective in the caller checkout while the approval lookup rejects the nonexistent literal authority, receives only constructed Git environment settings, and leaves no temporary cwd. A separate test verifies local worktree redirection through `core.worktree` is rejected and the local runner cannot perform `ls-remote`.

### Process ownership before listener readiness

Process identity capture no longer queries sockets. Immediately after start/reload it records the exact PM2 app/ID, kernel PID/start time/boot ID, runtime UID/GID, active cwd, fixed launcher command metadata and active release SHA. The candidate is assigned to `ownedProcess` before entering readiness. Listener ownership is checked separately, inside bounded health retries, and the same process proof is checked before and after readiness.

Recovery verifies and stops only that owned process without requiring a listener. It verifies shutdown, restores the sealed predecessor and its process, and checks the restored release identity. An already absent or confirmed-stopped registration does not trigger a stop against a potentially reassigned old PM2 ID. When ownership is ambiguous, the code continues to refuse an unproven stop. Recovery fixtures assert APP metadata and CURRENT agree and that subsequent inspection and rollback work.

RED: all three deterministic VM scenarios (`delayed`, `timeout`, and failure before listener) initially failed with `runtime activation and predecessor restoration failed; ownership requires review`. GREEN: delayed startup now succeeds on the second fixture readiness check; timeout and pre-listener failure stop only candidate PM2 ID 13 and restore the previous release. A fourth scenario reproduced the already-exited candidate failure and now restores safely without sending a stale-ID stop. All four subsequently inspect and roll back successfully, and their owned locks are removed.

Self-review found that pinned Next 16.1.6 sets `process.title` in `node_modules/next/dist/server/lib/start-server.js:182`, changing Linux argv memory. The first launcher-proof approach therefore received an additional failing regression. The fix validates PM2's exact retained executable/cwd/argument metadata and kernel identity instead of depending on mutable argv. The final test accepts the normal Next title change, rejects a different launcher, and separately rejects absent, foreign-PID, wildcard and duplicate listeners.

### Revision verification and operation boundary

- Focused authority/integration/Nginx/lint-config run: **22/22 PASS**.
- Final complete authority/integration/Nginx/artifact command: `node --test scripts/deploy-abbott.test.mjs scripts/verify-abbott-nginx-routes.test.mjs scripts/lint-runtime-config.test.mjs scripts/assert-abbott-artifact.test.mjs scripts/runtime-artifact-policy.test.mjs` — **229/229 PASS**, zero failures, including actual sealed Abbott payload materialization.
- `npm run typecheck` and `npx tsc --noEmit -p apps/abbott/tsconfig.json`: **PASS**.
- Full `npm run lint`: **PASS**, zero errors and the same ten existing source warnings.
- All three shell scripts pass `bash -n`; both installer modules and both CommonJS configurations pass `node --check`; JSON/PM2 parse assertions remain green. Exact Nginx validator reports the unchanged twelve exact routes, one asset prefix and 3004 upstream. `git diff --check`: **PASS**.
- This revision did not rebuild or deploy an application; it reused the existing verified artifact for relevant fixture tests. No app runtime, UI, database, collector, deployment profile or Nginx route changed.
- **No production or network operation ran.** The new Git regression executes `init`, object/ref creation, config setup, and `ls-remote` only inside task-owned temporary fixtures using local file transport. It creates no release branch in the project or on a remote. The actual project check performs only read-only local Git identity/status commands. No SSH, remote fetch/approval, push, PM2, production HTTP, service restart, Nginx reload, secret installation, database command or schedule ran. Fixture/config values were not printed. Every Git and transaction temporary directory was cleaned in `finally`; no browser or background service was created.
- Self-review covered URL-resolution isolation, linked-worktree identity, retained launcher metadata versus process title, proof assignment ordering, listener/health retry ownership, candidate shutdown, APP/CURRENT restoration, and tests using real worker code with isolated filesystem/platform fixtures. Actual PM2/Linux-host behavior remains a later authorized rollout check.

Closure: Done — both review blockers fixed and locally verified. Accepted — parent review pending. Reusable learning — repository-local Git URL rules survive disabled global/system config, and runtime identity must be established independently of socket readiness. Skill action — TDD and verification-before-completion; no acceptance-learning update. Evidence — RED/GREEN and final checks above. Budget stop — none.

## Review revision: retained PM2 registrations after candidate exit

The additional Important recovery finding was reproduced: a proven candidate could exit while PM2 retained its registration with PID zero and an errored or restart-pending state. Live-process capture correctly failed, but recovery also depended on live-process capture and therefore could not cancel that owned registration before restoring APP.

The process proof now includes an independently captured durable registration: exact app name, PM2 ID, executable, cwd, copied argument array, raw PM2 UID/GID identity, immutable release ID and source SHA. The worker supplies the two non-secret release metadata values to PM2 only from the protected record for that exact control directory. Its command environment remains freshly constructed; caller environment cannot supply those values. The launcher still clears inherited PM2 metadata before loading the allowlisted runtime environment. Candidate and restored-predecessor proofs must match their sealed release ID as well as source SHA.

Recovery looks up the registration by both the proven PM2 ID and fixed app name, so a renamed or reassigned ID cannot be mistaken for absence. All durable fields must match the original captured copy. If a PID exists, the original live-PID/kernel start-time/boot/UID/GID/cwd checks remain mandatory. If PID is zero in `errored`, `waiting restart`, `launching`, `stopping` or `stopped`, the registration is treated as retained ownership, not an absent process. The only mutation is `pm2 stop` for the proven ID when needed to cancel its restart. Recovery then verifies the same registration is stopped or absent and verifies the Abbott listener is absent before restoring/restarting the predecessor. Unknown state or any ownership-field difference fails closed without stopping or replacing that registration.

RED: `node --test --test-name-pattern='recovery handles .*PM2 registration' scripts/deploy-abbott.test.mjs` produced three failures for retained `errored`, `waiting restart` and `launching` rows. Each failed with `runtime activation and predecessor restoration failed; ownership requires review`. The pre-existing mismatch refusal remained green.

GREEN: the same retained-state scenarios now cancel only PM2 ID 13, verify the registration/listener shutdown, restore APP/CURRENT to the sealed predecessor, and successfully inspect and roll back again. The VM stop fixture retains a PID-zero `stopped` registration to exercise that verification branch; the other recovery fixtures exercise actual absence. Nine negative scenarios alter the PM2 ID, name, exec, cwd, args, UID, GID, release ID or source SHA and prove no stop or predecessor replacement is attempted. Those ambiguous mismatches intentionally remain for operator review rather than risking an unowned process. Argument arrays are copied when ownership is captured, so later PM2 metadata mutation cannot mutate the original proof.

Final checks:

- Focused authority/integration/Nginx/lint-config suite: **34/34 PASS**.
- Complete authority/integration/Nginx/artifact suite: **241/241 PASS**, including real sealed payload materialization and all retained-registration fixtures.
- `npm run test:abbott-runtime`: **PASS**, rebuilt Abbott and passed **67 app/contract tests plus 241 control/artifact tests**; exact Nginx validator remains twelve exact routes, one asset prefix, upstream 3004.
- Root and Abbott typechecks: **PASS**. Full `npm run lint`: **PASS**, zero errors and the same ten existing warnings. All three shell scripts pass syntax checks; local/remote installers and both CommonJS configs parse; exact JSON/PM2 authority assertions and `git diff --check` pass.
- No production/network deployment action or PM2 daemon was run. The project has no local PM2 package; no installation or background service was started to obtain one. PM2 state transitions were tested through the deterministic VM platform fixture, with filesystem writes confined to test-owned temporary directories and cleanup in `finally`. The full package command performed only a local build and tests. No runtime credentials, routes, app/UI code, collector, database, source API, server file or other dashboard changed.

Self-review covered protected-record metadata propagation, complete durable-field comparisons, no aliasing of captured arguments, lookup of renamed/reassigned registrations, preservation of live PID proofs, cancellation of retained restart state, stopped/absent verification, listener absence before predecessor restoration, and refusal to act on mismatches. Actual PM2/Linux integration remains a later authorized host verification; this report does not claim it was exercised.

Closure: Done — retained-registration recovery fixed and locally verified. Accepted — parent review pending. Reusable learning — process exit and supervisor-registration removal are different events; recovery must own and cancel restart state separately. Skill action — TDD and verification-before-completion, no acceptance-learning update. Evidence — RED/GREEN and final checks above. Budget stop — none.
