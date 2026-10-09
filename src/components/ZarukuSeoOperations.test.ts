import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuSeoOperations from "./ZarukuSeoOperations";
import type { ZarukuSeoOpportunityRow, ZarukuSeoOsData } from "@/lib/types";

const source = readFileSync(new URL("./ZarukuSeoOperations.tsx", import.meta.url), "utf8");

test("operations tables use shared bounded frames", () => {
  assert.equal((source.match(/<ZarukuTableFrame mode="operational"/g) ?? []).length, 3);
  assert.doesNotMatch(source, /max-h-\[(?:300|360)px\] overflow-auto/);
  assert.match(source, /card-surface zaruku-panel/);
});

test("rendered approval rate shows +25 pp, current decided counts and unavailable empty week", () => {
  const opportunities = ["approved", "approved", "approved", "rejected"].map((decision, i) => ({ week: "2026-W29", opportunity_id: String(i), title: "Рекомендация", section: null, opportunity_type: "new_content", target_url: null, reject_reason: null, confidence: 60, priority: "high", decision } as ZarukuSeoOpportunityRow));
  opportunities.push(...opportunities.slice(0, 2).map((row, i) => ({ ...row, week: "2026-W28", opportunity_id: `old-${i}`, decision: i ? "rejected" : "approved" } as ZarukuSeoOpportunityRow)));
  const seoOs = { available: true, weeks: ["2026-W28", "2026-W29"], opportunities, tasks: [], runs: [] } as unknown as ZarukuSeoOsData;
  const markup = renderToStaticMarkup(createElement(ZarukuSeoOperations, { seoOs, primaryWeek: "2026-W29", comparisonWeek: "2026-W28" }));
  assert.match(markup, /Δ \+25 п\.п\./);
  assert.match(markup, /3 принято \/ 4 решений/);
  const empty = renderToStaticMarkup(createElement(ZarukuSeoOperations, { seoOs, primaryWeek: "2026-W30", comparisonWeek: "2026-W28" }));
  assert.match(empty, /0 принято \/ 0 решений/);
  assert.doesNotMatch(empty, /Δ \+25/);
});

test("approval delta uses percentage points and decided counts; empty week is plain Russian", () => {
  assert.match(source, /formatRateDelta\(decisionSummary.approve_rate_delta\)/);
  assert.match(source, /counts.approved \+ decisionSummary.counts.rejected/);
  assert.match(source, /Нет задач для выбранной недели/);
  assert.doesNotMatch(source, /ждёт первого approve/);
});
