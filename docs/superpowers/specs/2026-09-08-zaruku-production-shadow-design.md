# Zaruku Production Shadow Design

**Date:** 2026-09-08  
**Status:** approved for planning  
**Candidate source:** `ee950f3917d0f8616b6229d4049410a0afb7e380`  
**Public cutover:** explicitly out of scope

## Objective

Run the isolated Zaruku application beside the current combined production application and prove
that both return the same manager-visible result from the same canonical MySQL state. The current
public URLs must continue to use the combined runtime throughout this work.

The deliverable is a loopback-only Zaruku process on `127.0.0.1:3002` plus a sanitized, reviewed
parity report. This design does not authorize an Nginx change, a public route cutover, a collector
change, a data migration, or an Abbott extraction.

## Verified Starting State

Read-only inspection on 2026-09-08 established:

- the combined `dashboard-next` PM2 process is online and listens on `127.0.0.1:3001`;
- `127.0.0.1:3002` is not occupied;
- `/usr/bin/setpriv`, `/usr/bin/python3`, `/usr/bin/ss`, and PM2 are installed;
- the SSH operator is `root`, while the combined PM2 process also currently runs as `root`;
- the `dashboard-zaruku` account and group do not exist;
- `/var/www/dashboard-zaruku` and `/var/www/.dashboard-zaruku-secrets` do not exist;
- Nginx sends `/dashboard/` and the fallback location to `127.0.0.1:3001`.

No secret value, database row, Nginx setting, process, account, directory, or permission was
changed during inspection.

## Runtime Topology

The combined runtime remains authoritative on `127.0.0.1:3001`. The isolated Zaruku runtime is
installed under `/var/www/dashboard-zaruku`, runs as the fixed `dashboard-zaruku` service identity,
and listens only on `127.0.0.1:3002`. Its PM2 application name is `dashboard-zaruku`.

The release uses the already-reviewed Zaruku authority:

- runtime scope: `zaruku`;
- release branch: `release/zaruku`;
- application directory: `/var/www/dashboard-zaruku`;
- isolated release and backup directories;
- isolated deploy lock `/var/www/.dashboard-zaruku-deploy.lock`;
- isolated asset prefix `/_next-zaruku`.

The shadow process is never added to Nginx during this stage. Only loopback requests made on the
server may reach it. The combined application, advertising dashboards, Abbott runtime, collectors,
cron, and public static assets are not restarted or modified.

## Production Identity and Filesystem Boundary

Provision a locked system account and group named `dashboard-zaruku`. The account has no interactive
shell, no home-directory workflow, no sudo authority, and no membership in groups used by Abbott,
collectors, or the combined application.

Root owns the control, release, backup, and secret ancestry. The service identity receives only the
minimum read and execute permissions required to start the active Zaruku artifact and read its
rendered runtime environment. It cannot write the active artifact, release authority, deployment
metadata, trusted manifest, secret input, or another runtime's directories.

Before any application code starts, the Linux privilege fixture must prove real and effective UID/GID
drop, cleared supplementary groups and capabilities, `no_new_privs`, expected working directory,
expected process identity, and loopback-only ownership of port `3002`. A failed identity or filesystem
check is a hard stop.

## Database Boundary

Create a dedicated MySQL account for the Zaruku runtime. It is read-only and is scoped to the
canonical/shared tables used by the reviewed Zaruku dependency graph. It receives no write grant,
no schema-management grant, no grant option, and no access to `report_bd_private`.

The reviewed grant inventory must cover only these functional groups:

- shared dashboard identity and access: `dashboards`, `dashboard_access_users`;
- canonical traffic and returning-content facts;
- canonical Metrika breakdown facts and coverage;
- canonical Webmaster and GSC facts;
- canonical collector/source health metadata;
- normalized Alice visibility snapshots, queries, sources, and featured sites;
- normalized Wordstat registry, classifications, coverage, demand, region, and dynamics facts;
- SEO OS positions, patterns, opportunities, tasks, weekly runs, and approved read models.

Before grants are applied, an automated source inventory is compared with the proposed SQL grant
manifest. An unexpected table fails the gate; it is not granted implicitly. After provisioning,
positive reads against every allowed table family and negative reads against a write operation,
`report_bd_private`, and representative advertising-only tables must be recorded without returning
row contents.

The production renderer accepts database credentials only from
`/var/www/.dashboard-zaruku-secrets/runtime.env`. The directory is root-owned mode `0700`; the file is
root-owned, single-link, mode `0600`, strict UTF-8, bounded, and uses the existing exact
`ZARUKU_DB_*` allowlist. Generic `MYSQL_*` or `DB_*` inputs are rejected. Secret values never appear
in commands, process listings, logs, evidence, or Git.

