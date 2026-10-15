import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./AbbottBiDashboard.tsx", import.meta.url), "utf8");

test("controlled lazy views retain navigation and conceal stale content while pending", () => {
  assert.match(source, /activeView \?\? localActiveTab/);
  assert.match(source, /data\.read_contract\.available_views\.includes\(tab\.id\)/);
  assert.match(source, /onViewChange\?\.\(tab\.id\)/);
  assert.match(source, /viewPending \?[^]*?role="status"/);
  assert.match(source, /hidden=\{viewPending\}/);
});

test("admin user editor is rendered only at the bottom of the actions tab", () => {
  assert.match(source, /activeTab === "user_actions"[\s\S]*?<AbbottAdminUsersPanel/);
  assert.doesNotMatch(source, /users_summary:\s*\([\s\S]{0,1200}<AbbottAdminUsersPanel/);
});
const userActionFilterSource = readFileSync(
  new URL("./abbott/abbott-user-action-filters.ts", import.meta.url),
  "utf8",
);
const adminUserFilterSource = readFileSync(
  new URL("./abbott/abbott-admin-user-filter.ts", import.meta.url),
  "utf8",
);

test("orders aggregate User ID filters and treats sentinels as aggregate populations", () => {
  assert.match(adminUserFilterSource, /ВСЕ с User ID[\s\S]*ВСЕ без админов/);
  assert.match(source, /isAbbottAggregateUserFilter\(usersSummaryUserIdFilter\)/);
});

test("uses the approved Logs-based Russian manager description", () => {
  assert.ok(
    source.includes(
      "Сессии и общие варианты User ID рассчитаны по каноническим визитам Logs API за выбранный период.",
    ),
  );
});

test("does not expose ordinary English dashboard copy", () => {
  const exactVisibleStrings = [
    "All",
    "Avg duration",
    "Avg depth",
    "Event Title",
    "Direction",
    "External URL",
    "Outbound Clicks",
    "Material Name",
    "Pageviews",
    "Users",
    "UTM source",
    "UTM campaign",
    "Session ID",
    "Bitrix events",
  ];

  for (const text of exactVisibleStrings) {
    assert.equal(source.includes(`"${text}"`), false, `visible English copy remains: ${text}`);
  }

  assert.doesNotMatch(source, />\s*Search\s*</);
  assert.doesNotMatch(source, />\s*Grain:\s*</);
  assert.doesNotMatch(source, /}\s*total\b/);
  assert.equal(source.includes("Bitrix dump"), false);
  assert.equal(source.includes("SQL dump"), false);
});

test("uses native source options from the displayed population and clears only loaded stale selections", () => {
  assert.match(source, /abbottTrafficSourceOptions\(usersSummarySourceRows\)/);
  assert.match(source, /abbottTrafficSourceOptions\(data\.user_actions\)/);
  assert.doesNotMatch(source, /\.\.\.data\.users_summary\.map\(\(row\) => row\.traffic_source\)/);
  assert.match(source, /if \(viewPending\) return/);
  assert.match(source, /data\.read_contract\.view !== activeTab/);
  assert.match(source, /availableAbbottTrafficSource/);
  assert.match(source, /row\.traffic_source !== usersSummaryTrafficSource/);
  assert.match(source, /traffic_source: userActionsTrafficSource/);
});

test("gives chart tooltip metrics Russian display names", () => {
  for (const metricName of [
    "Средняя продолжительность, мин",
    "Посетители",
    "Количество",
    "Просмотры",
    "Переходы",
    "Доля вернувшихся",
    "Пользователи",
    "Итого на сайте",
    "По материалам",
  ]) {
    assert.ok(source.includes(`name="${metricName}"`) || source.includes(`metricName="${metricName}"`), metricName);
  }
  assert.match(source, /<Pie[\s\S]*?name="Значение"/);
});

