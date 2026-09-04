import assert from "node:assert/strict";
import test from "node:test";
import type {
  ZarukuSeoAiVisibilityAggregateRow,
  ZarukuAliceVisibilitySnapshot,
  ZarukuSeoOpportunityRow,
  ZarukuSeoRunRow,
  ZarukuSeoSovWeeklyRow,
  ZarukuSeoTaskRow,
} from "@/lib/types";
import {
  buildNorthStarKpis,
  buildSemanticHealthRows,
  buildWeeklyFocus,
} from "@/components/zaruku-north-star";

const sovRows: ZarukuSeoSovWeeklyRow[] = [
  {
    week: "2026-W29",
    period_label: "28d: 2026-06-13 — 2026-07-10",
    snapshot_date: "2026-07-13",
    date_start: "2026-06-13",
    date_end: "2026-07-10",
    cluster: "medical_org_labs_noise",
    query_count: 1650,
    impressions: 19347,
    clicks: 94,
    impressions_share: 63.74,
    clicks_share: 15.41,
    ctr: 0.49,
    average_position: 9.65,
    is_noise: true,
    is_medical: false,
    ingestion_run_id: "seo_os_sov_weekly_2026-W29",
  },
  {
    week: "2026-W29",
    period_label: "28d: 2026-06-13 — 2026-07-10",
    snapshot_date: "2026-07-13",
    date_start: "2026-06-13",
    date_end: "2026-07-10",
    cluster: "medical_intent_total",
    query_count: 810,
    impressions: 7532,
    clicks: 444,
    impressions_share: 24.81,
    clicks_share: 72.79,
    ctr: 5.89,
    average_position: null,
    is_noise: false,
    is_medical: true,
    ingestion_run_id: "seo_os_sov_weekly_2026-W29",
  },
];

const aiRows: ZarukuSeoAiVisibilityAggregateRow[] = [
  {
    engine: "alisa_ai",
    period: "2026-07",
    mentions: 89,
    citations: 155,
    presence_rate: 44,
    provenance: "wm_alisa_manual",
    captured_at: "2026-07-13 14:30:00",
    ingestion_run_id: "seo_os_ai_visibility_2026-07_alisa_ai",
  },
];

const aliceSnapshots: ZarukuAliceVisibilitySnapshot[] = [
  {
    id: "july", analyticsAccountId: "1", month: "2026-07", domain: "zaruku.ru", officialSovPct: 44,
    exportedQueryCount: null, portalPresentQueryCount: null, samplePresencePct: null,
    provenance: { sourceKey: "alice_ai", sourceFilename: "july.xlsx", sourceSha256: "july", ingestionRunId: "july" },
    queries: [], competitors: [], featuredSites: [], versions: [],
  },
  {
    id: "august", analyticsAccountId: "1", month: "2026-08", domain: "zaruku.ru", officialSovPct: 43.91,
    exportedQueryCount: null, portalPresentQueryCount: null, samplePresencePct: null,
    provenance: { sourceKey: "alice_ai", sourceFilename: "august.xlsx", sourceSha256: "august", ingestionRunId: "august" },
    queries: [], competitors: [], featuredSites: [], versions: [],
  },
];

const opportunities: ZarukuSeoOpportunityRow[] = [
  { week: "2026-W29", opportunity_id: "approved-1", section: "/rak-molochnoj-zhelezy/", opportunity_type: "section_ranking_gap", title: "one", target_url: "https://zaruku.ru/a", decision: "approved", reject_reason: null, confidence: 60, priority: "high" },
  { week: "2026-W29", opportunity_id: "approved-2", section: "/melanoma/", opportunity_type: "section_ranking_gap", title: "two", target_url: "https://zaruku.ru/b", decision: "approved", reject_reason: null, confidence: 60, priority: "high" },
  { week: "2026-W29", opportunity_id: "approved-3", section: "/rak-lyogkogo/", opportunity_type: "section_ranking_gap", title: "three", target_url: "https://zaruku.ru/c", decision: "approved", reject_reason: null, confidence: 60, priority: "medium" },
  { week: "2026-W29", opportunity_id: "approved-4", section: "/map/", opportunity_type: "section_ranking_gap", title: "four", target_url: "https://zaruku.ru/d", decision: "approved", reject_reason: null, confidence: 60, priority: "low" },
  { week: "2026-W29", opportunity_id: "rejected-1", section: "/content/", opportunity_type: "section_ranking_gap", title: "five", target_url: null, decision: "rejected", reject_reason: "skip", confidence: 60, priority: "low" },
  { week: "2026-W29", opportunity_id: "rejected-2", section: "/content/", opportunity_type: "section_ranking_gap", title: "six", target_url: null, decision: "rejected", reject_reason: "skip", confidence: 60, priority: "low" },
  { week: "2026-W29", opportunity_id: "pending", section: "/content/", opportunity_type: "section_ranking_gap", title: "pending", target_url: null, decision: "pending", reject_reason: null, confidence: 60, priority: "high" },
];

