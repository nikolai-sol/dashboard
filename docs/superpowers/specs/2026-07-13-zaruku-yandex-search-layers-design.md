# Zaruku Yandex Search Layers Design

## Goal

Complete the Zaruku search measurement architecture without collecting the same SERP positions twice.

The dashboard must combine three independently sourced views:

- SEO OS tracked visibility: weekly Yandex positions for the controlled cluster set.
- Yandex Webmaster demand: actual impressions, clicks, CTR, average position, queries, URLs, and device splits.
- Yandex Generative Search visibility: mentions and citations for the same tracked cluster set.

The dashboard remains a read model. API collectors write normalized database snapshots; React components never call Yandex APIs directly.

## Ownership Boundaries

### SEO OS

SEO OS remains the only writer of tracked Yandex SERP positions. It owns the ordinary Yandex Search API credentials and continues writing:

- `seo_positions_weekly`
- `seo_opportunities`
- `seo_tasks`
- `seo_weekly_runs`

Production currently contains 36 `seo_positions_weekly` rows for `2026-W28` and `2026-W29`, all with `source_key = 'seo_os'`. ReportingDash must not issue a second ordinary Search API request for these clusters or write competing position rows.

SEO OS also owns Yandex Generative Search requests because they use the same tracked cluster set, weekly cadence, region, language, and request-budget boundary. It exports the resulting AI visibility snapshots to ReportingDash.

### ReportingDash

ReportingDash owns Yandex Webmaster collection. Webmaster measures actual search exposure and demand rather than controlled rank checks. Its collector writes separate Webmaster facts and never modifies SEO OS tables.

The dashboard application reads both datasets and combines them only in presentation DTOs. It does not infer that Webmaster clicks equal Metrika visits.

## Source Registry

The Zaruku source registry exposes these sources independently:

- `metrika`, layer `onsite`, connected.
- `seo_os`, layer `serp`, connected when tracked position tables are available.
- `webmaster`, layer `serp`, connected or partial according to collection coverage.
- `yandex_gen_search`, layer `ai`, connected or partial according to exported snapshots.
- `gsc`, layer `serp`, pending.

Ordinary Yandex Search API is not shown as a second dashboard source. It is an implementation dependency of `seo_os`.

## Webmaster Collection

### Authentication

The server-only collector reads:

- `YANDEX_WEBMASTER_ENABLED`
- `YANDEX_WEBMASTER_CLIENT_ID`
- `YANDEX_WEBMASTER_CLIENT_SECRET`
- `YANDEX_WEBMASTER_REDIRECT_URI`
- `YANDEX_WEBMASTER_OAUTH_TOKEN`
- `YANDEX_WEBMASTER_REFRESH_TOKEN`
- `YANDEX_WEBMASTER_HOST_ID`
- `YANDEX_WEBMASTER_DEFAULT_DATE_RANGE_DAYS`
- `YANDEX_WEBMASTER_DEVICE_TYPE`

The OAuth access token is sent only in the `Authorization` header. The collector refreshes it through Yandex OAuth when required and accepts the newly returned refresh token. Rotated tokens must be persisted in the server secret store, never in application tables, logs, browser responses, or committed files.

If `YANDEX_WEBMASTER_HOST_ID` is empty, the collector obtains the Webmaster user ID, lists accessible hosts, and selects the canonical host matching `zaruku.ru`. Ambiguous or missing matches fail explicitly instead of selecting the first host.

### Calendar Weeks

The dashboard compares complete ISO calendar weeks, Monday through Sunday. The collector requests explicit `date_from` and `date_to` values for each completed week. It does not label a rolling seven-day response as a calendar week.

Initial backfill covers all complete weeks supported by the API and then runs after each week closes. Re-running a week is idempotent.

### Database Facts

Create `seo_webmaster_queries_weekly` with grain:

`analytics_account_id + week_key + query_id + device_type`

Fields:

- source and host provenance
- query ID and query text
- impressions
- clicks
- CTR, calculated from clicks and impressions at the read boundary
- average show position
- average click position
- collected timestamp and ingestion run ID

Create `seo_webmaster_pages_weekly` with grain:

`analytics_account_id + week_key + page_url + device_type`

Fields mirror the available Webmaster URL-level indicators. Query and URL facts remain separate unless the selected Webmaster endpoint provides an authoritative pair. The collector must not manufacture a query-to-page relationship.

Collection run status is written to the existing canonical collector telemetry contour or to an equivalent source-scoped run table. Partial pagination, API errors, token failures, and stale weeks are visible as partial/unavailable source coverage.

