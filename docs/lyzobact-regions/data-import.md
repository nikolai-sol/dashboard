# Regional research data: candidate only

The runtime reads only MySQL through `loadRegionalModule`. There are no source API calls, file fallbacks, cron jobs, collection services, advertising actions or weather/Wordstat estimates. Dashboard authorization remains in the route; the additional store gate requires the exact active client key `lyzobact` or `lisobact` and JSON boolean `config.lyzobact_regions.enabled === true`.

## Three additive tables

`064_lyzobact_regions.sql` creates only dedicated tables:

- `lyzobact_regions_snapshots`: one immutable audit per dashboard+snapshot ID; two source-file checksums and combined import fingerprint; staged/published state and expected row counts.
- `lyzobact_regions_observations`: one selected regional observation per dashboard+snapshot+region key. Validated typed JSON retains actual literal report period, publication/check dates, numeric values, textual qualifiers, quality and geography. No common reporting week is inferred.
- `lyzobact_regions_source_pages`: one reviewed source-history record per dashboard+snapshot+source ordinal. Repeated URLs in different historical records remain separate. Foreign keys attach these only to this module's tables.

One transaction inserts all children and publishes the snapshot last. A failed write rolls back. An identical rerun returns `already_exists`; reusing the ID with different input bytes or label fails. Use a new audit ID for a new reviewed dataset. Previously published snapshots remain selectable. Latest means newest audit check date, not current disease week. Expected totals are fixed by the one-shot importer at 85 regions and 230 source records. No production migration, import or configuration write was performed for this candidate.

## Offline validation

From the worktree, run (dashboard ID below is illustrative and causes no lookup in dry-run):

```sh
node --import tsx scripts/import-lyzobact-regions.ts \
  --register /absolute/path/register-85.json \
  --sources /absolute/path/source-pages.csv \
  --snapshot audit-20261006 \
  --label 'Проверка источников 05–06.10.2026' \
  --dashboard-id 1
```

Default mode loads no database module and only reports checksums, counts and metric presence. `--apply` is an explicit later operator action, requiring separately approved migration/application and the existing DB environment. It checks the target is an active Lysobact dashboard, runs the import transaction, closes the connection and pool. It never runs migrations or changes the dashboard configuration. Do not run it as part of this build-only task.

## Interpretation and failure states

`ready`, `not_imported`, `snapshot_not_found` and `unavailable` are distinct. Missing schema produces `unavailable/schema_missing`; query errors or incomplete published children produce `unavailable/read_failed`, without exposing DB details. Unknown requested audits never fall back to another snapshot.

NULL is preserved; numeric zero is valid. No percentage is recomputed or inferred from counts. Approximate counts and source caveats remain in `available`/`comparisonBasis`; the UI must show those qualifiers alongside numeric values. Cases/casesPrior reject negative or fractional values. All numeric percentages must be finite.

The frozen workbook's `autumn` flag covers 48 original primary autumn observations. Its 17 later secondary autumn records retain `autumn=Нет`; their explicit established status `Осень 2026: СМИ — …` supplies the reviewed temporal classification. Normalization therefore produces 48 `primary_autumn`, 17 `secondary_autumn`, 19 `historical`, and one `index_only`. Historical/index data must not color a current-growth map. These are autumn observations of different weeks and verification dates, not synchronized surveillance or a proven ongoing feed.

All campaign statuses initialize to `unknown`; status dates, Wordstat and temperature initialize to NULL. Source-history HTTP code `0` is a legacy transport-failure marker: `httpStatus` is NULL and `sourceHttpStatusRaw` retains `0`. Check dates are audit dates, not invented retrieval timestamps; exact retrieval times are unavailable in this frozen input. `remoteArchive` and evidence references retain provenance without claiming local raw archive verification.

## Validation performed

Focused tests cover zero/NULL, reported/calculated separation, source identity, duplicate URLs, count/number/date validation, transaction rollback, idempotency/conflicts, explicit apply, the client/opt-in gate, unavailable schema/read errors, unknown snapshot selection and published child integrity. A real offline import preserves 85/230 records, 58 case values, 12 prior-case values, 37 reported changes, six calculated changes and 85 unknown campaign statuses. SQL migration was inspected, not executed against MySQL; transaction tests use injected connections.
