import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuAiVisibilityRow, ZarukuYandexWebmasterQueryRow } from "@/lib/types";
import {
  selectRowsForWeek,
  summarizeAiVisibility,
  summarizeWebmasterKpis,
  topWebmasterQueries,
} from "@/components/zaruku-yandex-webmaster-panels";

function query(partial: Partial<ZarukuYandexWebmasterQueryRow>): ZarukuYandexWebmasterQueryRow {
  return {
    week: "2026-W28",
    query_id: "q",
    query: "за руку",
    device: "ALL",
    impressions: 0,
    clicks: 0,
    ctr: null,
    average_position: null,
    week_from: "2026-07-06",
    week_to: "2026-07-12",
    ...partial,
  };
}

function ai(partial: Partial<ZarukuAiVisibilityRow>): ZarukuAiVisibilityRow {
  return {
    week: "2026-W28",
    cluster_id: "c",
    query: "онко помощь",
    engine: "yandex_gen_search",
    region: "225",
    language: "ru",
    device: "desktop",
    mentioned: false,
    mention_count: 0,
    citation_count: 0,
    cited_urls: [],
    checked_at: null,
    ...partial,
  };
}

test("summarizeWebmasterKpis totals impressions clicks and weighted position", () => {
  const summary = summarizeWebmasterKpis([
    query({ query_id: "1", impressions: 100, clicks: 10, ctr: 10, average_position: 2 }),
    query({ query_id: "2", impressions: 300, clicks: 15, ctr: 5, average_position: 6 }),
  ]);

  assert.deepEqual(summary, { impressions: 400, clicks: 25, ctr: 6.25, average_position: 5 });
});

test("topWebmasterQueries sorts by impressions then clicks", () => {
  assert.deepEqual(
    topWebmasterQueries([
      query({ query_id: "low", query: "low", impressions: 1, clicks: 10, ctr: 1000, average_position: 1 }),
      query({ query_id: "high", query: "high", impressions: 20, clicks: 1, ctr: 5, average_position: 2 }),
    ], 1).map((row) => row.query_id),
    ["high"],
  );
});

test("summarizeAiVisibility counts presence and citations", () => {
  assert.deepEqual(
    summarizeAiVisibility([
      ai({ cluster_id: "a", mentioned: true, mention_count: 2, citation_count: 1 }),
      ai({ cluster_id: "b", mentioned: false, mention_count: 0, citation_count: 0 }),
    ]),
    { checked: 2, mentioned: 1, presence_rate: 50, mentions: 2, citations: 1 },
  );
});

test("selectRowsForWeek falls back when selected week has no rows", () => {
  assert.deepEqual(
    selectRowsForWeek([
      query({ week: "2026-W27", query_id: "old" }),
      query({ week: "2026-W28", query_id: "latest" }),
    ], "2026-W29", "2026-W28").map((row) => row.query_id),
    ["latest"],
  );
});
