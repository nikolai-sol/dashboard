# Abbott Task 9 — Phase1 asset-boundary instrumentation

Status: DONE_WITH_CONCERNS; local boundary diagnostics await review before a
diagnostic run. The last approved6393077 smoke returned asset_attestation/failed
before issuance, without a finer reason. Its live cause remains unproven. This
turn changed source/tests/runbook/report only; no live request, push, deployment,
capture or Nginx action occurred. Last verified production remains6f09982/8c79,
with retainedf80607f/6cd2 backup,9aaed34 quarantine, browser/neighbor/Nginx proofs
and completed cleanup from the preceding operational turn. No fresh host claim
is made here. Live parity, six-image comparison and cutover remain incomplete.
Earlier sections are chronological history.

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

### Candidate PDF browser prerequisite diagnosis and local fix — STOP for review

Authorized narrow read-only host diagnosis repeated the full fixed proof first:
same host/boot, four PM2 pid-file/kernel identities/UID/GID/cwds/releases, Abbott
account/secret metadata, sole loopback3004 listener, direct health200 and exact
Nginx hash. No restart, deploy, route, auth, DB/fact or source-data change occurred.

The relevant names-only inventory found HOME present in the combined initial
kernel process environment; no explicit browser/cache key was present there or
in its authoritative combined env. Candidate initial kernel environment and
rendered env had none of the browser executable/cache/HOME/temp/XDG keys checked.
No other env keys or values were output; the fixed launcher clears inheritance.
No raw PM2 environment dump was taken. A bounded UID982/GID984 metadata child
confirmed `os.homedir()` resolves `/nonexistent`, that directory and its Puppeteer
cache are absent, and `/tmp` is writable/executable. `/tmp` is root:root1777.
The combined root cache directory exists, but root0700 ancestry excludes the
dedicated account; neither its contents nor browser/user data were read/copied.

All ten bounded standard browser paths were absent: google-chrome/stable and
chromium/chromium-browser under the checked /usr/bin, /usr/local/bin, /usr/lib,
/opt/google/chrome and /snap locations. Fixed package queries returned no
installed chromium, chromium-browser or google-chrome-stable record. Candidate
installed Puppeteer package is24.39.1. There was consequently no candidate binary
against which to claim successful shared-library inspection. No browser launch,
PDF retry, package installation or browser download was performed.

This establishes the candidate's missing executable prerequisite: its PDF handler
called Puppeteer without an executable override, while the cleared/no-home
runtime had no default cache. It does not establish that installing a browser
alone will satisfy all later PDF/render/visual gates. Per the follow-up direction,
no system package install or combined/root cache reuse is proposed.

Implemented a local app-scoped prerequisite module and separate fixed bootstrap
entrypoint. Installed locked puppeteer-core24.39.1 derives supported Linux
chrome-headless-shell146.0.7680.76; installed @puppeteer/browsers2.13.0 derives the
official source and exact executable layout. There is no hardcoded invented
upstream archive digest. The API supplies no checksum; first controlled install
will capture the actual archive SHA-256 into the immutable stamp alongside exact
package/build/platform/source and complete file hashes/sizes/modes.

The fixed bootstrap repeats source/process/parser and entire active f80607f
artifact proof before importing its installed package APIs or creating directories.
It verifies exact service account and /var/lib ancestry. The official HTTPS
download has no proxy/redirect/fallback, a120-second/256-MiB limit, and metadata ZIP
validation before extraction (4,096 entries/768 MiB expanded, no links/escapes).
Installed API extraction consumes the preseeded validated archive in a bounded
60-second child with HTTP disabled and installDeps:false. Overall remote deadline
is180seconds, fixed SSH wrapper210seconds; signals feed the owned child/download
abort path. Unknown/child output is reduced to fixed bootstrap refusal.

Private staging is atomically promoted only after full verification into
`/var/lib/dashboard-abbott/browser-cache`. Root:dashboard-abbott directories0750,
data/stamp0640, executable files0750, including under restrictive umask; no runtime
writes. Existing installs must exactly verify, never auto-replaced. Cancellation,
interrupted download/extraction or unexecutable staging cannot publish; owned
staging is removed. A newly created empty parent may remain after failure. Before
promotion a bounded empty-environment child drops all supplemental groups and
checks service-UID execution permission, writable /tmp and ldd for missing libs.
Missing libraries remain a blocker; no system dependency installation is enabled.

The existing fixed deploy transport explicitly carries this reviewed source;
only Abbott deploy/rollback uses its preflight before lock or release writes.
Hash/mode/version/symlink/access drift refuses. Deployment never downloads a
browser; it renders the verified path into the already-allowlisted
PUPPETEER_EXECUTABLE_PATH in new app env without rewriting the secret input or
sealed launcher. The focused handler selects the same package-derived immutable
headless-shell path, pipe transport and minimal non-secret browser environment.
Puppeteer's existing per-launch /tmp profiles and browser-close cleanup remain
the writable runtime state; neither user home nor immutable browser cache is used
as profile storage. Combined/Zaruku/MedRoche application sources are unchanged.

TDD RED/GREEN covered missing prerequisite refusal before writes; package/source/
build selection; fixed PDF launch options; interrupted download/extraction and
abort before/after extraction; archive escapes/links/duplicates/size; version,
file hash, extra-file, mode, parent-mode and executable-access drift; restrictive
umask; idempotence; and bounded/redacted download errors. Installed API extraction
was exercised only on a synthetic ZIP with HTTP methods disabled; no browser
binary was downloaded/executed. Capsule syntax was compiled without execution.
Actual-handler smoke fixtures still compare the pinned request/auth/render source
after excluding only this explicitly tested launch block/import.

Operational STOP: do not run the new bootstrap, push, deploy, retry PDF/smoke or
capture, or edit Nginx until dedicated review. No first-install archive digest,
live library success, new runtime release, screenshot dimensions/diff or full PDF
parity is claimed. Existing f80607f remains live and PDF-blocked; route-only
rollback target remains unchanged combined3001. The pre-fix isolated predecessor
does not contain this PDF correction. A future app deployment also requires a
reviewed successor manifest attestation for smoke instead of overriding its
existing f80607f pin. These source changes and evidence are local/unpushed.

Final local gates: build passed; 67 app/runtime tests and 283 authority/artifact/
bootstrap tests passed; 157 focused operational tests (including the 14 new
browser/bootstrap tests) and 108 auth/access/runtime tests passed. Root and
Abbott typechecks, artifact verification (2,870 files/82 text files), exact-route
validator, script syntax and whitespace checks passed. Lint: zero errors, ten
existing warnings. Final independent local test-browser inventory was zero; all
test/build subprocess sessions exited. This is implementation evidence only, not
browser installation or live PDF acceptance.
The refreshed 111 contract tests, contract wiring and public-asset security gates
also passed before commit.

### Approved browser bootstrap attempt — 2026-09-15 — BLOCKED locally

