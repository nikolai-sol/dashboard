import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuWorkTab.tsx", import.meta.url), "utf8");
const operationsSource = readFileSync(new URL("./ZarukuSeoOperations.tsx", import.meta.url), "utf8");

test("work tab names the selected SEO OS periods and warns about incomplete historical counters", () => {
  assert.match(source, /Работы и задачи/);
  assert.match(source, /Основная неделя/);
  assert.match(source, /Неделя сравнения/);
  assert.match(source, /hasHistoricalZeroTelemetry/);
  assert.match(source, /ноль не означает, что работ не было/i);
});

test("client-facing unavailable copy avoids internal SEO Ops jargon", () => {
  assert.doesNotMatch(operationsSource, /SEO Ops временно недоступен/);
  assert.match(operationsSource, /Данные по работам и задачам временно недоступны/);
});
