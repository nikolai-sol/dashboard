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
  const metadata = rows.metadata?.[0] ?? null;
  const endpointRows = (facts: DbRow[] | undefined, endpoint: "query" | "region" | "historical") => {
    const period = endpoint === "query"
      ? { from: metadata?.query_from, to: metadata?.query_to }
      : endpoint === "region"
        ? { from: metadata?.region_from, to: metadata?.region_to }
        : {
            from: rows["historical-period"]?.[0]?.period_from,
            to: rows["historical-period"]?.[0]?.period_to,
          };
    const scopeCount = endpoint === "query"
      ? metadata?.query_scope_count
      : endpoint === "region"
        ? metadata?.region_scope_count
        : rows["historical-period"]?.length ? 1 : 0;
    const emptyScopeCount = endpoint === "query"
      ? metadata?.query_empty_scope_count
      : endpoint === "region"
        ? metadata?.region_empty_scope_count
        : 0;
    const endpointStatus = metadata?.[`${endpoint}_last_status`] ?? metadata?.last_status ?? null;
    const coverageRunStatus = metadata?.[`${endpoint}_coverage_run_status`] ?? endpointStatus;
    const state = {
      endpoint_from: period.from ?? null,
      endpoint_to: period.to ?? null,
      endpoint_scope_count: scopeCount ?? 0,
      endpoint_empty_scope_count: emptyScopeCount ?? 0,
      endpoint_coverage_run_status: coverageRunStatus,
      endpoint_last_status: endpointStatus,
      endpoint_last_finished_at: metadata?.[`${endpoint}_last_finished_at`] ?? metadata?.last_finished_at ?? null,
      endpoint_last_success_at: metadata?.[`${endpoint}_last_success_at`] ?? metadata?.last_success_at ?? null,
      endpoint_last_error_at: metadata?.[`${endpoint}_last_error_at`] ?? metadata?.last_error_at ?? null,
      endpoint_last_error_summary: metadata?.[`${endpoint}_last_error_summary`] ?? metadata?.last_error_summary ?? null,
      endpoint_rows_read: metadata?.rows_read ?? 0,
      endpoint_rows_written: metadata?.rows_written ?? 0,
    };
    return (facts?.length ? facts : [{}]).map((fact) => ({ ...state, ...fact }));
  };
  return {
    queries,
    run: async (query: SqlQuery) => {
      queries.push(query);
      if (query.sql.includes("wordstat:metadata")) return rows.metadata ?? [];
      if (query.sql.includes("wordstat:historical-period")) return rows["historical-period"] ?? [];
      if (query.sql.includes("wordstat:historical")) return endpointRows(rows["historical-rows"], "historical");
      if (query.sql.includes("wordstat:current-queries")) return endpointRows(rows["current-queries"], "query");
      if (query.sql.includes("wordstat:current-regions")) return endpointRows(rows["current-regions"], "region");
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
  assert.ok(fixture.queries.length >= 3);
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
  assert.equal(data.indicators.irrelevant_demand_share, 100);
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
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
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

test("Wordstat fails closed when historical coverage is missing despite healthy current endpoints", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
  }).run);

  assert.equal(data.status, "partial");
  assert.equal(data.source_freshness?.freshness_status, "delayed");
  assert.equal(data.historical.period, null);
});

test("Wordstat exposes endpoint-specific periods and never labels a regional snapshot with the query window", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      region_from: "2026-08-10",
      region_to: "2026-09-08",
    }],
  }).run);

  assert.deepEqual(data.current.query_period, { from: "2026-08-03", to: "2026-09-01" });
  assert.deepEqual(data.current.region_period, { from: "2026-08-10", to: "2026-09-08" });
  assert.equal(data.current.period, null);
  assert.equal(data.status, "partial");
  assert.match(data.messages.join(" "), /разные.*период/i);
});

test("Wordstat gives a mismatched successful-empty snapshot partial precedence over empty", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_empty_scope_count: 28,
      region_empty_scope_count: 28,
      region_from: "2026-08-10",
      region_to: "2026-09-08",
    }],
  }).run);

  assert.equal(data.status, "partial");
  assert.equal(data.source_freshness?.freshness_status, "delayed");
});

test("Wordstat keeps selected newer endpoint coverage problems visible after an older replay succeeds", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_empty_scope_count: 28,
      region_empty_scope_count: 28,
      query_coverage_run_status: "partial",
      region_coverage_run_status: "partial",
      query_last_status: "success",
      region_last_status: "success",
    }],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
  }).run);

  assert.deepEqual(data.current.period, { from: "2026-08-03", to: "2026-09-01" });
  assert.equal(data.status, "partial");
  assert.equal(data.source_freshness?.last_status, "partial");
  assert.equal(data.source_freshness?.freshness_status, "delayed");
});

