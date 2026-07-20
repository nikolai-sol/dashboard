# Abbott Session Traffic Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Abbott traffic totals, User ID partitions, sources and private journeys mutually consistent with Yandex Metrica, while presenting the Abbott dashboard fully in Russian.

**Architecture:** The aggregate Reports API publishes three source summaries with one `lastsign` attribution contract: `all`, `with_user_id`, and `without_user_id`. The private `user_behavior` scope is collected from Logs API `source=visits`, where one database row is one Metrica visit and raw User ID remains manager-only. The UI selects aggregate partitions for traffic filters and visit rows only for a concrete User ID or direction.

**Tech Stack:** Python 3.11, `requests`, `unittest`, MySQL 8/InnoDB, TypeScript 5, Node test runner, Next.js 16, React 19.

## Global Constraints

- Work only in `/Users/nafanya/ReportingDash/.worktrees/abbott-canonical-private-foundation` on `codex/abbott-canonical-private-foundation`; do not deploy or mutate production API, DB, env, cron, tokens, Telegram or Hermes.
- Abbott counter is exactly `90602537`; no other counter satisfies coverage or health.
- Keep the five release scopes exactly `other`, `traffic`, `page`, `user_behavior`, and `returning`.
- Aggregate traffic attribution is exactly `lastsign`; `all`, `with_user_id`, and `without_user_id` use the same dimensions, metrics, dates, timezone and attribution.
- A visit has User ID only when the same session-parameter tuple contains level 1 `UserID` and a non-empty level 2 value. The two presence filters are exact `EXISTS(...)` and `NONE(...)` complements.
- For every counter/day/source, `all.sessions = with_user_id.sessions + without_user_id.sessions`; failure blocks publication.
- Raw User ID, visit ID, client ID, raw start URL and raw end URL live only in `report_bd_private`; embed responses and aggregate tables never expose them.
- Logs API collection uses `source=visits`, cleans prepared log requests in `finally`, never logs response bodies, and treats evaluate/create/status/download/clean failures as sanitized scope failures.
- Existing Bitrix dump behavior remains test-only and unchanged; no live Bitrix connector is introduced.
- UI localization changes display labels only. Raw traffic-source values remain unchanged in API payloads, filters, comparisons and exports.
- Preserve common Russian-market terms `ID`, `URL`, `UTM`, `API`, `SQL`, `CRM`, `CTR`, and `SEO`.
- Every production-code change follows red-green-refactor and is committed at its task boundary.

---

### Task 1: Russian Abbott presentation and raw source labels

**Files:**
- Create: `dashboard-next/src/components/abbott-localization.ts`
- Create: `dashboard-next/src/components/abbott-localization.test.ts`
- Create: `dashboard-next/src/components/AbbottBiDashboard.ui.test.ts`
- Modify: `dashboard-next/src/components/AbbottBiDashboard.tsx`

**Interfaces:**
- Produces: `abbottTrafficSourceLabel(raw: string): string` and `abbottTrafficSourceOption(raw: string): { value: string; label: string }`.
- Preserves: raw `traffic_source` in filter state and data rows.

- [ ] **Step 1: Write source-label RED tests**

Test exact display mappings for `Direct traffic`, `Link traffic`, `Search engine traffic`, `Internal traffic`, `Unknown traffic`, and `Registered portal behavior`. Assert that `Custom CRM / SEO traffic` is returned unchanged and that option `value` remains raw.

- [ ] **Step 2: Verify source-label RED**

Run:

```bash
cd dashboard-next
node --import tsx --test src/components/abbott-localization.test.ts
```

Expected: fail because `abbott-localization.ts` does not exist.

- [ ] **Step 3: Implement display-only source localization**

Create the exact raw-to-Russian map and return `Неизвестный источник` only for blank/known unknown inputs. Do not mutate `AbbottBiData`.

- [ ] **Step 4: Write dashboard-copy RED tests**

Require the manager description to equal:

```text
По умолчанию сессии и источники берутся из Метрики, Источники трафика. При выборе User ID, типа трафика или направления включается User ID-детализация.
```

Require visible `All`, `Search`, `Avg duration`, `Avg depth`, `Event Title`, `Direction`, `External URL`, `Outbound Clicks`, `Material Name`, `Pageviews`, `Users`, `UTM source`, `UTM campaign`, `Session ID`, `Bitrix dump`, `SQL dump`, `Bitrix events`, and `Grain:` to be absent from the component source. Require localized source labels in options, tables, search values and charts while raw equality filters remain.

- [ ] **Step 5: Verify dashboard-copy RED**

Run:

```bash
cd dashboard-next
node --import tsx --test src/components/AbbottBiDashboard.ui.test.ts
```

Expected: fail on the existing English copy and missing helper calls.