The clean approved commit `9aaed34feeb9b73b4d177dccab5a2b750776b4c3`
was pushed with ordinary fast-forward pushes to only
`refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Isolated literal remote-ref lookups verified both exact SHAs. No force push or
other ref change occurred. The local gate counts above remain the approved
source verification evidence; no implementation changed in this attempt.

The exact reviewed `node scripts/bootstrap-abbott-browser.mjs` invocation
returned only `ABBOTT_BROWSER_REFUSED`, exit 1. A read-only invocation check
proved the first local guard rejects inherited key names `GIT_PAGER` and
`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S`; their values were not inspected or
printed. That guard precedes capsule creation and SSH spawn, so no remote
bootstrap, download, staging, account/cache write, or install was attempted.
Local bootstrap PID 62611 was independently verified absent (ESRCH). No retry
or environment workaround was performed. Read-only proof SSH sessions exited.

Full preflight before and after the failed local invocation passed: hostname
`ybjqbzojln`, root PM2 daemon 1316; dashboard-next ID1/PID3722244/start122353749,
dashboard-zaruku ID2/PID791065/start131477500, dashboard-medroche
ID4/PID1870897/start139126198 all retained their recorded UID/GID, cwd and
release/source identity. Abbott remained ID5/PID542693/start160900613,
UID982/GID984, source `f80607fbc8a693aa2c720b0976938e88732cdf1a`, release
`6cd2f12e245a47dcbd5f6ce928c4ed83`; immutable control identity, account and
secret/rendered-env metadata passed. Its sole listener remained loopback3004,
direct database health200, with zero Abbott/combined child processes.
Nginx stayed at SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.

STOP: no deploy, attestation-pin edit, smoke, capture or Nginx action followed.
No new browser/archive stamp, screenshot/diff or PDF parity result is claimed.
No browser or credential resource was created. No Nginx backup was needed;
public routing and route-only rollback target remain combined port3001.
The parent authorized a narrow new-release attestation pin update after a
successful deploy, but that prerequisite was not reached.

### Clean invocation retry and interrupted activation — 2026-09-15

The owner authorized an invocation-only retry without weakening source guards.
Local no-network proof used `/usr/bin/env -i` and verified absolute Node
`/opt/homebrew/Cellar/node/25.6.1_1/bin/node`; no variables were supplied.
macOS automatically adds only `__CF_USER_TEXT_ENCODING`; the reviewed prohibited
key scan passed. Four bootstrap tests passed in this clean environment.

The single approved retry returned `ABBOTT_BROWSER_CREATED`. Bootstrap PID63337
and owned SSH63346 (ps start `Tue Sep 15 04:58:34 2026`) exited and were
independently verified ESRCH. Independent
read-only verification confirmed core24.39.1, browsers2.13.0, Linux
chrome-headless-shell146.0.7680.76, official Chrome-for-Testing source, full
immutable file inventory and archive SHA-256
`fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04`.
UID982/GID984 execute/access and bounded ldd checks passed. The exact browser
parent contained only browser-cache, no staging residue. No detached downloader
was used; the awaited download/extraction/SSH pipeline completed and exited.

Per explicit approval, deployment used a temporary detached worktree at exact
`9aaed34feeb9b73b4d177dccab5a2b750776b4c3`, preserving branch c74aaa2.
The normal fixed `npm run deploy:abbott` returned only
`Refusing fixed runtime operation`. It reached activation after its build,
local gates and staged artifact verification, but did not publish a successful
release receipt. Deployment parent63995 and worker64005 exited. The temporary
worktree was removed with normal git worktree remove; its parent directory and
Git registration were independently verified absent. No source changes or
force operation occurred there.

CORRECTION: an early progress message inferred predecessor restoration from
the old current.json pointer plus health. That inference is explicitly
retracted. Pointer-only preflight did not prove the active artifact identity.
Subsequent exact filesystem and PM2 evidence proves interrupted activation:

- Active regular directory `/var/www/dashboard-abbott` is candidate9aaed34,
  control `e9e548a6414c4d8c836c7715c66f37ad`, manifest
  `a62b6297cdc903ed4d0e94357e7dfbe8d552ed4bf76db95be6582d913433c74b`.
- Current pointer still equals immutable predecessor6cd2/f806/7b9a record.
- Exact backup `/var/www/dashboard-abbott-backups/6cd2f12e245a47dcbd5f6ce928c4ed83`
  contains f806. Both candidate and backup complete trees independently pass
  the worker's unchanged readRecord/attestTree read-only authority checks.
- PM2 ID5/PID714550/start162192969 is online, UID982/GID984, exact fixed launch
  and cwd, sole loopback3004 listener, direct database health200. Its registration
  retains predecessor source f806/release6cd2, not candidate binding.
- Candidate rendered browser env matches the fixed executable path in the
  renderer's single-quoted format; root:GID9840640 single-link metadata passes.
  An initial double-quote comparison was corrected read-only; it was a probe
  format error, not an env defect. No values were printed.
- Deploy lock is absent; no parked verification env remains. One ownership
  receipt predates this failed activation; no candidate-success receipt exists.

The deterministic refusal boundary is the new-registration check, before
ownedRegistration assignment. The recovery catch then refuses to stop a
registration not bound to the candidate, leaving candidate files, old pointer
and preserved backup. A synthetic real-worker regression reproduces an online
replacement PID retaining predecessor binding: no automatic stop/promotion,
backup intact, pointer unchanged, lock removed, and ordinary inspect/rollback
refusing the active-versus-pointer mismatch. All37 focused deploy tests passed.
Installed PM2 is5.3.1; its static env-merge code was inspected read-only, but the
deeper cause of the retained binding is not yet claimed resolved.

Neighbors remain ID1/PID3722244/start122353749, ID2/PID791065/start131477500,
ID4/PID1870897/start139126198 with unchanged source/release/cwd/UID/GID.
Nginx remains SHA-256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
Abbott/combined children are zero. Read-only diagnosis SSH sessions exited.
No token, browser session, smoke/capture, screenshot, PDF retry, pin update or
Nginx action followed. Public routing/route rollback remains combined3001.
Pointer-only promotion is unsafe; ordinary deploy/rollback is also blocked by
the verified inconsistency. A separately reviewed exact-state recovery command
is now authorized for local implementation only, not execution.

### Checkpoint A — fixed interrupted-activation recovery implementation

The owner approved the rollback design and its conservative failure semantics:
verify the exact observed state, take only the Abbott lock, stop the exact
stale-bound Abbott process, park the candidate, restore the sealed predecessor,
restart only old protected control, and verify every authority before unlock.
No candidate pointer promotion or normal deploy-path weakening is included.
Checkpoint B (PM2 binding update correction) is deferred until host recovery.

Implemented the recovery-only module and fixed local entrypoint. The unchanged
worker tree/record attesters and PM2 adapter are exposed to this dedicated path;
normal current()/deploy/rollback inconsistency gates remain intact. The new
path pins candidate e9e548/9aaed34/a62b, predecessor6cd2/f806/7b9a, ID5/PID714550/
start162192969/UID982/GID984, host/boot/daemon, all three neighbor identities,
Nginx hash and fixed filesystem locations. Every full tree and env overlay is
rechecked around atomic renames; inode identities and env digests stay bound
in memory. No environment value enters output/journal. There is no DB write,
browser operation, candidate promotion or non-Abbott PM2 target.

Recovery succeeds only with old app stamp/current pointer/registration, fixed
listener/health and unchanged perimeter. It retains candidate code in a fixed
quarantine and a root-only completed journal. Failure or cancellation after a
possible stop attempts to stop only the captured registration and compensate
file layout under exact atomic preconditions. It never restarts mismatched
candidate code. If ownership changed, it does not kill an unowned replacement;
it retains the lock/journal and available trees for manual review. Failed
compensation is explicitly not successful recovery. Before-mutation refusal
after acquiring the lock can also conservatively preserve it.

The initial shared-child wrapper was replaced before use by the owner-approved
recovery-only bidirectional transport: fixed SSH alias/IP/root/private-key path/
known-hosts path, no config, proxy, agent, multiplexing or redirect authority.
The local key and known-hosts contents are never read by our diagnostics; SSH
uses their fixed protected paths. A bounded source-length/SHA-256 frame and RUN
line precede execution; explicit ABORT and EOF feed the remote controller.
No credential frame is used. Remote final statuses are closed enums emitted
only after the recovery promise terminates. The local parent waits for the
exact acknowledgement and verified SSH exit, rejects stderr/extra/oversized/
forged output or bad exit, and retains handlers through bounded cleanup.
Only a matching owned SSH PID/start may receive deadline TERM/KILL. Missing ack
is UNACKNOWLEDGED, never remote-cleanup evidence.

TDD covered the absent engine/entrypoint/transport, phase failures after stop,
both renames, restart and health/identity/listener checks, actual adapter inode
restoration, zero-write pin/host/source/metadata/tree/pointer/UID/GID/neighbor/
Nginx/listener refusals, signals, restart error after spawn, compensation failure,
EOF/abort framing, truncated/oversized source, forged/late output, lost ack,
hung SSH, PID replacement, and failed SSH exit despite an apparent success ack.
All host/filesystem/process adapters used isolated fixtures; the actual loader
tests launched only short-lived local Node children and verified each exit.
An initial loader stdin-lifecycle regression was caught RED and fixed; the
signal tests use a readiness pipe rather than timing assumptions. Concurrent
build-dependent typecheck/smoke probes encountered transient missing generated
files and were rerun serially after build completion; no source workaround.

STOP for dedicated source review. The command has NOT been executed or pushed.
The live interrupted state recorded above is unchanged by this implementation.
No recovery acknowledgement, restored runtime, new asset pin, smoke/capture or
Nginx change is claimed. The public rollback route remains combined3001.

Final Checkpoint A local evidence: build and67 app/runtime tests passed; the
refreshed full authority/artifact/bootstrap/recovery suite passed311 tests,
including27 focused recovery tests and the new retained-binding regression.
The61 smoke/attestation/orchestrator/capture regressions passed after the build.
Root and Abbott typechecks passed serially; lint had zero errors and ten
pre-existing warnings. The exact12-route/one-prefix validator, artifact scan
(2,870 files/82 text files), trusted artifact verification, all changed-script
syntax checks, compiled capsule syntax and git whitespace check passed.
The final recovery reader regression proves metadata-to-descriptor replacement
refuses before any writes. All test/build tool sessions ended; loader tests
independently verified their exact local Node child PIDs absent. No browser or
live SSH/recovery process was created during this implementation checkpoint.

### Checkpoint A re-review: post-spawn transport lifecycle

The review found an early-return path when the initial SSH start proof or shared
setup failed after spawn. TDD first reproduced seven failures. The transport now
installs close/exit observation, bounded stdout/stderr drains and all cleanup
deadlines before PID/start proof or shared setup. A failed proof/setup sends EOF
without source or RUN, and permits a cleanup-only identity retry. A ps timeout
or error is unknown identity, not proof of absence. A captured start identity
must still match before TERM/KILL; an observed child exit cannot be rebound to
a replacement PID. No catch, failed kill or identity mismatch can clear timers
or settle while the child remains live before the full observation deadline.

If the budget expires without a verified close, the result is explicitly
UNACKNOWLEDGED with sshExitVerified=false. It never claims remote cleanup.
Bounded drains and the close observer remain attached for a late close; timers
are cleared only after close. Secret-bearing synthetic errors/stdout/stderr
remain absent from returned status. Source/RUN are never sent before proof.

Fresh local evidence: transport14/14, focused recovery34/34; build plus67
app/runtime tests and full authority/artifact/bootstrap/recovery318/318 passed.
The additional smoke/asset/orchestrator/capture61/61 passed after the build.
Root and Abbott typechecks passed; lint zero errors/ten existing warnings.
Artifact inventory remains2,870 files/82 text files and trusted verification
passed. Exact12-route/one-prefix validation, changed-module syntax and Git
whitespace checks passed. Local loader tests reaped their owned Node children
and independently proved their PIDs absent; all test/build sessions exited.

STOP for re-review. No live SSH, recovery, deployment, credential use, browser,
push or Nginx operation occurred. The last attested interrupted host state above
is not asserted repaired or freshly revalidated by this local-only checkpoint.
The authorized public rollback route remains combined127.0.0.1:3001.

### Approved single recovery attempt: UNACKNOWLEDGED (2026-09-15)

Checkpoint A received explicit execution approval. The clean local HEAD was
278fd2da2f8d4b11b7204206323f0e62c41a15a9. Fresh transport/entrypoint tests passed
16/16 before publication; the full local gate results are recorded immediately
above. Isolated literal remote lookup verified both existing authorized refs
were ancestors, then ordinary non-force pushes advanced only
refs/heads/codex/abbott-runtime-isolation and refs/heads/release/abbott to that
exact HEAD. Both literal remote SHAs were independently verified equal to HEAD.
The temporary outside-repository ref-proof directory was removed.

Exactly one invocation of the approved fixed entrypoint ran with /usr/bin/env
-i and the pinned absolute Node executable, no arguments or ambient authority.
It exited1 with only ABBOTT_RECOVERY_UNACKNOWLEDGED. There was no trusted terminal
recovery acknowledgement. No retry, code fix, deployment, credential issuance,
smoke, capture, DB/admin change or Nginx operation followed. This status is not
restoration or proof of remote cleanup.

Independent read-only post-result evidence established:

- Active regular root:root0755 directory still contains candidate9aaed34;
  the root:root0755 backup still contains oldf80607f. Both complete trees pass
  the unchanged worker record/manifest/tree attesters. Candidate control remains
  e9e548a6414c4d8c836c7715c66f37ad/manifest a62b6297cdc903ed4d0e94357e7dfbe8d552ed4bf76db95be6582d913433c74b.
- current.json remains byte-identical to old6cd2f12e245a47dcbd5f6ce928c4ed83,
  sourcef80607fbc8a693aa2c720b0976938e88732cdf1a, manifest
  7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f.
  PM2 ID5/PID714550/start162192969 still has that old registration binding.
  Kernel UID982/GID984, exact app cwd and sole127.0.0.1:3004 listener pass;
  bounded direct health returns200 with the expected Abbott connected body.
- Recovery lock, journal, journal.next and candidate quarantine are absent.
  Thus the interrupted layout remains unchanged; the attempt is not reported
  as having reached any recovery mutation phase.
- Browser cache full inventory/permissions, package/build/source contract,
  first-install archive SHA fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04,
  and executable access as dashboard-abbott pass. No browser staging entries.
  Account no-home/no-login and root-only secret-input/rendered-env metadata pass;
  no secret values were emitted.
- Neighbors unchanged: dashboard-next ID1/PID3722244/start122353749/source8f389a2;
  dashboard-zaruku ID2/PID791065/start131477500/sourceaf1948c;
  dashboard-medroche ID4/PID1870897/start139126198/release13d68b0b2c820ba5d223f254bc4eba6d0cf24418.
  Exact previously recorded cwd/UID/GID/release pointers and boot/PM2 daemon pass.
  Nginx hash remains1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c.

Cleanup evidence is limited precisely: the invocation exited before its exact
transient local/SSH PIDs could be recorded. Subsequent local inventories found
zero matching recovery entrypoints, zero recovery SSH transports, and zero
listeners on local3001/3004. The remote recovery-loader inventory is zero.
The combined and Abbott runtime child counts are zero. All read-only tool
sessions exited. No browser/forward was created. These inventories do not
replace the missing PID/start-specific proof or remote acknowledgement.

BLOCKED at ABBOTT_RECOVERY_UNACKNOWLEDGED. Public routing remains on combined3001;
the predecessor backup is preserved and candidate activation is still
inconsistent. Await separate direction; no speculative recovery or retry.

### Recovery diagnostic checkpoint (local only; awaiting review)

Source/tests and the exact earlier invocation metadata were inspected without
SSH or a live request. The earlier single UNACKNOWLEDGED status cannot identify
which transport phase failed. No deterministic protocol cause was established,
and no speculative host, auth, framing authority or recovery-state change was
made. In particular, this checkpoint does not retroactively infer that the
remote loader started or that it refused a particular preflight.

TDD added closed status/stage/reason diagnostics for local spawn, initial
identity proof, source/RUN writes, remote startup, remote preflight, terminal
recovery review, acknowledgement framing, deadline and SSH close. Unknown
errors map to unknown. Remote acknowledgements are strictly bound to allowed
status/stage/reason pairs; secret-bearing or forged/extra/oversized output is
never a diagnostic source. Parent output is one formatted closed line only,
without stderr/stdout, exception text, host, command, path, PID or start time.
Actual local loader tests distinguish startup/import errors from preflight
refusals without disclosing either exception. Recovery mutation logic and pins
remain unchanged.

The owner clarified local evidence ownership: invoking UID, not root, because
the fixed wrapper remains unprivileged. A fixed ignored private directory0700
and identity-only file0600 record the child PID immediately after spawn, then
verified start before any source write, and exit observation/verification.
Publication is atomic and rejects links, unsafe modes, existing directory,
arbitrary fields and malformed identity data. After copying a no-PID boolean
summary internally, the wrapper removes its evidence. Interrupted writes
preserve prior evidence and remove only their own verified temporary inode;
drift refuses without deleting unverified files. No PID/start enters Git or
output. Existing bounded drains, deadlines, ownership-checked termination and
late-close observation remain active on evidence failure too.

Fresh evidence:44 focused recovery tests,328 full authority/artifact/bootstrap/
recovery tests,67 app/runtime tests and61 smoke/asset/orchestrator/capture
regressions passed. Build, root and Abbott typechecks, trusted artifact scan
(2,870 files/82 text files), exact12-route/one-prefix validation, changed-script
syntax and whitespace checks passed. Lint:zero errors/ten existing warnings.
The new failure cases were first observed RED before implementation. Private
fixture directories were removed; real local loader children were reaped and
their PIDs independently absent. All test/build sessions exited, and the fixed
production evidence directory was never created. Its Git ignore rule passed.

STOP for focused re-review. No push, live SSH, recovery retry, credentials,
browser, deploy, smoke/capture or Nginx operation occurred. The last live state
and remote refs remain those recorded in the previous operational entry.

### Approved diagnostic recovery retry: stopped (2026-09-15)

Diagnostics checkpoint received explicit approval. Clean HEAD
e0238f92ba6b8e4cfc734b514580fed1651bed8a passed26 fresh transport/diagnostics/
private-evidence/wrapper tests. Existing complete gate evidence is above.
Ordinary non-force fast-forward pushes updated only the feature and Abbott
release refs; isolated literal remote lookups verified both at that exact HEAD.
Temporary ref-proof directory cleanup passed.

Exactly one reviewed clean-env recovery retry returned:

`ABBOTT_RECOVERY_UNACKNOWLEDGED stage=remote_startup reason=stderr`

No raw stderr/stdout or exception was retained or examined. This closed code
does not establish why SSH/remote startup emitted stderr, does not prove the
remote loader reached preflight, and does not acknowledge recovery completion.
No retry, speculative fix, deploy, smoke, capture, credential use or Nginx action
followed.

An independent bounded read-only local observer consumed only the protected
identity metadata while the retry ran. It held the exact owned SSH identity and
its verified wrapper parent identity in memory, then proved both processes
absent after the evidence file disappeared. No PIDs/start times entered tool
output or this report. The observer returned only
ABBOTT_LOCAL_PRIVATE_EVIDENCE_CLEANUP_VERIFIED and exited. Fixed private evidence
directory absence was independently confirmed; local3001/3004 listeners are
absent. No browser or forward was created.

Narrow read-only post-refusal checks passed with no raw runtime output: active
candidate and old backup source markers/layout remain unchanged; quarantine,
lock, journal and journal.next remain absent. Current pointer is still the
exact old6cd2/f806 record; the previously pinned Abbott kernel identity and
sole loopback3004 listener remain unchanged and bounded health is200. All
neighbor PID/start/cwd/UID/GID/release proofs and the exact prior Nginx hash
remain unchanged. Account and secret-file metadata pass. Combined/Abbott child
counts remain zero; the remote recovery-loader inventory is zero. This narrow
post-check does not claim a fresh full browser/tree attestation or repaired
activation. All read-only tool sessions exited.

BLOCKED at the closed code above. Public routing stays combined3001 and the
interrupted activation remains unresolved. Await direction; no further attempt
is authorized by this report.

### Source-first startup diagnosis and inert probe checkpoint (local only)

The exact fixed command was inspected: root SSH invokes env-i and Node ESM
with an explicit -e loader. There is no sudo command in this path. A new local
shell-bound test ran the identical remote quoting/tokenization, substituting
only the installed local Node executable, with a framed inert source module.
It passed without stderr and reaped its local process. Existing full capsule
syntax checks also pass. This does not establish remote Node behavior or a
deterministic cause for the prior remote_startup/stderr; no speculative
argv/ESM/source-syntax correction or warning suppression was made.

The requested READY boundary was added with RED/GREEN tests: no source or RUN
is transmitted until the exact complete startup marker arrives and the same
owned SSH identity is revalidated. Missing/forged/duplicate-coalesced READY,
startup stderr, cancellation and identity replacement cannot release a frame.
Framing, source hashes and recovery pins/state transitions remain unchanged.

A bounded in-memory stderr classifier now returns only sudo_hostname,
node_syntax, node_warning, permission, missing_binary, ssh_warning or unknown.
All stderr is still fatal; classification never permits a warning or exposes
matched text. Fragmentation, invalid encoding/control data, oversized buffers,
mixed categories and secret-bearing fixtures are covered. At most8,192 bytes
are retained, then zeroed; no raw stderr is saved or returned.

Because source inspection did not determine the cause, the fixed inert probe
was implemented, NOT executed. It reuses the exact same SSH/env/Node loader,
READY/identity boundary, bounded child lifecycle and private evidence. Its
only source is an inert function returning an internal protocol marker; it
loads no recovery source and makes no host filesystem, runtime, database or
network operation. External output is explicitly STARTUP_PROBE_READY or
STARTUP_PROBE_REFUSED with closed enums, never a recovery-restored claim.
Shared local authority checks still require the exact clean worktree, pinned
Node, protected SSH metadata and zero caller arguments/ambient overrides.
The runbook labels this command as requiring separate review and execution
approval; no remote startup probe or recovery retry ran in this checkpoint.

Fresh gates:53 focused recovery/probe tests;337 full authority/artifact/
bootstrap/recovery tests;67 app/runtime tests;61 smoke/asset/orchestrator/capture
regressions all passed. Build, both typechecks, trusted artifact verification
(2,870 files/82 text files), exact12-route/one-prefix validation, changed-script
syntax and whitespace checks passed. Lint:zero errors/ten existing warnings.
Local loader/shell children were reaped and independently absent; test/build
sessions exited and no fixed private evidence directory remains.

STOP for review. No live SSH, remote probe, push, recovery attempt, credential,
browser, deployment, smoke/capture or Nginx change occurred. The last verified
live interrupted state and published e0238f9 refs remain unchanged by this
local-only implementation. The prior startup failure remains unexplained.

### Approved inert startup probe: REFUSED (2026-09-15)

The probe checkpoint received explicit execution approval. Clean HEAD
385e761adfaf8bf85ec29fb65285b42a9d0a1743 passed35 fresh transport/classifier/
evidence/probe/wrapper tests. Only the two authorized refs were fast-forwarded
with ordinary non-force pushes, and isolated literal lookups verified both
remote SHAs equal to that HEAD. The temporary ref-proof directory was removed.

Exactly one reviewed inert probe ran via the fixed clean-env command and
returned only:

`ABBOTT_STARTUP_PROBE_REFUSED stage=remote_startup reason=unknown`

No raw stderr/stdout was examined, saved or reproduced. The closed result does
not establish a particular warning/error type or a remote preflight outcome.
Unknown stderr remains a hard refusal. No recovery was invoked in this turn,
regardless of probe result; no fix, retry, deployment, credentials, browser,
smoke/capture or Nginx action followed.

The bounded private metadata observer verified both the exact owned SSH child
and probe parent absent after their identity evidence disappeared. PID/start
metadata stayed in memory and was never emitted. Private evidence directory
absence and no local3001/3004 listeners were independently confirmed. Observer
and all read-only tool sessions exited. Remote recovery-loader inventory and
combined/Abbott runtime child counts are zero.

Post-probe read-only gates verified the previously recorded live state remains
unchanged: active candidate9aaed34, oldf806 backup, no recovery quarantine/lock/
journal/next file, exact old6cd2 current pointer, same pinned Abbott kernel
identity/UID/GID/cwd, sole loopback3004 listener and health200. All three neighbor
PID/start/cwd/UID/GID/release proofs and the exact prior Nginx hash pass unchanged.
Account and secret-file metadata pass. These are the narrow post-probe checks,
not a new full browser/tree attestation or evidence of restored activation.

BLOCKED at the closed probe refusal above. The live interrupted state remains
unresolved and public routing remains combined3001. Await further direction;
no recovery attempt is authorized by probe completion.

### Staged startup matrix checkpoint (source/tests only)

Implemented three separately selected fixed read-only stages behind the same
SSH option vector, clean environment, private identity evidence and bounded
lifecycle. The ssh stage runs env-i /bin/true and expects empty stdout. The
node stage runs exact env-i /usr/bin/node with a fixed direct-e sentinel. The
loader stage runs the current ESM loader, waits for READY, sends only EOF and
checks the exact terminal refusal. No stage sends source or RUN, creates remote
files, imports recovery code, or changes any runtime. The CLI accepts exactly
one literal stage; there is no automatic fallback chain or arbitrary command.
Recovery itself retains zero-argument invocation and all prior authority gates.

The owner approved additional closed unexpected_output and cleanup_unverified
results so forged stdout and missing cleanup proof are not mislabeled as stderr
or nonzero exit. Output contains only fixed stage/result/category enums: clean,
stderr_known_category, stderr_unknown, exit_nonzero, timeout, unexpected_output
or cleanup_unverified. No raw text, hash, length, path or identity is emitted.
Known stderr remains fatal. SSH tty, known-host and locale warnings now have
bounded anchored family patterns; the prior generic warning-prefix matcher
was tightened to unknown. Node warning families remain bounded/anchored.

TDD first reproduced missing staged API/wrapper and a deadline classification
regression; tests now cover secret-bearing/forged output and summary fields,
wrong stage, all fixed commands, zero source/RUN, loader-only EOF, stderr,
nonzero exit, deadlines and cleanup refusal. Final evidence failure cannot
remain clean. Local shell tokenization tests ran each exact command shape with
installed local executable substitutions only: macOS uses a different true
binary path, which was corrected in the fixture without changing the fixed
production /bin/true command. These local tests do not attest remote binaries.

Fresh gates passed:61 focused recovery/matrix tests;345 full authority/artifact/
bootstrap/recovery tests;67 app/runtime tests;61 separate smoke/asset/
orchestrator/capture regressions. Build, both typechecks, trusted artifact scan
(2,870 files/82 text files), exact12-route/one-prefix validator, changed-module
syntax and whitespace checks pass. Lint:zero errors/ten existing warnings.
All owned local test children were reaped with independent absence checks;
test/build sessions exited, fixture evidence was removed, and the fixed private
evidence directory was not created.

STOP for review before executing any matrix stage. No live SSH, probe, recovery,
push, credential, browser, deploy, smoke/capture or Nginx operation occurred.
The existing interrupted host state and last published385e761 refs were not
changed or freshly revalidated by this local-only checkpoint. Root cause of
the startup refusal remains unknown pending an explicitly approved stage.

### Approved staged inert matrix execution (2026-09-15)

Fresh focused startup/evidence/diagnostic/wrapper tests passed:18/18. Clean
approved HEAD aeb2c4e9e5e55e552510be5078a21a1371a161ec was published by ordinary
fast-forward pushes only to codex/abbott-runtime-isolation and release/abbott.
Both literal remote refs were reread through isolated Git authority and equal
that exact HEAD. No other ref was changed.

Executed each approved fixed stage exactly once, separately, through the exact
clean-env installed-Node CLI. Closed results only:

```
ABBOTT_STARTUP_STAGE stage=ssh result=stderr_unknown category=none
ABBOTT_STARTUP_STAGE stage=node result=stderr_unknown category=none
ABBOTT_STARTUP_STAGE stage=loader result=stderr_unknown category=none
```

Each stage exited refused. No raw stderr/stdout, lengths, hashes or exception
text were inspected or retained. The matrix does not establish a root cause;
the first inert stage already refuses without Node. No recovery source/RUN
was sent, and no recovery was attempted.

For each stage, an independent bounded observer captured its private child and
parent identity metadata in memory, verified both processes absent after exit,
and verified the protected evidence file/directory removed. All three emitted
ABBOTT_LOCAL_PRIVATE_EVIDENCE_CLEANUP_VERIFIED. All six stage/observer sessions
were reaped. Subsequent checks emitted ABBOTT_LOCAL_VERIFICATION_PORTS_CLEAR
and ABBOTT_REMOTE_RECOVERY_INVENTORY_CLEAR. No browser or credential resources
were created.

The bounded read-only post-matrix proof emitted
ABBOTT_POST_MATRIX_STATE_VERIFIED. The known interrupted layout is unchanged:
active candidate9aaed34; sealed oldf806 backup and old6cd2 current pointer;
quarantine, deploy lock, recovery journal and next file absent. Exact pinned
Abbott kernel identity/UID/GID/cwd, sole loopback3004 listener and health200
remain unchanged. All three neighbor PID/start/cwd/UID/GID/release proofs and
the prior exact Nginx config hash pass unchanged. Account and secret-file
metadata pass. These are narrow marker/metadata checks, not a fresh full-tree
or browser attestation, PM2-environment read, or evidence of restored activation.

BLOCKED: all three inert stages returned the closed stderr_unknown result.
No speculative fix or retry, recovery, deployment, token issuance, smoke,
capture or Nginx action followed. Public routing remains combined3001 and the
interrupted Abbott state remains unresolved. Stop for direction with this
sanitized evidence-only commit; no publication of the evidence commit.

### Staged exit precedence correction (source/tests only)

Review identified that the first matrix prioritized stderr over a failing SSH
exit. Its three stderr_unknown results therefore do not establish connection,
authentication or remote execution success; they may mask nonzero transport
exits. No reclassification of those historical results is claimed and no raw
output was recovered or inspected.

TDD reproduced the defect through the real staged transport and public wrapper:
secret-bearing stderr plus a verified nonzero exit incorrectly returned
stderr_unknown. The minimal production change now prioritizes cleanup_unverified,
then exit_nonzero for nonzero/signal exit, then timeout, then zero-exit stderr
classification. Stderr on zero exit remains fatal. A reached deadline ending in
verified zero exit remains timeout; a terminated child reports exit_nonzero.
No numeric status, signal name, raw stderr, optional new category or authority
change was introduced. Recovery result handling/lifecycle is unchanged.

Regressions cover all three stages with known and secret-bearing unknown stderr,
nonzero and signal exits, exact closed wrapper output, higher-priority unverified
cleanup, deadline exit distinctions and evidence failure. The signal fixture
emits the actual signal in the close event. RED was observed before the fix;
GREEN passed afterward. Runbook documents precedence and the limits of the
historical matrix evidence.

Fresh gates passed:45 focused transport/probe/evidence/diagnostic tests;
347 full authority/artifact/bootstrap/recovery tests;67 app/runtime tests;
72 smoke/asset/capture/issuer/diagnostic tests;23 orchestrator regressions.
Abbott build, both root and Abbott typechecks, artifact scan (2,870 files/82
text files), trusted artifact verification, exact12-route/one-prefix validator,
changed-module syntax and whitespace checks pass. Lint:zero errors/ten existing
warnings. An initial workspace typecheck command referenced an absent npm
script; the direct installed TypeScript command passed. An extra test invocation
omitted the required tsx loader and failed module resolution; the same suite
passed with --import tsx. Neither invocation correction required source changes.

All test/build sessions exited. Local loader/tokenization children were reaped
and absence-checked by tests; fixture resources were cleaned, and the fixed
private evidence directory remains absent. No live SSH, staged probe, recovery,
push, credentials, browser capture, deployment or Nginx action occurred. Host
state was not revalidated in this source-only checkpoint. STOP for review before
any retry; interrupted activation remains unresolved by this work.

### Approved corrected-precedence matrix execution (2026-09-15)

Clean approved HEAD7188a843f87b4b68875727ac4107735764c69cf9 was published by
ordinary fast-forward pushes only to codex/abbott-runtime-isolation and
release/abbott. Isolated literal remote lookups verified both refs equal that
exact SHA. No other ref was changed. The preceding source checkpoint's fresh
gates are recorded above; this turn changed evidence only.

Ran each fixed clean-env stage exactly once, separately, after verifying prior
stage cleanup. The exit_nonzero stop condition did not occur. Closed results:

```
ABBOTT_STARTUP_STAGE stage=ssh result=stderr_unknown category=none
ABBOTT_STARTUP_STAGE stage=node result=stderr_unknown category=none
ABBOTT_STARTUP_STAGE stage=loader result=stderr_unknown category=none
```

With reviewed corrected precedence, these results establish verified zero SSH
exit with unrecognized stderr, not a hidden nonzero/signal exit. They do not
establish clean stdout or successful remote sentinel/loader readiness because
stderr still takes precedence over output validation. No raw streams, warning
text, lengths, hashes or exception contents were inspected or persisted. Root
cause remains unknown; no warning was bypassed and no recovery was attempted.

For each stage, independent bounded observation verified the captured owned
SSH child and wrapper absent after exit and the private identity evidence
file/directory removed. All three cleanup observations returned
ABBOTT_LOCAL_PRIVATE_EVIDENCE_CLEANUP_VERIFIED; all six sessions were reaped.
Final checks returned ABBOTT_LOCAL_VERIFICATION_PORTS_CLEAR and
ABBOTT_REMOTE_RECOVERY_INVENTORY_CLEAR. No credential or browser resource was
created.

The bounded read-only proof returned ABBOTT_POST_MATRIX_STATE_VERIFIED. Known
interrupted layout, old current pointer/backup, pinned Abbott kernel identity,
UID/GID/cwd, loopback-only listener and health remain unchanged. Quarantine,
lock/journal/next remain absent. All three neighbor process/start/cwd/UID/GID/
release proofs, account/secret-file metadata and exact Nginx hash pass unchanged.
This narrow proof is not a fresh full-tree/browser attestation or evidence of
restored activation. Public routing remains combined3001; active candidate9aa
and old6cd2/f806 control pointer remain the unresolved interrupted state.

BLOCKED at the closed stderr_unknown results. No further probe/retry, recovery,
deploy, smoke, capture or Nginx action. Stop with sanitized evidence-only commit;
do not publish this evidence commit without new direction.

### Recovery/probe SSH client log-level checkpoint (source/tests only)

Added exactly -o LogLevel=ERROR to the single fixed recovery/probe SSH option
vector. This controls SSH client diagnostics, not remote stderr. Stdio remains
three pipes, remote command bytes and framing remain unchanged, and every
received stderr byte remains bounded/fatal with closed diagnostics. Nonzero/
signal exits retain priority and cannot be accepted; cleanup-unverified remains
highest. No stderr shell redirection, stream filter, generic warning acceptance,
credential/deploy transport change or authority override was introduced.

TDD exact-vector regression failed before the option existed and passed after
the one-line production change. It checks recovery plus all three inert stages,
the complete fixed SSH argv prefix, binary, cwd, constructed env and pipe-only
stdio. Synthetic remote stderr on zero exit still refuses; synthetic connection
and authentication errors with failing exit still return exit_nonzero for each
stage. Recovery refuses all those cases without sending a frame. Secret-bearing
chunks are zeroed and diagnostics contain no supplied values/raw error text.

Fresh gates passed:47 focused recovery/probe/evidence/diagnostic tests;
349 full authority/artifact/bootstrap/recovery tests;67 app/runtime tests;
95 smoke/asset/capture/issuer/orchestrator/diagnostic regressions. Abbott build,
both typechecks, exact12-route/one-prefix validator, artifact scan (2,870 files/
82 text files), trusted artifact verification, changed-module syntax and
whitespace checks pass. Lint:zero errors/ten existing warnings. The first extra
suite overlapped the rebuild and failed one generated-HTML fixture read while
the file was absent; after the completed build the full95 suite passed without
test or source changes. Generated-asset tests must follow, not overlap, builds.

All local test/build sessions exited; tests reaped and absence-checked their
owned loader/shell children. Fixture resources were cleaned and the fixed
private identity evidence directory remains absent. No live SSH/probe/recovery,
push, credentials, browser capture, deployment or Nginx operation occurred.
Historical unknown stderr is not newly classified, and no claim is made that
the live failure is resolved. STOP for review before retry; interrupted Abbott
activation remains unresolved and was not revalidated by this local checkpoint.

### Approved matrix and single predecessor recovery (2026-09-15)

Clean approved HEAD982dd1ad5152a7bd832a2d4c6efae9de34330e2a was published with
ordinary fast-forward pushes to codex/abbott-runtime-isolation and release/abbott
only. Isolated literal remote lookups verified both refs equal that exact SHA.
The preceding implementation's full fresh gates are recorded above; this turn
changed evidence only.

Ran each fixed clean-env inert stage once, with independent owned-process and
private-evidence cleanup verified between stages:

```
ABBOTT_STARTUP_STAGE stage=ssh result=clean category=none
ABBOTT_STARTUP_STAGE stage=node result=clean category=none
ABBOTT_STARTUP_STAGE stage=loader result=clean category=none
```

The fresh read-only check invoked only initial verification in the exact
committed recovery adapter/worker/source-proof modules, without recovery steps.
It checked both sealed trees and overlays, exact control/manifest pins, source
and installed-Next proof, pinned Abbott process/binding/kernel identity, health,
listener, neighbors and Nginx. It returned ABBOTT_RECOVERY_INITIAL_PROOF_VERIFIED.
Its bounded SSH process was reaped and independently absence-checked.

Executed the single approved fixed recovery CLI through env-i, installed Node,
bounded transport and private identity evidence. The command independently
rechecked all initial and under-lock preconditions. It returned:

```
ABBOTT_RECOVERY_RESTORED stage=complete reason=none
```

Independent read-only post-recovery verification returned
ABBOTT_POST_RECOVERY_VERIFIED. The unchanged trusted worker fully attests active
f80607fbc8a693aa2c720b0976938e88732cdf1a, release6cd2f12e245a47dcbd5f6ce928c4ed83,
manifest7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f,
and exact current pointer. The predecessor backup was atomically consumed into
the active path. PM2 registration5, source/release binding, active files and new
kernel process identity agree; UID982/GID984, sole loopback3004 listener and
database health pass. The old interrupted-process identity is absent; the new
identity was captured in memory and rechecked unchanged, without emitting IDs.

Candidate9aaed34/e9e548a6414c4d8c836c7715c66f37ad and its exact a62b6297 manifest
are preserved and freshly full-tree attested at the fixed interrupted-recovery
quarantine path. No candidate promotion occurred. The deployment lock and
journal next file are absent. Per explicit reviewed clarification, the audit
journal is intentionally retained: exact version/state restored, pinned old/
candidate references and original identity fields, root:root0600, regular file,
single link. It is not an active lock or cleanup failure; no journal was deleted.

The entire browser inventory/stamp was revalidated against exact installed
package/build/source contract and original archive SHA
fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04.
Root/group immutable modes, executable access as UID982/GID984, shared libraries
and writable temporary-directory access pass. Browser-cache is the sole browser
parent entry, with no staging residue. No install/download occurred.

All three neighbor process/start/cwd/UID/GID/release proofs and the prior exact
Nginx hash pass unchanged. Source/Next proof, account and secret-file metadata
pass. Public routes remain on combined3001; no Nginx backup/change/reload was
needed or performed. This is a verified recovery, not a cutover or PDF/parity
acceptance. The restored predecessor still lacks the newer browser env wiring;
the reviewed PM2 release-binding deployment defect requires its separate repair
checkpoint before any next candidate deployment.

All four stage/recovery child-wrapper observer pairs returned
ABBOTT_LOCAL_PRIVATE_EVIDENCE_CLEANUP_VERIFIED. Every local execution session
ended, private evidence was removed, and final checks returned
ABBOTT_REMOTE_RECOVERY_INVENTORY_CLEAR, ABBOTT_LOCAL_VERIFICATION_PORTS_CLEAR
and ABBOTT_PRIVATE_EVIDENCE_ABSENT. Read-only verification SSH children were
reaped/absence-checked too. No credentials or browser sessions were created.

DONE_WITH_CONCERNS: recovery complete and host safe on the sealed predecessor;
Task9 release repair/parity/capture/cutover remain incomplete. No deployment,
smoke, capture, fact/DB/auth mutation, neighbor process action or Nginx action
followed recovery. Stop for review/direction. This sanitized evidence-only commit
is local and is not published without new authorization.

## Checkpoint B — fresh Abbott PM2 registration, source/TDD only

Implemented the parent-approved Abbott-only activation repair. The fixture now
models PM2 correctly: stop retains the old registration/env until an explicit
delete. The retained-env regression failed against the prior activation path,
then passed with exact predecessor stop/delete and a fresh fixed-ecosystem
start. Non-Abbott activation and the dedicated historical recovery API remain
unchanged. No generic deployment framework or alternate authority was added.

Before activation, the worker proves the exact predecessor registration,
PID/start/UID/GID, launcher/cwd, release/source, sole loopback listener and health,
plus sealed active/candidate trees, protected records, env metadata/digests,
directory identities, original pointer bytes and absence of the backup slot.
It re-proves the registration immediately before stop and delete, verifies the
old kernel PID has exited, and starts only after registry/listener absence.
Fresh candidate binding, stable live identity, online status, full tree/env,
listener and health must all pass before pointer publication.

Failure compensation stops/deletes only a provably owned candidate, restores
the exact old tree/env/pointer bytes and starts the predecessor fresh. Its old
binding/listener/health must then pass. Failed owned predecessor startups are
stopped; uncertain replacement identities are never touched. Unresolved drift
preserves both trees where available plus root-only lock/journal for review;
the worker does not claim an unproven replacement was stopped. Atomic journal
states distinguish committed, restored and review_required. A fully restored
failure clears the lock but retains its audit journal, as does successful
activation. Journals contain metadata only, never env values.

Additional observed RED/GREEN regressions cover online status, remote signal
guard wiring, pointer drift with owned-candidate shutdown, last-boundary identity
drift, exact original pointer-byte restoration, unsafe predecessor env mode and
candidate registration disappearance after final health. Synthetic fault cases
cover stop/delete/start errors before and after side effects, both atomic tree
moves before/after failure, PID/start/UID/GID/release drift, partial inactive
registrations, predecessor restart failure, and cancellation at prepared, stop,
delete, both renames, start, candidate_started and pointer publication. The real
command adapter test confirms exact fixed PM2 start/delete argv and no retained
env merge. No test performs live SSH, PM2 or production filesystem actions.

Fresh final local gates:

| Gate | Result |
| --- | --- |
| Abbott production build and sealed route gate | Pass; 12 exact routes, one asset prefix |
| Abbott app/contract tests | 67/67 pass; repeated locally after build |
| Full authority/bootstrap/browser/recovery/deploy/artifact suite | 388/388 pass |
| Smoke/asset/issuer/visual/orchestrator regression suite | 95/95 pass, after build |
| Sealed artifact verification | Pass; 2870 files, 82 text files |
| Root and Abbott TypeScript checks | Pass |
| ESLint | Exit 0; 0 errors, 10 existing warnings |
| Changed-module syntax and whitespace checks | Pass |

Verification-before-completion required fresh gates after the final stale-proof
fix; earlier intermediate runs are not substituted for this evidence. The
debugging, TDD and executing-plans skills guided the isolated fixture and phased
compensation implementation. The runbook now explains changed PM2 IDs, exact
authority, audit/lock behavior and the mandatory pre-execution review stop.

All local test command sessions exited. No owned browser/SSH resources were
created, and the fixed private recovery-evidence directory is absent. No
credentials were minted/read, no production proof was rerun, and no push,
deployment, browser download, parity/capture, DB/auth/fact/cron change, neighbor
process action or Nginx operation occurred. Latest published refs remain
982dd1a; fc0bcb6 remains the preceding local recovery-evidence commit.

Concerns: this source change is not authorized for live execution until reviewed.
The deploy SSH transport/options are deliberately unchanged; the recovery-only
transport fixes do not prove a future deploy transport invocation. Signal guards
yield between activation phases and existing OS commands remain bounded, but
abrupt unrecoverable worker death requires protected journal/lock inspection,
not an automatic-success assumption. Last verified production rollback target
remains f80607f/release6cd2, with candidate9aaed34 preserved; no new release,
Nginx backup, screenshot dimensions/diff or post-deploy smoke result exists in
this source-only checkpoint. STOP for checkpoint B review before any live use.

## Checkpoint B follow-up — acknowledged Abbott deploy transport

Source inspection confirmed the remaining transport gap: the prior Abbott
driver used blocking SSH, consumed EOF as the whole payload, and could time out
without waiting for activation compensation. The parent approved a dedicated
Abbott-only framed transport, with exact-schema internal metadata paired to
capsule/payload digest and control ID. This follow-up implements that design;
non-Abbott transfer options/behavior and the dedicated recovery transport remain
unchanged. No generic transport framework or caller-selectable target was added.

The fixed deploy/rollback driver now awaits the Abbott transport for inspection
and mutation. SSH uses the reviewed fixed host/user/key/known-hosts and closed
options, no proxy/agent/reuse, and only constructed PATH; remote Node uses an
empty environment. Source (maximum1MiB) and sealed artifact request
(maximum512MiB) travel in separate hash/length-checked stdin frames after exact
READY and owned PID/start proof. RUN follows completed writes once; ABORT/EOF
feed the same transaction guard used by remote signals. Runtime secrets remain
host-side under the unchanged input/rendered-env contract.

The worker's acknowledgement adapter uses its own internal state transitions,
never exception text, to distinguish completed, restored, refused and protected
review states. Its result follows transaction lock cleanup. REVIEW_REQUIRED
requires successful publication of the owned review journal; inability to
verify/write journal or lock cleanup remains UNACKNOWLEDGED. It does not claim
an unowned replacement process was stopped. An unexpected exception after
entering the transaction produces no valid paired acknowledgement.

The response permits only one canonical record with five existing fields and
one terminal ACK, agreeing on exact source/payload digest and control ID. Hex
lengths, scalar types, null predecessor, scope and key set are bounded. Extra
keys, duplicate JSON fields, coerced arrays, duplicate/out-of-order frames,
wrong digest/control ID and unexpected output cannot pass. All records remain
internal; CLI output is one closed status/stage/reason line. Child stderr is
always fatal, zeroed and never relayed. No token, URL, arbitrary path, raw body,
header, process environment or child error text appears in public diagnostics.

Post-spawn drains, exit observation, identity evidence and cleanup deadlines
precede PID proof/dispatch. The parent requests ABORT/EOF at240s and waits for
compensation before exact PID/start-checked TERM at540s and possible KILL at600s;
the observation budget is605s. Lost ACK, SSH failure or unverified PID exit can
never report success. Unverifiable/reused PIDs are not killed; live close/drain
observation remains and no cleanup success is inferred. Local private evidence
uses a fixed ignored invoking-user0700 directory and atomic0600 identity-only
file; a no-PID summary is copied before owned evidence removal. Any evidence
failure prevents success. Session-finally zeroes source/payload buffers, and
transport zeroes response/header buffers. Parent signal handlers span transport
and evidence cleanup.

TDD evidence: the initial18 tests failed for the missing protocol/driver path,
then passed. Additional observed RED/GREEN cases caught early result acceptance
before RUN, scalar coercion in record fields, forged metadata at the evidence
wrapper, non-closed CLI refusal, acknowledgement despite an unverifiable review
journal, and duplicate RUN acknowledgement. Tests use fake SSH and local Node
loader children only; the exact remote shell tokenization and actual captured
worker/browser capsule syntax are checked locally without SSH or mutation.

The interruption matrix adds36 worker cases: signal/EOF/connection-loss abort
semantics before and after stop, delete, both active-tree renames, fresh start
and pointer publication. The actual local loader separately proves signal,
stdin EOF and ABORT reach the guard and await terminal completion. These are
composed loader/worker proofs, not production-network experiments. Existing
activation tests retain coverage for partial registrations, PID reuse, failed
predecessor restart and protected locks. Transport tests cover initial proof
failure/shared setup errors, missing/forged/oversized/late output, write errors,
upload cancellation, missing ACK, hung SSH, PID reuse and bounded observation.

Fresh final gates:

| Gate | Result |
| --- | --- |
| Abbott production build and exact route gate | Pass |
| App/contract tests | 67/67 pass |
| Full authority/bootstrap/browser/recovery/deploy/artifact suite | 455/455 pass |
| New dedicated transport/evidence/session tests (included above) | 29/29 pass |
| Post-build smoke/asset/issuer/visual/orchestrator tests | 95/95 pass |
| Sealed artifact verification | Pass; 2870 files, 82 text files |
| Both TypeScript checks, changed-module syntax, whitespace | Pass |
| ESLint | Exit0; 0 errors, 10 existing warnings |

All local loader/test commands exited; loader tests verify their owned child
PIDs absent. Both fixed private evidence directories are absent. No browser or
SSH process was launched, no credentials were read/minted, and no production
request, push, deploy, smoke/capture, DB/auth/fact/cron/neighbor or Nginx action
occurred. Last published refs still982dd1a; preceding local checkpoint is21495e9.
Last verified live rollback target remains f80607f/release6cd2 and candidate9aaed34
remains last-known quarantined; this source checkpoint does not freshly attest
those facts. No new Nginx backup or visual dimensions/diff evidence exists.

DONE_WITH_CONCERNS: transport and activation require independent review before
any operational retry. Bounded cancellation is cooperative; catastrophic worker
death or an unverifiable child still requires read-only ownership/journal
inspection rather than a cleanup claim or automatic retry. This supersedes the
preceding source checkpoint's unchanged-Abbott-transport caveat, not its live-use
prohibition. Debugging/TDD and verification-before-completion guided the
implementation and fresh checks. STOP before push/live/deploy/Nginx.

## Review correction — reject incomplete deploy control frames

Fixed the Important loader framing gap with real local-process TDD. RED evidence:
valid source/payload frames followed by RUN plus a one-byte trailing fragment
returned COMMITTED; an incomplete ABORT at EOF returned RESTORED. The new held-
cleanup fixture also showed malformed bytes could bypass the intended abort.
These were local synthetic results, not production operations.

The loader now checks exact possible control prefixes immediately. After RUN,
any received control fragment starts the existing abort guard; impossible
prefixes, duplicate controls and bytes after a completed ABORT are rejected.
Terminal serialization cannot leave pending control bytes: incomplete state is
rejected, zeroed and cleared first. EOF/error with a partial RUN/ABORT is refused.
When malformed traffic interrupts started work, the loader waits for the
transaction to settle and emits only REFUSED or the worker's verified
REVIEW_REQUIRED; it cannot turn that traffic into COMMITTED or RESTORED. Unknown
transaction/journal outcomes still produce no valid paired acknowledgement.

Exact RUN without trailing bytes still commits. Clean EOF still follows the
reviewed cancellation/restoration path, not a framing error. Complete ABORT,
including deliberately split delivery completed before terminal cleanup, still
restores. If only a partial command remains when work settles, it is refused;
the terminal gate does not guess that a future fragment will complete it.

Added57 real-loader cases: one-through-five-byte trailing suffixes, every partial
ABORT/RUN prefix, duplicate RUN, whitespace/newline/NUL, bytes after ABORT,
same-chunk and per-byte delivery, active-work EOF, and incomplete first control
at EOF. Held compensation must be explicitly released by the fixture before any
ACK can appear. Each local child is bounded, reaped and PID-absence checked.
The earlier duplicate-command test now expects the requested fixed REFUSED
result after settled compensation, never successful acknowledgement.

Fresh gates: dedicated transport/session/evidence86/86; full authority suite
512/512; app/contract67/67; production build/exact route gate pass. Both
TypeScript checks and changed-module syntax/whitespace checks pass; lint exits0
with0 errors and the same10 existing warnings. Post-build smoke/asset/issuer/
visual/orchestrator95/95 and sealed artifact verification pass (2870 files,
82 text files). Verification-before-completion uses these fresh checks, and
TDD guided the framing/terminal fix.

No live request, SSH, browser, credential read/issuance, push, deployment,
DB/auth/fact/cron/neighbor action or Nginx change occurred. Both fixed private
evidence directories are absent, all test commands exited, and no owned loader
child remains. Last verified production state is still the earlier recovered
f80607f/release6cd2 with candidate9aaed34 quarantined; no fresh host assertion is
made. Latest published refs remain982dd1a; this builds on localc2b29d3. No new
release, Nginx backup, live smoke or screenshot/diff evidence was produced.
DONE_WITH_CONCERNS: STOP for re-review before push or any operational retry.

## Approved acknowledged deployment — 2026-09-15

Explicit approval authorized exactly6f09982 and one Abbott-only deployment,
followed by a pin-only local checkpoint. Clean worktree and literal Git authority
were verified; ordinary non-force fast-forward pushes updated only
`refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Both literal remote SHAs were reread and exactly equal
`6f09982fb1e8068f02340ddfcb5c945fb02ebfd5`. No other ref was written.

