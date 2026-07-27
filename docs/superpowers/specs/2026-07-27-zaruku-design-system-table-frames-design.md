# Zaruku Design System and Table Frames

**Date:** 2026-07-27

**Status:** Approved direction; implementation not started

**Scope:** `dashboard-next`, Zaruku dashboard only except for shared visual tokens

**Reference:** ReportingDash Source of Truth, RD-01

## Objective

Give the Zaruku dashboard one predictable visual and responsive system, using the stable geometry of the Gidrofuril dashboard as the reference while preserving Zaruku's specialized SEO, content, audience, and operations behavior.

The result must keep cards and tables within the viewport, make comparable panels use consistent dimensions, and keep wide or long tables scrollable inside their own cards rather than expanding the page.

## Evidence and problem statement

The production and source audit found that Gidrofuril is visually stable because it reuses a small set of shared card and table patterns. At 1440 px, its main cards share one width, its KPI cards share a 180 px height, and its wide tables keep their minimum widths inside `overflow-x-auto` containers. At 1024 px and 430 px, its document width remains equal to the viewport width.

Zaruku is assembled from many locally styled panels and table implementations:

- 26 separate white bordered panel patterns occur across Zaruku components.
- Zaruku tables are implemented in nine component files.
- Table minimum widths vary from 560 px to 1320 px without named size tiers.
- The SEO tab expands the production document to 1614 px at both 1440 px and 1024 px viewports.
- `ZarukuSeoQueryComparison` puts `min-w-[1180px]` on the scroll container.
- `ZarukuSeoPageComparison` puts `min-w-[1320px]` on the scroll container.
- The Content tab can exceed 7000 px in document height because a 50-row table has no bounded vertical viewport.
- Panel radius, padding, header layout, shadows, empty states, and chart colors are defined locally and inconsistently.

The primary defect is structural: the page is sometimes made as wide or tall as the table. The table frame must own overflow instead.

## Design principles

1. **Gidrofuril geometry, Zaruku behavior.** Reuse Gidrofuril's containment, spacing, and sizing logic without forcing Zaruku data into generic Gidrofuril table components.
2. **One owner for overflow.** Every wide or long dataset scrolls inside its table frame. The document never becomes wider because of table content.
3. **Named size modes.** Components choose a semantic table mode rather than inventing pixel widths and heights locally.
4. **Domain tables remain domain tables.** Grouped source headers, week comparisons, sorting, filtering, pagination, links, and source-specific columns stay in their existing components.
5. **Tokens before literals.** Shared colors, spacing, radii, and chart colors come from CSS variables and one chart palette module.
6. **Progressive adaptation.** Desktop layouts use available space; narrow layouts keep the page fluid and use internal table scrolling. A full mobile table redesign is not part of this work.

## Architecture

### Visual tokens

`src/app/globals.css` remains the single theme owner. No `theme.ts` and no generic React `Card` component will be introduced.

The existing `.card-surface` class will be aligned to these tokens:

| Token | Initial value | Purpose |
|---|---:|---|
| `--accent-seo` | `#2F7F6F` | Zaruku primary accent and main chart series |
| `--accent-pos` | `#7C5CFF` | Position series |
| `--ink` | `#1B2637` | Primary text |
| `--muted` | `#6B7A8C` | Secondary text and labels |
| `--surface` | `#FFFFFF` | Card surface |
| `--surface-alt` | `#F7F9FA` | Quiet surface and table header |
| `--radius` | `12px` | Card and table-frame radius |
| `--card-pad` | `20px` | Standard card body padding, matching Gidrofuril |
| `--gap-card` | `16px` | Grid gap inside a dashboard section |
| `--gap-section` | `24px` | Gap between dashboard sections |

The chosen 20 px card padding and 16 px card gap match the measured Gidrofuril foundation. Zaruku-specific layouts may use 24 px only for page-level gutters, not as an alternative card padding.

A single `src/lib/chart-palette.ts` module will expose the semantic palette used by Recharts, Nivo, and Visx. It will centralize chart color values without unifying the chart libraries.

