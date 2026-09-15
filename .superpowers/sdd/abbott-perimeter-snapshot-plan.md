# Abbott transaction perimeter snapshot

> Execute inline with TDD; stop for critical review before live use.

## Approved design

Retain the existing transported worker and fixed Abbott current record. Replace
historical neighbor PID/source/Nginx pins with a private in-memory snapshot
captured by the read-only preflight. Reauthorize semantic contracts only when
capturing; subsequent perimeter calls compare exact captured identities and
stable metadata. No caller/wire/temp-file snapshot is accepted.

Discover ports3001/3002/3003 from bounded direct proc network tables and a bounded
PID/fd scan; accept exactly one owner per loopback listener. Validate fixed
UID/GID and cwd contracts, root-owned nonwritable Node executable, established
server command shape, valid root-owned source records and the MedRoche immutable
release symlink. Record exact selected listener/PID/start/cwd/executable/cmdline,
release bytes/metadata and boot identity, not unrelated process activity.

Read the fixed Nginx config with existing nofollow/ownership/stability bounds.
Require structurally valid braces/directives and one TLS server containing the
exact target hostname among aliases. Refuse Abbott markers/routes/3004 targets.
Capture exact bytes/hash/metadata, not a historical hash. Do not edit Nginx.

Existing pre-stop, post-health/pre-pointer and compensation-end perimeter gates
compare the snapshot. Before mutation drift refuses; after mutation unresolved
drift preserves the reviewed fail-closed journal/lock. Other dashboards remain
read-only. Do not change the historical interrupted-recovery command's sealed
incident contract; this change is the normal Abbott deploy preflight only.

## Implementation sequence

- [ ] Add fake-proc/Nginx fixtures and RED tests: valid neighbor release/PID/commit
  changes before capture pass; the same changes after capture refuse. Update
  historical-pin tests to assert captured snapshot invariants instead.
- [ ] Implement bounded listener discovery, semantic process/release validation,
  structural Nginx sanity and exact in-memory snapshot comparison in
  `scripts/runtime-release-remote.mjs`. Reuse existing closed diagnostics,
  nofollow reads and activation/compensation boundaries.
- [ ] Cover multiple owners, wildcard/IPv6 listeners, PID/fd scan limits,
  proc disappearance/reuse/races, malformed source SHA, bad symlinks, byte and
  metadata drift, Nginx aliases/HTTP-vs-TLS/markers/routes. Prove zero mutation on
  initial refusal and review-lock preservation for post-mutation drift.
- [ ] Run focused tests, `npm run test:abbott-runtime`, post-build verification,
  contract/security checks, combined build, root/focused TypeScript and lint.
  Update runbook/report, commit, and stop for critical review. No push/live use.

The preferred single-snapshot design prevents concurrent changes. Recapturing
authority at each activation boundary would silently accept concurrent neighbor
updates; retaining historical pins would reject legitimate prior updates.
