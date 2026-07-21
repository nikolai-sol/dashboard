# Abbott DB-native Canonical-first Foundation

**Date:** 2026-07-16

**Status:** proposed, approved at architectural direction level; implementation starts only after review of this specification

**Branches:** `codex/abbott-canonical-private-foundation` in the root collector repository and in `dashboard-next`

## 1. Goal and business context

Abbott is an SEO and product-analytics dashboard for a medical portal with two related but different audiences:

1. anonymous and registered visitors on the public portal;
2. doctors inside the protected account area after registration.

The dashboard must explain where visitors go, what they read, which pages and materials are popular, and how registered doctors behave. A raw internal `UserID` is required for the future join with Bitrix. It is not directly identifying without the protected Bitrix database, but it is still treated as private linkage data.

The first project establishes a reliable, protected, DB-native analytics foundation. Content recommendations and automatic material-development analysis are a separate second project after the facts and data-quality controls are stable.

## 2. Decisions

- The canonical database is the only production read source for dates from `2026-01-01` onward.
- We backfill 2026 directly from Yandex Metrika API. We do not copy legacy aggregates into canonical facts.
- There is no silent legacy fallback inside a selected month. Missing canonical data is shown as a data-quality error.
- Raw `UserID` remains available to authenticated Abbott managers and is stored server-side in a restricted database table.
- Anonymous/embed access receives aggregate projections only and never receives raw user IDs or user-level paths.
- Static Abbott source files are removed from the public release and imported into private DB tables through an auditable snapshot process.
- The default dashboard interval is the current calendar month through yesterday. If the month has no complete day yet, the UI shows an explicit empty/incomplete state.
- Abbott and Zaruku Metrika data are isolated by `counter_id` in storage, queries, health checks, and reports.
- The old `/metrika` collector is retired after the canonical cutover gate passes; it is not repaired as a parallel production path.

## 3. Access and privacy model

### 3.1 Access classes

| Access class | Allowed data |
|---|---|
| Unauthenticated | No Abbott dashboard or Abbott API data; `401`/login response |
| Authenticated Abbott manager | Aggregates, raw internal `UserID`, user-level portal paths, Bitrix joins |
| Permanent iframe/embed | Aggregate facts only; no raw IDs, no user-level paths, no private exports |
| Cron/collector service | Write-only/read-minimal service permissions for its specific canonical/private tables |

Authorization is enforced server-side in every Abbott API/read-model path. UI hiding is not considered a security boundary.

### 3.2 Release boundary

The following must not exist in `dashboard-next/public`, `.next/static`, deployment archives, or other web-served paths:

- CSV/XLSX/JSON files containing raw `UserID`, session IDs, paths, or Bitrix data;
- intermediate conversion files;
- migration validation artifacts containing row-level values;
- secrets or access tokens.

A deploy guard scans the release manifest and fails the build if prohibited Abbott filenames or content signatures are present.

### 3.3 Logging boundary

Application, collector, Telegram, and Hermes logs may contain counts, counter IDs, dates, run IDs, table names, and sanitized error classes. They must not contain OAuth tokens, launch secrets, raw `UserID`, Bitrix identifiers, URLs with private query parameters, or row-level journeys.

## 4. Target data model

Names can be adjusted to the repository's migration conventions, but grains and ownership are fixed.

### 4.1 Source snapshots and migration evidence

`portal_dataset_snapshots`

- one row per imported source file/dump/version;
- source kind, original filename, source period, generated time;
- SHA-256, byte size, row count, parser version;
- import status, imported row count, rejected row count;
- private archive location and creation timestamps.

`portal_migration_validation_runs`

- one row per before/after comparison;
- baseline snapshot ID, candidate snapshot/run ID, code revision;
- control name, expected/actual values, absolute/relative delta;
- threshold, result (`pass`, `warn`, `fail`), sanitized diagnostic JSON;
- reviewer and acceptance timestamp for explicitly approved differences.

`portal_data_releases`

- one immutable candidate release per Abbott migration/backfill;
- source snapshot IDs, canonical version ID, baseline validation run ID, code revision;
- status (`staging`, `validated`, `active`, `retired`, `failed`);
- a single active-release pointer used by the Abbott read model;
- activation and rollback audit fields.

Candidate facts are written under a new release/version and do not overwrite the currently active facts. Cutover and rollback change the active pointer in one transaction after validation. Old releases remain queryable during the rollback retention period.

### 4.2 Private portal and Bitrix facts

