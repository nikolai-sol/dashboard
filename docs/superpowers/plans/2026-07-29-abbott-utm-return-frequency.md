# Abbott UTM and Return-Frequency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact visit-level UTM Source filtering and count-first return-frequency analytics to Abbott, hide the external-transitions tab reversibly, and preserve every non-Abbott dashboard.

**Architecture:** Extend the existing Abbott Logs API visit contract and manager-only canonical visit table with nullable `utm_source`. Build arbitrary-period frequency aggregates from the active release’s private visit rows, return only aggregate client-hash results, and render those aggregates ahead of the existing Reports API recency control view. The application and operational repositories use coordinated branches/worktrees with the same name.

**Tech Stack:** Python 3/unittest, Yandex Metrika Logs API, MySQL 8, TypeScript, Next.js 16, React 19, Node test runner, Recharts, ESLint.

## Global Constraints

- Dashboard request, render, filter, export, and read-model code reads canonical MySQL only and never calls Yandex APIs or reads `METRIKA_TOKEN`.
- Abbott uses Reports API attribution `lastsign`; visit UTM uses `ym:s:lastsignUTMSource` from Logs API `source=visits`.
- One private row remains one Metrika visit in `report_bd_private.canonical_fact_metrika_visits`.
- Raw Client ID is never persisted; only `client_id_hash` is used for period-local visitor identity.
- Frequency groups are exactly `1`, `2–3`, and `4+` visits in the selected period.
- Active releases remain append-only. No existing active-release row is updated in place.
- Embed performs zero private-schema queries and receives no identifiers or client hashes.
- Bitrix remains test-only and is not used for return-frequency identity.
- Zaruku files and behavior must remain unchanged.
- No production deployment, production migration, API call, backfill, cron edit, Telegram send, or Hermes schedule is authorized by this plan.

---

## Execution worktrees

The application worktree already exists:

```bash
APP_WT=/Users/nafanya/ReportingDash/dashboard-next/.worktrees/codex-abbott-utm-return-frequency
git -C "$APP_WT" status --short --branch
```

Create the paired operational worktree before Task 1:

```bash
OPS_REPO=/Users/nafanya/ReportingDash
OPS_WT=/Users/nafanya/ReportingDash/.worktrees/codex-abbott-utm-return-frequency
git -C "$OPS_REPO" check-ignore -q .worktrees
git -C "$OPS_REPO" worktree add "$OPS_WT" -b codex/abbott-utm-return-frequency main
cd "$OPS_WT"
python3 -m unittest \
  tests.test_metrika_logs_api \
  tests.test_yandex_metrika_day_bundle \
  tests.test_yandex_metrika_atomic_writer \
  tests.test_abbott_schema_contract
```

Expected: the operational worktree is created from local `main`; all selected Python baseline tests pass.

---

### Task 1: Collect visit-level UTM Source from Logs API

**Files:**
- Modify in operational repo: `metrika_logs_api.py`
- Test in operational repo: `tests/test_metrika_logs_api.py`

**Interfaces:**
- Produces: every parsed visit dict has `utm_source: str | None`.
- Preserves: evaluate → create → poll → download all parts → clean in `finally`.

- [ ] **Step 1: Write failing parser and request-contract tests**

Add `ym:s:lastsignUTMSource` after `ym:s:lastsignTrafficSource` in the test `FIELDS` tuple. Add `utm_source` between `source` and `keys1` in `visit_row`, defaulting to `newsletter`. Extend the expected parsed row with `"utm_source": "newsletter"` and add:

```python
def test_normalizes_blank_utm_source_to_none(self):
    result = parse_visits_tsv(
        HEADER + "\n" + visit_row(utm_source="") + "\n",
        expected_day="2026-07-19",
    )
    self.assertIsNone(result[0]["utm_source"])
```

Keep the existing client assertions:

```python
self.assertEqual(params["fields"], ",".join(FIELDS))
self.assertEqual(params["attribution"], "lastsign")
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd "$OPS_WT"
python3 -m unittest tests.test_metrika_logs_api
```

Expected: FAIL because production `VISIT_FIELDS` and parsed visit rows do not contain `ym:s:lastsignUTMSource`/`utm_source`.

- [ ] **Step 3: Implement the minimal Logs parser change**

Update `VISIT_FIELDS` in `metrika_logs_api.py`:

```python
VISIT_FIELDS = (
    "ym:s:visitID",
    "ym:s:dateTime",
    "ym:s:startURL",
    "ym:s:endURL",
    "ym:s:pageViews",
    "ym:s:visitDuration",
    "ym:s:bounce",
    "ym:s:clientID",
    "ym:s:lastsignTrafficSource",
    "ym:s:lastsignUTMSource",
    "ym:s:parsedParamsKey1",
    "ym:s:parsedParamsKey2",
)
```

