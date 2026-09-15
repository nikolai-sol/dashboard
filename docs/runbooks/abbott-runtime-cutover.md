# Abbott isolated-runtime cutover runbook

### Transaction perimeter snapshot checkpoint — critical review required

Approved `ece704e` was published to both authorized refs, but no production
command was dispatched. Source inspection established that the earlier worker
had no neighbor/Nginx gate and that `inspect` created a lock. Do not treat that
earlier inspection as mutation-free evidence.

The new Abbott-only preflight runs before account subprocesses, browser UID
checks, PM2 access, locks or directory/file creation. It pins current/control
`8c79caf495f147ad91b2174b9bc5f65c`, source
`6f09982fb1e8068f02340ddfcb5c945fb02ebfd5`, manifest
`a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2`,
the protected ownership receipt, full active artifact, exact account982/984,
and immutable browser/archive evidence. It performs bounded stable nofollow
filesystem/kernel reads only: no PM2 CLI/library/socket, spawned check or health
request. Abbott `inspect` now returns through that proof without creating a lock;
an existing lock still refuses. Subsequent activation retains its existing
process identity and health gates.

Abbott current/previous authority remains fixed. Neighbor identity is captured
once in the transaction's private memory, not taken from historical evidence,
caller input, a transport frame or a temporary file. Semantic neighbor contracts:

| Runtime | UID / GID / port | Cwd and release authority |
| --- | --- | --- |
| combined | 0 / 0 / 3001 | `/var/www/dashboard`; root-owned regular `.release-source-sha`, valid40-hex SHA |
| Zaruku | 984 / 991 / 3002 | `/var/www/dashboard-zaruku/apps/zaruku`; root-owned regular root `.release-source-sha`, valid40-hex SHA |
| MedRoche | 983 / 983 / 3003 | `/var/www/dashboard-medroche-releases/<40-hex SHA>/standalone/apps/site-seo`; exact root-owned `/var/www/dashboard-medroche` pointer to that standalone root |

Each must own its single expected IPv4 loopback listener3001/3002/3003, proven
from bounded `/proc/1/net/tcp{,6}` tables and direct numeric PID/socket-descriptor
discovery. No PM2, ss or other subprocess performs discovery. Bounds are8192
proc entries,4096 numeric PIDs,4096 descriptors per PID and65536 total descriptors;
TCP tables are bounded to2MiB each. Multiple owners, wildcard/IPv6 alternatives,
scan overflow and unsafe metadata refuse. Unrelated processes/socket activity
within these bounds do not become snapshot authority. Node binary
and command checks are semantic, not invented historical byte pins: an absolute
root-owned non-writable regular Node executable, plus the source-established
Next16.1.6 title or exact server/launcher argv shape. No raw argv or environment
is output. Source records and the exact MedRoche root-owned immutable pointer
are independently checked. Process cwd/release ancestry must also be root-owned,
nonwritable, real directories. The snapshot captures boot, PID/start/UID/GID,
cwd/executable/cmdline, directory/binary metadata, listener inode, and release
bytes/target plus stable metadata. Nginx remains the stable regular root-owned0644
`/etc/nginx/conf.d/dashboard-next.conf`: its current bytes/hash/metadata are
captured only after bounded structural validation finds exactly one TLS server
whose server_name tokens include `dashboards.adreports.ru`. Composite aliases
and a separate HTTP redirect are accepted, including quoted brace data and
braced Nginx variables. Malformed block/directive structure, Abbott markers,
case-insensitive Abbott/18 locations or3004 upstreams refuse. Any `include`
directive refuses: included files are outside this fixed single-file snapshot,
even if the existing include would otherwise be valid Nginx configuration.
Extending that scope would require separate review. No config is edited.

Nginx context/routing re-review correction: this conf.d file must contain only
top-level `server {}` blocks. A server nested in location/if/upstream/http or any
other block cannot supply target-host/TLS authority and refuses; listen and
server_name must be direct server directives. The selected dashboards TLS server
is unique across normalized same-host declarations: every other target-host
block must explicitly listen only on non-SSL port80. Implicit listeners, another
443 block without `ssl`, padded/alternate ports or case variants cannot escape
the selected-server policy through shared socket TLS behavior. The selected server
accepts only direct literal locations (plain or exact `=`), with no nested
locations, regex patterns, variables, `~`, `~*` or `^~` modifiers. Its proxy_pass
must be a literal `http://127.0.0.1:3001`,3002 or3003 target, optionally with a
literal path. Named, variable, alternate-protocol or otherwise opaque targets
refuse. Only status-only return is supported there; redirects, set/map/rewrite/
if, try_files/error_page, other pass modules and unknown routing directives or
blocks refuse. Known passive SSL/header/log/timeout/buffering directives remain
supported; literal-name non-routing header variables are data, not destination
authority. Location/Refresh or dynamically named response headers refuse. The separate
HTTP redirect may retain its existing host/request variables. Parsed literal
Abbott aliases/asset prefixes and3004 targets, including padded3004 ports and
escaped/case variants, remain prohibited. This is a deliberately restricted
preflight contract, not a complete Nginx interpreter: unsupported otherwise-valid
configuration requires review and must not be bypassed. No live retry is
authorized until this correction is reviewed.

Proxy URI re-review correction: the optional literal proxy_pass path must be
canonical and provably unrelated to Abbott. Queries, fragments, percent encoding,
duplicate slashes or dot-segment normalization refuse rather than being decoded
or repaired. Case-insensitive path segments matching dashboard/18 or
dashboard/abbott, including api-prefixed/nested forms, descendants, trailing
slashes and the Abbott asset prefix refuse. Numeric spellings coercing to18
also refuse, matching the combined loader's Number(identifier) behavior. Prefix
locations may omit the URI or use only an identity URI equal to their literal
location path: Nginx otherwise appends unmatched request bytes and can complete
a partial Abbott alias. Other canonical unrelated URI rewrites require an exact
`=` location with no unmatched suffix. Proxy directives without a proven location
context refuse. The no-URI/root-identity accepted composite
fixture is unchanged. This remains a source-only gate requiring re-review.

Neighbor/Nginx proof repeats immediately before predecessor PM2 stop, after
candidate health immediately before pointer promotion, and at compensation
completion. The first activation gate re-proves predecessor presence/identity
and perimeter before setting the mutation marker and writing the prepared
journal. Refusal at that gate performs no activation mutation. Once the marker
is set, every later failure enters compensation even if no stop command ran.
Post-health drift prevents promotion and enters owned compensation. Any detected
snapshot failure is latched, even if another deployment subsequently reverts its
change; compensation cannot claim an unchanged perimeter afterward. Unverified compensation
retains the lock/review journal and leaves the provably owned runtime stopped.
No neighbor or Nginx mutation is introduced. Non-Abbott transactions keep their
existing path. All CLI diagnostics remain closed and contain no raw proof data.

This is a fixed Abbott checkpoint plus one dynamic transaction perimeter, not
recapture at every activation boundary. Legitimate neighbor updates completed
before capture are accepted; exact in-memory comparisons reject concurrent ones.
A successful Abbott successor activation requires separately reviewed Abbott checkpoint re-pinning before
another deployment or standalone rollback through this entrypoint. Internal
failure compensation remains available within the transaction. STOP for source
review; this documentation does not authorize a new probe, deployment or retry.

### Correlated PDF failure-stage header — review required before deploy

The focused Abbott handler now adds `X-Abbott-PDF-Failure-Stage` only to its
private, no-store500 response, with the request-local closed stage authorize,
launch, prepare, navigate, ready or render. Success,401 and404 carry no stage
header. The generic body and bounded log contract are unchanged. Smoke reads
this header only for candidate PDF5xx and reports the corresponding closed
candidate_pdf stage reason; absent or malformed labels remain candidate_5xx.
Control PDF baseline policy is unchanged. This source-only checkpoint requires
review and a separately authorized deployment before any live use; no new
operator command, log read or retry is authorized by this documentation.

Deployment preflight review correction: kernel TCP ports are exact uppercase
four-digit hex (`0BB9`, `0BBA`, `0BBB`, `0BBC`), not unpadded numbers. Fixtures
use Linux table columns; malformed address/port widths or case refuse. Extra
IPv6 listeners on any protected port are detected and refused, preserving the
single IPv4 loopback listener requirement. A predecessor disappearing between
its final health check and the first activation mutation is refusal, not a
successful implicit stop. After the prepared journal is written, disappearance
or any write/start/health failure is compensating work; unresolved ownership or
readiness retains the review journal/lock. These corrections are source-only
and require re-review before live use.

### PDF log caller checkpoint — review required before host use

