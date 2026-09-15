import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardTargetIntentView } from "../src/lib/read-model.ts";
import { IntentQueryDisclosures } from "../src/components/IntentQueryDisclosures.tsx";
import { TargetIntentPanel } from "../src/components/TargetIntentPanel.tsx";
import { existsSync, readFileSync } from "node:fs";
import { Dashboard, intentPublicationMatches } from "../src/components/Dashboard.tsx";
import { createPeriodSelection } from "../src/lib/period-selection.ts";
import { Overview } from "../src/components/Overview.tsx";

const readyView: DashboardTargetIntentView = {
  siteId: "site-clinic",
  dashboardId: 77,
  versionId: "intent-v9",
  label: "Запросы пациентов",
  state: "ready",
  period: { kind: "iso_week", key: "2026-W37", from: "2026-09-07", to: "2026-09-13", sourceTimezone: "Europe/Moscow" },
  provenance: { importId: "91", publicationId: "92", sourceTransport: "upload", sourceIdentity: "rules.xlsx", contentSha256: "a".repeat(64), publishedAt: "2026-09-15T12:00:00Z", publishedBy: "admin@example.test", comment: null },
  target: { label: "Запросы пациентов", impressions: 180, clicks: 18, sharePct: 75, queryCount: 4 },
  other: { label: "Остальные запросы", impressions: 60, clicks: 6, sharePct: 25, queryCount: 2 },
  sources: [
    { source: "google", included: true, reason: "available", meta: null },
    { source: "yandex", included: true, reason: "available", meta: null },
  ],
  queries: [
    { query: "бета", source: "yandex", impressions: 60, clicks: 6, category: "target", group: "Группа Б", matchedRule: "бета", matchType: "exact" },
    { query: "альфа", source: "yandex", impressions: 60, clicks: 6, category: "target", group: "Группа А", matchedRule: "альфа", matchType: "phrase" },
    { query: "альфа", source: "google", impressions: 60, clicks: 6, category: "target", group: "Группа А", matchedRule: "альфа", matchType: "phrase" },
    { query: "ноль", source: "google", impressions: 0, clicks: 99, category: "target", group: "Ошибка", matchedRule: "ноль", matchType: "exact" },
    { query: "прочее", source: "google", impressions: 40, clicks: 3, category: "other", group: null, matchedRule: null, matchType: null },
    { query: "другое", source: "yandex", impressions: 20, clicks: 3, category: "other", group: null, matchedRule: null, matchType: null },
  ],
};

test("renders two independent native disclosures with positive-row counts and review columns", () => {
  const html = renderToStaticMarkup(createElement(IntentQueryDisclosures, { view: readyView }));

  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.match(html, /<summary[^>]*>Запросы пациентов — 3 запроса<\/summary>/);
  assert.match(html, /<summary[^>]*>Остальные запросы — 2 запроса<\/summary>/);
  for (const heading of ["Запрос", "Источник", "Показы", "Клики", "Группа", "Правило", "Тип совпадения", "Статус классификации"]) {
    assert.match(html, new RegExp(`<th[^>]*>${heading}<\\/th>`));
  }
  assert.match(html, /не найдено правило/);
  assert.doesNotMatch(html, /ноль|Ошибка/);
});

test("sorts each disclosure by impressions, clicks, query, then source", () => {
  const html = renderToStaticMarkup(createElement(IntentQueryDisclosures, { view: readyView }));
  const target = html.slice(html.indexOf('data-intent-category="target"'), html.indexOf('data-intent-category="other"'));
  assert.ok(target.indexOf("альфа") < target.indexOf("бета"));
  assert.ok(target.indexOf("Google") < target.indexOf("Яндекс"));
  const other = html.slice(html.indexOf('data-intent-category="other"'));
  assert.ok(other.indexOf("прочее") < other.indexOf("другое"));
});

test("uses the selected-week goal semantics and does not render the old partial-data sentence", () => {
  const html = renderToStaticMarkup(createElement(TargetIntentPanel, { intent: readyView }));

  assert.match(html, /Цель: целевой органический трафик \+ ИИ-выдача/);
  assert.match(html, /Выбранная неделя · 2026-09-07 — 2026-09-13/);
  assert.match(html, /Запросы пациентов[^]*75%[^]*180[^]*показов[^]*18[^]*кликов/);
  assert.match(html, /Клики — переходы из поиска, а не пользователи/);
  assert.doesNotMatch(html, /частичные данные|Охват статистики|Google:|Яндекс:/);
});

