# Abbott Task 9 — shadow deployment and token-tooling review checkpoint

Status: DONE_WITH_CONCERNS at the requested additional smoke-tool review checkpoint.
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

## Fixed issuer and local orchestrator checkpoint — local only

The token consumer and corrected runbook were approved. The parent then requested
an exact issuer transport and local orchestrator, with a STOP before live use.
This revision implements two focused modules: `abbott-parity-issuer.mjs` and
`verify-abbott-shadow.mjs`. Neither was invoked against production.

### Authority and issuance

The orchestrator requires the exact clean isolated worktree and reciprocal Git
directory identity. It reads committed issuer/bootstrap source plus the exact
combined source blob `8f389a28:src/lib/access-auth.ts`; its SHA-256 must equal
`71fad58b4eb66b2cd5dd29b7c463043c5cc8a04d839e597a14e0d9a2fae8e64f`.
That existing implementation is transpiled in memory, not rewritten or copied
into another signing implementation. The code capsule is bounded to 262,144 bytes
and sent only on fixed SSH stdin. No code or credential control artifact is
uploaded, and no combined runtime file is updated.

SSH uses only `beget`, batch/strict-host checking, no TTY and no ControlMaster or
ControlPath reuse. The fixed remote command starts Node with an empty environment.
The issuer's read-only source helper reuses the reviewed bootstrap host, exact
source stamp, process PID/start/boot/cwd/all UID/GID values, source ownership/modes,
Next version/hash and effective-value equality proof. Both source snapshots and
serialized scratch buffers are cleared. The bootstrap mutation entrypoint is now
file-module-only, so importing it as the transported data module cannot run any
account or credential write. Normal direct bootstrap behavior remains covered.

The issuer performs one fixed SELECT through the existing host Python MySQL
connector for dashboard 18, active client Abbott, and current shared credential
version. Missing/non-positive/unsafe versions fail; no fallback, password hash
read, auth rotation, grant, or DB mutation exists. Missing/malformed DB inputs
fail before a child starts. The database child's credentials go only through
stdin, with empty environment, timeout and captured bounded outputs.

Existing `createSignedSession` runs in a bounded private VM with the existing
signing secret, manager audience, dashboard 18, authoritative credential version
and 600-second expiry. The embed key uses the same trim semantics as the existing
authorizer. The one-shot issuer refuses TTY/file-like stdout and emits only one
strict three-line UTF-8 frame, at most 65,536 bytes. One-use means one issuance
per issuer instance/process workflow, not a new server-side token revocation
mechanism; the token retains existing authentication/version semantics.

### In-memory transport and lifecycle

The local orchestrator captures issuer stdout/stderr, never inheriting or teeing
them. Any nonzero/signal result, stderr, malformed/truncated/extra frame or size
violation refuses before consumer use. The valid frame is passed directly to the
selected comparator/capture child's stdin once. Child results are accepted only
against exact safe output shapes; no raw child diagnostic reaches logs/reports.
Input/result/chunk buffers are zeroed in success and failure paths. Remaining
JavaScript strings are memory-only and die with their bounded child processes.

Each run checks that local ports are free and creates one owned foreground SSH
process, forwarding only literal local loopback 3001 and 3004. Its PID/start
identity and exact owned listener addresses are verified. Startup is bounded;
TERM/KILL cleanup checks the recorded identity and waits for exit. Signal/error
paths close forwards and clear frames; capture receives a 30-second cleanup grace
before consumer termination escalation so its reviewed browser lifecycle can
finish. No reusable master, background daemon, manual tunnel, temp credential
file, environment credential, or credential argument is used.

The runbook now exposes only `node scripts/verify-abbott-shadow.mjs compare` or
`capture` for credential-bearing workflows, including post-cutover parity.
Standalone issuer invocation and stdout redirection are explicitly forbidden.
Both commands remain gated on this checkpoint's approval. PDF/privacy/alias/asset
smoke and the Nginx structural fix remain separately required before cutover.

### Verification

TDD RED demonstrated missing issuer/orchestrator interfaces, file-backed stdout
and imported-bootstrap entrypoint hazards, stale manual runbook transport,
missing DB input refusal and embed-trim disagreement. GREEN covers one-shot
claims/version/expiry/frame, source revalidation, no ambient mutation, captured
fixed-query transport, TTY/file refusal, wrong/missing data, extra/truncated frames,
secret-looking child stdout/stderr rejection, interrupts and zeroed buffers,
actual owned-child exit and start-identity drift refusal, existing-source hash,
and orchestrator-only runbook entrypoints.

Final focused bootstrap/issuer/orchestrator/comparator/capture suite: 82 tests,
zero failures. Relevant auth/access/PDF-auth plus Abbott runtime tests: 108 pass.
Full runtime gate: build passed, 67 app/runtime tests and 268 authority/artifact
tests passed; the fixed Nginx fragment remains 12 exact routes plus one asset
prefix. Root/Abbott typechecks, syntax, targeted lint and diff checks pass. Full
lint passed with the same ten pre-existing warnings and zero errors.

All tests used synthetic local inputs and reaped their owned child processes.
No real credential was minted, no production/SSH command was run, no live browser
or parity execution occurred, and no commit was pushed or deployed in this
revision. The previous shadow/neighbor/Nginx evidence remains the latest observed
live state, not a new verification claim. Stop for focused issuer review.

## Issuer review correction — fixed signer and continuous forward ownership

Status: DONE_WITH_CONCERNS, stopped for re-review before any live credential use.
This section supersedes the previous checkpoint's VM-signing description.

The reviewer identified two Important issues: host objects injected into the
signer VM were not an isolation boundary, and the SSH forward was not monitored
through the complete issuance/consumer/cleanup lifetime. The owner subsequently
directed a simpler fixed internal signer instead of an OS signer sandbox.

The issuer now signs directly with `node:crypto` HMAC-SHA256. It accepts no
executable signing source, performs no dynamic signing-code loading/evaluation,
and has no signer child. The signing key Buffer is cleared in `finally`; existing
source/frame/output cleanup remains in place. The exact existing auth blob hash
is still checked as compatibility authority, but that blob is not transported or
executed for signing. A synthetic regression verifies byte-for-byte equality
with the real `createSignedSession`, acceptance by the real verifier, trimmed
secret semantics, the current credential version, dashboard 18, manager audience,
and the fixed 600-second expiry. The fixed read-only DB-version child is unchanged.
No runtime upgrade, OS sandbox installation, or combined-source change was needed.

