import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuAliceVisibilityQuery, ZarukuAliceVisibilitySnapshot } from "@/lib/types";
import {
  aliceDetailState,
  filterAliceQueries,
  monthlySovDelta,
  formatAliceMonthLabel,
  paginateAliceQueries,
  selectAliceSnapshot,
} from "@/components/zaruku-alice-visibility-view";

const query = (queryText: string, portalPresent: boolean): ZarukuAliceVisibilityQuery => ({
  id: queryText,
  queryHash: queryText,
  queryText,
  portalPresent,
  portalPosition: portalPresent ? 2 : null,
  portalUrl: portalPresent ? "https://zaruku.ru/page" : null,
  aliceAnswerUrl: "https://alice.yandex.ru/answer",
  sourceCount: 1,
  rawPresentValue: String(portalPresent),
  sources: [],
});

const snapshot = (month: string, queries: ZarukuAliceVisibilityQuery[] = []): ZarukuAliceVisibilitySnapshot => ({
  id: month,
  analyticsAccountId: "1",
  month,
  domain: "zaruku.ru",
  officialSovPct: month === "2026-08" ? 43.91 : 44,
  exportedQueryCount: queries.length || null,
  portalPresentQueryCount: queries.filter((row) => row.portalPresent).length || null,
  samplePresencePct: queries.length ? queries.filter((row) => row.portalPresent).length / queries.length * 100 : null,
  provenance: { sourceKey: "alice", sourceFilename: null, sourceSha256: "hash", ingestionRunId: "run" },
  queries,
  competitors: [],
  featuredSites: [],
  versions: [],
});

const rows = [
  query("Инвалидность после мастэктомии", true),
  query("реабилитация после операции", false),
  query("Мастэктомия и восстановление", false),
];

test("monthly delta is expressed in percentage points", () => {
  assert.equal(monthlySovDelta([{ month: "2026-07", officialSovPct: 44 }, { month: "2026-08", officialSovPct: 43.91 }], "2026-08"), -0.09);
});

test("month labels are derived from YYYY-MM fields without parsing the period as a timestamp", () => {
  assert.equal(formatAliceMonthLabel("2026-08", "ru-RU"), "август 2026 г.");
  assert.equal(formatAliceMonthLabel("not-a-month", "ru-RU"), "not-a-month");
});

test("query table supports text and presence filters", () => {
  assert.deepEqual(
    filterAliceQueries(rows, { text: "мастэктом", presence: "present" }).map((row) => row.queryText),
    ["Инвалидность после мастэктомии"],
  );
});

test("query filtering is case-insensitive and keeps a stable query-text order", () => {
  assert.deepEqual(
    filterAliceQueries(rows, { text: "", presence: "all" }).map((row) => row.queryText),
    ["Инвалидность после мастэктомии", "Мастэктомия и восстановление", "реабилитация после операции"],
  );
  assert.deepEqual(
    filterAliceQueries(rows, { text: "МАСТЭКТОМ", presence: "absent" }).map((row) => row.queryText),
    ["Мастэктомия и восстановление"],
  );
});

test("pagination uses pages of 25 rows and clamps the requested page", () => {
  const manyRows = Array.from({ length: 26 }, (_, index) => query(`запрос ${String(index + 1).padStart(2, "0")}`, false));
  const page = paginateAliceQueries(manyRows, 99);
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 2);
  assert.deepEqual(page.rows.map((row) => row.queryText), ["запрос 26"]);
});

test("month selection falls back to the newest available snapshot", () => {
  const july = snapshot("2026-07");
  const august = snapshot("2026-08", rows);
  assert.equal(selectAliceSnapshot([july, august], "2026-06"), august);
  assert.equal(selectAliceSnapshot([july, august], "2026-07"), july);
});

test("summary-only snapshots do not expose ambiguous historical query totals", () => {
  assert.equal(aliceDetailState(snapshot("2026-07")), "summary-only");
  assert.equal(aliceDetailState(snapshot("2026-08", rows)), "ready");
  assert.equal(aliceDetailState(null), "empty");
});