const tasks: ZarukuSeoTaskRow[] = [
  { week: "2026-W29", task_id: "w481", section: "/rak-molochnoj-zhelezy/", title: "Task 1", status: "awaiting_medical_review", notion_url: "https://notion.so/1" },
  { week: "2026-W29", task_id: "w482", section: "/melanoma/", title: "Task 2", status: "awaiting_medical_review", notion_url: "https://notion.so/2" },
  { week: "2026-W29", task_id: "w484", section: "/rak-lyogkogo/", title: "Task 4", status: "awaiting_medical_review", notion_url: "https://notion.so/4" },
];

const runs: ZarukuSeoRunRow[] = [
  { week: "2026-W29", status: "completed", serp_requests: 0, llm_tokens: 0, digest_count: 6 },
];

test("buildNorthStarKpis uses the latest published official Alice SoV", () => {
  const kpis = buildNorthStarKpis({ sovRows, aiRows, aliceSnapshots, opportunities });

  assert.equal(kpis.noise.value, 63.74);
  assert.equal(kpis.medicalIntent.value, 24.81);
  assert.equal(kpis.medicalIntent.guardValue, 72.79);
  assert.equal(kpis.aiVisibility.value, 43.91);
  assert.equal(kpis.aiVisibility.delta, -0.09000000000000341);
  assert.deepEqual(kpis.aiVisibility.series, [
    { label: "2026-07", value: 44 },
    { label: "2026-08", value: 43.91 },
  ]);
  assert.equal(kpis.approveRate.value, 66.66666666666666);
  assert.equal(kpis.noise.goal, "down");
  assert.equal(kpis.medicalIntent.goal, "up");
});

test("buildSemanticHealthRows keeps all latest-week SOV clusters and highlights baseline clusters", () => {
  const rows = buildSemanticHealthRows(sovRows, "2026-W29");

  assert.deepEqual(rows.map((row) => row.cluster), ["medical_org_labs_noise", "medical_intent_total"]);
  assert.equal(rows[0].isBaselineCluster, true);
  assert.equal(rows[1].isBaselineCluster, true);
});

test("buildWeeklyFocus describes the latest official Alice SoV without legacy counts", () => {
  const focus = buildWeeklyFocus({ opportunities, aiRows, aliceSnapshots, tasks, runs, week: "2026-W29" });

  assert.equal(focus.seo, "Фокус SEO: /rak-molochnoj-zhelezy/ — разрыв позиций раздела");
  assert.doesNotMatch(focus.ai, /89|155|упоминани|цитировани/i);
  assert.equal(focus.ai, "ИИ: официальная видимость в Алисе AI — 43,91% за 2026-08 · ручная выгрузка");
  assert.equal(focus.pipeline, "Конвейер: 2026-W29 завершён, дайджест 6, Медицинская проверка: 3");
});

test("legacy Alice fallback keeps only visibility and Russian manual provenance", () => {
  const kpis = buildNorthStarKpis({ sovRows, aiRows, aliceSnapshots: [], opportunities });
  const focus = buildWeeklyFocus({ opportunities, aiRows, aliceSnapshots: [], tasks, runs, week: "2026-W29" });

  assert.equal(kpis.aiVisibility.value, 44);
  assert.equal(kpis.aiVisibility.note, "Видимость в Алисе AI, ручная выгрузка, ежемесячно");
  assert.equal(kpis.aiVisibility.provenance, "Ручная выгрузка");
  assert.equal(focus.ai, "ИИ: видимость в Алисе AI — 44,00% за 2026-07 · ручная выгрузка");
  assert.doesNotMatch(`${kpis.aiVisibility.provenance} ${focus.ai}`, /89|155|упоминани|цитировани|wm_alisa_manual/i);
});