Unpack and normalize the new TSV field:

```python
(
    visit_id, date_time, start_url, end_url, page_views_text,
    duration_text, bounce_text, client_id, traffic_source,
    utm_source_text, level1_text, level2_text,
) = row
utm_source = utm_source_text if utm_source_text.strip() else None
```

Add `"utm_source": utm_source` to the returned visit dict.

- [ ] **Step 4: Verify GREEN and lifecycle regression coverage**

```bash
python3 -m unittest tests.test_metrika_logs_api
```

Expected: all parser, request, retry, download-order, and cleanup tests pass.

- [ ] **Step 5: Commit the operational parser change**

```bash
git add metrika_logs_api.py tests/test_metrika_logs_api.py
git commit -m "feat: collect Abbott visit UTM source"
```

---

### Task 2: Persist UTM Source in append-only canonical visits

**Files:**
- Modify in operational repo: `fetch_yandex_metrika_canonical.py`
- Modify in operational repo: `canonical_writer.py`
- Modify in operational repo: `ops/sql/abbott_private_schema_and_grants.sql`
- Modify in operational repo: `ops/abbott-runtime-manifest.sha256`
- Test in operational repo: `tests/test_yandex_metrika_day_bundle.py`
- Test in operational repo: `tests/test_yandex_metrika_atomic_writer.py`
- Test in operational repo: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Consumes: parsed visit `utm_source: str | None` from Task 1.
- Produces: release visit row and private canonical column `utm_source`.

- [ ] **Step 1: Write failing release-row tests**

In the valid visit fixture in `tests/test_yandex_metrika_day_bundle.py`, add:

```python
"utm_source": "email",
```

Assert the normalized release row contains:

```python
"traffic_source": "Search engine traffic",
"utm_source": "email",
```

In the blank-client test set `"utm_source": None` and assert `self.assertIsNone(row["utm_source"])`. Add `"utm_source"` to the incomplete-row deletion cases so a missing field fails closed with the existing sanitized error. Add malformed cases for a non-string value and a value longer than 500 characters; both must raise the existing sanitized collection error before the writer runs.

- [ ] **Step 2: Write failing writer and schema tests**

Extend the visit fixture in `tests/test_yandex_metrika_atomic_writer.py` with `"utm_source": "email"`, then require:

```python
self.assertIn("traffic_source, utm_source, start_url", sql)
self.assertIn("email", params[0])
```

Extend `tests/test_abbott_schema_contract.py` to require:

```python
"utm_source VARCHAR(500) DEFAULT NULL",
"idx_private_visit_release_utm",
```

and reject any `UPDATE report_bd_private.canonical_fact_metrika_visits` statement.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
python3 -m unittest \
  tests.test_yandex_metrika_day_bundle \
  tests.test_yandex_metrika_atomic_writer \
  tests.test_abbott_schema_contract
```

Expected: FAIL because release rows, writer SQL, and schema do not include `utm_source`.

- [ ] **Step 4: Implement collector validation and propagation**

Add `utm_source` to `_METRIKA_VISIT_KEYS`, read it in `_release_metrika_visit_rows`, validate it as nullable text no longer than 500 characters, and emit it:

```python
utm_source = visit["utm_source"]
if utm_source is not None and (
    not isinstance(utm_source, str) or len(utm_source) > 500
):
    raise MetrikaCollectionError("Metrika Logs visit row is invalid")

row = {
    "traffic_source": traffic_source,
    "utm_source": utm_source if utm_source and utm_source.strip() else None,
}
```

Keep `VISIT_FIELDS` inside the existing request fingerprint so this field-contract change produces a new fingerprint automatically.

- [ ] **Step 5: Implement the atomic writer change**

Add `row.get('utm_source')` after `row['traffic_source']` in `_insert_private_metrika_visit_rows`, and update SQL to contain:

```sql
traffic_source, utm_source, start_url, start_url_hash, end_url, end_url_hash,
session_started_at, session_ended_at, pageviews, duration_seconds,
is_bounce, request_fingerprint, ingestion_run_id
```

The unique key remains `(canonical_release_id, counter_id, report_date, visit_id_hash)`.

- [ ] **Step 6: Implement repeat-safe operational schema**

Add to the table definition:

```sql
utm_source VARCHAR(500) DEFAULT NULL,
KEY idx_private_visit_release_utm
  (canonical_release_id, report_date, utm_source(191)),
