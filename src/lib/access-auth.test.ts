import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignedSession,
  createViewerExportToken,
  createViewerPortalSession,
  createViewerSession,
  verifyViewerPortalSession,
  verifyViewerSession,
} from "./access-auth";

test("embed and manager audiences survive signed viewer sessions", () => {
  const managerToken = createViewerSession(18, "manager@example.test", "manager");
  const embedToken = createViewerSession(18, "embed@example.test", "embed");

  assert.equal(verifyViewerSession(managerToken, 18)?.audience, "manager");
  assert.equal(verifyViewerSession(embedToken, 18)?.audience, "embed");
});

test("viewer export tokens preserve their explicit audience", () => {
  const managerToken = createViewerExportToken(18, "manager");
  const embedToken = createViewerExportToken(18, "embed");

  assert.equal(verifyViewerSession(managerToken, 18)?.audience, "manager");
  assert.equal(verifyViewerSession(embedToken, 18)?.audience, "embed");
});

test("legacy and invalid audiences cannot authorize dashboard sessions", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const legacyToken = createSignedSession({
    type: "viewer",
    dashboard_id: 18,
    email: "legacy@example.test",
    exp,
  });
  const invalidToken = createSignedSession({
    type: "viewer_export",
    dashboard_id: 18,
    audience: "admin",
    exp,
  } as unknown as Parameters<typeof createSignedSession>[0]);

  assert.equal(verifyViewerSession(legacyToken, 18), null);
  assert.equal(verifyViewerSession(invalidToken, 18), null);
});

test("viewer portal sessions keep their existing audience-free behavior", () => {
  const token = createViewerPortalSession("VIEWER@example.test", [18, 19]);
  const payload = verifyViewerPortalSession(token);

  assert.equal(payload?.email, "viewer@example.test");
  assert.deepEqual(payload?.dashboard_ids, [18, 19]);
  assert.equal("audience" in (payload ?? {}), false);
});
