import assert from "node:assert/strict";
import test from "node:test";
import { campaignIdsWithFrequencyOverrides } from "./dashboard-data-loader";

test("frequency override campaign ids preserve embedded colons", () => {
  const overrides = new Map([
    ["yandex_direct:sheet_name_v1:9dca31919940bea6:2026-07", 1.98],
    ["yandex_direct:sheet_name_v1:9dca31919940bea6:2026-08", 1.98],
    ["between:24834:2026-08", 3],
  ]);

  assert.deepEqual(campaignIdsWithFrequencyOverrides("yandex_direct", overrides), [
    "sheet_name_v1:9dca31919940bea6",
  ]);
});
