# Zaruku SEO Dashboard Pending Sources

Current production source:
- Yandex Metrika counter `66624469`
- Layer: `onsite`
- Answers: visits after click, users, pageviews, bounce, duration, depth, traffic source, search engine, partial search phrases, pages, geo, devices, browser, OS, inferred demographics/interests.

The UI is intentionally built around measurement layers, not vendor-specific screens:
- `onsite`: what happens after a click, currently Yandex Metrika.
- `serp`: what happens before a click in search results, pending GSC and Yandex Webmaster.
- `ai`: AI answer visibility / citations, pending DataForSEO or equivalent.

## Google Search Console

Status: pending.

Needed fields:
- query
- page
- country
- device
- date
- clicks
- impressions
- ctr
- position

Dashboard panels unlocked:
- SERP KPI: impressions, clicks, CTR, average position.
- Organic landing page table columns: Google position, Google CTR, Google impressions.
- Query table with full Google search visibility, not only post-click phrases exposed by Metrika.
- Country/device SERP split.

Important distinction:
- Metrika can show visits from Google after click.
- GSC is required for impressions and average position before click.

## Yandex Webmaster

Status: pending.

Needed fields:
- query
- url
- region
- device
- date
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
- Webmaster is required for positions, impressions and CTR.

## DataForSEO / AI Visibility

Status: pending.

Needed fields:
- prompt / query
- engine
- region
- date
- mentions
- citations
- quoted_urls
- competitors
- presence_rate

Dashboard panels unlocked:
- AI visibility KPI.
- Mention and citation tables.
- Prompt groups by oncology topic.
- Quoted Zaruku URLs and competitor comparison.

Important distinction:
- AI visibility is not a website session metric.
- It should stay in the `ai` layer and not be mixed into Metrika traffic totals.

## Current Metrika Limitations To Keep Visible

- Search phrases are partial. Google often hides query values, so Metrika phrases are useful but not a complete keyword universe.
- `searchPhrase × landing page` is not reliable for this counter; the API can return empty results for that combined cut.
- `Cached page traffic` is a technical Metrika traffic bucket (`saved`) and should stay in data-quality / technical tail, not as a main acquisition channel.
- Demographics and interests are inferred and only cover part of traffic.