- [ ] **Step 6: Implement Russian copy and chart labels**

Translate ordinary English copy, use `Все` for empty selections and `Поиск` for search. Keep technical keys and accepted abbreviations unchanged. Add Russian tooltip names instead of raw `duration_minutes`, `value`, `users`, `clicks`, `pageviews`, `overall`, and `materials`.

- [ ] **Step 7: Verify and commit**

```bash
cd dashboard-next
node --import tsx --test src/components/abbott-localization.test.ts src/components/AbbottBiDashboard.ui.test.ts
npm run typecheck
git add src/components/abbott-localization.ts src/components/abbott-localization.test.ts src/components/AbbottBiDashboard.ui.test.ts src/components/AbbottBiDashboard.tsx
git commit -m "fix: localize Abbott dashboard copy"
```

---

### Task 2: Exact Reports API User ID partitions and last-significant attribution

**Files:**
- Modify: `fetch_yandex_metrika_canonical.py`
- Modify: `tests/test_yandex_metrika_day_bundle.py`
- Modify: `tests/test_abbott_canonical_controls.py`
- Modify: `tests/test_yandex_metrika_atomic_writer.py`

**Interfaces:**
- Produces: `ABBOTT_USER_ID_CONDITION`, `ABBOTT_OTHER_SEGMENTS`, and `collect_other_scope(...) -> MetrikaScopeResult`.
- Stores: `scope_dimensions.user_id_presence` as exactly `all`, `with_user_id`, or `without_user_id` for `analytics_scope='other'`.

- [ ] **Step 1: Write Reports-contract RED tests**

Require three fully paginated source requests for `other`:

```python
(
    ('all', ''),
    ('with_user_id', "EXISTS(ym:s:paramsLevel1=='UserID' AND ym:s:paramsLevel2!='')"),
    ('without_user_id', "NONE(ym:s:paramsLevel1=='UserID' AND ym:s:paramsLevel2!='')"),
)
```

All three must render `ym:s:lastsignTrafficSource`, pass `attribution='lastsign'`, and carry distinct fingerprints.

- [ ] **Step 2: Verify Reports-contract RED**

```bash
python3 -m unittest tests.test_yandex_metrika_day_bundle tests.test_abbott_canonical_controls -v
```

Expected: fail because `other` currently makes one `lastTrafficSource` request.

- [ ] **Step 3: Implement segmented source collection**

Collect each segment with identical metrics and only the stated filter difference. Add `user_id_presence` to every `other` row's `scope_dimensions` and scope hash. Combine API row counts and completeness into one `MetrikaScopeResult`; any sampled, incomplete or missing-total segment makes the whole scope non-publishable.

- [ ] **Step 4: Write partition-reconciliation RED tests**

Construct rows where totals match and mismatch. Require exact equality globally and for each raw traffic source. Assert mismatch raises `MetrikaCollectionError` before `publish_metrika_day_bundle` and therefore writes neither facts nor success coverage.

- [ ] **Step 5: Implement reconciliation and verify GREEN**

Implement a pure validator that sums the stored `sessions` metric by presence/source. Validate after all three reports are normalized and before returning a successful `other` scope.

```bash
python3 -m unittest tests.test_yandex_metrika_day_bundle tests.test_abbott_canonical_controls tests.test_yandex_metrika_atomic_writer -v
```

- [ ] **Step 6: Commit collector behavior**

```bash
git add fetch_yandex_metrika_canonical.py tests/test_yandex_metrika_day_bundle.py tests/test_abbott_canonical_controls.py tests/test_yandex_metrika_atomic_writer.py
git commit -m "fix: partition Abbott traffic by User ID"
```

---

### Task 3: Private Logs API visit collector and schema

**Files:**
- Create: `metrika_logs_api.py`
- Create: `tests/test_metrika_logs_api.py`
- Modify: `fetch_yandex_metrika_canonical.py`
- Modify: `canonical_writer.py`
- Modify: `tests/test_yandex_metrika_day_bundle.py`
- Modify: `tests/test_yandex_metrika_atomic_writer.py`
- Modify: `ops/sql/abbott_private_schema_and_grants.sql`
- Modify: `tests/test_abbott_schema_contract.py`

**Interfaces:**
- Produces: `MetrikaLogsClient.collect_visits(counter_id: str, day: str, attribution: str = 'lastsign') -> tuple[dict, ...]`.
- Produces: `parse_clickhouse_string_array(value: str) -> tuple[str, ...]`, `extract_raw_user_id(level1, level2) -> str | None`, and `normalize_visit_row(...) -> dict`.
- Stores one row per `(canonical_release_id, counter_id, report_date, visit_id_hash)` in `report_bd_private.canonical_fact_metrika_visits`.

