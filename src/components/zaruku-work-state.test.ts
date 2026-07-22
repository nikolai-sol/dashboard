import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuSeoRunRow } from "@/lib/types";
import { hasHistoricalZeroTelemetry } from "@/components/zaruku-work-state";

const runs: ZarukuSeoRunRow[] = [
  { week: "2026-W28", status: "completed", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
  { week: "2026-W29", status: "completed", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
  { week: "2026-W30", status: "completed", serp_requests: 10, llm_tokens: 200, digest_count: 1 },
];

test("historical completed runs with all-zero counters are flagged as incomplete telemetry", () => {
  assert.equal(hasHistoricalZeroTelemetry(runs), true);
});

test("historical zero SERP and LLM counters stay incomplete when a digest was recorded", () => {
  assert.equal(hasHistoricalZeroTelemetry([
    { ...runs[0], digest_count: 3 },
    runs[2],
  ]), true);
});

test("a zero-only latest run is not enough to relabel history", () => {
  assert.equal(hasHistoricalZeroTelemetry([runs[2], { ...runs[2], week: "2026-W31", serp_requests: 0, llm_tokens: 0, digest_count: 0 }]), false);
});