```

Add `information_schema.COLUMNS` and `information_schema.STATISTICS` guards that execute only `ALTER TABLE report_bd_private.canonical_fact_metrika_visits ADD COLUMN` and `ALTER TABLE report_bd_private.canonical_fact_metrika_visits ADD INDEX`; do not update historic rows.

- [ ] **Step 7: Refresh the operational runtime attestation and verify GREEN**

Replace only the SHA-256 lines for `metrika_logs_api.py`, `fetch_yandex_metrika_canonical.py`, and `canonical_writer.py` in `ops/abbott-runtime-manifest.sha256` using `shasum -a 256`. Then run:

```bash
python3 -m unittest \
  tests.test_yandex_metrika_day_bundle \
  tests.test_yandex_metrika_atomic_writer \
  tests.test_abbott_schema_contract
python3 -m unittest \
  tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure \
  tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_attested_runtime_uses_python38_compatible_syntax
```

Expected: all focused persistence, schema, attestation-hash, and Python 3.8 syntax tests pass.

- [ ] **Step 8: Commit the operational persistence change**

```bash
git add fetch_yandex_metrika_canonical.py canonical_writer.py \
  ops/sql/abbott_private_schema_and_grants.sql \
  ops/abbott-runtime-manifest.sha256 \
  tests/test_yandex_metrika_day_bundle.py \
  tests/test_yandex_metrika_atomic_writer.py \
  tests/test_abbott_schema_contract.py
git commit -m "feat: persist Abbott visit UTM source"
```

---

### Task 3: Add application migration and synchronized runtime closure

**Files:**
- Create: `src/db/migrations/044_abbott_private_visit_utm_source.sql`
- Create: `src/db/abbott-private-visit-utm-migration.test.ts`
- Modify: `scripts/deploy.sh`
- Modify: `src/lib/single-writer-contracts.test.ts`
- Replace synchronized copies under `reportingdash-canonical-bootstrap/{collectors,lib,runtime}/`
- Modify: `reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`

**Interfaces:**
- Consumes: reviewed operational sources from Tasks 1–2.
- Produces: deployable schema/runtime package matching root authorities byte-for-byte.

- [ ] **Step 1: Write failing migration and deploy-inventory tests**

Create `src/db/abbott-private-visit-utm-migration.test.ts`:

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("migration 044 adds Abbott visit UTM source and index repeat-safely", () => {
  const sql = readFileSync(path.resolve(
    "src/db/migrations/044_abbott_private_visit_utm_source.sql",
  ), "utf8");
  assert.match(sql, /TABLE_SCHEMA\s*=\s*'report_bd_private'/i);
  assert.match(sql, /TABLE_NAME\s*=\s*'canonical_fact_metrika_visits'/i);
  assert.match(sql, /ADD COLUMN utm_source VARCHAR\(500\) DEFAULT NULL/i);
  assert.match(sql, /ADD INDEX idx_private_visit_release_utm/i);
  assert.match(sql, /information_schema\.COLUMNS/i);
  assert.match(sql, /information_schema\.STATISTICS/i);
  assert.doesNotMatch(sql, /UPDATE\s+report_bd_private\.canonical_fact_metrika_visits/i);
});
```

Add to `src/lib/single-writer-contracts.test.ts`:

```typescript
test("deploy inventory packages the Metrika Logs visit parser", () => {
  const deploy = readFileSync(join(repoRoot, "scripts/deploy.sh"), "utf8");
  assert.match(deploy, /copy_canonical_file metrika_logs_api\.py/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd "$APP_WT"
node --import tsx --test \
  src/db/abbott-private-visit-utm-migration.test.ts \
  src/lib/single-writer-contracts.test.ts
```

Expected: FAIL because migration 044 and the deploy inventory entry do not exist.

- [ ] **Step 3: Add migration 044**

Use the prepared-statement pattern from migration 041. Required guarded DDL:

```sql
ALTER TABLE report_bd_private.canonical_fact_metrika_visits
  ADD COLUMN utm_source VARCHAR(500) DEFAULT NULL AFTER traffic_source
```

```sql
ALTER TABLE report_bd_private.canonical_fact_metrika_visits
  ADD INDEX idx_private_visit_release_utm
    (canonical_release_id, report_date, utm_source(191))
```

- [ ] **Step 4: Package and synchronize runtime dependencies**

Add `copy_canonical_file metrika_logs_api.py` to `scripts/deploy.sh`, then run:

```bash
cp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/collectors/fetch_yandex_metrika_canonical.py
cp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/runtime/fetch_yandex_metrika_canonical.py
cp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/lib/canonical_writer.py
cp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/runtime/canonical_writer.py
cp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/lib/metrika_logs_api.py
cp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/runtime/metrika_logs_api.py
```

