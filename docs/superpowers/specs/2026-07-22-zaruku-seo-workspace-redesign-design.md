# Zaruku SEO Workspace Redesign

## Goal

Rebuild the Zaruku `SEO` tab as a readable Russia-focused decision workspace that moves from executive status to query/page detail, compares Google and Yandex without inventing cross-source relationships, and preserves SEO OS as the authoritative writer and source for tracked Yandex positions.

## Scope

This design changes only the dashboard read model and presentation. It does not deploy, call external APIs during implementation, write to production tables, edit collectors, or change the SEO OS exporter.

The first implementation covers:

- explicit traffic-period versus SEO-week context;
- executive Google, Yandex, AI, and post-click summaries;
- one unified query workspace;
- one unified landing-page workspace;
- progressive disclosure for secondary diagnostics;
- removal of the Countries panel;
- responsive desktop and mobile behavior;
- documented mount points for a later SEO-specific AI Summary and contextual AI chat.

Actual AI generation and chat are separate follow-up work. The core redesign must not add a dead chat button or a generic advertising summary that ignores Zaruku SEO facts.

## Global Constraints

- Russia is the only intended geographic scope for the redesigned SEO workspace.
- Do not change database structure unless a source contract cannot satisfy the Russia-only requirement without it.
- Do not write to `seo_*` tables. SEO OS remains their only writer.
- Do not duplicate ordinary Yandex Search API collection in ReportingDash.
- Do not redefine SEO OS tracked positions, Yandex Webmaster average positions, and Google Search Console average positions as the same metric.
- Do not create fuzzy or semantic query joins. Cross-source presentation joins use a deterministic normalized exact phrase only.
- Do not manufacture query-to-page relationships that the source did not provide.
- Preserve source-specific selected/fallback week labels. Never present two different actual weeks as a direct same-period comparison.
- Preserve `null`/not-found positions as unavailable; never convert them to zero.
- No deployment, migration, cron change, secret change, API probe, or SEO OS schedule change belongs to this plan.

## Current Data Contract And Required Logic Changes

### Google Search Console

The canonical GSC facts already contain `country`. The dashboard read queries currently aggregate all countries. The redesigned SEO workspace requires a read-logic change: every GSC query used by Zaruku SEO must filter to canonical country code `rus` before aggregation.

This applies to:

- query facts;
- summary/device facts;
- landing pages;
- brand versus non-brand;
- search appearances;
- search/result types;
- the retained compatibility `country_summary` payload.

No GSC schema migration is required. The Countries UI panel is removed, but the existing DTO field can remain for compatibility.

### Yandex Metrika

The Reports API-backed SEO panels can request Russia-only rows through a report filter. This is a read-logic change, not a database change.

The existing canonical site analytics grain does not persist country on all traffic/page rows. Therefore this plan must not silently relabel canonical all-region totals as Russia-only. The redesigned SEO workspace uses Russia-filtered Reports API facts for its post-click SEO context. Converting every non-SEO tab and every canonical KPI to a provable Russia-only grain is separate work and may require a collector/read-model decision.

### Yandex Webmaster

The current canonical Webmaster query/page/summary facts do not carry a country or region dimension. They measure host-wide Webmaster demand. Without an upstream guarantee, the dashboard cannot truthfully label these rows as Russia-only.

For the redesigned comparison table:

- `Yandex tracked position` comes from SEO OS `seo_positions_weekly` and remains the authoritative controlled-position measurement;
- Webmaster demand metrics remain a separately labelled `Yandex Webmaster` group;
- Webmaster data is not labelled `RF` unless its upstream contract is verified;
- if strict Russia-only Webmaster demand is later required and the upstream API supports a region filter, collector/schema work receives a separate design and migration review;
- if the upstream API cannot provide that scope, Webmaster demand must remain host-wide or be omitted from Russia-only executive conclusions.

### SEO OS

SEO OS remains the only writer of:

- `seo_positions_weekly`;
- `seo_opportunities`;
- `seo_tasks`;
- `seo_weekly_runs`.

The redesign consumes existing `ZarukuSeoOsData` only. It uses exact normalized query text to enrich a display row with:

- tracked Yandex position;
- previous-week delta;
- found/not-found state;
- section;
- matched URL.

This is a presentation join. It does not persist a new relationship and does not alter SEO OS tables.

## Target Information Architecture

The SEO tab renders in this order:

1. `Контекст периода`
   - `Период поведения на сайте` for Metrika-backed facts;
   - `Отчётная SEO-неделя A` and optional `B` for weekly search facts;
   - source-specific fallback warnings next to the affected source, not as a global warning.
2. `Executive summary`
   - Google RF impressions, clicks, CTR, and average position;
   - Yandex Webmaster demand with its honest host-wide label;
   - SEO OS tracked Yandex position and coverage;
   - AI visibility presence, mentions, and citations;
   - Russia-filtered post-click organic visits where available.
