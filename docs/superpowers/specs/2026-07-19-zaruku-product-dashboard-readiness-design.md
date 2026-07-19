# Zaruku Product Dashboard Readiness Design

## Goal

Bring the Zaruku SEO / GEO dashboard to a product-ready state for two primary users:

- agency account manager: quickly explain what is happening, what changed, what work is running, and whether data is fresh;
- brand / marketing manager: understand Google/Yandex visibility, content demand, geographic demand, audience, behavior, and AI-search visibility without reading collector internals.

The dashboard should remain technical enough for operators: source freshness must keep the words `cron`, `collector`, and `rows`, because those are useful for debugging and handoff.

## Product principles

1. Every tab answers a clear user question.
2. Every table has data or an explicit explanation of why data is absent.
3. Every metric label matches the real source grain. Page-level Metrika facts must not be labeled as visits if the collector only provides pageviews/users.
4. Source status and source freshness are separate:
   - source status answers “is this source connected and usable in the dashboard?”;
   - freshness answers “did the latest cron collector successfully import rows?”
5. The dashboard can show a connected source with a failed latest collector if historical/current rows still exist. That is not a contradiction; the Quality tab must make it clear.
6. GSC and Yandex Webmaster are SERP sources. SEO OS is workflow/tracked-position intelligence. Metrika is on-site behavior after the click. AI visibility is its own AI-search visibility layer.

## Current source contracts

### Yandex Metrika

- Active Zaruku counter: `66624469`.
- On hold / inactive counters: `29137835`, `105559308`, `99078698`.
- Main canonical table for dashboard facts: `canonical_fact_site_analytics_daily`.
- Page-scope rows have `pageviews` and `users`; `visits` can be null.
- Product implication: content/page tables should prefer `pageviews` or `users` unless they are using visit-scope facts.

### Google Search Console

- Root collector: `fetch_gsc_canonical.py`.
- Canonical fact table: `canonical_fact_gsc_queries_daily`.
- Grain: `analytics_account_id`, `report_date`, `query`, `page`, `country`, `device`.
- Metrics: `impressions`, `clicks`, `ctr`, `position`.
- Dashboard behavior: aggregate daily facts into ISO weeks on read. Mark partial weeks as partial, for example `частично, по DD.MM`.
- Fresh-day zero rows are normal because GSC has a 2–3 day data lag.

### Yandex Webmaster

- Root collector: `fetch_yandex_webmaster_canonical.py`.
- Canonical fact tables:
  - `canonical_fact_webmaster_queries_daily`
  - `canonical_fact_webmaster_summary_daily`
  - `canonical_fact_webmaster_pages_daily`
- Dashboard behavior: aggregate daily facts into ISO weeks on read. Do not fall back silently from an explicitly selected empty week, except where the panel copy states the fallback.
- Current operational issue: the latest cron can fail with a `400 Bad Request` on `query-analytics/list` while earlier rows are still available. The dashboard must show data and also show the failed collector in Quality.

### SEO OS

- Owns tracked positions, section patterns, clusters, opportunities, tasks, and run telemetry.
- Dashboard should show the behind-the-scenes work pipeline at a manager-friendly level: current opportunities, tasks, runs, rhythm, and impact signals, without exposing unnecessary internal prompt/task detail.

### AI-search visibility

- Current visible AI data comes from `seo_intelligence.ai`, backed by `seo_ai_visibility`.
- Legacy `ai_visibility.rows` may be empty and should not be treated as the active product source.

## Target tab responsibilities

### Overview

Question: “Is the SEO/GEO system working and what is the headline state?”

Must show:

- North-star strip: noise, medical intent, AI visibility, and baseline date;
- traffic health from Metrika;
- acquisition channels;
- organic trend;
- connected sources;
- pending requirements only when there are actual pending requirements.

### SEO

Question: “How visible are we in search and where is demand coming from?”

Must show:

- search engines from Metrika;
- Yandex Webmaster host/query/page facts;
- GSC summary and query facts;
- SEO OS semantic health;
- AI visibility summary;
- organic landing pages and Metrika search phrases.

Near-term additions:

- GSC landing pages aggregated from existing GSC rows;
- GSC branded vs non-branded split;
- GSC country/device summary if not already exposed cleanly.

### SEO Operations

Question: “What work is running behind the scenes?”

Must show:

- opportunities;
- tasks;
- runs;
- status and rhythm, not low-level automation internals.

### Content

Question: “Which site sections and pages are getting demand and visibility?”

Must show:

- traffic visibility by SEO sections;
- section summary;
- top pages.

Metric labels must match source grain. If rows come from page-scope Metrika, label them as pageviews/users rather than visits.

### Geo

Question: “Where is geographic demand coming from?”

Must show:

- countries;
- cities;
- map demand.

### Devices

Question: “How does traffic differ by device/browser/OS?”

Must show:

- device types;
- source × device;
- browsers;
- operating systems.

### Audience

Question: “Who is the audience?”

Must show:

- age;
- gender;
- interests.

### Behavior

Question: “Which pages retain users or create risk?”

Must show:

- best engagement;
- high bounce;
- traffic channels;
- returning content if available.

If returning content has no rows because the legacy source is stale, the table must say that clearly.

### Quality

Question: “Can we trust today’s dashboard data?”

Must show:

- source freshness per source/cron/collector;
- last successful cron time;
- imported window;
- rows read/written;
- latest active error only when it is newer than the latest success;
- data quality checks;
- pending requirements.

## Error and empty-state rules

1. Do not show an empty table body without explanation.
2. Do not show stale historical collector errors on a healthy row.
3. Do not mark a source as “not connected” if rows exist and the read model is available.
4. If a collector failed but rows exist, show:
   - source connected in sidebar;
   - source data panels populated;
   - Quality row marked failed with last successful import and current error.
5. If source lag is expected, use wording like “partial” rather than “missing”.

## Implementation boundaries

This readiness pass may modify:

- Zaruku dashboard React components;
- Zaruku read models;
- Zaruku type definitions;
- Zaruku tests;
- documentation/spec/plan files.

This readiness pass should not:

- rewrite Abbott dashboard behavior;
- change non-Zaruku collectors except where needed to document or display freshness;
- delete legacy tables;
- add new external credentials;
- expose secrets in UI, logs, tests, or docs.

## Acceptance criteria

1. Production dashboard loads at `https://dashboards.adreports.ru/dashboard/zaruku`.
2. Every visible tab has populated panels or explicit empty-state explanations.
3. Sidebar sources show connected when their read models are available.
4. Quality tab distinguishes connected data from failed latest cron.
5. GSC panels are populated from `canonical_fact_gsc_queries_daily`.
6. The first GSC enrichment pass adds product-useful aggregations without new API calls.
7. Targeted tests and `npm run build` pass before deploy.
8. After deploy, public and local health checks pass.
