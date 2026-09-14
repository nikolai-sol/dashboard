# Abbott Task 9 — local gates and bootstrap review checkpoint

Status: DONE_WITH_CONCERNS for the explicitly requested bootstrap code checkpoint.
Task 9 production release/cutover is not complete. Bootstrap has not been executed.

## Scope and authorization

Started from clean `codex/abbott-runtime-isolation` at `ec9e64996fda4e5b20ee673d11da0b337a3563ef`.
Read the complete Task 9 brief, operator runbook and Playwright skill; verified
`npx` and Python availability. Debugging/TDD guided the local gate fix and the
bootstrap regression fixtures; verification-before-completion governed the final
checks. No live browser was needed because deployment gates stopped first.

The parent authorized a local pre-production gate fix, then a fixed bootstrap
implementation with an explicit STOP for dedicated review before execution.
The corrected permissions instruction preserves the reviewed worker's root-only
secret input. The Nginx mismatch requires a later, separately reviewed fix and was
not implemented here.

## Completed local gate and source-authority fix

Commit `120d3ab` fixes the mismatch between the feature-worktree runbook and the
deployer's previous local `release/abbott` branch-name requirement. Local branch
name is no longer authority. The exact worktree/Git-directory identity, clean
source, literal remote release ref, exact approved SHA, ancestry, sealed source
metadata and artifact hashes remain required. Missing approved SHA now also
fails closed inside `verifySource`.

RED: the feature-branch regression failed with `Runtime source must use the fixed
release branch`. GREEN: the same feature SHA passes; dirty source, different SHA,
missing approval, wrong ref and missing predecessor fail. Real temporary Git
repositories verify effective local URL redirection is ignored by the isolated
remote lookup; missing remote ref fails, and redirected local worktree identity
fails. All fixtures are local and cleaned.

Initial complete gate at the reviewed starting commit:

| Gate | Result |
| --- | --- |
| `npm ci` | Exit 0; audit reported 35 existing vulnerabilities (4 low, 8 moderate, 22 high, 1 critical); no audit fix applied |
| Comparator/capture tests | 34/34 pass |
| Abbott runtime app/contract tests | 67/67 pass |
| Deployment, Nginx and artifact tests | 245/245 pass |
| Abbott data/UI/privacy contract | 111/111 pass |
| Contract wiring and public-asset checks | Exit 0 |
| Lint | Exit 0, 0 errors, 10 existing warnings |
| Root typecheck and Abbott build | Exit 0 |
| Explicit artifact verification | 2,870 files / 82 text files; scan and trusted artifact pass |
| Exact Nginx fragment validator | 12 exact routes, 1 asset prefix, upstream 127.0.0.1:3004 |
| Full branch whitespace/scope review | `git diff --check` pass; Abbott runtime/loader/authority/tooling/docs scope |

After the authority fix, the full runtime gate, deployment source guard, runtime
normalization/production validation guards, lint, root/Abbott typechecks, build
and artifact checks passed. An attempted app-workspace `typecheck` npm command
reported no such package script; the actual app check was then run successfully
as `npx tsc --noEmit -p apps/abbott/tsconfig.json`.

## Read-only production evidence (2026-09-15)

The established `beget` alias resolves to root at `5.35.85.218`; authenticated host
name is `ybjqbzojln`. `nginx -t` passes. No credential file contents were printed,
transferred, or saved. Only metadata and sanitized process/routing facts were
inspected. PM2's existing daemon was verified before a read-only API list; it was
disconnected afterward. No `pm2 jlist` command or raw environment dump was used.

| Neighbor | PM2 ID | PID | Active identity |
| --- | --- | --- | --- |
| dashboard-next | 1 | 3722244 | cwd `/var/www/dashboard`; source `8f389a28df1c4b741ec33b7538f0354b74f5a40e` |
| dashboard-zaruku | 2 | 791065 | cwd `/var/www/dashboard-zaruku/apps/zaruku`; root source `af1948c8b9a0f70d8696afb9c8abc254408a5daa` |
| dashboard-medroche | 4 | 1870897 | declared cwd `/var/www/dashboard-medroche/apps/site-seo`; active immutable root `/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone` |

All three were online. Two consecutive read-only snapshots matched for PM2
IDs/PIDs/cwds and available release metadata. The Nginx hash also matched across
the snapshots. No neighbor process/release pointer was changed by this task.

The combined source directory and `.release-source-sha` are UID 501/GID 0,
mode 0755 and 0644 respectively. `/var/www/dashboard/.env` is a regular,
single-link, UID 501/GID 0, mode-0600 file, 2,933 bytes. The exact source PID proof
is start time `122353749`, kernel boot ID `1c736efb-eaa2-42d9-b247-bd1a2ef36a4e`,
and cwd `/var/www/dashboard`.

Preflight blockers:

1. Dedicated `dashboard-abbott` account is absent.
2. `/var/www/.dashboard-abbott-secrets/runtime.env` is absent.
3. `/var/www/dashboard-abbott` and its independent current control record are
   absent, consistent with a first deployment.
