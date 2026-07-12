# Task 3 Report: Shared ISO Week Comparison Controls

## Delivered

- Added shared ISO-week selection state to `ZarukuSeoDashboard`, initialized from `data.seo_os.latest_week` and preserved while dashboard tabs change.
- Added `ZarukuSeoWeekToolbar` with a `Single`/`Compare` segmented control, native A/B ISO-week selects, and a Lucide history icon action titled `Сравнить с предыдущей доступной неделей`.
- The previous-week action selects the prior available week and is disabled when none exists.
- Added a client-safe selection helper which prevents equal A/B values by moving the other selection to the nearest prior available week, then the next available week.
- Kept existing tab navigation and tab content unchanged.

## TDD Evidence

### RED

1. `npm test -- src/components/zaruku-seo-week-selection.test.ts`
   - Failed because `@/components/zaruku-seo-week-selection` did not exist.
2. After browser verification found a client bundle failure caused by importing the server-side `zaruku-seo-os` module, a focused helper export test was added.
   - Failed with `TypeError: previousAvailableWeek is not a function`.

### GREEN

`npm test -- src/components/zaruku-seo-week-selection.test.ts && npm run typecheck && npm run lint`

- Tests: 15 passed, 0 failed.
- `tsc --noEmit`: exit 0.
- ESLint: exit 0; two pre-existing `react-hooks/exhaustive-deps` warnings remain in `src/components/admin/DashboardUtmSourceMatching.tsx` at lines 66 and 152. No Task 3 lint issues.

## Browser Verification

- Ran `npm run dev -- -p 3000` and opened `/dashboard/28`.
- Initial browser check revealed a `mysql2`/`net` client-bundle error from importing a server-only module. Replaced the import with a client-safe local ISO-week helper.
- Recheck loaded the dashboard with no console errors and no error overlay.
- Verified the toolbar appears on Overview and Content, Compare mode persists after tab navigation, and the previous-week button is disabled for the loaded one-week dataset.

## Files

- Modified: `src/components/ZarukuSeoDashboard.tsx`
- Added: `src/components/ZarukuSeoWeekToolbar.tsx`
- Added: `src/components/zaruku-seo-week-selection.ts`
- Added: `src/components/zaruku-seo-week-selection.test.ts`

## Commit

- `5d6143d Add Zaruku ISO week comparison controls`

## Self-Review

- Shared state is owned by the dashboard shell, so all existing tabs see the same controls without tab remount resets.
- The toolbar uses stable grid tracks and native controls, with an accessible name and hover title for the icon-only action.
- Selection logic has no server imports, preventing server database code from entering the client bundle.
- `git diff --check` is clean.

## Concerns

- The local Zaruku record currently provides a single available week, so browser interaction could only validate the disabled previous-week state. The pure tests cover multi-week predecessor selection and duplicate A/B reconciliation.
- The existing server-side ISO-week helper remains separate from the client-safe helper to avoid changing server data-loader boundaries in this focused task.

## Task 3 Accessibility Follow-up (2026-07-12)

### Delivered

- Wrapped the disabled previous-week icon action in a focusable non-disabled `span` only when no prior week exists.
- Moved the unavailable-state native tooltip trigger to that wrapper and retained the existing tooltip for the enabled button state.
- Preserved the native icon button, its accessible name, and its `disabled` behavior.
- Added `aria-describedby` on the disabled button and a matching `sr-only` unavailable explanation.

### Commands And Results

1. RED render assertion:

   ```sh
   node --import tsx --input-type=module --eval 'import assert from "node:assert/strict"; import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; const module = await import("./src/components/ZarukuSeoWeekToolbar.tsx"); const ZarukuSeoWeekToolbar = module.default.default; const html = renderToStaticMarkup(createElement(ZarukuSeoWeekToolbar, { weeks: ["2026-W01"], primaryWeek: "2026-W01", comparisonWeek: null, comparisonEnabled: false, onComparisonEnabledChange() {}, onPrimaryWeekChange() {}, onComparisonWeekChange() {}, onComparePrevious() {} })); assert.match(html, /tabindex="0"/); assert.match(html, /aria-describedby="zaruku-previous-week-unavailable-description"/); assert.match(html, /id="zaruku-previous-week-unavailable-description"/);'
   ```

   Result before the change: exit 1. The assertion failed because rendered markup lacked `tabindex="0"`.

2. GREEN render assertion: repeated the exact command above after the change.

   Result: exit 0. The rendered one-week toolbar includes the focusable wrapper, `aria-describedby`, and hidden description.

3. Focused available tests:

   ```sh
   npm test -- src/components/zaruku-seo-week-selection.test.ts
   ```

   Result: exit 0; 15 passed, 0 failed.

4. Typecheck:

   ```sh
   npm run typecheck
   ```

   Result: exit 0 (`tsc --noEmit`).

5. Lint:

   ```sh
   npm run lint
   ```

   Result: exit 0; 0 errors and 2 pre-existing `react-hooks/exhaustive-deps` warnings in `src/components/admin/DashboardUtmSourceMatching.tsx` at lines 66 and 152.

6. Diff validation:

   ```sh
   git diff --check
   ```

   Result: exit 0.

7. Browser check:

   ```sh
   npm run dev -- -p 3000
   ```

   Opened `http://localhost:3000/dashboard/28` in the in-app browser. The loaded one-week toolbar rendered one wrapper with `tabindex="0"` and title `Нет предыдущей доступной недели для сравнения`; its child button remained disabled, referenced `zaruku-previous-week-unavailable-description`, and that hidden element contained the same explanatory text. The browser automation could not advance tab focus from the selected segmented-control button, and native title tooltips are not captured in its screenshots.

### Files

- Modified: `src/components/ZarukuSeoWeekToolbar.tsx`
- Appended: `.superpowers/sdd/task-3-report.md`

## Task 3 Accessibility Follow-up: Focus Association (2026-07-12)

### Delivered

- Added `aria-describedby="zaruku-previous-week-unavailable-description"` to the focusable unavailable-state wrapper.
- Retained the association on the disabled child button.
- Added `src/components/ZarukuSeoWeekToolbar.test.ts` with a focused assertion that checks the opening wrapper tag itself carries both `tabindex="0"` and `aria-describedby`.

### Commands And Results

1. RED focused assertion:

   ```sh
   npm test -- src/components/ZarukuSeoWeekToolbar.test.ts
   ```

   Result before the component change: exit 1; 15 passed, 1 failed. The focused assertion failed because the focusable wrapper had `tabindex="0"` but no `aria-describedby`.

2. GREEN focused assertion:

   ```sh
   npm test -- src/components/ZarukuSeoWeekToolbar.test.ts
   ```

   Result: exit 0; 16 passed, 0 failed.

3. Typecheck:

   ```sh
   npm run typecheck
   ```

   Result: exit 0 (`tsc --noEmit`).

4. Lint:

   ```sh
   npm run lint
   ```

   Result: exit 0; 0 errors and the same 2 pre-existing `react-hooks/exhaustive-deps` warnings in `src/components/admin/DashboardUtmSourceMatching.tsx` at lines 66 and 152.
