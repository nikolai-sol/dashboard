# Zaruku SEO Dashboard Source Status

Current production source:
- Yandex Metrika counter `66624469`
- Layer: `onsite`
- Answers: visits after click, users, pageviews, bounce, duration, depth, traffic source, search engine, partial search phrases, pages, geo, devices, browser, OS, inferred demographics/interests.

The UI is intentionally built around measurement layers, not vendor-specific screens:
- `onsite`: what happens after a click, currently Yandex Metrika.
- `serp`: what happens before a click in search results. Weekly tracked Yandex positions are connected through SEO OS; Yandex Webmaster supplies Yandex search-console facts; Google Search Console supplies Google search-console facts.
- `ai`: AI answer visibility / citations. For this dashboard it is connected through the Alisa AI visibility snapshot in `seo_ai_visibility`.

## SEO OS / Weekly Yandex Positions

Status: connected.

SEO OS supplies weekly Yandex tracked-position data, section-level position and coverage trends, opportunity decisions, content tasks, and pipeline run telemetry. The dashboard currently exposes the available SEO OS weeks, clusters, opportunities, tasks, runs, and traffic-versus-visibility views through the `seo_os` payload.

Section assignment is read from `seo_section_patterns`. This database dictionary defines the URL-pattern-to-section mapping used by SEO OS; it is the authoritative section source for position and traffic/visibility views.

SEO OS is not a replacement for GSC or Yandex Webmaster. It provides the current tracked-position operational contour, while GSC and Yandex Webmaster provide the search-console impressions, clicks, CTR, and average-position facts.

## Google Search Console

Status: connected as a ReportingDash-owned root collector and read model.

Production note: canonical daily query/page facts are live in `canonical_fact_gsc_queries_daily`. The root collector is `fetch_gsc_canonical.py`; the old temporary / teletask path must not be treated as a writer for this table. Cron is enabled on the canonical VPS at `06:55` and collects yesterday plus a 3-day backfill window because GSC can lag by 2-3 days. The dashboard aggregates daily facts into ISO weeks on read; incomplete current weeks render as `частично, по DD.MM`.

Connected fields:
- query
- page
- country
- device
- date
- clicks
- impressions
- ctr
- position

Dashboard panels:
- SERP KPI: impressions, clicks, CTR, average position.
- Query table with full Google search visibility, not only post-click phrases exposed by Metrika.
- Device SERP split is connected through query/page/summary facts by device.
- Country SERP split is connected through `canonical_fact_gsc_countries_daily` at `country + device` grain. This is Google Search Console's pre-click country dimension, not the onsite post-click `Geography` tab from Metrika.

Important distinction:
- Metrika can show visits from Google after click.
- GSC supplies Google impressions, clicks, CTR, and average position before click.

## Yandex Webmaster

Status: connected as a ReportingDash-owned collector and read model.

Production note: canonical daily URL/page facts are live in `canonical_fact_webmaster_pages_daily`. Backfill run `1439` loaded `2026-07-13..2026-07-15`; the dashboard API reports `zaruku_seo.webmaster.data_availability.pages = true`.

Connected fields:
- query
- url
- device
- ISO week
- clicks
- impressions
- ctr
- position

Dashboard panels unlocked:
- Yandex-specific SERP KPI.
- Query / URL visibility for Yandex search.
- Regional search-demand view before click.

Important distinction:
- Metrika shows Yandex organic sessions and some search phrases.
- SEO OS provides the connected weekly tracked Yandex positions.
- Webmaster provides real Yandex impressions, clicks, CTR, and query / URL search-console coverage. ReportingDash must not use ordinary Yandex Search API to duplicate SEO OS tracked positions.

## Alisa AI Visibility / SEO OS Export

Status: connected through `seo_ai_visibility`.

Connected fields:
- engine
- period
- presence_rate
- mentions
- citations
- provenance
- captured_at

Dashboard panels unlocked:
- AI visibility KPI.
- Presence trend by period.
- Mention and citation totals.
- Provenance badge for the source snapshot.

Important distinction:
- AI visibility is not a website session metric.
- It should stay in the `ai` layer and not be mixed into Metrika traffic totals.

## Current Metrika Limitations To Keep Visible

- Search phrases are partial. Google often hides query values, so Metrika phrases are useful but not a complete keyword universe.
- `searchPhrase × landing page` is not reliable for this counter; the API can return empty results for that combined cut.
- `Cached page traffic` is a technical Metrika traffic bucket (`saved`) and should stay in data-quality / technical tail, not as a main acquisition channel.
- Demographics and interests are inferred and only cover part of traffic.