### Panel contract

Zaruku panels will use `.card-surface` and one internal structure:

```text
section.card-surface
├── header (title, description, controls, source badge)
└── body
    ├── panel state, when applicable
    └── content or table frame
```

The contract defines:

- 12 px radius from the shared token;
- one border and shadow treatment;
- 20 px body padding;
- a predictable header border and padding;
- consistent title, explanation, source badge, and control placement;
- `min-width: 0` on every grid and flex child that may contain a table;
- no panel-level minimum width that can expand the document.

Existing domain components may keep their names and logic. The implementation should consolidate their repeated class strings around this contract without performing unrelated refactors.

### Future layout-editor readiness

The current implementation will prepare panels for a future admin-only visual layout editor without adding drag-and-drop controls or layout persistence in this phase.

Every movable dashboard panel receives a permanent semantic identifier, for example:

```text
overview.traffic_health
overview.channels
overview.organic_search
seo.query_comparison
seo.page_comparison
content.all_pages
```

Panel metadata is defined separately from its rendered data:

```text
panel_id
tab_id
default_order
default_size
allowed_sizes
movable
visible
```

The initial metadata remains code-owned and deterministic. No database column, API mutation, or per-user preference is introduced now.

Desktop layouts use a 12-column grid and named panel sizes:

| Panel size | Grid span | Intended use |
|---|---:|---|
| `compact` | 3 | KPI or short status |
| `half` | 6 | Standard chart or table |
| `wide` | 8 | Primary analytical panel |
| `full` | 12 | Comparison table or operational workspace |

Panel height uses content modes rather than free pixel sizing:

| Height mode | Intended use |
|---|---|
| `compact` | KPI and short summary |
| `standard` | Normal chart or table |
| `tall` | Long operational table |
| `auto` | Small dynamic content |

The grid wrapper resolves `default_order` and size metadata into layout classes. Panels must not rely on arbitrary absolute positioning or pixel coordinates. At narrow breakpoints, panels stack according to `default_order`; desktop spans do not create horizontal overflow.

This boundary allows a later editor to add drag handles, snapping, save/cancel/reset, and dashboard-level layout persistence without moving table logic or rewriting panel components.

### Table-frame contract

Introduce one lightweight `ZarukuTableFrame` shell. It does not render columns, rows, sorting, filtering, or pagination. It only owns containment and sizing.

The component accepts a named mode:

| Mode | Intended use | Horizontal behavior | Vertical behavior |
|---|---|---|---|
| `compact` | Up to five columns and short data | Fluid table; internal scroll only when required | Natural height |
| `standard` | Six to eight columns | Internal horizontal scroll | Natural height up to the row limit |
| `operational` | Many rows, moderate column count | Internal horizontal scroll | Bounded 360–480 px viewport with sticky header |
| `comparison` | Nine or more columns or grouped source headers | Explicit table canvas inside `max-width: 100%` frame | Maximum 672 px viewport with sticky header |

Table canvas widths are properties of the table, never the frame. The comparison tables may retain 1180 px and 1320 px canvases, but the frame itself must remain `width: 100%; max-width: 100%; min-width: 0; overflow: auto`.

Shared table rules:

- compact row height: 44 px;
- rich-content row height: 52 px minimum;
- numeric cells use tabular numbers and right alignment;
- one header typography style;
- one divider color;
- sticky headers for bounded frames;
- sticky first column for comparison tables when it does not obscure grouped headers;
- visible focus states for sortable headers, links, and pagination controls;
- no nested horizontal scroll containers.

### Table assignments

| Area | Mode |
|---|---|
| SEO unified query comparison | `comparison`, 1180 px canvas |
| SEO unified landing-page comparison | `comparison`, 1320 px canvas |
| SEO section analytics and visibility | `standard` |
| Content popular/best/risk tables | `standard` |
| Content returning table | `standard` |
| Content all-pages table | `operational` |
| Audience device table | `compact` or `standard` based on visible columns |
| Opportunities and tasks | `operational` |
| Pipeline rhythm | `standard` with bounded height when rows exceed the compact limit |
| Source diagnostics | `standard` inside the existing expandable section |

