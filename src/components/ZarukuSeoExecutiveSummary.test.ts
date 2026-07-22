import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoExecutiveSummary from "@/components/ZarukuSeoExecutiveSummary";
import type { SeoExecutiveSnapshot } from "@/components/zaruku-seo-workspace";

const source = readFileSync(new URL("./ZarukuSeoExecutiveSummary.tsx", import.meta.url), "utf8");

const snapshot: SeoExecutiveSnapshot = {
  google: { impressions: 1_200, clicks: 120, ctr: 10, average_position: 4.5 },
  webmaster: { impressions: 2_000, clicks: 180, ctr: 9, average_position: 7.2 },
  seo_os: { average_position: 5.1, coverage: 0.75 },
  ai: { presence_rate: 44, mentions: 89, citations: 155 },
  post_click: { visits: 320, users: 270 },
};

test("renders an executive-to-detail source hierarchy without a country panel", () => {
  const markup = renderToStaticMarkup(
    createElement(ZarukuSeoExecutiveSummary, {
      snapshot,
      trafficPeriod: { from: "2026-07-01", to: "2026-07-21" },
      primaryWeek: "2026-W29",
      comparisonWeek: "2026-W28",
      sourcePeriods: {
        google: "2026-W29",
        webmaster: "2026-W29",
        seoOs: "2026-W29",
        ai: "2026-07",
      },
    }),
  );

  assert.match(markup, /Период поведения на сайте/);
  assert.match(markup, /Отчётная SEO-неделя/);
  assert.match(markup, /Google RF/);
  assert.match(markup, /Яндекс Вебмастер/);
  assert.match(markup, /SEO OS · Яндекс, отслеживаемые позиции/);
  assert.match(markup, /AI-видимость/);
  assert.doesNotMatch(markup, /Countries|Страны/);
  assert.doesNotMatch(markup, /Яндекс Вебмастер[^<]{0,80}(?:RF|Россия|только РФ)/);
});

test("keeps the executive grid shrinkable at page level", () => {
  assert.match(source, /<section className="min-w-0/);
  assert.match(source, /grid min-w-0 gap-4/);
  assert.match(source, /flex flex-col gap-4 lg:flex-row/);
});
