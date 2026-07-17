import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("./ZarukuSeoWeekToolbar.tsx", import.meta.url), "utf8");
const webmasterPanelsSource = readFileSync(new URL("./zaruku-yandex-webmaster-panels.ts", import.meta.url), "utf8");

test("dashboard distinguishes the traffic period from SEO week selection", () => {
  assert.match(source, /Период трафика:\s*<\/span>\s*<span>\{data\.period\.from\} — \{data\.period\.to\}<\/span>/);
});

test("SEO week toolbar names its reporting period", () => {
  assert.match(toolbarSource, /Отчётная SEO-неделя/);
});

test("navigation uses the full geography label", () => {
  assert.match(source, /\{ id: "geo", label: "География", icon: MapPin \}/);
});

test("DataTable keeps behavior metric headers readable with spacing and wrapping", () => {
  assert.match(source, /min-w-\[1080px\]/);
  assert.match(source, /table-fixed/);
  assert.match(source, /px-3 pb-2 text-right font-medium leading-tight/);
  assert.match(source, /whitespace-normal/);
});

test("SEO tab renders one AI visibility panel and keeps long tables bounded", () => {
  const aiPanelMatches = source.match(/<AiAggregateVisibilityPanel/g) ?? [];

  assert.equal(aiPanelMatches.length, 1);
  assert.match(source, /data\.organic_landing_pages\.slice\(0, 10\)/);
  assert.match(source, /max-h-\[29rem\]/);
  assert.match(source, /max-h-\[30rem\]/);
});

test("SEO tab explains Metrika search phrases and hides empty Yandex landing page facts", () => {
  assert.match(source, /Поисковые фразы из Метрики/);
  assert.match(source, /Фразы, которые Метрика смогла определить после клика/);
  assert.match(source, /webmasterPages\.length > 0/);
});

test("SEO tab labels Yandex query table from its own week selection", () => {
  assert.match(source, /const webmasterQueryMeta = buildWebmasterSelectionMeta\(webmasterQuerySelection, webmasterWeek\)/);
  assert.match(source, /webmasterQueryMeta\.fallbackNote/);
});

test("source health renders collection provenance labels", () => {
  assert.match(source, /автоматически/);
  assert.match(source, /внешний импорт/);
  assert.match(source, /вручную/);
  assert.match(source, /не подключено/);
});

test("sidebar clarifies GEO as AI search rather than visitor geography", () => {
  assert.match(source, /SEO \/ AI-поиск/);
  assert.doesNotMatch(source, /SEO \/ GEO дашборд/);
});

test("visible provenance copy stays manager friendly", () => {
  assert.match(source, /Google Search Console API; ежедневная загрузка ReportingDash/);
  assert.match(webmasterPanelsSource, /Яндекс Вебмастер API; ежедневная загрузка ReportingDash/);
  assert.match(source, /ручной снимок AI-видимости/);
  assert.doesNotMatch(source, /Источник: Google Search Console \/ canonical_fact_gsc_\*_daily/);
  assert.doesNotMatch(webmasterPanelsSource, /Источник: Яндекс Вебмастер \/ canonical_fact_webmaster_\*_daily/);
  assert.doesNotMatch(source, /Источник данных: \$\{latest\.provenance\}/);
});

test("pending panel switches to a connected-source summary when nothing is waiting", () => {
  assert.match(source, /data\.pending_requirements\.length === 0/);
  assert.match(source, /Подключения источников/);
  assert.match(source, /Все ключевые источники подключены/);
});

test("geography tab flags suspicious map demand and labels it as post-click geography", () => {
  assert.match(source, /findMapGeoAnomalies/);
  assert.match(source, /Проверить гео\/ботов/);
  assert.match(source, /География после клика из Метрики/);
});

test("audience bars localize common Metrika labels", () => {
  assert.match(source, /readableAudienceLabel/);
  assert.match(source, /Мужчины/);
  assert.match(source, /Женщины/);
  assert.match(source, /Возраст не определён/);
});