The owned SSH child's exit/error (and unexpected output) now aborts a lifetime
signal. Both issuance and consuming verification race against that signal; the
orchestrator still awaits their bounded aborted cleanup, clearing late-arriving
buffers before it closes the forward. PID/start identity and both exact literal
loopback listeners are checked initially, after issuance, immediately before
credential handoff, after consumption, and before intentional tunnel shutdown.
Failure or replacement prevents handoff/success. SIGINT/SIGTERM handlers remain
installed until consumer cleanup and owned-forward exit verification finish;
signals during cleanup cannot produce a passed result. Expected exit from the
orchestrator's deliberate final shutdown is distinguished from earlier loss.

TDD RED demonstrated the former dynamic signing path and false success after
forward death/early signal-handler removal. GREEN additionally covers a pending
issuer or consumer interrupted by forward failure, waiting for their cleanup,
zeroing late buffers, immediate handoff loss, replacement refusal, real local
child start-identity/listener checks, and signals during cleanup.

Fresh verification:

- Focused bootstrap/issuer/orchestrator/comparator/capture: 88 passed (20 in the
  focused issuer/orchestrator subset), zero failures.
- Relevant real auth/access/PDF-auth and Abbott app/runtime: 108 passed.
- Full Abbott runtime gate: build passed; 67 app/runtime and 268 authority/artifact
  tests passed; unchanged Nginx fragment validation passed.
- Root and Abbott typechecks, full lint, syntax and whitespace checks passed.
  Lint retains the ten pre-existing warnings, with zero errors.

All inputs were synthetic local fixtures. Test-owned children were bounded and
reaped; no browser or SSH forward was opened. No real credential was minted or
used, no production/network command was run, and no push, deploy, Nginx edit,
reload, DB/auth write, or neighbor action occurred in this revision. Published
refs and the shadow deployment remain at `f80607f` as previously recorded; prior
PID/release/Nginx evidence was not refreshed and is not presented as fresh proof.
Public routing remains unswitched by this task; rollback target remains port
3001. Live parity, six-image comparison, and the separately reviewed structural
Nginx correction remain required. The previously recorded Python stamp-helper
Minor is unchanged. Stop for focused re-review.

## Approved operational resume and additional smoke review checkpoint

### Publication and unchanged installed application

After issuer approval, the worktree was clean at
`bb9fad507b2dbda67eaf3a46b020acf680a70f30`. Isolated Git discovery proved both
authorized remote refs were at `f80607f` and ancestors of HEAD. One ordinary
non-force push updated only `refs/heads/codex/abbott-runtime-isolation` and
`refs/heads/release/abbott`; a fresh isolated literal repository lookup confirmed
both at `bb9fad507b2dbda67eaf3a46b020acf680a70f30`.

No shadow redeploy was necessary: the entire diff from installed `f80607f` to
`bb9fad5` contains verification/bootstrap tooling and documentation, not packaged
application, launcher, runtime-contract, dependency or artifact-policy changes.
The installed release remains `6cd2f12e245a47dcbd5f6ce928c4ed83` with source
`f80607fbc8a693aa2c720b0976938e88732cdf1a` and no predecessor.

Fresh preflight verified host `ybjqbzojln`, account UID 982/GID 984,
`/nonexistent` home and `/usr/sbin/nologin`, root-only input directory/file
0700/0600, rendered app environment root:GID984 mode0640, and single-link files.
The sole port-3004 listener was `127.0.0.1:3004`, owned by PID542693; direct
Abbott/database health returned HTTP200. No credential values were output.

Neighbor PM2 pid-file/kernel identities and release paths/stamps matched before
and after the live comparison/capture attempt:

| Runtime | PM2 ID / PID | Release evidence |
| --- | --- | --- |
| dashboard-next | 1 / 3722244 | source `8f389a28df1c4b741ec33b7538f0354b74f5a40e`, cwd `/var/www/dashboard` |
| dashboard-zaruku | 2 / 791065 | source `af1948c8b9a0f70d8696afb9c8abc254408a5daa`, cwd `/var/www/dashboard-zaruku/apps/zaruku` |
| dashboard-medroche | 4 / 1870897 | immutable root `/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone` |
| dashboard-abbott | 5 / 542693 | installed isolated release/source unchanged |

Nginx config SHA-256 remained
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
No Nginx backup, insertion, test/reload or cutover occurred. Route rollback target
remains the unchanged combined runtime on port3001.

### Live results and cleanup

The approved `compare` orchestrator minted an ephemeral frame on the authorized
host, captured it only in memory, and passed it directly to the consumer. For
`2026-09-01..2026-09-13`, manager/embed JSON and HTTP Excel parity returned
`match`, mismatch count0. Both manager-only administrator-list GETs accepted the
session/current version. No administrator ID was modified. The redacted report
is mode0600 at:

`/Users/nafanya/Downloads/Abbott-dashboard-cutover-evidence-2026-09-14/abbott-runtime-parity-5d963f9c0537299abe34f5df/abbott-runtime-parity.json`

Its owned SSH PID8174 (start `Tue Sep 15 02:23:46 2026`) exited; independent
kernel existence check returned ESRCH.

The approved `capture` invocation used a fresh ephemeral frame, but exited1 with
the fixed `ABBOTT_VERIFICATION_REFUSED` diagnostic. The wrapper intentionally
did not expose raw consumer stderr, so no more specific failure cause is claimed.
No candidate PNGs/index remain; therefore six-image dimensions, pixel differences,
console counts and human visual parity are **not available / not passed**.
The existing visual baseline was not changed.

Capture cleanup removed its partial output directory. Independently checked
ESRCH for owned SSH8302 (start `Tue Sep 15 02:24:13 2026`), orchestrator8294,
consumer8336, Chromium8338 and captured child PIDs8346, 8347, 8348, 8352, 8353,
8362 and 8366. Only the successful redacted comparison directory remains in the
private evidence root. Credential buffers were cleared by the reviewed lifecycle;
credential strings remained process-memory-only until those processes exited.
No credential temp files or plaintext password workflow were used.

The visual gate is blocked. Separately, the reviewed comparison/capture tools did
not cover PDF, all aliases or explicit privacy-denial/asset acceptance; these were
not misrepresented as passed. The parent approved a local-only additional smoke
implementation and required review before any new live probe.

### Additional read-only smoke transport, not executed live

Implemented a focused `smoke` mode behind the same frame/forward lifecycle. A
read-only SSH attestation binds the exact installed release/current record and
manifest hash, repeats source proof, checks every public file and refuses
unattested additions, symlinks, owner/mode/hash drift. It returns only bounded
public paths/sizes/hashes in captured memory before credential issuance. No
manifest file or alternate credential descriptor is introduced.

