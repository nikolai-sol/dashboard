import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuAliceVisibilityTab from "@/components/ZarukuAliceVisibilityTab";
import { loadZarukuAliceVisibility } from "@/lib/zaruku-alice-visibility";
import type { ZarukuAliceVisibilityData, ZarukuAliceVisibilitySnapshot } from "@/lib/types";

const augustSnapshot: ZarukuAliceVisibilitySnapshot = {
  id: "august",
  analyticsAccountId: "1",
  month: "2026-08",
  domain: "zaruku.ru",
  officialSovPct: 43.91,
  exportedQueryCount: 155,
  portalPresentQueryCount: 89,
  samplePresencePct: 57.42,
  provenance: { sourceKey: "alice_ai", sourceFilename: "august.xlsx", sourceSha256: "hash", ingestionRunId: "run" },
  queries: [{
    id: "query-1",
    queryHash: "query-1",
    queryText: "инвалидность после мастэктомии",
    portalPresent: true,
    portalPosition: 2,
    portalUrl: "https://zaruku.ru/reabilitaciya",
    aliceAnswerUrl: "https://alice.yandex.ru/answer/1",
    sourceCount: 4,
    rawPresentValue: "true",
    sources: [
      { id: "portal", sourceRank: 2, sourceUrl: "https://zaruku.ru/reabilitaciya", sourceDomain: "zaruku.ru", isPortal: true },
      { id: "competitor-1", sourceRank: 1, sourceUrl: "https://onco-life.ru/article", sourceDomain: "onco-life.ru", isPortal: false },
      { id: "competitor-2", sourceRank: 3, sourceUrl: "https://doctu.ru/article", sourceDomain: "doctu.ru", isPortal: false },
      { id: "unsafe", sourceRank: 4, sourceUrl: "javascript:alert(1)", sourceDomain: "unsafe.example", isPortal: false },
    ],
  }],
  competitors: [{ domain: "onco-life.ru", queryCount: 1, sharePct: 100 }],
  featuredSites: [{ id: "featured-1", displayOrder: 1, siteUrl: "https://onco-life.ru", siteDomain: "onco-life.ru", listKind: "featured" }],
  versions: [],
};

const julySnapshot: ZarukuAliceVisibilitySnapshot = {
  ...augustSnapshot,
  id: "july",
  month: "2026-07",
  officialSovPct: 44,
  exportedQueryCount: null,
  portalPresentQueryCount: null,
  samplePresencePct: null,
  queries: [],
  competitors: [],
  featuredSites: [],
};

const data = (snapshots: ZarukuAliceVisibilitySnapshot[], status: ZarukuAliceVisibilityData["status"] = "available"): ZarukuAliceVisibilityData => ({
  status,
  error: status === "partial" ? "Детальные строки недоступны" : null,
  months: snapshots.map((snapshot) => snapshot.month),
  latestMonth: snapshots.at(-1)?.month ?? null,
  snapshots,
});

test("renders the August official SoV separately from export coverage", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot, augustSnapshot]), locale: "ru-RU" }));
  for (const label of ["ИИ-видимость и конкуренты", "43,91%", "155", "89", "57,42%", "Запросы и позиция Zaruku", "Конкуренты в выгрузке", "Примеры заметных сайтов по данным Яндекса"]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /Официальная доля рассчитана Яндексом/);
  assert.match(markup, /Доля в примерах рассчитана только по выгруженным строкам/);
  assert.match(markup, /Все источники в ответе/);
  assert.match(markup, /Порядок показа не является рейтингом/);
  assert.match(markup, /target="_blank" rel="noreferrer"/);
  assert.doesNotMatch(markup, /javascript:alert/);
});

test("latest detail ignores a stale month hint and renders compact history without a month selector", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, {
    data: { ...data([augustSnapshot, julySnapshot]), latestMonth: "2026-07" },
    locale: "ru-RU",
  }));

  assert.doesNotMatch(markup, /<option[^>]*value="2026-0[78]"/);
  assert.doesNotMatch(markup, />Месяц<select/);
  assert.match(markup, /Последний загруженный месяц/);
  assert.match(markup, /август 2026 г\./);
  assert.match(markup, /43,91%/);
  assert.match(markup, /overflow-x-auto/);
  assert.match(markup, /width:240px/);
});

test("query table fixes column geometry and contains long query and link text", () => {
  const longQuery = "оченьдлинныйнепрерывныйзапрос".repeat(12);
  const longUrl = `https://onco-life.ru/${"very-long-path-segment/".repeat(12)}`;
  const snapshot = {
    ...augustSnapshot,
    queries: [{
      ...augustSnapshot.queries[0]!,
      queryText: longQuery,
      portalUrl: `https://zaruku.ru/${"long-portal-path/".repeat(12)}`,
      sources: [{
        ...augustSnapshot.queries[0]!.sources[1]!,
        sourceUrl: longUrl,
      }],
    }],
  };
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([snapshot]), locale: "ru-RU" }));

  assert.match(markup, /<table class="zaruku-table table-fixed min-w-\[920px\]">/);
  assert.match(markup, /<colgroup>/);
  for (const width of [28, 8, 8, 22, 24, 10]) assert.match(markup, new RegExp(`style="width:${width}%"`));
  assert.match(markup, /min-w-0 whitespace-normal \[overflow-wrap:anywhere\]/);
  assert.match(markup, /class="block min-w-0 max-w-full truncate text-teal-700/);
  assert.match(markup, new RegExp(`href="${longUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(markup, new RegExp(`title="${longUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(markup, /<thead class="zaruku-table-head">/);
});

test("July summary-only view keeps its official SoV and withholds query detail", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot]), locale: "ru-RU" }));
  assert.match(markup, /44,00%/);
  assert.match(markup, /Детализация запросов за июль не была сохранена\./);
  assert.doesNotMatch(markup, /Запросов в выгрузке/);
  assert.doesNotMatch(markup, /89/);
  assert.doesNotMatch(markup, /155/);
});

