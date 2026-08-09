# Abbott Completed-Day Date Picker Design

**Date:** 2026-08-09  
**Scope:** Abbott dashboard only

## Goal

Replace the Abbott date controls with a compact, modern period selector that
never requests the incomplete current day. Preserve every other dashboard's
existing date controls and behavior.

## Period semantics

All calendar calculations use the Abbott business timezone already defined by
`ABBOTT_BUSINESS_TIME_ZONE` (default `Europe/Moscow`). The latest selectable
date is the previous business-calendar day.

| Preset | From | To |
|---|---|---|
| Этот месяц | First day of the current month | Yesterday |
| Прошлый месяц | First day of the previous month | Last day of the previous month |
| Эта неделя | Monday of the current week | Yesterday |
| Прошлая неделя | Previous Monday | Previous Sunday |
| Свой период | User-selected date | User-selected date, no later than yesterday |

If the current month or week has no completed day yet, selecting its preset
does not issue an API request. The dashboard shows: «За текущий период ещё нет
завершённых дней. Данные появятся завтра».

Existing Abbott URLs whose `to` value is today or a future date are normalized
to yesterday. The normalized period replaces the URL so refresh and export use
the same completed-day range. A custom range cannot start after its end and
cannot contain today or a future date.

## Interface

Abbott receives a dedicated compact date control instead of changing the
shared controls used by Zaruku and other dashboards.

- One period selector exposes five choices: «Этот месяц», «Прошлый месяц»,
  «Эта неделя», «Прошлая неделя», «Свой период».
- The active preset and resolved dates remain visible in the dashboard header.
- Selecting a preset with completed days applies immediately.
- Selecting «Свой период» opens the adjacent «От» and «До» inputs and an
  explicit «Применить» button.
- Both inputs have `max=yesterday`. Invalid or incomplete custom input keeps
  «Применить» disabled and shows a short inline validation message.
- The layout wraps cleanly on mobile without a modal or third-party calendar
  dependency.

## Architecture

Date arithmetic moves into the existing Abbott date-range module as pure,
testable functions:

- resolve an Abbott preset for a supplied instant and business timezone;
- detect which preset matches a resolved range;
- normalize a requested Abbott range to the latest completed day;
- represent a current preset with no completed dates as an explicit empty
  result rather than inventing a date.

An Abbott-only date-control component renders the selector and custom range.
The shared `DashboardHeader` receives this component through an Abbott-specific
render path or slot; its default controls and types remain unchanged for other
dashboards.

The Abbott page owns applied and draft state. It normalizes URL parameters
before loading data, avoids a request for an explicit empty period, and keeps
exports aligned with the applied completed-day range.

The Abbott dashboard API validates the same completed-day boundary so a direct
request cannot reintroduce today through handcrafted query parameters. It
normalizes `to` down to yesterday and rejects structurally invalid ranges.

## Empty and error states

- No completed current-period day: render the approved empty-state message and
  keep existing dashboard data from being presented as if it matched the empty
  period.
- Invalid custom range: do not update the URL or call the API; show an inline
  message.
- API failure for a valid completed-day period: preserve the existing Abbott
  technical-error handling.

## Testing and verification

Automated tests cover:

- Moscow-timezone boundaries around midnight;
- ordinary, month-first-day, Monday, year-boundary, and leap-year dates;
- exact ranges for all four presets;
- normalization of today/future URL dates to yesterday;
- explicit empty results for the first day of a month and Monday;
- custom-range validation and maximum date;
- Abbott-only rendering, ensuring Zaruku/shared header behavior is unchanged;
- no data request for an empty current period.

Visual verification covers desktop and mobile Abbott views, every preset,
custom range application, URL parameters, and the first-day empty state using
a deterministic browser date where needed.

## Non-goals

- No changes to Metrika collection, canonical tables, cron, or release data.
- No change to Zaruku, Gidrofuril, or other dashboard period ownership.
- No third-party calendar dependency and no comparison-period redesign.
