import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");

test("adds the Alice visibility workspace after SEO without a shared week control", () => {
  const seoIndex = source.indexOf('{ id: "seo", label: "SEO"');
  const aliceIndex = source.indexOf('{ id: "alice", label: "ИИ-видимость и конкуренты"');
  const wordstatIndex = source.indexOf('{ id: "wordstat", label: "Спрос Wordstat"');

  assert.ok(seoIndex >= 0);
  assert.ok(aliceIndex > seoIndex);
  assert.ok(wordstatIndex > aliceIndex);
  assert.match(source, /case "alice":/);
  assert.match(source, /<ZarukuAliceVisibilityTab data=\{data\.alice_visibility\} locale=\{locale\} \/>/);
});

test("SEO keeps only the current official Alice SoV summary with a path to details", () => {
  const seoStart = source.indexOf("function SeoTab");
  const seoEnd = source.indexOf("export default function ZarukuSeoDashboard");
  const seoSource = source.slice(seoStart, seoEnd);

  assert.match(seoSource, /<AliceVisibilitySummaryCard/);
  assert.match(source, /ИИ-видимость в Алисе AI/);
  assert.match(source, /Открыть запросы и конкурентов/);
  assert.match(source, /к \{formatAliceComparisonMonth\(previous\.month\)\}/);
  assert.match(seoSource, /onOpenAlice/);
  assert.doesNotMatch(seoSource, /AiAggregateVisibilityPanel/);
  assert.doesNotMatch(seoSource, /Упоминания|Цитаты/);
});
