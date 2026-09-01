# Abbott User ID Aggregate Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ВСЕ с User ID` in the approved position and make all aggregate User ID selections use the same canonical Logs visit population.

**Architecture:** Keep aggregate-selection semantics in the existing small Abbott filter helpers. The dashboard continues to compose filters, but summary and action row selectors recognize two internal sentinels and never treat them as concrete User IDs. Manager summaries use private Logs rows; the aggregate Reports summary remains available only for non-manager projections where private rows are unavailable.

**Tech Stack:** Next.js, React, TypeScript, Node test runner, `tsx`.

## Global Constraints

- Visible aggregate order is exactly `ВСЕ`, `ВСЕ с User ID`, `ВСЕ без админов`, then sorted concrete User IDs.
- `ВСЕ с User ID` includes administrator visits.
- `ВСЕ без админов` is the only aggregate option that removes configured administrators.
- Manager aggregate options read the canonical Logs visit model and do not call source APIs at request time.
- Internal sentinel values never render as real User IDs.
- No collector, database schema, OAuth token, cron, release pointer, or deployment change is part of this implementation.

---

### Task 1: Aggregate User ID option and action filtering

**Files:**
- Modify: `src/components/abbott/abbott-admin-user-filter.ts`
- Modify: `src/components/abbott/abbott-admin-user-filter.test.ts`
- Modify: `src/components/abbott/abbott-user-action-filters.ts`
- Modify: `src/components/abbott/abbott-user-action-filters.test.ts`

**Interfaces:**
- Produces: `ABBOTT_WITH_USER_ID: "__abbott_with_user_id__"`.
- Produces: `isAbbottAggregateUserFilter(value: string): boolean` for preventing sentinels from being compared with concrete IDs.
- Extends: `buildAbbottAdminUserOptions(exactUserIds, adminFilterAvailable)` so `ВСЕ с User ID` is always first in its returned options and `ВСЕ без админов` follows when available.
- Extends: `selectAbbottUserActions(...)` so the new sentinel keeps rows with `has_user_id=true`, including `is_admin_user=true` rows.

- [ ] **Step 1: Write failing option-order tests**

Update the import and first test in `src/components/abbott/abbott-admin-user-filter.test.ts`:

```ts
import {
  ABBOTT_WITH_USER_ID,
  ABBOTT_WITHOUT_ADMINS,
  abbottAdminUsersApiPath,
  buildAbbottAdminUserOptions,
  normalizeAbbottAdminUserInput,
} from "./abbott-admin-user-filter";

test("aggregate options precede exact User IDs in the approved order", () => {
  assert.deepEqual(buildAbbottAdminUserOptions(["900001", "000001"], true), [
    { value: ABBOTT_WITH_USER_ID, label: "ВСЕ с User ID" },
    { value: ABBOTT_WITHOUT_ADMINS, label: "ВСЕ без админов" },
    { value: "000001", label: "000001" },
    { value: "900001", label: "900001" },
  ]);
  assert.deepEqual(buildAbbottAdminUserOptions(["900001"], false), [
    { value: ABBOTT_WITH_USER_ID, label: "ВСЕ с User ID" },
    { value: "900001", label: "900001" },
  ]);
});
```

- [ ] **Step 2: Write the failing action-filter test**

Import `ABBOTT_WITH_USER_ID` and add to `src/components/abbott/abbott-user-action-filters.test.ts`:

```ts
test("all-with-User-ID keeps identified admin and non-admin visits", () => {
  const selected = selectAbbottUserActions([
    action("900001", null, { is_admin_user: true }),
    action("doctor-1", null, { is_admin_user: false }),
    action("", null, { has_user_id: false, is_admin_user: false }),
  ], {
    user_id: ABBOTT_WITH_USER_ID,
  }, 1, 100);

  assert.deepEqual(
    selected.filteredRows.map((row) => row.user_id).sort(),
    ["900001", "doctor-1"],
  );
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
node --import tsx --test \
  src/components/abbott/abbott-admin-user-filter.test.ts \
  src/components/abbott/abbott-user-action-filters.test.ts
```

Expected: FAIL because `ABBOTT_WITH_USER_ID` is not exported and the option/filter behavior is absent.

- [ ] **Step 4: Implement the sentinel, ordered options, and action predicate**

In `src/components/abbott/abbott-admin-user-filter.ts`, add the new sentinel and aggregate predicate, exclude both sentinels from exact IDs, and return aggregate options in order:

