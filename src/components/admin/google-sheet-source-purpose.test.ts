import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const wizard = readFileSync(path.resolve("src/components/admin/WizardStep2.tsx"), "utf8");
const confirmation = readFileSync(
  path.resolve("src/app/api/admin/manual-data/confirm/route.ts"),
  "utf8",
);

test("admin separates media-plan Sheets from advertising fact Sheets", () => {
  assert.match(wizard, /Add media plan Sheet/);
  assert.match(wizard, /Advertising actuals from file or Google Sheet/);
  assert.match(wizard, /Add advertising actuals Sheet/);
  assert.doesNotMatch(wizard, /Collected daily into canonical advertising data/);
});

test("Sheet actuals reuse Collection settings and health policy without connector storage", () => {
  assert.match(confirmation, /canonical_source_account_collection_settings/);
  assert.match(confirmation, /canonical_ad_source_schedule_policies/);
  assert.doesNotMatch(confirmation, /canonical_ad_source_connectors/);
});