- [ ] **Step 1: Write Logs lifecycle RED tests**

Using a fake HTTP session, require this sequence: evaluate, create, poll until `processed`, download every ordered part, then clean in `finally`. Require cleanup after parsing/download failure, retry only sanitized retryable statuses, and never include remote response text or request parameters in raised errors.

- [ ] **Step 2: Verify lifecycle RED**

```bash
python3 -m unittest tests.test_metrika_logs_api -v
```

Expected: fail because `metrika_logs_api.py` does not exist.

- [ ] **Step 3: Implement the Logs client**

Use the management endpoint `/management/v1/counter/{counterId}/logrequests`, `source=visits`, `date1=day`, `date2=day`, and these exact fields:

```text
ym:s:visitID,ym:s:dateTime,ym:s:startURL,ym:s:endURL,ym:s:pageViews,
ym:s:visitDuration,ym:s:bounce,ym:s:clientID,ym:s:lastsignTrafficSource,
ym:s:parsedParamsKey1,ym:s:parsedParamsKey2
```

Download TSV parts without logging bodies. Bound polling by configured attempts and delay; validate every lifecycle payload structurally.

- [ ] **Step 4: Write parser RED tests**

Test empty arrays, escaped ClickHouse strings, a single exact `UserID` tuple, no UserID, blank UserID, and two conflicting non-empty UserID values. Conflicts must fail the whole scope. Assert normalized rows preserve raw ID/URLs, hash visit/client/ID values, calculate session end, keep source, duration, pageviews and bounce, and never place raw values in error text.

- [ ] **Step 5: Implement parsing and integrate `user_behavior`**

Branch `collect_metrika_scope` before Reports API handling when `scope == 'user_behavior'`. Convert each downloaded visit into a private row and produce complete, unsampled `MetrikaScopeResult` evidence. A missing visit ID, wrong day, duplicate visit ID or malformed metric fails closed.

- [ ] **Step 6: Write and implement schema/writer RED-GREEN**

Create `report_bd_private.canonical_fact_metrika_visits` with nullable raw User ID/hash, lossless visit ID, visit/client hashes, source ID/name, raw start/end URLs and hashes, start/end timestamps, pageviews, duration seconds, bounce, request fingerprint and run ID. Grant collector CRUD and manager runtime reader SELECT only. Embed/importer/release operator receive no access. Update `canonical_writer.py` to insert the visit rows atomically before success coverage.

- [ ] **Step 7: Verify and commit**

```bash
python3 -m unittest tests.test_metrika_logs_api tests.test_yandex_metrika_day_bundle tests.test_yandex_metrika_atomic_writer tests.test_abbott_schema_contract -v
python3 -m py_compile metrika_logs_api.py fetch_yandex_metrika_canonical.py canonical_writer.py
git add metrika_logs_api.py tests/test_metrika_logs_api.py fetch_yandex_metrika_canonical.py canonical_writer.py tests/test_yandex_metrika_day_bundle.py tests/test_yandex_metrika_atomic_writer.py ops/sql/abbott_private_schema_and_grants.sql tests/test_abbott_schema_contract.py
git commit -m "feat: collect Abbott visits from Metrika Logs API"
```

---

### Task 4: Dashboard selection over exact aggregate and visit grains

**Files:**
- Modify: `dashboard-next/src/lib/types.ts`
- Modify: `dashboard-next/src/lib/abbott-bi.ts`
- Modify: `dashboard-next/src/lib/abbott-bi-loader.test.ts`
- Modify: `dashboard-next/src/components/abbott-summary.ts`
- Modify: `dashboard-next/src/components/abbott-summary.test.ts`
- Modify: `dashboard-next/src/lib/abbott-data-projection.test.ts`

**Interfaces:**
- Adds: `traffic_segment: 'all' | 'with_user_id' | 'without_user_id'` to aggregate summary rows.
- Changes: `selectAbbottSummaryRows` selects aggregate presence partitions for presence/source filters and private visit summaries only for concrete `user_id` or `direction` filters.

- [ ] **Step 1: Write loader RED tests**

Require `buildTrafficSummary` to keep three partitions separate, default missing markers to `all` only for historic rows, and never triple-count default totals. Require the manager query to use only `report_bd_private.canonical_fact_metrika_visits`; embed makes zero private queries.

- [ ] **Step 2: Write summary RED tests**

Assert:

```text
All -> aggregate all
with User ID -> aggregate with_user_id
without User ID -> aggregate without_user_id
source only -> aggregate all filtered by raw source
source + presence -> matching aggregate partition and source
specific raw User ID or direction -> private visit summaries
```

Require `with + without = all` for the test fixtures and ensure the three selections never expose all segment rows simultaneously.

