import assert from "node:assert/strict";
import test from "node:test";

import { defaultAbbottRange } from "./abbott-date-range";

test("Abbott defaults to current month through yesterday", () => {
  assert.deepEqual(defaultAbbottRange(new Date("2026-07-16T12:00:00+02:00")), {
    from: "2026-07-01",
    to: "2026-07-15",
  });
});

test("Abbott calculates the business date independently of the browser timezone", () => {
  assert.deepEqual(defaultAbbottRange(new Date("2026-06-30T21:30:00Z"), "Europe/Moscow"), {
    from: "2026-07-01",
    to: "2026-06-30",
  });
});

test("Abbott range accepts a configured business timezone", () => {
  assert.deepEqual(defaultAbbottRange(new Date("2026-07-01T23:30:00Z"), "America/New_York"), {
    from: "2026-07-01",
    to: "2026-06-30",
  });
});
