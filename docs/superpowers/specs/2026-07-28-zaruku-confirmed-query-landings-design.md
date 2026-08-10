# Zaruku Confirmed Query-to-Landing Design

Date: 2026-07-28  
Status: exact Webmaster pair implementation merged; migration and manual collection live; application deploy and weekly cron deferred by Abbott gate
Owner: ReportingDash / Zaruku

## Problem

The Quality tab always renders the warning `Запрос → посадочная · неполный`. This is not actionable and makes a permanent limitation look like an incident.

The current sources do not have the same relationship grain:

- Google Search Console stores `query + page` in the same fact row. This is a confirmed source relationship.
- Yandex Webmaster still stores its complete query and page totals separately, but a bounded exact-URL collector now stores observed pairs in `canonical_fact_webmaster_query_pages_daily`. Only that pair table may confirm a Yandex landing.
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
| Yandex Webmaster | exact standard-API URL-filter pairs in `canonical_fact_webmaster_query_pages_daily` | Yes, exact pair rows only |
| SEO OS | `matched_url` is target/tracking context | No |

The Webmaster `popular_complementary_indicator` may later be shown as `Основная страница в Яндексе`, but it must not pass the confirmed-landing filter because it is a representative complementary URL rather than a per-pair click fact.

## Dashboard Behavior

### Default state

- The filter is off.
- The unified table continues to show Google, Webmaster, and SEO OS query rows.
- Confirmed Google and exact Webmaster links appear below the query with source prefixes.
- Rows without a confirmed page remain visible and show no invented URL.
- The existing SEO OS target URL remains visible with its existing `SEO OS:` prefix, but does not affect the filter.

### Filtered state

- The control label is `Только с подтверждённой посадочной`.
- Enabling it filters the already loaded unified rows client-side.
- A row passes when `google_pages.length > 0 || webmaster_pages.length > 0`.
- Rows without either exact source pair disappear only while the filter is enabled.
- Search, sort, week selection, and pagination continue to work. Filtering occurs before pagination so page counts remain correct.
- If no rows match, the table shows one quiet message: `Нет запросов с подтверждённой посадочной за выбранный период.`
- The table states explicitly that confirmation comes from same-row Google Search Console or Yandex Webmaster facts; SEO OS and representative Yandex URLs do not confirm the filter.

### URL presentation

- Google links use the prefix `Google:`.
- Exact Webmaster links use the prefix `Яндекс:`.
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

Decision: do not add `search_phrase_landing_pages`, do not modify the Metrika collector, and do not expose Metrika as a confirmed query-to-landing source. Confirmed landing pages come from GSC or the exact Webmaster pair table. Reconsider Metrika only if a future API/data-contract change produces a materially non-empty result in a separately authorized validation.

## W30 Coverage and Wording Decision

The read-only production calculation was repeated immediately before the RD-07 gate for `2026-W30` (`2026-07-20..2026-07-26`; GSC facts through 25.07, Webmaster facts through 22.07):

- 4,528 unified query keys;
- 3,259 keys with a same-row GSC page;
- 1,269 Webmaster-only keys;
- the confirmed cohort carries 695 of 3,958 Webmaster impressions, or 17.5594%.

The 17.5594% is a historical partial-week diagnostic from before exact Webmaster pair collection and is not rendered as a percentage. A Google page must still never be read as the Yandex landing for the same phrase.

An authoritative URL count for all Webmaster-only queries does not exist in the current canonical contract because query and page facts are separate. The bounded `popular_complementary_indicator` proxy covers 491 normalized URLs and 487 of 1,269 Webmaster-only query keys, but remains representative-only and never passes the RD-06 filter.

## RD-07 Enhanced Export Proof

After the URL/date prerequisite was fixed, one explicitly authorized base-quota request was created for the highest-impression representative candidate:

- URL: `/rak-molochnoj-zhelezy/nuzhno-li-sohranyat-molochnuyu-zhelezu-pri-rake/`;
- date: `2026-07-22`;
- task: `26224340-8a5c-11f1-b8b7-21c9fbaae2a2`;
- quota: 1 free unit used, 99 remaining; no paid quota used.

The task completed successfully. Its gzip CSV contains 152 rows with `date`, `host`, `path`, `query`, `clicks`, `impressions`, and `position` in the same row; 13 rows have positive clicks, totaling 13 clicks and 191 impressions. All 152 query strings normalize with the same trim / whitespace-collapse / lowercase rule used by the dashboard. The selected representative query matches the current canonical normalized key exactly.

This proved that Enhanced Export can supply exact Yandex query-page relationships. The later standard-API exact-URL probe matched the same artifact exactly and unlocked the bounded canonical collector; Enhanced Export remains the historical-backfill and exact fallback path.

## Data Contract

The filter eligibility helper is a pure function so it can be tested independently:

```text
hasConfirmedLanding(row) = google_pages.length > 0 || webmaster_pages.length > 0
```

## Error and Partial-Data Handling

- Metrika does not create a query-to-landing dataset, warning card, or filter dependency.
- A source failure remains visible only through existing source freshness/technical diagnostics.
- Client copy never claims that every click is mapped to a page.
- Separate Webmaster query/page totals are never joined heuristically.

## Tests

### Read model

- Multiple GSC or Webmaster pages for one query are deduplicated and bounded per source.
- Webmaster rows never acquire a page through an inferred join.
- Metrika rows never pass the confirmed-landing filter.

### UI

- The Quality item `Запрос → посадочная` is absent.
- The filter is off by default.
- With the filter off, all query rows remain visible.
- With the filter on, only rows with GSC-confirmed or exact Webmaster-confirmed pages remain.
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
7. Only exact Webmaster pair URLs are represented as observed Yandex landings; separate page totals, representative URLs, and SEO OS targets remain excluded.
8. Existing query search, sort, pagination, week selection, and responsive table containment remain intact.
9. Unit tests, TypeScript, production build, and browser verification pass before handoff.

## Out of Scope

- Synthetic query-to-page joins based on matching totals, dates, positions, or ranks.
- Treating Webmaster `popular_complementary_indicator` as an exact click landing.
- A separate landing-mapping dashboard tab.
- Additional query-page schema beyond migration `045`.
- Metrika `searchPhrase + startURL` collection unless a future separately authorized probe demonstrates useful non-empty coverage.
- Historical query-page backfill, paid Enhanced Export quota, secret changes, or expansion beyond 30 priority pages.

## Rollout checkpoint 2026-07-29

- Standard exact-URL probe: 152/152 rows, 13/13 clicks, 191/191 impressions, zero mismatches against Enhanced Export.
- Migration `045` is applied in production.
- Manual run `1715` succeeded for 15 pages over `2026-07-21..2026-07-27`: 105 coverage rows, 67 pair facts, 88 successful-empty page-days, and zero bad rows.
- Dashboard commit `833db89` is merged and pushed to `main`, but is not deployed because Abbott release `10` remains staging and the active pointer remains release `8`.
- The proposed Monday `03:20 UTC` cron is not installed. Production UI smoke and first scheduled-run verification remain pending.