`portal_user_directions_private`

- snapshot ID;
- `raw_user_id` stored losslessly as text;
- normalized direction/specialization;
- uniqueness on canonical release, snapshot, and raw user ID so one immutable
  snapshot can be materialized into separately reviewed successor releases.

`portal_content_catalog`

- normalized URL/path, page title, material ID/type, section/direction, publication metadata;
- source snapshot and validity timestamps.

`portal_external_events`

- event date/time where available, normalized path, event kind, source/campaign dimensions;
- raw user/session linkage only in private columns/tables;
- snapshot ID and stable source-row fingerprint for idempotency.

`portal_bitrix_page_facts`

- daily aggregate page/material facts from the current Bitrix test dump;
- source snapshot ID so a later dump cannot silently overwrite the tested version.

`portal_bitrix_journeys_private`

- raw internal `UserID`, protected session/visit ID, ordered page/event sequence;
- available only to the privileged read model.

`portal_bitrix_journey_transitions`

- aggregate `from_path -> to_path` transitions for ordinary charts and embed-safe projections.

### 4.3 Canonical Metrika facts

Existing canonical traffic and page facts remain source-of-truth after collector safety fixes and a verified 2026 backfill. The 2026 candidate is written to versioned canonical staging/fact tables keyed by `canonical_release_id`; it is invisible to production reads until activation.

Raw user-behavior facts live physically in `report_bd_private.canonical_fact_metrika_user_behavior_daily`, also keyed by `canonical_release_id`. The canonical collector has a narrowly scoped writer credential. Only the protected Abbott server-side read model has a separate privileged read-only credential. The general dashboard runtime credential and embed read model cannot select this table. Aggregate, non-identifying behavior projections may be materialized in `report_bd` for ordinary charts.

Add `canonical_fact_metrika_returning_pages_release_daily` with grain:

`canonical_release_id + counter_id + date + raw_page + return_bucket_code`

Each row stores the raw API page value, a separately derived normalized page, the API bucket code/label, the source percentage at API precision, and the source denominator if the API provides it. Counts are not silently treated as source facts: when a count is derived, the read model calculates it with decimal half-up rounding and marks it `is_derived=true`. Normalization collisions are measured and stored in the validation report before aggregation. All writes and reads require `counter_id`; Abbott cannot see Zaruku rows and vice versa.

Add `canonical_source_coverage_daily` with grain:

`canonical_release_id + source_key + counter_id + scope + date`

It records collection status, canonical release ID, API total rows, persisted rows, pagination completion, sampling flag, collector run ID, and sanitized failure information. Allowed statuses are `success`, `success_empty`, `partial`, `skipped`, `sampled`, and `failed`. Only `success` and a reconciled `success_empty` satisfy coverage. A successful collector run is not sufficient evidence of complete coverage without these rows.

## 5. Metric lineage and dashboard semantics

| Dashboard concept | Source | Required scope/key | Notes |
|---|---|---|---|
| Sessions, users, pageviews, bounce, duration | Canonical Metrika `other` scope | Abbott `counter_id=90602537` | All-portal audience and authoritative denominator |
| UTM/acquisition performance | Canonical Metrika `traffic` scope | Abbott counter | UTM/acquisition slice only; never used as the all-portal denominator |
| Popular pages/materials | Canonical Metrika page daily joined to `portal_content_catalog` | Abbott counter + normalized URL | Rank by pageviews/visits; retain title/material metadata |
| User paths and reading behavior | Canonical private user-behavior facts | Abbott counter + raw `UserID` | Only authenticated managers receive row-level output |
| Registered-doctor segment | Canonical behavior joined to `portal_user_directions_private` and later Bitrix | raw `UserID` | Separate segment/view, not substituted for all traffic |
| Returning users/pages | `canonical_fact_metrika_returning_pages_release_daily` | Abbott counter | No on-demand mixed-counter query in the dashboard request |
| Bitrix activity | Versioned private Bitrix snapshot tables | snapshot ID | Labeled as test-dump data until a scheduled source is introduced |

The all-portal and registered-doctor views are related but have different denominators. The dashboard must not replace the full traffic total with a user-behavior total when a `UserID` or direction filter is enabled. Filtered cards must be labeled as registered-doctor metrics.

## 6. Migration control points

The migration is not accepted merely because rows were inserted. A repeatable control pack is captured before any source file is removed or any read path is switched.

### 6.1 Pre-migration baseline

