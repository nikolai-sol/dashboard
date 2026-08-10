# Abbott URL Identity Resolution and Content Coverage

**Date:** 2026-08-10

**Status:** approved product direction; implementation requires a reviewed plan

**Scope:** Abbott only. Zaruku, Gidrofuril, Bitrix live integration, source API
collection, and other dashboards are unchanged.

## Goal

Remove false `Не определено` values from the Abbott page-statistics dashboard
by resolving an observed page to one canonical content entity through strong,
reviewed URL identity before using weak title or slug evidence. Preserve
append-only releases, human approval, historical metric totals, and the
canonical-MySQL-only dashboard boundary.

## Confirmed Current State

- Active Abbott release: `24`; previous/rollback release: `14`.
- Active catalog release `24` contains 3,446 rows and 2,049 distinct entities.
- Active catalog rows/entities missing direction: `0`.
- Active catalog rows/entities missing material type: `0`.
- Lookup projection ambiguity in release `24`:
  - path: 438 groups;
  - title: 712 groups;
  - slug: 591 groups.
- The dashboard loads only `unique` and `identical_collapsed` projection rows.
- The current dashboard lookup order is title, then path, then slug. This puts
  weak title evidence ahead of stronger URL evidence.
- Draft approval batch `6` contains 122 ready, 510 conflict, 138 unresolved,
  63 rejected, 626 no-change, and 0 accepted rows.
- Batch `6` conflict composition is 307 `ARCHIVE_TYPE_INVALID`, 111
  `IDENTITY_COLLISION`, 63 `DIRECTION_CONFLICT`, 26 `ACCESS_CONFLICT`, and 3
  `MATERIAL_TYPE_CONFLICT` rows.
- July dashboard coverage is 419 of 899 page rows and 9,212 of 33,205
  pageviews. August 1-9 coverage is 183 of 346 page rows and 1,543 of 6,138
  pageviews.

The catalog is therefore classified, but the analytics-page-to-entity join is
not complete. The fix belongs in identity resolution and release
materialization, not in Metrika collection.

## Product Decisions

1. A full normalized URL or approved URL alias is stronger identity evidence
   than a title, path-only fallback, or slug.
2. The dashboard never guesses among conflicting entities.
3. A service/navigation/account page receives explicit taxonomy values instead
   of remaining `Не определено`.
4. Existing direction and type assignments do not flip automatically.
5. Batch `6` remains immutable evidence. Corrections are published in a new
   approval batch rather than rewriting batch `6`.
6. Historical Metrika facts are not recollected. A successor release is built
   DB-native from release `24`, with changed content identity/projection rows
   only.
7. Google Sheets remains the human approval surface; canonical MySQL remains
   the only runtime source of truth.

## Canonical URL Identity

The shared normalizer must produce byte-identical identities in Python and
TypeScript. It:

- lowercases scheme and host;
- normalizes the Abbott host aliases to the approved canonical host;
- removes fragments and known tracking parameters, including UTM parameters;
- normalizes percent encoding and redundant/trailing slashes;
- preserves query parameters that change semantic page identity;
- does not silently equate `.php` routes or unrelated paths;
- represents an approved redirect or legacy route through an explicit alias.

`portal_content_registry_aliases` remains the canonical alias registry.
`canonical_url` and `url` are strong aliases and must identify exactly one
active `content_entity_id` inside their uniqueness scope.

## Projection and Dashboard Lookup

Add `url` to the release-scoped lookup projection. Candidate materialization
creates URL projection rows from the entity canonical URL and every active,
reviewed strong URL alias.

The lookup precedence becomes:

1. exact normalized full URL;
2. exact approved URL alias;
3. unique compatible normalized path;
4. unique compatible normalized title;
5. unique compatible slug;
6. unresolved.

Title and slug remain weak fallbacks. They may resolve only when the projection
contains one compatible metadata signature. An ambiguous projection is never
loaded into the dashboard lookup maps.

The page table, charts, filters, and exports all consume the same resolved
metadata object. There is no separate UI-only mapping table.

## Service Pages

Observed non-content routes such as authentication, registration, profile,
policy, sitemap, and other navigation/account pages are classified explicitly:

