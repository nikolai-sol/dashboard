import assert from "node:assert/strict";
import test from "node:test";
import { verifyViewerSession } from "./access-auth";
import * as pdfRoute from "../app/api/dashboard/[id]/pdf/route";

type ExportTokenFactory = (access: {
  context: { id: number; auth_mode: "public" | "email_password" | "password_only" };
  audience: "manager" | "embed";
  credentialVersion?: number;
}) => string | undefined;

function exportTokenFactory() {
  const factory = (pdfRoute as unknown as {
    createAuthorizedViewerExportToken?: ExportTokenFactory;
  }).createAuthorizedViewerExportToken;
  assert.equal(typeof factory, "function");
  return factory as ExportTokenFactory;
}

test("PDF shared-manager export token preserves validated audience and credential version", () => {
  const token = exportTokenFactory()({
    context: { id: 28, auth_mode: "password_only" },
    audience: "manager",
    credentialVersion: 7,
  });
  const payload = verifyViewerSession(token, 28);

  assert.equal(payload?.audience, "manager");
  assert.equal(payload?.credential_version, 7);
});

test("PDF embed export token remains unversioned with embed audience", () => {
  const token = exportTokenFactory()({
    context: { id: 28, auth_mode: "password_only" },
    audience: "embed",
  });
  const payload = verifyViewerSession(token, 28);

  assert.equal(payload?.audience, "embed");
  assert.equal(payload?.credential_version, undefined);
});
