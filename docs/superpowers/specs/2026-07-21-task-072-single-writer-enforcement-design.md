# TASK-072 Single-Writer Enforcement Design

## Status

Approved by the user through the Notion task marked `Ready` and the explicit request to execute TASK-072.

## Goal

Enforce one production writer for Zaruku Webmaster, Metrika, and GSC facts without changing dashboard read contracts or losing recoverability.

## Chosen design

### Webmaster

The canonical daily collector remains the only owner of Webmaster facts. The legacy weekly JavaScript collector must stop opening a database connection, registering a collector run, or writing `seo_webmaster_queries_weekly` and `seo_webmaster_pages_weekly`. The legacy fetch helpers may remain only if they are still exercised as read-only utilities; runtime execution must be explicitly disabled with a clear canonical-owner result.

### Metrika

The canonical collector at `06:12 UTC` remains active. Before removing the `06:10 UTC` legacy bridge cron, compare its target date/output contract with canonical `other`, `page`, `traffic`, and `goal` facts for account `66624469`. Save the current root crontab as a rollback artifact, install a filtered crontab without only the legacy Metrika line, and verify the canonical line remains unchanged.

### Deprecated tables

Use the reversible option allowed by TASK-072: keep the three legacy tables but mark them `DEPRECATED / NO WRITER / DO NOT READ` with MySQL table comments and repository migrations. Do not drop historical rows in this task. Runtime grep must prove no ReportingDash panel/read-model writer or reader depends on them.

### GSC lineage

The single canonical contract is `source_key='google_search_console'`, `analytics_account_id`, `report_date`, `query`, `page`, `country`, `device`, metrics, and `ingestion_run_id`. Legacy compatibility columns, including `property_url`, are not part of the contract and may remain `NULL`. Back up the `source_key='seo_os'` rows, verify the canonical writer covers every legacy report date and does not duplicate canonical business keys, then delete only those legacy rows from `canonical_fact_gsc_queries_daily`.

### GSC optional layers

Core query facts remain mandatory. A tolerated HTTP 400/403 from Search Appearance or a configured result type is recorded as a structured optional-layer issue. If core collection succeeds but at least one optional layer is skipped, finish the collector run with status `partial`, nonzero `error_count`, and a concise `error_summary`; return `status='partial'`. This makes failure visible without rolling back successful core facts.

### Documentation and telemetry

Update AGENTS and platform/canonical memory to match the live cron, lineage, deprecated-table, and partial-status rules. Source freshness must treat a recent GSC `partial` run as visible degradation rather than silently reusing an older success.

## Safety and rollback

- No production mutation before read-only counts and coverage checks.
- Save root crontab before removing the legacy line.
- Dump legacy GSC rows before deletion and record pre/post counts.
- Use table comments instead of destructive table drops.
- Keep collector deploy copies checksummed and preserve a server-side previous file.
- Run targeted tests before every code change and production health/count checks after deployment.

## Acceptance mapping

- Single writer: runtime grep, cron inspection, and post-change writer inventory.
- Deprecated tables: table comments and no runtime writer/read references.
- GSC lineage: zero `source_key='seo_os'` rows in the canonical query table, canonical counts retained, backup recorded.
- Optional failure visibility: unit test plus a live collector run showing `partial` when Search Appearance is rejected.
- Docs: AGENTS and platform/canonical memory match production.
