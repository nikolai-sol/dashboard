# Abbott Metrika-First Release Design

## Status and decision

Abbott production activation is Metrika-first. The Yandex Metrika counter
`90602537` and its five canonical scopes are the factual authority. The copied
Bitrix dump is test-only and must not be imported into production or block the
first release. A live Bitrix connector will be introduced later through a
separately reviewed successor release.

## Required release inputs

Every validated Abbott release must contain exactly one imported snapshot and
one matching release-scoped import execution for each required workbook source:

- `abbott_workbook_json`
- `abbott_workbook_catalog`

These sources provide protected direction mappings and the material catalog.
They are private reference enrichment, not an authority for traffic totals.

The following sources are optional and independent:

- `abbott_bitrix_pages`
- `abbott_bitrix_journeys`

An optional source becomes required for a particular release only when it is
declared in that release's frozen baseline. If declared, its immutable
fingerprint, imported snapshot, release-scoped execution, and referenced ID
must reconcile exactly like a required source. Unknown source kinds, duplicate
snapshot IDs, missing required workbook kinds, and sources not declared by the
baseline fail validation.

## Metrika gate

The Metrika validation contract does not change:

- counter ID is exactly `90602537`;
- scopes are exactly `other`, `traffic`, `page`, `user_behavior`, and
  `returning` for every completed day;
- Reports API attribution is `lastsign`;
- `all.sessions = with_user_id.sessions + without_user_id.sessions` globally
  and per traffic source;
- `user_behavior` contains one private row per Logs API visit;
- no sampled, partial, unreconciled, or missing day may activate.

## Dashboard behavior without Bitrix

The active release still requires the two workbook snapshots. The dashboard
loads Metrika aggregates and visit-level manager data normally. Missing Bitrix
page or journey snapshots are represented by the existing explicit unavailable
source metadata and empty Bitrix rows. No test dump, legacy fallback, inferred
journey, or fabricated zero is introduced.

## Preflight and rollout

A successful repeat-safe schema rehearsal is sufficient local evidence for the
Metrika-first rollout. It is no longer marked partial merely because the live
Bitrix contract is deferred. Runtime credentials, the owner-delivered Metrika
token, migrations, source fingerprints, candidate comparison, full five-scope
coverage, manager/embed smoke checks, and human warning acceptance remain
mandatory.

The first production baseline and importer invocation include only the two
workbook sources. The private schema may still create empty Bitrix tables for
forward compatibility. The schema verification gate must include
`report_bd_private.canonical_fact_metrika_visits` and must not treat the legacy
daily behavior table as the visit-level authority.

## Later Bitrix connection

The live connector must define stable identifiers, completeness, incremental
extraction, and source timestamps before use. It creates a successor release
whose baseline declares the relevant Bitrix source kinds. It never mutates the
active Metrika-first release and never reuses the test dump as production
evidence.

## Error handling and rollback

Any mismatch among the baseline source set, release snapshot IDs, persisted
snapshots, or release import executions blocks validation with a sanitized
error. Metrika coverage or partition mismatches remain critical. Activation and
rollback continue to use the atomic Abbott active-release pointer; facts and
private rows are not copied or rewritten during pointer changes.

## Verification

Tests must prove:

- two workbook sources validate without Bitrix;
- either optional Bitrix source validates when declared and complete;
- a declared but missing/failed optional source blocks validation;
- missing workbook, unknown kind, duplicate ID, or baseline/release set mismatch
  blocks validation;
- the importer CLI accepts omitted Bitrix inputs;
- dashboard manager/embed projections remain safe when Bitrix is absent;
- preflight reports schema evidence ready rather than Bitrix-deferred partial;
- runbook commands contain no production Bitrix dump inputs and verify the
  visit-level table.
