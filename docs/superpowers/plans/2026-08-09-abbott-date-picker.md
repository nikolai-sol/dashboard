# Abbott Completed-Day Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Abbott its own modern period selector whose presets and custom ranges end on the latest completed business day, never today.

**Architecture:** Pure functions in `abbott-date-range.ts` own timezone-aware date arithmetic, preset resolution, detection, and normalization. An Abbott-only control component is injected into the shared header through a slot so other dashboards retain their current controls. The dashboard server applies the same completed-day boundary before loading Abbott data.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Node test runner, existing `Intl.DateTimeFormat` business-timezone utilities.

## Global Constraints

- Scope is Abbott only; Zaruku, Gidrofuril, and all other dashboards keep their current period behavior and UI.
- Abbott business timezone remains `ABBOTT_BUSINESS_TIME_ZONE`, default `Europe/Moscow`.
- The latest selectable and queryable Abbott date is yesterday in that business timezone.
- Presets are exactly: `this_month`, `previous_month`, `this_week`, `previous_week`, `custom`.
- Current month is first-of-month through yesterday; current week is Monday through yesterday.
- Previous month and previous week are complete calendar periods.
- A current period with no completed day yields the Russian empty-state message «За текущий период ещё нет завершённых дней. Данные появятся завтра» and does not replace the applied range with today.
- Custom input exposes `От` and `До`, disables invalid application, and cannot select today or a future date.
- Existing Abbott URLs ending today or later normalize to yesterday; invalid/inverted explicit Abbott ranges are rejected by the server boundary.
- No source API, canonical database, collector, cron, or release-data changes.
- No new third-party date-picker dependency.

---

### Task 1: Completed-day Abbott date domain

**Files:**
- Modify: `dashboard-next/src/lib/abbott-date-range.ts`
- Modify: `dashboard-next/src/lib/abbott-date-range.test.ts`

**Interfaces:**
- Produces `AbbottDatePreset`, `AbbottPresetResult`, `latestCompletedAbbottDate`, `resolveAbbottPreset`, `detectAbbottPreset`, and `normalizeAbbottRequestedRange`.
- `resolveAbbottPreset` returns either `{ kind: "range", from, to }` or `{ kind: "empty", message }`.
- `normalizeAbbottRequestedRange` returns a clamped range or throws `AbbottDateRangeError` for malformed/inverted input.

- [ ] **Step 1: Write failing preset and normalization tests**

Add deterministic tests using Moscow business time:

```ts
assert.deepEqual(resolveAbbottPreset("this_month", new Date("2026-08-09T12:00:00Z")), {
  kind: "range", from: "2026-08-01", to: "2026-08-08",
});
assert.deepEqual(resolveAbbottPreset("previous_month", new Date("2026-08-09T12:00:00Z")), {
  kind: "range", from: "2026-07-01", to: "2026-07-31",
});
assert.deepEqual(resolveAbbottPreset("this_week", new Date("2026-08-09T12:00:00Z")), {
  kind: "range", from: "2026-08-03", to: "2026-08-08",
});
assert.deepEqual(resolveAbbottPreset("previous_week", new Date("2026-08-09T12:00:00Z")), {
  kind: "range", from: "2026-07-27", to: "2026-08-02",
});
assert.equal(resolveAbbottPreset("this_week", new Date("2026-08-10T09:00:00Z")).kind, "empty");
assert.deepEqual(normalizeAbbottRequestedRange(
  { from: "2026-08-01", to: "2026-08-09" },
  new Date("2026-08-09T12:00:00Z"),
), { from: "2026-08-01", to: "2026-08-08" });
```

Also cover the first business day of a month, New Year, leap-year February,
custom `from > to`, invalid ISO dates, and preset detection.

- [ ] **Step 2: Run the date tests and verify RED**

Run: `npm test -- --test-name-pattern='Abbott' src/lib/abbott-date-range.test.ts`  
Expected: FAIL because the new exports and semantics do not exist.

- [ ] **Step 3: Implement the pure date API**

Use UTC date construction only after extracting business-calendar parts:

```ts
export type AbbottDatePreset =
  | "this_month" | "previous_month" | "this_week" | "previous_week" | "custom";

export const ABBOTT_NO_COMPLETED_DAYS =
  "За текущий период ещё нет завершённых дней. Данные появятся завтра";

export type AbbottPresetResult =
  | { kind: "range"; from: string; to: string }
  | { kind: "empty"; message: typeof ABBOTT_NO_COMPLETED_DAYS };
```