Pagination remains owned by the domain component. The table frame must not reset page, sort, filter, search, or week state.

## Responsive layout

### Page containment

Every layout boundary containing a table must use `minmax(0, 1fr)` for grid columns and `min-width: 0` for grid/flex children. The Zaruku root and tab content must use `max-width: 100%` and must not inherit a table's intrinsic width.

Acceptance viewports are 430, 768, 1024, 1279, 1280, and 1440 px.

At every acceptance viewport:

```text
document.scrollWidth == viewport width
```

Horizontal scrolling is allowed only inside the navigation strip or a table frame.

### Navigation

- At 1280 px and above, keep the 240 px sidebar and a fluid `minmax(0, 1fr)` content column.
- From 768 px through 1279 px, keep the sidebar only while it leaves a usable content column; it must not force table width onto the page.
- Below 768 px, keep the horizontal tab strip and hide the sidebar.

### Overview

At 1280 px and above, Overview uses the fixed RD-01 grid:

- row 1: objective and three KPIs;
- row 2: traffic-health strip;
- row 3: acquisition channels and organic search;
- maximum six acquisition rows, with the remainder available through the existing `ещё` interaction;
- technical-tail content moves to the information tooltip;
- the Overview content area fits a 1440 × 900 viewport without vertical scrolling or period-dependent height changes.

Below 1280 px, Overview returns to natural vertical flow.

## Time controls

The visual-system work must preserve the RD-01 rule that each tab has one time owner:

| Tab | Time owner |
|---|---|
| Overview | URL date range |
| Audience | URL date range |
| SEO | Week A / A+B |
| Content | Week A / A+B |
| Work and tasks | Week A / A+B |
| Quality | No time selector |

The global date picker must be hidden or disabled with a plain-language explanation when a weekly tab is active. The weekly toolbar must not render on URL-period tabs. Tables combining source periods keep the source period in grouped headers and expose a plain-language explanation of differences.

## Panel states and error presentation

The existing dataset metadata contract remains authoritative. Visual treatment changes as follows:

- `ready`: render content normally;
- `partial`: quiet 13 px footer note, not a banner;
- `empty`: unframed gray text, “Нет данных за период”;
- `unavailable`: hidden from client presentation when there is no user action;
- `hidden`: new state; render nothing;
- amber: reserved for warnings with a concrete user action.

If every panel in a section is `hidden` or `empty`, the section renders one quiet section-level message. If all Audience datasets are unavailable, the Audience tab is removed until data becomes available.

Technical failures remain visible in Quality and existing operational alerts; they are not silently discarded from monitoring.

## Data flow and state preservation

This work changes presentation boundaries, not the underlying data model:

1. The dashboard loader continues to return Zaruku data and `dataset_meta`.
2. `ZarukuSeoDashboard` continues to own active-tab and week-selection state.
3. Domain table components continue to own sort, filter, search, and pagination state.
4. The code-owned panel registry provides stable identity, order, allowed sizes, and visibility metadata.
5. The grid wrapper resolves panel metadata into responsive placement without owning panel data.
6. `ZarukuTableFrame` receives only display mode and accessibility metadata.
7. CSS tokens and the chart palette provide presentation values.

Changing tabs, dates, weeks, or table state must not cause the page width to jump. Table frames must keep a stable width even when row counts or empty states change.

## Implementation sequence

1. Add tokens and chart palette; align `.card-surface` while visually checking Gidrofuril and Abbott.
2. Add the table-frame shell and tests for its four modes.
3. Fix page containment and migrate the two SEO comparison tables first, because they currently cause document-level overflow.
4. Migrate remaining Zaruku tables by mode without changing their data logic.
5. Add stable panel IDs, the code-owned panel registry, named size presets, and grid-ready panel wrappers.
6. Consolidate Zaruku panel header/body styling around `.card-surface`.
7. Apply RD-01 panel-state presentation and section collapsing.
8. Apply tab-specific time-control ownership.
9. Apply the desktop-only Overview grid through the shared grid metadata.
10. Run responsive, interaction, visual, and regression verification.

