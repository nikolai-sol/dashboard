import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./AbbottBiDashboard.tsx", import.meta.url), "utf8");

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

test("localizes traffic sources at display boundaries while preserving raw filters", () => {
  assert.match(
    source,
    /import \{ abbottTrafficSourceLabel, abbottTrafficSourceOption \} from "\.\/abbott-localization";/,
  );
  assert.ok(
    source.match(/\.map\(\(option\) => abbottTrafficSourceOption\(option\.value\)\)/g)?.length === 2,
    "both traffic-source option lists must use localized labels with raw values",
  );
  assert.ok(
    source.match(/traffic_source: abbottTrafficSourceLabel\(row\.traffic_source\)/g)?.length === 2,
    "both traffic-source tables must use localized labels",
  );
  assert.ok(
    (source.match(/abbottTrafficSourceLabel\(row\.traffic_source\)/g)?.length ?? 0) >= 4
      && source.includes("traffic_source_label: abbottTrafficSourceLabel"),
    "traffic-source search and display rows must be localized, including delegated action filtering",
  );
  assert.match(source, /label: abbottTrafficSourceLabel\(label\)/);
  assert.equal(
    source.match(/row\.traffic_source !== filters\.traffic_source/g)?.length,
    1,
    "the summary table must keep exact raw traffic-source filtering",
  );
  assert.match(
    userActionFilterSource,
    /row\.traffic_source\.trim\(\) !== filters\.traffic_source/,
    "the action table must compare the displayed normalized source without relabeling stored data",
  );
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
  assert.match(source, /labelAbbottPageDimension\(row\.access\)/);
});

test("places the multi-value MNN filter and column immediately after direction", () => {
  assert.match(source, /label="Направление"[\s\S]*?label="МНН"/);
  assert.match(source, /key: "direction", label: "Направление"[\s\S]*?key: "mnn", label: "МНН"/);
  assert.match(source, /formatAbbottMnnValues\(row\.mnn, pageStatsOptions\.mnn\)/);
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
