# Zaruku SEO OS Layer Design

## Goal

Add the account-scoped SEO OS weekly read model to the Zaruku dashboard while preserving the existing separation between on-site, SERP, and AI visibility data. The dashboard must support latest-week analysis, automatic comparison with the previous available week, and manual comparison between two ISO calendar weeks.

## Scope

The implementation reads the following tables for `analytics_account_id = 66624469`:

- `seo_section_patterns`
- `seo_positions_weekly`
- `seo_opportunities`
- `seo_tasks`
- `seo_weekly_runs`

The dashboard is read-only for every `seo_*` table. The SEO OS exporter remains the only writer.

Google Search Console and Yandex Webmaster remain pending sources for impressions, clicks, CTR, and their own position datasets. DataForSEO remains pending for AI visibility. SEO OS becomes a connected SERP source for tracked Yandex positions and workflow telemetry.

## Navigation And Panels

The existing `SEO` tab becomes the analytical SEO workspace:

- ISO week toolbar with the latest available week selected by default.
- `Compare with previous` action that selects the immediately preceding available SEO week.
- Manual comparison mode with separate `Week A` and `Week B` ISO week selectors.
- Positions by section trend with an inverted Y axis.
- Coverage per section and week.
- Latest or selected-week cluster table.
- Existing Metrika search-engine and search-phrase panels remain available as on-site post-click context.
- GSC and Webmaster placeholders remain, but no longer imply that all position data is unavailable.

A new `SEO Ops` tab contains:

- Opportunity decision funnel and approve rate.
- Reject reasons.
- Tasks status summary and task table.
- Weekly rhythm health strip.

The existing `Content` tab gains a `Traffic vs visibility` panel combining weekly Metrika traffic and SEO OS average position using the shared section dictionary.

## Week Selection And Comparison

SEO panels do not inherit the dashboard's general date filter. They use their own ISO week selector because SEO OS is produced weekly and the newest SEO week may be outside the selected Metrika range.

The loader returns all available SEO weeks in ascending order. The UI selects the newest week by default and performs week switching locally without an additional server request.

Comparison behavior:

- `Compare with previous` compares the selected week with the immediately preceding available week, not merely `week number - 1` when that week has no data.
- The button is disabled when there is no earlier available week and exposes a concise tooltip.
- Manual comparison permits any two available ISO weeks.
- Labels always include ISO year and week, for example `2026-W28`, to avoid ambiguity around year boundaries.
- Comparison applies to average positions, coverage, opportunity decisions, approve rate, task statuses, pipeline telemetry, and section traffic.
- With only one available week, current values remain visible and comparison deltas are omitted.

## Data Model

Add `seo_os` as a connected SERP source without changing the layer model. Introduce focused DTOs under `ZarukuSeoData` for:

- available weeks and latest week;
- section position trend points;
- cluster position rows;
- weekly opportunity summaries and opportunity rows;
- weekly task summaries and task rows;
- weekly run health rows;
- weekly traffic-versus-visibility rows;
- SEO OS availability and error state.

Numeric database values are normalized to JavaScript numbers in the loader. URLs remain nullable strings. JSON pipeline stages are exposed only as parsed structured data if needed by the rhythm panel; malformed or absent JSON becomes an empty value and does not fail the dashboard.

## Query And Join Rules

Every SEO query filters `analytics_account_id` using the dashboard's normalized account IDs, with Zaruku falling back to `66624469`.

Positions:

- `serp_position IS NULL` and `status = 'no_data'` are never converted to zero.
- Null positions are excluded from averages and chart points.
- Coverage is `found rows / all tracked rows` for the same section and week.
- A negative `delta_prev` is an improvement and uses green/up styling.
- A positive `delta_prev` is a decline and uses red/down styling.

Sections:

- Section names come only from `seo_section_patterns`.
- Page traffic from `canonical_fact_site_analytics_daily`, with `analytics_scope = 'page'`, is assigned by matching `page_url` to `url_pattern`.
- When multiple patterns match, the most specific pattern wins; specificity is the pattern length. Equal-length matches use the lower numeric `priority`. The `/` pattern is the fallback.
- Existing URL-first-segment section derivation is removed from Zaruku content aggregation.
- Daily traffic is grouped into ISO weeks using Monday through Sunday boundaries before it is combined with SEO visibility.

## Missing Weeks And Empty States

The rhythm strip spans every ISO week between the earliest and latest returned SEO week. A missing `seo_weekly_runs` row is rendered as a red missing-week state.

Run rows with `status = 'failed'` are red. Completed and noop states remain distinct. SERP request usage is shown against the fixed weekly budget of 50.

Expected empty states:

- No tasks: `ждёт первого approve`.
- No previous week: comparison controls are disabled, while current-week panels remain usable.
- No matched SERP URL: no link is rendered.
- `no_data` cluster: grey `не найдено` status.
- No approved or rejected opportunities: approve rate is unavailable rather than zero.

## Failure Isolation

SEO OS loading is isolated from Metrika loading. If one or more SEO tables cannot be read, the existing on-site dashboard still renders. The SEO OS source reports an unavailable state and its panels show a compact retry-later message.

An empty successful query is not treated as a database failure. Individual nullable values do not invalidate an otherwise usable weekly dataset.

## UI Behavior

The week toolbar is shared by the `SEO`, `SEO Ops`, and SEO OS content panels. Selection state lives at the Zaruku dashboard component level so navigation does not reset it.

Charts and tables derive their selected and comparison slices from the normalized payload. Position charts use an inverted Y axis with position 1 at the top. Tables are designed for hundreds of clusters with bounded-height scrolling or pagination, stable column widths, and no layout shift.

Links for `matched_url`, `target_url`, and `notion_url` open safely in a new tab. `awaiting_medical_review` receives a prominent red status badge because it represents a compliance block.

## Testing And Verification

Unit-level tests cover pure transformations:

- ISO week ordering and previous-available-week selection;
- section-pattern precedence and root fallback;
- exclusion of null positions from averages;
- coverage calculation;
- negative position delta as improvement;
- opportunity approve-rate denominator;
- generation of missing rhythm weeks.

Loader tests or query-boundary tests validate account scoping and numeric/null normalization. Component behavior is verified for single-week, comparison, no-data cluster, empty tasks, failed run, and unavailable-source states.

Completion requires TypeScript checking, linting, production build, API payload inspection for dashboard 28, and browser verification of the Zaruku dashboard at desktop and mobile widths.

## Out Of Scope

- Writing decisions or tasks back to the database.
- Connecting GSC, Yandex Webmaster, or DataForSEO.
- Editing the SEO OS exporter or its schema.
- Inventing page sections outside `seo_section_patterns`.
- Applying the general Metrika date filter to weekly SEO OS panels.
