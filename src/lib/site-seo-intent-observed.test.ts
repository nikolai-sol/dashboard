import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as observed from "./site-seo-intent-observed";

const scope = { siteId: "site-med", clientId: "client-med", dashboardId: 41 };
const rules = [{ sourceRowOrdinal: 2, key: "рак", normalizedKey: "рак", group: "Онкология", matchType: "phrase" as const }];
test("canonical sample uses server scope, bounded independent periods and actual observed query matches", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const result = await observed.readTargetIntentObservedQueries({ async execute(sql, params = []) {
    calls.push({ sql, params });
    if (/latest-webmaster-date/.test(sql)) return [[{ period_to: "2026-09-13" }]];
    return [Array.from({ length: 100 }, (_, i) => ({ query_text: `рак ${i}`, impressions: 100 - i, clicks: 2, period_from: "2026-09-07", period_to: "2026-09-13" }))];
  } }, scope, rules, [{ ...scope, sourceKey: "yandex_webmaster", analyticsAccountId: "account-med", resourceId: "host-med" }]);
  assert.equal(result.length, 2);
  assert.ok(result.every(s => s.matches.length === 8 && s.sampledQueryCount === 100));
  assert.ok(result.every(s => s.periodFrom === "2026-09-07" && s.periodTo === "2026-09-13"));
  assert.ok(result.every(s => s.matches.every(m => m.matchedRule === "рак" && m.query.startsWith("рак "))));
  const gsc = calls.find(c => /canonical_fact_gsc_manual_period_dimensions/.test(c.sql))!;
  assert.deepEqual(gsc.params.slice(0, 3), [scope.clientId, scope.siteId, scope.dashboardId]);
  assert.equal(gsc.params[3], createHash("sha256").update('{"country":"all","device":"all","search_type":"web"}').digest("hex"));
  assert.match(gsc.sql, /status = 'published'/);
  assert.match(gsc.sql, /period_kind = 'iso_week'/);
  assert.match(gsc.sql, /LIMIT 100/);
  const webmaster = calls.find(c => /SUM\(impressions\)/.test(c.sql))!;
  assert.deepEqual(webmaster.params, ["yandex_webmaster", "account-med", "host-med", "2026-09-07", "2026-09-13"]);
  assert.match(webmaster.sql, /LIMIT 100/);
  assert.ok(calls.every(c => !/oauth|token|https?:/i.test(c.sql)));
});

test("foreign bindings are never queried; unavailable canonical reads cannot masquerade as no matches", async () => {
  let calls = 0;
  const result = await observed.readTargetIntentObservedQueries({ async execute() { calls++; throw new Error("private SQL error"); } }, scope, rules, [{ ...scope, siteId: "foreign", sourceKey: "yandex_webmaster", analyticsAccountId: "foreign", resourceId: "foreign" }]);
  assert.equal(calls, 1);
  assert.equal(result[0].state, "unavailable");
  assert.equal(result[1].state, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private|foreign/);
});
