import test from "node:test";
import assert from "node:assert/strict";
import { selectAbbottSummaryRows } from "./abbott-summary";
import type { AbbottBiUserSummaryRow } from "@/lib/types";

function summaryRow(overrides: Partial<AbbottBiUserSummaryRow>): AbbottBiUserSummaryRow {
  return {
    user_id: "",
    has_user_id: false,
    traffic_source: "Direct traffic",
    direction: null,
    visits: 100,
    users: 80,
    new_users: 20,
    page_depth: 3,
    avg_duration: 240,
    bounce_rate: 20,
    ...overrides,
  };
}

test("default summary uses authoritative traffic sessions", () => {
  const trafficRows = [summaryRow({ visits: 11650 })];
  const behaviorRows = [summaryRow({ user_id: "60", has_user_id: true, visits: 52633 })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    trafficRows,
  );
});

test("user behavior summary is used for User ID and direction filters", () => {
  const trafficRows = [summaryRow({ visits: 11650 })];
  const behaviorRows = [summaryRow({ user_id: "60", has_user_id: true, direction: "Гастро", visits: 42 })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "60", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "Гастро" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
});

test("falls back to behavior rows when traffic summary is unavailable", () => {
  const behaviorRows = [summaryRow({ visits: 52633 })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows: [],
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
});
