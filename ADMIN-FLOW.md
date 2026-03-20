# Admin Flow

## Purpose

This document describes the current production admin flow for dashboard configuration in `dashboard-next`.
It covers source roles, preview/data check behavior, dashboard save errors, and media plan review.

## Source Roles

Dashboard sources now support three roles:

- `actual`
  - canonical actual data sources
  - examples: `linkedin`, `reddit`, `vk`, `hybrid`, `git`, `yandex`, `manual_data`
- `plan`
  - media plan source
  - currently `media_plan`
- `custom_table`
  - standalone uploaded/linked reporting tables rendered as separate dashboard sections
  - display-only by rule
  - never participates in KPI, platform totals, channel performance, or plan/fact

Special cases:

- `manual_data`
  - configured as `role=actual`
  - source type is `manual`
  - loaded from `source_config.sheet_url`
  - participates in preview, campaign catalog, dashboard rendering, and media-plan binding
- `media_plan`
  - configured as `role=plan`
  - used for plan-vs-fact and optional media-plan-derived spend

## Dashboard Preview / Data Check

Endpoint:

- `POST /api/dashboard/preview`

Current behavior:

- canonical mysql sources
  - counted via canonical metadata/fact queries
- `media_plan`
  - parsed and summarized separately
- `manual_data`
  - loads sheet data from `source_config.sheet_url`
  - aggregates channels via `aggregateByChannel`
  - reports campaign/channel count in `Data check`

Manual data preview statuses:

- `ok`
  - manual sheet loaded and contains parsable rows
- `empty`
  - sheet loaded but no parsable rows were found
- `error`
  - fetch/parse failed, or `sheet_url` is empty

## Dashboard Create / Update Errors

Endpoints:

- `POST /api/admin/dashboards`
- `PUT /api/admin/dashboards/[id]`

Error handling now returns structured details to the UI.

Returned fields:

- `error`
- `details`

`details` can include:

- base error message
- MySQL `code`
- MySQL `sqlMessage`
- MySQL `errno`

This allows the admin wizard to show the real failure reason instead of a generic save error.

## Media Plan Review Flow

Endpoints:

- `POST /api/admin/media-plan/analyze`
- `POST /api/admin/media-plan/confirm`

Analyze step:

- parses sheet URL or uploaded inline rows
- detects plan format
- normalizes rows
- checks platform/source coverage
- computes row-level binding status:
  - `canonical_bound`
  - `plan_only`
  - `unresolved`
- returns issues, matched platforms, missing source platforms, and candidate bindings

Confirm step:

- accepts review resolutions
- saves reviewed state back into `media_plan.source_config.review`
- persists:
  - review status
  - binding summary
  - row bindings
  - alias memory
  - selected resolutions
  - optional inline rows from uploaded CSV/XLSX

## Spend Source

Dashboard config supports:

- `platform_actual`
- `media_plan_derived`

If `media_plan_derived` is selected:

- spend in dashboard KPI/platform sections is calculated from media plan unit price
- plan-vs-fact still uses media plan as plan layer

If spend is disabled in dashboard config:

- spend KPI/sections are hidden from the public dashboard

## Platform Visibility Rule

Public dashboard must show only platforms explicitly selected in admin.

This applies to:

- platform filter tabs
- platform KPI aggregation
- trend filtering
- plan-vs-fact platform references

## Current Manual / Custom Table Paths

Manual data endpoints:

- `GET /api/admin/manual-data/preview`
- manual template: `/manual_data_template.csv`

Custom table preview:

- `GET /api/admin/custom-table/preview`

## Leads Handling Rule

Leads must not be loaded through `custom_table`.

Reason:
- `custom_table` is intentionally free-form and display-only
- leads require binding semantics and can distort dashboard metrics if injected without review

Current rule:
- if a team wants to show raw leads as a table, `custom_table` is fine
- if a team wants leads to affect conversions/KPI/platform/channel sections, that must go through a dedicated leads-binding flow

See:
- [LEADS-BINDING-SPEC.md](/Users/nicko/ReportingDash/dashboard-next/LEADS-BINDING-SPEC.md)

## Recommended Commit Split For Current Local Diff

1. `feat(admin): add manual data/custom table preview support`
   - manual source schema
   - manual/custom-table preview endpoints
   - dashboard preview data check for manual sources
   - manual campaign catalog support
   - manual/custom table rendering

2. `feat(admin): improve dashboard save errors and validation flow`
   - detailed dashboard create/update API errors
   - wizard save error display
   - related admin validation updates

3. `feat(media-plan): add review, binding, upload, and confirm flow`
   - media plan preflight/analyze
   - row-level binding model
   - alias memory
   - CSV/XLSX upload intake
   - confirm/apply review persistence
