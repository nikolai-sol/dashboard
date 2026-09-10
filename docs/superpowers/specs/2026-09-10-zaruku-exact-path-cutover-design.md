# Zaruku Exact-Path Production Cutover Design

## Goal

Move only the Zaruku dashboard from the combined `dashboard-next` runtime on
`127.0.0.1:3001` to the isolated `dashboard-zaruku` runtime on
`127.0.0.1:3002`, without changing public URLs or the runtime used by any
other dashboard.

The isolated application source is the reviewed commit
`0630a94c2ea493ba76e4c5932f6b83a351fbd810` on
`refs/heads/release/zaruku`. It contains the dedicated Wordstat and
`ИИ-видимость и конкуренты` views that are absent from the currently active
combined release `96f16c5df88da796813e701d565191b84dac278b`.

## Chosen Approach

Use exact-path Nginx routing after the existing production-shadow workflow has
started and verified the isolated runtime.

Two alternatives are rejected:

1. Redeploying the combined application would restore Zaruku temporarily but
   would again couple it to Gidrofuril, Abbott, and advertising releases.
2. Moving Zaruku to a new hostname would isolate routing but would break the
   approved public URL, bookmarks, and embed integrations.

Exact-path routing keeps the current hostname, leaves the broad combined
routes untouched, and can be rolled back by restoring one Nginx configuration
file.

## Scope and Non-Goals

The cutover changes only Zaruku HTTP routing and starts the already reviewed
isolated runtime. It does not:

- stop, restart, reload, or redeploy `dashboard-next` on port `3001`;
- change Abbott, Gidrofuril, advertising, preview, admin, authentication, or
  generic dashboard routes;
- run a collector or call Yandex, Google, Alice, or another external source;
- migrate, write, backfill, delete, or reclassify canonical MySQL data;
- rotate a password, auth secret, OAuth token, or database credential;
- change cron, PM2 configuration for another application, or public firewall
  exposure;
- remove compatibility adapters from the combined application.

## Preconditions

The operation fails closed before changing Nginx unless all of these are true:

- the source worktree is clean and exactly at
  `0630a94c2ea493ba76e4c5932f6b83a351fbd810`;
- the live `release/zaruku` ref equals that SHA;
- the full Zaruku test, typecheck, lint, build, runtime-artifact, and production
  shadow gates pass;
- `dashboard-zaruku` is the only process listening on `127.0.0.1:3002`, its
  cwd is `/var/www/dashboard-zaruku/apps/zaruku`, and its attested source SHA
  equals the reviewed release;
- an authenticated manager comparison has confirmed Wordstat, July/August
  Alice visibility, competitors, SEO OS, PDF, and Excel against canonical
  MySQL;
- `dashboard-next` is healthy on `127.0.0.1:3001`, and its PID, cwd, source SHA,
  and listener are recorded;
- the complete loaded Nginx configuration hash and the exact configuration
  file hash are recorded;
- port `3002` is not publicly reachable directly.

A missing valid manager session is a hard stop before deployment or cutover.
The session descriptor is supplied through the existing hidden-input installer
and is never printed or committed.

## Public Route Ownership

The following requests move to `127.0.0.1:3002`:

| Public request | Isolated upstream request |
| --- | --- |
| `/dashboard/zaruku` and `/dashboard/zaruku/` | same path |
| `/api/dashboard/zaruku` | same path |
| `/api/dashboard/zaruku/pdf` | same path |
| `/api/dashboard/zaruku/excel` | same path |
| `/_next-zaruku/*` | same path; the isolated Next.js rewrite owns its internal `/_next/*` mapping |
| `/dashboard/28` and `/dashboard/28/` | `/dashboard/zaruku`, preserving the query string |
| `/api/dashboard/28` | `/api/dashboard/zaruku`, preserving the query string |
| `/api/dashboard/28/pdf` | `/api/dashboard/zaruku/pdf`, preserving the query string |
| `/api/dashboard/28/excel` | `/api/dashboard/zaruku/excel`, preserving the query string |

The numeric aliases are exact matches. No prefix such as `/dashboard/280` or
`/api/dashboard/280` can enter the Zaruku runtime.

All other paths continue to use the current Nginx configuration and port
`3001`. In particular, `/api/health`, `/api/dashboard-auth/*`, `/admin/*`,
`/_next/*`, and the broad `/dashboard/*` fallback remain owned by the combined
runtime. The isolated application shares the existing Zaruku access model and
the same protected auth-secret value, so the existing dashboard-auth cookie is
accepted without moving the shared login endpoint.

