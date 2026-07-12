import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuSeoOpportunityRow, ZarukuSeoRunRow, ZarukuSeoTaskRow } from "@/lib/types";
import {
  buildOpportunityDecisionSummary,
  buildRhythmRows,
  buildTaskStatusSummary,
  normalizeConfidencePercent,
} from "@/components/zaruku-seo-operations";

const opportunities: ZarukuSeoOpportunityRow[] = [
  { week: "2026-W27", opportunity_id: "previous-approved", section: "/map/", opportunity_type: "refresh", title: "Previous approval", target_url: null, decision: "approved", reject_reason: null, confidence: 0.9, priority: "high" },
  { week: "2026-W28", opportunity_id: "approved", section: "/map/", opportunity_type: "refresh", title: "Approved", target_url: null, decision: "approved", reject_reason: null, confidence: 0.8, priority: "high" },
  { week: "2026-W28", opportunity_id: "rejected", section: "/articles/", opportunity_type: "new", title: "Rejected", target_url: null, decision: "rejected", reject_reason: "Not enough evidence", confidence: 0.6, priority: "medium" },
  { week: "2026-W28", opportunity_id: "pending", section: null, opportunity_type: "new", title: "Pending", target_url: null, decision: "pending", reject_reason: null, confidence: 0.5, priority: "low" },
  { week: "2026-W28", opportunity_id: "carried", section: null, opportunity_type: "new", title: "Carried", target_url: null, decision: "carried_over", reject_reason: null, confidence: 0.5, priority: "low" },
];

test("buildOpportunityDecisionSummary excludes pending and carried-over opportunities from approve rate", () => {
  const summary = buildOpportunityDecisionSummary(opportunities, "2026-W28", "2026-W27");

  assert.deepEqual(summary.counts, { pending: 1, approved: 1, rejected: 1, carried_over: 1 });
  assert.equal(summary.approve_rate, 50);
  assert.equal(summary.comparison_approve_rate, 100);
  assert.equal(summary.approve_rate_delta, -50);
});

test("buildOpportunityDecisionSummary leaves approve rate unavailable without decisions", () => {
  const summary = buildOpportunityDecisionSummary(opportunities, "2026-W29", null);

  assert.equal(summary.approve_rate, null);
  assert.equal(summary.comparison_approve_rate, null);
});

const tasks: ZarukuSeoTaskRow[] = [
  { week: "2026-W28", task_id: "medical", section: "/articles/", title: "Medical review", status: "awaiting_medical_review", notion_url: null },
  { week: "2026-W28", task_id: "draft", section: null, title: "Draft", status: "draft", notion_url: null },
  { week: "2026-W27", task_id: "done", section: null, title: "Done", status: "done", notion_url: null },
];

test("buildTaskStatusSummary returns every status count for the selected week", () => {
  assert.deepEqual(buildTaskStatusSummary(tasks, "2026-W28"), {
    draft: 1,
    awaiting_medical_review: 1,
    in_progress: 0,
    done: 0,
    cancelled: 0,
  });
});

const runs: ZarukuSeoRunRow[] = [
  { week: "2026-W28", status: "completed", serp_requests: 12, llm_tokens: 3000, digest_count: 2 },
  { week: "2026-W30", status: "failed", serp_requests: 50, llm_tokens: 0, digest_count: 0 },
];

test("buildRhythmRows retains generated missing weeks and failed rows", () => {
  assert.deepEqual(buildRhythmRows(runs, ["2026-W28", "2026-W29", "2026-W30"]), [
    { week: "2026-W28", status: "completed", serp_requests: 12, llm_tokens: 3000, digest_count: 2 },
    { week: "2026-W29", status: "missing", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
    { week: "2026-W30", status: "failed", serp_requests: 50, llm_tokens: 0, digest_count: 0 },
  ]);
});

test("normalizeConfidencePercent accepts fraction and percent confidence values", () => {
  assert.equal(normalizeConfidencePercent(0.6), 60);
  assert.equal(normalizeConfidencePercent(60), 60);
});