test("adds Abbott UTM and count-first return UI while hiding external transitions reversibly", () => {
  assert.equal(source.includes('label: "4. Внешние переходы"'), false);
  assert.match(source, /activeTab === "external_events"/);
  assert.match(source, /external_events:/);

  for (const text of [
    "Одна строка — одно уникальное сочетание User ID, источника, UTM Source, направления и последней страницы",
    "UTM Source",
    "Без UTM",
    "Количество заходов за выбранный период",
    "Направления вернувшихся пользователей",
    "Страницы возврата",
    "Интервалы возврата по Метрике",
  ]) {
    assert.ok(source.includes(text), text);
  }
  assert.match(
    source,
    /activeTab === "user_actions"[\s\S]*?\{ key: "visits", label: "Сессии"/,
  );
  assert.match(source, /dataKey="visitors"/);
  assert.match(source, /return_frequency/);
});

test("separates period-wide return frequency from the Metrika interval controls", () => {
  assert.ok(source.includes("Общая частота визитов за выбранный период"));
  assert.ok(
    source.includes(
      "Показатели рассчитаны по всему сайту и не зависят от фильтров контрольного слоя ниже.",
    ),
  );
  assert.match(source, /returning:\s*null,/);

  const returningChartBranch = source.slice(source.indexOf('activeTab === "returning"'));
  const intervalHeadingIndex = returningChartBranch.indexOf("Интервалы возврата по Метрике");
  assert.ok(intervalHeadingIndex >= 0);

  const intervalSection = returningChartBranch.slice(intervalHeadingIndex);
  assert.ok(intervalSection.indexOf('label="URL"') >= 0);
  assert.ok(intervalSection.indexOf('label="Направление"') >= 0);
});

test("labels unmapped page metadata in the page table and exports", () => {
  assert.match(source, /labelAbbottPageDimension\(row\.direction\)/);
  assert.match(source, /labelAbbottPageDimension\(row\.material_type\)/);
  assert.match(source, /labelAbbottAccess\(row\.access\)/);
});

test("both access selectors distinguish any access and share canonical access matching", () => {
  const accessSelectors = [...source.matchAll(/<SelectField\s+label="Доступ"[\s\S]*?\/>/g)];
  assert.equal(accessSelectors.length, 2);
  for (const [selector] of accessSelectors) assert.match(selector, /allLabel="Любой доступ"/);
  assert.match(source, /access: buildAbbottPageDimensionOptions\(data\.page_stats, \(row\) => labelAbbottAccess\(row\.access\)\)/);
  assert.match(source, /access: buildAbbottPageDimensionOptions\(data\.bitrix_pages, \(row\) => labelAbbottAccess\(row\.access\)\)/);
  assert.match(source, /matchesSelectedAbbottAccess\(row\.access, filters\.access\)/);
  assert.match(source, /groupAbbottPageStatsByDimension\(pageStatRows, \(row\) => labelAbbottAccess\(row\.access\)/);
});

test("places the multi-value MNN filter and column immediately after direction", () => {
  assert.match(source, /label="Направление"[\s\S]*?label="МНН"/);
  assert.match(source, /key: "direction", label: "Направление"[\s\S]*?key: "mnn", label: "МНН"/);
  assert.match(source, /formatAbbottMnnValues\(row\.mnn, pageStatsOptions\.mnn, row\.url\)/);
  assert.match(source, /buildAbbottMnnOptions\(data\.page_stats\)/);
});

test("uses page-only metadata grouping that retains the unmapped bucket", () => {
  const pageChartSource = source.slice(source.indexOf("const pageDirectionData"), source.indexOf("const bitrixDirectionData"));
  assert.match(pageChartSource, /groupAbbottPageStatsByDimension/);
  assert.doesNotMatch(pageChartSource, /excludeUnnamedChartGroups/);
});

test("shows filtered metadata coverage for mapped material types", () => {
  assert.match(source, /summarizeAbbottPageMetadataCoverage\(pageStatRows\)/);
  assert.ok(source.includes("Справочник: тип определён для"));
  assert.ok(source.includes("страниц; просмотры —"));
});
