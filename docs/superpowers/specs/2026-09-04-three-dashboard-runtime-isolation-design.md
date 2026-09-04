# Three Dashboard Runtime Isolation Design

## Goal

Split the current combined `dashboard-next` production application into three
independently built, deployed, versioned, locked, and rolled-back runtimes:

1. advertising dashboards plus the shared portal and admin UI;
2. Zaruku;
3. Abbott.

The existing public URLs, login flows, dashboard data, and manager workflows
must remain unchanged. Releasing one runtime must not change the active version
of either of the other two runtimes.

## Why Branches Alone Are Insufficient

Separate development branches protect concurrent source edits, but the current
deployment still replaces one `/var/www/dashboard` runtime and one PM2 process.
A deployment from any branch can therefore replace every dashboard at once.

The solution combines branch isolation with runtime isolation. Each dashboard
family receives its own application entry point, artifact, production process,
release directory, active source attestation, deployment lock, health check,
and rollback history.

## Selected Architecture

Keep one Git repository and reorganize the product as a monorepo with three
application roots and narrowly scoped shared packages:

```text
apps/
  advertising/   # portal, admin, and advertising dashboards
  zaruku/        # Zaruku UI, API, exports, and operational endpoints
  abbott/        # Abbott UI, API, exports, embed, and protected operations
packages/
  auth-contract/ # signed-session formats and access-policy primitives
  db-core/       # connection primitives without dashboard-specific queries
  ui-core/       # genuinely shared presentation primitives
  report-core/   # safe PDF/Excel foundations without domain projections
services/
  advertising/   # advertising collectors and publication operations
  zaruku/        # Zaruku collectors and manual imports
  abbott/        # Abbott collection and private operational jobs
```

Dashboard-specific components, queries, schemas, collectors, imports, and
exports live in their owning application or service. Shared packages may not
import from an application. An application may import shared packages and its
own domain service only.

The migration will reuse current code and move it by ownership. It will not
rewrite working dashboard calculations or replace canonical data paths.

## Public Routing and URL Compatibility

The existing domain and browser-visible URLs remain unchanged. The reverse
proxy routes requests internally:

| Existing public path | Owning runtime |
| --- | --- |
| `/`, `/admin/**`, `/api/admin/**`, `/api/viewer-portal/**` | advertising |
| `/dashboard/zaruku` and `/dashboard/zaruku/**` | Zaruku |
| `/api/dashboard/zaruku` and `/api/dashboard/zaruku/**` | Zaruku |
| `/dashboard/abbott` and `/dashboard/abbott/**` | Abbott |
| `/api/dashboard/abbott` and `/api/dashboard/abbott/**` | Abbott |
| `/dashboard/<other-id>` and matching dashboard APIs | advertising |
| `/api/dashboard-auth/login` | advertising |

Framework assets use non-conflicting internal prefixes:

- advertising: `/_next/**`;
- Zaruku: `/_next-zaruku/**`;
- Abbott: `/_next-abbott/**`.

Zaruku- and Abbott-specific public images or downloadable assets use
`/assets/zaruku/**` and `/assets/abbott/**`. These are supporting browser
requests, not changes to any dashboard link. The proxy must route exact
Zaruku and Abbott paths before the generic advertising catch-all.

The shared dashboard login endpoint stays in the advertising/control runtime so
the current login form does not change. All three runtimes validate the same
versioned signed-session contract. They read current credential authority from
canonical storage; no application accepts another application's environment
fallback. Abbott's existing embed credential remains Abbott-only.

Before cutover, an automated route inventory must compare the live route list
with this ownership map. Any current Zaruku- or Abbott-specific route discovered
under a generic prefix is assigned to its domain runtime before proxy changes.

## Production Runtime Boundaries

Use three independent loopback-only processes:

| Runtime | PM2 name | Default loopback port | Application directory |
| --- | --- | --- | --- |
| advertising | `dashboard-advertising` | `3001` | `/var/www/dashboard-advertising` |
| Zaruku | `dashboard-zaruku` | `3002` | `/var/www/dashboard-zaruku` |
| Abbott | `dashboard-abbott` | `3003` | `/var/www/dashboard-abbott` |

Each runtime also owns separate sibling `-releases` and `-backups` directories.
Each deploy uses a fixed scope-specific lock under `/var/www`, writes the full
Git SHA and runtime scope into immutable release metadata, and may activate or
roll back only its own application directory.

Deploy scripts reject caller overrides for scope, PM2 name, port, application
directory, release directories, lock path, SSH authority, and base release
branch. The selected scope is encoded by the script entry point, not accepted
as an arbitrary environment variable.

The current combined deployment guard remains active until all three route
cutovers pass and the combined runtime is no longer serving traffic.

## Branch and Worktree Model

Create three long-lived release branches:

- `release/advertising`
- `release/zaruku`
- `release/abbott`

Feature branches use an owning prefix such as `codex/zaruku-*`,
`codex/abbott-*`, or `codex/advertising-*` and are developed in separate
worktrees. A feature branch merges only into its matching release branch.

`main` remains the repository integration and reference branch; it is not a
universal production pointer. Production authority is the separately attested
active SHA for each runtime. A deploy must contain the current active SHA of
that same runtime, but it does not need to contain the active SHA of another
runtime.

Changes to a shared package require explicit compatibility changes in every
affected release branch. They are never propagated by automatically merging all
of `main` into all three release branches. This prevents an unrelated Abbott
commit from silently entering a Zaruku release while still allowing intentional
shared fixes.

Initial release branches are created only after reconciling the current active
production SHA with the latest reviewed domain branch. Uncommitted files and
unreviewed worktrees are not used as branch seeds.

