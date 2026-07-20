import test from "node:test";
import assert from "node:assert/strict";
import { selectAbbottSummaryRows } from "./abbott-summary";
import type { AbbottBiUserSummaryRow } from "@/lib/types";

function summaryRow(overrides: Partial<AbbottBiUserSummaryRow>): AbbottBiUserSummaryRow {
  return {
    user_id: "",
    has_user_id: false,
    traffic_segment: "all",
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
  const trafficRows = [
    summaryRow({ traffic_segment: "all", traffic_source: "Direct", visits: 11650 }),
    summaryRow({ traffic_segment: "with_user_id", traffic_source: "Direct", visits: 4000 }),
    summaryRow({ traffic_segment: "all", traffic_source: "Organic", visits: 3000 }),
  ];
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "60", has_user_id: true, visits: 52633 })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    [trafficRows[0], trafficRows[2]],
  );
});

test("user behavior summary is used for User ID and direction filters", () => {
  const trafficRows = [summaryRow({ visits: 11650 })];
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "60", has_user_id: true, direction: "Гастро", visits: 42 })];

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
  const behaviorRows = [summaryRow({ traffic_segment: null, visits: 52633 })];

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

test("User ID traffic filters select only the exact aggregate partition", () => {
  const all = summaryRow({ traffic_segment: "all", visits: 100 });
  const withUserId = summaryRow({ traffic_segment: "with_user_id", has_user_id: true, visits: 40 });
  const withoutUserId = summaryRow({ traffic_segment: "without_user_id", visits: 60 });
  const trafficRows = [all, withUserId, withoutUserId];
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "60", has_user_id: true })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "with_user_id", direction: "" },
      showUserIdAnalytics: true,
    }),
    [withUserId],
  );
  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "without_user_id", direction: "" },
      showUserIdAnalytics: true,
    }),
    [withoutUserId],
  );
});

test("presence partition selection never falls back to private behavior", () => {
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "60", has_user_id: true })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows: [summaryRow({ traffic_segment: "all" })],
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "with_user_id", direction: "" },
      showUserIdAnalytics: true,
    }),
    [],
  );
});