Immediately before the deploy, the independent read-only proof returned
`ABBOTT_POST_RECOVERY_VERIFIED`. It attested host/boot/source/parser identity,
old active/current/control/PM2 bindingf80607f/release6cd2, Abbott ID5 service
identity, exact kernel PID/start, sole loopback3004 and database-connected health.
It also attested the quarantined9aa tree, restored root-only recovery journal,
absent lock and old backup slot, browser package/build/archive/tree/UID execution
and shared libraries, secret-file metadata, neighbors and Nginx hash. No secret
values or environment contents were output.

The one fixed `npm run deploy:abbott` invocation used `/usr/bin/env -i`, the
verified installed Node/npm25.6.1 path and only its non-secret fixed executable
PATH. The reviewed wrapper performed its clean-ref checks, `npm ci`, production
Abbott build, full runtime gates, artifact verification/boot and the acknowledged
transaction. The source gate has67 app/contract and512 authority/bootstrap/
browser/recovery/deploy/artifact cases; the command exited0 after these gates.
Build/test child logs remain suppressed by the reviewed deployer, rather than
being relayed from the operational command. The final result was exactly
`ABBOTT_DEPLOY_COMMITTED stage=complete reason=none`.

An independent post-deploy read-only verifier then returned
`ABBOTT_POST_DEPLOY_VERIFIED` with these exact non-secret release fields:

