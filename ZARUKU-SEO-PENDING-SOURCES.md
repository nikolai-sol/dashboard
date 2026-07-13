# Zaruku SEO Dashboard Pending Sources

Current production source:
- Yandex Metrika counter `66624469`
- Layer: `onsite`
- Answers: visits after click, users, pageviews, bounce, duration, depth, traffic source, search engine, partial search phrases, pages, geo, devices, browser, OS, inferred demographics/interests.

The UI is intentionally built around measurement layers, not vendor-specific screens:
- `onsite`: what happens after a click, currently Yandex Metrika.
- `serp`: what happens before a click in search results. Weekly tracked Yandex positions are connected through SEO OS; Yandex Webmaster supplies Yandex search-console facts; GSC remains pending for Google.
- `ai`: AI answer visibility / citations. For this dashboard it is connected through the Alisa AI visibility snapshot in `seo_ai_visibility`.

## SEO OS / Weekly Yandex Positions

Status: connected.

SEO OS supplies weekly Yandex tracked-position data, section-level position and coverage trends, opportunity decisions, content tasks, and pipeline run telemetry. The dashboard currently exposes the available SEO OS weeks, clusters, opportunities, tasks, runs, and traffic-versus-visibility views through the `seo_os` payload.

Section assignment is read from `seo_section_patterns`. This database dictionary defines the URL-pattern-to-section mapping used by SEO OS; it is the authoritative section source for position and traffic/visibility views.

SEO OS is not a replacement for GSC or Yandex Webmaster. It provides the current tracked-position operational contour, but it does not provide the complete impressions, clicks, or CTR dataset required for search-console reporting.

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
- GSC is required for Google impressions, clicks, CTR, and average position before click.

## Yandex Webmaster

Status: connected as a ReportingDash-owned collector and read model.

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