The fixed caller is now implemented locally; the preceding classifier-only
checkpoint remains historical. Do not run it until this caller checkpoint is
approved. It is the only proposed operator command, from the clean exact
isolation worktree, without arguments or inherited authority:

```sh
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/read-abbott-pdf-stage.mjs
```

The caller pins classifier/proof source hashes, clean HEAD blobs, exact
worktree/Git directory, its own script realpath and bytes, installed Node and
local SSH key/known-host metadata. Its fixed SSH command uses root on beget's
pinned host/address/key/known-host authority, LogLevel=ERROR, no config/proxy/
agent/control reuse, and a clean remote Node environment. Only a bounded,
canonical source frame travels through stdin, never credentials or arguments.
The loader verifies exact schema, source hashes and size limits before importing
the proof. No source or log file is created remotely.

The read-only proof reconciles the exact6f09982/8c79/a5b5 current record and sealed
ownership receipt with active-directory inode, direct kernel PID/start/UID982/
GID984, cwd/exe/cmdline and the receipt's fixed launcher/source/control release
binding. It reads no PM2 state, invokes no PM2 CLI/library and connects to no
supervisor socket. Only fixed read-only `/usr/bin/ss` proves sole loopback3004
ownership; no-redirect bounded health remains mandatory. Kernel stat/status and
exact cwd/exe targets are repeated around the classifier and health. All proc
reads are bounded/stable/O_NOFOLLOW; only cwd/exe may be exact-target proc magic
links. The kernel initial environ must match the fixed env-i PATH boundary and
is compared as bytes then zeroed, never decoded or reported. Source/control
binding comes from the protected receipt/current records and same PID/start,
not invented RUNTIME_RELEASE variables in environ. The installed Next16.1.6
process-title rewrite or exact original launcher argv is required. No runtime.env
or application .env is read. Supervisor socket loss is irrelevant to this proof.
The classifier's strict0600,64KiB,complete-safe-record acceptance is unchanged;
unknown remains unknown, without permission repair or broader log inspection.

The local caller installs bounded drains/deadlines/exit handlers immediately
after spawn, captures owned PID/start in private identity-only evidence before
source dispatch and checks ownership before TERM/KILL. Exact child exit and
private-evidence cleanup are required before a stage result can be accepted.
All stderr, failing SSH exits, malformed/duplicate/extra stdout and unverifiable
cleanup collapse to the same closed unknown line. Output contains no PIDs,
paths, times, counts, command/error text or log content. The process exits nonzero
on unknown. A classified historical marker is not per-request attribution and
does not authorize smoke retry, deployment or Nginx changes.

### Gated source-only PDF log-stage diagnostic (2026-09-15)

After the approved d17712f smoke returned `pdf_fetch/candidate_5xx`, stop live
verification. `scripts/abbott-pdf-log-stage.mjs` is a read-only classifier library,
not an operational command. It requires review and a separately reviewed caller
that attests the exact active kernel process against the protected deploy
receipt and kernel PID/start before and after reading. Do not invoke a host log
read, copy logs, or use `pm2 logs`, `tail`, or raw SSH output at this checkpoint.

The pinned6f09982 ecosystem fixes one error log, merge mode and second-resolution
timestamps; the handler emits only its fixed marker plus stage/error_class.
No repository policy establishes live rotation or log ownership/mode. The reader
therefore requires root:root0600, one regular non-symlink link and safe ancestors;
unknown metadata means unknown, never permission repair. It refuses files larger
than64KiB without reading content and never follows rotated files. Stable bounded
snapshot checks detect rotation, truncation or append during reading; the read
buffer is zeroed and descriptor closed on every outcome.

Only exact timestamped single-/multiline Node marker records can be classified.
Unknown context, duplicate/nonmonotonic timestamps, malformed/partial records or
additional fields make the snapshot unknown. Output is only
`ABBOTT_PDF_STAGE stage=<authorize|launch|prepare|navigate|ready|render> class=<Error|NonError>`
or `ABBOTT_PDF_STAGE stage=unknown class=unknown`, without timestamps, counts,
paths or messages. Raw unframed logs cannot authenticate a marker's origin or
correlate a historical marker with a particular request; the result must not be
represented as proof of the failed smoke's cause. No standalone transport is
included; live metadata and rotation remain unobserved pending authorization.

This runbook moves only Abbott's exact public routes from the combined runtime on `127.0.0.1:3001` to the already-reviewed isolated runtime on `127.0.0.1:3004`. It does not migrate data, rotate credentials, change collectors or cron, or restart another dashboard runtime. The parity period is fixed at `2026-09-01..2026-09-13`.

Run the local commands from the reviewed isolated-runtime worktree as an unprivileged account. Run the server commands only through the established `beget` SSH alias. Stop on the first failure. Never put a password, access token, embed key, cookie, or authorized URL in shell arguments, environment variables, files, screenshots of browser chrome, or chat. Credentials must arrive through the approved ephemeral host issuer and a direct stdin pipe only.

Current operational checkpoint (2026-09-15): acknowledged deploy6f09982 succeeded
as release8c79, with predecessor6cd2 retained. Approved pin53f01c9 was published;
one smoke stopped at `ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=failed`
before credential issuance. Cleanup and independent deployed-runtime/browser/
neighbor/Nginx checks passed. The source-only asset diagnostic checkpoint below
requires review before any retry. No capture, redeploy or route change followed.
Earlier diagnostic-review notes describe historical checkpoints, not authority
to bypass the current failure.

## 1. Verify the clean reviewed commit

```bash
cd /Users/nafanya/ReportingDash/dashboard-next/.worktrees/abbott-runtime-isolation
test "$(git branch --show-current)" = "codex/abbott-runtime-isolation"
test -z "$(git status --porcelain=v1)"
SOURCE_SHA="$(git rev-parse HEAD)"
test "$(git ls-remote --heads origin refs/heads/release/abbott | cut -f1)" = "$SOURCE_SHA"
git show --no-patch --format='%H %s' "$SOURCE_SHA"
```

Do not continue from an uncommitted checkout or if `release/abbott` is not the reviewed commit.

The fixed deploy command binds the exact clean local worktree and its Git directory,
then requires local `HEAD` to equal the literal remote `refs/heads/release/abbott`
resolved through isolated Git configuration. The local branch name does not grant
deployment authority; keep this feature worktree checked out as above. Publish its
reviewed commit to both the feature branch and `release/abbott` with ordinary
non-force pushes only after the complete local gates pass.

## 2. Build and test locally

```bash
npm ci
command -v python3 >/dev/null
node --import tsx --test scripts/compare-abbott-runtime.test.mjs scripts/capture-abbott-runtime.test.mjs \
  scripts/abbott-parity-issuer.test.mjs scripts/verify-abbott-shadow.test.mjs
node --import tsx --test scripts/smoke-abbott-runtime.test.mjs scripts/abbott-asset-attestation.test.mjs scripts/abbott-bounded-child.test.mjs
node --import tsx --test scripts/abbott-verification-diagnostics.test.mjs
npm run test:abbott-runtime
npm run test:abbott-contract
npm run test:abbott-contract-wiring
npm run security:public-assets
npm run lint
npm run typecheck
npm --workspace apps/abbott run build
npm --workspace apps/abbott run verify:artifact
node scripts/verify-abbott-nginx-routes.mjs deploy/abbott/nginx-routes.conf
```

Expected: `python3` is available for descriptor-bound private output writes, zero failed tests, lint/typecheck/build exit `0`, the artifact gate exits `0`, and the final command reports `12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004`.

### First-runtime prerequisite checkpoint (reviewed and executed)

Read-only preflight on 2026-09-15 found no `dashboard-abbott` service account and no
`/var/www/.dashboard-abbott-secrets/runtime.env`. The fixed deployer requires both.
The bootstrap received its dedicated review and was executed from `f80607f` on
2026-09-15 (operator local date), returning `created`. It did not change routes.

The source is fixed to the active combined runtime at `/var/www/dashboard/.env`:
single-link regular file, UID `501`, GID `0`, mode `0600`; its parent is UID `501`,
GID `0`, mode `0755`. The script also pins the observed combined source SHA,
PID/start-time, kernel boot ID, cwd, and host name. A restart, release change,
ownership change or symlink causes refusal and requires new read-only evidence
and review. Never override these checks through arguments or environment.

The source process kernel real/effective/saved/filesystem UID and GID are all `0`,
and all eight values are pinned separately from the source files' UID 501. The
verified `/var/www` ancestry mode is root:root `0751`; bootstrap checks it and
does not change it.