| Field | Verified value |
| --- | --- |
| Release/control ID | `8c79caf495f147ad91b2174b9bc5f65c` |
| Source commit | `6f09982fb1e8068f02340ddfcb5c945fb02ebfd5` |
| Manifest SHA256 | `a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2` |
| Predecessor/rollback | `6cd2f12e245a47dcbd5f6ce928c4ed83` / `f80607fbc8a693aa2c720b0976938e88732cdf1a` |

Active tree, source stamp, byte-equal current/control record, trusted manifest and
full artifact all attest. The new PM2 registration is different from old ID5;
its exact PID/start/UID982/GID984, protected launcher, Abbott cwd and candidate
source/control binding match the root-only ownership receipt. It is online, has
the sole127.0.0.1:3004 listener and passes database-connected health, including
repeat identity/readiness checks. PID/start metadata stayed in protected host
evidence and in-memory verification, not raw PM2 output. The activation audit
is committed, root:root0600 single-link; the lock and staging path are absent.
The earlier restored recovery audit remains root:root0600, intact and restored.

The predecessor full sealed tree now exists at
`/var/www/dashboard-abbott-backups/6cd2f12e245a47dcbd5f6ce928c4ed83` and attests
against its unchanged control/manifest. The interrupted candidate remains fully
attested at its existing e9e548a quarantine path. No predecessor or quarantined
tree was deleted. The verified browser remains chrome-headless-shell146.0.7680.76,
puppeteer-core24.39.1 / browsers2.13.0, with unchanged archive SHA
`fa769d4b10dd6efd02284749029f15bc51a4adaa28b3b3e8d7740cec3d792d04`.
Package/build contract, immutable cache contents, UID982 execution, shared
libraries and writable `/tmp` passed. The candidate rendered env contains the
exact verified executable path and fixed loopback runtime settings; no values
were printed. No browser install/download or live browser launch occurred here.

