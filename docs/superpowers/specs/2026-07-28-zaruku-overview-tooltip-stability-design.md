# Zaruku Overview Tooltip Stability Design

Date: 2026-07-28
Status: approved for planning
Scope: Zaruku first tab (`Overview`) and the shared Zaruku period context

## Problem

The Overview north-star card currently places tooltip elements inside containers that use `overflow-hidden`. The tooltip can therefore be cut off by the card or grid slot. The north-star heading also has a general information icon beside metric-specific information icons, which creates duplicate adjacent controls. At compact widths, the KPI value, direction arrow, and delta do not have a sufficiently explicit layout contract and can visually collide with nearby content.

The Overview period summary has a separate instability. Hovering the whole `YYYY-WNN · недельный срез позиций` label reveals an inline hidden element. Because that element enters document flow, the summary changes size, moves the hover target, and can flicker. A second period-context component implements the same explanation with separate tooltip markup.

## Outcome

Overview information controls will be singular, stable, readable above clipped panels, and usable with a pointer, keyboard, or touch screen. Opening explanatory content must not move the surrounding layout.

## Interaction Design

### Shared information popover

Introduce one reusable client-side information-popover component for Zaruku explanatory content.

- The trigger is a real button with a minimum `20 × 20 px` hit area, an accessible label, and a visible focus ring.
- Hovering or focusing the trigger opens the popover on pointer/keyboard devices.
- Clicking or tapping the trigger toggles the popover.
- Clicking outside or pressing `Escape` closes it.
- Moving the pointer from the trigger into the popover does not cause flicker.
- The popover is rendered through a portal attached to `document.body`, so panel and table overflow rules cannot clip it.
- Its position is calculated from the trigger rectangle. It prefers below the trigger, flips above when necessary, and clamps horizontally within a 16 px viewport margin.
- Position is recalculated when the popover opens and on window resize or scroll while it remains open.
- The trigger uses `aria-expanded`, `aria-controls`, and `aria-describedby` while the surface is open. The explanatory surface uses `role="tooltip"` and has a stable accessible association with its trigger.

The surface is a compact non-modal popover rather than a browser-native `title`: it uses the existing white card styling, readable type, border, and shadow. It does not trap focus.

### North-star metrics

- Remove the general information icon after the north-star heading.
- Keep one information button beside each metric label: `Шум`, `Мед. интент`, and `Алиса AI`.
- Preserve the existing metric-specific title, explanation, importance, provenance, and period text inside each popover.
- Use a wrapping/flex-safe value row with explicit minimum widths and shrink behavior. The number remains readable; the arrow and delta stay in their own non-overlapping elements and may wrap as a group only when the viewport is too narrow.
- The north-star card may retain `overflow-hidden` because the portal removes popovers from the card clipping context.

### Period summary

- Keep `Ежедневные данные`, the date range, the standard-lag note, the weekly-period label, and the unified-period sentence permanently visible and unchanged by interaction.
- The weekly-period label itself is plain text and is no longer a hover target.
- Add exactly one shared information button immediately after `недельный срез позиций`.
- Its popover explains that the SEO OS weekly slice is independent of the selected daily period and does not limit Metrika, GSC, or Yandex Webmaster data.
- Apply the same component and copy in both `ZarukuOverviewTab` and `ZarukuPeriodContext`, eliminating their divergent tooltip implementations.

## Component Boundaries

Create a focused shared component under `src/components`, for example `ZarukuInfoPopover.tsx`. It owns open state, event handling, portal rendering, and viewport-aware positioning. Callers own trigger labels and content. Existing data builders and source-truth logic do not change.

`ZarukuSeoDashboard` uses it for north-star KPI explanations and the technical-tail explanation. `ZarukuOverviewTab` and `ZarukuPeriodContext` use it for the weekly-period explanation.

## Responsive and Visual Behavior

- No popover may extend beyond the viewport at 430, 768, 1280, or 1440 px widths.
- Opening or closing a popover must not change the dimensions or positions of the Overview period summary, north-star strip, traffic-health strip, channel panel, or organic-search panel.
- Popovers use a maximum width that fits within the viewport and a practical desktop width around 288 px.
- Trigger buttons remain visually quiet but are large enough to select reliably.

## Testing

Add focused component/source tests that verify:

- the north-star heading no longer renders its general information icon;
- each north-star metric renders one information trigger;
- the period label no longer owns hover-revealed inline content;
- both period components use the shared information popover;
- tooltip content is portal-rendered rather than nested in clipped panels;
- triggers expose the agreed accessible state and relationships;
- value-row classes preserve separate number and metadata layout.

Run the focused tests, the complete dashboard test suite, type checking, and lint. Browser verification covers hover, focus, tap/click, outside-click, `Escape`, viewport-edge placement, absence of reflow, and no overlap at representative mobile and desktop widths.

## Out of Scope

- Changing metric definitions, values, periods, provenance, or source data
- Changing the fixed Overview desktop panel composition
- Redesigning chart tooltips or unrelated tables
- Deployment, API calls, database changes, collector runs, cron edits, or secret changes