The in-process consumer checks both page/JSON/PDF/Excel aliases and both audiences
on the two literal loopback origins with fixed dates, GET only and no redirects.
Manager admin reads must pass; embed admin reads must return401/403. Embed JSON
gets a recursive forbidden-identifier/private-collection scan. JSON and workbook
aliases use the existing semantic summaries. PDF validity, page count/dimensions
and normalized text digests are compared; metadata/compression byte differences
are deliberately not parity failures. Installed Poppler26.04.0 parses PDFs using
bounded pipes, captures/clears output and reaps children. No raw PDF/text is saved.

Assets have bounded per-runtime HTML inventories, status/type checks, shared-path
hash equality and candidate-manifest equality. Candidate-only split-prefix chunks
are validated against the installed manifest rather than a different local build.
The overall smoke deadline is eight minutes; rejected response bodies are
cancelled. Forward loss or signals abort requests/parser children and prevent
success. The report retains only redacted counts/digests.

TDD RED observed missing smoke/attestation interfaces, absent orchestrator mode,
unread body cleanup omission and missing Excel alias requests. GREEN covers real
synthetic PDF parsing, PDF semantic differences, both aliases/audiences, recursive
privacy, manager denial/embed acceptance failures, wrong periods/status/types,
asset/hash/manifest/source drift, unapproved paths, abort cleanup and buffer
clearing. Runbook and dashboard memory distinguish the actual partial live result
from this unexecuted local implementation. No Nginx structural fix was attempted.

New focused suite: 100 tests passed. Relevant auth/access/PDF-auth plus Abbott
app/runtime: 108 passed. Root/Abbott typechecks, full lint (same ten pre-existing
warnings, zero errors), targeted lint, syntax and whitespace checks passed.
Fresh full runtime build passed, with 67 app/runtime and 268 authority/artifact
tests passing; the unchanged exact Nginx fragment validation also passed. Earlier
pre-publication supplemental gates passed 111 Abbott contract tests, contract
wiring, public-asset scan and explicit artifact verification (2,870 files,
82 text files). Those operations did not deploy or change Nginx.

STOP for additional smoke-tool review. This revision is not pushed/deployed; no
new live smoke/PDF/asset probe or token mint occurred during implementation.
Visual failure still requires a separate safe diagnosis and passing retry before
Nginx work or cutover. No DB/fact/auth/admin write, migration, credential rotation,
collector/cron change or neighbor restart/release occurred.

### Smoke review corrections — local-only checkpoint, 2026-09-15

The real public loader serializes `dashboard.type`, period and Abbott-specific
schema, but not the internal `dashboard_id` metadata. Removed the invented
`dashboard.id === 18` smoke requirement. The fixture now mirrors the public
loader shape, including its KPI and dashboard fields. Identity remains bound to
the two fixed exact aliases, reviewed audience authorization and existing strict
Abbott schema/period validation. Regressions reject foreign dashboard type,
missing Abbott collections and malformed time buckets even when both origins
return the same invalid payload.

Every recursively encountered `session_journeys` (including normalized camel
case) must now be a non-null, non-array object with its own empty `rows` array.
Null, arrays, missing/inherited rows, scalar values, malformed rows and nonempty
rows refuse with the fixed safe category. Aggregate metadata alongside an empty
rows array remains accepted.

TDD RED: the targeted regression run selected 12 tests and demonstrated eight
expected failures before the implementation change (the real response shape and
seven previously accepted malformed journey shapes). GREEN: all 20 smoke tests
passed. Fresh focused bootstrap/issuer/orchestrator/comparison/capture/smoke/asset
suite passed 112 tests; relevant auth/access/PDF-auth and app/runtime passed 108.
Full Abbott production build and runtime gate passed, including 67 app/runtime
and 268 authority/artifact tests plus unchanged exact route-fragment validation.
Root and Abbott typechecks, full lint (zero errors, ten existing warnings), both
changed JavaScript syntax checks and whitespace checks passed.

STOP for re-review. No live probe, SSH session, token issuance, browser launch,
push, deploy or Nginx action occurred in this correction turn. No production
state was re-read or mutated. Prior live visual capture remains failed; additional
live smoke remains unexecuted. Public routing stays at the previously recorded
port 3001 state; this local checkpoint does not claim new production evidence.

### Approved smoke operational attempt — BLOCKED, 2026-09-15

After dedicated approval, the clean reviewed commit
`af33ac7c55a7a21d4388e78216b57ade2d4b3574` was ordinary fast-forward pushed to only
`refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Both literal remote refs were then verified equal to that SHA through isolated
Git configuration outside the worktree. Neither push used force. This followed
the fresh passing local gate evidence recorded in the preceding checkpoint.
No app redeploy was performed: the approved smoke attests the existing `f80607f`
release/manifest, and these changes affect only verification tooling/evidence.

The only credential-bearing command executed was the approved
`node scripts/verify-abbott-shadow.mjs smoke`. It opened owned forward PID 15106,
start `Tue Sep 15 02:57:29 2026`, under orchestrator PID 15098 with the same start
time. It did not return a smoke result. Read-only source inspection found an ESM
evaluation cycle: the orchestrator's top-level await waits for its smoke consumer
to dynamically import `smoke-abbott-runtime.mjs`; that module statically imports
`captureBoundedChild` back from the still-evaluating orchestrator. The smoke body
and its eight-minute timeout cannot start. The abort path also waits for the
pending import, so its normal finally/cleanup cannot finish while the SSH handle
remains open. This is a local transport startup failure, not a data/PDF/privacy/
asset mismatch, and no smoke acceptance check or report is claimed.

Bounded ownership-checked cleanup sent SIGTERM first to PID 15098. When the
pending import did not settle, SIGTERM closed only its exact owned SSH PID 15106.
Node then exited with status 13 and an unsettled-top-level-await diagnostic at
the orchestrator entrypoint, independently corroborating the cycle. No SIGKILL
was needed. Both PIDs subsequently returned ESRCH in an independent check, and
both local loopback forwarding ports were confirmed free. Local snapshots showed
only the orchestrator and its forward after issuance; no local browser or PDF
parser child was launched. There are zero smoke output directories.

Normal buffer-zeroing/finally attestation was not reached and is explicitly not
claimed. Credential/attestation bytes remained confined to pipes and the now-exited
processes' memory; no credential file, token-bearing output, raw response, or
report was written. No issuer/consumer was invoked standalone and no retry ran.

Read-only preflight and post-cleanup checks matched host/boot identity and all
recorded PM2 pid-file IDs, kernel PIDs/start times/cwds, UID/GID sets, release
pointers and available source stamps:

| Runtime | PM2 ID / PID | Kernel start | Source/release identity unchanged |
| --- | --- | --- | --- |
| dashboard-next | 1 / 3722244 | 122353749 | `8f389a28df1c4b741ec33b7538f0354b74f5a40e`, `/var/www/dashboard` |
| dashboard-zaruku | 2 / 791065 | 131477500 | `af1948c8b9a0f70d8696afb9c8abc254408a5daa`, `/var/www/dashboard-zaruku` |
| dashboard-medroche | 4 / 1870897 | 139126198 | immutable `13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone` |
| dashboard-abbott | 5 / 542693 | 160900613 | `f80607fbc8a693aa2c720b0976938e88732cdf1a`, `/var/www/dashboard-abbott` |

Nginx remained a regular file with exact SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`
before and after. No Nginx backup, edit, validation/reload, cutover or route change
occurred. Route rollback target remains the combined runtime on port 3001.
No neighbor restart/release, DB/auth/admin mutation, collector/cron operation or
credential rotation occurred. The prior visual gate remains unresolved. Per the
failed-smoke stop condition, no visual diagnostic change was implemented.