Neighbor evidence passed identically before and after:

| Runtime | PM2 ID / PID / kernel start | Unchanged release |
| --- | --- | --- |
| dashboard-next | 1 / 3722244 / 122353749 | `8f389a28df1c4b741ec33b7538f0354b74f5a40e` |
| dashboard-zaruku | 2 / 791065 / 131477500 | `af1948c8b9a0f70d8696afb9c8abc254408a5daa` |
| dashboard-medroche | 4 / 1870897 / 139126198 | `13d68b0b2c820ba5d223f254bc4eba6d0cf24418` immutable pointer |

Each neighbor's exact cwd and UID/GID also matched. Nginx remained a regular
single-link file with SHA256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
No Nginx backup, edit, test/reload or route switch occurred; public Abbott traffic
still uses3001. No neighbor process/write/release, DB migration/fact/auth change,
password rotation, collector/cron or shared-login change occurred.

The deploy's three owned SSH transfers were observed through the reviewed
0700/0600 local private evidence. Their exact PID/start metadata was captured
only in memory; all three children and their wrapper exited. The observer
returned `ABBOTT_LOCAL_DEPLOY_CLEANUP_VERIFIED transports=3`. Both fixed local
private evidence directories are absent; independent read-only SSH also exited.
No local3001/3004 listener remains. No manager/embed credential was minted or
used; transport buffers were zeroed by the reviewed wrapper. There are no owned
browser sessions or new screenshot artifacts to clean up.