```ts
export const ABBOTT_WITH_USER_ID = "__abbott_with_user_id__";
export const ABBOTT_WITHOUT_ADMINS = "__abbott_without_admins__";

export function isAbbottAggregateUserFilter(value: string): boolean {
  return value === ABBOTT_WITH_USER_ID || value === ABBOTT_WITHOUT_ADMINS;
}

export function buildAbbottAdminUserOptions(
  exactUserIds: readonly string[],
  adminFilterAvailable: boolean,
): AbbottAdminUserOption[] {
  const exact = [...new Set(exactUserIds)]
    .filter((userId) => !isAbbottAggregateUserFilter(userId))
    .sort((left, right) => left.localeCompare(right));
  return [
    { value: ABBOTT_WITH_USER_ID, label: "ВСЕ с User ID" },
    ...(adminFilterAvailable
      ? [{ value: ABBOTT_WITHOUT_ADMINS, label: "ВСЕ без админов" }]
      : []),
    ...exact.map((userId) => ({ value: userId, label: userId })),
  ];
}
```

In `src/components/abbott/abbott-user-action-filters.ts`, import both sentinels and replace the concrete-User-ID checks with:

```ts
if (filters.user_id === ABBOTT_WITH_USER_ID && !row.has_user_id) return false;
if (filters.user_id === ABBOTT_WITHOUT_ADMINS && row.is_admin_user) return false;
if (
  filters.user_id
  && !isAbbottAggregateUserFilter(filters.user_id)
  && row.user_id !== filters.user_id
) return false;
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 3.

Expected: PASS for all option-helper and action-filter tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add \
  src/components/abbott/abbott-admin-user-filter.ts \
  src/components/abbott/abbott-admin-user-filter.test.ts \
  src/components/abbott/abbott-user-action-filters.ts \
  src/components/abbott/abbott-user-action-filters.test.ts
git commit -m "feat(abbott): add aggregate User ID option"
```

---

### Task 2: Logs-based manager summary selection and dashboard integration