For every current Abbott file, legacy query, canonical scope, and relevant API query, capture:

- SHA-256, byte size, generated timestamp, min/max date, row count;
- distinct raw user IDs, sessions/visits, URLs, material IDs, and directions;
- null/blank counts for join keys and required metrics;
- duplicate key groups and orphan references;
- daily coverage bitmap for 2026;
- totals by day/month and by dashboard tab for sessions, users, pageviews, visits, and returned metrics;
- top 20 pages/materials with stable tie-breaking;
- user-to-direction mapping coverage;
- canonical versus direct API totals per counter, date, and scope;
- current legacy versus canonical differences, recorded as evidence rather than normalized away.

Every API/query baseline also stores a reproducibility fingerprint: ordered dimensions and metrics, filters, attribution model, accuracy/sampling settings, pagination settings, timezone, URL-normalization version, parser version, request hash, and response hash. The frozen baseline is immutable and must be committed to the private validation store before the first candidate backfill write.

Raw baseline evidence is stored in the restricted DB/private archive. A sanitized manifest containing hashes, counts, periods, run IDs, and code revisions may be committed or attached to the deployment record. It contains no row-level identifiers.

### 6.2 Post-import comparison

The same control pack runs against the candidate DB-native read model. Comparison rules:

- pure file-to-table rehosting: exact row count, distinct-count, and aggregate parity; exact stable row-fingerprint multiset where parsing is lossless;
- intentional normalization: source and normalized counts plus an explicit reject/mapping report;
- canonical versus direct API: no missing coverage rows, no sampling, pagination complete, and metric delta no greater than 1% unless a documented API semantic difference is accepted;
- top-page/material lists: deterministic comparison with explained changes caused only by normalization;
- private joins: no unexpected loss of raw `UserID`; all unmatched IDs counted and reviewable.

Every failed control blocks cutover. Warnings require an explicit recorded approval. This makes the current system a preserved comparison point even after its public files and legacy reads are retired.

### 6.3 Known baseline anomalies to preserve and resolve

- canonical traffic gap `2026-03-29..2026-04-07`;
- different historical start dates between traffic, page, and user-behavior scopes;
- current returned-data duplicates and lack of `counter_id`;
- currently observed page-total mismatch between legacy/current representations;
- Bitrix data is a static test dump, not a live feed.

These are recorded in the baseline as known failures. They must not be hidden by copying values into the new model.

## 7. Collector and backfill design

### 7.1 Safety fixes before backfill

- stage and validate all required scopes for one `counter_id + date` before publication;
- publish `other`, `traffic`, `page`, private `user_behavior`, and `returning` facts for that day in one transaction under the candidate `canonical_release_id`;
- replace occurs only after every required scope has a complete, successful, unsampled API response or a reconciled `success_empty` result;
- a `403`, `404`, timeout, or pagination failure never marks the counter/date as collected and never changes the active or candidate published version;
- successful coverage rows are committed in the same publication transaction; failure/partial/skipped diagnostics are recorded afterward in a separate transaction without publishing facts;
- pagination totals are reconciled before commit;
- retries are idempotent through stable fact keys and run IDs.

The closed required-scope set for the Abbott release is `other`, `traffic`, `page`, `user_behavior`, and `returning`. If a scope is later added or removed, that is a versioned contract change rather than a runtime guess.

### 7.2 Backfill order

1. Run the control baseline and freeze its IDs.
2. Create an immutable pre-backfill release/snapshot of all active Abbott facts and coverage metadata, and verify a restore probe against it.
3. Fix and test collector atomicity, skipped-counter behavior, pagination, and coverage manifests.
4. Process dates `2026-03-29..2026-04-07` first, but stage all five required scopes for each date, including returning, and publish each complete day atomically to the candidate release.
5. Process all remaining dates month-by-month from `2026-01-01` through yesterday with the same five-scope staging and atomic daily publication.
6. Verify the original traffic gap as a coverage control after the complete candidate backfill; it is not a separately published partial dataset.
7. Run post-backfill API and read-model comparisons.
8. Atomically activate the candidate release only after the cutover gate passes.

No collector operation may mix Abbott and Zaruku counters in a delete window, aggregate, alert, or validation result.

## 8. Dashboard behavior

