# Zaruku Confirmed Query-to-Landing Design

Date: 2026-07-28  
Status: approved design, amended after read-only Metrika validation; implementation pending
Owner: ReportingDash / Zaruku

## Problem

The Quality tab always renders the warning `Запрос → посадочная · неполный`. This is not actionable and makes a permanent limitation look like an incident.

The current sources do not have the same relationship grain:

- Google Search Console stores `query + page` in the same fact row. This is a confirmed source relationship.
- Yandex Webmaster stores query rows and page rows separately in the current canonical contract. Joining them by totals, week, or position would invent a relationship.
- Yandex Metrika currently stores `search_phrases` and `organic_landing_pages` as separate segment types. The latter is `searchEngine + startURL`, not `searchPhrase + startURL`.
- SEO OS `matched_url` is a tracked or target page. It is useful context, but it is not an observed landing page for a click.

Users should see all useful query data by default and be able to isolate only the rows with a source-confirmed landing page. The product must not create a separate permanently incomplete tab or card.

## Decision

Use the existing unified SEO query table as the only query-to-page surface.

1. Remove the permanent Quality item `Запрос → посадочная`.
2. Keep all query rows visible by default.
3. Show confirmed landing-page links directly under the query.
4. Add one table filter: `Только с подтверждённой посадочной`.
5. When the filter is enabled, retain only rows with at least one observed `query + page` relationship.
6. Do not count SEO OS target URLs or a Webmaster representative URL as confirmed landings.

No new tab, card, or dashboard section is introduced.

## Confirmation Rules

A landing is confirmed only when the source returns the query and page in the same record or the same grouped report row.

| Source | Current status | Counts as confirmed |
| --- | --- | --- |
| Google Search Console | `query + page` already collected | Yes |
| Yandex Metrika | separate phrase and landing segment types; the validated combined report returned no rows | No |
| Yandex Webmaster | query and URL datasets are separate | No |
| SEO OS | `matched_url` is target/tracking context | No |

The Webmaster `popular_complementary_indicator` may later be shown as `Основная страница в Яндексе`, but it must not pass the confirmed-landing filter because it is a representative complementary URL rather than a per-pair click fact.

## Dashboard Behavior

### Default state

- The filter is off.
- The unified table continues to show Google, Webmaster, and SEO OS query rows.
- Confirmed Google links appear below the query with a source prefix.
- Rows without a confirmed page remain visible and show no invented URL.
- The existing SEO OS target URL remains visible with its existing `SEO OS:` prefix, but does not affect the filter.

### Filtered state

- The control label is `Только с подтверждённой посадочной`.
- Enabling it filters the already loaded unified rows client-side.
- A row passes when `google_pages.length > 0`.
- Webmaster-only and SEO-OS-only rows disappear only while the filter is enabled.
- Search, sort, week selection, and pagination continue to work. Filtering occurs before pagination so page counts remain correct.
- If no rows match, the table shows one quiet message: `Нет запросов с подтверждённой посадочной за выбранный период.`

### URL presentation

- Google links use the prefix `Google:`.
- Duplicate Google URLs are normalized and shown once.
- The current per-query URL cap remains bounded to protect row height.

## Metrika Validation Decision

Before implementation, one explicitly authorized read-only Reporting API request tested the proposed combination:

```text
counter = 66624469
date = 2026-07-23
dimensions = ym:s:searchPhrase,ym:s:startURL
metrics = existing METRIKA_SEGMENT_METRICS
accuracy = full
```

The request succeeded with HTTP 200 and no sampling (`sample_share = 1.0`, `sample_size = sample_space = 353`), so the dimensions are technically compatible. The response contained zero rows, zero query-page pairs, and zero visits.

For the same counter and date, existing separately collected segments contained:

- `search_phrases`: 30 rows and 32 visits;
- `organic_landing_pages`: 30 rows and 144 visits.

Measured survival was therefore 0% of the stored top search phrases and 0% of visits in both comparison cuts. Compatibility alone is not sufficient: the combined privacy suppression makes the dataset unusable for this dashboard.

Decision: do not add `search_phrase_landing_pages`, do not modify the Metrika collector, and do not expose Metrika as a confirmed query-to-landing source. Confirmed landing pages remain GSC-only. Reconsider Metrika only if a future API/data-contract change produces a materially non-empty result in a separately authorized validation.

## Data Contract

The filter eligibility helper is a pure function so it can be tested independently:

```text
hasConfirmedLanding(row) = google_pages.length > 0
```

## Error and Partial-Data Handling

- Metrika does not create a query-to-landing dataset, warning card, or filter dependency.
- A source failure remains visible only through existing source freshness/technical diagnostics.
- Client copy never claims that every click is mapped to a page.
- Separate Webmaster query/page totals are never joined heuristically.

## Tests

### Read model

- Multiple GSC pages for one query are deduplicated and bounded.
- Webmaster rows never acquire a page through an inferred join.
- Metrika rows never pass the confirmed-landing filter.

### UI

- The Quality item `Запрос → посадочная` is absent.
- The filter is off by default.
- With the filter off, all query rows remain visible.
- With the filter on, only rows with GSC-confirmed pages remain.
- SEO OS `matched_url` alone does not pass the filter.
- Filtering happens before pagination and preserves search/sort behavior.
- The empty filtered state uses the agreed quiet message.

## Acceptance Criteria

1. No permanent `Запрос → посадочная · неполный` card is rendered.
2. No new tab or standalone query-to-landing panel is added.
3. The default query workspace loses no Webmaster, GSC, or SEO OS rows.
4. The new filter returns only source-confirmed query-page relationships.
5. GSC works immediately from existing canonical data.
6. No Metrika combined segment, collector change, or synthetic Metrika join is introduced.
7. Webmaster and SEO OS URLs are not misrepresented as observed landing pages.
8. Existing query search, sort, pagination, week selection, and responsive table containment remain intact.
9. Unit tests, TypeScript, production build, and browser verification pass before handoff.

## Out of Scope

- Synthetic query-to-page joins based on matching totals, dates, positions, or ranks.
- Treating Webmaster `popular_complementary_indicator` as an exact click landing.
- A separate landing-mapping dashboard tab.
- Database migration.
- Metrika `searchPhrase + startURL` collection unless a future separately authorized probe demonstrates useful non-empty coverage.
- Production collector execution, backfill, cron change, deployment, or secret change.
