# Zaruku Dashboard Optimization Design

## Status

Approved direction with product-owner corrections on 2026-07-22. This document defines the target information architecture and the data-truth gates that must be satisfied before visual reorganization.

## Goal

Turn the Zaruku dashboard into a client-readable search and content workspace that moves from executive state to actionable detail without presenting stale periods, mislabeled metrics, unsupported conclusions, or unproven RF-only claims.

## Primary users

- Client or brand manager: understands visibility, traffic, content consumption, geographic demand, and current work without reading collector internals.
- Agency manager: explains what changed, where the opportunity is, and what work follows from it.
- SEO operator: uses the secondary operational area for approvals, tasks, and pipeline rhythm.

## Product priority

Data truth comes before information architecture and visual polish.

The implementation order is mandatory:

1. make periods explicit and current;
2. make every metric label match its source grain;
3. remove conclusions that are not derived from stored facts;
4. establish which datasets can truthfully be called RF-only;
5. only then reorganize tabs and presentation.

The navigation must not be rearranged while the default dashboard still presents March onsite data next to July search and AI data without explicit period separation.

## Current-state findings

### Period truth

- The dashboard-level onsite range currently comes from saved `period_from` and `period_to` when the URL has no explicit range.
- The observed default onsite period was `2026-03-03..2026-03-26` while SEO OS, GSC, Webmaster, and AI facts were from July 2026.
- SEO weeks and AI months are valid independent grains, but they must never look like they belong to the dashboard-level onsite range.
- The current-month fallback ends on the last calendar day of the month, including future days. It is not an appropriate freshness default for a live executive dashboard.

### Metric truth

- Canonical page-scope rows can contain pageviews and users without visits.
- `buildContentSections()` currently substitutes users when visits are absent and then exposes the result through a column called `Визиты`.
- Page-scope tables contain several columns that are empty for their actual source grain.
- Metric availability must be explicit; an absent metric must not be synthesized from a different metric.

### Unsupported conclusions

- The weekly AI focus contains a hard-coded claim that 67% of citations belong to one page.
- The AI visibility panel states that the portal is source number one in all cases, although the current aggregate model does not contain source rank or per-page concentration.
- Both claims must be removed. They may return only after the read model contains the facts required to calculate them.

### RF-only boundary

- GSC reads are explicitly filtered to `country = rus`.
- Live Yandex Metrika report cuts are explicitly filtered to Russia.
- Yandex Webmaster is treated operationally as Russian host data and has no country dimension in the current canonical contract.
- Canonical traffic, page, organic-trend, SEO traffic-visibility, and returning-content reads do not contain a country field that proves RF scope.

The UI must not claim that these canonical datasets are RF-only until the data contract proves it.

Strict RF-only canonical reporting is a separate authorization gate. The recommended durable direction is a generic country-aware canonical contract plus collector/backfill support, not a Zaruku-specific table. Before any migration or collector edit, implementation must stop and present the exact affected tables, columns, grains, writer changes, backfill window, and rollback plan for approval.

### Empty and error states

- Shared `BarList` and `DataTable` components render empty bodies without an explanation.
- This produces blank white panels in Devices, Audience, Behavior, and parts of Content when a live Metrika cut is unavailable.
- Local verification showed all 14 extended Metrika report cuts unavailable while canonical traffic remained readable. The dashboard must distinguish `no matching rows`, `source unavailable`, and `metric not collected`.

### Scale and links

- The unified SEO query workspace rendered 5,948 rows in one DOM tree.
- Query and page tables need search plus pagination or virtualization; a scroll container alone is insufficient.
- Relative Webmaster page URLs can resolve against the dashboard host. All Zaruku content links must be normalized to safe absolute `https://zaruku.ru/...` URLs.

## Target navigation

The client-facing navigation contains six tabs in this order:

1. `Обзор`
2. `SEO`
3. `Контент`
4. `Аудитория`
5. `Работы и задачи`
6. `Качество`

`SEO-операции` is renamed to `Работы и задачи` and moved after the client-facing visibility, traffic, content, and audience tabs. Its underlying SEO OS ownership and approve/task/run relationships remain unchanged.

The current `Поведение` tab is merged into `Контент`, because engagement, bounce risk, and return behavior describe content consumption.