## Pin-only post-deployment review checkpoint

Changed only the asset attestation's literal release ID, source SHA, manifest
hash and exact observed predecessor pin. No attestation logic was weakened.
TDD RED showed the new deployed fixture refused and the predecessorf806 fixture
incorrectly accepted under the old pins. GREEN accepts the observed6f09982
release and rejects oldf806 plus incorrect predecessor pointers:4/4 tests pass.
The broader local smoke/asset/issuer/visual/orchestrator suite passes97/97 with
its required `--import tsx` harness. An initial invocation without that harness
failed three module/Next-import cases; the corrected invocation passed without
any source change. Both TypeScript checks, changed-file syntax and whitespace
checks pass. Lint exits0 with0 errors and10 unchanged warnings.

Verification-before-completion required independent operational proofs and fresh
pin checks; TDD constrained the change to the observed immutable authority.
The pin commit is local only, not pushed or deployed. No live smoke, credential
issuance, capture, PDF request or Nginx action is authorized by this checkpoint.
No six-image dimensions/diff or post-cutover smoke result is claimed. STOP for
focused pin review before its publication and any live parity retry.

## Approved pin publication and single smoke — 2026-09-15

Pin checkpoint53f01c9 received independent approval. The clean exact HEAD
`53f01c92ac5b23696aab0411379e6a8e3d3402a1` was ordinarily fast-forward pushed to
only `refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`;
both literal remote refs were independently reread and matched exactly. No
redeployment was performed because the checkpoint changed pins/tests/report only.
The deployed source remains6f09982, release8c79 and manifesta5b56e3 as recorded
above. The exact independent full post-deploy proof passed immediately before
the verification attempt.

