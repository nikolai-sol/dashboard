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

test("groups visits by the five displayed dimensions and preserves weighted totals", () => {
  const rows = [
    action("", null, {
      has_user_id: false,
      start_url: "/first-entry",
      end_url: "/same-exit",
      visits: 1,
      avg_duration: 30,
      page_depth: 2,
    }),
    action("", "   ", {
      has_user_id: false,
      start_url: "/different-entry",
      end_url: "/same-exit",
      visits: 2,
      avg_duration: 60,
      page_depth: 4,
    }),
    action("", "email", {
      has_user_id: false,
      end_url: "/same-exit",
      visits: 4,
      avg_duration: 90,
      page_depth: 5,
    }),
  ];

  const selected = selectAbbottUserActions(rows, {}, 1, 100);

  assert.equal(selected.filteredRows.length, 2);
  assert.deepEqual(
    selected.filteredRows.map((row) => ({
      utm_source: row.utm_source,
      visits: row.visits,
    })),
    [
      { utm_source: "email", visits: 4 },
      { utm_source: null, visits: 3 },
    ],
  );
  assert.equal(selected.filteredRows[0]?.avg_duration, 90);
  assert.equal(selected.filteredRows[0]?.page_depth, 5);
  assert.equal(selected.filteredRows[1]?.avg_duration, 50);
  assert.ok(Math.abs((selected.filteredRows[1]?.page_depth ?? 0) - (10 / 3)) < 1e-12);

  assert.equal(
    selected.filteredRows.reduce((sum, row) => sum + row.visits, 0),
    rows.reduce((sum, row) => sum + row.visits, 0),
  );
  assert.equal(
    selected.filteredRows.reduce((sum, row) => sum + row.avg_duration * row.visits, 0),
    rows.reduce((sum, row) => sum + row.avg_duration * row.visits, 0),
  );
  assert.equal(
    Math.round(selected.filteredRows.reduce((sum, row) => sum + row.page_depth * row.visits, 0)),
    rows.reduce((sum, row) => sum + row.page_depth * row.visits, 0),
  );
});

test("groups raw traffic sources that have the same displayed source label", () => {
  const rows = [
    action("", null, { has_user_id: false, traffic_source: "" }),
    action("", null, { has_user_id: false, traffic_source: "Unknown traffic" }),
  ];

  const selected = selectAbbottUserActions(rows, {
    traffic_source_label: () => "Неизвестный источник",
  }, 1, 100);

  assert.equal(selected.filteredRows.length, 1);
  assert.equal(selected.filteredRows[0]?.visits, 2);
});

test("matches source and direction filters against the displayed trimmed values", () => {
  const selected = selectAbbottUserActions([
    action("doctor-a", null, {
      traffic_source: " Direct traffic ",
      direction: " Кардиология ",
    }),
  ], {
    traffic_source: "Direct traffic",
    direction: "Кардиология",
  }, 1, 100);

  assert.equal(selected.filteredRows.length, 1);
});
