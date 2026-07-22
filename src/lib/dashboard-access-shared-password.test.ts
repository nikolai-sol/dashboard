import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sharedCredentialVersionMatches } from "./dashboard-access";

test("unversioned manager session cannot authorize a versioned shared dashboard", () => {
  assert.equal(sharedCredentialVersionMatches({ audience: "manager" }, 1), false);
  assert.equal(
    sharedCredentialVersionMatches(
      { audience: "manager", credential_version: 1 },
      1,
    ),
    true,
  );
});

test("shared dashboard manager sessions reject stale and non-manager versions", () => {
  assert.equal(
    sharedCredentialVersionMatches(
      { audience: "manager", credential_version: 2 },
      3,
    ),
    false,
  );
  assert.equal(
    sharedCredentialVersionMatches(
      { audience: "embed", credential_version: 3 },
      3,
    ),
    false,
  );
});

test("dashboard login rate limits by client IP and normalized dashboard identifier", () => {
  const source = readFileSync(
    new URL("../app/api/dashboard-auth/login/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /checkRateLimit/);
  assert.match(
    source,
    /dashboard-login:\$\{getClientIp\(request\)\}:\$\{identifier\.toLowerCase\(\)\}/,
  );
  assert.match(source, /LOGIN_MAX_ATTEMPTS\s*=\s*10/);
  assert.match(source, /LOGIN_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /status:\s*429/);
  assert.match(source, /["']Retry-After["']/);
  assert.match(
    source,
    /createViewerSession\([\s\S]*context\.credentialVersion[\s\S]*\)/,
  );
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:password|body)/i);
});

test("PDF export receives the credential version validated by dashboard authorization", () => {
  const source = readFileSync(
    new URL("../app/api/dashboard/[id]/pdf/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /createViewerExportToken\([\s\S]*access\.context\.id,[\s\S]*access\.audience,[\s\S]*access\.credentialVersion[\s\S]*\)/,
  );
});
