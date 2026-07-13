import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeoAiVisibilityQuery,
  buildSeoSovWeeklyQuery,
  loadZarukuSeoIntelligenceData,
  normalizeSeoAiVisibilityRow,
  normalizeSeoSovWeeklyRow,
} from "@/lib/zaruku-seo-intelligence";

test("buildSeoSovWeeklyQuery scopes SOV rows by analytics account", () => {
  const query = buildSeoSovWeeklyQuery(["66624469"]);

  assert.match(query.sql, /FROM seo_sov_weekly/);
  assert.match(query.sql, /analytics_account_id IN \(\?\)/);
  assert.deepEqual(query.params, ["66624469"]);
});

test("buildSeoAiVisibilityQuery scopes monthly AI visibility by analytics account", () => {
  const query = buildSeoAiVisibilityQuery(["66624469"]);

  assert.match(query.sql, /FROM seo_ai_visibility/);
  assert.match(query.sql, /analytics_account_id IN \(\?\)/);
  assert.deepEqual(query.params, ["66624469"]);
});

test("normalizes SOV rows with 28d window metadata", () => {
  assert.deepEqual(
    normalizeSeoSovWeeklyRow({
      week_key: "2026-W29",
      snapshot_date: "2026-07-13",
      date_start: "2026-06-13",
      date_end: "2026-07-10",
      cluster: "medical_intent_total",
      query_count: "810",
      impressions: "7532",
      clicks: "444",
      impression_share_pct: "24.81",
      click_share_pct: "72.79",
      ctr_pct: "5.89",
      average_position: null,
      is_noise: 0,
      is_medical: 1,
      ingestion_run_id: "seo_os_sov_weekly_2026-W29",
    }),
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
  );
});

test("normalizes monthly AI visibility rows from seo_ai_visibility", () => {
  assert.deepEqual(
    normalizeSeoAiVisibilityRow({
      engine: "alisa_ai",
      period: "2026-07",
      mentions: "89",
      citations: "155",
      presence_rate: "0.4400",
      provenance: "wm_alisa_manual",
      captured_at: "2026-07-13 14:30:00",
      ingestion_run_id: "seo_os_ai_visibility_2026-07_alisa_ai",
    }),
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
  );
});

test("loadZarukuSeoIntelligenceData isolates missing optional tables", async () => {
  const data = await loadZarukuSeoIntelligenceData(["66624469"], async (query) => {
    if (query.sql.includes("seo_ai_visibility")) throw new Error("missing ai table");
    return [];
  });

  assert.equal(data.status, "partial");
  assert.equal(data.sov.available, true);
  assert.equal(data.ai.available, false);
  assert.match(data.error ?? "", /missing ai table/);
});
