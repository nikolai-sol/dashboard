# Abbott Metrika-first Release Gate Design

## Decision

Abbott production rollout is Metrika-first. The protected workbook JSON and
catalog are the two required imported source kinds. The exploratory Bitrix dump
remains test-only and does not block release activation while the live read-only
Bitrix connector and its completeness contract are deferred.

## Validation contract

The release gate requires all of the following:

- a staging candidate bound to the reviewed code revision and predecessor;
- both workbook source snapshots, with immutable content, size, parser and
  per-release import evidence matching the frozen baseline;
- any Bitrix source declared by a future baseline to satisfy the same checks;
- the latest completed comparator batch to contain exactly the frozen aggregate
  controls plus the five required Metrika coverage controls;
- every day in the requested interval to contain the exact reconciled,
  unsampled five-scope bundle.

The reviewed predecessor that predates release-scoped Metrika facts produced
an empty aggregate `control_values` mapping. This one-time exception is bound
to immutable baseline snapshot 13 and predecessor release 1; it is not a
general fallback for future releases. The comparator and validation gate still
require the five coverage controls and the exact calendar gate. Any other empty,
missing or non-object `control_values` field is invalid. June production smoke
controls provide the external Metrika comparison before the rollout is declared
complete.

## Failure and rollback

Validation remains fail-closed for unknown, duplicate, missing or mismatched
source snapshots; incomplete evidence; partial dates; sampling; or revision
mismatch. A smoke failure rolls the active data pointer and application release
back to their recorded predecessors. Quarantined public Abbott assets are never
restored.
