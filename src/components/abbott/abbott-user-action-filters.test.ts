import assert from "node:assert/strict";
import test from "node:test";

import {
  ABBOTT_WITHOUT_UTM,
  buildAbbottUtmSourceOptions,
  selectAbbottUserActions,
} from "./abbott-user-action-filters";
import type { AbbottBiUserActionRow } from "@/lib/types";

const action = (
  userId: string,
  utmSource: string | null,
  overrides: Partial<AbbottBiUserActionRow> = {},
): AbbottBiUserActionRow => ({
  user_id: userId,
  has_user_id: Boolean(userId),
  traffic_source: "Direct traffic",
  utm_source: utmSource,
  direction: "Кардиология",
  start_url: "/start",
  end_url: "/end",
  visits: 1,
  page_depth: 2,
  avg_duration: 30,
  ...overrides,
});

test("builds sorted exact UTM options with one explicit missing-value option", () => {
  assert.deepEqual(
    buildAbbottUtmSourceOptions([
      action("1", "social"),
      action("2", null),
      action("3", "email"),
      action("4", "   "),
      action("5", "email"),
    ]),
    [
      { value: ABBOTT_WITHOUT_UTM, label: "Без UTM" },
      { value: "email", label: "email" },
      { value: "social", label: "social" },
    ],
  );
});

test("applies UTM and existing action filters before pagination", () => {
  const rows = [
    action("doctor-a", null),
    action("doctor-a", "", { end_url: "/matching-second" }),
    action("doctor-a", "email"),
    action("doctor-b", null),
  ];

  const selected = selectAbbottUserActions(rows, {
    query: "matching",
    user_id: "doctor-a",
    user_id_traffic: "with_user_id",
    traffic_source: "Direct traffic",
    utm_source: ABBOTT_WITHOUT_UTM,
    direction: "Кардиология",
  }, 1, 1);

  assert.equal(selected.filteredRows.length, 1);
  assert.equal(selected.pageRows[0]?.end_url, "/matching-second");
  assert.equal(selected.currentPage, 1);
  assert.equal(selected.totalPages, 1);
});

test("empty UTM selection preserves all rows and exact values do not match missing UTM", () => {
  const rows = [action("1", null), action("2", "email")];
  assert.equal(selectAbbottUserActions(rows, { utm_source: "" }, 1, 100).filteredRows.length, 2);
  assert.deepEqual(
    selectAbbottUserActions(rows, { utm_source: "email" }, 1, 100).filteredRows.map((row) => row.user_id),
    ["2"],
  );
});