### Devices

Version 1 collects `ALL`, matching `YANDEX_WEBMASTER_DEVICE_TYPE=ALL`. The schema keeps `device_type` in the unique key so desktop/mobile collection can be enabled later without migration or UI redesign.

## Generative Search Export

SEO OS exports `seo_ai_visibility_weekly` with grain:

`analytics_account_id + week_key + cluster_id + engine + region + language + device`

Fields:

- tracked query and cluster identity
- whether `zaruku.ru` was mentioned
- mention count where deterministically measurable
- cited URLs as structured JSON
- citation count
- response/request identifiers safe for diagnostics
- checked timestamp and ingestion run ID
- explicit status for success, no mention, no answer, and request failure

Raw generated answer text is not required by the dashboard and should not be stored unless SEO OS has a separate retention and privacy requirement. API credentials remain in the SEO OS runtime, not the ReportingDash browser or database.

## Dashboard Contract

Extend `ZarukuSeoData` with independent `webmaster` and `ai_visibility` DTOs. Each DTO contains availability, coverage, latest week, available weeks, rows, summaries, and a sanitized error message.

The existing ISO week toolbar controls all weekly search panels. A selected week may be present in one source and missing in another; each panel renders its own coverage state rather than hiding the entire dashboard.

### Webmaster Panels

- KPI row: impressions, clicks, CTR, average show position.
- Weekly trend with optional week comparison.
- Query table: query, impressions, clicks, CTR, average position, deltas.
- Landing-page table when authoritative URL facts are available.
- Device split after device-specific collection is enabled.

### Tracked Visibility Panels

Existing SEO OS position, cluster, opportunity, task, rhythm, and traffic-versus-visibility panels remain authoritative and unchanged in meaning.

### AI Visibility Panels

- Presence rate across checked tracked clusters.
- Mentioned versus not-mentioned clusters.
- Cited Zaruku URLs.
- Week-over-week change for the same tracked universe, with coverage shown when the cluster set changes.

No UI panel combines tracked rank, Webmaster average position, and AI presence into a single synthetic score.

## Environment And Secret Handling

Production values live only in `/var/www/www-root/data/.production.env`. `scripts/render-production-env.sh` explicitly whitelists the Webmaster variables needed by ReportingDash. `.env.production.example` contains names and placeholders only.

Ordinary and Generative Search credentials are installed in the SEO OS runtime. ReportingDash should receive Generative Search credentials only if it becomes the agreed collector owner in a later architecture change.

All credentials shared during setup must be rotated because they were exposed outside the secret store. Validation commands must report only status, account/host identifiers, and non-sensitive metadata.

## Failure Semantics

- Webmaster disabled: source is unavailable with a configuration note.
- Expired access token with valid refresh token: refresh and retry once.
- Refresh failure: abort without erasing prior snapshots.
- Host discovery ambiguity: fail closed and require explicit host ID.
- Partial pagination or endpoint failure: preserve successful rows under a partial run; never mark the week complete.
- SEO OS or AI export missing for a week: render a source-specific missing-week state.
- Empty valid response: distinguish zero activity from collection failure.

Collectors use bounded retries for transient 429 and 5xx responses and honor server retry guidance. Logs redact authorization headers, API keys, client secrets, access tokens, and refresh tokens.

## Verification

Automated coverage includes:

- OAuth refresh response handling and token redaction.
- exact `zaruku.ru` host discovery and ambiguity handling.
- ISO week date boundaries, including year transitions.
- API pagination and idempotent upserts.
- CTR calculation and null/zero-impression behavior.
- partial-source semantics.
- week reconciliation across SEO OS, Webmaster, and AI datasets.
- assurance that ReportingDash never writes `seo_positions_weekly`.

Integration verification uses a token-protected API probe, records no secret values, and confirms the discovered Webmaster host before backfill. Browser verification covers desktop and mobile dashboard layouts, week comparison, empty states, and partial-source states.

## Delivery Sequence

1. Rotate and install credentials in their owning runtimes.
2. Add Webmaster schema, collector, secret whitelist, tests, and a dry-run probe.
3. Discover and pin the Zaruku Webmaster host ID.
4. Backfill complete supported weeks and validate totals.
5. Add Webmaster DTOs and dashboard panels.
6. Extend SEO OS with Generative Search export and the AI snapshot table.
7. Add AI visibility DTOs and panels after exported rows exist.
8. Deploy and verify source coverage independently.