- direction: `not_applicable` / `Не относится / служебная`;
- material type: new taxonomy term `service_page` / `Служебная страница`;
- access: the reviewed route-appropriate access term.

Section and landing pages keep `section` or `subsection` where appropriate.
`service_page` is not applied to medical materials merely because their
identity is currently unresolved.

## Approval Batch Resolution

Create a successor review batch from the immutable reconciliation inputs used
for batch `6`, plus the observed canonical page URLs through the latest
completed day.

Resolution rules:

- 307 `ARCHIVE_TYPE_INVALID` rows: move archive intent to lifecycle
  `archive_candidate`; retain or propose the actual material type. Publication
  as archived still requires reviewed override or HTTP 404/410 evidence.
- 111 `IDENTITY_COLLISION` rows: the reviewer selects the canonical entity for
  the exact URL and supplies a mandatory reason. Acceptance creates or retires
  the corresponding strong alias event.
- Direction, material-type, and access conflicts: preserve the active value by
  default; a change requires an explicit correction decision, actor, reason,
  and predecessor event.
- 138 unresolved rows: run deterministic classification first, then the
  approved structured LLM proposal path when evidence remains insufficient.
  Final direction and material type still require human approval.
- 122 ready rows: remain ready unless the refreshed URL identity changes their
  entity binding.
- 626 no-change rows: remain reconciled evidence and are not republished as new
  decisions.

The weekly discovery job reads canonical page facts and registry tables. It
does not call Metrika from the dashboard or approval path. If no new,
ambiguous, or unresolved observed URLs exist, it records a successful-empty
review run and sends no approval request.

## Successor Release

After batch acceptance:

1. create a staging successor release;
2. clone the required release-scoped Abbott fact rows from active release `24`
   inside MySQL with exact count and fingerprint reconciliation;
3. materialize accepted classification events, catalog rows, strong aliases,
   and the rebuilt lookup projection;
4. validate taxonomy, alias uniqueness, anti-flip history, source receipts,
   data coverage, and page-stat resolution;
5. compare June, July, and August aggregate totals with release `24`;
6. activate only after approved cutover and smoke tests.

This is not a Metrika backfill. No OAuth token, Logs API job, or Reports API
request is used. Pageviews, visitors, sessions, and visit facts remain
unchanged; only their content metadata resolution changes.

## Publication Gates

Activation requires:

- zero strong URL aliases mapped to multiple active entities;
- zero accepted identity collisions;
- zero accepted anti-flip violations;
- zero out-of-taxonomy values;
- exact batch count and accepted-decision-hash reconciliation;
- every observed content-like Abbott URL with traffic in June, July, August,
  and the current completed-month window resolves to direction and material
  type;
- every observed non-content URL is explicitly classified as a service page or
  has a reviewed exclusion reason;
- pageviews, visitors, sessions, and visit counts match release `24` exactly for
  the same periods and filters;
- dashboard direction/type filters, charts, table totals, and XLSX export use
  the same resolved metadata;
- Abbott health and session integrity remain `OK`;
- public Abbott assets remain unavailable;
- Zaruku and every other dashboard gitlink and runtime remain unchanged.

## Failure and Rollback

- An ambiguous or missing identity stays visible in the review batch and does
  not receive guessed metadata.
- A failed batch ingestion or candidate validation leaves release `24` active.
- A failed post-cutover smoke test restores the pointer to release `24` and the
  previous dashboard application release.
- No rollback restores removed public PII assets.
- Candidate failure never triggers a Metrika backfill.

## Verification

Automated coverage includes:

- Python/TypeScript URL-normalization parity fixtures;
- strong-alias uniqueness and collision tests;
- projection materialization tests for exact URL, alias, path, title, and slug;
- lookup-precedence regression tests proving URL wins over conflicting title;
- service-page taxonomy tests;
- immutable batch and anti-flip tests;
- DB-native clone reconciliation tests;
- June/July/August before-and-after aggregate controls;
- dashboard API, filter, export, and browser smoke tests;
- checks that no source API, token, Bitrix connector, Zaruku code, or unrelated
  dashboard code changed.

