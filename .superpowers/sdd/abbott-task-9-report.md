# Abbott Task 9 — shadow deployment and token-tooling review checkpoint

Status: DONE_WITH_CONCERNS at the requested stdin-token tooling review checkpoint.
Reviewed bootstrap and shadow deployment succeeded. Public routing is unchanged;
live parity, six-image comparison and cutover are not complete. Earlier sections
are chronological checkpoint history, superseded by the final execution section
where they state that bootstrap/deploy had not occurred.

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

## Bootstrap review revision: credential semantics and kernel owner proof

This revision addresses the two Important review findings. It still stops before
bootstrap execution, push, deployment or cutover.

### Credential interpretation

The old parser retained an unquoted hash and literal interpolation text, whereas
the active Next parser treats an unquoted hash as a comment and expands variables
even in single-quoted values. Four focused RED tests reproduced missing parser
comparison, acceptance of unknown/cyclic references, acceptance of effective-value
disagreement, and missing process owner validation.

The strict parser now applies matching unquoted-hash semantics and resolves only
present allowlisted `$KEY`/`${KEY}` references through a bounded acyclic graph.
Missing keys, ambient references, source/unrelated-key dependencies, self/multi-key
cycles, defaults/unsupported constructs, duplicate selected keys, malformed values,
multiline/control/NUL/quote/backslash/backtick values and oversized expanded output
fail before account or credential mutation. The combined source may legitimately
contain unrelated/source OAuth settings; the parent clarified that these must be
filtered rather than causing whole-file rejection. The target input still rejects
every unapproved/source key and is never repaired or replaced.

Every selected result must equal the effective result from the exact installed
active `@next/env`, version `16.1.6`, SHA-256
`44e84a28e712bca30781e892e3e64d3aecdc46bef9d23b5b7f39bfa1fcef6baa`.
The active parser and package are fixed-path, regular, single-link, UID 501/GID 0,
mode-0644 files; canonical identity and pinned code hash/version are checked.
Only the verified effective values are serialized into the worker's strict format.

The parser executes in a synchronous, fresh child with no inherited environment,
a 64-MiB V8 heap limit, a 3-second deadline and 128-KiB captured output bound.
Inside that child the pinned parser uses a private VM `process.env` and two
750-ms execution limits; the parent/child ambient environments remain untouched.
Unneeded filesystem/crypto/OS interfaces inside the parser VM are unavailable.
Only stdin/stdout pipes carry values, and the parent captures them in memory.
The exact parser code is hash-checked both before transport and inside the child.
Subprocess success/failure is synchronously reaped; no background parser survives.

Regressions compare synthetic quoted/unquoted references, forward references,
and unquoted hash comments against installed `@next/env`; they prove identical
bytes or refusal. They also prove isolation from an ambient canary, no ambient
mutation, bounded child options, pinned-parser rejection, effective-value mismatch
refusal, unknown target-key rejection, and no writes/account commands during the
read-only source proof.

### Kernel owner and ancestry proof

Read-only kernel metadata for PID 3722244 confirms both UID and GID fields are
`[0,0,0,0]`, with unchanged boot ID, start time and cwd. These real/effective/saved/
filesystem identities are now pinned in `HOST` and checked before account lookups
or secret mutation. UID and GID drift regressions prove zero commands, zero writes,
and unchanged prior credential bytes.

The first end-to-end read-only proof exposed a previous unverified assumption:
`/var/www` is root:root mode `0751`, whereas `/` and `/var` are mode `0755`.
A regression reproduced refusal of the observed mode; bootstrap now pins `0751`
and rejects drift. No host permissions were changed.

### Actual production file proof

After those checks, the read-only gate against the active source file and exact
active parser returned only:

```json
{"status":"verified","allowlistedKeyCount":23}
```

All 23 selected effective values matched byte-for-byte. No source keys, values,
cookies, tokens, passwords or serialized credentials were printed, transported to
the local host, or written to files. The earlier coarse `NEEDS_CONTEXT` categories
were resolved by the clarified filtering rule and verified ancestry metadata.
No production bootstrap/account/credential write occurred.

### Final revision verification and remaining boundary

Focused bootstrap suite: 18 tests, zero failures. Full Abbott gate: build passes,
67 app/runtime tests and 263 bootstrap/authority/Nginx/artifact tests pass. Root
and Abbott typechecks, full lint, syntax, explicit artifact verification and diff
checks pass; lint retains only the ten existing warnings. No production mutation,
push, deploy, browser session, Nginx edit/reload or database operation occurred.
Dedicated bootstrap re-review and the separate Nginx fix remain required.

## Narrow bootstrap review revision: exact serialized byte limit

The previous character-count and parser-equality checks did not guarantee that
the final UTF-8 credential input fit the unchanged worker's 65,536-byte limit.
A multibyte value referenced by another allowlisted value could pass both checks
and exceed the worker limit after expansion, quoting and newlines.

Added one shared strict serializer that builds the exact `desired` UTF-8 Buffer
and rejects `desired.length > 65536`. Bootstrap calls it before any account/group
lookup or creation, directory creation or publication. The read-only source proof
uses that same serializer and byte check. The final newline counts toward the
limit, and temporary verification buffers are cleared. The unchanged fixed
refusal output contains no value or dynamically interpolated diagnostic.

