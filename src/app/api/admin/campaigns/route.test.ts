import assert from "node:assert/strict";
import test from "node:test";
import pool from "@/lib/db";
import { GET } from "./route";

test("campaign GET returns canonical account-aware identity and binds account/search filters", async (t) => {
  let calledSql = "";
  let calledParams: unknown[] = [];
  t.mock.method(pool, "query", async (sql: string, params?: unknown[]) => {
    calledSql = sql;
    calledParams = params ?? [];
    return [[{
      canonical_campaign_id: 501,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet 1113",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
    }], []] as never;
  });

  const response = await GET(new Request(
    "http://localhost/api/admin/campaigns?platform=between&account_ids=1113,1113&search=OLV",
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    campaigns: [{
      canonical_campaign_id: 501,
      source_key: "between",
      platform_account_id: "1113",
      account_name: "Cabinet 1113",
      platform_campaign_id: "24932",
      campaign_name: "OLV Serials",
      display_label: "OLV Serials · 24932 · Cabinet 1113",
      id: "24932",
      name: "OLV Serials",
      platform: "between",
      copyable_id: "24932",
    }],
    total: 1,
  });
  assert.match(calledSql, /c\.platform_account_id IN \(\?\)/);
  assert.match(calledSql, /c\.campaign_name LIKE \?/);
  assert.deepEqual(calledParams, ["between", "1113", "%OLV%", "%OLV%", "%OLV%"]);
});

test("campaign GET rejects a missing platform before canonical database access", async (t) => {
  let calls = 0;
  t.mock.method(pool, "query", async () => {
    calls += 1;
    return [[], []] as never;
  });
  const response = await GET(new Request("http://localhost/api/admin/campaigns"));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