The current `Гео`, `Устройства`, and demographic `Аудитория` tabs are combined into one client-facing `Аудитория` workspace. Geography remains a visually and semantically distinct first section because `city × /map/` is a product-demand signal for the nationwide oncology-center catalogue, not demographic decoration.

## Shared page hierarchy

Every client-facing tab follows the same reading order:

1. executive state or answer to the tab's primary question;
2. three to five decision metrics with explicit periods and sources;
3. one primary visualization or ranked comparison;
4. actionable rows, risks, or opportunities;
5. detailed tables and technical diagnostics through progressive disclosure.

Every panel must expose:

- source;
- actual period or source-specific week/month;
- metric grain when it can be confused with another grain;
- populated, empty, unavailable, or partial state;
- fallback disclosure when data from another period or grain is used.

## Period model

The dashboard has three independent time contexts:

- `Onsite period`: calendar range used by Metrika traffic and content behavior.
- `Search period`: source-specific ISO week for GSC, Webmaster, and SEO OS.
- `AI period`: monthly snapshot period.

The default onsite range should be the latest 28 complete days ending yesterday. Explicit URL ranges and user-selected custom ranges continue to override the default.

The dashboard header shows the onsite period. Tabs that mix grains must show a compact period-context block listing all active periods. A panel may only display a source week/month that actually has rows. No panel silently falls back to another week.

## Tab designs

### 1. Обзор

Primary question: `Что происходит с поисковой видимостью и целевым трафиком сейчас?`

Order:

1. period context: onsite, search, and AI;
2. executive summary with current state, change direction when a comparable period exists, and data-confidence status;
3. search visibility: Google RF, Yandex Webmaster, tracked SEO OS coverage, and AI presence;
4. traffic health: visits, users, organic share, bounce rate, and average duration for the onsite period;
5. acquisition-channel ranking and organic trend;
6. top content or geographic signal requiring attention;
7. source-status details only through a link or disclosure to `Качество`.

The `Россия` share card is removed because RF is the product scope, not an executive comparison metric. It may return only as a data-quality assertion that verifies scope.

### 2. SEO

The approved executive-to-detail structure remains:

1. executive search state;
2. unified query workspace;
3. unified landing-page workspace;
4. semantic health;
5. tracked position trend;
6. AI visibility;
7. expandable diagnostics;
8. post-click Metrika cuts.

Required residual improvements:

- add query search;
- add page search;
- paginate or virtualize large result sets;
- cap the initial detail view without losing access to the full dataset;
- normalize all content links to the Zaruku host;
- keep Google average position, Webmaster average position, and SEO OS tracked position separate;
- retain explicit period mismatch warnings.

### 3. Контент

Primary question: `Какой контент создаёт спрос, удерживает аудиторию или требует внимания?`

This tab absorbs the current Behavior tab.

Order:

1. content executive summary: leading section, leading page, strongest retention signal, and largest verified risk;
2. section workspace combining pageviews/users with search visibility and tracked coverage;
3. top pages ranked by a user-selectable native metric;
4. strongest retention pages;
5. high-bounce entry pages;
6. returning content with 1-day, 2–7-day, and 8–31-day buckets;
7. detailed page table with search, sorting, pagination, and only available metrics.

Page-scope canonical data is labeled `Просмотры` and `Пользователи`. `Визиты`, bounce rate, duration, and depth appear only when a visit-scope source actually provides them. Users are never presented as visits.

The section visualization uses ranked bars for traffic and independent position markers. It must not connect unrelated categorical sections with a trend line.

### 4. Аудитория

Primary question: `Где находится продуктовый спрос и как аудитория потребляет портал?`

Order:

1. `География спроса каталога`: explicit `город × /map/` executive section;
2. Russia demand map with top-city ranking and share of `/map/` visits;
3. device summary: mobile, desktop, tablet, and other supported device groups;
4. source × device comparison as a compact matrix rather than a full behavior-metric table;
5. browser and OS detail through progressive disclosure;
6. demographic estimates: age and gender;
7. interests with an explicit Yandex coverage limitation.

No Countries panel is shown. Geography is limited to Russian city demand, with unresolved or non-Russian names excluded rather than assigned invented coordinates.

If `city × /map/` is unavailable, the first section remains visible with an actionable explanation of whether the live cut failed, the selected period has no visits, or city coordinates could not be resolved.