RED evidence: synthetic multibyte plus allowlisted-expansion cases at 65,537 and
70,000 serialized bytes passed existing character limits and exact pinned Next
equality. The read-only gate wrongly accepted them; bootstrap reached six account
operations before eventual failure. The 65,536-byte boundary was already valid.

GREEN evidence: exactly 65,536 bytes, including its final newline, is accepted by
bootstrap and by the unchanged worker parser. The 65,537- and 70,000-byte cases
now return the fixed refusal and perform zero account commands or writes; the
read-only proof also refuses them. Assertions expose only counts, byte lengths
and hashes, never the synthetic values. All fixtures are cleaned.

Final verification: focused bootstrap suite 21/21 pass; complete Abbott gate
build and 67 app/runtime tests plus 266 bootstrap/authority/Nginx/artifact tests
pass. Root/Abbott typechecks, full lint, syntax, artifact verification and diff
checks pass; the same ten pre-existing lint warnings remain. No bootstrap,
production mutation, push or deployment occurred. Final checkpoint re-review is
still required before execution.

## Approved bootstrap and shadow execution — 2026-09-15 local date

The parent approved `f80607fbc8a693aa2c720b0976938e88732cdf1a` and authorized
bootstrap, the two Abbott refs, and fixed shadow deployment, but no Nginx change.
The exact reviewed bootstrap was piped to `beget` under an empty environment.
Its immediately repeated fixed host/process/source/parser proof passed, and its
only output was `Abbott host prerequisites: created`.

Post-bootstrap metadata: `dashboard-abbott` UID 982/GID 984, supplemental group
984 only, home field `/nonexistent` (absent), shell `/usr/sbin/nologin`.
`/var/www/.dashboard-abbott-secrets` is root:root `0700`, and `runtime.env` is
root:root `0600`, single-link regular file. Only existing effective allowlisted
values were copied. No secret/password was generated or rotated, and no values
were printed. Neighbors and the exact Nginx hash below stayed unchanged.

Fresh clean-tree local gate at `f80607f`: `npm ci` passed; comparator/capture
34 tests, app/runtime 67 tests, bootstrap/authority/artifact 266 tests, contract
111 tests all passed (478 total). Contract wiring, public-asset safety, root and
Abbott typechecks, full lint, explicit build/artifact, fixed Nginx fragment and
diff checks passed. Lint retains 10 existing warnings and zero errors. The
unchanged dependency audit reports 35 vulnerabilities; no audit fix was applied.

Ordinary non-force pushes published only:

- `refs/heads/codex/abbott-runtime-isolation`
- `refs/heads/release/abbott`

Both literal remote SHAs were verified as
`f80607fbc8a693aa2c720b0976938e88732cdf1a` using isolated Git authority lookup.
No other ref was pushed. The token-tooling checkpoint commit is local only.

Read-only DB checks used the existing host Python MySQL connector, not a new
package. The exact active roles match `abbott_embed_reader_role` and
`abbott_runtime_reader_role`; MySQL quotes its role representation, which was
normalized before comparison. Embed has no direct private-schema or mutation
grant and its private visit-table zero-row SELECT is denied. Manager's private
visit-table zero-row read succeeds. No SQL write, grant, migration, raw row,
password/hash, or source-key output occurred.

### Shadow release and final process evidence

Only `npm run deploy:abbott` installed and started the shadow. It returned
`Runtime release attested: f80607fbc8a693aa2c720b0976938e88732cdf1a`.

- Release ID: `6cd2f12e245a47dcbd5f6ce928c4ed83`; `previousId` is null.
- Active path: `/var/www/dashboard-abbott`; cwd: its `apps/abbott` directory.
- PM2 ID 5, PID 542693, online; kernel UID `[982,982,982,982]` and GID
  `[984,984,984,984]` match the dedicated service identity.
- Its sole kernel-attested listening socket is loopback port 3004, no public bind.
- Direct health: HTTP 200, `{"ok":true,"scope":"abbott","database":"connected"}`.
- Rendered root `.env`: root:GID984 `0640`, single-link regular file; generated
  NODE_ENV/HOSTNAME/PORT/INTERNAL_BASE_URL match the fixed worker values. No
  rendered value was printed.
- Root-only current and immutable record agree; trusted manifest digest is
  `7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f`.
  All 2,884 active files are root-owned and not group/world-writable; the active
  tree contains no symlinks.

Neighbor before/after bootstrap, after deploy, and final checks are identical:

| Process | PM2 ID | PID | Release evidence |
| --- | --- | --- | --- |
| dashboard-next | 1 | 3722244 | `/var/www/dashboard`, source `8f389a28df1c4b741ec33b7538f0354b74f5a40e` |
| dashboard-zaruku | 2 | 791065 | `/var/www/dashboard-zaruku/apps/zaruku`, root source `af1948c8b9a0f70d8696afb9c8abc254408a5daa` |
| dashboard-medroche | 4 | 1870897 | `/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone/apps/site-seo` |

