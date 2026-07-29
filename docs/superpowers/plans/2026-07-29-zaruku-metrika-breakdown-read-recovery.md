# Zaruku Metrika Breakdown Read Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Zaruku Metrika breakdown reads so the Audience tab remains visible whenever canonical coverage is complete, without weakening SQL parameterization for account IDs, report keys, or dates.

**Architecture:** Keep the existing two-query fail-closed loader and `mysql2.execute()` prepared-statement path. Inline only the fixed presentation limits from `ZARUKU_METRIKA_BREAKDOWN_REPORTS`, because MySQL 8.0.42 rejects numeric `LIMIT ?` values sent by mysql2's binary protocol with `ER_WRONG_ARGUMENTS`, while all data predicates remain bound parameters. Add a regression contract that prevents `LIMIT ?` from returning.

**Tech Stack:** TypeScript, Node test runner, mysql2 3.19, Next.js 16, MySQL 8.0.42, PM2.

## Global Constraints

- Preserve the current fail-closed completeness gate: every report requires exact daily coverage with `pagination_complete = 1` and `status IN ('success', 'empty')`.
- Do not change collector schedules, collector data, database schemas, authentication, or source freshness rules.
- Keep account IDs, report keys, and date boundaries parameterized.
- Inline only numeric limits defined in the trusted `ZARUKU_METRIKA_BREAKDOWN_REPORTS` constant.
- Verify the selected production period `2026-07-01..2026-07-27`, where all twelve reports have confirmed `27/27` coverage.

---

### Task 1: Lock the mysql2 LIMIT regression contract

**Files:**
- Modify: `src/lib/zaruku-metrika.test.ts:10-46`
- Test: `src/lib/zaruku-metrika.test.ts`

**Interfaces:**
- Consumes: `buildZarukuMetrikaBreakdownQueries(accountIds, range)`.
- Produces: a regression test requiring literal presentation limits and rejecting `LIMIT ?` while preserving all other bound parameters.

- [x] **Step 1: Write the failing test**

Replace the existing `LIMIT ?` assertions with:

```ts
assert.match(sql, new RegExp(`GROUP\\s+BY[\\s\\S]*LIMIT\\s+${report.limit + 1}\\b`, "i"));
assert.doesNotMatch(sql, /LIMIT\s+\?/i);
assert.equal(
  queries.detail.params.filter((value) => typeof value === "number").length,
  0,
);
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test src/lib/zaruku-metrika.test.ts`

Expected: FAIL because the generated SQL still contains `LIMIT ?` and twelve numeric limit parameters.

- [x] **Step 3: Confirm the failure is the production failure class**

Run the current generated detail query against production with `mysql2.execute()`.

Expected: `ER_WRONG_ARGUMENTS`, errno `1210`, `Incorrect arguments to mysqld_stmt_execute`.

### Task 2: Remove only the incompatible LIMIT bindings

**Files:**
- Modify: `src/lib/zaruku-metrika.ts:67-169`
- Modify: `DASHBOARDS-MEMORY.md`
- Test: `src/lib/zaruku-metrika.test.ts`

**Interfaces:**
- Consumes: trusted integer `report.limit` values from `ZARUKU_METRIKA_BREAKDOWN_REPORTS`.
- Produces: detail SQL with `LIMIT ${report.limit + 1}` literals and parameter arrays containing only account IDs, report keys, and date bounds.

- [x] **Step 1: Implement the minimal SQL change**

In `reportDetailSql`, calculate the trusted bound and embed it:

```ts
const presentationLimit = report.limit + 1;
// mysql2 execute() sends JS numbers through the binary protocol as DOUBLE;
// MySQL rejects that type in LIMIT with ER_WRONG_ARGUMENTS. This value is a
// trusted code constant, while all data predicates remain parameterized.
...
LIMIT ${presentationLimit}
```

Remove `report.limit + 1` from `detailParams`:

```ts
const detailParams = ZARUKU_METRIKA_BREAKDOWN_REPORTS.flatMap((report) => [
  ...normalizedAccountIds,
  report.key,
  range.from,
  range.to,
]);
```

- [x] **Step 2: Run the focused test and verify GREEN**

Run: `node --import tsx --test src/lib/zaruku-metrika.test.ts`

Expected: all Zaruku Metrika tests pass.

- [x] **Step 3: Record the confirmed runtime rule**

Add a concise entry to `DASHBOARDS-MEMORY.md` documenting the MySQL/mysql2 LIMIT incompatibility, the literal-limit rule, and the regression test.

### Task 3: Verify, commit, deploy, and prove the UI recovery

**Files:**
- Verify: `src/lib/zaruku-metrika.ts`
- Verify: `src/lib/zaruku-metrika.test.ts`
- Verify: `DASHBOARDS-MEMORY.md`

**Interfaces:**
- Consumes: corrected generated queries and the existing production deploy workflow.
- Produces: a committed and deployed dashboard release with confirmed Audience and quality states.

- [x] **Step 1: Execute the corrected query through production mysql2 prepared statements**

Run the generated detail query with the application DB credentials and `mysql2.execute()`.

Expected: `OK rows=3671`, with no `ER_WRONG_ARGUMENTS`.

- [x] **Step 2: Run the full verification suite**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits `0` with no failing tests or build errors.

- [x] **Step 3: Commit the focused fix**

```bash
git add src/lib/zaruku-metrika.ts src/lib/zaruku-metrika.test.ts DASHBOARDS-MEMORY.md docs/superpowers/plans/2026-07-29-zaruku-metrika-breakdown-read-recovery.md
git commit -m "fix(zaruku): restore metrika breakdown reads"
```

- [x] **Step 4: Deploy through the existing release workflow**

Run: `npm run deploy`

Expected: build, staged upload, atomic release swap, PM2 restart, and health check all succeed.

- [x] **Step 5: Verify production state**

Check PM2 and both health endpoints, then open a fresh Zaruku dashboard response for `2026-07-01..2026-07-27`.

Expected:

- navigation includes `Аудитория`;
- all twelve Metrika breakdown reports are available;
- quality no longer reports the thirteen breakdown-dependent datasets as unavailable;
- Metrika, Webmaster, and GSC freshness remains current.
