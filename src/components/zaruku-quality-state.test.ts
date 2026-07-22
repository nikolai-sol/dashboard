import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuDatasetMeta, ZarukuSourceFreshnessRow } from "@/lib/types";
import { buildZarukuTrustState } from "@/components/zaruku-quality-state";

const meta = (state: ZarukuDatasetMeta["state"]): ZarukuDatasetMeta => ({
  state,
  sources: ["metrika"],
  period: { from: "2026-06-24", to: "2026-07-19" },
  requested_period: { from: "2026-06-24", to: "2026-07-21" },
  geography: "unsegmented",
  metrics: { visits: true, users: true, pageviews: true, bounce_rate: true, avg_duration_seconds: true, page_depth: true },
  message: null,
});

const freshness = (status: ZarukuSourceFreshnessRow["freshness_status"]): ZarukuSourceFreshnessRow => ({
  source_key: "yandex_metrika",
  label: "Яндекс Метрика",
  collector: "collector.py",
  expected_frequency_hours: 24,
  freshness_status: status,
  freshness_label: status,
  last_status: "success",
  last_finished_at: null,
  last_success_at: null,
  date_from: null,
  date_to: null,
  rows_read: 0,
  rows_written: 0,
  last_error_at: null,
  last_error_summary: null,
  note: "",
});

test("trust state is critical when canonical traffic is unavailable", () => {
  const state = buildZarukuTrustState({ traffic: meta("unavailable"), datasets: [meta("unavailable")], freshness: [freshness("healthy")] });
  assert.equal(state.level, "critical");
  assert.equal(state.label, "Критическая проблема");
});

test("trust state is partial when optional datasets or freshness are incomplete", () => {
  const state = buildZarukuTrustState({ traffic: meta("ready"), datasets: [meta("ready"), meta("unavailable")], freshness: [freshness("delayed")] });
  assert.equal(state.level, "partial");
  assert.equal(state.label, "Частичные данные");
  assert.deepEqual(state.counts, { ready: 1, partial: 0, empty: 0, unavailable: 1 });
});