Keep `defaultAbbottRange` as a compatibility wrapper around
`resolveAbbottPreset("this_month", ...)`; for the no-completed-day case it
returns `null` instead of substituting today. Derive Monday with ISO weekday
arithmetic and clamp requested `to` to `latestCompletedAbbottDate`.

- [ ] **Step 4: Run the date tests and verify GREEN**

Run: `npm test -- --test-name-pattern='Abbott' src/lib/abbott-date-range.test.ts`  
Expected: all Abbott date-range tests pass.

- [ ] **Step 5: Commit Task 1 in the dashboard repository**

```bash
git add src/lib/abbott-date-range.ts src/lib/abbott-date-range.test.ts
git commit -m "feat: define Abbott completed-day periods"
```

### Task 2: Server-side Abbott completed-day boundary

**Files:**
- Modify: `dashboard-next/src/lib/dashboard-date-range.ts`
- Modify: `dashboard-next/src/lib/dashboard-date-range.test.ts`
- Modify: `dashboard-next/src/app/api/dashboard/[id]/route.ts`
- Test: add or modify the closest dashboard API route test if one exists; otherwise add `dashboard-next/src/app/api/dashboard/[id]/route.test.ts`.

**Interfaces:**
- Consumes `normalizeAbbottRequestedRange` and `defaultAbbottRange` from Task 1.
- Produces `InvalidDashboardDateRangeError`, mapped to HTTP 400 by the dashboard route.

- [ ] **Step 1: Write failing server-boundary tests**

```ts
assert.deepEqual(resolveDashboardDateRange({
  requestUrl: "https://dash.test/abbott?from=2026-08-01&to=2026-08-09",
  configFrom: null,
  configTo: null,
  dashboardType: "abbott_bi",
  now: new Date("2026-08-09T12:00:00Z"),
}), { from: "2026-08-01", to: "2026-08-08" });

assert.throws(() => resolveDashboardDateRange({
  requestUrl: "https://dash.test/abbott?from=2026-08-08&to=2026-08-01",
  configFrom: null,
  configTo: null,
  dashboardType: "abbott_bi",
  now: new Date("2026-08-09T12:00:00Z"),
}), InvalidDashboardDateRangeError);
```

Retain tests proving Zaruku and generic ranges are unchanged. Add a route test
that maps `InvalidDashboardDateRangeError` to a private, no-store 400 response.

- [ ] **Step 2: Run the focused server tests and verify RED**

Run: `npm test -- src/lib/dashboard-date-range.test.ts`  
Expected: FAIL because Abbott explicit ranges are currently returned unchanged.

- [ ] **Step 3: Implement the Abbott branch and 400 mapping**

In `resolveDashboardDateRange`, handle `dashboardType === "abbott_bi"` before
the generic explicit-range return. Normalize valid explicit ranges; reject a
partial, malformed, or inverted explicit range; use the completed current-month
default when neither bound is supplied. Export a stable error class:

```ts
export class InvalidDashboardDateRangeError extends Error {
  constructor() { super("Invalid Abbott date range"); }
}
```

In the API route catch block, return `{ error: "Invalid date range" }` with
status 400 when this class is caught. Do not expose the supplied values.

- [ ] **Step 4: Run server tests and verify GREEN**

Run: `npm test -- src/lib/dashboard-date-range.test.ts`  
Expected: all range tests pass, including unchanged Zaruku behavior.

- [ ] **Step 5: Commit Task 2 in the dashboard repository**

```bash
git add src/lib/dashboard-date-range.ts src/lib/dashboard-date-range.test.ts \
  'src/app/api/dashboard/[id]/route.ts' 'src/app/api/dashboard/[id]/route.test.ts'
git commit -m "fix: enforce completed Abbott query dates"
```

### Task 3: Abbott-only modern period selector

**Files:**
- Create: `dashboard-next/src/components/abbott/AbbottDatePicker.tsx`
- Create: `dashboard-next/src/components/abbott/abbott-date-picker.test.ts`
- Modify: `dashboard-next/src/components/DashboardHeader.tsx`
- Modify: `dashboard-next/src/app/dashboard/[id]/page.tsx`

**Interfaces:**
- `AbbottDatePicker` consumes the active `AbbottDatePreset`, applied/draft
  range, `maxDate`, loading state, optional empty message, and callbacks for
  preset selection, draft changes, and custom apply.
