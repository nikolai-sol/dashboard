import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSourceWeekFallback,
  hasSourceWeekFallback,
  selectSourceWeekRows,
} from "@/components/zaruku-seo-source-week";

type Row = { week: string; id: string };

const rows: Row[] = [
  { week: "2026-W29", id: "old" },
  { week: "2026-W31", id: "latest" },
];

test("selectSourceWeekRows returns the requested populated week", () => {
  assert.deepEqual(
    selectSourceWeekRows(rows, "2026-W29", ["2026-W29", "2026-W31"]),
    {
      requestedWeek: "2026-W29",
      actualWeek: "2026-W29",
      rows: [rows[0]],
      fallback: false,
    },
  );
});

test("selectSourceWeekRows falls back to the latest populated week", () => {
  const selection = selectSourceWeekRows(rows, "2026-W30", ["2026-W29", "2026-W31"]);

  assert.deepEqual(selection, {
    requestedWeek: "2026-W30",
    actualWeek: "2026-W31",
    rows: [rows[1]],
    fallback: true,
  });
  assert.equal(formatSourceWeekFallback(selection), "W30 недоступна, показано W31");
});

test("selectSourceWeekRows preserves a coverage-backed successful empty week", () => {
  assert.deepEqual(
    selectSourceWeekRows([], "2026-W30", ["2026-W30"]),
    {
      requestedWeek: "2026-W30",
      actualWeek: "2026-W30",
      rows: [],
      fallback: false,
    },
  );
});

test("selectSourceWeekRows returns a no-source state without inventing a fallback", () => {
  assert.deepEqual(selectSourceWeekRows([], "2026-W30", []), {
    requestedWeek: "2026-W30",
    actualWeek: null,
    rows: [],
    fallback: false,
  });
});

test("hasSourceWeekFallback follows explicit fallback state", () => {
  const exact = selectSourceWeekRows(rows, "2026-W29", ["2026-W29", "2026-W31"]);
  const fallback = selectSourceWeekRows(rows, "2026-W30", ["2026-W29", "2026-W31"]);

  assert.equal(hasSourceWeekFallback([exact]), false);
  assert.equal(hasSourceWeekFallback([exact, fallback]), true);
});
