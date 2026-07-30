# Zaruku Unified SEO Week Selection Design

## Goal

Make the primary ISO-week selector on the Zaruku SEO tab control the two
comparison tables consistently across Google Search Console, Yandex Webmaster,
Yandex Metrika, and SEO OS.

The selected week is the requested week for every source. A source that has no
rows for that week may use only its latest populated week, and the fallback must
be visible beside that source. The global period-mismatch notice appears only
when at least one source actually falls back.

## Confirmed Root Cause

`SeoTab` currently applies `primaryWeek` only to SEO OS. GSC and Webmaster use
their own `latest_week`, while Metrika landing pages are already aggregated over
the dashboard's effective daily period. Both comparison components infer a
period mismatch from distinct displayed week strings and do not know which week
the user requested.

Production evidence confirms that `2026-W30` is present in canonical storage:
GSC facts were present through 2026-07-25, Webmaster facts through 2026-07-22,
and Metrika had complete daily breakdown coverage for 2026-07-20..2026-07-26.
The visible W30 problem is therefore a read-model and selection defect, not a
collector gap.

## Scope

This change affects only:

- `Запросы: Google, Яндекс и SEO OS`;
- `Посадочные страницы: спрос и поведение`;
- the shared ISO-week selection metadata used by those tables.

It does not change collectors, cron, source APIs, SEO OS calculation logic, the
existing GSC newest-first landing-page ordering fix, or the daily-period logic
used by other Zaruku panels.

## Architecture

### Canonical-only weekly bundle

The dashboard continues to read canonical MySQL only. The existing GSC and
Webmaster rows already carry ISO week keys. Metrika receives a separate weekly
organic-landing read model built from
`canonical_fact_metrika_breakdowns_daily`, grouped by ISO week and exact row
dimensions, with completeness checked through
`canonical_metrika_breakdown_coverage_daily`.

The existing `organic_landing_pages` field and its daily dashboard-period
semantics remain unchanged for other panels. The SEO comparison receives a new
weekly Metrika field; no 28-day row is reused as a weekly value.

The selector's list and SEO OS filtering remain based on `seo_os.weeks`. The
canonical weekly bundle spans the same selectable weeks so choosing a week does
not require a source API request or a page reload.

### Source selection contract

A shared selector returns:

```ts
type WeekRowSelection<T> = {
  requestedWeek: string | null;
  actualWeek: string | null;
  rows: T[];
  fallback: boolean;
};
```

Selection rules:

1. If the requested week has rows, return those rows and `fallback: false`.
2. Otherwise return rows from the source dataset's lexicographically latest ISO
   week and `fallback: true`.
3. If the dataset has no populated week, return no rows, `actualWeek: null`, and
   `fallback: false`; source availability continues to describe the missing
   source separately.
4. The fallback is latest-populated, not nearest-by-distance.

GSC, Webmaster, and SEO OS use the same requested week. Query and page tables
select from the dataset relevant to that table, so the displayed source week is
always the week of the rows actually rendered.

### Presentation contract

Each source heading receives requested and actual week metadata. When they
differ, it shows the explicit note:

`W30 недоступна, показано W31`

When they match, only the actual week is shown. Metrika appears as an ISO week
in the landing-page table rather than as a free-standing date range.

The amber `Периоды источников различаются` notice is controlled by source
fallback metadata, not by comparing a set of non-null week strings. It is
visible only when at least one source in that table could not render the
requested week.

## Metrika Aggregation

For every selectable ISO week, derive Monday and Sunday boundaries and aggregate
`organic_landing` detail rows inside those boundaries. Preserve the current
weighted calculations for bounce rate, visit duration, and page depth, then
apply the existing exact normalized-URL aggregation and page-title enrichment.

A Metrika week is published only when its daily coverage rows satisfy the
existing fail-closed report contract for every day included in the loaded week.
No live Metrika API fallback is allowed.

## Verification

Automated coverage must prove:

- requested W30 selects W30 rows for GSC, Webmaster, Metrika, and SEO OS;
- missing requested rows select the source's latest populated week;
- fallback copy names both requested and actual weeks beside the source;
- no global mismatch notice appears when every actual week equals W30;
- the mismatch notice appears when at least one source falls back;
- Metrika groups Monday through Sunday and never reuses the dashboard's 28-day
  `organic_landing_pages` rows;
- the existing GSC `ORDER BY week_key DESC` landing-page fix remains intact;
- existing SEO OS week-selection tests remain green.

After code verification, production validation selects W30 and compares the
displayed source weeks with read-only canonical snapshots.
