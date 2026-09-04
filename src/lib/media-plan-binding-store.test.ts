import assert from "node:assert/strict";
import test from "node:test";
import {
  preflightBindings,
  replaceEffectiveBindings,
  type EffectiveBindingInput,
} from "./media-plan-binding-store";

function binding(
  lineKey: string,
  campaignId: number,
  effectiveFrom: string | null,
  effectiveTo: string | null,
): EffectiveBindingInput {
  return {
    line_key: lineKey,
    channel: lineKey,
    canonical_campaign_id: campaignId,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
  };
}

function fakeConnection(options: { account?: string; existing?: Record<string, unknown>[] } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let nextId = 700;
  const connection = {
    async execute(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes("FROM dashboards")) {
        return [[{
          id: Number(params[0]),
          dashboard_type: "awareness",
          config: JSON.stringify({ period_from: "2026-08-01", period_to: "2026-08-31" }),
        }], []];
      }
      if (sql.includes("FROM dashboard_sources")) {
        return [[{
          platform: "between",
          source_config: JSON.stringify({ source_key: "between", account_ids: [options.account ?? "1113"] }),
        }], []];
      }
      if (sql.includes("FROM canonical_source_campaigns")) {
        const ids = params.map(Number);
        return [[
          ...(ids.includes(501) ? [{
            id: 501,
            source_key: "between",
            platform_account_id: "1113",
            platform_campaign_id: "24932",
            campaign_name: "OLV Serials",
          }] : []),
          ...(ids.includes(999) ? [{
            id: 999,
            source_key: "between",
            platform_account_id: "other-account",
            platform_campaign_id: "24999",
            campaign_name: "Other",
          }] : []),
        ], []];
      }
      if (sql.includes("SELECT id, dashboard_id") && sql.includes("FROM media_plan_bindings")) {
        return [options.existing ?? [], []];
      }
      if (sql.startsWith("INSERT INTO media_plan_bindings")) {
        nextId += 1;
        return [{ insertId: nextId, affectedRows: 1 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  return { connection, statements };
}

test("rejects one campaign bound to two lines in an overlapping period", async () => {
  const { connection } = fakeConnection();
  await assert.rejects(
    () => preflightBindings(connection as never, 29, [
      binding("line-a", 501, "2026-08-01", null),
      binding("line-b", 501, "2026-08-15", null),
    ]),
    /overlapping binding/,
  );
});

test("accepts same campaign in another dashboard", async () => {
  const { connection } = fakeConnection();
  const result = await preflightBindings(
    connection as never,
    30,
    [binding("line-b", 501, "2026-08-01", null)],
  );
  assert.equal(result[0].dashboard_id, 30);
});

test("accepts non-overlapping periods for one campaign in the same dashboard", async () => {
  const { connection } = fakeConnection();
  const result = await preflightBindings(connection as never, 29, [
    binding("line-a", 501, "2026-08-01", "2026-08-14"),
    binding("line-b", 501, "2026-08-15", "2026-08-31"),
  ]);

  assert.equal(result.length, 2);
});

test("rejects campaign outside dashboard selected accounts", async () => {
  const { connection } = fakeConnection();
  await assert.rejects(
    () => preflightBindings(connection as never, 29, [binding("line-a", 999, null, null)]),
    /selected source account/,
  );
});

test("null effective dates resolve to dashboard period and source identity comes from catalog", async () => {
  const { connection } = fakeConnection();
  const [resolved] = await preflightBindings(
    connection as never,
    29,
    [binding("line-a", 501, null, null)],
  );

  assert.deepEqual(resolved, {
    dashboard_id: 29,
    line_key: "line-a",
    channel: "line-a",
    canonical_campaign_id: 501,
    source_key: "between",
    platform_account_id: "1113",
    platform_campaign_id: "24932",
    campaign_name: "OLV Serials",
    effective_from: "2026-08-01",
    effective_to: "2026-08-31",
  });
});

test("rejects invalid or out-of-dashboard effective period", async () => {
  const { connection } = fakeConnection();
  await assert.rejects(
    () => preflightBindings(connection as never, 29, [
      binding("line-a", 501, "2026-07-31", "2026-08-20"),
    ]),
    /dashboard period/,
  );
  await assert.rejects(
    () => preflightBindings(connection as never, 29, [
      binding("line-a", 501, "2026-08-20", "2026-08-10"),
    ]),
    /effective period/,
  );
});

test("replacement audits every deleted and created row with authenticated actor", async () => {
  const { connection, statements } = fakeConnection({
    existing: [{
      id: 41,
      dashboard_id: 29,
      line_key: "old-line",
      channel: "old-line",
      source_key: "between",
      canonical_campaign_id: 501,
      platform_account_id: "1113",
      platform_campaign_id: "24932",
      effective_from: "2026-08-01",
      effective_to: "2026-08-31",
      created_by: "old@example.test",
    }],
  });

  await replaceEffectiveBindings(
    connection as never,
    29,
    "manager@example.test",
    [binding("line-a", 501, null, null)],
  );

  const auditCalls = statements.filter(({ sql }) => sql.startsWith("INSERT INTO media_plan_binding_audit"));
  assert.equal(auditCalls.length, 2);
  assert.equal(auditCalls[0].params[2], "manager@example.test");
  assert.match(String(auditCalls[0].params[3]), /old-line/);
  assert.equal(auditCalls[1].params[2], "manager@example.test");
  assert.match(String(auditCalls[1].params[3]), /line-a/);
  assert.ok(statements.some(({ sql }) => sql === "DELETE FROM media_plan_bindings WHERE dashboard_id = ?"));
});