- `DashboardHeader` gains optional `dateControlsSlot?: React.ReactNode`; when
  present it replaces only the shared date-control block.
- Other dashboards continue using the existing `DashboardQuickRangePreset`
  and callbacks without behavior changes.

- [ ] **Step 1: Write failing UI contract tests**

Use the repository's source-contract test style to assert:

```ts
assert.match(pickerSource, /Этот месяц/);
assert.match(pickerSource, /Прошлый месяц/);
assert.match(pickerSource, /Эта неделя/);
assert.match(pickerSource, /Прошлая неделя/);
assert.match(pickerSource, /Свой период/);
assert.match(pickerSource, /max=\{maxDate\}/);
assert.match(headerSource, /dateControlsSlot/);
assert.match(pageSource, /<AbbottDatePicker/);
```

Add pure tests for custom validation: missing bounds, inverted bounds, and a
valid completed-day range. Assert the Abbott page uses the slot only in the
`dashboardType === "abbott_bi"` render path.

- [ ] **Step 2: Run the UI tests and verify RED**

Run: `npm test -- src/components/abbott/abbott-date-picker.test.ts`  
Expected: FAIL because the component and slot do not exist.

- [ ] **Step 3: Implement the picker and header slot**

Render one styled `<select>` for the five preset choices. Render the `От` and
`До` inputs plus «Применить» only for `custom`; set `max={maxDate}` on both.
Expose `validateAbbottCustomRange` as a pure helper returning `null` when valid
or a Russian inline message when invalid.

In `DashboardHeader`, prefer the slot without altering the shared branch:

```tsx
{dateControlsSlot ? dateControlsSlot : (
  // existing shared quick buttons and date inputs unchanged
)}
```

- [ ] **Step 4: Integrate Abbott state without changing other dashboards**

Replace Abbott's use of `buildQuickRange`/`detectQuickRangePreset` with the
Task 1 functions. Normalize initial Abbott URL bounds to yesterday and call
`router.replace` with the normalized range. Preset ranges apply immediately.
For an empty current preset, set an Abbott-only empty message, leave the last
valid applied range unchanged so the effect does not fetch, and hide
`AbbottBiDashboard` behind the approved empty-state card. Applying a valid
custom range clears the empty state, updates URL/state, and triggers one load.

- [ ] **Step 5: Run UI and existing header tests and verify GREEN**

Run:

```bash
npm test -- src/components/abbott/abbott-date-picker.test.ts \
  src/components/AbbottBiDashboard.ui.test.ts src/lib/abbott-date-range.test.ts
```

Expected: all selected tests pass and the shared-header source remains intact
for non-Abbott call sites.

- [ ] **Step 6: Commit Task 3 in the dashboard repository**

```bash
git add src/components/abbott/AbbottDatePicker.tsx \
  src/components/abbott/abbott-date-picker.test.ts \
  src/components/DashboardHeader.tsx 'src/app/dashboard/[id]/page.tsx'
git commit -m "feat: add Abbott completed-period picker"
```

### Task 4: Integration verification and parent pin

**Files:**
- Modify: parent repository `dashboard-next` gitlink only after the dashboard commits pass.
- Modify: this plan only to check completed steps and record commands.

**Interfaces:**
- Consumes all Task 1–3 commits.
- Produces a reviewed dashboard child commit and an Abbott-only parent branch.

- [ ] **Step 1: Run the complete dashboard verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run security:public-assets
```

Expected: zero test/type/lint/build/security failures.

- [ ] **Step 2: Run browser verification**

Verify Abbott at desktop and mobile widths with a deterministic or current
date. Confirm all four presets, custom `От–До`, URL normalization, maximum
yesterday, and the approved empty-state copy. Confirm a Zaruku page retains
its existing date controls. Do not mutate production data.

- [ ] **Step 3: Perform whole-branch review**

Review the complete child diff against the approved spec. Reject changes to
Zaruku behavior, collector code, database code, or shared date behavior outside
the additive header slot.

- [ ] **Step 4: Commit the parent gitlink and completed plan**

```bash
git add dashboard-next docs/superpowers/plans/2026-08-09-abbott-date-picker.md
git commit -m "feat: add Abbott completed-day date picker"
```

- [ ] **Step 5: Merge and deploy only after explicit user authorization**

Do not merge, push, or deploy from this task unless the user explicitly asks.