## Verification strategy

### Automated checks

- Unit tests for table-frame mode classes and accessibility attributes.
- Existing table sorting, filtering, pagination, URL-link, week-selection, dataset-state, and dashboard tests remain green.
- Source tests ensure no `min-w-*` class is placed on a table frame.
- Source tests ensure wide tables are wrapped by the shared frame.
- Source tests ensure Zaruku chart components consume the shared palette.
- Unit tests ensure every registered panel ID is unique and every default size is allowed.
- Unit tests ensure panel order is deterministic and narrow layouts ignore desktop spans.
- TypeScript, ESLint, and production build pass.

### Browser checks

For every Zaruku tab at 430, 768, 1024, 1279, 1280, and 1440 px:

- document width equals viewport width;
- the page has no horizontal scrollbar;
- wide tables have an internal horizontal scrollbar;
- bounded tables have sticky headers;
- keyboard focus remains visible inside scrolled tables;
- changing sort, filter, pagination, week, or tab does not resize the page shell;
- `?mobile=1` remains usable;
- tables do not lose columns or links.

At 1440 × 900, verify that Overview fits without vertical page scrolling and does not change height when the date range changes.

### Cross-dashboard regression

Because `.card-surface` and theme tokens are shared, visually verify Gidrofuril and Abbott at desktop and narrow widths. No Zaruku table-frame behavior is applied to non-Zaruku dashboards.

## Acceptance criteria

1. No Zaruku tab creates document-level horizontal scrolling at any acceptance viewport.
2. All wide tables scroll inside their own cards.
3. All large-row tables use a bounded viewport and sticky header.
4. Comparable tables share row height, padding, header typography, and divider styling.
5. Cards share one radius, border, shadow, padding, and section-gap system.
6. SEO query and page comparison tables preserve grouped source headers, sorting, pagination, and links.
7. Content all-pages no longer expands the document by thousands of pixels.
8. Overview fits 1440 × 900 and remains stable across periods.
9. One time owner is active per tab.
10. Empty and unavailable datasets do not create repeated warning boxes.
11. Gidrofuril and Abbott retain usable layouts after token changes.
12. Every movable Zaruku panel has a unique stable ID, deterministic order, allowed size set, and grid-compatible wrapper.
13. Reordering metadata in a test changes panel order without modifying the panel's data component.
14. Narrow layouts stack panels by deterministic order and ignore desktop column spans.
15. No drag-and-drop control, layout API, database change, deployment, collector change, cron change, or external send occurs as part of this work.

## Out of scope

- Replacing Recharts, Nivo, and Visx with one chart library.
- Replacing Zaruku domain tables with `CustomTable`, `PlatformTable`, or another universal table.
- A full mobile-specific table/card redesign.
- Drag-and-drop controls, freeform resizing, save/cancel/reset UI, and layout persistence.
- Per-user layouts; a future editor should begin with admin-owned dashboard-level layouts.
- Lazy-loading tabs.
- Changes to data collection, canonical facts, database schema, cron, authentication, exports, or API contracts unless a separate reviewed requirement is created.

## Risks and mitigations

1. **Shared token regression.** Token changes may alter Gidrofuril or Abbott. Mitigate with explicit visual regression checks before merge.
2. **Sticky-layer conflicts.** Sticky headers and first columns can overlap grouped headers. Migrate comparison tables first and test z-index/background behavior at each breakpoint.
3. **Nested overflow.** Existing components may already contain scroll wrappers. Remove redundant wrappers during migration and enforce one overflow owner with source tests.
4. **State loss during refactor.** Keep sort/filter/pagination state in domain components; the frame remains stateless.
5. **False mobile completeness.** Internal scroll makes current tables usable but does not constitute a full mobile redesign; keep that boundary explicit.