### 5. Работы и задачи

Primary question: `Что команда делает с найденными возможностями?`

This is a secondary operator workspace backed by the existing SEO OS read model.

Order:

1. factual focus of the selected week;
2. immediate actions requiring a decision or medical review;
3. opportunity funnel;
4. task statuses and links;
5. pipeline rhythm and technical run metrics.

Requirements:

- sort priority as high, medium, low;
- show pending/approved work before rejected or carried-over history;
- replace raw `opportunity_type: cluster_id` titles with manager-readable labels while preserving the identifiers in details;
- derive every focus sentence from current rows;
- do not expose unsupported AI concentration claims;
- keep Notion links safe and external;
- keep approve, task, and run ownership in SEO OS unchanged.

### 6. Качество

Primary question: `Можно ли доверять сегодняшним данным и какие разделы затронуты проблемами?`

Order:

1. overall trust state: healthy, partial, or critical;
2. user-facing list of affected tabs and missing cuts;
3. source freshness summary;
4. data-quality checks;
5. expandable technical collector diagnostics.

Requirements:

- separate source connection, data availability, and latest collector health;
- do not mark a zero-row success as sufficient proof that all dependent panels are current;
- summarize raw API/collector errors and keep full payloads collapsed;
- use consistent Russian client-facing labels while retaining `cron`, `collector`, and `rows` in the technical detail;
- link each unavailable Metrika cut to the affected tab or panel;
- never expose tokens, credentials, or unbounded raw error payloads.

## AI extension points

AI is added after the data-truth and information-architecture work, not before it.

- `AI Summary`: placed after the period context and executive metrics on Overview, SEO, Content, and Audience. It receives only the tab's normalized read model and explicit periods.
- `AI Chat`: contextual to the active tab, active filters, selected weeks, and visible rows. It must cite which source and period support each answer.
- `Работы и задачи`: AI may explain or summarize existing SEO OS work but must not write approvals, tasks, or database records without a separate authorization flow.

No placeholder AI panel, endpoint, database table, or collector is part of this redesign.

## Error, empty-state, and fallback rules

1. No visible panel renders an empty body without explanation.
2. `Нет данных` means a successful source query returned no matching rows.
3. `Источник недоступен` means the query or upstream source failed.
4. `Метрика не собирается` means the source grain does not contain that metric.
5. A fallback period is shown only when the panel explicitly names both requested and displayed periods.
6. A fallback metric is never created by renaming another metric.
7. Connected historical data and a failed latest collector may coexist; Quality must explain both states.

## Responsive and performance rules

- No tab creates page-level horizontal overflow at 390 px.
- Wide tables scroll inside their own bounded sections.
- Mobile navigation contains six tabs and keeps the active tab visible.
- Long tables use pagination or virtualization and never mount thousands of rows at once.
- Charts use readable category labels, avoid false connected trends across categories, and preserve accessible text/table alternatives.
- Switching tabs should reset or preserve scroll intentionally; it must not leave the user midway through the next tab.

## Data and implementation boundaries

Allowed without a separate data-contract approval:

- client-side information architecture;
- metric labels based on existing facts;
- removal of unsupported copy;
- period disclosure;
- empty/error states;
- sorting, search, pagination, URL normalization, and responsive behavior;
- pure read-model helpers that do not change source meaning.

Requires explicit approval before implementation:

- database migrations;
- new tables or columns;
- changes to canonical grain or idempotency keys;
- collector changes or new collectors;
- RF backfills;
- cron changes;
- external API contract changes;
- writes from ReportingDash into SEO OS or other source-owned tables.

## Approved source-of-truth contract after the SEO OS audit

The owner approved the read-only implementation path on 2026-07-22. The audit did not authorize any schema, collector, backfill, cron, deployment, or write-path change.

The dashboard uses these stable contracts:

