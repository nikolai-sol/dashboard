import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuQualityTab from "@/components/ZarukuQualityTab";
import type { ZarukuDatasetMeta, ZarukuSeoData } from "@/lib/types";

const source = readFileSync(new URL("./ZarukuQualityTab.tsx", import.meta.url), "utf8");

test("quality tab reads from verdict to limitations to technical freshness", () => {
  const headings = ["Можно ли доверять данным?", "Покрытие и ограничения", "Свежесть источников", "Ожидаемые источники"];
  let previous = -1;
  for (const heading of headings) {
    const index = source.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the previous section`);
    previous = index;
  }
});

test("quality surface keeps collector internals in progressive disclosure", () => {
  assert.match(source, /buildZarukuTrustState/);
  assert.match(source, /<details/);
  assert.match(source, /Технические детали/);
  assert.match(source, /rows_written/);
  assert.doesNotMatch(source, />Source freshness</);
});

const meta = (
  state: ZarukuDatasetMeta["state"],
  period: { from: string; to: string },
): ZarukuDatasetMeta => ({
  state,
  sources: ["metrika"],
  period,
  requested_period: { from: "2026-07-19", to: "2026-07-21" },
  geography: "unsegmented",
  metrics: {
    visits: true,
    users: false,
    pageviews: true,
    bounce_rate: true,
    avg_duration_seconds: true,
    page_depth: true,
  },
  message: state === "unavailable" ? "Collector report is unavailable." : null,
});

test("quality distinguishes delayed, successful-empty, and unavailable coverage with dates", () => {
  const data = {
    dataset_meta: {
      traffic_channels: meta("ready", { from: "2026-07-19", to: "2026-07-21" }),
      devices: meta("empty", { from: "2026-07-19", to: "2026-07-21" }),
      interests: meta("unavailable", { from: "2026-07-19", to: "2026-07-21" }),
    },
    source_freshness: [{
      source_key: "yandex_metrika",
      label: "Яндекс Метрика",
      collector: "fetch_yandex_metrika_canonical.py",
      expected_frequency_hours: 24,
      freshness_status: "delayed",
      freshness_label: "delayed",
      last_status: "success",
      last_finished_at: "2026-07-22 06:14:00",
      last_success_at: "2026-07-22 06:14:00",
      date_from: "2026-07-19",
      date_to: "2026-07-21",
      rows_read: 0,
      rows_written: 0,
      last_error_at: null,
      last_error_summary: null,
      note: "Последний successful cron collector записал 0 rows.",
    }],
    data_quality: [],
    pending_requirements: [],
  } as unknown as ZarukuSeoData;

  const markup = renderToStaticMarkup(createElement(ZarukuQualityTab, { data }));
  const text = markup.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

  assert.match(text, /задерживается/);
  assert.match(text, /Успешно, данных нет/);
  assert.match(text, /Отчёт недоступен/);
  assert.match(text, /Покрытие: 2026-07-19 — 2026-07-21/);
  assert.match(text, /Collector: fetch_yandex_metrika_canonical\.py/);
});
