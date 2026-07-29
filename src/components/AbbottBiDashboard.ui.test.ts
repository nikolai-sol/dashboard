import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./AbbottBiDashboard.tsx", import.meta.url), "utf8");
const userActionFilterSource = readFileSync(
  new URL("./abbott/abbott-user-action-filters.ts", import.meta.url),
  "utf8",
);

test("uses the approved Russian manager description", () => {
  assert.ok(
    source.includes(
      "По умолчанию сессии и источники берутся из Метрики, Источники трафика. При выборе User ID, типа трафика или направления включается User ID-детализация.",
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
    `${source}\n${userActionFilterSource}`.match(/row\.traffic_source !== filters\.traffic_source/g)?.length,
    2,
    "traffic-source equality filters must continue comparing raw values",
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
    "Одна строка — один визит Метрики",
    "UTM Source",
    "Без UTM",
    "Количество заходов за выбранный период",
    "Направления вернувшихся пользователей",
    "Страницы возврата",
    "Интервалы возврата по Метрике",
  ]) {
    assert.ok(source.includes(text), text);
  }
  assert.match(source, /dataKey="visitors"/);
  assert.match(source, /return_frequency/);
});