test("Wordstat binds query rows and their snapshot period in one statement", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const seen: string[] = [];
  const data = await loadZarukuWordstatData("66624469", async (query) => {
    if (query.sql.includes("wordstat:metadata")) {
      seen.push("metadata");
      return [{
        ...availableMetadata(),
        query_from: "2026-08-10",
        query_to: "2026-09-08",
      }];
    }
    if (query.sql.includes("wordstat:current-queries")) {
      seen.push("queries");
      return [{
        endpoint_from: "2026-08-03",
        endpoint_to: "2026-09-01",
        endpoint_scope_count: 1,
        endpoint_empty_scope_count: 0,
        endpoint_last_status: "success",
        normalized_query: "старый снимок",
        query: "старый снимок",
        request_kind: "popular",
        device: "all",
        count: 50,
        classification: "medical",
        review_status: "reviewed",
      }];
    }
    if (query.sql.includes("wordstat:current-regions")) {
      seen.push("regions");
      return [{
        endpoint_from: "2026-08-03",
        endpoint_to: "2026-09-01",
        endpoint_scope_count: 1,
        endpoint_empty_scope_count: 0,
        endpoint_last_status: "success",
        region_id: 213,
        region_name: "Москва",
        region_type: "city",
        device: "all",
        count: 5,
      }];
    }
    if (query.sql.includes("wordstat:historical")) return [];
    throw new Error(`unexpected Wordstat query: ${query.sql}`);
  });

  assert.equal(seen.includes("metadata"), false);
  assert.deepEqual(data.current.query_period, { from: "2026-08-03", to: "2026-09-01" });
  assert.deepEqual(data.current.queries.map((row) => row.query), ["старый снимок"]);
});

test("Wordstat freshness fails closed for a relevant endpoint run and missing endpoint coverage", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_last_status: "failed",
      region_scope_count: 0,
      region_empty_scope_count: 0,
    }],
  }).run);

  assert.equal(data.status, "partial");
  assert.notEqual(data.source_freshness?.freshness_status, "healthy");
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

test("Wordstat historical rows omit unexpected classifications instead of rewriting them as reviewed medical", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
    "historical-rows": [
      {
        seed_hash: "medical-seed",
        phrase: "медицинская тема",
        topic: "Онкология",
        cluster: null,
        classification: "medical",
        review_status: "reviewed",
        wordstat_count: 20,
        previous_wordstat_count: null,
        webmaster_impressions: 3,
        webmaster_clicks: 1,
        webmaster_average_position: 4,
      },
      {
        seed_hash: "unexpected-seed",
        phrase: "нерелевантная тема",
        topic: null,
        cluster: null,
        classification: "irrelevant",
        review_status: "pending",
        wordstat_count: 900,
        previous_wordstat_count: 800,
        webmaster_impressions: 0,
        webmaster_clicks: 0,
        webmaster_average_position: null,
      },
    ],
  }).run);

  assert.deepEqual(data.historical.rows.map((row) => row.seed_hash), ["medical-seed"]);
  assert.equal(data.historical.rows[0].classification, "medical");
  assert.equal(data.historical.rows[0].review_status, "reviewed");
});

test("Wordstat irrelevant-demand share uses only the non-overlapping popular all-device universe", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "current-queries": [
      {
        normalized_query: "медицинский запрос",
        query: "медицинский запрос",
        request_kind: "popular",
        device: "all",
        count: 100,
        share: null,
        classification: "medical",
        review_status: "reviewed",
      },
      {
        normalized_query: "нерелевантный запрос",
        query: "нерелевантный запрос",
        request_kind: "popular",
        device: "all",
        count: 25,
        share: null,
        classification: "irrelevant",
        review_status: "reviewed",
      },
      {
        normalized_query: "нерелевантный запрос",
        query: "нерелевантный запрос",
        request_kind: "similar",
        device: "all",
        count: 900,
        share: null,
        classification: "irrelevant",
        review_status: "reviewed",
      },
      {
        normalized_query: "нерелевантный запрос",
        query: "нерелевантный запрос",
        request_kind: "popular",
        device: "desktop",
        count: 800,
        share: null,
        classification: "irrelevant",
        review_status: "reviewed",
      },
    ],
  }).run);

  assert.equal(data.indicators.irrelevant_demand_share, 20);
});

