import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard and Excel daily Views are rounded to whole numbers", () => {
  const loader = readFileSync(path.resolve("src/lib/dashboard-data-loader.ts"), "utf8");
  const excelRoute = readFileSync(path.resolve("src/app/api/dashboard/[id]/excel/route.ts"), "utf8");

  assert.match(loader, /views:\s*Math\.round\(item\.views\)/);
  assert.match(excelRoute, /views:\s*Math\.round\(row\.views\)/);
  assert.match(excelRoute, /Math\.round\(daily\.views\)/);
});
