import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type SqlQuery = { sql: string; params: Array<string | number> };
type DbRow = Record<string, unknown>;

async function wordstatModule() {
  return import("./zaruku-wordstat");
}

function fakeQuery(rows: Partial<Record<"metadata" | "historical-period" | "historical-rows" | "current-queries" | "current-regions", DbRow[]>>) {
  const queries: SqlQuery[] = [];
  return {
    queries,
    run: async (query: SqlQuery) => {
      queries.push(query);
      if (query.sql.includes("wordstat:metadata")) return rows.metadata ?? [];
      if (query.sql.includes("wordstat:historical-period")) return rows["historical-period"] ?? [];
      if (query.sql.includes("wordstat:historical-rows")) return rows["historical-rows"] ?? [];
      if (query.sql.includes("wordstat:current-queries")) return rows["current-queries"] ?? [];
      if (query.sql.includes("wordstat:current-regions")) return rows["current-regions"] ?? [];
      throw new Error(`unexpected Wordstat query: ${query.sql}`);
    },
  };
}

function availableMetadata(): DbRow {
  return {
    query_from: "2026-08-03",
    query_to: "2026-09-01",
    query_scope_count: 28,
    query_empty_scope_count: 0,
    region_from: "2026-08-03",
    region_to: "2026-09-01",
    region_scope_count: 28,
    region_empty_scope_count: 0,
    last_status: "success",
    last_finished_at: "2026-09-02 06:00:00",
    last_success_at: "2026-09-02 06:00:00",
    last_error_at: null,
    last_error_summary: null,
    rows_read: 100,
    rows_written: 80,
  };
}

test("Wordstat loader reads canonical data and keeps periods separate", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const fixture = fakeQuery({
    metadata: [availableMetadata()],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
    "historical-rows": [{
      seed_hash: "seed-a",
      phrase: "рак груди",
      topic: "Онкология",
      cluster: "рак",
      classification: "medical",
      review_status: "reviewed",
      wordstat_count: 120,
      previous_wordstat_count: 100,
      webmaster_impressions: 10,
      webmaster_clicks: 2,
      webmaster_average_position: 18,
    }],
    "current-queries": [
      {
        normalized_query: "рак груди",
        query: "Рак груди",
        request_kind: "popular",
        device: "all",
        count: 90,
        share: 0.2,
        classification: "medical",
        review_status: "reviewed",
        topic: "Онкология",
        cluster: "рак",
        seo_os_position: 18,
        seo_os_week: "2026-W35",
        confirmed_url: "https://zaruku.ru/rak-grudi/",
      },
      {
        normalized_query: "рак груди",
        query: "рак груди",
        request_kind: "popular",
        device: "all",
        count: 120,
        share: 0.25,
        classification: "medical",
        review_status: "reviewed",
        topic: "Онкология",
        cluster: "рак",
        seo_os_position: 18,
        seo_os_week: "2026-W35",
        confirmed_url: "https://zaruku.ru/rak-grudi/",
      },
    ],
    "current-regions": [{
      region_id: 213,
      region_name: "Москва",
      region_type: "city",
      device: "all",
      count: 33,
      share: 0.1,
      affinity_index: 1.2,
      metrika_visits: 4,
    }],
  });

  const data = await loadZarukuWordstatData("66624469", fixture.run);

  assert.deepEqual(data.historical.period, { from: "2026-07-10", to: "2026-07-31" });
  assert.deepEqual(data.current.period, { from: "2026-08-03", to: "2026-09-01" });
  assert.equal(data.current.queries.length, 1);
  assert.equal(data.current.queries[0].count, 120);
  assert.equal(data.current.queries[0].action, "strengthen_page");
  assert.equal(data.current.regions[0].metrika_visits, 4);
  assert.equal(data.status, "available");
  assert.ok(fixture.queries.length >= 5);
  for (const query of fixture.queries) {
    assert.equal(query.params.includes("outside-account"), false);
    assert.equal(query.params.includes("66624469"), true);
  }
});