test("states not-configured and unavailable classifications truthfully", () => {
  const notConfigured = renderToStaticMarkup(createElement(TargetIntentPanel, { intent: { ...readyView, state: "not_configured", versionId: null, provenance: null, queries: [], target: { ...readyView.target, impressions: null, clicks: null, sharePct: null, queryCount: null }, other: { ...readyView.other, impressions: null, clicks: null, sharePct: null, queryCount: null } } }));
  const unavailable = renderToStaticMarkup(createElement(TargetIntentPanel, { intent: { ...readyView, state: "unavailable", queries: [], target: { ...readyView.target, impressions: null, clicks: null, sharePct: null, queryCount: null }, other: { ...readyView.other, impressions: null, clicks: null, sharePct: null, queryCount: null } } }));

  assert.match(notConfigured, /Классификация не настроена/);
  assert.match(notConfigured, /Запросы не отнесены к категории «Остальные запросы»/);
  assert.doesNotMatch(notConfigured, /100%/);
  assert.match(unavailable, /Классификация временно недоступна/);
  assert.doesNotMatch(unavailable, /не настроена|100%/);
});

test("paginates mounted review rows and links downloads to the selected active publication", () => {
  const many = Array.from({ length: 55 }, (_, index) => ({
    query: `запрос-${String(index).padStart(2, "0")}`, source: "google" as const, impressions: 100 - index, clicks: index,
    category: "target" as const, group: "Группа", matchedRule: "запрос", matchType: "phrase" as const,
  }));
  const hrefs: string[] = [];
  const html = renderToStaticMarkup(createElement(IntentQueryDisclosures, {
    view: { ...readyView, queries: many, target: { ...readyView.target, queryCount: 55 } },
    navigation: {
      target: { page: 2, pageSize: 50 }, other: { page: 1, pageSize: 50 },
      pageHref: (category: string, page: number) => `?traffic_week=2026-W37&intent_${category}_page=${page}&intent_publication=92`,
      downloadHref: (category: string, format: string) => { const href = `/api/dashboard/medroche/intent-queries?traffic_week=2026-W37&intent_category=${category}&intent_format=${format}&intent_publication=92`; hrefs.push(href); return href; },
    },
  }));

  assert.equal((html.match(/<tr/g) ?? []).length, 7, "two table headers plus five target rows must be mounted on target page 2");
  assert.match(html, /Страница 2 из 2/);
  assert.match(html, /intent_target_page=1/);
  assert.ok(hrefs.some((href) => href.includes("intent_category=target") && href.includes("intent_format=csv") && href.includes("intent_publication=92")));
  assert.ok(hrefs.some((href) => href.includes("intent_category=other") && href.includes("intent_format=xlsx") && href.includes("intent_publication=92")));
});

test("keeps the paginated disclosure open after returning to page one", () => {
  const html = renderToStaticMarkup(createElement(IntentQueryDisclosures, {
    view: readyView,
    navigation: {
      target: { page: 1, pageSize: 50, open: true }, other: { page: 1, pageSize: 50, open: false },
      pageHref: (category: string, page: number) => `?intent_${category}_page=${page}&intent_open=${category}`,
      downloadHref: () => "/download",
    },
  }));

  assert.match(html, /<details data-intent-category="target" open="">/);
  assert.doesNotMatch(html, /<details data-intent-category="other" open="">/);
});

test("wires the public route to the bounded authorized intent handler", () => {
  const route = new URL("../src/app/api/dashboard/[siteSlug]/intent-queries/route.ts", import.meta.url);
  assert.ok(existsSync(route));
  const source = readFileSync(route, "utf8");
  assert.match(source, /createIntentQueryHandler/);
  assert.match(source, /parseDashboardReadRequest/);
  assert.match(source, /parseIntentQueryOptions/);
});