Calculate SHA-256 values with `shasum -a 256` and replace only the six corresponding digest cells in `MIGRATION-MANIFEST.md`.

- [ ] **Step 5: Verify closure and GREEN**

```bash
cmp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/collectors/fetch_yandex_metrika_canonical.py
cmp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/runtime/fetch_yandex_metrika_canonical.py
cmp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/lib/canonical_writer.py
cmp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/runtime/canonical_writer.py
cmp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/lib/metrika_logs_api.py
cmp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/runtime/metrika_logs_api.py
node --import tsx --test \
  src/db/abbott-private-visit-utm-migration.test.ts \
  src/lib/single-writer-contracts.test.ts
```

Expected: every `cmp` returns 0 and both Node test files pass.

- [ ] **Step 6: Commit application schema/runtime closure**

```bash
git add src/db/migrations/044_abbott_private_visit_utm_source.sql \
  src/db/abbott-private-visit-utm-migration.test.ts scripts/deploy.sh \
  src/lib/single-writer-contracts.test.ts reportingdash-canonical-bootstrap
git commit -m "feat: package Abbott visit UTM schema"
```

### Task 4: Build the period-local return-frequency calculator

**Files:**

- Create: `src/lib/abbott-return-frequency.ts`
- Create: `src/lib/abbott-return-frequency.test.ts`
- Create: `src/lib/abbott-page-url.ts`
- Create: `src/lib/abbott-page-url.test.ts`
- Modify: `src/lib/abbott-bi.ts`
- Modify: `src/lib/types.ts`
- Modify: Abbott test fixtures found by `rg 'AbbottBiData|returning:' src --glob '*.{ts,tsx}'`

- [ ] **Step 1: Write calculator and type tests first**

Define these public result types in `src/lib/types.ts`:

```typescript
export type AbbottVisitFrequencyGroupId = "one" | "two_to_three" | "four_plus";

export type AbbottBiVisitFrequencyGroup = {
  group_id: AbbottVisitFrequencyGroupId;
  label: "1 раз" | "2–3 раза" | "4+ раза";
  visitors: number;
  share: number;
  visits: number;
};

export type AbbottBiReturningUserDirectionRow = {
  direction: string;
  frequency_group: Exclude<AbbottVisitFrequencyGroupId, "one">;
  visitors: number;
  repeat_visits: number;
};

export type AbbottBiReturningPageRow = {
  url: string;
  direction: string;
  frequency_group: Exclude<AbbottVisitFrequencyGroupId, "one">;
  returning_visitors: number;
  repeat_visits: number;
};

export type AbbottBiReturnFrequency = {
  available: boolean;
  period_local: true;
  identified_visitors: number;
  unidentified_visits: number;
  groups: AbbottBiVisitFrequencyGroup[];
  user_directions: AbbottBiReturningUserDirectionRow[];
  return_pages: AbbottBiReturningPageRow[];
};
```

Add `return_frequency: AbbottBiReturnFrequency` to `AbbottBiData`. Update `emptyAbbottData` and every existing Abbott fixture with a shared empty frequency value whose three arrays are empty, counts are zero, `available` is `false`, and `period_local` is `true`.

In the new test, use exact visits that prove all rules:

- client A has one visit;
- client B has two visits;
- client C has three visits;
- client D has four visits;
- two visits have `client_id_hash = null` and increment only `unidentified_visits`;
- one client maps to exactly one user direction;
- one client maps to two directions and becomes `Несколько направлений`;
- one client has no mapped user direction and becomes `Направление не определено`;
- two repeat landings normalize to the same canonical page and aggregate together;
- two visits with the same timestamp are ordered by `visit_id_hash`.

The expected visitor denominator is four, group counts are `1 / 2 / 1`, and shares are `25 / 50 / 25`.

- [ ] **Step 2: Run the new test and verify RED**

```bash
cd "$APP_WT"
node --import tsx --test \
  src/lib/abbott-page-url.test.ts \
  src/lib/abbott-return-frequency.test.ts
```

Expected: FAIL because the calculator module and new return-frequency types do not exist.

- [ ] **Step 3: Implement a pure deterministic calculator**

First extract the existing `normalizePage` body from `src/lib/abbott-bi.ts` into exported `normalizeAbbottPageUrl` in `src/lib/abbott-page-url.ts`. Update every Abbott BI call site to import that function, and add regression cases for absolute URLs, duplicate slashes, query/fragment removal, root paths, and relative paths. This avoids a circular import or duplicated page identity logic.

