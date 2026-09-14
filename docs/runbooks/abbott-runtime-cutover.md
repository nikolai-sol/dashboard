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

## 2. Build and test locally

```bash
npm ci
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

Expected: zero failed tests, lint/typecheck/build exit `0`, the artifact gate exits `0`, and the final command reports `12 exact Abbott routes, 1 Abbott asset prefix, upstream 127.0.0.1:3004`.

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

A mismatch exits `1` and reports only redacted paths. Do not inspect or save source responses or workbook rows.

## 5. Capture and compare the private visual candidate

This captures the five baseline desktop tabs at CSS width `1440`, the users-summary tab at CSS `390x844`, and every conditional tab that is truthfully visible. It waits for dashboard readiness, fonts, and chart animation settlement. Its private candidate directory is removed on failure, and the owned Chromium process closes in `finally` on success or failure.

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

Verify that no task-owned browser remains. The first command must find no Puppeteer process whose parent belongs to this operator run; do not terminate an unowned process:

```bash
pgrep -fal 'chrome|chromium' | grep -F "$PWD/node_modules/puppeteer" && exit 1 || true
find "$EVIDENCE_PARENT" -maxdepth 2 -type f -name parity-index.json -exec stat -f '%Lp %N' {} \;
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