STOP: the local ESM entrypoint cycle and bounded cancellation must receive a
tested reviewed fix before another live attempt. This evidence-only update is
local and unpushed.

### ESM startup / bounded cancellation correction — local review checkpoint

The prior failed-attempt evidence commit `b499089` remains in history unchanged.
Extracted `captureBoundedChild` into `scripts/abbott-bounded-child.mjs`, a node-only
leaf with no imports back into verification or smoke. Both callers now import
that leaf. Its existing child pipe, output/time bounds and reaping behavior are
preserved; the orchestrator re-export preserves the existing tested interface.

The orchestrator now loads smoke before attestation or credential issuance.
Signal handlers and a fixed overall watchdog are installed before setup/loading:
240 seconds for compare, 660 seconds for capture, 540 seconds for smoke. Smoke's
existing 480-second request deadline is unchanged. There is no CLI/environment
timeout override. On abort, guarded pending work gets at most 35 seconds to
finish the existing child/browser cleanup; an unresolved import or setup promise
can no longer prevent the outer finally from clearing retained code, credential,
attestation and consumer-output buffers and closing/verifying the owned forward.
Late returned output buffers are also cleared. Signals and the watchdog stay
installed until forward cleanup completes, then listeners/timers are removed.

TDD RED covered the dependency cycle, missing pre-issuance loading/watchdog and
unbounded hanging-consumer abort. The real CLI entrypoint fixture uses the actual
top-level-await entrypoint and real smoke import graph, with only host/consumer
operations replaced by local seams. Its temporary path is canonicalized so the
CLI guard actually executes. Temporarily restoring the old smoke-to-orchestrator
import reproduced a bounded child timeout; restoring the leaf import passed.
No SSH/network or real credential is used by this fixture. Synthetic token bytes
are generated only in its child memory, not stored in the fixture file.

New tests also cover deadline, SIGTERM and rejection during consumer loading and
after issuance; they verify no issuance after failed load, zeroed retained buffers
before forward closure, retained signal handlers during cleanup, no leftover
timers/listeners, and clearing of late results. A static traversal asserts an
acyclic local consumer graph and a node-only child-runner leaf. Existing forward
loss and bounded child/browser cleanup tests remain passing.

Fresh verification: 120 focused bootstrap/issuer/orchestrator/compare/capture/
smoke/asset tests; 108 relevant auth/access/PDF-auth/app/runtime tests; full Abbott
production build with 67 app/runtime and 268 authority/artifact tests; 111 Abbott
contract tests; contract wiring; public-asset security check; explicit trusted
artifact verification (2,870 files, 82 text files); unchanged exact Nginx fragment
validation. Root and Abbott typechecks, full lint (zero errors, ten existing
warnings), targeted lint, changed JavaScript syntax and whitespace checks passed.
After the fixture-only refinement, all 22 orchestrator tests passed again.

STOP for review. This correction is local/unpushed and has not been used for live
issuance, smoke or capture. No SSH, production read/write, deploy, Nginx action,
browser launch, DB/auth/admin mutation or neighbor process operation occurred in
this correction turn. The last production evidence remains the preceding failed
attempt's verified unchanged runtime/Nginx identities and exited owned processes.
Live smoke and visual acceptance are still outstanding; this code checkpoint
does not convert either failed gate into a pass.

### Approved corrected smoke attempt — BLOCKED, 2026-09-15

The startup correction received dedicated approval. Clean HEAD
`b4252b86e9c832231cd6c3d60514a26e54d44cc4` was ordinary fast-forward pushed to only
`refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`;
isolated literal remote lookups verified both exact SHAs afterward. The preceding
checkpoint records its passing local gates. No app redeploy was needed or run;
the fixed smoke still attests deployed release `6cd2f12e245a47dcbd5f6ce928c4ed83`,
source `f80607fbc8a693aa2c720b0976938e88732cdf1a` and its pinned manifest.

Executed only `node scripts/verify-abbott-shadow.mjs smoke`, with the unchanged
fixed period `2026-09-01..2026-09-13` and strict in-memory/pipe issuer transport.
It exited 1 with the sole fixed diagnostic `ABBOTT_VERIFICATION_REFUSED`.
No `abbott-runtime-smoke.json` or smoke output directory was produced. The
diagnostic does not identify the failing subgate; no data/PDF/privacy/alias/asset
mismatch category is inferred and none of those acceptance checks is claimed.
Unlike the first attempt, the operation returned through normal cleanup rather
than stalling on module loading.

The orchestrator recorded owned SSH PID 19139, start
`Tue Sep 15 03:16:21 2026`, then `exitVerified: true`; its parent was PID 19131.
Normal finally clears retained credential, attestation, capsule and returned
child-output buffers before the forward-close attestation. An independent check
confirmed ESRCH for both PIDs, local forwarding ports 3001/3004 free, and zero
smoke output directories. No manual process signal/escalation was needed. No
credential was written to file, argv, environment, report or tool output.

Read-only checks before and after matched the exact host/boot, PM2 pid-file IDs,
kernel PIDs/start times/cwds, UID/GID sets, release pointers and source stamps:
dashboard-next ID1/PID3722244/start122353749/source8f389a28; dashboard-zaruku
ID2/PID791065/start131477500/sourceaf1948c8; dashboard-medroche
ID4/PID1870897/start139126198/immutable13d68b0b; dashboard-abbott
ID5/PID542693/start160900613/sourcef80607f. Their full paths and SHAs remain those
listed in the preceding operational evidence. Exact Nginx SHA-256 stayed
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.

