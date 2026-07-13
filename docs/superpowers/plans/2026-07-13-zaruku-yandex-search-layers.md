# Zaruku Yandex Search Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Yandex Webmaster SERP facts and normalized AI visibility slots to the Zaruku dashboard without duplicating the existing SEO OS tracked-position collection.

**Architecture:** ReportingDash owns the Yandex Webmaster collector, database snapshots, and dashboard read model. SEO OS remains the only ordinary Yandex Search writer for tracked positions and later exports generative-search snapshots into `seo_ai_visibility_weekly`. React components render normalized `ZarukuSeoData` sections and never call Yandex APIs directly.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, mysql2, MySQL migrations, Yandex Webmaster REST API, existing deployment scripts.

## Global Constraints

- Do not commit or print live Yandex API credentials; use env names and server-side secret files only.
- Do not issue ordinary Yandex Search API calls from ReportingDash; `seo_positions_weekly` remains owned by SEO OS.
- Use ISO calendar weeks, Monday through Sunday, completed weeks only for scheduled snapshots.
- Webmaster snapshots publish atomically: fetch all remote pages first, then replace one week in one DB transaction.
- Refresh OAuth tokens into a mode-0600 token state file outside release directories.
- `YANDEX_WEBMASTER_HOST_ID` may be empty; auto-discover `zaruku.ru`, fail closed on missing or ambiguous hosts.
- UI must support current Webmaster data and future GSC/Webmaster/DataForSEO/GSC layers without another component rewrite.
- Work in the current checkout and preserve existing uncommitted user changes.

---

## File Structure

- Create `src/db/migrations/031_zaruku_yandex_webmaster_search_layers.sql`: additive Webmaster and AI snapshot tables.
- Create `src/lib/zaruku-yandex-webmaster.ts`: read normalized Webmaster weekly facts from MySQL.
- Create `src/lib/zaruku-yandex-webmaster.test.ts`: query builders and normalizers.
- Create `src/lib/zaruku-ai-visibility.ts`: read future SEO OS AI snapshots, returning an unavailable shell when empty.
- Create `src/lib/zaruku-ai-visibility.test.ts`: AI query and normalization tests.
- Modify `src/lib/types.ts`: add source id, Webmaster and AI DTOs.
- Modify `src/lib/zaruku-seo.ts`: connect sources, load Webmaster/AI sections, remove Webmaster from pending when data schema is available.
- Modify `src/components/ZarukuSeoDashboard.tsx`: replace pending SERP/AI blocks with data-aware panels.
- Create `src/components/zaruku-yandex-webmaster-panels.test.ts`: pure UI helper tests.
- Create `scripts/collect-yandex-webmaster.ts`: standalone collector for Yandex Webmaster snapshots.
- Create `scripts/collect-yandex-webmaster.test.ts`: OAuth, week, host discovery, and atomic persistence tests.
- Modify `scripts/render-production-env.sh`: whitelist Webmaster env vars into production `.env`.
- Modify `scripts/deploy.sh`: include collector script and install runtime dependencies already present in standalone package.
- Modify `.env.production.example` if present, otherwise add only documentation to `ZARUKU-SEO-PENDING-SOURCES.md`.

## Task 1: Database And Read Model