## Nginx Change

The cutover inserts only exact Zaruku locations and the dedicated asset-prefix
location before the existing `location ^~ /dashboard/` and `location /`
fallbacks. Each proxied request retains the existing host, client IP,
forwarding protocol, upgrade, cache-bypass, timeout, CSP, and HSTS behavior.

The operator creates a candidate configuration from an exact expected
predecessor hash. It refuses an unexpected file, an already-cut-over file,
duplicate Zaruku locations, any pre-existing reference to port `3002`, or a
configuration whose broad `3001` ownership is not recognized.

The remote mutation sequence is:

1. create a root-owned mode-`0600` backup containing the exact predecessor;
2. write the complete candidate to a root-owned temporary file in the same
   filesystem;
3. validate the candidate's exact route grammar and hashes without loading it;
4. atomically rename the candidate over the target;
5. run `nginx -t` against the complete installed configuration before reload;
6. if syntax validation fails, restore the verified backup before returning;
7. reload Nginx without restarting it;
8. run the post-cutover checks;
9. on any failure after installation, atomically restore the verified backup,
   run `nginx -t`, reload, and verify that Zaruku again resolves to `3001`.

The backup is retained until the post-cutover report is accepted. Rollback
does not stop the isolated process; it only removes public traffic from it.

## Verification

The post-cutover gate requires all of the following:

- public `/dashboard/zaruku` returns `200` and loads only
  `/_next-zaruku/` application assets;
- the authenticated Zaruku JSON endpoint returns the expected dashboard type
  and the Wordstat and Alice visibility objects;
- the manager UI shows eight tabs, including `ИИ-видимость и конкуренты` and
  `Спрос Wordstat` in the approved order;
- July/August Alice snapshots and competitor detail remain available;
- Wordstat retains its real coverage/status labels rather than fallback data;
- Zaruku PDF and Excel endpoints complete under the existing authorization;
- `/dashboard/28` and the numeric API aliases reach the same isolated result;
- `dashboard-next` retains its exact pre-cutover PID, cwd, source SHA, and
  `127.0.0.1:3001` listener;
- representative Gidrofuril, Abbott, advertising, shared login, and public
  health requests retain their pre-cutover status and asset ownership;
- the loaded Nginx configuration differs only by the reviewed Zaruku route
  block;
- canonical table counts and period totals used by the shadow parity check are
  unchanged;
- neither port `3001` nor `3002` is reachable directly on the public host.

An authenticated browser smoke verifies tab navigation at desktop width and a
narrow mobile width. Browser or application errors introduced by the cutover
are a rollback condition.

## Failure Handling

Before Nginx installation, any failure leaves production unchanged. After
installation, failure of syntax validation, reload, health, authentication,
route identity, foreign-runtime stability, asset loading, or data parity
triggers the exact backup rollback.

If rollback validation fails, the operation stops and reports the installed
and backup hashes without attempting another mutation. It never guesses a
configuration, restarts all PM2 processes, or deploys the combined application.

## Implementation Units

- `scripts/zaruku-exact-path-cutover.mjs` owns pure configuration generation,
  exact predecessor/candidate validation, the fixed remote mutation sequence,
  post-cutover verification, and rollback.
- `scripts/zaruku-exact-path-cutover.test.mjs` covers exact route ownership,
  numeric aliases, unrelated-route preservation, stale-predecessor refusal,
  fault-triggered rollback, and secret-free evidence.
- `deploy/zaruku/nginx-cutover.json` pins the target file, reviewed application
  SHA, ports, exact routes, and expected asset prefix. It contains no secret.
- `docs/superpowers/reports/2026-09-10-zaruku-exact-path-cutover.md` records
  only sanitized hashes, SHAs, PIDs, route/status assertions, data-parity
  assertions, rollback readiness, and the final result.

The cutover implementation lives on `codex/zaruku-exact-path-cutover`; the
reviewed application artifact remains sourced from the unchanged
`release/zaruku` commit `0630a94c2ea493ba76e4c5932f6b83a351fbd810`.

## Completion Boundary

The work is complete only when Zaruku public and numeric-alias requests resolve
to the attested isolated runtime on `3002`, the two restored tabs and exports
pass authenticated smoke checks, all other dashboards remain on the unchanged
combined runtime on `3001`, and a verified rollback configuration remains
available. A running loopback shadow without public exact-path routing is not a
completed cutover.
