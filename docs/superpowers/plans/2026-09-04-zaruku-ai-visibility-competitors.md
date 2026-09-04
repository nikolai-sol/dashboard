# Zaruku AI Visibility and Competitors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually refreshed monthly Alice AI visibility tab for Zaruku with official Share of Voice, query-level portal positions, all cited sources, and competitor summaries.

**Architecture:** A validated CLI imports each XLSX as one immutable canonical MySQL snapshot with child query, source, and featured-site rows. The dashboard read model reads only those canonical tables, while a dedicated client component owns month selection, filtering, expansion, and pagination. Existing July aggregate data is copied into the new monthly summary without inventing missing query detail.

**Tech Stack:** Next.js 16, React 19, TypeScript, MySQL 8, `xlsx`, Recharts, Node test runner.

## Global Constraints

- Dashboard requests, rendering, filtering, and exports read canonical MySQL only and never call Yandex or read XLSX files.
- Official monthly SoV and the share inside exported examples remain separate metrics.
- August 2026 stores official SoV `43.91`, 155 exported queries, 89 Zaruku-present queries, 57.42% example coverage, and 1,313 source links.
- Exact Zaruku matching uses hostname `zaruku.ru` or a subdomain; a foreign URL that merely contains `zaruku.ru` is not Zaruku.
- Identical imports are idempotent by source checksum. A changed file for a published month requires an explicit superseding action, and the earlier snapshot remains stored.
- The source workbook is never copied into `public/` or a release asset directory.
- July 2026 remains visible at `44.00%`; its ambiguous 89/155 legacy counters are retained only as labelled source metadata.
- The AI tab has its own month selector and is not controlled by the SEO OS week selector.
- User-facing copy is plain Russian and does not describe internal tables, collectors, or SQL.

---

### Task 1: Parse and validate an Alice AI workbook

**Files:**
- Create: `src/lib/zaruku-alice-visibility-import.ts`
- Test: `src/lib/zaruku-alice-visibility-import.test.ts`

**Interfaces:**
- Consumes: an XLSX `Buffer`, portal domain, month, official SoV, capture time, and featured URLs.
- Produces: `parseAliceVisibilityWorkbook(buffer, input): ParsedAliceVisibilitySnapshot` and `isPortalHostname(hostname, portalDomain): boolean`.

- [ ] **Step 1: Write the failing parser and hostname tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  isPortalHostname,
  parseAliceVisibilityWorkbook,
} from "@/lib/zaruku-alice-visibility-import";

