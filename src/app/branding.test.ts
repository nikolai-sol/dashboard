import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
const pdfSource = readFileSync(new URL("./api/dashboard/[id]/pdf/route.ts", import.meta.url), "utf8");
const excelSource = readFileSync(new URL("./api/dashboard/[id]/excel/route.ts", import.meta.url), "utf8");

test("runtime metadata uses ReportingDash instead of the retired SolGoood brand", () => {
  for (const source of [layoutSource, pdfSource, excelSource]) {
    assert.doesNotMatch(source, /SolGoood/i);
  }

  assert.match(layoutSource, /title:\s*"ReportingDash"/);
  assert.match(layoutSource, /description:\s*"Client reporting dashboards"/);
});
