# Zaruku Daily Cutoff and Canonical Collector Repair Design

**Status:** approved in conversation on 2026-07-23  
**Repositories:** `ReportingDash` root collector repository and nested `dashboard-next` repository  
**Working branches:** `codex/zaruku-daily-cutoff-cron-repair` in both repositories

## Goal

Repair the Zaruku daily collection path and give every daily dashboard panel one predictable period contract:

- daily data uses a product-wide 48-hour lag;
- SEO OS remains an independent weekly position snapshot;
- AI visibility remains an independent snapshot/monthly measurement;
- missing or delayed facts are never silently replaced by another period;
- work is implemented and verified on dedicated branches before any merge to `main`.

## Confirmed production findings

The current generic Yandex Metrika cron fails with:

```text
1265 (01000): Data truncated for column 'analytics_scope'
```

The collector writes `analytics_scope='entry_page'`, while
`canonical_fact_site_analytics_daily.analytics_scope` currently permits only:

```text
traffic, goal, page, params, returned, other
```

The current generic collector also deletes the target window before attempting
the canonical upsert. The failed insert therefore left Zaruku facts ending on
2026-07-19 even though a later Abbott release run made the source-wide
freshness query look healthy.

Google Search Console diagnostics for the closed date 2026-07-20 established:

- `dimensions=['searchAppearance']` returns HTTP 200;
- adding `page` returns HTTP 400 with
  `Cannot group by search appearance dimension together with another dimension`;
- the normal query/page/country/device request returns HTTP 200;
- `type='discover'` with `device` returns HTTP 400 with
  `Requests for Discover cannot be grouped by device`;
- `type='discover'` with page/country returns HTTP 200.

These GSC errors are request-contract errors, not data-latency errors.

## Product period contract

### Daily sources

The dashboard uses one public rule:

```text
Daily data is shown with a standard 48-hour lag.
```

The maximum eligible daily date is:

```text
expected_daily_to = current calendar date - 2 calendar days
```

The calculation is deterministic and receives `today` as an injectable input
in tests. Production uses the dashboard's configured calendar date, without
deriving the date from collector runs.

For a requested period:

```text
effective_daily_from = requested_from
effective_daily_to = min(requested_to, expected_daily_to)
```

All daily read models use this same clipped range:

- canonical Yandex Metrika facts;
- live read-only Metrika report slices that remain in the Zaruku loader;
- Google Search Console daily facts;
- Yandex Webmaster daily facts;
- returning-content daily facts.

The Overview period surface says only:

```text
Ежедневные данные: DD.MM.YYYY–DD.MM.YYYY · стандартный лаг 48 часов
```

It does not name a “limiting source.” If a required daily dataset has no
confirmed facts for the expected cutoff, the trust/quality surface marks daily
data as delayed and shows the actual available-through date. It does not move
the requested period backward without disclosure and does not reuse an older
week under a newer label.

### SEO OS

SEO OS is never used to determine or filter the daily period.

GSC and Webmaster queries must no longer receive `seo_os.weeks` as their date
scope. They receive the clipped daily date range and aggregate daily facts into
ISO weeks only for presentation.

SEO OS retains its own week selector and displays:

```text
2026-W29 · недельный срез позиций
```

An adjacent circular `i` tooltip explains:

```text
SEO OS — отдельный недельный срез отслеживаемых позиций и рабочего pipeline.
Он не является данными за выбранный daily-период и не ограничивает Метрику,
Google Search Console или Яндекс Вебмастер.
```

### AI visibility

AI visibility remains an independent snapshot/monthly measurement. Its period
and provenance remain visible and it is not clipped to the daily period.

## Metrika collector repair

### Schema compatibility

Add a replay-safe migration that extends
`canonical_fact_site_analytics_daily.analytics_scope` with `entry_page`.

The collector performs a schema preflight before collection/publishing and
fails before any fact mutation if the required scope is unavailable.

No cron schedule is changed. The existing generic collection time remains
06:12.

### Safe publication order

Replace destructive publication:

```text
delete target range -> insert current run
```

with:

```text
collect and validate -> upsert current run -> prune stale rows from the same
account/range/scopes where ingestion_run_id differs from the successful run
```

The same safety rule applies to generic user-behavior facts. If an upsert
fails, old facts remain available. A failed run must never create a blank
published window.

Abbott release publication remains append-only and unchanged. The generic
Zaruku repair must not weaken Abbott's five-scope publication gate or write
into Abbott private visit storage.

### Account scope

Production repair/backfill targets only Zaruku counter `66624469`.

The following counters remain inactive and cron-disabled:

- `29137835`;
- `105559308`;
- `99078698`.

## Freshness and availability

The Zaruku daily availability date is derived from facts scoped to
`analytics_account_id=66624469`, never from a source-wide success belonging to
another account or Abbott release.

The Metrika collector-health query for Zaruku ignores
`run_mode='canonical_release'`; Abbott release success cannot hide a failed
generic `canonical_only` run.

