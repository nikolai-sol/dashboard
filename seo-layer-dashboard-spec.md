# SEO OS Layer — Dashboard Integration Spec (v1)

Audience: agent building panels in ReportingDash (dashboard-next / Python viz).
Scope: client `zaruku.ru`, `analytics_account_id = 66624469`.

## 1. What this layer is

Weekly SEO pipeline (SEO OS) exports its results into 5 MySQL tables in the
ReportingDash database. The exporter is the ONLY writer; tables are a
disposable read model (can be dropped and rebuilt via backfill).

- Write cadence: weekly (Mondays), after the autonomous SEO run; idempotent
  upserts — re-export never duplicates rows.
- Grain: ISO week, column `week_key` CHAR(8), e.g. `2026-W28` (Mon–Sun).
- Dashboard rule: READ ONLY. Never write to `seo_*` tables.
- Current data: W28 only (first week). New week arrives every Monday.

## 2. Tables

### seo_section_patterns (12 rows) — section dictionary
Maps URL patterns to semantic sections (the same section definitions SEO OS
uses internally). `priority`: 1 = highest business priority.
USE THIS to aggregate `canonical_fact_site_analytics_daily` (scope='page')
into sections, so traffic and SEO panels share one section definition.

### seo_positions_weekly (13 rows for W28) — SERP positions per tracked cluster
- `cluster_id` + human-readable `query` (representative query of the cluster)
- `serp_position` DECIMAL, NULL when not found; `status`: 'found' | 'no_data'
- `matched_url` — page found in Yandex SERP (NULL when no_data)
- `delta_prev` — position change vs previous run, smoothed:
  convention `current − previous`, NEGATIVE = improvement (position number
  went down = better). NULL when either side missing.

### seo_opportunities (5 rows for W28) — proposals + human decisions
- `opportunity_type`: currently `section_ranking_gap` (more types later:
  ranking, ctr, content_refresh)
- `target_url` NULL = "new content candidate" (no existing page bound)
- `decision`: 'pending' | 'approved' | 'rejected' | 'carried_over'
  - carried_over = shown before, still undecided
- `reject_reason` — free text, valuable signal, show it
- `confidence` 0–100, `priority` high/medium/low

### seo_tasks (0 rows — expected) — draft tasks from approved decisions
Producer goes live with the next pipeline stage (TASK-053). Build the panel
now, expect data within days.
- `status`: 'draft' | 'awaiting_medical_review' | 'in_progress' | 'done' | 'cancelled'
  - awaiting_medical_review = blocked until a human medical reviewer signs off
    (oncology portal compliance) — highlight this status visually
- `notion_url` — link to the task page, make it clickable

### seo_weekly_runs (1 row) — pipeline telemetry
- `status`: 'completed' | 'failed' | 'noop'
- `serp_requests` (budget: 50/week), `llm_tokens` (may be 0 — enrichment is
  optional), `digest_count` (items sent to the operator), `stages_json`

## 3. Panels to build (v1)

P1. **Positions by section, weekly trend** (line chart)
    AVG(serp_position) per section per week_key + coverage
    (SUM(status='found') / COUNT(*)). Y axis INVERTED (1 on top, lower = better).
    NULL positions are excluded from AVG, never plotted as 0.

P2. **Cluster table (latest week)**: section, query, serp_position, delta_prev
    (color: negative = green), matched_url (link), status.

P3. **Opportunity funnel per week**: counts by decision + list of
    reject_reasons. KPI tile: approve rate = approved / (approved + rejected).

P4. **Tasks board**: counts by status; table with notion_url links;
    red badge on awaiting_medical_review. Empty state: "ждёт первого approve".

P5. **Rhythm health strip**: per week — status, serp_requests/50,
    llm_tokens, digest_count. Red row if status='failed' or week missing.

P6. **Section: traffic vs visibility** (combo): visits from
    canonical_fact_site_analytics_daily joined via seo_section_patterns
    (page_url LIKE CONCAT('%', url_pattern, '%')) + avg position overlay.
    Note: canonical traffic for counter 66624469 must be enabled in the
    ReportingDash collector first.

## 4. Join & date rules

- Sections: ONLY via seo_section_patterns. Do not re-derive sections from URLs.
- week_key ↔ dates: ISO-8601 week, Monday–Sunday. For joining daily traffic,
  aggregate report_date into ISO weeks (Python: date.isocalendar()).
- Always filter analytics_account_id = 66624469 (more clients later — design
  panels as account-scoped).

## 5. Semantics you must not get wrong

1. `status='no_data'` ≠ position 0. It means "site not visible in checked SERP
   window" — show as gap/grey, and it is exactly what an opportunity of type
   section_ranking_gap is about.
2. delta_prev: negative = improvement. Label accordingly ("↑ выросли" for
   negative delta).
3. 13 clusters / 5 opportunities is week one of a growing system — expect
   17+ clusters from W29, design for hundreds.
4. Reference queries A/B/C live as comments in `010_seo_os_v1.sql`.
