import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";
import { build } from "esbuild";
import ExcelJS from "exceljs";
import { abbottFixture } from "../../../../../lib/abbott-export-fixture";
import { createAbbottExcelHandler } from "../../../../../lib/abbott-excel-handler";
import { GET } from "./route";

const context = { id: 18, client_id: "abbott", dashboard_type: "abbott_bi", auth_mode: "password_only" as const,
  client_name: "Abbott", dashboard_name: "Abbott BI", is_active: true, access_users_count: 0 };
const access = (audience: "manager" | "embed" = "manager") => ({
  context, authorized: true as const, reason: "authorized" as const, audience,
  credentialVersion: audience === "manager" ? 7 : undefined,
  payload: {type: "viewer" as const, dashboard_id: 18, audience, exp: 9999999999},
});
const loaded = () => ({dashboard_id: 18, data: abbottFixture()}) as never;

async function workbook(response: Response) {
  assert.equal(response.status, 200);
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await response.arrayBuffer());
  return result;
}

async function combinedHandler(audience: "manager" | "embed") {
  // Only the authorization and data IO seams are replaced: the existing handler,
  // projection and ExcelJS serialization all execute unchanged.
  const result = await build({
    entryPoints: ["src/app/api/dashboard/[id]/excel/route.ts"],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{
      name: "fixture-io",
      setup(builder) {
        builder.onResolve({filter: /^@\/lib\/(dashboard-access|dashboard-data-loader)$/}, (args) => ({path: args.path, namespace: "fixture"}));
        builder.onLoad({filter: /.*/, namespace: "fixture"}, (args) => ({
          contents: args.path.endsWith("dashboard-access")
            ? "export const isDashboardAccessAuthorized=async()=>access;"
            : "export const loadDashboardData=async()=>({data:fixture,leads_rows:[]});",
        }));
      },
    }],
  });
  const evaluatedModule = {exports: {}} as {exports: { GET: typeof GET }};
  new Function("require", "module", "exports", "fixture", "access", result.outputFiles[0].text)(
    createRequire(import.meta.url), evaluatedModule, evaluatedModule.exports, abbottFixture(), access(audience),
  );
  return evaluatedModule.exports.GET;
}

test("route exports the isolated GET handler", () => assert.equal(typeof GET, "function"));

test("HTTP workbook exactly matches the executed combined Abbott fixture baseline for both audiences and aliases", async () => {
  for (const audience of ["manager", "embed"] as const) {
    const combined = await combinedHandler(audience);
    for (const id of ["18", "abbott"]) {
      const request = new Request(`https://example.test/api/dashboard/${id}/excel?from=2026-07-01&to=2026-07-15&embed_key=fixture`);
      const calls: unknown[][] = [];
      const handler = createAbbottExcelHandler({
        authorize: async () => access(audience),
        load: async (...args) => {calls.push(args); return loaded();},
      });
      const response = await handler(request, {params: {id}});
      const baseline = await combined(request, {params: Promise.resolve({id})});
      assert.deepEqual(Object.fromEntries(response.headers), Object.fromEntries(baseline.headers));
      assert.deepEqual(calls, [[request, id, audience]]);
      const actualBook = await workbook(response);
      const baselineBook = await workbook(baseline);
      assert.deepEqual(actualBook.worksheets.map(sheet => sheet.model), baselineBook.worksheets.map(sheet => sheet.model));
      assert.deepEqual(actualBook.worksheets, [], "baseline has zero sheets, rows, cells, formulas and Abbott rows");
      assert.equal(actualBook.creator, "ReportingDash");
      assert.equal(actualBook.properties.date1904, true);
      assert.doesNotMatch(JSON.stringify(actualBook.model), /raw_user_id|visit_id|start_url|end_url|session_journeys|raw-user-42|doctor=private/);
    }
  }
});

test("foreign identifiers, unauthorized access and resolved identity mismatches never load", async () => {
  let authCalls = 0;
  const handler = createAbbottExcelHandler({
    authorize: async () => {authCalls++; return access();},
    load: async () => assert.fail("must not load"),
  });
  assert.equal((await handler(new Request("https://example.test"), {params: {id:"28"}})).status, 404);
  assert.equal(authCalls, 0);
  for (const [result, status] of [
    [{context:null,authorized:false,reason:"not_found"},404],
    [{context,authorized:false,reason:"auth_required"},401],
    [{...access(),context:{...context,id:28}},404],
    [{...access(),context:{...context,dashboard_type:"other"}},404],
  ] as const) {
    const handle = createAbbottExcelHandler({authorize: async () => result as never, load: async () => assert.fail("must not load")});
    const response = await handle(new Request("https://example.test"), {params:{id:"18"}});
    assert.equal(response.status,status);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
  }
});

test("loaded identity mismatch and failures preserve private generic error semantics", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(console, "error", () => undefined);
  for (const value of [
    {dashboard_id:28,data:abbottFixture()},
    {dashboard_id:18,data:{...abbottFixture(),dashboard:{...abbottFixture().dashboard,type:"other"}}},
    new Error("Dashboard not found"), new Error("private failure"),
  ]) {
    const handler = createAbbottExcelHandler({authorize:async()=>access(),load:async()=>{if(value instanceof Error)throw value;return value as never;}});
    const response = await handler(new Request("https://example.test"),{params:{id:"abbott"}});
    assert.equal(response.status,value instanceof Error && value.message !== "Dashboard not found" ? 500 : 404);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.doesNotMatch(await response.text(), /private failure/);
  }
});