function workbookBuffer() {
  const rows = [
    ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", "Сайт 1", "Сайт 2", "Сайт 3", "Сайт 4", "Сайт 5", "Сайт 6", "Сайт 7", "Сайт 8", "Сайт 9", "Сайт 10"],
    ["инвалидность после мастэктомии", "true", "https://yandex.ru/search/?text=x", "https://zaruku.ru/article/", "https://example.org/a"],
    ["онкологический центр", "false", "https://yandex.ru/search/?text=y", "https://example.org/b", "https://catalog.example/review/zaruku.ru.html"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "sheet1");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("portal matching uses the hostname rather than a URL substring", () => {
  assert.equal(isPortalHostname("zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("www.zaruku.ru", "zaruku.ru"), true);
  assert.equal(isPortalHostname("catalog.example", "zaruku.ru"), false);
});

test("parser keeps official SoV separate from exported example coverage", () => {
  const parsed = parseAliceVisibilityWorkbook(workbookBuffer(), {
    accountId: "66624469",
    portalDomain: "zaruku.ru",
    period: "2026-08",
    officialSovPct: 43.91,
    capturedAt: "2026-09-04T13:28:14.000Z",
    sourceFilename: "neurostatistics-zaruku.ru-20260904-152814.xlsx",
    featuredSites: ["https://onco-life.ru"],
  });

  assert.equal(parsed.officialSovPct, 43.91);
  assert.equal(parsed.exportedQueryCount, 2);
  assert.equal(parsed.portalPresentQueryCount, 1);
  assert.equal(parsed.samplePresencePct, 50);
  assert.equal(parsed.queries[0].portalPosition, 1);
  assert.equal(parsed.queries[1].portalPosition, null);
  assert.equal(parsed.sources.length, 4);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --import tsx --test src/lib/zaruku-alice-visibility-import.test.ts`

Expected: FAIL because `zaruku-alice-visibility-import` does not exist.

- [ ] **Step 3: Implement the parser and validation types**

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export type AliceVisibilityImportInput = {
  accountId: string;
  portalDomain: string;
  period: string;
  officialSovPct: number;
  capturedAt: string;
  sourceFilename: string;
  featuredSites: string[];
};

export type ParsedAliceVisibilityQuery = {
  queryHash: string;
  queryText: string;
  rawPresentValue: string;
  portalPresent: boolean;
  portalPosition: number | null;
  portalUrl: string | null;
  aliceAnswerUrl: string;
  sourceCount: number;
};

export type ParsedAliceVisibilitySource = {
  queryHash: string;
  sourceRank: number;
  sourceUrl: string;
  sourceDomain: string;
  isPortal: boolean;
};

export type ParsedAliceVisibilitySnapshot = AliceVisibilityImportInput & {
  sourceSha256: string;
  exportedQueryCount: number;
  portalPresentQueryCount: number;
  samplePresencePct: number;
  queries: ParsedAliceVisibilityQuery[];
  sources: ParsedAliceVisibilitySource[];
  featured: Array<{ displayOrder: number; siteUrl: string; siteDomain: string }>;
};

export function isPortalHostname(hostname: string, portalDomain: string) {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  const portal = portalDomain.toLowerCase().replace(/^www\./, "");
  return normalized === portal || normalized.endsWith(`.${portal}`);
}

function requiredUrl(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}: ссылка отсутствует`);
  return new URL(text);
}

export function parseAliceVisibilityWorkbook(buffer: Buffer, input: AliceVisibilityImportInput): ParsedAliceVisibilitySnapshot {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("Период должен иметь формат YYYY-MM");
  if (!Number.isFinite(input.officialSovPct) || input.officialSovPct < 0 || input.officialSovPct > 100) throw new Error("Доля запросов должна быть от 0 до 100");
  const workbook = XLSX.read(buffer, { type: "buffer", dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
  const expected = ["Запрос", "Присутствует сайт", "Ответ в Алисе AI", ...Array.from({ length: 10 }, (_, index) => `Сайт ${index + 1}`)];
  assert.deepEqual(rows[0]?.slice(0, 13), expected);
  const seen = new Set<string>();
  const queries: ParsedAliceVisibilityQuery[] = [];
  const sources: ParsedAliceVisibilitySource[] = [];
  for (const [offset, row] of rows.slice(1).entries()) {
    const rowNumber = offset + 2;
    const queryText = String(row[0] ?? "").trim();
    if (!queryText) throw new Error(`Строка ${rowNumber}: запрос отсутствует`);
    const queryHash = createHash("sha256").update(queryText.toLowerCase()).digest("hex");
    if (seen.has(queryHash)) throw new Error(`Строка ${rowNumber}: запрос повторяется`);
    seen.add(queryHash);
    const rawPresentValue = String(row[1] ?? "").trim().toLowerCase();
    if (rawPresentValue !== "true" && rawPresentValue !== "false") throw new Error(`Строка ${rowNumber}: присутствие должно быть true или false`);
    const answerUrl = requiredUrl(row[2], `Строка ${rowNumber}`).toString();
    const rowSources = row.slice(3, 13).flatMap((value, index) => {
      if (!value) return [];
      const parsed = requiredUrl(value, `Строка ${rowNumber}, сайт ${index + 1}`);
      return [{ queryHash, sourceRank: index + 1, sourceUrl: parsed.toString(), sourceDomain: parsed.hostname.toLowerCase().replace(/^www\./, ""), isPortal: isPortalHostname(parsed.hostname, input.portalDomain) }];
    });
    const portalSource = rowSources.find((source) => source.isPortal) ?? null;
    const portalPresent = portalSource !== null;
    if (portalPresent !== (rawPresentValue === "true")) throw new Error(`Строка ${rowNumber}: отметка присутствия не совпадает с источниками`);
    sources.push(...rowSources);
    queries.push({ queryHash, queryText, rawPresentValue, portalPresent, portalPosition: portalSource?.sourceRank ?? null, portalUrl: portalSource?.sourceUrl ?? null, aliceAnswerUrl: answerUrl, sourceCount: rowSources.length });
  }
  const present = queries.filter((query) => query.portalPresent).length;
  const featured = input.featuredSites.map((siteUrl, index) => {
    const parsed = requiredUrl(siteUrl, `Отмеченный сайт ${index + 1}`);
    return { displayOrder: index + 1, siteUrl: parsed.toString(), siteDomain: parsed.hostname.toLowerCase().replace(/^www\./, "") };
  });
  return { ...input, sourceSha256: createHash("sha256").update(buffer).digest("hex"), exportedQueryCount: queries.length, portalPresentQueryCount: present, samplePresencePct: queries.length ? present / queries.length * 100 : 0, queries, sources, featured };
}
```

- [ ] **Step 4: Add failure tests for headers, duplicates, invalid flags, URL errors, and flag/source mismatches**

Run: `node --import tsx --test src/lib/zaruku-alice-visibility-import.test.ts`

Expected: PASS with the positive and validation cases.

- [ ] **Step 5: Run the parser against the supplied workbook in dry-run memory**

Run: `node --import tsx scripts/import-zaruku-alice-visibility.ts --xlsx "/Users/nafanya/Downloads/neurostatistics-zaruku.ru-20260904-152814 (1).xlsx" --period 2026-08 --official-sov 43.91 --captured-at 2026-09-04T13:28:14.000Z --dry-run`

Expected after Task 2 supplies the CLI: `155` queries, `89` present, `57.42%` sample presence, `1,313` sources, and all 89 portal positions equal to 1.

- [ ] **Step 6: Commit the parser**

```bash
git add src/lib/zaruku-alice-visibility-import.ts src/lib/zaruku-alice-visibility-import.test.ts
git commit -m "feat: parse Zaruku Alice visibility exports"
```

### Task 2: Add canonical storage and the idempotent import command

**Files:**
- Create: `src/db/migrations/046_zaruku_alice_visibility_monthly.sql`
- Create: `scripts/import-zaruku-alice-visibility.ts`
- Create: `scripts/import-zaruku-alice-visibility.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ParsedAliceVisibilitySnapshot` from Task 1 and an explicit CLI request.
- Produces: four canonical tables plus `persistAliceVisibilitySnapshot(connection, parsed, options)`.

- [ ] **Step 1: Write a failing migration-contract test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Alice visibility migration creates normalized immutable snapshot tables", () => {
  const sql = readFileSync("src/db/migrations/046_zaruku_alice_visibility_monthly.sql", "utf8");
  for (const table of ["canonical_alice_visibility_snapshots", "canonical_alice_visibility_queries", "canonical_alice_visibility_sources", "canonical_alice_visibility_featured_sites"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /source_sha256 CHAR\(64\)/);
  assert.match(sql, /UNIQUE KEY uniq_alice_snapshot_checksum/);
  assert.match(sql, /UNIQUE KEY uniq_alice_query/);
  assert.match(sql, /UNIQUE KEY uniq_alice_source_rank/);
});
```

- [ ] **Step 2: Run the migration test and confirm RED**

Run: `node --import tsx --test scripts/import-zaruku-alice-visibility.test.ts`

Expected: FAIL because migration `046` does not exist.

- [ ] **Step 3: Create migration 046**

```sql
CREATE TABLE IF NOT EXISTS canonical_alice_visibility_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL DEFAULT 'yandex_webmaster_alice_manual',
  analytics_account_id VARCHAR(128) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  period_month DATE NOT NULL,
  captured_at DATETIME NOT NULL,
  official_sov_pct DECIMAL(7,4) NOT NULL,
  exported_query_count INT DEFAULT NULL,
  portal_present_query_count INT DEFAULT NULL,
  sample_presence_pct DECIMAL(7,4) DEFAULT NULL,
  source_filename VARCHAR(255) DEFAULT NULL,
  source_sha256 CHAR(64) NOT NULL,
  publication_status VARCHAR(32) NOT NULL DEFAULT 'published',
  supersedes_snapshot_id BIGINT DEFAULT NULL,
  ingestion_run_id VARCHAR(128) NOT NULL,
  source_payload_json JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_snapshot_checksum (analytics_account_id, source_key, source_sha256),
  UNIQUE KEY uniq_alice_snapshot_run (ingestion_run_id),
  KEY idx_alice_snapshot_month (analytics_account_id, period_month, publication_status),
  KEY idx_alice_snapshot_supersedes (supersedes_snapshot_id),
  CONSTRAINT fk_alice_snapshot_supersedes FOREIGN KEY (supersedes_snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_queries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  query_hash CHAR(64) NOT NULL,
  query_text TEXT NOT NULL,
  portal_present TINYINT(1) NOT NULL,
  portal_position TINYINT UNSIGNED DEFAULT NULL,
  portal_url TEXT DEFAULT NULL,
  alice_answer_url TEXT NOT NULL,
  source_count TINYINT UNSIGNED NOT NULL,
  raw_present_value VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_query (snapshot_id, query_hash),
  KEY idx_alice_query_snapshot (snapshot_id, portal_present),
  CONSTRAINT fk_alice_query_snapshot FOREIGN KEY (snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_sources (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  query_id BIGINT NOT NULL,
  source_rank TINYINT UNSIGNED NOT NULL,
  source_url TEXT NOT NULL,
  source_domain VARCHAR(255) NOT NULL,
  is_portal TINYINT(1) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_source_rank (query_id, source_rank),
  KEY idx_alice_source_domain (source_domain),
  CONSTRAINT fk_alice_source_query FOREIGN KEY (query_id) REFERENCES canonical_alice_visibility_queries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canonical_alice_visibility_featured_sites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id BIGINT NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL,
  site_url TEXT NOT NULL,
  site_domain VARCHAR(255) NOT NULL,
  list_kind VARCHAR(64) NOT NULL DEFAULT 'yandex_random_high_mentions',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alice_featured_order (snapshot_id, list_kind, display_order),
  KEY idx_alice_featured_snapshot (snapshot_id),
  CONSTRAINT fk_alice_featured_snapshot FOREIGN KEY (snapshot_id) REFERENCES canonical_alice_visibility_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Write failing persistence tests with a fake transactional connection**

Tests must prove:

```ts
assert.equal(await persistAliceVisibilitySnapshot(fake, parsed, {}), "inserted");
assert.equal(await persistAliceVisibilitySnapshot(fakeWithSameChecksum, parsed, {}), "already_exists");
await assert.rejects(() => persistAliceVisibilitySnapshot(fakeWithOtherPublishedMonth, parsed, {}), /уже опубликован другой файл/);
assert.equal(await persistAliceVisibilitySnapshot(fakeWithOtherPublishedMonth, parsed, { supersedeSnapshotId: 7 }), "superseded");
```

Also assert one transaction, 155 query inserts, 1,313 source inserts, 10 featured-site inserts, and post-write count reconciliation.

- [ ] **Step 5: Implement the CLI and persistence function**

Supported flags:

```text
--xlsx <absolute path>
--period YYYY-MM
--official-sov 43.91
--captured-at ISO timestamp
--featured-site <URL> (repeatable)
--account-id 66624469
--domain zaruku.ru
--supersede-snapshot-id <integer>
--dry-run
--execute
```

The default is dry-run. `--execute` opens the configured MySQL connection, validates the existing month and checksum, writes all rows in one transaction, reconciles child counts, and rolls back on every error. Add `import:zaruku-alice` to `package.json` as `tsx scripts/import-zaruku-alice-visibility.ts`.

- [ ] **Step 6: Add a summary-only mode for the July legacy point**

Supported additional flags:

```text
--summary-only
--legacy-source wm_alisa_manual_legacy
--legacy-mentions 89
--legacy-citations 155
```

Summary-only requires no XLSX, writes null query counts and sample presence, and stores the legacy counters under `source_payload_json.legacy_unconfirmed`. It cannot create query, source, or featured-site rows.

- [ ] **Step 7: Run focused tests and dry-run the real August file**

Run: `node --import tsx --test src/lib/zaruku-alice-visibility-import.test.ts scripts/import-zaruku-alice-visibility.test.ts`

Run the dry-run command from Task 1 with the ten `--featured-site` values in the approved order.

Expected: tests PASS; dry-run reports the exact August counts and no database writes.

- [ ] **Step 8: Commit schema and importer**

```bash
git add src/db/migrations/046_zaruku_alice_visibility_monthly.sql scripts/import-zaruku-alice-visibility.ts scripts/import-zaruku-alice-visibility.test.ts package.json
git commit -m "feat: store monthly Alice visibility snapshots"
```

### Task 3: Add the canonical read model

**Files:**
- Create: `src/lib/zaruku-alice-visibility.ts`
- Create: `src/lib/zaruku-alice-visibility.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/zaruku-seo.ts`
- Modify: `src/lib/zaruku-seo.test.ts`

**Interfaces:**
- Consumes: the four canonical tables from Task 2 and Zaruku account IDs.
- Produces: `loadZarukuAliceVisibility(accountIds): Promise<ZarukuAliceVisibilityData>` and `alice_visibility` on `ZarukuSeoData`.

- [ ] **Step 1: Write failing query and normalization tests**

```ts
test("read model scopes published snapshots and all children by account", () => {
  const queries = buildAliceVisibilityQueries(["66624469"]);
  assert.equal(queries.length, 4);
  assert.match(queries[0].sql, /canonical_alice_visibility_snapshots/);
  assert.match(queries[0].sql, /analytics_account_id IN \(\?\)/);
  assert.deepEqual(queries[0].params, ["66624469"]);
});

test("competitor frequency counts a domain once per query", () => {
  const data = normalizeAliceVisibilityRows(snapshotRows, queryRows, sourceRowsWithDuplicateDomain, featuredRows);
  assert.deepEqual(data.snapshots[0].competitors[0], { domain: "example.org", queryCount: 2, sharePct: 100 });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --import tsx --test src/lib/zaruku-alice-visibility.test.ts`

Expected: FAIL because the read model does not exist.

- [ ] **Step 3: Add public types**

Add types for snapshot summary, query, source, competitor, featured site, version, and the container:

```ts
export interface ZarukuAliceVisibilityData {
  status: "available" | "partial" | "unavailable";
  error: string | null;
  months: string[];
  latestMonth: string | null;
  snapshots: ZarukuAliceVisibilitySnapshot[];
}
```

Each normalized snapshot contains `officialSovPct`, nullable query coverage, `samplePresencePct`, provenance, all queries, computed competitors, featured sites, and source metadata. Add `alice_visibility: ZarukuAliceVisibilityData` to `ZarukuSeoData`.

- [ ] **Step 4: Implement four isolated reads and normalization**

Use `Promise.allSettled` so a missing child table produces `partial` while available monthly summaries remain visible. Convert `period_month` to `YYYY-MM`, percentages to numbers, and IDs to strings. Select published snapshots for the default month while retaining superseded versions in a per-month version collection.

- [ ] **Step 5: Load the new read model in `loadZarukuSeoData`**

Add `loadZarukuAliceVisibility(normalizedCounterIds)` to the existing `seo-db` phase and assign the result to `result.alice_visibility`. Update AI source status and `data_through` from `alice_visibility.latestMonth`; do not remove the existing SEO intelligence SOV rows.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test src/lib/zaruku-alice-visibility.test.ts src/lib/zaruku-seo.test.ts`

Expected: PASS, including a regression proving July remains available when query detail is absent.

- [ ] **Step 7: Commit the read model**

```bash
git add src/lib/zaruku-alice-visibility.ts src/lib/zaruku-alice-visibility.test.ts src/lib/types.ts src/lib/zaruku-seo.ts src/lib/zaruku-seo.test.ts
git commit -m "feat: read canonical Alice visibility snapshots"
```

### Task 4: Build the detailed AI visibility tab

**Files:**
- Create: `src/components/zaruku-alice-visibility-view.ts`
- Create: `src/components/zaruku-alice-visibility-view.test.ts`
- Create: `src/components/ZarukuAliceVisibilityTab.tsx`
- Create: `src/components/ZarukuAliceVisibilityTab.test.ts`

**Interfaces:**
- Consumes: `ZarukuAliceVisibilityData`.
- Produces: month selection, query filtering and paging helpers plus `ZarukuAliceVisibilityTab`.

- [ ] **Step 1: Write failing view-helper tests**

```ts
test("monthly delta is expressed in percentage points", () => {
  assert.equal(monthlySovDelta([{ month: "2026-07", officialSovPct: 44 }, { month: "2026-08", officialSovPct: 43.91 }], "2026-08"), -0.09);
});

test("query table supports text and presence filters", () => {
  assert.deepEqual(filterAliceQueries(rows, { text: "мастэктом", presence: "present" }).map((row) => row.queryText), ["инвалидность после мастэктомии"]);
});
```

- [ ] **Step 2: Run helper tests and confirm RED**

Run: `node --import tsx --test src/components/zaruku-alice-visibility-view.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure month, delta, filtering, and pagination helpers**

Use a page size of 25, case-insensitive Russian search, presence options `all`, `present`, and `absent`, and stable query-text ordering. Return an empty detail state when the selected snapshot has no queries.

- [ ] **Step 4: Write the failing server-rendered component test**

```ts
const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: augustFixture, locale: "ru-RU" }));
for (const label of ["ИИ-видимость и конкуренты", "43,91%", "155", "89", "57,42%", "Запросы и позиция Zaruku", "Конкуренты в выгрузке", "Примеры заметных сайтов по данным Яндекса"]) assert.match(markup, new RegExp(label));
assert.match(markup, /Официальная доля рассчитана Яндексом/);
assert.match(markup, /Доля в примерах рассчитана только по выгруженным строкам/);
```

- [ ] **Step 5: Run component test and confirm RED**

Run: `node --import tsx --test src/components/ZarukuAliceVisibilityTab.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the tab**

Render, in order:

1. title, source note, and month selector;
2. Recharts monthly SoV line chart;
3. four compact KPI cards;
4. the explanation separating official and example percentages;
5. searchable/filterable/paginated query table with first three competitor sources;
6. expandable list of all sources for each row;
7. computed competitor frequency table;
8. unordered featured-site list with the note that display order is not a rating.

Links open in a new tab with `rel="noreferrer"`. July renders the chart and SoV card plus the message `Детализация запросов за июль не была сохранена.`

- [ ] **Step 7: Run component and helper tests**

Run: `node --import tsx --test src/components/zaruku-alice-visibility-view.test.ts src/components/ZarukuAliceVisibilityTab.test.ts`

Expected: PASS for August, July summary-only, empty, and partial states.

- [ ] **Step 8: Commit the detailed tab**

```bash
git add src/components/zaruku-alice-visibility-view.ts src/components/zaruku-alice-visibility-view.test.ts src/components/ZarukuAliceVisibilityTab.tsx src/components/ZarukuAliceVisibilityTab.test.ts
git commit -m "feat: add Zaruku AI visibility detail tab"
```

### Task 5: Wire navigation, SEO summary, and overview metrics

**Files:**
- Modify: `src/components/zaruku-seo-week-selection.ts`
- Modify: `src/components/zaruku-seo-week-selection.test.ts`
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/zaruku-seo-workspace.ts`
- Modify: `src/components/zaruku-seo-workspace.test.ts`
- Modify: `src/components/zaruku-north-star.ts`
- Modify: `src/components/zaruku-north-star.test.ts`
- Create: `src/components/zaruku-ai-navigation.test.ts`

**Interfaces:**
- Consumes: the Task 3 read model and Task 4 tab.
- Produces: `alice` navigation, an SEO summary card, and latest monthly AI values across the overview.

- [ ] **Step 1: Write failing navigation and time-owner tests**

```ts
assert.equal(zarukuTimeOwner("alice"), "none");
assert.equal(shouldShowSeoWeekToolbar("alice"), false);
assert.match(source, /\{ id: "alice", label: "ИИ-видимость и конкуренты"/);
assert.match(source, /case "alice":/);
```

- [ ] **Step 2: Run the navigation tests and confirm RED**

Run: `node --import tsx --test src/components/zaruku-seo-week-selection.test.ts src/components/zaruku-ai-navigation.test.ts`

Expected: FAIL because `alice` is not a valid tab.

- [ ] **Step 3: Add the new tab after SEO**

Extend `ZarukuTabId` with `alice`, add `NAV` label `ИИ-видимость и конкуренты` between SEO and Wordstat, assign no global time owner, import the detailed component, and render it from the dashboard switch.

- [ ] **Step 4: Replace the expanded SEO panel with a short summary card**

The card uses the latest published snapshot and renders:

```text
ИИ-видимость в Алисе AI
Август 2026
43,91%
−0,09 п. п. к июлю
Ручная выгрузка · 04.09.2026
Открыть запросы и конкурентов
```

The action calls the existing tab-selection path with `alice`. Remove `AiAggregateVisibilityPanel` from SEO after the summary test is RED.

- [ ] **Step 5: Update overview and north-star helpers to use the new monthly source**

Replace the legacy AI aggregate argument with the latest published `alice_visibility` snapshots for the AI KPI and weekly focus. The latest overview value becomes August `43.91`; July remains the comparison point. Do not label legacy 89/155 as current mentions or citations.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test src/components/zaruku-seo-week-selection.test.ts src/components/zaruku-ai-navigation.test.ts src/components/zaruku-seo-workspace.test.ts src/components/zaruku-north-star.test.ts`

Expected: PASS and no expanded AI panel copy remains in the SEO tab.

- [ ] **Step 7: Commit integration**

```bash
git add src/components/zaruku-seo-week-selection.ts src/components/zaruku-seo-week-selection.test.ts src/components/ZarukuSeoDashboard.tsx src/components/zaruku-seo-workspace.ts src/components/zaruku-seo-workspace.test.ts src/components/zaruku-north-star.ts src/components/zaruku-north-star.test.ts src/components/zaruku-ai-navigation.test.ts
git commit -m "feat: integrate Zaruku AI visibility navigation"
```

### Task 6: Migrate, load July and August, deploy, and verify

**Files:**
- Modify: `README.md`
- Use local source: `/Users/nafanya/Downloads/neurostatistics-zaruku.ru-20260904-152814 (1).xlsx`

**Interfaces:**
- Consumes: migration 046, the importer, the supplied workbook, and the approved featured-site list.
- Produces: published July and August snapshots in production plus the deployed dashboard.

- [ ] **Step 1: Document the monthly handoff command**

Add a concise README section containing the required inputs, dry-run command, execute command, idempotency behavior, correction flag, and a warning that the official SoV is not calculated from the Excel row count.

- [ ] **Step 2: Run the complete local verification before deployment**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Expected: every command exits 0 with no test failures or type/build errors.

- [ ] **Step 3: Apply migration 046 using the existing migration runner**

Run: `npm run db:migrate`

Expected: migration runner applies all idempotent migrations including 046; all four tables exist and an immediate read-only schema check confirms their keys and columns.

- [ ] **Step 4: Publish the July summary-only snapshot**

Run the importer with:

```text
--summary-only --period 2026-07 --official-sov 44 --captured-at 2026-07-13T14:30:00.000Z --legacy-source wm_alisa_manual_legacy --legacy-mentions 89 --legacy-citations 155 --execute
```

Expected: one published July snapshot, null query coverage, and no child query/source rows.

- [ ] **Step 5: Dry-run and publish August**

Use the supplied XLSX, official SoV `43.91`, capture time `2026-09-04T13:28:14.000Z`, and these repeated `--featured-site` values:

```text
https://onco-life.ru
https://chernyakhovsk39.ru
https://yusupovs.com
https://dzen.ru
https://doctu.ru
https://brobank.ru
https://zoon.ru
https://amse.spb.ru
https://www.oncology-centr.ru
https://2gis.ru
```

Expected before execute: 155 queries, 89 present, 57.42% example coverage, 1,313 sources, 10 featured sites, and zero validation mismatches. Execute only after those values match.

- [ ] **Step 6: Verify canonical database totals**

Read-only checks must prove:

```text
2026-07: official_sov_pct=44.0000, query counts NULL, published
2026-08: official_sov_pct=43.9100, exported_query_count=155, portal_present_query_count=89, sample_presence_pct=57.4194, published
August query rows=155
August source rows=1313
August featured-site rows=10
August exact Zaruku positions: 89 at position 1, 0 at other positions
Duplicate query hashes=0
Duplicate query/source ranks=0
```

- [ ] **Step 7: Deploy with the repository deployment path**

Run: `npm run deploy`

Expected: deployment completes, application health passes, and the active release contains migration 046, importer, read model, and UI components. Do not place the XLSX in the release.

- [ ] **Step 8: Verify the live dashboard**

Open Zaruku dashboard 28 and confirm:

1. SEO shows only the short August card with 43.91% and −0.09 percentage points.
2. The new tab appears after SEO.
3. The monthly chart contains July and August.
4. August cards show 43.91%, 155, 89, and 57.42% with the distinction explained.
5. Query search, presence filter, pagination, row expansion, portal links, and Alice links work.
6. Competitor counts match read-only database aggregation.
7. Featured sites display without an implied ranking.
8. July detail shows the no-detail message without losing its 44.00% point.
9. Browser console and application logs contain no new errors.

- [ ] **Step 9: Re-run production-safe verification and commit documentation**

Run the public-asset security check and a read-only production smoke after deployment. Then commit the README change:

```bash
git add README.md
git commit -m "docs: describe monthly Alice visibility imports"
```