3. `Что изменилось`
   - deterministic selected-week versus comparison-week facts;
   - source coverage and missing-week warnings;
   - no generated prose in the core implementation.
4. `Запросы: Google × Яндекс × SEO OS`
5. `Посадочные страницы: до клика × после клика`
6. `Семантика и разделы`
7. `Дополнительная диагностика`
   - devices;
   - brand/non-brand;
   - search appearances;
   - result types.
8. `После клика`
   - search-engine distribution;
   - Metrika-known search phrases and their explicit coverage limitation.

Countries is not rendered anywhere in the target SEO tab.

## Unified Query Workspace

The visible column groups are:

- `Фраза`;
- `Раздел`;
- `Google RF`: impressions, clicks, CTR, average position;
- `Яндекс Вебмастер`: impressions, clicks, CTR, average position;
- `SEO OS`: tracked position, delta, status;
- `Страница`: authoritative source URL when available.

Query keys are built by trimming, lowercasing with Russian locale, and collapsing internal whitespace. No stemming, transliteration, typo correction, embedding similarity, or AI matching is permitted.

Multiple GSC rows for one normalized query are aggregated for display:

- impressions and clicks are summed;
- CTR is derived from the summed values;
- average position is impression-weighted across non-null positions;
- pages remain a bounded list of source-provided GSC pages, not a fabricated single canonical landing page.

Sorting supports one active key at a time:

- Google position;
- Yandex Webmaster average position;
- SEO OS tracked position;
- impressions;
- clicks.

Position sorting explicitly labels directions `1 → 100` and `100 → 1`. Null positions always sort after real positions.

Quick filters:

- all;
- Top 3;
- Top 10;
- Top 20;
- improved;
- declined;
- not found.

The table header remains sticky inside its own scroll container. It must never increase the page-level horizontal width.

## Unified Landing-Page Workspace

Rows use deterministic normalized Zaruku URLs. The workspace presents separate groups:

- Google RF search facts;
- Yandex Webmaster host-wide facts;
- Metrika Russia-filtered post-click facts for the selected traffic period;
- SEO OS tracked-query count/coverage only when an authoritative `matched_url` exists.

The UI explicitly labels the Metrika traffic period separately from the weekly search period. It does not imply that impressions, clicks, and visits share an identical attribution window.

## Progressive Disclosure

Devices, brand/non-brand, search appearances, and result types live under one collapsed `Дополнительная диагностика` section. The current GSC Countries panel is removed.

The old standalone Yandex query, GSC query, Yandex page, GSC page, and SEO OS cluster tables are removed after the unified workspaces cover their facts. Existing source KPI calculations and fallback notes may be reused.

## AI Extension Points

### SEO AI Summary

Reserved position: after period context and before executive KPI cards.

It will eventually consume a Zaruku-specific payload containing selected weeks, Russia-scoped GSC/Metrika facts, SEO OS positions/opportunities, Webmaster scope metadata, and data-quality warnings. The existing advertising-oriented AI summary prompt must not be reused until it understands these facts.

### Contextual AI Chat

Reserved interaction: a bottom-right launcher that opens a side drawer. It will eventually receive the active tab, weeks, filters, sort, and selected query/page. It is not implemented by this core redesign.

## Responsive And Accessibility Requirements

- No page-level horizontal overflow at 1280×720 or 390×844.
- Wide tables scroll inside their own bordered container.
- Panel headers wrap without squeezing titles into narrow columns.
- Sort controls are real buttons with `aria-sort` or an equivalent accessible state.
- Keyboard users can reach table sorting, filters, diagnostic disclosure, and links.
- Source periods and scope are text, not color-only indicators.
- Russian is the primary UI language; source/product names may remain in their official form.

## Database And Data-Logic Decision

Core redesign decision:

- database migration: **not required**;
- SEO OS exporter change: **not required**;
- GSC read logic change: **required** for `country = rus` filtering;
- Metrika report logic change: **required** for Russia-only SEO report calls;
- presentation aggregation/join logic: **required**;
- Yandex Webmaster strict RF guarantee: **not currently provable from stored grain** and requires a separate upstream/data-contract decision if mandatory.

## Completion Criteria

- The SEO tab follows the target information order.
- Countries is absent.
- GSC SEO facts are filtered to Russia before aggregation.
- SEO OS tracked positions remain separate and authoritative.
- Google, Webmaster, and SEO OS position meanings are visible and unambiguous.
- Query and page workspaces support sorting without page overflow.
- Source week mismatches are visible and never hidden.
- Existing SEO Ops and SEO OS writer contracts are unchanged.
- Unit, component, type, lint, build, desktop, and mobile verification pass before any deployment decision.