Use this private input boundary in `src/lib/abbott-return-frequency.ts`:

```typescript
export type AbbottFrequencyVisit = {
  client_id_hash: string | null;
  raw_user_ids: string[];
  visit_id_hash: string;
  session_started_at: string;
  start_url: string;
};
```

The exported calculator receives:

```typescript
buildAbbottReturnFrequency(
  visits: AbbottFrequencyVisit[],
  directionByUserId: ReadonlyMap<string, string | null>,
  resolvePageDirection: (normalizedUrl: string) => string | null,
): AbbottBiReturnFrequency
```

Implement the approved rules exactly:

1. Ignore null client hashes for visitor grouping and count those rows in `unidentified_visits`.
2. Group identified visits by `client_id_hash`.
3. Sort within each visitor by `session_started_at`, then `visit_id_hash`.
4. Classify visit counts as `one`, `two_to_three`, or `four_plus`.
5. Calculate `share` against identified visitors only; return zero when the denominator is zero.
6. Resolve a visitor direction from distinct non-empty directions mapped from all visit User IDs: one value uses that value, zero values use `Направление не определено`, multiple values use `Несколько направлений`.
7. Treat visits after the first as repeat visits.
8. Normalize each repeat `start_url` with `normalizeAbbottPageUrl`, then call `resolvePageDirection` for the exact canonical hashed-path lookup; missing direction uses `Направление не определено`.
9. Aggregate returning visitors with a `Set` and repeat visits with a counter so one visitor is never counted twice in the same page/direction/group row.
10. Sort groups in the fixed order and aggregate rows by descending visitor count, then descending repeat visits, then Russian label via `localeCompare("ru")`.

- [ ] **Step 4: Run focused tests and repair fixtures**

```bash
node --import tsx --test \
  src/lib/abbott-page-url.test.ts \
  src/lib/abbott-return-frequency.test.ts
npm run typecheck
```

Expected: URL regression tests, calculator tests, and typecheck pass. Typecheck is the guard that every `AbbottBiData` fixture and loader path now supplies `return_frequency`.

- [ ] **Step 5: Commit the calculator**

```bash
git add src/lib/abbott-page-url.ts src/lib/abbott-page-url.test.ts \
  src/lib/abbott-return-frequency.ts src/lib/abbott-return-frequency.test.ts \
  src/lib/abbott-bi.ts src/lib/types.ts src/lib/abbott-data-projection.test.ts
git commit -m "feat: calculate Abbott return frequency"
```

### Task 5: Connect private Abbott visits to the manager read model

**Files:**

- Modify: `src/lib/abbott-bi.ts`
- Modify: `src/lib/abbott-bi-loader.test.ts`
- Create: `src/lib/abbott-bi-loader-source.test.ts`
- Modify: `src/lib/abbott-data-projection.ts`
- Modify: `src/lib/abbott-data-projection.test.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Write failing loader and projection tests**

Extend the manager loader fixture with visit rows containing `visit_id_hash`, `session_started_at`, `utm_source`, client hashes, raw User IDs, start URLs, and the visit counts from Task 4.

Assert that:

- manager user-action rows expose normalized nullable `utm_source`;
- `return_frequency.available` is true and matches the pure-calculator expectations;
- the private query requests `visit_id_hash`, `session_started_at`, and `utm_source` from `canonical_fact_metrika_visits`;
- embed mode performs zero private queries and returns an unavailable empty `return_frequency` object;
- the embed projection returns no frequency rows or visit/client identifiers;
- manager return-page URLs have query strings and fragments removed at the projection boundary;
- an unavailable `return_frequency` remains empty after projection.

Add source-contract assertions that the dashboard loader imports and calls `buildAbbottReturnFrequency`, while the aggregate returning loader remains unchanged.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd "$APP_WT"
node --import tsx --test \
  src/lib/abbott-bi-loader.test.ts \
  src/lib/abbott-bi-loader-source.test.ts \
  src/lib/abbott-data-projection.test.ts
```

Expected: FAIL because the private visit projection does not yet select UTM/time/visit identity or build the new block.

- [ ] **Step 3: Extend the private visit read model**

Add `utm_source: string | null` to `AbbottBiUserActionRow`, then modify only the Abbott manager query in `src/lib/abbott-bi.ts` to select:

```sql
visit_id_hash,
session_started_at,
utm_source,
raw_user_id,
raw_user_ids_json,
client_id_hash,
traffic_source,
start_url,
end_url,
pageviews,
duration_seconds,
is_bounce
```