## Data Plane and Migration Ownership

All dashboard request, render, filter, export, and read-model code continues to
read canonical MySQL. No runtime may call an external source API. External APIs
remain collector-only.

The existing canonical history is retained in place. Splitting applications
does not copy, delete, reclassify, or replace facts. Directly added canonical
history remains visible and period totals must be regression-tested before each
domain cutover.

Database access is least-privilege by runtime:

- advertising receives only advertising and shared portal/admin permissions;
- Zaruku receives only Zaruku and required shared credential reads;
- Abbott manager operations retain the private Abbott role;
- Abbott embed reads retain the separate aggregate-only role;
- neither advertising nor Zaruku receives Abbott private credentials.

Existing globally numbered migrations remain immutable. New migration manifests
classify every migration as `shared`, `advertising`, `zaruku`, `abbott-public`,
or `abbott-private`. A domain deployment may run only its allowed manifest.
Shared migrations require an explicit compatibility review for all consumers.
No deployment infers migration ownership from a filename alone.

Collectors and manual imports publish to the same existing canonical tables and
coverage mechanisms. Their packaging and schedules move to the owning service,
so deploying the UI of another runtime cannot replace their executable files.

## Application Boundaries

The current combined dashboard page is split into domain entry points:

- advertising owns the generic advertising dashboard page and shared portal;
- Zaruku owns only the Zaruku page and the Zaruku read model;
- Abbott owns only the Abbott page and Abbott projections.

Each API runtime enforces its dashboard family after resolving the canonical
dashboard record. A request for a non-owned dashboard returns `404` before
loading domain data. This is a second boundary behind reverse-proxy routing and
prevents a proxy mistake from exposing another domain.

PDF and Excel generation execute in the owning runtime and keep their existing
public URLs. Generated reports use the same audience and credential checks as
the interactive dashboard. Abbott manager-only fields remain absent from embed
and non-manager exports.

Each build sets a distinct Next.js asset prefix and produces a scope-specific
build directory. Therefore one runtime cannot serve stale JavaScript chunks
from another runtime, and a deployment cannot delete another application's
browser assets.

## Release and Rollback Flow

For each runtime independently:

1. verify a clean named branch and its allowed release branch ancestry;
2. run the scope-specific tests plus shared contract tests;
3. build only the selected application and its allowed service artifacts;
4. inspect the artifact for forbidden routes, credentials, source files, and
   cross-domain private assets;
5. acquire only the runtime's deployment lock;
6. recheck the active SHA for that runtime under the lock;
7. stage, activate, attest scope and SHA, and smoke the loopback endpoint;
8. smoke the existing public URLs routed to that runtime;
9. retain and prune only that runtime's rollback history.

On failure, rollback restores only the affected runtime. The other two PM2
processes, active directories, release metadata, and routes remain unchanged.

## Migration Sequence

### Phase 1: Foundations Without Traffic Changes

Add the monorepo application boundaries, route ownership contracts,
scope-specific build commands, artifact policies, process definitions, deploy
scripts, migration manifests, and cross-runtime regression tests. Run all three
new applications in parallel on loopback ports while the combined runtime still
serves public traffic.

### Phase 2: Zaruku Cutover

Seed `release/zaruku` from the reconciled reviewed Zaruku baseline. Compare all
current Zaruku tabs, source health, Wordstat, SEO OS, Alice visibility, date
filters, authentication, PDF, Excel, and historical totals between the combined
and isolated runtimes. Route the existing Zaruku paths to port `3002`. Prove by
test and production attestation that a Zaruku deployment and rollback do not
change advertising or Abbott SHAs.

### Phase 3: Abbott Cutover

Seed `release/abbott` from the reconciled reviewed Abbott baseline. Validate
manager, viewer, embed, aggregate/private database separation, current release
facts, exports, and all Abbott privacy contracts. Route the existing Abbott
paths to port `3003`. Prove that Abbott deployment and rollback do not change
the other active SHAs.

### Phase 4: Advertising Cutover and Combined Runtime Retirement

Seed `release/advertising` from the reconciled advertising baseline. Keep the
portal, admin UI, shared login, and all non-Zaruku/non-Abbott dashboard paths on
port `3001`. After all three route groups pass an agreed observation window,
stop the old combined process and retain its final artifact as a rollback-only
backup. No canonical data is removed.

## Verification and Acceptance Criteria

The split is complete only when all of the following have fresh evidence:

1. Existing public URLs and query parameters behave identically.
2. Portal login, dashboard password login, admin login, Abbott embed access,
   PDF, and Excel pass through the new routing.
3. Zaruku and Abbott historical period totals match the pre-cutover runtime;
   direct manual additions remain visible.
4. Each artifact contains only its owned routes and allowed supporting files.
5. Advertising and Zaruku artifacts contain no Abbott private data or private
   database credentials.
6. Deploying and rolling back each runtime leaves the other two active SHAs,
   PM2 processes, directories, and health endpoints unchanged.
7. Parallel deploys to different runtimes may proceed; parallel deploys to the
   same runtime serialize under its own lock.
8. A stale candidate for one runtime is rejected against that runtime's active
   SHA without consulting another runtime's release history.
9. Reverse-proxy rollback can return one route group to the combined runtime
   without changing the other two route groups.
10. Production processes listen only on loopback and public smoke checks pass
    through the existing domain.

## Out of Scope

- changing dashboard calculations, labels, or visual design;
- changing the existing public URLs or domain;
- replacing canonical MySQL or rewriting historical data;
- creating new external API collection behavior;
- rotating passwords, API tokens, or Abbott embed credentials;
- changing collection cron schedules;
- deploying or cutting over production as part of the architecture/spec commit.