4. The live Nginx server-name list includes the primary domain plus three aliases
   in both HTTP and HTTPS blocks. The runbook's literal single-name needle cannot
   match it. No Abbott cutover markers exist. Config SHA-256 is
   `1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.

## Bootstrap code checkpoint (not executed)

Added `scripts/bootstrap-abbott-host.mjs` and its temp-fixture tests, wired into
the existing Abbott runtime test command, plus the explicit review checkpoint in
the runbook.

- Fixed host, source path, UID/GID/modes, source release SHA and live kernel process
  proof; zero caller arguments and empty inherited environment required.
- No source-file sourcing/eval. Bounded strict UTF-8 parsing accepts ordinary
  quoted/unquoted dotenv assignments, rejects duplicate/malformed/control/quote
  or backslash/backtick injection, and copies only the reviewed input allowlist.
- Source OAuth/unrelated settings never enter the output. Existing general DB,
  private/embed DB and auth/embed values are preserved. Database names and distinct
  private/embed users are checked; live grants remain a later gate.
- Only the fixed system group/account can be created: `dashboard-abbott`, primary
  dedicated group only, `/nonexistent` home field, no home creation, nologin shell.
  Wrong existing identities are rejected rather than repaired.
- Target input remains root:root directory 0700 and file 0600. Existing content
  must exactly match; bootstrap never overwrites or rotates it, nor repairs wrong
  ownership/mode. Fixed runtime values are left to the unchanged worker renderer,
  which creates root:dashboard-abbott app `.env` mode 0640.
- New input publication uses a retained directory descriptor, exclusive temporary
  file, fsync and atomic no-clobber link. Cleanup removes only a temporary file
  successfully created by this invocation. Prior/competing targets remain intact.
- Output is a fixed created/unchanged/refused status, including injected errors
  containing a secret canary. Source values never appear in commands or output.
- A group/account may remain if a later bootstrap operation fails; rerun is
  idempotent after the failure is resolved. No account deletion is attempted.

TDD evidence: initial scaffold failed the positive parser/bootstrap/idempotence
assertions. The implemented suite passed. Self-review added an exclusive-open
collision regression; it reproduced removal of a never-owned temporary path,
then passed after ownership assignment moved after successful exclusive open.
An additional RED/GREEN regression prevents the dedicated service user from
reusing UID 501, which owns the combined source. The final focused suite has 11
passing tests, including production-adapter command
fixtures, source/target symlinks and hardlinks, wrong identities, fixed renderer
values, prior-file preservation and fixed diagnostic output. A test variable named
`module` triggered Next's lint rule and was renamed to `moduleSource`.

Final checkpoint verification: 67 app/runtime tests and the earlier full build
passed; the final combined bootstrap/deployment/Nginx/artifact suite has 256
passing tests with zero failures. Full lint passed with the same 10 pre-existing
warnings and zero errors. Root and Abbott TypeScript checks, Node syntax check,
and `git diff --check` passed. No production bootstrap command was run.

## Deployment and acceptance gates not reached

| Required evidence | Status |
| --- | --- |
| Pushed refs | None; read-only remote-ref check showed neither feature nor release/abbott ref |
| Deployed Abbott SHA/release ID | None |
| Shadow listener/health | Not started; not tested |
| Live manager/embed/Excel/PDF/admin-control parity | Not run |
| Live DB-role/grants verification | Not run |
| Baseline/candidate screenshot dimensions and diff | Not run; no candidate directory created |
| Nginx backup identifier | None; no config write or reload |
| Post-cutover Abbott/neighbor smoke | Not run; no cutover |
| Application rollback predecessor | None; no isolated Abbott release exists |
| Route rollback target | Existing combined runtime at 127.0.0.1:3001; no rollback needed or executed |
| Browser/tunnel cleanup | No live browser session, Chromium PID, SSH tunnel, or temporary service created |

No production bootstrap, push, deploy, PM2 mutation, Nginx edit/reload, database
migration/query/write, collector/cron change, canonical release/fact write,
administrator-ID mutation, password rotation, shared login/admin change or message
send occurred. All SSH subprocesses returned and fixture resources were cleaned.

Remaining concerns: dedicated bootstrap review and execution; separately reviewed
Nginx TLS-block selection/hash-drift fix; all later deployment/parity/visual/smoke
gates; the already accepted Task 6 Minor about broader direct Python stamp-helper
inputs remains unchanged for final branch review.

Closure: Done — local authority fix and bootstrap code checkpoint only. Accepted —
not yet; dedicated review is pending. Reusable learning — first-runtime bootstrap
must conform to the existing sealed secret-input contract and verified active
source identity. Skill action — debugging, TDD and verification; no accepted-work
learning update. Evidence — local RED/GREEN checks and read-only metadata above.
Budget stop — none; paused at the explicitly required review boundary.
