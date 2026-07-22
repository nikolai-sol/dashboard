import assert from "node:assert/strict";
import test from "node:test";
import { filterAndPaginate } from "./zaruku-table-pagination";

const rows = Array.from({ length: 121 }, (_, index) => ({ id: index, label: `Фраза ${index}` }));

test("mount window is capped at 50 rows", () => {
  const result = filterAndPaginate(rows, "", 1, 50, (row) => row.label);
  assert.equal(result.rows.length, 50);
  assert.equal(result.totalPages, 3);
  assert.equal(result.totalRows, 121);
});

test("search is case-insensitive and clamps an out-of-range page", () => {
  const result = filterAndPaginate(rows, "ФРАЗА 12", 9, 50, (row) => row.label);
  assert.equal(result.page, 1);
  assert.equal(result.totalRows, 2);
});
