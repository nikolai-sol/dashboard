import assert from "node:assert/strict";
import test from "node:test";
import { createViewerSession } from "./access-auth";
import * as dashboardAccess from "./dashboard-access";

const dashboard = {
  id: 28,
  client_id: "zaruku",
  client_name: "Zaruku",
  dashboard_name: "Dashboard",
  is_active: true,
  access_users_count: 0,
  auth_mode: "password_only" as const,
};

type AuthorizerFactory = (dependencies: Record<string, unknown>) => (
  request: Request,
  identifier: string | number,
) => Promise<{ authorized: boolean; reason: string }>;

function createAuthorizer(dependencies: Record<string, unknown>) {
  const factory = (dashboardAccess as unknown as {
    createDashboardAccessAuthorizer?: AuthorizerFactory;
  }).createDashboardAccessAuthorizer;
  assert.equal(typeof factory, "function");
  return (factory as AuthorizerFactory)(dependencies);
}

function authenticatedRequest(credentialVersion: number) {
  const token = createViewerSession(
    dashboard.id,
    "shared-access+zaruku@dashboard.local",
    "manager",
    credentialVersion,
  );
  return new Request(`http://dashboard.test/dashboard/zaruku?access_token=${token}`);
}

test("old real signed manager session is rejected after credential rotation", async () => {
  const authorize = createAuthorizer({
    async getDashboardAccessContext() {
      return dashboard;
    },
    async loadSharedPasswordCredential() {
      return {
        source: "database",
        password_hash: "not-used-for-authorization",
        legacy_password: null,
        credential_version: 2,
      };
    },
  });

  const access = await authorize(authenticatedRequest(1), "zaruku");

  assert.equal(access.authorized, false);
  assert.equal(access.reason, "auth_required");
});

test("missing shared credential state rejects a real signed manager session", async () => {
  const authorize = createAuthorizer({
    async getDashboardAccessContext() {
      return dashboard;
    },
    async loadSharedPasswordCredential() {
      return {
        source: "missing",
        password_hash: null,
        legacy_password: null,
        credential_version: 0,
      };
    },
  });

  const access = await authorize(authenticatedRequest(0), "zaruku");

  assert.equal(access.authorized, false);
  assert.equal(access.reason, "auth_required");
});
