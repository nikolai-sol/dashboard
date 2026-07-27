import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ZARUKU_CLIENT_COPY,
  ZARUKU_COPY_AUDIT,
  formatZarukuCompleteness,
} from "./zaruku-client-copy";

const FORBIDDEN_CLIENT_TERMS = /\b(?:grain|canonical|collector|dataset_meta|fallback|partial)\b/i;

test("audited Zaruku copy labels every string as client or technical", () => {
  assert.ok(ZARUKU_COPY_AUDIT.length >= 20);
  for (const item of ZARUKU_COPY_AUDIT) {
    assert.ok(item.id.length > 0);
    assert.ok(item.text.length > 0);
    assert.ok(item.verdict === "client" || item.verdict === "technical");
  }
});

test("client-facing Zaruku copy contains no implementation vocabulary", () => {
  const violations = ZARUKU_COPY_AUDIT
    .filter((item) => item.verdict === "client" && FORBIDDEN_CLIENT_TERMS.test(item.text))
    .map((item) => `${item.id}: ${item.text}`);

  assert.deepEqual(violations, []);
  assert.equal(ZARUKU_CLIENT_COPY.disabledCalendar, "На этой вкладке период выбирается по неделям.");
  assert.equal(formatZarukuCompleteness("2026-07-19"), "Данные полные по 19.07.2026.");
});

test("known technical phrases are removed from rendered Zaruku source strings", () => {
  const files = [
    "ZarukuContentTab.tsx",
    "ZarukuQualityTab.tsx",
    "ZarukuSeoDashboard.tsx",
    "zaruku-north-star.ts",
    "zaruku-yandex-webmaster-panels.ts",
  ];
  const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(source, /canonical traffic|источником или grain|названия collectors|Collector:/);
  assert.doesNotMatch(source, /canonical_fact_|entry-page|read-model|seo_ai_visibility|SOV-кластеры|ручной baseline/i);
});