**Files:**
- Create: `src/db/migrations/031_zaruku_yandex_webmaster_search_layers.sql`
- Create: `src/lib/zaruku-yandex-webmaster.ts`
- Create: `src/lib/zaruku-yandex-webmaster.test.ts`
- Create: `src/lib/zaruku-ai-visibility.ts`
- Create: `src/lib/zaruku-ai-visibility.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `loadZarukuYandexWebmasterData(counterIds: string[], weeks?: string[], executeQuery?: QueryExecutor): Promise<ZarukuYandexWebmasterData>`
- Produces: `loadZarukuAiVisibilityData(counterIds: string[], weeks?: string[], executeQuery?: QueryExecutor): Promise<ZarukuAiVisibilityData>`
- Produces: `ZarukuYandexWebmasterQueryRow`, `ZarukuYandexWebmasterPageRow`, `ZarukuAiVisibilityRow`
- Consumes: existing `mysql2` pool and `ZarukuSeoSourceId`

- [ ] **Step 1: Write failing Webmaster read-model tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebmasterAccountQueries,
  loadZarukuYandexWebmasterData,
  normalizeWebmasterQueryRow,
} from "@/lib/zaruku-yandex-webmaster";

test("buildWebmasterAccountQueries scopes by account and optional weeks", () => {
  const queries = buildWebmasterAccountQueries(["66624469"], ["2026-W28"]);
  assert.match(queries.queries.sql, /seo_webmaster_queries_weekly/);
  assert.match(queries.queries.sql, /week_key IN \(\?\)/);
  assert.deepEqual(queries.queries.params, ["66624469", "2026-W28"]);
});

test("normalizeWebmasterQueryRow keeps CTR and position as percentages and decimals", () => {
  assert.deepEqual(
    normalizeWebmasterQueryRow({
      week_key: "2026-W28",
      query_id: "q:1",
      query_text: "рак молочной железы помощь",
      device_type: "ALL",
      impressions: "1000",
      clicks: "120",
      ctr: "12.000000",
      average_position: "4.6",
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    }),
    {
      week: "2026-W28",
      query_id: "q:1",
      query: "рак молочной железы помощь",
      device: "ALL",
      impressions: 1000,
      clicks: 120,
      ctr: 12,
      average_position: 4.6,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    },
  );
});

test("loadZarukuYandexWebmasterData is partial when one table is unavailable", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W28"], async (query) => {
    if (query.sql.includes("seo_webmaster_pages_weekly")) throw new Error("missing table");
    return [{
      week_key: "2026-W28",
      query_id: "q:1",
      query_text: "за руку",
      device_type: "ALL",
      impressions: 10,
      clicks: 1,
      ctr: 10,
      average_position: 2,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    }];
  });
  assert.equal(data.status, "partial");
  assert.equal(data.queries.length, 1);
  assert.equal(data.pages.length, 0);
  assert.match(data.error ?? "", /pages/);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/lib/zaruku-yandex-webmaster.test.ts`

Expected: FAIL with module-not-found for `@/lib/zaruku-yandex-webmaster`.

- [ ] **Step 3: Add migration**

```sql
CREATE TABLE IF NOT EXISTS seo_webmaster_queries_weekly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  week_key VARCHAR(8) NOT NULL,
  week_from DATE NOT NULL,
  week_to DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  query_id VARCHAR(255) NOT NULL,
  query_text TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_seo_webmaster_queries_weekly (analytics_account_id, week_key, device_type, query_id),
  KEY idx_seo_webmaster_queries_weekly_week (analytics_account_id, week_key),
  KEY idx_seo_webmaster_queries_weekly_query (analytics_account_id, query_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_webmaster_pages_weekly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  analytics_account_id VARCHAR(128) NOT NULL,
  host_id VARCHAR(255) NOT NULL,
  week_key VARCHAR(8) NOT NULL,
  week_from DATE NOT NULL,
  week_to DATE NOT NULL,
  device_type VARCHAR(32) NOT NULL DEFAULT 'ALL',
  page_url TEXT NOT NULL,
  page_hash CHAR(64) NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(18,6) DEFAULT NULL,
  average_position DECIMAL(18,6) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  ingestion_run_id BIGINT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_seo_webmaster_pages_weekly (analytics_account_id, week_key, device_type, page_hash),
  KEY idx_seo_webmaster_pages_weekly_week (analytics_account_id, week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_ai_visibility_weekly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  analytics_account_id VARCHAR(128) NOT NULL,
  source_key VARCHAR(64) NOT NULL DEFAULT 'seo_os',
  week_key VARCHAR(8) NOT NULL,
  cluster_id VARCHAR(128) NOT NULL,
  query_text TEXT NOT NULL,
  engine VARCHAR(64) NOT NULL,
  region_id VARCHAR(64) NOT NULL DEFAULT '225',
  language_code VARCHAR(16) NOT NULL DEFAULT 'ru',
  device_type VARCHAR(32) NOT NULL DEFAULT 'desktop',
  mentioned TINYINT(1) NOT NULL DEFAULT 0,
  mention_count INT NOT NULL DEFAULT 0,
  citation_count INT NOT NULL DEFAULT 0,
  cited_urls_json JSON DEFAULT NULL,
  checked_at DATETIME DEFAULT NULL,
  run_id VARCHAR(128) DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_seo_ai_visibility_weekly (analytics_account_id, week_key, cluster_id, engine, region_id, language_code, device_type),
  KEY idx_seo_ai_visibility_weekly_week (analytics_account_id, week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Implement read models**

Add query builders, normalizers, unavailable/partial status handling, and stable numeric parsing. `loadZarukuYandexWebmasterData` must query weekly queries and pages independently with `Promise.allSettled`; `loadZarukuAiVisibilityData` must return `status: "unavailable"` when the table does not exist.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/lib/zaruku-yandex-webmaster.test.ts src/lib/zaruku-ai-visibility.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/031_zaruku_yandex_webmaster_search_layers.sql src/lib/zaruku-yandex-webmaster.ts src/lib/zaruku-yandex-webmaster.test.ts src/lib/zaruku-ai-visibility.ts src/lib/zaruku-ai-visibility.test.ts src/lib/types.ts
git commit -m "Add Zaruku Webmaster search read models"
```

