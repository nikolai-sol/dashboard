import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuContentTab.tsx", import.meta.url), "utf8");

test("content tab follows the executive-to-detail reading order", () => {
  const headings = [
    "Состояние контента",
    "Разделы сайта",
    "Популярные страницы",
    "Лучшее удержание",
    "Риск отказов",
    "Возврат к контенту",
    "Все страницы",
  ];
  let previous = -1;
  for (const heading of headings) {
    const index = source.indexOf(heading);
    assert.ok(index > previous, `${heading} must follow the previous section`);
    previous = index;
  }
});

test("content tab uses explicit dataset states, native columns, search, and pagination", () => {
  assert.match(source, /<ZarukuPeriodContext/);
  assert.match(source, /<ZarukuPanelState/);
  assert.match(source, /availableMetricColumns/);
  assert.match(source, /filterAndPaginate/);
  assert.match(source, /type="search"/);
  assert.match(source, /PAGE_SIZE = 50/);
  assert.doesNotMatch(source, /Поведение по каналам/);
});

test("returning content keeps canonical recency buckets", () => {
  assert.match(source, /1 день/);
  assert.match(source, /2–7 дней/);
  assert.match(source, /8–31 день/);
  assert.match(source, /returning_1_day_users/);
  assert.match(source, /returning_2_7_days_users/);
  assert.match(source, /returning_8_31_days_users/);
});
