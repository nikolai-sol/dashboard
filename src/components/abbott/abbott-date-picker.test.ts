import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateAbbottCustomRange } from "./AbbottDatePicker";

const pickerSource = readFileSync(new URL("./AbbottDatePicker.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../DashboardHeader.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");

test("Abbott period picker provides all completed-period choices", () => {
  for (const label of ["Этот месяц", "Прошлый месяц", "Эта неделя", "Прошлая неделя", "Свой период"]) {
    assert.match(pickerSource, new RegExp(label));
  }
  assert.match(pickerSource, /max=\{maxDate\}/);
  assert.match(headerSource, /dateControlsSlot/);
  assert.match(pageSource, /<AbbottDatePicker/);
});

test("Abbott custom dates require a complete, ordered completed-day range", () => {
  assert.equal(validateAbbottCustomRange({ from: "", to: "2026-08-08" }, "2026-08-08"), "Укажите обе даты периода");
  assert.equal(
    validateAbbottCustomRange({ from: "2026-08-08", to: "2026-08-01" }, "2026-08-08"),
    "Дата начала не может быть позже даты окончания",
  );
  assert.equal(
    validateAbbottCustomRange({ from: "2026-08-01", to: "2026-08-09" }, "2026-08-08"),
    "Дата окончания не может быть позже последнего завершённого дня",
  );
  assert.equal(validateAbbottCustomRange({ from: "2026-08-01", to: "2026-08-08" }, "2026-08-08"), null);
});

test("Abbott picker announces range validation and empty-period state accessibly", () => {
  assert.match(pickerSource, /aria-describedby=\{customError \? customMessageId : undefined\}/);
  assert.match(pickerSource, /id=\{customMessageId\}[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(pickerSource, /id=\{emptyMessageId\}[^>]*role="status"[^>]*aria-live="polite"/);
});

test("only Abbott passes a dedicated period selector into the shared header", () => {
  const abbottBranch = pageSource.slice(
    pageSource.indexOf('if (dashboardType === "abbott_bi"'),
    pageSource.indexOf('if (dashboardType === "zaruku_bi"'),
  );
  const zarukuBranch = pageSource.slice(pageSource.indexOf('if (dashboardType === "zaruku_bi"'));
  assert.match(abbottBranch, /dateControlsSlot=/);
  assert.doesNotMatch(zarukuBranch, /dateControlsSlot=/);
});
