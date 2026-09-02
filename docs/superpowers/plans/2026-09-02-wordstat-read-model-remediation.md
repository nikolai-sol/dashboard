# Wordstat Read-Model Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Zaruku Wordstat read model report exact, endpoint-scoped canonical snapshot and collector state without torn metadata reads.

**Architecture:** Replace the global Wordstat run CTE with separate account-scoped `current|all`, `regions|all`, and `historical|all` run selectors. Each current endpoint statement returns its own selected coverage identity, coverage state, relevant run state, and left-joined facts, so the parser derives period and rows from the same result. Aggregate availability and freshness use conservative endpoint-state precedence.

**Tech Stack:** Next.js TypeScript, mysql2 read-only SQL, Node test runner, TypeScript compiler.

## Global Constraints

- Dashboard code reads canonical MySQL only; do not add provider, OAuth, token, API, migration, or production behavior.
- Account scope is mandatory; ignore legacy Wordstat runs that lack the `yandex_wordstat:<account>:<scope>` key contract.
- Preserve the fixed 2026-07-10 through 2026-07-31 historical coverage rules, reviewed-medical action gates, and non-overlapping `popular`/`all` irrelevant-demand base.
- `all` runs that are partial or failed affect every endpoint family unless a sanitized event proves narrower scope; this plan intentionally makes no such proof.

---

### Task 1: Reproduce controller findings with focused tests

**Files:**
- Modify: `src/lib/zaruku-wordstat.test.ts`
- Test: `src/lib/zaruku-wordstat.test.ts`

**Interfaces:**
- Consumes: `loadZarukuWordstatData(accountId, query)` and `buildZarukuWordstatQueries(accountId)`.
- Produces: failing specifications for endpoint run scopes, status precedence, snapshot ordering, atomic endpoint rows, and freshness.

- [x] **Step 1: Write failing tests**

```ts
assert.match(queries.currentQueries.sql, /:current'.*:all'/s);
assert.match(queries.currentRegions.sql, /:regions'.*:all'/s);
assert.match(queries.historicalRows.sql, /:historical'.*:all'/s);
assert.match(queries.currentQueries.sql, /ORDER BY coverage\.requested_to DESC, coverage\.requested_from DESC/i);
assert.equal(data.status, "partial");
assert.equal(data.source_freshness?.freshness_status, "delayed");
```

Add a fake runner whose query endpoint returns `{ window_from: "2026-08-03", window_to: "2026-09-01", query: "old" }` while a distinct metadata-shaped response would contain a later window. Assert the model exposes the returned endpoint window and `old` row, and assert no `wordstat:metadata` statement is requested.

- [x] **Step 2: Verify RED**

Run: `node --import tsx --test src/lib/zaruku-wordstat.test.ts`

Expected: FAIL because production SQL uses global `last_status`, orders snapshots by ingestion run, and parses periods from a separate metadata call.

### Task 2: Return current endpoint state and facts from the same query

**Files:**
- Modify: `src/lib/zaruku-wordstat.ts`
- Modify: `src/lib/zaruku-wordstat.test.ts`
- Test: `src/lib/zaruku-wordstat.test.ts`

**Interfaces:**
- Consumes: `canonical_wordstat_coverage`, current Wordstat canonical fact tables, and account-scoped collector runs.
- Produces: endpoint result rows with `window_from`, `window_to`, `scope_count`, `empty_scope_count`, `last_status`, timestamps, and nullable fact columns.

- [x] **Step 1: Implement exact endpoint CTEs**

```sql
ORDER BY coverage.requested_to DESC, coverage.requested_from DESC,
  coverage.updated_at DESC, coverage.id DESC, coverage.ingestion_run_id DESC
```

Use a one-row anchor left-joined to `latest_snapshot`, matching coverage counts, and the latest scoped run. Left join deduplicated facts to that state so `success_empty` still returns state with null fact columns.

- [x] **Step 2: Parse only endpoint rows**

```ts
const queryEndpoint = normalizeCurrentEndpointRows(queryRows, "query");
const queryPeriod = queryEndpoint.period;
const currentQueries = queryEndpoint.rows;
```

Do not issue or consume a separate current metadata statement.

- [x] **Step 3: Verify GREEN**

Run: `node --import tsx --test src/lib/zaruku-wordstat.test.ts`

Expected: PASS with the existing behavior plus atomic snapshot regression coverage.

### Task 3: Aggregate scoped run state and conservative freshness

**Files:**
- Modify: `src/lib/zaruku-wordstat.ts`
- Modify: `src/lib/zaruku-wordstat.test.ts`
- Test: `src/lib/zaruku-wordstat.test.ts`

**Interfaces:**
- Consumes: query, region, and historical endpoint state.
- Produces: top-level `available|partial|empty|unavailable` status and `ZarukuSourceFreshnessRow` that fail closed for uncertain scope lineage.

- [x] **Step 1: Implement scoped run selection and precedence**

```sql
runs.job_key IN (
  CONCAT('yandex_wordstat:', ?, ':current'),
  CONCAT('yandex_wordstat:', ?, ':all')
)
```

Use `regions` and `historical` in the equivalent endpoint statements. Evaluate endpoint failures, missing coverage, unknown account-scoped run lineage, rejected statements, and `periodsDiffer` before the all-empty branch.

- [x] **Step 2: Implement freshness aggregation**

```ts
const hasEndpointProblem = endpointStates.some((state) => state.coverageMissing || state.runStatus !== "success");
const freshnessStatus = hasEndpointProblem || periodsDiffer ? "delayed" : "healthy";
```

Keep `failed` for a relevant failed endpoint and never label a legacy-covered endpoint healthy.

- [x] **Step 3: Verify GREEN**

Run: `node --import tsx --test src/lib/zaruku-wordstat.test.ts src/lib/zaruku-seo.test.ts src/lib/account-read-models.test.ts`

Expected: all focused tests pass.

### Task 4: Complete verification, review, and report

**Files:**
- Modify: `/Users/nafanya/ReportingDash/.worktrees/zaruku-wordstat-demand/.superpowers/sdd/task-5-implementer-report.md`
- Test: dashboard full test suite and TypeScript compiler.

- [x] **Step 1: Verify the full app**

Run: `npm test && npx tsc --noEmit --pretty false && git diff --check`

Expected: all tests pass, typecheck passes, and no whitespace errors remain.

- [x] **Step 2: Self-review and commit**

Run: `git diff --check && git status --short`

Commit only app files with: `git commit -m "fix: harden Wordstat endpoint state"`.

- [x] **Step 3: Append evidence**

Record every RED and GREEN command/count, commit SHA, review result, and the lack of live MySQL/API/production actions in the Task 5 implementer report.