The existing `DASHBOARD_AUTH_SECRET` is copied by a privileged local operation into the dedicated
input without printing it. Reusing this authority during shadow is necessary so the same reviewed
manager session can be compared on both runtimes. This is not a rotation.

## Release and Start Sequence

The candidate is the exact reviewed commit
`ee950f3917d0f8616b6229d4049410a0afb7e380`. The deployment gate requires a clean named source branch
and the reviewed `release/zaruku` authority to contain that commit. The artifact is built, stamped,
transported, and verified with the existing external trusted-manifest policy.

Preparation order is fixed:

1. run the Linux build-helper and privilege-drop fixtures on the target platform;
2. provision and attest the service identity and filesystem boundary;
3. provision and test the dedicated read-only database identity;
4. install the dedicated secret input without exposing its values;
5. run the full local predeploy gate at the candidate SHA;
6. transport and verify the sealed Zaruku artifact;
7. start `dashboard-zaruku` on `127.0.0.1:3002` under the service identity;
8. attest PID, UID/GID, working directory, artifact SHA, runtime scope, listener, and health;
9. verify that Nginx still references only `127.0.0.1:3001` for existing dashboard routes.

No step may silently substitute another commit, branch, environment file, account, port, directory,
or manifest. A failed step stops before the next state change.

## Same-Snapshot Parity

Both loopback runtimes read the same live canonical database state. The comparison label records the
database observation time and candidate SHAs, but it does not lock tables or pause collectors. To
avoid a false mismatch from data arriving between requests, the verifier performs paired reads and
repeats a mismatched pair once only when source coverage advanced during that pair. Any stable
difference is `NO-GO`; the verifier never copies or rewrites facts to make results match.

The principal comparison range is `2026-01-01` through `2026-08-31`. It includes explicit assertions
for:

- manager-visible totals and dated direct historical additions;
- January-through-August period history;
- July Wordstat demand and its coverage/health meaning;
- August Alice visibility, Zaruku positions, competitors, mentions, citations, and share of queries;
- SEO OS positions, opportunities, tasks, and proposed improvements;
- traffic-quality and medical/noise classifications without reclassification;
- Metrika, Webmaster, GSC, Wordstat, Alice, and SEO OS availability and freshness states;
- unauthorized response status and challenge metadata;
- authorized manager JSON with documented volatile fields normalized;
- PDF and Excel semantic content with only reviewed generation metadata normalized;
- exact Zaruku route inventory, runtime scope, source SHA, and absence of Abbott/private markers.

The auth descriptor is passed by a protected file descriptor, never as an argument. Evidence contains
only sanitized statuses, counts, hashes, route names, period labels, and mismatch descriptions. It
does not contain cookies, authorization headers, passwords, raw manager payloads, or private paths.

## Failure Handling and Rollback

Provisioning and deployment are fail-closed. Before every mutation, the operator captures only the
non-secret predecessor state required to reverse that mutation. A failure may remove or stop only the
new Zaruku shadow resources created by this stage. It must not stop, restart, reload, or roll back the
combined `dashboard-next` application.

If the shadow process fails health, identity, artifact, listener, or parity checks, the result is
`NO-GO`. The process is stopped unless retaining a loopback-only failed instance is explicitly needed
for reviewed diagnosis. Nginx remains unchanged, so public service continuity does not depend on the
shadow rollback.

Database grants and the service account are retained only when their final attestations pass. Secret
files are never included in diagnostic archives. All cleanup targets are exact named Zaruku paths and
identities; no recursive operation may target `/var/www`, the repository root, or a variable-derived
broad path.

## Evidence and Acceptance Gates

The shadow stage is accepted only when one evidence bundle records:

- exact source and artifact SHA;
- clean release authority and trusted-manifest validation;
- Linux build-helper and privilege-drop fixture results;
- service account, filesystem, PM2, PID, UID/GID, capability, working-directory, and listener checks;
- dedicated database grant inventory plus positive/negative permission checks;
- health, authorization, manager JSON, PDF, Excel, history, direct-addition, source-status, Wordstat,
  Alice, and SEO OS parity;
- unchanged Nginx configuration hash and unchanged combined-process identity/health;
- no Abbott marker, private database access, collector call, cron change, or public route change;
- a final `GO` or `NO-GO` for a later cutover plan.

`GO` means only that the isolated runtime is ready for a separately reviewed exact-path cutover.
It does not authorize that cutover. `NO-GO` leaves the current public service on the combined runtime.

## Out of Scope

- editing or reloading Nginx;
- sending any public request to port `3002` through the domain;
- changing public URLs, cookies, or dashboard identifiers;
- modifying canonical facts, coverage, imports, collectors, cron, or external source APIs;
- rotating shared authentication authority;
- extracting Abbott or advertising runtimes;
- deleting the combined compatibility path;
- merging branches or creating a Pull Request.

