import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DatasetMeta, Period } from "@reportingdash/site-seo-contract";
import { Overview } from "../src/components/Overview.tsx";
import { buildMedicalIntent } from "../src/lib/medical-intent.ts";
import { buildDashboardExportRows } from "../src/lib/exports.ts";
import { createPeriodSelection } from "../src/lib/period-selection.ts";

const period: Period = { kind: "iso_week", key: "2026-W37", from: "2026-09-07", to: "2026-09-13", sourceTimezone: "Europe/Moscow" };
const meta: DatasetMeta = { sourceKey: "google_search_console", period, state: "partial", collectionMode: "manual", completeness: "limited", importId: "test", exportedAt: null, loadedAt: null, freshness: "current", latestAttempt: "success" };
const gsc = { meta, summary: null, daily: [], dimensions: [
  { dimension: "query" as const, value: "лечение меланомы", metrics: { clicks: 9, impressions: 90, ctrPct: null, averagePosition: null } },
  { dimension: "query" as const, value: "погода", metrics: { clicks: 1, impressions: 10, ctrPct: null, averagePosition: null } },
], dimensionMeta: { query: meta } };
const model = { gsc, indexing: meta, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {},
  intent: buildMedicalIntent({ period, gsc, webmaster: null }) };

test("accepted overview replaces mixed-source KPIs, with source coverage, exact dates and honest units", () => {
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true }));
  assert.match(html, /data-medical-intent="true"/);
  assert.match(html, /Шум/);
  assert.match(html, /Мед\. интент/);
  assert.match(html, /90%/);
  assert.match(html, /доля показов/);
  assert.match(html, /показов/);
  assert.match(html, /кликов/);
  assert.match(html, /2026-09-07 — 2026-09-13/);
  assert.match(html, /Яндекс: нет запросов за неделю/);
  assert.match(html, /Google: частичные данные/);
  assert.match(html, /Клики ≠ пользователи/);
  assert.match(html, /Желаемое направление/);
  assert.doesNotMatch(html, /Поисковые визиты|site-seo-goal-kpis/);
  assert.match(html, /Здоровье трафика/);
});

test("no query coverage displays dashes and never invented zero percentages", () => {
  const emptyGsc = { ...gsc, dimensions: [], dimensionMeta: {} };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model: { ...model, intent: buildMedicalIntent({ period, gsc: emptyGsc, webmaster: null }) }, showGsc: true }));
  assert.match(html, /Нет статистики запросов за выбранную неделю/);
  assert.doesNotMatch(html, />0%<|>0<\/b>/);
});

test("overview names failed source collection rather than describing it as missing", () => {
  const intent = buildMedicalIntent({ period, gsc, webmaster: null, webmasterMeta: { ...meta, sourceKey: "yandex_webmaster", state: "failed" } });
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model: { ...model, intent }, showGsc: true }));
  assert.match(html, /Яндекс: ошибка сбора/);
});

test("exports weekly intent, provenance and query classification without relabeling monthly GSC", () => {
  const rows = buildDashboardExportRows({ profile: { sources: [] }, selection: createPeriodSelection({ primaryWeek: "2026-W37", aliceMonth: "2026-08", gsc: period }, "Europe/Moscow"), model });
  const values = rows.map(row => row.field + ": " + row.value).join("\n");
  assert.match(values, /Медицинский интент: 2026-09-07 — 2026-09-13/);
  assert.match(values, /Мед\. интент · показы: 90/);
  assert.match(values, /Мед\. интент · клики: 9/);
  assert.match(values, /Мед\. интент · доля показов, %: 90/);
  assert.match(values, /medroche-medical-intent-v1/);
  assert.match(values, /google.*partial/);
  assert.match(values, /yandex.*missing/);
  assert.match(values, /меланомы.*medical.*expert_seed|меланомы.*medical.*medical_term/);
});