- [ ] **Step 3: Verify dashboard RED**

```bash
cd dashboard-next
node --import tsx --test src/lib/abbott-bi-loader.test.ts src/components/abbott-summary.test.ts src/lib/abbott-data-projection.test.ts
```

- [ ] **Step 4: Implement visit query and weighted summaries**

Load source, nullable raw User ID, client hash, URLs, pageviews, duration and bounce. Group registered summaries by raw User ID plus source, anonymous summaries by source, count each visit once, count distinct client hashes, and calculate session-weighted duration, depth and bounce rate. Actions remain one row per private visit.

- [ ] **Step 5: Implement aggregate partition selection**

Read `user_id_presence` from `scope_dimensions`; map it to the public discriminated segment and preserve raw source values. Default UI shows only `all`; presence choices show exactly one complementary partition. Keep raw User ID and visit rows manager-only.

- [ ] **Step 6: Verify and commit**

```bash
cd dashboard-next
node --import tsx --test src/lib/abbott-bi-loader.test.ts src/components/abbott-summary.test.ts src/lib/abbott-data-projection.test.ts src/components/abbott-localization.test.ts src/components/AbbottBiDashboard.ui.test.ts
npm run typecheck
git add src/lib/types.ts src/lib/abbott-bi.ts src/lib/abbott-bi-loader.test.ts src/components/abbott-summary.ts src/components/abbott-summary.test.ts src/lib/abbott-data-projection.test.ts
git commit -m "fix: use exact Abbott session partitions"
```

---

### Task 5: Runtime closure, operations, alerts and full verification

**Files:**
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/runtime/fetch_yandex_metrika_canonical.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/collectors/fetch_yandex_metrika_canonical.py`
- Create: `dashboard-next/reportingdash-canonical-bootstrap/runtime/metrika_logs_api.py`
- Create: `dashboard-next/reportingdash-canonical-bootstrap/lib/metrika_logs_api.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/runtime/canonical_writer.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/lib/canonical_writer.py`
- Modify: `dashboard-next/reportingdash-canonical-bootstrap/MIGRATION-MANIFEST.md`
- Modify: `ops/abbott-runtime-manifest.sha256`
- Modify: `abbott_health_probe.py`
- Modify: `tests/test_abbott_health_probe.py`
- Modify: `send_canonical_telegram_report.py`
- Modify: `tests/test_send_canonical_telegram_report.py`
- Modify: `docs/ABBOTT-OPERATIONS-RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: `dashboard-next/DASHBOARDS-MEMORY.md`
- Modify: `dashboard-next/CANONICAL-ENTITIES-MEMORY.md`

**Interfaces:**
- Adds sanitized health codes for missing visit coverage, partition mismatch, Logs API lifecycle failure, and stale visit collection.
- Keeps the approved cron order: Abbott collection `06:12`, health `07:05`, summary `07:10`.

- [ ] **Step 1: Write health/summary RED tests**

Require counter-scoped critical incidents when visit coverage is missing/stale or partition validation fails. Require the `07:10` summary to include a sanitized Abbott session-integrity line with counts/status only; no ID, URL, token, response body or DSN may appear.

- [ ] **Step 2: Implement sanitized monitoring**

Reuse canonical coverage and aggregate segment counts. Do not query or emit raw private rows. Preserve existing exit-code and Telegram escaping behavior.

- [ ] **Step 3: Synchronize runtime authorities and manifests**

Copy root collector/writer/Logs client byte-for-byte into the established bootstrap locations, update only their SHA-256 entries, and require runtime imports to work without the parent repository.

- [ ] **Step 4: Update operational truth**

Document Reports partition semantics, Logs API lifecycle/quota cleanup, `METRIKA_TOKEN`, `lastsign`, the immutable-release limitation for late session updates, sanitized alerts, and the exact rollback rule. Keep Bitrix explicitly test-only until a live connector contract exists.

- [ ] **Step 5: Run focused and full verification**

```bash
python3 -m unittest tests.test_metrika_logs_api tests.test_yandex_metrika_day_bundle tests.test_yandex_metrika_atomic_writer tests.test_abbott_schema_contract tests.test_abbott_health_probe tests.test_send_canonical_telegram_report tests.test_abbott_runtime_closure -v
python3 -m unittest discover -s tests -v
cd dashboard-next
npm test
npm run lint
npm run typecheck
npm run security:public-assets
npm run build
```

Expected: all commands exit `0`; lint may retain only explicitly identified pre-existing warnings.

- [ ] **Step 6: Commit runtime and documentation**

Commit the nested bootstrap synchronization first, then the root pointer/manifests/operations changes. Do not deploy, install secrets, call Metrica, modify crontab, send Telegram, or schedule Hermes.

