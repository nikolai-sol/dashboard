# Abbott isolated-runtime cutover runbook

This runbook moves only Abbott's exact public routes from the combined runtime on `127.0.0.1:3001` to the already-reviewed isolated runtime on `127.0.0.1:3004`. It does not migrate data, rotate credentials, change collectors or cron, or restart another dashboard runtime. The parity period is fixed at `2026-09-01..2026-09-13`.

Run the local commands from the reviewed isolated-runtime worktree as an unprivileged account. Run the server commands only through the established `beget` SSH alias. Stop on the first failure. Never put a password, access token, embed key, cookie, or authorized URL in shell arguments, environment variables, files, screenshots of browser chrome, or chat. The credential prompts below use shell memory and a pipe only; they do not echo input.

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
node --test scripts/compare-abbott-runtime.test.mjs scripts/capture-abbott-runtime.test.mjs
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

### First-runtime prerequisite checkpoint (review required; not executed)

Read-only preflight on 2026-09-15 found no `dashboard-abbott` service account and no
`/var/www/.dashboard-abbott-secrets/runtime.env`. The fixed deployer requires both.
The bootstrap below is a separate code checkpoint and must receive its dedicated
review before execution. It does not deploy a runtime or change routes.

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

Create one private evidence directory and a bounded local SSH tunnel. The trap stops the task-owned SSH process on every ordinary shell exit.

```bash
umask 077
EVIDENCE_PARENT="/Users/nafanya/Downloads/Abbott-dashboard-cutover-evidence-2026-09-14"
BASELINE="/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14"
mkdir -p "$EVIDENCE_PARENT"
chmod 0700 "$EVIDENCE_PARENT"
TUNNEL_DIR="$(mktemp -d "$EVIDENCE_PARENT/tunnel.XXXXXX")"
chmod 0700 "$TUNNEL_DIR"
cleanup_tunnel() {
  ssh -S "$TUNNEL_DIR/control" -O exit beget >/dev/null 2>&1 || true
  rm -rf -- "$TUNNEL_DIR"
}
trap cleanup_tunnel EXIT INT TERM
ssh -M -S "$TUNNEL_DIR/control" -fnNT -o ExitOnForwardFailure=yes \
  -L 3001:127.0.0.1:3001 -L 3004:127.0.0.1:3004 beget
ssh -S "$TUNNEL_DIR/control" -O check beget >/dev/null
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
test "$(curl --fail --silent --show-error http://127.0.0.1:3004/api/health)" = \
  '{"ok":true,"scope":"abbott","database":"connected"}'
```

## 4. Obtain ephemeral authorization and compare ports

At each prompt, type into the local terminal only. Do not paste credentials into chat. The two newline-delimited values go directly to file descriptor `0`; the scripts reject more than two non-empty lines and never persist them.

```bash
{
  printf 'Abbott manager password: ' >/dev/tty
  IFS= read -r -s manager_password </dev/tty
  printf '\nAbbott embed key: ' >/dev/tty
  IFS= read -r -s embed_key </dev/tty
  printf '\n' >/dev/tty
  printf '%s\n%s\n' "$manager_password" "$embed_key"
  unset manager_password embed_key
} | node scripts/compare-abbott-runtime.mjs \
  --reference http://127.0.0.1:3001 \
  --candidate http://127.0.0.1:3004 \
  --output-parent "$EVIDENCE_PARENT"
```

Expected: `status=match mismatches=0`. The new mode-`0700` report directory contains one mode-`0600` JSON file with only redacted field paths, counts, and hashes. Review it without copying it into Git:

```bash
PARITY_REPORT="$(find "$EVIDENCE_PARENT" -maxdepth 2 -type f -name abbott-runtime-parity.json -print | sort | tail -n 1)"
test -n "$PARITY_REPORT"
test "$(stat -f '%Lp' "$PARITY_REPORT")" = "600"
node -e 'const fs=require("fs");const p=process.argv[1];const v=JSON.parse(fs.readFileSync(p,"utf8"));if(v.status!=="match"||v.mismatch_count!==0)process.exit(1);console.log("manager/embed parity: match")' "$PARITY_REPORT"
```

A mismatch exits `1` and reports only redacted paths. Payload totals use order-independent fixed six-decimal aggregation (integer counts remain exact). Workbooks are compared by worksheet, coordinate, cell type, and hashes of normalized formulas or values; raw cells are never persisted. Do not inspect or save source responses or workbook rows.

## 5. Capture and compare the private visual candidate

This captures the five baseline desktop tabs at CSS width `1440`, the users-summary tab at CSS `390x844`, and every conditional tab that is truthfully visible. The mobile device scale is exactly `800/390`, preserving the baseline's `800`-pixel raster width without changing the CSS viewport; the index records both CSS and raster dimensions. It waits for dashboard readiness, fonts, and chart animation settlement. Its private candidate directory is retained by directory identity and all files are created relative to that descriptor. On failure the retained inode is cleaned without following a replacement path. Browser close has a short deadline and falls back only to the exact recorded Chromium PID on failure, timeout, or signal cancellation.

