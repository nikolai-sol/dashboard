import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import { Overview } from "../src/components/Overview.tsx";
import { buildTargetIntentView } from "../src/lib/target-intent.ts";

const period: Period = { kind: "iso_week", key: "2026-W37", from: "2026-09-07", to: "2026-09-13", sourceTimezone: "Europe/Moscow" };
const meta: DatasetMeta = { sourceKey: "google_search_console", period, state: "partial", collectionMode: "manual", completeness: "limited", importId: "test", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" };
const ruleSet = {
  siteId: "site-medroche", dashboardId: 41, versionId: "intent-v1", label: "Мед. интент", state: "ready" as const,
  rules: [{ key: "лечение меланомы", normalizedKey: "лечение меланомы", group: "Меланома", matchType: "phrase" as const }],
  provenance: { importId: "7", publicationId: "8", sourceTransport: "upload" as const, sourceIdentity: "rules.xlsx", contentSha256: "a".repeat(64), publishedAt: "2026-09-15T12:00:00Z", publishedBy: "admin@example.test", comment: null },
};

function targetIntent(options: Readonly<{ available?: boolean; failedYandex?: boolean }> = {}) {
  const available = options.available ?? true;
  const view = buildTargetIntentView({
    siteId: "site-medroche", dashboardId: 41, label: "Мед. интент",
    ruleSet: available ? ruleSet : { ...ruleSet, state: "unavailable" },
    queries: available ? [
      { query: "лечение меланомы", source: "google", impressions: 90, clicks: 9 },
      { query: "погода", source: "google", impressions: 10, clicks: 1 },
    ] : [],
  });
  return {
    ...view,
    period,
    sources: [
      { source: "google" as const, included: available, reason: available ? "available" as const : "no_queries" as const, meta },
      { source: "yandex" as const, included: false, reason: options.failedYandex ? "failed" as const : "missing" as const, meta: options.failedYandex ? { ...meta, sourceKey: "yandex_webmaster" as const, state: "failed" as const, latestAttempt: "failed" as const } : null },
    ],
  };
}

const model = { gsc: { meta, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: meta, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {}, targetIntent: targetIntent() };

test("overview consumes generic target intent with exact dates and honest units", () => {
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true }));
  assert.match(html, /data-target-intent="true"/);
  assert.match(html, /Остальные запросы/);
  assert.match(html, /Мед\. интент/);
  assert.match(html, /90%/);
  assert.match(html, /доля показов/);
  assert.match(html, /показов/);
  assert.match(html, /кликов/);
  assert.match(html, /2026-09-07 — 2026-09-13/);
  assert.match(html, /Яндекс: нет запросов за неделю/);
  assert.match(html, /Google: частичные данные/);
  assert.match(html, /Клики ≠ пользователи/);
  assert.doesNotMatch(html, /Поисковые визиты|site-seo-goal-kpis/);
  assert.match(html, /Здоровье трафика/);
});

test("unavailable query coverage displays dashes and never invents zero percentages", () => {
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model: { ...model, targetIntent: targetIntent({ available: false }) }, showGsc: true }));
  assert.match(html, /Нет статистики запросов за выбранную неделю/);
  assert.doesNotMatch(html, />0%<|>0<\/b>/);
});

test("overview names failed source collection rather than describing it as missing", () => {
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model: { ...model, targetIntent: targetIntent({ available: false, failedYandex: true }) }, showGsc: true }));
  assert.match(html, /Яндекс: ошибка сбора/);
});
