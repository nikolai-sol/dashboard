import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type SqlQuery = { sql: string; params: Array<string | number> };
type DbRow = Record<string, unknown>;
const JULY_DATES = Array.from({ length: 22 }, (_, index) => `2026-07-${String(index + 10).padStart(2, "0")}`);

async function wordstatModule() {
  return import("./zaruku-wordstat");
}

test("Wordstat ranking aliases do not use the MySQL reserved ROW_NUMBER keyword", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const { currentQueries } = buildZarukuWordstatQueries("66624469", "2026-09-10");
  assert.doesNotMatch(currentQueries.sql, /(?:AS|WHERE)\s+row_number\b/i);
  assert.match(currentQueries.sql, /AS dedup_rank/);
});

test("Wordstat joins established SEO/GSC tables with an explicit compatible collation", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const { currentQueries } = buildZarukuWordstatQueries("66624469", "2026-09-10");
  for (const source of ["positions", "urls"]) {
    assert.ok(currentQueries.sql.includes(`${source}.normalized_query COLLATE utf8mb4_unicode_ci = facts.normalized_query COLLATE utf8mb4_unicode_ci`));
  }
});

function fakeQuery(rows: Partial<Record<"metadata" | "historical-period" | "historical-rows" | "current-queries" | "current-regions", DbRow[]>>) {
  const queries: SqlQuery[] = [];
  const metadata = rows.metadata?.[0] ?? null;
  const endpointRows = (facts: DbRow[] | undefined, endpoint: "query" | "region" | "historical") => {
    const historicalPeriod = rows["historical-period"]?.[0];
    const period = endpoint === "query"
      ? { from: metadata?.query_from, to: metadata?.query_to }
      : endpoint === "region"
        ? { from: metadata?.region_from, to: metadata?.region_to }
        : {
            from: historicalPeriod?.period_from,
            to: historicalPeriod?.period_to,
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
      ...(endpoint === "historical" ? {
        endpoint_confirmed_dates: (historicalPeriod?.confirmed_dates as string[] | undefined ?? JULY_DATES).join(","),
        endpoint_confirmed_day_count: historicalPeriod?.confirmed_day_count ?? (historicalPeriod ? JULY_DATES.length : 0),
        endpoint_confirmed_dates_contiguous: historicalPeriod?.confirmed_dates_contiguous ?? (historicalPeriod ? 1 : 0),
      } : {}),
    };
    return (facts?.length ? facts : [{}]).map((fact) => ({
      ...state,
      ...(endpoint === "query" ? { classification_active: fact.classification_active ?? 1 } : {}),
      ...fact,
    }));
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
        classification_active: 1,
        seo_os_eligible: 1,
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
        seo_os_eligible: 1,
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
      affinity_index: 120,
    }],
  });

  const data = await loadZarukuWordstatData("66624469", fixture.run);

  assert.deepEqual(data.historical.period, { from: "2026-07-10", to: "2026-07-31" });
  assert.equal(data.historical.status, "available");
  assert.deepEqual(data.current.period, { from: "2026-08-03", to: "2026-09-01" });
  assert.equal(data.current.query_status, "available");
  assert.equal(data.current.region_status, "available");
  assert.equal(data.current.queries.length, 1);
  assert.equal(data.current.queries[0].count, 120);
  assert.equal(data.current.queries[0].action, "strengthen_page");
  assert.equal(data.historical.rows[0].previous_wordstat_count, null);
  assert.equal(data.historical.rows[0].demand_change, null);
  assert.equal(data.indicators.growing_medical_topics, null);
  assert.match(data.indicators.growing_medical_topics_reason, /предыдущ.*сопоставим.*период/i);
  assert.deepEqual(data.historical.confirmed_dates, JULY_DATES);
  assert.equal(data.historical.confirmed_day_count, 22);
  assert.equal(data.historical.confirmed_dates_contiguous, true);
  assert.equal(data.current.regional_traffic_comparison.status, "unavailable");
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
  assert.equal(empty.historical.status, "available");
  assert.equal(empty.current.query_status, "empty");
  assert.equal(empty.current.region_status, "empty");
  assert.deepEqual(empty.current.period, { from: "2026-08-03", to: "2026-09-01" });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.historical.status, "unavailable");
  assert.equal(failed.current.query_status, "unavailable");
  assert.equal(failed.current.region_status, "unavailable");
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
  assert.equal(missingRegionCoverage.current.query_status, "empty");
  assert.equal(missingRegionCoverage.current.region_status, "unavailable");
});

