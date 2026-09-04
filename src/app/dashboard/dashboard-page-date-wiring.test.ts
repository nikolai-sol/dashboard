import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf8");

test("dashboard page wires live-main Zaruku cutoffs through initial, comparison, and applied ranges", () => {
  assert.match(source, /import \{\s*clampZarukuDateRange,\s*latestZarukuReportingDate,\s*\} from "@\/lib\/dashboard-date-range"/);
  assert.match(source, /const initialRange = isZarukuDashboard \? clampZarukuDateRange\(rawInitialRange\) : rawInitialRange/);
  assert.match(source, /const initialCompareRange = isZarukuDashboard\s*\? clampZarukuDateRange\(rawInitialCompareRange\)/);
  assert.match(source, /const resolvedRange = isZarukuDashboard \? clampZarukuDateRange\(range\) : range/);
  assert.match(source, /const resolvedRange = isZarukuDashboard \? clampZarukuDateRange\(draftDateRange\) : draftDateRange/);
  assert.match(source, /const zarukuMaxDate = latestZarukuReportingDate\(\)/);
  assert.match(source, /dateControlsMode=\{zarukuDateControlsMode\}[\s\S]*maxDate=\{zarukuMaxDate\}/);
});

test("dashboard page wires Abbott's dedicated date picker into the shared header slot", () => {
  assert.match(source, /dateControlsSlot=\{\s*<AbbottDatePicker[\s\S]*maxDate=\{abbottMaxDate\}/);
  assert.match(source, /const abbottMaxDate = latestCompletedAbbottDate\(\)/);
});