test("Wordstat SQL binds facts and run lineage to account-scoped confirmed coverage", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469");

  assert.match(queries.currentQueries.sql, /endpoint_state/i);
  assert.match(queries.currentRegions.sql, /endpoint_state/i);
  assert.match(queries.historicalRows.sql, /endpoint_state/i);
  assert.doesNotMatch(queries.currentQueries.sql, /account_coverage_runs/i);
  assert.match(queries.historicalRows.sql, /seed\.registry_version\s*=\s*dynamics\.registry_version/i);
  assert.match(queries.historicalRows.sql, /coverage\.ingestion_run_id\s*=\s*dynamics\.ingestion_run_id/i);
  assert.match(queries.historicalRows.sql, /dynamics\.report_date\s+BETWEEN\s+coverage\.requested_from\s+AND\s+coverage\.requested_to/i);
  assert.match(queries.historicalRows.sql, /'2026-07-10'/i);
  assert.match(queries.historicalRows.sql, /'2026-07-31'/i);
  assert.doesNotMatch(queries.historicalRows.sql, /previous_demand/i);
  assert.match(queries.currentQueries.sql, /facts\.ingestion_run_id\s*=\s*coverage\.ingestion_run_id/i);
  assert.match(queries.currentRegions.sql, /facts\.ingestion_run_id\s*=\s*coverage\.ingestion_run_id/i);
  assert.match(queries.currentQueries.sql, /facts\.registry_version\s*=\s*coverage\.registry_version/i);
  assert.match(queries.currentRegions.sql, /facts\.registry_version\s*=\s*coverage\.registry_version/i);
  assert.doesNotMatch(queries.currentQueries.sql, /MAX\(requested_to\)/i);
  assert.doesNotMatch(queries.currentRegions.sql, /MAX\(requested_to\)/i);
  assert.match(queries.currentRegions.sql, /classification\s*=\s*'medical'/i);
  assert.match(queries.currentRegions.sql, /review_status\s*=\s*'reviewed'/i);
});

test("Wordstat SQL scopes run state by endpoint family and selects the latest requested snapshot", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469");

  assert.deepEqual(Object.keys(queries).sort(), ["currentQueries", "currentRegions", "historicalRows"]);
  assert.doesNotMatch(queries.currentQueries.sql, /wordstat:metadata/i);
  assert.match(queries.currentQueries.sql, /:current'[\s\S]*:all'/i);
  assert.match(queries.currentRegions.sql, /:regions'[\s\S]*:all'/i);
  assert.match(queries.historicalRows.sql, /:historical'[\s\S]*:all'/i);
  for (const query of [queries.currentQueries, queries.currentRegions]) {
    assert.match(
      query.sql,
      /ORDER BY coverage\.requested_to DESC,\s*coverage\.requested_from DESC,\s*coverage\.updated_at DESC,\s*coverage\.id DESC,\s*coverage\.ingestion_run_id DESC/i,
    );
  }
});

test("Wordstat accepts coverage only when its exact run has the matching account-scoped family key", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469");

  for (const query of [queries.currentQueries, queries.currentRegions, queries.historicalRows]) {
    assert.match(query.sql, /JOIN canonical_collector_runs coverage_run\s+ON coverage_run\.id\s*=\s*coverage\.ingestion_run_id/i);
    assert.match(query.sql, /coverage_run\.job_key IN \([\s\S]*:all'/i);
  }
  assert.match(queries.currentQueries.sql, /:current'/i);
  assert.match(queries.currentRegions.sql, /:regions'/i);
  assert.match(queries.historicalRows.sql, /:historical'/i);
});

test("Wordstat endpoint SQL carries selected coverage-run status separately from latest family-run status", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469");

  for (const query of [queries.currentQueries, queries.currentRegions]) {
    assert.match(query.sql, /coverage_run\.status\s+AS\s+selected_coverage_run_status/i);
    assert.match(query.sql, /latest_snapshot\.selected_coverage_run_status\s+AS\s+endpoint_coverage_run_status/i);
    assert.match(query.sql, /latest_endpoint_run\.status\s+AS\s+endpoint_last_status/i);
  }
});

test("Wordstat read model never imports providers, credentials, or capture-share arithmetic", async () => {
  await wordstatModule();
  const source = readFileSync(new URL("./zaruku-wordstat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /wordstat_count\s*\/\s*(webmaster_)?impressions/i);
  assert.doesNotMatch(source, /market_share|capture_rate/i);
  assert.doesNotMatch(source, /WORDSTAT_TOKEN|oauth|wordstat_api|fetch\s*\(/i);
});