Keep the existing release, counter, and selected-date predicates. Do not add any source API call or OAuth dependency.

Normalize `utm_source` with trim-to-null semantics when building `AbbottBiUserActionRow`. Pass the existing `workbook.userDirections` map and a page resolver that returns `workbook.urlReturnDirections.get(lookupHash(normalizedPagePath(url)))?.direction ?? null` to `buildAbbottReturnFrequency`, then attach its result to manager data.

Validate the private calculator inputs before aggregation: `visit_id_hash` must be a non-empty string, `session_started_at` must be a valid timestamp, `client_id_hash` must be a non-empty string or null, and raw User IDs must continue to satisfy the existing singular/JSON identity contract. Any malformed canonical private row fails closed through the existing unavailable-data path; it is never skipped or coerced into another visitor.

For embed mode, return the explicit empty value:

```typescript
{
  available: false,
  period_local: true,
  identified_visitors: 0,
  unidentified_visits: 0,
  groups: [],
  user_directions: [],
  return_pages: [],
}
```

- [ ] **Step 4: Harden the projection boundary**

Teach `src/lib/abbott-data-projection.ts` to sanitize `return_frequency.return_pages[].url` through the existing public URL sanitizer. The projection must not invent an available private block; unavailable input stays unavailable and empty.

- [ ] **Step 5: Run focused tests and GREEN**

```bash
node --import tsx --test \
  src/lib/abbott-return-frequency.test.ts \
  src/lib/abbott-bi-loader.test.ts \
  src/lib/abbott-bi-loader-source.test.ts \
  src/lib/abbott-data-projection.test.ts
```

Expected: all focused loader, calculator, source-contract, and projection tests pass.

- [ ] **Step 6: Commit the read-model change**

```bash
git add src/lib/abbott-bi.ts src/lib/abbott-bi-loader.test.ts \
  src/lib/abbott-bi-loader-source.test.ts src/lib/abbott-data-projection.ts \
  src/lib/abbott-data-projection.test.ts src/lib/types.ts
git commit -m "feat: expose Abbott UTM and return frequency"
```

### Task 6: Update the Abbott-only dashboard interface

**Files:**

- Create: `src/components/abbott/abbott-user-action-filters.ts`
- Create: `src/components/abbott/abbott-user-action-filters.test.ts`
- Create: `src/components/abbott/abbott-return-frequency-ui.ts`
- Create: `src/components/abbott/abbott-return-frequency-ui.test.ts`
- Modify: `src/components/AbbottBiDashboard.tsx`
- Modify: `src/components/AbbottBiDashboard.ui.test.ts`

- [ ] **Step 1: Write pure UI-model tests**

In `abbott-user-action-filters.test.ts`, prove that:

- distinct non-empty UTM sources become alphabetically sorted options;
- null and blank values create one option `{ value: "__without_utm__", label: "Без UTM" }`;
- the empty select value used by `SelectField` preserves all rows and renders as `Все`;
- a concrete source matches exactly;
- `__without_utm__` matches null and blank only;
- UTM filtering composes with User ID, traffic source, direction, and pagination by filtering before slicing.

Define a local structural option type in the helper; do not import component-private `SelectOption`.

In `abbott-return-frequency-ui.test.ts`, prove fixed Russian labels, count-first chart values, percentage formatting, direction/page filter options, and empty/unavailable states without rendering React.

- [ ] **Step 2: Add component source-contract tests and verify RED**

Extend `AbbottBiDashboard.ui.test.ts` to assert:

- `buildTabs` no longer contains the label `4. Внешние переходы`;
- the existing external-page rendering branches and data fields still exist for reversible restoration;
- the actions tab contains the label `UTM Source`, the `Без UTM` sentinel, and a UTM column;
- the actions-tab description states that one row is one Metrika visit and that UTM/User ID/URLs belong to that same visit;
- the returning tab contains `Количество заходов за выбранный период`, `Направления вернувшихся пользователей`, and `Страницы возврата`;
- the previous Reports API block remains under `Интервалы возврата по Метрике`;
- the frequency chart uses visitor counts as values and percentages only as supplemental labels.

Run:

```bash
cd "$APP_WT"
node --import tsx --test \
  src/components/abbott/abbott-user-action-filters.test.ts \
  src/components/abbott/abbott-return-frequency-ui.test.ts \
  src/components/AbbottBiDashboard.ui.test.ts
```

Expected: FAIL because the helpers and new UI contracts do not exist.

- [ ] **Step 3: Add the UTM Source filter and column on tab 2**

In `src/components/AbbottBiDashboard.tsx`:

