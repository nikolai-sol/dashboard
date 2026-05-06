# Migration Plan: Legacy `nest-second` -> New Reporting Stack

## Goal
Build the new reporting pipeline next to the current system, run both in parallel, compare outputs, and only then cut traffic over. Current production must stay untouched until parity is confirmed.

## Non-Negotiable Rule
Do not modify or disable the current production collection flow while the new stack is being built and validated.

## Current State
- Legacy collector: NestJS app in `nest-second`, running on VPS.
- Current trigger: daily cron calls `http://5.35.85.218:5000/launch?secret=...`.
- Current storage: legacy MySQL tables in `report_bd`.
- New dashboard stack: `dashboard-next` + Python ETL scripts for Reddit/LinkedIn.
- `LinkedIn` and `Reddit` do not exist in legacy `nest-second`; they can be onboarded directly into the new collector path.
- `Sape` is currently stale and should be excluded from the new target migration scope unless business confirms it must be restored.

## Target State
- New collector runs separately from legacy.
- New collector writes into new canonical tables for dashboard consumption.
- `dashboard-next` reads only the new canonical schema.
- Legacy collector remains active during shadow period.
- Cutover happens only after platform-level and metric-level parity checks pass.

## Phase 1: Inventory and Freeze
1. Document all legacy inputs, env files, cron jobs, PM2 apps, and output tables.
2. Mark each source as `working`, `degraded`, or `unknown`.
3. Freeze legacy behavior: no refactors, no endpoint changes, no table renames.

## Phase 2: New Canonical Schema
1. Keep legacy tables as-is.
2. Define canonical tables for the new dashboard:
   - platform dimension / source registry
   - campaigns
   - ad groups / creatives where needed
   - daily facts
   - ingestion runs / job logs
3. Add source lineage fields so every fact can be traced back to platform and raw source.

## Phase 3: New Collectors
1. Build new collectors per platform as isolated jobs.
2. Start with platforms already implemented outside legacy:
   - LinkedIn
   - Reddit
3. Then port legacy-managed sources one by one:
   - Yandex Direct
   - Yandex Metrika
   - Hybrid
   - GetIntent
   - VK Ads v2
4. Each new collector writes only to canonical tables.
5. Each collector must have:
   - idempotent upsert logic
   - explicit run logging
   - error classification
   - token expiry handling

## Phase 4: Parallel Run
1. Keep legacy cron active.
2. Run new collectors on separate schedule or manual trigger.
3. Store results independently.
4. Build parity reports by platform/date/metric, but only on metrics that are реально доступны и trustworthy per source.
5. Define source-specific parity sets and acceptable tolerance per source.

### Source-specific parity baseline

- LinkedIn: `spend`, `impressions`, `clicks`, `conversions`
- Reddit: `spend`, `impressions`, `clicks`, `conversions`
- Yandex Direct: `spend`, `impressions`, `clicks`, `conversions`, `ctr`, `avgCpc`
- Hybrid: `impressions`, `views`, `clicks`, `reach`, video quartiles
- GetIntent: `impressions`, `unique_imps`, `clicks`, `view_rate`, video quartiles
- VK Ads v2: `impressions`, `clicks`, video quartiles
- Yandex Metrika: `visits`, `users`, `newUsers`, goal metrics

## Phase 5: Dashboard Shadow Mode
1. Keep current reporting source untouched.
2. Point `dashboard-next` to canonical tables only.
3. Validate dashboard totals against legacy outputs and Telegram daily summaries.
4. Add a discrepancy report visible only internally.

## Phase 6: Cutover
1. Stop legacy-triggered source only after parity is stable for a defined window.
2. Disable the corresponding legacy cron/PM2 path.
3. Keep legacy tables read-only for rollback period.
4. Roll source-by-source, not big-bang.

## Recommended Cutover Order
1. Reddit
2. LinkedIn
3. VK Ads v2
4. Hybrid
5. GetIntent
6. Yandex Metrika
7. Yandex Direct

## Validation Checklist Per Platform
- Authentication works
- Raw API call returns data for recent date
- New run writes expected rows
- Re-run is idempotent
- Aggregates match legacy within tolerance
- Dashboard renders correct totals
- Alerting/logging exists

## Immediate Actions
1. Confirm real health of each legacy source without mutating production.
2. Extract all secrets from hardcoded code paths into env in the new stack only.
3. Build canonical ingestion logs.
4. Add internal parity dashboard/report.

## Risks
- Legacy launch secret is hardcoded and exposed via public endpoint.
- Some legacy secrets are still hardcoded in code.
- `:5000` and `:3306` are publicly reachable.
- Yandex Direct currently appears degraded.