STOP on the failed smoke gate. No retry or visual-diagnostic implementation was
performed. No Nginx backup/edit/test/reload/cutover, deploy, neighbor restart,
DB/auth/admin mutation, credential rotation, collector or cron action occurred.
Public route rollback target remains port 3001. Both smoke and the prior visual
gate remain unpassed. This evidence-only update is local/unpushed.

### Closed-enum smoke / visual diagnostics — local review checkpoint

Added a shared leaf diagnostic module with frozen, explicit stage/reason lists.
Its formatter emits only
`ABBOTT_VERIFICATION_REFUSED stage=<allowed_enum> reason=<allowed_enum>`.
Only internally associated WeakMap metadata is read: arbitrary error fields,
messages, stacks, causes, codes, URLs, headers, bodies and paths are not consulted.
Unknown errors or unapproved values become `unknown`. Forged error properties
cannot grant a diagnostic stage. No raw error object is added to a report.

Smoke now distinguishes manager/embed JSON aliases, manager administration,
embed administrative denial, recursive privacy shape, PDF fetch/parse/comparison,
Excel fetch/parse/comparison, and HTML/assets/attestation/comparison. Known HTTP
status, content-type, cache-policy and parity failures use fixed reasons, never
the actual response text or URL. Existing private/body/buffer cleanup remains in
place. The precise prior live refusal is still unknown; no stage is retroactively
assigned to it.

Capture associates fixed stages with browser launch, navigation, render readiness,
screenshots, dimensions and comparison. Console, dimension and pixel-diff
acceptance failures emit a fixed mismatch diagnostic before any success-shaped
stdout line. Existing threshold values and private index/image semantics are
unchanged. Browser logs remain counts only; raw console/error text is not retained.

The parent preserves internally branded smoke diagnostics and accepts a capture
child diagnostic only for exit status 1, no signal, empty stdout and one exact
allowlisted LF-terminated stderr line of at most 160 bytes. Extra lines, malformed
framing, unknown values, nonempty stdout or arbitrary stderr map to unknown;
neither child stream is relayed. Credential/output erasure and owned forward
cleanup still precede returning a failure. Signal/watchdog/cleanup failures also
use the same closed vocabulary.

TDD RED observed absent formatter/protocol, smoke stage association, visual
boundaries/acceptance and parent propagation. GREEN exercises every allowed
stage/reason pair with secret-bearing error fields; forged fields and throwing
property proxies; invalid/extra/oversized child frames; actual parent/capture CLI
failure output; requested smoke stages including PDF semantic mismatch; visual
launch/navigation/render/screenshot/dimensions failures and cleanup; console/
dimension/diff rejection; and parent propagation only after buffer/forward cleanup.
Synthetic browser/HTTP errors include private strings in messages, stacks, causes,
headers, bodies, URLs and paths; none reaches the formatted result.

Fresh gates passed: 127 focused bootstrap/issuer/orchestrator/compare/capture/
smoke/asset/diagnostic tests; 108 auth/access/PDF-auth/app/runtime tests; full
Abbott build with 67 app/runtime and 268 authority/artifact tests; 111 Abbott
contract tests; contract wiring; public-asset security check; explicit trusted
artifact verification (2,870 files, 82 text files); unchanged exact route-fragment
validation. Root and Abbott typechecks, full lint (zero errors, ten existing
warnings), syntax and whitespace checks passed. The runbook documents the exact
failure framing and retains the review-before-retry stop.

STOP for review. No push, live credential issuance, smoke/capture retry, SSH,
production access, deploy or Nginx action occurred in this implementation turn.
No real browser was launched; local test children were bounded/reaped and temporary
fixtures cleaned. The last production evidence remains the preceding failed
attempt's normal cleanup and unchanged runtime/Nginx identities. Smoke and visual
acceptance remain outstanding, with public routing unchanged on port 3001.

### Approved diagnostic smoke attempt — BLOCKED, 2026-09-15

