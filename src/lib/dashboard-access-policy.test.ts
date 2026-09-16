import assert from "node:assert/strict";
import test from "node:test";
import {
  isProtectedClient,
  resolveDashboardAudience,
  resolveDashboardAuthMode,
} from "./dashboard-access-policy";
import { isSharedPasswordClient, isSharedPasswordDashboard } from "./shared-password-policy";

test("Abbott and Zaruku always use shared password access", () => {
  for (const clientId of ["abbott", " ABBOTT ", "zaruku", "ZARUKU"]) {
    assert.equal(resolveDashboardAuthMode(clientId, 5, false), "password_only");
    assert.equal(resolveDashboardAuthMode(clientId, 0, false), "password_only");
    assert.equal(isSharedPasswordClient(clientId), true);
  }
});

test("non-shared-password dashboards keep their existing auth modes", () => {
  assert.equal(resolveDashboardAuthMode("other", 1, false), "email_password");
  assert.equal(resolveDashboardAuthMode("other", 0, true), "password_only");
  assert.equal(resolveDashboardAuthMode("other", 0, false), "public");
  assert.equal(isProtectedClient("other"), false);
});

test("every generic site-seo dashboard requires its own shared password", () => {
  assert.equal(isSharedPasswordClient("client-roche"), false);
  assert.equal(isSharedPasswordDashboard("client-roche", "site_seo"), true);
  assert.equal(resolveDashboardAuthMode("client-roche", 0, false, "site_seo"), "password_only");
  assert.equal(isSharedPasswordDashboard("other", "performance"), false);
});

test("embed keys and signed sessions resolve the correct audience", () => {
  assert.equal(resolveDashboardAudience("embed_key"), "embed");
  assert.equal(resolveDashboardAudience("authorized"), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "manager" }), "manager");
  assert.equal(resolveDashboardAudience("authorized", { audience: "embed" }), "embed");
});