test("Wordstat scopes retain confirmed facts independently when another endpoint is partial or unavailable", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const retained = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{ ...availableMetadata(), query_last_status: "failed" }],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
    "historical-rows": [{
      seed_hash: "seed-a", phrase: "рак груди", topic: "Онкология", cluster: null,
      classification: "medical", review_status: "reviewed", wordstat_count: 20,
      previous_wordstat_count: 10, webmaster_impressions: 2, webmaster_clicks: 1,
      webmaster_average_position: 4,
    }],
    "current-queries": [{
      normalized_query: "рак груди", query: "рак груди", request_kind: "popular", device: "all",
      count: 20, classification: "medical", review_status: "reviewed", seo_os_eligible: 1,
      confirmed_url: "/rak-grudi", seo_os_position: 12,
    }],
  }).run);

  assert.equal(retained.status, "partial");
  assert.equal(retained.historical.status, "available");
  assert.equal(retained.historical.rows.length, 1);
  assert.equal(retained.current.query_status, "partial");
  assert.equal(retained.current.queries.length, 1);
  assert.equal(retained.current.region_status, "available");

  const rejectedRegion = await loadZarukuWordstatData("66624469", async (query) => {
    if (query.sql.includes("wordstat:current-regions")) throw new Error("regional read unavailable");
    return fakeQuery({
      metadata: [availableMetadata()],
      "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
    }).run(query);
  });
  assert.equal(rejectedRegion.current.query_status, "available");
  assert.equal(rejectedRegion.current.region_status, "unavailable");
  assert.equal(rejectedRegion.historical.status, "available");
});

test("Wordstat keeps the provider affinity scale around 100 and disables the incomparable Metrika region KPI", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "current-regions": [
      { region_id: 213, region_name: "Москва", region_type: "city", device: "all", count: 20, share: 0.25, affinity_index: 120 },
      { region_id: 2, region_name: "Санкт-Петербург", region_type: "city", device: "all", count: 19, share: 0.2, affinity_index: 100 },
      { region_id: 3, region_name: "Казань", region_type: "city", device: "all", count: 18, share: 0.1, affinity_index: 52 },
    ],
  }).run);

  assert.equal(data.current.regions[0].share, 0.25);
  assert.deepEqual(data.current.regions.map((row) => row.affinity_index), [120, 100, 52]);
  assert.equal(data.indicators.region_opportunity_count, null);
  assert.match(data.indicators.region_opportunity_reason, /Яндекс-органик/i);
  assert.equal(data.current.regional_traffic_comparison.status, "unavailable");
  assert.match(data.current.regional_traffic_comparison.reason, /Яндекс-органик/i);
});

test("Wordstat SEO eligibility is explicit and fails closed for inactive, pending, and missing actions", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "current-queries": [
      { normalized_query: "активный", query: "активный", request_kind: "popular", device: "all", count: 20, classification: "medical", review_status: "reviewed", seo_os_eligible: 1, confirmed_url: "/active", seo_os_position: 5 },
      { normalized_query: "неактивный", query: "неактивный", request_kind: "popular", device: "all", count: 19, classification: "medical", review_status: "reviewed", seo_os_eligible: 0, confirmed_url: "/inactive", seo_os_position: 12 },
      { normalized_query: "ожидает", query: "ожидает", request_kind: "popular", device: "all", count: 18, classification: "medical", review_status: "pending", seo_os_eligible: 0, confirmed_url: "/pending", seo_os_position: 12 },
      { normalized_query: "без действия", query: "без действия", request_kind: "popular", device: "all", count: 17, classification: "medical", review_status: "reviewed", seo_os_eligible: 1, confirmed_url: null, seo_os_position: null },
    ],
  }).run);
  const rows = new Map(data.current.queries.map((row) => [row.query, row]));

  assert.equal(rows.get("активный")?.seo_os_eligible, true);
  assert.equal(rows.get("активный")?.action, "strengthen_page");
  assert.equal(rows.get("неактивный")?.seo_os_eligible, false);
  assert.equal(rows.get("неактивный")?.action, null);
  assert.equal(rows.get("ожидает")?.seo_os_eligible, false);
  assert.equal(rows.get("ожидает")?.action, null);
  assert.equal(rows.get("без действия")?.seo_os_eligible, true);
  assert.equal(rows.get("без действия")?.action, "create_material");
});

