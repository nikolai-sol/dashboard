import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuOverviewTab from "@/components/ZarukuOverviewTab";
import type { ZarukuDatasetMeta, ZarukuSeoData } from "@/lib/types";

const overviewSource = readFileSync(new URL("./ZarukuOverviewTab.tsx", import.meta.url), "utf8");

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

test("overview starts from dashboard content without the duplicated period strip", () => {
  const text = visibleText(renderToStaticMarkup(
    createElement(ZarukuOverviewTab, { data }, createElement("div", null, "content")),
  ));

  assert.match(text, /content/);
  assert.doesNotMatch(text, /Ежедневные данные|стандартный лаг|Период трафика/);
  assert.doesNotMatch(text, /фактически по|лимитирующий источник|ограничивает период/i);
});

test("overview no longer renders a weekly SEO OS period note", () => {
  const markup = renderToStaticMarkup(
    createElement(ZarukuOverviewTab, { data }, createElement("div", null, "content")),
  );
  const text = visibleText(markup);

  assert.doesNotMatch(text, /2026-W29 · недельный срез позиций/);
  assert.doesNotMatch(overviewSource, /<ZarukuInfoPopover/);
  assert.doesNotMatch(overviewSource, /label=\{ZARUKU_CLIENT_COPY\.weeklyPeriod\.label\}/);
  assert.doesNotMatch(overviewSource, /group-hover:block|<span role="tooltip"/);
  assert.doesNotMatch(text, /не относится к выбранному ежедневному периоду/i);
  assert.doesNotMatch(text, /не ограничивает данные Метрики, GSC или Вебмастера/i);
});

test("overview does not restate GSC and Webmaster period context", () => {
  const populatedSearchData = {
    ...data,
    gsc: {
      latest_week: "2026-W30",
      summary: [{ week: "2026-W30" }],
      queries: [],
    },
    webmaster: {
      latest_week: "2026-W30",
      summary: [{ week: "2026-W30" }],
      queries: [],
    },
  } as unknown as ZarukuSeoData;
  const text = visibleText(renderToStaticMarkup(
    createElement(ZarukuOverviewTab, { data: populatedSearchData }),
  ));

  assert.doesNotMatch(text, /Google RF:|Яндекс: 2026-W30/);
  assert.doesNotMatch(text, /собственных фактических периодах/i);
  assert.doesNotMatch(text, /Метрика, Google Search Console и Яндекс Вебмастер показаны за единый ежедневный период/i);
});
