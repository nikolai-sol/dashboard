import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLatestWebmasterAccountQueries,
  buildWebmasterAccountQueries,
  loadZarukuYandexWebmasterData,
  normalizeWebmasterPageRow,
  normalizeWebmasterQueryRow,
} from "@/lib/zaruku-yandex-webmaster";

test("buildWebmasterAccountQueries scopes by account and optional weeks", () => {
  const queries = buildWebmasterAccountQueries(["66624469"], ["2026-W28"]);

  assert.match(queries.queries.sql, /seo_webmaster_queries_weekly/);
  assert.match(queries.queries.sql, /week_key IN \(\?\)/);
  assert.deepEqual(queries.queries.params, ["66624469", "2026-W28"]);
  assert.match(queries.pages.sql, /seo_webmaster_pages_weekly/);
  assert.deepEqual(queries.pages.params, ["66624469", "2026-W28"]);
});

test("buildLatestWebmasterAccountQueries scopes latest rows by account", () => {
  const queries = buildLatestWebmasterAccountQueries(["66624469"]);

  assert.match(queries.queries.sql, /MAX\(week_key\)/);
  assert.deepEqual(queries.queries.params, ["66624469", "66624469"]);
  assert.match(queries.pages.sql, /seo_webmaster_pages_weekly/);
  assert.deepEqual(queries.pages.params, ["66624469", "66624469"]);
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

test("normalizeWebmasterPageRow preserves page url and numeric metrics", () => {
  assert.deepEqual(
    normalizeWebmasterPageRow({
      week_key: "2026-W28",
      page_url: "https://zaruku.ru/map/",
      device_type: "ALL",
      impressions: "90",
      clicks: "9",
      ctr: "10",
      average_position: "3.25",
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    }),
    {
      week: "2026-W28",
      url: "https://zaruku.ru/map/",
      device: "ALL",
      impressions: 90,
      clicks: 9,
      ctr: 10,
      average_position: 3.25,
      week_from: "2026-07-06",
      week_to: "2026-07-12",
    },
  );
});

test("loadZarukuYandexWebmasterData is partial when one table is unavailable", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W28"], async (query) => {
    if (query.sql.includes("seo_webmaster_pages_weekly")) throw new Error("missing table");
    return [
      {
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
      },
    ];
  });

  assert.equal(data.status, "partial");
  assert.equal(data.queries.length, 1);
  assert.equal(data.pages.length, 0);
  assert.match(data.error ?? "", /pages/);
});

test("loadZarukuYandexWebmasterData falls back to latest page week when selected weeks are empty", async () => {
  const data = await loadZarukuYandexWebmasterData(["66624469"], ["2026-W28"], async (query) => {
    if (query.sql.includes("seo_webmaster_queries_weekly")) {
      return [
        {
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
        },
      ];
    }
    if (!query.sql.includes("MAX(week_key)")) return [];
    return [
      {
        week_key: "2026-W27",
        page_url: "https://zaruku.ru/map/",
        device_type: "ALL",
        impressions: 90,
        clicks: 9,
        ctr: 10,
        average_position: 3.25,
        week_from: "2026-06-29",
        week_to: "2026-07-05",
      },
    ];
  });

  assert.deepEqual(data.weeks, ["2026-W27", "2026-W28"]);
  assert.equal(data.latest_week, "2026-W28");
  assert.deepEqual(data.queries.map((row) => row.week), ["2026-W28"]);
  assert.deepEqual(data.pages.map((row) => row.week), ["2026-W27"]);
});