test("dashboard review links retain every selected period, filter, category and active intent publication", () => {
  const selection = createPeriodSelection({ primaryWeek: "2026-W37", comparisonWeek: "2026-W36", aliceMonth: "2026-09", gsc: readyView.period }, "Europe/Moscow");
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const html = renderToStaticMarkup(createElement(Dashboard, {
    profile: { siteId: "site-clinic", dashboardId: 77, slug: "clinic", title: "Клиника", domain: "clinic.test", sources: [] } as never,
    model: { targetIntent: { ...readyView, queries: Array.from({ length: 55 }, (_, index) => ({ query: `q-${index}`, source: "google" as const, impressions: 100 - index, clicks: 1, category: "target" as const, group: null, matchedRule: "q", matchType: "phrase" as const })) }, gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} },
    selection, publicationId: "gsc-publication", filters: { country: "RU" }, activeTab: "overview", intentPages: { target: 2, other: 1 },
  }));
  assert.match(html, /intent_target_page=1/);
  assert.match(html, /\/api\/dashboard\/clinic\/intent-queries\?/);
  assert.match(html, /traffic_week=2026-W37/);
  assert.match(html, /traffic_compare=2026-W36/);
  assert.match(html, /gsc_period=2026-W37/);
  assert.match(html, /alice_month=2026-09/);
  assert.match(html, /publication=gsc-publication/);
  assert.match(html, /filter_country=RU/);
  assert.match(html, /intent_category=target/);
  assert.match(html, /intent_format=csv/);
  assert.match(html, /intent_publication=92/);
  assert.match(html, /intent_open=target/);
});

test("dashboard page parses both disclosure pages through a bounded helper", () => {
  const source = readFileSync(new URL("../src/app/dashboard/[siteSlug]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /boundedIntentPage/);
  assert.match(source, /intent_target_page/);
  assert.match(source, /intent_other_page/);
  assert.match(source, /intent_open/);
  assert.match(source, /intentPages=/);
});

test("overview reaches the truthful not-configured panel for a resolved SEO query scope", () => {
  const notConfigured = { ...readyView, state: "not_configured" as const, versionId: null, provenance: null, queries: [], target: { ...readyView.target, impressions: null, clicks: null, sharePct: null, queryCount: null }, other: { ...readyView.other, impressions: null, clicks: null, sharePct: null, queryCount: null } };
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const html = renderToStaticMarkup(createElement(Overview, { id: "overview", model: { targetIntent: notConfigured, gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} }, showGsc: true, targetIntentEnabled: true }));
  assert.match(html, /Классификация не настроена/);
  assert.doesNotMatch(html, /Поисковые визиты/);
});

test("unrelated dashboards retain the legacy overview until target intent is active or explicitly enabled", () => {
  const notConfigured = { ...readyView, state: "not_configured" as const, versionId: null, provenance: null, queries: [], target: { ...readyView.target, impressions: null, clicks: null, sharePct: null, queryCount: null }, other: { ...readyView.other, impressions: null, clicks: null, sharePct: null, queryCount: null } };
  const missing = { sourceKey: "google_search_console" as const, period: null, state: "missing" as const, collectionMode: "manual" as const, completeness: "unknown" as const, importId: null, exportedAt: null, loadedAt: null, freshness: "unknown" as const, latestAttempt: "none" as const };
  const model = { targetIntent: notConfigured, gsc: { meta: missing, summary: null, daily: [], dimensions: [], dimensionMeta: {} }, indexing: missing, datasets: {}, metrika: null, webmaster: null, wordstat: null, alice: null, seoOs: null, trafficComparison: {} };

  const unrelated = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true, targetIntentEnabled: false }));
  const enabled = renderToStaticMarkup(createElement(Overview, { id: "overview", model, showGsc: true, targetIntentEnabled: true }));

  assert.match(unrelated, /Цель: рост целевого органического трафика/);
  assert.doesNotMatch(unrelated, /Классификация не настроена/);
  assert.match(enabled, /Классификация не настроена/);
});

test("detects a stale intent publication before rendering a paginated review", () => {
  assert.equal(intentPublicationMatches(readyView, "92"), true);
  assert.equal(intentPublicationMatches(readyView, "old-publication"), false);
  assert.equal(intentPublicationMatches(readyView, null), true);
  const source = readFileSync(new URL("../src/app/dashboard/[siteSlug]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /intentPublicationMatches/);
  assert.match(source, /Классификация обновлена/);
});
