# Zaruku Webmaster provenance snapshot — 2026-07-28

## Scope and safety

This snapshot was produced by the SELECT-only `plan_zaruku_webmaster_backfill.py` for `2026-07-01..2026-07-27` against the configured reporting database.

- No collector or Webmaster API request was started.
- No fact row, collector run, cron, schema, or Telegram state was changed.
- No backfill was started or authorized.
- The failed-lineage criterion is shared with RD-11: fact `ingestion_run_id` resolves to `canonical_collector_runs.id` with `status = 'failed'`.
- `rows_read > rows_written` is not used as a completeness criterion.

## Failed-lineage scope

The exact catch-up scope defined by failed lineage contains four distinct dates:

```text
2026-07-14
2026-07-15
2026-07-16
2026-07-17
```

| Layer | Distinct dates | Rows carrying failed lineage | Dates |
|---|---:|---:|---|
| `webmaster_queries` | 4 | 755 | 2026-07-14, 2026-07-15, 2026-07-16, 2026-07-17 |
| `webmaster_pages` | 2 | 942 | 2026-07-14, 2026-07-16 |
| `webmaster_summary` | 1 | 1 | 2026-07-14 |
| Union | 4 | 1,698 | 2026-07-14..2026-07-17 |

Failed provenance is attached to two collector runs, both `cron` and both `failed`:

| Run ID | Affected layer/date groups |
|---:|---|
| `1453` | queries 2026-07-14..16; pages 2026-07-14 and 2026-07-16; summary 2026-07-14 |
| `1471` | queries 2026-07-15..17 |

This is a last-writer-wins snapshot: later successful writes already coexist with failed-run lineage on some dates. A future catch-up must be limited to the reviewed date scope and must take a fresh provenance snapshot immediately before execution.

## Missing-date diagnostics

The requested range also exposes dates with no current rows. These are diagnostics, not an automatic backfill authorization and not a replacement for the failed-lineage criterion.

- Query facts missing: 14 dates — `2026-07-01..09`, `2026-07-23..27`.
- Page facts missing: 17 dates — `2026-07-01..12`, `2026-07-23..27`.
- Union of failed-lineage and missing-date diagnostics: 21 dates.

The broad union must not be executed as a backfill without a separate review. In particular, dates after the current fact maximum may reflect the known collector outage/publication lag, while dates before the first stored Webmaster fact need historical-availability review.

## Lineage integrity and retention

- Non-castable GSC `ingestion_run_id`: 0 rows.
- Missing `ingestion_run_id`: 0 rows across the six checked Zaruku fact layers.
- Orphaned run references: 0 rows across the six checked Zaruku fact layers.
- Collector run IDs retained: `1..1694`.
- Collector run timestamps retained: `2026-03-15 11:12:24` through `2026-07-28 08:05:20`.
- Webmaster fact dates retained: `2026-07-10..2026-07-23`.
- Minimum Webmaster fact run ID: `1389`, which resolves inside the retained collector-run range.

The current bounds are compatible, but no automatic retention policy guarantees this relationship. RD-12 therefore keeps the orphan check as a permanent precondition.

## Operational gate

The next allowed action is review only. Deployment, an end-to-end collector run, scheduled-cron observation, and any backfill each require their own later authorization. The future backfill gate remains: RD-10 deployed, RD-11 active, then one stable scheduled Webmaster cron, then a fresh read-only provenance snapshot and an explicitly approved date list.