- On initial load, use `[first day of current month, yesterday]` in the configured business timezone.
- Show a clear coverage banner when any selected day/scope is incomplete.
- Do not silently change dataset when a filter is toggled.
- Expose separate, labeled views for all portal traffic and registered doctors.
- Managers can inspect raw `UserID` and paths in the protected view and export only through an authorized server-side route.
- Embed responses are built from aggregate tables/projections and cannot request the privileged fields through query parameters.
- Bitrix widgets display the snapshot date and “test dump” status until automated ingestion is designed.

The Abbott API always returns `source="canonical"` and an explicit `data_quality` object containing release ID, requested scopes/dates, coverage status, and blocking gaps. It never implements `catch(() => legacy)`, `COUNT(*) > 0` source switching, or query-parameter selection of legacy data. Incomplete canonical data produces a typed incomplete response and visible banner rather than substituted totals.

## 9. Secrets and legacy retirement

- Replace hardcoded Yandex tokens and the shared legacy launch secret with environment/secret-file references.
- Generate internal launch secrets without printing them to terminal, Git, logs, or chat.
- A new Yandex OAuth token requires the owner to authorize/revoke it in Yandex; the repository can prepare secure installation and verify access afterward.
- Keep the old `/metrika` cron disabled/removed after canonical parity is accepted. Do not leave two collectors writing overlapping data.
- Document the final cron table, environment variables, rotation steps, and rollback commands in the operational memory files in the same implementation change.

## 10. Monitoring, alerts, and Hermes

Deterministic probes run before any AI interpretation. They produce sanitized structured events.

Alert conditions include:

- cron/run missing past its expected completion time;
- any failed/partial/skipped Abbott counter/date/scope;
- coverage gap in the selected month or latest expected day;
- pagination incomplete or sampled response;
- duplicate fact keys or unexpected row-count collapse/spike;
- canonical/API delta above threshold;
- abnormal loss in `UserID` mapping coverage;
- stale Bitrix snapshot (informational while it remains a test dump);
- private files detected in the release artifact;
- unauthenticated private API access unexpectedly succeeds.

`sources_health_dashboard.py` and `send_canonical_telegram_report.py --mode summary` include a dedicated Abbott/Metrika section with counter-scoped freshness, coverage, last run, and anomaly status.

Hermes can run on its available system cron to summarize the sanitized probe JSON, classify likely causes, and send a manager-friendly Telegram explanation. Hermes never receives raw IDs, tokens, private paths, or Bitrix rows. Deterministic high-severity alerts are sent even if Hermes is unavailable.

## 11. Cutover gate and rollback

Cutover requires all of the following:

- access tests prove default-deny and aggregate-only embed behavior;
- no Abbott private artifacts exist in the public/release tree;
- pre/post migration controls pass or have explicit approved warnings;
- all 2026 dates required by the closed scope set have `success` or reconciled `success_empty` coverage rows; `partial`, `skipped`, `sampled`, and `failed` always block activation;
- known traffic gap is filled;
- returning facts are counter-scoped and deduplicated;
- API parity thresholds pass;
- manager and embed projections pass contract tests;
- monitoring and Telegram summary report Abbott per counter;
- the active release pointer, immutable pre-backfill release, private snapshot IDs, and restore probe are verified.

Rollback is an atomic transaction that changes `portal_data_releases` from the candidate release back to the recorded pre-backfill release ID. The protected and aggregate read models resolve the same pointer, so they cannot roll back independently. A release-specific smoke test verifies counts, coverage, access projection, and current-month behavior immediately after the switch. Candidate rows remain immutable for incident analysis; rollback does not delete them and does not re-enable silent within-month legacy fallback. Source files remain in the private archive until the retention period and final acceptance are complete.

## 12. Test strategy

- migration tests for constraints, privileges, idempotency, and rollback;
- collector unit/integration tests for `403/404`, timeout, partial pagination, sampling, retry, and transaction rollback;
- golden control-pack tests using small anonymized fixtures;
- read-model tests for counter isolation, audience denominator semantics, current-month default, and missing-data banners;
- authorization tests for manager, embed, and unauthenticated requests;
- release-content test that rejects private Abbott artifacts;
- end-to-end smoke tests for protected Abbott tabs and aggregate embed;
- production read-only validation after deployment before enabling scheduled writes.

## 13. Delivery boundaries

This foundation project includes DB-native ingestion, private access, canonical 2026 backfill tooling, returned facts, validation controls, monitoring, secrets cleanup, and legacy cron retirement. It does not yet implement AI recommendations for developing portal content. That follows as Project 2 and will consume only accepted canonical/content facts with explicit evidence links and human approval.
