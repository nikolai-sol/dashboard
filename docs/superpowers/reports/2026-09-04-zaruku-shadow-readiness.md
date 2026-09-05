# Zaruku isolated runtime shadow readiness — 2026-09-05

## Decision

**Local build and fixture readiness: GO. Production shadow and public route cutover: NO-GO pending the explicit prerequisites below.**

The isolated runtime is independently buildable, artifact-policy clean, locally bootable as the
unprivileged developer account, and covered by a read-only shadow comparison harness. This task did
not start a live or production shadow and did not inspect or change a production process, proxy,
database, migration, cron, secret, service account, filesystem ownership, PM2 state, or public route.
The existing public domain remains on the combined runtime.

Task 1–6 base and the source SHA stamped into the verified local artifact:
`db576a2c83eb26ca87f81174e8fd5ec1c9471a4c`. The Task 7 commit that tracks this report is the
result of `git log -1 --format=%H -- docs/superpowers/reports/2026-09-04-zaruku-shadow-readiness.md`
and is supplied in the handoff; a Git commit cannot contain its own content-addressed SHA.

## What the shadow verifier proves

`scripts/verify-zaruku-shadow.sh` accepts exactly two credential-free HTTP loopback base URLs and a
new evidence directory. The operator supplies a canonical snapshot label, one explicit historical
date range, a Zaruku artifact root, an inventory of authoritative other-runtime SHA files, and a
manager-auth JSON descriptor through an already-open file descriptor. The descriptor is copied into
a mode-`0600` temporary file, never appears in argv or evidence, and is deleted on exit. Each HTTP
request has one bounded deadline for both headers and the complete response body (15 seconds by
default; an explicitly configured value must remain within 100–30,000 milliseconds).

For both runtimes the verifier performs only HTTP `GET` requests. It:

- validates the combined canonical-DB health contract and exact isolated `{ok:true,scope:"zaruku"}`
  contract;
- compares the full unauthorized response, including Zaruku dashboard metadata and auth mode;
- compares the complete manager JSON as canonicalized JSON, with no field-value exclusions;
- compares PDF status, semantic headers, and all bytes after masking only Info-object
  `CreationDate`/`ModDate` plus generated trailer/XRef document IDs;
- compares Excel status, semantic headers, and every expanded XLSX package entry while ignoring
  only ZIP order/compression/timestamps and core-properties `created`/`modified` values;
- ignores only response headers `connection`, `content-length`, `date`, `keep-alive`,
  `server-timing`, `transfer-encoding`, and `x-response-time`;
- treats only combined-health `db_latency_ms`, `timestamp`, and `uptime_seconds` as volatile;
- attests the artifact's full source SHA, exact `zaruku` scope, and exact six-route public inventory;
- bounded-scans every regular artifact file for Abbott/private cross-runtime markers; and
- snapshots every listed other-runtime source SHA before and after the requests and fails on change.

Evidence contains only hashes, statuses, the documented normalized fields, source/scope/routes, and
before/after runtime SHAs. It does not persist manager payloads, export bodies, or authentication
material. Parser, assertion, HTTP, and descriptor failures emit one fixed sanitized error rather
than exception values, private JSON, response headers, or descriptor contents. The output files are
`summary.json`, `endpoint-parity.json`,
`artifact-attestation.json`, `zaruku-routes.txt`, `runtime-shas.before.tsv`, and
`runtime-shas.after.tsv`.

The fixture suite exercises real loopback HTTP behavior and real temporary artifact/SHA files. Its
positive case covers health, unauthorized metadata, manager JSON, actual PDF, and actual XLSX files;
the matching export fixtures have different creation timestamps and different raw bytes. Eighteen
negative cases prove nonzero exit for a historical total change, missing direct owner addition, missing Alice
month, Wordstat coverage change, canonical coverage change, source-health change, auth metadata
change, PDF content difference, Excel content difference, a non-Info PDF metadata difference,
semantic health-header difference, another-runtime SHA mutation, a same-value SHA-file rewrite
detected by file identity, an Abbott route marker in a compiled Zaruku artifact file, private JSON
and private-header mismatch redaction, malformed auth-descriptor redaction, and a stalled response
body deadline. These are
behavioral fixtures, not source-regex assertions.

## Fresh verification evidence

