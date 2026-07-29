# Yandex Webmaster Query-to-Page Standard API Probe

Date: 2026-07-29  
Status: pass  
Scope: one exact URL and one report date; no canonical write, migration, cron edit, deployment, Telegram send or new Enhanced Export task

## Controlled input

- Account: `66624469`
- Host: `zaruku.ru`
- Date: `2026-07-22`
- Exact URL filter: `/rak-molochnoj-zhelezy/nuzhno-li-sohranyat-molochnuyu-zhelezu-pri-rake/`
- Standard endpoint: `query-analytics/list`
- Primary text indicator: `QUERY`
- Filter: `URL / TEXT_MATCH / exact path above`
- Device: `ALL`
- Search location: deployed `YANDEX_WEBMASTER_SEARCH_LOCATION` value

The comparison source was the existing Enhanced Export task `26224340-8a5c-11f1-b8b7-21c9fbaae2a2`. Its existing successful task was downloaded again; no new task and no paid quota were used. The downloaded gzip remained 5,737 bytes with SHA-256 `c4a76e1e5768e44c9bee43575690674844a336811059e3833d33e048ab6e272f`, exactly matching the 2026-07-28 evidence.

## Normalization finding

The first standard response contained 1,679 query indicators across the endpoint's recent window. For the selected day, 1,527 rows had zero clicks, zero impressions and no position. The existing Webmaster page canonical normalizer already excludes this no-fact shape.

Before applying the same selected-day rule, the sanitized comparison was:

- standard rows: 1,679;
- Enhanced Export rows: 152;
- mismatch count: 1,527;
- both totals: 13 clicks and 191 impressions.

The equality `1,679 - 152 = 1,527`, together with identical non-negative metric totals, showed that all 152 Enhanced Export signatures were already present and that the surplus consisted only of zero-fact indicators. A regression test now requires the probe and planned collector pair normalizer to drop a row only when clicks and impressions are both zero and position is absent for the requested date.

## Pass result

After that source-consistent selected-day normalization, the repeated exact-filter read produced:

| Gate | Standard | Enhanced Export |
| --- | ---: | ---: |
| normalized query-page rows | 152 | 152 |
| clicks | 13 | 13 |
| impressions | 191 | 191 |
| mismatched signatures | 0 | 0 |

- Gate: `pass`
- Standard response SHA-256: `41e3b62ca5790f0444f98100adf0104447146bd43166d045b0ef03550f2fb948`
- Enhanced Export SHA-256: `c4a76e1e5768e44c9bee43575690674844a336811059e3833d33e048ab6e272f`

## Decision

The standard Yandex Webmaster Query Analytics endpoint can supply exact recent `query -> page` facts using `text_indicator = QUERY` plus the exact `URL / TEXT_MATCH` filter. The weekly 15-page implementation may proceed behind a separate canonical pair grain and successful-empty coverage. Existing separate query/page tables and `popular_complementary_indicator` remain forbidden as pair sources. Enhanced Export remains the historical-backfill and exact fallback path.
