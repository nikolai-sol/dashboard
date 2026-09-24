import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSourceAccountLabel } from "./dashboard-source-display";

test("dashboard source label overrides only the configured account", () => {
  assert.equal(
    dashboardSourceAccountLabel({ account_display_name: "Hudeu Prosto", account_ids: ["gidrofuril"] }, "gidrofuril", "Between account gidrofuril"),
    "Hudeu Prosto",
  );
  assert.equal(
    dashboardSourceAccountLabel({ account_display_name: "Hudeu Prosto", account_ids: ["gidrofuril"] }, "other", "Other account"),
    "Other account",
  );
  assert.equal(dashboardSourceAccountLabel({}, "gidrofuril", "Between account gidrofuril"), "Between account gidrofuril");
});
