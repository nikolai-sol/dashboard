import assert from "node:assert/strict";
import test from "node:test";
import {
  isProtectedClient,
  resolveDashboardAudience,
  resolveDashboardAuthMode,
} from "./dashboard-access-policy";

test("Abbott never resolves public", () => {
  assert.equal(resolveDashboardAuthMode("abbott", 0, false), "password_only");
  assert.equal(resolveDashboardAuthMode(" ABBOTT ", 0, true), "password_only");
  assert.equal(resolveDashboardAuthMode("abbott", 1, false), "email_password");
  assert.equal(isProtectedClient("AbBoTt"), true);
});

test("non-Abbott dashboards keep their existing auth modes", () => {
  assert.equal(resolveDashboardAuthMode("zaruku", 1, false), "email_password");
  assert.equal(resolveDashboardAuthMode("zaruku", 0, true), "password_only");
  assert.equal(resolveDashboardAuthMode("zaruku", 0, false), "public");
  assert.equal(isProtectedClient("zaruku"), false);
});

test("embed keys and signed sessions resolve the correct audience", () => {
  assert.equal(resolveDashboardAudience("embed_key"), "embed");
  assert.equal(resolveDashboardAudience("authorized"), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "manager" }), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "embed" }), "embed");
});
