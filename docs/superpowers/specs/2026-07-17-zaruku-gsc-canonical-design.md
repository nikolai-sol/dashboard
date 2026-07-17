# Zaruku GSC Canonical Design

## Goal

Connect Google Search Console as an automated canonical SERP source for Zaruku, starting with read-only Search Analytics facts for `https://zaruku.ru/`.

## Scope

- Source key: `google_search_console`.
- Property: `https://zaruku.ru/`.
- OAuth scope: `https://www.googleapis.com/auth/webmasters.readonly`.
- Local auth is already validated through Telegatask OAuth and copied to ReportingDash `.env`.
- Production rollout still requires adding `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`, and `GSC_SITE_URL` to `/root/reportingdash-canonical/.env`.

## Data Model

The collector writes daily canonical tables:

- `canonical_fact_gsc_queries_daily`: grain is source/property/day/device/query.
- `canonical_fact_gsc_pages_daily`: grain is source/property/day/device/page.
- `canonical_fact_gsc_summary_daily`: grain is source/property/day/device.

Metrics are impressions, clicks, CTR percent, and average position. Query and page text are hashed for stable unique keys. Daily reruns replace the full property/date/device snapshot in one transaction per day.

## Collector

`fetch_google_search_console_canonical.py` uses OAuth refresh-token flow, calls `searchAnalytics.query`, and fetches dimensions:

- `query`
- `page`
- `device`
- `query,device`
- `page,device`

The collector refuses partial snapshots. If a response returns exactly the configured row limit, the run fails before deleting old data, because GSC pagination must be added before the collector can safely publish larger snapshots.

## Dashboard

The app reads canonical GSC tables through a new read model, aggregates daily rows into ISO weeks, and exposes:

- weekly summary
- top Google queries
- top Google landing pages
- source status and data-through date

The GSC source changes from pending/not connected to automated/connected when canonical rows exist. If the tables are missing, the dashboard stays partial or pending without breaking the whole Zaruku view.

## Out Of Scope

- Production deploy/backfill.
- Cron installation.
- URL Inspection API.
- Writing data back to Google Search Console.