Executed exactly one `smoke` invocation of the reviewed local orchestrator under
a clean environment with the verified installed Node executable. The fixed
period remains2026-09-01..2026-09-13 and the exact deployed manifest pin applies.
Child stdout/stderr were retained only in bounded memory; the wrapper emitted
only the allowlisted diagnostic and no-PID cleanup result:

`ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=failed`

`ABBOTT_VERIFICATION_OWNED_CLEANUP_VERIFIED`

No more specific cause is established by this closed code. In the reviewed
sequence asset attestation precedes issuer execution, so no real manager/embed
credential frame was minted or consumed and no credentialed smoke requests or
PDF/Excel/browser capture were reached. No raw remote stdout/stderr, secret,
response, token URL, environment value or private row was exposed. The approved
failure instruction was followed: no retry, diagnostic/source fix, visual
capture, Nginx implementation or production Nginx action.

The owned orchestrator PID/start, forward PID/start from its exact lifecycle
records, and observed descendant identities stayed in memory. Exit was verified
for all captured PIDs; the final forward record also attested exit. Local3001/
3004 listeners are absent. The fixed private evidence directories are absent;
there is no smoke report or partial candidate directory. All observation and
independent SSH sessions exited. The Playwright skill's ownership/cleanup rules
were retained, but the conditional browser phase was never entered, so there is
no new browser session, screenshot dimension/diff or visual approval.

After refusal, the independent full read-only proof again returned
`ABBOTT_POST_DEPLOY_VERIFIED` for exact release
`8c79caf495f147ad91b2174b9bc5f65c`, source
`6f09982fb1e8068f02340ddfcb5c945fb02ebfd5`, manifest
`a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2`
and predecessor`6cd2f12e245a47dcbd5f6ce928c4ed83`. It reattested full active and
rollback/quarantine trees, current/control/ownership receipt, exact fresh Abbott
registration/PID/start/UID982/GID984, soleloopback3004/health, browser package/
archive/executable/env metadata, committed/restored root-only audits and absent
lock/staging. This independent proof does not substitute for the failed smoke
asset-attestation gate.

Neighbor IDs/PIDs/start/cwd/release pointers remain exactly as in the preceding
table, and Nginx remains unchanged at SHA256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.
Public routing still uses3001. No backup/reload/cutover, deployment, neighbor
process/write/release, DB/auth/fact migration/write, secret rotation or cron change
occurred in this turn. Rollback target remains the retainedf80607f/release6cd2.
This checkpoint changes only sanitized report evidence; no source was altered.
BLOCKED pending further reviewed direction, not an automatic retry.

## Source-only asset-attestation diagnosis and closed subreasons

Compared the fixed remote paths, invocation, current/record fields, predecessor,
manifest schema, limits and public-prefix handling against the preceding
sanitized6f09982/8c79/a5b56e3/6cd2 evidence and the committed installer. No
deterministic mismatch was found: the current pins match the observed record;
the installer publishes exactly those five record fields, and the preceding
independent host proof checked their current/record byte agreement and full tree.
Before rebuilding locally, the retained deployed artifact manifest independently
hashed toa5b56e3, was version1/739144 bytes with2883 entries and13 public assets,
all public entries of the expected schema, file type and0644 mode with permitted
path characters. The asset capsule was28554 bytes, below262144. These bounded
non-secret observations do not prove the live attestation transport or every
metadata predicate passed; they therefore do not justify a speculative fix.