test("Wordstat historical availability is separate from weekly current freshness", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
  }).run, new Date("2026-09-02T12:00:00Z"));

  assert.equal(data.status, "partial");
  assert.equal(data.source_freshness?.freshness_status, "healthy");
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
  assert.match(historicalQuery?.sql ?? "", /canonical_fact_webmaster_summary_daily/i);
  assert.match(historicalQuery?.sql ?? "", /JOIN\s+canonical_collector_runs\s+webmaster_run/i);
  assert.match(historicalQuery?.sql ?? "", /webmaster_run\.status\s*=\s*'success'/i);
  assert.doesNotMatch(historicalQuery?.sql ?? "", /coverage_run\.status\s*=\s*'success'/i);
  assert.match(historicalQuery?.sql ?? "", /SUM\(coverage_run_status\s*<>\s*'success'\)\s*>\s*0\s+THEN\s+'partial'/i);
  assert.match(historicalQuery?.sql ?? "", /summary\.impressions\s*=\s*0/i);
  assert.match(historicalQuery?.sql ?? "", /queries\.ingestion_run_id\s*=\s*summary\.ingestion_run_id/i);
  assert.match(historicalQuery?.sql ?? "", /queries\.device_type\s*=\s*summary\.device_type/i);
  assert.match(historicalQuery?.sql ?? "", /queries\.host_id\s*=\s*summary\.host_id/i);
  assert.match(historicalQuery?.sql ?? "", /common_dates/i);
});

test("Wordstat historical payload preserves an exact sparse lineage-confirmed date set", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const dates = ["2026-07-10", "2026-07-12", "2026-07-31"];
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "historical-period": [{
      period_from: "2026-07-10",
      period_to: "2026-07-31",
      confirmed_dates: dates,
      confirmed_day_count: dates.length,
      confirmed_dates_contiguous: 0,
    }],
  }).run);

  assert.deepEqual(data.historical.confirmed_dates, dates);
  assert.equal(data.historical.confirmed_day_count, 3);
  assert.equal(data.historical.confirmed_dates_contiguous, false);
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

test("Wordstat current grain prefers popular, excludes non-all devices, and counts only active reviewed demand", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [availableMetadata()],
    "current-queries": [
      { normalized_query: "один запрос", query: "Один запрос", request_kind: "similar", device: "all", count: 900, classification: "irrelevant", review_status: "reviewed", classification_active: 1 },
      { normalized_query: "один запрос", query: "один запрос", request_kind: "popular", device: "all", count: 25, classification: "irrelevant", review_status: "reviewed", classification_active: 1 },
      { normalized_query: "медицинский", query: "медицинский", request_kind: "popular", device: "all", count: 100, classification: "medical", review_status: "reviewed", classification_active: 1 },
      { normalized_query: "неактивный", query: "неактивный", request_kind: "popular", device: "all", count: 500, classification: "irrelevant", review_status: "reviewed", classification_active: 0 },
      { normalized_query: "проверить", query: "проверить", request_kind: "popular", device: "all", count: 75, classification: "unreviewed", review_status: "pending", classification_active: 1 },
      { normalized_query: "desktop", query: "desktop", request_kind: "popular", device: "desktop", count: 800, classification: "irrelevant", review_status: "reviewed", classification_active: 1 },
    ],
    "current-regions": [
      { region_id: 213, region_name: "Москва", region_type: "city", device: "desktop", count: 999, affinity_index: 150 },
      { region_id: 213, region_name: "Москва", region_type: "city", device: "all", count: 20, affinity_index: 120 },
      { region_id: 213, region_name: "Москва", region_type: "city", device: "all", count: 25, affinity_index: 121 },
    ],
  }).run);

  assert.deepEqual(data.current.queries.map((row) => [row.normalized_query, row.request_kind, row.count]), [
    ["неактивный", "popular", 500],
    ["медицинский", "popular", 100],
    ["проверить", "popular", 75],
    ["один запрос", "popular", 25],
  ]);
  assert.equal(data.current.queries.find((row) => row.query === "неактивный")?.classification, "unreviewed");
  assert.equal(data.current.queries.find((row) => row.query === "неактивный")?.review_status, "pending");
  assert.equal(data.indicators.irrelevant_demand_share, 20);
  assert.equal(data.indicators.review_queue_count, 1);
  assert.deepEqual(data.current.regions.map((row) => [row.region_id, row.device, row.count]), [[213, "all", 25]]);
});

