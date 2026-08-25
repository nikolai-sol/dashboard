import test from "node:test";
import assert from "node:assert/strict";
import { selectAbbottSummaryRows } from "./abbott-summary";
import { ABBOTT_WITH_USER_ID, ABBOTT_WITHOUT_ADMINS } from "./abbott/abbott-admin-user-filter";
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

test("manager default summary uses canonical Logs visit rows", () => {
  const trafficRows = [summaryRow({ traffic_segment: "all", visits: 7863 })];
  const behaviorRows = [
    summaryRow({ traffic_segment: null, user_id: "900001", has_user_id: true, visits: 47 }),
    summaryRow({ traffic_segment: null, user_id: "", has_user_id: false, visits: 6785 }),
  ];

  assert.equal(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
});

test("non-manager summary keeps the aggregate Reports traffic rows", () => {
  const trafficRows = [
    summaryRow({ traffic_segment: "all", traffic_source: "Direct", visits: 7863 }),
    summaryRow({ traffic_segment: "with_user_id", traffic_source: "Direct", visits: 1189 }),
  ];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows: [],
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: false,
    }),
    [trafficRows[0]],
  );
});

test("all-with-User-ID keeps identified admin and non-admin summary rows", () => {
  const admin = summaryRow({ traffic_segment: null, user_id: "900001", has_user_id: true, visits: 47 });
  const doctor = summaryRow({ traffic_segment: null, user_id: "doctor-1", has_user_id: true, visits: 3 });
  const anonymous = summaryRow({ traffic_segment: null, user_id: "", has_user_id: false, visits: 10 });

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows: [summaryRow({ traffic_segment: "all", visits: 7863 })],
      behaviorRows: [admin, doctor, anonymous],
      filters: { user_id: ABBOTT_WITH_USER_ID, user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    [admin, doctor],
  );
});

test("manager aggregate all stays on the Logs visit population", () => {
  const trafficRows = [summaryRow({ traffic_segment: "all", visits: 12032 })];
  const behaviorRows = [
    summaryRow({ traffic_segment: null, user_id: "", has_user_id: false, visits: 12168 }),
  ];

  assert.equal(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
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

test("non-manager User ID traffic filters select only the exact aggregate partition", () => {
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
      showUserIdAnalytics: false,
    }),
    [withUserId],
  );
  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "without_user_id", direction: "" },
      showUserIdAnalytics: false,
    }),
    [withoutUserId],
  );
});

test("manager presence selection keeps the Logs population for downstream filtering", () => {
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "60", has_user_id: true })];

  assert.equal(
    selectAbbottSummaryRows({
      trafficRows: [summaryRow({ traffic_segment: "all" })],
      behaviorRows,
      filters: { user_id: "", user_id_traffic: "with_user_id", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRows,
  );
});

test("admin-free selection uses its independently recomputed behavior rows", () => {
  const trafficRows = [summaryRow({ traffic_segment: "all", visits: 100 })];
  const behaviorRows = [summaryRow({ traffic_segment: null, user_id: "900001", has_user_id: true, visits: 5 })];
  const behaviorRowsWithoutAdmins = [summaryRow({ traffic_segment: null, user_id: "doctor-1", has_user_id: true, visits: 3 })];

  assert.deepEqual(
    selectAbbottSummaryRows({
      trafficRows,
      behaviorRows,
      behaviorRowsWithoutAdmins,
      filters: { user_id: ABBOTT_WITHOUT_ADMINS, user_id_traffic: "", direction: "" },
      showUserIdAnalytics: true,
    }),
    behaviorRowsWithoutAdmins,
  );
});
