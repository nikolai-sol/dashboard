import assert from "node:assert/strict";
import test from "node:test";

import { buildAbbottReturnFrequencyUi } from "./abbott-return-frequency-ui";
import type { AbbottBiReturnFrequency } from "@/lib/types";

const frequency: AbbottBiReturnFrequency = {
  available: true,
  period_local: true,
  identified_visitors: 10,
  unidentified_visits: 2,
  groups: [
    { group_id: "one", label: "1 раз", visitors: 4, share: 40, visits: 4 },
    { group_id: "two_to_three", label: "2–3 раза", visitors: 5, share: 50, visits: 12 },
    { group_id: "four_plus", label: "4+ раза", visitors: 1, share: 10, visits: 5 },
  ],
  user_directions: [
    { direction: "Кардиология", frequency_group: "two_to_three", visitors: 3, repeat_visits: 5 },
    { direction: "Гастроэнтерология", frequency_group: "four_plus", visitors: 1, repeat_visits: 4 },
  ],
  return_pages: [
    { url: "/cardio", direction: "Кардиология", frequency_group: "two_to_three", returning_visitors: 3, repeat_visits: 5 },
    { url: "/gastro", direction: "Гастроэнтерология", frequency_group: "four_plus", returning_visitors: 1, repeat_visits: 4 },
  ],
};

test("builds count-first cards and chart rows with supporting percentages", () => {
  const ui = buildAbbottReturnFrequencyUi(frequency, {});

  assert.deepEqual(ui.cards.map(({ label, visitors, share }) => ({ label, visitors, share })), [
    { label: "1 визит", visitors: 4, share: 40 },
    { label: "2–3 визита", visitors: 5, share: 50 },
    { label: "4+ визита", visitors: 1, share: 10 },
  ]);
  assert.deepEqual(ui.chart.map(({ label, visitors, share }) => ({ label, visitors, share })), [
    { label: "1 раз", visitors: 4, share: 40 },
    { label: "2–3 раза", visitors: 5, share: 50 },
    { label: "4+ раза", visitors: 1, share: 10 },
  ]);
  assert.equal(ui.identifiedVisitors, 10);
  assert.equal(ui.unidentifiedVisits, 2);
});

test("builds sorted filter options and filters aggregate tables", () => {
  const ui = buildAbbottReturnFrequencyUi(frequency, {
    frequency_group: "four_plus",
    user_direction: "Гастроэнтерология",
    page_direction: "Гастроэнтерология",
    page_url: "/gastro",
  });

  assert.deepEqual(ui.options.frequency_group.map((option) => option.value), ["two_to_three", "four_plus"]);
  assert.deepEqual(ui.options.user_direction.map((option) => option.value), ["Гастроэнтерология", "Кардиология"]);
  assert.deepEqual(ui.userDirections.map((row) => row.direction), ["Гастроэнтерология"]);
  assert.deepEqual(ui.returnPages.map((row) => row.url), ["/gastro"]);
});

test("unavailable frequency never creates zero-filled cards", () => {
  const ui = buildAbbottReturnFrequencyUi({ ...frequency, available: false }, {});
  assert.equal(ui.available, false);
  assert.deepEqual(ui.cards, []);
  assert.deepEqual(ui.chart, []);
  assert.deepEqual(ui.userDirections, []);
  assert.deepEqual(ui.returnPages, []);
});