```bash
{
  printf 'Abbott manager password: ' >/dev/tty
  IFS= read -r -s manager_password </dev/tty
  printf '\nAbbott embed key: ' >/dev/tty
  IFS= read -r -s embed_key </dev/tty
  printf '\n' >/dev/tty
  printf '%s\n%s\n' "$manager_password" "$embed_key"
  unset manager_password embed_key
} | node scripts/capture-abbott-runtime.mjs \
  --login http://127.0.0.1:3001 \
  --candidate http://127.0.0.1:3004 \
  --baseline "$BASELINE" \
  --output-parent "$EVIDENCE_PARENT"
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

Run the redacted parity and visual commands from sections 4 and 5 again before any other change. Then verify both public Abbott aliases, both JSON/export aliases, manager control, embed isolation, and one Abbott asset without exposing authorization:

```bash
node --input-type=module 3< <(
  printf 'Abbott manager password: ' >/dev/tty
  IFS= read -r -s manager_password </dev/tty
  printf '\nAbbott embed key: ' >/dev/tty
  IFS= read -r -s embed_key </dev/tty
  printf '\n' >/dev/tty
  printf '%s\n%s\n' "$manager_password" "$embed_key"
  unset manager_password embed_key
) <<'NODE'
import { obtainManagerToken, readCredentialFd } from './scripts/compare-abbott-runtime.mjs';

const { managerPassword, embedKey } = await readCredentialFd(3);
const token = await obtainManagerToken('http://127.0.0.1:3001', managerPassword);
const origin = 'https://dashboards.adreports.ru';
const period = { from: '2026-09-01', to: '2026-09-13' };
const fetchAuthorized = async (pathname, kind, base = origin) => {
  const url = new URL(pathname, base);
  url.searchParams.set('from', period.from);
  url.searchParams.set('to', period.to);
  if (kind === 'embed') url.searchParams.set('embed_key', embedKey);
  const response = await fetch(url, {
    headers: kind === 'manager' ? { cookie: `dashboard_viewer_18=${token}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  return response;
};
const managerPaths = [
  '/dashboard/18', '/dashboard/abbott',
  '/api/dashboard/18', '/api/dashboard/abbott',
  '/api/dashboard/18/pdf', '/api/dashboard/abbott/pdf',
  '/api/dashboard/18/excel', '/api/dashboard/abbott/excel',
  '/api/dashboard/18/abbott-admin-users', '/api/dashboard/abbott/abbott-admin-users',
];
for (const pathname of managerPaths) {
  const response = await fetchAuthorized(pathname, 'manager');
  if (!response.ok) throw new Error(`manager smoke failed for ${pathname}: HTTP ${response.status}`);
  console.log(`${pathname}: ${response.status}`);
}
const embed = await fetchAuthorized('/api/dashboard/18', 'embed', 'http://127.0.0.1:3004');
if (!embed.ok) throw new Error(`embed smoke returned HTTP ${embed.status}`);
const embedText = await embed.text();
if (/raw_user_id|visit_id|start_url|end_url|session_journeys/i.test(embedText)) {
  throw new Error('embed smoke exposed a forbidden field');
}
const denied = await fetchAuthorized('/api/dashboard/18/abbott-admin-users', 'embed', 'http://127.0.0.1:3004');
if (denied.status !== 403) throw new Error(`embed manager-control smoke returned HTTP ${denied.status}`);
const page = await fetchAuthorized('/dashboard/18', 'manager');
const html = await page.text();
const assetPath = html.match(/\/_next-abbott\/[^"'\s<]+/)?.[0];
if (!assetPath) throw new Error('Abbott asset path not found');
const asset = await fetch(new URL(assetPath, origin), { redirect: 'error', signal: AbortSignal.timeout(60000) });
if (!asset.ok) throw new Error(`Abbott asset smoke returned HTTP ${asset.status}`);
console.log(`embed isolation: pass; manager-control denial: ${denied.status}; asset: ${asset.status}`);
NODE
```

Verify representative neighbor pages and the three direct health endpoints, then compare PIDs again:

```bash
for path in /dashboard/28 /dashboard/zaruku /dashboard/17; do
  test "$(curl --silent --output /dev/null --write-out '%{http_code}' "https://dashboards.adreports.ru$path")" = "200"
done
for port in 3001 3004; do curl --fail --silent --show-error "http://127.0.0.1:$port/api/health" >/dev/null; done
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

```bash
cleanup_tunnel
trap - EXIT INT TERM
ssh -S "$TUNNEL_DIR/control" -O check beget >/dev/null 2>&1 && exit 1 || true
```

Keep the mode-`0700` evidence and Nginx checkpoint for audit. They contain no credentials, raw JSON payloads, raw workbook rows, or cookie material. Do not commit them.