**Files:**
- Modify: `src/components/abbott-summary.ts`
- Modify: `src/components/abbott-summary.test.ts`
- Modify: `src/components/AbbottBiDashboard.tsx`
- Modify: `src/components/AbbottBiDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `ABBOTT_WITH_USER_ID`, `ABBOTT_WITHOUT_ADMINS`, and `isAbbottAggregateUserFilter` from Task 1.
- Extends: `selectAbbottSummaryRows(...)` so manager mode returns Logs-derived `behaviorRows` for `ВСЕ`, filters identified rows for `ВСЕ с User ID`, and returns independently recomputed rows for `ВСЕ без админов`.
- Preserves: aggregate Reports rows for `showUserIdAnalytics=false`, where private manager rows are not exposed.

- [ ] **Step 1: Replace the old default-summary expectation with failing Logs expectations**

In `src/components/abbott-summary.test.ts`, import `ABBOTT_WITH_USER_ID`. Replace `default summary uses authoritative traffic sessions` and add the new identified-population assertion:

```ts
test("manager default summary uses canonical Logs visit rows", () => {
  const trafficRows = [summaryRow({ traffic_segment: "all", visits: 7863 })];
  const behaviorRows = [
    summaryRow({ traffic_segment: null, user_id: "900001", has_user_id: true, visits: 47 }),
    summaryRow({ traffic_segment: null, user_id: "", has_user_id: false, visits: 6785 }),
  ];

  assert.equal(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
});

test("all-with-User-ID keeps identified admin and non-admin summary rows", () => {
  const admin = summaryRow({ traffic_segment: null, user_id: "900001", has_user_id: true, visits: 47 });
  const doctor = summaryRow({ traffic_segment: null, user_id: "doctor-1", has_user_id: true, visits: 3 });
  const anonymous = summaryRow({ traffic_segment: null, user_id: "", has_user_id: false, visits: 10 });

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows: [summaryRow({ traffic_segment: "all", visits: 7863 })],
      behaviorRows: [admin, doctor, anonymous],
      filters: { user_id: ABBOTT_WITH_USER_ID, user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    [admin, doctor],
  );
});
```

Retain a non-manager test proving `showUserIdAnalytics=false` still selects `traffic_segment="all"` rows.

- [ ] **Step 2: Add failing dashboard integration assertions**

In `src/components/AbbottBiDashboard.ui.test.ts`, import the filter-helper source with `readFileSync` and add:

```ts
test("orders aggregate User ID filters and treats sentinels as aggregate populations", () => {
  const filterSource = readFileSync(
    new URL("./abbott/abbott-admin-user-filter.ts", import.meta.url),
    "utf8",
  );
  assert.match(filterSource, /ВСЕ с User ID[\s\S]*ВСЕ без админов/);
  assert.match(source, /usersSummaryUserIdFilter === ABBOTT_WITH_USER_ID/);
  assert.match(source, /!isAbbottAggregateUserFilter\(usersSummaryUserIdFilter\)/);
});
```

- [ ] **Step 3: Run focused summary/UI tests and verify RED**

Run:

```bash
node --import tsx --test \
  src/components/abbott-summary.test.ts \
  src/components/AbbottBiDashboard.ui.test.ts
```

Expected: FAIL because manager default still selects Reports rows and the dashboard does not recognize the new sentinel.

- [ ] **Step 4: Implement Logs-based summary population selection**

In `src/components/abbott-summary.ts`, use the new sentinel and keep the existing public aggregate path:

```ts
if (filters.user_id === ABBOTT_WITHOUT_ADMINS) return behaviorRowsWithoutAdmins;
if (filters.user_id === ABBOTT_WITH_USER_ID) {
  return behaviorRows.filter((row) => row.has_user_id);
}
if (showUserIdAnalytics) return behaviorRows;
if (filters.user_id_traffic === "with_user_id" || filters.user_id_traffic === "without_user_id") {
  return trafficRows.filter((row) => row.traffic_segment === filters.user_id_traffic);
}
const allTrafficRows = trafficRows.filter((row) => row.traffic_segment === "all");
return allTrafficRows.length > 0 ? allTrafficRows : behaviorRows;
```

Remove the underscore from the destructured `showUserIdAnalytics` parameter because it is now used.

- [ ] **Step 5: Integrate aggregate sentinels in the dashboard**

In `src/components/AbbottBiDashboard.tsx`, import `ABBOTT_WITH_USER_ID` and `isAbbottAggregateUserFilter`. Extend the unavailable-admin guard only for `ABBOTT_WITHOUT_ADMINS`, keep the new option available regardless of admin settings, and make summary presentation treat both sentinels as aggregate populations:

```ts
const userBehaviorSummaryActive =
  isAbbottAggregateUserFilter(usersSummaryUserIdFilter)
  || usersSummarySourceRows.length === 0
  || usersSummarySourceRows === data.users_summary;
```

Replace the concrete-ID row check with:

```ts
if (
  usersSummaryUserIdFilter
  && !isAbbottAggregateUserFilter(usersSummaryUserIdFilter)
  && row.user_id !== usersSummaryUserIdFilter
) return false;
```

Update the users-summary tab description to state that the manager table uses canonical Logs visits and that the aggregate User ID options select populations from that same visit dataset.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3 plus Task 1's focused command.

Expected: PASS for all four test files.

- [ ] **Step 7: Run repository verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: all tests pass, ESLint exits 0, TypeScript exits 0, and the production build completes successfully.

- [ ] **Step 8: Commit Task 2**

```bash
git add \
  src/components/abbott-summary.ts \
  src/components/abbott-summary.test.ts \
  src/components/AbbottBiDashboard.tsx \
  src/components/AbbottBiDashboard.ui.test.ts
git commit -m "fix(abbott): align aggregate user filters on Logs visits"
```

---

### Task 3: Read-only production acceptance query

**Files:**
- No files modified.

**Interfaces:**
- Consumes: active Abbott canonical release, counter `90602537`, private visit facts, and dashboard `18` administrator exclusions.
- Produces: read-only evidence for the expected `ВСЕ` and `ВСЕ без админов` totals before any separately approved deployment.

- [ ] **Step 1: Run the existing read-only production query**

Query `report_bd_private.canonical_fact_metrika_visits` for release `49`, counter `90602537`, and `2026-08-01..2026-08-24`, using `EXISTS` against `portal_abbott_admin_user_exclusions` for dashboard `18`.

Expected result:

```text
all_visits=7974
admin_visits=47
without_admin_visits=7927
```

- [ ] **Step 2: Record the identified-visits acceptance value**

Run a read-only `COUNT(*)` over the same visit range with a non-empty `raw_user_ids_json` array.

Expected: the count becomes the acceptance value for `ВСЕ с User ID`; no Reports API value is substituted.

- [ ] **Step 3: Confirm operational scope**

Verify that no deployment, database write, migration, token change, cron edit, or release activation occurred. Report the implementation branch, commits, verification commands, and the three acceptance totals to the user.