Expected cutoff and actual availability are separate concepts:

- expected cutoff: today minus 48 hours;
- actual availability: latest confirmed fact date for the Zaruku account and
  dataset;
- status `ready`: actual availability reaches the expected cutoff;
- status `delayed`: actual availability is older;
- status `empty`: a successful supported query produced no facts;
- status `unavailable`: the source/query contract failed.

The Overview keeps the simple 48-hour product copy. Technical source and cron
details remain in the Quality tab.

## Google Search Console correction

### Search appearance

Collect `searchAppearance` as a property-level aggregate with the only
dimension:

```json
["searchAppearance"]
```

Store empty strings for page, country, and device in the existing canonical
contract. The hash remains deterministic over search type, appearance, and the
empty lower-grain dimensions.

An HTTP 200 response with zero rows means that no special search appearance was
reported for that date. It is not a collector failure and does not block the
48-hour daily period.

### Search/result types

Use dimensions by result type:

- `web`, `image`, `video`, `news`, `googleNews`: page, country, device;
- `discover`: page, country.

For Discover, persist an empty device value. Optional result types that return
HTTP 200 with zero rows remain valid empty datasets.

The collector continues to treat core query/page/country/device facts as the
required GSC layer.

## Read-model changes

Introduce a focused daily-period helper that:

- accepts requested `from`, requested `to`, and `today`;
- returns the standard cutoff and clipped effective range;
- handles a requested range ending before the cutoff without changing it;
- handles an invalid range explicitly rather than silently swapping dates.

`loadZarukuSeoData` calculates the period once and passes it to all daily
queries and live report requests.

`loadAccountFacts` passes the clipped date range to GSC and Webmaster.
Their SQL filters `report_date BETWEEN ? AND ?`, then aggregates the matching
daily facts into ISO weeks. Partial first/last ISO weeks remain labelled as
partial.

SEO OS and AI loaders receive no daily date constraint.

## UI changes

The Overview period context is reorganized into:

1. one daily-data badge with the selected clipped range and `48 часов`;
2. one SEO OS weekly badge with a circular information tooltip;
3. one AI snapshot badge with period and provenance.

The misleading sentence about every source using “its own factual period” is
removed. Recommended Overview copy:

```text
Ежедневные показатели Метрики, Google Search Console и Яндекс Вебмастера
показаны по единому правилу: с лагом 48 часов. SEO OS и AI-видимость —
отдельные срезы, их периоды указаны рядом.
```

Missing data remains visibly missing or delayed; no previous-week fallback is
introduced.

## Testing

### Root collector tests

Add red/green tests for:

- schema preflight rejects a database without `entry_page` before mutation;
- current-run rows are upserted before stale rows are pruned;
- upsert failure does not invoke prune;
- stale pruning is scoped by account, date range, scopes, and ingestion run;
- inactive Zaruku counters remain excluded;
- GSC searchAppearance requests only one dimension;
- GSC Discover requests omit device;
- HTTP 200 with zero optional rows is not a partial run;
- HTTP 400 captures the sanitized Google error message without credentials.

### Dashboard tests

Add red/green tests for:

- 48-hour cutoff calculation;
- requested periods ending before the cutoff remain unchanged;
- every daily loader receives the same effective range;
- GSC/Webmaster SQL uses date bounds rather than SEO OS week bounds;
- SEO OS does not constrain daily sources;
- Overview shows the unified daily badge;
- SEO OS shows the circular information tooltip and explanatory copy;
- Metrika actual availability uses account facts, not Abbott release runs;
- generic Metrika health ignores `canonical_release`.

Run the focused test suites, then the full Python collector suite, dashboard
tests, lint, typecheck, and production build.

## Branch, review, and merge workflow

All work stays on `codex/zaruku-daily-cutoff-cron-repair` in both repositories.

Before acceptance:

- do not merge either branch to `main`;
- do not deploy;
- do not edit production cron;
- do not apply the migration;
- do not run a production-writing backfill.

Before presenting for acceptance:

- provide commits for the root collector and nested dashboard repository;
- provide test/build evidence;
- provide a read-only production availability report;
- provide the proposed migration and targeted backfill commands.

After explicit acceptance:

1. merge the nested dashboard branch into a clean nested `main`;
2. update the root repository gitlink;
3. merge the root branch into a clean root `main`;
4. push both clean mains;
5. apply the reviewed migration;
6. deploy the reviewed collectors/dashboard;
7. run a targeted backfill only for `66624469`;
8. verify the common 48-hour cutoff and collector health;
9. leave the three inactive counters untouched.

No force push is permitted.

## External references

- Google Search Analytics API documents `searchAppearance` as a supported
  filter/grouping dimension and `dataState=final` as finalized data:
  https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- Google documents that Search Console performance data is normally available
  in 2–3 days:
  https://support.google.com/webmasters/answer/96568

