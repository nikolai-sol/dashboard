import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuWordstatTab from "@/components/ZarukuWordstatTab";
import type { ZarukuWordstatData } from "@/lib/types";

const fixture: ZarukuWordstatData = {
  status: "available",
  historical: {
    period: { from: "2026-07-10", to: "2026-07-31" },
    rows: [{
      seed_hash: "seed-1",
      phrase: "лечение рака",
      topic: "Лечение рака",
      cluster: "treatment",
      classification: "medical",
      review_status: "reviewed",
      wordstat_count: 1240,
      previous_wordstat_count: 1012,
      demand_change: 228,
      webmaster_impressions: 440,
      webmaster_clicks: 36,
      webmaster_average_position: 17.4,
      opportunity: "high",
    }],
  },
  current: {
    period: { from: "2026-08-03", to: "2026-09-01" },
    query_period: { from: "2026-08-03", to: "2026-09-01" },
    region_period: { from: "2026-08-03", to: "2026-09-01" },
    queries: [{
      normalized_query: "лечение рака",
      query: "лечение рака",
      request_kind: "popular",
      device: "all",
      count: 1240,
      share: 3.1,
      classification: "medical",
      review_status: "reviewed",
      topic: "Лечение рака",
      cluster: "treatment",
      seo_os_position: 12,
      seo_os_week: "2026-W35",
      confirmed_url: "/treatment/",
      action: "strengthen_page",
    }],
    regions: [{
      region_id: 213,
      region_name: "Москва",
      region_type: "город",
      device: "all",
      count: 600,
      share: 12.4,
      affinity_index: 132,
      metrika_visits: 15,
    }],
  },
  indicators: {
    growing_medical_topics: 1,
    largest_opportunity: "high",
    irrelevant_demand_share: 14.2,
    review_queue_count: 1,
    region_opportunity_count: 1,
  },
  source_freshness: {
    source_key: "yandex_wordstat",
    label: "Yandex Wordstat",
    collector: "fetch_yandex_wordstat_canonical.py",
    expected_frequency_hours: 24,
    freshness_status: "healthy",
    freshness_label: "актуально",
    last_status: "success",
    last_finished_at: "2026-09-02T06:15:00Z",
    last_success_at: "2026-09-02T06:15:00Z",
    date_from: "2026-08-03",
    date_to: "2026-09-01",
    rows_read: 4,
    rows_written: 4,
    last_error_at: null,
    last_error_summary: null,
    note: "Снимок подтверждён.",
  },
  messages: [],
};

const unreviewedFixture: ZarukuWordstatData = {
  ...fixture,
  current: {
    ...fixture.current,
    queries: [{
      ...fixture.current.queries[0],
      normalized_query: "непроверенный запрос",
      query: "непроверенный запрос",
      classification: "unreviewed",
      review_status: "pending",
      action: null,
    }],
  },
};

test("Wordstat tab explains irrelevant demand and keeps periods visible", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, { data: fixture }));

  assert.match(markup, /Сопоставление · 10–31 июля 2026/);
  assert.match(markup, /Новые запросы · последние 30 дней · 03.08.2026–01.09.2026/);
  assert.match(markup, /10–31 июля 2026/);
  assert.match(markup, /последние 30 дней/);
  assert.match(markup, /Определяется правилами Zaruku, а не Яндексом/);
  assert.match(markup, /Не является долей нецелевого трафика на сайте/);
  assert.match(markup, /Как формируется вывод по теме/);
});

test("Wordstat tab renders all required management sections with its independent periods", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, { data: fixture }));

  for (const label of [
    "Темы с растущим спросом",
    "Самая большая возможность",
    "Нерелевантный спрос сейчас",
    "Новые темы для проверки",
    "Регионы возможностей",
    "10–31 июля: спрос и присутствие Zaruku",
    "Текущие запросы Wordstat",
    "Региональные возможности",
    "Wordstat → проверка → SEO OS",
    "Запросы: 03.08.2026–01.09.2026",
    "Регионы: 03.08.2026–01.09.2026",
  ]) {
    assert.match(markup, new RegExp(label));
  }
});

test("unreviewed query cannot become a task", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, { data: unreviewedFixture }));

  assert.match(markup, /Нужна медицинская проверка/);
  assert.match(markup, /Не создаёт задачу SEO OS/);
  assert.doesNotMatch(markup, /Можно передать на одобрение в SEO OS/);
});

test("non-medical rows do not expose approved SEO OS actions", () => {
  const queries = (["unreviewed", "adjacent", "irrelevant"] as const).map((classification) => ({
    ...fixture.current.queries[0],
    normalized_query: `query-${classification}`,
    query: `запрос ${classification}`,
    classification,
    review_status: classification === "unreviewed" ? "pending" as const : "reviewed" as const,
    action: null,
  })) satisfies ZarukuWordstatData["current"]["queries"];
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, {
    data: { ...fixture, current: { ...fixture.current, queries } },
  }));

  for (const row of queries) {
    const rowStart = markup.indexOf(row.query);
    const rowMarkup = markup.slice(rowStart, markup.indexOf("</tr>", rowStart));
    assert.match(rowMarkup, /Не создаёт задачу SEO OS/);
    assert.doesNotMatch(rowMarkup, /Можно передать на одобрение в SEO OS/);
    assert.doesNotMatch(rowMarkup, /Усилить страницу|Создать материал|Уточнить формулировку/);
  }
});

test("query chip keeps the confirmed query window when regional coverage differs", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, {
    data: {
      ...fixture,
      current: {
        ...fixture.current,
        period: null,
        region_period: { from: "2026-08-10", to: "2026-08-31" },
      },
    },
  }));

  assert.match(markup, /Новые запросы · последние 30 дней · 03.08.2026–01.09.2026/);
  assert.match(markup, /Периоды запросов и регионов не совпадают: запросы 03.08.2026–01.09.2026, регионы 10.08.2026–31.08.2026/);
});

test("regional opportunity labels use the canonical affinity threshold", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, {
    data: {
      ...fixture,
      current: {
        ...fixture.current,
        regions: [{ ...fixture.current.regions[0], affinity_index: 1.2, metrika_visits: 0 }],
      },
    },
  }));

  assert.match(markup, /1,2 · выше/);
  assert.match(markup, /Высокая возможность/);
});

test("unavailable Wordstat does not invent period or indicator values", () => {
  const markup = renderToStaticMarkup(createElement(ZarukuWordstatTab, {
    data: {
      ...fixture,
      status: "unavailable",
      historical: { period: null, rows: [] },
      current: { period: null, query_period: null, region_period: null, queries: [], regions: [] },
      source_freshness: null,
      messages: ["Доступ к Wordstat пока не установлен."],
    },
  }));

  assert.match(markup, /Нет данных/);
  assert.match(markup, /Период пока не подтверждён/);
  assert.doesNotMatch(markup, />1,240</);
});