Before any mutation, allowlisted source values must match the exact active
`@next/env` version `16.1.6`, code SHA-256
`44e84a28e712bca30781e892e3e64d3aecdc46bef9d23b5b7f39bfa1fcef6baa`.
That parser runs in a fresh child with empty inherited environment, a private VM
environment, a 64-MiB V8 heap limit, a 3-second process deadline, bounded output,
and separate 750-ms VM execution limits. Only captured stdin/stdout pipes carry
values. The parent and child ambient environments are never modified by parsing.
Unquoted `#` uses Next comment semantics; quoted or unquoted `$KEY`/`${KEY}` may
refer only to present allowlisted keys. Missing, ambient, unrelated/source-key,
cyclic or unsupported references and semantic disagreement refuse bootstrap.
Unrelated combined-runtime settings are filtered, never printed or copied.
The final strict quoted credential input is serialized as UTF-8 and must be at
most 65,536 bytes, including every quote, separator and final newline. Bootstrap
checks that exact buffer before any account/group operation or filesystem write;
the read-only proof uses the same serializer and byte check.

The exported read-only `verifyAbbottBootstrapSource` gate performs no account
command or filesystem write. Its authorized production check on 2026-09-15
returned only `{"status":"verified","allowlistedKeyCount":23}`. This is source
semantics verification, not execution or approval of bootstrap. The source process
and file/parser identities are checked again by bootstrap immediately before use.

After dedicated bootstrap review and the clean-source/release-ref gates above:

```bash
node --test scripts/bootstrap-abbott-host.test.mjs
node --check scripts/bootstrap-abbott-host.mjs
test -z "$(git status --porcelain=v1)"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes beget \
  '/usr/bin/env -i /usr/bin/node --input-type=module' \
  < scripts/bootstrap-abbott-host.mjs
```

Expected output is only `Abbott host prerequisites: created` or `unchanged`.
The account/group is exactly `dashboard-abbott`, with no home creation and
`/usr/sbin/nologin`. The root-only credential input directory remains root:root
`0700`, and its file root:root `0600`, as required by the reviewed worker.
Only existing Abbott allowlisted credential/config values are copied; source
OAuth keys and unrelated settings are excluded. No password or secret is created
or rotated. Existing input must byte-match, otherwise the script refuses without
replacing it. A newly created group/account may remain after a later failure;
repeat only after resolving and reviewing the failed prerequisite.

The worker, unchanged, supplies `NODE_ENV=production`, `HOSTNAME=127.0.0.1`,
`PORT=3004`, and `INTERNAL_BASE_URL=http://127.0.0.1:3004` when rendering the app
`.env` as root:dashboard-abbott `0640`. These generated fields are deliberately
absent from the root-only secret input. Database role/grant verification remains
a separate deployment gate; bootstrap performs no database query or mutation.

The current Nginx insertion instructions in section 7 are also blocked pending a
separate reviewed fix: the live configuration has a composite `server_name` in
both HTTP and TLS blocks, so its literal single-name needle does not match. Do not
edit Nginx or run section 7 until that fix is reviewed.

Use this fixed private evidence directory. Do not open a manual tunnel: the
reviewed local orchestrator exclusively owns bounded forwards for each run.

```bash
umask 077
EVIDENCE_PARENT="/Users/nafanya/Downloads/Abbott-dashboard-cutover-evidence-2026-09-14"
BASELINE="/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14"
mkdir -p "$EVIDENCE_PARENT"
chmod 0700 "$EVIDENCE_PARENT"
```

## 3. Record neighbors, then install without Nginx

### Browser prerequisite correction — STOP for review, not executed

Read-only diagnosis after `candidate_5xx` found no explicit browser/cache key in
the candidate rendered env or initial process env. UID982 resolves HOME through
the account database to absent `/nonexistent`; its default Puppeteer cache is
therefore absent. `/tmp` is writable/executable by UID982. Ten standard system
Chrome/Chromium paths and the three corresponding package records were absent.
The combined process has HOME present and its root-only ancestry excludes use by
the dedicated account; no root/user cache is copied or reused. No browser was
launched and no shared-library state was claimed for an absent candidate binary.

After dedicated review only, the proposed fixed local command is:

```bash
node scripts/bootstrap-abbott-browser.mjs
```

Do not invoke a remote installer, package CLI, alternate path or apt command
manually. This command requires the exact clean worktree; it sends committed
modules on fixed SSH stdin. On the fixed host it repeats source/process/parser
proof, attests the entire active f80607f tree, verifies UID982/GID984/no-home
identity, and compares installed package-derived browser authority before writes.
It accepts no caller arguments or browser/Git/proxy/Node environment override.

Pinned package `puppeteer-core`24.39.1 currently resolves Linux
`chrome-headless-shell` build146.0.7680.76; installed `@puppeteer/browsers`2.13.0
resolves its exact official HTTPS archive. No browser download was made in this
checkpoint. The downloader rejects redirects/proxies/alternate origins, has a
120-second/256-MiB bound, and the complete operation has a 180-second watchdog.
ZIP names/types/count and expanded size (4,096 entries/768 MiB) are checked before
installed API extraction. The extraction child has a 60-second deadline, bounded
output and disabled HTTP; it consumes the preseeded local archive, with
`installDeps:false`. No transient npx, system package install or browser launch.

There is no upstream integrity checksum in this installed package API. The first
controlled official HTTPS download's archive SHA-256 is recorded honestly as a
first-install content digest, not an invented upstream checksum. Its immutable
stamp also binds package versions, supported build/platform, exact source URL,
executable discovery and the complete extracted file hashes/sizes/modes.

The fixed `/var/lib/dashboard-abbott/browser-cache` is atomically promoted from
private sibling staging. Parent/cache/directories are root:dashboard-abbott0750;
regular data/stamp files0640 and executable files0750. Runtime cannot write this
tree. Existing installs must verify exactly; mismatched version/hash/mode/links
refuse rather than replacing them. Cancellation/failure removes only owned
staging; a newly created empty parent may remain. There is no automatic cleanup
of an existing installed browser. Before publication, an empty-environment
UID982/GID984 child checks executable access, writable `/tmp`, and bounded `ldd`
output for missing libraries. Missing libraries are a new blocker, not permission
to install system dependencies.

Fixed `deploy:abbott` never downloads a browser. Its new Abbott-only prerequisite
verifies immutable hashes/modes and service-UID executable access before deploy/
rollback writes. Only then is the existing `PUPPETEER_EXECUTABLE_PATH` rendered
into the new app env. Root secret input and the sealed launcher allowlist remain
unchanged. Other runtime scopes do not use this gate. Focused PDF explicitly uses
the package-derived headless-shell path, debugger pipes, and a minimal child env
without credentials. Puppeteer's existing unique `/tmp` profile allocation and
browser-close cleanup remain in use; the read-only cache is not a profile/home.

Release and rollback verification reuse this same immutable browser; they never
reinstall or delete it. A package/build change requires a separately reviewed
prerequisite successor, not an override. The pre-fix f80607f application does not
contain this PDF selection correction; route-only rollback to combined3001 is
still the known-good rollback, and no full PDF acceptance is claimed for f80607f.
Before any future smoke, the deployed manifest attestation must be reviewed for
the new app release rather than bypassing its existing f80607f pin.

### Fresh Abbott registration activation — checkpoint B review required

Do not run the changed deploy path until this checkpoint has been reviewed and
its exact commit approved for execution. The fixed `npm run deploy:abbott`
entrypoint remains the only deploy authority; no manual PM2 delete/start command
is authorized. Non-Abbott activation and the dedicated historical interrupted-
recovery entrypoint are unchanged.

The Abbott transaction now verifies the current pointer, sealed active tree,
exact env digest/inode, predecessor ID/PID/start/UID/GID/release binding, health
and loopback listener before disturbing the active runtime. Candidate artifact,
env, protected record and backup-slot absence are checked too. Once the candidate
is ready, the same predecessor registration is immediately re-proven, stopped,
its kernel exit/listener absence verified, and only that exact stopped PM2 ID
deleted. The candidate is then atomically moved into the active path and starts
as a fresh registration from its fixed protected ecosystem; no startOrReload or
retained-environment merge is used in this Abbott path.

The new registration must match candidate release/source, dedicated UID/GID,
launcher/cwd, stable PID/start and sole127.0.0.1:3004 listener. Full artifact/env
and health/identity checks must pass before pointer promotion. PM2 IDs may change
when registrations are recreated; an old numeric ID must never be reused as
operator authority. No neighboring registration/name/port is targeted.

Failures and SIGINT/SIGTERM/SIGHUP enter bounded identity-checked compensation.
Only the proven candidate registration can be stopped/deleted. Exact predecessor
tree/env/inode and original pointer bytes are restored, then the predecessor is
started fresh and its old binding, health and listener re-attested. Failed
predecessor startup is stopped only when ownership can be proven. An unverified
replacement PID/registration is never touched or described as stopped.

