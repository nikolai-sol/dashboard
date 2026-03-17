# Media Plan Handler Spec

## Goal
Build a smart media plan intake layer for dashboard admin that:
- accepts published Google Sheets URLs, CSV URLs, and later file uploads
- parses and normalizes media plan rows
- validates structure and required fields
- explains what is connected to actual sources and what is not
- supports spend derivation from media plan KPI pricing when explicitly enabled in dashboard config

This handler is admin-side operational tooling. It does not write to canonical fact tables.

## Current State
Dashboard media plan support already exists, but it is limited:
- one optional `media_plan` source per dashboard
- published sheet URL stored in `dashboard_sources.source_config.sheet_url`
- parser reads a small set of known CSV shapes
- public dashboard can compute `plan_vs_fact`
- dashboard config now supports `spend_source`:
  - `platform_actual`
  - `media_plan_derived`

Current remaining gaps:
- no dedicated file artifact storage outside dashboard config
- no campaign alias UI management screen
- no full row-level override workflow beyond unresolved rows
- no FX conversion layer

## Implementation Status
Implemented now:
- `POST /api/admin/media-plan/analyze`
- admin Step 2 review block
- `POST /api/admin/media-plan/confirm`
- uploaded file intake:
  - `csv`
  - `xlsx`
- uploaded plans are normalized and persisted as `source_config.inline_rows`
- explicit resolution actions for missing actual sources:
  - `connect_source`
  - `plan_only`
  - `ignore`
- row-level binding statuses:
  - `canonical_bound`
  - `plan_only`
  - `unresolved`
- token-based campaign candidate scoring
- alias memory persisted in `source_config.review.alias_memory`
- manual row-level override for unresolved rows only
- reviewed media plan metadata persisted into `dashboard_sources.source_config.review` on normal dashboard save

Current constraint:
- `confirm` prepares and applies reviewed config inside the wizard payload
- final DB persistence still happens through the normal dashboard `Create/Save` action

## Architecture

### Inputs
Admin-side handler accepts one of:
- published Google Sheets URL
- direct CSV URL
- later: uploaded CSV/XLSX file

### Outputs
Handler returns a preflight report with:
- fetchability status
- normalized source URL used for fetch
- detected media plan format
- parsed row counts
- distinct platforms/channels
- issue list (`error`, `warn`, `info`)
- source coverage summary
- sample normalized rows for review

### Scope Boundaries
In scope:
- admin preflight
- dashboard config guidance
- plan-to-platform binding hints
- media-plan-derived spend model preview

Out of scope for this wave:
- writing normalized media plan rows to a dedicated DB table
- campaign-level hard binding persistence
- AI/NLP reconciliation of arbitrary naming
- FX conversion engine
- file storage pipeline

## Normalized Row Contract
Internal normalized row shape:
- `platform`
- `channel`
- `format`
- `buy_type`
- `budget_plan`
- `impressions_plan`
- `clicks_plan`
- `views_plan`
- `conversions_plan`
- `cpm_plan`
- `cpc_plan`
- `cpv_plan`
- `cpa_plan`

Platform is normalized to dashboard platform ids where possible:
- `LinkedIn -> linkedin`
- `Reddit -> reddit`
- `ВКонтакте / ВК -> vk`
- `Яндекс / Яндекс.Директ -> yandex`
- `GetIntent -> git`
- etc.

## Preflight Checks

### 1. Fetch check
- URL present
- Google `pubhtml` is convertible to `pub?output=csv`
- fetch succeeds with non-empty response

### 2. Format detection
Supported first-pass formats:
- `canonical_template`
  - headers like `platform, channel, buy_type, budget_plan, ...`
- `campaign_budget_sheet`
  - headers like `campaign_name, platform, planned_budget, planned_cpc, report_type`
- `unknown`

### 3. Structural validation
- required columns present for at least one known format
- at least one parsable row
- row has recognized platform or at least non-empty platform value
- budget and KPI price fields are numeric when supplied
- buy type can be inferred or is explicitly present

### 4. Source coverage validation
Compare media plan platforms against selected actual sources in dashboard config:
- `matched`: plan platform has selected actual source
- `missing_source`: plan platform exists in media plan but no actual source selected in dashboard
- `actual_without_plan`: actual source selected but no media plan rows for that platform

### 5. Account-context review
For selected actual sources, inspect active canonical accounts:
- selected account count
- active account count
- suggested account count based on `client_name`

This is advisory in MVP, not a hard blocker.

## Spend Source Semantics
Dashboard config field:
- `config.spend_source`
  - `platform_actual`
  - `media_plan_derived`

Behavior:
- `platform_actual`
  - use source-native spend from canonical ads facts
- `media_plan_derived`
  - compute spend from media plan KPI pricing

Derived formulas:
- `CPC -> clicks * cpc_plan`
- `CPM -> impressions / 1000 * cpm_plan`
- `CPV -> views * cpv_plan`
- `CPA -> conversions * cpa_plan`

Important:
- this is dashboard presentation logic, not canonical fact rewriting
- no FX conversion is performed in MVP
- dashboard currency is a display choice; media plan unit cost is assumed already expressed in that dashboard currency

## MVP
Deliverables:
- `MEDIA-PLAN-HANDLER-SPEC.md`
- reusable media plan analysis helper
- admin endpoint: `POST /api/admin/media-plan/analyze`
- wizard review block in Step 2
- issue severity model
- source coverage summary
- sample normalized rows

MVP result:
- user can paste a sheet URL
- click analyze
- immediately see if sheet is valid, which platforms are connected, which are missing, and what spend model will be applied

## V2
- row-level campaign matching hints against `canonical_source_campaigns`
- user-resolved mapping memory beyond source-level platform decisions
- support mixed plan+manual channels more clearly
- separate review UI for alias memory inspection/editing

## V3
- fuzzy matching / confidence scoring for client and campaign names
- AI-assisted reconciliation suggestions
- optional FX conversion layer
- persistent normalized media plan cache table
- multi-sheet workbook support
- stricter preflight gating and approval workflow

## Endpoint Contract (MVP)
Request:
- dashboard form payload, same shape as current preview payload

Response:
- `status`
- `sheet_url_input`
- `sheet_url_fetch`
- `format`
- `rows_total`
- `rows_parsed`
- `channels`
- `platforms`
- `matched_platforms`
- `missing_source_platforms`
- `actual_without_plan_platforms`
- `issues[]`
- `source_review[]`
- `sample_rows[]`

## Endpoint Contract (Phase 2)
Confirm/apply request:
- dashboard form payload
- resolution map by missing platform

Confirm/apply response:
- `analysis`
- `reviewed_source_config`
- `updated_sources`

Behavior:
- updates `media_plan.source_config.review`
- can append draft actual sources when resolution is `connect_source`
- does not write dashboard rows directly; final persistence happens on normal dashboard save

## UI Review Step (MVP)
Wizard Step 2 should show:
- analyze button
- detected format badge
- rows/channels/platforms summary
- issue list grouped by severity
- per-platform coverage chips
- actual source review cards
- sample normalized row table

## Success Criteria
MVP is successful when:
- `pubhtml` and CSV URLs both work
- admin can tell exactly why a media plan is not connecting
- missing actual sources are visible before save
- dashboard spend-source behavior is explicit in config
- no changes are required to canonical schema or collectors
