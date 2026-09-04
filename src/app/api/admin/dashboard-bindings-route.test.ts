import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.resolve("src/app/api/admin/dashboards/[id]/bindings/route.ts"),
  "utf8",
);

const dashboardWriteSources = [
  "src/app/api/admin/dashboards/route.ts",
  "src/app/api/admin/dashboards/[id]/route.ts",
  "src/app/api/admin/dashboards/[id]/clone/route.ts",
].map((file) => readFileSync(path.resolve(file), "utf8"));

test("binding write requires a signed admin actor and canonical ids", () => {
  assert.match(source, /verifyAdminSession/);
  assert.match(source, /ADMIN_SESSION_COOKIE/);
  assert.match(source, /canonical_campaign_id/);
  assert.match(source, /replaceEffectiveBindings\(conn, dashboardId, actor, bindings\)/);
  assert.doesNotMatch(source, /replaceMediaPlanBindings/);
});

test("binding write owns one explicit transaction", () => {
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /await conn\.commit\(\)/);
  assert.match(source, /await conn\.rollback\(\)/);
});

test("generic dashboard writes cannot bypass canonical binding persistence", () => {
  for (const route of dashboardWriteSources) {
    assert.match(route, /replaceEffectiveBindings/);
    assert.doesNotMatch(route, /replaceMediaPlanBindings/);
  }
});