Each transaction retains a root-only audit file under the fixed control root:
`activation-<transaction UUID>.json`, root:root0600, atomically updated through
an exclusive `.next` sibling. It contains only transaction/release/inode/path
metadata and closed states, never env values. Successful activation records
committed; verified compensation records restored. Both clear the owned lock.
Unresolved process/tree/pointer/compensation drift preserves the root-only lock
and journal (review_required when writable), plus the attested trees, for manual
review. Never remove them or retry by overriding the gate. A stopped Abbott
runtime is safer than serving a known mismatch; unrelated replacements remain
untouched when identity cannot be established.

### Acknowledged Abbott deploy transport — additional review required

The source-only transport follow-up replaces Abbott's blocking SSH invocation
only. Do not execute until its exact commit is independently approved. Continue
to use only `npm run deploy:abbott` or the separately authorized fixed rollback
wrapper; never invoke the remote loader, redirect its output or send a capsule
manually. Non-Abbott SSH transport remains unchanged.

The fixed SSH target is root on beget, with the pinned IP/key/known-hosts, strict
host-key checking, no agent, proxy, forwarding or connection reuse, and client
LogLevel=ERROR. SSH gets only its constructed PATH; remote Node runs under
`env -i`. The local parent owns stdin/stdout/stderr pipes. No source, payload,
credential or runtime environment is put in SSH argv. Secrets stay on the host
under the unchanged input/renderer contract.

Exact READY and captured SSH PID/start proof precede transmission. Source and
payload have separate length/hash frames (1 MiB and 512 MiB maximum). The payload
is the already-sealed artifact request, not environment data. RUN is sent once,
only after both writes finish. ABORT, EOF and remote signals feed the transaction
cancellation guard. The remote loader waits for activation or compensation to
finish; unexpected transaction exceptions cannot certify restoration.

Control prefixes are checked byte-exactly as they arrive. Any post-RUN fragment
starts cancellation; an impossible prefix, duplicate command, trailing bytes or
incomplete line at EOF/terminal completion is refused. Pending control bytes are
rejected and cleared before any terminal ACK. Malformed traffic permits only
REFUSED or the worker's verified REVIEW_REQUIRED after work settles, never
COMMITTED/RESTORED. Exact RUN still completes normally; clean EOF and complete
ABORT retain the reviewed cancellation path. This framing correction also awaits
independent review before live use.

Internal release metadata is limited to the exact bounded record schema. The
record and terminal ACK must agree on capsule/payload digest and control ID;
extra, duplicate, malformed or out-of-order frames fail. Public output contains
only closed status/stage/reason, never record values or child streams. COMMITTED
requires transaction completion plus verified SSH exit; RESTORED requires the
worker's own verified compensation state. REVIEW_REQUIRED certifies the owned
review journal was written, not that an unowned replacement was stopped. Failed
journal/lock proof or lost acknowledgement is UNACKNOWLEDGED, never cleanup
success. Stop and inspect read-only; do not automatically retry or deploy.

The diagnostic protocol checkpoint also binds a canonical `diagnostic` object
beside the internal record and repeats its stage/reason in the terminal ACK.
Old frames without diagnostics are rejected. Status pairs are fixed:
COMMITTED=`complete/none`, RESTORED=`compensation/restored`, and
REVIEW_REQUIRED=`compensation/review_required`. REFUSED requires `failed` with
one of `preflight_current`, `preflight_browser`, `preflight_nginx`,
`lock`, `prepare`, `activation_precheck`,
`activation_stop`, `activation_start`, `candidate_health`, `pointer`,
`compensation` or `unknown`; REFUSED can never mean `complete/none`.
The private phase is set immediately before an existing boundary, never inferred
from exception text or properties. Successful perimeter subchecks restore their
calling phase; failed subchecks retain their specific closed phase. A verified
compensation outcome takes precedence over the original failed activation phase.
No acceptance gate, host authority or deployment behavior is relaxed. This is
Phase1 instrumentation only, pending review before any live diagnostic retry.

For `preflight_neighbor_combined`, `preflight_neighbor_zaruku` and
`preflight_neighbor_medroche`, REFUSED instead requires exactly one of
`pid_absent`, `start_mismatch`, `uid_gid`, `cwd`, `release_record`, `executable`,
`cmdline`, `listener`, `proc_metadata` or `unknown`. The fixed proof sets that
private subreason at the existing read/semantic boundary; no values, process
arguments, source contents or raw errors are emitted. Only ENOENT while reading
the exact process directory is `pid_absent`; permissions and missing proc child
files do not imply PID absence. Full filesystem/identity/listener acceptance is
unchanged. These reasons are valid only with REFUSED plus a neighbor phase;
verified compensation still uses its canonical compensation pair.

A local cooperative-abort timeout does not override a later exact, verified
terminal ACK. Once framing/digest/status pairing and SSH exit are valid, the
canonical remote diagnostic is passed to session revalidation; private evidence
cleanup must still verify before any acknowledged result is accepted. RESTORED,
REVIEW_REQUIRED and REFUSED can therefore survive a prior timeout with their
proper diagnostic pairs. COMMITTED is never accepted after local timeout/abort.
Forged frames, stderr, nonzero SSH exit or unverified cleanup remain unacknowledged.

Immediately after spawn, drains, exit handlers and deadlines remain installed
through PID proof, upload, RUN and compensation. At 240 seconds the parent sends
ABORT (or EOF before RUN), then allows 300 seconds for remote compensation before
an exact PID/start-checked TERM. At 600 seconds it may send identity-checked KILL;
the final observation budget ends at 605 seconds. No kill targets an unverifiable
or reused PID. A live unverified child keeps its close/drain observation and must
not be described as cleaned up. Remote cancellation is cooperative between
bounded phases; abrupt worker death still requires lock/journal review.

Transient local identity evidence uses only the fixed ignored directory
`.superpowers/sdd/.abbott-deploy-evidence`, invoking-user-owned0700, with atomic
0600 metadata-only writes and no links. It records PID/start/exit flags and closed
stage codes, then copies a no-PID summary and removes the owned evidence. An
evidence failure prevents success. Source/payload/output buffers are zeroed on
all terminal paths. Parent signal handlers remain through transport and evidence
cleanup. No live deploy, Nginx action or PDF/data/visual approval is part of this
source checkpoint.

Record only process names and PIDs; never dump `pm2 jlist` because it includes process environments. The reviewed worker may inspect it in memory and must never relay its contents.

```bash
ssh beget 'set -eu; for app in dashboard-next dashboard-zaruku dashboard-medroche; do printf "%s " "$app"; pm2 pid "$app"; done' \
  > "$EVIDENCE_PARENT/neighbors.before"
chmod 0600 "$EVIDENCE_PARENT/neighbors.before"
npm run deploy:abbott
```

`deploy:abbott` installs and starts only `dashboard-abbott`; it does not edit or reload Nginx. Verify the direct listener before authorization:

#### Interrupted activation recovery checkpoint (not yet authorized to execute)

The 2026-09-15 attempt left candidate `9aaed34` at the active directory while
PM2 registration and current pointer retained predecessor `f80607f`. The
candidate and sealed predecessor backup both attest. Health alone does not
prove release consistency. Do not rerun deploy, use ordinary rollback, update
the asset pin, or promote the candidate pointer in this state.

Only after the dedicated recovery source review and explicit execution approval,
use this single local command from the clean fixed isolation worktree:

```bash
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/recover-abbott-activation.mjs
```

No arguments, environment overrides, standalone remote invocation, source edits
or alternate SSH command are allowed. The recovery pins candidate control
`e9e548a6414c4d8c836c7715c66f37ad`/manifest
`a62b6297cdc903ed4d0e94357e7dfbe8d552ed4bf76db95be6582d913433c74b`, old control
`6cd2f12e245a47dcbd5f6ce928c4ed83`/manifest
`7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f`, and exact
observed Abbott ID5/PID714550/start162192969/UID982/GID984 with predecessor
binding. Host, boot, source/parser proof, neighbor identities, Nginx hash, trees,
env overlays, listener and kernel identity must match before and under the lock.

It stops only the pinned Abbott registration, verifies process/listener exit,
parks the candidate with an atomic rename and atomically restores the sealed
backup at the active path. Only the old protected control may restart Abbott.
Old artifact, pointer, binding, identity, health, listener and neighbors must all
pass before the lock is removed. The candidate remains preserved at the fixed
`/var/www/dashboard-abbott-releases/e9e548a6414c4d8c836c7715c66f37ad-interrupted-recovery`
path. The root-only journal is
`/var/www/.dashboard-abbott-control/interrupted-recovery-e9e548a6414c4d8c836c7715c66f37ad.json`.