Added a committed sanitized fixture containing only the actual observed release
record. It accepts8c79/6f09982/a5b56e3 with predecessor6cd2; oldf806, wrong source/
hash/predecessor and malformed records refuse. The exact-five-field check now
also rejects additional authority fields. TDD demonstrated that extra fields
were previously accepted; this validation tightening is not identified as the
live refusal's cause. All fixed pins, full manifest/file hashing, exact pointer
bytes, bounded reads, no-link/owner/mode checks, public inventory completeness,
path and split-prefix mapping remain unchanged.

Remote failure formatting now uses only privately branded enums:
record_schema, pin_mismatch, tree_hash, asset_prefix, predecessor, transport,
source_proof, metadata or unknown. Error messages, stacks, causes and arbitrary
properties are never read for diagnostics. The local parent accepts the specific
reason only with exit1, no signal, empty stdout and one exact bounded known
stderr frame. Other status/signal/output/size/framing combinations remain fatal
transport refusals; no raw child stream or value is relayed. Existing parent
output remains `ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=<enum>`.
Attestation still precedes issuer execution, and the same forward abort/cleanup
and buffer-zeroing paths remain in force.

TDD RED showed the missing remote formatter, generic parent reason instead of
the expected enum, and acceptance of extra record fields. GREEN includes each
asset category, secret-bearing errors/properties, unknown/forged/extra/oversized/
CRLF frames, exit0-with-stderr, signal/nonempty-stdout rejection, no issuance on
refusal, buffer zeroing, handler removal and completed forward cleanup. A real
local pipe-only child executes the data-URL module and emits only the fixed
source-proof refusal. Its test-only setup models an empty remote environment:
local macOS adds one environment entry even under env-i, so the first local
fixture correctly refused at transport. No production environment rule was
relaxed and no inference about the remote environment is made from that fixture.

Fresh gates: focused asset/diagnostic/orchestrator36/36; broader smoke/asset/
issuer/visual/orchestrator102/102; app/contract67/67; full authority/bootstrap/
browser/recovery/deploy/artifact512/512; production build and exact12-route/
1-prefix gate pass. Both TypeScript checks, source/test syntax and whitespace
checks pass. ESLint initially caught a fixture variable named module; renaming
that local variable resolved it. Final lint exits0 with0 errors and the same10
existing warnings. Sealed local artifact verification passes (2870 files,
82 text files). Runbook now records the current deployed pin and diagnostic
review stop without authorizing new operations.

Systematic debugging/code-review reception prevented a speculative compatibility
change; TDD and verification-before-completion governed the diagnostic and gate
evidence. All local test/loader processes completed, both fixed private evidence
directories and local3001/3004 listeners are absent, and no browser/SSH was
started in this turn. No real credential, runtime env, DB/auth/fact, collector/
cron/neighbor, deployment or Nginx operation occurred. Published refs remain
53f01c9; preceding local evidence commit is7b7b9ec. No new screenshot/diff,
Nginx backup or live parity result is claimed. Rollback target remains the
last-verifiedf80607f/release6cd2. DONE_WITH_CONCERNS: STOP for review before
push, host diagnosis or any live retry.

## Approved diagnostic publication and single retry — 2026-09-15

Following independent approval, the clean exact HEAD
`63930772a4e307727f404c21a156a0dcdfdd2a8e` was ordinary fast-forward pushed to
only `refs/heads/codex/abbott-runtime-isolation` and `refs/heads/release/abbott`.
Both literal remote refs were reread and matched exactly. No deployment was
needed or performed; the deployed release remains6f09982/8c79/a5b56e3.

The independent full read-only deployed-state proof passed before the attempt.
Ran exactly one approved smoke via the existing orchestrator, fixed dates
2026-09-01..2026-09-13 and literal loopback3001/3004, clean local invocation and
owned-child observation. The only refusal returned was:

`ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=failed`

No more specific asset subreason was obtained; do not infer a pin, metadata,
schema, tree or transport cause from this generic result. The asset stage still
precedes issuer execution, so no real credential frame was minted/consumed and
no credentialed smoke/PDF/Excel or capture phase was entered. No raw child
streams, environment or credential values were exposed. The first failure
stopped all further task actions except required read-only state/cleanup evidence:
no retry, fix, capture, Nginx tooling implementation or production Nginx change.

The owned observer returned `ABBOTT_VERIFICATION_OWNED_CLEANUP_VERIFIED`.
Captured orchestrator/forward/descendant PID/start identities stayed in memory;
all captured PIDs exited and the forward emitted its verified-exit record.
Independent local checks returned
`ABBOTT_SMOKE_OUTPUT_ABSENT_AND_LOCAL_CLEANUP_VERIFIED`: no3001/3004 listener,
no private identity evidence directories, no smoke report or partial candidate
directory. There was no browser session or credential temp file to remove;
reviewed buffer cleanup completed. All local commands and read-only SSH children
exited; no six-image dimensions/diff or visual acceptance is claimed.

After refusal, the independent full proof again returned
`ABBOTT_POST_DEPLOY_VERIFIED` for release`8c79caf495f147ad91b2174b9bc5f65c`,
source`6f09982fb1e8068f02340ddfcb5c945fb02ebfd5`, manifest
`a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2`
and predecessor`6cd2f12e245a47dcbd5f6ce928c4ed83`. Exact runtime/ownership receipt,
PID/start/UID982/GID984, soleloopback3004/health, active/backup/quarantine trees,
browser package/archive/executable/env metadata, committed/restored root-only
audits and absent deploy lock/staging remain verified. Neighbor IDs/PIDs/start/
cwd/releases match the preceding table. Nginx remains unchanged at SHA256
`1fd9d1b0e7ac65b20f1e3b7ee8cb544001e9691b006c103779d6ba55717a387c`.

Public routes remain on3001; no Nginx backup/test/reload/cutover, deployment,
neighbor write/restart/release, DB/auth/fact change, password rotation or collector/
cron action occurred. Rollback target remains retainedf80607f/release6cd2.
This checkpoint changes only the sanitized report. Verification-before-completion
required fresh cleanup and independent state proofs, not a claimed smoke pass.
BLOCKED pending further reviewed direction; no automatic retry.

## Phase1 only — instrument every asset boundary before further diagnosis

The preceding closed failed result could originate before the remote module
returns an attestation frame. Source inspection confirmed that the generic
bounded-child rejection erased whether spawn, stdin, timeout or abort caused
failure; the asset capsule creation was also outside the previous per-child
diagnostic catch. The outer remote import catch had its own undifferentiated
frame. Synthetic tests reproduced these information gaps. None establishes
which happened during the real6393077 attempt, and no runtime fix was selected.

Added a narrow asset transport wrapper around the existing fixed capsule/SSH
invocation. Git/source/capsule/size setup failures are local_capsule; its assigned
input buffer is cleared in finally on every path. The shared node-only bounded
child runner now privately brands its first spawn, stdin, timeout, abort or
output-limit failure while preserving the generic external exception message.
It still zeroes accumulated stdout/stderr before rejection after owned close,
clears timers and abort listeners, and retains the existing bounded TERM/KILL
sequence. A synchronous stdin-write throw is retained through that same cleanup
path instead of escaping the Promise setup. No raw errors, error properties or
streams become diagnostic values. The spawn seam is local-test-only wiring;
production consumers still call the same fixed installed child commands.

Asset-only mapping exposes ssh_spawn, ssh_stdin, ssh_timeout, cancelled and
ssh_stderr_frame. Returned nonzero/signal exits without a valid remote frame
map to ssh_exit; malformed output frames map to ssh_stderr_frame. Arbitrary
unbranded local throws remain unknown. The remote capsule now distinguishes
remote_import from otherwise unbranded remote_attestation exceptions; valid
source-proof frames map to remote_source_proof. Per review instruction, known
remote pin/schema/tree/prefix/predecessor/metadata reasons remain specific rather
than being collapsed. Terminal output stays the existing closed two-enum frame.
No LogLevel or other SSH flag, secret/env contract, release pin, file/tree/hash/
path/mode check, credential protocol or acceptance threshold changed.

TDD RED showed missing private cause classification, capsule catch coverage and
outer import/runtime distinction. GREEN covers thrown setup/oversize before SSH,
spawn failure, synthetic EPIPE/synchronous stdin throw, timeout, abort, output
overflow, first-cause preservation, unknown/forged secret-bearing error fields,
and zeroed streams after child close. A real local child closes descriptor0
early, reproducing EPIPE; the test verifies its exact owned PID has exited.
Real local capsule children distinguish failing import, unbranded remote runtime
throw and a valid tree_hash frame, without exposing synthetic secret text.
Parent integration verifies no issuance on each boundary failure, cleared capsule
and child buffers, closed forward and removed signal handlers. The exact current
SSH argv is regression-checked, including the absence of a speculative option
change. No production capsule, credential or network connection is used by these
local fixtures.

Fresh gates: focused leaf/asset/diagnostic/orchestrator47/47; broader post-build
smoke/asset/issuer/visual/orchestrator/leaf113/113; app/contract67/67; full authority/
bootstrap/browser/recovery/deploy/artifact512/512. Abbott production build and
exact12-route/1-prefix gate pass; sealed artifact2870 files/82 text files passes.
Both TypeScript checks, source/test syntax and whitespace checks pass; final
lint exits0 with0 errors and10 existing warnings. An initial broader-suite run
overlapped the rebuild and could not read its generated HTML fixture; rerunning
after the build completed passed113/113 without a source workaround. The final
post-build result, not that overlapping run, is the verification evidence.

Systematic debugging is deliberately paused at evidence instrumentation, not a
chosen production remedy. TDD and verification-before-completion provide the
local test evidence. All local test/loader commands exited; the EPIPE fixture
specifically proves owned PID absence. Local3001/3004 listeners and both fixed
private identity evidence directories are absent; no browser or SSH session was
started. No live credential read/issuance/use, push, deploy, DB/auth/fact/cron/
collector/neighbor or Nginx action occurred. Latest published refs remain6393077;
the preceding evidence-only commit is112df8f. No new screenshot/diff, Nginx
backup or parity approval is claimed. Last verified rollback target remains
f80607f/release6cd2. DONE_WITH_CONCERNS: STOP for review before one diagnostic
run; no automatic retry and no speculative fix.