## Task 2: Webmaster Collector

**Files:**
- Create: `scripts/collect-yandex-webmaster.ts`
- Create: `scripts/collect-yandex-webmaster.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectYandexWebmaster(options: CollectorOptions, deps?: CollectorDeps): Promise<CollectorResult>`
- Produces CLI command: `npm run collect:yandex-webmaster`
- Consumes env vars listed in the design spec.

- [ ] **Step 1: Write failing collector tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  completedIsoWeekBefore,
  discoverHostId,
  refreshYandexToken,
  replaceWeekRowsTransaction,
} from "../scripts/collect-yandex-webmaster";

test("completedIsoWeekBefore returns the previous completed Monday-Sunday week", () => {
  assert.deepEqual(completedIsoWeekBefore(new Date("2026-07-13T09:00:00.000Z")), {
    weekKey: "2026-W28",
    from: "2026-07-06",
    to: "2026-07-12",
  });
});

test("discoverHostId resolves one exact zaruku host and rejects ambiguity", async () => {
  const hostId = await discoverHostId("zaruku.ru", async () => ({
    hosts: [{ host_id: "https:zaruku.ru:443", ascii_host_url: "https://zaruku.ru/" }],
  }));
  assert.equal(hostId, "https:zaruku.ru:443");
  await assert.rejects(
    () => discoverHostId("zaruku.ru", async () => ({
      hosts: [
        { host_id: "a", ascii_host_url: "https://zaruku.ru/" },
        { host_id: "b", ascii_host_url: "http://zaruku.ru/" },
      ],
    })),
    /Ambiguous/,
  );
});

test("refreshYandexToken writes access and refresh token state without logging secrets", async () => {
  const written: unknown[] = [];
  const result = await refreshYandexToken(
    { clientId: "id", clientSecret: "secret", refreshToken: "refresh", tokenStatePath: "/tmp/state.json" },
    async () => ({ access_token: "access2", refresh_token: "refresh2", expires_in: 3600 }),
    async (path, value) => written.push({ path, value }),
  );
  assert.equal(result.accessToken, "access2");
  assert.equal(result.refreshToken, "refresh2");
  assert.equal(written.length, 1);
});