After dedicated diagnostics approval, clean HEAD
`bf9059104411e102e3493e6149afd63dce61f07d` was ordinary fast-forward pushed only
to `refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Isolated literal lookups verified both remote refs equal that exact SHA. Local
gate evidence is recorded in the preceding checkpoint. The deployed shadow is
still release `6cd2f12e245a47dcbd5f6ce928c4ed83`, source
`f80607fbc8a693aa2c720b0976938e88732cdf1a`; no redeploy occurred.

Ran the approved smoke orchestrator exactly once with its unchanged fixed period
`2026-09-01..2026-09-13`, deployed-manifest attestation and ephemeral pipe/memory
credential transport. Exit status was 1. Its sole failure diagnostic was:

`ABBOTT_VERIFICATION_REFUSED stage=asset_html reason=failed`

No raw HTML, URL, request/response field, token, exception text or private row was
read into the report or tool output. This code identifies the HTML asset-inventory
gate, but does not identify the exact rejected construct or origin; no more
specific cause is inferred. No smoke report/output directory was created and no
complete parity/acceptance pass is claimed.

Owned SSH PID 22564, start `Tue Sep 15 03:31:02 2026`, emitted normal
`exitVerified: true`; its orchestrator parent was PID 22556. Normal finally clears
retained credentials/attestation/output before closing the forward. Independent
checks returned ESRCH for both PIDs, confirmed local forwarding ports 3001/3004
free, and confirmed zero smoke output directories. No manual signal or forced
termination was needed. No credential file or standalone issuer/consumer was used.

Preflight and post-cleanup host/boot, PM2 IDs/PIDs, kernel starts/cwds, UID/GID sets,
release pointers and available source stamps matched: dashboard-next 1/3722244,
dashboard-zaruku 2/791065, dashboard-medroche 4/1870897, dashboard-abbott 5/542693.
Their full source/release identities and starts remain those recorded above.
Nginx remained a regular file with exact SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.

STOP on the failed smoke gate. Capture was not started, no code fix or Nginx
structural inserter was implemented, and no Nginx backup/edit/test/reload/cutover
occurred. No app/neighbor restart/release, DB/auth/admin mutation, credential
rotation, collector or cron action occurred. Public routing and its route-only
rollback target remain port 3001. This evidence-only update is local/unpushed.

### Asset HTML source diagnosis and corrected inventory — STOP for review, 2026-09-15

Performed source/local-build inspection only after the preceding refusal. No live
HTTP request, SSH connection, credential issuance, capture, deployment, push or
Nginx action occurred in this checkpoint. The preceding production identities,
cleanup and Nginx hash are historical evidence, not a new production verification.

Found a deterministic local contract bug: Abbott config sets assetPrefix to
`/_next-abbott`, and Next 16.1.6 appends `/_next/static/`. Local generated HTML and
the installed Next `loadCustomRoutes` implementation agree on
`/_next-abbott/_next/static/`, with an internal rewrite to `/_next/static/`.
Smoke and the attester incorrectly mapped files to `/_next-abbott/static/`.
Corrected those two derived-path mappings and normalized only the exact candidate
prefix for common-asset comparison. The pinned deployed release/source/manifest
digests, file inventory, ownership/link checks and every per-file hash remain
unchanged. This does not change app configuration, deployment or Nginx.

Installed Next's metadata image loader also adds a content-hash query, and the
combined app has a favicon route. Per explicit review direction, HTML inventory
now covers script sources and stylesheet/preload/modulepreload links in the
exact runtime Next static namespace; icon/metadata links and image elements are
ignored rather than accepting query URLs. No-query, exact-loopback and redirect
boundaries remain intact for all probed assets. Candidate attestation still
checks and fetches every attested public file, including files outside the HTML
inventory. A regression verifies that an ignored image remains fetched and
hash-checked if it is present in the candidate manifest.

These are source-backed contract findings, not an attribution of the earlier
live `asset_html reason=failed`: its exact origin/construct was not retained and
has not been inspected. No successful live smoke or visual parity is claimed.

Added closed reason categories `http_status`, `body_limit`, `malformed_html`,
`no_assets`, `unexpected_asset_origin`, `unexpected_asset_path`, `inventory_limit`
and `alias_mismatch`; `content_type` was already closed. HTML decode/unsupported
markup failures, declared/stream body limits and inventory consistency now carry
safe categories. Existing cache/boundary/cancellation categories are preserved.
Only branded allowlisted stage/reason strings can reach parent diagnostics;
no rejected value, raw HTML, header, body, credential, URL or exception property
is included. The inventory remains a bounded strict markup recognizer, not a
general HTML validator.

TDD RED reproduced the wrong generated/attested prefix and missing subcodes.
An isolated RED run with the old normalization proved that an overlapping asset
with different bytes would otherwise pass; the correction restores refusal.
The favicon-query regression failed before metadata exclusion, then passed while
script, stylesheet, preload and modulepreload queries stayed rejected. Synthetic
secret-bearing inputs cover each new inventory category, and transport tests
cover HTTP/type/body refusals, cancellation, invalid UTF-8 and alias drift.
The existing exhaustive enum/forged-error/child-framing redaction tests cover the
new closed reasons as well. No real browser was launched; test children and
temporary fixtures use their existing bounded cleanup.

Fresh local gates passed: 133 focused bootstrap/issuer/orchestrator/compare/
capture/smoke/attestation/diagnostic tests; 108 auth/access/PDF-auth/app/runtime
tests; full Abbott build and runtime suite with 268 authority/artifact tests;
111 contract tests; contract wiring; public-asset security; explicit trusted
artifact verification (2,870 files, 82 text files); exact existing route-fragment
validation. Root and Abbott typechecks, syntax, whitespace and full lint passed
(zero errors, ten existing warnings). An initial parallel auth/runtime invocation
raced build cleanup and missed the temporary middleware manifest; its ordered
post-build rerun passed all 108 tests. The final build/focused run was ordered,
with no such race.

STOP for dedicated review before any push or live retry. Public routing and its
rollback target remain port 3001 according to the preceding live evidence; no
fresh production observation is claimed. Shadow remains the previously attested
f80607f release; screenshot dimensions/diffs, full smoke acceptance and Nginx
structural review remain outstanding. The previously recorded Minor about the
Python stamp helper's broader direct-input contract remains unchanged.

### Exact asset attribute parser review fix — STOP for re-review, 2026-09-15

Addressed the Important parser review finding locally with TDD. Six regression
groups initially failed: three legitimate stylesheet attribute/rel variants,
data-attribute masking, duplicate/malformed attributes, and critical rel tokens
mixed with icon tokens. A seventh RED regression covered comments, quoted
tag-like attribute content, script text and exact tag names. The previous loose
lookup could mistake data-src for src, miss render-critical links and accept a
duplicate critical attribute; no live probe was needed to establish these bugs.

Replaced substring attribute lookup with a bounded quote-aware tag scan and
exact, case-insensitive attribute parsing. Quoted values support optional ASCII
whitespace around the equals sign; unquoted assignments, duplicate attributes,
missing critical values, unsupported rel tokens/encoding and malformed relevant
markup fail closed with the existing `malformed_html` code. Valueless boolean
attributes such as async/defer remain valid, but src/href/rel require quoted
values. Attribute text cannot mask a real source; comments and raw script text
are not searched as resource tags. Only exact script/link tags are relevant.

Rel is parsed as an ASCII-whitespace token list, case-insensitively. Critical
stylesheet/preload/modulepreload tokens are recognized independent of order or
padding, including alongside an icon token; icon/metadata exclusion occurs only
after exact rel parsing. Query-bearing and foreign asset URLs remain refused.
The fixed release/source/manifest authority, complete candidate public-file
attestation/fetching, asset bounds, parity and credential/forward cleanup are
unchanged. Synthetic secret strings in malformed attributes or unsafe URLs never
enter formatted diagnostics. Local generated Next markup remains accepted.

No push, live request, SSH, credential issuance, browser launch, deployment or
Nginx action occurred. The prior live failure remains unconfirmed; public routing
and rollback target are still recorded as port 3001 by the preceding historical
production evidence, not a new observation.

Fresh gates passed: 140 focused bootstrap/issuer/orchestrator/compare/capture/
smoke/attestation/diagnostic tests (34 smoke); full Abbott build/runtime and 268
authority/artifact tests; 108 auth/access/PDF-auth/app/runtime tests; 111 contract
tests; contract wiring; public-asset security; exact route-fragment validation;
trusted artifact verification (2,870 files, 82 text files); root and Abbott
typechecks; syntax and whitespace checks. Full lint passed with zero errors and
ten existing warnings. Ordered post-build tests avoided the prior build race.
Temporary test children/fixtures retained their tested bounded cleanup; no real
browser or SSH resource was created. STOP for dedicated re-review before push
or any live smoke/capture retry. All earlier operational boundaries still apply.

### Approved exact-parser live smoke — BLOCKED, 2026-09-15

After parser approval, clean HEAD
`7d5026949971a04a38588da19a33d0447407b988` was ordinary fast-forward pushed only
to `refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Before each push, its literal remote predecessor was checked as an ancestor.
Isolated Git lookups outside the checkout verified both exact remote refs at the
approved SHA. No force push or other ref update occurred. Approved local gate
counts remain the preceding checkpoint's 140 focused, 268 authority/artifact,
108 auth/runtime and 111 contract tests plus build/typecheck/lint/artifact gates.