test("Wordstat SQL binds facts and run lineage to account-scoped confirmed coverage", async () => {
  const { buildZarukuWordstatQueries } = await wordstatModule();
  const queries = buildZarukuWordstatQueries("66624469", new Date("2026-09-02T12:00:00Z"));

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
  assert.match(queries.currentQueries.sql, /AS seo_os_eligible/i);
  assert.match(queries.currentQueries.sql, /classifications\.is_active\s*=\s*1/i);
  assert.doesNotMatch(queries.currentQueries.sql, /query_hash\s*=\s*facts\.query_hash\s+AND\s+classifications\.is_active\s*=\s*1/i);
  assert.match(queries.currentQueries.sql, /facts\.device_type\s*=\s*'all'/i);
  assert.match(queries.currentRegions.sql, /facts\.device_type\s*=\s*'all'/i);
  assert.doesNotMatch(queries.currentRegions.sql, /canonical_fact_metrika_breakdowns_daily|map_city_demand|metrika_visits/i);
  assert.match(queries.currentQueries.sql, /PARTITION BY facts\.device_type, facts\.normalized_query/i);
  assert.doesNotMatch(queries.currentQueries.sql, /PARTITION BY facts\.request_kind/i);
  assert.match(queries.currentQueries.sql, /CASE\s+WHEN facts\.request_kind = 'popular' THEN 0 ELSE 1 END/i);
  assert.match(queries.currentRegions.sql, /PARTITION BY facts\.region_id/i);
  for (const query of [queries.currentQueries, queries.currentRegions]) {
    assert.match(query.sql, /coverage\.requested_to\s*<=\s*\?/i);
    assert.equal(query.params.includes("2026-09-02"), true);
  }
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

test("Wordstat old successful current snapshots are delayed against the injected UTC clock", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const data = await loadZarukuWordstatData("66624469", fakeQuery({
    metadata: [{
      ...availableMetadata(),
      query_from: "2026-07-27",
      query_to: "2026-08-25",
      region_from: "2026-07-27",
      region_to: "2026-08-25",
      last_finished_at: "2026-08-26 06:00:00",
      last_success_at: "2026-08-26 06:00:00",
    }],
    "historical-period": [{ period_from: "2026-07-10", period_to: "2026-07-31" }],
  }).run, new Date("2026-09-02T12:00:00Z"));

  assert.equal(data.source_freshness?.expected_frequency_hours, 168);
  assert.equal(data.source_freshness?.freshness_status, "delayed");
  assert.match(data.source_freshness?.note ?? "", /168|устар/i);
});

test("Wordstat legacy coverage with unknown selected-run lineage is never healthy", async () => {
  const { loadZarukuWordstatData } = await wordstatModule();
  const endpoint = {
    endpoint_from: "2026-08-03",
    endpoint_to: "2026-09-01",
    endpoint_scope_count: 1,
    endpoint_empty_scope_count: 0,
    endpoint_last_status: "success",
    endpoint_last_finished_at: "2026-09-02 06:00:00",
    endpoint_last_success_at: "2026-09-02 06:00:00",
    endpoint_rows_read: 1,
    endpoint_rows_written: 1,
  };
  const data = await loadZarukuWordstatData("66624469", async (query) => {
    if (query.sql.includes("wordstat:historical")) return [{
      ...endpoint,
      endpoint_from: "2026-07-10",
      endpoint_to: "2026-07-31",
      endpoint_confirmed_dates: JULY_DATES.join(","),
      endpoint_confirmed_day_count: 22,
      endpoint_confirmed_dates_contiguous: 1,
    }];
    return [endpoint];
  }, new Date("2026-09-02T12:00:00Z"));

  assert.notEqual(data.source_freshness?.freshness_status, "healthy");
});

test("Wordstat read model never imports providers, credentials, or capture-share arithmetic", async () => {
  await wordstatModule();
  const source = readFileSync(new URL("./zaruku-wordstat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /wordstat_count\s*\/\s*(webmaster_)?impressions/i);
  assert.doesNotMatch(source, /market_share|capture_rate/i);
  assert.doesNotMatch(source, /WORDSTAT_TOKEN|oauth|wordstat_api|fetch\s*\(/i);
});