The final uninterrupted pre-review `npm run predeploy:verify` exited zero after a successful `npm ci`. Its order
was the existing full combined suite, runtime-contract tests, all isolated app tests, existing
combined deployment gates, the existing release gate (which builds Zaruku before deploy fixtures),
artifact-policy fixtures, artifact validation, local sealed boot, shadow fixtures, the existing
Abbott gates, public-asset security, root and isolated typechecks, lint, combined build, and preview
builder tests. The complete root suite ran once in that successful gate.

- Root tests: 956 Node discovered; 946 passed, 10 existing skipped, 0 failed. Python: 13/13.
- Runtime ownership contract: 4/4. Isolated Zaruku application: 39/39.
- Fixed Zaruku release/deploy behavioral suite: 28/28.
- Runtime artifact policy: 144/144. Shadow verifier at that gate: 1 positive + 13 negative fixtures.
- Abbott contract: 111/111; wiring gate passed.
- `npm run typecheck` and `npm exec -- tsc --noEmit -p apps/zaruku/tsconfig.json`: exit 0.
- `npm run lint`: exit 0, 0 errors and the same 12 pre-existing warnings.
- `npm run security:public-assets`, artifact validation, local sealed boot, and preview builders: exit 0.
- `npm run build` and `npm --workspace apps/zaruku run build`: exit 0.
- `npm ci --offline --dry-run --ignore-scripts --no-audit`, Bash syntax, and `git diff --check`: exit 0.

After review findings were fixed, the focused shadow verifier passed 1 positive + 18 negative
fixtures, `npm run test:deploy-source` passed, the predeploy ordering contract passed, and
`npm ci --offline --dry-run --ignore-scripts --no-audit`, Bash syntax, and `git diff --check`
remained clean. The parent completion pass owns a fresh branch-wide predeploy gate for the amended
commit.

The successful fresh isolated artifact is at
`apps/zaruku/.next-zaruku/standalone`; its external authority is
`apps/zaruku/.next-zaruku/trusted-runtime-manifest.json`. Observed artifact inventory: 75,048 KiB,
2,861 regular files, 0 symlinks, exact scope `zaruku`, zero policy violations, and no forbidden
cross-runtime marker. The framework manifest also contains `/_global-error`; the public routes are:

- `/_not-found`
- `/api/dashboard/zaruku`
- `/api/dashboard/zaruku/excel`
- `/api/dashboard/zaruku/pdf`
- `/api/health`
- `/dashboard/zaruku`

The combined build retained its existing routes and middleware. No advertising or Abbott artifact,
process, or SHA was changed by the verification.

An earlier long-running tool invocation lost its visible process handle; its completion status was
not used as evidence, and a diagnostic isolated rebuild may have overlapped it. The final gate above
was started with an explicit handle, observed through every stage, and completed without overlap.

## What remains unverified and blocks production shadow

- The real `scripts/boot-zaruku-service.linux.test.mjs` fixture has **not** run. It must pass both
  privilege-drop cases in a reviewed network-disabled Linux Node + util-linux image with the
  documented fixture-only `SYS_PTRACE` capability.
- The target `dashboard-zaruku` account/group, `/usr/bin/setpriv`, `/proc`, `ss`, root-owned path
  ancestry, release/control/environment modes, runtime readability, PM2 UID/GID handling, process
  cwd attestation, port `127.0.0.1:3002`, and secret availability have **not** been inspected or
  provisioned on production.
- No production combined/isolated comparison has run, so there is no live canonical-snapshot parity
  claim and no evidence yet for production manager JSON, direct additions, history, coverage,
  source health, Alice, Wordstat, PDF, Excel, or auth parity.
- No production process was started, stopped, reloaded, or registered. No proxy configuration or
  route was read or changed. No rollback/recovery operation ran.

After these prerequisites are reviewed and pass, a separate authorized production-shadow plan may
start the isolated loopback process and capture live evidence. Public exact-path cutover requires a
second explicit review of that evidence and is outside this task. Abbott extraction remains later.

## Change boundary

Task 7 changes only the shadow verifier and its tests, its declared ZIP parser dependency, predeploy
gate and contract test, `OPS.md`, and this report. There were no source API/OAuth calls, database reads or writes, migration actions,
collector/backfill actions, deployments, proxy edits, PM2 actions, cron edits, secret
installation/rotation, Telegram sends, or Hermes schedules.