1. Replace the obsolete aggregated-estimate description with: `Одна строка — один визит Метрики. User ID, источник, UTM Source, начальный и конечный URL относятся к одному и тому же визиту.`
2. Add `utm_source: ""` to `filtersByTab.user_actions`; the empty value is the existing `Все` convention.
3. Derive options from the full manager action set.
4. Add the `UTM Source` select after `Источник` and before `Направление`.
5. Apply UTM filtering before pagination.
6. Render `Без UTM` for null/blank values in the table.
7. Include UTM Source in free-text search and in the filtered chart input.
8. Reset the page index when UTM selection changes.

Keep `User ID` as the established Russian-market technical term requested by the user.

- [ ] **Step 4: Hide external transitions from navigation only**

Remove the external tab descriptor from `buildTabs`. Do not delete its types, loader, chart/table rendering branch, theme, or canonical collection. This keeps rollback to a menu-only one-line change and prevents unrelated data-plane churn.

- [ ] **Step 5: Rework tab 5 around visit counts**

Render the new manager-only block above the old recency block:

- three KPI cards for `1 визит`, `2–3 визита`, and `4+ визита`, each with visitor count and percentage;
- a three-bar chart for `1 раз`, `2–3 раза`, `4+ раза` whose primary values are visitor counts;
- count and percentage in each tooltip/label;
- filters for frequency group, user direction, page direction, and page URL;
- a user-direction table with visitors and repeat visits;
- a `Страницы возврата` table with normalized page URL, direction, returning visitors, and repeat visits;
- a note that returning-visitor counts across different page rows are non-additive;
- a compact data-quality note for visits without a client hash;
- explicit unavailable and no-data messages without zero-filled cards in embed mode.

Keep the existing Reports API percentage charts/table below under `Интервалы возврата по Метрике`. Do not reinterpret those values as the new period-local frequency metric.

- [ ] **Step 6: Run Abbott UI tests and GREEN**

```bash
node --import tsx --test \
  src/components/abbott/abbott-user-action-filters.test.ts \
  src/components/abbott/abbott-return-frequency-ui.test.ts \
  src/components/AbbottBiDashboard.ui.test.ts
```

Expected: all Abbott filter, UI-model, and component-contract tests pass.

- [ ] **Step 7: Commit the Abbott UI**

```bash
git add src/components/AbbottBiDashboard.tsx src/components/AbbottBiDashboard.ui.test.ts \
  src/components/abbott
git commit -m "feat: update Abbott actions and returning tabs"
```

### Task 7: Document rollout gates and finish both isolated branches

**Files:**

- Modify in operations worktree: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`
- Create in operations worktree: `tests/test_abbott_utm_rollout_runbook.py`
- Modify: `reportingdash-canonical-bootstrap/README.md`
- Modify: `DASHBOARDS-MEMORY.md`
- Modify: `CANONICAL-ENTITIES-MEMORY.md`
- Modify in operations worktree: `dashboard-next` gitlink

- [ ] **Step 1: Test and add the successor-release rollout procedure**

Create `tests/test_abbott_utm_rollout_runbook.py` first. It reads only `docs/ABBOTT-OPERATIONS-RUNBOOK.md` and asserts the exact migration number, successor-release rule, UTM/frequency comparison metrics, session integrity equation, manager/embed boundary, rollback rule, and unchanged cron times listed below. Run it once and confirm RED before editing documentation.

```bash
cd "$OPS_WT"
python3 -m unittest tests.test_abbott_utm_rollout_runbook
```

Expected: FAIL because the runbook does not yet contain the Abbott UTM/frequency successor-release procedure.

Document these production steps as deferred operator work, not actions performed by this implementation:

1. Apply migration 044 after a database backup and verify the column and index through `information_schema`.
2. Start a new append-only Abbott successor release; never update the active release in place.
3. Backfill every requested date with the updated Logs visit collector and its normal evaluate/create/poll/download/clean lifecycle.
4. Require successful run status, complete expected-date coverage, and zero bad coverage rows.
5. Compare old and candidate releases for total visit rows, distinct visit hashes, User ID coverage, null client-hash count, direction mapping coverage, and UTM populated/null counts.
6. Validate `all = with_user_id + without_user_id` for every date/source before publication.
7. Confirm manager-only UTM/frequency reads and zero embed private queries.
8. Perform the reviewed cutover, application deploy, authenticated manager smoke test, embed smoke test, and rollback if smoke fails.
9. Do not restore public PII assets during rollback.

State that current collection times stay `06:12`, health `07:05`, summary `07:10`, and that the summary integrity mismatch remains `CRITICAL`.

- [ ] **Step 2: Verify operations tests and synchronized closure**

```bash
cd "$OPS_WT"
python3 -m unittest \
  tests.test_metrika_logs_api \
  tests.test_yandex_metrika_day_bundle \
  tests.test_yandex_metrika_atomic_writer \
  tests.test_abbott_schema_contract \
  tests.test_abbott_utm_rollout_runbook