No redeploy was needed: the complete diff since installed `f80607f` remains
verification/bootstrap tooling and operational documentation, with no packaged
application, launcher, dependency, runtime-contract or artifact-policy change.
Shadow remains release `6cd2f12e245a47dcbd5f6ce928c4ed83`, source
`f80607fbc8a693aa2c720b0976938e88732cdf1a`, with no predecessor. Current and
immutable record agree and the trusted manifest digest remains
`7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f`.

Ran `node scripts/verify-abbott-shadow.mjs smoke` exactly once with the fixed
`2026-09-01..2026-09-13` period, approved ephemeral in-memory/pipe credential
issuer and deployed-manifest attestation. It exited 1 with only:

`ABBOTT_VERIFICATION_REFUSED stage=pdf_fetch reason=status`

This identifies a PDF response-status gate; the exact status value, origin,
audience and alias were not exposed or inferred. No raw response/PDF, header,
token, private row, authorized URL or exception detail was inspected or saved.
No full smoke pass is claimed and no smoke report/output directory was created.
Capture was not started; no new screenshots, dimensions or diff result exist.
No code fix or Nginx structural inserter was attempted after the failed gate.

Owned SSH PID 31998, start `Tue Sep 15 03:55:45 2026`, returned normal
`exitVerified: true`; its orchestrator parent was PID 31990. Independent local
checks returned ESRCH for both exact PIDs, confirmed ports 3001/3004 free and zero
smoke directories. The reviewed normal finally path clears retained credential,
attestation and child-output buffers before returning. No credential file,
standalone issuer/consumer, manual tunnel, signal or forced cleanup was used.
No local browser was launched. Post-run kernel child inventories of combined
PID 3722244 and Abbott PID 542693 each had zero descendants; no process was killed.

Read-only preflight and post-cleanup proof matched host `ybjqbzojln`, root PM2
daemon PID 1316, pinned kernel boot ID, PM2 pid-file IDs, kernel starts/cwds and
all real/effective/saved/filesystem UID/GID values:

| Runtime | PM2 ID / PID | Kernel start | UID / GID |
| --- | --- | --- | --- |
| dashboard-next | 1 / 3722244 | 122353749 | 0 / 0 |
| dashboard-zaruku | 2 / 791065 | 131477500 | 984 / 991 |
| dashboard-medroche | 4 / 1870897 | 139126198 | 983 / 983 |
| dashboard-abbott | 5 / 542693 | 160900613 | 982 / 984 |

Combined source remains `8f389a28df1c4b741ec33b7538f0354b74f5a40e` at
`/var/www/dashboard`; Zaruku remains `af1948c8b9a0f70d8696afb9c8abc254408a5daa`
at `/var/www/dashboard-zaruku`. MedRoche's release pointer still resolves to
`/var/www/dashboard-medroche-releases/13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone`.
All cwds match the earlier full evidence. Abbott service identity/no-home/no-login,
root-only credential input 0700/0600, root:GID984 app env0640 and single-link
regular files remained correct. No values were output. Abbott's sole listener
remained `127.0.0.1:3004`, and direct database health returned HTTP200 before and
after smoke.