Cancellation after mutation stops only the captured Abbott process and attempts
guarded layout compensation. It never restarts mismatched candidate code. Any
failure retains the journal and lock plus both trees for review; compensation
itself may refuse if inode/ownership/precondition evidence drifted. Do not remove
these files or improvise a recovery. A pre-mutation refusal after taking the
lock may conservatively leave the root-only lock for review as well.

The recovery-only SSH transport pins host/IP/root/key/known-hosts, disables
config/proxies/agents/multiplexing, and sends a bounded hash-bound source frame.
It contains no credentials. Local signals send an explicit abort control line;
remote EOF/abort triggers compensation. Local signal handlers remain installed
until acknowledgement and verified SSH exit or the bounded failure deadline.
The remote watchdog is90seconds; local acknowledgement deadline300seconds,
identity-checked SSH TERM/KILL grace60seconds and final exit wait5seconds.

Only `ABBOTT_RECOVERY_RESTORED` acknowledges complete predecessor restoration.
`ABBOTT_RECOVERY_REVIEW_REQUIRED` acknowledges a terminal attempt requiring
inspection, not successful cleanup. `ABBOTT_RECOVERY_UNACKNOWLEDGED` means no
trusted terminal acknowledgement and must never be reported as remote cleanup.
`ABBOTT_RECOVERY_REFUSED` is not restoration. After any result, independently
verify the safe host state and task-owned process exit. No Nginx change, smoke,
token issuance, capture or PM2 update implementation belongs to this checkpoint.
The PM2 release-binding update defect is a separate checkpoint after recovery.

The single approved attempt from278fd2d returned UNACKNOWLEDGED and stopped;
the interrupted layout, neighbors and Nginx were then verified unchanged.
The following local diagnostic changes require review before another attempt.
Output is now exactly one closed status plus `stage=<enum> reason=<enum>`;
it never contains remote stderr/stdout, host, command, path or PID data. Stages
distinguish local_spawn, identity_proof, source_write, run_write, remote_startup,
remote_preflight, remote_recovery, ack_framing, timeout, ssh_close,
local_evidence, complete and unknown. Unknown errors remain unknown, not raw
exception text. Strict acknowledgement pairs distinguish remote module startup
from preflight refusal without disclosing either exception.

Before transmitting source, the wrapper captures the transient SSH PID and then
its verified start internally. Identity-only lifecycle evidence is atomically
written in the fixed ignored `.superpowers/sdd/.abbott-recovery-evidence`
directory (invoking UID0700; file0600, no symlinks or hardlinks). No elevated
local process is required. After terminal observation, it copies only
identity-captured/exit-observed/exit-verified booleans into an in-memory summary,
then removes the evidence file/directory. PIDs/start never enter output or Git.
Evidence drift refuses and preserves unverified files for inspection; do not
delete or overwrite existing evidence to bypass a refusal. An unverified exit
remains unverified even after the observation deadline; no cleanup claim can
be inferred from a closed diagnostic alone.

#### Inert startup diagnostic (review required; not executed)

Source inspection found no sudo step: the exact command is fixed root SSH,
`env -i`, and Node ESM `--input-type=module -e`. A local shell-bound regression
preserves the exact remote quoting/tokenization (substituting only the local
verified Node executable) and passes with inert framed source. It does not
establish behavior of the remote Node installation or explain prior stderr.

The transport now waits for exactly `ABBOTT_RECOVERY_READY` before sending any
source or RUN, then rechecks the same owned child identity. Missing, malformed,
duplicate/coalesced startup output, cancellation, identity drift or stderr
cannot release a frame. All stderr remains fatal, including recognized warnings.
At most8,192 bytes are retained in memory, classified and zeroed. The only
additional startup reasons are sudo_hostname, node_syntax, node_warning,
permission, missing_binary, ssh_warning and unknown; no raw line is returned.

After separate review and explicit probe approval only:

```bash
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/probe-abbott-recovery-startup.mjs
```

This fixed probe uses the exact recovery SSH/env/Node loader invocation,
private identity evidence, READY gate and bounded lifecycle. Its sole framed
module is a fixed inert function returning the internal transport success
marker. It imports no host/recovery code and performs no filesystem, runtime,
database or network operation. The loader itself only manages its own stdin,
stdout, hash and cancellation lifecycle. External output is STARTUP_PROBE_READY
or STARTUP_PROBE_REFUSED with closed stage/reason; it never claims a runtime
was restored. Probe success does not authorize or substitute for recovery.
No recovery capsule, arbitrary source, standalone remote command or caller
override is accepted. Do not run this probe or retry recovery before review.

#### Staged startup matrix (diagnostic correction requires review before retry)

The approved single inert probe returned remote_startup/unknown. The staged
matrix below is implemented for separate review; these are three separate
invocations, not an automatic fallback chain. Execute only the specifically
approved stage. A stage result never authorizes recovery or the next stage.

```bash
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/probe-abbott-startup-stage.mjs ssh
```

```bash
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/probe-abbott-startup-stage.mjs node
```

```bash
/usr/bin/env -i /opt/homebrew/Cellar/node/25.6.1_1/bin/node scripts/probe-abbott-startup-stage.mjs loader
```

All stages reuse the exact fixed SSH options, clean env and private evidence/
bounded cleanup implementation. Recovery and its probes pin `-o LogLevel=ERROR`
for SSH client diagnostics only; remote command stderr is still piped, bounded
and fatal, and connection/authentication errors or nonzero exits still refuse.
No shell stderr redirect or stream filter is introduced. This option is not
applied to deployment, credential issuance or other SSH workflows.
The ssh stage runs only env-i /bin/true and
expects empty stdout; node runs the exact Node binary with a fixed direct -e
sentinel; loader starts the current ESM loader, waits for exact READY, then
sends EOF and verifies its exact terminal refusal. No stage sends a source
frame or RUN, reads host state, creates remote files or changes a runtime.
Only the three literal stage arguments are accepted; recovery itself still
requires zero arguments and retains every original authority/pin gate.

Each stage returns only `ABBOTT_STARTUP_STAGE stage=<enum> result=<enum>
category=<enum>` on one line. Results are clean, stderr_known_category,
stderr_unknown, exit_nonzero, timeout, unexpected_output or cleanup_unverified.
Known category names are closed; all other results use category=none. The
matrix never returns text, hashes, byte counts, identities or paths. Even
recognized stderr is fatal. Standard SSH tty/known-host/locale and Node warning
patterns are bounded and anchored; generic warning prefixes remain unknown.
Unverified cleanup takes precedence over every other result. Once cleanup is
verified, nonzero or signal exit takes precedence over deadline and stderr and
returns only exit_nonzero/category=none. Stderr classification applies only to
verified zero exit; a reached deadline with zero exit remains timeout. Neither
exit status values nor signal names are emitted.
Local tokenization fixtures substitute installed local binary paths only;
they do not establish the remote binaries' behavior. The approved first matrix
returned stderr_unknown for all three stages, but its earlier precedence could
mask nonzero SSH exits. Those results do not prove successful connection or
remote execution. Stop for source review before any retry; see the task report
for the original closed results and cleanup evidence.

#### Normal shadow health check (not a recovery substitute)

```bash
test "$(ssh beget 'curl --fail --silent --show-error http://127.0.0.1:3004/api/health')" = \
  '{"ok":true,"scope":"abbott","database":"connected"}'
```

## 4. Obtain ephemeral authorization and compare ports

**Issuer/orchestrator `bb9fad5` was approved and used for comparison and capture.
Comparison passed; capture failed without retained images/index. The additional
smoke source was approved at `af33ac7`, but its live attempt stalled on an ESM
entrypoint cycle. The approved startup correction `b4252b8` returned a generic
refusal on retry, with normal cleanup and no smoke report. The local closed-enum
diagnostic change below is paused for review before any further retry. No
plaintext or legacy password fallback is authorized for this operation.**

The new stdin frame is three LF-delimited lines: the literal mode name
`manager_access_token`, the short-lived signed manager session, and the existing
embed key. One final LF is permitted. CR, controls, empty fields, extra lines,
invalid UTF-8, and input exceeding 65,536 bytes are rejected. Only descriptor 0
backed by a pipe/socket is accepted; no credential file, alternate descriptor,
argument, or environment input is supported. Input buffers are cleared after
parsing. The older two-line protocol remains available for separately authorized
interactive use, but is not part of this production operation.