python3 -m unittest \
  tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_runtime_manifest_covers_runbook_entrypoints_and_local_import_closure \
  tests.test_abbott_runtime_closure.AbbottRuntimeClosureTest.test_attested_runtime_uses_python38_compatible_syntax

cd "$APP_WT"
cmp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/collectors/fetch_yandex_metrika_canonical.py
cmp "$OPS_WT/fetch_yandex_metrika_canonical.py" reportingdash-canonical-bootstrap/runtime/fetch_yandex_metrika_canonical.py
cmp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/lib/canonical_writer.py
cmp "$OPS_WT/canonical_writer.py" reportingdash-canonical-bootstrap/runtime/canonical_writer.py
cmp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/lib/metrika_logs_api.py
cmp "$OPS_WT/metrika_logs_api.py" reportingdash-canonical-bootstrap/runtime/metrika_logs_api.py
```

Expected: all operations tests pass and all six comparisons return exit code 0.

- [ ] **Step 3: Commit application documentation**

```bash
cd "$APP_WT"
git add reportingdash-canonical-bootstrap/README.md DASHBOARDS-MEMORY.md CANONICAL-ENTITIES-MEMORY.md
git diff --cached --quiet || git commit -m "docs: add Abbott UTM rollout gates"
```

- [ ] **Step 4: Rebase onto the latest application main without losing other dashboards**

```bash
cd "$APP_WT"
git fetch origin
git rebase origin/main
```

Expected: the feature commits are replayed on the latest `origin/main`. If a conflict touches a shared dashboard or Zaruku behavior, preserve the latest main implementation and reapply only the Abbott-specific hunk, then rerun every gate below. Do not resolve a conflict by restoring an older whole file.

- [ ] **Step 5: Run the full application quality gates**

```bash
cd "$APP_WT"
npm test
npm run security:public-assets
npm run lint
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

Expected: all commands pass. Record existing dependency-audit findings separately if `npm audit` still reports the baseline vulnerabilities; do not silently widen this Abbott feature into a dependency upgrade.

- [ ] **Step 6: Prove that Zaruku was not changed**

```bash
cd "$APP_WT"
if git diff --name-only origin/main...HEAD | rg -i 'zaruku|zaruk|zaruq'; then
  echo "ERROR: Abbott branch contains Zaruku paths" >&2
  exit 1
fi
if git diff -U0 origin/main...HEAD -- src | rg -P '^[+-](?![+-]).*(?i:zaruku|zaruk|zaruq)'; then
  echo "ERROR: Abbott branch changes Zaruku code in a shared file" >&2
  exit 1
fi
```

Expected: `rg` returns no path and the guard exits successfully. Also inspect the complete changed-file list and reject any unrelated dashboard file before committing.

- [ ] **Step 7: Point the isolated operations branch at the application branch**

```bash
cd "$OPS_WT"
APP_SHA=$(git -C "$APP_WT" rev-parse HEAD)
git update-index --add --cacheinfo "160000,$APP_SHA,dashboard-next"
git add metrika_logs_api.py fetch_yandex_metrika_canonical.py canonical_writer.py \
  ops/sql/abbott_private_schema_and_grants.sql ops/abbott-runtime-manifest.sha256 \
  tests/test_metrika_logs_api.py tests/test_yandex_metrika_day_bundle.py \
  tests/test_yandex_metrika_atomic_writer.py tests/test_abbott_schema_contract.py \
  tests/test_abbott_utm_rollout_runbook.py docs/ABBOTT-OPERATIONS-RUNBOOK.md
git commit -m "chore: pin Abbott UTM dashboard branch"
```

This root commit records the exact application commit used by the paired feature branch without touching either repository's `main` branch.

- [ ] **Step 8: Final clean-tree and non-deployment verification**

```bash
git -C "$APP_WT" status --short
git -C "$OPS_WT" status --short
git -C "$APP_WT" log -1 --oneline
git -C "$OPS_WT" log -1 --oneline
```

Expected: both status outputs are empty. Report the two branch names and commit SHAs, test/build results, the explicit Zaruku no-change check, and the deferred migration/backfill/cutover/deploy steps. Do not merge, deploy, call Yandex APIs, alter cron, send Telegram, or schedule Hermes until the user separately authorizes production rollout.