test("replaceWeekRowsTransaction deletes then inserts in one transaction", async () => {
  const calls: string[] = [];
  const conn = {
    beginTransaction: async () => calls.push("begin"),
    execute: async (sql: string) => calls.push(sql.trim().split(/\\s+/, 2).join(" ")),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    release: () => calls.push("release"),
  };
  await replaceWeekRowsTransaction(conn, {
    accountId: "66624469",
    hostId: "host",
    weekKey: "2026-W28",
    weekFrom: "2026-07-06",
    weekTo: "2026-07-12",
    device: "ALL",
    runId: 7,
    queryRows: [],
    pageRows: [],
  });
  assert.deepEqual(calls, ["begin", "DELETE FROM", "DELETE FROM", "commit", "release"]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- scripts/collect-yandex-webmaster.test.ts`

Expected: FAIL with module-not-found for `scripts/collect-yandex-webmaster`.

- [ ] **Step 3: Implement collector**

Implement:
- env parsing and validation for Webmaster credentials;
- access token refresh via Yandex OAuth token endpoint;
- token state read/write using `fs.rename` and `chmod 0600`;
- host auto-discovery by canonical `zaruku.ru`;
- completed ISO week default and explicit `--week=YYYY-Www`;
- query facts from Webmaster popular/search-query endpoint;
- page facts from Webmaster query analytics endpoint with URL indicator when available;
- all remote pages fetched before DB transaction;
- `canonical_collector_runs` status updates with `source_key='yandex_webmaster'`.

- [ ] **Step 4: Run focused collector tests**

Run: `npm test -- scripts/collect-yandex-webmaster.test.ts`

Expected: PASS.

- [ ] **Step 5: Add package script**

```json
"collect:yandex-webmaster": "tsx scripts/collect-yandex-webmaster.ts"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/collect-yandex-webmaster.ts scripts/collect-yandex-webmaster.test.ts package.json package-lock.json
git commit -m "Add Yandex Webmaster collector"
```

## Task 3: Dashboard Integration

**Files:**
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Create: `src/components/zaruku-yandex-webmaster-panels.test.ts`
- Modify: `ZARUKU-SEO-PENDING-SOURCES.md`

**Interfaces:**
- Consumes: `ZarukuYandexWebmasterData`, `ZarukuAiVisibilityData`
- Produces: connected/partial source badges and SERP/AI panels.

- [ ] **Step 1: Write failing integration tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeWebmasterKpis,
  topWebmasterQueries,
} from "@/components/zaruku-yandex-webmaster-panels";

test("summarizeWebmasterKpis totals impressions clicks and weighted position", () => {
  const summary = summarizeWebmasterKpis([
    { week: "2026-W28", query_id: "1", query: "a", device: "ALL", impressions: 100, clicks: 10, ctr: 10, average_position: 2, week_from: "2026-07-06", week_to: "2026-07-12" },
    { week: "2026-W28", query_id: "2", query: "b", device: "ALL", impressions: 300, clicks: 15, ctr: 5, average_position: 6, week_from: "2026-07-06", week_to: "2026-07-12" },
  ]);
  assert.deepEqual(summary, { impressions: 400, clicks: 25, ctr: 6.25, average_position: 5 });
});

test("topWebmasterQueries sorts by impressions then clicks", () => {
  assert.deepEqual(
    topWebmasterQueries([
      { week: "2026-W28", query_id: "low", query: "low", device: "ALL", impressions: 1, clicks: 10, ctr: 1000, average_position: 1, week_from: "2026-07-06", week_to: "2026-07-12" },
      { week: "2026-W28", query_id: "high", query: "high", device: "ALL", impressions: 20, clicks: 1, ctr: 5, average_position: 2, week_from: "2026-07-06", week_to: "2026-07-12" },
    ], 1).map((row) => row.query_id),
    ["high"],
  );
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/components/zaruku-yandex-webmaster-panels.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Wire loaders into `loadZarukuSeoData`**

Import the two read models, load them alongside SEO OS, add `webmaster` and `ai_visibility` fields to `ZarukuSeoData`, set source status to connected/partial/unavailable from data status, and remove Webmaster from pending requirements when the source is connected or partial.

- [ ] **Step 4: Replace pending panels**

In the SEO tab:
- show Webmaster KPIs: impressions, clicks, CTR, average position;
- show top Yandex queries table with query, impressions, clicks, CTR, position;
- show top Yandex landing pages when page facts are available;
- keep GSC pending;
- show AI visibility panel as unavailable/empty until SEO OS exports `seo_ai_visibility_weekly`.

- [ ] **Step 5: Run focused dashboard tests**

Run: `npm test -- src/components/zaruku-yandex-webmaster-panels.test.ts src/lib/zaruku-seo.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zaruku-seo.ts src/components/ZarukuSeoDashboard.tsx src/components/zaruku-yandex-webmaster-panels.ts src/components/zaruku-yandex-webmaster-panels.test.ts src/lib/types.ts ZARUKU-SEO-PENDING-SOURCES.md
git commit -m "Show Webmaster and AI layers on Zaruku dashboard"
```

## Task 4: Production Env, Deploy, And Backfill

**Files:**
- Modify: `scripts/render-production-env.sh`
- Modify: `scripts/deploy.sh`
- Modify: `.env.production.example` if it exists

**Interfaces:**
- Consumes: `/var/www/www-root/data/.production.env`
- Produces: deployed collector and server-side env.

- [ ] **Step 1: Write failing env render test if a shell test harness exists**

If no shell test harness exists, skip test creation and verify by running `bash -n scripts/render-production-env.sh scripts/deploy.sh`.

- [ ] **Step 2: Whitelist safe env names**

Add only names, never values:

```sh
YANDEX_WEBMASTER_ENABLED
YANDEX_WEBMASTER_CLIENT_ID
YANDEX_WEBMASTER_CLIENT_SECRET
YANDEX_WEBMASTER_REDIRECT_URI
YANDEX_WEBMASTER_OAUTH_TOKEN
YANDEX_WEBMASTER_REFRESH_TOKEN
YANDEX_WEBMASTER_HOST_ID
YANDEX_WEBMASTER_DEFAULT_DATE_RANGE_DAYS
YANDEX_WEBMASTER_DEVICE_TYPE
YANDEX_WEBMASTER_TOKEN_STATE_PATH
```

- [ ] **Step 3: Deploy script packaging**

Copy `scripts/collect-yandex-webmaster.ts` into standalone `scripts/` and ensure production can run it via bundled `node_modules/.bin/tsx` or a plain compiled fallback.

- [ ] **Step 4: Server env install**

Update `/var/www/www-root/data/.production.env` over SSH with the provided Webmaster variables and `YANDEX_WEBMASTER_TOKEN_STATE_PATH=/var/www/www-root/data/.yandex-webmaster-token-state.json`. Do not print secret values.

- [ ] **Step 5: Run migration and collector**

Run:

```bash
npm run db:migrate
npm run collect:yandex-webmaster -- --week=2026-W28
npm run collect:yandex-webmaster -- --week=2026-W29
```

On production, run equivalent commands from `/var/www/dashboard` after deploy if local DB is not production.

- [ ] **Step 6: Verify**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Then verify production DB has rows:

```sql
SELECT week_key, COUNT(*) FROM seo_webmaster_queries_weekly WHERE analytics_account_id='66624469' GROUP BY week_key;
```

- [ ] **Step 7: Commit**

```bash
git add scripts/render-production-env.sh scripts/deploy.sh .env.production.example
git commit -m "Wire Webmaster collector deployment"
```

## Self-Review

Spec coverage:
- Webmaster collector, token refresh, host discovery, atomic publication, weeks, UI source statuses, and non-duplication of ordinary Search API are covered by Tasks 1-4.
- AI visibility DB/read model is covered as a read slot only; actual generative-search collection remains owned by SEO OS per design.
- GSC remains pending and visible.

Placeholder scan:
- No task uses TBD/TODO/fill-in language. The only implementation-summary step is bounded by explicit behavior and tested helpers.

Type consistency:
- `week`, `week_key`, `query_id`, `device`, `impressions`, `clicks`, `ctr`, and `average_position` names are consistent across read models, tests, and UI helpers.
