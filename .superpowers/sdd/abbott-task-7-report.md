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