Never invoke the issuer standalone or redirect its stdout. Run only the local
orchestrator below, after its dedicated review. It sends committed code on SSH
stdin to the fixed `beget` command under an empty remote environment. The issuer
revalidates the exact combined host/source/process/UID/GID/Next-parser proof,
selects the effective allowlisted environment in memory, reads dashboard 18's
current DB credential version with a fixed SELECT, and uses a fixed internal
`node:crypto` HMAC-SHA256 signer with
`type=viewer`, `dashboard_id=18`, `audience=manager`, that credential version, and
an expiry 600 seconds ahead. The consumer rejects expired tokens or expiry more
than 900 seconds ahead. Its JSON/base64url wire contract is tested byte-for-byte
against the existing `createSignedSession` and accepted by the existing verifier.
The combined auth Git blob remains hash-attested as
`71fad58b4eb66b2cd5dd29b7c463043c5cc8a04d839e597a14e0d9a2fae8e64f`, but is
never loaded or evaluated for signing. There is no dynamic signing source, VM,
eval, Function constructor, or signer child. No combined file or ambient
environment is changed. Missing DB credentials/version/embed key or source drift
fails closed.

The issuer refuses TTY/file-like stdout and emits at most one exact frame per
process. Its stdout/stderr are captured, bounded and checked before consumer use,
never inherited or teed to a terminal. The local orchestrator feeds only the
validated frame into the consumer's stdin, clears buffers, and never saves a
credential. It opens only literal loopback forwards 3001/3004, refuses occupied
ports, disables ControlMaster/ControlPath reuse, records its SSH PID/start identity,
checks owned listeners, and bounds startup and exit. SSH exit/error aborts both
issuance and consuming verification. PID/start and both literal owned listeners
are revalidated after issuance, immediately before handing off the frame, after
the consumer, and before deliberate tunnel shutdown. A lost/replaced tunnel
cannot produce success. Interrupt handlers stay installed through consumer and
verified forward cleanup; capture receives time for its reviewed browser cleanup
before escalation. Only the owned SSH process is closed. No password or HTTP
issuer endpoint exists.

The consumer's envelope checks do not verify a signature. Both live runtimes
must independently accept the session/current version through a read-only
manager-only administrator-list GET before comparison or browser launch.
Requests use the manager cookie in memory, never a manager token URL, and refuse
redirects. Capture additionally intercepts requests before setting the cookie,
permits only the literal candidate loopback origin, rejects redirect chains,
bypasses service workers, and removes partial output on failure.

The only authorized credential-bearing workflow entrypoint after review is:

```bash
node scripts/verify-abbott-shadow.mjs compare
```

Expected: fixed JSON status `passed`, mode `compare`, and owned-forward exit
attestation. The consumer must report a match with zero mismatches internally.
The new mode-`0700` report directory contains one mode-`0600` JSON file with only
redacted field paths, counts, and hashes. Review it without copying it into Git:

```bash
PARITY_REPORT="$(find "$EVIDENCE_PARENT" -maxdepth 2 -type f -name abbott-runtime-parity.json -print | sort | tail -n 1)"
test -n "$PARITY_REPORT"
test "$(stat -f '%Lp' "$PARITY_REPORT")" = "600"
node -e 'const fs=require("fs");const p=process.argv[1];const v=JSON.parse(fs.readFileSync(p,"utf8"));if(v.status!=="match"||v.mismatch_count!==0)process.exit(1);console.log("manager/embed parity: match")' "$PARITY_REPORT"
```

A mismatch exits `1` and reports only redacted paths. Payload totals use order-independent fixed six-decimal aggregation (integer counts remain exact). Workbooks are compared by worksheet, coordinate, cell type, and hashes of normalized formulas or values; raw cells are never persisted. Do not inspect or save source responses or workbook rows.

## 5. Capture and compare the private visual candidate

After issuer/orchestrator approval, the capture entrypoint issues a fresh
short-lived frame itself; do not invoke the issuer or consumer separately.

This captures the five baseline desktop tabs at CSS width `1440`, the users-summary tab at CSS `390x844`, and every conditional tab that is truthfully visible. The mobile device scale is exactly `800/390`, preserving the baseline's `800`-pixel raster width without changing the CSS viewport; the index records both CSS and raster dimensions. It waits for dashboard readiness, fonts, and chart animation settlement. Its private candidate directory is retained by directory identity and all files are created relative to that descriptor. On failure the retained inode is cleaned without following a replacement path. Browser close has a short deadline and falls back only to the exact recorded Chromium PID on failure, timeout, or signal cancellation.

```bash
node scripts/verify-abbott-shadow.mjs capture
```

Expected: six captures unless a conditional tab is visible, zero console errors, matching dimensions, `changed_pixel_ratio <= 0.02`, and `mean_absolute_error <= 0.005` for every baseline-backed capture. The script exits `1` if a baseline-backed image misses either threshold. Open the candidate and baseline images side by side and confirm the tab heading, labels, KPI cards, charts, tables, and responsive layout; aggregate thresholds do not replace human review. The 13 documented chart-size warnings may recur, but any new warning requires review.

Verify only the exact browser PID captured when this tool launched Chromium. The index must attest cleanup and each captured PID must already have exited; this check neither reads command lines nor guesses browser cache paths:

```bash
CAPTURE_INDEX="$(find "$EVIDENCE_PARENT" -maxdepth 2 -type f -name parity-index.json -print | sort | tail -n 1)"
test -n "$CAPTURE_INDEX"
test "$(stat -f '%Lp' "$CAPTURE_INDEX")" = "600"
node --input-type=module - "$CAPTURE_INDEX" <<'NODE'
import fs from 'node:fs';

const index = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ownership = index.browser_processes;
if (!ownership || ownership.exit_verified !== true || !Array.isArray(ownership.process_ids)) {
  throw new Error('browser cleanup attestation missing');
}
for (const pid of ownership.process_ids) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid captured browser PID');
  try {
    process.kill(pid, 0);
    throw new Error(`captured browser PID ${pid} remains alive`);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
console.log(`captured browser cleanup: ${ownership.process_ids.length} PID(s) exited`);
NODE
```

## 6. Verify every neighbor PID is unchanged

### Additional read-only smoke transport — diagnostics STOP for review

Neither the stalled `af33ac7` attempt nor the corrected `b4252b8` refusal produced
a smoke report. Owned orchestrator/forward exits were independently verified;
neighbors and Nginx were unchanged. The following entrypoint must not be retried
until the local diagnostics change receives dedicated review. It does not waive
the failed visual gate:

```bash
node scripts/verify-abbott-shadow.mjs smoke
```

The local correction moves the bounded child runner into a node-only leaf module
so smoke never imports its awaiting CLI. The orchestrator installs signal handlers
and a fixed overall watchdog before setup/consumer loading: four minutes for
comparison, eleven for capture, nine for smoke (which retains its own eight-minute
request deadline). Smoke is loaded before attestation or credential issuance.
Abort permits up to 35 seconds for existing child/browser cleanup, then proceeds
to clear retained buffers and close/verify the owned forward rather than waiting
forever on an unresolved import/setup promise. Late returned buffers are also
cleared. Signal handlers remain until forward cleanup completes. No timeout or
module authority can be supplied through CLI arguments or environment.

The pending diagnostic change emits failures only as
`ABBOTT_VERIFICATION_REFUSED stage=<allowed_enum> reason=<allowed_enum>`.
Smoke stages distinguish manager/embed aliases, manager administration/embed
denial, privacy shape, PDF fetch/parse/comparison, Excel and asset checks. Visual
stages distinguish launch, navigation, readiness, screenshot, dimensions and
comparison. Both stage and reason use fixed closed lists; unknown errors or
unrecognized values become `unknown`. No exception properties, stacks, causes,
URLs, request/response headers, bodies, credentials or arbitrary paths enter the
formatter. The parent accepts a child diagnostic only for exit 1, empty stdout,
and one exact bounded allowlisted stderr line; other child output is never relayed.
Success reports remain unchanged and contain no diagnostic/raw error objects.

The latest approved attempt stopped at `asset_html reason=failed`. The subsequent
local asset-contract correction and subcodes are **STOP for review; no live retry**.
HTML refusals now distinguish `http_status`, `content_type`, `body_limit`,
`malformed_html`, `no_assets`, `unexpected_asset_origin`, `unexpected_asset_path`,
`inventory_limit`, and `alias_mismatch`; existing fixed boundary/cache/cancellation
codes remain applicable. These are categories only: never append the rejected
status value, URL, path, markup, header, body or exception. Unknown errors retain
the closed fallback. A `malformed_html` code means unsupported/malformed inventory
markup or invalid UTF-8, not a general-purpose HTML validity certification.

