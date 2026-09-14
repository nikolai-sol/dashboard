# Abbott Runtime Isolation Design

**Date:** 2026-09-14

**Status:** approved design, implementation not started

**Source branch:** `codex/abbott-runtime-isolation`

**Source revision:** `8f389a28df1c4b741ec33b7538f0354b74f5a40e`

## Goal

Run the existing Abbott manager dashboard as an independently built and released application without changing its visible behavior, URLs, access rules, canonical data, or exports. A later advertising-dashboard release must not replace Abbott, and an Abbott release must not replace advertising dashboards, Zaruku, or MedRoche.

The live shared application at revision `8f389a28df1c4b741ec33b7538f0354b74f5a40e` is the functional baseline. The private visual baseline is stored outside Git at `/Users/nafanya/Downloads/Abbott-dashboard-visual-baseline-2026-09-14`.

## Chosen approach

Create a dedicated Next.js application at `apps/abbott`, following the already proven application-boundary pattern used for Zaruku. Abbott receives its own build output, static asset prefix, immutable releases, process, port, health check, deploy command, rollback command, and exact reverse-proxy routes.

This is preferred over two alternatives:

1. Running the existing combined build on another port would isolate only the process, not the source or release contents.
2. Extracting every shared component into new packages before isolation would enlarge the change and introduce unrelated refactoring.

Only the small runtime contract that identifies dashboard ownership may be shared. Abbott application code must not import the combined application's page, route handlers, or advertising dashboard loaders at runtime.

## Runtime ownership

| Runtime | Port | Owns |
|---|---:|---|
| Combined advertising application | 3001 | Advertising dashboards, viewer login, admin UI, shared-password administration |
| Zaruku | 3002 | Existing Zaruku routes and assets |
| MedRoche/site SEO | 3003 | Existing MedRoche routes and assets |
| Abbott | 3004 | Abbott page, Abbott data API, Abbott exports, Abbott user-exclusion control, Abbott assets and health |

The port is a local implementation detail. Existing public Abbott URLs remain unchanged.

## Route boundary

Nginx sends only these exact Abbott surfaces to port 3004:

- `/dashboard/18` and its trailing-slash form;
- `/dashboard/abbott` and its trailing-slash form;
- `/api/dashboard/18`, `/api/dashboard/18/pdf`, `/api/dashboard/18/excel`, and `/api/dashboard/18/abbott-admin-users`;
- `/api/dashboard/abbott`, `/api/dashboard/abbott/pdf`, `/api/dashboard/abbott/excel`, and `/api/dashboard/abbott/abbott-admin-users`;
- `/_next-abbott/` static assets;
- `/api/health` on the direct port for deployment verification; Nginx does not expose it as an Abbott public path.

The generic `/api/dashboard-auth/login`, `/admin/**`, `/api/admin/**`, and `/api/admin/dashboards/18/shared-password` remain on port 3001. All advertising catch-all routes remain on port 3001. Existing Zaruku and MedRoche route blocks retain their current owners.

Unknown dashboard IDs and unsupported Abbott descendants fail closed; the Abbott application must not become a proxy or fallback for another dashboard family.

## Authentication and authorization

The login form still posts to the shared login endpoint on port 3001. That endpoint issues the existing signed viewer session. Port 3004 verifies the same signed session and current shared-password credential version using the existing production authentication secret and canonical credential table.

The isolated runtime does not display, store, rotate, or seed the shared password. Password administration remains on port 3001. The existing environment-backed embed key continues to authorize only the aggregate embed audience.

Authorization remains audience-scoped:

- `manager` may read the existing manager projection and operate the current Abbott user-exclusion control;
- `embed` reads only the aggregate projection and cannot access raw User IDs, visit IDs, journeys, private URLs, or manager mutations;
- an expired, invalid, wrong-dashboard, wrong-credential-version, or wrong-audience token is rejected.

## Application contents

`apps/abbott` contains only the code needed to render and serve Abbott:

- the Abbott page shell, header, access gate, date controls, tabs, charts and tables;
- the Abbott canonical loader and audience-specific data projection;
- the Abbott JSON response, PDF and Excel handlers;
- the current Abbott user-exclusion endpoint and UI;
- database connection boundaries for aggregate/embed and private/manager reads;
- Abbott date, URL, content identity, direction, MNN and presentation helpers;
- a health route and application-specific global styles/assets.

