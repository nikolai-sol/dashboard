import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuAiVisibilityRow, ZarukuYandexWebmasterQueryRow } from "@/lib/types";
import {
  buildWebmasterFactsPanelChrome,
  buildWebmasterSelectionMeta,
  resolveRowsForWeek,
  resolveRowsForWeekOrLatest,
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
    is_partial_week: false,
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

test("selectRowsForWeek does not fallback when selected week has no rows", () => {
  assert.deepEqual(
    selectRowsForWeek([
      query({ week: "2026-W27", query_id: "old" }),
      query({ week: "2026-W28", query_id: "latest" }),
    ], "2026-W29", "2026-W28").map((row) => row.query_id),
    [],
  );
});

test("resolveRowsForWeek keeps selected empty week without fallback", () => {
  const selection = resolveRowsForWeek([
    query({ week: "2026-W27", query_id: "old" }),
    query({ week: "2026-W28", query_id: "latest" }),
  ], "2026-W29", "2026-W28");

  assert.equal(selection.week, "2026-W29");
  assert.deepEqual(selection.rows.map((row) => row.query_id), []);
});

test("resolveRowsForWeekOrLatest falls back to latest available row week for sparse query details", () => {
  const selection = resolveRowsForWeekOrLatest([
    query({ week: "2026-W27", query_id: "old" }),
    query({ week: "2026-W28", query_id: "latest" }),
  ], "2026-W29", "2026-W28");

  assert.equal(selection.week, "2026-W28");
  assert.deepEqual(selection.rows.map((row) => row.query_id), ["latest"]);
});

test("resolveRowsForWeek uses the latest row week when no week is selected", () => {
  const selection = resolveRowsForWeek([
    query({ week: "2026-W27", query_id: "page-facts" }),
  ], null, "2026-W28");

  assert.equal(selection.week, "2026-W27");
  assert.deepEqual(selection.rows.map((row) => row.query_id), ["page-facts"]);
});

test("buildWebmasterSelectionMeta labels partial current week without fallback warning", () => {
  const selection = resolveRowsForWeek([
    query({
      week: "2026-W29",
      query_id: "current",
      week_from: "2026-07-13",
      week_to: "2026-07-14",
      is_partial_week: true,
    }),
  ], "2026-W29", "2026-W29");

  assert.deepEqual(buildWebmasterSelectionMeta(selection, "2026-W29"), {
    periodLabel: "2026-W29 · частично, по 14.07",
    sourceNote: "Источник: Яндекс Вебмастер / canonical_fact_webmaster_*_daily.",
    fallbackNote: null,
  });
});

test("buildWebmasterSelectionMeta explains when sparse details use the latest available week", () => {
  const selection = resolveRowsForWeekOrLatest([
    query({ week: "2026-W28", query_id: "latest" }),
  ], "2026-W29", "2026-W28");

  assert.deepEqual(buildWebmasterSelectionMeta(selection, "2026-W29"), {
    periodLabel: "2026-W28 · 2026-07-06 — 2026-07-12",
    sourceNote: "Источник: Яндекс Вебмастер / canonical_fact_webmaster_*_daily.",
    fallbackNote: "За выбранную неделю 2026-W29 детальных данных Яндекс Вебмастера пока нет; показываем последнюю доступную неделю 2026-W28.",
  });
});

test("buildWebmasterSelectionMeta warns only when there is no Webmaster data at all", () => {
  assert.deepEqual(buildWebmasterSelectionMeta({ week: "2026-W29", rows: [] }, "2026-W29"), {
    periodLabel: "2026-W29",
    sourceNote: "Источник: Яндекс Вебмастер / canonical_fact_webmaster_*_daily.",
    fallbackNote: "За выбранную неделю данных Яндекс Вебмастера пока нет.",
  });
});

test("buildWebmasterFactsPanelChrome keeps source badge without layer hint", () => {
  assert.deepEqual(buildWebmasterFactsPanelChrome(), {
    source: "webmaster",
    layer: null,
  });
});
