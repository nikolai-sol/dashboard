import assert from "node:assert/strict";
import test from "node:test";
import {
  isProtectedClient,
  resolveDashboardAudience,
  resolveDashboardAuthMode,
} from "./dashboard-access-policy";
import { isSharedPasswordClient } from "./shared-password-policy";

test("Abbott and Zaruku always use shared password access", () => {
  for (const clientId of ["abbott", " ABBOTT ", "zaruku", "ZARUKU"]) {
    assert.equal(resolveDashboardAuthMode(clientId, 5, false), "password_only");
    assert.equal(isSharedPasswordClient(clientId), true);
  }
});

test("non-shared-password dashboards keep their existing auth modes", () => {
  assert.equal(resolveDashboardAuthMode("other", 1, false), "email_password");
  assert.equal(resolveDashboardAuthMode("other", 0, true), "password_only");
  assert.equal(resolveDashboardAuthMode("other", 0, false), "public");
  assert.equal(isProtectedClient("other"), false);
});

test("embed keys and signed sessions resolve the correct audience", () => {
  assert.equal(resolveDashboardAudience("embed_key"), "embed");
  assert.equal(resolveDashboardAudience("authorized"), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "manager" }), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "embed" }), "embed");
});