Nginx remained a single-link regular file with exact SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c` before/after.
No backup, config write, nginx test/reload, route change or cutover occurred.
Public routing and its route-only rollback target remain port 3001. No neighbor
restart/release, DB/admin/auth/fact mutation, migration, collector/cron change or
credential rotation occurred. STOP at the failed PDF status gate. This sanitized
evidence-only commit is local/unpushed.

### PDF source-contract diagnosis and bounded origin/status diagnostics — STOP for review

Inspected the exact combined PDF source at
`8f389a28df1c4b741ec33b7538f0354b74f5a40e` and focused handler at deployed
`f80607fbc8a693aa2c720b0976938e88732cdf1a`, alongside smoke and shared request/auth
code. Both routes export GET and use query-string dates; neither has a POST/body
schema. Smoke already sends GET with no body, exact aliases, the fixed
`2026-09-01..2026-09-13` dates, manager cookie or embed key, and redirect refusal.
Both handlers preserve dates into the rendered dashboard URL, derive export
tokens with the authorized audience, and retain manager credential_version.
Focused internal URL defaults to loopback3004; combined defaults to loopback3001.
No deterministic method/body/date/auth contract mismatch was found. No request
or application behavior was changed speculatively.

Added actual-handler integration tests, not a replacement PDF response schema.
Tests hash-check current handler source against the exact pinned Git blobs,
execute both real handler/auth/store-read paths using the smoke-built Request,
and stub database/browser I/O. All eight alias/audience/origin combinations return
the real route's PDF response; existing Poppler pipe parsers verify the synthetic
render bytes. Tests assert no request body, exact GET/query fields, real signed
manager-cookie acceptance, embed acceptance, export audience/version/date
propagation, PDF headers, and closure of every fixture browser. Only SELECT
fixtures are available; database writes/connections are refused.

The first local integration-test shim intercepted Puppeteer's ESM singleton but
not its separate CJS singleton used by tsx's TS handlers. Its failure occurred
before fixture launch was called, so a real local browser launch could be reached
in those initial test attempts; exact transient browser PIDs were not captured.
No production tunnel or real credential was used. Corrected the ESM/CJS seams,
then independently verified zero local Puppeteer/Chrome-for-Testing/headless-shell
processes remained. The final fixture additionally guards child spawning at both
CJS/ESM built-in bindings, permitting only the two fixed Poppler executables and
refusing a browser child before spawn. Both actual-handler tests pass with this
guard. The original route's finally path returned, and no process was killed.

Per review direction, PDF response-status refusals now distinguish only closed
origin/classes: control_4xx, control_5xx, candidate_4xx, candidate_5xx, and
control_other_status/candidate_other_status. Control/candidate derive solely from
the fixed 3001/3004 origins. No exact HTTP number, header/body, URL, alias, audience
or exception property is emitted. Existing PDF type/body limits remain unchanged.
TDD RED proved the missing codes; real handler credential-version denial and
synthetic renderer failure produce the appropriate 4xx/5xx categories for both
origins after fixture-browser cleanup. Exact child frames and every closed enum
remain redaction-tested; arbitrary suffixes, exact numeric status strings and
secret-bearing error fields never pass the allowlist.

Source-only dependency inspection found a conditional, unconfirmed prerequisite
difference: the sealed candidate launcher removes HOME/PUPPETEER_CACHE_DIR and
runs UID982 with /nonexistent home. PUPPETEER_EXECUTABLE_PATH is allowed but
optional in the unchanged secret/bootstrap/renderer contract. Installed Puppeteer
uses that explicit path when configured, otherwise its home-based cache. The PDF
handler does not supply a separate executable. Production path presence, binary
permissions/cache availability and shared-library state were not inspected in
this turn. The earlier status code did not identify which origin failed, so this
is not attributed as the live cause. No environment/worker contract, browser
installation, cache permission or runtime source was changed.

No live production request, SSH, push, deployment, database operation, production
log read or Nginx action occurred. The previous live PDF status refusal remains
the outstanding blocker; visual acceptance/cutover remain unperformed. Review
this diagnostic/test checkpoint before any retry or additional runtime inspection.

Fresh local gates: Abbott build and exact-route validation passed; 67 app/runtime
tests and 268 authority/artifact tests passed. Bootstrap/issuer/orchestrator/
comparison/capture/smoke/attestation/diagnostic suite passed 143/143 (rerun after
the final spawn guard); auth/access/runtime suite passed 108/108; contract suite
passed 111/111. Artifact verification passed for 2,870 files / 82 text files.
Root and Abbott typechecks, contract wiring, public-asset security, four changed
script syntax checks and whitespace checks passed. Lint has zero errors and the
same ten existing warnings. Final independent local test-browser inventory was
zero; all test command sessions exited. This checkpoint is local/unpushed and
requires review; it does not establish live PDF or visual parity.

### Approved PDF diagnostic retry — candidate PDF 5xx, BLOCKED

From clean reviewed `b9c89654cb14dfe5c44e6145ef2fd66bab806eb6`, ordinary non-force
pushes advanced only `refs/heads/codex/abbott-runtime-isolation` and
`refs/heads/release/abbott`. Both literal remote SHAs were verified equal to HEAD
through an isolated Git lookup; existing remote SHAs were ancestors. Prior local
gates are the immediately preceding checkpoint's 143 focused, 67 app/runtime,
268 authority/artifact, 108 auth/access and 111 contract tests, plus build,
artifact, typechecks, syntax/security/wiring and lint (zero errors/ten warnings).

No redeploy: the diff since installed `f80607f` contains only verification/
bootstrap tooling and operational documentation, including AGENTS/dashboard
memory. Application, dependency, launcher and runtime/artifact authority are
unchanged. Shadow remains source `f80607fbc8a693aa2c720b0976938e88732cdf1a`, release
`6cd2f12e245a47dcbd5f6ce928c4ed83`, previousId null. Current/immutable records agree;
manifest digest remains `7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f`.

The first read-only metadata proof used an incorrect guessed rendered-env path
under apps/abbott and refused before issuance/smoke. Reviewed start.cjs/worker
source proves the exact path is `/var/www/dashboard-abbott/.env`; metadata-only
inspection confirmed it is root:GID984 0640, single-link regular, no symlink.
The full corrected preflight passed. No file was created/moved/read for values.
Root-only input remains root:root 0700 directory / 0600 single-link regular file.
Account UID982/GID984 remains no-home `/nonexistent`, `/usr/sbin/nologin`.

Ran `node scripts/verify-abbott-shadow.mjs smoke` exactly once for the fixed
`2026-09-01..2026-09-13` dates with reviewed ephemeral issuer/pipe/in-memory
credentials and deployed manifest attestation. Exit 1 emitted only:

`ABBOTT_VERIFICATION_REFUSED stage=pdf_fetch reason=candidate_5xx`

This establishes only that a candidate-port PDF response was in the server-error
class. Exact status, alias/audience, error body/header and underlying cause were
not exposed or inferred. No raw response/PDF, private row, secret or authorized
URL was inspected or retained. No complete smoke pass/report exists. Per the
hard stop, no capture retry, browser investigation, source fix or Nginx inserter
work followed. No new image dimensions or diff result exists.

Owned SSH PID38311, start `Tue Sep 15 04:16:49 2026`, emitted normal
exitVerified=true; orchestrator PID38301 exited 1. Independent checks returned
ESRCH for both exact PIDs, ports3001/3004 free, zero smoke directories and zero
local test-browser processes. The reviewed normal finally path clears retained
credential/attestation/child buffers. No credential file, manual tunnel,
standalone issuer/consumer, signal or forced cleanup was used. Post-run kernel
child inventories for combined PID3722244 and candidate PID542693 were both zero.

Full preflight/post-cleanup proof matched host ybjqbzojln, root PM2 daemon1316,
boot ID `1c736efb-eaa2-42d9-b247-bd1a2ef36a4e`, all pid-file IDs, kernel starts,
cwds, and real/effective/saved/filesystem UID/GID values:

| Runtime | PM2 ID / PID | Kernel start | UID / GID |
| --- | --- | --- | --- |
| dashboard-next | 1 / 3722244 | 122353749 | 0 / 0 |
| dashboard-zaruku | 2 / 791065 | 131477500 | 984 / 991 |
| dashboard-medroche | 4 / 1870897 | 139126198 | 983 / 983 |
| dashboard-abbott | 5 / 542693 | 160900613 | 982 / 984 |

Combined cwd `/var/www/dashboard`, source `8f389a28df1c4b741ec33b7538f0354b74f5a40e`;
Zaruku cwd `/var/www/dashboard-zaruku/apps/zaruku`, root source
`af1948c8b9a0f70d8696afb9c8abc254408a5daa`; MedRoche cwd remains the apps/site-seo
directory under immutable release `13d68b0b2c820ba5d223f254bc4eba6d0cf24418/standalone`,
and its public release pointer resolves there. Abbott cwd remains
`/var/www/dashboard-abbott/apps/abbott`; sole listener127.0.0.1:3004 and direct
health200 both passed before/after.

Nginx exact single-link regular config SHA-256 remained
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c` before/after.
No backup, config write, nginx test/reload or cutover occurred; public routing and
route-only rollback target remain3001. No neighbor restart/release, DB/auth/admin/
fact mutation, migration, collector/cron/source-API action or credential rotation.
This sanitized evidence/docs update is local/unpushed. BLOCKED at candidate PDF
5xx; next diagnosis requires reviewed scope, not an automatic retry.

Evidence/docs validation: 49 diagnostic/capture/orchestrator tests passed, zero
failures; whitespace check passed. No implementation change was made after smoke.