test("Wordstat SEO actions and opportunities require an active reviewed medical classification", async () => {
  const { classifyWordstatOpportunity, loadZarukuWordstatData } = await wordstatModule();
  assert.equal(classifyWordstatOpportunity({
    classification: "medical",
    review_status: "reviewed",
    wordstat_count: 100,
    demand_median: 50,
    webmaster_impressions: 0,
    webmaster_average_position: null,
    visibility_impression_median: 10,
    visibility_position_median: 10,
  }), "high");
  assert.equal(classifyWordstatOpportunity({
    classification: "medical",
    review_status: "pending",
    wordstat_count: 100,
    demand_median: 50,
    webmaster_impressions: 0,
    webmaster_average_position: null,
    visibility_impression_median: 10,
    visibility_position_median: 10,
  }), null);

  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "current-queries": [
      {
        normalized_query: "непроверенный запрос",
        query: "непроверенный запрос",
        request_kind: "similar",
        device: "all",
        count: 55,
        share: 0.1,
        classification: "medical",
        review_status: "pending",
        topic: "Онкология",
        cluster: null,
        seo_os_position: null,
        seo_os_week: null,
        confirmed_url: null,
      },
      {
        normalized_query: "нерелевантный запрос",
        query: "нерелевантный запрос",
        request_kind: "popular",
        device: "all",
        count: 45,
        share: 0.08,
        classification: "irrelevant",
        review_status: "reviewed",
        topic: null,
        cluster: null,
        seo_os_position: null,
        seo_os_week: null,
        confirmed_url: null,
      },
    ],
  }).run);

  const actionsByClassification = new Map(
    data.current.queries.map(({ classification, action }) => [classification, action]),
  );
  assert.equal(actionsByClassification.get("irrelevant"), null);
  assert.equal(actionsByClassification.get("unreviewed"), null);
  assert.equal(data.indicators.review_queue_count, 1);
  assert.equal(data.indicators.irrelevant_demand_share, 45 / 100 * 100);
});

test("Wordstat loader distinguishes successful-empty coverage from a failed run with no coverage", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const empty = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_scope_count: 28,
      query_empty_scope_count: 28,
      region_scope_count: 28,
      region_empty_scope_count: 28,
    }],
  }).run);
  const failed = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_from: null,
      query_to: null,
      query_scope_count: 0,
      query_empty_scope_count: 0,
      region_from: null,
      region_to: null,
      region_scope_count: 0,
      region_empty_scope_count: 0,
      last_status: "failed",
      last_finished_at: "2026-09-02 06:00:00",
      last_error_at: "2026-09-02 06:00:00",
    }],
  }).run);

  assert.equal(empty.status, "empty");
  assert.deepEqual(empty.current.period, { from: "2026-08-03", to: "2026-09-01" });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.current.period, null);
  assert.match(failed.messages.join(" "), /сбой|ошибк/i);

  const missingRegionCoverage = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_scope_count: 28,
      query_empty_scope_count: 28,
      region_scope_count: 0,
      region_empty_scope_count: 0,
    }],
  }).run);
  assert.equal(missingRegionCoverage.status, "partial");
});

test("Wordstat loader rejects an empty account scope and clips historical rows to confirmed common dates", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  await assert.rejects(() => loadZarukuWordstatData("   ", async () => []), /accountId is required/);
  const fixture = fakeQuery({
    metadata: [availableMetadata()],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
    "historical-rows": [{
      seed_hash: "seed-a",
      phrase: "рак груди",
      topic: "Онкология",
      cluster: null,
      classification: "medical",
      review_status: "reviewed",
      wordstat_count: 10,
      previous_wordstat_count: null,
      webmaster_impressions: 2,
      webmaster_clicks: 1,
      webmaster_average_position: 4,
    }],
  });
  const data = await loadZarukuWordstatData("66624469", fixture.run);

  assert.deepEqual(data.historical.period, { from: "2026-07-10", to: "2026-07-31" });
  const historicalQuery = fixture.queries.find((query) => query.sql.includes("wordstat:historical-rows"));
  assert.match(historicalQuery?.sql ?? "", /canonical_wordstat_coverage/i);
  assert.match(historicalQuery?.sql ?? "", /canonical_fact_webmaster_queries_daily/i);
  assert.match(historicalQuery?.sql ?? "", /common_dates/i);
});

test("Wordstat SQL binds facts and run lineage to account-scoped confirmed coverage", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469");

  assert.match(queries.metadata.sql, /account_coverage_runs/i);
  assert.match(queries.metadata.sql, /JOIN account_coverage_runs/i);
  assert.match(queries.historicalRows.sql, /dynamics\.registry_version\s*=\s*seed\.registry_version/i);
  assert.match(queries.currentQueries.sql, /facts\.ingestion_run_id\s*=\s*coverage\.ingestion_run_id/i);
  assert.match(queries.currentRegions.sql, /facts\.ingestion_run_id\s*=\s*coverage\.ingestion_run_id/i);
  assert.doesNotMatch(queries.currentQueries.sql, /facts\.snapshot_date\s*=/i);
  assert.doesNotMatch(queries.currentRegions.sql, /facts\.snapshot_date\s*=/i);
  assert.match(queries.currentRegions.sql, /classification\s*=\s*'medical'/i);
  assert.match(queries.currentRegions.sql, /review_status\s*=\s*'reviewed'/i);
});

test("Wordstat read model never imports providers, credentials, or capture-share arithmetic", async () => {
  await wordstatModule();
  const source = readFileSync(new URL("./zaruku-wordstat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /wordstat_count\s*\/\s*(webmaster_)?impressions/i);
  assert.doesNotMatch(source, /market_share|capture_rate/i);
  assert.doesNotMatch(source, /WORDSTAT_TOKEN|oauth|wordstat_api|fetch\s*\(/i);
});
