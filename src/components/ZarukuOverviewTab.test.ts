import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuOverviewTab from "@/components/ZarukuOverviewTab";
import type { ZarukuDatasetMeta, ZarukuSeoData } from "@/lib/types";

const dailyMeta: ZarukuDatasetMeta = {
  state: "ready",
  sources: ["metrika"],
  period: { from: "2026-07-19", to: "2026-07-21" },
  requested_period: { from: "2026-07-19", to: "2026-07-23" },
  geography: "unsegmented",
  metrics: {
    visits: true,
    users: false,
    pageviews: true,
    bounce_rate: true,
    avg_duration_seconds: true,
    page_depth: true,
  },
  message: null,
};

const data = {
  dataset_meta: { traffic_channels: dailyMeta },
  source_freshness: [],
  gsc: { latest_week: null, summary: [], queries: [] },
  webmaster: { latest_week: null, summary: [], queries: [] },
  seo_os: { latest_week: "2026-W29", position_trend: [{ week: "2026-W29" }] },
  seo_intelligence: {
    ai: {
      latest_period: "2026-07",
      rows: [{ period: "2026-07", provenance: "manual snapshot" }],
    },
  },
} as unknown as ZarukuSeoData;

function visibleText(markup: string) {
  return markup.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

test("overview states the effective daily period and the standard 48-hour lag", () => {
  const text = visibleText(renderToStaticMarkup(
    createElement(ZarukuOverviewTab, { data }, createElement("div", null, "content")),
  ));

  assert.match(text, /Ежедневные данные: 19\.07\.2026–21\.07\.2026 · стандартный лаг 48 часов/);
  assert.doesNotMatch(text, /фактически по|лимитирующий источник|ограничивает период/i);
});

test("overview labels SEO OS as an independent weekly position snapshot", () => {
  const markup = renderToStaticMarkup(
    createElement(ZarukuOverviewTab, { data }, createElement("div", null, "content")),
  );
  const text = visibleText(markup);

  assert.match(text, /2026-W29 · недельный срез позиций/);
  assert.match(markup, /role="tooltip"/);
  assert.match(text, /не относится к выбранному ежедневному периоду/i);
  assert.match(text, /не ограничивает данные Метрики, GSC или Вебмастера/i);
});