test("empty data explains what is needed for the first snapshot", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([]), locale: "ru-RU" }));
  assert.match(markup, /Пока нет опубликованных снимков ИИ-видимости/);
  assert.match(markup, /Передайте месячную выгрузку/);
});

test("a successful zero-row canonical load reaches the first-upload component guidance", async () => {
  const loaded = await loadZarukuAliceVisibility(["66624469"], async () => []);
  assert.equal(loaded.status, "available");
  assert.equal(loaded.latestMonth, null);
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: loaded, locale: "ru-RU" }));
  assert.match(markup, /Пока нет опубликованных снимков ИИ-видимости/);
  assert.match(markup, /Передайте месячную выгрузку/);
  assert.doesNotMatch(markup, /Попробуйте открыть вкладку позже/);
});

test("a failed canonical snapshot read remains unavailable", async () => {
  const loaded = await loadZarukuAliceVisibility(["66624469"], async (query) => {
    if (query.sql.includes("alice-visibility:snapshots")) throw new Error("snapshot read failed");
    return [];
  });
  assert.equal(loaded.status, "unavailable");
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: loaded, locale: "ru-RU" }));
  assert.match(markup, /Попробуйте открыть вкладку позже/);
  assert.doesNotMatch(markup, /Передайте месячную выгрузку/);
});

test("unavailable snapshots show an honest retry-later state instead of an import request", () => {
  const unavailable = { ...data([], "unavailable"), error: "Опубликованные ежемесячные снимки AI-видимости недоступны." };
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: unavailable, locale: "ru-RU" }));
  assert.match(markup, /Данные ИИ-видимости сейчас недоступны/);
  assert.match(markup, /Попробуйте открыть вкладку позже/);
  assert.doesNotMatch(markup, /Пока нет опубликованных снимков/);
  assert.doesNotMatch(markup, /Передайте месячную выгрузку/);
  assert.doesNotMatch(markup, /Канонические снимки/);
});

test("partial data preserves the visible monthly result", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot], "partial"), locale: "ru-RU" }));
  assert.match(markup, /44,00%/);
  assert.match(markup, /Детализация запросов за июль не была сохранена\./);
});

test("a later partial snapshot does not claim its detail was lost in July", () => {
  const partialAugust = { ...augustSnapshot, queries: [], competitors: [], featuredSites: [] };
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot, partialAugust], "partial"), locale: "ru-RU" }));
  assert.match(markup, /43,91%/);
  assert.match(markup, /Детализация запросов за август 2026 г\. пока недоступна\./);
  assert.doesNotMatch(markup, /Детализация запросов за июль не была сохранена\./);
  assert.match(markup, /155/);
  assert.match(markup, /89/);
  assert.match(markup, /57,42%/);
});

test("partial source and featured reads do not turn empty arrays into factual empty claims", () => {
  const partialAugust = {
    ...augustSnapshot,
    queries: augustSnapshot.queries.map((query) => ({ ...query, sources: [] })),
    competitors: [],
    featuredSites: [],
  };
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([partialAugust], "partial"), locale: "ru-RU" }));
  assert.match(markup, /инвалидность после мастэктомии/);
  assert.match(markup, /Часть детализации по источникам и примерам временно недоступна/);
  assert.match(markup, /Источники временно недоступны/);
  assert.match(markup, /Данные об источниках для конкурентов временно недоступны/);
  assert.match(markup, /Примеры заметных сайтов временно недоступны/);
  assert.doesNotMatch(markup, /В выгрузке нет внешних источников для подсчёта/);
  assert.doesNotMatch(markup, /Яндекс не передал примеры заметных сайтов/);
});

test("detailed view renders safe Zaruku subdomains and suppresses a foreign path spoof", () => {
  const safeSubdomain = {
    ...augustSnapshot,
    queries: [{
      ...augustSnapshot.queries[0]!,
      portalUrl: "https://www.zaruku.ru/reabilitaciya",
      sources: augustSnapshot.queries[0]!.sources.map((source) => source.isPortal
        ? { ...source, sourceUrl: "https://guides.zaruku.ru/reabilitaciya", sourceDomain: "guides.zaruku.ru" }
        : source),
    }],
  };
  const safeMarkup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([safeSubdomain]), locale: "ru-RU" }));
  assert.match(safeMarkup, /href="https:\/\/www\.zaruku\.ru\/reabilitaciya"/);
  assert.match(safeMarkup, /href="https:\/\/guides\.zaruku\.ru\/reabilitaciya"/);

  const spoofed = {
    ...safeSubdomain,
    queries: [{ ...safeSubdomain.queries[0]!, portalUrl: "https://example.test/path/zaruku.ru" }],
  };
  const spoofedMarkup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([spoofed]), locale: "ru-RU" }));
  assert.doesNotMatch(spoofedMarkup, /href="https:\/\/example\.test\/path\/zaruku\.ru"/);
});

test("detailed UI formats official SoV and percentage-point delta without a percent-point hybrid", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot, augustSnapshot]), locale: "ru-RU" }));
  assert.match(markup, /43,91%/);
  assert.match(markup, /Δ −0,09 п\. п\./);
  assert.doesNotMatch(markup, /% п\.?п\.?/);
  const julyMarkup = renderToStaticMarkup(createElement(ZarukuAliceVisibilityTab, { data: data([julySnapshot]), locale: "ru-RU" }));
  assert.match(julyMarkup, /44,00%/);
});