Next's configured `assetPrefix: "/_next-abbott"` prefixes the standard
`/_next/static/` namespace. Thus candidate inventory and attested file mapping use
`/_next-abbott/_next/static/`; installed Next supplies its internal rewrite to
`/_next/static/`. Normalize only that exact candidate prefix when comparing
overlapping assets. Release/hash/file attestation remains unchanged. Off-origin
references, queries, encoding/traversal and all unattested candidate assets remain
refused; this correction does not authorize a Nginx edit or relax an asset gate.
The HTML inventory is scoped to `script[src]` and stylesheet/preload/modulepreload
links in the runtime's exact Next static namespace. Icon/metadata links (including
Next's favicon content-hash query) and image elements are explicitly ignored, not
accepted as query-bearing assets. Query-bearing scripts/styles/preloads remain
refused. Candidate attestation and fetching of every attested public file remain
exhaustive; this inventory scope does not remove files from the manifest gate.
The pending parser correction must also receive dedicated re-review. Attribute
names are exact and case-insensitive (`data-src` is never `src`); assignments
require quoted values and permit ASCII whitespace around `=`. Duplicate
attributes, missing critical values and unsupported/malformed relevant markup
fail closed as `malformed_html`. Parse the exact `rel` attribute into ASCII
whitespace-separated tokens before excluding metadata; stylesheet/preload/
modulepreload tokens take precedence over accompanying icon tokens regardless of
case or order. No query or off-origin exception is introduced by this parser.

The approved parser retry stopped at `pdf_fetch reason=status`; no capture or
Nginx work followed. The subsequent PDF diagnostic change is **STOP for review;
no live retry**. PDF non-200 responses now use only `control_4xx`, `control_5xx`,
`candidate_4xx`, `candidate_5xx`, `control_other_status`, or
`candidate_other_status`. Control means literal loopback port 3001; candidate
means 3004. No exact status number, URL, alias, audience, header or body is emitted.
Existing `content_type`/`body_limit`/boundary codes and limits remain unchanged.
The actual combined/focused PDF handlers both accept GET with query dates and no
body. Smoke's method, fixed dates and authorization transport are unchanged.

Source-only dependency review found a conditional browser prerequisite: the
sealed launcher strips HOME/cache overrides and runs the no-home account;
PUPPETEER_EXECUTABLE_PATH is allowed but optional, while Puppeteer otherwise uses
its home-based cache. This is not proof of the live failure. Do not change the
sealed environment, install a browser or read raw combined PDF logs as a workaround.
Any later runtime inspection/remediation requires its own reviewed scope.

This mode uses the same strict credential frame and owned-forward lifecycle.
Before credential issuance, a separate bounded read-only SSH capsule repeats the
source proof and validates the exact installed release
`8c79caf495f147ad91b2174b9bc5f65c` / `6f09982`, current/record agreement, exact
predecessor`6cd2f12e245a47dcbd5f6ce928c4ed83`, and trusted manifest SHA-256
`a5b56e3b72f8f062bc90d38b94e2b96c0e41e260d2c0aac883182e58104077a2`.
It rejects links, mode/owner drift, modified public assets and unattested files;
only public asset paths/sizes/hashes return through captured stdout. No manifest
or credential transport file or extra credential descriptor is created.

The local asset diagnostic change is STOP for review; it does not prove the live
failure's cause. Remote refusals have one bounded frame whose reason is only
record_schema, pin_mismatch, tree_hash, asset_prefix, predecessor, transport,
source_proof, metadata or unknown. Reasons are privately branded, never read from
exception fields. The parent propagates a reason only for exit1, no signal, empty
stdout and exactly one bounded known frame. Unknown/forged/oversized/extra output,
stderr accompanying exit0 and signal exits remain fatal transport refusals; raw
streams are never displayed. Parent output retains the existing closed
`ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=<enum>` format.

All deployed pins, current/record byte equality, manifest/file hashes, full public
inventory, fixed prefix, bounded reads, ownership/modes and link checks remain.
The record must contain exactly the observed five authority fields. The sanitized
deployed-record fixture accepts8c79/6f09982/a5b56e3/6cd2 and rejects stale/wrong or
extra fields. This narrows validation; it is not a speculative compatibility fix.

### Asset boundary diagnostics — Phase1, STOP for review

The subsequent approved98cf58a diagnostic also stopped at the generic asset
failure. The source-only follow-up distinguishes the remaining orchestrator
boundaries; it is not approved for a live retry yet. Unbranded read/setup errors
use asset_attestation/asset_read. Missing or malformed child result contracts
and exceptions while inspecting them use asset_attestation/result_contract.
The post-read PID/start/listener recheck runs under forward/failed, then restores
the asset stage only after it passes. Signal/deadline reasons remain cancelled/
deadline; forward abort remains forward/failed. Guard drain/finalizer failures
use cleanup/guarded_cleanup, while owned-forward close/record failures retain
cleanup/failed. The final forward recheck also reports forward/failed.
Regression fixtures forbid asset_attestation/failed on these paths, verify no
issuance after an asset refusal, clear available buffers, and verify cleanup and
signal-handler removal. SSH options, capsule bytes, attestation pins, remote
frame acceptance and all full-tree/hash/path/mode gates are unchanged.

The approved6393077 retry still returned asset_attestation/failed; no finer reason
was obtained. This source-only instrumentation must be reviewed before one more
diagnostic run. It does not select a live fix, change SSH flags/LogLevel, relax
environment/authority checks or alter payload acceptance.

The asset-specific local wrapper brands Git/source/capsule-size failures as
local_capsule before SSH. The node-only bounded child runner privately retains
only its first spawn/stdin/timeout/abort/output-limit cause, while still zeroing
both streams before rejecting and waiting for the owned child to close. These
map to ssh_spawn, ssh_stdin, ssh_timeout, cancelled or ssh_stderr_frame. Unbranded
local failures remain unknown; arbitrary exception fields cannot forge a cause.
Input capsule buffers are cleared in finally on setup and child failures.

Returned nonzero/signal exits without a valid remote frame use ssh_exit; malformed
stderr/output combinations use ssh_stderr_frame. Known exact bounded exit1 remote
frames retain their specific pin/schema/tree/prefix/predecessor/metadata reasons.
Source-proof frames become remote_source_proof. The outer capsule distinguishes
remote_import from otherwise unbranded remote_attestation exceptions. Raw stderr,
stdout, status values, signal names, URLs, command strings and exception text
never become diagnostic output. Terminal output remains the same two-enum
`ABBOTT_VERIFICATION_REFUSED stage=asset_attestation reason=<closed reason>`.

The regressions cover thrown capsule creation/size, spawn failure, synthetic and
real stdin EPIPE with exact child exit verification, timeout/abort, nonzero without
a frame, forged/oversized output, outer import/runtime exceptions and a valid
remote reason. Every refusal precedes credential issuance and uses the existing
forward-loss/cleanup path. No automatic retry or standalone remote probe is added.

### Degraded control PDF baseline policy — STOP for review, no live use

After the approved9af24ce smoke stopped at control_5xx, the requested local policy
permits only a narrowly labeled unavailable control PDF baseline. Do not use this
policy live until this exact source checkpoint is reviewed and approved.

Only PDF5xx responses from literal control port3001 may produce the private
unavailable sentinel, and only after their body is canceled without reading it.
Control4xx/other statuses, redirects, cancellation failures, malformed control200
PDFs and all candidate failures still refuse. The four control combinations
(manager/embed and aliases18/abbott) must all be available or all unavailable;
mixed outcomes fail closed. All four candidate PDFs must independently be200,
application/pdf, bounded and parse-valid, and candidate aliases must agree.
Available control PDFs retain strict normalized page/dimension/text comparison.
JSON, Excel, assets, administration and recursive embed privacy remain strict.

The report distinguishes `verification: strict_parity`,
`control_pdf_baseline: available`, `pdf_parity: matched` from
`verification: candidate_functional_with_baseline_exception`,
`control_pdf_baseline: unavailable_5xx`, `pdf_parity: not_compared`.
The latter is candidate functional verification with an explicit exception,
never a claim of PDF parity. No raw response/status/body is retained. Overall
smoke may pass with this labeled exception; all subsequent visual and routing
review gates remain in force. There is no automatic retry or control-runtime fix.

The in-process consumer performs GET only on both literal loopback origins for
both aliases `18`/`abbott`, both audiences, and the fixed period. Manager admin
reads must succeed; embed admin reads must return 401/403. JSON aliases must match
the existing redacted payload contract and parity; embed JSON additionally gets
a recursive private-identifier/collection scan. Both Excel aliases are parsed and
compared using the existing redacted workbook semantics. Candidate PDF responses
must be200 with the PDF content type and valid parse; available control PDFs must
also have equal page counts/dimensions and normalized text digest. The uniform
control5xx exception is governed solely by the reviewed policy above. PDF
metadata/compression bytes are not compared. Installed Poppler
26.04.0 at its exact `/opt/homebrew/Cellar/poppler/26.04.0/bin` paths receives PDF
bytes only through bounded stdin/stdout pipes; raw PDF/text never reaches files,
arguments, diagnostics, or the report. Parser children are reaped on abort.

