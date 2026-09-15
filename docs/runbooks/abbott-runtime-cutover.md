# Abbott isolated-runtime cutover runbook

This runbook moves only Abbott's exact public routes from the combined runtime on `127.0.0.1:3001` to the already-reviewed isolated runtime on `127.0.0.1:3004`. It does not migrate data, rotate credentials, change collectors or cron, or restart another dashboard runtime. The parity period is fixed at `2026-09-01..2026-09-13`.

Run the local commands from the reviewed isolated-runtime worktree as an unprivileged account. Run the server commands only through the established `beget` SSH alias. Stop on the first failure. Never put a password, access token, embed key, cookie, or authorized URL in shell arguments, environment variables, files, screenshots of browser chrome, or chat. Credentials must arrive through the approved ephemeral host issuer and a direct stdin pipe only.

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
node --import tsx --test scripts/smoke-abbott-runtime.test.mjs scripts/abbott-asset-attestation.test.mjs
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

Record only process names and PIDs; never use `pm2 jlist` because it includes process environments.

```bash
ssh beget 'set -eu; for app in dashboard-next dashboard-zaruku dashboard-medroche; do printf "%s " "$app"; pm2 pid "$app"; done' \
  > "$EVIDENCE_PARENT/neighbors.before"
chmod 0600 "$EVIDENCE_PARENT/neighbors.before"
npm run deploy:abbott
```

`deploy:abbott` installs and starts only `dashboard-abbott`; it does not edit or reload Nginx. Verify the direct listener before authorization:

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

This mode uses the same strict credential frame and owned-forward lifecycle.
Before credential issuance, a separate bounded read-only SSH capsule repeats the
source proof and validates the exact installed release
`6cd2f12e245a47dcbd5f6ce928c4ed83` / `f80607f`, current/record agreement, and trusted
manifest SHA-256
`7b9acd076ec821840d221f03dcc754eae09b921603e22f3941a0c489a102bd1f`.
It rejects links, mode/owner drift, modified public assets and unattested files;
only public asset paths/sizes/hashes return through captured stdout. No manifest
or credential transport file or extra credential descriptor is created.

The in-process consumer performs GET only on both literal loopback origins for
both aliases `18`/`abbott`, both audiences, and the fixed period. Manager admin
reads must succeed; embed admin reads must return 401/403. JSON aliases must match
the existing redacted payload contract and parity; embed JSON additionally gets
a recursive private-identifier/collection scan. Both Excel aliases are parsed and
compared using the existing redacted workbook semantics. PDF responses must be 200 with
the PDF content type and valid parse, equal page counts/dimensions and normalized
text digest. PDF metadata/compression bytes are not compared. Installed Poppler
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