The initial post-deploy metadata probe lacked HOME and attached to the already
existing `/etc/.pm2` namespace. Its daemon PID 2463804 and pid-file timestamp
2026-09-09 were verified as pre-existing, not task-owned, and preserved. Corrected
checks asserted root PM2 home and existing daemon PID 1316 before reading the
expected list. No extra PM2 daemon was created or stopped.

Nginx config remains byte-identical SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
Backup identifier: none, because no Nginx edit/test/reload or route switch was
performed in this execution. The composite TLS/HTTP server-name mismatch remains
pending its separate reviewed structural fix. Public routes stay on port 3001.

### Stdin token tooling checkpoint (local only, not used live)

The parent prohibited inspecting/using any legacy plaintext manager password and
requested a new reviewed `manager_access_token` stdin mode. No legacy password
was read and no manager token/embed credential was generated or transported for
parity. The root-only runtime input intentionally excludes manager passwords.

TDD RED: three-line frame rejected; token resolver absent; regular file-backed
stdin accepted; capture attempted login instead of checking both runtime manager
endpoints. GREEN: token framing and 65,536-byte boundary, pipe-only stdin, invalid
encoding/control/frame rejection, short expiry/version envelope, wrong audience/
dashboard/type rejection, both-port read-only authorization, redirect/server
rejection sanitization, no manager token URLs, redacted report output, capture
off-origin/redirect guard, and partial-output cleanup all pass. Existing browser
PID/signal cleanup regressions remain passing.

The consumer does not claim to verify signatures locally: each runtime verifies
the supplied signature/version on a manager-only GET before use. Browser requests
are intercepted before cookie installation, restricted to candidate loopback,
and redirects rejected. No token appears in report/index metadata. Input buffers
are cleared; JavaScript strings remain memory-only until process exit.

Live issuance must use existing `createSignedSession` code on the authorized host,
the existing signing secret and a SELECT-only current DB credential version, with
manager audience and a 600-second expiry. The exact issuer transport has not been
executed and remains a verification prerequisite after consumer review.

Fresh token checkpoint verification: comparator/capture 44 tests, app/runtime 67,
bootstrap/authority/artifact 266, contract 111 (488 total), all zero failures.
Contract wiring, public assets, root/Abbott typechecks, full lint, syntax, build,
explicit artifact verification and diff checks pass. Same 10 existing lint
warnings, zero errors. Artifact scan: 2,870 files, 82 text files.

### Remaining gates and rollback

- Data/Excel/PDF/admin-read/privacy parity: not run; paused for token review.
- Six-image candidate dimensions/diff: not run; baseline remains untouched at
  `/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14`.
  No candidate/evidence directory was created.
- Browser/tunnel cleanup: no browser or SSH forwarding session was launched.
  Foreground SSH diagnostics and deploy child completed; no temporary credential
  files were created. Abbott is the intended persistent shadow.
- Post-cutover public smoke: not applicable, no cutover. Shadow health and final
  neighbor/release/Nginx checks passed as documented above.
- Route rollback target: combined port 3001 and unchanged source
  `8f389a28df1c4b741ec33b7538f0354b74f5a40e`. No preceding isolated release exists,
  so isolated rollback cannot select a predecessor yet. Do not execute a live
  rollback or modify public routes at this checkpoint.
- Retained review Minor: Python stamp helper accepts broader direct inputs than
  its sole fixed Node caller. No production source change was made for it.

No neighbor restart/release/write, database/auth/admin mutation, source API call,
collector/cron change, shared login change, password rotation, or Nginx mutation
occurred. Bootstrap and the Abbott-only shadow deployment are the only authorized
production changes. Stop for focused token-tooling review.

## Token runbook review correction — post-cutover stdin consistency

The consumer review found one Important documentation defect: section 8 still
contained the old interactive plaintext flow, an alternate credential descriptor,
and a password-login call. Removed that workflow entirely. Its replacement
requires the same strict three-line token frame from a direct pipe on stdin,
explicitly refuses the legacy mode, and invokes the shared dual-port token
authorization/parity consumer. Errors emit one fixed category, not response or
credential details.

The issuer transport is explicitly a gated preceding step requiring review and
approval before any generation, live smoke, or cutover. No issuer placeholder
command was introduced. The runbook also preserves PDF/privacy/alias/asset
acceptance as required gates, whose exact token-safe transport must be reviewed
before route mutation; the parity consumer alone does not claim those checks.

TDD RED: the new static runbook test detected the stale password/descriptor path.
GREEN: it proves absence of plaintext workflow symbols, login calls and non-stdin
credential descriptors, plus presence of strict token mode, explicit stdin,
token-only rejection, and shared parity invocation for both exact loopback ports.
Focused docs/comparator/capture suite: 45/45 pass. Targeted tool/test lint,
root/Abbott typechecks and diff checks pass. Application/deployer code is unchanged.

This correction is local only. No token generation/use, production command,
push/deploy, Nginx action, browser/tunnel launch, or production mutation occurred
during this revision. The previously verified shadow remains the latest observed
production state; public routing remains unchanged. Stop for quick re-review.
