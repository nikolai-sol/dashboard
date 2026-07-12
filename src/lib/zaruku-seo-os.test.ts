import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRhythmWeeks,
  buildSectionPositionTrend,
  calculateApproveRate,
  matchSectionPattern,
  previousAvailableWeek,
  sortIsoWeeks,
} from "@/lib/zaruku-seo-os";

const patterns = [
  { section: "/content/", url_pattern: "/", priority: 99 },
  { section: "/map/", url_pattern: "/map/", priority: 1 },
  { section: "/map/clinics/", url_pattern: "/map/clinics/", priority: 5 },
  { section: "/priority-a/", url_pattern: "/priority/", priority: 10 },
  { section: "/priority-b/", url_pattern: "/priority/", priority: 1 },
];

test("sortIsoWeeks orders ISO weeks across year boundaries", () => {
  assert.deepEqual(sortIsoWeeks(["2026-W02", "2025-W52", "2026-W01"]), ["2025-W52", "2026-W01", "2026-W02"]);
});

test("previousAvailableWeek selects the preceding available week", () => {
  assert.equal(previousAvailableWeek(["2026-W28", "2026-W30"], "2026-W30"), "2026-W28");
  assert.equal(previousAvailableWeek(["2026-W28"], "2026-W28"), null);
});

test("matchSectionPattern selects the longest matching pattern before priority", () => {
  assert.equal(matchSectionPattern("https://zaruku.ru/map/clinics/42", patterns)?.section, "/map/clinics/");
  assert.equal(matchSectionPattern("https://zaruku.ru/map/moscow/1", patterns)?.section, "/map/");
  assert.equal(matchSectionPattern("https://zaruku.ru/priority/test", patterns)?.section, "/priority-b/");
});

test("matchSectionPattern uses the configured root pattern as fallback", () => {
  assert.equal(matchSectionPattern("https://zaruku.ru/unknown", patterns)?.section, "/content/");
});

test("buildSectionPositionTrend excludes null positions from averages and includes no-data rows in coverage", () => {
  assert.deepEqual(
    buildSectionPositionTrend([
      { week: "2026-W28", section: "/map/", serp_position: 4, status: "found" },
      { week: "2026-W28", section: "/map/", serp_position: null, status: "no_data" },
      { week: "2026-W28", section: "/map/", serp_position: 8, status: "found" },
    ]),
    [
      {
        week: "2026-W28",
        section: "/map/",
        average_position: 6,
        coverage: 2 / 3,
        found_rows: 2,
        tracked_rows: 3,
      },
    ],
  );
});

test("calculateApproveRate excludes undecided opportunities from its denominator", () => {
  assert.equal(calculateApproveRate([{ decision: "approved" }, { decision: "rejected" }, { decision: "pending" }]), 50);
  assert.equal(calculateApproveRate([{ decision: "pending" }, { decision: "carried_over" }]), null);
});

test("buildRhythmWeeks inserts missing ISO weeks between available runs", () => {
  assert.deepEqual(
    buildRhythmWeeks([
      { week: "2026-W28", status: "completed", serp_requests: 50, llm_tokens: 0, digest_count: 1 },
      { week: "2026-W30", status: "noop", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
    ]),
    [
      { week: "2026-W28", status: "completed", serp_requests: 50, llm_tokens: 0, digest_count: 1 },
      { week: "2026-W29", status: "missing", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
      { week: "2026-W30", status: "noop", serp_requests: 0, llm_tokens: 0, digest_count: 0 },
    ],
  );
});