HTML inventories must be consistent across aliases/audiences per runtime.
Status, content type and hashes are checked; normalized common paths have equal
hashes and all candidate public assets match the attested deployed manifest.
Different generated chunk names across builds are not treated as byte-parity
failures. Inventories are capped at 256 assets, individual bodies at 16 MiB
(32 MiB for PDFs), PDFs at 500 pages; overall smoke has an eight-minute deadline.
Redirects and non-loopback requests are forbidden, rejected bodies are cancelled,
and buffers are cleared. Only a private redacted `abbott-runtime-smoke.json` report
and fixed success counts are retained. Any release/manifest change requires a new
reviewed authority update, never an override.

### Neighbor identity check

```bash
ssh beget 'set -eu; for app in dashboard-next dashboard-zaruku dashboard-medroche; do printf "%s " "$app"; pm2 pid "$app"; done' \
  > "$EVIDENCE_PARENT/neighbors.after-shadow"
chmod 0600 "$EVIDENCE_PARENT/neighbors.after-shadow"
diff -u "$EVIDENCE_PARENT/neighbors.before" "$EVIDENCE_PARENT/neighbors.after-shadow"
```

Any difference stops the cutover. Investigate without restarting or killing another runtime.

## 7. Validate, snapshot, and apply only Abbott Nginx locations

Validate the currently active Nginx configuration before touching it, create a private checkpoint, and transfer only the already-validated fragment:

```bash
ssh beget '/usr/sbin/nginx -t'
node scripts/verify-abbott-nginx-routes.mjs deploy/abbott/nginx-routes.conf
REMOTE_CHECKPOINT="/root/reportingdash-private/abbott/nginx-cutover/$(date -u +%Y%m%dT%H%M%SZ)-$SOURCE_SHA"
ssh beget "umask 077; mkdir -p '$REMOTE_CHECKPOINT'; cp -p /etc/nginx/conf.d/dashboard-next.conf '$REMOTE_CHECKPOINT/dashboard-next.conf.before'; cat > '$REMOTE_CHECKPOINT/abbott-locations.conf'" \
  < deploy/abbott/nginx-routes.conf
ssh beget "chmod 0600 '$REMOTE_CHECKPOINT/dashboard-next.conf.before' '$REMOTE_CHECKPOINT/abbott-locations.conf'"
printf 'Nginx checkpoint: %s\n' "$REMOTE_CHECKPOINT"
```

Insert the fragment into the one server block for `dashboards.adreports.ru`. The markers are the rollback boundary; the script refuses an existing marker or ambiguous server block.

```bash
ssh beget "REMOTE_CHECKPOINT='$REMOTE_CHECKPOINT' python3 -" <<'PY'
import os
from pathlib import Path

target = Path('/etc/nginx/conf.d/dashboard-next.conf')
fragment = Path(os.environ['REMOTE_CHECKPOINT']) / 'abbott-locations.conf'
begin = '# BEGIN REPORTINGDASH ABBOTT ISOLATED ROUTES'
end = '# END REPORTINGDASH ABBOTT ISOLATED ROUTES'
text = target.read_text()
if begin in text or end in text:
    raise SystemExit('Abbott cutover markers already exist')
needle = 'server_name dashboards.adreports.ru;'
if text.count(needle) != 1:
    raise SystemExit('Expected exactly one dashboard server block')
marker = text.index(needle)
server = text.rfind('server', 0, marker)
opening = text.find('{', server, marker)
if server < 0 or opening < 0:
    raise SystemExit('Dashboard server block opening not found')
depth = 0
closing = None
for offset in range(opening, len(text)):
    if text[offset] == '{':
        depth += 1
    elif text[offset] == '}':
        depth -= 1
        if depth == 0:
            closing = offset
            break
if closing is None:
    raise SystemExit('Dashboard server block closing not found')
addition = f'\n    {begin}\n' + fragment.read_text().rstrip().replace('\n', '\n    ') + f'\n    {end}\n'
temporary = target.with_suffix('.conf.abbott-new')
temporary.write_text(text[:closing] + addition + text[closing:])
temporary.chmod(target.stat().st_mode & 0o777)
temporary.replace(target)
PY
```

Define the route-only rollback before validation. It removes only the marked Abbott fragment and never restores the whole Nginx snapshot over unrelated changes:

```bash
rollback_abbott_locations() {
  ssh beget "python3 -" <<'PY'
from pathlib import Path

target = Path('/etc/nginx/conf.d/dashboard-next.conf')
begin = '# BEGIN REPORTINGDASH ABBOTT ISOLATED ROUTES'
end = '# END REPORTINGDASH ABBOTT ISOLATED ROUTES'
text = target.read_text()
if text.count(begin) != 1 or text.count(end) != 1 or text.index(begin) > text.index(end):
    raise SystemExit('Exact Abbott rollback markers not found')
start = text.rfind('\n', 0, text.index(begin))
finish = text.find('\n', text.index(end))
if start < 0:
    start = 0
if finish < 0:
    finish = len(text)
else:
    finish += 1
temporary = target.with_suffix('.conf.abbott-rollback')
temporary.write_text(text[:start] + text[finish:])
temporary.chmod(target.stat().st_mode & 0o777)
temporary.replace(target)
PY
  ssh beget '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload'
}
```

Validate before reload. If validation fails, remove only the new block and stop:

```bash
ssh beget '/usr/sbin/nginx -t' || { rollback_abbott_locations; exit 1; }
ssh beget '/usr/sbin/nginx -s reload'
```

## 8. Post-cutover Abbott and neighbor smoke

**Gated preceding step: the closed-enum diagnostics must be reviewed and
approved before retry, live smoke must pass, and the failed visual gate must be resolved before
cutover.** The initial
issuer transport was reviewed and approved; no issuer placeholder command is supplied.

After approval, re-run the orchestrator; it obtains the strict
`manager_access_token\n<token>\n<embed key>\n` frame in memory and feeds stdin.
It refuses the legacy two-line mode and calls the same dual-port manager
authorization/parity path: both
manager-only administrator-list GETs must accept the current signature/version
before manager/embed data and workbook comparisons. Authorization stays in
memory on loopback ports 3001 and 3004 only, with redirects refused.

Use only these local entrypoints, with no credentials in arguments or redirects:

```bash
node scripts/verify-abbott-shadow.mjs compare
node scripts/verify-abbott-shadow.mjs capture
node scripts/verify-abbott-shadow.mjs smoke
```

The additional smoke mode covers the separately required PDF/privacy/admin/
alias/asset checks described above, but neither approved live attempt passed.
The corrected attempt refused with normal cleanup; the diagnostics change has
not been approved or used for a further retry.
All of these and visual parity must pass before any route mutation; do not
improvise a public-token URL, credential file, extra descriptor, or plaintext
fallback to perform them.

Verify representative neighbor pages and the three direct health endpoints, then compare PIDs again:

```bash
for path in /dashboard/28 /dashboard/zaruku /dashboard/17; do
  test "$(curl --silent --output /dev/null --write-out '%{http_code}' "https://dashboards.adreports.ru$path")" = "200"
done
ssh beget 'set -eu; for port in 3001 3004; do curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null; done'
ssh beget 'set -eu; curl -fsS http://127.0.0.1:3002/api/health >/dev/null; curl -fsS http://127.0.0.1:3003/api/health >/dev/null'
ssh beget 'set -eu; for app in dashboard-next dashboard-zaruku dashboard-medroche; do printf "%s " "$app"; pm2 pid "$app"; done' \
  > "$EVIDENCE_PARENT/neighbors.after-cutover"
chmod 0600 "$EVIDENCE_PARENT/neighbors.after-cutover"
diff -u "$EVIDENCE_PARENT/neighbors.before" "$EVIDENCE_PARENT/neighbors.after-cutover"
```

If any post-cutover check fails, immediately run:

```bash
rollback_abbott_locations
```

Then repeat the Abbott page/API smoke against port `3001`, verify the neighbor PID snapshot remains unchanged, and record the failed gate in the private evidence directory. Do not run `npm run deploy:abbott:rollback` unless the isolated Abbott application release itself must be reverted; route rollback is sufficient for a routing/parity failure.

## 9. Close owned temporary resources

Each orchestrator invocation closes and verifies its exact owned SSH process
before returning success and reports its PID/start identity plus exit attestation.
Capture also records and verifies its browser PIDs in the private index as above.
If cleanup refuses, stop and inspect only the recorded ownership proof; never
kill another session's processes or start a replacement tunnel to conceal failure.

Keep the mode-`0700` evidence and Nginx checkpoint for audit. They contain no credentials, raw JSON payloads, raw workbook rows, or cookie material. Do not commit them.