- GSC query and page facts come from `canonical_fact_gsc_queries_daily` with `country = 'rus'`; the verified available search weeks are `2026-W27..2026-W29`.
- Yandex impressions, clicks, CTR, and average position come from the canonical Webmaster facts and remain explicitly unsegmented because the tables have no country dimension.
- Tracked Yandex positions, opportunities, tasks, and run rhythm come from SEO OS. Historical `seo_weekly_runs` counters before TASK-071 are valid stored zeros but do not prove complete historical telemetry.
- AI headline facts come from the single current `seo_ai_visibility` manual baseline row for `alisa_ai`, period `2026-07`, provenance `wm_alisa_manual`: 89 mentions, 155 citations, and stored presence rate `0.44`. The UI identifies this as a manual baseline and does not infer source rank or page concentration.
- `seo_sov_weekly` row `2026-W29` represents a 28-day snapshot for `2026-06-13..2026-07-10`; the UI labels the actual window and never calls it a one-week measurement.
- Onsite traffic channels and organic traffic come from canonical Metrika and are unsegmented. For the selected onsite window `2026-06-24..2026-07-21`, the verified source coverage ends on `2026-07-19`.
- Canonical page facts provide users and pageviews but not visits. Page users are not site-unique users, and the 40,757 channel-scope versus 40,796 page-scope pageview totals are different grains rather than a reconciliation error.
- Returning content comes from `canonical_fact_metrika_returning_pages_daily`, remains unsegmented, and has verified coverage through `2026-07-20`.
- Section traffic may use pageviews plus `seo_section_patterns`; it does not show visits or claim RF scope while page visits are absent.
- Search Appearance has no rows and is shown as empty or omitted, never as a connected populated panel.
- `city × /map/`, devices, source × device, browsers, operating systems, age, gender, and interests have no stable stored contract. Production cannot rely on the live Reports API path because the production process has no Metrika token and the read-only smoke returned HTTP 400. These panels remain explicitly unavailable; there is no live fallback.

The approved implementation does not copy or synchronize numbers between owners. It synchronizes definitions: source, period, grain, geography, formula, and availability. A future generic country-aware canonical Metrika dimension fact remains a separate approval gate. Entry-page visits must not be written into the existing pageview-grain rows merely to populate a `visits` column.

## Implementation sequence

1. Data-truth pass: period policy, metric grain, unsupported conclusions, relative URLs, and current empty/error semantics.
2. RF source-map decision: document the exact canonical gaps and request approval for any schema/collector/backfill work.
3. Shared UI foundation: period context, panel state, metric availability, table controls, and safe links.
4. Overview redesign.
5. SEO residual scale and link fixes.
6. Content plus Behavior consolidation.
7. Audience workspace with explicit `city × /map/` geography.
8. Rename and redesign `Работы и задачи`.
9. Quality trust surface.
10. Full desktop/mobile, accessibility, performance, and source-contract verification.

## Verification strategy

- Unit tests for period selection, native metric availability, priority ordering, safe Zaruku URLs, pagination, and tab grouping.
- Read-model tests proving users are never converted into visits.
- Tests proving unsupported AI copy is absent unless supporting fields exist.
- Tests proving every empty data component renders a reason.
- SQL/query-contract tests proving no RF label is attached to unsegmented canonical rows.
- Browser verification for all six tabs at desktop and 390 px mobile widths.
- Browser checks for no page-level overflow, bounded table overflow, tab switching, pagination, and preserved source-period labels.
- Full `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` before integration.

## Acceptance criteria

1. The default onsite period is current and never includes future dates.
2. Search weeks and AI months are visually separate from the onsite period.
3. No users value is labeled or aggregated as visits.
4. No unsupported `67%` or `источник №1` statement is rendered.
5. RF-only wording appears only for datasets with a provable RF filter or country-aware canonical grain.
6. The navigation order is `Обзор`, `SEO`, `Контент`, `Аудитория`, `Работы и задачи`, `Качество`.
7. `city × /map/` remains a named, primary product-demand section inside Audience.
8. Content contains engagement, bounce-risk, and returning-content analysis.
9. Every panel has a populated, empty, partial, or unavailable state.
10. No table mounts thousands of rows at once.
11. All Zaruku content links resolve safely to `https://zaruku.ru`.
12. Quality explains which tabs are affected without exposing unbounded raw errors.
13. No database, collector, backfill, cron, or SEO OS write occurs without explicit approval.

## Out of scope

- deploying the redesign;
- changing Abbott or other dashboard types;
- writing approvals or tasks back to SEO OS;
- adding an AI provider, AI endpoint, or persistent chat history;
- inventing missing positions, visits, demographic facts, geographic coordinates, or source rankings.