The initial implementation preserves behavior. It does not redesign components, rename labels, change filters, adjust calculations, fix existing chart warnings, or introduce new data.

## Data flow and privacy

Collectors remain shared and write canonical MySQL. The isolated dashboard never calls Metrica, Bitrix, advertising, or other external source APIs while rendering, filtering, or exporting.

The Abbott loader keeps the active-release publication rule and existing canonical tables. Manager reads keep the separate private database credentials. Embed reads keep the aggregate-only database credentials. No raw client ID is introduced, and no manager-only rows are copied into public assets or build artifacts.

Separating the application does not create another database, duplicate facts, change a collector schedule, activate a new canonical release, or rewrite historical data.

## Build and release

The app uses a unique Next.js output directory and `assetPrefix=/_next-abbott`. Its standalone release is packaged from an explicit source revision into an immutable directory under an Abbott-only release root. The package excludes environment files, uploads, workbooks, logs, temporary files, source control metadata, and unrelated dashboard assets.

The deployment command is fixed-authority: it accepts no arbitrary source path, destination, port, process name, or route owner. It verifies a clean approved revision, builds and tests the Abbott app, validates the release manifest, stages the release, starts or reloads only `dashboard-abbott`, and performs direct health and route checks before any proxy cutover.

Abbott deployment and rollback use their own lock. They do not restart `dashboard-next`, `dashboard-zaruku`, or `dashboard-medroche`, and cannot write to those release roots or process definitions.

## Cutover and rollback

The candidate first runs on port 3004 without public routing. Verification reads the same canonical period used by the visual baseline (`2026-09-01..2026-09-13`) and compares data contracts and rendered output.

Only after the candidate passes does Nginx move the exact Abbott routes from 3001 to 3004. Configuration validation occurs before reload. Post-cutover checks cover both Abbott aliases, data API, exports, manager access, embed isolation, static assets, health, and representative advertising/Zaruku/MedRoche routes.

Rollback changes only the Abbott route owner back to port 3001 and reloads the last known-good Nginx configuration. The shared application remains capable of serving Abbott during the first isolated rollout. Rollback does not change the database or collectors.

Removing Abbott code from the combined application is explicitly deferred until the isolated runtime has operated successfully and rollback no longer depends on the combined copy.

## Parity and test gates

Before cutover, all of the following must pass:

1. Existing Abbott contract, authorization, projection, date-range, URL identity and export tests.
2. New runtime-boundary tests proving Abbott owns only Abbott identities and paths.
3. Tests proving the app has no runtime dependency on combined pages, advertising loaders, Zaruku, or MedRoche.
4. Tests proving manager and embed database credentials and projections remain separated.
5. Artifact tests proving no private files, secrets, raw source exports, or unrelated dashboard assets enter the release.
6. Build, typecheck, lint, health, direct-port smoke and exact Nginx route tests.
7. Data parity for the recorded period, including dashboard metadata, KPI totals, tab availability, table row counts, exports and current user-exclusion behavior.
8. Visual comparison against all six baseline images: five live desktop tabs and the mobile first tab.
9. Regression smoke for advertising dashboards on 3001, Zaruku on 3002 and MedRoche on 3003 before and after cutover.

The current live payload exposes five tabs. Conditional Bitrix pages, Bitrix journeys, external events and time-on-site states are not represented by truthful live screenshots because their datasets are currently absent. Their code and data contracts remain mandatory tests, and any conditional tab that becomes visible before cutover must receive an additional baseline and parity capture.

## Existing baseline observations

The captured live page has no browser console errors. It produced 13 repeated chart-size warnings while tabs and viewport size changed. These warnings are baseline behavior, are not fixed by the isolation change, and must not be misreported as an isolation regression.

## Non-goals

- No UI redesign or wording changes.
- No new Abbott metric, source, tab, filter, or export field.
- No password rotation or access-policy change.
- No collector, cron, canonical schema, fact, or release activation change.
- No migration of the shared admin interface.
- No cleanup of the combined Abbott implementation during the initial cutover.
- No general monorepo or shared-component refactor beyond the minimum runtime contract required for isolation.

## Success criteria

Abbott renders and exports the same authorized data at the same public URLs from port 3004, matches the preserved visual and data baseline, and can be deployed or rolled back without changing any other dashboard runtime. A later release of the combined advertising application cannot overwrite the Abbott executable, static assets, route ownership, or release pointer.
